import { listen, NeedsKeyError } from "./api.js";
import { openMic, Take, toWav, audioContext } from "./audio.js";
import { detectPitch, freqToMidi, midiToFreq, noteName, scoreTake, describeFree } from "./pitch.js";

const PATTERNS = [
  { id: "scale5", name: "Five-note scale", steps: [0, 2, 4, 5, 7, 5, 4, 2, 0] },
  { id: "arp", name: "Major arpeggio", steps: [0, 4, 7, 12, 7, 4, 0] },
  { id: "thirds", name: "Thirds up and down", steps: [0, 4, 2, 5, 4, 7, 4, 2, 0] },
  { id: "octave", name: "Octave leap", steps: [0, 12, 7, 0], beats: [2, 2, 1, 2] },
  { id: "held", name: "One long note", steps: [0], beats: [6] },
  { id: "free", name: "Free singing, no target", free: true },
];
const FREE_MAX = 20;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function centsText(c) {
  const r = Math.round(c);
  if (Math.abs(r) <= 10) return "on pitch";
  return `${Math.abs(r)} ¢ ${r > 0 ? "sharp" : "flat"}`;
}

export function initSing({ say, needKey }) {
  const patternSel = $("sg-pattern"), rootSel = $("sg-root"), tempoSel = $("sg-tempo");
  const btn = $("sg-start"), phaseEl = $("sg-phase"), nowEl = $("sg-now"), canvas = $("sg-canvas");
  patternSel.innerHTML = PATTERNS.map((p) => `<option value="${p.id}">${p.name}</option>`).join("");
  const roots = [];
  for (let m = 43; m <= 67; m++) roots.push(m);
  rootSel.innerHTML = roots.map((m) => `<option value="${m}" ${m === 57 ? "selected" : ""}>${noteName(m)}${m === 48 ? " (low voices)" : m === 60 ? " (middle C)" : ""}</option>`).join("");

  let run = null;     // live session
  let last = null;    // last finished take: {targets, samples, wav, stats, free}

  const fail = (e) => (e instanceof NeedsKeyError ? needKey() : say(e.message, true));

  const pattern = () => PATTERNS.find((p) => p.id === patternSel.value);
  function buildTargets() {
    const p = pattern();
    if (p.free) return [];
    const beat = +tempoSel.value, root = +rootSel.value;
    let t = 0;
    return p.steps.map((s, i) => {
      const dur = beat * (p.beats?.[i] ?? 1);
      const n = { midi: root + s, start: t, end: t + dur };
      t += dur;
      return n;
    });
  }

  // Redraw the idle chart whenever the settings change.
  for (const el of [patternSel, rootSel, tempoSel]) el.onchange = () => { if (!run) { last = null; draw({ targets: buildTargets(), samples: [] }); } };
  new ResizeObserver(() => draw(run || last || { targets: buildTargets(), samples: [] })).observe(canvas);

  btn.onclick = () => (run ? stop() : start());

  async function start() {
    $("sg-result").hidden = true;
    let stream;
    try { stream = await openMic({ raw: true }); } catch (e) { return fail(e); }
    const ctx = audioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);

    const targets = buildTargets();
    const free = pattern().free;
    const beat = +tempoSel.value;
    const length = free ? FREE_MAX : targets[targets.length - 1].end;
    const t0 = ctx.currentTime + 0.35;
    const singStart = free ? t0 + beat * 2 : t0 + length + beat * 2;

    const voices = [];
    if (!free) targets.forEach((n) => voices.push(tone(ctx, n.midi, t0 + n.start, t0 + n.end - 0.04, 0.22)));
    voices.push(click(ctx, singStart - beat * 2), click(ctx, singStart - beat));
    if (!free && $("sg-guide").checked) targets.forEach((n) => voices.push(tone(ctx, n.midi, singStart + n.start, singStart + n.end - 0.04, 0.05)));

    run = { ctx, analyser, stream, source, voices, targets, free, length, t0, singStart, samples: [], take: null, buf: new Float32Array(analyser.fftSize) };
    btn.setAttribute("aria-pressed", "true");
    btn.querySelector(".rec-label").textContent = "Stop";
    say("");
    loop();
  }

  function loop() {
    const r = run;
    if (!r) return;
    const now = r.ctx.currentTime;
    if (now < r.singStart) {
      const listening = !r.free && now < r.t0 + r.length;
      phaseEl.innerHTML = listening ? "<strong>Listen.</strong> This is the pattern." : "<strong>Get ready…</strong>";
      r.head = listening ? now - r.t0 : null;
      r.mode = "listen";
    } else {
      if (!r.take) r.take = new Take(r.stream);
      const t = now - r.singStart;
      r.mode = "sing";
      r.head = t;
      phaseEl.innerHTML = r.free ? `<strong>Sing.</strong> Press Stop when you're done (up to ${FREE_MAX} s).` : "<strong>Your turn.</strong> Sing the pattern.";
      r.analyser.getFloatTimeDomainData(r.buf);
      const p = detectPitch(r.buf, r.ctx.sampleRate);
      if (p && p.clarity > 0.8) {
        const midi = freqToMidi(p.freq);
        r.samples.push({ t, midi });
        const target = r.targets.find((n) => t >= n.start && t < n.end);
        nowEl.textContent = target
          ? `${noteName(midi)}, ${centsText(foldedCents(midi, target.midi))} against ${noteName(target.midi)}`
          : noteName(midi);
      } else {
        nowEl.textContent = "–";
      }
      if (t > r.length + 0.4) return stop();
    }
    draw(r);
    r.raf = requestAnimationFrame(loop);
  }

  async function stop() {
    const r = run;
    if (!r) return;
    run = null;
    cancelAnimationFrame(r.raf);
    r.voices.forEach((v) => { try { v.stop(); } catch { /* already done */ } });
    r.source.disconnect();
    btn.setAttribute("aria-pressed", "false");
    btn.querySelector(".rec-label").textContent = "Start";
    nowEl.textContent = "–";

    if (!r.take) {
      r.stream.getTracks().forEach((t) => t.stop());
      phaseEl.textContent = "Stopped before your turn. Press start to try again.";
      draw({ targets: r.targets, samples: [] });
      return;
    }
    btn.disabled = true;
    phaseEl.textContent = "Scoring your take…";
    try {
      const wav = await toWav(await r.take.stop());
      const length = r.free ? (r.samples.at(-1)?.t ?? 0) + 0.3 : r.length;
      last = { targets: r.targets, samples: r.samples, wav, free: r.free, length };
      draw(last);
      renderResult(last);
      phaseEl.textContent = "Done. Press start for another go.";
    } catch (e) { fail(e); }
    btn.disabled = false;
  }

  function renderResult(take) {
    const url = URL.createObjectURL(take.wav);
    const audioEl = $("sg-audio");
    if (audioEl.src) URL.revokeObjectURL(audioEl.src);
    audioEl.src = url;
    const facts = [];
    const list = $("sg-notes");
    list.innerHTML = "";

    if (take.free) {
      const d = describeFree(take.samples);
      take.stats = d;
      if (!d) {
        facts.push(["–", "no clear singing picked up"]);
      } else {
        facts.push([`${noteName(d.lo)}–${noteName(d.hi)}`, "range you used"]);
        facts.push([d.held, d.held === 1 ? "held note" : "held notes"]);
        if (d.wobble != null) facts.push([`±${Math.round(d.wobble)} ¢`, "wobble on held notes"]);
      }
    } else {
      const s = scoreTake(take.samples, take.targets);
      take.stats = s;
      facts.push([`${s.inTunePct}%`, "of your singing within 50 ¢ of the target"]);
      if (s.sungCount) {
        facts.push([centsText(s.lean), "overall tendency"]);
        facts.push([`±${Math.round(s.wobble)} ¢`, "wobble within notes"]);
      }
      if (s.octave) facts.push([`${s.octave > 0 ? "+" : ""}${s.octave} oct`, "you sang in another octave, scored there"]);
      for (const n of s.notes) {
        const li = document.createElement("li");
        li.className = n.grade;
        li.innerHTML = `<b>${noteName(n.midi)}</b><span>${n.cents == null ? "not heard" : centsText(n.cents)}</span>`;
        list.append(li);
      }
    }
    list.hidden = take.free;
    list.previousElementSibling.hidden = take.free;
    $("sg-facts").innerHTML = facts.map(([b, s]) => `<div class="fact"><b>${esc(b)}</b><span>${esc(s)}</span></div>`).join("");
    $("sg-coach").innerHTML = `<button class="btn" id="sg-ask">Ask the coach about tone and breath</button>`;
    $("sg-ask").onclick = () => askCoach(take);
    $("sg-result").hidden = false;
  }

  async function askCoach(take) {
    const box = $("sg-coach");
    box.innerHTML = `<p class="muted">The coach is listening…</p>`;
    try {
      const n = await listen(take.wav, singPrompt(take));
      const tips = (n.tips || []).slice(0, 4).map((t) => `<li><span class="tag">${esc(t.area)}:</span> ${esc(t.tip)}</li>`).join("");
      box.innerHTML = `<p>${esc(n.overall)}</p>${tips ? `<ul>${tips}</ul>` : ""}${n.next ? `<p><span class="tag">Try next:</span> ${esc(n.next)}</p>` : ""}`;
    } catch (e) {
      box.innerHTML = `<button class="btn" id="sg-ask">Ask the coach again</button>`;
      $("sg-ask").onclick = () => askCoach(take);
      fail(e);
    }
  }

  function singPrompt(take) {
    const measured = take.free
      ? JSON.stringify(take.stats)
      : JSON.stringify({
        exercise: pattern().name,
        notes: take.stats.notes.map((n) => ({ target: noteName(n.midi), cents_off: n.cents == null ? null : Math.round(n.cents), wobble_cents: n.wobble == null ? null : Math.round(n.wobble) })),
        percent_within_50_cents: take.stats.inTunePct,
      });
    return `You are an encouraging, practical singing teacher. Listen to the attached recording of a student ${take.free ? "singing freely" : "singing a warm-up exercise"}.
A pitch tracker measured this (cents: positive = sharp): ${measured}
Trust these pitch numbers over your ear for intonation. Use your ear for tone quality, breath support, onsets, vowel shape, steadiness and confidence. Only mention problems you can actually hear or see in the numbers. Write in plain English, no jargon without a short explanation.

Reply with JSON only:
{"overall": "one or two sentences",
 "tips": [{"area": "Pitch | Tone | Breath | Vowels | Onset", "tip": "specific advice with a physical cue"}],
 "next": "one exercise or focus for the next take"}`;
  }

  // ---------- drawing ----------
  function draw(state) {
    const dpr = devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return;
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; }
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    const targets = state.targets || [];
    const samples = state.samples || [];
    const isFree = !targets.length;

    // Vertical range.
    let lo, hi;
    if (!isFree) {
      lo = Math.min(...targets.map((n) => n.midi)) - 4;
      hi = Math.max(...targets.map((n) => n.midi)) + 4;
    } else {
      const ms = samples.map((s) => s.midi);
      const mid = ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : +rootSel.value;
      lo = Math.min(mid - 9, ...ms) - 1;
      hi = Math.max(mid + 9, ...ms) + 1;
    }
    const left = 44, right = 10, top = 8, bottom = 8;
    const y = (m) => top + (hi - m) / (hi - lo) * (H - top - bottom);

    // Horizontal range.
    let span = isFree ? Math.max(8, (samples.at(-1)?.t ?? 0) + 1) : targets.at(-1).end + 0.4;
    if (state.length && isFree && !run) span = Math.max(state.length, 2);
    const x = (t) => left + (t / span) * (W - left - right);

    // Semitone lanes.
    g.font = `13px ${css("--body")}`;
    g.textBaseline = "middle";
    const targetSet = new Set(targets.map((n) => n.midi));
    for (let m = Math.ceil(lo); m <= Math.floor(hi); m++) {
      const isC = ((m % 12) + 12) % 12 === 0;
      g.strokeStyle = isC ? "#b5c3bb" : css("--lane");
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(left, y(m)); g.lineTo(W - right, y(m)); g.stroke();
      if (isC || targetSet.has(m)) {
        g.fillStyle = targetSet.has(m) ? css("--ink") : css("--ink-soft");
        g.fillText(noteName(m), 4, y(m));
      }
    }

    // Target bars.
    const laneH = (H - top - bottom) / (hi - lo);
    const t = state.head;
    for (const n of targets) {
      const active = t != null && t >= n.start && t < n.end;
      g.fillStyle = active ? (state.mode === "listen" ? "#9fb2a7" : "#14202b33") : "#14202b1f";
      roundRect(g, x(n.start) + 1, y(n.midi) - laneH * 0.42, x(n.end) - x(n.start) - 2, laneH * 0.84, 5);
    }

    // Your voice.
    const good = css("--good"), near = css("--near"), off = css("--off"), ink = css("--ink");
    g.lineWidth = 3;
    g.lineCap = "round";
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1], b = samples[i];
      if (b.t - a.t > 0.12) continue;
      const target = targets.find((n) => b.t >= n.start && b.t < n.end);
      let mb = b.midi, ma = a.midi;
      if (target) {
        const fold = Math.round((b.midi - target.midi) / 12) * 12;
        mb -= fold; ma -= fold;
        const c = Math.abs((mb - target.midi) * 100);
        g.strokeStyle = c <= 25 ? good : c <= 50 ? near : off;
      } else {
        g.strokeStyle = isFree ? ink : "#14202b66";
      }
      if (Math.abs(mb - ma) > 3) continue;
      g.beginPath(); g.moveTo(x(a.t), y(ma)); g.lineTo(x(b.t), y(mb)); g.stroke();
    }

    // Playhead.
    if (t != null && t >= 0) {
      g.strokeStyle = state.mode === "sing" ? css("--rec") : css("--ink-soft");
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(x(t), top); g.lineTo(x(t), H - bottom); g.stroke();
    }

    if (isFree && !samples.length) {
      g.fillStyle = css("--ink-soft");
      g.textAlign = "center";
      g.fillText("Your pitch will be drawn here as you sing.", W / 2, H / 2);
      g.textAlign = "start";
    }
  }

  draw({ targets: buildTargets(), samples: [] });
}

function foldedCents(midi, target) {
  const d = midi - target;
  return (d - Math.round(d / 12) * 12) * 100;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h);
  g.fill();
}

// Soft piano-ish tone for the reference pattern.
function tone(ctx, midi, start, end, level) {
  const osc = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc2.type = "sine";
  osc.frequency.value = midiToFreq(midi);
  osc2.frequency.value = midiToFreq(midi) * 2;
  const g2 = ctx.createGain();
  g2.gain.value = 0.25;
  osc.connect(gain);
  osc2.connect(g2).connect(gain);
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(level, start + 0.02);
  gain.gain.setTargetAtTime(level * 0.6, start + 0.05, 0.2);
  gain.gain.setTargetAtTime(0, end - 0.02, 0.02);
  osc.start(start); osc2.start(start);
  osc.stop(end + 0.15); osc2.stop(end + 0.15);
  return { stop: () => { osc.stop(); osc2.stop(); } };
}

function click(ctx, at) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 1500;
  gain.gain.setValueAtTime(0.2, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + 0.06);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + 0.07);
  return osc;
}
