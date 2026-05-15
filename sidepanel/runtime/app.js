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

let profiles = [];
let panelState = {
  activeRequestId: null,
  requests: []
};

let outgoingRequestPending = null;

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
  render();
}

function bindEvents() {
  dom.refreshButton.addEventListener("click", () => {
    void runPanelAction(async () => {
      await loadPanelState();
      render();
    });
  });

  dom.sendManualButton.addEventListener("click", () => {
    void runPanelAction(sendManualRequest);
  });

  dom.screenshotButton.addEventListener("click", () => {
    void runPanelAction(sendScreenshotRequest);
  });

  dom.retryButton.addEventListener("click", () => {
    void runPanelAction(() => retryActiveRequest(false));
  });

  dom.followupButton.addEventListener("click", () => {
    void runPanelAction(sendFollowupRequest);
  });

  dom.retryRepairButton.addEventListener("click", () => {
    void runPanelAction(() => retryActiveRequest(true));
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
    void runPanelAction(saveAutomationSettings);
  });

  dom.permissionRepairButton.addEventListener("click", () => {
    void runPanelAction(requestRepairPermission);
  });

  responseView.bindInteractions();
}

async function loadProfiles() {
  const response = await sendMessage(PANEL_MESSAGES.GET_PROFILES);
  profiles = response.profiles || [];

  const manualProfiles = profiles.filter((profile) => profile.inputKind === "manual_text" || profile.inputKind === "selection");
  dom.profileSelect.replaceChildren(...manualProfiles.map((profile) => {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.label;

    return option;
  }));

  if (!dom.profileSelect.value && manualProfiles[0]) {
    dom.profileSelect.value = manualProfiles[0].id;
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
  dom.projectName.value = settings.project?.name || "ChatGPT Page Relay Prototype";
  dom.projectCreateIfMissing.checked = settings.project?.createIfMissing !== false;
  dom.startNewChat.checked = settings.conversation?.startNewChat !== false;
  dom.automationVisibilityMode.value = normalizeVisibilityMode(settings.visibility?.mode);
  dom.modelSelectionEnabled.checked = Boolean(settings.model?.enabled);
  dom.modelLabel.value = settings.model?.label || "";
  dom.modelRequireExact.checked = Boolean(settings.model?.requireExact);
  renderAutomationTargetStatus(settings.automationSession || null);
}

async function sendManualRequest() {
  const text = dom.manualText.value.trim();

  if (!text) {
    setTransientStatus("Text prompt is empty.");
    return;
  }

  markOutgoingRequestPending("Sending text prompt...");
  await sendMessage(PANEL_MESSAGES.RUN_MANUAL_REQUEST, {
    profileId: dom.profileSelect.value || "custom_text",
    text
  });
  dom.manualText.value = "";
  await loadPanelState();
  render();
}

async function sendScreenshotRequest() {
  markOutgoingRequestPending("Capturing visible screenshot...");
  await sendMessage(PANEL_MESSAGES.RUN_SCREENSHOT_REQUEST, {
    prompt: dom.manualText.value.trim()
  });
  await loadPanelState();
  render();
}

async function retryActiveRequest(useRepairHints) {
  const request = getActiveRequest();

  if (!request) {
    return;
  }

  await sendMessage(PANEL_MESSAGES.RETRY_REQUEST, {
    requestId: request.id,
    useRepairHints
  });
  await loadPanelState();
  render();
}

async function sendFollowupRequest() {
  const request = getActiveRequest();
  const text = dom.followupText.value.trim();

  if (!request) {
    return;
  }

  if (!text) {
    setTransientStatus("Follow-up prompt is empty.");
    return;
  }

  markOutgoingRequestPending("Sending follow-up...");
  await sendMessage(PANEL_MESSAGES.RUN_FOLLOWUP_REQUEST, {
    requestId: request.id,
    text
  });
  dom.followupText.value = "";
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

  console.log("[ChatGPT Relay] Side panel debug dump", response.dump);
  setTransientStatus("Debug dump written to console.");
}

async function saveAutomationSettings() {
  const response = await sendMessage(PANEL_MESSAGES.SET_CHATGPT_AUTOMATION_SETTINGS, {
    settings: {
      project: {
        enabled: dom.projectRoutingEnabled.checked,
        name: dom.projectName.value,
        createIfMissing: dom.projectCreateIfMissing.checked
      },
      conversation: {
        startNewChat: dom.startNewChat.checked
      },
      visibility: {
        schemaVersion: VISIBILITY_SETTINGS_VERSION,
        mode: normalizeVisibilityMode(dom.automationVisibilityMode.value)
      },
      model: {
        enabled: dom.modelSelectionEnabled.checked,
        label: dom.modelLabel.value,
        requireExact: dom.modelRequireExact.checked
      }
    }
  });
  const settings = response.settings;

  dom.projectRoutingEnabled.checked = Boolean(settings.project.enabled);
  dom.projectName.value = settings.project.name;
  dom.projectCreateIfMissing.checked = Boolean(settings.project.createIfMissing);
  dom.startNewChat.checked = Boolean(settings.conversation.startNewChat);
  dom.automationVisibilityMode.value = normalizeVisibilityMode(settings.visibility.mode);
  dom.modelSelectionEnabled.checked = Boolean(settings.model.enabled);
  dom.modelLabel.value = settings.model.label;
  dom.modelRequireExact.checked = Boolean(settings.model.requireExact);
  renderAutomationTargetStatus(settings.automationSession || null);
  setTransientStatus("ChatGPT routing settings saved.");
}

async function refreshAutomationTargetStatus() {
  const response = await sendMessage(PANEL_MESSAGES.GET_AUTOMATION_SESSION).catch(() => null);

  if (response?.automationSession) {
    renderAutomationTargetStatus(response.automationSession);
  }
}

async function requestRepairPermission() {
  const granted = await chrome.permissions.request({
    origins: ["http://localhost:11434/*"]
  });
  setTransientStatus(granted ? "Localhost permission granted." : "Localhost permission was not granted.");
}

function render() {
  const request = getActiveRequest();

  if (outgoingRequestPending && request && request.id !== outgoingRequestPending.previousRequestId) {
    outgoingRequestPending = null;
  }

  const showOutgoingPending = Boolean(outgoingRequestPending)
    && (!request || request.id === outgoingRequestPending.previousRequestId)
    && (!request || !isRunningRequest(request));

  if (showOutgoingPending) {
    renderPendingOutgoingState(request);
    return;
  }

  dom.statusLine.textContent = request
    ? `${request.profileLabel} - ${formatState(request.state)}`
    : "Idle";
  dom.stateBadge.textContent = request ? request.state : "IDLE";
  dom.profileLabel.textContent = request?.profileLabel || "-";
  dom.sourceLabel.textContent = request?.source?.title || request?.source?.url || "-";
  dom.selectedText.textContent = request?.selectedText || "";
  dom.selectedBlock.classList.toggle("hidden", !request?.selectedText);
  renderResponse(request);

  if (request?.error) {
    dom.errorBlock.textContent = request.error;
    dom.errorBlock.classList.remove("hidden");
  } else {
    dom.errorBlock.textContent = "";
    dom.errorBlock.classList.add("hidden");
  }

  const hasRequest = Boolean(request);
  const isRunning = isRunningRequest(request);
  const hasRepairHints = Boolean(request?.repairSuggestions?.hints?.length);

  dom.retryButton.disabled = !hasRequest;
  dom.followupButton.disabled = !hasRequest || isRunning || (!request?.chatConversationUrl && !request?.chatTabId);
  dom.retryRepairButton.disabled = !hasRepairHints;
  dom.openChatGptButton.disabled = !hasRequest;
  dom.cancelButton.disabled = !isRunning;

  renderRepairSuggestions(request);
  renderEvents(request);
}


function markOutgoingRequestPending(label) {
  const current = getActiveRequest();
  outgoingRequestPending = {
    label,
    previousRequestId: current?.id || null,
    startedAt: Date.now()
  };
  responseAnimation.stop();
  responseView.resetAutoScroll();
  responseView.setHtml("", { forceScroll: true });
  dom.statusLine.textContent = label;
  dom.stateBadge.textContent = "QUEUED";
}

function renderPendingOutgoingState(request) {
  dom.statusLine.textContent = outgoingRequestPending?.label || "Preparing request...";
  dom.stateBadge.textContent = "QUEUED";
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
  dom.retryRepairButton.disabled = true;
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
    dom.statusLine.textContent = previous;
  }, 2400);
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
