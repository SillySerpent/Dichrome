import {
  APP_MODES,
  MODE_MESSAGES,
  getModeLabel,
  listPublicModes,
  normalizeAppMode
} from "../shared/modes.js";

const MODE_SOURCES = Object.freeze({
  [APP_MODES.MODE2]: "mode2/sidepanel.html",
  [APP_MODES.MODE1]: "mode1.html"
});

const dom = {
  activeModeLabel: document.getElementById("activeModeLabel"),
  cancelActiveRequest: document.getElementById("cancelActiveRequest"),
  cancelActiveRequestRow: document.getElementById("cancelActiveRequestRow"),
  mode1BetaAcknowledge: document.getElementById("mode1BetaAcknowledge"),
  mode1BetaWarning: document.getElementById("mode1BetaWarning"),
  modeFrame: document.getElementById("modeFrame"),
  modeSelect: document.getElementById("modeSelect"),
  modeSettingsButton: document.getElementById("modeSettingsButton"),
  modeSettingsCancelButton: document.getElementById("modeSettingsCancelButton"),
  modeSettingsCloseButton: document.getElementById("modeSettingsCloseButton"),
  modeSettingsOverlay: document.getElementById("modeSettingsOverlay"),
  modeSettingsSaveButton: document.getElementById("modeSettingsSaveButton"),
  modeSettingsStatus: document.getElementById("modeSettingsStatus")
};

let activeMode = APP_MODES.MODE2;
let activeRequestId = null;

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  renderModeOptions();
  void refreshModeStatus();
});

function bindEvents() {
  dom.modeSettingsButton.addEventListener("click", () => {
    openSettings();
  });
  dom.modeSettingsCloseButton.addEventListener("click", () => {
    closeSettings();
  });
  dom.modeSettingsCancelButton.addEventListener("click", () => {
    closeSettings();
  });
  dom.modeSettingsOverlay.addEventListener("click", (event) => {
    if (event.target === dom.modeSettingsOverlay) {
      closeSettings();
    }
  });
  dom.modeSelect.addEventListener("change", () => {
    renderSettingsState();
  });
  dom.modeSettingsSaveButton.addEventListener("click", () => {
    void saveMode();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !dom.modeSettingsOverlay.classList.contains("hidden")) {
      closeSettings();
    }
  });
}

function renderModeOptions() {
  const modes = listPublicModes();

  dom.modeSelect.textContent = "";
  for (const mode of modes) {
    const option = document.createElement("option");

    option.value = mode.id;
    option.textContent = mode.label;
    dom.modeSelect.append(option);
  }
}

async function refreshModeStatus() {
  const response = await sendRuntimeMessage({
    type: MODE_MESSAGES.GET_MODE_STATUS
  });

  activeMode = normalizeAppMode(response.mode) || APP_MODES.MODE2;
  activeRequestId = response.mode1ActiveRequestId || null;
  renderActiveMode();
  renderSettingsState();
}

function renderActiveMode() {
  dom.activeModeLabel.textContent = getModeLabel(activeMode);
  dom.modeSelect.value = activeMode;

  const source = MODE_SOURCES[activeMode] || MODE_SOURCES[APP_MODES.MODE2];
  const currentSource = dom.modeFrame.getAttribute("src") || "";

  if (!currentSource.endsWith(source)) {
    dom.modeFrame.src = source;
  }
}

function renderSettingsState() {
  const selectedMode = normalizeAppMode(dom.modeSelect.value) || APP_MODES.MODE2;
  const switchingToMode1 = selectedMode === APP_MODES.MODE1 && activeMode !== APP_MODES.MODE1;
  const switchingAwayFromActiveMode1 =
    activeMode === APP_MODES.MODE1 && selectedMode === APP_MODES.MODE2 && activeRequestId;

  dom.mode1BetaWarning.classList.toggle("hidden", !switchingToMode1);
  dom.mode1BetaAcknowledge.required = switchingToMode1;
  if (!switchingToMode1) {
    dom.mode1BetaAcknowledge.checked = false;
  }

  dom.cancelActiveRequestRow.classList.toggle("hidden", !switchingAwayFromActiveMode1);
  if (!switchingAwayFromActiveMode1) {
    dom.cancelActiveRequest.checked = false;
  }
}

function openSettings() {
  dom.modeSelect.value = activeMode;
  dom.modeSettingsStatus.textContent = "Ready.";
  renderSettingsState();
  dom.modeSettingsOverlay.classList.remove("hidden");
  dom.modeSelect.focus();
}

function closeSettings() {
  dom.modeSettingsOverlay.classList.add("hidden");
}

async function saveMode() {
  const selectedMode = normalizeAppMode(dom.modeSelect.value) || APP_MODES.MODE2;

  if (selectedMode === APP_MODES.MODE1 && activeMode !== APP_MODES.MODE1 && !dom.mode1BetaAcknowledge.checked) {
    dom.modeSettingsStatus.textContent = "Acknowledge the Mode 1 beta warning before switching.";
    dom.mode1BetaAcknowledge.focus();
    return;
  }

  try {
    dom.modeSettingsSaveButton.disabled = true;
    const response = await sendRuntimeMessage({
      type: MODE_MESSAGES.SET_ACTIVE_MODE,
      mode: selectedMode,
      cancelActiveRequest: dom.cancelActiveRequest.checked
    });

    activeMode = normalizeAppMode(response.mode) || selectedMode;
    activeRequestId = null;
    renderActiveMode();
    closeSettings();
  } catch (error) {
    dom.modeSettingsStatus.textContent = toErrorMessage(error);
    await refreshModeStatus().catch(() => null);
  } finally {
    dom.modeSettingsSaveButton.disabled = false;
  }
}

async function sendRuntimeMessage(payload) {
  const response = await chrome.runtime.sendMessage(payload);

  if (!response?.ok) {
    throw new Error(response?.error || "Dichrome action failed.");
  }

  return response;
}

function toErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error || "Unknown error");
}
