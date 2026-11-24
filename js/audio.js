// Microphone capture, recording, and WAV encoding.

export async function openMic({ raw = false } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser can't record audio.");
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: raw
        ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        : { echoCancellation: true, noiseSuppression: true },
    });
  } catch (e) {
    throw new Error(e.name === "NotAllowedError"
      ? "Microphone access is blocked. Allow it in the address bar, then try again."
      : `Couldn't open the microphone (${e.message}).`);
  }
}

let sharedCtx;
export function audioContext() {
  sharedCtx ||= new (window.AudioContext || window.webkitAudioContext)();
  if (sharedCtx.state === "suspended") sharedCtx.resume();
  return sharedCtx;
}

export class Take {
  constructor(stream) {
    this.stream = stream;
    this.chunks = [];
    this.rec = new MediaRecorder(stream);
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.done = new Promise((resolve) => { this.rec.onstop = () => resolve(new Blob(this.chunks, { type: this.rec.mimeType })); });
    this.rec.start();
  }
  stop() {
    if (this.rec.state !== "inactive") this.rec.stop();
    this.stream.getTracks().forEach((t) => t.stop());
    return this.done;
  }
}

// Decode any recorded blob and re-encode as 16 kHz mono 16-bit WAV.
export async function toWav(blob, rate = 16000) {
  const decoded = await audioContext().decodeAudioData(await blob.arrayBuffer());
  const frames = Math.ceil(decoded.duration * rate);
  const off = new OfflineAudioContext(1, frames, rate);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const out = await off.startRendering();
  return encodeWav(out.getChannelData(0), rate);
}

export function encodeWav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

// Draws a scrolling level meter from an analyser.
export function drawMeter(canvas, analyser) {
  const ctx = canvas.getContext("2d");
  const dpr = devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  const data = new Float32Array(analyser.fftSize);
  const bars = [];
  let raf;
  const tick = () => {
    analyser.getFloatTimeDomainData(data);
    let peak = 0;
    for (const x of data) peak = Math.max(peak, Math.abs(x));
    bars.push(Math.min(1, peak * 1.6));
    const w = 4 * dpr, gap = 2 * dpr, max = Math.floor(canvas.width / (w + gap));
    while (bars.length > max) bars.shift();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#d8342c";
    bars.forEach((b, i) => {
      const h = Math.max(2 * dpr, b * canvas.height);
      ctx.fillRect(i * (w + gap), (canvas.height - h) / 2, w, h);
    });
    raf = requestAnimationFrame(tick);
  };
  tick();
  return () => cancelAnimationFrame(raf);
}

export const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
