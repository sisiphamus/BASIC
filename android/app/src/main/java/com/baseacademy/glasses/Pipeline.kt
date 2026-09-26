package com.baseacademy.glasses

import android.content.Context
import android.os.SystemClock
import android.util.Log
import com.meta.wearable.dat.camera.Camera
import com.meta.wearable.dat.camera.Stream
import com.meta.wearable.dat.camera.addCamera
import com.meta.wearable.dat.camera.removeCamera
import com.meta.wearable.dat.camera.types.StreamConfiguration
import com.meta.wearable.dat.camera.types.StreamState
import com.meta.wearable.dat.camera.types.VideoQuality
import com.meta.wearable.dat.core.Wearables
import com.meta.wearable.dat.core.selectors.AutoDeviceSelector
import com.meta.wearable.dat.core.session.DeviceSession
import com.meta.wearable.dat.core.session.DeviceSessionState
import com.meta.wearable.dat.core.types.Permission
import com.meta.wearable.dat.core.types.PermissionStatus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject

data class Status(
    val running: Boolean = false,
    val registration: String = "unknown",
    val glasses: Boolean = false,
    val session: String = "none",
    val stream: String = "none",
    val talking: Boolean = false,
    val paused: Boolean = false,
    val needsCameraPermission: Boolean = false,
    val serverSession: String? = null,
    val job: String = "",
    val step: String = "",
    val stepId: String = "",
    val stepNo: Int = 0,
    val stepCount: Int = 0,
    val jobStatus: String = "",
    val photos: Int = 0,
    val lastPhotoKb: Int = 0,
    val lastPhotoSize: String = "",
    val lastCaptureMs: Long = 0,
    val lastRoundTripMs: Long = 0,
    val lastSaid: String = "",
    val lastSaidFrom: String = "",
    val socket: String = "off",
    val error: String = "",
)

/**
 * The whole loop, owned by [GlassesService] so it keeps running with the screen off:
 * glasses appear -> device session -> camera stream -> every N seconds capturePhoto() ->
 * JPEG -> POST to the server -> spoken replies arrive over the socket -> text-to-speech in the glasses.
 *
 * Talking pauses the camera (see [Speaker]): the glasses mute media audio while streaming.
 */
object Pipeline {
  private const val TAG = "BA-Pipeline"
  private const val WARM_UP_MS = 1000L // first frames after a (re)start are unreliable
  private const val CAPTURE_TIMEOUT_MS = 6000L
  private const val STALL_MS = 15_000L

  private val _status = MutableStateFlow(Status())
  val status: StateFlow<Status> = _status.asStateFlow()

  private var scope: CoroutineScope? = null
  private lateinit var appContext: Context
  private lateinit var speaker: Speaker
  // Created only after Wearables is initialized; constructing it earlier throws.
  private var selector: AutoDeviceSelector? = null

  private var session: DeviceSession? = null
  private var camera: Camera? = null
  private var stream: Stream? = null
  private var streamingSince = 0L
  private var cameraWantedSince = 0L
  private var loopJob: Job? = null
  private val streamJobs = mutableListOf<Job>()
  private val sessionJobs = mutableListOf<Job>()
  private var socket: WebSocket? = null
  private var socketWanted = false
  private var socketTries = 0
  private var glassesPresent = false
  private var talking = false // audio window: camera stopped so the glasses can speak
  private var paused = false // crew pressed Pause: camera off, nothing sent
  private var socketId: String? = null

  fun start(context: Context) {
    if (scope != null) return
    appContext = context.applicationContext
    val s = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    scope = s
    speaker =
        Speaker(
            appContext,
            onSpoken = { text -> Log.i(TAG, "speaking: $text") },
            onNeedAudio = { openAudioWindow() },
            onAudioDone = { closeAudioWindow() },
        )
    _status.update { Status(running = true) }
    s.launch {
      if (Settings.mock) {
        if (!Mock.setUp(appContext)) fail("Mock glasses could not be set up")
      } else {
        Wearables.initialize(appContext).onFailure { error, _ -> Log.w(TAG, "initialize: ${error.description}") }
      }
      selector = AutoDeviceSelector()
      watch()
      watchdog()
    }
  }

  fun stop() {
    val s = scope ?: return
    stopLoop()
    closeSocket()
    session?.stop()
    session = null
    camera = null
    stream = null
    talking = false
    scope = null
    s.cancel()
    if (Settings.mock) Mock.tearDown(appContext)
    speaker.shutdown()
    _status.update { Status(running = false) }
  }

  /** Forget the current server job so the next photo starts a fresh one. */
  fun newJob() {
    Settings.sessionId = null
    closeSocket()
    stopLoop()
    _status.update { it.copy(serverSession = null, step = "", stepNo = 0, stepCount = 0, jobStatus = "", photos = 0) }
    if (stream != null && _status.value.stream == StreamState.STREAMING.name) startLoop()
  }

  fun sendCommand(cmd: String) {
    val id = Settings.sessionId ?: return
    scope?.launch { runCatching { Server.command(id, cmd) }.onFailure { fail("Command failed: ${it.message}") } }
  }

  /** Pause: turn the glasses camera off and stop sending photos until [resume]. */
  fun pause() {
    if (paused) return
    paused = true
    _status.update { it.copy(paused = true) }
    stopLoop()
    val cam = camera
    if (cam != null) {
      session?.let { onCameraGone(it) }
      runCatching { cam.stop() }
    }
  }

  fun resume() {
    if (!paused) return
    paused = false
    _status.update { it.copy(paused = false, error = "") }
    val s = session ?: return
    if (s.state.value == DeviceSessionState.STARTED) scope?.launch { addCamera(s) }
  }

  /** Called by the activity after the Meta AI camera permission flow. */
  fun cameraPermissionGranted() {
    _status.update { it.copy(needsCameraPermission = false) }
    session?.let { s -> if (s.state.value == DeviceSessionState.STARTED) scope?.launch { addCamera(s) } }
  }

  // ---- glasses -------------------------------------------------------------

  private fun watch() {
    val s = scope ?: return
    s.launch { Wearables.registrationState.collect { r -> _status.update { it.copy(registration = r.name) } } }
    s.launch {
      selector!!.activeDeviceFlow().collect { device ->
        glassesPresent = device != null
        _status.update { it.copy(glasses = glassesPresent) }
        if (device != null) connect() else Log.i(TAG, "glasses not available")
      }
    }
  }

  private fun connect() {
    if (session != null) return
    val sel = selector ?: return
    Wearables.createSession(sel)
        .onSuccess { created ->
          session = created
          val s = scope ?: return@onSuccess
          sessionJobs += s.launch {
            created.state.collect { state ->
              _status.update { it.copy(session = state.name) }
              when (state) {
                DeviceSessionState.STARTED -> if (!talking && !paused) addCamera(created)
                DeviceSessionState.STOPPED -> onSessionStopped()
                else -> Unit
              }
            }
          }
          sessionJobs += s.launch { created.errors.collect { e -> fail("Glasses: ${e.description}") } }
          created.start()
        }
        .onFailure { error, _ ->
          fail("Could not connect to the glasses: ${error.description}")
          retryConnect()
        }
  }

  private fun onSessionStopped() {
    stopLoop()
    streamJobs.forEach { it.cancel() }
    streamJobs.clear()
    sessionJobs.forEach { it.cancel() }
    sessionJobs.clear()
    camera = null
    stream = null
    session = null
    _status.update { it.copy(stream = "none") }
    if (talking) speaker.release() // don't leave queued lines waiting on a camera that's gone
    retryConnect()
  }

  private fun retryConnect() {
    scope?.launch {
      delay(3000)
      if (glassesPresent && session == null) connect()
    }
  }

  private suspend fun addCamera(s: DeviceSession) {
    if (camera != null || talking || paused) return
    var granted = false
    Wearables.checkPermissionStatus(Permission.CAMERA)
        .onSuccess { status -> granted = status == PermissionStatus.Granted }
        .onFailure { error, _ -> fail("Camera permission check failed: ${error.description}") }
    if (!granted) {
      _status.update { it.copy(needsCameraPermission = true) }
      fail("Open Base Academy and tap Allow glasses camera")
      return
    }
    if (camera != null || talking || paused) return // re-check after the suspend
    cameraWantedSince = SystemClock.elapsedRealtime()
    // The stream keeps the camera awake; the pictures come from capturePhoto().
    s.addCamera(StreamConfiguration(videoQuality = VideoQuality.LOW, frameRate = 2))
        .onSuccess { cam ->
          camera = cam
          val st = cam.stream
          stream = st
          val sc = scope ?: return@onSuccess
          streamJobs += sc.launch { st.videoStream.collect { /* frames not needed; keep the flow drained */ } }
          streamJobs += sc.launch { st.errorStream.collect { e -> Log.w(TAG, "stream: ${e.description}") } }
          streamJobs += sc.launch {
            // state replays STOPPED on subscribe (before start()), so only a stop AFTER the stream
            // was active means it ended.
            var wasActive = false
            st.state.collect { state ->
              _status.update { it.copy(stream = state.name) }
              val terminal = state == StreamState.STOPPED || state == StreamState.CLOSED
              if (!terminal) wasActive = true
              when {
                state == StreamState.STREAMING -> {
                  streamingSince = SystemClock.elapsedRealtime()
                  startLoop()
                }
                terminal && wasActive -> {
                  wasActive = false
                  if (camera === cam) onCameraGone(s)
                }
              }
            }
          }
          st.start().onFailure { error, _ -> fail("Glasses camera did not start: ${error.description}") }
        }
        .onFailure { error, _ -> fail("Could not open the glasses camera: ${error.description}") }
  }

  /** The camera stream ended: either we stopped it to talk, or it dropped. */
  private fun onCameraGone(s: DeviceSession) {
    stopLoop()
    streamJobs.forEach { it.cancel() }
    streamJobs.clear()
    camera = null
    stream = null
    _status.update { it.copy(stream = if (paused) "paused" else "restarting") }
    runCatching { s.removeCamera() } // required before the next addCamera()
    if (talking) {
      speaker.release()
    } else {
      scope?.launch {
        delay(1500)
        if (session === s && s.state.value == DeviceSessionState.STARTED && !talking && !paused) addCamera(s)
      }
    }
  }

  // ---- talking: pause the camera so the glasses can play audio -------------

  private fun openAudioWindow() {
    if (talking) return
    talking = true
    _status.update { it.copy(talking = true) }
    stopLoop()
    val cam = camera
    if (cam == null) {
      speaker.release()
      return
    }
    cam.stop() // stream goes STOPPED/CLOSED -> onCameraGone -> speaker.release()
    scope?.launch {
      delay(2000) // never let a stuck stop hold the voice back
      if (talking && camera === cam) {
        val s = session
        camera = null
        stream = null
        streamJobs.forEach { it.cancel() }
        streamJobs.clear()
        if (s != null) runCatching { s.removeCamera() }
        speaker.release()
      }
    }
  }

  private fun closeAudioWindow() {
    talking = false
    _status.update { it.copy(talking = false) }
    val s = session ?: return
    scope?.launch {
      delay(300)
      if (!talking && !paused && session === s && s.state.value == DeviceSessionState.STARTED) addCamera(s)
    }
  }

  /** If the camera should be streaming but hasn't for a while, start it over. */
  private fun watchdog() {
    scope?.launch {
      while (isActive) {
        delay(5000)
        val s = session ?: continue
        if (talking || paused || s.state.value != DeviceSessionState.STARTED) continue
        val streaming = _status.value.stream == StreamState.STREAMING.name || _status.value.stream == StreamState.PAUSED.name
        val since = SystemClock.elapsedRealtime() - cameraWantedSince
        if (!streaming && since > STALL_MS) {
          Log.w(TAG, "camera stalled in ${_status.value.stream}; restarting it")
          cameraWantedSince = SystemClock.elapsedRealtime()
          val cam = camera
          if (cam != null) {
            onCameraGone(s)
            runCatching { cam.stop() }
          } else {
            addCamera(s)
          }
        }
      }
    }
  }

  // ---- the photo loop ------------------------------------------------------

  private fun startLoop() {
    if (loopJob?.isActive == true) return
    val s = scope ?: return
    loopJob = s.launch {
      val id = ensureServerJob() ?: return@launch
      openSocket(id)
      var failures = 0
      while (isActive) {
        val started = SystemClock.elapsedRealtime()
        val st = stream ?: break
        val warm = WARM_UP_MS - (started - streamingSince)
        if (warm > 0) {
          delay(warm)
          continue
        }
        if (talking || speaker.busy) {
          delay(200)
          continue
        }
        if (Settings.mock) Mock.prepareShot(_status.value.stepNo.coerceAtLeast(1))
        var jpeg: ByteArray? = null
        var size = ""
        val captured =
            withTimeoutOrNull(CAPTURE_TIMEOUT_MS) {
              st.capturePhoto()
                  .onSuccess { photo ->
                    val out = withContext(Dispatchers.Default) { Photos.toJpeg(photo) }
                    jpeg = out?.first
                    size = out?.second.orEmpty()
                  }
                  .onFailure { error, _ -> Log.w(TAG, "capture failed: ${error.description}") }
            }
        if (captured == null) Log.w(TAG, "capture timed out")
        val captureMs = SystemClock.elapsedRealtime() - started
        val bytes = jpeg
        if (bytes == null) {
          failures += 1
          if (failures >= 3) fail("Glasses photos are failing. If you tapped the glasses, tap again to resume.")
        } else {
          failures = 0
          _status.update { it.copy(lastCaptureMs = captureMs, lastPhotoSize = size) }
          upload(id, bytes, started)
          if (_status.value.jobStatus == "complete" || _status.value.jobStatus == "ended") break
        }
        val wait = Settings.intervalMs - (SystemClock.elapsedRealtime() - started)
        delay(wait.coerceAtLeast(150))
      }
    }
  }

  private fun stopLoop() {
    loopJob?.cancel()
    loopJob = null
  }

  private suspend fun upload(id: String, jpeg: ByteArray, started: Long) {
    try {
      val res = Server.postFrame(id, jpeg)
      _status.update {
        it.copy(photos = it.photos + 1, lastPhotoKb = jpeg.size / 1024, lastRoundTripMs = SystemClock.elapsedRealtime() - started, error = "")
      }
      if (!res.optBoolean("analyzing") && res.optString("reason").startsWith("session is")) {
        _status.update { it.copy(jobStatus = res.optString("reason").removePrefix("session is ")) }
      }
    } catch (e: ServerError) {
      if (e.code == 404) {
        // the job was cleared on the server; start a fresh one
        Settings.sessionId = null
        fail("Job not found on the server, starting a new one")
        scope?.launch {
          closeSocket()
          stopLoop()
          startLoop()
        }
      } else {
        fail("Upload refused: ${e.message}")
      }
    } catch (e: Exception) {
      fail("Can't reach the server at ${Settings.serverUrl}: ${e.message}")
    }
  }

  /** Reuse this phone's job if it is still open, otherwise start one. */
  private suspend fun ensureServerJob(): String? {
    Settings.sessionId?.let { id ->
      val existing = runCatching { Server.session(id) }.getOrNull()
      if (existing != null && existing.optString("status") == "active") {
        applySession(existing)
        return id
      }
    }
    val worker = Settings.worker.ifBlank { "Crew member" }
    while (scope?.isActive == true) {
      try {
        val created = Server.createSession(Settings.playbookId, worker, Settings.mode)
        val id = created.getString("id")
        Settings.sessionId = id
        applySession(created)
        return id
      } catch (e: Exception) {
        fail("Can't start the job on ${Settings.serverUrl}: ${e.message}")
        delay(3000)
      }
    }
    return null
  }

  private fun applySession(s: JSONObject) {
    val steps = s.optJSONArray("steps")
    val cur = s.optInt("current", 0)
    val title = steps?.optJSONObject(cur)?.optString("title").orEmpty()
    val stepId = steps?.optJSONObject(cur)?.optString("id").orEmpty()
    _status.update {
      it.copy(
          serverSession = s.optString("id"),
          job = s.optString("playbookTitle"),
          step = title,
          stepId = stepId,
          stepNo = cur + 1,
          stepCount = steps?.length() ?: 0,
          jobStatus = s.optString("status"),
      )
    }
  }

  // ---- voice back ----------------------------------------------------------

  private fun openSocket(id: String) {
    socketWanted = true
    if (socket != null && socketId == id) return
    if (socket != null) {
      socket?.close(1000, "new job")
      socket = null
    }
    socketId = id
    _status.update { it.copy(socket = "connecting") }
    socket =
        Server.socket(
            id,
            object : WebSocketListener() {
              override fun onOpen(webSocket: WebSocket, response: Response) {
                socketTries = 0
                _status.update { it.copy(socket = "live") }
              }

              override fun onMessage(webSocket: WebSocket, text: String) {
                val msg = runCatching { JSONObject(text) }.getOrNull() ?: return
                scope?.launch { handle(id, msg) }
              }

              override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = dropped(webSocket, id)

              override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = dropped(webSocket, id)
            },
        )
  }

  private fun dropped(ws: WebSocket, id: String) {
    scope?.launch {
      if (socket !== ws) return@launch
      socket = null
      _status.update { it.copy(socket = "reconnecting") }
      if (!socketWanted) return@launch
      socketTries += 1
      delay((500L shl socketTries.coerceAtMost(4)).coerceAtMost(8000))
      if (socketWanted && Settings.sessionId == id) openSocket(id)
    }
  }

  private fun closeSocket() {
    socketWanted = false
    socket?.close(1000, "bye")
    socket = null
    socketId = null
    _status.update { it.copy(socket = "off") }
  }

  private fun handle(id: String, msg: JSONObject) {
    when (msg.optString("type")) {
      "say" -> if (msg.optString("sessionId") == id) speak(msg.getJSONObject("say"))
      "snapshot" -> {
        msg.optJSONArray("sessions")?.let { arr -> if (arr.length() > 0) applySession(arr.getJSONObject(0)) }
        msg.optJSONArray("says")?.let { arr -> for (i in 0 until arr.length()) speak(arr.getJSONObject(i)) }
      }
      "session" -> msg.optJSONObject("session")?.let { s -> if (s.optString("id") == id) applySession(s) }
    }
  }

  private fun speak(say: JSONObject) {
    val text = say.optString("text")
    val source = say.optString("source")
    _status.update { it.copy(lastSaid = text, lastSaidFrom = source) }
    if (paused) return // paused means quiet too; the line still shows on screen
    speaker.say(say.optString("id").ifBlank { null }, text, say.optBoolean("interrupt"))
  }

  private fun fail(message: String) {
    Log.w(TAG, message)
    _status.update { it.copy(error = message) }
  }
}
