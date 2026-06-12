const DEFAULT_CHATGPT_URL = "https://chatgpt.com/";
const FRAME_ROLES = Object.freeze({
  CHAT: "chat",
  HISTORY: "history"
});
const HOST_TARGET = "offscreen-automation-host";

const frameStates = Object.freeze({
  [FRAME_ROLES.CHAT]: createFrameState(FRAME_ROLES.CHAT, document.getElementById("chatgptChatFrame")),
  [FRAME_ROLES.HISTORY]: createFrameState(FRAME_ROLES.HISTORY, document.getElementById("chatgptHistoryFrame"))
});

for (const state of Object.values(frameStates)) {
  state.frame?.addEventListener("load", () => {
    if (state.frame?.getAttribute("src") === "about:blank") {
      return;
    }

    state.frameLoaded = true;
    state.frameFailed = false;
    state.failureReason = "";
    state.loadCount += 1;
    state.lastLoadedAt = new Date().toISOString();
  });

  state.frame?.addEventListener("error", () => {
    state.frameFailed = true;
    state.frameLoaded = false;
    state.failureReason = `Assistant ${state.role} iframe failed to load in the offscreen host.`;
    state.lastFailedAt = new Date().toISOString();
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "OFFSCREEN_AUTOMATION_PROBE") {
    const state = getFrameState(message.frameRole);

    sendResponse({
      target: HOST_TARGET,
      supported: state.frameLoaded && !state.frameFailed,
      failureReason: getFailureReason(state),
      status: collectHostStatus()
    });
    return false;
  }

  if (message?.type === "OFFSCREEN_AUTOMATION_STATUS") {
    sendResponse({
      target: HOST_TARGET,
      status: collectHostStatus()
    });
    return false;
  }

  if (message?.type === "OFFSCREEN_AUTOMATION_RELOAD_FRAME") {
    const state = getFrameState(message.frameRole);
    const nextUrl = sanitizeChatGptUrl(message.url) || DEFAULT_CHATGPT_URL;

    reloadFrame(state, nextUrl);

    sendResponse({
      target: HOST_TARGET,
      frameRole: state.role,
      reloaded: true,
      status: collectHostStatus()
    });
    return false;
  }

  if (message?.type === "OFFSCREEN_AUTOMATION_BRIDGE_STATUS") {
    const state = getFrameState(message.frameRole);

    state.bridgeConnected = Boolean(message.connected);
    state.bridgeFrame = normalizeBridgeFrame(message.frame);
    state.framePolicy = message.framePolicy && typeof message.framePolicy === "object"
      ? message.framePolicy
      : state.framePolicy;

    if (state.bridgeConnected) {
      state.lastBridgeConnectedAt = new Date().toISOString();
    } else {
      state.lastBridgeDisconnectedAt = new Date().toISOString();
    }

    sendResponse({
      target: HOST_TARGET,
      ok: true,
      frameRole: state.role,
      status: collectHostStatus()
    });
    return false;
  }

  return false;
});

function createFrameState(role, frame) {
  return {
    role,
    frame,
    frameLoaded: false,
    frameFailed: false,
    failureReason: frame ? "" : `Assistant ${role} iframe is missing from the offscreen host.`,
    loadCount: 0,
    lastLoadedAt: null,
    lastFailedAt: null,
    lastReloadedAt: null,
    bridgeConnected: false,
    lastBridgeConnectedAt: null,
    lastBridgeDisconnectedAt: null,
    bridgeFrame: null,
    framePolicy: null
  };
}

function getFrameState(frameRole) {
  return frameStates[normalizeFrameRole(frameRole)] || frameStates[FRAME_ROLES.CHAT];
}

function normalizeFrameRole(value) {
  return value === FRAME_ROLES.HISTORY ? FRAME_ROLES.HISTORY : FRAME_ROLES.CHAT;
}

function reloadFrame(state, url) {
  if (!state.frame) {
    state.frameFailed = true;
    state.frameLoaded = false;
    state.failureReason = `Assistant ${state.role} iframe is missing from the offscreen host.`;
    state.lastFailedAt = new Date().toISOString();
    return;
  }

  state.frameLoaded = false;
  state.frameFailed = false;
  state.bridgeConnected = false;
  state.bridgeFrame = null;
  state.failureReason = "";
  state.lastReloadedAt = new Date().toISOString();
  state.frame.src = "about:blank";
  window.setTimeout(() => {
    state.frame.src = url;
  }, 50);
}

function getFailureReason(state) {
  if (state.frameFailed) {
    return state.failureReason;
  }

  if (!state.frameLoaded) {
    return `Waiting for assistant ${state.role} iframe load in the offscreen host.`;
  }

  return null;
}

function collectHostStatus() {
  const chatStatus = collectFrameStatus(frameStates[FRAME_ROLES.CHAT]);

  return {
    ...chatStatus,
    frames: {
      [FRAME_ROLES.CHAT]: chatStatus,
      [FRAME_ROLES.HISTORY]: collectFrameStatus(frameStates[FRAME_ROLES.HISTORY])
    },
    hostKind: "chrome-offscreen",
    checkedAt: new Date().toISOString()
  };
}

function collectFrameStatus(state) {
  return {
    frameRole: state.role,
    frameLoaded: state.frameLoaded,
    frameFailed: state.frameFailed,
    failureReason: getFailureReason(state),
    frameSrc: state.frame?.getAttribute("src") || "",
    loadCount: state.loadCount,
    lastLoadedAt: state.lastLoadedAt,
    lastFailedAt: state.lastFailedAt,
    lastReloadedAt: state.lastReloadedAt,
    bridgeConnected: state.bridgeConnected,
    lastBridgeConnectedAt: state.lastBridgeConnectedAt,
    lastBridgeDisconnectedAt: state.lastBridgeDisconnectedAt,
    bridgeFrame: state.bridgeFrame,
    framePolicy: state.framePolicy
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
    disconnectedAt: typeof source.disconnectedAt === "string" ? source.disconnectedAt : null,
    frameRole: normalizeFrameRole(source.frameRole)
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
