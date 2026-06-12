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
  OFFSCREEN_FRAME_ROLES,
  OFFSCREEN_MESSAGES
} from "../../shared/contracts.js";

const OFFSCREEN_DOCUMENT_PATH = "offscreen/automation-host.html";
const OFFSCREEN_HOST_READY_TIMEOUT_MS = CHATGPT_LOAD_TIMEOUT_MS;
const OFFSCREEN_FRAME_BRIDGE_TIMEOUT_MS = 15000;
const OFFSCREEN_FRAME_COMMAND_TIMEOUT_MS = 8000;
const DEFAULT_FRAME_ROLE = OFFSCREEN_FRAME_ROLES.CHAT;

let creatingOffscreenDocument = null;
let probingOffscreenAutomationTarget = null;
let offscreenCommandCounter = 0;
let offscreenFrameDisconnectHandler = null;
const pendingOffscreenCommands = new Map();
const offscreenPortRoles = new WeakMap();
const offscreenFrames = new Map(Object.values(OFFSCREEN_FRAME_ROLES).map((role) => [role, createOffscreenFrameState(role)]));

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

  port.onMessage.addListener((message) => {
    handleOffscreenFramePortMessage(port, message);
  });
  port.onDisconnect.addListener(() => {
    handleOffscreenFramePortDisconnected(port);
  });

  return true;
}

export async function probeOffscreenAutomationTarget() {
  if (probingOffscreenAutomationTarget) {
    return probingOffscreenAutomationTarget;
  }

  probingOffscreenAutomationTarget = probeOffscreenAutomationTargetOnce()
    .finally(() => {
      probingOffscreenAutomationTarget = null;
    });

  return probingOffscreenAutomationTarget;
}

async function probeOffscreenAutomationTargetOnce() {
  const session = await getAutomationSession();

  if (session.offscreenCapability?.supported === true && hasConnectedOffscreenFrame(OFFSCREEN_FRAME_ROLES.CHAT)) {
    return session.offscreenCapability;
  }

  if (!hasChromeOffscreenApi()) {
    return recordUnsupported(
      "Chrome offscreen documents are unavailable. Dichrome hidden automation requires a Chromium browser with offscreen document support."
    );
  }

  try {
    await ensureOffscreenDocument();
    const response = await waitForOffscreenHostProbe({
      frameRole: OFFSCREEN_FRAME_ROLES.CHAT
    });

    if (!response?.supported) {
      return recordUnsupported(response?.failureReason || "ChatGPT could not be loaded inside the offscreen host.");
    }

    let frameStatus = await waitForOffscreenFrameBridge({
      frameRole: OFFSCREEN_FRAME_ROLES.CHAT
    });

    if (!frameStatus.supported && await reloadOffscreenChatGptFrame(OFFSCREEN_FRAME_ROLES.CHAT)) {
      const reloadProbe = await waitForOffscreenHostProbe({
        frameRole: OFFSCREEN_FRAME_ROLES.CHAT
      });

      if (!reloadProbe?.supported) {
        return recordUnsupported(reloadProbe?.failureReason || "ChatGPT could not be reloaded inside the offscreen host.");
      }

      frameStatus = await waitForOffscreenFrameBridge({
        afterReload: true,
        frameRole: OFFSCREEN_FRAME_ROLES.CHAT
      });
    }

    if (!frameStatus.supported && shouldRetryWithBroadFramePolicy()) {
      const fallbackPolicy = await enableBroadOffscreenFramePolicyOverride("Non-tab-scoped rule installed but the hidden ChatGPT frame bridge did not connect; broadened to all ChatGPT subframes for this extension session.");

      if (fallbackPolicy.enabled && await reloadOffscreenChatGptFrame(OFFSCREEN_FRAME_ROLES.CHAT)) {
        const fallbackProbe = await waitForOffscreenHostProbe({
          frameRole: OFFSCREEN_FRAME_ROLES.CHAT
        });

        if (!fallbackProbe?.supported) {
          return recordUnsupported(fallbackProbe?.failureReason || "ChatGPT could not be reloaded after broadening the frame-policy override.");
        }

        frameStatus = await waitForOffscreenFrameBridge({
          afterReload: true,
          afterFramePolicyFallback: true,
          frameRole: OFFSCREEN_FRAME_ROLES.CHAT
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

export function getOffscreenFrameStatus(frameRole = DEFAULT_FRAME_ROLE) {
  const role = getRoutableFrameRole(frameRole);
  const state = getFrameState(role);

  return {
    frameRole: role,
    connected: hasConnectedOffscreenFrame(role),
    frame: state.info,
    pendingCommandCount: countPendingCommands(role),
    framePolicy: getOffscreenFramePolicyStatus(),
    frames: collectOffscreenFrameStatuses()
  };
}

export async function getOffscreenHostStatus() {
  const response = await chrome.runtime.sendMessage({
    type: OFFSCREEN_MESSAGES.HOST_STATUS
  }).catch(() => null);

  if (response?.target !== "offscreen-automation-host") {
    return {
      connected: false,
      failureReason: "Hidden internal automation host did not respond."
    };
  }

  return {
    connected: true,
    ...response.status
  };
}

export async function sendMessageToOffscreenFrame(message, timeoutMs = OFFSCREEN_FRAME_COMMAND_TIMEOUT_MS, options = {}) {
  const normalized = normalizeCommandOptions(timeoutMs, options);
  const frameRole = getRoutableFrameRole(normalized.frameRole);

  if (!hasConnectedOffscreenFrame(frameRole)) {
    throw new Error(`Hidden internal ChatGPT ${frameRole} frame is not connected.`);
  }

  const commandId = `offscreen-command-${++offscreenCommandCounter}`;

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingOffscreenCommands.delete(commandId);
      reject(new Error(`Timed out waiting for offscreen ChatGPT ${frameRole} frame command: ${message?.type || "unknown"}`));
    }, normalized.timeoutMs);

    const commandPort = getFrameState(frameRole).port;

    pendingOffscreenCommands.set(commandId, {
      frameRole,
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

export async function navigateOffscreenFrameToConversation(conversationUrl, options = {}) {
  return navigateOffscreenFrameToUrl(conversationUrl, {
    invalidUrlMessage: "The saved ChatGPT conversation URL is not a ChatGPT URL.",
    rejectedMessage: "The hidden ChatGPT frame rejected conversation navigation.",
    timeoutMessage: "Timed out waiting for the hidden ChatGPT frame to load the saved conversation."
  }, options);
}

export async function navigateOffscreenFrameToUrl(url, {
  invalidUrlMessage = "The target ChatGPT URL is not valid.",
  rejectedMessage = "The hidden ChatGPT frame rejected navigation.",
  timeoutMessage = "Timed out waiting for the hidden ChatGPT frame to load the requested page."
} = {}, options = {}) {
  const frameRole = getRoutableFrameRole(options.frameRole);

  if (!isChatGptUrl(url)) {
    throw new Error(invalidUrlMessage);
  }

  const response = await sendMessageToOffscreenFrame({
    type: CHATGPT_AUTOMATION_MESSAGES.NAVIGATE,
    url
  }, OFFSCREEN_FRAME_COMMAND_TIMEOUT_MS, {
    frameRole
  });

  if (!response?.ok) {
    throw new Error(response?.error || rejectedMessage);
  }

  const frameStatus = await waitForOffscreenFrameBridge({
    frameRole,
    url,
    timeoutMessage
  });

  if (!frameStatus.supported) {
    throw new Error(frameStatus.failureReason);
  }

  return frameStatus.frame;
}

export async function reloadOffscreenFrameToUrl(url, {
  invalidUrlMessage = "The target ChatGPT URL is not valid.",
  timeoutMessage = "Timed out waiting for the hidden ChatGPT frame to reload the requested page."
} = {}, options = {}) {
  const frameRole = getRoutableFrameRole(options.frameRole);

  if (!isChatGptUrl(url)) {
    throw new Error(invalidUrlMessage);
  }

  const reloaded = await requestOffscreenFrameReload(url, frameRole);

  if (!reloaded) {
    throw new Error("The hidden ChatGPT host did not reload the requested frame.");
  }

  markOffscreenFrameReloading(frameRole);

  const frameStatus = await waitForOffscreenFrameBridge({
    frameRole,
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
    offscreenDocumentUrl: getAutomationHostDocumentUrl(),
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

async function waitForOffscreenHostProbe({
  frameRole = OFFSCREEN_FRAME_ROLES.CHAT,
  hostTimeoutMessage = "Timed out waiting for the offscreen ChatGPT host probe."
} = {}) {
  const startedAt = Date.now();
  const role = getRoutableFrameRole(frameRole);
  let lastResponse = null;

  while (Date.now() - startedAt < OFFSCREEN_HOST_READY_TIMEOUT_MS) {
    const response = await chrome.runtime.sendMessage({
      type: OFFSCREEN_MESSAGES.HOST_PROBE,
      frameRole: role,
      url: CHATGPT_HOME_URL
    }).catch(() => null);

    if (response?.target === "offscreen-automation-host") {
      lastResponse = response;

      if (response.supported || getHostFrameStatus(response.status, role)?.frameFailed) {
        return response;
      }
    }

    await sleep(250);
  }

  if (lastResponse) {
    return {
      ...lastResponse,
      supported: false,
      failureReason: `Timed out waiting for ChatGPT ${role} iframe load in the offscreen host.`
    };
  }

  return {
    supported: false,
    failureReason: hostTimeoutMessage
  };
}

async function waitForOffscreenFrameBridge({
  frameRole = OFFSCREEN_FRAME_ROLES.CHAT,
  url = null,
  afterReload = false,
  afterFramePolicyFallback = false,
  timeoutMessage = ""
} = {}) {
  const role = getRoutableFrameRole(frameRole);
  const startedAt = Date.now();
  const expectedUrl = normalizeUrlForComparison(url);

  while (Date.now() - startedAt < OFFSCREEN_FRAME_BRIDGE_TIMEOUT_MS) {
    if (hasConnectedOffscreenFrame(role)) {
      const actualUrl = normalizeUrlForComparison(getFrameState(role).info?.href || "");

      if (!expectedUrl || actualUrl === expectedUrl) {
        return {
          supported: true,
          frame: getFrameState(role).info
        };
      }
    }

    await sleep(250);
  }

  return {
    supported: false,
    failureReason: expectedUrl
      ? (timeoutMessage || `Timed out waiting for the hidden ChatGPT ${role} frame to load the requested ChatGPT URL.`)
      : `ChatGPT iframe loaded, but the ChatGPT ${role} frame content script did not connect from the offscreen iframe.${afterReload ? " Retried the offscreen iframe once." : ""}${afterFramePolicyFallback ? " Retried with a broader ChatGPT subframe frame-policy override." : ""}`
  };
}

async function reloadOffscreenChatGptFrame(frameRole = OFFSCREEN_FRAME_ROLES.CHAT) {
  return requestOffscreenFrameReload(CHATGPT_HOME_URL, getRoutableFrameRole(frameRole));
}

async function requestOffscreenFrameReload(url, frameRole) {
  const role = getRoutableFrameRole(frameRole);

  const response = await chrome.runtime.sendMessage({
    type: OFFSCREEN_MESSAGES.HOST_RELOAD_FRAME,
    frameRole: role,
    url: buildOffscreenReloadUrl(url)
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
    const frameRole = normalizeFrameRole(message.frameRole || message.frame?.frameRole);

    if (isStaleReloadPort(port, frameRole)) {
      return;
    }

    const nextFrameInfo = normalizeFrameInfo({
      ...message.frame,
      frameRole,
      connectedAt: getFrameState(frameRole).info?.connectedAt || new Date().toISOString()
    });

    if (!isUsableOffscreenAutomationFrameUrl(nextFrameInfo.href)) {
      rejectOffscreenFramePort(port, nextFrameInfo);
      return;
    }

    registerOffscreenFramePort(port, frameRole, nextFrameInfo);
    return;
  }

  if (message?.type === OFFSCREEN_MESSAGES.FRAME_COMMAND_RESPONSE) {
    const pending = pendingOffscreenCommands.get(message.commandId);

    if (!pending || pending.port !== port) {
      return;
    }

    pendingOffscreenCommands.delete(message.commandId);
    pending.resolve(message.response || {});
  }
}

function handleOffscreenFramePortDisconnected(port) {
  const frameRole = offscreenPortRoles.get(port);

  offscreenPortRoles.delete(port);

  if (frameRole) {
    const state = getFrameState(frameRole);

    if (state.port === port) {
      state.port = null;
      state.info = {
        ...(state.info || {}),
        frameRole,
        disconnectedAt: new Date().toISOString()
      };
      void notifyOffscreenHostBridgeState(false, frameRole);

      if (frameRole === OFFSCREEN_FRAME_ROLES.CHAT) {
        const disconnectNoticeTimer = globalThis.setTimeout(() => {
          void notifyOffscreenFrameDisconnectedIfStillGone(frameRole);
        }, 2000);
        disconnectNoticeTimer?.unref?.();
      }
    }
  }

  for (const [commandId, pending] of pendingOffscreenCommands.entries()) {
    if (pending.port === port) {
      pending.reject(new Error(`Offscreen ChatGPT ${pending.frameRole} frame disconnected.`));
      pendingOffscreenCommands.delete(commandId);
    }
  }
}

function rejectOffscreenFramePort(port, frameInfo) {
  const existingRole = offscreenPortRoles.get(port);

  if (existingRole) {
    const state = getFrameState(existingRole);

    if (state.port === port) {
      state.port = null;
      state.info = {
        ...frameInfo,
        lastError: "Rejected non-automation ChatGPT frame."
      };
      void notifyOffscreenHostBridgeState(false, existingRole);
    }
  }

  try {
    port.disconnect();
  } catch (_error) {
    // Ignore already-closed nested frame ports.
  }
}

function registerOffscreenFramePort(port, frameRole, frameInfo) {
  const role = normalizeFrameRole(frameRole);
  const previousRole = offscreenPortRoles.get(port);

  if (previousRole && previousRole !== role) {
    const previousState = getFrameState(previousRole);

    if (previousState.port === port) {
      previousState.port = null;
      previousState.info = {
        ...(previousState.info || {}),
        disconnectedAt: new Date().toISOString()
      };
      void notifyOffscreenHostBridgeState(false, previousRole);
    }
  }

  const state = getFrameState(role);
  const previousPort = state.port && state.port !== port
    ? state.port
    : null;

  offscreenPortRoles.set(port, role);
  state.port = port;
  state.reloadingAt = null;
  state.reloadStalePorts.delete(port);
  state.info = normalizeFrameInfo({
    ...frameInfo,
    frameRole: role,
    connectedAt: frameInfo.connectedAt || new Date().toISOString()
  });
  void notifyOffscreenHostBridgeState(true, role);

  if (previousPort) {
    if (role === OFFSCREEN_FRAME_ROLES.CHAT) {
      void notifyOffscreenFrameReplacedDuringActiveRequest(role);
    }

    try {
      previousPort.disconnect();
    } catch (_error) {
      // The previous frame port may already be closed.
    }
  }
}

function hasConnectedOffscreenFrame(frameRole = OFFSCREEN_FRAME_ROLES.CHAT) {
  const state = getFrameState(getRoutableFrameRole(frameRole));

  return Boolean(!state.reloadingAt && state.port && isUsableOffscreenAutomationFrameUrl(state.info?.href || ""));
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

function createOffscreenFrameState(frameRole) {
  return {
    role: frameRole,
    port: null,
    info: null,
    reloadingAt: null,
    reloadStalePorts: new WeakSet()
  };
}

function getFrameState(frameRole) {
  return offscreenFrames.get(normalizeFrameRole(frameRole)) || offscreenFrames.get(DEFAULT_FRAME_ROLE);
}

function normalizeFrameRole(value) {
  return value === OFFSCREEN_FRAME_ROLES.HISTORY
    ? OFFSCREEN_FRAME_ROLES.HISTORY
    : OFFSCREEN_FRAME_ROLES.CHAT;
}

function getRoutableFrameRole(value) {
  return normalizeFrameRole(value);
}

function normalizeCommandOptions(timeoutMs, options) {
  if (timeoutMs && typeof timeoutMs === "object") {
    return {
      timeoutMs: OFFSCREEN_FRAME_COMMAND_TIMEOUT_MS,
      frameRole: timeoutMs.frameRole
    };
  }

  return {
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : OFFSCREEN_FRAME_COMMAND_TIMEOUT_MS,
    frameRole: options?.frameRole
  };
}

function normalizeFrameInfo(value) {
  const source = value && typeof value === "object" ? value : {};

  return {
    frameRole: normalizeFrameRole(source.frameRole),
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

function hasChromeOffscreenApi() {
  return Boolean(chrome.offscreen?.createDocument);
}

function getAutomationHostDocumentUrl() {
  return getOffscreenDocumentUrl();
}

function collectOffscreenFrameStatuses() {
  return Object.fromEntries(Object.values(OFFSCREEN_FRAME_ROLES).map((frameRole) => {
    const state = getFrameState(frameRole);

    return [frameRole, {
      frameRole,
      connected: hasConnectedOffscreenFrame(frameRole),
      frame: state.info,
      pendingCommandCount: countPendingCommands(frameRole),
      reloading: Boolean(state.reloadingAt),
      reloadingAt: state.reloadingAt
    }];
  }));
}

function countPendingCommands(frameRole) {
  const role = getRoutableFrameRole(frameRole);
  let count = 0;

  for (const pending of pendingOffscreenCommands.values()) {
    if (pending.frameRole === role) {
      count += 1;
    }
  }

  return count;
}

function getHostFrameStatus(status, frameRole) {
  return status?.frames?.[frameRole] || status || null;
}

function markOffscreenFrameReloading(frameRole) {
  const role = getRoutableFrameRole(frameRole);
  const state = getFrameState(role);
  const previousPort = state.port;
  const reloadingAt = new Date().toISOString();

  if (previousPort) {
    state.reloadStalePorts.add(previousPort);
  }

  state.port = null;
  state.reloadingAt = reloadingAt;
  state.info = normalizeFrameInfo({
    ...(state.info || {}),
    frameRole: role,
    connectedAt: null,
    disconnectedAt: reloadingAt
  });

  rejectPendingCommandsForRole(role, new Error(`Offscreen ChatGPT ${role} frame reloaded.`));
  void notifyOffscreenHostBridgeState(false, role);

  if (role === OFFSCREEN_FRAME_ROLES.CHAT) {
    void notifyOffscreenFrameReplacedDuringActiveRequest(role);
  }
}

function isStaleReloadPort(port, frameRole) {
  const state = getFrameState(frameRole);

  return Boolean(state.reloadingAt && state.reloadStalePorts.has(port));
}

function rejectPendingCommandsForRole(frameRole, error) {
  const role = getRoutableFrameRole(frameRole);

  for (const [commandId, pending] of pendingOffscreenCommands.entries()) {
    if (pending.frameRole === role) {
      pending.reject(error);
      pendingOffscreenCommands.delete(commandId);
    }
  }
}

async function notifyOffscreenHostBridgeState(connected, frameRole = OFFSCREEN_FRAME_ROLES.CHAT) {
  const role = getRoutableFrameRole(frameRole);

  await chrome.runtime.sendMessage({
    type: OFFSCREEN_MESSAGES.BRIDGE_STATUS,
    frameRole: role,
    connected: Boolean(connected),
    frame: getFrameState(role).info,
    framePolicy: getOffscreenFramePolicyStatus()
  }).catch(() => null);
}

async function notifyOffscreenFrameDisconnectedIfStillGone(frameRole = OFFSCREEN_FRAME_ROLES.CHAT) {
  if (getRoutableFrameRole(frameRole) !== OFFSCREEN_FRAME_ROLES.CHAT || hasConnectedOffscreenFrame(OFFSCREEN_FRAME_ROLES.CHAT) || !offscreenFrameDisconnectHandler) {
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

async function notifyOffscreenFrameReplacedDuringActiveRequest(frameRole = OFFSCREEN_FRAME_ROLES.CHAT) {
  if (getRoutableFrameRole(frameRole) !== OFFSCREEN_FRAME_ROLES.CHAT || !offscreenFrameDisconnectHandler) {
    return;
  }

  const session = await getAutomationSession().catch(() => null);

  if (!session?.activeRequestId) {
    return;
  }

  offscreenFrameDisconnectHandler({
    requestId: session.activeRequestId,
    reason: "Hidden internal ChatGPT frame reloaded during the active request."
  });
}
