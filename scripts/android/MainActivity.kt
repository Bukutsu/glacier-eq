package com.bukutsu.glaciereq

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.View
import android.view.ViewTreeObserver
import androidx.activity.enableEdgeToEdge
import com.bukutsu.tauri.plugin.materialyou.StartupHandoff

class MainActivity : TauriActivity(), StartupHandoff {
    private val startupHandler = Handler(Looper.getMainLooper())
    private var startupReady = false
    private var startupDeadline = 0L
    private var startupContent: View? = null
    private var startupListener: ViewTreeObserver.OnPreDrawListener? = null
    private val failOpen = Runnable { releaseStartupSplash() }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Deadline is a failure ceiling, never a minimum display duration.
        startupDeadline = SystemClock.uptimeMillis() + 8_000L
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        // Android retains the launch window until the first application draw.
        // JS and the Tauri bridge can run while this draw is suspended.
        val content = findViewById<View>(android.R.id.content)
        startupContent = content
        val listener = ViewTreeObserver.OnPreDrawListener {
            if (startupReady || SystemClock.uptimeMillis() >= startupDeadline) {
                releaseStartupSplash()
                true
            } else {
                false
            }
        }
        startupListener = listener
        content.viewTreeObserver.addOnPreDrawListener(listener)
        startupHandler.postDelayed(failOpen, (startupDeadline - SystemClock.uptimeMillis()).coerceAtLeast(0L))
    }

    // Called on the UI thread by the Material You plugin, after appearance/editor readiness.
    override fun releaseStartupSplash() {
        startupReady = true
        startupHandler.removeCallbacks(failOpen)
        val content = startupContent
        val listener = startupListener
        if (content != null && listener != null && content.viewTreeObserver.isAlive) {
            content.viewTreeObserver.removeOnPreDrawListener(listener)
        }
        startupListener = null
        content?.postInvalidateOnAnimation()
    }

    override fun onDestroy() {
        releaseStartupSplash()
        startupContent = null
        super.onDestroy()
    }
}
