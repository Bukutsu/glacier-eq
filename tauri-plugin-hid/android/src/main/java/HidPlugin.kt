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

sealed class HidResult<out T> {
    data class Success<T>(val data: T) : HidResult<T>()
    data class Error(val message: String, val exception: Exception? = null) : HidResult<Nothing>() {
        init {
            Log.e(TAG, message, exception)
        }
    }
}

class HidDevice(
    private val usbDevice: UsbDevice,
    private val deviceConnection: UsbDeviceConnection,
    private val onDisconnected: () -> Unit
) {
    private var usbInEndpoint: UsbEndpoint? = null
    private var usbOutEndpoint: UsbEndpoint? = null
    private var usbInterface: UsbInterface? = null
    
    private val readQueue = LinkedBlockingQueue<ByteArray>(MAX_QUEUED_READS)
    private val operationLock = Any()
    private val connectionLock = Any()
    @Volatile
    private var isReading = false
    @Volatile
    private var closed = false
    private var readThread: Thread? = null
    @Volatile
    private var activeReadRequest: UsbRequest? = null
    
    // Initialize and connect to the device
    fun initialize(): HidResult<Unit> {
        try {
            var selectedInterface: UsbInterface? = null
            var firstHidInterface: UsbInterface? = null
            for (i in 0 until usbDevice.interfaceCount) {
                val intf = usbDevice.getInterface(i)
                Log.i(TAG, "Interface Index: $i, ID: ${intf.id}, Class: ${intf.interfaceClass}, Subclass: ${intf.interfaceSubclass}, Protocol: ${intf.interfaceProtocol}, Endpoints: ${intf.endpointCount}")
                if (intf.interfaceClass == UsbConstants.USB_CLASS_HID) {
                    var hasIn = false
                    var hasOut = false
                    for (j in 0 until intf.endpointCount) {
                        val ep = intf.getEndpoint(j)
                        if (ep.type == UsbConstants.USB_ENDPOINT_XFER_INT) {
                            if (ep.direction == UsbConstants.USB_DIR_IN) {
                                hasIn = true
                            } else if (ep.direction == UsbConstants.USB_DIR_OUT) {
                                hasOut = true
                            }
                        }
                    }
                    Log.i(TAG, "Interface $i is HID: hasIn=$hasIn, hasOut=$hasOut")
                    if (firstHidInterface == null) {
                        firstHidInterface = intf
                    }
                    if (hasIn && hasOut && selectedInterface == null) {
                        selectedInterface = intf
                    }
                }
            }
            if (selectedInterface == null) {
                selectedInterface = firstHidInterface
            }
            if (selectedInterface == null) {
                for (i in 0 until usbDevice.interfaceCount) {
                    val intf = usbDevice.getInterface(i)
                    var hasIn = false
                    var hasOut = false
                    for (j in 0 until intf.endpointCount) {
                        val ep = intf.getEndpoint(j)
                        if (ep.type == UsbConstants.USB_ENDPOINT_XFER_INT) {
                            if (ep.direction == UsbConstants.USB_DIR_IN) {
                                hasIn = true
                            } else if (ep.direction == UsbConstants.USB_DIR_OUT) {
                                hasOut = true
                            }
                        }
                    }
                    if (hasIn && hasOut) {
                        selectedInterface = intf
                        break
                    }
                }
            }
            if (usbDevice.interfaceCount == 0) {
                return HidResult.Error("Device has no interfaces")
            }
            val usbInterface = selectedInterface ?: usbDevice.getInterface(0)
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

    fun startReading() {
        val endpoint = usbInEndpoint ?: return
        if (closed) return
        isReading = true
        readQueue.clear()

        val thread = Thread {
            Log.i(TAG, "Background read thread started using UsbRequest")
            val bufferSize = maxOf(endpoint.maxPacketSize, 64)
            val request = UsbRequest()
            activeReadRequest = request

            var readFailed = false
            try {
                if (request.initialize(deviceConnection, endpoint)) {
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
                } else {
                    Log.e(TAG, "Read thread: failed to initialize UsbRequest")
                    readFailed = true
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
                activeReadRequest = null
                if (readFailed && !closed) {
                    onDisconnected()
                }
                Log.i(TAG, "Background read thread stopped")
            }
        }
        readThread = thread
        thread.start()
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
                            if (interruptData.size > outEndpoint.maxPacketSize) {
                                HidResult.Error(
                                    "Interrupt OUT report is ${interruptData.size} bytes, " +
                                        "but the endpoint accepts ${outEndpoint.maxPacketSize}"
                                )
                            } else try {
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
                activeReadRequest?.cancel()
            } catch (_: Exception) {}
            thread = readThread
        }

        if (thread != null && thread !== Thread.currentThread()) {
            thread.interrupt()
            try {
                thread.join(1000)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            }
        }

        synchronized(connectionLock) {
            readThread = null
            readQueue.clear()
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
}

@InvokeArg
class OpenArgs {
    var path: String? = null
}

@InvokeArg
class CloseArgs {
    var path: String? = null
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
                        val detached = connectedDevices.remove(it.deviceName)
                        val pending = synchronized(this@HidPlugin) {
                            if (pendingUsbDevice?.deviceName == it.deviceName) {
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
                        pending?.reject("USB device detached before permission was granted")

                        Log.i(TAG, "Device detached: ${it.deviceName}")
                        if (detached != null) {
                            detached.closeConnection()
                            triggerObject("device-disconnected", it.deviceName)
                            triggerObject("deviceDisconnected", it.deviceName)
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
                            val value = Triple(pendingInvoke, pendingDevicePath, pendingUsbDevice)
                            pendingInvoke = null
                            pendingUsbDevice = null
                            pendingDevicePath = null
                            pendingPermissionToken = null
                            value
                        }
                    }
                    if (pending == null) {
                        Log.w(TAG, "Ignoring USB permission broadcast with an invalid token")
                        return
                    }
                    val invoke = pending.first
                    val expectedPath = pending.second
                    val expectedDevice = pending.third

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

                    createAndConnectDevice(expectedDevice, expectedPath, invoke)
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
    
    private fun handleDeviceFailure(path: String) {
        val device = connectedDevices.remove(path) ?: return
        Log.w(TAG, "HID reader stopped unexpectedly: $path")
        device.closeConnection()
        triggerObject("device-disconnected", path)
        triggerObject("deviceDisconnected", path)
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
    
    private fun createAndConnectDevice(usbDevice: UsbDevice, path: String, invoke: Invoke) {
        if (destroyed) {
            invoke.reject("HID plugin is no longer active")
            return
        }

        // Open device connection
        val connection = usbManager.openDevice(usbDevice)
        if (connection == null) {
            Log.e(TAG, "Failed to open connection to device: ${usbDevice.deviceName}")
            invoke.reject("Failed to open connection to device")
            return
        }
        
        // Create new HidDevice
        val hidDevice = HidDevice(usbDevice, connection) { handleDeviceFailure(path) }

        when (val result = hidDevice.initialize()) {
            is HidResult.Success -> {
                Log.i(TAG, "HidDevice created successfully")
                val installed = synchronized(this) {
                    if (destroyed) null
                    else connectedDevices.putIfAbsent(path, hidDevice) == null
                }
                if (installed == null) {
                    hidDevice.closeConnection()
                    invoke.reject("HID plugin is no longer active")
                    return
                }
                if (installed) {
                    hidDevice.startReading()
                } else {
                    hidDevice.closeConnection()
                }
                invoke.resolve()
            }
            is HidResult.Error -> {
                hidDevice.closeConnection()
                invoke.reject("Failed to create HidDevice: ${result.message}", TAG)
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
                    invoke.resolve()
                    return
                }
                
                // Check for permission
                if (usbManager.hasPermission(device)) {
                    // We have permission, create and connect
                    createAndConnectDevice(device, path, invoke)
                } else {
                    // No permission, request it first
                    val token = UUID.randomUUID().toString()
                    val accepted = synchronized(this) {
                        if (destroyed) {
                            false
                        } else {
                            pendingInvoke?.reject("Cancelled by subsequent connection request")
                            pendingDevicePath = path
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
        val device = connectedDevices.remove(path)
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
            invoke.reject("Device not open")
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
