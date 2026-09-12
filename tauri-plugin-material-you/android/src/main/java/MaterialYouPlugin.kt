package com.bukutsu.tauri.plugin.materialyou

import android.app.Activity
import android.content.res.Configuration
import android.os.Build
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

private val TONES = intArrayOf(0, 10, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000)

private val FAMILIES = mapOf(
    "accent1" to "system_accent1",
    "accent2" to "system_accent2",
    "accent3" to "system_accent3",
    "neutral1" to "system_neutral1",
    "neutral2" to "system_neutral2",
    "error" to "system_error",
)

// These are the same resolved Material 3 roles used by Android Settings.
// Palette tones remain available as a fallback for older Android releases.
private val MATERIAL_ROLES = arrayOf(
    "primary",
    "on_primary",
    "primary_container",
    "on_primary_container",
    "secondary",
    "tertiary",
    "error",
    "background",
    "on_background",
    "surface",
    "on_surface",
    "surface_container_low",
    "surface_container_lowest",
    "surface_container",
    "surface_container_high",
    "surface_container_highest",
    "surface_bright",
    "surface_dim",
    "surface_variant",
    "on_surface_variant",
    "outline",
    "outline_variant",
)

private fun androidColorId(resources: android.content.res.Resources, name: String): Int {
    return try {
        // The role resources are public in recent SDKs but are marked staged;
        // resolving the generated android.R field works where getIdentifier does not.
        android.R.color::class.java.getField(name).getInt(null)
    } catch (_: Exception) {
        resources.getIdentifier(name, "color", "android")
    }
}

@TauriPlugin
class MaterialYouPlugin(private val activity: Activity) : Plugin(activity) {

    @Command
    fun getDynamicColors(invoke: Invoke) {
        val ret = JSObject()
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            ret.put("available", false)
            invoke.resolve(ret)
            return
        }
        try {
            val res = activity.resources
            val night =
                (res.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
                    Configuration.UI_MODE_NIGHT_YES
            val palettes = JSObject()
            for ((key, prefix) in FAMILIES) {
                val tonesObj = JSObject()
                for (tone in TONES) {
                    val id = res.getIdentifier("${prefix}_${tone}", "color", "android")
                    if (id == 0) continue
                    try {
                        val color = res.getColor(id, activity.theme)
                        tonesObj.put(tone.toString(), String.format("#%06X", 0xFFFFFF and color))
                    } catch (_: Exception) {
                    }
                }
                palettes.put(key, tonesObj)
            }

            val roles = JSObject()
            val roleSuffix = if (night) "dark" else "light"
            for (role in MATERIAL_ROLES) {
                val id = androidColorId(res, "system_${role}_${roleSuffix}")
                if (id == 0) continue
                try {
                    val color = res.getColor(id, activity.theme)
                    roles.put(role, String.format("#%06X", 0xFFFFFF and color))
                } catch (_: Exception) {
                }
            }

            ret.put("available", true)
            ret.put("dark", night)
            ret.put("palettes", palettes)
            ret.put("roles", roles)
            invoke.resolve(ret)
        } catch (e: Exception) {
            invoke.reject("Failed to read dynamic colors: ${e.message}")
        }
    }
}
