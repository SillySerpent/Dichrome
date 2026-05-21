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
import {
  getVisibilityMode,
  mergeAutomationSettings,
  usesHiddenAutomation
} from "../automation/settings.js";
import { summarizeDebugData } from "../debug-dump.js";
import {
  disableFocusEmulationForRequest,
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
  CHATGPT_CONTENT_SCRIPT_FILES,
  getTabId,
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
  rememberSourceTab
} from "../automation/source-focus.js";
import {
  getAutomationSettings,
  getPublicAutomationSettings,
  setAutomationSettings
} from "./settings-repository.js";
import { createContextMenuController } from "./context-menu.js";
import { buildChatOptionsForAutomationRun } from "./conversation-run-options.js";
import { createRuntimeMessageRouter } from "./message-router.js";
import { createProjectHistoryController } from "./project-history-controller.js";
import { createRequestController } from "./request-controller.js";
import { getFreshConversationUrl } from "./fresh-conversation-url.js";
import {
  CHATGPT_AUTOMATION_MESSAGES,
  REQUEST_ERROR_CODES
} from "../../shared/contracts.js";
import { formatUserFacingError } from "../../shared/error-messages.js";

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
  getProfile,
  getRequest,
  normalizeText,
  queryBestSourceTab,
  restoreAttachmentPayloads,
  sendMessageToOffscreenFrame,
  sendMessageToTab,
  startRequest,
  updateRequest
});
const projectHistoryController = createProjectHistoryController({
  getAutomationSettings: () => getResolvedAutomationSettings(),
  probeOffscreenAutomationTarget: () => probeHiddenAutomationWithWarmup({ attempts: 3, initialDelayMs: 350 }),
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
  checkChatGptWorkspace,
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
        error: serializeError(error),
        errorCode: error?.errorCode || classifyRequestError(error)
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
    const request = await getRequest(requestId);

    if (!request) {
      throw new Error("Request disappeared before orchestration started.");
    }

    const automationSettings = await resolveAutomationSettingsProjectTarget(mergeAutomationSettings(
      await getAutomationSettings(EXTENSION_NAME),
      chatOptionsOverride,
      EXTENSION_NAME
    ));
    const hiddenCapability = await probeHiddenAutomationWithWarmup({ attempts: 3, initialDelayMs: 350 });

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

async function injectAutomationScript(tabId) {
  await chrome.scripting.executeScript({
    target: {
      tabId
    },
    files: CHATGPT_CONTENT_SCRIPT_FILES
  });
}

async function checkChatGptWorkspace() {
  const capability = await probeHiddenAutomationWithWarmup({
    attempts: 3,
    initialDelayMs: 350
  });
  const errorCode = capability?.supported
    ? null
    : classifyHiddenCapabilityFailure(capability?.failureReason || "Hidden internal automation is unavailable.");

  return {
    ready: Boolean(capability?.supported),
    capability,
    errorCode,
    message: capability?.supported
      ? "Hidden ChatGPT workspace is ready."
      : formatUserFacingError(errorCode, capability?.failureReason || "Hidden internal automation is unavailable.")
  };
}

async function probeHiddenAutomationWithWarmup({ attempts = 2, initialDelayMs = 300 } = {}) {
  let lastCapability = null;

  for (let index = 0; index < attempts; index += 1) {
    lastCapability = await probeOffscreenAutomationTarget();

    if (lastCapability?.supported) {
      return lastCapability;
    }

    if (index < attempts - 1) {
      await sleep(initialDelayMs * (index + 1));
    }
  }

  return lastCapability;
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

    if (message.errorCode) {
      draft.errorCode = message.errorCode;
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
      draft.errorCode = draft.errorCode || classifyRequestError(message.error || message.detail || "");
      draft.completedAt = new Date().toISOString();
    }

    appendEvent(draft, message.detail || message.state || "Automation event received.");
  });

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
    await disableFocusEmulationForRequest(requestId).catch(() => null);
    await clearAutomationRequestActive(requestId).catch(() => null);
  }

}

async function handleFocusEmulationDetached({ requestId, reason }) {
  const request = await getRequest(requestId).catch(() => null);

  if (!request || isTerminalRequest(request)) {
    return;
  }

  await markRequestError(
    requestId,
    createCodedError(
      `Hidden ChatGPT workspace lost its automation connection (${reason}). Retry from Dichrome after the workspace is ready.`,
      REQUEST_ERROR_CODES.HIDDEN_FRAME_UNAVAILABLE
    )
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
    createCodedError(
      `${reason} Hidden internal automation cannot continue. Open ChatGPT to sign in if needed, then retry from Dichrome.`,
      classifyHiddenCapabilityFailure(reason)
    )
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

async function markRequestError(requestId, error) {
  await updateRequest(requestId, (draft) => {
    draft.state = REQUEST_STATES.ERROR_STATE;
    const rawError = serializeError(error);
    draft.errorCode = error?.errorCode || classifyRequestError(rawError);
    draft.error = formatUserFacingError(draft.errorCode, rawError);
    draft.rawError = rawError;
    draft.completedAt = new Date().toISOString();
    appendEvent(draft, `Error: ${draft.error}`);
  });
}

function createCodedError(message, errorCode) {
  const error = new Error(message);
  error.errorCode = errorCode || REQUEST_ERROR_CODES.CHATGPT_UNAVAILABLE;
  return error;
}

function classifyHiddenCapabilityFailure(message) {
  return classifyRequestError(message || "Hidden internal automation is unavailable.");
}

function classifyRequestError(error) {
  const message = serializeError(error).toLowerCase();

  if (/\b(log in|login|sign in|sign-in|auth|account gate|401|403|session|access token)\b/.test(message)) {
    return REQUEST_ERROR_CODES.AUTH_REQUIRED;
  }

  if (/\b(model|picker)\b/.test(message) && /\b(unavailable|not available|not selectable|not confirm|not found|upgrade|plan|tier|rejected)\b/.test(message)) {
    return REQUEST_ERROR_CODES.MODEL_UNAVAILABLE;
  }

  if (/\b(upload|attachment|file input|file too large|unsupported file|image limit|file limit|rejected)\b/.test(message)) {
    return REQUEST_ERROR_CODES.UPLOAD_REJECTED;
  }

  if (/\b(rate limit|usage limit|too many requests|temporarily unavailable|try again later|429)\b/.test(message)) {
    return REQUEST_ERROR_CODES.RATE_LIMITED;
  }

  if (/\b(project)\b/.test(message) && /\b(not found|unavailable|requires|routing|history)\b/.test(message)) {
    return REQUEST_ERROR_CODES.PROJECT_UNAVAILABLE;
  }

  if (/\b(disconnect|disconnected|receiving end does not exist|message port closed|could not establish connection|bridge)\b/.test(message)) {
    return REQUEST_ERROR_CODES.BRIDGE_DISCONNECTED;
  }

  if (/\b(hidden|offscreen|frame|iframe)\b/.test(message)) {
    return REQUEST_ERROR_CODES.HIDDEN_FRAME_UNAVAILABLE;
  }

  return REQUEST_ERROR_CODES.CHATGPT_UNAVAILABLE;
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
