import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import {
  CHATGPT_HOME_URL,
  OFFSCREEN_FRAME_ROLES,
  OFFSCREEN_MESSAGES
} from "../shared/contracts.js";

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.listeners = new Map();
    this.id = "";
    this.name = "";
    this.src = "";
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    if (name === "src") {
      return this.src;
    }

    return this.attributes.get(name) || "";
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type) {
    for (const listener of this.listeners.get(type) || []) {
      listener();
    }
  }
}

const chatFrame = new FakeElement("iframe");
chatFrame.id = "chatgptChatFrame";
chatFrame.name = "dichrome-offscreen-chat";
chatFrame.src = CHATGPT_HOME_URL;
const historyFrame = new FakeElement("iframe");
historyFrame.id = "chatgptHistoryFrame";
historyFrame.name = "dichrome-offscreen-history";
historyFrame.src = CHATGPT_HOME_URL;
const elements = new Map([
  [chatFrame.id, chatFrame],
  [historyFrame.id, historyFrame]
]);
const listeners = [];
const context = vm.createContext({
  URL,
  chrome: {
    runtime: {
      onMessage: {
        addListener(listener) {
          listeners.push(listener);
        }
      }
    }
  },
  document: {
    getElementById(id) {
      return elements.get(id) || null;
    }
  },
  window: {
    setTimeout(callback) {
      callback();
      return 1;
    }
  }
});
const source = await readFile(new URL("../offscreen/automation-host.js", import.meta.url), "utf8");

vm.runInContext(source, context);

assert.equal(listeners.length, 1);

chatFrame.dispatch("load");
historyFrame.dispatch("load");

let response = sendMessage({
  type: OFFSCREEN_MESSAGES.HOST_STATUS
});

assert.equal(response.target, "offscreen-automation-host");
assert.equal(response.status.frameLoaded, true);
assert.equal(response.status.frames.chat.frameLoaded, true);
assert.equal(response.status.frames.history.frameLoaded, true);
assert.equal(response.status.hostKind, "chrome-offscreen");

response = sendMessage({
  type: OFFSCREEN_MESSAGES.HOST_RELOAD_FRAME,
  frameRole: OFFSCREEN_FRAME_ROLES.HISTORY,
  url: "https://chatgpt.com/g/g-p-dichrome/project"
});

assert.equal(response.reloaded, true);
assert.equal(response.frameRole, OFFSCREEN_FRAME_ROLES.HISTORY);
assert.equal(chatFrame.src, CHATGPT_HOME_URL);
assert.equal(historyFrame.src, "https://chatgpt.com/g/g-p-dichrome/project");

sendMessage({
  type: OFFSCREEN_MESSAGES.BRIDGE_STATUS,
  frameRole: OFFSCREEN_FRAME_ROLES.HISTORY,
  connected: true,
  frame: {
    frameRole: OFFSCREEN_FRAME_ROLES.HISTORY,
    href: "https://chatgpt.com/g/g-p-dichrome/project",
    readyState: "complete"
  },
  framePolicy: {
    enabled: true
  }
});

response = sendMessage({
  type: OFFSCREEN_MESSAGES.HOST_STATUS
});

assert.equal(response.status.frames.history.bridgeConnected, true);
assert.equal(response.status.frames.history.bridgeFrame.href, "https://chatgpt.com/g/g-p-dichrome/project");
assert.equal(response.status.frames.history.framePolicy.enabled, true);
assert.equal(response.status.frames.chat.bridgeConnected, false);

console.log("Chrome offscreen automation host tests passed.");

function sendMessage(message) {
  let response = null;
  const handled = listeners[0](message, {}, (payload) => {
    response = payload;
  });

  assert.equal(handled, false);
  return response;
}
