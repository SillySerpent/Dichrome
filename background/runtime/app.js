import {
  REQUEST_PROFILES,
  buildPromptForProfile,
  createRequestId,
  createRequestRecord,
  getPublicProfiles,
  getProfile,
  normalizeText
} from "../state-machine.js";
import {
  getVisibilityMode,
  mergeAutomationSettings
} from "../automation/settings.js";
import { summarizeDebugData } from "../debug-dump.js";
import {
  clearAutomationRequestActive,
  getAutomationSession,
  markAutomationRequestActive,
  updateSessionConversation
} from "../automation/session.js";
import { resolveProjectTarget } from "../automation/project-target.js";
import {
  getOffscreenFrameStatus,
  handleOffscreenFramePort,
  navigateOffscreenFrameToConversation,
  navigateOffscreenFrameToUrl,
  probeOffscreenAutomationTarget,
  reloadOffscreenFrameToUrl,
  sendMessageToOffscreenFrame,
  setOffscreenFrameDisconnectHandler
} from "../automation/offscreen-target.js";
import {
  serializeError,
  sleep
} from "../constants.js";
import {
  appendEvent,
  getPanelState,
  getRequest,
  putRequest,
  restoreAttachmentPayloads,
  storeAttachmentPayloads,
  updateRequest
} from "../requests/store.js";
import {
  captureVisibleTabScreenshot,
  queryBestSourceTab,
  rememberSourceTab
} from "../automation/source-focus.js";
import {
  getAutomationSettings,
  getPublicAutomationSettings,
  setAutomationSettings
} from "./settings-repository.js";
import { createContextMenuController } from "./context-menu.js";
import { buildChatOptionsForAutomationRun } from "./conversation-run-options.js";
import { getFreshConversationUrl } from "./fresh-conversation-url.js";
import { createRuntimeMessageRouter } from "./message-router.js";
import { createProjectHistoryController } from "./project-history-controller.js";
import { createRequestController } from "./request-controller.js";
import { formatUserFacingError } from "../../shared/error-messages.js";
import {
  classifyHiddenCapabilityFailure,
  classifyRequestError,
  createCodedError
} from "./error-classification.js";
import { createSidePanelState } from "./side-panel-state.js";
import { createWorkspaceReadinessController } from "./workspace-readiness.js";
import { createRequestOrchestrator } from "./request-orchestrator.js";
import { createAutomationEventController } from "./automation-events.js";
import {
  APP_MODES,
  MODE_MESSAGES,
  getActiveMode,
  getModeLabel,
  listPublicModes,
  normalizeAppMode,
  setActiveMode
} from "../../shared/modes.js";
import {
  MODE2_COMMANDS,
  MODE2_MESSAGE_TYPES,
  createMode2CompanionController
} from "../mode2/companion-controller.js";

const EXTENSION_NAME = chrome.runtime.getManifest().name;
const SIDE_PANEL_TOGGLE_COMMAND = "toggle-dichrome-side-panel";
const SELECTION_ACTION_BY_COMMAND = Object.freeze({
  [MODE2_COMMANDS.SUMMARIZE_SELECTION]: "summarize",
  [MODE2_COMMANDS.EXPLAIN_SELECTION]: "explain"
});
const sidePanelState = createSidePanelState();
const workspaceReadinessController = createWorkspaceReadinessController({
  classifyHiddenCapabilityFailure,
  formatUserFacingError,
  probeOffscreenAutomationTarget,
  sleep
});
const automationEventController = createAutomationEventController({
  appendEvent,
  classifyHiddenCapabilityFailure,
  classifyRequestError,
  clearAutomationRequestActive,
  createCodedError,
  formatUserFacingError,
  getRequest,
  summarizeDebugData,
  updateRequest,
  updateSessionConversation
});
const requestOrchestrator = createRequestOrchestrator({
  appendEvent,
  buildChatOptionsForAutomationRun,
  buildPromptForProfile,
  classifyHiddenCapabilityFailure,
  clearAutomationRequestActive,
  createCodedError,
  createRequestId,
  createRequestRecord,
  extensionName: EXTENSION_NAME,
  getAutomationSettings,
  getAutomationSession,
  getFreshConversationUrl,
  getOffscreenFrameStatus,
  getRequest,
  getVisibilityMode,
  markAutomationRequestActive,
  markRequestError: automationEventController.markRequestError,
  mergeAutomationSettings,
  navigateOffscreenFrameToConversation,
  navigateOffscreenFrameToUrl,
  openSidePanel: sidePanelState.openSidePanel,
  putRequest,
  rememberSourceTab,
  resolveProjectTarget,
  sendMessageToOffscreenFrame,
  setAutomationSettings,
  storeAttachmentPayloads,
  updateRequest,
  workspaceReadinessController
});
const requestController = createRequestController({
  appendEvent,
  captureVisibleTabScreenshot,
  clearAutomationRequestActive,
  getProfile,
  getRequest,
  normalizeText,
  queryBestSourceTab,
  restoreAttachmentPayloads,
  sendMessageToOffscreenFrame,
  startRequest: requestOrchestrator.startRequest,
  updateRequest
});
const mode2Controller = createMode2CompanionController({
  captureVisibleTabScreenshot,
  openSidePanel: sidePanelState.openSidePanel,
  queryBestSourceTab
});
const contextMenuController = createContextMenuController({
  appendEvent,
  getActiveMode,
  mode2Controller,
  normalizeText,
  openSidePanel: sidePanelState.openSidePanel,
  startRequest: requestOrchestrator.startRequest,
  startScreenshotRequest: requestController.startScreenshotRequest,
  updateRequest
});
const projectHistoryController = createProjectHistoryController({
  getAutomationSettings: () => requestOrchestrator.getResolvedAutomationSettings(),
  probeOffscreenAutomationTarget: () => workspaceReadinessController.probeHiddenAutomationWithWarmup({ attempts: 3, initialDelayMs: 350 }),
  reloadOffscreenFrameToUrl,
  sendMessageToOffscreenFrame,
  setAutomationSettings: (settings) => setAutomationSettings(settings, EXTENSION_NAME)
});
const runtimeMessageRouter = createRuntimeMessageRouter({
  getProfiles: () => ({
    profiles: getPublicProfiles()
  }),
  getPanelState: async () => ({
    panelState: await getPanelState()
  }),
  startManualRequest: requestController.startManualRequest,
  startScreenshotRequest: requestController.startScreenshotRequest,
  captureScreenshotAttachment: requestController.captureScreenshotAttachment,
  startFollowupRequest: requestController.startFollowupRequest,
  startHistoryFollowupRequest: requestController.startHistoryFollowupRequest,
  retryRequest: requestController.retryRequest,
  cancelRequest: requestController.cancelRequest,
  openChatGptAuth: requestController.openChatGptAuth,
  getProjectConversations: projectHistoryController.getProjectConversations,
  getProjectConversation: projectHistoryController.getProjectConversation,
  getChatGptAutomationSettings: async () => ({
    settings: await getPublicAutomationSettings(EXTENSION_NAME)
  }),
  setChatGptAutomationSettings: (settings) => setAutomationSettings(settings, EXTENSION_NAME),
  checkChatGptWorkspace: workspaceReadinessController.checkChatGptWorkspace,
  handleAutomationDebug: automationEventController.handleAutomationDebug,
  handleAutomationEvent: automationEventController.handleAutomationEvent
});

setOffscreenFrameDisconnectHandler((event) => {
  void automationEventController.handleOffscreenFrameDisconnected(event);
});

chrome.runtime.onInstalled.addListener(() => {
  void configureSidePanel();
  void contextMenuController.createContextMenus();
});

chrome.runtime.onStartup?.addListener(() => {
  void configureSidePanel();
  void contextMenuController.createContextMenus();
});

chrome.action.onClicked.addListener((tab) => {
  void sidePanelState.openSidePanel(tab?.id);
  void rememberSourceTab(tab).catch(() => null);
});

chrome.commands?.onCommand?.addListener?.((command, tab) => {
  if (command !== SIDE_PANEL_TOGGLE_COMMAND) {
    void handleShortcutCommand(command, tab).catch((error) => {
      console.error("Dichrome shortcut command failed", error);
    });
    return;
  }

  if (sidePanelState.shouldCloseSidePanel(tab)) {
    void sidePanelState.closeSidePanel(tab);
  } else {
    void sidePanelState.openSidePanel(tab?.id);
    void rememberSourceTab(tab).catch(() => null);
  }
});

chrome.sidePanel?.onOpened?.addListener?.((info) => {
  sidePanelState.markSidePanelOpen(info);
});

chrome.sidePanel?.onClosed?.addListener?.((info) => {
  sidePanelState.markSidePanelClosed(info);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void contextMenuController.handleContextMenuClick(info, tab);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  sidePanelState.forgetTab(tabId);
});

chrome.runtime.onConnect.addListener((port) => {
  handleOffscreenFramePort(port);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return false;
  }

  handleRuntimeMessage(message, sender)
    .then((payload) => sendResponse({ ok: true, ...payload }))
    .catch((error) => {
      console.error("ChatGPT relay background error", error);
      sendResponse({
        ok: false,
        error: serializeError(error),
        errorCode: error?.errorCode || classifyRequestError(error)
      });
    });

  return true;
});

async function configureSidePanel() {
  await chrome.sidePanel?.setPanelBehavior?.({
    openPanelOnActionClick: true
  }).catch(() => null);
  await chrome.sidePanel?.setOptions?.({
    path: "sidepanel/sidepanel.html",
    enabled: true
  }).catch(() => null);
}

async function handleRuntimeMessage(message, sender) {
  if (message.type === MODE_MESSAGES.GET_ACTIVE_MODE) {
    const mode = await getActiveMode();

    return {
      mode,
      label: getModeLabel(mode),
      modes: listPublicModes()
    };
  }

  if (message.type === MODE_MESSAGES.GET_MODE_STATUS) {
    const mode = await getActiveMode();
    const session = await getAutomationSession().catch(() => null);

    return {
      mode,
      label: getModeLabel(mode),
      modes: listPublicModes(),
      mode1ActiveRequestId: session?.activeRequestId || null
    };
  }

  if (message.type === MODE_MESSAGES.SET_ACTIVE_MODE) {
    return setModeFromMessage(message);
  }

  if (message.type === MODE2_MESSAGE_TYPES.SELECTION_ACTION) {
    const activeMode = await getActiveMode();

    if (activeMode === APP_MODES.MODE1) {
      return contextMenuController.handleSelectionAction({
        action: message.action,
        selectedText: message.selectedText,
        tab: sender.tab,
        source: "selection-popover",
        pageTitle: message.pageTitle,
        pageUrl: message.pageUrl
      });
    }
  }

  if (message.type === MODE2_MESSAGE_TYPES.CAPTURE_VISIBLE_TAB) {
    const activeMode = await getActiveMode();

    if (activeMode === APP_MODES.MODE1) {
      return contextMenuController.handleScreenshotAction(sender.tab, message.source || "side-panel");
    }
  }

  if (mode2Controller.canHandleMessage(message)) {
    return mode2Controller.handleMessage(message, sender);
  }

  return runtimeMessageRouter.handle(message, sender);
}

async function setModeFromMessage(message) {
  const targetMode = normalizeAppMode(message.mode);

  if (!targetMode) {
    throw new Error(`Unsupported Dichrome mode: ${message.mode}`);
  }

  const currentMode = await getActiveMode();
  const session = await getAutomationSession().catch(() => null);

  if (
    currentMode === APP_MODES.MODE1
    && targetMode === APP_MODES.MODE2
    && session?.activeRequestId
    && !message.cancelActiveRequest
  ) {
    throw new Error("Original Dichrome beta has an active request. Cancel it before switching modes.");
  }

  if (
    currentMode === APP_MODES.MODE1
    && targetMode === APP_MODES.MODE2
    && session?.activeRequestId
    && message.cancelActiveRequest
  ) {
    await requestController.cancelRequest(session.activeRequestId);
  }

  const mode = await setActiveMode(targetMode);

  return {
    mode,
    label: getModeLabel(mode),
    modes: listPublicModes()
  };
}

async function handleShortcutCommand(command, tab) {
  const activeMode = await getActiveMode();

  if (activeMode === APP_MODES.MODE2) {
    await mode2Controller.handleCommand(command);
    return;
  }

  const sourceTab = await queryBestSourceTab(tab);
  if (command === MODE2_COMMANDS.CAPTURE_VISIBLE_SCREENSHOT) {
    await contextMenuController.handleScreenshotAction(sourceTab, "keyboard-shortcut");
    return;
  }

  const action = SELECTION_ACTION_BY_COMMAND[command];
  if (!action) {
    return;
  }

  const selection = await readSelectionForShortcut(sourceTab);
  await contextMenuController.handleSelectionAction({
    action,
    selectedText: selection.selectedText,
    tab: sourceTab,
    source: "keyboard-shortcut",
    pageTitle: selection.pageTitle,
    pageUrl: selection.pageUrl
  });
}

async function readSelectionForShortcut(tab) {
  if (!tab?.id) {
    return {
      selectedText: "",
      pageTitle: tab?.title || "",
      pageUrl: tab?.url || ""
    };
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: MODE2_MESSAGE_TYPES.GET_SELECTION
    });

    return {
      selectedText: response?.selectedText || "",
      pageTitle: response?.pageTitle || tab.title || "",
      pageUrl: response?.pageUrl || tab.url || ""
    };
  } catch (_error) {
    return {
      selectedText: "",
      pageTitle: tab.title || "",
      pageUrl: tab.url || ""
    };
  }
}
