import {
  AUTOMATION_WINDOW_STATE_KEY,
  storageArea
} from "../constants.js";
import {
  AUTOMATION_TARGET_TYPES,
  STORAGE_KEYS
} from "../../shared/contracts.js";

export const AUTOMATION_SESSION_KEY = STORAGE_KEYS.AUTOMATION_SESSION;
export const AUTOMATION_SESSION_SCHEMA_VERSION = 1;
export { AUTOMATION_TARGET_TYPES };

const DEFAULT_SESSION = Object.freeze({
  schemaVersion: AUTOMATION_SESSION_SCHEMA_VERSION,
  targetType: null,
  tabId: null,
  windowId: null,
  offscreenDocumentUrl: null,
  currentConversationUrl: null,
  currentConversationKey: null,
  activeRequestId: null,
  lastKnownUrl: null,
  lastHealthyAt: null,
  offscreenCapability: null
});

export async function getAutomationSession() {
  const result = await chrome.storage.local.get([
    AUTOMATION_SESSION_KEY,
    AUTOMATION_WINDOW_STATE_KEY
  ]);
  const existing = normalizeAutomationSession(result[AUTOMATION_SESSION_KEY]);

  if (existing) {
    return existing;
  }

  const migrated = normalizeLegacyAutomationWindowState(result[AUTOMATION_WINDOW_STATE_KEY]);

  if (migrated) {
    await setAutomationSession(migrated);
    return migrated;
  }

  return createDefaultAutomationSession();
}

export async function setAutomationSession(session) {
  const normalized = normalizeAutomationSession(session) || createDefaultAutomationSession();

  await chrome.storage.local.set({
    [AUTOMATION_SESSION_KEY]: normalized
  });

  return normalized;
}

export async function updateAutomationSession(mutator) {
  const session = await getAutomationSession();
  const next = structuredClone(session);

  mutator(next);

  return setAutomationSession(next);
}

export async function markAutomationTargetReady({
  targetType,
  tabId = null,
  windowId = null,
  offscreenDocumentUrl = null,
  lastKnownUrl = null
}) {
  return updateAutomationSession((session) => {
    session.targetType = targetType;
    session.tabId = Number.isInteger(tabId) ? tabId : null;
    session.windowId = Number.isInteger(windowId) ? windowId : null;
    session.offscreenDocumentUrl = offscreenDocumentUrl || null;
    session.lastKnownUrl = lastKnownUrl || session.lastKnownUrl || null;
    session.lastHealthyAt = new Date().toISOString();
  });
}

export async function markAutomationRequestActive(requestId) {
  return updateAutomationSession((session) => {
    session.activeRequestId = requestId || null;
  });
}

export async function clearAutomationRequestActive(requestId) {
  return updateAutomationSession((session) => {
    if (!requestId || session.activeRequestId === requestId) {
      session.activeRequestId = null;
    }
  });
}

export async function updateSessionConversation({ conversationUrl, conversationKey }) {
  if (!conversationUrl && !conversationKey) {
    return getAutomationSession();
  }

  return updateAutomationSession((session) => {
    if (conversationUrl) {
      session.currentConversationUrl = conversationUrl;
      session.lastKnownUrl = conversationUrl;
    }

    if (conversationKey) {
      session.currentConversationKey = conversationKey;
    }

    session.lastHealthyAt = new Date().toISOString();
  });
}

export async function clearAutomationTarget(reason = "") {
  return updateAutomationSession((session) => {
    session.targetType = null;
    session.tabId = null;
    session.windowId = null;
    session.offscreenDocumentUrl = null;
    session.activeRequestId = null;
    session.lastKnownUrl = reason ? `cleared:${reason}` : null;
  });
}

export async function clearAutomationTabIfMatches(tabId) {
  const session = await getAutomationSession();

  if (session.tabId !== tabId) {
    return session;
  }

  return updateAutomationSession((draft) => {
    draft.tabId = null;
    draft.windowId = null;
    draft.activeRequestId = null;
    draft.lastKnownUrl = "tab-removed";
  });
}

export async function setOffscreenCapability(capability) {
  return updateAutomationSession((session) => {
    session.offscreenCapability = {
      supported: Boolean(capability?.supported),
      checkedAt: capability?.checkedAt || new Date().toISOString(),
      failureReason: capability?.failureReason || null
    };
  });
}

export function summarizeAutomationSession(session) {
  const normalized = normalizeAutomationSession(session) || createDefaultAutomationSession();

  return {
    schemaVersion: normalized.schemaVersion,
    targetType: normalized.targetType,
    tabId: normalized.tabId,
    windowId: normalized.windowId,
    offscreenDocumentUrl: normalized.offscreenDocumentUrl,
    currentConversationUrl: normalized.currentConversationUrl,
    currentConversationKey: normalized.currentConversationKey,
    activeRequestId: normalized.activeRequestId,
    lastKnownUrl: normalized.lastKnownUrl,
    lastHealthyAt: normalized.lastHealthyAt,
    offscreenCapability: normalized.offscreenCapability
  };
}

function createDefaultAutomationSession() {
  return structuredClone(DEFAULT_SESSION);
}

function normalizeAutomationSession(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return {
    schemaVersion: AUTOMATION_SESSION_SCHEMA_VERSION,
    targetType: normalizeTargetType(value.targetType),
    tabId: Number.isInteger(value.tabId) ? value.tabId : null,
    windowId: Number.isInteger(value.windowId) ? value.windowId : null,
    offscreenDocumentUrl: typeof value.offscreenDocumentUrl === "string" ? value.offscreenDocumentUrl : null,
    currentConversationUrl: typeof value.currentConversationUrl === "string" ? value.currentConversationUrl : null,
    currentConversationKey: typeof value.currentConversationKey === "string" ? value.currentConversationKey : null,
    activeRequestId: typeof value.activeRequestId === "string" ? value.activeRequestId : null,
    lastKnownUrl: typeof value.lastKnownUrl === "string" ? value.lastKnownUrl : null,
    lastHealthyAt: typeof value.lastHealthyAt === "string" ? value.lastHealthyAt : null,
    offscreenCapability: normalizeOffscreenCapability(value.offscreenCapability)
  };
}

function normalizeLegacyAutomationWindowState(value) {
  if (!value || typeof value !== "object" || !Number.isInteger(value.tabId)) {
    return null;
  }

  return {
    ...createDefaultAutomationSession(),
    lastKnownUrl: "legacy-visible-tab-ignored"
  };
}

function normalizeTargetType(value) {
  if (value === AUTOMATION_TARGET_TYPES.OFFSCREEN_FRAME) {
    return value;
  }

  return null;
}

function normalizeOffscreenCapability(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return {
    supported: Boolean(value.supported),
    checkedAt: typeof value.checkedAt === "string" ? value.checkedAt : new Date().toISOString(),
    failureReason: typeof value.failureReason === "string" ? value.failureReason : null
  };
}
