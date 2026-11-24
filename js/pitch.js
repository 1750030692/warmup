// YIN pitch detection and note helpers. Pure functions, no DOM.

export function detectPitch(buf, rate, minF = 75, maxF = 1100) {
  const n = buf.length;
  let rms = 0;
  for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / n);
  if (rms < 0.012) return null;

  const maxTau = Math.min(Math.floor(rate / minF), Math.floor(n / 2));
  const minTau = Math.max(2, Math.floor(rate / maxF));
  const win = n - maxTau;
  const cmnd = new Float32Array(maxTau + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i < win; i++) {
      const d = buf[i] - buf[i + tau];
      sum += d * d;
    }
    running += sum;
    cmnd[tau] = running ? (sum * tau) / running : 1;
  }

  let tau = -1;
  for (let t = minTau; t <= maxTau; t++) {
    if (cmnd[t] < 0.15) {
      while (t + 1 <= maxTau && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return null;

  const a = cmnd[tau - 1], b = cmnd[tau], c = cmnd[tau + 1] ?? b;
  const denom = a + c - 2 * b;
  const shift = denom ? (a - c) / (2 * denom) : 0;
  return { freq: rate / (tau + shift), clarity: 1 - b, rms };
}

const NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
export const freqToMidi = (f) => 69 + 12 * Math.log2(f / 440);
export const midiToFreq = (m) => 440 * 2 ** ((m - 69) / 12);
export const noteName = (m) => `${NAMES[((Math.round(m) % 12) + 12) % 12]}${Math.floor(Math.round(m) / 12) - 1}`;

export const median = (xs) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Score sung pitch samples [{t, midi}] against target notes [{midi, start, end}].
// Octave errors are folded out (a tenor singing a soprano line still counts).
export function scoreTake(samples, targets) {
  const perNote = targets.map((n) => {
    const settle = Math.min(0.15, (n.end - n.start) * 0.25);
    const inNote = samples.filter((s) => s.t >= n.start + settle && s.t <= n.end);
    return { ...n, raw: inNote.map((s) => s.midi - n.midi) };
  });
  const all = perNote.flatMap((n) => n.raw);
  const octave = all.length ? Math.round(median(all) / 12) * 12 : 0;

  let inTune = 0, voiced = 0;
  const notes = perNote.map((n) => {
    const diffs = n.raw.map((d) => d - octave);
    voiced += diffs.length;
    inTune += diffs.filter((d) => Math.abs(d) <= 0.5).length;
    if (diffs.length < 3) return { midi: n.midi, cents: null, wobble: null, grade: "silent" };
    const cents = median(diffs) * 100;
    const wobble = Math.sqrt(diffs.reduce((s, d) => s + (d * 100 - cents) ** 2, 0) / diffs.length);
    const abs = Math.abs(cents);
    return { midi: n.midi, cents, wobble, grade: abs <= 25 ? "good" : abs <= 50 ? "near" : "off" };
  });

  const sung = notes.filter((n) => n.cents != null);
  return {
    notes,
    octave: octave / 12,
    inTunePct: voiced ? Math.round((100 * inTune) / voiced) : 0,
    lean: sung.length ? median(sung.map((n) => n.cents)) : 0,
    wobble: sung.length ? median(sung.map((n) => n.wobble)) : 0,
    sungCount: sung.length,
  };
}

// Summarise a free take with no target: range and steadiness of held notes.
export function describeFree(samples) {
  if (samples.length < 10) return null;
  const midis = samples.map((s) => s.midi).sort((a, b) => a - b);
  const lo = midis[Math.floor(midis.length * 0.05)];
  const hi = midis[Math.floor(midis.length * 0.95)];
  // Held notes: runs where pitch stays within a semitone for 0.3 s.
  const wobbles = [];
  let run = [samples[0]];
  for (const s of samples.slice(1)) {
    const prev = run[run.length - 1];
    if (s.t - prev.t < 0.08 && Math.abs(s.midi - run[0].midi) < 1) run.push(s);
    else { push(run); run = [s]; }
  }
  push(run);
  function push(r) {
    if (r.length < 2 || r[r.length - 1].t - r[0].t < 0.3) return;
    const m = r.reduce((a, s) => a + s.midi, 0) / r.length;
    wobbles.push(Math.sqrt(r.reduce((a, s) => a + ((s.midi - m) * 100) ** 2, 0) / r.length));
  }
  return { lo, hi, held: wobbles.length, wobble: wobbles.length ? median(wobbles) : null };
}
