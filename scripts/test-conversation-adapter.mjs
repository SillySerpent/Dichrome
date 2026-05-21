import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const projectListRow = {
  innerText: "May 19\nExisting project list row",
  textContent: "May 19\nExisting project list row"
};
const assistantMessage = {
  innerText: "Assistant response",
  textContent: "Assistant response"
};
let visibleElements = [];
let offscreenAutomationFrame = false;

const context = vm.createContext({
  ChatGptRelay: {},
  location: new URL("https://chatgpt.com/g/g-p-dichrome/project")
});
const source = await readFile(new URL("../content/chatgpt/runtime/adapter/conversation.js", import.meta.url), "utf8");

vm.runInContext(source, context);

const methods = context.ChatGptRelay.runtime.adapterConversation.createMethods({
  REQUEST_STATES: {
    CONVERSATION_READY: "CONVERSATION_READY",
    CHATGPT_TAB_READY: "CHATGPT_TAB_READY"
  },
  clickElement() {},
  emitState() {},
  extractProjectPathSegment(pathname) {
    return String(pathname || "").match(/^\/g\/(g-p-[^/]+)/)?.[1] || "";
  },
  getElementLabel() {
    return "";
  },
  isDisabled() {
    return false;
  },
  isOffscreenAutomationFrame() {
    return offscreenAutomationFrame;
  },
  isVisible(element) {
    return visibleElements.includes(element);
  },
  normalizeComparableText(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  },
  normalizeConversationOptions(value) {
    return {
      mode: value?.mode === "continue" ? "continue" : "new",
      startNewChat: value?.startNewChat !== false
    };
  },
  normalizeProjectNavigationHref() {
    return "";
  },
  normalizeProjectOptions(value) {
    return {
      enabled: Boolean(value?.enabled),
      name: String(value?.name || ""),
      segment: String(value?.segment || ""),
      url: String(value?.url || "")
    };
  },
  normalizeText(value) {
    return String(value || "").trim();
  },
  queryAllSafe(selector) {
    if (selector.includes("[data-message-author-role]")) {
      return visibleElements.filter((element) => element === assistantMessage);
    }

    if (selector === "main article") {
      return [projectListRow];
    }

    return [];
  },
  scoreNewChatCandidate() {
    return 0;
  },
  waitFor: async (producer) => producer()
});

const adapter = {
  ...methods
};

visibleElements = [projectListRow];
assert.equal(adapter.hasExistingConversation(), false);

visibleElements = [assistantMessage];
assert.equal(adapter.hasExistingConversation(), true);

context.location = new URL("https://chatgpt.com/g/g-p-dichrome/c/current");
visibleElements = [];
assert.equal(adapter.hasExistingConversation(), true);

offscreenAutomationFrame = true;
await assert.rejects(
  () => adapter.ensureFreshConversation({
    mode: "new",
    startNewChat: true
  }, {
    enabled: true,
    name: "Dichrome",
    segment: "g-p-dichrome",
    url: "https://chatgpt.com/g/g-p-dichrome/project"
  }, "request-id", {}),
  /Hidden fresh-chat navigation was not prepared/
);

console.log("Conversation adapter tests passed.");
