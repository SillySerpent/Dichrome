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
  const { requestId, type } = messages[0].message;
  let resolved = false;
  void response.then(() => { resolved = true; });
  emit({ type: `${type}-result`, requestId, ok: true }, "https://evil.test");
  emit({ type: `${type}-result`, requestId, ok: true }, "https://chatgpt.com", {});
  emit({ type: `${type}-result`, requestId: "stale", ok: true });
  await Promise.resolve();
  assert.equal(resolved, false, "Only the target frame's matching reply may acknowledge insertion.");
  emit({ type: `${type}-result`, requestId, ok: true });
  assert.equal((await response).ok, true);
  const rejected = client.request(FRAME_MESSAGES.INSERT_PROMPT);
  emit({ type: `${type}-result`, requestId: messages.at(-1).message.requestId, ok: false, error: "Draft exists" });
  await assert.rejects(rejected, /Draft exists/);
  const cancelled = client.request(FRAME_MESSAGES.ATTACH_SCREENSHOT);
  client.cancel();
  await assert.rejects(cancelled, /reloaded/);
  await assert.rejects(client.request(FRAME_MESSAGES.PING, {}, 5), /did not respond/);

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
