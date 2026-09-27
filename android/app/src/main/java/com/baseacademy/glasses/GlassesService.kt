package com.baseacademy.glasses

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.PowerManager
import android.util.Log

/** Keeps the glasses loop alive with the screen off (foreground service + partial wake lock). */
class GlassesService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Always enter the foreground first, even for a stop, so the startForegroundService() contract holds.
    try {
      startForeground(NOTIFICATION_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
    } catch (e: Exception) {
      Log.e(TAG, "could not enter foreground", e)
      stopSelf()
      return START_NOT_STICKY
    }
    if (intent?.action == ACTION_STOP) {
      Pipeline.stop()
      releaseWakeLock()
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
      return START_NOT_STICKY
    }
    if (wakeLock == null) {
      wakeLock =
          (getSystemService(Context.POWER_SERVICE) as PowerManager)
              .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "BASIC::Glasses")
              .apply { acquire(4 * 60 * 60 * 1000L) }
    }
    Pipeline.start(this)
    return START_STICKY
  }

  override fun onDestroy() {
    Pipeline.stop()
    releaseWakeLock()
    super.onDestroy()
  }

  private fun releaseWakeLock() {
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
  }

  private fun notification(): Notification {
    val nm = getSystemService(NotificationManager::class.java)
    nm.createNotificationChannel(NotificationChannel(CHANNEL, "Glasses coaching", NotificationManager.IMPORTANCE_LOW))
    val open =
        PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
    return Notification.Builder(this, CHANNEL)
        .setContentTitle("BASIC is watching")
        .setContentText("Taking a picture from your glasses every ${Settings.intervalMs / 1000.0} s")
        .setSmallIcon(R.drawable.ic_launcher_foreground)
        .setOngoing(true)
        .setContentIntent(open)
        .build()
  }

  companion object {
    private const val TAG = "BA-Service"
    private const val CHANNEL = "glasses"
    private const val NOTIFICATION_ID = 7
    private const val ACTION_STOP = "com.baseacademy.glasses.STOP"

    fun start(context: Context) {
      context.startForegroundService(Intent(context, GlassesService::class.java))
    }

    fun stop(context: Context) {
      context.startForegroundService(Intent(context, GlassesService::class.java).setAction(ACTION_STOP))
    }
  }
}
