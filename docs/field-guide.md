# BASIC field guide

> The full operations guide: every way to connect the glasses, the phone web page, the simulator, playbook syntax and troubleshooting. Start with the [README](../README.md).

AI coaching through Meta glasses for Base Power field crews, plus a dashboard where one master electrician watches every crew at once.

The glasses (or a phone camera) send a still frame every 2 seconds. Gemini checks it against the current step of a job playbook ("tape reads 36 inches or more from the window"). The crew hears what to do next, what's wrong, and when a step passes. The supervisor sees every crew live, scrubs back through footage, talks into anyone's glasses by typing, and adds new things to watch for in plain English. Every job ends with a proof packet for the inspector, and every pass counts toward a worker's training record.

## Run it

```bash
npm install
cp env.example .env         # put GEMINI_API_KEY in it (optional, see below)
npm run build
npm start
```

The server prints two kinds of links:

```
dashboard:       http://localhost:3000
glasses (phone): https://192.168.1.162:3443/glasses
```

- **Dashboard**: open on the laptop.
- **Glasses page**: open on the phone. The phone and laptop need to be on the same Wi-Fi. The first time, the phone shows a certificate warning (the certificate is self-made). Tap "Show details / Advanced" and "visit this website". Phones only allow the camera on https pages, which is why this is needed.

**No Gemini key? Use Claude.** `MODEL_PROVIDER=claude-cli npm start` sends each photo to the `claude` command-line tool (Claude Code) on this laptop, using whatever account it's logged into: Sonnet, low effort, no tools, no hooks or MCP servers. On real glasses photos it took about 3.8 s per check and cost about $0.013 per photo against that account. Change the model or effort with `BA_CLAUDE_MODEL` and `BA_CLAUDE_EFFORT`.

No key at all? The server runs a built-in walkthrough model that fakes believable results (step 1 fails once, then everything passes). Use it to rehearse. With `GEMINI_API_KEY` set, Gemini judges every frame for real. The server asks Google which models your key can use and picks the newest regular `flash` model. Set `GEMINI_MODEL` to force one.

## Morning checklist (10 minutes)

1. Put the Gemini key in `.env`, then `npm run build && npm start`. The last startup line should say `model: gemini ...`.
2. On the dashboard, the empty wall shows a QR code for the phone page. Scan it.
3. Pair the Meta glasses to that phone over Bluetooth (normal Bluetooth audio pairing is enough for option A below).
4. On the phone: enter a name, pick **Glasses system check**, press Start. It asks for a thumbs up, three fingers, then any screen. If you hear "System check complete", the whole loop works: camera, server, Gemini, voice.
5. Then run **Battery set and commission** with the props (below).

## Before you go on stage

- **Run `npm run check:gemini` at the venue.** It must end with "Gemini works" and `thinking=true schema=true`. `GEMINI_MODEL` is pinned to `gemini-3.8-flash` in `env.example`.
- **Use a billing-enabled key.** Each crew sends a request every 2-3 seconds, which is about 20-40 a minute per crew. Free-tier limits are around that, so the simulator with several crews will hit 429s. Check your limits in AI Studio.
- **Use a phone hotspot for the laptop and the demo phone.** Venue Wi-Fi often blocks phones from reaching laptops. On an open network anyone could also post messages to the glasses (there's no login).
- **iPhone:** Safari accepts the certificate warning for the page but not for the live connection. The page notices and switches to a backup channel over https (the badge shows "Live (backup)"), so coaching still plays, with up to a second of extra delay. For the full live connection, run `npm run tunnel` and open the `https://...trycloudflare.com/glasses` link it prints. That has a real certificate, but it goes over the internet.
- **Screen:** set the phone's Auto-Lock to Never. The page asks the phone to stay awake, but not every phone listens.
- **Clean floor:** stop the server, run `npm run archive-data` (moves rehearsal jobs into `data/archive/`, nothing is deleted), and start again. Jobs untouched for 30 minutes also close on their own.
- **Changed Wi-Fi?** The certificate is remade automatically for the new address. The phone will show the warning once more.

## The glasses app (Android): photos straight from the glasses

`android/` is a small Android app built on Meta's Wearables Device Access Toolkit. Once set up, it:

- connects to the glasses by itself whenever they're on and paired,
- takes a **full-resolution photo from the glasses camera every 2 seconds** and uploads it to the server,
- speaks every reply through the glasses (Android text-to-speech on media audio, which goes to the glasses' speakers),
- keeps running with the phone screen off (foreground service),
- shows up on the dashboard like any other crew.

**One-time setup**

1. In the Meta AI app, pair the glasses and turn on **Developer Mode**. No Meta developer account or App ID is needed in Developer Mode; the app ships with `0/0` as Meta's docs specify.
2. Build and install from this laptop (JDK 17 and the Android SDK are in `~/Android`):
   ```bash
   cd android
   JAVA_HOME=~/Android/jdk-17.0.20.1+1 ./gradlew assembleDebug
   ~/Android/sdk/platform-tools/adb install -r app/build/outputs/apk/debug/app-debug.apk
   ```
3. Open **BASIC** on the phone. Enter your name and the server address, then tap **Connect glasses (one time)**. That hops to Meta AI to approve and comes back. Then tap **Start**, and **Allow glasses camera** if it asks.

**How the voice reaches the glasses.** While the glasses camera is streaming, the glasses mute normal media audio (Meta DAT issue #78). So by default the app speaks over the Bluetooth **call** channel, which keeps working during the stream. Tested on a Galaxy S24 with Ray-Ban Meta: clear, and a check every ~4 s. If you can't hear anything on another phone, turn off "Talk over phone-call audio": the app then stops the camera while it speaks and restarts it after, which works everywhere but adds several seconds per spoken line. Photos taken during a stream come back at 1080×1440 (measured: ~220 KB, ~1.3 s per capture). The app shows the real size and timing on screen, and **Pause** turns the camera off until you resume.

**Server address from the phone**

- Phone plugged into the laptop: `adb reverse tcp:3000 tcp:3000`, then use `http://localhost:3000`.
- Same Wi-Fi: `http://<laptop-ip>:3000` (the server prints it).
- Phone on mobile data: `npm run tunnel` and use the `https://...trycloudflare.com` address.

**Test without glasses:** turn on "Test without glasses (simulated glasses)". Meta's MockDeviceKit pairs fake Ray-Ban Meta glasses whose camera returns the photos in `android/app/src/main/assets/mock/`, matched to the current step. Or from the laptop:

```bash
adb shell am start -n com.baseacademy.glasses/.MainActivity --ez mock true \
  --es server http://localhost:3000 --es worker "'Your Name'" --es playbook battery-install --ez newjob true --ez start true
adb logcat -s BA-Pipeline BA-Speaker     # watch it capture and speak
```

## Hooking up the glasses

There are three ways. A is the one to trust on stage.

### A. Glasses for audio, phone camera for video (most reliable)

The glasses are a Bluetooth headset. The phone runs the glasses page with its back camera, clipped to a chest mount or held at eye level. Coaching plays in the glasses' speakers.

Voice commands ("next", "repeat", "help", "back") use the phone's speech recognition and start **off**. Android chimes each time listening restarts, and on iPhones listening can interfere with the spoken coaching. Tap "Voice commands off" to turn them on, test on the real phone with the glasses, and leave them on only if the coaching still plays cleanly. The phone remembers the choice. Buttons and the supervisor's approve/skip always work.

### B. The glasses' own camera through a video call

1. On a laptop, open WhatsApp Desktop or messenger.com and log into the account the glasses will call.
2. From the glasses: "Hey Meta, video call <that contact> on WhatsApp", then switch the call to the glasses camera (double-press the capture button).
3. On the laptop, open `https://localhost:3443/glasses` in Chrome, set **Video from** to **A shared window**, and pick the call window. Frames now come from the glasses' point of view.
4. Getting the coaching back into the call means the laptop's speech has to go into the call's microphone:
   - **Mac:** `brew install blackhole-2ch`. Set the Mac's sound output to BlackHole (or a Multi-Output Device of speakers + BlackHole so you hear it too), and set the call's microphone to BlackHole.
   - **Windows:** install VB-Cable. Set Chrome's output to "CABLE Input" and the call's microphone to "CABLE Output".
   - **Linux:** `pactl load-module module-null-sink sink_name=ba_voice`, point Chrome at it in `pavucontrol`, and set the call's microphone to "Monitor of ba_voice".
   - **No time for that?** Uncheck "Speak the coaching on this device" on the laptop. Then open the glasses page on the phone paired to the glasses and tap the crew under **Speak for a crew already running**. The phone speaks while the laptop sends video. Some phones mute other audio during a call, so test this before relying on it.

   Voice commands don't work in B, because the laptop can't hear the wearer. Use the dashboard buttons instead.

### C. Meta's SDK (the real product path)

Meta's Wearables Device Access Toolkit ([iOS](https://github.com/facebook/meta-wearables-dat-ios), [Android](https://github.com/facebook/meta-wearables-dat-android)) streams the glasses camera into a native app. It needs an app registered in the Wearables Developer Center. A native app only needs the same two calls the glasses page makes:

- `POST /api/sessions/<id>/frames`: body is a JPEG, `content-type: image/jpeg`
- WebSocket `/ws?role=glasses&session=<id>`: speak every `{type:"say", say:{text}}` message

## Demo props (battery job)

A cardboard box as the battery, a taped-on window frame, a tape measure, a small bubble level, any chunky plug with a colored band, printed "BASE" and "WARNING" labels, and a phone showing an "Online" screen. To show a caught mistake, start the box 2 feet from the "window". The crew hears "That is under 36 inches..." and moves it.

## Playbooks: telling it what to look for and what to say

Jobs are YAML files in `playbooks/`. Edit them in the dashboard (**Playbooks**) or any text editor; changes apply to running crews right away. A bad file is refused with the line number, so it never breaks a live job.

```yaml
steps:
  - id: clearance
    title: Clearance from openings
    say: Measure from the battery to the nearest window or door.   # said when the step starts
    check: The tape reading at the frame is {clearance_in} inches or more.   # what Gemini checks
    pass_say: Clearance is good.
    fail_say: That is under {clearance_in} inches. Slide the battery away.
    hint: I can't read the tape yet. Get closer.          # after ~8 s of not seeing it
    why: Fire code keeps batteries away from openings.    # trainee mode only
watch:                                                    # checked on every frame
  - id: bare-hands
    when: Bare hands are touching a metal connector.
    say: Gloves on before you touch the connector.        # leave empty and Gemini words it
    cooldown_s: 30
```

`{clearance_in}` comes from the `job:` section (the customer file).

During a job, the supervisor can type rules on the crew's page:

- `When you see a ladder against the wall, say check your footing`
- `If the disconnect is on, tell them to switch it off`
- `Now check for gloves and safety glasses` (Gemini writes the line)

They apply from the next frame. The supervisor can also rewrite what the current step checks.

## Demo multiple crews

```bash
npm run simulate -- --crews 5 --loop --images demo-frames/battery-install
```

Fake crews post photos from `demo-frames/` through the same API as the glasses, which fills the dashboard wall. Use it for the "one master electrician, five crews" moment. Simulated crews always run on the built-in walkthrough model, even when a Gemini key is set, so they never eat quota or slow the real crew. Add `--real-model` to have Gemini judge the photos; each file's number (`03-...`) is the step it's sent for.

## When something goes wrong

| What you see | Fix |
|---|---|
| Phone says the camera needs the https address | Use the `https://...:3443/glasses` link, not http |
| Phone can't reach the server | Same Wi-Fi? Venue Wi-Fi often blocks device-to-device traffic. Use a phone hotspot, or run `npx cloudflared tunnel --url http://localhost:3000` and open that https URL on the phone |
| No voice in the glasses | Glasses paired and chosen as the phone's audio output? Volume up? "Speak the coaching on this device" checked? |
| "Model is having trouble" | Check the dashboard's error line. A bad key shows "API key not valid". A quota problem shows 429. The job keeps going and the supervisor can approve steps by hand |
| Steps pass too easily / never pass | Edit the step's `check` wording, or raise/lower `min_confidence` (default 0.6) |
| Port in use | `PORT=3100 HTTPS_PORT=3543 npm start` |

## Tests

```bash
npm test          # engine, playbooks, Gemini connector (against a fake Gemini), full HTTP + WebSocket API
npm run build && npm run test:e2e   # real Chrome with a fake camera runs whole jobs through the phone page
```

## How it's built

- `server/`: Express + WebSocket. `engine.js` is the step state machine (pure, fully tested). `service.js` runs frames through the model, one at a time per crew: if frames arrive faster than the model answers, only the newest waiting frame is checked. `providers/gemini.js` talks to Gemini over REST with fallbacks for model names, optional settings and transient errors. Everything is saved under `data/` (session state, an event log, and every frame), so a restart loses nothing.
- `web/glasses.html`: the phone page (plain JS, about 17 KB).
- `web/index.html`: the supervisor dashboard (React).
- `playbooks/`: the jobs.
