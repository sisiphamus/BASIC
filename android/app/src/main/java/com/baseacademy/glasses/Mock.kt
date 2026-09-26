package com.baseacademy.glasses

import android.content.Context
import android.net.Uri
import android.util.Log
import com.meta.wearable.dat.mockdevice.MockDeviceKit
import com.meta.wearable.dat.mockdevice.api.GlassesModel
import com.meta.wearable.dat.mockdevice.api.MockGlasses
import java.io.File

/**
 * Simulated Ray-Ban Meta glasses (Meta's MockDeviceKit), for testing the whole loop without
 * hardware. The photos it "captures" come from assets/mock/<job>/NN-*.jpg, matched to the step the
 * crew is on, so a real model sees believable pictures.
 */
object Mock {
  private const val TAG = "BA-Mock"
  private var glasses: MockGlasses? = null
  private var images: Map<Int, List<File>> = emptyMap()
  private var shot = 0

  suspend fun setUp(context: Context): Boolean {
    val kit = MockDeviceKit.getInstance(context.applicationContext)
    kit.enable() // also initializes Wearables and marks the app registered
    var ok = false
    kit.pairGlasses(GlassesModel.RAYBAN_META)
        .fold(
            onSuccess = { g ->
              glasses = g
              g.powerOn()
              g.unfold()
              g.don()
              copyAssets(context)
              video(context)?.let { g.services.camera.setCameraFeed(Uri.fromFile(it)) }
              ok = true
              Log.i(TAG, "mock glasses paired and worn")
            },
            onFailure = { error, _ -> Log.e(TAG, "could not pair mock glasses: $error") },
        )
    return ok
  }

  /** Point the mock camera at a photo for this step before each capture. */
  suspend fun prepareShot(stepNo: Int) {
    val g = glasses ?: return
    val pool = images[stepNo].orEmpty().ifEmpty { images[0].orEmpty() }.ifEmpty { images.values.flatten() }
    if (pool.isEmpty()) return
    val file = pool[shot++ % pool.size]
    g.services.camera.setCapturedImage(Uri.fromFile(file))
  }

  fun tearDown(context: Context) {
    runCatching { MockDeviceKit.getInstance(context.applicationContext).disable() }
    glasses = null
  }

  private fun copyAssets(context: Context) {
    val am = context.assets
    val job = Settings.playbookId
    val folder = if ((am.list("mock/$job") ?: emptyArray()).isNotEmpty()) "mock/$job" else "mock/battery-install"
    val out = File(context.filesDir, folder).apply { mkdirs() }
    val map = mutableMapOf<Int, MutableList<File>>()
    for (name in (am.list(folder) ?: emptyArray()).sorted()) {
      if (!name.endsWith(".jpg")) continue
      val f = File(out, name)
      if (!f.exists()) am.open("$folder/$name").use { input -> f.outputStream().use { input.copyTo(it) } }
      val step = Regex("^(\\d+)-").find(name)?.groupValues?.get(1)?.toIntOrNull() ?: 0
      map.getOrPut(step) { mutableListOf() }.add(f)
    }
    images = map
  }

  private fun video(context: Context): File? {
    val f = File(context.filesDir, "mock/feed.mp4")
    if (f.exists()) return f
    return runCatching {
          f.parentFile?.mkdirs()
          context.assets.open("mock/feed.mp4").use { input -> f.outputStream().use { input.copyTo(it) } }
          f
        }
        .getOrNull()
  }
}
