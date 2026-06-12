import assert from "node:assert/strict";

const localStore = new Map();
const storageApi = {
  async get(keys) {
    if (Array.isArray(keys)) {
      return Object.fromEntries(keys.map((key) => [key, localStore.get(key)]));
    }

    if (typeof keys === "string") {
      return {
        [keys]: localStore.get(keys)
      };
    }

    return {};
  },
  async set(values) {
    for (const [key, value] of Object.entries(values)) {
      localStore.set(key, value);
    }
  },
  async remove(key) {
    localStore.delete(key);
  }
};

globalThis.chrome = {
  runtime: {
    id: "test-extension",
    getURL(path) {
      return `chrome-extension://test-extension/${path}`;
    }
  },
  storage: {
    local: storageApi,
    session: storageApi
  }
};

const {
  AUTOMATION_SESSION_KEY,
  AUTOMATION_TARGET_TYPES,
  clearAutomationRequestActive,
  getAutomationSession,
  markAutomationRequestActive,
  markAutomationTargetReady,
  setAutomationSession,
  setOffscreenCapability,
  summarizeAutomationSession,
  updateSessionConversation
} = await import("../background/automation/session.js");

const LEGACY_AUTOMATION_WINDOW_STATE_KEY = "chatGptAutomationWindowState";

localStore.set(LEGACY_AUTOMATION_WINDOW_STATE_KEY, {
  tabId: 42,
  windowId: 7
});

const migrated = await getAutomationSession();

assert.equal(migrated.targetType, null);
assert.equal(migrated.tabId, null);
assert.equal(migrated.windowId, null);
assert.equal(migrated.lastKnownUrl, null);
assert.equal(localStore.has(LEGACY_AUTOMATION_WINDOW_STATE_KEY), false);
assert.equal(localStore.has(AUTOMATION_SESSION_KEY), false);

await markAutomationTargetReady({
  targetType: AUTOMATION_TARGET_TYPES.OFFSCREEN_FRAME,
  offscreenDocumentUrl: "chrome-extension://test-extension/offscreen/automation-host.html",
  lastKnownUrl: "https://chatgpt.com/c/thread"
});
await updateSessionConversation({
  conversationUrl: "https://chatgpt.com/c/thread",
  conversationKey: "thread"
});
await markAutomationRequestActive("request-1");

const active = await getAutomationSession();

assert.equal(active.tabId, null);
assert.equal(active.windowId, null);
assert.equal(active.offscreenDocumentUrl, "chrome-extension://test-extension/offscreen/automation-host.html");
assert.equal(active.currentConversationUrl, "https://chatgpt.com/c/thread");
assert.equal(active.currentConversationKey, "thread");
assert.equal(active.activeRequestId, "request-1");

await clearAutomationRequestActive("different-request");
assert.equal((await getAutomationSession()).activeRequestId, "request-1");

await clearAutomationRequestActive("request-1");
assert.equal((await getAutomationSession()).activeRequestId, null);

const cleared = await getAutomationSession();

assert.equal(cleared.tabId, null);
assert.equal(cleared.windowId, null);
assert.equal(cleared.lastKnownUrl, "https://chatgpt.com/c/thread");

await setOffscreenCapability({
  supported: false,
  checkedAt: "2026-05-14T00:00:00.000Z",
  failureReason: "iframe blocked"
});

assert.deepEqual((await getAutomationSession()).offscreenCapability, {
  supported: false,
  checkedAt: "2026-05-14T00:00:00.000Z",
  failureReason: "iframe blocked"
});

await setAutomationSession(null);
assert.equal(summarizeAutomationSession(await getAutomationSession()).schemaVersion, 1);

console.log("Automation session tests passed.");
