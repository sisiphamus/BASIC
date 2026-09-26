package com.baseacademy.glasses

import androidx.compose.foundation.background
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

/** Mock Base installer app commissioning screen: Connecting -> checks -> Online. Tap to close. */
@Composable
fun InstallerApp(onClose: () -> Unit) {
  var stage by remember { mutableIntStateOf(0) }
  LaunchedEffect(Unit) {
    // A short, believable progression; ends on Online and stays there.
    for (s in 1..4) {
      delay(1300)
      stage = s
    }
  }
  val checks = listOf("Battery detected", "Firmware verified", "Grid sync", "Reporting to Base")
  val online = stage >= 4
  Column(Modifier.fillMaxSize().background(Color(0xFFF4F5F7)).clickable(onClick = onClose).safeDrawingPadding()) {
    Row(Modifier.fillMaxWidth().background(Color(0xFF1A1D24)).padding(horizontal = 24.dp, vertical = 20.dp), verticalAlignment = Alignment.CenterVertically) {
      Text("Base", fontSize = 30.sp, fontWeight = FontWeight.Bold, color = Color.White)
      Spacer(Modifier.weight(1f))
      Text("Installer", fontSize = 16.sp, color = Color(0xFFB8BDC7))
    }
    Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
      Text("Commissioning", fontSize = 30.sp, fontWeight = FontWeight.Bold, color = Color(0xFF1A1D24))
      Text("Job ${PropValues.JOB} · ${PropValues.ADDRESS}", fontSize = 17.sp, color = Color(0xFF555B66))
      Text("Serial ${PropValues.SERIAL}", fontSize = 17.sp, color = Color(0xFF555B66))
      Spacer(Modifier.height(4.dp))
      Row(
          Modifier.fillMaxWidth().background(if (online) Color(0xFF1F8A4C) else Color(0xFFE2A400), RoundedCornerShape(12.dp)).padding(20.dp),
          verticalAlignment = Alignment.CenterVertically,
      ) {
        Text(if (online) "Online" else "Connecting", fontSize = 40.sp, fontWeight = FontWeight.Bold, color = Color.White)
      }
      checks.forEachIndexed { i, label ->
        val done = stage > i
        Row(verticalAlignment = Alignment.CenterVertically) {
          Spacer(Modifier.size(14.dp).background(if (done) Color(0xFF1F8A4C) else Color(0xFFC9CDD4), CircleShape))
          Spacer(Modifier.size(12.dp))
          Text(label, fontSize = 20.sp, color = Color(0xFF1A1D24), modifier = Modifier.weight(1f))
          Text(if (done) "OK" else "…", fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = if (done) Color(0xFF1F8A4C) else Color(0xFF8A909A))
        }
      }
      if (online) Text("Backup ready · 100%", fontSize = 18.sp, color = Color(0xFF1A1D24))
    }
  }
}
