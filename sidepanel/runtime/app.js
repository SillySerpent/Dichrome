import {
  VISIBILITY_SETTINGS_VERSION
} from "../../background/automation/settings.js";
import {
  PANEL_MESSAGES,
  PROJECT_CONVERSATION_HISTORY_LIMIT,
  PROJECT_CONVERSATION_MESSAGE_BATCH_SIZE,
  VISIBILITY_MODES
} from "../../shared/contracts.js";
import {
  normalizeResponseHtml,
  normalizeResponseText,
  renderMarkdownToHtml
} from "../../shared/response-formatting.js";
import { sendMessage } from "./client.js";
import { dom } from "./dom.js";
import {
  createProjectHistoryState,
  loadPersistedProjectHistoryState,
  normalizeHistoryProjectKey,
  persistProjectHistoryState
} from "./project-history-state.js";
import {
  getUnreflectedLiveRequestsForHistory
} from "./conversation-thread.js";
import { createResponseAnimation } from "./response-animation.js";
import { createResponseView } from "./response-view.js";
import {
  isRunningRequest,
  isStreamingState
} from "./state.js";

const MAX_CONTEXT_PREVIEW_LENGTH = 700;
const MAX_FILE_ATTACHMENT_BYTES = 32 * 1024 * 1024;
const SELECTION_REFRESH_DELAY_MS = 180;
const CHAT_THREAD_AUTOSCROLL_BOTTOM_THRESHOLD_PX = 64;
const CHAT_THREAD_HISTORY_TOP_THRESHOLD_PX = 72;
const HISTORY_LIST_BOTTOM_THRESHOLD_PX = 48;
const PROJECT_HISTORY_AUTO_LOAD_DELAY_MS = 120;
const PROJECT_HISTORY_AUTO_RETRY_DELAY_MS = 4000;
const PROJECT_HISTORY_AUTO_RETRY_MAX_DELAY_MS = 30000;

let profiles = [];
let panelState = {
  activeRequestId: null,
  requests: []
};

let outgoingRequestPending = null;
let composerSendInFlight = false;
let forceNewConversationDraft = false;
let pendingAttachments = [];
let selectedContext = null;
let dismissedSelectionKey = "";
let selectionRefreshTimer = null;
let composerReadingMode = true;
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
const responseAnimation = createResponseAnimation({
  renderMarkdownToHtml,
  resetAutoScroll: responseView.resetAutoScroll,
  setHtml: responseView.setHtml
});

document.addEventListener("DOMContentLoaded", () => {
  void initialize();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === PANEL_MESSAGES.PANEL_STATE_UPDATED) {
    panelState = message.panelState;
    render();
    void refreshAutomationTargetStatus();
    return;
  }
});

async function initialize() {
  bindEvents();
  loadPersistedProjectHistoryState(projectHistoryState);
  await Promise.all([
    loadProfiles(),
    loadPanelState(),
    loadRepairSettings(),
    loadAutomationSettings()
  ]);
  await maybeRefreshSelectedContext({ force: true });
  render();
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
        maybeRefreshSelectedContext({ force: true })
      ]);
      render();
    });
  });

  dom.newChatButton.addEventListener("click", () => {
    startNewConversationDraft();
  });

  dom.historyRefreshButton.addEventListener("click", () => {
    void runPanelAction(() => loadProjectConversations({
      reset: true
    }));
  });

  dom.historyList.addEventListener("click", (event) => {
    const conversationButton = event.target?.closest?.("[data-history-conversation-id]");

    if (conversationButton) {
      void runPanelAction(() => loadProjectConversation(conversationButton.dataset.historyConversationId));
      return;
    }

    if (event.target?.closest?.("[data-history-load-more]")) {
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

  dom.manualText.addEventListener("focus", () => {
    markComposerInterest();
    scheduleSelectedContextRefresh({ force: true });
  });

  dom.manualText.addEventListener("keydown", () => {
    markComposerInterest();
  });

  dom.screenshotButton?.addEventListener("click", () => {
    void runPanelAction(attachVisibleScreenshot);
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
    void runPanelAction(() => attachFilesFromInput(event.dataTransfer?.files));
  });

  for (const eventName of ["focusin", "pointerdown", "pointerenter"]) {
    dom.composerPanel.addEventListener(eventName, markComposerInterest);
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

  dom.followupButton.addEventListener("click", () => {
    void runPanelAction(sendComposerRequest);
  });

  dom.debugDumpButton.addEventListener("click", () => {
    void runPanelAction(dumpDebugState);
  });

  dom.openChatGptButton.addEventListener("click", () => {
    const request = projectHistoryState.activeConversation
      ? getActiveProjectConversationRequest()
      : getActiveRequest();

    if (request) {
      void runPanelAction(() => sendMessage(PANEL_MESSAGES.OPEN_CHATGPT_TAB, {
        requestId: request.id
      }));
      return;
    }

    if (projectHistoryState.activeConversation) {
      void runPanelAction(() => sendMessage(PANEL_MESSAGES.OPEN_PROJECT_CONVERSATION, {
        conversation: {
          id: projectHistoryState.activeConversation.id,
          url: projectHistoryState.activeConversation.url
        }
      }));
    }
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

  dom.saveRepairButton.addEventListener("click", () => {
    void runPanelAction(saveRepairSettings);
  });

  dom.saveAutomationButton.addEventListener("click", () => {
    void runPanelAction(() => saveAutomationSettings());
  });

  dom.modelLabel.addEventListener("input", () => {
    syncModelSelectionEnabledFromLabel();
    void saveAutomationSettings({ silent: true });
  });

  dom.modelLabel.addEventListener("change", () => {
    syncModelSelectionEnabledFromLabel();
    void saveAutomationSettings({ silent: true });
  });

  dom.modelRequireExact.addEventListener("change", () => {
    void saveAutomationSettings({ silent: true });
  });

  window.addEventListener("focus", () => {
    scheduleSelectedContextRefresh({ force: true });
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      scheduleSelectedContextRefresh({ force: true });
    }
  });

  responseView.bindInteractions();
}

async function loadProfiles() {
  const response = await sendMessage(PANEL_MESSAGES.GET_PROFILES);
  profiles = response.profiles || [];

  const customProfile = profiles.find((profile) => profile.id === "custom_text") || profiles[0];
  dom.profileSelect.replaceChildren(...profiles.map((profile) => {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.label;

    return option;
  }));

  if (customProfile) {
    dom.profileSelect.value = customProfile.id;
  }
}

async function loadPanelState() {
  const response = await sendMessage(PANEL_MESSAGES.GET_PANEL_STATE);
  panelState = response.panelState || panelState;
}

async function loadRepairSettings() {
  const response = await sendMessage(PANEL_MESSAGES.GET_LOCAL_REPAIR_SETTINGS);
  const settings = response.settings || {};

  dom.repairEnabled.checked = Boolean(settings.enabled);
  dom.repairModel.value = settings.model || "llama3.2:3b";
  dom.repairUrl.value = settings.ollamaUrl || "http://localhost:11434/api/generate";
}

async function loadAutomationSettings() {
  const response = await sendMessage(PANEL_MESSAGES.GET_CHATGPT_AUTOMATION_SETTINGS);
  const settings = response.settings || {};

  dom.projectRoutingEnabled.checked = Boolean(settings.project?.enabled);
  dom.projectName.value = settings.project?.name || "Dichrome";
  dom.projectCreateIfMissing.checked = settings.project?.createIfMissing !== false;
  if (dom.startNewChat) {
    dom.startNewChat.checked = false;
  }
  dom.automationVisibilityMode.value = normalizeVisibilityMode(settings.visibility?.mode);
  dom.modelSelectionEnabled.checked = Boolean(settings.model?.enabled);
  setModelLabelValue(settings.model?.label || "");
  dom.modelRequireExact.checked = Boolean(settings.model?.requireExact);
  renderAutomationTargetStatus(settings.automationSession || null);
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
  return Boolean(dom.projectRoutingEnabled.checked && dom.projectName.value.trim());
}

function getCurrentProjectHistoryKey() {
  return normalizeHistoryProjectKey({
    name: dom.projectName.value
  });
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
  renderHistoryPanel();

  projectHistoryLoadPromise = (async () => {
  try {
    const response = await sendMessage(PANEL_MESSAGES.GET_PROJECT_CONVERSATIONS, {
      cursor: reset ? 0 : projectHistoryState.nextCursor || 0,
      limit: PROJECT_CONVERSATION_HISTORY_LIMIT
    });

    if (response.pending) {
      projectHistoryState.project = response.project || projectHistoryState.project;
      projectHistoryState.pending = true;
      projectHistoryState.pendingSource = response.source || "pending";
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
    projectHistoryState.loaded = true;
    projectHistoryState.pending = false;
    projectHistoryState.pendingSource = "";
    projectHistoryState.project = response.project || projectHistoryState.project;
    projectHistoryState.conversations = Array.from(byId.values());
    projectHistoryState.nextCursor = response.nextCursor ?? null;
  } catch (error) {
    projectHistoryState.error = error.message || String(error);
    throw error;
  } finally {
    projectHistoryState.loadingList = false;
    projectHistoryLoadPromise = null;
    renderHistoryPanel();
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
  renderHistoryPanel();

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
    responseAnimation.stop();
    responseView.resetAutoScroll();
    render();
    setTransientStatus(`Loaded ${conversation.title}`);
  } catch (error) {
    projectHistoryState.error = error.message || String(error);
    throw error;
  } finally {
    projectHistoryState.loadingConversationId = "";
    renderHistoryPanel();
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

function setModelLabelValue(label) {
  const normalized = String(label || "").trim();

  if (normalized && !Array.from(dom.modelLabel.options).some((option) => option.value === normalized)) {
    const option = document.createElement("option");
    option.value = normalized;
    option.textContent = normalized;
    dom.modelLabel.appendChild(option);
  }

  dom.modelLabel.value = normalized;
}

async function sendComposerRequest() {
  if (composerSendInFlight) {
    setTransientStatus("Message is already being sent.");
    return;
  }

  composerSendInFlight = true;
  updateComposerSendState();

  try {
    await maybeRefreshSelectedContext({ force: true });

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

  return Boolean(request.chatConversationUrl || request.chatConversationKey || request.chatTabId);
}

function canContinueActiveProjectConversation() {
  return Boolean(!forceNewConversationDraft && projectHistoryState.activeConversation?.url);
}

function clearComposerAfterSend() {
  dom.manualText.value = "";
  pendingAttachments = [];
  selectedContext = null;
  forceNewConversationDraft = false;
  renderAttachments();
  renderSelectedContext();
  updateComposerSendState();
}

function startNewConversationDraft() {
  composerReadingMode = false;
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
  const response = await sendMessage(PANEL_MESSAGES.CAPTURE_SCREENSHOT_ATTACHMENT);
  const screenshot = response.attachment;

  if (!screenshot) {
    throw new Error("Screenshot capture returned no attachment.");
  }

  addAttachment({
    ...screenshot,
    previewUrl: screenshot.dataUrl
  });
  setTransientStatus("Screenshot attached. Review it, add text if needed, then press Send.");
}

async function attachFilesFromInput(fileList) {
  const files = Array.from(fileList || []);

  if (!files.length) {
    return;
  }

  for (const file of files) {
    if (file.size > MAX_FILE_ATTACHMENT_BYTES) {
      throw new Error(`${file.name} is too large for the side-panel attachment buffer.`);
    }

    const dataUrl = await readFileAsDataUrl(file);
    addAttachment({
      id: createLocalId(),
      kind: file.type.startsWith("image/") ? "image" : "file",
      name: file.name || "attachment",
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      dataUrl,
      previewUrl: file.type.startsWith("image/") ? dataUrl : ""
    });
  }

  setTransientStatus(`${files.length} file${files.length === 1 ? "" : "s"} attached.`);
}

function addAttachment(attachment) {
  markComposerInterest();
  pendingAttachments = [
    ...pendingAttachments,
    {
      id: attachment.id || createLocalId(),
      kind: attachment.kind || (String(attachment.mimeType || "").startsWith("image/") ? "image" : "file"),
      name: attachment.name || "attachment",
      mimeType: attachment.mimeType || "application/octet-stream",
      sizeBytes: attachment.sizeBytes || null,
      dataUrl: attachment.dataUrl,
      previewUrl: attachment.previewUrl || (String(attachment.mimeType || "").startsWith("image/") ? attachment.dataUrl : "")
    }
  ];
  renderAttachments();
  updateComposerSendState();
}

function removeAttachment(attachmentId) {
  markComposerInterest();
  pendingAttachments = pendingAttachments.filter((attachment) => attachment.id !== attachmentId);
  renderAttachments();
  updateComposerSendState();
}

function renderAttachments() {
  dom.attachmentsTray.replaceChildren();
  dom.attachmentsTray.classList.toggle("hidden", pendingAttachments.length === 0);

  for (const attachment of pendingAttachments) {
    const chip = document.createElement("div");
    chip.className = "attachment-chip";

    if (attachment.previewUrl) {
      const image = document.createElement("img");
      image.width = 34;
      image.height = 30;
      image.decoding = "sync";
      image.loading = "eager";
      image.src = attachment.previewUrl;
      image.alt = "";
      chip.append(image);
    } else {
      const icon = document.createElement("span");
      icon.className = "file-icon";
      icon.textContent = "File";
      chip.append(icon);
    }

    const body = document.createElement("div");
    body.className = "attachment-body";
    const name = document.createElement("strong");
    name.textContent = attachment.name;
    const meta = document.createElement("span");
    meta.textContent = [attachment.mimeType, formatBytes(attachment.sizeBytes)].filter(Boolean).join(" · ");
    body.append(name, meta);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "tiny-button";
    remove.textContent = "Remove";
    remove.dataset.removeAttachment = attachment.id;

    chip.append(body, remove);
    dom.attachmentsTray.append(chip);
  }
}

function scheduleSelectedContextRefresh({ force = false } = {}) {
  window.clearTimeout(selectionRefreshTimer);
  selectionRefreshTimer = window.setTimeout(() => {
    void maybeRefreshSelectedContext({ force });
  }, SELECTION_REFRESH_DELAY_MS);
}

async function maybeRefreshSelectedContext({ force = false } = {}) {
  if (!force && selectedContext) {
    return;
  }

  const selection = await getActiveTabSelection().catch(() => null);
  const text = normalizeSelectionText(selection?.text || "");

  if (!text) {
    return;
  }

  const key = createSelectionKey(text);

  if (key === dismissedSelectionKey) {
    return;
  }

  selectedContext = {
    id: key,
    text,
    sourceTitle: selection?.title || "",
    sourceUrl: selection?.url || ""
  };
  renderSelectedContext();
  updateComposerSendState();
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

async function retryActiveRequest(useRepairHints) {
  const request = projectHistoryState.activeConversation
    ? getActiveProjectConversationRequest()
    : getActiveRequest();

  if (!request) {
    return;
  }

  await saveAutomationSettings({ silent: true });
  await sendMessage(PANEL_MESSAGES.RETRY_REQUEST, {
    requestId: request.id,
    useRepairHints
  });
  await loadPanelState();
  render();
}

async function saveRepairSettings() {
  const response = await sendMessage(PANEL_MESSAGES.SET_LOCAL_REPAIR_SETTINGS, {
    settings: {
      enabled: dom.repairEnabled.checked,
      model: dom.repairModel.value,
      ollamaUrl: dom.repairUrl.value
    }
  });
  const settings = response.settings;

  dom.repairEnabled.checked = Boolean(settings.enabled);
  dom.repairModel.value = settings.model;
  dom.repairUrl.value = settings.ollamaUrl;
  setTransientStatus("Local repair settings saved.");
}

async function dumpDebugState() {
  const request = projectHistoryState.activeConversation
    ? getActiveProjectConversationRequest()
    : getActiveRequest();
  const response = await sendMessage(PANEL_MESSAGES.DUMP_DEBUG, {
    requestId: request?.id || null
  });

  console.log("[Dichrome] Side panel debug dump", response.dump);
  setTransientStatus("Debug dump written to console.");
}

async function saveAutomationSettings({ silent = false } = {}) {
  const response = await sendMessage(PANEL_MESSAGES.SET_CHATGPT_AUTOMATION_SETTINGS, {
    settings: collectAutomationSettingsFromForm()
  });
  const settings = response.settings;

  dom.projectRoutingEnabled.checked = Boolean(settings.project.enabled);
  dom.projectName.value = settings.project.name;
  dom.projectCreateIfMissing.checked = Boolean(settings.project.createIfMissing);
  if (dom.startNewChat) {
    dom.startNewChat.checked = false;
  }
  dom.automationVisibilityMode.value = normalizeVisibilityMode(settings.visibility.mode);
  dom.modelSelectionEnabled.checked = Boolean(settings.model.enabled);
  setModelLabelValue(settings.model.label);
  dom.modelRequireExact.checked = Boolean(settings.model.requireExact);
  renderAutomationTargetStatus(settings.automationSession || null);

  if (!silent) {
    setTransientStatus("Settings saved.");
    scheduleProjectHistoryAutoLoad({
      force: true,
      reset: true
    });
  }
}

function collectAutomationSettingsFromForm() {
  const modelLabel = dom.modelLabel.value.trim();

  return {
    project: {
      enabled: dom.projectRoutingEnabled.checked,
      name: dom.projectName.value,
      createIfMissing: dom.projectCreateIfMissing.checked
    },
    conversation: {
      // Conversation creation is now controlled per message by the sidebar's
      // active conversation state. Model/effort changes must never mutate this.
      startNewChat: false
    },
    visibility: {
      schemaVersion: VISIBILITY_SETTINGS_VERSION,
      mode: normalizeVisibilityMode(dom.automationVisibilityMode.value)
    },
    model: {
      enabled: Boolean(dom.modelSelectionEnabled.checked || modelLabel),
      label: modelLabel,
      requireExact: dom.modelRequireExact.checked
    }
  };
}

function syncModelSelectionEnabledFromLabel() {
  dom.modelSelectionEnabled.checked = Boolean(dom.modelLabel.value.trim());
}

async function refreshAutomationTargetStatus() {
  const response = await sendMessage(PANEL_MESSAGES.GET_AUTOMATION_SESSION).catch(() => null);

  if (response?.automationSession) {
    renderAutomationTargetStatus(response.automationSession);
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
    ? `${displayedRequest.profileLabel} - ${formatState(displayedRequest.state)}`
    : historyConversation
      ? `History - ${historyConversation.title}`
      : forceNewConversationDraft
        ? "New chat draft"
        : "Ready";
  dom.profileLabel.textContent = displayedRequest?.profileLabel || (historyConversation ? "Project history" : "-");
  dom.sourceLabel.textContent = displayedRequest?.source?.title || displayedRequest?.source?.url || historyConversation?.projectName || "-";
  dom.selectedText.textContent = displayedRequest?.selectedText || "";
  dom.selectedBlock.classList.toggle("hidden", !displayedRequest?.selectedText);

  renderHistoryPanel();

  if (historyConversation) {
    renderProjectConversationThread(historyConversation, historyRequest);
    renderResponse(historyRequest);
  } else {
    renderChatThread(request);
    renderResponse(request);
  }

  if (displayedRequest?.error) {
    dom.errorBlock.textContent = displayedRequest.error;
    dom.errorBlock.classList.remove("hidden");
  } else {
    dom.errorBlock.textContent = "";
    dom.errorBlock.classList.add("hidden");
  }

  const hasRequest = Boolean(displayedRequest);

  dom.retryButton.disabled = !hasRequest;
  dom.followupButton.disabled = true;
  dom.openChatGptButton.disabled = !hasRequest && !historyConversation;
  dom.cancelButton.disabled = !isRunning;

  renderRepairSuggestions(displayedRequest);
  renderEvents(displayedRequest);
  updateComposerSendState();
}

function renderHistoryPanel() {
  const projectName = projectHistoryState.project?.name || dom.projectName?.value || "Project";
  const activeTitle = projectHistoryState.activeConversation?.title || "";

  if (projectHistoryState.loadingList) {
    dom.historyStatus.textContent = `Loading ${projectName}...`;
  } else if (projectHistoryState.pending) {
    dom.historyStatus.textContent = `Preparing hidden ChatGPT history for ${projectName}...`;
  } else if (projectHistoryState.error) {
    dom.historyStatus.textContent = projectHistoryState.error;
  } else if (activeTitle) {
    dom.historyStatus.textContent = activeTitle;
  } else if (projectHistoryState.loaded) {
    dom.historyStatus.textContent = `${projectHistoryState.conversations.length} conversation${projectHistoryState.conversations.length === 1 ? "" : "s"} in ${projectName}`;
  } else {
    dom.historyStatus.textContent = `Loading ${projectName} history`;
  }

  dom.historyRefreshButton.disabled = projectHistoryState.loadingList;
  dom.historyRefreshButton.textContent = "Refresh";
  dom.historyList.replaceChildren();
  dom.historyList.classList.toggle("hidden", !projectHistoryState.loaded && !projectHistoryState.loadingList);

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
    meta.textContent = formatHistoryMeta(conversation);
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

  persistProjectHistoryState(projectHistoryState);
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
    const empty = document.createElement("div");
    empty.className = "empty-chat";
    const title = document.createElement("strong");
    title.textContent = conversation.title || "Conversation";
    const body = document.createElement("span");
    body.textContent = "No messages were returned for this conversation.";
    empty.append(title, body);
    dom.chatMessages.append(empty);
    restoreChatThreadScroll(previousScrollTop, shouldStickToBottom);
    return;
  }

  for (const message of visibleMessages) {
    dom.chatMessages.append(createHistoryMessageCard(message));
  }

  const liveRequests = activeRequest
    ? getUnreflectedLiveRequestsForHistory(conversation.messages, getRequestThread(activeRequest))
    : [];

  let renderedActiveRequest = false;

  if (liveRequests.length) {
    for (const request of liveRequests) {
      const isActiveLiveRequest = request.id === activeRequest.id;
      renderedActiveRequest = renderedActiveRequest || isActiveLiveRequest;
      dom.chatMessages.append(createUserMessageCard(request));
      dom.chatMessages.append(createAssistantMessageCard(request, isActiveLiveRequest));
    }
  }

  if (!renderedActiveRequest) {
    moveResponseTextToParking();
  }

  restoreChatThreadScroll(previousScrollTop, shouldStickToBottom);
}

function createHistoryMessageCard(message) {
  const card = document.createElement("article");
  const isAssistant = message.role === "assistant";
  card.className = `message-card ${isAssistant ? "assistant-message" : "user-message"}`;

  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.textContent = isAssistant ? "Assistant" : "You";

  const body = document.createElement("div");
  body.className = `message-body${isAssistant ? " assistant-body" : ""}`;

  if (isAssistant) {
    const content = document.createElement("div");
    content.className = "response-content";
    content.innerHTML = message.text ? renderMarkdownToHtml(message.text) : normalizeResponseHtml(message.html || "");
    responseView.enhanceContainer(content);
    body.append(content);
  } else {
    body.textContent = message.text || "";
  }

  card.append(meta, body);
  return card;
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
    const empty = document.createElement("div");
    empty.className = "empty-chat";
    const title = document.createElement("strong");
    title.textContent = forceNewConversationDraft ? "New conversation" : "Start a chat";
    const body = document.createElement("span");
    body.textContent = forceNewConversationDraft
      ? "Your next message will start separately. Mode changes only affect the next send."
      : "Type below, attach context, or select webpage text. Follow-ups continue this conversation until you press New.";
    empty.append(title, body);
    dom.chatMessages.append(empty);
    restoreChatThreadScroll(previousScrollTop, shouldStickToBottom);
    return;
  }

  const thread = getRequestThread(activeRequest);

  for (const request of thread) {
    dom.chatMessages.append(createUserMessageCard(request));
    dom.chatMessages.append(createAssistantMessageCard(request, request.id === activeRequest.id));
  }

  restoreChatThreadScroll(previousScrollTop, shouldStickToBottom);
}

function createUserMessageCard(request) {
  const card = document.createElement("article");
  card.className = "message-card user-message";

  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.textContent = "You";

  const body = document.createElement("div");
  body.className = "message-body";
  body.textContent = request.manualText || request.prompt || "Sent attachment/context.";

  card.append(meta, body);

  if (request.selectedText) {
    const context = document.createElement("div");
    context.className = "sent-context";
    context.textContent = `Selected text: ${truncateText(request.selectedText, 420)}`;
    card.append(context);
  }

  if (request.attachments?.length) {
    const list = document.createElement("div");
    list.className = "sent-attachments";

    for (const attachment of request.attachments) {
      const chip = document.createElement("span");
      chip.textContent = attachment.name || attachment.kind || "attachment";
      list.append(chip);
    }

    card.append(list);
  }

  return card;
}

function createAssistantMessageCard(request, isActive) {
  const card = document.createElement("article");
  card.className = "message-card assistant-message";

  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.textContent = request.state === "ERROR_STATE" ? "Assistant - error" : "Assistant";

  const body = document.createElement("div");
  body.className = "message-body assistant-body";

  if (isActive) {
    body.append(dom.responseText);
  } else {
    const content = document.createElement("div");
    content.className = "response-content";
    const text = normalizeResponseText(request.responseText || "");
    content.innerHTML = text ? renderMarkdownToHtml(text) : normalizeResponseHtml(request.responseHtml || "");
    responseView.enhanceContainer(content);
    body.append(content);
  }

  card.append(meta, body);
  return card;
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

function markReaderInterest() {
  composerReadingMode = true;
  updateComposerCollapseState();
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
  dom.profileLabel.textContent = "-";
  dom.sourceLabel.textContent = request?.source?.title || request?.source?.url || "-";
  dom.selectedText.textContent = "";
  dom.selectedBlock.classList.add("hidden");
  responseAnimation.stop();
  responseView.resetAutoScroll();
  responseView.setHtml("", { forceScroll: true });
  dom.errorBlock.textContent = "";
  dom.errorBlock.classList.add("hidden");
  dom.retryButton.disabled = true;
  dom.followupButton.disabled = true;
  dom.openChatGptButton.disabled = true;
  dom.cancelButton.disabled = true;
  dom.repairSuggestions.replaceChildren();
  dom.eventLog.replaceChildren();
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

function renderRepairSuggestions(request) {
  dom.repairSuggestions.replaceChildren();

  const hints = request?.repairSuggestions?.hints || [];

  if (!hints.length) {
    return;
  }

  for (const hint of hints) {
    const card = document.createElement("div");
    card.className = "repair-card";
    const title = document.createElement("strong");
    title.textContent = `${hint.target} - ${hint.strategy} (${Math.round(hint.confidence * 100)}%)`;
    const body = document.createElement("div");
    body.textContent = [
      hint.selector ? `selector: ${hint.selector}` : "",
      hint.ariaLabelIncludes ? `aria: ${hint.ariaLabelIncludes}` : "",
      hint.placeholderIncludes ? `placeholder: ${hint.placeholderIncludes}` : "",
      hint.textIncludes ? `text: ${hint.textIncludes}` : "",
      hint.rationale || ""
    ].filter(Boolean).join(" | ");
    card.append(title, body);
    dom.repairSuggestions.append(card);
  }
}

function renderEvents(request) {
  dom.eventLog.replaceChildren();

  const events = request?.events || [];

  for (const event of events.slice().reverse()) {
    const item = document.createElement("li");
    item.textContent = `${formatTime(event.at)} - ${event.detail}`;
    dom.eventLog.append(item);
  }
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

function formatState(state) {
  return String(state || "IDLE").toLowerCase().replace(/_/g, " ");
}

function normalizeVisibilityMode(value) {
  if (value === VISIBILITY_MODES.HIDDEN || value === VISIBILITY_MODES.SINGLE_TAB || value === VISIBILITY_MODES.SIDECAR || value === VISIBILITY_MODES.FOCUSED) {
    return value;
  }

  return VISIBILITY_MODES.HIDDEN;
}

function renderAutomationTargetStatus(session) {
  if (!dom.automationTargetStatus) {
    return;
  }

  if (!session?.targetType) {
    dom.automationTargetStatus.textContent = "Automation target: not created yet.";
    return;
  }

  const fallback = session.offscreenCapability && !session.offscreenCapability.supported
    ? ` (${session.offscreenCapability.failureReason || "hidden internal unavailable"})`
    : "";

  dom.automationTargetStatus.textContent = `Automation target: ${session.targetType}${fallback}`;
}

function formatHistoryMeta(conversation) {
  const updated = formatCompactDate(conversation.updatedAt || conversation.createdAt);
  const project = conversation.projectName || projectHistoryState.project?.name || "";

  return [updated, project].filter(Boolean).join(" - ") || "Project conversation";
}

function formatCompactDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
}

function formatTime(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function truncateText(text, maxLength) {
  const normalized = String(text || "").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}

function normalizeSelectionText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function createSelectionKey(text) {
  return normalizeSelectionText(text).slice(0, 1000);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error(`Failed to read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function createLocalId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatBytes(value) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return "";
  }

  if (number < 1024) {
    return `${number} B`;
  }

  if (number < 1024 * 1024) {
    return `${Math.round(number / 1024)} KB`;
  }

  return `${(number / (1024 * 1024)).toFixed(1)} MB`;
}
