package com.baseacademy.glasses

import android.app.Application

class App : Application() {
  override fun onCreate() {
    super.onCreate()
    Settings.init(this)
  }
}
