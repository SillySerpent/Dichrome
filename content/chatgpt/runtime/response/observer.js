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
    normalizeText,
    shouldPreferBackendResponse,
    waitForMutationOrDelay
  }) {
    async function observeAssistantResponse({ requestId, visibilityMode, adapter, messageElement, previousMessages = [], promptText = "", run }) {
      let trackedMessage = messageElement;
      let latestText = "";
      let latestHtml = "";
      let firstTextAt = 0;
      let lastTextChangeAt = Date.now();
      let lastEmitAt = 0;
      let lastBackendPollAt = 0;
      let lastBackendError = "";
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

          const newestMessage = adapter.findNewestAssistantMessageAfter(previousMessages, trackedMessage);

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

          if (!nextText || isLowConfidenceDomResponse(nextText, promptText)) {
            const textBearingMessage = adapter.findNewestTextBearingAssistantMessageAfter(previousMessages, trackedMessage);

            if (textBearingMessage && textBearingMessage !== trackedMessage) {
              trackedMessage = textBearingMessage;
              nextText = normalizeText(adapter.extractAssistantText(trackedMessage));
              nextHtml = adapter.extractAssistantHtml(trackedMessage);
            }
          }

          const capturedResponse = getLatestNetworkCapturedAssistantResponse(requestId, {
            afterMs: startedAt - 1000
          });

          if (capturedResponse?.text && shouldPreferBackendResponse(capturedResponse.text, nextText, promptText)) {
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
                afterMs: startedAt - 10000
              });

              if (backendResponse?.text && shouldPreferBackendResponse(backendResponse.text, nextText, promptText)) {
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

          const stable = Boolean(latestText) && Date.now() - lastTextChangeAt >= STREAM_STABILITY_MS;
          const hasStopped = !adapter.findStopButton();
          const sendReady = Boolean(adapter.findSendButton());
          const composerReady = adapter.isComposerIdle();
          const minimumResponseAgeMet = firstTextAt && Date.now() - firstTextAt >= 900;

          // In ChatGPT's current UI, an empty composer often shows dictation/voice
          // controls instead of a visible send button. Requiring sendReady made
          // hidden/offscreen runs stream text forever until the hard timeout even
          // after the model had finished. Treat an idle composer as an equivalent
          // completion signal once the assistant text has stabilized and no stop
          // control is visible.
          const lowConfidenceCompletion = isLowConfidenceDomResponse(latestText, promptText)
            && responseSource !== "backend-api"
            && responseSource !== "network-stream";
          const backendFinished = (responseSource === "backend-api" || responseSource === "network-stream") && isFinishedBackendStatus(backendStatus);

          if (stable && hasStopped && (sendReady || composerReady || backendFinished) && minimumResponseAgeMet && !lowConfidenceCompletion) {
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
