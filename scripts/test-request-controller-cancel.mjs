import assert from "node:assert/strict";

globalThis.chrome = {
  storage: {
    local: {},
    session: null
  }
};

const { REQUEST_STATES } = await import("../shared/contracts.js");
const { createRequestController } = await import("../background/runtime/request-controller.js");

const requests = new Map([
  ["offscreen-request", {
    id: "offscreen-request",
    profileLabel: "Custom Text Prompt",
    state: REQUEST_STATES.CHATGPT_TAB_READY,
    automationTargetType: "offscreen-frame",
    chatTabId: null,
    events: []
  }],
  ["tab-request", {
    id: "tab-request",
    profileLabel: "Custom Text Prompt",
    state: REQUEST_STATES.CHATGPT_TAB_READY,
    automationTargetType: "single-tab",
    chatTabId: 77,
    events: []
  }],
  ["completed-request", {
    id: "completed-request",
    profileLabel: "Custom Text Prompt",
    state: REQUEST_STATES.RESPONSE_COMPLETE,
    completedAt: "2026-05-19T00:00:00.000Z",
    automationTargetType: "offscreen-frame",
    chatTabId: null,
    events: []
  }]
]);
const offscreenMessages = [];
const tabMessages = [];
const clearedRequests = [];
const disabledFocusRequests = [];
const updatedRequests = [];

const controller = createRequestController({
  appendEvent(request, detail) {
    request.events = [...(request.events || []), { detail }];
  },
  captureVisibleTabScreenshot: async () => null,
  clearAutomationRequestActive: async (requestId) => {
    clearedRequests.push(requestId);
  },
  disableFocusEmulationForRequest: async (requestId) => {
    disabledFocusRequests.push(requestId);
  },
  findOrCreateChatGptTab: async () => ({ id: 99 }),
  getProfile() {
    return {
      inputKind: "manual_text"
    };
  },
  getRequest: async (id) => requests.get(id) || null,
  getSourceFocusTarget: () => ({}),
  normalizeText(value) {
    return String(value || "").trim();
  },
  queryBestSourceTab: async () => ({
    id: 10,
    windowId: 20,
    title: "Source",
    url: "https://example.test"
  }),
  restoreAttachmentPayloads: async () => [],
  sendMessageToOffscreenFrame: async (message) => {
    offscreenMessages.push(message);

    return {
      ok: true
    };
  },
  sendMessageToTab: async (tabId, message) => {
    tabMessages.push({
      tabId,
      message
    });

    return {
      ok: true
    };
  },
  startRequest: async () => ({
    requestId: "started-request"
  }),
  updateRequest: async (requestId, mutator) => {
    const current = requests.get(requestId);
    const draft = structuredClone(current);

    mutator(draft);
    requests.set(requestId, draft);
    updatedRequests.push(requestId);
  }
});

await controller.cancelRequest("offscreen-request");

assert.deepEqual(offscreenMessages, [{
  type: "CHATGPT_AUTOMATION_CANCEL",
  requestId: "offscreen-request"
}]);
assert.deepEqual(tabMessages, []);
assert.deepEqual(disabledFocusRequests, ["offscreen-request"]);
assert.deepEqual(clearedRequests, ["offscreen-request"]);
assert.equal(requests.get("offscreen-request").state, REQUEST_STATES.ERROR_STATE);
assert.equal(requests.get("offscreen-request").error, "Cancelled by user.");
assert.ok(requests.get("offscreen-request").completedAt);
assert.equal(requests.get("offscreen-request").events.at(-1).detail, "Request cancelled.");

await controller.cancelRequest("tab-request");

assert.deepEqual(tabMessages, [{
  tabId: 77,
  message: {
    type: "CHATGPT_AUTOMATION_CANCEL",
    requestId: "tab-request"
  }
}]);
assert.equal(offscreenMessages.length, 1);
assert.deepEqual(disabledFocusRequests, ["offscreen-request", "tab-request"]);
assert.deepEqual(clearedRequests, ["offscreen-request", "tab-request"]);
assert.equal(requests.get("tab-request").state, REQUEST_STATES.ERROR_STATE);
assert.equal(requests.get("tab-request").error, "Cancelled by user.");

await controller.cancelRequest("completed-request");

assert.equal(offscreenMessages.length, 2);
assert.equal(updatedRequests.includes("completed-request"), false);
assert.deepEqual(clearedRequests, ["offscreen-request", "tab-request", "completed-request"]);
assert.equal(requests.get("completed-request").state, REQUEST_STATES.RESPONSE_COMPLETE);

console.log("Request controller cancel tests passed.");
