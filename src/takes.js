// Takes within an ON session: holding a pose arms the detector ("ready"); moving starts a take, which includes
// preroll_s of the hold before the motion; holding a pose again ends it, and that hold arms the next take.
// "Held" means the orientation stays within still_deg for hold_s, measured on the quaternion rather than on |ω|
// so that a very slow bow doesn't count as still. A bow change passes back through the same orientation, so
// motion slower than 2·still_deg/hold_s (1.5°/s by default) can still look held.
// stop(tCut) ends the session (the OFF flick): a take in progress keeps its samples up to tCut, or is cancelled
// when it has less than min_take_s of motion (it was the flick itself).
import { DEG, geodesic, normalize } from './quat.js';

export function takeDetector({ still_deg = 1.5, hold_s = 2, preroll_s = 1, max_s = 40, min_take_s = 1 } = {}, onEvent) {
  let state = 'waiting', anchor = null, recent = [], take = null, moveT = 0;
  return {
    feed(sample, t) {
      const q = normalize(sample.q);
      if (!anchor || geodesic(q, anchor.q) * DEG > still_deg) anchor = { q, t };
      const held = t - anchor.t >= hold_s;
      recent.push({ t, sample });
      recent = recent.filter(r => t - r.t <= preroll_s);

      if (state === 'waiting' && held) {
        state = 'ready'; onEvent('ready');
      } else if (state === 'ready' && anchor.t === t) {
        state = 'moving'; take = [...recent]; moveT = t; onEvent('start');
      } else if (state === 'moving') {
        take.push({ t, sample });
        if (held || t - take[0].t > max_s) {
          state = held ? 'ready' : 'waiting';
          onEvent('end', take); take = null;
          if (held) onEvent('ready');
        }
      }
    },
    stop(tCut) {
      if (state === 'moving') {
        if (tCut - moveT >= min_take_s) onEvent('end', take.filter(r => r.t <= tCut));
        else onEvent('cancel');
      }
      state = 'off'; take = null;
    },
  };
}
