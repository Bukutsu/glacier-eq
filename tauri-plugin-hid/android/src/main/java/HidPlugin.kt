package uk.redfern.tauri.plugin.hid

import android.annotation.SuppressLint
import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.hardware.usb.UsbRequest
import android.util.Log
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.UUID

private const val TAG = "HidPlugin"
private const val MAX_QUEUED_READS = 64
private const val READ_POLL_SLICE_MS = 100L

private fun sameUsbDevice(left: UsbDevice, right: UsbDevice): Boolean =
    left.deviceName == right.deviceName
        && left.vendorId == right.vendorId
        && left.productId == right.productId
        && left.deviceId == right.deviceId

sealed class HidResult<out T> {
    data class Success<T>(val data: T) : HidResult<T>()
    data class Error(val message: String, val exception: Exception? = null) : HidResult<Nothing>() {
        init {
            Log.e(TAG, message, exception)
        }
    }
}

// This small Android-side parser selects an interface before starting the reader.
// Rust validates the selected raw descriptor again with the shared core parser.
private data class HidReportSizes(val input: Map<Int, Long>, val output: Map<Int, Long>)

private fun parseReportSizes(bytes: ByteArray): HidReportSizes {
    require(bytes.isNotEmpty()) { "Empty HID report descriptor" }
    val input = mutableMapOf<Int, Long>()
    val output = mutableMapOf<Int, Long>()
    var size = 0L
    var count = 0L
    var id = 0
    var collections = 0
    var numbered = false
    var unnumbered = false
    val stack = mutableListOf<Triple<Long, Long, Int>>()
    var offset = 0
    while (offset < bytes.size) {
        val prefix = bytes[offset++].toInt() and 0xff
        if (prefix == 0xfe) {
            require(bytes.size - offset >= 2) { "Truncated HID long item" }
            val length = bytes[offset].toInt() and 0xff
            offset += 2
            require(bytes.size - offset >= length) { "Truncated HID long item payload" }
            offset += length
            continue
        }
        val length = if (prefix and 3 == 3) 4 else prefix and 3
        require(bytes.size - offset >= length) { "Truncated HID short item" }
        var value = 0L
        for (i in 0 until length) value = value or ((bytes[offset + i].toLong() and 0xff) shl (8 * i))
        offset += length
        val kind = (prefix shr 2) and 3
        val tag = prefix shr 4
        when {
            kind == 1 && (tag == 7 || tag == 9) -> {
                require(length > 0) { "Missing HID report size/count" }
                if (tag == 7) size = value else count = value
            }
            kind == 1 && tag == 8 -> {
                require(length == 1 && value in 1..255) { "Invalid HID report ID" }
                id = value.toInt()
            }
            kind == 1 && tag == 10 -> {
                require(length == 0) { "Invalid HID global Push" }
                stack.add(Triple(size, count, id))
            }
            kind == 1 && tag == 11 -> {
                require(length == 0 && stack.isNotEmpty()) { "Unmatched HID global Pop" }
                val saved = stack.removeAt(stack.lastIndex)
                size = saved.first; count = saved.second; id = saved.third
            }
            kind == 0 && tag == 10 -> {
                require(length == 1) { "Invalid HID Collection" }
                collections++
            }
            kind == 0 && tag == 12 -> {
                require(length == 0 && collections > 0) { "Unmatched HID End Collection" }
                collections--
            }
            kind == 0 && (tag == 8 || tag == 9 || tag == 11) -> {
                require(length > 0 && size > 0 && count > 0) { "Missing/zero HID report size/count" }
                numbered = numbered || id != 0
                unnumbered = unnumbered || id == 0
                require(!(numbered && unnumbered)) { "Mixed numbered and unnumbered HID reports" }
                require(size <= 0xffffffffL / count) { "HID report bit size overflow" }
                val bits = size * count
                if (tag != 11) {
                    val reports = if (tag == 8) input else output
                    val total = (reports[id] ?: 0L) + bits
                    require(total <= 0xffffffffL) { "HID report bit size overflow" }
                    reports[id] = total
                }
            }
        }
    }
    require(stack.isEmpty() && collections == 0) { "Unbalanced HID globals/collections" }
    require(input.isNotEmpty() || output.isNotEmpty()) { "HID descriptor has no Input or Output reports" }
    return HidReportSizes(input, output)
}

class HidDevice(
    private val usbDevice: UsbDevice,
    private val deviceConnection: UsbDeviceConnection,
    private val sessionId: Long,
    private val reportContract: OpenArgs,
    private val onDisconnected: (HidDevice) -> Unit
) {
    private var usbInEndpoint: UsbEndpoint? = null
    private var usbOutEndpoint: UsbEndpoint? = null
    private var usbInterface: UsbInterface? = null
    var reportDescriptor: ByteArray = byteArrayOf()
        private set
    private var reportSizes: HidReportSizes? = null
    private var inputBufferSize = 64
    
    private val readQueue = LinkedBlockingQueue<ByteArray>(MAX_QUEUED_READS)
    private val operationLock = Any()
    private val connectionLock = Any()
    @Volatile
    private var isReading = false
    @Volatile
    private var closed = false
    @Volatile
    private var resourcesReleased = false
    private var readThread: Thread? = null
    @Volatile
    private var activeReadRequest: UsbRequest? = null

    val path: String
        get() = usbDevice.deviceName

    val connectionSessionId: Long
        get() = sessionId

    val displayName: String
        get() = usbDevice.productName ?: usbDevice.deviceName

    fun matchesDevice(device: UsbDevice): Boolean = sameUsbDevice(usbDevice, device)
    
    private fun fetchReportDescriptor(intf: UsbInterface): ByteArray {
        // Read the advertised report descriptor length from the HID descriptor.
        // Endpoint maxPacketSize says nothing about the HID report contract.
        val raw = deviceConnection.rawDescriptors
        var offset = 0
        var currentId = -1
        var currentAlternate = -1
        var reportLength = 0
        while (offset < raw.size) {
            require(raw.size - offset >= 2) { "Truncated USB descriptor" }
            val length = raw[offset].toInt() and 0xff
            val type = raw[offset + 1].toInt() and 0xff
            require(length >= 2 && raw.size - offset >= length) { "Invalid USB descriptor length" }
            if (type == 4 && length >= 9) {
                currentId = raw[offset + 2].toInt() and 0xff
                currentAlternate = raw[offset + 3].toInt() and 0xff
            }
            if (type == 0x21 && currentId == intf.id && currentAlternate == intf.alternateSetting) {
                require(length >= 6) { "Truncated HID descriptor" }
                val count = raw[offset + 5].toInt() and 0xff
                require(length >= 6 + count * 3) { "Truncated HID subordinate descriptors" }
                for (i in 0 until count) {
                    val item = offset + 6 + i * 3
                    if ((raw[item].toInt() and 0xff) == 0x22) {
                        reportLength = (raw[item + 1].toInt() and 0xff) or ((raw[item + 2].toInt() and 0xff) shl 8)
                    }
                }
            }
            offset += length
        }
        require(reportLength in 1..4096) { "Missing or unsupported HID report descriptor length: $reportLength" }
        val buffer = ByteArray(reportLength)
        val received = deviceConnection.controlTransfer(0x81, 0x06, 0x2200, intf.id, buffer, buffer.size, 1000)
        require(received == reportLength) { "HID report descriptor GET_DESCRIPTOR returned $received, expected $reportLength" }
        return buffer
    }

    // Initialize and connect to the device
    fun initialize(): HidResult<Unit> {
        try {
            val candidates = mutableListOf<Triple<UsbInterface, ByteArray, HidReportSizes>>()
            val rejected = mutableListOf<String>()
            for (i in 0 until usbDevice.interfaceCount) {
                val intf = usbDevice.getInterface(i)
                if (intf.interfaceClass != UsbConstants.USB_CLASS_HID || intf.alternateSetting != 0) continue
                try {
                    require((0 until intf.endpointCount).any {
                        val ep = intf.getEndpoint(it)
                        ep.type == UsbConstants.USB_ENDPOINT_XFER_INT && ep.direction == UsbConstants.USB_DIR_IN
                    }) { "No interrupt IN endpoint" }
                    val descriptor = fetchReportDescriptor(intf)
                    val sizes = parseReportSizes(descriptor)
                    val id = reportContract.reportId
                    if (id != null) {
                        require(id in 0..255) { "Invalid required report ID" }
                        require(reportContract.minOutputBytes >= 0 && reportContract.minInputBytes >= 0) { "Invalid required report length" }
                        for ((direction, reports, minimum) in listOf(
                            Triple("Output", sizes.output, reportContract.minOutputBytes),
                            Triple("Input", sizes.input, reportContract.minInputBytes)
                        )) {
                            if (minimum == 0) continue
                            val bits = reports[id] ?: error("No $direction report ID 0x${id.toString(16)}")
                            require(bits >= minimum.toLong() * 8) { "$direction report ID 0x${id.toString(16)} is too short: $bits bits, requires $minimum payload bytes" }
                        }
                    }
                    candidates.add(Triple(intf, descriptor, sizes))
                } catch (e: Exception) {
                    rejected.add("interface ${intf.id}: ${e.message}")
                }
            }
            require(candidates.size == 1) {
                if (candidates.isEmpty()) "No HID interface satisfies the report contract: ${rejected.joinToString("; ")}"
                else "Multiple HID interfaces satisfy the report contract; refusing ambiguous interface selection"
            }
            val candidate = candidates.single()
            reportDescriptor = candidate.second
            reportSizes = candidate.third
            // Read a complete report, even when USB splits it into smaller packets.
            val maxInputBits = candidate.third.input.values.maxOrNull() ?: 0L
            val numbered = candidate.third.input.keys.any { it != 0 }
            val readSize = (maxInputBits + 7) / 8 + if (numbered) 1 else 0
            require(readSize in 1..16384) { "Unsupported HID input report length: $readSize" }
            inputBufferSize = readSize.toInt()
            val usbInterface = candidate.first
            this.usbInterface = usbInterface
            
            // Log device details
            Log.i(TAG, "Interface Count: ${usbDevice.interfaceCount}")
            Log.i(TAG, "Using Interface ID: ${usbInterface.id}")
            Log.i(TAG, "Interface Class: ${usbInterface.interfaceClass}")
            Log.i(TAG, "Interface Subclass: ${usbInterface.interfaceSubclass}")
            Log.i(TAG, "Interface Protocol: ${usbInterface.interfaceProtocol}")
            Log.i(TAG, "Interface Endpoint Count: ${usbInterface.endpointCount}")
            
            // Find IN and OUT endpoints
            for (i in 0 until usbInterface.endpointCount) {
                val endpoint: UsbEndpoint = usbInterface.getEndpoint(i)
                Log.i(TAG, "Endpoint ID: ${endpoint.endpointNumber}, Type: ${endpoint.type}, MaxPacketSize: ${endpoint.maxPacketSize}")
                Log.i(
                    TAG,
                    "Endpoint Direction: ${if (endpoint.direction == UsbConstants.USB_DIR_IN) "IN" else "OUT"}"
                )
                if (endpoint.direction == UsbConstants.USB_DIR_IN && endpoint.type == UsbConstants.USB_ENDPOINT_XFER_INT) {
                    Log.i(TAG, "Found IN endpoint: maxPacketSize=${endpoint.maxPacketSize}")
                    usbInEndpoint = endpoint
                }
                if (endpoint.direction == UsbConstants.USB_DIR_OUT && endpoint.type == UsbConstants.USB_ENDPOINT_XFER_INT) {
                    Log.i(TAG, "Found OUT endpoint: maxPacketSize=${endpoint.maxPacketSize}")
                    usbOutEndpoint = endpoint
                }
            }
            
            // Claim interface
            val claimed = deviceConnection.claimInterface(usbInterface, true)
            if (!claimed) {
                closeConnection()
                return HidResult.Error("Failed to claim interface")
            }
            Log.i(TAG, "Interface claimed successfully")
            
            return HidResult.Success(Unit)
        } catch (e: Exception) {
            closeConnection()
            return HidResult.Error("Error initializing device: ${e.message}", e)
        }
    }

    fun startReading(): HidResult<Unit> {
        val endpoint = usbInEndpoint ?: return HidResult.Error("Cannot start reader: IN endpoint not available")
        val request = UsbRequest()
        if (!request.initialize(deviceConnection, endpoint)) {
            Log.e(TAG, "Read thread: failed to initialize UsbRequest")
            request.close()
            return HidResult.Error("Failed to initialize USB read endpoint")
        }

        val thread = Thread {
            Log.i(TAG, "Background read thread started using UsbRequest")
            val bufferSize = inputBufferSize
            var readFailed = false
            try {
                var failureCount = 0
                val buffer = ByteBuffer.allocateDirect(bufferSize)
                while (isReading && !closed) {
                    buffer.clear()

                    val queued = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                        request.queue(buffer)
                    } else {
                        @Suppress("DEPRECATION")
                        request.queue(buffer, bufferSize)
                    }

                    if (!queued) {
                        Log.e(TAG, "Read thread: failed to queue UsbRequest")
                        failureCount++
                        if (failureCount > 5) {
                            Log.w(TAG, "Read thread: persistent queue failure (device disconnected), stopping loop")
                            readFailed = true
                            break
                        }
                        Thread.sleep(100)
                        continue
                    }

                    // closeConnection may have cancelled the request just
                    // before this thread queued it. Recheck under the same lock
                    // and cancel the newly queued request before waiting.
                    val stopAfterQueue = synchronized(connectionLock) {
                        if (isReading && !closed) {
                            false
                        } else {
                            try {
                                request.cancel()
                            } catch (_: Exception) {}
                            true
                        }
                    }
                    if (stopAfterQueue) break

                    val completed = deviceConnection.requestWait()
                    if (!isReading || closed) break
                    if (completed == null) {
                        failureCount++
                        if (failureCount > 5) {
                            Log.w(TAG, "Read thread: repeated requestWait failure, stopping loop")
                            readFailed = true
                            break
                        }
                        Thread.sleep(10)
                        continue
                    }
                    if (completed !== request) {
                        Log.w(TAG, "Read thread: unexpected UsbRequest completion")
                        failureCount++
                        if (failureCount > 5) {
                            readFailed = true
                            break
                        }
                        continue
                    }
                    failureCount = 0

                    val bytesRead = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                        val size = buffer.position()
                        buffer.flip()
                        size
                    } else {
                        buffer.flip()
                        buffer.remaining()
                    }

                    if (bytesRead > 0) {
                        val data = ByteArray(bytesRead)
                        buffer.get(data)
                        Log.i(TAG, "Read thread: got data (size=$bytesRead): " + data.joinToString(", ") { String.format("%02X", it) })
                        if (!readQueue.offer(data)) {
                            readQueue.poll()
                            readQueue.offer(data)
                        }
                    }
                }
            } catch (e: InterruptedException) {
                readFailed = !closed
                Log.i(TAG, "Read thread interrupted")
            } catch (e: Exception) {
                readFailed = !closed
                Log.e(TAG, "Read thread exception: ${e.message}", e)
            } finally {
                try {
                    request.cancel()
                    request.close()
                } catch (_: Exception) {}
                synchronized(connectionLock) {
                    if (activeReadRequest === request) activeReadRequest = null
                }
                if (readFailed && !closed) {
                    // Release the claimed interface before notifying the
                    // frontend. The callback may immediately start a reconnect;
                    // an event that races ahead of release would leave the old
                    // device interface claimed.
                    releaseConnectionResources()
                    onDisconnected(this)
                } else {
                    val releaseFromReader = synchronized(connectionLock) {
                        closed && readThread === Thread.currentThread()
                    }
                    if (releaseFromReader) {
                        // If closeConnection was requested from the reader itself,
                        // defer resource release until this thread has finished.
                        releaseConnectionResources()
                    }
                }
                Log.i(TAG, "Background read thread stopped")
            }
        }

        synchronized(connectionLock) {
            if (closed) {
                try {
                    request.cancel()
                    request.close()
                } catch (_: Exception) {}
                return HidResult.Error("Cannot start reader: device is closed")
            }
            isReading = true
            readQueue.clear()
            activeReadRequest = request
            readThread = thread
            thread.start()
        }
        return HidResult.Success(Unit)
    }

    // Read data from the device queue (thread-safe, timed block)
    fun read(timeout: Int): HidResult<ByteArray> = synchronized(operationLock) {
        if (usbInEndpoint == null) {
            return@synchronized HidResult.Error("Cannot read: IN endpoint not available")
        }

        val deadline = if (timeout < 0) {
            Long.MAX_VALUE
        } else {
            System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeout.toLong())
        }
        try {
            while (!closed) {
                val remainingNanos = deadline - System.nanoTime()
                if (timeout >= 0 && remainingNanos <= 0) break
                val waitMs = if (timeout < 0) {
                    READ_POLL_SLICE_MS
                } else {
                    minOf(
                        READ_POLL_SLICE_MS,
                        TimeUnit.NANOSECONDS.toMillis(remainingNanos).coerceAtLeast(1L)
                    )
                }
                val data = readQueue.poll(waitMs, TimeUnit.MILLISECONDS)
                if (data != null) {
                    Log.i(TAG, "read: got data from queue (size=${data.size}): " + data.joinToString(", ") { String.format("%02X", it) })
                    return@synchronized HidResult.Success(data)
                }
            }
            HidResult.Success(ByteArray(0))
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
            HidResult.Success(ByteArray(0))
        } catch (e: Exception) {
            HidResult.Error("Read error: ${e.message}", e)
        }
    }
    
    // Write an HID report. The report ID is kept separate because it belongs in
    // SET_REPORT's wValue, while interrupt transfers only include it when non-zero.
    fun write(reportId: Int, data: ByteArray): HidResult<Unit> {
        if (reportId !in 0..0xFF) {
            return HidResult.Error("Report ID is out of range: $reportId")
        }

        val bits = reportSizes?.output?.get(reportId)
            ?: return HidResult.Error("No Output report ID 0x${reportId.toString(16)} on selected HID interface")
        if (data.size.toLong() * 8 > bits) {
            return HidResult.Error("Output payload exceeds HID report size: ${data.size} bytes, $bits bits")
        }
        return synchronized(operationLock) {
            synchronized(connectionLock) {
                if (closed) {
                    HidResult.Error("Cannot write: device is closed")
                } else {
                    // Many USB HID DACs only process commands sent through SET_REPORT.
                    val controlResult = writeViaControlTransfer(reportId, data)
                    if (controlResult is HidResult.Success) {
                        controlResult
                    } else {
                        val outEndpoint = usbOutEndpoint
                        if (outEndpoint == null) {
                            HidResult.Error("Failed to write: OUT endpoint is not available and SET_REPORT failed")
                        } else {
                            val interruptData = if (reportId == 0) {
                                data
                            } else {
                                byteArrayOf(reportId.toByte()) + data
                            }
                            try {
                                val bytesWritten = deviceConnection.bulkTransfer(
                                    outEndpoint,
                                    interruptData,
                                    interruptData.size,
                                    1000
                                )
                                Log.i(TAG, "write (bulkTransfer): wrote $bytesWritten/${interruptData.size} bytes")
                                if (bytesWritten == interruptData.size) {
                                    HidResult.Success(Unit)
                                } else {
                                    HidResult.Error(
                                        "Failed to write via SET_REPORT or interrupt OUT endpoint. " +
                                            "Last result=$bytesWritten"
                                    )
                                }
                            } catch (e: Exception) {
                                HidResult.Error("Interrupt OUT transfer failed: ${e.message}", e)
                            }
                        }
                    }
                }
            }
        }
    }

    // SET_REPORT receives the report ID for numbered reports. Unnumbered HID
    // reports omit the zero ID byte from the control-transfer payload.
    private fun writeViaControlTransfer(reportId: Int, data: ByteArray): HidResult<Unit> {
        val ifaceId = usbInterface?.id
            ?: return HidResult.Error("Cannot write: interface is not available")
        val wValue = 0x0200 or reportId
        val controlData = if (reportId == 0) {
            data
        } else {
            byteArrayOf(reportId.toByte()) + data
        }

        Log.i(TAG, "write (controlTransfer): SET_REPORT reportId=0x${String.format("%02X", reportId)}, ifaceId=$ifaceId, dataSize=${controlData.size}")

        return try {
            val result = deviceConnection.controlTransfer(
                0x21,       // bmRequestType: host-to-device, class, interface
                0x09,       // bRequest: SET_REPORT
                wValue,     // wValue: report type (output=0x02) | report ID
                ifaceId,    // wIndex: interface number
                controlData,
                controlData.size,
                1000
            )

            Log.i(TAG, "write (controlTransfer): result=$result")
            if (result == controlData.size) {
                HidResult.Success(Unit)
            } else {
                HidResult.Error("SET_REPORT failed: result=$result, expected=${controlData.size}")
            }
        } catch (e: Exception) {
            HidResult.Error("SET_REPORT failed: ${e.message}", e)
        }
    }
    
    // Close the connection and release resources. This method is idempotent.
    fun closeConnection() {
        val thread: Thread?
        synchronized(connectionLock) {
            if (closed) return
            closed = true
            isReading = false
            try {
                activeReadRequest?.let { request ->
                    request.cancel()
                }
            } catch (_: Exception) {}
            thread = readThread
        }

        if (thread != null && thread === Thread.currentThread()) {
            Log.e(TAG, "Connection close requested from the HID reader thread")
            return
        }

        if (thread != null && thread !== Thread.currentThread()) {
            thread.interrupt()
            try {
                thread.join(1000)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            }
            if (thread.isAlive) {
                // Do not report a successful close while the interface is
                // still claimed. Closing the connection/request is the bounded
                // escape hatch for a wedged driver; the idempotent release
                // guard makes the reader's eventual finally block harmless.
                Log.w(TAG, "Reader did not exit within 1s; forcing connection release")
                releaseConnectionResources()
                return
            }
        }

        releaseConnectionResources()
    }

    private fun releaseConnectionResources() {
        val shouldRelease = synchronized(connectionLock) {
            if (resourcesReleased) {
                false
            } else {
                resourcesReleased = true
                closed = true
                readThread = null
                readQueue.clear()
                true
            }
        }
        if (!shouldRelease) return
        try {
            usbInterface?.let {
                deviceConnection.releaseInterface(it)
            }
            deviceConnection.close()
        } catch (e: Exception) {
            Log.e(TAG, "Error closing connection: ${e.message}")
        }
    }
}

@InvokeArg
class OpenArgs {
    var path: String? = null
    var sessionId: Long = 0
    var reportId: Int? = null
    var minOutputBytes: Int = 0
    var minInputBytes: Int = 0
}

@InvokeArg
class CloseArgs {
    var path: String? = null
    var sessionId: Long? = null
}

@InvokeArg
class ReadArgs {
    var path: String? = null
    var timeout: Int = 0
}

@InvokeArg
class WriteArgs {
    var path: String? = null
    var reportId: Int = 0
    var data: ByteArray? = null
}

@TauriPlugin
class HidPlugin(private val activity: Activity): Plugin(activity) {
    companion object {
        private const val ACTION_USB_PERMISSION = "uk.redfern.tauri.plugin.hid.USB_PERMISSION"
        private const val EXTRA_PERMISSION_TOKEN = "uk.redfern.tauri.plugin.hid.PERMISSION_TOKEN"
    }
    
    private val usbManager = activity.getSystemService(Context.USB_SERVICE) as UsbManager
    private val connectedDevices = ConcurrentHashMap<String, HidDevice>()
    private val ioExecutor: ExecutorService = Executors.newCachedThreadPool { runnable ->
        Thread(runnable, "HidPlugin-IO").apply { isDaemon = true }
    }
    private val pendingIoInvokes = mutableSetOf<Invoke>()
    @Volatile
    private var destroyed = false
    private var permissionReceiver: BroadcastReceiver? = null
    private var usbDetachReceiver: BroadcastReceiver? = null
    
    // Permission handling state
    private var pendingDevicePath: String? = null
    private var pendingSessionId: Long = 0
    private var pendingUsbDevice: UsbDevice? = null
    private var pendingInvoke: Invoke? = null
    private var pendingPermissionToken: String? = null

    init {
        registerUsbPermissionReceiver()
        registerUsbDetachReceiver()
    }

    private fun enqueueIo(invoke: Invoke, operation: () -> Unit): Boolean {
        synchronized(this) {
            if (destroyed) {
                invoke.reject("HID plugin is no longer active")
                return false
            }
            pendingIoInvokes.add(invoke)
        }
        return try {
            ioExecutor.execute {
                try {
                    operation()
                } catch (e: Exception) {
                    finishIo(invoke) { invoke.reject("HID I/O failed: ${e.message}") }
                }
            }
            true
        } catch (e: Exception) {
            finishIo(invoke) { invoke.reject("Failed to schedule HID I/O: ${e.message}") }
            false
        }
    }

    private fun finishIo(invoke: Invoke, response: () -> Unit) {
        synchronized(this) {
            if (destroyed || !pendingIoInvokes.remove(invoke)) return
            response()
        }
    }

    private fun disconnectedPayload(path: String, name: String, sessionId: Long): JSObject = JSObject().apply {
        put("path", path)
        put("name", name)
        put("session_id", sessionId)
    }

    private fun emitDisconnected(payload: JSObject) {
        // Plugin listener registration/removal runs on the UI command thread;
        // serialize reader/detach notifications onto that same thread.
        activity.runOnUiThread {
            if (!destroyed) {
                triggerObject("device-disconnected", payload)
                triggerObject("deviceDisconnected", payload)
            }
        }
    }

    private fun registerUsbDetachReceiver() {
        usbDetachReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (UsbManager.ACTION_USB_DEVICE_DETACHED == intent.action) {
                    val device: UsbDevice? = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                        intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        intent.getParcelableExtra(UsbManager.EXTRA_DEVICE) as? UsbDevice
                    }
                    device?.let {
                        val detached = connectedDevices[it.deviceName]
                            ?.takeIf { current -> current.matchesDevice(it) }
                            ?.also { current -> connectedDevices.remove(it.deviceName, current) }
                        val pending = synchronized(this@HidPlugin) {
                            if (pendingUsbDevice?.let { pending -> sameUsbDevice(pending, it) } == true) {
                                val waitingInvoke = pendingInvoke
                                pendingInvoke = null
                                pendingUsbDevice = null
                                pendingDevicePath = null
                                pendingSessionId = 0
                                pendingPermissionToken = null
                                waitingInvoke
                            } else {
                                null
                            }
                        }
                        pending?.reject("USB device detached before permission was granted")

                        Log.i(TAG, "Device detached: ${it.deviceName}")
                        if (detached != null) {
                            detached.closeConnection()
                            val payload = disconnectedPayload(
                                it.deviceName,
                                it.productName ?: it.deviceName,
                                detached.connectionSessionId
                            )
                            emitDisconnected(payload)
                        }
                    }
                }
            }
        }

        val filter = IntentFilter(UsbManager.ACTION_USB_DEVICE_DETACHED)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            activity.registerReceiver(usbDetachReceiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            activity.registerReceiver(usbDetachReceiver, filter)
        }
    }

    @SuppressLint("UnspecifiedRegisterReceiverFlag")
    private fun registerUsbPermissionReceiver() {
        permissionReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (ACTION_USB_PERMISSION == intent.action) {
                    val device = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                        intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        intent.getParcelableExtra(UsbManager.EXTRA_DEVICE) as? UsbDevice
                    }
                    val granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
                    val pending = synchronized(this@HidPlugin) {
                        if (intent.getStringExtra(EXTRA_PERMISSION_TOKEN) != pendingPermissionToken) {
                            null
                        } else {
                            val value = Pair(
                                Triple(pendingInvoke, pendingDevicePath, pendingUsbDevice),
                                pendingSessionId
                            )
                            pendingInvoke = null
                            pendingUsbDevice = null
                            pendingDevicePath = null
                            pendingSessionId = 0
                            pendingPermissionToken = null
                            value
                        }
                    }
                    if (pending == null) {
                        Log.w(TAG, "Ignoring USB permission broadcast with an invalid token")
                        return
                    }
                    val pendingRequest = pending.first
                    val invoke = pendingRequest.first
                    val expectedPath = pendingRequest.second
                    val expectedDevice = pendingRequest.third
                    val expectedSessionId = pending.second

                    if (invoke == null) {
                        Log.w(TAG, "USB permission broadcast but no pending invoke")
                        return
                    }

                    if (!granted || device == null) {
                        Log.i(TAG, "USB permission DENIED for ${device?.deviceName ?: "unknown device"}")
                        invoke.reject("Permission denied for USB device")
                        return
                    }

                    if (expectedDevice == null || expectedPath == null || device.deviceName != expectedDevice.deviceName) {
                        Log.w(
                            TAG,
                            "USB permission for unexpected device ${device.deviceName} " +
                            "(expected=${expectedDevice?.deviceName})"
                        )
                        invoke.reject("USB permission for unexpected device")
                        return
                    }

                    createAndConnectDevice(expectedDevice, expectedPath, expectedSessionId, invoke)
                }
            }
        }
        
        val filter = IntentFilter(ACTION_USB_PERMISSION)
        
        // Register with RECEIVER_EXPORTED flag on Android 13+ (TIRAMISU)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            activity.registerReceiver(permissionReceiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            activity.registerReceiver(permissionReceiver, filter)
        }
    }
    
    private fun handleDeviceFailure(path: String, failedDevice: HidDevice) {
        if (!connectedDevices.remove(path, failedDevice)) {
            failedDevice.closeConnection()
            return
        }
        Log.w(TAG, "HID reader stopped unexpectedly: $path")
        failedDevice.closeConnection()
        val payload = disconnectedPayload(
            failedDevice.path,
            failedDevice.displayName,
            failedDevice.connectionSessionId
        )
        emitDisconnected(payload)
    }

    private fun requestPermission(device: UsbDevice, token: String) {
        val intent = Intent(ACTION_USB_PERMISSION).apply {
            setPackage(activity.packageName)
            putExtra(EXTRA_PERMISSION_TOKEN, token)
        }

        val flags =
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            } else {
                PendingIntent.FLAG_UPDATE_CURRENT
            }

        val permissionIntent = PendingIntent.getBroadcast(
            activity,
            token.hashCode(),
            intent,
            flags
        )

        try {
            val canRequest = synchronized(this) {
                if (destroyed || pendingPermissionToken != token) {
                    false
                } else {
                    usbManager.requestPermission(device, permissionIntent)
                    true
                }
            }
            if (canRequest) {
                Log.i(TAG, "Permission requested for device: ${device.deviceName}")
            }
        } catch (e: Exception) {
            val waiting = synchronized(this) {
                if (pendingPermissionToken == token) {
                    val waitingInvoke = pendingInvoke
                    pendingInvoke = null
                    pendingUsbDevice = null
                    pendingDevicePath = null
                    pendingPermissionToken = null
                    waitingInvoke
                } else {
                    null
                }
            }
            waiting?.reject("Failed to request USB permission: ${e.message}")
        }
    }
    
    private fun createAndConnectDevice(
        usbDevice: UsbDevice,
        path: String,
        sessionId: Long,
        invoke: Invoke
    ) {
        // Descriptor reads may block for each interface; keep them off the UI
        // command thread and retain the existing destroy/cancellation fence.
        enqueueIo(invoke) {
            if (destroyed) {
                finishIo(invoke) { invoke.reject("HID plugin is no longer active") }
                return@enqueueIo
            }

            // Open device connection
            val connection = usbManager.openDevice(usbDevice)
            if (connection == null) {
                Log.e(TAG, "Failed to open connection to device: ${usbDevice.deviceName}")
                finishIo(invoke) { invoke.reject("Failed to open connection to device") }
                return@enqueueIo
            }

            // Create new HidDevice
            val hidDevice = HidDevice(usbDevice, connection, sessionId, invoke.parseArgs(OpenArgs::class.java)) { failedDevice ->
                handleDeviceFailure(path, failedDevice)
            }

            when (val result = hidDevice.initialize()) {
                is HidResult.Success -> {
                    Log.i(TAG, "HidDevice created successfully")
                    val installed = synchronized(this) {
                        if (destroyed) null
                        else connectedDevices.putIfAbsent(path, hidDevice) == null
                    }
                    if (installed == null) {
                        hidDevice.closeConnection()
                        finishIo(invoke) { invoke.reject("HID plugin is no longer active") }
                        return@enqueueIo
                    }
                    if (installed) {
                        when (val reading = hidDevice.startReading()) {
                            is HidResult.Success -> {
                                val result = JSObject()
                                result.put("data", JSArray(hidDevice.reportDescriptor))
                                finishIo(invoke) { invoke.resolve(result) }
                            }
                            is HidResult.Error -> {
                                connectedDevices.remove(path, hidDevice)
                                hidDevice.closeConnection()
                                finishIo(invoke) { invoke.reject("Failed to start HID reader: ${reading.message}", TAG) }
                            }
                        }
                    } else {
                        hidDevice.closeConnection()
                        finishIo(invoke) { invoke.reject("HID device is already connected") }
                    }
                }
                is HidResult.Error -> {
                    hidDevice.closeConnection()
                    finishIo(invoke) { invoke.reject("Failed to create HidDevice: ${result.message}", TAG) }
                }
            }
        }
    }

    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun onDestroy() {
        cleanup()
        super.onDestroy()
    }

    fun cleanup() {
        val (pending, pendingIo) = synchronized(this) {
            if (destroyed) return
            destroyed = true
            val waitingInvoke = pendingInvoke
            pendingInvoke = null
            pendingUsbDevice = null
            pendingDevicePath = null
            pendingSessionId = 0
            pendingPermissionToken = null
            val waitingIo = pendingIoInvokes.toList()
            pendingIoInvokes.clear()
            waitingInvoke to waitingIo
        }
        pending?.reject("USB permission request cancelled")
        pendingIo.forEach { it.reject("HID plugin destroyed") }
        ioExecutor.shutdownNow()

        permissionReceiver?.let {
            try {
                activity.unregisterReceiver(it)
            } catch (e: Exception) {
                Log.w(TAG, "Failed to unregister USB permission receiver", e)
            }
            permissionReceiver = null
        }
        usbDetachReceiver?.let {
            try {
                activity.unregisterReceiver(it)
            } catch (e: Exception) {
                Log.w(TAG, "Failed to unregister USB detach receiver", e)
            }
            usbDetachReceiver = null
        }

        val devices = connectedDevices.values.toList()
        connectedDevices.clear()
        devices.forEach { it.closeConnection() }
    }

    @Command
    fun enumerate(invoke: Invoke) {
        val ret = JSObject()
        val devices = JSArray()

        val deviceList = usbManager.deviceList

        for (dev in deviceList.values) {
            if (!(0 until dev.interfaceCount).any { dev.getInterface(it).interfaceClass == UsbConstants.USB_CLASS_HID }) continue
            val device = JSObject()
            device.put("releaseNumber", 0)
            device.put("path", dev.deviceName)
            device.put("vendorId", dev.vendorId)
            device.put("productId", dev.productId)
            device.put("manufacturerString", dev.manufacturerName)
            device.put("productString", dev.productName)
            devices.put(device)
        }

        ret.put("devices", devices)
        invoke.resolve(ret)
    }

    @Command
    fun open(invoke: Invoke) {
        if (destroyed) {
            invoke.reject("HID plugin is no longer active")
            return
        }
        val args = invoke.parseArgs(OpenArgs::class.java)
        if (args.path == null) {
            invoke.reject("Path is required")
            return
        }
        val path = args.path!!

        val deviceList = usbManager.deviceList

        if (deviceList.containsKey(path)) {
            val device = deviceList[path]
            if (device != null) {
                Log.i(TAG, "Device found: ${device.deviceName}")
                
                // Check if we already have this device open
                val existingDevice = connectedDevices[path]
                if (existingDevice != null) {
                    invoke.reject("Device already open")
                    return
                }
                
                // Check for permission
                if (usbManager.hasPermission(device)) {
                    // We have permission, create and connect
                    createAndConnectDevice(device, path, args.sessionId, invoke)
                } else {
                    // No permission, request it first
                    val token = UUID.randomUUID().toString()
                    val accepted = synchronized(this) {
                        if (destroyed) {
                            false
                        } else {
                            pendingInvoke?.reject("Cancelled by subsequent connection request")
                            pendingDevicePath = path
                            pendingSessionId = args.sessionId
                            pendingUsbDevice = device
                            pendingInvoke = invoke
                            pendingPermissionToken = token
                            true
                        }
                    }
                    if (!accepted) {
                        invoke.reject("HID plugin is no longer active")
                        return
                    }
                    requestPermission(device, token)
                }
                return
            } else {
                invoke.reject("Device not found")
            }
        } else {
            invoke.reject("Path not found in device list")
        }
    }
    
    @Command
    fun close(invoke: Invoke) {
        val args = invoke.parseArgs(CloseArgs::class.java)
        if (args.path == null) {
            invoke.reject("Path is required")
            return
        }
        
        val path = args.path!!
        val expectedSessionId = args.sessionId
        val device = if (expectedSessionId != null) {
            val current = connectedDevices[path]
            if (current == null) {
                null
            } else if (current.connectionSessionId != expectedSessionId) {
                invoke.reject("Device session changed")
                return
            } else if (connectedDevices.remove(path, current)) {
                current
            } else {
                invoke.reject("Device session changed")
                return
            }
        } else {
            connectedDevices.remove(path)
        }
        if (device != null) {
            if (!enqueueIo(invoke) {
                    device.closeConnection()
                    finishIo(invoke) {
                        Log.i(TAG, "Device closed: $path")
                        invoke.resolve()
                    }
                }) {
                device.closeConnection()
            }
        } else {
            invoke.resolve()
        }
    }
    
    @Command
    fun read(invoke: Invoke) {
        val args = invoke.parseArgs(ReadArgs::class.java)
        if (args.path == null) {
            invoke.reject("Path is required")
            return
        }
        
        val path = args.path!!
        val device = connectedDevices[path]
        if (device == null) {
            invoke.reject("Device not open")
            return
        }
        
        enqueueIo(invoke) {
            when (val result = device.read(args.timeout)) {
                is HidResult.Success -> {
                    val ret = JSObject()
                    ret.put("data", JSArray(result.data))
                    finishIo(invoke) { invoke.resolve(ret) }
                }
                is HidResult.Error -> {
                    finishIo(invoke) {
                        invoke.reject("Failed to read from device: ${result.message}")
                    }
                }
            }
        }
    }
    
    @Command
    fun write(invoke: Invoke) {
        val args = invoke.parseArgs(WriteArgs::class.java)
        if (args.path == null || args.data == null) {
            invoke.reject("Path and data are required")
            return
        }
        
        val path = args.path!!
        val device = connectedDevices[path]
        if (device == null) {
            invoke.reject("Device not open")
            return
        }
        
        enqueueIo(invoke) {
            when (val result = device.write(args.reportId, args.data!!)) {
                is HidResult.Success -> {
                    finishIo(invoke) { invoke.resolve() }
                }
                is HidResult.Error -> {
                    finishIo(invoke) {
                        invoke.reject("Failed to write to device: ${result.message}")
                    }
                }
            }
        }
    }
}
