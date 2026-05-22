import assert from "node:assert/strict";
import {
  CHATGPT_HOME_URL,
  OFFSCREEN_MESSAGES
} from "../shared/contracts.js";
import { createFirefoxAutomationHost } from "../sidepanel/runtime/firefox-automation-host.js";

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = "";
    this.id = "";
    this.title = "";
    this.referrerPolicy = "";
    this.src = "";
  }

  append(child) {
    this.children.push(child);
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

const documentRef = {
  body: new FakeElement("body"),
  createElement(tagName) {
    return new FakeElement(tagName);
  }
};
const listeners = [];
const runtime = {
  onMessage: {
    addListener(listener) {
      listeners.push(listener);
    }
  }
};
const host = createFirefoxAutomationHost({
  documentRef,
  runtime,
  setTimeoutRef: (callback) => callback(),
  now: () => "2026-05-22T00:00:00.000Z"
});

host.register();

assert.equal(listeners.length, 1);

let response = sendMessage({
  type: OFFSCREEN_MESSAGES.HOST_PROBE,
  url: "https://malicious.example/"
});

assert.equal(response.target, "offscreen-automation-host");
assert.equal(response.supported, false);
assert.match(response.failureReason, /Firefox sidebar host/);
assert.equal(documentRef.body.children.length, 1);

const container = documentRef.body.children[0];
const frame = container.children[0];

assert.equal(container.className, "firefox-automation-host");
assert.equal(container.getAttribute("aria-hidden"), "true");
assert.equal(frame.src, CHATGPT_HOME_URL);

frame.dispatch("load");
response = sendMessage({
  type: OFFSCREEN_MESSAGES.HOST_STATUS
});

assert.equal(response.status.frameLoaded, true);
assert.equal(response.status.frameFailed, false);
assert.equal(response.status.frameSrc, CHATGPT_HOME_URL);
assert.equal(response.status.hostKind, "firefox-sidebar");

response = sendMessage({
  type: OFFSCREEN_MESSAGES.HOST_RELOAD_FRAME,
  url: "https://chat.openai.com/c/test"
});

assert.equal(response.reloaded, true);
assert.equal(frame.src, "https://chat.openai.com/c/test");

sendMessage({
  type: OFFSCREEN_MESSAGES.BRIDGE_STATUS,
  connected: true,
  frame: {
    href: "https://chat.openai.com/c/test",
    readyState: "complete"
  },
  framePolicy: {
    enabled: true
  }
});

response = sendMessage({
  type: OFFSCREEN_MESSAGES.HOST_STATUS
});

assert.equal(response.status.bridgeConnected, true);
assert.equal(response.status.bridgeFrame.href, "https://chat.openai.com/c/test");
assert.equal(response.status.framePolicy.enabled, true);

console.log("Firefox automation host tests passed.");

function sendMessage(message) {
  let response = null;
  const handled = listeners[0](message, {}, (payload) => {
    response = payload;
  });

  assert.equal(handled, false);
  return response;
}
