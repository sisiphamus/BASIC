# Demo script: glasses-guided battery install

An installer with no training wears the glasses. The voice walks them through Base's visit-2 install
in build order, and Claude checks every step from the glasses camera. Only the instructions are
written in advance. Every confirmation and correction is written from what the camera sees.

## Setup

- Server: `MODEL_PROVIDER=claude-cli npm start`. Dashboard on the projector at `http://localhost:3000`.
- Telemetry for the judges: `npm run console` in one terminal, `npm run frames` (kitty) in another.
- Phone: open BASIC, job **Base battery install (visit 2)**, glasses on, camera streaming. Keep it
  paused until you're standing at the stack. Over USB, run `adb reverse tcp:3000 tcp:3000` and use
  `http://localhost:3000` as the server.
- Props: the module stack, the dark gray top and the metal shell. The Disco, commissioning and grid
  test happen on the phone under **Base installer app**.

## The run (12 steps, about 5 s per check)

| # | The glasses say | What you do |
|---|---|---|
| 1 | Set the module stack on flat ground, labels facing you. Then give me a thumbs up. | Stack in view, thumbs up |
| 2 | Scan the unit. Look at the QR code on the Base label. | Look at the label |
| 3 | Look at the top plate. Point to the four mounting studs. | Point at the studs |
| 4 | Set the gray top on the studs. Press down so it seats. | Place the gray top, press down |
| 5 | Before any connection, open the installer app and drag the Disco switch to OFF. | Swipe the Disco lever in the app, show the screen |
| 6 | Point to the connection point on the gray top. | Point at the gray top |
| 7 | Point to the back corner where the D2I cable exits. | Point at the back corner |
| 8 | Lower the metal shell over the gray top until it sits flush. | Shell on, hand on it, thumbs up |
| 9 | Open the installer app and press Start commissioning. Show me when it reads Online. | Tap Start commissioning, show Online |
| 10 | Grid test. In the installer app, drag the grid breaker down to OFF. | Swipe the breaker off |
| 11 | Hold on that screen until it says passed. Then drag the breaker back ON. | Show Passed, swipe it back on |
| 12 | Closeout photo. Step back about six feet, unit centered, then thumbs up. | Step back, thumbs up |

Hold each action for a beat. If a step won't register, tap **Skip** on the phone (it's logged as
skipped), or approve it from the dashboard.

## Older script (battery-install job with tape/level props)



## Setup before you're called

- Laptop: `npm start`, dashboard open on the projector at `http://localhost:3000`.
- Wall of crews: `npm run simulate -- --crews 4 --loop` in a second terminal, so the floor shows several jobs moving. These are simulated crews on the built-in walkthrough model: they cost no Gemini quota and can't slow down the real crew. If a judge asks, say so. Only the crew on stage is real.
- Crew member: glasses paired to the phone, phone on the glasses page, name typed in, job = **Battery set and commission**, *not started yet*.
- Props on the table: box as the battery 2 feet from a taped "window", tape measure, bubble level, a plug with a colored band, BASE + WARNING labels, a spare phone showing `demo-frames/battery-install/05-online-c-base-app-online.jpg` full screen.

## Script

1. **The problem (15 s).** "Base wants to go from about 20 to about 100 megawatts a month. The limit isn't batteries, it's skilled crew time. Every install needs someone who knows what right looks like."

2. **Put on the glasses (the teammate with no electrical training).** Tap Start. The glasses say: *"Measure from the battery to the nearest window or door."*

3. **The catch.** Measure the box at 2 feet. Glasses: *"That is under 36 inches. Slide the battery away from the opening and measure again."* Slide it, measure again: *"Clearance is good."* (On the projector, step 1 turns green with the photo as evidence.)

4. **The supervisor (on the projector).** "This is the master electrician's view. Every crew, live." Click the crew. Type: *"Nice catch. Level next."* The crew hears it in the glasses.

5. **Teach it something new, live.** In **Watching for**, type *"When you see a phone in their hand, say eyes on the work"*. Hold up a phone and the glasses say it. "No retraining. Plain English."

6. **Finish fast.** Level, plug, labels, app screen. The last line is *"Battery is online. Nice work."*

7. **The record.** Open **Proof packet**: every step with its photo and reading. "This is what the city inspector would otherwise drive out to check."

8. **The bigger story (20 s).** "Today it's the install crew. The same engine lets one master electrician supervise twenty crews. In trainee mode it explains why each step matters, and signs off skills once someone does them without help." Click **Training record**. "And every task is just a playbook file, so it works for any field trade."

## If something breaks on stage

- Model slow or erroring: the supervisor clicks **Approve step** and keeps going. The job never gets stuck.
- Glasses audio drops: tap **Repeat** on the phone, or read the line off the phone screen.
- Phone loses the server: the badge says Reconnecting, and the page reloads into **Resume job** with one tap.
- Total failure: run the walkthrough model (`MODEL_PROVIDER=mock npm start`). It plays a believable job on its own.
