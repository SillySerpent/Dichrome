import assert from "node:assert/strict";
import { installFakeDocument } from "./test-utils/fake-dom.mjs";
import { createMessageCardFactory } from "../sidepanel/runtime/message-cards.js";

installFakeDocument();

const enhanced = [];
const liveResponse = document.createElement("div");
liveResponse.textContent = "Streaming";
const cards = createMessageCardFactory({
  responseText: liveResponse,
  responseView: {
    enhanceContainer(element) {
      enhanced.push(element);
    }
  }
});

const userCard = cards.createUserRequestCard({
  manualText: "Question",
  selectedText: "Selected context",
  attachments: [{
    name: "report.pdf"
  }]
});

assert.equal(userCard.className, "message-card user-message");
assert.equal(userCard.children[1].textContent, "Question");
assert.equal(userCard.children[2].textContent, "Selected text: Selected context");
assert.equal(userCard.children[3].children[0].textContent, "report.pdf");

const historyAssistantCard = cards.createHistoryMessageCard({
  role: "assistant",
  text: "**Answer**"
});

assert.equal(historyAssistantCard.className, "message-card assistant-message");
assert.equal(enhanced.length, 1);
assert.match(historyAssistantCard.children[1].children[0].innerHTML, /<strong>Answer<\/strong>/);

const activeAssistantCard = cards.createAssistantRequestCard({
  state: "STREAMING_RESPONSE"
}, true);

assert.equal(activeAssistantCard.children[1].children[0], liveResponse);

const empty = cards.createEmptyChat({
  title: "Start",
  body: "Message below.",
  includeShortcutHint: true
});

assert.equal(empty.className, "empty-chat");
assert.equal(empty.children.length, 3);
assert.equal(empty.children[2].attributes["aria-label"], "Side panel shortcut");

console.log("Side panel message card tests passed.");
