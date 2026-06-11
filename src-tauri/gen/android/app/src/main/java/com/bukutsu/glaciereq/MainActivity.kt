package com.bukutsu.glaciereq

import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  private var statusBarHeightDp = 0f
  private var navigationBarHeightDp = 0f

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { _, insets ->
      val statusBarHeight = insets.getInsets(WindowInsetsCompat.Type.statusBars()).top
      val navigationBarHeight = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom
      
      val density = resources.displayMetrics.density
      statusBarHeightDp = statusBarHeight / density
      navigationBarHeightDp = navigationBarHeight / density

      val webView = findWebView(window.decorView)
      webView?.post {
        webView.evaluateJavascript(
          "document.documentElement.style.setProperty('--safe-area-inset-top-android', '${statusBarHeightDp}px');" +
          "document.documentElement.style.setProperty('--safe-area-inset-bottom-android', '${navigationBarHeightDp}px');",
          null
        )
      }
      
      insets
    }

    val webView = findWebView(window.decorView)
    if (webView != null) {
      setupWebView(webView)
    } else {
      window.decorView.post {
        val wv = findWebView(window.decorView)
        wv?.let { setupWebView(it) }
      }
    }
  }

  private fun setupWebView(webView: WebView) {
    webView.addJavascriptInterface(object {
      @JavascriptInterface
      fun getStatusBarHeight(): Float = statusBarHeightDp

      @JavascriptInterface
      fun getNavigationBarHeight(): Float = navigationBarHeightDp
    }, "AndroidInsets")

    webView.addJavascriptInterface(object {
      @JavascriptInterface
      fun showToast(message: String) {
        Toast.makeText(this@MainActivity, message, Toast.LENGTH_SHORT).show()
      }
    }, "AndroidNotifier")
  }

  private fun findWebView(view: View): WebView? {
    if (view is WebView) {
      return view
    }
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) {
        val child = view.getChildAt(i)
        val webView = findWebView(child)
        if (webView != null) {
          return webView
        }
      }
    }
    return null
  }
}
