package com.baseacademy.glasses

import android.content.Context
import android.media.AudioAttributes
import android.speech.tts.TextToSpeech
import android.util.Log
import java.util.Locale

/**
 * Speaks coaching lines. Uses media audio, which Android sends to the paired glasses'
 * speakers when they are connected. Supervisor lines cut in; everything else queues.
 */
class Speaker(context: Context, private val onSpoken: (String) -> Unit) {
  private var ready = false
  private val pending = ArrayDeque<Pair<String, Boolean>>()
  private val seen = LinkedHashSet<String>()
  private var n = 0

  private val tts: TextToSpeech =
      TextToSpeech(context.applicationContext) { status ->
        ready = status == TextToSpeech.SUCCESS
        if (ready) {
          tts.language = Locale.US
          tts.setSpeechRate(1.05f)
          tts.setAudioAttributes(
              AudioAttributes.Builder()
                  .setUsage(AudioAttributes.USAGE_MEDIA)
                  .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                  .build(),
          )
          while (pending.isNotEmpty()) pending.removeFirst().let { (t, i) -> speakNow(t, i) }
        } else {
          Log.e(TAG, "Text-to-speech failed to start ($status)")
        }
      }

  /** [id] de-duplicates lines replayed after a reconnect. */
  fun say(id: String?, text: String, interrupt: Boolean) {
    if (text.isBlank()) return
    if (id != null) {
      if (!seen.add(id)) return
      while (seen.size > 400) seen.remove(seen.first())
    }
    onSpoken(text)
    if (!ready) {
      if (interrupt) pending.clear()
      pending.addLast(text to interrupt)
      return
    }
    speakNow(text, interrupt)
  }

  private fun speakNow(text: String, interrupt: Boolean) {
    Log.i(TAG, "say: $text")
    tts.speak(text, if (interrupt) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD, null, "ba-${n++}")
  }

  fun shutdown() {
    tts.stop()
    tts.shutdown()
  }

  companion object {
    const val TAG = "BA-Speaker"
  }
}
