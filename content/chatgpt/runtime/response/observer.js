(() => {
  const relay = globalThis.ChatGptRelay = globalThis.ChatGptRelay || {};
  const runtime = relay.runtime = relay.runtime || {};

  function createObserver({
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
  }) {
    const DOM_COMPLETION_STABILITY_MS = Math.max(STREAM_STABILITY_MS, 4200);

    async function observeAssistantResponse({ requestId, visibilityMode, adapter, messageElement, previousMessages = [], responseAfterMs = 0, promptText = "", run }) {
      const previousAssistantBaseline = adapter.createAssistantMessageBaseline(previousMessages);
      const responseStartedAfterMs = responseAfterMs || Date.now() - 1000;
      let trackedMessage = messageElement;
      let latestText = "";
      let latestHtml = "";
      let firstTextAt = 0;
      let lastTextChangeAt = Date.now();
      let lastEmitAt = 0;
      let lastBackendPollAt = 0;
      let lastBackendError = "";
      let transientStatusSeenAt = 0;
      const startedAt = Date.now();
      let observerWake;
      const observer = new MutationObserver(() => {
        if (observerWake) {
          observerWake();
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });

      try {
        while (Date.now() - startedAt < WAIT_TIMEOUTS.completionMs) {
          assertNotCancelled(run);
          await assertExpectedVisiblePage({
            id: requestId,
            chatOptions: {
              visibility: {
                mode: visibilityMode
              }
            }
          }, run, "response-observation");

          const newestMessage = adapter.findNewestAssistantMessageAfter(previousAssistantBaseline, trackedMessage);

          if (newestMessage) {
            trackedMessage = newestMessage;
          }

          const errorText = adapter.findErrorText();

          if (errorText) {
            throw new DomAdapterError(errorText, adapter.collectSnapshot());
          }

          let nextText = normalizeText(adapter.extractAssistantText(trackedMessage));
          let nextHtml = adapter.extractAssistantHtml(trackedMessage);
          let responseSource = "dom";
          let backendStatus = "";

          if (isTransientAssistantStatusText(nextText)) {
            transientStatusSeenAt = Date.now();
            nextText = "";
            nextHtml = "";
            responseSource = "dom-transient-status";
          }

          if (!nextText || isLowConfidenceDomResponse(nextText, promptText)) {
            const textBearingMessage = adapter.findNewestTextBearingAssistantMessageAfter(previousAssistantBaseline, trackedMessage);

            if (textBearingMessage && textBearingMessage !== trackedMessage) {
              trackedMessage = textBearingMessage;
              nextText = normalizeText(adapter.extractAssistantText(trackedMessage));
              nextHtml = adapter.extractAssistantHtml(trackedMessage);

              if (isTransientAssistantStatusText(nextText)) {
                transientStatusSeenAt = Date.now();
                nextText = "";
                nextHtml = "";
                responseSource = "dom-transient-status";
              }
            }
          }

          const capturedResponse = getLatestNetworkCapturedAssistantResponse(requestId, {
            afterMs: responseStartedAfterMs
          });

          if (capturedResponse?.text && !isTransientAssistantStatusText(capturedResponse.text) && shouldPreferBackendResponse(capturedResponse.text, nextText, promptText)) {
            nextText = capturedResponse.text;
            nextHtml = capturedResponse.html || emptyCanonicalHtmlFallback(capturedResponse.text);
            responseSource = "network-stream";
            backendStatus = capturedResponse.status || "";
            emitDebug(requestId, "network-response-selected", {
              textLength: nextText.length,
              domTextLength: normalizeText(adapter.extractAssistantText(trackedMessage)).length,
              conversationKey: capturedResponse.conversationKey || extractConversationKey(location.href) || null,
              messageId: capturedResponse.messageId || null,
              status: backendStatus,
              done: Boolean(capturedResponse.done)
            });
          }

          const shouldPollBackend = Date.now() - lastBackendPollAt >= 1000
            && (isLowConfidenceDomResponse(nextText, promptText) || Date.now() - startedAt >= 1500);

          if (shouldPollBackend) {
            lastBackendPollAt = Date.now();

            try {
              const backendResponse = await adapter.fetchLatestConversationAssistantResponse({
                afterMs: responseStartedAfterMs,
                excludedMessageIds: previousAssistantBaseline.messageIds
              });

              if (backendResponse?.text && !isTransientAssistantStatusText(backendResponse.text) && shouldPreferBackendResponse(backendResponse.text, nextText, promptText)) {
                nextText = backendResponse.text;
                nextHtml = backendResponse.html || emptyCanonicalHtmlFallback(backendResponse.text);
                responseSource = "backend-api";
                backendStatus = backendResponse.status || "";
                emitDebug(requestId, "backend-response-selected", {
                  textLength: nextText.length,
                  status: backendStatus,
                  conversationKey: backendResponse.conversationKey || null,
                  messageId: backendResponse.messageId || null,
                  domTextLength: normalizeText(adapter.extractAssistantText(trackedMessage)).length
                });
              }
            } catch (error) {
              const message = error?.message || String(error);

              if (message && message !== lastBackendError) {
                lastBackendError = message;
                emitDebug(requestId, "backend-response-poll-failed", {
                  error: message
                });
              }
            }
          }

          if (nextText && (nextText !== latestText || nextHtml !== latestHtml)) {
            latestText = nextText;
            latestHtml = nextHtml;
            firstTextAt = firstTextAt || Date.now();
            lastTextChangeAt = Date.now();

            if (Date.now() - lastEmitAt >= STREAM_EMIT_THROTTLE_MS) {
              lastEmitAt = Date.now();
              emitState(requestId, REQUEST_STATES.STREAMING_RESPONSE, {
                text: latestText,
                html: latestHtml,
                detail: responseSource === "network-stream"
                  ? "Assistant response updated from captured ChatGPT stream."
                  : responseSource === "backend-api"
                    ? "Assistant response updated from conversation API."
                    : "Assistant response updated."
              });
            }
          }

          const backendFinished = (responseSource === "backend-api" || responseSource === "network-stream") && isFinishedBackendStatus(backendStatus);
          const stabilityWindowMs = backendFinished ? STREAM_STABILITY_MS : DOM_COMPLETION_STABILITY_MS;
          const stable = Boolean(latestText) && Date.now() - lastTextChangeAt >= stabilityWindowMs;
          const hasStopped = !adapter.findStopButton();
          const sendReady = Boolean(adapter.findSendButton());
          const composerReady = adapter.isComposerIdle();
          const minimumResponseAgeMet = firstTextAt && Date.now() - firstTextAt >= 900;
          const transientStatusRecentlySeen = Boolean(transientStatusSeenAt && Date.now() - transientStatusSeenAt < DOM_COMPLETION_STABILITY_MS);

          // In ChatGPT's current UI, an empty composer often shows dictation/voice
          // controls instead of a visible send button. Requiring sendReady made
          // hidden/offscreen runs stream text forever until the hard timeout even
          // after the model had finished. Treat an idle composer as an equivalent
          // completion signal once the assistant text has stabilized and no stop
          // control is visible.
          const lowConfidenceCompletion = isLowConfidenceDomResponse(latestText, promptText)
            && responseSource !== "backend-api"
            && responseSource !== "network-stream";

          if (stable && hasStopped && (sendReady || composerReady || backendFinished) && minimumResponseAgeMet && !transientStatusRecentlySeen && !lowConfidenceCompletion) {
            emitState(requestId, REQUEST_STATES.RESPONSE_COMPLETE, {
              text: latestText,
              html: latestHtml,
              detail: responseSource === "network-stream"
                ? "Assistant response complete from captured ChatGPT stream."
                : responseSource === "backend-api"
                  ? "Assistant response complete from conversation API."
                  : "Assistant response complete."
            });
            return;
          }

          await waitForMutationOrDelay(250, (wake) => {
            observerWake = wake;
          });
          observerWake = null;
        }
      } finally {
        observer.disconnect();
      }

      throw new DomAdapterError("Timed out waiting for the assistant response to complete.", adapter.collectSnapshot());
    }

    return Object.freeze({
      observeAssistantResponse
    });
  }

  runtime.responseObserver = Object.freeze({
    createObserver
  });
})();
