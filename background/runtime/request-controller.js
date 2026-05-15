import {
  CHATGPT_AUTOMATION_MESSAGES,
  REQUEST_STATES
} from "../../shared/contracts.js";

export function createRequestController({
  appendEvent,
  captureVisibleTabScreenshot,
  disableFocusEmulationForRequest,
  findOrCreateChatGptTab,
  getProfile,
  getRequest,
  getSourceFocusTarget,
  normalizeText,
  queryBestSourceTab,
  restoreAttachmentPayloads,
  sendMessageToTab,
  startRequest,
  updateRequest
}) {
  async function startManualRequest(message) {
    const profileId = message.profileId || "custom_text";
    const profile = getProfile(profileId);

    if (profile.inputKind !== "manual_text" && profile.inputKind !== "selection") {
      throw new Error(`Profile ${profileId} cannot be used with manual text.`);
    }

    const sourceTab = await queryBestSourceTab();
    const manualText = normalizeText(message.text);
    const selectedText = profile.inputKind === "selection" ? manualText : "";

    return startRequest({
      profileId,
      sourceTab,
      manualText,
      selectedText
    });
  }

  async function startScreenshotRequest(message) {
    const sourceTab = await queryBestSourceTab();

    if (!sourceTab?.windowId) {
      throw new Error("No source tab is available for screenshot capture.");
    }

    const screenshot = await captureVisibleTabScreenshot(sourceTab.windowId);

    return startRequest({
      profileId: "visible_screenshot",
      sourceTab,
      manualText: normalizeText(message.prompt),
      attachments: [screenshot]
    });
  }

  async function startFollowupRequest(message) {
    const existing = await getRequest(message.requestId);

    if (!existing) {
      throw new Error("Request not found.");
    }

    const manualText = normalizeText(message.text);

    if (!manualText) {
      throw new Error("Follow-up prompt is empty.");
    }

    if (!existing.chatConversationUrl && !existing.chatTabId) {
      throw new Error("The previous request does not have a saved ChatGPT conversation for follow-up.");
    }

    return startRequest({
      profileId: "custom_text",
      sourceTab: existing.source,
      manualText,
      parentRequestId: existing.id,
      conversationMode: "followup",
      expectedConversationUrl: existing.chatConversationUrl || null,
      expectedConversationKey: existing.chatConversationKey || null,
      preferredChatTabId: existing.chatTabId || null,
      chatOptionsOverride: {
        project: {
          enabled: false
        },
        conversation: {
          mode: "continue",
          startNewChat: false,
          expectedConversationUrl: existing.chatConversationUrl || null
        },
        model: {
          enabled: false
        }
      }
    });
  }

  async function retryRequest(message) {
    const existing = await getRequest(message.requestId);

    if (!existing) {
      throw new Error("Request not found.");
    }

    const attachments = await restoreAttachmentPayloads(existing);
    const adapterHints = message.useRepairHints && existing.repairSuggestions
      ? existing.repairSuggestions.hints
      : [];

    const retry = await startRequest({
      profileId: existing.profileId,
      sourceTab: existing.source,
      selectedText: existing.selectedText,
      manualText: existing.manualText,
      attachments,
      adapterHints,
      parentRequestId: existing.parentRequestId || null,
      conversationMode: existing.conversationMode || "new",
      expectedConversationUrl: existing.conversationMode === "followup" ? existing.chatConversationUrl || null : null,
      expectedConversationKey: existing.conversationMode === "followup" ? existing.chatConversationKey || null : null,
      preferredChatTabId: existing.chatTabId || null
    });

    await updateRequest(retry.requestId, (request) => {
      appendEvent(request, `Retry created from ${existing.id}.`);
    });

    return retry;
  }

  async function cancelRequest(requestId) {
    const request = await getRequest(requestId);

    if (!request) {
      throw new Error("Request not found.");
    }

    if (request.chatTabId) {
      await sendMessageToTab(request.chatTabId, {
        type: CHATGPT_AUTOMATION_MESSAGES.CANCEL,
        requestId
      }).catch(() => null);
    }

    await disableFocusEmulationForRequest(requestId).catch(() => null);

    await updateRequest(requestId, (draft) => {
      draft.state = REQUEST_STATES.ERROR_STATE;
      draft.error = "Cancelled by user.";
      draft.completedAt = new Date().toISOString();
      appendEvent(draft, "Request cancelled.");
    });

    return {};
  }

  async function openChatGptTabForRequest(requestId) {
    const request = requestId ? await getRequest(requestId) : null;
    const sourceFocus = getSourceFocusTarget(request?.source);
    const tabId = request?.chatTabId || (await findOrCreateChatGptTab({ sourceFocus })).id;

    await chrome.tabs.update(tabId, {
      active: true
    });

    return {
      tabId
    };
  }

  return Object.freeze({
    startManualRequest,
    startScreenshotRequest,
    startFollowupRequest,
    retryRequest,
    cancelRequest,
    openChatGptTabForRequest
  });
}
