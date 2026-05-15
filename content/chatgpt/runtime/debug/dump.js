(() => {
  const relay = globalThis.ChatGptRelay = globalThis.ChatGptRelay || {};
  const runtime = relay.runtime = relay.runtime || {};

  function createDebugTools({
    AUTOMATION_MESSAGES,
    REQUEST_STATES,
    ChatGptDomAdapter,
    buildDebugPayload,
    describeElementForDebug,
    extractConversationKey,
    getNetworkCaptureDebug,
    normalizeText,
    sendRuntimeMessage,
    serializeError
  }) {
    function emitState(requestId, state, { text, html, detail } = {}) {
      const conversation = getConversationInfo();

      sendRuntimeMessage({
        type: AUTOMATION_MESSAGES.event,
        requestId,
        state,
        text,
        html,
        detail,
        conversationUrl: conversation.url,
        conversationKey: conversation.key
      });
    }

    function emitDebug(requestId, stage, data = {}) {
      const payload = buildDebugPayload
        ? buildDebugPayload(requestId, stage, data)
        : {
            type: AUTOMATION_MESSAGES.debug,
            requestId,
            stage,
            data: {
              ...data,
              url: location.href,
              visibilityState: document.visibilityState,
              hasFocus: document.hasFocus(),
              at: new Date().toISOString()
            }
          };

      console.debug("[ChatGPT Relay] Automation debug", payload);
      sendRuntimeMessage(payload);
    }

    function getConversationInfo() {
      try {
        const url = new URL(location.href);
        const key = extractConversationKey(url.href);

        return {
          url: key ? `${url.origin}${url.pathname}` : null,
          key
        };
      } catch (_error) {
        return {
          url: null,
          key: null
        };
      }
    }

    function emitError(requestId, error) {
      const payload = {
        type: AUTOMATION_MESSAGES.event,
        requestId,
        state: REQUEST_STATES.ERROR_STATE,
        error: serializeError(error),
        detail: "Automation failed."
      };

      if (!error?.suppressDomSnapshot) {
        payload.domSnapshot = error?.snapshot || new ChatGptDomAdapter([]).collectSnapshot();
      }

      sendRuntimeMessage(payload);
    }

    function collectAutomationDebugDump({ activeRun } = {}) {
      const adapter = new ChatGptDomAdapter([]);
      const composer = adapter.findComposer();
      const sendButton = adapter.findSendButton();
      const stopButton = adapter.findStopButton();
      const assistantMessages = adapter.findAssistantMessages();
      const newestAssistantMessage = assistantMessages[assistantMessages.length - 1] || null;

      return {
        runtime: collectRuntimeDebug({
          activeRun
        }),
        networkCapture: getNetworkCaptureDebug(),
        elements: {
          composer: describeElementForDebug(composer),
          sendButton: describeElementForDebug(sendButton),
          stopButton: describeElementForDebug(stopButton),
          assistantMessageCount: assistantMessages.length,
          newestAssistantMessage: describeElementForDebug(newestAssistantMessage),
          newestAssistantTextLength: newestAssistantMessage
            ? normalizeText(adapter.extractAssistantText(newestAssistantMessage)).length
            : 0
        },
        snapshot: adapter.collectSnapshot()
      };
    }

    function collectRuntimeDebug({ activeRun: run } = {}) {
      return {
        href: location.href,
        title: document.title,
        visibilityState: document.visibilityState,
        hasFocus: document.hasFocus(),
        readyState: document.readyState,
        activeElement: describeElementForDebug(document.activeElement),
        activeRun: run ? {
          requestId: run.requestId || null,
          cancelled: Boolean(run.cancelled),
          finished: Boolean(run.finished)
        } : null,
        bodyTextLength: normalizeText(document.body?.innerText || document.body?.textContent || "").length,
        timestamp: new Date().toISOString()
      };
    }

    return Object.freeze({
      collectAutomationDebugDump,
      collectRuntimeDebug,
      emitDebug,
      emitError,
      emitState,
      getConversationInfo
    });
  }

  runtime.debugDump = Object.freeze({
    createDebugTools
  });
})();
