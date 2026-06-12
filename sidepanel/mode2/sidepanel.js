const CHATGPT_URL = "https://chatgpt.com/";
const CHATGPT_FRAME_LOAD_TIMEOUT_MS = 5000;
const SCREENSHOT_ACTION_RESET_MS = 10000;

const MESSAGE_TYPES = Object.freeze({
  CAPTURE_VISIBLE_TAB: "chatgpt-sidebar:capture-visible-tab",
  ENABLE_CHATGPT_FRAME_POLICY: "chatgpt-sidebar:enable-chatgpt-frame-policy",
  OPEN_CHATGPT_WINDOW: "chatgpt-sidebar:open-chatgpt-window"
});

const STORAGE_KEYS = Object.freeze({
  CHATGPT_FRAME_URL: "dichrome.mode2.chatGptFrameUrl",
  LATEST_NOTICE: "dichrome.mode2.latestNotice",
  LATEST_PROMPT: "dichrome.mode2.latestPrompt",
  LATEST_SCREENSHOT: "dichrome.mode2.latestScreenshot"
});

const elements = {
  captureScreenshot: document.getElementById("captureScreenshot"),
  chatGptFrame: document.getElementById("chatGptFrame"),
  contextualActions: document.getElementById("contextualActions"),
  copyPrompt: document.getElementById("copyPrompt"),
  copyScreenshot: document.getElementById("copyScreenshot"),
  downloadScreenshot: document.getElementById("downloadScreenshot"),
  openChatGptWindow: document.getElementById("openChatGptWindow"),
  reloadChatGptFrame: document.getElementById("reloadChatGptFrame"),
  frameStatus: document.getElementById("frameStatus"),
  statusBar: document.getElementById("statusBar"),
  statusText: document.getElementById("statusText")
};

let latestPrompt = null;
let latestScreenshot = null;
let chatGptFrameTimer = 0;
let screenshotActionResetTimer = 0;

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  void prepareAndLoadChatGptFrame();
  void loadState().catch((error) => {
    showLocalStatus(`Failed to load extension state: ${toErrorMessage(error)}`, "error");
  });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (!isCurrentStorageArea(areaName)) {
    return;
  }

  if (
    changes[STORAGE_KEYS.LATEST_PROMPT] ||
    changes[STORAGE_KEYS.LATEST_SCREENSHOT] ||
    changes[STORAGE_KEYS.LATEST_NOTICE]
  ) {
    void loadState().catch((error) => {
      showLocalStatus(`Failed to refresh extension state: ${toErrorMessage(error)}`, "error");
    });
  }
});

function bindEvents() {
  elements.openChatGptWindow.addEventListener("click", () => {
    void openChatGptWindow();
  });
  elements.reloadChatGptFrame.addEventListener("click", () => {
    void prepareAndLoadChatGptFrame();
  });
  elements.chatGptFrame.addEventListener("load", () => {
    window.clearTimeout(chatGptFrameTimer);
    setFrameStatus("Loaded", "loaded");
  });
  elements.captureScreenshot.addEventListener("click", () => {
    void captureScreenshot();
  });
  elements.copyPrompt.addEventListener("click", () => {
    void copyPrompt();
  });
  elements.copyScreenshot.addEventListener("click", () => {
    void copyScreenshot();
  });
  elements.downloadScreenshot.addEventListener("click", () => {
    downloadScreenshot();
  });
}

async function prepareAndLoadChatGptFrame() {
  setFrameStatus("Preparing", "loading");

  const response = await sendRuntimeMessage({
    type: MESSAGE_TYPES.ENABLE_CHATGPT_FRAME_POLICY
  });

  const framePolicy = response.framePolicy;
  if (!response.ok || !framePolicy?.enabled) {
    const message = framePolicy?.error || "ChatGPT frame-policy override is unavailable.";
    setFrameStatus("Policy blocked", "warning");
    showLocalStatus(message, "error");
    return;
  }

  if (framePolicy.error) {
    showLocalStatus(framePolicy.error, "warning");
  }

  await loadChatGptFrame();
}

async function loadChatGptFrame() {
  window.clearTimeout(chatGptFrameTimer);
  setFrameStatus("Loading", "loading");
  elements.chatGptFrame.src = await getChatGptFrameUrl();

  chatGptFrameTimer = window.setTimeout(() => {
    setFrameStatus("Check frame", "warning");
  }, CHATGPT_FRAME_LOAD_TIMEOUT_MS);
}

async function getChatGptFrameUrl() {
  const state = await getPersistentStorage().get(STORAGE_KEYS.CHATGPT_FRAME_URL);
  return sanitizeChatGptUrl(state[STORAGE_KEYS.CHATGPT_FRAME_URL]) || CHATGPT_URL;
}

function setFrameStatus(label, state) {
  elements.frameStatus.textContent = label;
  elements.frameStatus.dataset.state = state;
}

async function loadState() {
  const state = await getStorageArea().get([
    STORAGE_KEYS.LATEST_NOTICE,
    STORAGE_KEYS.LATEST_PROMPT,
    STORAGE_KEYS.LATEST_SCREENSHOT
  ]);

  latestPrompt = state[STORAGE_KEYS.LATEST_PROMPT] || null;
  latestScreenshot = state[STORAGE_KEYS.LATEST_SCREENSHOT] || null;

  renderNotice(state[STORAGE_KEYS.LATEST_NOTICE]);
  renderPrompt(latestPrompt);
  renderScreenshot(latestScreenshot);
}

function renderNotice(notice) {
  if (!notice) {
    elements.statusBar.dataset.kind = "";
    elements.statusText.textContent = "Ready.";
    return;
  }

  elements.statusBar.dataset.kind = notice.kind || "";
  elements.statusText.textContent = notice.message || "Ready.";
}

function renderPrompt(prompt) {
  const hasPrompt = Boolean(prompt?.prompt);
  elements.copyPrompt.classList.toggle("hidden", !hasPrompt);
  updateContextualActionsVisibility();
}

function renderScreenshot(screenshot) {
  const hasScreenshot = Boolean(screenshot?.dataUrl);
  elements.copyScreenshot.classList.toggle("hidden", !hasScreenshot);
  elements.downloadScreenshot.classList.toggle("hidden", !hasScreenshot);
  updateContextualActionsVisibility();

  window.clearTimeout(screenshotActionResetTimer);
  if (hasScreenshot) {
    screenshotActionResetTimer = window.setTimeout(hideScreenshotActions, SCREENSHOT_ACTION_RESET_MS);
  }
}

function hideScreenshotActions() {
  elements.copyScreenshot.classList.add("hidden");
  elements.downloadScreenshot.classList.add("hidden");
  updateContextualActionsVisibility();
}

function updateContextualActionsVisibility() {
  const hasVisibleContextualAction = [
    elements.copyPrompt,
    elements.copyScreenshot,
    elements.downloadScreenshot
  ].some((element) => !element.classList.contains("hidden"));

  elements.contextualActions.classList.toggle("hidden", !hasVisibleContextualAction);
}

async function openChatGptWindow() {
  const response = await sendRuntimeMessage({
    type: MESSAGE_TYPES.OPEN_CHATGPT_WINDOW
  });

  if (response.ok) {
    showLocalStatus("ChatGPT sidebar window opened.", "success");
  }
}

async function captureScreenshot() {
  const response = await sendRuntimeMessage({
    type: MESSAGE_TYPES.CAPTURE_VISIBLE_TAB,
    source: "side-panel"
  });

  if (response.ok) {
    showLocalStatus("Screenshot captured.", "success");
  }
}

async function copyPrompt() {
  try {
    if (!latestPrompt?.prompt) {
      showLocalStatus("No prompt is ready to copy.", "warning");
      return;
    }

    await navigator.clipboard.writeText(latestPrompt.prompt);
    showLocalStatus("Prompt copied. Paste it into ChatGPT.", "success");
  } catch (error) {
    showLocalStatus(`Could not copy prompt: ${toErrorMessage(error)}`, "error");
  }
}

async function copyScreenshot() {
  try {
    if (!latestScreenshot?.dataUrl) {
      showLocalStatus("No screenshot is ready to copy.", "warning");
      return;
    }

    if (!window.ClipboardItem) {
      showLocalStatus("This Chrome version does not expose image clipboard support here.", "warning");
      return;
    }

    const blob = await dataUrlToBlob(latestScreenshot.dataUrl);
    await navigator.clipboard.write([
      new ClipboardItem({
        [blob.type]: blob
      })
    ]);
    hideScreenshotActions();
    showLocalStatus("Screenshot copied. Paste it into ChatGPT.", "success");
  } catch (error) {
    showLocalStatus(`Could not copy screenshot: ${toErrorMessage(error)}`, "error");
  }
}

function downloadScreenshot() {
  if (!latestScreenshot?.dataUrl) {
    showLocalStatus("No screenshot is ready to download.", "warning");
    return;
  }

  const anchor = document.createElement("a");
  anchor.href = latestScreenshot.dataUrl;
  anchor.download = `chatgpt-sidebar-screenshot-${fileSafeTimestamp(
    latestScreenshot.createdAt
  )}.png`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  hideScreenshotActions();
  showLocalStatus("Screenshot download started.", "success");
}

async function sendRuntimeMessage(payload) {
  try {
    const response = await chrome.runtime.sendMessage(payload);
    if (!response?.ok) {
      throw new Error(response?.error || "Extension action failed.");
    }

    return response;
  } catch (error) {
    showLocalStatus(toErrorMessage(error), "error");
    return { ok: false };
  }
}

function showLocalStatus(message, kind) {
  elements.statusBar.dataset.kind = kind || "";
  elements.statusText.textContent = message;
}

function getStorageArea() {
  return chrome.storage.session || chrome.storage.local;
}

function getPersistentStorage() {
  return chrome.storage.local;
}

function isCurrentStorageArea(areaName) {
  if (chrome.storage.session) {
    return areaName === "session";
  }

  return areaName === "local";
}

function sanitizeChatGptUrl(value) {
  try {
    const url = new URL(value);

    if (url.protocol === "https:" && (url.hostname === "chatgpt.com" || url.hostname === "chat.openai.com")) {
      url.searchParams.delete("chatgpt_sidebar_reload");
      return url.href;
    }
  } catch (_error) {
    // Fall through to the default ChatGPT home URL.
  }

  return null;
}

async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return response.blob();
}

function fileSafeTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return Date.now();
  }

  return date.toISOString().replace(/[:.]/g, "-");
}

function toErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error || "Unknown error");
}
