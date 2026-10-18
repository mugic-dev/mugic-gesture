# MUGIC Gesture

Learn a gesture from a few reference performances with a MUGIC IMU, then score new attempts,
diagnose defects and give visual feedback. Standalone app (not part of mugic-arcade).
See [SPEC.md](SPEC.md) for the design.

## Device facts (firmware 2.2.x, verified against mugic-firmware)

- BNO055 in NDOF fusion mode (magnetometer on: yaw is absolute but unreliable indoors; use relative yaw).
- Default rate 50 Hz (`loop_delay` 20 ms); configurable down to 10 ms (100 Hz).
- Units: accel m/s², gyro °/s, Euler degrees; quaternion (w,x,y,z) scaled 1/2^14, sensor→earth.
- Default accel mode is `LINEAR_ACCEL`: `acc` is already gravity-free, in the body frame.
  The SPEC §3 gravity check (`R·a ≈ (0,0,±9.81)`) needs `RAW_ACCEL` mode.
- OSC float args: acc 0-2, euler 3-5, gyro 6-8, mag 9-11, quat 12-15, battery volts 16.
- Transport: UDP port 4000 (WiFi), or BLE notifications on service 0x5501, char 0x113B (firmware >= 2.2.0).
- Flick is not emitted by firmware; detect it from the accel energy spike
  (see `mugic-arcade/common/mugic.js` for the Web Bluetooth + OSC parsing code).
