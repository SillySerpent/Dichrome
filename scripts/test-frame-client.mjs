import assert from "node:assert/strict";
import { createFrameClient, FRAME_MESSAGES, sanitizeChatGptUrl } from "../sidepanel/mode2/frame-client.js";
import { openPanelForUserAction } from "../background/runtime/panel-gesture.js";
import { createSidePanelState } from "../background/runtime/side-panel-state.js";

const savedWindow = globalThis.window;
const savedChrome = globalThis.chrome;
const listeners = new Set();
globalThis.window = { addEventListener: (_type, listener) => listeners.add(listener) };
const messages = [];
const target = { postMessage: (message, origin) => messages.push({ message, origin }) };
const frame = { src: "https://chatgpt.com/", contentWindow: target };
const emit = (data, origin = "https://chatgpt.com", source = target) => {
  for (const listener of listeners) listener({ data, source, origin });
};
try {
  assert.equal(sanitizeChatGptUrl("https://chatgpt.com/c/123"), "https://chatgpt.com/c/123");
  for (const url of ["javascript:alert(1)", "https://chatgpt.com.evil.test/", "http://chatgpt.com/", "https://chatgpt.com/backend-api/a", "https://user:password@chatgpt.com/"]) {
    assert.equal(sanitizeChatGptUrl(url), null);
  }
  const client = createFrameClient(frame);
  const response = client.request(FRAME_MESSAGES.INSERT_PROMPT, { prompt: "A real prompt" });
  assert.equal(messages.length, 0, "Do not post to a frame before its live document announces an allowed origin.");
  emit({ type: "dichrome:mode2:bridge-unload" });
  emit({ type: "dichrome:mode2:bridge-ready", documentId: "document-1" }, "null");
  assert.equal(messages.length, 0, "Opaque frames must never receive the queued prompt.");
  emit({ type: "dichrome:mode2:bridge-ready", documentId: "document-1" });
  assert.equal(messages.length, 1, "Send once to the announced origin, not to every allowed origin.");
  assert.equal(messages[0].origin, "https://chatgpt.com");
  const { requestId, type } = messages[0].message;
  let resolved = false;
  void response.then(() => { resolved = true; });
  emit({ type: `${type}-result`, requestId, ok: true }, "https://evil.test");
  emit({ type: `${type}-result`, requestId, ok: true }, "https://chatgpt.com", {});
  emit({ type: `${type}-result`, requestId: "stale", ok: true });
  await Promise.resolve();
  assert.equal(resolved, false, "Only the target frame's matching reply may acknowledge insertion.");
  emit({ type: `${type}-result`, requestId, documentId: "document-1", ok: true });
  assert.equal((await response).ok, true);
  const rejected = client.request(FRAME_MESSAGES.INSERT_PROMPT);
  emit({ type: `${type}-result`, requestId: messages.at(-1).message.requestId, documentId: "document-1", ok: false, error: "Draft exists" });
  await assert.rejects(rejected, /Draft exists/);
  const cancelled = client.request(FRAME_MESSAGES.ATTACH_SCREENSHOT);
  client.cancel();
  await assert.rejects(cancelled, /reloaded/);
  await assert.rejects(client.request(FRAME_MESSAGES.PING, {}, 5), /did not respond/);
  client.disconnect();
  const countBeforeRedirect = messages.length;
  frame.src = "https://chat.openai.com/";
  const redirected = client.request(FRAME_MESSAGES.PING);
  assert.equal(messages.length, countBeforeRedirect);
  emit({ type: "dichrome:mode2:bridge-ready", documentId: "document-2" }, "https://chatgpt.com");
  assert.equal(messages.at(-1).origin, "https://chatgpt.com", "Use the live origin after an allowed-host redirect.");
  emit({ type: `${FRAME_MESSAGES.PING}-result`, requestId: messages.at(-1).message.requestId, documentId: "document-2", ok: true });
  await redirected;
  emit({ type: "dichrome:mode2:bridge-unload", documentId: "document-1" });
  const active = client.request(FRAME_MESSAGES.PING);
  emit({ type: "dichrome:mode2:bridge-unload", documentId: "document-2" });
  await assert.rejects(active, /reloaded/);

  let openedSynchronously = false;
  globalThis.chrome = { sidePanel: { open: () => {
    openedSynchronously = true;
    return Promise.resolve();
  } } };
  const panel = createSidePanelState();
  const opening = openPanelForUserAction({ type: "chatgpt-sidebar:selection-action" }, { tab: { id: 7 } }, panel.openSidePanel);
  assert.equal(openedSynchronously, true, "Opening must happen before the event handler yields to storage.");
  assert.equal((await opening).panelOpened, true);
  chrome.sidePanel.open = async () => { throw new Error("User gesture expired"); };
  const failure = await openPanelForUserAction({ type: "chatgpt-sidebar:selection-action" }, { tab: { id: 7 } }, panel.openSidePanel);
  assert.equal(failure.panelOpened, false);
  assert.match(failure.panelError, /gesture expired/);
  openedSynchronously = false;
  await openPanelForUserAction({ type: "unrelated" }, { tab: { id: 7 } }, panel.openSidePanel);
  assert.equal(openedSynchronously, false);
  console.log("Frame acknowledgment, cancellation, URL validation, and panel gesture tests passed.");
} finally {
  globalThis.window = savedWindow;
  globalThis.chrome = savedChrome;
}
