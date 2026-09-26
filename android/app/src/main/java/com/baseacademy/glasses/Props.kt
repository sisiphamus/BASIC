package com.baseacademy.glasses

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

// Demo props shown on the phone so the glasses can "scan" and "see commissioning" without extra
// hardware. Values come from the job file so they match what the server expects.
object PropValues {
  const val SERIAL = "BP2-0418-7731"
  const val JOB = "BP-24-1187"
  const val ADDRESS = "2305 Goldsmith St"
}

/** Full-screen serial label: hold the phone at the stack for the scan step. Tap to close. */
@Composable
fun SerialLabel(onClose: () -> Unit) {
  Column(
      Modifier.fillMaxSize().background(Color.White).clickable(onClick = onClose).safeDrawingPadding().padding(20.dp),
      verticalArrangement = Arrangement.Center,
  ) {
    Column(Modifier.fillMaxWidth().border(4.dp, Color.Black).padding(22.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
      Text("BASE", fontSize = 56.sp, fontWeight = FontWeight.Black, color = Color.Black)
      Text("Home Battery", fontSize = 22.sp, color = Color.Black)
      Spacer(Modifier.height(6.dp))
      Text("S/N", fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = Color.Black)
      Text(PropValues.SERIAL, fontSize = 36.sp, fontWeight = FontWeight.Bold, color = Color.Black, maxLines = 1)
      Text("JOB", fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = Color.Black)
      Text(PropValues.JOB, fontSize = 36.sp, fontWeight = FontWeight.Bold, color = Color.Black, maxLines = 1)
    }
  }
}

/** Mock Base installer app. Shows the screen for the current step; controls are touch-driven. */
@Composable
fun InstallerApp(stepId: String, onClose: () -> Unit) {
  when (stepId) {
    "grid-test", "grid-verify" -> GridTest(onClose)
    "commission", "top-shell", "side-panel", "closeout" -> Commissioning(onClose)
    else -> PreCheck(onClose)
  }
}

@Composable
private fun AppFrame(title: String, onClose: () -> Unit, body: @Composable () -> Unit) {
  Column(Modifier.fillMaxSize().background(Color(0xFFF4F5F7)).safeDrawingPadding()) {
    Row(Modifier.fillMaxWidth().background(Color(0xFF1A1D24)).padding(horizontal = 24.dp, vertical = 16.dp), verticalAlignment = Alignment.CenterVertically) {
      Text("Base", fontSize = 30.sp, fontWeight = FontWeight.Bold, color = Color.White)
      Spacer(Modifier.width(12.dp))
      Text("Installer", fontSize = 16.sp, color = Color(0xFFB8BDC7))
      Spacer(Modifier.weight(1f))
      Text("Done", fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = Color.White, modifier = Modifier.clickable(onClick = onClose).padding(10.dp))
    }
    Column(Modifier.padding(horizontal = 24.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
      Text(title, fontSize = 28.sp, fontWeight = FontWeight.Bold, color = Color(0xFF1A1D24))
      Text("Job ${PropValues.JOB} · Serial ${PropValues.SERIAL}", fontSize = 15.sp, color = Color(0xFF555B66))
      body()
    }
  }
}

@Composable
private fun Banner(text: String, color: Color) {
  Row(Modifier.fillMaxWidth().background(color, RoundedCornerShape(12.dp)).padding(18.dp), verticalAlignment = Alignment.CenterVertically) {
    Text(text, fontSize = 34.sp, fontWeight = FontWeight.Bold, color = Color.White)
  }
}

@Composable
private fun CheckRow(label: String, value: String, ok: Boolean) {
  Row(verticalAlignment = Alignment.CenterVertically) {
    Spacer(Modifier.size(14.dp).background(if (ok) Color(0xFF1F8A4C) else Color(0xFFC9CDD4), CircleShape))
    Spacer(Modifier.size(12.dp))
    Text(label, fontSize = 19.sp, color = Color(0xFF1A1D24), modifier = Modifier.weight(1f))
    Text(value, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = if (ok) Color(0xFF1F8A4C) else Color(0xFF8A909A))
  }
}

/**
 * A breaker-style lever: drag the handle down for OFF, up for ON (a tap also flips it).
 */
@Composable
private fun Lever(label: String, on: Boolean, onChange: (Boolean) -> Unit) {
  var drag by remember { mutableStateOf(0f) }
  Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(20.dp)) {
    Box(
        Modifier.size(width = 120.dp, height = 220.dp)
            .background(Color(0xFF2A2E36), RoundedCornerShape(14.dp))
            .border(3.dp, Color(0xFF555B66), RoundedCornerShape(14.dp))
            .pointerInput(on) {
              detectVerticalDragGestures(
                  onDragEnd = {
                    if (on && drag > 60f) onChange(false)
                    if (!on && drag < -60f) onChange(true)
                    drag = 0f
                  },
                  onVerticalDrag = { _, dy -> drag += dy },
              )
            }
            .clickable { onChange(!on) },
        contentAlignment = if (on) Alignment.TopCenter else Alignment.BottomCenter,
    ) {
      Box(
          Modifier.padding(10.dp).size(width = 96.dp, height = 96.dp)
              .background(if (on) Color(0xFFC8372D) else Color(0xFF1F8A4C), RoundedCornerShape(10.dp)),
          contentAlignment = Alignment.Center,
      ) {
        Text(if (on) "ON" else "OFF", fontSize = 28.sp, fontWeight = FontWeight.Black, color = Color.White)
      }
    }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
      Text(label, fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Color(0xFF1A1D24))
      Text(if (on) "Drag down to switch OFF" else "Drag up to switch ON", fontSize = 16.sp, color = Color(0xFF555B66))
    }
  }
}

/** Before connecting: flip the Disco to OFF. */
@Composable
private fun PreCheck(onClose: () -> Unit) {
  var discoOn by remember { mutableStateOf(true) }
  AppFrame("Pre-install check", onClose) {
    if (discoOn) Banner("Disco ON", Color(0xFFC8372D)) else Banner("Disco OFF", Color(0xFF1F8A4C))
    Lever("Disco", discoOn) { discoOn = it }
    CheckRow("Disconnect (Disco)", if (discoOn) "ON" else "OFF", !discoOn)
    CheckRow("Battery isolated", if (discoOn) "…" else "OK", !discoOn)
    CheckRow("Serial registered", "OK", true)
    Text(if (discoOn) "Switch the Disco OFF before connecting." else "Safe to connect.", fontSize = 18.sp, color = Color(0xFF1A1D24))
  }
}

/** Commissioning: press Start, checks run, ends Online. */
@Composable
private fun Commissioning(onClose: () -> Unit) {
  var started by remember { mutableStateOf(false) }
  var stage by remember { mutableIntStateOf(0) }
  LaunchedEffect(started) {
    if (!started) return@LaunchedEffect
    for (s in 1..4) {
      delay(1300)
      stage = s
    }
  }
  val online = stage >= 4
  AppFrame("Commissioning", onClose) {
    when {
      !started -> Banner("Ready", Color(0xFF555B66))
      online -> Banner("Online", Color(0xFF1F8A4C))
      else -> Banner("Connecting", Color(0xFFE2A400))
    }
    listOf("Battery detected", "Firmware verified", "Grid sync", "Reporting to Base").forEachIndexed { i, label ->
      CheckRow(label, if (stage > i) "OK" else if (started) "…" else "", stage > i)
    }
    if (!started) {
      Box(
          Modifier.fillMaxWidth().height(72.dp).background(Color(0xFFF5D000), RoundedCornerShape(14.dp)).clickable { started = true },
          contentAlignment = Alignment.Center,
      ) { Text("Start commissioning", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Color(0xFF1A1D24)) }
    }
    if (online) Text("Backup ready · 100%", fontSize = 18.sp, color = Color(0xFF1A1D24))
  }
}

/** Grid test: drag the breaker OFF -> islanded -> on battery -> passed; drag it back ON to restore. */
@Composable
private fun GridTest(onClose: () -> Unit) {
  var breakerOn by remember { mutableStateOf(true) }
  var stage by remember { mutableIntStateOf(0) } // 0 idle, 1 grid off, 2 on battery, 3 passed, 4 restored
  LaunchedEffect(breakerOn) {
    if (!breakerOn && stage == 0) {
      stage = 1
      delay(2000)
      stage = 2
      delay(2000)
      stage = 3
    } else if (breakerOn && stage >= 3) {
      stage = 4
    }
  }
  AppFrame("Grid test", onClose) {
    when (stage) {
      0 -> Banner("Switch breaker OFF", Color(0xFFE2A400))
      1 -> Banner("Grid OFF", Color(0xFFC8372D))
      2 -> Banner("On battery", Color(0xFF1F8A4C))
      3 -> Banner("Grid test passed", Color(0xFF1F8A4C))
      else -> Banner("Grid restored", Color(0xFF1F8A4C))
    }
    Lever("Grid breaker", breakerOn) { breakerOn = it }
    CheckRow("Home islanded", if (stage >= 2) "OK" else "…", stage >= 2)
    CheckRow("Home load on battery", if (stage >= 2) "3.8 kW" else "…", stage >= 2)
    CheckRow("Backup verified", if (stage >= 3) "OK" else "…", stage >= 3)
    if (stage == 3) Text("Switch the breaker back ON to restore utility power.", fontSize = 18.sp, color = Color(0xFF1A1D24))
    if (stage == 4) Text("Resynchronized to the grid.", fontSize = 18.sp, color = Color(0xFF1A1D24))
  }
}
