package uk.redfern.tauri.plugin.hid

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
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

private const val TAG = "HidPlugin"

sealed class HidResult<out T> {
    data class Success<T>(val data: T) : HidResult<T>()
    data class Error(val message: String, val exception: Exception? = null) : HidResult<Nothing>() {
        init {
            Log.e(TAG, message, exception)
        }
    }
}

class HidDevice(
    private val usbManager: UsbManager,
    private val usbDevice: UsbDevice,
    private val deviceConnection: UsbDeviceConnection
) {
    private var usbInEndpoint: UsbEndpoint? = null
    private var usbOutEndpoint: UsbEndpoint? = null
    private var usbInterface: UsbInterface? = null
    
    private val readQueue = LinkedBlockingQueue<ByteArray>()
    @Volatile
    private var isReading = false
    private var readThread: Thread? = null
    private var activeReadRequest: UsbRequest? = null
    
    // Initialize and connect to the device
    fun initialize(): HidResult<Unit> {
        try {
            var selectedInterface: UsbInterface? = null
            for (i in 0 until usbDevice.interfaceCount) {
                val intf = usbDevice.getInterface(i)
                Log.i(TAG, "Interface Index: $i, ID: ${intf.id}, Class: ${intf.interfaceClass}, Subclass: ${intf.interfaceSubclass}, Protocol: ${intf.interfaceProtocol}, Endpoints: ${intf.endpointCount}")
                if (intf.interfaceClass == 3) { // UsbConstants.USB_CLASS_HID
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
                    if (hasIn && hasOut) {
                        selectedInterface = intf
                    } else if (selectedInterface == null) {
                        selectedInterface = intf
                    }
                }
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
                return HidResult.Error("Failed to claim interface")
            }
            Log.i(TAG, "Interface claimed successfully")
            
            // Start background reading
            startReading()
            
            return HidResult.Success(Unit)
        } catch (e: Exception) {
            return HidResult.Error("Error initializing device: ${e.message}", e)
        }
    }

    private fun startReading() {
        val endpoint = usbInEndpoint ?: return
        isReading = true
        readQueue.clear()
        
        readThread = Thread {
            Log.i(TAG, "Background read thread started using UsbRequest")
            val bufferSize = Math.max(endpoint.maxPacketSize, 64)
            val request = UsbRequest()
            activeReadRequest = request
            
            try {
                if (request.initialize(deviceConnection, endpoint)) {
                    var failureCount = 0
                    val buffer = ByteBuffer.allocateDirect(bufferSize)
                    while (isReading) {
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
                                break
                            }
                            Thread.sleep(100)
                            continue
                        }
                        failureCount = 0
                        
                        val completed = deviceConnection.requestWait()
                        if (!isReading) {
                            break
                        }
                        
                        if (completed == null) {
                            Thread.sleep(10)
                            continue
                        }
                        
                        val bytesRead = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                            buffer.position()
                        } else {
                            buffer.flip()
                            buffer.remaining()
                        }
                        
                        if (bytesRead > 0) {
                            val data = ByteArray(bytesRead)
                            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                                buffer.flip()
                            }
                            buffer.get(data)
                            Log.i(TAG, "Read thread: got data (size=$bytesRead): " + data.joinToString(", ") { String.format("%02X", it) })
                            readQueue.put(data)
                        }
                    }
                } else {
                    Log.e(TAG, "Read thread: failed to initialize UsbRequest")
                }
            } catch (e: InterruptedException) {
                Log.i(TAG, "Read thread interrupted")
            } catch (e: Exception) {
                Log.e(TAG, "Read thread exception: ${e.message}", e)
            } finally {
                try {
                    request.cancel()
                    request.close()
                } catch (_: Exception) {}
                activeReadRequest = null
                Log.i(TAG, "Background read thread stopped")
            }
        }
        readThread?.start()
    }

    // Read data from the device queue (thread-safe, timed block)
    fun read(timeout: Int): HidResult<ByteArray> {
        val endpoint = usbInEndpoint
        if (endpoint == null) {
            return HidResult.Error("Cannot read: IN endpoint not available")
        }
        
        val effectiveTimeout = if (timeout <= 0) 5000L else timeout.toLong()
        try {
            val data = readQueue.poll(effectiveTimeout, TimeUnit.MILLISECONDS)
            return if (data != null) {
                Log.i(TAG, "read: got data from queue (size=${data.size}): " + data.joinToString(", ") { String.format("%02X", it) })
                HidResult.Success(data)
            } else {
                // Timeout
                HidResult.Success(ByteArray(0))
            }
        } catch (e: InterruptedException) {
            return HidResult.Success(ByteArray(0))
        } catch (e: Exception) {
            return HidResult.Error("Read error: ${e.message}", e)
        }
    }
    
    // Write data to the device
    fun write(data: ByteArray): HidResult<Unit> {
        if (!deviceConnection.claimInterface(usbInterface, true)) {
            Log.w(TAG, "write: Failed to claim interface, attempting anyway")
        }
        
        // Strategy 1: Try UsbRequest (asynchronous interrupt transfer)
        try {
            val outEndpoint = usbOutEndpoint
            if (outEndpoint != null) {
                val request = UsbRequest()
                if (request.initialize(deviceConnection, outEndpoint)) {
                    val buffer = ByteBuffer.allocateDirect(data.size)
                    buffer.put(data)
                    buffer.flip()
                    
                    val queued = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                        request.queue(buffer)
                    } else {
                        @Suppress("DEPRECATION")
                        request.queue(buffer, data.size)
                    }
                    
                    if (queued) {
                        val completed = deviceConnection.requestWait()
                        request.close()
                        if (completed != null) {
                            Log.i(TAG, "write (UsbRequest): successfully wrote ${data.size} bytes")
                            return HidResult.Success(Unit)
                        }
                    }
                    request.close()
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "write (UsbRequest) failed: ${e.message}")
        }
        
        // Strategy 2: Try bulkTransfer on OUT endpoint
        try {
            val outEndpoint = usbOutEndpoint
            if (outEndpoint != null) {
                val bytesWritten = deviceConnection.bulkTransfer(outEndpoint, data, data.size, 1000)
                if (bytesWritten >= 0) {
                    Log.i(TAG, "write (bulkTransfer): wrote $bytesWritten bytes")
                    return HidResult.Success(Unit)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "write (bulkTransfer) failed: ${e.message}")
        }
        
        // Strategy 3: Try HID SET_REPORT control transfer
        return writeViaControlTransfer(data)
    }
    
    // Write via HID SET_REPORT control transfer (works when interrupt OUT is not available or fails)
    private fun writeViaControlTransfer(data: ByteArray): HidResult<Unit> {
        val ifaceId = usbInterface?.id ?: 0
        // HID SET_REPORT: bmRequestType=0x21 (host-to-device, class, interface)
        // bRequest=0x09 (SET_REPORT), wValue=0x0200 (report type OUTPUT, report ID 0) or with actual report ID
        // Walkplay / Savitech uses Report ID 0x4B; devices with 0-report-ID use 0
        val reportId = if (data.isNotEmpty() && data[0] == 0x4B.toByte()) 0x4B else 0
        val wValue = 0x0200 or reportId  // Output report type (0x02) | report ID
        
        Log.i(TAG, "write (controlTransfer): SET_REPORT reportId=0x${String.format("%02X", reportId)}, ifaceId=$ifaceId, dataSize=${data.size}")
        
        val result = deviceConnection.controlTransfer(
            0x21,       // bmRequestType: host-to-device, class, interface
            0x09,       // bRequest: SET_REPORT
            wValue,     // wValue: report type (output=0x02) | report ID
            ifaceId,    // wIndex: interface number
            data,       // data
            data.size,  // length
            1000        // timeout
        )
        
        Log.i(TAG, "write (controlTransfer): result=$result")
        return if (result == data.size) {
            HidResult.Success(Unit)
        } else {
            HidResult.Error("Failed to write data via all methods (UsbRequest, bulkTransfer, controlTransfer). Last result=$result")
        }
    }
    
    // Close the connection and release resources
    fun closeConnection() {
        isReading = false
        activeReadRequest?.let {
            try {
                it.cancel()
                it.close()
            } catch (_: Exception) {}
        }
        readThread?.interrupt()
        
        try {
            readThread?.join(500)
        } catch (_: InterruptedException) {}
        
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
    var data: ByteArray? = null
}

@TauriPlugin
class HidPlugin(private val activity: Activity): Plugin(activity) {
    companion object {
        private const val ACTION_USB_PERMISSION = "uk.redfern.tauri.plugin.hid.USB_PERMISSION"
    }
    
    private val usbManager = activity.getSystemService(Context.USB_SERVICE) as UsbManager
    private val connectedDevices = ConcurrentHashMap<String, HidDevice>()
    private var permissionReceiver: BroadcastReceiver? = null
    private var usbDetachReceiver: BroadcastReceiver? = null
    
    // Permission handling state
    private var pendingDevicePath: String? = null
    private var pendingUsbDevice: UsbDevice? = null
    private var pendingInvoke: Invoke? = null

    init {
        registerUsbPermissionReceiver()
        registerUsbDetachReceiver()
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
                    device?.apply {
                        connectedDevices.remove(device.deviceName)?.closeConnection()
                        Log.i(TAG, "Device detached: ${device.deviceName}")
                        val payload = JSObject()
                        payload.put("path", device.deviceName)
                        trigger("device-disconnected", payload)
                        trigger("deviceDisconnected", payload)
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

    private fun registerUsbPermissionReceiver() {
        permissionReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (ACTION_USB_PERMISSION == intent.action) {
                    synchronized(this@HidPlugin) {
                        val device = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                            intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
                        } else {
                            @Suppress("DEPRECATION")
                            intent.getParcelableExtra(UsbManager.EXTRA_DEVICE) as? UsbDevice
                        }
                        val granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)

                        val invoke = pendingInvoke
                        val expectedPath = pendingDevicePath
                        val expectedDevice = pendingUsbDevice

                        // Clear pending state *first* to avoid re-use
                        pendingInvoke = null
                        pendingUsbDevice = null
                        pendingDevicePath = null

                        if (invoke == null) {
                            // Nothing waiting – just log and bail
                            Log.w(TAG, "USB permission broadcast but no pending invoke")
                            return
                        }

                        if (!granted || device == null) {
                            Log.i(TAG, "USB permission DENIED for ${device?.deviceName ?: "unknown device"}")
                            invoke.reject("Permission denied for USB device")
                            return
                        }

                        if (expectedDevice == null || device.deviceName != expectedDevice.deviceName) {
                            Log.w(
                                TAG,
                                "USB permission for unexpected device ${device.deviceName} " +
                                "(expected=${expectedDevice?.deviceName})"
                            )
                            invoke.reject("USB permission for unexpected device")
                            return
                        }

                        createAndConnectDevice(expectedDevice!!, expectedPath!!, invoke!!)
                    }
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
    
    private fun requestPermission(device: UsbDevice) {
        val intent = Intent(ACTION_USB_PERMISSION).apply {
            setPackage(activity.packageName)   // <-- REQUIRED on Android 12+
        }

        val flags =
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            } else {
                PendingIntent.FLAG_UPDATE_CURRENT
            }

        val permissionIntent = PendingIntent.getBroadcast(
            activity,
            0,
            intent,
            flags
        )

        usbManager.requestPermission(device, permissionIntent)
        Log.i(TAG, "Permission requested for device: ${device.deviceName}")
    }
    
    private fun createAndConnectDevice(usbDevice: UsbDevice, path: String, invoke: Invoke) {
        // Open device connection
        val connection = usbManager.openDevice(usbDevice)
        if (connection == null) {
            Log.e(TAG, "Failed to open connection to device: ${usbDevice.deviceName}")
            invoke.reject("Failed to open connection to device")
            return
        }
        
        // Create new HidDevice
        val hidDevice = HidDevice(usbManager, usbDevice, connection)

        when (val result = hidDevice.initialize()) {
            is HidResult.Success -> {
                Log.i(TAG, "HidDevice created successfully")
                connectedDevices[path] = hidDevice
                invoke.resolve()
            }
            is HidResult.Error -> {
                invoke.reject("Failed to create HidDevice: ${result.message}", TAG)
            }
            else -> {
                invoke.reject("Unknown error")
            }
        }
    }

    fun cleanup() {
        if (permissionReceiver != null) {
            activity.unregisterReceiver(permissionReceiver)
            permissionReceiver = null
        }
        if (usbDetachReceiver != null) {
            activity.unregisterReceiver(usbDetachReceiver)
            usbDetachReceiver = null
        }

        // Close all open devices
        for (device in connectedDevices.values) {
            device.closeConnection()
        }
        connectedDevices.clear()
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
                    synchronized(this) {
                        pendingInvoke?.reject("Cancelled by subsequent connection request")
                        pendingDevicePath = path
                        pendingUsbDevice = device
                        pendingInvoke = invoke
                    }
                    requestPermission(device)
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
        val device = connectedDevices[path]
        if (device != null) {
            when (device.closeConnection()) {
                is HidResult.Error -> {
                    invoke.reject("Failed to close device")
                    return
                }
                is HidResult.Success -> {
                    Log.i(TAG, "Device closed: $path")
                }
                else -> {
                    invoke.reject("Unknown error")
                    return
                }
            }
            connectedDevices.remove(path)
            invoke.resolve()
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
        
        when (val result = device.read(args.timeout)) {
            is HidResult.Success -> {
                val ret = JSObject()
                ret.put("data", JSArray(result.data))
                invoke.resolve(ret)
            }
            is HidResult.Error -> {
                invoke.reject("Failed to read from device: ${result.message}")
            }
            else -> {
                invoke.reject("Unknown error")
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
        
        when (val result = device.write(args.data!!)) {
            is HidResult.Success -> {
                invoke.resolve()
            }
            is HidResult.Error -> {
                invoke.reject("Failed to write to device: ${result.message}")
            }
            else -> {
                invoke.reject("Unknown error")
            }
        }
    }
}
