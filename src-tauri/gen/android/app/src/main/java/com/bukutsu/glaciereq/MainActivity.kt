package com.bukutsu.glaciereq

import android.os.Bundle
import android.util.TypedValue
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject

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

    webView.addJavascriptInterface(object {
      @JavascriptInterface
      fun getMaterialColorTokens(): String {
        val json = JSONObject()
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
          try {
            // Accent 1 (System accent / Cyan accent in Glacier)
            json.put("accent1_50", colorToHex(resources.getColor(android.R.color.system_accent1_50, null)))
            json.put("accent1_100", colorToHex(resources.getColor(android.R.color.system_accent1_100, null)))
            json.put("accent1_200", colorToHex(resources.getColor(android.R.color.system_accent1_200, null)))
            json.put("accent1_300", colorToHex(resources.getColor(android.R.color.system_accent1_300, null)))
            json.put("accent1_400", colorToHex(resources.getColor(android.R.color.system_accent1_400, null)))
            json.put("accent1_500", colorToHex(resources.getColor(android.R.color.system_accent1_500, null)))
            json.put("accent1_600", colorToHex(resources.getColor(android.R.color.system_accent1_600, null)))
            json.put("accent1_700", colorToHex(resources.getColor(android.R.color.system_accent1_700, null)))
            json.put("accent1_800", colorToHex(resources.getColor(android.R.color.system_accent1_800, null)))
            json.put("accent1_900", colorToHex(resources.getColor(android.R.color.system_accent1_900, null)))

            // Accent 2
            json.put("accent2_200", colorToHex(resources.getColor(android.R.color.system_accent2_200, null)))
            json.put("accent2_600", colorToHex(resources.getColor(android.R.color.system_accent2_600, null)))

            // Accent 3
            json.put("accent3_200", colorToHex(resources.getColor(android.R.color.system_accent3_200, null)))
            json.put("accent3_600", colorToHex(resources.getColor(android.R.color.system_accent3_600, null)))

            // Neutral 1 (Backgrounds / Surfaces / Text)
            json.put("neutral1_10", colorToHex(resources.getColor(android.R.color.system_neutral1_10, null)))
            json.put("neutral1_50", colorToHex(resources.getColor(android.R.color.system_neutral1_50, null)))
            json.put("neutral1_100", colorToHex(resources.getColor(android.R.color.system_neutral1_100, null)))
            json.put("neutral1_200", colorToHex(resources.getColor(android.R.color.system_neutral1_200, null)))
            json.put("neutral1_800", colorToHex(resources.getColor(android.R.color.system_neutral1_800, null)))
            json.put("neutral1_900", colorToHex(resources.getColor(android.R.color.system_neutral1_900, null)))
            json.put("neutral1_1000", colorToHex(resources.getColor(android.R.color.system_neutral1_1000, null)))

            // Neutral 2 (Outlines / Borders / Muted)
            json.put("neutral2_300", colorToHex(resources.getColor(android.R.color.system_neutral2_300, null)))
            json.put("neutral2_500", colorToHex(resources.getColor(android.R.color.system_neutral2_500, null)))
            json.put("neutral2_700", colorToHex(resources.getColor(android.R.color.system_neutral2_700, null)))
            json.put("neutral2_800", colorToHex(resources.getColor(android.R.color.system_neutral2_800, null)))

            // Resolve Material 3 theme attributes dynamically
            val m3Attrs = mapOf(
              "surface" to com.google.android.material.R.attr.colorSurface,
              "surfaceContainerLowest" to com.google.android.material.R.attr.colorSurfaceContainerLowest,
              "surfaceContainerLow" to com.google.android.material.R.attr.colorSurfaceContainerLow,
              "surfaceContainer" to com.google.android.material.R.attr.colorSurfaceContainer,
              "surfaceContainerHigh" to com.google.android.material.R.attr.colorSurfaceContainerHigh,
              "outlineVariant" to com.google.android.material.R.attr.colorOutlineVariant,
              "onSurface" to com.google.android.material.R.attr.colorOnSurface,
              "onSurfaceVariant" to com.google.android.material.R.attr.colorOnSurfaceVariant,
              "primaryContainer" to com.google.android.material.R.attr.colorPrimaryContainer,
              "onPrimaryContainer" to com.google.android.material.R.attr.colorOnPrimaryContainer,
              "secondaryContainer" to com.google.android.material.R.attr.colorSecondaryContainer,
              "onSecondaryContainer" to com.google.android.material.R.attr.colorOnSecondaryContainer
            )

            for ((key, attr) in m3Attrs) {
              val typedValue = TypedValue()
              if (theme.resolveAttribute(attr, typedValue, true)) {
                json.put(key, colorToHex(typedValue.data))
              }
            }
          } catch (e: Exception) {
            e.printStackTrace()
          }
        }
        return json.toString()
      }

      private fun colorToHex(color: Int): String {
        return String.format("#%06X", 0xFFFFFF and color)
      }
    }, "AndroidTheme")
  }

  override fun onDestroy() {
    currentToast?.cancel()
    currentToast = null
    appWebView = null
    super.onDestroy()
  }
}
