import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const dataSource = await readFile(new URL("../content/chatgpt/runtime/history/project-history-data.js", import.meta.url), "utf8");
const source = await readFile(new URL("../content/chatgpt/runtime/history/project-history.js", import.meta.url), "utf8");

const context = vm.createContext({
  console,
  Date,
  URL,
  URLSearchParams,
  document: {
    body: null,
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    }
  },
  fetch: createFetchMock([
    { ok: false, status: 404 },
    { ok: false, status: 404 },
    {
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            id: "outside",
            title: "Outside project",
            update_time: 1000
          },
          {
            id: "inside",
            title: "Inside project",
            gizmo_id: "g-p-target",
            update_time: 1001
          }
        ],
        has_more: false
      })
    }
  ]),
  location: new URL("https://chatgpt.com/g/g-p-target/project")
});

loadProjectHistoryRuntime(context);

const controller = context.ChatGptRelay.runtime.projectHistory.createController(createDependencies());
const result = await controller.listProjectConversations({
  project: {
    enabled: true,
    name: "Dichrome"
  },
  limit: 10
});

assert.equal(result.project.segment, "g-p-target");
assert.equal(result.conversations.length, 1);
assert.equal(result.conversations[0].id, "inside");

const configuredSegmentContext = vm.createContext({
  console,
  Date,
  URL,
  URLSearchParams,
  document: {
    body: null,
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    }
  },
  fetch: createFetchMock([
    {
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            id: "configured",
            title: "Configured project conversation",
            update_time: 1002
          }
        ],
        has_more: false
      })
    }
  ]),
  location: new URL("https://chatgpt.com/")
});

loadProjectHistoryRuntime(configuredSegmentContext);

const configuredSegmentController = configuredSegmentContext.ChatGptRelay.runtime.projectHistory.createController(createDependencies({
  ChatGptDomAdapter: class FakeAdapter {
    async waitForAppShell() {}

    detectBlockingUi() {
      return "";
    }

    async ensureProjectContext() {
      throw new Error("name-only project routing should not run when a project segment is configured");
    }

    collectSnapshot() {
      return {};
    }
  }
}));
const configuredSegmentResult = await configuredSegmentController.listProjectConversations({
  project: {
    enabled: true,
    name: "Dichrome",
    segment: "g-p-configured-dichrome",
    url: "https://chatgpt.com/g/g-p-configured-dichrome/project"
  },
  limit: 10
});

assert.equal(configuredSegmentResult.project.segment, "g-p-configured-dichrome");
assert.equal(configuredSegmentResult.conversations.length, 1);
assert.equal(configuredSegmentResult.conversations[0].url, "https://chatgpt.com/g/g-p-configured-dichrome/c/configured");

const hiddenProjectLink = createConversationLinkElement(
  "https://chatgpt.com/g/g-p-linked-dichrome/project",
  "Dichrome"
);
const linkedProjectContext = vm.createContext({
  console,
  Date,
  URL,
  URLSearchParams,
  document: {
    body: null,
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [hiddenProjectLink];
    }
  },
  fetch: createFetchMock([
    {
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            id: "linked",
            title: "Linked project conversation",
            update_time: 1002
          }
        ],
        has_more: false
      })
    }
  ]),
  location: new URL("https://chatgpt.com/")
});

loadProjectHistoryRuntime(linkedProjectContext);

const linkedProjectController = linkedProjectContext.ChatGptRelay.runtime.projectHistory.createController(createDependencies({
  ChatGptDomAdapter: class FakeAdapter {
    async waitForAppShell() {}

    detectBlockingUi() {
      return "";
    }

    async ensureProjectContext() {
      throw new Error("linked project resolution should not require visible project routing");
    }

    collectSnapshot() {
      return {};
    }
  }
}));
const linkedProjectResult = await linkedProjectController.listProjectConversations({
  project: {
    enabled: true,
    name: "Dichrome"
  },
  limit: 10
});

assert.equal(linkedProjectResult.project.segment, "g-p-linked-dichrome");
assert.equal(linkedProjectResult.conversations.length, 1);
assert.equal(linkedProjectResult.conversations[0].url, "https://chatgpt.com/g/g-p-linked-dichrome/c/linked");

const domContext = vm.createContext({
  console,
  Date,
  URL,
  URLSearchParams,
  document: {
    body: null,
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [
        {
          href: "https://chatgpt.com/c/outside",
          getAttribute() {
            return "";
          },
          innerText: "Outside project"
        }
      ];
    }
  },
  fetch: createFetchMock([
    { ok: false, status: 404 },
    { ok: false, status: 404 },
    { ok: true, status: 200, json: async () => ({ items: [], has_more: false }) },
    { ok: true, status: 200, json: async () => ({ items: [], has_more: false }) },
    { ok: true, status: 200, json: async () => ({ items: [], has_more: false }) }
  ]),
  location: new URL("https://chatgpt.com/g/g-p-target/project")
});

loadProjectHistoryRuntime(domContext);

const domController = domContext.ChatGptRelay.runtime.projectHistory.createController(createDependencies());
const domResult = await domController.listProjectConversations({
  project: {
    enabled: true,
    name: "Dichrome"
  },
  limit: 10
});

assert.equal(domResult.conversations.length, 0);

const rowElement = createConversationRowElement("May 19\nTesting message received\nTesting");
const rowOnlyContext = vm.createContext({
  console,
  Date,
  URL,
  URLSearchParams,
  document: {
    body: null,
    querySelector(selector) {
      return selector === "main" ? {
        querySelectorAll() {
          return [rowElement];
        }
      } : null;
    },
    querySelectorAll() {
      return [];
    },
    readyState: "complete"
  },
  fetch: createFetchMock([
    { ok: false, status: 404 },
    { ok: false, status: 404 },
    { ok: true, status: 200, json: async () => ({ items: [], has_more: false }) },
    { ok: true, status: 200, json: async () => ({ items: [], has_more: false }) }
  ]),
  location: new URL("https://chatgpt.com/g/g-p-target/project"),
  window: {
    getComputedStyle() {
      return {
        display: "block",
        opacity: "1",
        visibility: "visible"
      };
    }
  }
});

loadProjectHistoryRuntime(rowOnlyContext);

const rowOnlyController = rowOnlyContext.ChatGptRelay.runtime.projectHistory.createController(createDependencies());
const rowOnlyResult = await rowOnlyController.listProjectConversations({
  project: {
    enabled: true,
    name: "Dichrome"
  },
  limit: 10
});

assert.equal(rowOnlyResult.source, "empty");
assert.equal(rowOnlyResult.conversations.length, 0);

const linkElement = createConversationLinkElement(
  "https://chatgpt.com/g/g-p-target/c/dom-link-conversation",
  "Testing message received"
);
const linkContext = vm.createContext({
  console,
  Date,
  URL,
  URLSearchParams,
  document: {
    body: null,
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [linkElement];
    },
    readyState: "complete"
  },
  fetch: createFetchMock([
    { ok: false, status: 404 },
    { ok: false, status: 404 },
    {
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            id: "outside-project",
            title: "Outside project",
            gizmo_id: "g-p-other",
            update_time: 1003
          }
        ],
        has_more: true
      })
    },
    { ok: true, status: 200, json: async () => ({ items: [], has_more: false }) },
    { ok: true, status: 200, json: async () => ({ items: [], has_more: false }) }
  ]),
  location: new URL("https://chatgpt.com/g/g-p-target/project"),
  window: {
    getComputedStyle() {
      return {
        display: "block",
        opacity: "1",
        visibility: "visible"
      };
    }
  }
});

loadProjectHistoryRuntime(linkContext);

const linkController = linkContext.ChatGptRelay.runtime.projectHistory.createController(createDependencies());
const linkResult = await linkController.listProjectConversations({
  project: {
    enabled: true,
    name: "Dichrome"
  },
  limit: 10
});

assert.equal(linkResult.source, "dom-project-page");
assert.equal(linkResult.conversations.length, 1);
assert.equal(linkResult.conversations[0].id, "dom-link-conversation");
assert.equal(linkResult.conversations[0].title, "Testing message received");

const loadContext = vm.createContext({
  console,
  Date,
  URL,
  URLSearchParams,
  document: {
    body: null,
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    readyState: "complete"
  },
  fetch: createFetchMock([
    {
      ok: true,
      status: 200,
      json: async () => ({
        id: "loaded-conversation",
        title: "Testing message received",
        gizmo_id: "g-p-target"
      })
    }
  ]),
  location: new URL("https://chatgpt.com/g/g-p-target/project"),
  window: {
    getComputedStyle() {
      return {
        display: "block",
        opacity: "1",
        visibility: "visible"
      };
    }
  }
});

loadProjectHistoryRuntime(loadContext);

const loadController = loadContext.ChatGptRelay.runtime.projectHistory.createController(createDependencies());
const loadedResult = await loadController.loadProjectConversation({
  project: {
    enabled: true,
    name: "Dichrome"
  },
  conversationId: linkResult.conversations[0].id,
  conversationUrl: linkResult.conversations[0].url
});

assert.equal(loadedResult.conversation.id, "dom-link-conversation");
assert.equal(loadedResult.conversation.url, "https://chatgpt.com/g/g-p-target/c/dom-link-conversation");

console.log("Project history filtering tests passed.");

function loadProjectHistoryRuntime(context) {
  vm.runInContext(dataSource, context);
  vm.runInContext(source, context);
}

function createDependencies(overrides = {}) {
  return {
    ChatGptDomAdapter: class FakeAdapter {
      async waitForAppShell() {}

      detectBlockingUi() {
        return "";
      }

      async ensureProjectContext() {}

      findSelectedProjectNavigationItem() {
        return {
          href: "https://chatgpt.com/g/g-p-target/project"
        };
      }

      findProjectNavigationItem() {
        return null;
      }

      collectSnapshot() {
        return {};
      }
    },
    DomAdapterError: Error,
    extractConversationKey(value) {
      try {
        const match = new URL(value).pathname.match(/\/c\/([^/?#]+)/);

        return match?.[1] || null;
      } catch (_error) {
        return null;
      }
    },
    extractConversationTitleFromConversationData(data) {
      return data?.title || "";
    },
    extractProjectPathSegment(pathname) {
      return String(pathname || "").match(/^\/g\/(g-p-[^/]+)/)?.[1] || "";
    },
    getChatGptAccessToken: async () => null,
    isAllowedChatGptUrl(url) {
      return url.protocol === "https:" && url.hostname === "chatgpt.com";
    },
    normalizeProjectOptions(project) {
      return {
        enabled: Boolean(project?.enabled),
        name: String(project?.name || ""),
        createIfMissing: Boolean(project?.createIfMissing),
        segment: String(project?.segment || ""),
        url: String(project?.url || "")
      };
    },
    normalizeText(value) {
      return String(value || "").trim();
    },
    selectConversationMessagesFromConversationData() {
      return [];
    },
    ...overrides
  };
}

function createConversationRowElement(text) {
  return {
    innerText: text,
    isConnected: true,
    textContent: text,
    click() {},
    closest() {
      return null;
    },
    contains(other) {
      return other === this;
    },
    getBoundingClientRect() {
      return {
        height: 72,
        width: 820,
        x: 0,
        y: 0
      };
    },
    matches() {
      return false;
    },
    querySelector() {
      return null;
    }
  };
}

function createConversationLinkElement(href, text) {
  return {
    href,
    innerText: text,
    textContent: text,
    getAttribute(name) {
      return name === "href" ? href : "";
    }
  };
}

function createFetchMock(responses) {
  const queue = [...responses];

  return async () => {
    const response = queue.shift();

    if (!response) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [],
          has_more: false
        })
      };
    }

    return {
      json: async () => ({}),
      ...response
    };
  };
}
