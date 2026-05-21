import {
  REQUEST_PROFILES,
  REQUEST_STATES,
  buildPromptForProfile,
  createRequestId,
  createRequestRecord,
  getPublicProfiles,
  getProfile,
  normalizeText
} from "../state-machine.js";
import { requestAdapterRepair } from "../adapter-repair.js";
import {
  VISIBILITY_MODES,
  getVisibilityMode,
  mergeAutomationSettings,
  usesFocusedAutomation,
  usesFocusEmulation,
  usesHiddenAutomation,
  usesSidecarWindow
} from "../automation/settings.js";
import { summarizeDebugData } from "../debug-dump.js";
import {
  disableFocusEmulationForRequest,
  enableFocusEmulation,
  setFocusEmulationDetachHandler
} from "../focus-emulation.js";
import {
  clearAutomationRequestActive,
  clearAutomationTabIfMatches,
  getAutomationSession,
  markAutomationRequestActive,
  summarizeAutomationSession,
  updateSessionConversation
} from "../automation/session.js";
import { resolveProjectTarget } from "../automation/project-target.js";
import {
  getOffscreenFrameStatus,
  handleOffscreenFramePort,
  navigateOffscreenFrameToConversation,
  navigateOffscreenFrameToUrl,
  probeOffscreenAutomationTarget,
  sendMessageToOffscreenFrame,
  setOffscreenFrameDisconnectHandler
} from "../automation/offscreen-target.js";
import {
  findOrCreateChatGptTab,
  getAutomationTargetType,
  getExistingChatGptAutomationTab,
  getUsableChatGptTab,
  navigateTabToConversation,
  prepareAutomationTab,
  resolvePreferredAutomationTabId,
  setAutomationWindowState
} from "../automation/tab-target.js";
import {
  CHATGPT_CONTENT_SCRIPT_FILES,
  getTabId,
  isChatGptUrl,
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
  getSourceFocusTarget,
  queryBestSourceTab,
  rememberSourceTab,
  restoreSourceFocus
} from "../automation/source-focus.js";
import {
  getAutomationSettings,
  getPublicAutomationSettings,
  getRepairSettings,
  setAutomationSettings,
  setRepairSettings
} from "./settings-repository.js";
import { createContextMenuController } from "./context-menu.js";
import { buildChatOptionsForAutomationRun } from "./conversation-run-options.js";
import { createRuntimeMessageRouter } from "./message-router.js";
import { createProjectHistoryController } from "./project-history-controller.js";
import { createRequestController } from "./request-controller.js";
import { getFreshConversationUrl } from "./fresh-conversation-url.js";
import { dumpDebugState as collectDebugDumpState } from "../debug/debug-dump-collector.js";
import { CHATGPT_AUTOMATION_MESSAGES } from "../../shared/contracts.js";

const EXTENSION_NAME = chrome.runtime.getManifest().name;
const contextMenuController = createContextMenuController({
  appendEvent,
  normalizeText,
  openSidePanel,
  requestProfiles: REQUEST_PROFILES,
  startRequest,
  updateRequest
});
const requestController = createRequestController({
  appendEvent,
  captureVisibleTabScreenshot,
  clearAutomationRequestActive,
  disableFocusEmulationForRequest,
  findOrCreateChatGptTab,
  getProfile,
  getRequest,
  getSourceFocusTarget,
  normalizeText,
  queryBestSourceTab,
  restoreAttachmentPayloads,
  sendMessageToOffscreenFrame,
  sendMessageToTab,
  startRequest,
  updateRequest
});
const projectHistoryController = createProjectHistoryController({
  disableFocusEmulationForRequest,
  enableFocusEmulation,
  findOrCreateChatGptTab,
  getAutomationSettings: () => getResolvedAutomationSettings(),
  getExistingChatGptAutomationTab,
  getSourceFocusTarget,
  injectAutomationScript,
  navigateTabToConversation,
  prepareAutomationTab,
  probeOffscreenAutomationTarget,
  queryBestSourceTab,
  restoreSourceFocus,
  sendMessageToOffscreenFrame,
  sendMessageToTab,
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
  openChatGptTabForRequest: requestController.openChatGptTabForRequest,
  openProjectConversation: projectHistoryController.openProjectConversation,
  getProjectConversations: projectHistoryController.getProjectConversations,
  getProjectConversation: projectHistoryController.getProjectConversation,
  getLocalRepairSettings: async () => ({
    settings: await getRepairSettings()
  }),
  setLocalRepairSettings: setRepairSettings,
  getChatGptAutomationSettings: async () => ({
    settings: await getPublicAutomationSettings(EXTENSION_NAME)
  }),
  getAutomationSession: async () => ({
    automationSession: summarizeAutomationSession(await getReconciledAutomationSession())
  }),
  setChatGptAutomationSettings: (settings) => setAutomationSettings(settings, EXTENSION_NAME),
  dumpDebug: (message) => collectDebugDumpState({
    requestId: message.requestId,
    extensionName: EXTENSION_NAME,
    getAutomationSettings: () => getAutomationSettings(EXTENSION_NAME),
    getAutomationSession: getReconciledAutomationSession,
    getRepairSettings,
    injectAutomationScript,
    sendMessageToTab
  }),
  handleAutomationDebug,
  handleAutomationEvent
});

setFocusEmulationDetachHandler((event) => {
  void handleFocusEmulationDetached(event);
});

setOffscreenFrameDisconnectHandler((event) => {
  void handleOffscreenFrameDisconnected(event);
});

chrome.runtime.onInstalled.addListener(() => {
  void contextMenuController.createContextMenus();
});

chrome.runtime.onStartup?.addListener(() => {
  void contextMenuController.createContextMenus();
});

chrome.action.onClicked.addListener((tab) => {
  void openSidePanel(tab?.id);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void contextMenuController.handleContextMenuClick(info, tab);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void clearAutomationTabIfMatches(tabId);
});

chrome.runtime.onConnect.addListener((port) => {
  handleOffscreenFramePort(port);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return false;
  }

  runtimeMessageRouter.handle(message, sender)
    .then((payload) => sendResponse({ ok: true, ...payload }))
    .catch((error) => {
      console.error("ChatGPT relay background error", error);
      sendResponse({
        ok: false,
        error: serializeError(error)
      });
    });

  return true;
});

async function startRequest({
  profileId,
  sourceTab,
  selectedText = "",
  manualText = "",
  attachments = [],
  adapterHints = [],
  preferredChatTabId = null,
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
    adapterHints,
    preferredChatTabId,
    chatOptionsOverride
  });

  return {
    requestId
  };
}

async function orchestrateRequest(requestId, {
  attachments = [],
  adapterHints = [],
  preferredChatTabId = null,
  chatOptionsOverride = null
} = {}) {
  try {
    const request = await getRequest(requestId);

    if (!request) {
      throw new Error("Request disappeared before orchestration started.");
    }

    const automationSettings = await resolveAutomationSettingsProjectTarget(mergeAutomationSettings(
      await getAutomationSettings(EXTENSION_NAME),
      chatOptionsOverride,
      EXTENSION_NAME
    ));
    const visibility = automationSettings.visibility;
    const sourceFocus = getSourceFocusTarget(request.source);
    const hiddenCapability = usesHiddenAutomation(visibility)
      ? await probeOffscreenAutomationTarget()
      : null;

    if (hiddenCapability && !hiddenCapability.supported) {
      await updateRequest(requestId, (draft) => {
        appendEvent(draft, `Hidden internal target unavailable; using one inactive tab. ${hiddenCapability.failureReason || ""}`.trim());
      });
    }

    if (usesHiddenAutomation(visibility) && hiddenCapability?.supported) {
      await runOffscreenAutomationTarget({
        request,
        requestId,
        attachments,
        adapterHints,
        automationSettings
      });
      return;
    }

    const preferredAutomationTabId = await resolvePreferredAutomationTabId(preferredChatTabId, visibility);
    const discoveredChatTab = preferredAutomationTabId
      ? await getUsableChatGptTab(preferredAutomationTabId, {
        sourceFocus,
        visibility
      })
      : await findOrCreateChatGptTab({
        sourceFocus,
        visibility
      });
    let chatTab = await prepareAutomationTab(discoveredChatTab);

    if (request.conversationMode === "followup") {
      if (request.expectedConversationUrl) {
        await navigateTabToConversation(chatTab.id, request.expectedConversationUrl);
      } else if (!preferredChatTabId || chatTab.id !== preferredChatTabId) {
        throw new Error("The previous request has no saved ChatGPT conversation URL, and its original ChatGPT tab is not available. The extension will not start a new chat for this follow-up.");
      }
    } else {
      const freshConversationUrl = getFreshConversationUrl(automationSettings, chatTab.url || chatTab.pendingUrl || "");

      if (freshConversationUrl) {
        await updateRequest(requestId, (draft) => {
          appendEvent(draft, "Preparing a fresh ChatGPT composer.");
        });
        chatTab = await navigateTabToConversation(chatTab.id, freshConversationUrl);
        await updateRequest(requestId, (draft) => {
          appendEvent(draft, "Fresh ChatGPT composer is ready.");
        });
      }
    }

    await markAutomationRequestActive(requestId);

    await updateRequest(requestId, (draft) => {
      draft.chatTabId = chatTab.id;
      draft.automationVisibilityMode = getVisibilityMode(visibility);
      draft.automationTargetType = getAutomationTargetType(visibility);
      draft.state = REQUEST_STATES.CHATGPT_TAB_READY;
      appendEvent(draft, `Using ChatGPT tab ${chatTab.id}.`);
    });

    if (usesFocusEmulation(visibility)) {
      await enableFocusEmulation({
        tabId: chatTab.id,
        requestId
      });
      await updateRequest(requestId, (draft) => {
        appendEvent(draft, "Chrome debugger focus emulation enabled for background ChatGPT streaming.");
      });
    }

    await injectAutomationScript(chatTab.id);

    if (usesSidecarWindow(visibility) && !usesFocusedAutomation(visibility)) {
      await restoreSourceFocus(sourceFocus, chatTab.windowId);
    }

    const response = await sendMessageToTab(chatTab.id, {
      type: CHATGPT_AUTOMATION_MESSAGES.RUN,
      request: buildAutomationRunRequest({
        request,
        attachments,
        adapterHints,
        automationSettings
      })
    });

    if (!response?.accepted) {
      throw new Error(response?.error || "ChatGPT automation script did not accept the request.");
    }

    if (usesSidecarWindow(visibility) && !usesFocusedAutomation(visibility)) {
      await restoreSourceFocus(sourceFocus, chatTab.windowId);
    }
  } catch (error) {
    await disableFocusEmulationForRequest(requestId).catch(() => null);
    await clearAutomationRequestActive(requestId).catch(() => null);
    await markRequestError(requestId, error);
  }
}

async function getResolvedAutomationSettings() {
  return resolveAutomationSettingsProjectTarget(await getAutomationSettings(EXTENSION_NAME));
}

async function resolveAutomationSettingsProjectTarget(settings) {
  if (!settings?.project?.enabled || !settings.project.name) {
    return settings;
  }

  const project = await resolveProjectTarget(settings.project, {
    getAutomationSession,
    queryTabs: () => chrome.tabs.query({})
  });

  if (project.segment && project.segment !== settings.project.segment) {
    await setAutomationSettings({
      ...settings,
      project
    }, EXTENSION_NAME).catch(() => null);
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
  adapterHints,
  automationSettings
}) {
  if (request.conversationMode === "followup") {
    if (!request.expectedConversationUrl) {
      throw new Error("The previous request has no saved ChatGPT conversation URL. The extension will not start a new chat for this follow-up.");
    }

    await navigateOffscreenFrameToConversation(request.expectedConversationUrl);
  } else {
    const freshHiddenUrl = getFreshConversationUrl(automationSettings, getOffscreenFrameStatus()?.frame?.href || "");

    if (freshHiddenUrl) {
      await updateRequest(requestId, (draft) => {
        appendEvent(draft, "Preparing a fresh hidden ChatGPT composer.");
      });
      await navigateOffscreenFrameToUrl(freshHiddenUrl, {
        rejectedMessage: "The hidden ChatGPT frame rejected fresh-chat navigation.",
        timeoutMessage: "Timed out waiting for the hidden ChatGPT frame to open a fresh composer."
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
    draft.state = REQUEST_STATES.CHATGPT_TAB_READY;
    appendEvent(draft, "Using hidden internal ChatGPT frame.");
  });

  const response = await sendMessageToOffscreenFrame({
    type: CHATGPT_AUTOMATION_MESSAGES.RUN,
    request: buildAutomationRunRequest({
      request,
      attachments,
      adapterHints,
      automationSettings,
      visibilityModeOverride: "offscreen-frame"
    })
  });

  if (!response?.accepted) {
    throw new Error(response?.error || "Hidden ChatGPT frame did not accept the request.");
  }
}

function buildAutomationRunRequest({
  request,
  attachments,
  adapterHints,
  automationSettings,
  visibilityModeOverride = null
}) {
  return {
    id: request.id,
    profileId: request.profileId,
    prompt: request.prompt,
    attachments,
    adapterHints,
    chatOptions: buildChatOptionsForAutomationRun({
      automationSettings,
      request,
      visibilityModeOverride
    })
  };
}

async function injectAutomationScript(tabId) {
  await chrome.scripting.executeScript({
    target: {
      tabId
    },
    files: CHATGPT_CONTENT_SCRIPT_FILES
  });
}

async function handleAutomationEvent(message, sender) {
  const requestId = message.requestId;

  if (!requestId) {
    return;
  }

  console.debug("[ChatGPT Relay] Automation event", {
    requestId,
    tabId: sender.tab?.id || null,
    state: message.state || null,
    textLength: typeof message.text === "string" ? message.text.length : null,
    htmlLength: typeof message.html === "string" ? message.html.length : null,
    detail: message.detail || null
  });

  const existingRequest = await getRequest(requestId).catch(() => null);

  if (!existingRequest) {
    return;
  }

  if (isTerminalRequest(existingRequest)) {
    if (
      message.state === REQUEST_STATES.RESPONSE_COMPLETE
      || message.state === REQUEST_STATES.ERROR_STATE
    ) {
      await disableFocusEmulationForRequest(requestId).catch(() => null);
      await clearAutomationRequestActive(requestId).catch(() => null);
    }

    console.debug("[ChatGPT Relay] Ignoring automation event for terminal request", {
      requestId,
      existingState: existingRequest.state,
      incomingState: message.state || null,
      detail: message.detail || null
    });
    return;
  }

  await updateRequest(requestId, (draft) => {
    if (sender.tab?.id) {
      draft.chatTabId = sender.tab.id;
    }

    if (message.state) {
      draft.state = message.state;
    }

    if (typeof message.text === "string") {
      draft.responseText = message.text;
    }

    if (typeof message.html === "string") {
      draft.responseHtml = message.html;
    }

    if (message.error) {
      draft.error = message.error;
    }

    if (message.conversationUrl) {
      draft.chatConversationUrl = message.conversationUrl;
    }

    if (message.conversationKey) {
      draft.chatConversationKey = message.conversationKey;
    }

    if (message.state === REQUEST_STATES.RESPONSE_COMPLETE) {
      draft.completedAt = new Date().toISOString();
    }

    if (message.state === REQUEST_STATES.ERROR_STATE) {
      draft.completedAt = new Date().toISOString();
    }

    appendEvent(draft, message.detail || message.state || "Automation event received.");
  });

  if (sender.tab?.id && isChatGptUrl(sender.tab.url || sender.tab.pendingUrl || "")) {
    await setAutomationWindowState({
      windowId: sender.tab.windowId,
      tabId: sender.tab.id
    });
  }

  if (message.conversationUrl || message.conversationKey) {
    await updateSessionConversation({
      conversationUrl: message.conversationUrl || null,
      conversationKey: message.conversationKey || null
    }).catch(() => null);
  }

  if (
    message.state === REQUEST_STATES.RESPONSE_COMPLETE
    || message.state === REQUEST_STATES.ERROR_STATE
  ) {
    const request = await getRequest(requestId);
    const settings = await getAutomationSettings(EXTENSION_NAME);
    const requestVisibilityMode = request?.automationVisibilityMode || getVisibilityMode(settings.visibility);

    await disableFocusEmulationForRequest(requestId).catch(() => null);
    await clearAutomationRequestActive(requestId).catch(() => null);

    if (requestVisibilityMode === VISIBILITY_MODES.FOCUSED) {
      await restoreSourceFocus(getSourceFocusTarget(request?.source), sender.tab?.windowId);
    }
  }

  if (message.state === REQUEST_STATES.ERROR_STATE && message.domSnapshot) {
    await maybeRequestLocalAdapterRepair(requestId, message);
  }
}

async function handleFocusEmulationDetached({ requestId, reason }) {
  const request = await getRequest(requestId).catch(() => null);

  if (!request || isTerminalRequest(request)) {
    return;
  }

  await markRequestError(
    requestId,
    new Error(`Chrome debugger focus emulation detached (${reason}). Background ChatGPT streaming cannot continue while the ChatGPT page is hidden. Close DevTools for the ChatGPT tab and retry, or switch routing mode to Focus ChatGPT.`)
  );
}

async function handleOffscreenFrameDisconnected({ requestId, reason }) {
  const request = await getRequest(requestId).catch(() => null);

  if (!request || isTerminalRequest(request)) {
    return;
  }

  await clearAutomationRequestActive(requestId).catch(() => null);
  await markRequestError(
    requestId,
    new Error(`${reason} Hidden internal automation cannot continue. The next run will probe again and may fall back to one inactive tab.`)
  );
}

async function handleAutomationDebug(message, sender) {
  const requestId = message.requestId || null;
  const stage = message.stage || "debug";

  console.debug("[ChatGPT Relay] Content debug", {
    requestId,
    tabId: sender.tab?.id || null,
    stage,
    data: message.data || null
  });

  if (!requestId) {
    return;
  }

  if (stage === "stream-update") {
    return;
  }

  await updateRequest(requestId, (draft) => {
    appendEvent(draft, `Debug ${stage}: ${summarizeDebugData(message.data)}`);
  }).catch(() => null);
}

async function maybeRequestLocalAdapterRepair(requestId, message) {
  const settings = await getRepairSettings();

  if (!settings.enabled) {
    return;
  }

  await updateRequest(requestId, (draft) => {
    appendEvent(draft, "Requesting local DOM adapter repair suggestions.");
  });

  try {
    const suggestions = await requestAdapterRepair({
      snapshot: message.domSnapshot,
      failure: message.error || message.detail,
      settings
    });

    await updateRequest(requestId, (draft) => {
      draft.repairSuggestions = {
        hints: suggestions.hints,
        warnings: suggestions.warnings,
        createdAt: new Date().toISOString()
      };
      appendEvent(draft, `Local repair returned ${suggestions.hints.length} validated hint(s).`);
    });
  } catch (error) {
    await updateRequest(requestId, (draft) => {
      appendEvent(draft, `Local repair failed: ${serializeError(error)}`);
    });
  }
}

async function markRequestError(requestId, error) {
  await updateRequest(requestId, (draft) => {
    draft.state = REQUEST_STATES.ERROR_STATE;
    draft.error = serializeError(error);
    draft.completedAt = new Date().toISOString();
    appendEvent(draft, `Error: ${draft.error}`);
  });
}

function isTerminalRequest(request) {
  return Boolean(
    request?.completedAt
    || request?.state === REQUEST_STATES.RESPONSE_COMPLETE
    || request?.state === REQUEST_STATES.ERROR_STATE
  );
}

async function getReconciledAutomationSession() {
  const session = await getAutomationSession();

  if (!session.activeRequestId) {
    return session;
  }

  const request = await getRequest(session.activeRequestId).catch(() => null);

  if (!request || isTerminalRequest(request)) {
    return clearAutomationRequestActive(session.activeRequestId).catch(() => session);
  }

  return session;
}

async function openSidePanel(tabId) {
  if (!tabId || !chrome.sidePanel?.open) {
    return;
  }

  await chrome.sidePanel.open({
    tabId
  }).catch(() => null);
}

const MESSAGE_RETRY_CONFIG = {
  maxAttempts: 3,
  initialDelayMs: 200,
  backoffMultiplier: 2,
  maxDelayMs: 2000
};

async function sendMessageToTab(tabId, message) {
  return sendMessageToTabWithRetry(tabId, message, MESSAGE_RETRY_CONFIG);
}

async function sendMessageToTabWithRetry(tabId, message, config = MESSAGE_RETRY_CONFIG, attemptNumber = 0) {
  try {
    // Ensure tab still exists
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) {
      throw new Error("Tab no longer exists.");
    }

    // Don't wait for tab to be fully loaded on retries - just ensure it's there
    // but wait a bit for it to recover from bfcache
    if (attemptNumber > 0 && tab.status !== "complete") {
      await sleep(300);
    }

    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    const errorMessage = error?.message || String(error);
    const isBfcacheError = errorMessage.includes("back/forward cache");
    const isDisconnectedError = errorMessage.includes("Receiving end does not exist") ||
                               errorMessage.includes("The message port closed before") ||
                               errorMessage.includes("could not establish connection");

    // Retry on bfcache or disconnection errors
    if ((isBfcacheError || isDisconnectedError) && attemptNumber < config.maxAttempts) {
      const delayMs = Math.min(
        config.initialDelayMs * Math.pow(config.backoffMultiplier, attemptNumber),
        config.maxDelayMs
      );

      console.info("[ChatGPT Relay] Message to tab failed, retrying in " + delayMs + "ms", {
        tabId,
        attempt: attemptNumber + 1,
        maxAttempts: config.maxAttempts,
        error: errorMessage
      });

      // Sleep before retry to allow page to recover
      await sleep(delayMs);

      return sendMessageToTabWithRetry(tabId, message, config, attemptNumber + 1);
    }

    throw error;
  }
}
