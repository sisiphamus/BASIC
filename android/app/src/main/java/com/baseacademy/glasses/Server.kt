package com.baseacademy.glasses

import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject

class ServerError(val code: Int, message: String) : IOException(message)

/** Talks to the Base Academy server: the same API the web glasses page uses. */
object Server {
  private val http =
      OkHttpClient.Builder()
          .connectTimeout(8, TimeUnit.SECONDS)
          .writeTimeout(30, TimeUnit.SECONDS) // full-resolution photos
          .readTimeout(20, TimeUnit.SECONDS)
          .pingInterval(15, TimeUnit.SECONDS) // notices a dead socket on flaky networks
          .build()

  private val JSON = "application/json".toMediaType()
  private val JPEG = "image/jpeg".toMediaType()

  private fun base() = Settings.serverUrl

  private suspend fun call(req: Request): JSONObject =
      withContext(Dispatchers.IO) {
        http.newCall(req).execute().use { res ->
          val text = res.body?.string().orEmpty()
          val body = runCatching { JSONObject(text) }.getOrElse { JSONObject() }
          if (!res.isSuccessful) throw ServerError(res.code, body.optString("error", "HTTP ${res.code}"))
          body
        }
      }

  suspend fun health(): JSONObject = call(Request.Builder().url("${base()}/api/health").build())

  suspend fun playbooks(): List<Pair<String, String>> {
    val arr: JSONArray = call(Request.Builder().url("${base()}/api/playbooks").build()).getJSONArray("playbooks")
    return (0 until arr.length()).map { arr.getJSONObject(it).let { p -> p.getString("id") to p.getString("title") } }
  }

  suspend fun createSession(playbookId: String, worker: String, mode: String): JSONObject {
    val body = JSONObject().put("playbookId", playbookId).put("worker", worker).put("mode", mode)
    return call(Request.Builder().url("${base()}/api/sessions").post(body.toString().toRequestBody(JSON)).build())
  }

  suspend fun session(id: String): JSONObject = call(Request.Builder().url("${base()}/api/sessions/$id").build())

  suspend fun postFrame(id: String, jpeg: ByteArray): JSONObject =
      call(Request.Builder().url("${base()}/api/sessions/$id/frames").post(jpeg.toRequestBody(JPEG)).build())

  suspend fun command(id: String, command: String): JSONObject {
    val body = JSONObject().put("command", command)
    return call(Request.Builder().url("${base()}/api/sessions/$id/commands").post(body.toString().toRequestBody(JSON)).build())
  }

  fun socket(id: String, listener: WebSocketListener): WebSocket {
    val ws = base().replaceFirst(Regex("^http"), "ws")
    return http.newWebSocket(Request.Builder().url("$ws/ws?role=glasses&session=$id").build(), listener)
  }
}
