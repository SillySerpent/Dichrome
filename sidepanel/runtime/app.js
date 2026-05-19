import {
  VISIBILITY_SETTINGS_VERSION
} from "../../background/automation/settings.js";
import {
  PANEL_MESSAGES,
  VISIBILITY_MODES
} from "../../shared/contracts.js";
import {
  normalizeResponseHtml,
  normalizeResponseText,
  renderMarkdownToHtml
} from "../../shared/response-formatting.js";
import { sendMessage } from "./client.js";
import { dom } from "./dom.js";
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
  }
});

async function initialize() {
  bindEvents();
  await Promise.all([
    loadProfiles(),
    loadPanelState(),
    loadRepairSettings(),
    loadAutomationSettings()
  ]);
  await maybeRefreshSelectedContext({ force: true });
  render();
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

    chatThreadScrollState.autoScroll = isChatThreadScrolledNearBottom();
  }, {
    passive: true
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
    const request = getActiveRequest();

    if (request) {
      void runPanelAction(() => sendMessage(PANEL_MESSAGES.OPEN_CHATGPT_TAB, {
        requestId: request.id
      }));
    }
  });

  dom.cancelButton.addEventListener("click", () => {
    const request = getActiveRequest();

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
    const canContinue = canContinueActiveConversation(activeRequest);

    if (isRunningRequest(activeRequest)) {
      setTransientStatus("Wait for the current response or cancel it first.");
      return;
    }

    await saveAutomationSettings({ silent: true });
    markOutgoingRequestPending(canContinue ? "Sending message..." : "Starting new conversation...");

    if (canContinue) {
      await sendMessage(PANEL_MESSAGES.RUN_FOLLOWUP_REQUEST, {
        requestId: activeRequest.id,
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
  await ensureScreenshotCapturePermission();
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

async function ensureScreenshotCapturePermission() {
  if (!chrome.permissions?.request) {
    return;
  }

  const granted = await chrome.permissions.request({
    origins: ["<all_urls>"]
  });

  if (!granted) {
    throw new Error("Visible screenshot capture needs All Sites access. Grant the permission prompt, then retry.");
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
  const request = getActiveRequest();

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
  const request = getActiveRequest();
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

  const isRunning = isRunningRequest(request);
  dom.statusLine.textContent = request
    ? `${request.profileLabel} - ${formatState(request.state)}`
    : forceNewConversationDraft
      ? "New chat draft"
      : "Ready";
  dom.profileLabel.textContent = request?.profileLabel || "-";
  dom.sourceLabel.textContent = request?.source?.title || request?.source?.url || "-";
  dom.selectedText.textContent = request?.selectedText || "";
  dom.selectedBlock.classList.toggle("hidden", !request?.selectedText);

  renderChatThread(request);
  renderResponse(request);

  if (request?.error) {
    dom.errorBlock.textContent = request.error;
    dom.errorBlock.classList.remove("hidden");
  } else {
    dom.errorBlock.textContent = "";
    dom.errorBlock.classList.add("hidden");
  }

  const hasRequest = Boolean(request);

  dom.retryButton.disabled = !hasRequest;
  dom.followupButton.disabled = true;
  dom.openChatGptButton.disabled = !hasRequest;
  dom.cancelButton.disabled = !isRunning;

  renderRepairSuggestions(request);
  renderEvents(request);
  updateComposerSendState();
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
  const request = getActiveRequest();
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
  const request = getActiveRequest();
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
