// Flick: a spike of acceleration energy | |a|² - baseline | above thresh (as in mugic-arcade). The baseline
// follows |a|² slowly while below the threshold, so it works with linear (gravity-free) or raw accel. Fires once
// per spike: re-armed when the energy drops below half the threshold and cooldown_s has passed.
export function flickDetector({ thresh = 60, cooldown_s = 0.25 } = {}) {
  let base = null, armed = true, last = -Infinity;
  return (acc, t) => {
    const e2 = acc[0] * acc[0] + acc[1] * acc[1] + acc[2] * acc[2];
    base ??= e2;
    const energy = Math.abs(e2 - base);
    if (energy < thresh) base += 0.02 * (e2 - base);
    if (armed && energy >= thresh && t - last > cooldown_s) { armed = false; last = t; return true; }
    if (energy < thresh / 2) armed = true;
    return false;
  };
}
