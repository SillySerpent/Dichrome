import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import {
  OFFSCREEN_FRAME_PORT_NAME,
  OFFSCREEN_FRAME_ROLES,
  OFFSCREEN_MESSAGES
} from "../shared/contracts.js";

const source = await readFile(new URL("../content/chatgpt/runtime/offscreen/bridge.js", import.meta.url), "utf8");

assert.equal(runBridgeSetupForOrigin("chrome-extension://test-extension", "dichrome-offscreen-chat"), OFFSCREEN_FRAME_ROLES.CHAT);
assert.equal(runBridgeSetupForOrigin("chrome-extension://test-extension", "dichrome-offscreen-history"), OFFSCREEN_FRAME_ROLES.HISTORY);
assert.equal(runBridgeSetupForOrigin("safari-extension://test-extension", ""), false);
assert.equal(runBridgeSetupForOrigin("https://example.com", "dichrome-offscreen-chat"), false);

console.log("Offscreen bridge origin tests passed.");

function runBridgeSetupForOrigin(extensionOrigin, frameName) {
  const messages = [];
  const ports = [];
  const topWindow = {};
  const location = {
    href: "https://chatgpt.com/",
    ancestorOrigins: [extensionOrigin]
  };
  const fakeWindow = {
    location,
    name: frameName,
    top: topWindow,
    parent: topWindow,
    addEventListener() {},
    setTimeout(callback) {
      callback();
      return 1;
    },
    setInterval(callback) {
      callback();
      return 1;
    },
    clearTimeout() {},
    clearInterval() {}
  };
  const context = vm.createContext({
    ChatGptRelay: {},
    chrome: {
      runtime: {
        id: "test-extension",
        connect(details) {
          const port = createPort(details, messages);
          ports.push(port);
          return port;
        },
        getURL(path) {
          return `${extensionOrigin}/${path}`;
        }
      }
    },
    document: {
      body: {
        innerText: "Loaded ChatGPT page"
      },
      readyState: "complete",
      referrer: `${extensionOrigin}/sidepanel/sidepanel.html`,
      title: "ChatGPT",
      hasFocus() {
        return false;
      },
      addEventListener() {}
    },
    location,
    window: fakeWindow
  });

  vm.runInContext(source, context);

  const bridge = context.ChatGptRelay.runtime.offscreenBridge.createBridge({
    AUTOMATION_MESSAGES: {
      offscreenFrameReady: OFFSCREEN_MESSAGES.FRAME_READY,
      offscreenFrameCommand: OFFSCREEN_MESSAGES.FRAME_COMMAND,
      offscreenFrameCommandResponse: OFFSCREEN_MESSAGES.FRAME_COMMAND_RESPONSE
    },
    OFFSCREEN_FRAME_ROLES,
    OFFSCREEN_FRAME_PORT_NAME,
    handleAutomationMessage() {
      return false;
    },
    isChatGptLocation(value) {
      return String(value).startsWith("https://chatgpt.com/");
    },
    isNonAutomationChatGptFrame() {
      return false;
    }
  });

  bridge.setup();

  const readyMessage = messages.find((message) => {
    return message.type === OFFSCREEN_MESSAGES.FRAME_READY
      && message.frame.href === "https://chatgpt.com/";
  });

  return ports.length === 1 && readyMessage
    ? readyMessage.frameRole
    : false;
}

function createPort(details, messages) {
  assert.equal(details.name, OFFSCREEN_FRAME_PORT_NAME);

  return {
    onMessage: {
      addListener() {}
    },
    onDisconnect: {
      addListener() {}
    },
    postMessage(message) {
      messages.push(message);
    }
  };
}
