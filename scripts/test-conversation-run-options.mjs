import assert from "node:assert/strict";
import { buildChatOptionsForAutomationRun } from "../background/runtime/conversation-run-options.js";

const baseSettings = {
  project: {
    enabled: true,
    name: "Dichrome",
    createIfMissing: true,
    segment: "g-p-dichrome",
    url: "https://chatgpt.com/g/g-p-dichrome/project"
  },
  conversation: {
    startNewChat: false,
    expectedConversationUrl: "https://chatgpt.com/g/g-p-dichrome/c/stale"
  },
  visibility: {
    mode: "hidden"
  },
  model: {
    enabled: true,
    label: "Instant",
    requireExact: false
  }
};

const newRequestOptions = buildChatOptionsForAutomationRun({
  automationSettings: baseSettings,
  request: {
    id: "new-request",
    conversationMode: "new",
    expectedConversationUrl: "https://chatgpt.com/g/g-p-dichrome/c/old-request"
  }
});

assert.equal(newRequestOptions.conversation.mode, "new");
assert.equal(newRequestOptions.conversation.startNewChat, true);
assert.equal(newRequestOptions.conversation.expectedConversationUrl, null);
assert.equal(newRequestOptions.model.label, "Instant");
assert.equal(newRequestOptions.project.segment, "g-p-dichrome");

const modelSwitchOptions = buildChatOptionsForAutomationRun({
  automationSettings: {
    ...baseSettings,
    model: {
      enabled: true,
      label: "Thinking",
      requireExact: true
    }
  },
  request: {
    id: "model-switch-request",
    conversationMode: "new"
  }
});

assert.equal(modelSwitchOptions.conversation.mode, "new");
assert.equal(modelSwitchOptions.conversation.startNewChat, true);
assert.equal(modelSwitchOptions.conversation.expectedConversationUrl, null);
assert.equal(modelSwitchOptions.model.label, "Thinking");

const followupOptions = buildChatOptionsForAutomationRun({
  automationSettings: baseSettings,
  request: {
    id: "followup-request",
    conversationMode: "followup",
    expectedConversationUrl: "https://chatgpt.com/g/g-p-dichrome/c/current"
  },
  visibilityModeOverride: "offscreen-frame"
});

assert.equal(followupOptions.conversation.mode, "continue");
assert.equal(followupOptions.conversation.startNewChat, false);
assert.equal(followupOptions.conversation.expectedConversationUrl, "https://chatgpt.com/g/g-p-dichrome/c/current");
assert.equal(followupOptions.visibility.mode, "offscreen-frame");

console.log("Conversation run option tests passed.");
