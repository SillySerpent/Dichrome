const DEBUGGER_PROTOCOL_VERSION = "1.3";

const activeSessionsByTabId = new Map();
const activeTabByRequestId = new Map();
let detachHandler = null;

export class FocusEmulationError extends Error {
  constructor(message) {
    super(message);
    this.name = "FocusEmulationError";
  }
}

export function setFocusEmulationDetachHandler(handler) {
  detachHandler = typeof handler === "function" ? handler : null;
}

export async function enableFocusEmulation({ tabId, requestId }) {
  if (!Number.isInteger(tabId) || !requestId) {
    throw new FocusEmulationError("Cannot enable ChatGPT focus emulation without a valid tab and request.");
  }

  if (!chrome.debugger) {
    throw new FocusEmulationError("Chrome debugger API is unavailable. Reload the extension after granting the debugger permission.");
  }

  const existingSession = activeSessionsByTabId.get(tabId);

  if (existingSession) {
    if (existingSession.requestId === requestId) {
      return existingSession;
    }

    throw new FocusEmulationError("ChatGPT focus emulation is already active for another request.");
  }

  const debuggee = {
    tabId
  };

  try {
    await chrome.debugger.attach(debuggee, DEBUGGER_PROTOCOL_VERSION);
    await chrome.debugger.sendCommand(debuggee, "Emulation.setFocusEmulationEnabled", {
      enabled: true
    });
    await chrome.debugger.sendCommand(debuggee, "Page.setWebLifecycleState", {
      state: "active"
    });
  } catch (error) {
    await detachDebuggee(debuggee).catch(() => null);
    throw new FocusEmulationError(`Could not enable background ChatGPT focus emulation. ${serializeDebuggerError(error)}`);
  }

  const session = {
    tabId,
    requestId,
    enabledAt: new Date().toISOString()
  };

  activeSessionsByTabId.set(tabId, session);
  activeTabByRequestId.set(requestId, tabId);

  return session;
}

export async function disableFocusEmulationForRequest(requestId) {
  const tabId = activeTabByRequestId.get(requestId);

  if (!tabId) {
    return;
  }

  await disableFocusEmulationForTab(tabId);
}

export async function disableFocusEmulationForTab(tabId) {
  const session = activeSessionsByTabId.get(tabId);

  if (!session) {
    return;
  }

  activeSessionsByTabId.delete(tabId);
  activeTabByRequestId.delete(session.requestId);

  const debuggee = {
    tabId
  };

  await chrome.debugger.sendCommand(debuggee, "Emulation.setFocusEmulationEnabled", {
    enabled: false
  }).catch(() => null);
  await detachDebuggee(debuggee).catch(() => null);
}

export function getFocusEmulationDebugState() {
  return Array.from(activeSessionsByTabId.values()).map((session) => ({
    tabId: session.tabId,
    requestId: session.requestId,
    enabledAt: session.enabledAt
  }));
}

chrome.debugger?.onDetach?.addListener((source, reason) => {
  const tabId = source?.tabId;

  if (!Number.isInteger(tabId)) {
    return;
  }

  const session = activeSessionsByTabId.get(tabId);

  if (!session) {
    return;
  }

  activeSessionsByTabId.delete(tabId);
  activeTabByRequestId.delete(session.requestId);

  if (detachHandler) {
    void detachHandler({
      tabId,
      requestId: session.requestId,
      reason: reason || "unknown"
    });
  }
});

chrome.tabs?.onRemoved?.addListener((tabId) => {
  const session = activeSessionsByTabId.get(tabId);

  if (!session) {
    return;
  }

  activeSessionsByTabId.delete(tabId);
  activeTabByRequestId.delete(session.requestId);
});

async function detachDebuggee(debuggee) {
  await chrome.debugger.detach(debuggee);
}

function serializeDebuggerError(error) {
  const message = error?.message || String(error || "Unknown debugger error");

  return `${message} If Chrome DevTools is already attached to the ChatGPT tab, close it and retry.`;
}
