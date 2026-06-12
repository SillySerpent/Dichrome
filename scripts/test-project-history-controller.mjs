import assert from "node:assert/strict";
import {
  CHATGPT_HOME_URL,
  OFFSCREEN_FRAME_ROLES
} from "../shared/contracts.js";

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
  let attemptedTabPath = false;
  const controller = createProjectHistoryController({
    getAutomationSettings: async () => createSettings(),
    probeOffscreenAutomationTarget: async () => ({
      supported: false,
      failureReason: "test-hidden-unavailable"
    }),
    sendMessageToOffscreenFrame: async () => {
      throw new Error("offscreen should not be used when unsupported");
    },
    reloadOffscreenFrameToUrl: async () => {
      throw new Error("history frame should not reload when unsupported");
    }
  });

  await assert.rejects(
    () => controller.getProjectConversations(),
    (error) => {
      assert.equal(error.errorCode, "HIDDEN_FRAME_UNAVAILABLE");
      assert.match(error.message, /Hidden internal project history is unavailable/);
      return true;
    }
  );
  assert.equal(attemptedTabPath, false);

  await assert.rejects(
    () => controller.getProjectConversation({
      conversationId: "conversation-1",
      conversationUrl: "https://chatgpt.com/g/g-p-dichrome/c/conversation-1"
    }),
    (error) => {
      assert.equal(error.errorCode, "HIDDEN_FRAME_UNAVAILABLE");
      return true;
    }
  );
}

{
  let hiddenAttempts = 0;
  let reloadAttempts = 0;
  const reloadUrls = [];
  const controller = createProjectHistoryController({
    getAutomationSettings: async () => createSettings({
      project: {
        enabled: true,
        name: "Dichrome",
        createIfMissing: true,
        segment: "",
        url: ""
      }
    }),
    probeOffscreenAutomationTarget: async () => ({
      supported: true
    }),
    reloadOffscreenFrameToUrl: async (url, _options, frameOptions) => {
      reloadAttempts += 1;
      reloadUrls.push(url);
      assert.equal(frameOptions.frameRole, OFFSCREEN_FRAME_ROLES.HISTORY);
    },
    sendMessageToOffscreenFrame: async () => {
      hiddenAttempts += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      throw new Error("ChatGPT project was not found: Dichrome");
    }
  });

  const [firstResponse, secondResponse] = await Promise.allSettled([
    controller.getProjectConversations(),
    controller.getProjectConversations()
  ]);

  assert.equal(firstResponse.status, "rejected");
  assert.equal(secondResponse.status, "rejected");
  assert.equal(firstResponse.reason.errorCode, "PROJECT_UNAVAILABLE");
  assert.equal(secondResponse.reason.errorCode, "PROJECT_UNAVAILABLE");
  assert.equal(reloadAttempts, 1);
  assert.deepEqual(reloadUrls, [CHATGPT_HOME_URL]);
  assert.equal(hiddenAttempts, 1);
}

{
  let hiddenMessages = 0;
  const reloadUrls = [];
  const sendOptions = [];
  let savedSettings = null;
  const controller = createProjectHistoryController({
    getAutomationSettings: async () => createSettings(),
    probeOffscreenAutomationTarget: async () => ({
      supported: true
    }),
    reloadOffscreenFrameToUrl: async (url, _options, frameOptions) => {
      reloadUrls.push(url);
      assert.equal(frameOptions.frameRole, OFFSCREEN_FRAME_ROLES.HISTORY);
    },
    sendMessageToOffscreenFrame: async (_message, _timeoutMs, options) => {
      hiddenMessages += 1;
      sendOptions.push(options);

      return {
        ok: true,
        project: {
          enabled: true,
          name: "Dichrome",
          segment: "g-p-dichrome-resolved"
        },
        conversations: [{
          id: "conversation-1",
          title: "Conversation 1",
          url: "https://chatgpt.com/g/g-p-dichrome/c/conversation-1"
        }],
        nextCursor: null,
        source: "project-api"
      };
    },
    setAutomationSettings: async (settings) => {
      savedSettings = settings;
    }
  });

  const response = await controller.getProjectConversations();

  assert.deepEqual(reloadUrls, ["https://chatgpt.com/g/g-p-dichrome/project"]);
  assert.equal(sendOptions[0].frameRole, OFFSCREEN_FRAME_ROLES.HISTORY);
  assert.equal(hiddenMessages, 1);
  assert.equal(response.conversations.length, 1);
  assert.equal(response.automationTargetType, "offscreen-frame");
  assert.equal(savedSettings.project.segment, "g-p-dichrome-resolved");
  assert.equal(savedSettings.project.url, "https://chatgpt.com/g/g-p-dichrome-resolved/project");
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
