import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const context = vm.createContext({
  URL,
  console,
  location: new URL("https://chatgpt.com/g/g-p-research/project"),
  document: {
    title: "ChatGPT - Research Project"
  }
});

const source = await readFile(new URL("../content/chatgpt/runtime/url/chatgpt-url.js", import.meta.url), "utf8");

vm.runInContext(source, context);

const urlRuntime = context.ChatGptRelay.runtime.chatGptUrl;

assert.equal(urlRuntime.isAllowedChatGptUrl(new URL("https://chatgpt.com/")), true);
assert.equal(urlRuntime.isAllowedChatGptUrl(new URL("https://chat.openai.com/c/abc")), true);
assert.equal(urlRuntime.isAllowedChatGptUrl(new URL("http://chatgpt.com/")), false);
assert.equal(urlRuntime.isAllowedChatGptUrl(new URL("https://example.com/")), false);
assert.equal(urlRuntime.isNonAutomationChatGptFrame("https://chatgpt.com/backend-api/sentinel/frame.html"), true);
assert.equal(urlRuntime.isNonAutomationChatGptFrame("https://chatgpt.com/api/foo"), true);
assert.equal(urlRuntime.isNonAutomationChatGptFrame("https://chatgpt.com/auth/login"), true);
assert.equal(urlRuntime.isNonAutomationChatGptFrame("https://chatgpt.com/"), false);
assert.equal(urlRuntime.sanitizeChatGptNavigationUrl("https://example.com/c/abc"), "");
assert.equal(urlRuntime.normalizeLocationForComparison("https://chatgpt.com/c/abc?x=1#frag"), "https://chatgpt.com/c/abc");
assert.equal(urlRuntime.extractConversationKey("https://chatgpt.com/c/conversation-id"), "conversation-id");
assert.equal(urlRuntime.extractProjectPathSegment("/g/g-p-123/project"), "g-p-123");
assert.equal(urlRuntime.normalizeProjectNavigationHref("/g/g-p-123/c/old"), "https://chatgpt.com/g/g-p-123/project");
assert.equal(urlRuntime.urlLooksProjectScopedForName("Research Project"), true);

console.log("Content runtime URL tests passed.");
