import {
  CHATGPT_HOME_URL,
  OFFSCREEN_MESSAGES
} from "../../shared/contracts.js";

const HOST_TARGET = "offscreen-automation-host";
const HOST_CLASS = "firefox-automation-host";
const FRAME_ID = "firefoxChatGptAutomationFrame";
const FRAME_TITLE = "Assistant automation host";

export function createFirefoxAutomationHost({
  documentRef = document,
  runtime = chrome.runtime,
  setTimeoutRef = window.setTimeout,
  now = () => new Date().toISOString()
} = {}) {
  let frame = null;
  let frameLoaded = false;
  let frameFailed = false;
  let failureReason = "";
  let loadCount = 0;
  let lastLoadedAt = null;
  let lastFailedAt = null;
  let lastReloadedAt = null;
  let bridgeConnected = false;
  let lastBridgeConnectedAt = null;
  let lastBridgeDisconnectedAt = null;
  let bridgeFrame = null;
  let framePolicy = null;

  function register() {
    runtime.onMessage.addListener(handleRuntimeMessage);
  }

  function handleRuntimeMessage(message, _sender, sendResponse) {
    if (message?.type === OFFSCREEN_MESSAGES.HOST_PROBE) {
      ensureFrame(sanitizeChatGptUrl(message.url) || CHATGPT_HOME_URL);
      sendResponse({
        target: HOST_TARGET,
        supported: frameLoaded && !frameFailed,
        failureReason: getFailureReason(),
        status: collectHostStatus()
      });
      return false;
    }

    if (message?.type === OFFSCREEN_MESSAGES.HOST_STATUS) {
      sendResponse({
        target: HOST_TARGET,
        status: collectHostStatus()
      });
      return false;
    }

    if (message?.type === OFFSCREEN_MESSAGES.HOST_RELOAD_FRAME) {
      reloadFrame(sanitizeChatGptUrl(message.url) || CHATGPT_HOME_URL);
      sendResponse({
        target: HOST_TARGET,
        reloaded: true,
        status: collectHostStatus()
      });
      return false;
    }

    if (message?.type === OFFSCREEN_MESSAGES.BRIDGE_STATUS) {
      bridgeConnected = Boolean(message.connected);
      bridgeFrame = normalizeBridgeFrame(message.frame);
      framePolicy = message.framePolicy && typeof message.framePolicy === "object"
        ? message.framePolicy
        : framePolicy;

      if (bridgeConnected) {
        lastBridgeConnectedAt = now();
      } else {
        lastBridgeDisconnectedAt = now();
      }

      sendResponse({
        target: HOST_TARGET,
        ok: true,
        status: collectHostStatus()
      });
      return false;
    }

    return false;
  }

  function ensureFrame(url = CHATGPT_HOME_URL) {
    if (frame) {
      return frame;
    }

    const container = documentRef.createElement("div");
    container.className = HOST_CLASS;
    container.setAttribute("aria-hidden", "true");

    frame = documentRef.createElement("iframe");
    frame.id = FRAME_ID;
    frame.title = FRAME_TITLE;
    frame.referrerPolicy = "origin";
    frame.src = url;
    frame.addEventListener("load", handleFrameLoad);
    frame.addEventListener("error", handleFrameError);

    container.append(frame);
    documentRef.body.append(container);

    return frame;
  }

  function reloadFrame(url) {
    ensureFrame(url);
    frameLoaded = false;
    frameFailed = false;
    bridgeConnected = false;
    bridgeFrame = null;
    failureReason = "";
    lastReloadedAt = now();
    frame.src = "about:blank";
    setTimeoutRef(() => {
      frame.src = url;
    }, 50);
  }

  function handleFrameLoad() {
    if (frame?.getAttribute("src") === "about:blank") {
      return;
    }

    frameLoaded = true;
    frameFailed = false;
    failureReason = "";
    loadCount += 1;
    lastLoadedAt = now();
  }

  function handleFrameError() {
    frameFailed = true;
    frameLoaded = false;
    failureReason = "Assistant iframe failed to load in the Firefox sidebar host.";
    lastFailedAt = now();
  }

  function getFailureReason() {
    if (frameFailed) {
      return failureReason;
    }

    if (!frameLoaded) {
      return "Waiting for assistant iframe load in the Firefox sidebar host.";
    }

    return null;
  }

  function collectHostStatus() {
    return {
      frameLoaded,
      frameFailed,
      failureReason: getFailureReason(),
      frameSrc: frame?.getAttribute("src") || "",
      loadCount,
      lastLoadedAt,
      lastFailedAt,
      lastReloadedAt,
      bridgeConnected,
      lastBridgeConnectedAt,
      lastBridgeDisconnectedAt,
      bridgeFrame,
      framePolicy,
      checkedAt: now(),
      hostKind: "firefox-sidebar"
    };
  }

  return Object.freeze({
    collectHostStatus,
    ensureFrame,
    handleRuntimeMessage,
    register,
    reloadFrame
  });
}

function shouldInstallFirefoxAutomationHost() {
  if (typeof chrome === "undefined" || typeof document === "undefined") {
    return false;
  }

  const manifest = chrome.runtime?.getManifest?.() || {};

  return Boolean(manifest.sidebar_action && !chrome.offscreen?.createDocument);
}

function normalizeBridgeFrame(value) {
  const source = value && typeof value === "object" ? value : {};

  return {
    href: typeof source.href === "string" ? source.href : "",
    readyState: typeof source.readyState === "string" ? source.readyState : "",
    visibilityState: typeof source.visibilityState === "string" ? source.visibilityState : "",
    hasFocus: Boolean(source.hasFocus),
    title: typeof source.title === "string" ? source.title : "",
    referrer: typeof source.referrer === "string" ? source.referrer : "",
    bodyTextLength: Number.isFinite(source.bodyTextLength) ? source.bodyTextLength : null,
    collectedAt: typeof source.collectedAt === "string" ? source.collectedAt : null,
    connectedAt: typeof source.connectedAt === "string" ? source.connectedAt : null,
    disconnectedAt: typeof source.disconnectedAt === "string" ? source.disconnectedAt : null
  };
}

function sanitizeChatGptUrl(value) {
  try {
    const url = new URL(value);

    if (url.protocol === "https:" && (url.hostname === "chatgpt.com" || url.hostname === "chat.openai.com")) {
      return url.href;
    }
  } catch (_error) {
    // Fall through to null.
  }

  return null;
}

if (shouldInstallFirefoxAutomationHost()) {
  createFirefoxAutomationHost().register();
}
