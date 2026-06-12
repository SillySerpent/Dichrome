import {
  VISIBILITY_SETTINGS_VERSION
} from "../../background/automation/settings.js";
import {
  PANEL_MESSAGES,
  PROJECT_CONVERSATION_HISTORY_LIMIT,
  PROJECT_CONVERSATION_MESSAGE_BATCH_SIZE,
  REQUEST_ERROR_CODES,
  VISIBILITY_MODES
} from "../../shared/contracts.js";
import { getErrorPresentation } from "../../shared/error-messages.js";
import {
  normalizeResponseHtml,
  normalizeResponseText,
  renderMarkdownToHtml
} from "../../shared/response-formatting.js";
import {
  getPendingAttachmentLimitViolation
} from "./attachment-limits.js";
import {
  captureVisibleScreenshotAttachment,
  createImageAttachmentsFromUrls,
  createFileAttachments,
  formatBytes,
  removeAttachmentFromList
} from "./attachments.js";
import { sendMessage } from "./client.js";
import { dom } from "./dom.js";
import {
  extractDroppedPromptText,
  extractDroppedImageUrls,
  getDroppedFiles,
  insertDroppedTextIntoComposer
} from "./drop-content.js";
import {
  createProjectHistoryState,
  loadPersistedProjectHistoryState,
  normalizeHistoryProjectKey,
  persistProjectHistoryState,
  PROJECT_HISTORY_STATUS,
  setProjectHistoryStatus
} from "./project-history-state.js";
import {
  getUnreflectedLiveRequestsForHistory
} from "./conversation-thread.js";
import {
  createSelectionKey,
  resolveSelectedContextUpdate
} from "./selection-context.js";
import { createResponseAnimation } from "./response-animation.js";
import { createResponseView } from "./response-view.js";
import { createSettingsDialog } from "./settings-dialog.js";
import { createMessageCardFactory } from "./message-cards.js";
import {
  appendPendingAttachment,
  renderPendingAttachments
} from "./pending-attachments.js";
import {
  formatHistoryMeta,
  formatRequestStatus,
  isAuthRequired
} from "./status-formatting.js";
import {
  isRunningRequest,
  isStreamingState
} from "./state.js";

const MAX_CONTEXT_PREVIEW_LENGTH = 700;
const SELECTION_REFRESH_DELAY_MS = 3000;
const SELECTION_POLL_INTERVAL_MS = 3000;
const CHAT_THREAD_AUTOSCROLL_BOTTOM_THRESHOLD_PX = 64;
const CHAT_THREAD_HISTORY_TOP_THRESHOLD_PX = 72;
const HISTORY_LIST_BOTTOM_THRESHOLD_PX = 48;
const PROJECT_HISTORY_AUTO_LOAD_DELAY_MS = 120;
const PROJECT_HISTORY_AUTO_RETRY_DELAY_MS = 4000;
const PROJECT_HISTORY_AUTO_RETRY_MAX_DELAY_MS = 30000;
const DEFAULT_PROJECT_NAME = chrome.runtime?.getManifest?.().name || "Dichrome";

let panelState = {
  activeRequestId: null,
  requests: []
};
let automationSettingsState = null;
let workspaceReadinessState = { ready: false, checked: false, message: "Preparing hidden ChatGPT workspace...", errorCode: null };

let outgoingRequestPending = null;
let composerSendInFlight = false;
let forceNewConversationDraft = false;
let pendingAttachments = [];
let selectedContext = null;
let dismissedSelectionKey = "";
let selectionRefreshTimer = null;
let selectionPollTimer = null;
let selectionRefreshPromise = null;
let composerReadingMode = true;
let projectHistoryReadingMode = true;
let projectHistoryAutoLoadTimer = null;
let projectHistoryAutoRetryCount = 0;
let projectHistoryLoadPromise = null;
const projectHistoryState = createProjectHistoryState();
const chatThreadScrollState = {
  autoScroll: true,
  lastProgrammaticScrollAt: 0
};

const responseView = createResponseView({
  responseText: dom.responseText
});
const messageCards = createMessageCardFactory({
  responseText: dom.responseText,
  responseView
});
const responseAnimation = createResponseAnimation({
  renderMarkdownToHtml,
  resetAutoScroll: responseView.resetAutoScroll,
  setHtml: responseView.setHtml
});
const settingsDialog = createSettingsDialog({
  dom,
  defaultProjectName: DEFAULT_PROJECT_NAME,
  getAutomationSettings: () => automationSettingsState,
  getWorkspaceReadiness: () => workspaceReadinessState,
  normalizePublicAutomationSettings
});

document.addEventListener("DOMContentLoaded", () => {
  void initialize();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === PANEL_MESSAGES.PANEL_STATE_UPDATED) {
    panelState = message.panelState;
    render();
    return;
  }
});

async function initialize() {
  bindEvents();
  loadPersistedProjectHistoryState(projectHistoryState);
  await Promise.all([
    loadPanelState(),
    loadAutomationSettings()
  ]);
  await loadWorkspaceReadiness({ silent: true });
  await maybeRefreshSelectedContext();
  render();
  startSelectedContextPolling();
  scheduleProjectHistoryAutoLoad({
    force: true,
    reset: true
  });
}

function bindEvents() {
  dom.refreshButton.addEventListener("click", () => {
    void runPanelAction(async () => {
      await Promise.all([
        loadPanelState(),
        loadWorkspaceReadiness({ silent: true }),
        maybeRefreshSelectedContext()
      ]);
      render();
    });
  });

  dom.newChatButton.addEventListener("click", () => {
    startNewConversationDraft();
  });

  dom.settingsButton.addEventListener("click", () => {
    settingsDialog.open();
  });

  dom.settingsCloseButton.addEventListener("click", () => {
    settingsDialog.close();
  });

  dom.settingsCancelButton.addEventListener("click", () => {
    settingsDialog.close();
  });

  dom.settingsOverlay.addEventListener("click", (event) => {
    if (event.target === dom.settingsOverlay) {
      settingsDialog.close();
    }
  });

  dom.settingsSaveButton.addEventListener("click", () => {
    void runPanelAction(() => saveAutomationSettings({ silent: false, closeAfterSave: true }));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !dom.settingsOverlay.classList.contains("hidden")) {
      settingsDialog.close();
    }
  });

  dom.historyRefreshButton.addEventListener("click", () => {
    markProjectHistoryInterest();
    void runPanelAction(() => loadProjectConversations({
      reset: true
    }));
  });

  dom.historyList.addEventListener("click", (event) => {
    const conversationButton = event.target?.closest?.("[data-history-conversation-id]");

    if (conversationButton) {
      markProjectHistoryInterest();
      void runPanelAction(() => loadProjectConversation(conversationButton.dataset.historyConversationId));
      return;
    }

    if (event.target?.closest?.("[data-history-load-more]")) {
      markProjectHistoryInterest();
      void runPanelAction(() => loadProjectConversations({
        reset: false
      }));
    }
  });

  dom.historyList.addEventListener("scroll", () => {
    if (projectHistoryState.loadingList || projectHistoryState.nextCursor === null) {
      return;
    }

    const distanceFromBottom = dom.historyList.scrollHeight - dom.historyList.clientHeight - dom.historyList.scrollTop;

    if (distanceFromBottom <= HISTORY_LIST_BOTTOM_THRESHOLD_PX) {
      void runPanelAction(() => loadProjectConversations({
        reset: false
      }));
    }
  }, {
    passive: true
  });

  dom.sendManualButton.addEventListener("click", () => {
    void runPanelAction(sendComposerRequest);
  });

  dom.manualText.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void runPanelAction(sendComposerRequest);
    }
  });

  dom.manualText.addEventListener("input", () => {
    markComposerInterest();
    scheduleSelectedContextRefresh();
    updateComposerSendState();
  });

  dom.manualText.addEventListener("paste", (event) => {
    const files = getDroppedFiles(event.clipboardData);
    const imageUrls = extractDroppedImageUrls(event.clipboardData);

    if (!files.length && !imageUrls.length) {
      return;
    }

    event.preventDefault();
    markComposerInterest();
    const text = extractDroppedPromptText(event.clipboardData);
    void runPanelAction(() => handleComposerTransfer({
      files,
      imageUrls,
      text,
      verb: "Pasted"
    }));
  });

  dom.manualText.addEventListener("focus", () => {
    markComposerInterest();
    scheduleSelectedContextRefresh();
  });

  dom.manualText.addEventListener("keydown", () => {
    markComposerInterest();
  });

  dom.composerScreenshotButton.addEventListener("click", () => {
    void runPanelAction(attachVisibleScreenshot);
  });

  dom.attachFileButton?.addEventListener("click", () => {
    dom.attachmentInput.click();
  });

  dom.composerAttachButton.addEventListener("click", () => {
    dom.attachmentInput.click();
  });

  dom.attachmentInput.addEventListener("change", () => {
    void runPanelAction(async () => {
      await attachFilesFromInput(dom.attachmentInput.files);
      dom.attachmentInput.value = "";
    });
  });

  dom.attachmentsTray.addEventListener("click", (event) => {
    const button = event.target?.closest?.("[data-remove-attachment]");

    if (!button) {
      return;
    }

    removeAttachment(button.dataset.removeAttachment);
  });

  dom.clearSelectedContextButton.addEventListener("click", () => {
    dismissedSelectionKey = selectedContext ? createSelectionKey(selectedContext.text) : dismissedSelectionKey;
    selectedContext = null;
    renderSelectedContext();
    updateComposerSendState();
  });

  dom.quickActions.addEventListener("click", (event) => {
    const button = event.target?.closest?.("button[data-action]");

    if (!button) {
      return;
    }

    applyQuickAction(button.dataset.action);
  });

  dom.composerDropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
    markComposerInterest();
    dom.composerDropZone.classList.add("drag-over");
  });

  dom.composerDropZone.addEventListener("dragleave", () => {
    dom.composerDropZone.classList.remove("drag-over");
  });

  dom.composerDropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    markComposerInterest();
    dom.composerDropZone.classList.remove("drag-over");
    const files = getDroppedFiles(event.dataTransfer);
    const imageUrls = extractDroppedImageUrls(event.dataTransfer);
    const text = extractDroppedPromptText(event.dataTransfer);
    void runPanelAction(() => handleComposerTransfer({
      files,
      imageUrls,
      text,
      verb: "Dropped"
    }));
  });

  for (const eventName of ["focusin", "pointerdown", "pointerenter"]) {
    dom.composerPanel.addEventListener(eventName, markComposerInterest);
  }

  for (const eventName of ["focusin", "pointerdown", "pointerenter"]) {
    dom.historyPanel?.addEventListener(eventName, markProjectHistoryInterest);
  }

  for (const eventName of ["focusin", "pointerdown", "pointerenter", "wheel", "scroll"]) {
    dom.chatMessages.addEventListener(eventName, markReaderInterest, {
      passive: eventName === "wheel" || eventName === "scroll"
    });
  }

  dom.chatMessages.addEventListener("scroll", () => {
    const now = Date.now();

    if (now - chatThreadScrollState.lastProgrammaticScrollAt < 180) {
      return;
    }

    if (projectHistoryState.activeConversation && dom.chatMessages.scrollTop <= CHAT_THREAD_HISTORY_TOP_THRESHOLD_PX) {
      revealOlderHistoryMessages();
      return;
    }

    chatThreadScrollState.autoScroll = isChatThreadScrolledNearBottom();
  }, {
    passive: true
  });

  dom.chatMessages.addEventListener("click", (event) => {
    if (event.target?.closest?.("[data-load-older-history-messages]")) {
      revealOlderHistoryMessages();
    }
  });

  dom.retryButton.addEventListener("click", () => {
    void runPanelAction(() => retryActiveRequest(false));
  });

  dom.openChatGptButton.addEventListener("click", () => {
    void runPanelAction(() => sendMessage(PANEL_MESSAGES.OPEN_CHATGPT_AUTH));
  });

  dom.cancelButton.addEventListener("click", () => {
    const request = projectHistoryState.activeConversation
      ? getActiveProjectConversationRequest()
      : getActiveRequest();

    if (request) {
      void runPanelAction(() => sendMessage(PANEL_MESSAGES.CANCEL_REQUEST, {
        requestId: request.id
      }));
    }
  });


  window.addEventListener("focus", () => {
    scheduleSelectedContextRefresh();
    startSelectedContextPolling();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      scheduleSelectedContextRefresh();
      startSelectedContextPolling();
      return;
    }

    stopSelectedContextPolling();
  });

  responseView.bindInteractions();
}

async function loadPanelState() {
  const response = await sendMessage(PANEL_MESSAGES.GET_PANEL_STATE);
  panelState = response.panelState || panelState;
}

async function loadAutomationSettings() {
  const response = await sendMessage(PANEL_MESSAGES.GET_CHATGPT_AUTOMATION_SETTINGS);
  const settings = response.settings || {};

  automationSettingsState = normalizePublicAutomationSettings(settings);
  settingsDialog.render();
}


async function loadWorkspaceReadiness({ silent = false } = {}) {
  workspaceReadinessState = {
    ...workspaceReadinessState,
    checked: false,
    message: "Preparing hidden ChatGPT workspace...",
    errorCode: null
  };

  try {
    const response = await sendMessage(PANEL_MESSAGES.CHECK_CHATGPT_WORKSPACE);
    workspaceReadinessState = {
      ready: Boolean(response.ready),
      checked: true,
      message: response.message || (response.ready ? "Hidden ChatGPT workspace is ready." : "Hidden ChatGPT workspace is not ready."),
      errorCode: response.errorCode || null
    };
  } catch (error) {
    const presentation = getErrorPresentation(error.errorCode, error.message || String(error));
    workspaceReadinessState = {
      ready: false,
      checked: true,
      message: `${presentation.title} ${presentation.detail}`.trim(),
      errorCode: error.errorCode || REQUEST_ERROR_CODES.CHATGPT_UNAVAILABLE
    };
  }

  if (!silent) {
    setTransientStatus(workspaceReadinessState.ready ? "Hidden workspace ready." : workspaceReadinessState.message);
  }
}

function normalizePublicAutomationSettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const project = source.project && typeof source.project === "object" ? source.project : {};
  const model = source.model && typeof source.model === "object" ? source.model : {};

  return {
    project: {
      enabled: project.enabled !== false,
      name: String(project.name || DEFAULT_PROJECT_NAME).trim() || DEFAULT_PROJECT_NAME,
      createIfMissing: project.createIfMissing !== false,
      segment: String(project.segment || ""),
      url: String(project.url || "")
    },
    conversation: {
      startNewChat: false
    },
    visibility: {
      schemaVersion: VISIBILITY_SETTINGS_VERSION,
      mode: VISIBILITY_MODES.HIDDEN
    },
    model: {
      enabled: Boolean(model.enabled || model.label),
      label: String(model.label || "").trim(),
      requireExact: Boolean(model.requireExact)
    }
  };
}

function getCurrentProjectSettings() {
  return normalizePublicAutomationSettings(automationSettingsState || {}).project;
}

function scheduleProjectHistoryAutoLoad({ force = false, reset = false, delayMs = PROJECT_HISTORY_AUTO_LOAD_DELAY_MS } = {}) {
  window.clearTimeout(projectHistoryAutoLoadTimer);

  if (projectHistoryState.loadingList || projectHistoryLoadPromise) {
    return;
  }

  projectHistoryAutoLoadTimer = window.setTimeout(() => {
    projectHistoryAutoLoadTimer = null;
    void runPanelAction(() => maybeAutoLoadProjectHistory({
      force,
      reset
    }));
  }, delayMs);
}

async function maybeAutoLoadProjectHistory({ force = false, reset = false } = {}) {
  if (!shouldLoadProjectHistoryAutomatically()) {
    return;
  }

  if (projectHistoryState.loadingList) {
    return;
  }

  const currentKey = getCurrentProjectHistoryKey();
  const loadedKey = getLoadedProjectHistoryKey();
  const shouldReset = reset || Boolean(loadedKey && loadedKey !== currentKey);

  if (!force && projectHistoryState.loaded && loadedKey === currentKey) {
    return;
  }

  await loadProjectConversations({
    reset: shouldReset || !projectHistoryState.loaded
  });
}

function shouldLoadProjectHistoryAutomatically() {
  const project = getCurrentProjectSettings();

  return Boolean(workspaceReadinessState.ready && project.enabled && project.name);
}

function getCurrentProjectHistoryKey() {
  return normalizeHistoryProjectKey(getCurrentProjectSettings());
}

function getLoadedProjectHistoryKey() {
  return normalizeHistoryProjectKey(projectHistoryState.project);
}

async function loadProjectConversations({ reset = false } = {}) {
  if (projectHistoryLoadPromise) {
    return projectHistoryLoadPromise;
  }

  if (projectHistoryState.loadingList) {
    return;
  }

  if (!reset && projectHistoryState.loaded && projectHistoryState.nextCursor === null) {
    return;
  }

  projectHistoryState.loadingList = true;
  projectHistoryState.pending = false;
  projectHistoryState.pendingSource = "";
  projectHistoryState.error = "";
  setProjectHistoryStatus(projectHistoryState, PROJECT_HISTORY_STATUS.LOADING);
  renderHistoryPanel({
    preserveScroll: true
  });

  projectHistoryLoadPromise = (async () => {
    try {
      const response = await sendMessage(PANEL_MESSAGES.GET_PROJECT_CONVERSATIONS, {
        cursor: reset ? 0 : projectHistoryState.nextCursor || 0,
        limit: PROJECT_CONVERSATION_HISTORY_LIMIT
      });

      if (response.pending) {
        projectHistoryState.project = response.project || projectHistoryState.project;
        projectHistoryState.pendingSource = response.source || "pending";
        setProjectHistoryStatus(projectHistoryState, PROJECT_HISTORY_STATUS.PENDING_AUTH);
        const retryDelay = Math.min(
          PROJECT_HISTORY_AUTO_RETRY_MAX_DELAY_MS,
          PROJECT_HISTORY_AUTO_RETRY_DELAY_MS * Math.max(1, 2 ** projectHistoryAutoRetryCount)
        );
        projectHistoryAutoRetryCount += 1;
        window.clearTimeout(projectHistoryAutoLoadTimer);
        projectHistoryAutoLoadTimer = window.setTimeout(() => {
          projectHistoryAutoLoadTimer = null;
          void runPanelAction(() => maybeAutoLoadProjectHistory({
            force: true,
            reset: true
          }));
        }, retryDelay);
        return;
      }

      const incoming = Array.isArray(response.conversations) ? response.conversations : [];
      const existing = reset ? [] : projectHistoryState.conversations;
      const byId = new Map(existing.map((conversation) => [conversation.id, conversation]));

      for (const conversation of incoming) {
        if (conversation?.id) {
          byId.set(conversation.id, conversation);
        }
      }

      projectHistoryAutoRetryCount = 0;
      projectHistoryState.project = response.project || projectHistoryState.project;
      projectHistoryState.conversations = Array.from(byId.values());
      projectHistoryState.nextCursor = response.nextCursor ?? null;
      setProjectHistoryStatus(
        projectHistoryState,
        projectHistoryState.conversations.length
          ? PROJECT_HISTORY_STATUS.LOADED
          : PROJECT_HISTORY_STATUS.EMPTY
      );
    } catch (error) {
      const presentation = getErrorPresentation(error.errorCode, error.message || String(error));
      projectHistoryState.error = `${presentation.title} ${presentation.detail}`.trim();
      setProjectHistoryStatus(
        projectHistoryState,
        error.errorCode === REQUEST_ERROR_CODES.AUTH_REQUIRED
          ? PROJECT_HISTORY_STATUS.LOGGED_OUT
          : PROJECT_HISTORY_STATUS.ERROR
      );
      throw error;
    } finally {
      projectHistoryState.loadingList = false;
      projectHistoryLoadPromise = null;
      renderHistoryPanel({
        preserveScroll: true,
        scrollAnchor: reset ? "preserve" : "append"
      });
    }
  })();

  return projectHistoryLoadPromise;
}

async function loadProjectConversation(conversationId) {
  const summary = projectHistoryState.conversations.find((conversation) => conversation.id === conversationId);

  if (!summary) {
    throw new Error("Conversation not found in loaded project history.");
  }

  projectHistoryState.loadingConversationId = conversationId;
  projectHistoryState.error = "";
  renderHistoryPanel({
    preserveScroll: true
  });

  try {
    const response = await sendMessage(PANEL_MESSAGES.GET_PROJECT_CONVERSATION, {
      conversationId: summary.id,
      conversationUrl: summary.url
    });
    const conversation = normalizeLoadedProjectConversation(response.conversation || summary);

    forceNewConversationDraft = false;
    projectHistoryState.activeConversation = conversation;
    projectHistoryState.renderedMessageCount = Math.min(
      conversation.messages.length,
      PROJECT_CONVERSATION_MESSAGE_BATCH_SIZE
    );
    chatThreadScrollState.autoScroll = true;
    projectHistoryReadingMode = true;
    responseAnimation.stop();
    responseView.resetAutoScroll();
    render();
    setTransientStatus(`Loaded ${conversation.title}`);
  } catch (error) {
    projectHistoryState.error = error.message || String(error);
    if (error.errorCode === REQUEST_ERROR_CODES.AUTH_REQUIRED) {
      setProjectHistoryStatus(projectHistoryState, PROJECT_HISTORY_STATUS.LOGGED_OUT);
    }
    throw error;
  } finally {
    projectHistoryState.loadingConversationId = "";
    renderHistoryPanel({
      preserveScroll: true
    });
  }
}

function normalizeLoadedProjectConversation(value) {
  const source = value && typeof value === "object" ? value : {};
  const messages = Array.isArray(source.messages)
    ? source.messages
      .filter((message) => message && (message.role === "user" || message.role === "assistant") && normalizeResponseText(message.text || ""))
      .map((message) => ({
        id: String(message.id || createLocalId()),
        role: message.role,
        text: normalizeResponseText(message.text || ""),
        html: message.html || "",
        createdAt: message.createdAt || null,
        updatedAt: message.updatedAt || null
      }))
    : [];

  return {
    id: String(source.id || ""),
    title: String(source.title || "Untitled conversation"),
    url: String(source.url || ""),
    projectName: String(source.projectName || projectHistoryState.project?.name || ""),
    projectSegment: String(source.projectSegment || projectHistoryState.project?.segment || ""),
    messages,
    messageCount: Number.isFinite(Number(source.messageCount)) ? Number(source.messageCount) : messages.length,
    loadedAt: source.loadedAt || new Date().toISOString()
  };
}

async function sendComposerRequest() {
  if (composerSendInFlight) {
    setTransientStatus("Message is already being sent.");
    return;
  }

  composerSendInFlight = true;
  updateComposerSendState();

  try {
    await maybeRefreshSelectedContext();

    const text = dom.manualText.value.trim();
    const selectedText = selectedContext?.text || "";
    const attachments = pendingAttachments.map((attachment) => ({ ...attachment }));

    if (!text && !selectedText && !attachments.length) {
      setTransientStatus("Message is empty.");
      return;
    }

    const activeRequest = getActiveRequest();
    const canContinueProjectConversation = canContinueActiveProjectConversation();
    const canContinue = !canContinueProjectConversation && canContinueActiveConversation(activeRequest);

    if (isRunningRequest(activeRequest)) {
      setTransientStatus("Wait for the current response or cancel it first.");
      return;
    }

    await saveAutomationSettings({ silent: true });
    markOutgoingRequestPending(canContinue || canContinueProjectConversation ? "Sending message..." : "Starting new conversation...");

    if (canContinue) {
      await sendMessage(PANEL_MESSAGES.RUN_FOLLOWUP_REQUEST, {
        requestId: activeRequest.id,
        text,
        selectedText,
        attachments
      });
    } else if (canContinueProjectConversation) {
      await sendMessage(PANEL_MESSAGES.RUN_HISTORY_FOLLOWUP_REQUEST, {
        conversation: {
          id: projectHistoryState.activeConversation.id,
          url: projectHistoryState.activeConversation.url
        },
        text,
        selectedText,
        attachments
      });
    } else {
      await sendMessage(PANEL_MESSAGES.RUN_MANUAL_REQUEST, {
        profileId: "custom_text",
        text,
        selectedText,
        attachments,
        forceNewChat: true
      });
    }

    clearComposerAfterSend();
    await loadPanelState();
    render();
  } finally {
    composerSendInFlight = false;
    updateComposerSendState();
  }
}

function canContinueActiveConversation(request) {
  if (forceNewConversationDraft || !request || isRunningRequest(request)) {
    return false;
  }

  return Boolean(request.chatConversationUrl || request.chatConversationKey);
}

function canContinueActiveProjectConversation() {
  return Boolean(!forceNewConversationDraft && projectHistoryState.activeConversation?.url);
}

function clearComposerAfterSend() {
  dom.manualText.value = "";
  pendingAttachments = [];
  dismissedSelectionKey = selectedContext ? createSelectionKey(selectedContext.text) : dismissedSelectionKey;
  selectedContext = null;
  forceNewConversationDraft = false;
  renderAttachments();
  renderSelectedContext();
  updateComposerSendState();
}

function startNewConversationDraft() {
  composerReadingMode = false;
  projectHistoryReadingMode = true;
  chatThreadScrollState.autoScroll = true;
  forceNewConversationDraft = true;
  pendingAttachments = [];
  selectedContext = null;
  projectHistoryState.activeConversation = null;
  projectHistoryState.renderedMessageCount = 0;
  dismissedSelectionKey = "";
  dom.manualText.value = "";
  responseAnimation.stop();
  responseView.resetAutoScroll();
  responseView.setHtml("", { forceScroll: true });
  renderAttachments();
  renderSelectedContext();
  render();
  dom.manualText.focus();
  setTransientStatus("New conversation ready. The next send will start separately.");
}

async function attachVisibleScreenshot() {
  const attachment = await captureVisibleScreenshotAttachment();
  if (addAttachment(attachment)) {
    setTransientStatus("Screenshot attached.");
  }
}

async function attachFilesFromInput(fileList) {
  const { attachments, rejected } = await createFileAttachments(fileList);
  const acceptedAttachments = [];
  let limitRejectedCount = 0;

  for (const message of rejected) {
    setTransientStatus(message);
  }

  for (const attachment of attachments) {
    if (addAttachment(attachment)) {
      acceptedAttachments.push(attachment);
    } else {
      limitRejectedCount += 1;
    }
  }

  if (acceptedAttachments.length && limitRejectedCount) {
    setTransientStatus(`${acceptedAttachments.length} attachment${acceptedAttachments.length === 1 ? "" : "s"} added; ${limitRejectedCount} skipped by attachment limits.`);
  } else if (acceptedAttachments.length) {
    setTransientStatus(`${acceptedAttachments.length} attachment${acceptedAttachments.length === 1 ? "" : "s"} added.`);
  }

  return {
    attachments: acceptedAttachments,
    rejected
  };
}

async function attachImagesFromUrls(urls) {
  const { attachments, rejected } = await createImageAttachmentsFromUrls(urls);
  const acceptedAttachments = [];
  let limitRejectedCount = 0;

  for (const message of rejected) {
    setTransientStatus(message);
  }

  for (const attachment of attachments) {
    if (addAttachment(attachment)) {
      acceptedAttachments.push(attachment);
    } else {
      limitRejectedCount += 1;
    }
  }

  if (acceptedAttachments.length && limitRejectedCount) {
    setTransientStatus(`${acceptedAttachments.length} image${acceptedAttachments.length === 1 ? "" : "s"} added; ${limitRejectedCount} skipped by attachment limits.`);
  }

  return {
    attachments: acceptedAttachments,
    rejected
  };
}

async function handleComposerTransfer({ files = [], imageUrls = [], text = "", verb = "Added" } = {}) {
  const droppedFiles = Array.from(files || []);
  const droppedImageUrls = Array.from(imageUrls || []);
  let insertedText = false;
  let attachmentCount = 0;

  if (droppedFiles.length) {
    const result = await attachFilesFromInput(droppedFiles);
    attachmentCount += result.attachments.length;
  }

  if (droppedImageUrls.length) {
    const result = await attachImagesFromUrls(droppedImageUrls);
    attachmentCount += result.attachments.length;
  }

  if (text) {
    insertedText = insertDroppedTextIntoComposer(dom.manualText, text);
  }

  if (insertedText) {
    markComposerInterest();
    updateComposerSendState();
    setTransientStatus(attachmentCount ? `${verb} attachments and text added.` : `${verb} text added.`);
    return;
  }

  if (attachmentCount) {
    setTransientStatus(`${verb} ${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}.`);
    return;
  }

  if (droppedImageUrls.length) {
    insertDroppedTextIntoComposer(dom.manualText, droppedImageUrls.join("\n"));
    updateComposerSendState();
    setTransientStatus(`Could not attach ${droppedImageUrls.length === 1 ? "image" : "images"}; inserted ${droppedImageUrls.length === 1 ? "URL" : "URLs"} instead.`);
    return;
  }

  if (!droppedFiles.length) {
    setTransientStatus(`No usable ${verb.toLowerCase()} content was found.`);
  }
}

function addAttachment(attachment) {
  const result = appendPendingAttachment(pendingAttachments, attachment, {
    createLocalId,
    getLimitViolation: getPendingAttachmentLimitViolation
  });

  if (!result.added) {
    setTransientStatus(result.limitViolation);
    return false;
  }

  markComposerInterest();
  pendingAttachments = result.attachments;
  renderAttachments();
  updateComposerSendState();
  return true;
}

function removeAttachment(attachmentId) {
  markComposerInterest();
  pendingAttachments = removeAttachmentFromList(pendingAttachments, attachmentId);
  renderAttachments();
  updateComposerSendState();
}

function renderAttachments() {
  renderPendingAttachments({
    container: dom.attachmentsTray,
    attachments: pendingAttachments,
    formatBytes
  });
}

function scheduleSelectedContextRefresh() {
  window.clearTimeout(selectionRefreshTimer);
  selectionRefreshTimer = window.setTimeout(() => {
    void maybeRefreshSelectedContext();
  }, SELECTION_REFRESH_DELAY_MS);
}

async function maybeRefreshSelectedContext() {
  if (selectionRefreshPromise) {
    return selectionRefreshPromise;
  }

  selectionRefreshPromise = refreshSelectedContextNow()
    .finally(() => {
      selectionRefreshPromise = null;
    });

  return selectionRefreshPromise;
}

async function refreshSelectedContextNow() {
  const selection = await getActiveTabSelection().catch(() => null);
  const update = resolveSelectedContextUpdate({
    currentContext: selectedContext,
    dismissedSelectionKey,
    selection
  });

  selectedContext = update.selectedContext;
  dismissedSelectionKey = update.dismissedSelectionKey;

  if (update.changed) {
    renderSelectedContext();
    updateComposerSendState();
  }
}

function startSelectedContextPolling() {
  if (document.hidden || selectionPollTimer) {
    return;
  }

  selectionPollTimer = window.setTimeout(runSelectedContextPoll, SELECTION_POLL_INTERVAL_MS);
}

function stopSelectedContextPolling() {
  window.clearTimeout(selectionPollTimer);
  selectionPollTimer = null;
}

async function runSelectedContextPoll() {
  selectionPollTimer = null;
  await maybeRefreshSelectedContext().catch(() => null);
  startSelectedContextPolling();
}

async function getActiveTabSelection() {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });

  if (!tab?.id || /^chrome:|^edge:|^brave:|^chrome-extension:/i.test(tab.url || "")) {
    return null;
  }

  const [result] = await chrome.scripting.executeScript({
    target: {
      tabId: tab.id
    },
    func: () => ({
      text: String(globalThis.getSelection?.() || ""),
      title: document.title || "",
      url: location.href
    })
  });

  return result?.result || null;
}

function renderSelectedContext() {
  const hasContext = Boolean(selectedContext?.text);
  dom.selectedContextCard.classList.toggle("hidden", !hasContext);

  if (!hasContext) {
    dom.selectedContextPreview.textContent = "";
    return;
  }

  const prefix = selectedContext.sourceTitle ? `${selectedContext.sourceTitle}\n` : "";
  dom.selectedContextPreview.textContent = `${prefix}${truncateText(selectedContext.text, MAX_CONTEXT_PREVIEW_LENGTH)}`;
}

function applyQuickAction(action) {
  if (!selectedContext?.text) {
    return;
  }

  const prompts = {
    explain: "Explain the selected text in plain language.",
    summarize: "Summarize the selected text compactly and include the key caveats.",
    improve: "Improve the selected text while preserving the original meaning.",
    rewrite: "Rewrite the selected text clearly and naturally.",
    define: "Define the selected word or phrase and explain the likely meaning in context."
  };

  dom.manualText.value = prompts[action] || prompts.explain;
  markComposerInterest();
  dom.manualText.focus();
  updateComposerSendState();
}

async function retryActiveRequest() {
  const request = projectHistoryState.activeConversation
    ? getActiveProjectConversationRequest()
    : getActiveRequest();

  if (!request) {
    setTransientStatus("No request is available to retry.");
    return;
  }

  await saveAutomationSettings({ silent: true });
  markOutgoingRequestPending("Retrying request...");
  await sendMessage(PANEL_MESSAGES.RETRY_REQUEST, {
    requestId: request.id
  });
  await loadPanelState();
  render();
}

async function saveAutomationSettings({ silent = false, closeAfterSave = false } = {}) {
  const response = await sendMessage(PANEL_MESSAGES.SET_CHATGPT_AUTOMATION_SETTINGS, {
    settings: settingsDialog.collect()
  });
  automationSettingsState = normalizePublicAutomationSettings(response.settings || {});
  settingsDialog.render();

  if (!silent) {
    projectHistoryState.loaded = false;
    projectHistoryState.conversations = [];
    projectHistoryState.nextCursor = null;
    setTransientStatus("Settings saved.");
    await loadWorkspaceReadiness({ silent: true });
    scheduleProjectHistoryAutoLoad({
      force: true,
      reset: true
    });
  }

  if (closeAfterSave) {
    settingsDialog.close();
  }
}

function render() {
  const request = forceNewConversationDraft ? null : getActiveRequest();
  const historyConversation = !forceNewConversationDraft ? projectHistoryState.activeConversation : null;
  const historyRequest = historyConversation ? getActiveProjectConversationRequest() : null;
  const displayedRequest = historyConversation ? historyRequest : request;

  if (outgoingRequestPending && request && request.id !== outgoingRequestPending.previousRequestId) {
    outgoingRequestPending = null;
  }

  const showOutgoingPending = Boolean(outgoingRequestPending)
    && (!request || request.id === outgoingRequestPending.previousRequestId)
    && (!request || !isRunningRequest(request));

  if (showOutgoingPending) {
    renderPendingOutgoingState(request);
    updateComposerSendState();
    return;
  }

  const isRunning = isRunningRequest(displayedRequest);
  dom.statusLine.textContent = displayedRequest
    ? formatRequestStatus(displayedRequest)
    : historyConversation
      ? `History - ${historyConversation.title}`
      : forceNewConversationDraft
        ? "New chat draft"
        : "Ready";

  settingsDialog.updateSummary();
  renderHistoryPanel();

  if (historyConversation) {
    renderProjectConversationThread(historyConversation, historyRequest);
    renderResponse(historyRequest);
  } else {
    renderChatThread(request);
    renderResponse(request);
  }

  if (displayedRequest?.error) {
    renderErrorBlock(displayedRequest);
  } else {
    dom.errorBlock.textContent = "";
    dom.errorBlock.classList.add("hidden");
  }

  const hasRequest = Boolean(displayedRequest);
  const needsAuth = isAuthRequired(displayedRequest)
    || projectHistoryState.status === PROJECT_HISTORY_STATUS.LOGGED_OUT
    || projectHistoryState.status === PROJECT_HISTORY_STATUS.PENDING_AUTH;

  dom.retryButton.disabled = !hasRequest;
  dom.openChatGptButton.disabled = !needsAuth;
  dom.openChatGptButton.classList.toggle("hidden", !needsAuth);
  dom.cancelButton.disabled = !isRunning;

  updateComposerSendState();
}

function renderHistoryPanel({ preserveScroll = true, scrollAnchor = "preserve" } = {}) {
  const previousScrollTop = dom.historyList.scrollTop;
  const previousScrollHeight = dom.historyList.scrollHeight;
  const projectName = projectHistoryState.project?.name || getCurrentProjectSettings().name || "Project";
  const activeTitle = projectHistoryState.activeConversation?.title || "";

  if (!workspaceReadinessState.ready && getCurrentProjectSettings().enabled) {
    dom.historyStatus.textContent = workspaceReadinessState.checked
      ? workspaceReadinessState.message
      : "Preparing hidden ChatGPT workspace";
    dom.historyRefreshButton.disabled = false;
    dom.historyList.replaceChildren();
    dom.historyList.classList.add("hidden");
    updateProjectHistoryCollapseState();
    persistProjectHistoryState(projectHistoryState);
    return;
  }

  switch (projectHistoryState.status) {
    case PROJECT_HISTORY_STATUS.LOADING:
      dom.historyStatus.textContent = `Loading ${projectName} history`;
      break;
    case PROJECT_HISTORY_STATUS.PENDING_AUTH:
    case PROJECT_HISTORY_STATUS.LOGGED_OUT:
      dom.historyStatus.textContent = `Sign in to ChatGPT to load ${projectName} history`;
      break;
    case PROJECT_HISTORY_STATUS.ERROR:
      dom.historyStatus.textContent = projectHistoryState.error || `Could not load ${projectName} history`;
      break;
    case PROJECT_HISTORY_STATUS.EMPTY:
      dom.historyStatus.textContent = `No conversations in ${projectName}`;
      break;
    case PROJECT_HISTORY_STATUS.LOADED:
      dom.historyStatus.textContent = activeTitle
        || `${projectHistoryState.conversations.length} conversation${projectHistoryState.conversations.length === 1 ? "" : "s"} in ${projectName}`;
      break;
    default:
      dom.historyStatus.textContent = `Loading ${projectName} history`;
  }

  dom.historyRefreshButton.disabled = projectHistoryState.loadingList;
  dom.historyRefreshButton.textContent = "Refresh";
  dom.historyList.replaceChildren();
  dom.historyList.classList.toggle("hidden", !projectHistoryState.conversations.length);

  for (const conversation of projectHistoryState.conversations) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-item";
    button.dataset.historyConversationId = conversation.id;
    button.classList.toggle("is-active", conversation.id === projectHistoryState.activeConversation?.id);
    button.disabled = projectHistoryState.loadingConversationId === conversation.id;

    const body = document.createElement("div");
    body.className = "history-item-body";
    const title = document.createElement("div");
    title.className = "history-item-title";
    title.textContent = conversation.title || "Untitled conversation";
    const meta = document.createElement("div");
    meta.className = "history-item-meta";
    meta.textContent = formatHistoryMeta(conversation, projectHistoryState.project?.name || "");
    body.append(title, meta);

    const marker = document.createElement("span");
    marker.className = "history-item-meta";
    marker.textContent = projectHistoryState.loadingConversationId === conversation.id ? "Loading" : "Open";

    button.append(body, marker);
    dom.historyList.append(button);
  }

  if (projectHistoryState.loaded && projectHistoryState.nextCursor !== null) {
    const loadMore = document.createElement("button");
    loadMore.type = "button";
    loadMore.className = "tiny-button history-load-more";
    loadMore.dataset.historyLoadMore = "true";
    loadMore.disabled = projectHistoryState.loadingList;
    loadMore.textContent = projectHistoryState.loadingList ? "Loading" : "Load older";
    dom.historyList.append(loadMore);
  }

  updateProjectHistoryCollapseState();
  persistProjectHistoryState(projectHistoryState);

  if (!preserveScroll || dom.historyPanel?.classList.contains("is-collapsed")) {
    return;
  }

  if (scrollAnchor === "append") {
    const delta = dom.historyList.scrollHeight - previousScrollHeight;
    dom.historyList.scrollTop = Math.max(0, previousScrollTop + delta);
    return;
  }

  const maxScrollTop = Math.max(0, dom.historyList.scrollHeight - dom.historyList.clientHeight);
  dom.historyList.scrollTop = Math.min(previousScrollTop, maxScrollTop);
}

function renderProjectConversationThread(conversation, activeRequest) {
  const previousScrollTop = dom.chatMessages.scrollTop;
  const shouldStickToBottom = chatThreadScrollState.autoScroll || isChatThreadScrolledNearBottom();
  const totalMessages = conversation.messages.length;
  const renderedCount = Math.min(
    Math.max(projectHistoryState.renderedMessageCount || PROJECT_CONVERSATION_MESSAGE_BATCH_SIZE, 0),
    totalMessages
  );
  const hiddenCount = Math.max(0, totalMessages - renderedCount);
  const visibleMessages = conversation.messages.slice(hiddenCount);

  dom.chatMessages.replaceChildren();

  if (hiddenCount > 0) {
    const loadOlder = document.createElement("button");
    loadOlder.type = "button";
    loadOlder.className = "tiny-button history-load-more";
    loadOlder.dataset.loadOlderHistoryMessages = "true";
    loadOlder.textContent = `Load ${Math.min(PROJECT_CONVERSATION_MESSAGE_BATCH_SIZE, hiddenCount)} earlier`;
    dom.chatMessages.append(loadOlder);
  }

  if (!visibleMessages.length && !activeRequest) {
    moveResponseTextToParking();
    dom.chatMessages.append(messageCards.createEmptyChat({
      title: conversation.title || "Conversation",
      body: "No messages were returned for this conversation."
    }));
    restoreChatThreadScroll(previousScrollTop, shouldStickToBottom);
    return;
  }

  for (const message of visibleMessages) {
    dom.chatMessages.append(messageCards.createHistoryMessageCard(message));
  }

  const liveRequests = activeRequest
    ? getUnreflectedLiveRequestsForHistory(conversation.messages, getRequestThread(activeRequest))
    : [];

  let renderedActiveRequest = false;

  if (liveRequests.length) {
    for (const request of liveRequests) {
      const isActiveLiveRequest = request.id === activeRequest.id;
      renderedActiveRequest = renderedActiveRequest || isActiveLiveRequest;
      dom.chatMessages.append(messageCards.createUserRequestCard(request));
      dom.chatMessages.append(messageCards.createAssistantRequestCard(request, isActiveLiveRequest));
    }
  }

  if (!renderedActiveRequest) {
    moveResponseTextToParking();
  }

  restoreChatThreadScroll(previousScrollTop, shouldStickToBottom);
}

function revealOlderHistoryMessages() {
  const conversation = projectHistoryState.activeConversation;

  if (!conversation?.messages?.length) {
    return;
  }

  const totalMessages = conversation.messages.length;
  const currentCount = Math.min(projectHistoryState.renderedMessageCount || 0, totalMessages);

  if (currentCount >= totalMessages) {
    chatThreadScrollState.autoScroll = isChatThreadScrolledNearBottom();
    return;
  }

  const previousHeight = dom.chatMessages.scrollHeight;
  projectHistoryState.renderedMessageCount = Math.min(
    totalMessages,
    currentCount + PROJECT_CONVERSATION_MESSAGE_BATCH_SIZE
  );
  chatThreadScrollState.autoScroll = false;
  render();
  const nextHeight = dom.chatMessages.scrollHeight;
  chatThreadScrollState.lastProgrammaticScrollAt = Date.now();
  dom.chatMessages.scrollTop = Math.max(0, dom.chatMessages.scrollTop + (nextHeight - previousHeight));
}

function renderChatThread(activeRequest) {
  const previousScrollTop = dom.chatMessages.scrollTop;
  const shouldStickToBottom = chatThreadScrollState.autoScroll || isChatThreadScrolledNearBottom();
  dom.chatMessages.replaceChildren();

  if (!activeRequest) {
    moveResponseTextToParking();
    dom.chatMessages.append(messageCards.createEmptyChat({
      title: forceNewConversationDraft ? "New conversation" : "Start a chat",
      body: forceNewConversationDraft
        ? "Your next message will start separately. Mode changes only affect the next send."
        : "Type below, attach context, or select webpage text. Follow-ups continue this conversation until you press New.",
      includeShortcutHint: true
    }));
    restoreChatThreadScroll(previousScrollTop, shouldStickToBottom);
    return;
  }

  const thread = getRequestThread(activeRequest);

  for (const request of thread) {
    dom.chatMessages.append(messageCards.createUserRequestCard(request));
    dom.chatMessages.append(messageCards.createAssistantRequestCard(request, request.id === activeRequest.id));
  }

  restoreChatThreadScroll(previousScrollTop, shouldStickToBottom);
}

function getRequestThread(activeRequest) {
  const byId = new Map(panelState.requests.map((request) => [request.id, request]));
  const thread = [];
  let cursor = activeRequest;
  let guard = 0;

  while (cursor && guard < 20) {
    thread.unshift(cursor);
    cursor = cursor.parentRequestId ? byId.get(cursor.parentRequestId) : null;
    guard += 1;
  }

  return thread;
}

function moveResponseTextToParking() {
  if (dom.responseText.parentElement !== dom.responseParking) {
    dom.responseParking.append(dom.responseText);
  }
}

function updateComposerSendState() {
  const request = projectHistoryState.activeConversation
    ? getActiveProjectConversationRequest() || getActiveRequest()
    : getActiveRequest();
  const hasContent = Boolean(dom.manualText.value.trim() || selectedContext?.text || pendingAttachments.length);
  dom.sendManualButton.disabled = !hasContent
    || composerSendInFlight
    || Boolean(outgoingRequestPending)
    || isRunningRequest(request);
  updateComposerCollapseState();
}

function markComposerInterest() {
  composerReadingMode = false;
  updateComposerCollapseState();
}

function markProjectHistoryInterest() {
  projectHistoryReadingMode = false;
  updateProjectHistoryCollapseState();
}

function markReaderInterest() {
  composerReadingMode = true;
  projectHistoryReadingMode = true;
  updateComposerCollapseState();
  updateProjectHistoryCollapseState();
}

function updateComposerCollapseState() {
  const activeElement = document.activeElement;
  const request = projectHistoryState.activeConversation
    ? getActiveProjectConversationRequest() || getActiveRequest()
    : getActiveRequest();
  const hasComposerFocus = Boolean(activeElement && dom.composerPanel.contains(activeElement));
  const composerIsEmpty = !dom.manualText.value.trim() && !selectedContext?.text && pendingAttachments.length === 0;
  const shouldCollapse = composerReadingMode
    && composerIsEmpty
    && !hasComposerFocus
    && !composerSendInFlight
    && !outgoingRequestPending
    && !isRunningRequest(request)
    && !request?.error;

  dom.composerPanel.classList.toggle("is-collapsed", shouldCollapse);
}

function updateProjectHistoryCollapseState() {
  const activeElement = document.activeElement;
  const hasHistoryFocus = Boolean(activeElement && dom.historyPanel?.contains(activeElement));
  const shouldCollapse = projectHistoryReadingMode
    && projectHistoryState.conversations.length > 0
    && projectHistoryState.status === PROJECT_HISTORY_STATUS.LOADED
    && !hasHistoryFocus
    && !projectHistoryState.loadingList
    && !projectHistoryState.loadingConversationId
    && !projectHistoryState.error
    && !projectHistoryState.pending;

  dom.historyPanel?.classList.toggle("is-collapsed", shouldCollapse);
}

function markOutgoingRequestPending(label) {
  const current = getActiveRequest();
  chatThreadScrollState.autoScroll = true;
  outgoingRequestPending = {
    label,
    previousRequestId: current?.id || null,
    startedAt: Date.now()
  };
  responseAnimation.stop();
  responseView.resetAutoScroll();
  responseView.setHtml("", { forceScroll: true });
  dom.statusLine.textContent = label;
}

function isChatThreadScrolledNearBottom() {
  const distanceFromBottom = dom.chatMessages.scrollHeight - dom.chatMessages.clientHeight - dom.chatMessages.scrollTop;

  return distanceFromBottom <= CHAT_THREAD_AUTOSCROLL_BOTTOM_THRESHOLD_PX;
}

function restoreChatThreadScroll(previousScrollTop, shouldStickToBottom) {
  if (shouldStickToBottom) {
    chatThreadScrollState.lastProgrammaticScrollAt = Date.now();
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
    return;
  }

  const maxScrollTop = Math.max(0, dom.chatMessages.scrollHeight - dom.chatMessages.clientHeight);
  dom.chatMessages.scrollTop = Math.min(previousScrollTop, maxScrollTop);
}

function renderPendingOutgoingState(request) {
  dom.statusLine.textContent = outgoingRequestPending?.label || "Preparing request...";
  responseAnimation.stop();
  responseView.resetAutoScroll();
  responseView.setHtml("", { forceScroll: true });
  dom.errorBlock.textContent = "";
  dom.errorBlock.classList.add("hidden");
  dom.retryButton.disabled = true;
  dom.openChatGptButton.disabled = true;
  dom.openChatGptButton.classList.add("hidden");
  dom.cancelButton.disabled = true;
}

function renderResponse(request) {
  const requestId = request?.id || null;
  const text = normalizeResponseText(request?.responseText || "");
  const fallbackHtml = request?.responseHtml || "";
  const targetIsAhead = responseAnimation.isTargetAhead(requestId, text);
  const shouldAnimate = Boolean(requestId && text && (isStreamingState(request?.state) || targetIsAhead));

  if (!requestId) {
    responseAnimation.stop();
    responseView.resetAutoScroll();
    responseView.setHtml("", { forceScroll: true });
    return;
  }

  if (!shouldAnimate) {
    responseAnimation.stop();
    responseView.setHtml(text ? renderMarkdownToHtml(text) : normalizeResponseHtml(fallbackHtml));
    return;
  }

  responseAnimation.startOrUpdate(requestId, text);
}

function getActiveRequest() {
  return panelState.requests.find((request) => request.id === panelState.activeRequestId) || panelState.requests[0] || null;
}

function getActiveProjectConversationRequest() {
  const conversation = projectHistoryState.activeConversation;

  if (!conversation) {
    return null;
  }

  const activeRequest = getActiveRequest();

  if (requestMatchesProjectConversation(activeRequest, conversation)) {
    return activeRequest;
  }

  return panelState.requests.find((request) => requestMatchesProjectConversation(request, conversation)) || null;
}

function requestMatchesProjectConversation(request, conversation) {
  if (!request || !conversation) {
    return false;
  }

  const conversationUrl = normalizeConversationUrlForComparison(conversation.url);
  const conversationKey = conversation.id || getConversationKeyFromUrl(conversation.url);
  const requestUrls = [
    request.chatConversationUrl,
    request.expectedConversationUrl
  ].map(normalizeConversationUrlForComparison).filter(Boolean);
  const requestKeys = [
    request.chatConversationKey,
    request.expectedConversationKey,
    ...requestUrls.map(getConversationKeyFromUrl)
  ].filter(Boolean).map(String);

  return Boolean(
    conversationUrl && requestUrls.includes(conversationUrl)
    || conversationKey && requestKeys.includes(String(conversationKey))
  );
}

function normalizeConversationUrlForComparison(value) {
  try {
    const url = new URL(value);

    return `${url.origin}${url.pathname}`;
  } catch (_error) {
    return "";
  }
}

function getConversationKeyFromUrl(value) {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/\/c\/([^/?#]+)/);

    return match?.[1] || "";
  } catch (_error) {
    return "";
  }
}

async function runPanelAction(action) {
  try {
    await action();
  } catch (error) {
    outgoingRequestPending = null;
    setTransientStatus(error.message || String(error));
    render();
  }
}

function setTransientStatus(text) {
  const previous = dom.statusLine.textContent;
  dom.statusLine.textContent = text;
  window.setTimeout(() => {
    if (dom.statusLine.textContent === text) {
      dom.statusLine.textContent = previous;
    }
  }, 2800);
}

function renderErrorBlock(request) {
  const presentation = getErrorPresentation(request.errorCode, request.rawError || request.error || "");

  dom.errorBlock.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = presentation.title;
  const detail = document.createElement("span");
  detail.textContent = presentation.detail;
  dom.errorBlock.append(title, detail);

  if (presentation.rawMessage) {
    const technical = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Technical detail";
    const body = document.createElement("span");
    body.textContent = presentation.rawMessage;
    technical.append(summary, body);
    dom.errorBlock.append(technical);
  }

  dom.errorBlock.classList.remove("hidden");
}

function truncateText(text, maxLength) {
  const normalized = String(text || "").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}

function createLocalId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
