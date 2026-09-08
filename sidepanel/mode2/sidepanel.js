import { createFrameClient, FRAME_MESSAGES, sanitizeChatGptUrl } from "./frame-client.js";
import { createContextController, CONTEXT_KEYS } from "./context-controller.js";

const FRAME_URL_KEY = "dichrome.mode2.chatGptFrameUrl";
const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));
const frameClient = createFrameClient(elements.chatGptFrame);
const context = createContextController({ elements, frameClient, showStatus });
let loadGeneration = 0;
let statusTimer;
let navigationTimer;

async function sendRuntimeMessage(type, values = {}) {
  const response = await chrome.runtime.sendMessage({ type: `chatgpt-sidebar:${type}`, ...values });
  if (!response?.ok) throw new Error(response?.error || "Dichrome could not complete this action.");
  return response;
}

function showStatus(message = "", kind = "") {
  clearTimeout(statusTimer);
  elements.statusText.textContent = message;
  elements.statusBar.dataset.kind = kind;
  elements.statusBar.classList.toggle("is-empty", !message);
  if (kind === "success") statusTimer = setTimeout(() => showStatus(), 8000);
}

function bindAction(id, action) {
  elements[id].addEventListener("click", async () => {
    elements[id].disabled = true;
    elements.toolsMenu.open = false;
    try { await action(); }
    catch (error) { showStatus(error.message || String(error), "error"); }
    finally { elements[id].disabled = false; }
  });
}

async function openFallback() {
  await sendRuntimeMessage("open-chatgpt-window");
  showStatus("ChatGPT window opened. Use Copy to bring your context with you.", "success");
}

bindAction("openChatGptWindow", openFallback);
bindAction("openFallback", openFallback);
bindAction("reloadChatGptFrame", loadFrame);
bindAction("retryFrame", loadFrame);
bindAction("captureScreenshot", async () => {
  showStatus("Capturing the visible page…", "info");
  await sendRuntimeMessage("capture-visible-tab", { source: "side-panel" });
  await context.refresh();
});
bindAction("modeButton", () => {
  window.parent.postMessage({ type: "mode-settings:open" }, location.origin);
});
elements.dismissStatus.addEventListener("click", () => showStatus());
document.addEventListener("pointerdown", (event) => {
  if (!elements.toolsMenu.contains(event.target)) elements.toolsMenu.open = false;
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (elements.toolsMenu.open) {
    elements.toolsMenu.open = false;
    elements.toolsMenu.querySelector("summary").focus();
  } else if (!elements.contextPanel.hidden) {
    context.setOpen(false);
    elements.contextToggle.focus();
  }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== (chrome.storage.session ? "session" : "local")) return;
  if ([CONTEXT_KEYS.prompt, CONTEXT_KEYS.screenshot, CONTEXT_KEYS.notice].some((key) => key in changes)) {
    void context.refresh().catch((error) => showStatus(`Could not refresh context: ${error.message}`, "error"));
  }
});

async function loadFrame() {
  frameClient.disconnect();
  const generation = beginConnection();
  try {
    const response = await sendRuntimeMessage("enable-chatgpt-frame-policy");
    if (!response.framePolicy?.enabled) throw new Error("ChatGPT could not be embedded. Try again or open the ChatGPT window.");
    const stored = await chrome.storage.local.get(FRAME_URL_KEY);
    if (generation !== loadGeneration) return;
    elements.chatGptFrame.src = sanitizeChatGptUrl(stored[FRAME_URL_KEY]) || "https://chatgpt.com/";
    navigationTimer = setTimeout(() => {
      if (generation === loadGeneration) showFrameRecovery("ChatGPT did not finish loading. Try again or open it in a window.");
    }, 15000);
  } catch (error) {
    if (generation === loadGeneration) showFrameRecovery(error.message);
  }
}

async function checkReadiness(generation) {
  const deadline = Date.now() + 15000;
  while (generation === loadGeneration && Date.now() < deadline) {
    try {
      const result = await frameClient.request(FRAME_MESSAGES.PING, {}, 1000);
      if (generation !== loadGeneration) return;
      if (result.ready) {
        setFrameStatus("Connected", "ready");
        elements.frameNotice.hidden = true;
        context.setFrameReady(true);
        return;
      }
    } catch { /* Navigation and sign-in can delay the composer bridge. */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (generation === loadGeneration) showFrameRecovery("Sign in to ChatGPT below, or open it in a window. Your captured context is still available.");
}

// Wait for each replacement document to load before accepting its composer handshake.
elements.chatGptFrame.addEventListener("load", () => {
  if (!sanitizeChatGptUrl(elements.chatGptFrame.src)) return;
  const generation = beginConnection();
  void checkReadiness(generation);
});

function beginConnection() {
  const generation = ++loadGeneration;
  clearTimeout(navigationTimer);
  context.setFrameReady(false);
  frameClient.cancel();
  elements.frameNotice.hidden = false;
  elements.frameNotice.classList.remove("is-warning");
  elements.loadingIndicator.hidden = false;
  elements.frameRecovery.hidden = true;
  elements.frameNoticeTitle.textContent = "Connecting to ChatGPT";
  elements.frameNoticeText.textContent = "Your conversation will appear here.";
  setFrameStatus("Connecting", "loading");
  return generation;
}

function setFrameStatus(label, state) {
  elements.frameStatus.textContent = label;
  elements.frameStatus.dataset.state = state;
}

function showFrameRecovery(message) {
  setFrameStatus("Needs attention", "warning");
  elements.frameNotice.hidden = false;
  elements.frameNotice.classList.add("is-warning");
  elements.loadingIndicator.hidden = true;
  elements.frameRecovery.hidden = false;
  elements.frameNoticeTitle.textContent = "ChatGPT needs a moment";
  elements.frameNoticeText.textContent = message;
}

void loadFrame();
void context.refresh().catch((error) => showStatus(`Could not load context: ${error.message}`, "error"));
