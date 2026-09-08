import assert from "node:assert/strict";
import { createContextMenuController } from "../background/runtime/context-menu.js";

const originalChrome = globalThis.chrome;
const items = new Map();
let removeCalls = 0;
let failRemoval = false;
let failCreation = false;
const callbackWithError = (callback, message) => {
  chrome.runtime.lastError = message ? { message } : undefined;
  callback();
  delete chrome.runtime.lastError;
};
globalThis.chrome = {
  runtime: {},
  contextMenus: {
    removeAll(callback) {
      removeCalls++;
      queueMicrotask(() => {
        if (!failRemoval) items.clear();
        callbackWithError(callback, failRemoval ? "Menu storage unavailable" : "");
      });
    },
    create(item, callback) {
      const error = failCreation ? "Menu creation failed" : items.has(item.id) ? `Cannot create item with duplicate id ${item.id}` : "";
      if (!error) items.set(item.id, item);
      queueMicrotask(() => callbackWithError(callback, error));
    }
  }
};
try {
  const controller = createContextMenuController({});
  const first = controller.createContextMenus();
  const overlapping = controller.createContextMenus();
  const results = await Promise.allSettled([first, overlapping]);
  assert.deepEqual(results.map((result) => result.status), ["fulfilled", "fulfilled"],
    "Concurrent install/startup must share one menu rebuild instead of creating duplicate IDs.");
  assert.equal(removeCalls, 1);
  assert.equal(items.size, 8);
  assert.equal(items.get("dichrome:summarize-selection").title, "Summarize with Dichrome");
  await controller.createContextMenus();
  assert.equal(removeCalls, 2, "A later rebuild must still be possible.");
  failRemoval = true;
  await assert.rejects(controller.createContextMenus(), /Menu storage unavailable/);
  failRemoval = false;
  failCreation = true;
  await assert.rejects(controller.createContextMenus(), /Menu creation failed/);
  failCreation = false;
  await controller.createContextMenus();
  assert.equal(items.size, 8, "Failed initialization must permit a subsequent complete rebuild.");
  console.log("Context menu initialization concurrency and recovery tests passed.");
} finally { globalThis.chrome = originalChrome; }
