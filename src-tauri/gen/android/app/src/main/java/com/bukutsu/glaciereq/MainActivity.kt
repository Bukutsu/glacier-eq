package com.bukutsu.glaciereq

import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  private var statusBarHeightDp = 0f
  private var navigationBarHeightDp = 0f
  private var appWebView: WebView? = null
  private var currentToast: Toast? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { _, insets ->
      val statusBarHeight = insets.getInsets(WindowInsetsCompat.Type.statusBars()).top
      val navigationBarHeight = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom
      
      val density = resources.displayMetrics.density
      statusBarHeightDp = statusBarHeight / density
      navigationBarHeightDp = navigationBarHeight / density

      appWebView?.let { webView ->
        webView.post {
          webView.evaluateJavascript(
            "document.documentElement.style.setProperty('--safe-area-inset-top-android', '${statusBarHeightDp}px');" +
            "document.documentElement.style.setProperty('--safe-area-inset-bottom-android', '${navigationBarHeightDp}px');",
            null
          )
        }
      }
      
      insets
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    appWebView = webView

    webView.addJavascriptInterface(object {
      @JavascriptInterface
      fun getStatusBarHeight(): Float = statusBarHeightDp

      @JavascriptInterface
      fun getNavigationBarHeight(): Float = navigationBarHeightDp
    }, "AndroidInsets")

    webView.addJavascriptInterface(object {
      @JavascriptInterface
      fun showToast(message: String) {
        runOnUiThread {
          currentToast?.cancel()
          currentToast = Toast.makeText(this@MainActivity, message, Toast.LENGTH_SHORT)
          currentToast?.show()
        }
      }
    }, "AndroidNotifier")
  }

  override fun onDestroy() {
    currentToast?.cancel()
    currentToast = null
    appWebView = null
    super.onDestroy()
  }
}
