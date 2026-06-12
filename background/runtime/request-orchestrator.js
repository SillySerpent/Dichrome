import {
  CHATGPT_AUTOMATION_MESSAGES,
  OFFSCREEN_FRAME_ROLES,
  REQUEST_STATES
} from "../../shared/contracts.js";
import {
  getTabId
} from "../constants.js";

export function createRequestOrchestrator({
  appendEvent,
  buildChatOptionsForAutomationRun,
  buildPromptForProfile,
  classifyHiddenCapabilityFailure,
  clearAutomationRequestActive,
  createCodedError,
  createRequestId,
  createRequestRecord,
  extensionName,
  getAutomationSettings,
  getAutomationSession,
  getFreshConversationUrl,
  getOffscreenFrameStatus,
  getRequest,
  getVisibilityMode,
  markAutomationRequestActive,
  markRequestError,
  mergeAutomationSettings,
  navigateOffscreenFrameToConversation,
  navigateOffscreenFrameToUrl,
  openSidePanel,
  putRequest,
  queryTabs = () => chrome.tabs.query({}),
  rememberSourceTab,
  resolveProjectTarget,
  sendMessageToOffscreenFrame,
  setAutomationSettings,
  storeAttachmentPayloads,
  updateRequest,
  workspaceReadinessController
}) {
  async function startRequest({
    profileId,
    sourceTab,
    selectedText = "",
    manualText = "",
    attachments = [],
    chatOptionsOverride = null,
    parentRequestId = null,
    conversationMode = "new",
    expectedConversationUrl = null,
    expectedConversationKey = null
  }) {
    await rememberSourceTab(sourceTab);

    const prompt = buildPromptForProfile(profileId, {
      selectedText,
      manualText,
      attachments
    });
    const requestId = createRequestId();
    const request = createRequestRecord({
      id: requestId,
      profileId,
      sourceTab,
      selectedText,
      manualText,
      prompt,
      attachments,
      parentRequestId,
      conversationMode,
      expectedConversationUrl,
      expectedConversationKey
    });

    await storeAttachmentPayloads(requestId, attachments);
    await putRequest(request);
    await updateRequest(requestId, (draft) => {
      draft.state = REQUEST_STATES.SELECTED_TEXT_RECEIVED;
      appendEvent(draft, "Request accepted by background worker.");
    });
    await openSidePanel(getTabId(sourceTab));

    void orchestrateRequest(requestId, {
      attachments,
      chatOptionsOverride
    });

    return {
      requestId
    };
  }

  async function orchestrateRequest(requestId, {
    attachments = [],
    chatOptionsOverride = null
  } = {}) {
    try {
      const request = await getRequestOrThrow(requestId);
      const automationSettings = await resolveAutomationSettingsProjectTarget(mergeAutomationSettings(
        await getAutomationSettings(extensionName),
        chatOptionsOverride,
        extensionName
      ));
      const hiddenCapability = await workspaceReadinessController.probeHiddenAutomationWithWarmup({
        attempts: 3,
        initialDelayMs: 350
      });

      if (!hiddenCapability?.supported) {
        throw createCodedError(
          `Hidden internal ChatGPT automation is unavailable. ${hiddenCapability?.failureReason || "Open ChatGPT to sign in, then retry from Dichrome."}`.trim(),
          classifyHiddenCapabilityFailure(hiddenCapability?.failureReason)
        );
      }

      await runOffscreenAutomationTarget({
        request,
        requestId,
        attachments,
        automationSettings
      });
    } catch (error) {
      await clearAutomationRequestActive(requestId).catch(() => null);
      await markRequestError(requestId, error);
    }
  }

  async function getResolvedAutomationSettings() {
    return resolveAutomationSettingsProjectTarget(await getAutomationSettings(extensionName));
  }

  async function resolveAutomationSettingsProjectTarget(settings) {
    if (!settings?.project?.enabled || !settings.project.name) {
      return settings;
    }

    const project = await resolveProjectTarget(settings.project, {
      getAutomationSession,
      queryTabs
    });

    if (project.segment && project.segment !== settings.project.segment) {
      await setAutomationSettings({
        ...settings,
        project
      }, extensionName).catch(() => null);
    }

    return {
      ...settings,
      project
    };
  }

  async function runOffscreenAutomationTarget({
    request,
    requestId,
    attachments,
    automationSettings
  }) {
    if (request.conversationMode === "followup") {
      if (!request.expectedConversationUrl) {
        throw new Error("The previous request has no saved ChatGPT conversation URL. The extension will not start a new chat for this follow-up.");
      }

      await navigateOffscreenFrameToConversation(request.expectedConversationUrl, {
        frameRole: OFFSCREEN_FRAME_ROLES.CHAT
      });
    } else {
      const freshHiddenUrl = getFreshConversationUrl(automationSettings, getOffscreenFrameStatus(OFFSCREEN_FRAME_ROLES.CHAT)?.frame?.href || "");

      if (freshHiddenUrl) {
        await updateRequest(requestId, (draft) => {
          appendEvent(draft, "Preparing a fresh hidden ChatGPT composer.");
        });
        await navigateOffscreenFrameToUrl(freshHiddenUrl, {
          rejectedMessage: "The hidden ChatGPT frame rejected fresh-chat navigation.",
          timeoutMessage: "Timed out waiting for the hidden ChatGPT frame to open a fresh composer."
        }, {
          frameRole: OFFSCREEN_FRAME_ROLES.CHAT
        });
        await updateRequest(requestId, (draft) => {
          appendEvent(draft, "Fresh hidden ChatGPT composer is ready.");
        });
      }
    }

    await markAutomationRequestActive(requestId);

    await updateRequest(requestId, (draft) => {
      draft.chatTabId = null;
      draft.automationVisibilityMode = getVisibilityMode(automationSettings.visibility);
      draft.automationTargetType = "offscreen-frame";
      draft.state = REQUEST_STATES.WORKSPACE_READY;
      appendEvent(draft, "Using hidden internal ChatGPT frame.");
    });

    const response = await sendMessageToOffscreenFrame({
      type: CHATGPT_AUTOMATION_MESSAGES.RUN,
      request: buildAutomationRunRequest({
        request,
        attachments,
        automationSettings,
        visibilityModeOverride: "offscreen-frame"
      })
    }, undefined, {
      frameRole: OFFSCREEN_FRAME_ROLES.CHAT
    });

    if (!response?.accepted) {
      throw new Error(response?.error || "Hidden ChatGPT frame did not accept the request.");
    }
  }

  function buildAutomationRunRequest({
    request,
    attachments,
    automationSettings,
    visibilityModeOverride = null
  }) {
    return {
      id: request.id,
      profileId: request.profileId,
      prompt: request.prompt,
      attachments,
      chatOptions: buildChatOptionsForAutomationRun({
        automationSettings,
        request,
        visibilityModeOverride
      })
    };
  }

  async function getRequestOrThrow(requestId) {
    const request = await getRequest(requestId);

    if (!request) {
      throw new Error("Request disappeared before orchestration started.");
    }

    return request;
  }

  return Object.freeze({
    getResolvedAutomationSettings,
    startRequest
  });
}
