import { createFrameClient, FRAME_MESSAGES, sanitizeChatGptUrl } from "./frame-client.js";
import { createContextController, CONTEXT_KEYS } from "./context-controller.js";

const FRAME_URL_KEY = "dichrome.mode2.chatGptFrameUrl";
const CHATGPT_ORIGINS = new Set(["https://chatgpt.com", "https://chat.openai.com"]);
const MAX_FRAME_LOADS_IN_WINDOW = 5;
const FRAME_LOAD_WINDOW_MS = 20000;
const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));
const frameClient = createFrameClient(elements.chatGptFrame);
const context = createContextController({ elements, frameClient, showStatus });
let loadGeneration = 0;
let statusTimer;
let navigationTimer;
let frameLoadsSinceReady = 0;
let documentsSinceReady = 0;
let recentFrameLoads = [];
let frameBlocked = false;
let frameDiagnostics = createFrameDiagnostics();

function createFrameDiagnostics() {
  return {
    startedAt: Date.now(), loadEvents: 0, bridgeReadyDocuments: 0, lastBridgeDocumentId: null,
    composerReadyEvents: 0, navigationType: "unavailable", responseStatus: null,
    framePolicyScope: "unavailable", reported: false
  };
}

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
window.addEventListener("message", (event) => {
  if (event.source !== elements.chatGptFrame.contentWindow || !CHATGPT_ORIGINS.has(event.origin)) return;
  const message = event.data;
  if (message?.type === "dichrome:mode2:bridge-ready" && typeof message.documentId === "string"
    && message.documentId.length > 0 && message.documentId.length <= 128) {
    if (message.documentId !== frameDiagnostics.lastBridgeDocumentId) {
      if (frameDiagnostics.lastBridgeDocumentId !== null && !frameBlocked) {
        beginConnection();
        startConnectionTimeout();
      }
      frameDiagnostics.lastBridgeDocumentId = message.documentId;
      frameDiagnostics.bridgeReadyDocuments += 1;
      documentsSinceReady += 1;
      if (documentsSinceReady >= MAX_FRAME_LOADS_IN_WINDOW && !frameBlocked) {
        stopReloadingFrame("repeated-documents");
      }
    }
  }
  if (message?.type === "dichrome:mode2:frame-diagnostic") {
    frameDiagnostics.navigationType = ["navigate", "reload", "back_forward", "prerender"].includes(message.navigationType)
      ? message.navigationType : "unavailable";
    frameDiagnostics.responseStatus = Number.isInteger(message.responseStatus)
      && message.responseStatus >= 100 && message.responseStatus <= 599 ? message.responseStatus : null;
  }
});

async function loadFrame() {
  frameBlocked = false;
  frameLoadsSinceReady = 0;
  documentsSinceReady = 0;
  recentFrameLoads = [];
  frameDiagnostics = createFrameDiagnostics();
  clearTimeout(navigationTimer);
  navigationTimer = null;
  frameClient.disconnect();
  const generation = beginConnection();
  try {
    const response = await sendRuntimeMessage("enable-chatgpt-frame-policy");
    if (!response.framePolicy?.enabled) throw new Error("ChatGPT could not be embedded. Try again or open the ChatGPT window.");
    frameDiagnostics.framePolicyScope = response.framePolicy.scope || "unavailable";
    const stored = await chrome.storage.local.get(FRAME_URL_KEY);
    if (generation !== loadGeneration) return;
    elements.chatGptFrame.src = sanitizeChatGptUrl(stored[FRAME_URL_KEY]) || "https://chatgpt.com/";
    startConnectionTimeout();
  } catch (error) {
    if (generation === loadGeneration) showFrameRecovery(error.message, "frame-policy-or-storage");
  }
}

async function checkReadiness(generation) {
  const deadline = Date.now() + 15000;
  while (generation === loadGeneration && Date.now() < deadline) {
    try {
      const result = await frameClient.request(FRAME_MESSAGES.PING, {}, 1000);
      if (generation !== loadGeneration) return;
      if (result.ready) {
        clearTimeout(navigationTimer);
        navigationTimer = null;
        frameLoadsSinceReady = 0;
        documentsSinceReady = 0;
        frameDiagnostics.composerReadyEvents += 1;
        setFrameStatus("Connected", "ready");
        elements.frameNotice.hidden = true;
        context.setFrameReady(true);
        return;
      }
    } catch { /* Navigation and sign-in can delay the composer bridge. */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

// Wait for each replacement document to load before accepting its composer handshake.
elements.chatGptFrame.addEventListener("load", () => {
  if (frameBlocked || !sanitizeChatGptUrl(elements.chatGptFrame.src)) return;
  frameDiagnostics.loadEvents += 1;
  const now = Date.now();
  recentFrameLoads = recentFrameLoads.filter((loadedAt) => now - loadedAt < FRAME_LOAD_WINDOW_MS);
  recentFrameLoads.push(now);
  frameLoadsSinceReady += 1;
  if (recentFrameLoads.length >= MAX_FRAME_LOADS_IN_WINDOW) {
    stopReloadingFrame();
    return;
  }
  const generation = beginConnection();
  startConnectionTimeout();
  void checkReadiness(generation);
});

function beginConnection() {
  const generation = ++loadGeneration;
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

function startConnectionTimeout() {
  if (navigationTimer) return;
  navigationTimer = setTimeout(() => {
    navigationTimer = null;
    if (frameBlocked || elements.frameStatus.dataset.state === "ready") return;
    if (frameLoadsSinceReady > 1) {
      stopReloadingFrame();
    } else {
      showFrameRecovery("ChatGPT did not finish loading. Try again or open it in a window.", "readiness-timeout");
    }
  }, 15000);
}

function stopReloadingFrame(reason = "repeated-loads") {
  frameBlocked = true;
  ++loadGeneration;
  clearTimeout(navigationTimer);
  navigationTimer = null;
  frameClient.disconnect();
  context.setFrameReady(false);
  elements.chatGptFrame.src = "about:blank";
  showFrameRecovery("ChatGPT repeatedly reloaded inside the sidebar. Try again; your captured context is still available.", reason);
}

function setFrameStatus(label, state) {
  elements.frameStatus.textContent = label;
  elements.frameStatus.dataset.state = state;
}

function showFrameRecovery(message, reason) {
  if (!frameDiagnostics.reported) {
    frameDiagnostics.reported = true;
    console.error(`[Dichrome Mode 2] ${JSON.stringify({
      reason,
      loadEvents: frameDiagnostics.loadEvents,
      bridgeReadyDocuments: frameDiagnostics.bridgeReadyDocuments,
      composerReadyEvents: frameDiagnostics.composerReadyEvents,
      navigationType: frameDiagnostics.navigationType,
      responseStatus: frameDiagnostics.responseStatus,
      framePolicyScope: frameDiagnostics.framePolicyScope,
      elapsedMs: Date.now() - frameDiagnostics.startedAt
    })}`);
  }
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
