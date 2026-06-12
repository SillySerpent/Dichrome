import {
  EVENT_LIMIT,
  HISTORY_LIMIT,
  PANEL_STATE_KEY,
  storageArea
} from "../constants.js";
import {
  PANEL_MESSAGES,
  normalizeRequestState
} from "../../shared/contracts.js";

let panelStateWriteQueue = Promise.resolve();

export async function storeAttachmentPayloads(requestId, attachments) {
  if (!attachments.length) {
    return;
  }

  await storageArea.set({
    [`attachments:${requestId}`]: attachments
  });
}

export async function restoreAttachmentPayloads(request) {
  if (!request?.attachments?.length) {
    return [];
  }

  const result = await storageArea.get(`attachments:${request.id}`);

  return result[`attachments:${request.id}`] || [];
}

export async function putRequest(request) {
  const panelState = await getPanelState();
  const nextRequests = [
    request,
    ...panelState.requests.filter((item) => item.id !== request.id)
  ].slice(0, HISTORY_LIMIT);

  await setPanelState({
    activeRequestId: request.id,
    requests: nextRequests
  });
}

export async function updateRequest(requestId, mutator) {
  const nextWrite = panelStateWriteQueue.then(() => updateRequestImmediately(requestId, mutator));
  panelStateWriteQueue = nextWrite.catch(() => null);

  return nextWrite;
}

export async function getRequest(requestId) {
  const panelState = await getPanelState();

  return panelState.requests.find((request) => request.id === requestId) || null;
}

export async function getPanelState() {
  const result = await storageArea.get(PANEL_STATE_KEY);

  return normalizePanelState(result[PANEL_STATE_KEY]);
}

export async function setPanelState(panelState) {
  const normalized = normalizePanelState(panelState);

  await storageArea.set({
    [PANEL_STATE_KEY]: normalized
  });

  await broadcastPanelState(normalized);
}

export function appendEvent(request, detail) {
  request.events = [
    ...(Array.isArray(request.events) ? request.events : []),
    {
      at: new Date().toISOString(),
      detail
    }
  ].slice(-EVENT_LIMIT);
}

async function updateRequestImmediately(requestId, mutator) {
  const panelState = await getPanelState();
  const index = panelState.requests.findIndex((request) => request.id === requestId);

  if (index === -1) {
    throw new Error(`Request not found: ${requestId}`);
  }

  const request = structuredClone(panelState.requests[index]);
  mutator(request);
  request.updatedAt = new Date().toISOString();

  const requests = [...panelState.requests];
  requests[index] = request;

  await setPanelState({
    ...panelState,
    requests
  });
}

function normalizePanelState(value) {
  if (!value || typeof value !== "object") {
    return {
      activeRequestId: null,
      requests: []
    };
  }

  const requests = Array.isArray(value.requests)
    ? value.requests.slice(0, HISTORY_LIMIT)
      .map(normalizeRequestRecord)
    : [];
  const activeRequestId = value.activeRequestId && requests.some((request) => request.id === value.activeRequestId)
    ? value.activeRequestId
    : requests[0]?.id || null;

  return {
    activeRequestId,
    requests
  };
}

function normalizeRequestRecord(request) {
  if (!request || typeof request !== "object") {
    return request;
  }

  return {
    ...request,
    state: normalizeRequestState(request.state)
  };
}

async function broadcastPanelState(panelState) {
  await chrome.runtime.sendMessage({
    type: PANEL_MESSAGES.PANEL_STATE_UPDATED,
    panelState
  }).catch(() => null);
}
