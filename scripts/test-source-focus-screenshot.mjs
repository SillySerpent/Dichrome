import assert from "node:assert/strict";

const DATA_URL = "data:image/png;base64,AAAA";
const calls = [];
let hasAllSitesAccess = true;
let captureError = null;
let tabsById = new Map();
let queryResults = [];

globalThis.chrome = {
  runtime: {
    id: "extension-id"
  },
  storage: {
    local: {
      get: async () => ({}),
      set: async () => null
    },
    session: null
  },
  permissions: {
    contains: async (query) => {
      calls.push({
        api: "permissions.contains",
        query
      });

      return hasAllSitesAccess;
    }
  },
  tabs: {
    get: async (tabId) => {
      calls.push({
        api: "tabs.get",
        tabId
      });

      if (!tabsById.has(tabId)) {
        throw new Error("Tab not found");
      }

      return tabsById.get(tabId);
    },
    query: async (query) => {
      calls.push({
        api: "tabs.query",
        query
      });

      return queryResults.shift() || [];
    },
    update: async (tabId, options) => {
      calls.push({
        api: "tabs.update",
        tabId,
        options
      });

      return {};
    },
    captureVisibleTab: async (windowId, options) => {
      calls.push({
        api: "tabs.captureVisibleTab",
        windowId,
        options
      });

      if (captureError) {
        throw captureError;
      }

      return DATA_URL;
    }
  },
  windows: {
    update: async (windowId, options) => {
      calls.push({
        api: "windows.update",
        windowId,
        options
      });

      return {};
    }
  }
};

const {
  captureVisibleTabScreenshot,
  queryBestSourceTab
} = await import("../background/automation/source-focus.js");

const sourceTab = {
  id: 42,
  windowId: 7,
  title: "Example",
  url: "https://example.test/page"
};

tabsById = new Map([
  [42, sourceTab]
]);

let resolvedSourceTab = await queryBestSourceTab({
  id: 42,
  windowId: 7,
  title: "Stale title",
  url: "https://example.test/old"
});

assert.equal(resolvedSourceTab.url, "https://example.test/page");
assert.deepEqual(calls, [
  {
    api: "tabs.get",
    tabId: 42
  }
]);

calls.length = 0;

let screenshot = await captureVisibleTabScreenshot(7, sourceTab);

assert.deepEqual(calls.slice(0, 4), [
  {
    api: "permissions.contains",
    query: {
      origins: ["<all_urls>"]
    }
  },
  {
    api: "tabs.update",
    tabId: 42,
    options: {
      active: true
    }
  },
  {
    api: "windows.update",
    windowId: 7,
    options: {
      focused: true
    }
  },
  {
    api: "tabs.captureVisibleTab",
    windowId: 7,
    options: {
      format: "png"
    }
  }
]);
assert.equal(screenshot.kind, "image");
assert.equal(screenshot.mimeType, "image/png");
assert.equal(screenshot.dataUrl, DATA_URL);
assert.ok(screenshot.name.startsWith("visible-tab-"));
assert.ok(screenshot.sizeBytes > 0);

calls.length = 0;
hasAllSitesAccess = false;

await assert.rejects(
  () => captureVisibleTabScreenshot(7, sourceTab),
  /All Sites access/
);
assert.deepEqual(calls, [
  {
    api: "permissions.contains",
    query: {
      origins: ["<all_urls>"]
    }
  }
]);

calls.length = 0;
hasAllSitesAccess = true;
captureError = new Error("Underlying capture blocked");

await assert.rejects(
  () => captureVisibleTabScreenshot(7, sourceTab),
  /Visible screenshot capture failed for https:\/\/example\.test\/page.*Underlying capture blocked/
);
assert.equal(calls.at(-1).api, "tabs.captureVisibleTab");

console.log("Source focus screenshot tests passed.");
