# MUGIC Gesture

Learn a gesture from a few reference performances with a MUGIC IMU, then score new attempts,
diagnose defects and give visual feedback. Standalone app (not part of mugic-arcade).
See [SPEC.md](SPEC.md) for the design.

## Run

    npm start        # python3 -m http.server 8000, then open http://localhost:8000 in Chrome or Edge
    npm test         # node --test (Node 20+), no dependencies

Web Bluetooth needs Chrome/Edge and a secure origin (`localhost` counts). The MUGIC must be in BLE output mode
(firmware >= 2.2.0).

## Hands-free

After Connect, nothing is pressed while playing. Holding still (orientation within 1.5° for 2 s) gets ready
(high beep); moving starts a take; holding still again ends it (low beep). The first take is the calibration
(one slow full down-bow, frog to tip), the next becomes the reference, later ones are scored attempts. Motion
slower than 1.5°/s can be mistaken for holding still (see `src/takes.js`).

## Layout

- `src/quat.js` quaternion / R(q) / yaw-only reset / gravity check (SPEC §3)
- `src/osc.js`, `src/device.js` OSC parsing and Web Bluetooth connection (one call per MUGIC)
- `src/takes.js` hands-free take detector
- `src/recording.js` recording file (SPEC §10, one entry per device with its own timestamps)
- `src/exercises/sonfile.js` son filé (class C): analysis, calibration, scoring
- `src/app.js`, `src/plot.js`, `index.html`, `style.css` UI

## Exercises

| Exercise | Class | MUGICs | Status |
|---|---|---|---|
| Son filé (forearm) | C | 1 | first version |
| Left-hand shift (back of left hand) | A | 1 | next |
| Bow change (right hand + forearm) | A/D | 2 | after two-device support |
| Shift who-led (left hand + forearm) | A | 2 | after two-device support |

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
