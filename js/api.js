// Thin client for gen.pollinations.ai.
import { getKey } from "./auth.js";

const GEN = "https://gen.pollinations.ai";

export const MODELS = {
  transcribe: "openai/whisper-large-v3", // word timestamps
  coach: "google/gemini-3.8-flash",      // listens to the audio itself
  text: "google/gemini-3.8-flash",       // phrase generation
  tts: "openai/tts-1",
};

export class NeedsKeyError extends Error {
  constructor() { super("Connect your Pollinations account to use audio features."); }
}

async function request(path, init = {}, { needsKey = false } = {}) {
  const key = getKey();
  if (needsKey && !key) throw new NeedsKeyError();
  const headers = new Headers(init.headers || {});
  if (key) headers.set("Authorization", `Bearer ${key}`);
  const res = await fetch(GEN + path, { ...init, headers });
  if (res.status === 401) throw new NeedsKeyError();
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const j = await res.json();
      msg = j?.error?.message || j?.message || msg;
    } catch { /* not JSON */ }
    if (res.status === 402) msg = "Your Pollen balance or key budget is used up. Top up at enter.pollinations.ai.";
    throw new Error(msg);
  }
  return res;
}

export async function chat(messages, { model = MODELS.text, needsKey = false, temperature = 0.4 } = {}) {
  const res = await request("/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, temperature }),
  }, { needsKey });
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

// Pull the first JSON object out of a model reply (handles ```json fences).
export function parseJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The coach replied in an unexpected format. Try again.");
  return JSON.parse(text.slice(start, end + 1));
}

export async function transcribe(wavBlob, language) {
  const form = new FormData();
  form.append("file", wavBlob, "take.wav");
  form.append("model", MODELS.transcribe);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("timestamp_granularities[]", "segment");
  if (language) form.append("language", language);
  const res = await request("/v1/audio/transcriptions", { method: "POST", body: form }, { needsKey: true });
  const data = await res.json();
  return { text: (data.text || "").trim(), words: extractWords(data), duration: data.duration };
}

// Normalise the many shapes of word timing into [{word, start, end}].
function extractWords(data) {
  let words = data.words || (data.segments || []).flatMap((s) => s.words || []);
  if (words.length) {
    return words.map((w) => ({ word: (w.word ?? w.text ?? "").trim(), start: +w.start, end: +w.end }))
      .filter((w) => w.word);
  }
  // Only segment timing: spread each segment's time over its words.
  return (data.segments || []).flatMap((s) => {
    const parts = (s.text || "").trim().split(/\s+/).filter(Boolean);
    const step = (s.end - s.start) / Math.max(parts.length, 1);
    return parts.map((word, i) => ({ word, start: s.start + i * step, end: s.start + (i + 1) * step }));
  });
}

export async function speech(text, voice) {
  const res = await request("/v1/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODELS.tts, input: text, voice, response_format: "mp3" }),
  }, { needsKey: true });
  return res.blob();
}

export async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

// Ask an audio-capable model to listen to a WAV and answer as JSON.
export async function listen(wavBlob, prompt) {
  const data = await blobToBase64(wavBlob);
  const text = await chat([{
    role: "user",
    content: [
      { type: "text", text: prompt },
      { type: "input_audio", input_audio: { data, format: "wav" } },
    ],
  }], { model: MODELS.coach, needsKey: true, temperature: 0.3 });
  return parseJson(text);
}
