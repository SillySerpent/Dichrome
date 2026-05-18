const frame = document.getElementById("chatgptFrame");
const DEFAULT_CHATGPT_URL = "https://chatgpt.com/";
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

frame.addEventListener("load", () => {
  frameLoaded = true;
  frameFailed = false;
  failureReason = "";
  loadCount += 1;
  lastLoadedAt = new Date().toISOString();
});

frame.addEventListener("error", () => {
  frameFailed = true;
  frameLoaded = false;
  failureReason = "Assistant iframe failed to load in the offscreen host.";
  lastFailedAt = new Date().toISOString();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "OFFSCREEN_AUTOMATION_PROBE") {
    sendResponse({
      target: "offscreen-automation-host",
      supported: frameLoaded && !frameFailed,
      failureReason: getFailureReason(),
      status: collectHostStatus()
    });
    return false;
  }

  if (message?.type === "OFFSCREEN_AUTOMATION_STATUS") {
    sendResponse({
      target: "offscreen-automation-host",
      status: collectHostStatus()
    });
    return false;
  }

  if (message?.type === "OFFSCREEN_AUTOMATION_RELOAD_FRAME") {
    const nextUrl = sanitizeChatGptUrl(message.url) || DEFAULT_CHATGPT_URL;

    frameLoaded = false;
    frameFailed = false;
    bridgeConnected = false;
    bridgeFrame = null;
    failureReason = "";
    lastReloadedAt = new Date().toISOString();
    frame.src = "about:blank";
    window.setTimeout(() => {
      frame.src = nextUrl;
    }, 50);

    sendResponse({
      target: "offscreen-automation-host",
      reloaded: true,
      status: collectHostStatus()
    });
    return false;
  }

  if (message?.type === "OFFSCREEN_AUTOMATION_BRIDGE_STATUS") {
    bridgeConnected = Boolean(message.connected);
    bridgeFrame = normalizeBridgeFrame(message.frame);
    framePolicy = message.framePolicy && typeof message.framePolicy === "object"
      ? message.framePolicy
      : framePolicy;

    if (bridgeConnected) {
      lastBridgeConnectedAt = new Date().toISOString();
    } else {
      lastBridgeDisconnectedAt = new Date().toISOString();
    }

    sendResponse({
      target: "offscreen-automation-host",
      ok: true,
      status: collectHostStatus()
    });
    return false;
  }

  return false;
});

function getFailureReason() {
  if (frameFailed) {
    return failureReason;
  }

  if (!frameLoaded) {
    return "Waiting for assistant iframe load in the offscreen host.";
  }

  return null;
}

function collectHostStatus() {
  return {
    frameLoaded,
    frameFailed,
    failureReason: getFailureReason(),
    frameSrc: frame.getAttribute("src") || "",
    loadCount,
    lastLoadedAt,
    lastFailedAt,
    lastReloadedAt,
    bridgeConnected,
    lastBridgeConnectedAt,
    lastBridgeDisconnectedAt,
    bridgeFrame,
    framePolicy,
    checkedAt: new Date().toISOString()
  };
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
