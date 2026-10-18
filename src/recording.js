// Recording file (SPEC §10) with one entry per device, so a second MUGIC can be added later. Each device keeps
// its own timestamps (seconds from the first sample) because two devices' streams aren't synchronized.
// extra.mic_rms, when present, has one value per sample of devices[0].

export function newRecording(meta, devices) {
  return {
    device: 'mugic', rate_hz: 50, labels: [], created: new Date().toISOString(), ...meta,
    devices: devices.map(({ id, mount }) => ({ id, mount, t: [], q: [], gyro: [], accel: [] })),
    extra: {},
  };
}

// Append a sample to device i; returns its time in seconds from the recording's first sample.
export function addSample(rec, i, now, s) {
  rec.t0 ??= now;
  const d = rec.devices[i], t = now - rec.t0;
  d.t.push(+t.toFixed(4)); d.q.push(s.q); d.gyro.push(s.gyro); d.accel.push(s.acc);
  return t;
}

// Hand the viewer a JSON file to save.
export function download(name, data) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function save(rec) {
  const { t0, ...data } = rec;
  download(`${rec.exercise}-${rec.role}-${rec.created.replace(/[:.]/g, '-')}.json`, data);
}
