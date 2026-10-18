# MUGIC Gesture Coach: Seed Spec for Claude Code

## 1. Goal

A general framework for learning **any** gesture from a few reference performances, then scoring new attempts against it, diagnosing specific defects, and giving gamified feedback. All input comes from the MUGIC IMU (optionally plus phone mic or camera as a secondary channel).

The framework is gesture-agnostic. Each gesture is described by a small **exercise config** (section 6) that selects the segmentation mode, features, scoring method and defect checks. Violin shifts and sons filés (section 9) are worked examples, not the scope.

Existing context: the arcade games (Space Invaders, Bowling, Sokoban, Pole Position, etc.) already use MUGIC as a controller. **Reuse the existing quaternion / rotation-matrix / gravity-removal code.** Ask the user where it lives before writing new versions.

## 2. Signal assumptions

- Sampling: 50 Hz (Nyquist 25 Hz, 20 ms resolution).
- Channels: accelerometer (body frame), gyroscope (confirm units), quaternion (w,x,y,z) or Euler angles.
- **Use the quaternion stream, never Euler, for scoring** (Euler wraps at ±180° and gimbal-locks near ±90° pitch).
- No magnetometer assumed, so yaw drifts. Always use relative yaw.
- Window length is per exercise: 0.3 s (one shift) to 20 s+ (slow bow). The arcade games used 2-5 s.

## 3. Math conventions (must be exact)

- Normalize every quaternion on input: `q ← q/|q|`. Check `RᵀR ≈ I`, `|det R − 1| < 1e-3`.
- Rotation matrix from unit quaternion (body → world):

```
R = [[1-2(y²+z²), 2(xy-wz),   2(xz+wy)],
     [2(xy+wz),   1-2(x²+z²), 2(yz-wx)],
     [2(xz-wy),   2(yz+wx),   1-2(x²+y²)]]
```

- **Convention check at startup:** device at rest, `R·a_body` should be ≈ (0,0,±9.81). If gravity lands on the wrong axis or has the wrong sign, use `Rᵀ`. Store the result in config.
- Sign continuity: flip q so `q_i · q_{i-1} ≥ 0` along each series (q and −q are the same rotation).
- Geodesic angle between orientations: `2·acos(min(1, |q1·q2|))`.
- **Reference reset is yaw-only:** `R_rel(t) = R_yaw0ᵀ · R(q(t))`. Extract yaw0 from the device forward axis projected onto the horizontal plane: `atan2(y, x)`. If the projection length is < 0.1 (pointing near vertical), fall back to another axis or require a neutral start pose. Do not cancel the starting tilt, so pitch and roll stay tied to gravity.
- Linear acceleration: `a_world = R(q)·a_body − g`, using the absolute quaternion before the reference reset.

## 4. Gesture space (three tiers)

**Do not double-integrate accelerometer data into position.** At 50 Hz on a MEMS part, 0.05 m/s² bias gives about 0.23 m error after 3 s, which equals the signal size.

| Tier | Quantities | Trust |
|---|---|---|
| 1. Angular | `q_rel`, pointing vector `v(t)=R_rel·[0,0,1]`, roll, `\|ω\|`, `d\|ω\|/dt` | Full |
| 2. Linear accel | `a_world` peak timing, magnitude, jerk | Shape and timing only. Velocity only if start and end are at rest (force `v(0)=v(T)=0`, remove linear drift) |
| 3. Pseudo-position | `p(t)=R_rel·[0,0,L]`, L ≈ 0.5 m (configurable, rigid-arm model) | Good: error is L × orientation error (1° ≈ 9 mm) |

Also define normalized progress `s(t)`: cumulative angular path length of the pointing vector, scaled to 0-1.

## 5. Gesture taxonomy (drives every design choice)

Classify each target gesture first. The class determines segmentation, alignment method and defect checks.

| Class | Description | Segmentation | Scoring method | Typical defects |
|---|---|---|---|---|
| **A. Discrete point-to-point** | One motion between two rests | Stillness → motion → stillness (hysteresis on `\|ω\|`) | DTW to DBA template, warp kept as timing measurement | Overshoot/undershoot, hesitation (multiple velocity peaks), landing correction, wrong plane |
| **B. Cyclic / rhythmic** | Repeated oscillation | Period detection (autocorrelation or zero crossings of the dominant axis) | Per-cycle features and spectral stats, not DTW (a cycle can be only 7-10 samples) | Rate off-target, rate drift, amplitude irregularity, period jitter, asymmetry |
| **C. Sustained / slow continuous** | Long controlled motion where evenness is the quality | Start/stop by motion thresholds or user trigger | Profile statistics over the middle 80%: CV of speed, deviation from straight path, tilt std | Speed unevenness, drift off plane, jerky turnarounds, wrong duration |
| **D. Ballistic / impulsive** | Fast stroke with an impact or release | Peak-aligned: anchor on max `\|a\|` or max `\|ω\|`, window ±N samples | Peak-aligned template, compare pre-impact ramp, peak value, follow-through | Weak or early peak, short follow-through, wrong plane at impact |
| **E. Multi-stroke pattern** | Sequence of strokes forming a shape | Segment at direction reversals or accel peaks (beats) | DTW on the pointing path projected to the pattern plane, plus beat-timing | Wrong shape, uneven beat spacing, size drift, wrong plane |
| **F. Static hold / posture** | Hold a pose or limb position | Stillness windows | Deviation from target orientation (geodesic), drift rate, tremor band power (4-12 Hz) | Drift, sag, tremor, wrong target angle |

Notes:
- **Sample rate limits:** anything above about 12 Hz fundamental or with impacts shorter than 20 ms is marginal at 50 Hz. Flag such exercises as "weak fit" in the config.
- Some exercises combine classes (a violin practice phrase is a sequence of class A shifts plus class C bows). Support a **segment sequence** in the config.

## 6. Exercise config (one per gesture)

```yaml
name: violin_shift_1_to_3
class: A                 # A-F from the taxonomy
mount: back_of_hand
window_s: [0.3, 3.0]     # accept range for segment duration
segmentation:            # parameters depend on class
  still_omega_dps: 5
  start_omega_dps: 15
  still_min_s: 0.25
features: [s, omega, pointing]
alignment: dtw           # dtw | peak | cycle | stats
band_frac: 0.15
amplitude_normalized: false
tempo_mandatory: false
tolerances: {extent_pct: 20, duration_ratio: [0.75, 1.33]}
defects: [overshoot, hesitation, landing_correction, shaky]
extra_sensors: []        # e.g. [mic_rms_envelope]
```

All thresholds in this spec are starting guesses. They are fixed from recorded data, not by assumption.

## 7. Modules

### M1: Recorder and segmenter
- Record raw streams plus metadata (mount, exercise, labels) to disk. Raw data is immutable.
- Segmentation strategy per class (section 5). Default for class A: stillness `|ω| < 5°/s` for ≥ 0.25 s (12 samples); motion starts at `|ω| > 15°/s` (hysteresis).
- Optional start trigger: a flick event.
- **Plot `|ω|` for about 20 recorded reps before fixing thresholds.** They depend on device mounting.

### M2: Template builder
- Class A/E: resample segments to 100 points on normalized time, keep true duration as a separate feature, DTW with Sakoe-Chiba band (default ±15%), template via DBA, per-timestep std as tolerance envelope with a floor. Prefer ≥ 10 reference reps (5 minimum).
- Class B: template = distributions of rate, amplitude and period jitter over cycles, plus a mean single-cycle shape.
- Class C: template = target statistics (speed CV, straightness, duration range) from a teacher recording.
- Class D: peak-aligned mean waveform plus peak value distribution.
- Class F: target orientation (geodesic mean) plus allowed drift and tremor power.
- Do not normalize amplitude by default: extent is part of quality.

### M3: Sample rejection (two passes, rebuild template between)
Reject a reference sample if any holds (class A example):
- Duration ratio outside 0.75-1.33 of the median.
- Warp path deviates > 15% of duration from the diagonal (band edge hit).
- Residual after alignment > 3σ of the accepted set.
- Total angular extent > 20% from the median.

### M4: Scorer and diagnostics
Overall score: alignment cost (normalized by path length) divided by the typical inter-reference distance → "N sigmas from ideal" → 0-100. For non-DTW classes, use the mean of per-feature |z| scores.

Each defect is a signed z-score against the reference distribution, flagged at |z| > 2. Examples:

| Defect | Feature |
|---|---|
| Overreach / underreach | Total angular extent, peak-to-peak amplitude per axis |
| Too slow / fast | Duration ratio, or rate for class B |
| Rushed or lagging mid-gesture | Slope of DTW warp path by segment |
| Shaky | RMS jerk after time normalization (class F: tremor band power) |
| Wrong plane | Cross-axis energy (roll leaking into pitch) |
| Hesitation | Number of velocity peaks > 1 |
| Landing correction | Reversal of `s(t)` in last 10% |
| Irregular rhythm | CV of period (class B, E) |
| Drift | Slope of orientation error over time (class F) |

Timing is **reported separately from shape**. Duration and warp slope are coaching information, not errors, unless `tempo_mandatory: true`.

Threshold calibration: record deliberately flawed reps (too big, too slow, shaky) and confirm the features separate them. A learned classifier only becomes worthwhile once there is data from many users.

### M5: Feedback and gamification (user is a visual learner)
- Ghost trace: template pseudo-position path with the live attempt overlaid, colored by local error.
- Per-axis radar chart of where points were lost.
- Velocity-profile overlay (attempt vs template envelope).
- Class-specific views: rate meter with target band (B), peak-aligned waveform overlay (D), beat-timing ticks (E), orientation target ring with drift trace (F).
- Difficulty = tolerance multiplier on the envelope.
- Streaks, plus one coaching line, e.g. "Pitch overshot 18%, 0.4 s too slow."

## 8. Application catalog (variety of gestures worth supporting)

Fit: S strong, G good, M medium, W weak at 50 Hz IMU alone.

**Music**
| Gesture | Class | Fit | Notes |
|---|---|---|---|
| Violin shift | A | G | Hand-back mount; intonation at landing not observable |
| Son filé / long bow | C | G | Needs mic RMS envelope for loudness evenness |
| Violin vibrato | B | S | 5-7 Hz; rate, width, regularity |
| Détaché / martelé | A or D | G | Timing and accel-peak shape |
| Spiccato / staccato | D | W | Bounce rate near the limit |
| Conducting patterns | E | S | Beat shape, size, tempo steadiness |
| Drum stick strokes / rudiments | D | M | Peak timing; double-stroke rolls too fast |
| Guitar strumming | B | G | Rate regularity, accent pattern |
| Wind/brass posture, piano wrist | F | M | Drift and tension (tremor band) |
| Expressive control of music software | A, E | S | Gesture vocabulary for MUGIC plugins |

**Sport**
| Gesture | Class | Fit | Notes |
|---|---|---|---|
| Golf swing | A + D | G | Tempo ratio (backswing:downswing), plane, impact peak |
| Tennis / baseball / cricket swing | A + D | G | Same structure |
| Boxing / martial-arts strikes | D | M | Peak and follow-through |
| Kata / tai chi / yoga flows | A, C, E | S | Slow and smooth, ideal fit |
| Rowing / cycling stroke | B | G | Cadence regularity |
| Throwing (javelin, shot put) | A + D | M | Release too fast for 50 Hz |

**Rehabilitation and ergonomics**
| Gesture | Class | Fit | Notes |
|---|---|---|---|
| Shoulder / wrist range-of-motion reps | A | S | Extent, smoothness, compensation |
| Balance and posture holds | F | G | Drift and sway |
| Tremor monitoring | F | M | Band power 4-12 Hz at 50 Hz is fine |
| Lifting form | A | M | Plane and speed |

**Skill and interaction**
| Gesture | Class | Fit | Notes |
|---|---|---|---|
| Air handwriting / shape drawing | E | M | Pointing-path projection |
| Calligraphy / brush control | C, E | M | Needs finer sensing than pseudo-position |
| Surgical or lab technique drills | A, C | M | Smoothness, economy of motion |
| Dance phrases | A, E | G | Phrase shape and timing |
| Game input recognition (arcade, existing) | A, D | S | Same segmenter, discrete classification |

## 9. Worked examples

### 9.1 Violin shifts (class A)
- Protocol: flick to start, then shift / complete stillness / shift. Each motion between stillness periods is one sample.
- Timing varies (about 0.9-1.1 s); shape matters. DTW absorbs timing, duration reported separately.
- A clean shift has a bell-shaped velocity profile: peak at normalized time about 0.4-0.5, one peak, low skew. Verify against data.
- Mount on the back of the hand: forearm mounting hides finger-only shifts.

### 9.2 Sons filés (class C)
- Mount on the bow-arm forearm just above the wrist. Capture window about 20 s.
- Calibration: record one slow full bow (frog to tip); normalized `s(t)` defines bow position; speed = `ds/dt` × bow length.
- Metrics (middle 80% of stroke unless noted):
  - Speed constancy: CV of `ds/dt`.
  - Straightness: RMS yaw deviation from start, degrees.
  - Tilt stability: std of roll.
  - Turnaround: RMS jerk in ±0.3 s around the direction change.
  - Duration: actual vs target (e.g. 8 s ± 0.5).
  - Loudness evenness (phone mic): CV of RMS envelope.
- Not observable by the IMU: bow pressure and contact point. The mic envelope is the proxy.
- Thresholds come from the gap between a teacher recording and a beginner recording.

## 10. Data format

One JSON (or Parquet) file per recording:
```
{ "device": "mugic", "rate_hz": 50, "mount": "back_of_hand",
  "exercise": "<config name>", "class": "A",
  "labels": ["good" | "too_slow" | "overreach" | ...],
  "performer": "<id>", "role": "reference" | "attempt",
  "t": [...], "q": [[w,x,y,z],...], "gyro": [[...]], "accel": [[...]],
  "extra": { "mic_rms": [...] } }
```
Derived features are computed on load and cached. Raw files are never modified.

## 11. Implementation notes

- Python + NumPy/SciPy for the prototype. Pure NumPy DTW is fine (about 62k cells for 250 samples, about 1M for 1000).
- Core prototype (class A only): 200-300 lines for record, template, score, diagnose, plus a live ghost-trace display. Other classes add one alignment/feature plugin each.
- Design for plugins: `segment()`, `features()`, `align()`, `defects()` per class, selected by the config.
- Start with one performer recording and replaying their own template. Add teacher-to-student mode later (inter-person variance is large).
- Unit tests required for: quaternion normalization and sign flipping, R(q) orthonormality, yaw-only reset (pitch/roll preserved), gravity check, segmenter on synthetic data, DTW recovering a known time warp, cycle detector on a synthetic 6 Hz sine at 50 Hz.

## 12. Milestones

1. Inspect the existing arcade code. Reuse its quaternion, R(q) and gravity removal.
2. Recorder, loader, plots of `|ω|` (confirm thresholds with the user).
3. Class A pipeline: segmenter, template, rejection, scoring (violin shifts as test case).
4. Diagnostics with deliberately flawed reps.
5. Live ghost-trace UI.
6. Class C (son filé, with mic envelope) and class B (vibrato) plugins.
7. Remaining classes (D, E, F) driven by the application the user picks next.

## 13. Questions to ask the user first

- Where is the existing quaternion/gravity code?
- Gyro units, and does the device report quaternion body→world or world→body?
- Is a flick event emitted by firmware, or detected from accel?
- Display target: desktop window, browser, or the existing arcade framework?
- Which gesture class and application first, and where will the device be mounted?
