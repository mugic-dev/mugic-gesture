// Minimal canvas line plot. series: [{ y, x?, color, band?: [lo[], hi[]] }]; bounds default to the data's.
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function plot(canvas, series, { xmin, xmax, ymin, ymax } = {}) {
  const dpr = devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  const xs = s => s.x ?? s.y.map((_, i) => i);
  const all = series.flatMap(s => [...s.y, ...(s.band ? [...s.band[0], ...s.band[1]] : [])]).filter(Number.isFinite);
  const allX = series.flatMap(xs);
  if (!all.length) return;
  xmin ??= Math.min(...allX); xmax ??= Math.max(...allX);
  ymin ??= Math.min(0, ...all); ymax ??= Math.max(...all);
  const X = v => (v - xmin) / (xmax - xmin || 1) * w, Y = v => h - 4 - (v - ymin) / (ymax - ymin || 1) * (h - 8);
  g.strokeStyle = css('--grid'); g.lineWidth = 1;
  if (ymin < 0 && ymax > 0) { g.beginPath(); g.moveTo(0, Y(0)); g.lineTo(w, Y(0)); g.stroke(); }
  for (const s of series) {
    const x = xs(s), color = css(s.color);
    if (s.band) {
      g.beginPath();
      x.forEach((xi, i) => g.lineTo(X(xi), Y(s.band[1][i])));
      for (let i = x.length - 1; i >= 0; --i) g.lineTo(X(x[i]), Y(s.band[0][i]));
      g.globalAlpha = 0.2; g.fillStyle = color; g.fill(); g.globalAlpha = 1;
    }
    g.beginPath(); g.strokeStyle = color; g.lineWidth = 1.5;
    x.forEach((xi, i) => g.lineTo(X(xi), Y(s.y[i])));
    g.stroke();
  }
}
