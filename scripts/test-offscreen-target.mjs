import assert from "node:assert/strict";
import {
  CHATGPT_AUTOMATION_MESSAGES,
  OFFSCREEN_FRAME_PORT_NAME,
  OFFSCREEN_MESSAGES
} from "../shared/contracts.js";

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
  }
};

globalThis.chrome = {
  runtime: {
    id: "test-extension",
    getURL(path) {
      return `chrome-extension://test-extension/${path}`;
    },
    async sendMessage() {
      return null;
    }
  },
  storage: {
    local: storageApi,
    session: storageApi
  }
};

function createEvent() {
  const listeners = [];

  return {
    addListener(listener) {
      listeners.push(listener);
    },
    emit(...args) {
      for (const listener of listeners) {
        listener(...args);
      }
    }
  };
}

function createMockPort({
  name = OFFSCREEN_FRAME_PORT_NAME,
  url = "https://chatgpt.com/",
  tabId = null
} = {}) {
  const port = {
    name,
    sender: {
      url,
      tab: Number.isInteger(tabId) ? { id: tabId } : undefined
    },
    messages: [],
    disconnected: false,
    onMessage: createEvent(),
    onDisconnect: createEvent(),
    postMessage(message) {
      this.messages.push(message);
    },
    disconnect() {
      if (this.disconnected) {
        return;
      }

      this.disconnected = true;
      this.onDisconnect.emit();
    }
  };

  return port;
}

const {
  getOffscreenFrameStatus,
  handleOffscreenFramePort,
  sendMessageToOffscreenFrame
} = await import("../background/automation/offscreen-target.js");

const tabPort = createMockPort({
  tabId: 7
});

assert.equal(handleOffscreenFramePort(tabPort), false);
assert.equal(tabPort.disconnected, true);
assert.equal(getOffscreenFrameStatus().connected, false);

const sentinelPort = createMockPort({
  url: "https://chatgpt.com/backend-api/sentinel/frame.html?sv=test"
});

assert.equal(handleOffscreenFramePort(sentinelPort), false);
assert.equal(sentinelPort.disconnected, true);
assert.equal(getOffscreenFrameStatus().connected, false);

const apiPort = createMockPort({
  url: "https://chatgpt.com/api/something"
});

assert.equal(handleOffscreenFramePort(apiPort), false);
assert.equal(apiPort.disconnected, true);
assert.equal(getOffscreenFrameStatus().connected, false);

const firstPort = createMockPort();

assert.equal(handleOffscreenFramePort(firstPort), true);
firstPort.onMessage.emit({
  type: OFFSCREEN_MESSAGES.FRAME_READY,
  frame: {
    href: "https://chatgpt.com/",
    readyState: "complete"
  }
});
assert.equal(getOffscreenFrameStatus().connected, true);

const secondPort = createMockPort();

assert.equal(handleOffscreenFramePort(secondPort), true);
secondPort.onMessage.emit({
  type: OFFSCREEN_MESSAGES.FRAME_READY,
  frame: {
    href: "https://chatgpt.com/",
    readyState: "complete"
  }
});
assert.equal(firstPort.disconnected, true);
assert.equal(getOffscreenFrameStatus().connected, true);

const commandPromise = sendMessageToOffscreenFrame({
  type: CHATGPT_AUTOMATION_MESSAGES.DUMP
});

assert.equal(secondPort.messages.length, 1);
const commandId = secondPort.messages[0].commandId;

firstPort.disconnect();
secondPort.onMessage.emit({
  type: OFFSCREEN_MESSAGES.FRAME_COMMAND_RESPONSE,
  commandId,
  response: {
    ok: true
  }
});

assert.deepEqual(await commandPromise, {
  ok: true
});

secondPort.disconnect();
assert.equal(getOffscreenFrameStatus().connected, false);

console.log("Offscreen target tests passed.");
