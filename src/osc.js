// MUGIC OSC packet -> sample. Float args: acc xyz, euler xyz, gyro xyz, mag xyz, quat wxyz, battery volts
// (the int state of charge before the volts is skipped). Units: m/s² (gravity-free in LINEAR_ACCEL mode), °/s.

export function parseOsc(view) {
  const str = off => {
    let end = off;
    while (end < view.byteLength && view.getUint8(end)) ++end;
    let s = '';
    for (let i = off; i < end; ++i) s += String.fromCharCode(view.getUint8(i));
    return [s, (end + 4) & ~3];
  };
  let [, off] = str(0);
  let tags;
  [tags, off] = str(off);
  const floats = [];
  for (const t of tags.slice(1)) {
    if (off + 4 > view.byteLength) break;
    if (t === 'f') floats.push(view.getFloat32(off, false));
    off += 4;
  }
  return floats;
}

export function toSample(f) {
  if (f.length < 16) return null;
  return { acc: f.slice(0, 3), euler: f.slice(3, 6), gyro: f.slice(6, 9), q: f.slice(12, 16), volts: f[16] ?? null };
}
