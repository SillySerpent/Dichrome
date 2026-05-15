import {
  CHATGPT_HOME_URL,
  CHATGPT_LOAD_TIMEOUT_MS,
  isChatGptUrl,
  serializeError,
  sleep
} from "../constants.js";
import {
  AUTOMATION_TARGET_TYPES,
  getAutomationSession,
  markAutomationTargetReady,
  setOffscreenCapability
} from "./session.js";
import {
  disableOffscreenFramePolicyOverride,
  enableBroadOffscreenFramePolicyOverride,
  enableOffscreenFramePolicyOverride,
  getOffscreenFramePolicyStatus
} from "./offscreen-frame-policy.js";
import {
  CHATGPT_AUTOMATION_MESSAGES,
  OFFSCREEN_FRAME_PORT_NAME,
  OFFSCREEN_MESSAGES
} from "../../shared/contracts.js";

const OFFSCREEN_DOCUMENT_PATH = "offscreen/automation-host.html";
const OFFSCREEN_HOST_READY_TIMEOUT_MS = CHATGPT_LOAD_TIMEOUT_MS;
const OFFSCREEN_FRAME_BRIDGE_TIMEOUT_MS = 15000;
const OFFSCREEN_FRAME_COMMAND_TIMEOUT_MS = 8000;

let creatingOffscreenDocument = null;
let offscreenFramePort = null;
let offscreenFrameInfo = null;
let offscreenCommandCounter = 0;
let offscreenFrameDisconnectHandler = null;
const pendingOffscreenCommands = new Map();

export function setOffscreenFrameDisconnectHandler(handler) {
  offscreenFrameDisconnectHandler = typeof handler === "function" ? handler : null;
}

export function handleOffscreenFramePort(port) {
  if (port?.name !== OFFSCREEN_FRAME_PORT_NAME) {
    return false;
  }

  if (port.sender?.tab?.id) {
    port.disconnect();
    return false;
  }

  const senderUrl = port.sender?.url || "";

  if (!isUsableOffscreenAutomationFrameUrl(senderUrl)) {
    try {
      port.disconnect();
    } catch (_error) {
      // Ignore already-closed nested frame ports.
    }

    return false;
  }

  const previousPort = offscreenFramePort && offscreenFramePort !== port
    ? offscreenFramePort
    : null;

  offscreenFramePort = port;
  offscreenFrameInfo = normalizeFrameInfo({
    href: port.sender?.url || "",
    readyState: "unknown",
    connectedAt: new Date().toISOString()
  });
  void notifyOffscreenHostBridgeState(true);

  port.onMessage.addListener((message) => {
    handleOffscreenFramePortMessage(port, message);
  });
  port.onDisconnect.addListener(() => {
    const wasActivePort = offscreenFramePort === port;

    if (offscreenFramePort === port) {
      offscreenFramePort = null;
      offscreenFrameInfo = {
        ...(offscreenFrameInfo || {}),
        disconnectedAt: new Date().toISOString()
      };
      void notifyOffscreenHostBridgeState(false);
      const disconnectNoticeTimer = globalThis.setTimeout(() => {
        void notifyOffscreenFrameDisconnectedIfStillGone();
      }, 2000);
      disconnectNoticeTimer?.unref?.();
    }

    for (const [commandId, pending] of pendingOffscreenCommands.entries()) {
      if (wasActivePort || pending.port === port) {
        pending.reject(new Error("Offscreen ChatGPT frame disconnected."));
        pendingOffscreenCommands.delete(commandId);
      }
    }
  });

  if (previousPort) {
    try {
      previousPort.disconnect();
    } catch (_error) {
      // The previous frame port may already be closed.
    }
  }

  return true;
}

export async function probeOffscreenAutomationTarget() {
  const session = await getAutomationSession();

  if (session.offscreenCapability?.supported === true && hasConnectedOffscreenFrame()) {
    return session.offscreenCapability;
  }

  if (!chrome.offscreen?.createDocument) {
    return recordUnsupported("Chrome offscreen API is unavailable.");
  }

  try {
    await ensureOffscreenDocument();
    const response = await waitForOffscreenHostProbe();

    if (!response?.supported) {
      return recordUnsupported(response?.failureReason || "ChatGPT could not be loaded inside the offscreen host.");
    }

    let frameStatus = await waitForOffscreenFrameBridge();

    if (!frameStatus.supported && await reloadOffscreenChatGptFrame()) {
      const reloadProbe = await waitForOffscreenHostProbe();

      if (!reloadProbe?.supported) {
        return recordUnsupported(reloadProbe?.failureReason || "ChatGPT could not be reloaded inside the offscreen host.");
      }

      frameStatus = await waitForOffscreenFrameBridge({
        afterReload: true
      });
    }

    if (!frameStatus.supported && shouldRetryWithBroadFramePolicy()) {
      const fallbackPolicy = await enableBroadOffscreenFramePolicyOverride("Non-tab-scoped rule installed but the hidden ChatGPT frame bridge did not connect; broadened to all ChatGPT subframes for this extension session.");

      if (fallbackPolicy.enabled && await reloadOffscreenChatGptFrame()) {
        const fallbackProbe = await waitForOffscreenHostProbe();

        if (!fallbackProbe?.supported) {
          return recordUnsupported(fallbackProbe?.failureReason || "ChatGPT could not be reloaded after broadening the frame-policy override.");
        }

        frameStatus = await waitForOffscreenFrameBridge({
          afterReload: true,
          afterFramePolicyFallback: true
        });
      }
    }

    if (!frameStatus.supported) {
      return recordUnsupported(frameStatus.failureReason);
    }

    const capability = {
      supported: true,
      checkedAt: new Date().toISOString(),
      failureReason: null
    };

    await setOffscreenCapability(capability);
    await markAutomationTargetReady(getOffscreenTargetDescriptor());
    return capability;
  } catch (error) {
    return recordUnsupported(error?.message || String(error));
  }
}

export function getOffscreenFrameStatus() {
  return {
    connected: hasConnectedOffscreenFrame(),
    frame: offscreenFrameInfo,
    pendingCommandCount: pendingOffscreenCommands.size,
    framePolicy: getOffscreenFramePolicyStatus()
  };
}

export async function getOffscreenHostStatus() {
  const response = await chrome.runtime.sendMessage({
    type: OFFSCREEN_MESSAGES.HOST_STATUS
  }).catch(() => null);

  if (response?.target !== "offscreen-automation-host") {
    return {
      connected: false,
      failureReason: "Offscreen automation host did not respond."
    };
  }

  return {
    connected: true,
    ...response.status
  };
}

export async function sendMessageToOffscreenFrame(message, timeoutMs = OFFSCREEN_FRAME_COMMAND_TIMEOUT_MS) {
  if (!hasConnectedOffscreenFrame()) {
    throw new Error("Hidden internal ChatGPT frame is not connected.");
  }

  const commandId = `offscreen-command-${++offscreenCommandCounter}`;

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingOffscreenCommands.delete(commandId);
      reject(new Error(`Timed out waiting for offscreen ChatGPT frame command: ${message?.type || "unknown"}`));
    }, timeoutMs);

    const commandPort = offscreenFramePort;

    pendingOffscreenCommands.set(commandId, {
      port: commandPort,
      resolve: (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timeoutId);
        reject(error);
      }
    });

    try {
      commandPort.postMessage({
        type: OFFSCREEN_MESSAGES.FRAME_COMMAND,
        commandId,
        payload: message
      });
    } catch (error) {
      pendingOffscreenCommands.delete(commandId);
      clearTimeout(timeoutId);
      reject(error);
    }
  });
}

export async function navigateOffscreenFrameToConversation(conversationUrl) {
  return navigateOffscreenFrameToUrl(conversationUrl, {
    invalidUrlMessage: "The saved ChatGPT conversation URL is not a ChatGPT URL.",
    rejectedMessage: "The hidden ChatGPT frame rejected conversation navigation.",
    timeoutMessage: "Timed out waiting for the hidden ChatGPT frame to load the saved conversation."
  });
}

export async function navigateOffscreenFrameToUrl(url, {
  invalidUrlMessage = "The target ChatGPT URL is not valid.",
  rejectedMessage = "The hidden ChatGPT frame rejected navigation.",
  timeoutMessage = "Timed out waiting for the hidden ChatGPT frame to load the requested page."
} = {}) {
  if (!isChatGptUrl(url)) {
    throw new Error(invalidUrlMessage);
  }

  const response = await sendMessageToOffscreenFrame({
    type: CHATGPT_AUTOMATION_MESSAGES.NAVIGATE,
    url
  });

  if (!response?.ok) {
    throw new Error(response?.error || rejectedMessage);
  }

  const frameStatus = await waitForOffscreenFrameBridge({
    url,
    timeoutMessage
  });

  if (!frameStatus.supported) {
    throw new Error(frameStatus.failureReason);
  }

  return frameStatus.frame;
}

export async function closeOffscreenAutomationTarget() {
  if (chrome.offscreen?.closeDocument) {
    await chrome.offscreen.closeDocument().catch(() => null);
  }

  await disableOffscreenFramePolicyOverride();
}

export function getOffscreenDocumentUrl() {
  return chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
}

export function getOffscreenTargetDescriptor() {
  return {
    targetType: AUTOMATION_TARGET_TYPES.OFFSCREEN_FRAME,
    tabId: null,
    windowId: null,
    offscreenDocumentUrl: getOffscreenDocumentUrl(),
    lastKnownUrl: CHATGPT_HOME_URL
  };
}

async function ensureOffscreenDocument() {
  await enableOffscreenFramePolicyOverride();

  const offscreenUrl = getOffscreenDocumentUrl();
  const existingContexts = chrome.runtime.getContexts
    ? await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl]
    })
    : [];

  if (existingContexts.length > 0) {
    return;
  }

  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: [getOffscreenReason()],
      justification: "Probe whether ChatGPT can run as a fully hidden internal automation target."
    }).finally(() => {
      creatingOffscreenDocument = null;
    });
  }

  await creatingOffscreenDocument;
}

async function waitForOffscreenHostProbe() {
  const startedAt = Date.now();
  let lastResponse = null;

  while (Date.now() - startedAt < OFFSCREEN_HOST_READY_TIMEOUT_MS) {
    const response = await chrome.runtime.sendMessage({
      type: OFFSCREEN_MESSAGES.HOST_PROBE,
      url: CHATGPT_HOME_URL
    }).catch(() => null);

    if (response?.target === "offscreen-automation-host") {
      lastResponse = response;

      if (response.supported || response.status?.frameFailed) {
        return response;
      }
    }

    await sleep(250);
  }

  if (lastResponse) {
    return {
      ...lastResponse,
      supported: false,
      failureReason: "Timed out waiting for ChatGPT iframe load in the offscreen host."
    };
  }

  return {
    supported: false,
    failureReason: "Timed out waiting for the offscreen ChatGPT host probe."
  };
}

async function waitForOffscreenFrameBridge({ url = null, afterReload = false, afterFramePolicyFallback = false, timeoutMessage = "" } = {}) {
  const startedAt = Date.now();
  const expectedUrl = normalizeUrlForComparison(url);

  while (Date.now() - startedAt < OFFSCREEN_FRAME_BRIDGE_TIMEOUT_MS) {
    if (hasConnectedOffscreenFrame()) {
      const actualUrl = normalizeUrlForComparison(offscreenFrameInfo?.href || "");

      if (!expectedUrl || actualUrl === expectedUrl) {
        return {
          supported: true,
          frame: offscreenFrameInfo
        };
      }
    }

    await sleep(250);
  }

  return {
    supported: false,
    failureReason: expectedUrl
      ? (timeoutMessage || "Timed out waiting for the hidden ChatGPT frame to load the requested ChatGPT URL.")
      : `ChatGPT iframe loaded, but the ChatGPT frame content script did not connect from the offscreen iframe.${afterReload ? " Retried the offscreen iframe once." : ""}${afterFramePolicyFallback ? " Retried with a broader ChatGPT subframe frame-policy override." : ""}`
  };
}

async function reloadOffscreenChatGptFrame() {
  const response = await chrome.runtime.sendMessage({
    type: OFFSCREEN_MESSAGES.HOST_RELOAD_FRAME,
    url: buildOffscreenReloadUrl(CHATGPT_HOME_URL)
  }).catch(() => null);

  return response?.target === "offscreen-automation-host" && response.reloaded === true;
}

async function recordUnsupported(failureReason) {
  const policyStatus = getOffscreenFramePolicyStatus();

  await disableOffscreenFramePolicyOverride();

  const policySuffix = policyStatus.error
    ? ` Frame-policy override status: ${policyStatus.error}`
    : "";
  const capability = {
    supported: false,
    checkedAt: new Date().toISOString(),
    failureReason: `${failureReason || "Hidden internal automation is unavailable."}${policySuffix}`
  };

  await setOffscreenCapability(capability);
  return capability;
}


function shouldRetryWithBroadFramePolicy() {
  const status = getOffscreenFramePolicyStatus();

  return status.enabled === true && status.scope === "non-tab-chatgpt-subframes";
}

function getOffscreenReason() {
  const reasons = chrome.offscreen?.Reason || {};

  return reasons.IFRAME_SCRIPTING || reasons.DOM_SCRAPING || reasons.CLIPBOARD || "IFRAME_SCRIPTING";
}

function handleOffscreenFramePortMessage(port, message) {
  if (message?.type === OFFSCREEN_MESSAGES.FRAME_READY) {
    const nextFrameInfo = normalizeFrameInfo(message.frame);

    if (!isUsableOffscreenAutomationFrameUrl(nextFrameInfo.href)) {
      if (offscreenFramePort === port) {
        offscreenFramePort = null;
        offscreenFrameInfo = {
          ...nextFrameInfo,
          lastError: "Rejected non-automation ChatGPT frame."
        };
        void notifyOffscreenHostBridgeState(false);
      }

      try {
        port.disconnect();
      } catch (_error) {
        // Ignore already-closed nested frame ports.
      }

      return;
    }

    if (offscreenFramePort === port) {
      offscreenFrameInfo = nextFrameInfo;
      void notifyOffscreenHostBridgeState(true);
    }
    return;
  }

  if (message?.type === OFFSCREEN_MESSAGES.FRAME_COMMAND_RESPONSE) {
    const pending = pendingOffscreenCommands.get(message.commandId);

    if (!pending) {
      return;
    }

    pendingOffscreenCommands.delete(message.commandId);
    pending.resolve(message.response || {});
  }
}

function hasConnectedOffscreenFrame() {
  return Boolean(offscreenFramePort && isUsableOffscreenAutomationFrameUrl(offscreenFrameInfo?.href || ""));
}

function isUsableOffscreenAutomationFrameUrl(value) {
  if (!isChatGptUrl(value)) {
    return false;
  }

  try {
    const url = new URL(value);
    const path = url.pathname.toLowerCase();

    return !path.startsWith("/backend-api/")
      && !path.startsWith("/api/")
      && !path.startsWith("/auth/")
      && !path.includes("/sentinel/");
  } catch (_error) {
    return false;
  }
}

function normalizeFrameInfo(value) {
  const source = value && typeof value === "object" ? value : {};

  return {
    href: typeof source.href === "string" ? source.href : "",
    readyState: typeof source.readyState === "string" ? source.readyState : "",
    visibilityState: typeof source.visibilityState === "string" ? source.visibilityState : "",
    hasFocus: Boolean(source.hasFocus),
    title: typeof source.title === "string" ? source.title : "",
    referrer: typeof source.referrer === "string" ? source.referrer : "",
    bodyTextLength: Number.isFinite(source.bodyTextLength) ? source.bodyTextLength : null,
    collectedAt: typeof source.collectedAt === "string" ? source.collectedAt : new Date().toISOString(),
    connectedAt: typeof source.connectedAt === "string" ? source.connectedAt : null,
    disconnectedAt: typeof source.disconnectedAt === "string" ? source.disconnectedAt : null,
    lastError: source.lastError ? serializeError(source.lastError) : null
  };
}

function normalizeUrlForComparison(value) {
  try {
    const url = new URL(value);

    return `${url.origin}${url.pathname}`;
  } catch (_error) {
    return "";
  }
}


function buildOffscreenReloadUrl(value) {
  try {
    const url = new URL(value);
    url.searchParams.set("relay_offscreen_probe", String(Date.now()));
    return url.href;
  } catch (_error) {
    return CHATGPT_HOME_URL;
  }
}

async function notifyOffscreenHostBridgeState(connected) {
  await chrome.runtime.sendMessage({
    type: OFFSCREEN_MESSAGES.BRIDGE_STATUS,
    connected: Boolean(connected),
    frame: offscreenFrameInfo,
    framePolicy: getOffscreenFramePolicyStatus()
  }).catch(() => null);
}

async function notifyOffscreenFrameDisconnectedIfStillGone() {
  if (hasConnectedOffscreenFrame() || !offscreenFrameDisconnectHandler) {
    return;
  }

  const session = await getAutomationSession().catch(() => null);

  if (!session?.activeRequestId) {
    return;
  }

  offscreenFrameDisconnectHandler({
    requestId: session.activeRequestId,
    reason: "Hidden internal ChatGPT frame disconnected."
  });
}
