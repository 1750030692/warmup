// Align target words with transcribed words (edit distance on word lists).

const SPACELESS = /^(ja|zh|th)$/;

export function tokenize(text, lang) {
  const clean = text.toLowerCase().normalize("NFKC");
  if (SPACELESS.test(lang)) return [...clean.replace(/[^\p{L}\p{N}]/gu, "")];
  return clean.split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")).filter(Boolean);
}

// Display tokens keep original casing/punctuation, one per tokenize() token.
export function displayTokens(text, lang) {
  if (SPACELESS.test(lang)) return [...text.normalize("NFKC")].filter((c) => /[\p{L}\p{N}]/u.test(c));
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
}

function charSimilarity(a, b) {
  if (a === b) return 1;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n, 1);
}

// Returns ops: {type: "ok"|"close"|"sub"|"miss"|"extra", target?: i, heard?: j}
export function align(target, heard) {
  const m = target.length, n = heard.length;
  const sim = (i, j) => charSimilarity(target[i], heard[j]);
  const cost = (i, j) => { const s = sim(i, j); return s === 1 ? 0 : s >= 0.6 ? 0.5 : 1.2; };
  const D = Array.from({ length: m + 1 }, (_, i) => {
    const row = new Float64Array(n + 1);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= n; j++) D[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + cost(i - 1, j - 1));
    }
  }
  const ops = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + cost(i - 1, j - 1)) {
      const s = sim(i - 1, j - 1);
      ops.push({ type: s === 1 ? "ok" : s >= 0.6 ? "close" : "sub", target: i - 1, heard: j - 1 });
      i--; j--;
    } else if (i > 0 && D[i][j] === D[i - 1][j] + 1) {
      ops.push({ type: "miss", target: i - 1 });
      i--;
    } else {
      ops.push({ type: "extra", heard: j - 1 });
      j--;
    }
  }
  return ops.reverse();
}
