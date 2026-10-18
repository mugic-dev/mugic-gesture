# MUGIC Gesture

Learn a gesture from a few reference performances with a MUGIC IMU, then score new attempts,
diagnose defects and give visual feedback. Standalone app (not part of mugic-arcade).
See [SPEC.md](SPEC.md) for the design.

## Run

    npm start        # python3 -m http.server 8000, then open http://localhost:8000 (the menu) in Chrome or Edge
    npm test         # node --test (Node 20+), no dependencies

Web Bluetooth needs Chrome/Edge and a secure origin (`localhost` counts). The MUGIC must be in BLE output mode
(firmware >= 2.2.0).

## Hands-free

The page opens in **Student** mode, scored against the teacher reference (normally built into the app), or in
**Teacher** while there is no reference at all; pick
**Teacher** only to record or load a reference of your own. Each mode shows only its own panel and results. There is no calibration step: the teacher is the calibration. Each
take finds its own bow direction from its motion (the first stroke is a down-bow: start at the frog), and the
teacher's largest stroke is the full bow that bow use and speed (cm/s) are measured against, for both players.
Every teacher take is added to the reference pool; **Clear reference** (teacher panel) empties it to start a new
one. A student take is scored against the pool right away: 0-10 overall and per measure,
`10 / (1 + (z/3)²)`, z = how many teacher spreads worse than the teacher.

Every take ends with a result card: stroke count, average stroke time and speed, evenness, and the stroke shape
(speed over each stroke, with the average ± spread). A student card adds the score, the measures against the
teacher and the student's strokes overlaid on the teacher's shape.

After Connect the app is OFF and ignores motion (scrolling, adjusting). A flick (acceleration spike) turns it
ON (rising beeps; 1 s to settle). While ON, holding still (orientation within 1.5° for 2 s) gets ready (high
beep), moving starts a take, holding still again ends it (low, then falling beeps) and turns it OFF: one take per
ON. A flick mid-take also turns it OFF (falling beeps): the take in progress is kept up to 0.4 s before the flick, or dropped when it has
less than 1 s of motion (the flick itself). After either, flicks are ignored for at least 10 s and until the device has
been still for 2 s, so taking it off and laying it down can't turn it back on. The ON/OFF button does the same as the flick.

Motion slower than 1.5°/s can be mistaken for holding still (see `src/takes.js`).

## Reference files

**Save reference** downloads the teacher's reference (e.g. `son_file-reference-MARI-2026-10-18-1530.json`: the
per-stroke measures and stroke shapes of the pooled teacher takes, the teacher's full bow, and its stamp: the
**Teacher name** typed in the teacher panel and when it was recorded and saved). **Load reference…** replaces the current
one with such a file, so a teacher trains once and reuses it across students and sessions, or sends it to a
remote student. The reference also sets the **target stroke duration** students are held to and are shown: the teacher's
average stroke by default, or what the teacher sets with the **Target stroke** slider (2-60 s, kept in the file).
Detection follows that target too (with the teacher's full bow, the expected bow speed): a bow counts as moving
above 40% of the expected speed (at most 3 °/s), a take ends on a hold of 10% of a stroke (at least 2 s), and a
take may last 10 strokes (at least 3 min). So a 1-minute bow works: set the slider before recording it.
A curated file placed at `references/son_file.json` ships with the app and is used whenever the
browser has no reference of its own, so no teacher training is needed.

## Photos

Gesture card photos (Unsplash License, placeholders for prototyping): `images/sonfile.jpg` by Denny Müller
(https://unsplash.com/photos/a-woman-playing-a-violin-in-a-park-ptvPoez04A8), `images/shift.jpg` by Joel Timothy
(https://unsplash.com/photos/person-playing-violin-YY3ijZa2lGQ) and `images/bowchange.jpg` by Eric Soubeyrand de
Saint Prix (https://unsplash.com/photos/man-playing-violin-in-a-dark-moody-setting-MZzGIswK3pU).

## Layout

- `src/quat.js` quaternion / R(q) / yaw-only reset / gravity check (SPEC §3)
- `src/osc.js`, `src/device.js` OSC parsing and Web Bluetooth connection (one call per MUGIC)
- `src/takes.js` take detector (hold still / move / hold still); `src/flick.js` ON/OFF flick
- `src/recording.js` recording file (SPEC §10, one entry per device with its own timestamps)
- `src/exercises/sonfile.js` son filé (class C): analysis, calibration, scoring
- `index.html` menu (banner, Connect, gesture cards; each gesture opens in a frame sharing the connection)
- `src/hub.js` the shared connection; `sonfile/index.html` + `src/sonfile-app.js` the son filé page
- `src/plot.js`, `style.css` (mugicmotion.com look)

## Exercises

| Exercise | Class | MUGICs | Status |
|---|---|---|---|
| Son filé (forearm) | C | 1 | first version |
| Left-hand shift (back of left hand) | A | 1 | next |
| Bow change (right hand + forearm) | A/D | 2 | after two-device support |
| Shift who-led (left hand + forearm) | A | 2 | after two-device support |

Planned for PR #2, camera (optional, like the mic; video stays in the browser):
1. Video recorded with each take, replayed in sync with the plots; teacher vs student side by side per stroke.
2. Arm posture from in-browser pose tracking (MediaPipe Pose): elbow height, shoulder lift, upper-arm opening.
3. Later, research: bow geometry (sounding point, bow parallel to the bridge) with markers and a fixed camera.

Open on the device: which MUGIC axis lies along the forearm when strapped (`forearm_axis` in
`src/exercises/sonfile.js`, guessed as x). It sets which motion counts as tilt and which as off-plane.

## Device facts (firmware 2.2.x, verified against mugic-firmware)

- BNO055 in NDOF fusion mode (magnetometer on: yaw is absolute but unreliable indoors; use relative yaw).
- Default rate 50 Hz (`loop_delay` 20 ms); configurable down to 10 ms (100 Hz).
- Units: accel m/s², gyro °/s, Euler degrees; quaternion (w,x,y,z) scaled 1/2^14. Its direction (body→world or
  world→body) is not assumed: the son filé calibration measures it against the gyro (`calib.conj`).
- Default accel mode is `LINEAR_ACCEL`: `acc` is already gravity-free, in the body frame.
  The SPEC §3 gravity check (`R·a ≈ (0,0,±9.81)`) needs `RAW_ACCEL` mode.
- OSC float args: acc 0-2, euler 3-5, gyro 6-8, mag 9-11, quat 12-15, battery volts 16.
- Transport: UDP port 4000 (WiFi), or BLE notifications on service 0x5501, char 0x113B (firmware >= 2.2.0).
- Flick is not emitted by firmware; detect it from the accel energy spike
  (see `mugic-arcade/common/mugic.js` for the Web Bluetooth + OSC parsing code).
