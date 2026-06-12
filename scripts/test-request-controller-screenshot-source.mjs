import assert from "node:assert/strict";

globalThis.chrome = {
  storage: {
    local: {},
    session: null
  }
};

const { createRequestController } = await import("../background/runtime/request-controller.js");

const sourceTab = {
  id: 10,
  windowId: 20,
  title: "Source",
  url: "https://example.test/page"
};
const screenshot = {
  id: "screenshot",
  kind: "image",
  name: "visible-tab.png",
  mimeType: "image/png",
  dataUrl: "data:image/png;base64,AAAA",
  sizeBytes: 4
};
let preferredSourceTab = null;
let captureArgs = null;

const controller = createRequestController({
  appendEvent(request, detail) {
    request.events = [...(request.events || []), { detail }];
  },
  captureVisibleTabScreenshot: async (windowId, tab) => {
    captureArgs = {
      windowId,
      tab
    };

    return screenshot;
  },
  getProfile() {
    return {
      inputKind: "manual_text"
    };
  },
  getRequest: async () => null,
  normalizeText(value) {
    return String(value || "").trim();
  },
  queryBestSourceTab: async (preferredTab) => {
    preferredSourceTab = preferredTab;

    return preferredTab || null;
  },
  restoreAttachmentPayloads: async () => [],
  sendMessageToOffscreenFrame: async () => ({}),
  startRequest: async () => ({
    requestId: "started"
  }),
  updateRequest: async () => null
});

const response = await controller.captureScreenshotAttachment({
  sourceTab
});

assert.deepEqual(preferredSourceTab, sourceTab);
assert.equal(captureArgs.windowId, 20);
assert.deepEqual(captureArgs.tab, sourceTab);
assert.deepEqual(response.attachment, screenshot);

await assert.rejects(
  () => controller.captureScreenshotAttachment({}),
  /No source tab is available/
);

console.log("Request controller screenshot source tests passed.");
