import {
  REQUEST_STATES
} from "../../shared/contracts.js";
import {
  serializeError
} from "../constants.js";

export function createAutomationEventController({
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
}) {
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
      await clearAutomationRequestActive(requestId).catch(() => null);
    }
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

  return Object.freeze({
    handleAutomationDebug,
    handleAutomationEvent,
    handleOffscreenFrameDisconnected,
    markRequestError
  });
}

function isTerminalRequest(request) {
  return Boolean(
    request?.completedAt
    || request?.state === REQUEST_STATES.RESPONSE_COMPLETE
    || request?.state === REQUEST_STATES.ERROR_STATE
  );
}
