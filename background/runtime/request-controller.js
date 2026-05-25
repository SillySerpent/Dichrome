import {
  AUTOMATION_TARGET_TYPES,
  CHATGPT_AUTOMATION_MESSAGES,
  REQUEST_STATES,
  REQUEST_ERROR_CODES,
  VISIBILITY_MODES,
  isTerminalState
} from "../../shared/contracts.js";
import {
  CHATGPT_HOME_URL,
  isChatGptUrl
} from "../constants.js";

export function createRequestController({
  appendEvent,
  captureVisibleTabScreenshot,
  clearAutomationRequestActive = async () => null,
  disableFocusEmulationForRequest,
  getProfile,
  getRequest,
  normalizeText,
  queryBestSourceTab,
  restoreAttachmentPayloads,
  sendMessageToOffscreenFrame = async () => null,
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
    const attachments = normalizeIncomingAttachments(message.attachments);
    const selectedText = normalizeText(message.selectedText || "");
    const manualText = buildComposerPrompt({
      text: message.text,
      selectedText,
      attachments
    });

    return startRequest({
      profileId: "custom_text",
      sourceTab,
      manualText,
      selectedText,
      attachments,
      conversationMode: "new",
      chatOptionsOverride: {
        conversation: {
          mode: "new",
          startNewChat: message.forceNewChat !== false
        }
      }
    });
  }

  async function startScreenshotRequest(message) {
    const sourceTab = await queryBestSourceTab();

    if (!sourceTab?.windowId) {
      throw new Error("No source tab is available for screenshot capture.");
    }

    const screenshot = await captureVisibleTabScreenshot(sourceTab.windowId, sourceTab);

    return startRequest({
      profileId: "visible_screenshot",
      sourceTab,
      manualText: normalizeText(message.prompt),
      attachments: [screenshot]
    });
  }


  async function captureScreenshotAttachment() {
    const sourceTab = await queryBestSourceTab();

    if (!sourceTab?.windowId) {
      throw new Error("No source tab is available for screenshot capture.");
    }

    return {
      attachment: await captureVisibleTabScreenshot(sourceTab.windowId, sourceTab)
    };
  }

  async function startFollowupRequest(message) {
    const existing = await getRequest(message.requestId);

    if (!existing) {
      throw new Error("Request not found.");
    }

    const attachments = normalizeIncomingAttachments(message.attachments);
    const selectedText = normalizeText(message.selectedText || "");
    const manualText = buildComposerPrompt({
      text: message.text,
      selectedText,
      attachments
    });

    if (!manualText) {
      throw new Error("Follow-up prompt is empty.");
    }

    if (!existing.chatConversationUrl) {
      throw new Error("The active conversation has no saved hidden workspace URL. Start a new chat instead.");
    }

    return startRequest({
      profileId: "custom_text",
      sourceTab: existing.source,
      selectedText,
      manualText,
      attachments,
      parentRequestId: existing.id,
      conversationMode: "followup",
      expectedConversationUrl: existing.chatConversationUrl || null,
      expectedConversationKey: existing.chatConversationKey || null,
      chatOptionsOverride: {
        project: {
          enabled: false
        },
        conversation: {
          mode: "continue",
          startNewChat: false,
          expectedConversationUrl: existing.chatConversationUrl || null
        }
      }
    });
  }

  async function startHistoryFollowupRequest(message) {
    const conversation = normalizeConversationTarget(message.conversation);
    const attachments = normalizeIncomingAttachments(message.attachments);
    const selectedText = normalizeText(message.selectedText || "");
    const manualText = buildComposerPrompt({
      text: message.text,
      selectedText,
      attachments
    });

    if (!manualText) {
      throw new Error("Follow-up prompt is empty.");
    }

    if (!conversation.url) {
      throw new Error("The selected conversation has no saved workspace target.");
    }

    if (!isChatGptUrl(conversation.url)) {
      throw new Error("The selected conversation target is not a workspace URL.");
    }

    const sourceTab = await queryBestSourceTab();

    return startRequest({
      profileId: "custom_text",
      sourceTab,
      selectedText,
      manualText,
      attachments,
      parentRequestId: null,
      conversationMode: "followup",
      expectedConversationUrl: conversation.url || null,
      expectedConversationKey: conversation.key || null,
      chatOptionsOverride: {
        project: {
          enabled: false
        },
        conversation: {
          mode: "continue",
          startNewChat: false,
          expectedConversationUrl: conversation.url || null
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

    const isFollowupRetry = existing.conversationMode === "followup";
    const retry = await startRequest({
      profileId: existing.profileId,
      sourceTab: existing.source,
      selectedText: existing.selectedText,
      manualText: existing.manualText,
      attachments,
      parentRequestId: existing.parentRequestId || null,
      conversationMode: existing.conversationMode || "new",
      expectedConversationUrl: isFollowupRetry ? existing.chatConversationUrl || null : null,
      expectedConversationKey: isFollowupRetry ? existing.chatConversationKey || null : null,
      chatOptionsOverride: isFollowupRetry
        ? {
          project: {
            enabled: false
          },
          conversation: {
            mode: "continue",
            startNewChat: false,
            expectedConversationUrl: existing.chatConversationUrl || null
          }
        }
        : {
          conversation: {
            mode: "new",
            startNewChat: true,
            expectedConversationUrl: null
          }
        }
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

    const cancelMessage = {
      type: CHATGPT_AUTOMATION_MESSAGES.CANCEL,
      requestId
    };

    void deliverAutomationCancel(request, cancelMessage);

    await disableFocusEmulationForRequest(requestId).catch(() => null);
    await clearAutomationRequestActive(requestId).catch(() => null);

    if (request.completedAt || isTerminalState(request.state)) {
      return {};
    }

    await updateRequest(requestId, (draft) => {
      draft.state = REQUEST_STATES.ERROR_STATE;
      draft.error = "Cancelled by user.";
      draft.errorCode = REQUEST_ERROR_CODES.CHATGPT_UNAVAILABLE;
      draft.completedAt = new Date().toISOString();
      appendEvent(draft, "Request cancelled.");
    });

    return {};
  }

  async function deliverAutomationCancel(request, cancelMessage) {
    if (
      request.automationTargetType === AUTOMATION_TARGET_TYPES.OFFSCREEN_FRAME
      || request.automationVisibilityMode === VISIBILITY_MODES.HIDDEN
    ) {
      await sendMessageToOffscreenFrame(cancelMessage).catch(() => null);
    }
  }

  async function openChatGptAuth() {
    const tab = await chrome.tabs.create({
      url: CHATGPT_HOME_URL,
      active: true
    });

    return {
      tabId: tab.id
    };
  }

  return Object.freeze({
    startManualRequest,
    startScreenshotRequest,
    captureScreenshotAttachment,
    startFollowupRequest,
    startHistoryFollowupRequest,
    retryRequest,
    cancelRequest,
    openChatGptAuth
  });
}

function buildComposerPrompt({ text, selectedText, attachments }) {
  const manualText = normalizeComposerText(text);
  const contextText = normalizeComposerText(selectedText);
  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;

  if (!contextText) {
    if (manualText) {
      return manualText;
    }

    return hasAttachments ? "Please analyze the attached file(s)." : "";
  }

  const instruction = manualText || "Answer based on the selected webpage text.";

  return [
    instruction,
    "",
    "Selected webpage text:",
    contextText
  ].join("\n");
}


function normalizeComposerText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function normalizeIncomingAttachments(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((attachment) => attachment && typeof attachment === "object" && typeof attachment.dataUrl === "string" && attachment.dataUrl.startsWith("data:"))
    .map((attachment) => ({
      id: String(attachment.id || createAttachmentId()),
      kind: attachment.kind === "image" ? "image" : "file",
      name: String(attachment.name || "attachment").slice(0, 160),
      mimeType: String(attachment.mimeType || "application/octet-stream").slice(0, 120),
      sizeBytes: Number.isFinite(Number(attachment.sizeBytes)) ? Number(attachment.sizeBytes) : null,
      dataUrl: attachment.dataUrl
    }));
}

function normalizeConversationTarget(value) {
  const source = value && typeof value === "object" ? value : {};

  return {
    key: normalizeComposerText(source.key || source.id || source.conversationKey || ""),
    url: normalizeComposerText(source.url || source.conversationUrl || "")
  };
}

function createAttachmentId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
