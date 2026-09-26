package com.baseacademy.glasses

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.meta.wearable.dat.core.Wearables
import com.meta.wearable.dat.core.types.Permission
import com.meta.wearable.dat.core.types.PermissionStatus
import kotlinx.coroutines.launch

private val Ink = Color(0xFF1A1D24)
private val HiVis = Color(0xFFF5D000)
private val Pass = Color(0xFF1F8A4C)
private val Fail = Color(0xFFC8372D)

class MainActivity : ComponentActivity() {

  private val androidPermissions =
      registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        Wearables.initialize(applicationContext)
        maybeAutoStart()
      }

  private val glassesCameraPermission =
      registerForActivityResult(Wearables.RequestPermissionContract()) { result ->
        if (result.getOrDefault(PermissionStatus.Denied) == PermissionStatus.Granted) Pipeline.cameraPermissionGranted()
      }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    applyExtras(intent)
    androidPermissions.launch(arrayOf(Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.POST_NOTIFICATIONS))
    setContent {
      MaterialTheme(colorScheme = lightColorScheme(primary = Ink, secondary = HiVis)) {
        Screen(
            onConnectGlasses = { Wearables.startRegistration(this) },
            onAllowCamera = { glassesCameraPermission.launch(Permission.CAMERA) },
        )
      }
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    applyExtras(intent)
  }

  /**
   * adb-friendly setup for testing, e.g.
   * adb shell am start -n com.baseacademy.glasses/.MainActivity --ez mock true --es server http://localhost:3000 --es worker "Test" --ez start true
   */
  private fun applyExtras(intent: Intent?) {
    val x = intent?.extras ?: return
    x.getString("server")?.let { Settings.serverUrl = it }
    x.getString("worker")?.let { Settings.worker = it }
    x.getString("playbook")?.let { Settings.playbookId = it }
    x.getString("mode")?.let { Settings.mode = it }
    if (x.containsKey("mock")) Settings.mock = x.getBoolean("mock")
    if (x.containsKey("interval")) Settings.intervalMs = x.getInt("interval").toLong()
    x.getString("voice")?.let { Settings.voiceRoute = it }
    if (x.getBoolean("newjob", false)) {
      Settings.sessionId = null
      if (Pipeline.status.value.running) Pipeline.newJob()
    }
    if (x.getBoolean("stop", false)) GlassesService.stop(this)
    if (x.getBoolean("start", false)) pendingStart = true
    maybeAutoStart()
  }

  private var pendingStart = false

  private fun maybeAutoStart() {
    val ok = ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
    if (!ok) return
    if ((pendingStart || Settings.autoStart) && Settings.worker.isNotBlank() && !Pipeline.status.value.running) {
      pendingStart = false
      GlassesService.start(this)
    }
  }
}

@Composable
private fun Screen(onConnectGlasses: () -> Unit, onAllowCamera: () -> Unit) {
  val status by Pipeline.status.collectAsStateWithLifecycle()
  val context = androidx.compose.ui.platform.LocalContext.current
  val scope = rememberCoroutineScope()
  var server by remember { mutableStateOf(Settings.serverUrl) }
  var worker by remember { mutableStateOf(Settings.worker) }
  var playbook by remember { mutableStateOf(Settings.playbookId) }
  var mode by remember { mutableStateOf(Settings.mode) }
  var mock by remember { mutableStateOf(Settings.mock) }
  var autoStart by remember { mutableStateOf(Settings.autoStart) }
  var callAudio by remember { mutableStateOf(Settings.voiceRoute == Settings.ROUTE_CALL) }
  var jobs by remember { mutableStateOf(listOf<Pair<String, String>>()) }
  var serverNote by remember { mutableStateOf("") }

  fun save() {
    Settings.serverUrl = server
    Settings.worker = worker
    Settings.playbookId = playbook
    Settings.mode = mode
    Settings.mock = mock
    Settings.autoStart = autoStart
    Settings.voiceRoute = if (callAudio) Settings.ROUTE_CALL else Settings.ROUTE_PAUSE
  }

  suspend fun checkServer() {
    save()
    serverNote = "Checking…"
    serverNote =
        try {
          jobs = Server.playbooks()
          if (jobs.none { it.first == playbook } && jobs.isNotEmpty()) playbook = jobs.first().first.also { Settings.playbookId = it }
          "Server OK"
        } catch (e: Exception) {
          "Can't reach $server (${e.message})"
        }
  }

  LaunchedEffect(Unit) { checkServer() }

  Column(
      Modifier.fillMaxSize().background(Color(0xFFF7F8FA)).safeDrawingPadding().verticalScroll(rememberScrollState()).padding(16.dp),
      verticalArrangement = Arrangement.spacedBy(14.dp),
  ) {
    Text("Base Academy", fontSize = 34.sp, fontWeight = FontWeight.Bold, color = Ink)

    if (status.running) {
      Live(status)
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
        OutlinedButton(onClick = { Pipeline.sendCommand("repeat") }, modifier = Modifier.weight(1f)) { Text("Repeat") }
        OutlinedButton(onClick = { Pipeline.sendCommand("help") }, modifier = Modifier.weight(1f)) { Text("Help") }
        OutlinedButton(onClick = { Pipeline.sendCommand("next") }, modifier = Modifier.weight(1f)) { Text("Skip") }
      }
      if (status.needsCameraPermission) BigButton("Allow glasses camera", HiVis, onAllowCamera)
      if (!mock && status.registration != "REGISTERED") BigButton("Connect glasses (one time)", HiVis, onConnectGlasses)
      OutlinedButton(onClick = { Pipeline.newJob() }, modifier = Modifier.fillMaxWidth()) { Text("Start a new job") }
      OutlinedButton(onClick = { GlassesService.stop(context) }, modifier = Modifier.fillMaxWidth()) { Text("Stop", color = Fail) }
      return@Column
    }

    Text("Pair your glasses in the Meta AI app with Developer Mode on. Then fill this in once. The app starts taking pictures as soon as your glasses connect.", color = Color(0xFF555B66))
    OutlinedTextField(value = worker, onValueChange = { worker = it }, label = { Text("Your name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(value = server, onValueChange = { server = it }, label = { Text("Server address") }, singleLine = true, modifier = Modifier.fillMaxWidth())
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      OutlinedButton(onClick = { scope.launch { checkServer() } }) { Text("Check server") }
      Text(serverNote, color = if (serverNote == "Server OK") Pass else Color(0xFF555B66), fontSize = 14.sp)
    }
    if (jobs.isNotEmpty()) {
      Text("Job", fontWeight = FontWeight.SemiBold)
      jobs.forEach { (id, title) -> FilterChip(selected = playbook == id, onClick = { playbook = id }, label = { Text(title) }) }
    }
    Text("Mode", fontWeight = FontWeight.SemiBold)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      FilterChip(selected = mode == "crew", onClick = { mode = "crew" }, label = { Text("Crew") })
      FilterChip(selected = mode == "trainee", onClick = { mode = "trainee" }, label = { Text("Trainee (explains why)") })
    }
    Toggle("Start automatically when the app opens", autoStart) { autoStart = it }
    Toggle("Test without glasses (simulated glasses)", mock) { mock = it }
    Toggle("Keep camera on while talking (phone-call audio)", callAudio) { callAudio = it }
    Text("Off (recommended): the camera pauses for a moment while the glasses talk, because the glasses mute normal audio during camera use. Turn on only if voice doesn't come through.", fontSize = 13.sp, color = Color(0xFF555B66))
    if (!mock && status.registration != "REGISTERED") BigButton("Connect glasses (one time)", Color.White, onConnectGlasses)
    BigButton("Start", HiVis) {
      save()
      if (worker.isBlank()) serverNote = "Enter your name first" else GlassesService.start(context)
    }
  }
}

@Composable
private fun Live(s: Status) {
  Column(
      Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(12.dp)).padding(16.dp),
      verticalArrangement = Arrangement.spacedBy(6.dp),
  ) {
    Line("Glasses", if (s.glasses) "connected" else "waiting for glasses", s.glasses)
    Line("Camera", s.stream.lowercase().replace('_', ' '), s.stream == "STREAMING")
    Line("Server", if (s.serverSession != null) "job running, voice ${s.socket}" else "not started", s.serverSession != null && s.socket == "live")
    Line("Photos sent", if (s.photos > 0) "${s.photos} · ${s.lastPhotoSize} · ${s.lastPhotoKb} KB" else "0", s.photos > 0)
    if (s.photos > 0) Line("Timing", "capture ${s.lastCaptureMs} ms · total ${s.lastRoundTripMs} ms", true)
    if (s.talking) Line("Voice", "camera paused while talking", true)
    Spacer(Modifier.height(6.dp))
    if (s.stepCount > 0) {
      Text("Step ${s.stepNo} of ${s.stepCount}", color = Color(0xFF555B66), fontWeight = FontWeight.SemiBold)
      Text(s.step, fontSize = 26.sp, fontWeight = FontWeight.Bold, color = Ink)
    }
    if (s.jobStatus == "complete") Text("Job complete", color = Pass, fontWeight = FontWeight.Bold)
    if (s.lastSaid.isNotBlank()) {
      Column(
          Modifier.fillMaxWidth().background(if (s.lastSaidFrom == "supervisor") HiVis else Color(0xFFF0F1F4), RoundedCornerShape(10.dp)).padding(12.dp),
      ) {
        Text(if (s.lastSaidFrom == "supervisor") "Supervisor" else "Coach", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        Text(s.lastSaid, fontSize = 18.sp)
      }
    }
    if (s.error.isNotBlank()) Text(s.error, color = Fail, fontSize = 14.sp)
  }
}

@Composable
private fun Line(label: String, value: String, good: Boolean) {
  Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
    Text(label, color = Color(0xFF555B66))
    Text(value, color = if (good) Pass else Ink, fontWeight = FontWeight.SemiBold)
  }
}

@Composable
private fun Toggle(label: String, value: Boolean, onChange: (Boolean) -> Unit) {
  Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
    Text(label, modifier = Modifier.weight(1f))
    Switch(checked = value, onCheckedChange = onChange)
  }
}

@Composable
private fun BigButton(label: String, color: Color, onClick: () -> Unit) {
  Button(
      onClick = onClick,
      modifier = Modifier.fillMaxWidth().height(56.dp),
      colors = ButtonDefaults.buttonColors(containerColor = color, contentColor = Ink),
      shape = RoundedCornerShape(12.dp),
  ) {
    Text(label, fontSize = 18.sp, fontWeight = FontWeight.Bold)
  }
}
