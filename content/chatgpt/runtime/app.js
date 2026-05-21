(() => {
  if (window.__chatGptPageRelayAutomationLoaded) {
    return;
  }

  window.__chatGptPageRelayAutomationLoaded = true;

  const CONTRACTS = globalThis.ChatGptRelay?.contracts || {};
  const RUNTIME = globalThis.ChatGptRelay?.runtime || {};
  const MESSAGE_RUNTIME = RUNTIME.messages || {};
  const URL_RUNTIME = RUNTIME.chatGptUrl || {};
  const ERROR_RUNTIME = RUNTIME.errors || {};
  const DOM_UTILS = RUNTIME.domUtils || {};
  const WAIT_RUNTIME = RUNTIME.wait || {};
  const RESPONSE_EXTRACTION = RUNTIME.responseExtraction || {};
  const NETWORK_CAPTURE_RUNTIME = RUNTIME.networkCaptureClient || {};
  const PROJECT_HISTORY_RUNTIME = RUNTIME.projectHistory || {};
  const OFFSCREEN_BRIDGE_RUNTIME = RUNTIME.offscreenBridge || {};
  const VISIBILITY_RUNTIME = RUNTIME.visibility || {};
  const DEBUG_DUMP_RUNTIME = RUNTIME.debugDump || {};
  const RESPONSE_OBSERVER_RUNTIME = RUNTIME.responseObserver || {};
  const AUTOMATION_RUNNER_RUNTIME = RUNTIME.automationRunner || {};
  const ADAPTER_OPTIONS = RUNTIME.adapterOptions || {};
  const ADAPTER_SCORING = RUNTIME.adapterScoring || {};
  const ADAPTER_BASE = RUNTIME.adapterBase || {};
  const ADAPTER_PROJECT_ROUTING = RUNTIME.adapterProjectRouting || {};
  const ADAPTER_CONVERSATION = RUNTIME.adapterConversation || {};
  const ADAPTER_MODEL_SELECTION = RUNTIME.adapterModelSelection || {};
  const ADAPTER_COMPOSER_CONTROLS = RUNTIME.adapterComposerControls || {};
  const ADAPTER_ASSISTANT_RESPONSE = RUNTIME.adapterAssistantResponse || {};
  const REQUEST_STATES = CONTRACTS.requestStates || Object.freeze({
    CHATGPT_TAB_READY: "CHATGPT_TAB_READY",
    PROJECT_READY: "PROJECT_READY",
    CONVERSATION_READY: "CONVERSATION_READY",
    MODEL_SELECTED: "MODEL_SELECTED",
    PROMPT_INSERTED: "PROMPT_INSERTED",
    PROMPT_SENT: "PROMPT_SENT",
    WAITING_FOR_ASSISTANT_MESSAGE: "WAITING_FOR_ASSISTANT_MESSAGE",
    STREAMING_RESPONSE: "STREAMING_RESPONSE",
    RESPONSE_COMPLETE: "RESPONSE_COMPLETE",
    ERROR_STATE: "ERROR_STATE"
  });
  const VISIBILITY_MODES = CONTRACTS.visibilityModes || Object.freeze({
    OFFSCREEN_FRAME: "offscreen-frame",
    HIDDEN: "hidden",
    SINGLE_TAB: "single-tab",
    SIDECAR: "sidecar",
    FOCUSED: "focused"
  });
  const AUTOMATION_MESSAGES = MESSAGE_RUNTIME.types || CONTRACTS.messages || Object.freeze({
    ping: "CHATGPT_AUTOMATION_PING",
    dump: "CHATGPT_AUTOMATION_DUMP",
    cancel: "CHATGPT_AUTOMATION_CANCEL",
    navigate: "CHATGPT_AUTOMATION_NAVIGATE",
    run: "CHATGPT_AUTOMATION_RUN",
    listProjectConversations: "CHATGPT_AUTOMATION_LIST_PROJECT_CONVERSATIONS",
    loadProjectConversation: "CHATGPT_AUTOMATION_LOAD_PROJECT_CONVERSATION",
    event: "CHATGPT_AUTOMATION_EVENT",
    debug: "CHATGPT_AUTOMATION_DEBUG",
    offscreenFrameReady: "OFFSCREEN_FRAME_READY",
    offscreenFrameCommand: "OFFSCREEN_FRAME_COMMAND",
    offscreenFrameCommandResponse: "OFFSCREEN_FRAME_COMMAND_RESPONSE"
  });
  const WAIT_TIMEOUTS = Object.freeze({
    composerMs: 15000,
    sendButtonMs: 8000,
    assistantMs: 90000,
    completionMs: 180000
  });
  const STREAM_STABILITY_MS = 1800;
  const STREAM_EMIT_THROTTLE_MS = 150;
  const SNAPSHOT_LIMITS = Object.freeze({
    inputs: 30,
    buttons: 60,
    messages: 40
  });
  const OFFSCREEN_FRAME_PORT_NAME = CONTRACTS.offscreenFramePortName || "chatgpt-relay-offscreen-frame";
  const {
    extractConversationKey,
    sanitizeChatGptNavigationUrl,
    normalizeLocationForComparison,
    isChatGptLocation,
    isNonAutomationChatGptFrame,
    isAllowedChatGptUrl,
    extractProjectPathSegment,
    normalizeProjectNavigationHref,
    urlLooksProjectScopedForName
  } = URL_RUNTIME;
  const {
    DomAdapterError,
    VisibilityStateError,
    serializeError
  } = ERROR_RUNTIME;
  const {
    clickElement,
    setEditableText,
    prioritizeComposerButtons,
    normalizeAssistantMessageElement,
    isInsideUserAuthoredMessage,
    compareDocumentOrder,
    findBestAssistantContentElement,
    extractReadableTextFromElement,
    extractReadableHtmlFromElement,
    resolveHintElements,
    collectCandidates,
    describeElementForDebug,
    findVisible,
    isVisible,
    isDisabled,
    isTextInput,
    getElementLabel,
    queryAllSafe,
    queryAllWithin,
    uniqueElements,
    normalizeText,
    dataUrlToFile
  } = DOM_UTILS;
  const {
    selectLatestAssistantResponseFromConversationData,
    selectConversationMessagesFromConversationData,
    extractConversationTitleFromConversationData,
    shouldPreferBackendResponse,
    isLowConfidenceDomResponse,
    isFinishedBackendStatus,
    isTransientAssistantStatusText,
    emptyCanonicalHtmlFallback
  } = RESPONSE_EXTRACTION;
  const {
    assertNotCancelled,
    sleep,
    waitFor,
    waitForMutationOrDelay,
    waitForOptional
  } = WAIT_RUNTIME;
  const {
    normalizeProjectOptions,
    normalizeConversationOptions,
    normalizeModelOptions,
    normalizeAdapterHints
  } = ADAPTER_OPTIONS;
  const {
    scoreProjectCandidate,
    isProjectNavigationTarget,
    isProjectOverflowControl,
    isSelectedNavigationElement,
    scoreNewChatCandidate,
    scoreCreateProjectLabel,
    isProjectNameInputCandidate,
    scoreProjectNameInputCandidate,
    findAncestorContainingProjectSubmit,
    scoreDialogActionCandidate,
    scoreModelPickerCandidate,
    scoreModelOptionCandidate,
    textMatchesName,
    elementMatchesText,
    normalizeComparableText
  } = ADAPTER_SCORING;
  const createAdapterClass = ADAPTER_BASE.createClass;
  const createProjectRoutingMethods = ADAPTER_PROJECT_ROUTING.createMethods;
  const createConversationMethods = ADAPTER_CONVERSATION.createMethods;
  const createModelSelectionMethods = ADAPTER_MODEL_SELECTION.createMethods;
  const createComposerControlMethods = ADAPTER_COMPOSER_CONTROLS.createMethods;
  const createAssistantResponseMethods = ADAPTER_ASSISTANT_RESPONSE.createMethods;
  const createNetworkCaptureClient = NETWORK_CAPTURE_RUNTIME.createClient;
  const createProjectHistoryController = PROJECT_HISTORY_RUNTIME.createController;
  const createOffscreenBridge = OFFSCREEN_BRIDGE_RUNTIME.createBridge;
  const createVisibilityController = VISIBILITY_RUNTIME.createController;
  const createDebugTools = DEBUG_DUMP_RUNTIME.createDebugTools;
  const createResponseObserver = RESPONSE_OBSERVER_RUNTIME.createObserver;
  const createAutomationRunner = AUTOMATION_RUNNER_RUNTIME.createRunner;
  const sendRuntimeMessage = MESSAGE_RUNTIME.send || ((payload) => chrome.runtime.sendMessage(payload).catch(() => null));

  let activeRun = null;
  let automationRunner = null;
  let debugTools = null;
  let activeHistoryRun = null;
  let networkCaptureClient = null;
  let offscreenBridge = null;
  let projectHistoryController = null;
  let responseObserver = null;
  let visibilityController = null;

  function handleAutomationMessage(message, sendResponse) {
    if (!message || typeof message.type !== "string") {
      return false;
    }

    if (message.type === AUTOMATION_MESSAGES.ping) {
      sendResponse({
        ok: true,
        busy: Boolean(activeRun && !activeRun.finished)
      });
      return false;
    }

    if (message.type === AUTOMATION_MESSAGES.dump) {
      sendResponse({
        ok: true,
        dump: debugTools.collectAutomationDebugDump({
          activeRun
        })
      });
      return false;
    }

    if (message.type === AUTOMATION_MESSAGES.cancel) {
      if (activeRun && activeRun.requestId === message.requestId) {
        activeRun.cancelled = true;
      }

      sendResponse({
        ok: true
      });
      return false;
    }

    if (message.type === AUTOMATION_MESSAGES.navigate) {
      const url = sanitizeChatGptNavigationUrl(message.url);

      if (!url) {
        sendResponse({
          ok: false,
          error: "Navigation target is not a ChatGPT URL."
        });
        return false;
      }

      if (normalizeLocationForComparison(location.href) !== normalizeLocationForComparison(url)) {
        location.assign(url);
      }

      sendResponse({
        ok: true,
        url
      });
      return false;
    }

    if (message.type === AUTOMATION_MESSAGES.run) {
      if (activeRun && !activeRun.finished) {
        sendResponse({
          accepted: false,
          error: "ChatGPT automation is already running in this tab."
        });
        return false;
      }

      activeRun = {
        requestId: message.request?.id,
        cancelled: false,
        finished: false
      };

      automationRunner.runAutomation(message.request, activeRun)
        .catch((error) => debugTools.emitError(message.request?.id, error))
        .finally(() => {
          if (activeRun?.requestId === message.request?.id) {
            activeRun.finished = true;
            activeRun = null;
          }
        });

      sendResponse({
        accepted: true
      });
      return false;
    }

    if (message.type === AUTOMATION_MESSAGES.listProjectConversations) {
      return runHistoryCommand(sendResponse, (run) => projectHistoryController.listProjectConversations({
        project: message.project,
        cursor: message.cursor,
        limit: message.limit
      }, run));
    }

    if (message.type === AUTOMATION_MESSAGES.loadProjectConversation) {
      return runHistoryCommand(sendResponse, (run) => projectHistoryController.loadProjectConversation({
        project: message.project,
        conversationId: message.conversationId,
        conversationUrl: message.conversationUrl
      }, run));
    }

    return false;
  }

  function runHistoryCommand(sendResponse, producer) {
    if (activeRun && !activeRun.finished) {
      sendResponse({
        ok: false,
        error: "ChatGPT automation is already running in this target."
      });
      return false;
    }

    if (activeHistoryRun && !activeHistoryRun.finished) {
      sendResponse({
        ok: false,
        error: "Project history is already loading in this target."
      });
      return false;
    }

    activeHistoryRun = {
      requestId: "project-history",
      cancelled: false,
      finished: false
    };

    Promise.resolve()
      .then(() => producer(activeHistoryRun))
      .then((payload) => {
        sendResponse({
          ok: true,
          ...payload
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: serializeError(error)
        });
      })
      .finally(() => {
        if (activeHistoryRun?.requestId === "project-history") {
          activeHistoryRun.finished = true;
          activeHistoryRun = null;
        }
      });

    return true;
  }

  const ChatGptDomAdapter = createAdapterClass({
    SNAPSHOT_LIMITS,
    collectCandidates,
    findVisible,
    normalizeAdapterHints,
    normalizeText,
    queryAllSafe,
    resolveHintElements,
    uniqueElements,
    waitFor
  });
  Object.assign(ChatGptDomAdapter.prototype, createProjectRoutingMethods({
    REQUEST_STATES,
    DomAdapterError,
    clickElement,
    emitState,
    extractProjectPathSegment,
    findAncestorContainingProjectSubmit,
    findVisible,
    getElementLabel,
    isDisabled,
    isOffscreenAutomationFrame,
    isVisible,
    isProjectNameInputCandidate,
    isProjectNavigationTarget,
    isProjectOverflowControl,
    isSelectedNavigationElement,
    normalizeComparableText,
    normalizeProjectOptions,
    queryAllSafe,
    queryAllWithin,
    scoreCreateProjectLabel,
    scoreDialogActionCandidate,
    scoreProjectCandidate,
    scoreProjectNameInputCandidate,
    setEditableText,
    sleep,
    textMatchesName,
    uniqueElements,
    urlLooksProjectScopedForName,
    waitFor,
    waitForOptional
  }));
  Object.assign(ChatGptDomAdapter.prototype, createConversationMethods({
    REQUEST_STATES,
    clickElement,
    emitState,
    extractProjectPathSegment,
    getElementLabel,
    isDisabled,
    isOffscreenAutomationFrame,
    isVisible,
    normalizeComparableText,
    normalizeConversationOptions,
    normalizeProjectNavigationHref,
    normalizeProjectOptions,
    normalizeText,
    queryAllSafe,
    scoreNewChatCandidate,
    waitFor
  }));
  Object.assign(ChatGptDomAdapter.prototype, createModelSelectionMethods({
    REQUEST_STATES,
    DomAdapterError,
    clickElement,
    elementMatchesText,
    emitState,
    getElementLabel,
    isDisabled,
    isVisible,
    normalizeComparableText,
    normalizeModelOptions,
    normalizeText,
    queryAllSafe,
    queryAllWithin,
    uniqueElements,
    scoreModelOptionCandidate,
    scoreModelPickerCandidate,
    sleep,
    waitFor,
    waitForOptional
  }));
  Object.assign(ChatGptDomAdapter.prototype, createComposerControlMethods({
    REQUEST_STATES,
    dataUrlToFile,
    emitState,
    findVisible,
    getElementLabel,
    isDisabled,
    isTextInput,
    isVisible,
    normalizeText,
    prioritizeComposerButtons,
    queryAllSafe,
    setEditableText,
    sleep,
    waitFor
  }));
  Object.assign(ChatGptDomAdapter.prototype, createAssistantResponseMethods({
    compareDocumentOrder,
    extractConversationKey,
    extractReadableHtmlFromElement,
    extractReadableTextFromElement,
    findBestAssistantContentElement,
    getChatGptAccessToken,
    getElementLabel,
    isAllowedChatGptUrl,
    isInsideUserAuthoredMessage,
    isTransientAssistantStatusText,
    isVisible,
    normalizeAssistantMessageElement,
    normalizeText,
    queryAllSafe,
    selectLatestAssistantResponseFromConversationData,
    uniqueElements
  }));

  initializeRuntime();

  function initializeRuntime() {
    networkCaptureClient = createNetworkCaptureClient({
      emptyCanonicalHtmlFallback,
      extractConversationKey,
      isAllowedChatGptUrl,
      isNonAutomationChatGptFrame,
      normalizeText
    });
    projectHistoryController = createProjectHistoryController({
      ChatGptDomAdapter,
      DomAdapterError,
      extractConversationKey,
      extractConversationTitleFromConversationData,
      extractProjectPathSegment,
      getChatGptAccessToken,
      isAllowedChatGptUrl,
      normalizeProjectOptions,
      normalizeText,
      selectConversationMessagesFromConversationData
    });
    debugTools = createDebugTools({
      AUTOMATION_MESSAGES,
      REQUEST_STATES,
      ChatGptDomAdapter,
      buildDebugPayload: MESSAGE_RUNTIME.buildDebugPayload,
      describeElementForDebug,
      extractConversationKey,
      getNetworkCaptureDebug: () => networkCaptureClient.collectDebug(),
      normalizeText,
      sendRuntimeMessage,
      serializeError
    });
    visibilityController = createVisibilityController({
      VISIBILITY_MODES,
      VisibilityStateError,
      collectRuntimeDebug,
      emitDebug,
      waitForOptional
    });
    responseObserver = createResponseObserver({
      REQUEST_STATES,
      STREAM_EMIT_THROTTLE_MS,
      STREAM_STABILITY_MS,
      WAIT_TIMEOUTS,
      DomAdapterError,
      assertExpectedVisiblePage,
      assertNotCancelled,
      emptyCanonicalHtmlFallback,
      emitDebug,
      emitState,
      extractConversationKey,
      getLatestNetworkCapturedAssistantResponse,
      isFinishedBackendStatus,
      isLowConfidenceDomResponse,
      isTransientAssistantStatusText,
      normalizeText,
      shouldPreferBackendResponse,
      waitForMutationOrDelay
    });
    automationRunner = createAutomationRunner({
      REQUEST_STATES,
      WAIT_TIMEOUTS,
      ChatGptDomAdapter,
      DomAdapterError,
      assertExpectedVisiblePage,
      assertNotCancelled,
      clickElement,
      collectRuntimeDebug,
      describeElementForDebug,
      emitDebug,
      emitState,
      getAutomationVisibilityMode,
      normalizeText,
      observeAssistantResponse,
      resetNetworkCaptureForRequest,
      sleep,
      waitFor
    });
    offscreenBridge = createOffscreenBridge({
      AUTOMATION_MESSAGES,
      OFFSCREEN_FRAME_PORT_NAME,
      handleAutomationMessage,
      isChatGptLocation,
      isNonAutomationChatGptFrame
    });

    networkCaptureClient.install();
    window.addEventListener("message", networkCaptureClient.handleMessage);
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      return handleAutomationMessage(message, sendResponse);
    });
    offscreenBridge.setup();
  }

  function assertExpectedVisiblePage(...args) {
    return visibilityController.assertExpectedVisiblePage(...args);
  }

  function collectRuntimeDebug(...args) {
    return debugTools.collectRuntimeDebug(...args);
  }

  function emitDebug(...args) {
    return debugTools.emitDebug(...args);
  }

  function emitState(...args) {
    return debugTools.emitState(...args);
  }

  function getAutomationVisibilityMode(...args) {
    return visibilityController.getAutomationVisibilityMode(...args);
  }

  function getChatGptAccessToken(...args) {
    return networkCaptureClient.getAccessToken(...args);
  }

  function getLatestNetworkCapturedAssistantResponse(...args) {
    return networkCaptureClient.getLatestAssistantResponse(...args);
  }

  function isOffscreenAutomationFrame() {
    return offscreenBridge.isOffscreenAutomationFrame();
  }

  function observeAssistantResponse(...args) {
    return responseObserver.observeAssistantResponse(...args);
  }

  function resetNetworkCaptureForRequest(...args) {
    return networkCaptureClient.resetForRequest(...args);
  }
})();
