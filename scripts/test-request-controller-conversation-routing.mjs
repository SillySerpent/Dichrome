import assert from "node:assert/strict";

globalThis.chrome = {
  storage: {
    local: {},
    session: null
  }
};

const { createRequestController } = await import("../background/runtime/request-controller.js");

const startCalls = [];
const requests = new Map([
  ["new-request", {
    id: "new-request",
    profileId: "custom_text",
    source: {
      tabId: 1,
      windowId: 2,
      title: "Source",
      url: "https://example.test"
    },
    selectedText: "",
    manualText: "retry this",
    conversationMode: "new",
    chatConversationUrl: "https://chatgpt.com/g/g-p-dichrome/c/stale",
    chatConversationKey: "stale",
    chatTabId: 44
  }],
  ["followup-request", {
    id: "followup-request",
    profileId: "custom_text",
    source: {
      tabId: 1,
      windowId: 2,
      title: "Source",
      url: "https://example.test"
    },
    selectedText: "",
    manualText: "continue this",
    conversationMode: "followup",
    chatConversationUrl: "https://chatgpt.com/g/g-p-dichrome/c/current",
    chatConversationKey: "current",
    chatTabId: 45
  }]
]);

const controller = createRequestController({
  appendEvent(request, detail) {
    request.events = [...(request.events || []), { detail }];
  },
  captureVisibleTabScreenshot: async () => null,
  disableFocusEmulationForRequest: async () => null,
  findOrCreateChatGptTab: async () => ({ id: 99 }),
  getProfile() {
    return {
      inputKind: "manual_text"
    };
  },
  getRequest: async (id) => requests.get(id),
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
  sendMessageToTab: async () => ({}),
  startRequest: async (payload) => {
    startCalls.push(payload);

    return {
      requestId: `started-${startCalls.length}`
    };
  },
  updateRequest: async (_id, mutator) => {
    const draft = {
      events: []
    };

    mutator(draft);
  }
});

await controller.retryRequest({
  requestId: "new-request"
});

assert.equal(startCalls[0].conversationMode, "new");
assert.equal(startCalls[0].expectedConversationUrl, null);
assert.equal(startCalls[0].expectedConversationKey, null);
assert.equal(startCalls[0].chatOptionsOverride.conversation.mode, "new");
assert.equal(startCalls[0].chatOptionsOverride.conversation.startNewChat, true);
assert.equal(startCalls[0].chatOptionsOverride.conversation.expectedConversationUrl, null);

await controller.retryRequest({
  requestId: "followup-request"
});

assert.equal(startCalls[1].conversationMode, "followup");
assert.equal(startCalls[1].expectedConversationUrl, "https://chatgpt.com/g/g-p-dichrome/c/current");
assert.equal(startCalls[1].chatOptionsOverride.project.enabled, false);
assert.equal(startCalls[1].chatOptionsOverride.conversation.mode, "continue");
assert.equal(startCalls[1].chatOptionsOverride.conversation.startNewChat, false);
assert.equal(startCalls[1].chatOptionsOverride.conversation.expectedConversationUrl, "https://chatgpt.com/g/g-p-dichrome/c/current");

await controller.startHistoryFollowupRequest({
  conversation: {
    id: "selected",
    url: "https://chatgpt.com/g/g-p-dichrome/c/selected"
  },
  text: "continue selected"
});

assert.equal(startCalls[2].conversationMode, "followup");
assert.equal(startCalls[2].expectedConversationUrl, "https://chatgpt.com/g/g-p-dichrome/c/selected");
assert.equal(startCalls[2].chatOptionsOverride.project.enabled, false);
assert.equal(startCalls[2].chatOptionsOverride.conversation.expectedConversationUrl, "https://chatgpt.com/g/g-p-dichrome/c/selected");

console.log("Request controller conversation routing tests passed.");
