package com.baseacademy.glasses

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import java.util.Locale

/**
 * Speaks coaching lines through the glasses.
 *
 * Important hardware fact (Meta DAT issue #78, discussion #82): while the glasses camera is
 * streaming, their normal media audio (A2DP) is suspended, so text-to-speech is silent. Two ways
 * around it, chosen in settings:
 *  - PAUSE_CAMERA (default): lines wait in a queue; [onNeedAudio] asks the pipeline to stop the
 *    camera, then [release] speaks everything and [onAudioDone] lets the camera start again.
 *  - CALL_AUDIO: speak right away over the Bluetooth call channel (SCO), camera keeps running.
 */
class Speaker(
    context: Context,
    private val onSpoken: (String) -> Unit,
    private val onNeedAudio: () -> Unit,
    private val onAudioDone: () -> Unit,
) {
  private val audio = context.getSystemService(AudioManager::class.java)
  private var ready = false
  private val queue = ArrayDeque<String>()
  private val seen = LinkedHashSet<String>()
  private var n = 0
  private var outstanding = 0
  private var released = false // audio window open: we may speak now
  private var scoOn = false

  private val tts: TextToSpeech =
      TextToSpeech(context.applicationContext) { status ->
        ready = status == TextToSpeech.SUCCESS
        if (!ready) {
          Log.e(TAG, "Text-to-speech failed to start ($status)")
          return@TextToSpeech
        }
        tts.language = Locale.US
        tts.setSpeechRate(0.9f) // a little slower: easier to follow through the glasses
        tts.setOnUtteranceProgressListener(
            object : UtteranceProgressListener() {
              override fun onStart(id: String?) = Unit

              override fun onDone(id: String?) = finished()

              @Deprecated("Deprecated in Java")
              override fun onError(id: String?) = finished()

              override fun onError(id: String?, errorCode: Int) = finished()
            },
        )
        pump()
      }

  /** Main-thread entry point for every line from the server. */
  fun say(id: String?, text: String, interrupt: Boolean) {
    if (text.isBlank()) return
    if (id != null) {
      if (!seen.add(id)) return
      while (seen.size > 400) seen.remove(seen.first())
    }
    onSpoken(text)
    if (interrupt) {
      // supervisor: jump the queue, cut off the current line
      queue.addFirst(text)
      if (outstanding > 0) {
        outstanding = 0
        tts.stop()
      }
    } else {
      queue.addLast(text)
    }
    pump()
  }

  /** The pipeline stopped the camera: audio can play now. */
  fun release() {
    released = true
    if (queue.isEmpty() && outstanding == 0) {
      // nothing left to say (e.g. a supervisor cut-in already covered it): hand the camera back
      released = false
      onAudioDone()
      return
    }
    pump()
  }

  val busy: Boolean
    get() = outstanding > 0 || queue.isNotEmpty()

  private fun pump() {
    if (!ready || queue.isEmpty()) return
    if (Settings.voiceRoute == Settings.ROUTE_CALL) {
      routeToCall(true)
      speakQueued(AudioAttributes.USAGE_VOICE_COMMUNICATION)
      return
    }
    if (!released) {
      onNeedAudio() // pipeline will stop the camera and call release()
      return
    }
    speakQueued(AudioAttributes.USAGE_MEDIA)
  }

  private fun speakQueued(usage: Int) {
    tts.setAudioAttributes(AudioAttributes.Builder().setUsage(usage).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
    while (queue.isNotEmpty()) {
      val text = queue.removeFirst()
      outstanding += 1
      Log.i(TAG, "say: $text")
      val params = Bundle()
      if (usage == AudioAttributes.USAGE_VOICE_COMMUNICATION) params.putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_VOICE_CALL)
      tts.speak(text, TextToSpeech.QUEUE_ADD, params, "ba-${n++}")
    }
  }

  // UtteranceProgressListener runs on a binder thread; hop back to main.
  private fun finished() {
    android.os.Handler(android.os.Looper.getMainLooper()).post {
      outstanding = (outstanding - 1).coerceAtLeast(0)
      if (outstanding == 0) {
        if (queue.isNotEmpty()) return@post pump()
        if (released) {
          released = false
          onAudioDone()
        }
      }
    }
  }

  /** Call audio (SCO): set once and keep, per Meta DAT threads (avoid startBluetoothSco). */
  private fun routeToCall(on: Boolean) {
    if (on == scoOn) return
    try {
      if (on) {
        val sco = audio.availableCommunicationDevices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }
        if (sco != null) {
          audio.mode = AudioManager.MODE_IN_COMMUNICATION
          audio.setCommunicationDevice(sco)
          scoOn = true
        } else {
          Log.w(TAG, "no Bluetooth call device; speaking on the default output")
        }
      } else {
        audio.clearCommunicationDevice()
        audio.mode = AudioManager.MODE_NORMAL
        scoOn = false
      }
    } catch (e: Exception) {
      Log.w(TAG, "could not switch audio route", e)
    }
  }

  fun shutdown() {
    routeToCall(false)
    tts.stop()
    tts.shutdown()
  }

  companion object {
    const val TAG = "BA-Speaker"
  }
}
