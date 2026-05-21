import assert from "node:assert/strict";

const storageApi = {
  async get() {
    return {};
  },
  async set() {}
};

globalThis.chrome = {
  storage: {
    local: storageApi,
    session: storageApi
  }
};

const { createProjectHistoryController } = await import("../background/runtime/project-history-controller.js");

{
  let createdTab = false;
  const controller = createProjectHistoryController({
    disableFocusEmulationForRequest: async () => null,
    enableFocusEmulation: async () => null,
    findOrCreateChatGptTab: async () => {
      createdTab = true;
      return {
        id: 99
      };
    },
    getAutomationSettings: async () => createSettings(),
    getExistingChatGptAutomationTab: async () => null,
    getSourceFocusTarget: () => ({}),
    injectAutomationScript: async () => null,
    navigateTabToConversation: async () => null,
    prepareAutomationTab: async (tab) => tab,
    probeOffscreenAutomationTarget: async () => ({
      supported: false,
      failureReason: "test-hidden-unavailable"
    }),
    queryBestSourceTab: async () => ({
      id: 1,
      windowId: 2
    }),
    restoreSourceFocus: async () => null,
    sendMessageToOffscreenFrame: async () => {
      throw new Error("offscreen should not be used when unsupported");
    },
    sendMessageToTab: async () => {
      throw new Error("tab messaging should not run without an existing target");
    }
  });

  const response = await controller.getProjectConversations();

  assert.equal(response.pending, true);
  assert.equal(response.conversations.length, 0);
  assert.equal(createdTab, false);

  await assert.rejects(
    () => controller.getProjectConversation({
      conversationId: "conversation-1",
      conversationUrl: "https://chatgpt.com/g/g-p-dichrome/c/conversation-1"
    }),
    /will not open a new browser tab just to load history/
  );
}

{
  let hiddenAttempts = 0;
  const controller = createProjectHistoryController({
    disableFocusEmulationForRequest: async () => null,
    enableFocusEmulation: async () => null,
    findOrCreateChatGptTab: async () => {
      throw new Error("history listing should not create a tab after hidden failure");
    },
    getAutomationSettings: async () => createSettings({
      project: {
        enabled: true,
        name: "Dichrome",
        createIfMissing: true,
        segment: "",
        url: ""
      }
    }),
    getExistingChatGptAutomationTab: async () => null,
    getSourceFocusTarget: () => ({}),
    injectAutomationScript: async () => null,
    navigateTabToConversation: async () => null,
    prepareAutomationTab: async (tab) => tab,
    probeOffscreenAutomationTarget: async () => ({
      supported: true
    }),
    queryBestSourceTab: async () => ({
      id: 1,
      windowId: 2
    }),
    restoreSourceFocus: async () => null,
    sendMessageToOffscreenFrame: async () => {
      hiddenAttempts += 1;
      throw new Error("ChatGPT project was not found: Dichrome");
    },
    sendMessageToTab: async () => {
      throw new Error("tab messaging should not run without an existing target");
    }
  });

  const firstResponse = await controller.getProjectConversations();
  const secondResponse = await controller.getProjectConversations();

  assert.equal(firstResponse.pending, true);
  assert.equal(secondResponse.pending, true);
  assert.equal(hiddenAttempts, 1);
}

{
  let createdTab = false;
  let messagedTabId = null;
  const controller = createProjectHistoryController({
    disableFocusEmulationForRequest: async () => null,
    enableFocusEmulation: async () => null,
    findOrCreateChatGptTab: async () => {
      createdTab = true;
      return {
        id: 99
      };
    },
    getAutomationSettings: async () => createSettings(),
    getExistingChatGptAutomationTab: async () => ({
      id: 42,
      windowId: 24,
      url: "https://chatgpt.com/"
    }),
    getSourceFocusTarget: () => ({}),
    injectAutomationScript: async () => null,
    navigateTabToConversation: async () => null,
    prepareAutomationTab: async (tab) => tab,
    probeOffscreenAutomationTarget: async () => ({
      supported: false,
      failureReason: "test-hidden-unavailable"
    }),
    queryBestSourceTab: async () => ({
      id: 1,
      windowId: 2
    }),
    restoreSourceFocus: async () => null,
    sendMessageToOffscreenFrame: async () => {
      throw new Error("offscreen should not be used when unsupported");
    },
    sendMessageToTab: async (tabId) => {
      messagedTabId = tabId;

      return {
        ok: true,
        project: {
          enabled: true,
          name: "Dichrome",
          segment: "g-p-dichrome"
        },
        conversations: [{
          id: "conversation-1",
          title: "Conversation 1",
          url: "https://chatgpt.com/g/g-p-dichrome/c/conversation-1"
        }],
        nextCursor: null,
        source: "project-api"
      };
    }
  });

  const response = await controller.getProjectConversations();

  assert.equal(createdTab, false);
  assert.equal(messagedTabId, 42);
  assert.equal(response.conversations.length, 1);
  assert.equal(response.automationTargetType, "single-tab");
}

console.log("Project history controller tests passed.");

function createSettings(overrides = {}) {
  const project = {
    enabled: true,
    name: "Dichrome",
    createIfMissing: true,
    segment: "g-p-dichrome",
    url: "https://chatgpt.com/g/g-p-dichrome/project",
    ...(overrides.project || {})
  };

  return {
    project,
    visibility: {
      mode: "hidden",
      ...(overrides.visibility || {})
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "project" && key !== "visibility"))
  };
}
