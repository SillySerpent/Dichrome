export function summarizeDebugData(data) {
  if (!data || typeof data !== "object") {
    return "";
  }

  return Object.entries(data)
    .slice(0, 5)
    .map(([key, value]) => `${key}=${summarizeScalar(value)}`)
    .join(", ");
}

export function summarizeRequestForDebug(request) {
  return {
    id: request.id,
    profileId: request.profileId,
    state: request.state,
    source: request.source,
    chatTabId: request.chatTabId,
    automationVisibilityMode: request.automationVisibilityMode || null,
    selectedTextLength: request.selectedText?.length || 0,
    manualTextLength: request.manualText?.length || 0,
    promptLength: request.prompt?.length || 0,
    responseTextLength: request.responseText?.length || 0,
    responseHtmlLength: request.responseHtml?.length || 0,
    error: request.error,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    completedAt: request.completedAt,
    events: (request.events || []).slice(-20)
  };
}

export function summarizeTabForDebug(tab) {
  return {
    id: tab.id,
    windowId: tab.windowId,
    active: tab.active,
    highlighted: tab.highlighted,
    status: tab.status,
    discarded: tab.discarded,
    audible: tab.audible,
    title: tab.title,
    url: sanitizeUrlForDebug(tab.url || tab.pendingUrl || "")
  };
}

export function summarizeWindowForDebug(window) {
  return {
    id: window.id,
    focused: window.focused,
    state: window.state,
    type: window.type,
    left: window.left,
    top: window.top,
    width: window.width,
    height: window.height,
    tabs: (window.tabs || []).map((tab) => ({
      id: tab.id,
      active: tab.active,
      title: tab.title,
      url: sanitizeUrlForDebug(tab.url || tab.pendingUrl || "")
    }))
  };
}

function summarizeScalar(value) {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "string") {
    return value.slice(0, 80);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return `[${value.length}]`;
  }

  return "{...}";
}

function sanitizeUrlForDebug(value) {
  try {
    const url = new URL(value);

    return `${url.origin}${url.pathname}`;
  } catch (_error) {
    return value;
  }
}
