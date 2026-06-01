import assert from "node:assert/strict";
import {
  createSelectionKey,
  normalizeSelectionText,
  resolveSelectedContextUpdate
} from "../sidepanel/runtime/selection-context.js";

assert.equal(normalizeSelectionText("  first line \r\n  second line  "), "first line\n  second line");
assert.equal(createSelectionKey("x".repeat(1200)).length, 1000);

let update = resolveSelectedContextUpdate({
  currentContext: null,
  dismissedSelectionKey: "",
  selection: {
    text: "  selected text  ",
    title: "Example",
    url: "https://example.test"
  }
});

assert.equal(update.changed, true);
assert.deepEqual(update.selectedContext, {
  id: "selected text",
  text: "selected text",
  sourceTitle: "Example",
  sourceUrl: "https://example.test"
});
assert.equal(update.dismissedSelectionKey, "");

update = resolveSelectedContextUpdate({
  currentContext: update.selectedContext,
  dismissedSelectionKey: "",
  selection: {
    text: "different text",
    title: "Example",
    url: "https://example.test"
  }
});

assert.equal(update.changed, true);
assert.equal(update.selectedContext.text, "different text");

update = resolveSelectedContextUpdate({
  currentContext: update.selectedContext,
  dismissedSelectionKey: "",
  selection: {
    text: "",
    title: "Example",
    url: "https://example.test"
  }
});

assert.equal(update.changed, true);
assert.equal(update.selectedContext, null);
assert.equal(update.dismissedSelectionKey, "");

update = resolveSelectedContextUpdate({
  currentContext: null,
  dismissedSelectionKey: "dismiss me",
  selection: {
    text: "dismiss me",
    title: "Example",
    url: "https://example.test"
  }
});

assert.equal(update.changed, false);
assert.equal(update.selectedContext, null);
assert.equal(update.dismissedSelectionKey, "dismiss me");

update = resolveSelectedContextUpdate({
  currentContext: null,
  dismissedSelectionKey: "dismiss me",
  selection: {
    text: "",
    title: "Example",
    url: "https://example.test"
  }
});

assert.equal(update.changed, false);
assert.equal(update.selectedContext, null);
assert.equal(update.dismissedSelectionKey, "");

update = resolveSelectedContextUpdate({
  currentContext: {
    id: "same text",
    text: "same text",
    sourceTitle: "Old",
    sourceUrl: "https://example.test/old"
  },
  dismissedSelectionKey: "",
  selection: {
    text: "same text",
    title: "New",
    url: "https://example.test/new"
  }
});

assert.equal(update.changed, true);
assert.equal(update.selectedContext.sourceTitle, "New");
assert.equal(update.selectedContext.sourceUrl, "https://example.test/new");

console.log("Side panel selection context tests passed.");
