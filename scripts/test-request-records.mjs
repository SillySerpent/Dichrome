import assert from "node:assert/strict";
import {
  REQUEST_STATES,
  createRequestRecord
} from "../background/state-machine.js";

const followup = createRequestRecord({
  id: "request-followup",
  profileId: "custom_text",
  sourceTab: {
    id: 10,
    windowId: 20,
    title: "Source",
    url: "https://example.test/source"
  },
  manualText: "Continue this",
  prompt: "Continue this",
  parentRequestId: "request-parent",
  conversationMode: "followup",
  expectedConversationUrl: "https://chatgpt.com/c/abc123",
  expectedConversationKey: "abc123"
});

assert.equal(followup.state, REQUEST_STATES.IDLE);
assert.equal(followup.parentRequestId, "request-parent");
assert.equal(followup.conversationMode, "followup");
assert.equal(followup.chatConversationUrl, "https://chatgpt.com/c/abc123");
assert.equal(followup.chatConversationKey, "abc123");
assert.equal(followup.expectedConversationUrl, "https://chatgpt.com/c/abc123");
assert.equal(followup.expectedConversationKey, "abc123");
assert.equal(followup.automationTargetType, null);

const normal = createRequestRecord({
  id: "request-normal",
  profileId: "custom_text",
  sourceTab: null,
  manualText: "New topic",
  prompt: "New topic",
  conversationMode: "unsupported"
});

assert.equal(normal.parentRequestId, null);
assert.equal(normal.conversationMode, "new");
assert.equal(normal.chatConversationUrl, null);
assert.equal(normal.chatConversationKey, null);

const sessionStore = new Map();
globalThis.chrome = {
  runtime: {
    sendMessage: async () => null
  },
  storage: {
    session: {
      async get(key) {
        return {
          [key]: sessionStore.get(key)
        };
      },
      async set(values) {
        for (const [key, value] of Object.entries(values)) {
          sessionStore.set(key, value);
        }
      }
    },
    local: null
  }
};

sessionStore.set("panelState", {
  activeRequestId: "legacy-ready",
  requests: [{
    id: "legacy-ready",
    state: "CHATGPT_TAB_READY"
  }]
});

const { getPanelState } = await import("../background/requests/store.js");
const panelState = await getPanelState();

assert.equal(panelState.requests[0].state, REQUEST_STATES.WORKSPACE_READY);

console.log("Request record tests passed.");
