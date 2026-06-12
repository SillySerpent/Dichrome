import assert from "node:assert/strict";
import {
  CHATGPT_AUTOMATION_MESSAGES,
  OFFSCREEN_FRAME_PORT_NAME,
  OFFSCREEN_FRAME_ROLES,
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
  offscreen: {
    async createDocument() {},
    async closeDocument() {},
    Reason: {
      IFRAME_SCRIPTING: "IFRAME_SCRIPTING"
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

function announceReady(port, frameRole, href = "https://chatgpt.com/") {
  port.onMessage.emit({
    type: OFFSCREEN_MESSAGES.FRAME_READY,
    frameRole,
    frame: {
      frameRole,
      href,
      readyState: "complete"
    }
  });
}

const {
  getOffscreenFrameStatus,
  getOffscreenTargetDescriptor,
  handleOffscreenFramePort,
  probeOffscreenAutomationTarget,
  reloadOffscreenFrameToUrl,
  sendMessageToOffscreenFrame
} = await import("../background/automation/offscreen-target.js");

assert.equal(
  getOffscreenTargetDescriptor().offscreenDocumentUrl,
  "chrome-extension://test-extension/offscreen/automation-host.html"
);

let hostProbeCalls = 0;
globalThis.chrome.runtime.sendMessage = async (message) => {
  if (message?.type === OFFSCREEN_MESSAGES.HOST_PROBE) {
    hostProbeCalls += 1;
    return {
      target: "offscreen-automation-host",
      supported: true,
      status: {
        frameLoaded: true,
        frames: {
          chat: {
            frameLoaded: true
          },
          history: {
            frameLoaded: true
          }
        }
      }
    };
  }

  return null;
};

const concurrentProbeOne = probeOffscreenAutomationTarget();
const concurrentProbeTwo = probeOffscreenAutomationTarget();
const warmupPort = createMockPort();

assert.equal(handleOffscreenFramePort(warmupPort), true);
announceReady(warmupPort, OFFSCREEN_FRAME_ROLES.CHAT);

const probeResults = await Promise.all([concurrentProbeOne, concurrentProbeTwo]);

assert.equal(probeResults[0], probeResults[1]);
assert.equal(probeResults[0].supported, true);
assert.equal(probeResults[0].failureReason, null);
assert.equal(hostProbeCalls, 1);
warmupPort.disconnect();
assert.equal(getOffscreenFrameStatus().connected, false);
globalThis.chrome.runtime.sendMessage = async () => null;

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

const chatPort = createMockPort();
const firstHistoryPort = createMockPort();

assert.equal(handleOffscreenFramePort(chatPort), true);
announceReady(chatPort, OFFSCREEN_FRAME_ROLES.CHAT);
assert.equal(handleOffscreenFramePort(firstHistoryPort), true);
announceReady(firstHistoryPort, OFFSCREEN_FRAME_ROLES.HISTORY, "https://chatgpt.com/g/g-p-dichrome/project");
assert.equal(getOffscreenFrameStatus(OFFSCREEN_FRAME_ROLES.CHAT).connected, true);
assert.equal(getOffscreenFrameStatus(OFFSCREEN_FRAME_ROLES.HISTORY).connected, true);
assert.equal(getOffscreenFrameStatus().frames.history.connected, true);

const secondHistoryPort = createMockPort();

assert.equal(handleOffscreenFramePort(secondHistoryPort), true);
announceReady(secondHistoryPort, OFFSCREEN_FRAME_ROLES.HISTORY, "https://chatgpt.com/g/g-p-dichrome/project");
assert.equal(firstHistoryPort.disconnected, true);
assert.equal(chatPort.disconnected, false);
assert.equal(getOffscreenFrameStatus(OFFSCREEN_FRAME_ROLES.CHAT).connected, true);
assert.equal(getOffscreenFrameStatus(OFFSCREEN_FRAME_ROLES.HISTORY).connected, true);

const chatCommandPromise = sendMessageToOffscreenFrame({
  type: CHATGPT_AUTOMATION_MESSAGES.DUMP
});

assert.equal(chatPort.messages.length, 1);
assert.equal(secondHistoryPort.messages.length, 0);
chatPort.onMessage.emit({
  type: OFFSCREEN_MESSAGES.FRAME_COMMAND_RESPONSE,
  commandId: chatPort.messages[0].commandId,
  response: {
    ok: true,
    frame: "chat"
  }
});
assert.deepEqual(await chatCommandPromise, {
  ok: true,
  frame: "chat"
});

const historyCommandPromise = sendMessageToOffscreenFrame({
  type: CHATGPT_AUTOMATION_MESSAGES.LIST_PROJECT_CONVERSATIONS
}, undefined, {
  frameRole: OFFSCREEN_FRAME_ROLES.HISTORY
});

assert.equal(secondHistoryPort.messages.length, 1);
secondHistoryPort.onMessage.emit({
  type: OFFSCREEN_MESSAGES.FRAME_COMMAND_RESPONSE,
  commandId: secondHistoryPort.messages[0].commandId,
  response: {
    ok: true,
    frame: "history"
  }
});
assert.deepEqual(await historyCommandPromise, {
  ok: true,
  frame: "history"
});

const historyProjectUrl = "https://chatgpt.com/g/g-p-dichrome/project";
const reloadMessages = [];
globalThis.chrome.runtime.sendMessage = async (message) => {
  if (message?.type === OFFSCREEN_MESSAGES.HOST_RELOAD_FRAME) {
    reloadMessages.push(message);
    return {
      target: "offscreen-automation-host",
      frameRole: OFFSCREEN_FRAME_ROLES.HISTORY,
      reloaded: true
    };
  }

  if (message?.type === OFFSCREEN_MESSAGES.BRIDGE_STATUS) {
    return {
      target: "offscreen-automation-host",
      ok: true
    };
  }

  return null;
};

let historyReloadResolved = false;
const historyReloadPromise = reloadOffscreenFrameToUrl(historyProjectUrl, {
  timeoutMessage: "Timed out waiting for test history reload."
}, {
  frameRole: OFFSCREEN_FRAME_ROLES.HISTORY
}).then((frame) => {
  historyReloadResolved = true;
  return frame;
});

await new Promise((resolve) => {
  setTimeout(resolve, 20);
});
assert.equal(reloadMessages.length, 1);
assert.equal(reloadMessages[0].frameRole, OFFSCREEN_FRAME_ROLES.HISTORY);
assert.match(reloadMessages[0].url, /^https:\/\/chatgpt\.com\/g\/g-p-dichrome\/project\?relay_offscreen_probe=/);
assert.equal(historyReloadResolved, false);
assert.equal(getOffscreenFrameStatus(OFFSCREEN_FRAME_ROLES.HISTORY).connected, false);
assert.equal(getOffscreenFrameStatus(OFFSCREEN_FRAME_ROLES.CHAT).connected, true);

announceReady(secondHistoryPort, OFFSCREEN_FRAME_ROLES.HISTORY, historyProjectUrl);
await new Promise((resolve) => {
  setTimeout(resolve, 20);
});
assert.equal(historyReloadResolved, false);
assert.equal(getOffscreenFrameStatus(OFFSCREEN_FRAME_ROLES.HISTORY).connected, false);

const reloadedHistoryPort = createMockPort();

assert.equal(handleOffscreenFramePort(reloadedHistoryPort), true);
announceReady(reloadedHistoryPort, OFFSCREEN_FRAME_ROLES.HISTORY, historyProjectUrl);

const reloadedHistoryFrame = await historyReloadPromise;

assert.equal(historyReloadResolved, true);
assert.equal(reloadedHistoryFrame.href, historyProjectUrl);
assert.equal(getOffscreenFrameStatus(OFFSCREEN_FRAME_ROLES.HISTORY).connected, true);

reloadedHistoryPort.disconnect();
assert.equal(getOffscreenFrameStatus(OFFSCREEN_FRAME_ROLES.HISTORY).connected, false);

secondHistoryPort.disconnect();
assert.equal(getOffscreenFrameStatus(OFFSCREEN_FRAME_ROLES.HISTORY).connected, false);
assert.equal(getOffscreenFrameStatus(OFFSCREEN_FRAME_ROLES.CHAT).connected, true);

chatPort.disconnect();
assert.equal(getOffscreenFrameStatus(OFFSCREEN_FRAME_ROLES.CHAT).connected, false);

assert.equal(
  getOffscreenTargetDescriptor().offscreenDocumentUrl,
  "chrome-extension://test-extension/offscreen/automation-host.html"
);

console.log("Offscreen target tests passed.");
