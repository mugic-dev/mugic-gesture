// Microphone loudness: RMS of the latest audio frame, read once per IMU sample. Automatic gain is off so the
// envelope reflects the player, not the browser.
export async function openMic() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const ctx = new AudioContext(), an = ctx.createAnalyser();
  an.fftSize = 2048;
  ctx.createMediaStreamSource(stream).connect(an);
  const buf = new Float32Array(an.fftSize);
  return {
    rms() {
      an.getFloatTimeDomainData(buf);
      let s = 0;
      for (const v of buf) s += v * v;
      return Math.sqrt(s / buf.length);
    },
    close() { stream.getTracks().forEach(t => t.stop()); ctx.close(); },
  };
}
