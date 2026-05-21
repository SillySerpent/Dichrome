import assert from "node:assert/strict";
import {
  getUnreflectedLiveRequestsForHistory,
  historyContainsRequest
} from "../sidepanel/runtime/conversation-thread.js";

const historyMessages = [
  {
    role: "user",
    text: "Reply with 3 if you got the message"
  },
  {
    role: "assistant",
    text: "3"
  }
];
const reflectedRequest = {
  id: "request-1",
  manualText: "Reply with 3 if you got the message",
  responseText: "3"
};
const followupRequest = {
  id: "request-2",
  manualText: "reply 4",
  responseText: "4"
};

assert.equal(historyContainsRequest(historyMessages, reflectedRequest), true);
assert.equal(historyContainsRequest(historyMessages, followupRequest), false);
assert.deepEqual(
  getUnreflectedLiveRequestsForHistory(historyMessages, [reflectedRequest, followupRequest]).map((request) => request.id),
  ["request-2"]
);
assert.equal(historyContainsRequest([
  {
    role: "user",
    text: "Prompt still running"
  }
], {
  id: "request-3",
  manualText: "Prompt still running",
  responseText: ""
}), true);

console.log("Conversation thread tests passed.");
