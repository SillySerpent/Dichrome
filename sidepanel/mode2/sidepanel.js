const CHATGPT_URL = "https://chatgpt.com/";
const CHATGPT_FRAME_LOAD_TIMEOUT_MS = 5000;
const CHATGPT_FRAME_READY_TIMEOUT_MS = 12000;
const FRAME_SCREENSHOT_ATTACH_TIMEOUT_MS = 45000;
const RECENT_SCREENSHOT_AUTO_ATTACH_MS = 30000;
const SCREENSHOT_ACTION_RESET_MS = 10000;

const MESSAGE_TYPES = Object.freeze({
  CAPTURE_VISIBLE_TAB: "chatgpt-sidebar:capture-visible-tab",
  ENABLE_CHATGPT_FRAME_POLICY: "chatgpt-sidebar:enable-chatgpt-frame-policy",
  OPEN_CHATGPT_WINDOW: "chatgpt-sidebar:open-chatgpt-window"
});

const FRAME_MESSAGE_TYPES = Object.freeze({
  ATTACH_SCREENSHOT: "dichrome:mode2:attach-screenshot",
  ATTACH_SCREENSHOT_RESULT: "dichrome:mode2:attach-screenshot-result"
});

const CHATGPT_FRAME_ORIGINS = Object.freeze([
  "https://chatgpt.com",
  "https://chat.openai.com"
]);

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
  modeButton: document.getElementById("modeButton"),
  openChatGptWindow: document.getElementById("openChatGptWindow"),
  reloadChatGptFrame: document.getElementById("reloadChatGptFrame"),
  frameStatus: document.getElementById("frameStatus"),
  statusBar: document.getElementById("statusBar"),
  statusText: document.getElementById("statusText")
};

let latestPrompt = null;
let latestScreenshot = null;
let chatGptFrameTimer = 0;
let chatGptFrameLoaded = false;
let screenshotActionResetTimer = 0;
const autoAttachedScreenshotIds = new Set();
const autoAttachTasks = new Map();

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
    chatGptFrameLoaded = true;
    setFrameStatus("Loaded", "loaded");
    queueRecentScreenshotAttach(latestScreenshot);
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
  elements.modeButton?.addEventListener("click", () => {
    // Send message to parent (shell) to open mode settings
    window.parent.postMessage({ type: "mode-settings:open" }, "*");
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
  chatGptFrameLoaded = false;
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
  queueRecentScreenshotAttach(latestScreenshot);
}

function renderNotice(notice) {
  if (!notice) {
    setStatusMessage("Ready.", "");
    return;
  }

  if (shouldSuppressStoredScreenshotNotice(notice)) {
    return;
  }

  setStatusMessage(notice.message || "Ready.", notice.kind || "");
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

function showScreenshotActions() {
  if (!latestScreenshot?.dataUrl) {
    return;
  }

  elements.copyScreenshot.classList.remove("hidden");
  elements.downloadScreenshot.classList.remove("hidden");
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
  try {
    elements.captureScreenshot.disabled = true;
    showLocalStatus("Capturing screenshot...", "info");

    const response = await sendRuntimeMessage({
      type: MESSAGE_TYPES.CAPTURE_VISIBLE_TAB,
      source: "side-panel"
    });

    if (!response.ok) {
      return;
    }

    latestScreenshot = response.screenshot || null;
    renderScreenshot(latestScreenshot);
    await autoAttachScreenshot(response.screenshot);
  } finally {
    elements.captureScreenshot.disabled = false;
  }
}

function queueRecentScreenshotAttach(screenshot) {
  if (!shouldAutoAttachScreenshot(screenshot)) {
    return;
  }

  void autoAttachScreenshot(screenshot);
}

function shouldAutoAttachScreenshot(screenshot) {
  if (!screenshot?.dataUrl) {
    return false;
  }

  const screenshotId = getScreenshotAttachId(screenshot);
  if (autoAttachedScreenshotIds.has(screenshotId) || autoAttachTasks.has(screenshotId)) {
    return false;
  }

  const createdAt = Date.parse(screenshot.createdAt || "");
  if (!Number.isFinite(createdAt)) {
    return false;
  }

  return Date.now() - createdAt <= RECENT_SCREENSHOT_AUTO_ATTACH_MS;
}

async function autoAttachScreenshot(screenshot) {
  if (!screenshot?.dataUrl) {
    showLocalStatus("No screenshot is ready to attach.", "warning");
    return {
      attached: false
    };
  }

  const screenshotId = getScreenshotAttachId(screenshot);
  if (autoAttachedScreenshotIds.has(screenshotId)) {
    return {
      attached: true
    };
  }

  const activeTask = autoAttachTasks.get(screenshotId);
  if (activeTask) {
    return activeTask;
  }

  const task = attachScreenshotTask(screenshot, screenshotId);
  autoAttachTasks.set(screenshotId, task);

  try {
    return await task;
  } finally {
    autoAttachTasks.delete(screenshotId);
  }
}

async function attachScreenshotTask(screenshot, screenshotId) {
  showLocalStatus("Attaching screenshot to ChatGPT...", "info");

  try {
    await waitForChatGptFrameReady();
    await attachScreenshotToChatGptFrame(screenshot);
    autoAttachedScreenshotIds.add(screenshotId);
    hideScreenshotActions();
    showLocalStatus("Screenshot attached to ChatGPT.", "success");

    return {
      attached: true
    };
  } catch (error) {
    showScreenshotActions();
    showLocalStatus(`Screenshot captured, but ChatGPT did not accept it: ${toErrorMessage(error)}`, "error");

    return {
      attached: false,
      error
    };
  }
}

function waitForChatGptFrameReady() {
  if (chatGptFrameLoaded && elements.chatGptFrame.contentWindow) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("ChatGPT frame did not finish loading."));
    }, CHATGPT_FRAME_READY_TIMEOUT_MS);

    function handleLoad() {
      cleanup();
      resolve();
    }

    function cleanup() {
      window.clearTimeout(timeoutId);
      elements.chatGptFrame.removeEventListener("load", handleLoad);
    }

    elements.chatGptFrame.addEventListener("load", handleLoad, {
      once: true
    });
  });
}

function attachScreenshotToChatGptFrame(screenshot) {
  const targetWindow = elements.chatGptFrame.contentWindow;
  if (!targetWindow) {
    return Promise.reject(new Error("ChatGPT frame is unavailable."));
  }

  const targetOrigins = getChatGptFrameTargetOrigins();
  if (!targetOrigins.length) {
    return Promise.reject(new Error("ChatGPT frame URL is not an allowed attachment target."));
  }

  const requestId = createId();
  const payload = {
    type: FRAME_MESSAGE_TYPES.ATTACH_SCREENSHOT,
    requestId,
    screenshot
  };

  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for ChatGPT to accept the screenshot."));
    }, FRAME_SCREENSHOT_ATTACH_TIMEOUT_MS);

    function handleFrameMessage(event) {
      if (event.source !== targetWindow || !targetOrigins.includes(event.origin)) {
        return;
      }

      const message = event.data;
      if (message?.type !== FRAME_MESSAGE_TYPES.ATTACH_SCREENSHOT_RESULT || message.requestId !== requestId) {
        return;
      }

      cleanup();

      if (message.ok) {
        resolve(message);
        return;
      }

      reject(new Error(message.error || "ChatGPT did not accept the screenshot."));
    }

    function cleanup() {
      window.clearTimeout(timeoutId);
      window.removeEventListener("message", handleFrameMessage);
    }

    window.addEventListener("message", handleFrameMessage);
    for (const origin of targetOrigins) {
      targetWindow.postMessage(payload, origin);
    }
  });
}

function getChatGptFrameTargetOrigins() {
  const origins = new Set(CHATGPT_FRAME_ORIGINS);
  const frameOrigin = getAllowedChatGptOrigin(elements.chatGptFrame.src);

  if (frameOrigin) {
    origins.delete(frameOrigin);
    return [frameOrigin, ...origins];
  }

  return Array.from(origins);
}

function getAllowedChatGptOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && (url.hostname === "chatgpt.com" || url.hostname === "chat.openai.com")) {
      return url.origin;
    }
  } catch (_error) {
    // Ignore malformed iframe URLs.
  }

  return "";
}

function shouldSuppressStoredScreenshotNotice(notice) {
  return notice?.message === "Visible screenshot captured."
    && latestScreenshot?.dataUrl
    && autoAttachedScreenshotIds.has(getScreenshotAttachId(latestScreenshot));
}

function getScreenshotAttachId(screenshot) {
  return String(screenshot?.id || `${screenshot?.createdAt || ""}:${screenshot?.dataUrl?.length || 0}`);
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
  setStatusMessage(message, kind);
}

function setStatusMessage(message, kind) {
  const label = message || "Ready.";
  elements.statusBar.dataset.kind = kind || "";
  elements.statusText.textContent = label;
  elements.statusBar.classList.toggle("is-empty", label === "Ready." && !kind);
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

function createId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error || "Unknown error");
}
