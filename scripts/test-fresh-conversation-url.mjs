import assert from "node:assert/strict";
import { getFreshConversationUrl } from "../background/runtime/fresh-conversation-url.js";

const projectSettings = {
  conversation: {
    startNewChat: true
  },
  project: {
    enabled: true,
    name: "Dichrome",
    segment: "g-p-dichrome",
    url: "https://chatgpt.com/g/g-p-dichrome/project"
  }
};

assert.equal(
  getFreshConversationUrl(projectSettings, "https://chatgpt.com/g/g-p-dichrome/c/old-chat"),
  "https://chatgpt.com/g/g-p-dichrome/project"
);
assert.equal(
  getFreshConversationUrl(projectSettings, "https://chatgpt.com/"),
  "https://chatgpt.com/g/g-p-dichrome/project"
);
assert.equal(
  getFreshConversationUrl({
    conversation: {
      startNewChat: false
    },
    project: projectSettings.project
  }, "https://chatgpt.com/g/g-p-dichrome/c/old-chat"),
  null
);
assert.equal(
  getFreshConversationUrl({
    conversation: {
      startNewChat: true
    },
    project: {
      enabled: true,
      name: "Dichrome"
    }
  }, "https://chatgpt.com/c/old-chat"),
  "https://chatgpt.com/"
);
assert.equal(
  getFreshConversationUrl({
    conversation: {
      startNewChat: true
    },
    project: {
      enabled: false
    }
  }, "https://chatgpt.com/"),
  null
);

console.log("Fresh conversation URL tests passed.");
