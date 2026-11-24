import { getKey, setKey, login, handleRedirect } from "./auth.js";
import { initSpeak } from "./speak.js";
import { initSing } from "./sing.js";

const statusEl = document.getElementById("status");
function say(msg, isError = false) {
  statusEl.textContent = msg || "";
  statusEl.classList.toggle("error", !!isError);
}

function renderAccount() {
  const box = document.getElementById("account");
  if (getKey()) {
    box.innerHTML = `<span class="who">Connected to Pollinations</span><button class="link" id="disconnect">Disconnect</button>`;
    document.getElementById("disconnect").onclick = () => { setKey(null); renderAccount(); };
  } else {
    box.innerHTML = `<button class="link" id="paste-key">Use an API key</button><button class="btn primary" id="connect">Connect Pollinations</button>`;
    document.getElementById("connect").onclick = () => login();
    document.getElementById("paste-key").onclick = () => {
      const dlg = document.getElementById("key-dialog");
      const input = document.getElementById("key-input");
      input.value = "";
      dlg.returnValue = "";
      dlg.showModal();
      dlg.onclose = () => {
        if (dlg.returnValue === "ok" && input.value.trim().startsWith("sk_")) {
          setKey(input.value.trim());
          renderAccount();
          say("Key saved for this tab.");
        } else if (dlg.returnValue === "ok") {
          say("That doesn't look like a secret key. It should start with sk_.", true);
        }
      };
    };
  }
}

function needKey() {
  say("Recording analysis and voices are paid from your Pollen balance. Press Connect Pollinations to sign in.", true);
  document.getElementById("connect")?.focus();
}

// Tabs
const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute("aria-selected", on);
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
  }
  history.replaceState(null, "", `#${tab.id.replace("tab-", "")}`);
  window.dispatchEvent(new Event("resize"));
}
tabs.forEach((t, i) => {
  t.onclick = () => selectTab(t);
  t.onkeydown = (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    selectTab(next);
    next.focus();
  };
});

try {
  if (await handleRedirect()) say("Connected. Usage is paid from your Pollen balance.");
} catch (e) {
  say(e.message, true);
}
renderAccount();
initSpeak({ say, needKey });
initSing({ say, needKey });
if (location.hash === "#sing") selectTab(document.getElementById("tab-sing"));
