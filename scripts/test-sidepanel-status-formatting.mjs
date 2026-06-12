import assert from "node:assert/strict";
import {
  REQUEST_ERROR_CODES,
  REQUEST_STATES
} from "../shared/contracts.js";
import {
  formatCompactDate,
  formatHistoryMeta,
  formatRequestStatus,
  formatState,
  isAuthRequired
} from "../sidepanel/runtime/status-formatting.js";

assert.equal(formatRequestStatus(null), "Ready");
assert.equal(formatRequestStatus({
  state: REQUEST_STATES.WORKSPACE_READY
}), "hidden workspace ready");
assert.equal(formatRequestStatus({
  state: "CHATGPT_TAB_READY"
}), "hidden workspace ready");
assert.equal(formatRequestStatus({
  state: REQUEST_STATES.ERROR_STATE,
  errorCode: REQUEST_ERROR_CODES.AUTH_REQUIRED
}), "Sign in required");
assert.equal(isAuthRequired({
  errorCode: REQUEST_ERROR_CODES.AUTH_REQUIRED
}), true);
assert.equal(formatState("PROMPT_SENT"), "prompt sent");
assert.equal(formatCompactDate("bad-date"), "");
assert.notEqual(formatCompactDate("2026-06-01T00:00:00.000Z"), "");
assert.equal(formatHistoryMeta({
  title: "Conversation"
}, "Dichrome"), "Dichrome");
assert.equal(formatHistoryMeta({
  updatedAt: "2026-06-01T00:00:00.000Z",
  projectName: "Research"
}), `${formatCompactDate("2026-06-01T00:00:00.000Z")} - Research`);

console.log("Side panel status formatting tests passed.");
