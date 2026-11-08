export function parseTime(v) {
  if (typeof v === "number") return v;
  const s = String(v || "").trim().toLowerCase().replace(/s|秒/g, '');
  if (s.includes('分')) return parseInt(s, 10) * 60;
  if (s.includes(':')) {
    const p = s.split(':').map(Number);
    return p.length === 2 ? p[0] * 60 + p[1] : NaN;
  }
  if (s.includes('.')) {
    const p = s.split('.').map(Number);
    return p.length === 2 ? p[0] * 60 + p[1] : NaN;
  }
  const val = Number(s);
  return isNaN(val) ? 0 : val;
}

export function formatTime(s) {
  if (isNaN(s) || s < 0) return "00:00";
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
