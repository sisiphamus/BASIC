package com.baseacademy.glasses

import android.content.Context
import android.content.SharedPreferences

/** Everything the crew sets once. Stored on the phone. */
object Settings {
  private lateinit var prefs: SharedPreferences

  fun init(context: Context) {
    prefs = context.getSharedPreferences("base_academy", Context.MODE_PRIVATE)
  }

  var serverUrl: String
    get() = prefs.getString("server", "http://localhost:3000")!!.trim().trimEnd('/')
    set(v) = prefs.edit().putString("server", v.trim().trimEnd('/')).apply()

  var worker: String
    get() = prefs.getString("worker", "")!!
    set(v) = prefs.edit().putString("worker", v.trim()).apply()

  var playbookId: String
    get() = prefs.getString("playbook", "battery-install")!!
    set(v) = prefs.edit().putString("playbook", v).apply()

  var mode: String
    get() = prefs.getString("mode", "crew")!!
    set(v) = prefs.edit().putString("mode", v).apply()

  /** Start watching for the glasses as soon as the app/phone starts the service. */
  var autoStart: Boolean
    get() = prefs.getBoolean("autostart", true)
    set(v) = prefs.edit().putBoolean("autostart", v).apply()

  /** Simulated glasses (Meta MockDeviceKit) for testing without hardware. */
  var mock: Boolean
    get() = prefs.getBoolean("mock", false)
    set(v) = prefs.edit().putBoolean("mock", v).apply()

  var intervalMs: Long
    get() = prefs.getLong("interval", 2000L)
    set(v) = prefs.edit().putLong("interval", v.coerceIn(500L, 30_000L)).apply()

  /** The server job this phone is working on, so a reconnect continues it. */
  var sessionId: String?
    get() = prefs.getString("session", null)
    set(v) = prefs.edit().putString("session", v).apply()
}
