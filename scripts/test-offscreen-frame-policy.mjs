import assert from "node:assert/strict";

const sessionRuleUpdates = [];
let failNonTabRule = false;

globalThis.chrome = {
  tabs: {
    TAB_ID_NONE: -1
  },
  declarativeNetRequest: {
    async updateSessionRules(payload) {
      sessionRuleUpdates.push(payload);
      const addedRule = payload.addRules?.[0] || null;

      if (failNonTabRule && Array.isArray(addedRule?.condition?.tabIds)) {
        throw new Error("tabIds are not supported in this mock browser");
      }
    }
  }
};

const {
  disableOffscreenFramePolicyOverride,
  enableBroadOffscreenFramePolicyOverride,
  enableOffscreenFramePolicyOverride,
  getOffscreenFramePolicyStatus
} = await import("../background/automation/offscreen-frame-policy.js");

let status = await enableOffscreenFramePolicyOverride();
assert.equal(status.enabled, true);
assert.equal(status.supported, true);
assert.equal(status.scope, "non-tab-chatgpt-subframes");
assert.deepEqual(sessionRuleUpdates.at(-1).addRules[0].condition.tabIds, [-1]);
assert.deepEqual(sessionRuleUpdates.at(-1).addRules[0].condition.requestDomains, ["chatgpt.com", "chat.openai.com"]);
assert.deepEqual(sessionRuleUpdates.at(-1).addRules[0].condition.resourceTypes, ["sub_frame"]);
assert.deepEqual(sessionRuleUpdates.at(-1).addRules[0].action.responseHeaders.map((item) => item.header), [
  "x-frame-options",
  "content-security-policy"
]);

await disableOffscreenFramePolicyOverride();
assert.equal(getOffscreenFramePolicyStatus().enabled, false);
assert.deepEqual(sessionRuleUpdates.at(-1).removeRuleIds, [91001]);

failNonTabRule = true;
status = await enableOffscreenFramePolicyOverride();
assert.equal(status.enabled, true);
assert.equal(status.supported, true);
assert.equal(status.scope, "all-chatgpt-subframes");
assert.equal(sessionRuleUpdates.at(-1).addRules[0].condition.tabIds, undefined);
assert.match(status.error, /Non-tab-scoped frame policy rule failed/);

await disableOffscreenFramePolicyOverride();
assert.equal(getOffscreenFramePolicyStatus().enabled, false);

console.log("Offscreen frame policy tests passed.");
