# Demo script: glasses-guided battery install (about 2 minutes)

The untrained installer wears the glasses; the voice walks them through Base's visit-2 sequence and
Claude checks every step from the glasses camera. Only the instructions are fixed; every confirmation
and correction is generated from what the camera sees.

## Setup

- Server with Claude as the model: `MODEL_PROVIDER=claude-cli npm start` (dashboard on the laptop, projector).
- Phone: Base Academy, job **Base battery install (visit 2)**, glasses paired, camera streaming. Pause until you're at the stack.
- Props: the module stack, one side panel, the top panel. Everything else is on the phone:
  **Show serial label** (for the scan) and **Base installer app** (the commissioning screen, goes Connecting → Online).

## What happens

1. **Stack set.** "Job BP-24-1187. Begin with the battery stack set in position, enclosure panels off…" → Claude confirms the bare stack.
2. **Serial scan.** Tap *Show serial label*, hold the phone at the stack. → "Serial BP2-0418-7731 confirmed and registered to job BP-24-1187."
3. **Harness.** Close-up of the stack's connector port, hand at it. → confirms the connection point.
4. **Side panel.** Fit the side panel flush. → confirms, or tells you what's off.
5. **Top panel.** Seat it, step back. → "The top panel is seated and the enclosure is fully closed as one finished unit."
6. **Commission.** Tap *Base installer app*, show the screen once it reads Online. → "The installer app shows the unit Online with all commissioning checks passing…"
7. **Closeout, front.** Six feet back, whole unit in frame. → "Front closeout photo is acceptable."
8. **Closeout, label.** Label or BASE badge readable. → install record complete; the dashboard's proof packet has every photo.

Each check takes about 5 s: hold each action for a beat. If something doesn't register, tap **Skip** (it's logged as skipped).


---

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
