import assert from "node:assert/strict";
import { createMode2CompanionController } from "../background/mode2/companion-controller.js";

const stored = {};
const calls = [];
const originalChrome = globalThis.chrome;
globalThis.chrome = { storage: { session: { set: async (values) => {
  calls.push("store");
  Object.assign(stored, values);
} } } };
try {
  const controller = createMode2CompanionController({
    openSidePanel: async () => calls.push("open"),
    queryBestSourceTab: async () => ({ id: 7, windowId: 1 }),
    captureVisibleTabScreenshot: async () => ({ dataUrl: "data:image/png;base64,YQ==" })
  });
  const result = await controller.queuePromptFromSelection({
    action: "explain", selectedText: "A selected passage", sourceTab: { id: 7 },
    pageTitle: "Source", pageUrl: "https://example.com/"
  });
  assert.equal(result.queued, true);
  assert.match(result.prompt.prompt, /A selected passage/);
  assert.match(result.prompt.prompt, /https:\/\/example.com\//);
  assert.equal(calls.includes("open"), false,
    "The storage controller must not attempt to open a panel after async persistence; the gesture entrypoint owns opening.");
  await assert.rejects(controller.queuePromptFromSelection({ action: "unknown", selectedText: "text" }), /Unsupported/);
  const empty = await controller.queuePromptFromSelection({ action: "ask", selectedText: "  " });
  assert.equal(empty.queued, false);
  assert.equal(stored["dichrome.mode2.latestPrompt"].id, result.prompt.id);
  const long = await controller.queuePromptFromSelection({ action: "summarize", selectedText: "a".repeat(25000) });
  assert.equal(long.prompt.selectedTextWasTruncated, true);
  assert.equal(long.prompt.selectedText.length, 24000);
  console.log("Mode 2 selection persistence tests passed.");
} finally {
  globalThis.chrome = originalChrome;
}
