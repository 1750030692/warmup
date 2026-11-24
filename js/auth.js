// Pollinations Pay (Bring Your Own Pollen): OAuth code flow with PKCE.
// Users authorize a temporary sk_ key that spends from their own balance.
// See https://github.com/pollinations/pollinations/blob/main/BRING_YOUR_OWN_POLLEN.md

const AUTH = "https://enter.pollinations.ai";

// Publishable App Key (pk_) registered at enter.pollinations.ai. It only
// identifies the app on the consent screen; it is safe to ship in frontend code.
export const APP_KEY = "pk_oIHjQHkVNpteJLKa";

const KEY_STORE = "warmup.key";
const PKCE_STORE = "warmup.pkce";

export const getKey = () => sessionStorage.getItem(KEY_STORE);
export function setKey(key) {
  if (key) sessionStorage.setItem(KEY_STORE, key);
  else sessionStorage.removeItem(KEY_STORE);
}

const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Must match the registered Redirect URI exactly, so /warmup/index.html
// is sent as /warmup/.
const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, "");

export async function login() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  sessionStorage.setItem(PKCE_STORE, JSON.stringify({ verifier, state }));

  const params = new URLSearchParams({
    response_type: "code",
    redirect_uri: redirectUri(),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "generate",
    budget: "2",
    expiry: "7",
  });
  if (APP_KEY) params.set("client_id", APP_KEY);
  location.href = `${AUTH}/authorize?${params}`;
}

// Call once on load. Returns the new key if this page load is the OAuth callback.
export async function handleRedirect() {
  // Legacy fragment flow, in case the server answers that way.
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get("api_key")) {
    setKey(hash.get("api_key"));
    history.replaceState(null, "", redirectUri() + location.search);
    return hash.get("api_key");
  }

  const query = new URLSearchParams(location.search);
  const code = query.get("code");
  const error = query.get("error");
  if (!code && !error) return null;
  history.replaceState(null, "", redirectUri());

  if (error) throw new Error(error === "access_denied" ? "Connection was cancelled." : `Connection failed: ${error}`);

  const saved = JSON.parse(sessionStorage.getItem(PKCE_STORE) || "null");
  sessionStorage.removeItem(PKCE_STORE);
  if (!saved || saved.state !== query.get("state")) {
    throw new Error("The login response didn't match this tab. Press Connect again.");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    code_verifier: saved.verifier,
  });
  if (APP_KEY) body.set("client_id", APP_KEY);

  const res = await fetch(`${AUTH}/api/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Couldn't finish connecting (${data.error_description || data.error || res.status}). Press Connect again.`);
  }
  setKey(data.access_token);
  return data.access_token;
}
