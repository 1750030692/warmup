import { chat, transcribe, speech, listen, NeedsKeyError } from "./api.js";
import { openMic, Take, toWav, audioContext, drawMeter, fmtTime } from "./audio.js";
import { tokenize, displayTokens, align } from "./align.js";
import { PHRASES } from "./phrases.js";
import { getKey } from "./auth.js";

export const LANGUAGES = [
  ["en", "English"], ["es", "Spanish"], ["fr", "French"], ["de", "German"], ["it", "Italian"],
  ["pt", "Portuguese"], ["nl", "Dutch"], ["ja", "Japanese"], ["zh", "Chinese (Mandarin)"],
  ["ko", "Korean"], ["hi", "Hindi"], ["ar", "Arabic"], ["ru", "Russian"], ["tr", "Turkish"],
];
const langName = (code) => LANGUAGES.find(([c]) => c === code)?.[1] ?? code;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function initSpeak({ say, needKey }) {
  const lang = $("sp-lang"), level = $("sp-level"), voice = $("sp-voice"), text = $("sp-text");
  const recBtn = $("sp-rec"), timer = $("sp-timer"), audioEl = $("sp-audio");
  lang.innerHTML = LANGUAGES.map(([c, n]) => `<option value="${c}">${n}</option>`).join("");

  let take = null, stopMeter = null, clock = null, busy = false;
  let lastUrl = null;

  const fail = (e) => (e instanceof NeedsKeyError ? needKey() : say(e.message, true));

  // Switching language loads a built-in phrase in that language.
  lang.onchange = () => { text.value = PHRASES[lang.value]?.[0] ?? ""; };

  $("sp-new").onclick = async () => {
    const btn = $("sp-new");
    // Without a key, rotate through the built-in phrases instead of generating.
    if (!getKey()) {
      const list = PHRASES[lang.value] || [];
      const i = list.indexOf(text.value.trim());
      text.value = list[(i + 1) % list.length] ?? "";
      say("Connect Pollinations to get fresh phrases written for your level.");
      return;
    }
    btn.disabled = true;
    say("Writing a new phrase…");
    try {
      const out = await chat([{
        role: "system",
        content: "You write short phrases for pronunciation practice. Reply with the phrase only, no quotes, no translation.",
      }, {
        role: "user",
        content: `One ${level.value} ${langName(lang.value)} sentence for speaking practice, 8 to 16 words, natural and everyday, with a few sounds learners find tricky. Make it different from: "${text.value}"`,
      }]);
      text.value = out.trim().replace(/^["“'«]|["”'»]$/g, "");
      say("");
    } catch (e) { fail(e); }
    btn.disabled = false;
  };

  $("sp-listen").onclick = async () => {
    const btn = $("sp-listen");
    btn.disabled = true;
    say("Getting audio…");
    try {
      const blob = await speech(text.value.trim(), voice.value);
      const a = new Audio(URL.createObjectURL(blob));
      await a.play();
      say("");
    } catch (e) { fail(e); }
    btn.disabled = false;
  };

  recBtn.onclick = () => (take ? finish() : start());

  async function start() {
    if (busy) return;
    if (!text.value.trim()) return say("Type or generate a phrase first.", true);
    try {
      const stream = await openMic();
      const ctx = audioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      stopMeter = drawMeter($("sp-meter"), analyser);
      take = new Take(stream);
      const t0 = performance.now();
      clock = setInterval(() => {
        const s = (performance.now() - t0) / 1000;
        timer.textContent = fmtTime(s);
        if (s > 60) finish();
      }, 200);
      recBtn.setAttribute("aria-pressed", "true");
      recBtn.querySelector(".rec-label").textContent = "Stop";
      say("Recording. Read the phrase, then press Stop.");
    } catch (e) { fail(e); }
  }

  async function finish() {
    const current = take;
    take = null;
    clearInterval(clock);
    stopMeter?.();
    recBtn.setAttribute("aria-pressed", "false");
    recBtn.querySelector(".rec-label").textContent = "Record";
    recBtn.disabled = true;
    busy = true;
    try {
      const raw = await current.stop();
      const wav = await toWav(raw);
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      lastUrl = URL.createObjectURL(wav);
      audioEl.src = lastUrl;
      await analyse(wav);
    } catch (e) { fail(e); }
    recBtn.disabled = false;
    busy = false;
  }

  async function analyse(wav) {
    const target = text.value.trim();
    const code = lang.value;
    say("Transcribing your take…");
    const heard = await transcribe(wav, code);
    renderTranscript(target, heard, code);
    $("sp-result").hidden = false;
    $("sp-coach").innerHTML = `<p class="muted">The coach is listening to your recording…</p>`;
    say("Listening for pronunciation…");
    try {
      const notes = await listen(wav, coachPrompt(target, heard.text, code, level.value));
      renderCoach(notes);
      say("");
    } catch (e) {
      $("sp-coach").innerHTML = `<p class="muted">Coach notes didn't load: ${esc(e.message)}</p>`;
      say("");
    }
    $("sp-result").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }

  function renderTranscript(target, heard, code) {
    const tTok = tokenize(target, code);
    const tShow = displayTokens(target, code);
    const hTok = heard.words.length ? heard.words.flatMap((w) => tokenize(w.word, code)) : tokenize(heard.text, code);
    // Map each heard token back to its timing.
    const hTime = heard.words.length
      ? heard.words.flatMap((w) => tokenize(w.word, code).map(() => w))
      : [];
    const hShow = hTok;
    const ops = align(tTok, hTok);

    const matched = ops.filter((o) => o.type === "ok").length;
    const close = ops.filter((o) => o.type === "close").length;
    const accuracy = tTok.length ? Math.round((100 * (matched + close * 0.5)) / tTok.length) : 0;

    const words = $("sp-words");
    words.innerHTML = "";
    for (const op of ops) {
      const timing = op.heard != null ? hTime[op.heard] : null;
      let el;
      if (op.type === "miss") {
        el = span("miss", tShow[op.target]);
        el.title = "Not heard";
      } else if (op.type === "extra") {
        el = timing ? button("extra", hShow[op.heard], timing) : span("extra", hShow[op.heard]);
        el.title = "You added this";
      } else {
        const cls = op.type === "ok" ? "ok" : "close";
        el = timing ? button(cls, tShow[op.target], timing) : span(cls, tShow[op.target]);
        if (op.type !== "ok") {
          el.title = `Heard “${hShow[op.heard]}”`;
          const s = document.createElement("small");
          s.textContent = `(${hShow[op.heard]})`;
          el.append(s);
          if (op.type === "sub") el.className = "w miss";
        }
      }
      words.append(el, " ");
    }

    $("sp-heard").textContent = heard.text || "Nothing was recognised. Check that the right microphone is selected.";

    const facts = [[`${accuracy}%`, "of words came through"]];
    if (heard.words.length > 1) {
      const first = heard.words[0].start, last = heard.words[heard.words.length - 1].end;
      const mins = Math.max(last - first, 0.5) / 60;
      const wpm = Math.round(heard.words.length / mins);
      if (!/^(ja|zh)$/.test(code)) facts.push([wpm, "words per minute"]);
      const pauses = heard.words.slice(1).filter((w, i) => w.start - heard.words[i].end > 0.6).length;
      facts.push([pauses, pauses === 1 ? "long pause" : "long pauses"]);
    }
    $("sp-facts").innerHTML = facts.map(([b, s]) => `<div class="fact"><b>${esc(b)}</b><span>${esc(s)}</span></div>`).join("");
  }

  function span(cls, text) {
    const el = document.createElement("span");
    el.className = `w ${cls}`;
    el.textContent = text ?? "";
    return el;
  }

  function button(cls, text, timing) {
    const el = document.createElement("button");
    el.className = `w ${cls}`;
    el.type = "button";
    el.textContent = text ?? "";
    el.onclick = () => {
      audioEl.currentTime = Math.max(0, timing.start - 0.15);
      audioEl.play();
      const stopAt = timing.end + 0.15;
      const check = () => { if (audioEl.currentTime >= stopAt) { audioEl.pause(); audioEl.removeEventListener("timeupdate", check); } };
      audioEl.addEventListener("timeupdate", check);
    };
    return el;
  }

  function renderCoach(n) {
    const items = (n.pronunciation || []).slice(0, 5).map((p) =>
      `<li><span class="tag">${esc(p.word)}</span>: ${esc(p.issue)} <em>${esc(p.tip)}</em></li>`).join("");
    $("sp-coach").innerHTML = `
      <p>${esc(n.overall)}</p>
      ${items ? `<ul>${items}</ul>` : ""}
      ${n.fluency ? `<p><span class="tag">Rhythm and pace:</span> ${esc(n.fluency)}</p>` : ""}
      ${n.next ? `<p><span class="tag">Try next:</span> ${esc(n.next)}</p>` : ""}`;
  }
}

function coachPrompt(target, heard, code, level) {
  return `You are a warm, precise ${langName(code)} pronunciation coach. A ${level} learner was asked to read aloud:
"${target}"
A speech recogniser heard: "${heard}"

Listen to the attached recording yourself. Judge pronunciation (individual sounds, stress, intonation) and fluency (pace, pauses, linking). Be specific about sounds, e.g. "the 'th' in 'the' came out as 'd'; touch your tongue to your top teeth". Don't invent problems: if a word sounded fine, leave it out. Write feedback in English.

Reply with JSON only:
{"overall": "one or two sentences on how it went",
 "pronunciation": [{"word": "word from the phrase", "issue": "what you heard", "tip": "how to fix it"}],
 "fluency": "one sentence on rhythm, pace and pauses",
 "next": "one concrete thing to practise on the next try"}`;
}
