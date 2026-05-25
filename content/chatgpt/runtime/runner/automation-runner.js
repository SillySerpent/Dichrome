(() => {
  const relay = globalThis.ChatGptRelay = globalThis.ChatGptRelay || {};
  const runtime = relay.runtime = relay.runtime || {};

  function createRunner({
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
  }) {
    async function runAutomation(request, run) {
      if (!request?.id || typeof request.prompt !== "string") {
        throw new Error("Invalid automation request.");
      }

      const adapter = new ChatGptDomAdapter(request.adapterHints || []);

      emitDebug(request.id, "run-start", collectRuntimeDebug({
        activeRun: run
      }));

      emitState(request.id, REQUEST_STATES.CHATGPT_TAB_READY, {
        detail: "Hidden ChatGPT workspace script is ready."
      });

      await adapter.waitForAppShell(run);
      adapter.closeOpenMenu();
      await sleep(100);

      emitState(request.id, REQUEST_STATES.CHATGPT_TAB_READY, {
        detail: `ChatGPT page visibility: ${document.visibilityState}; focused: ${document.hasFocus() ? "yes" : "no"}.`
      });
      emitDebug(request.id, "app-shell-ready", collectRuntimeDebug({
        activeRun: run
      }));
      await assertExpectedVisiblePage(request, run, "app-shell-ready");

      const blockingUi = adapter.detectBlockingUi();

      if (blockingUi) {
        throw new DomAdapterError(blockingUi, adapter.collectSnapshot());
      }

      await adapter.ensureProjectContext(request.chatOptions?.project, request.id, run);
      assertNotCancelled(run);

      await adapter.ensureFreshConversation(request.chatOptions?.conversation, request.chatOptions?.project, request.id, run);
      assertNotCancelled(run);

      await adapter.ensureModelSelection(request.chatOptions?.model, request.id, run);
      assertNotCancelled(run);

      await adapter.attachFiles(request.attachments || [], request.id, run);
      assertNotCancelled(run);

      const composer = await waitFor(
        () => adapter.findComposer(),
        WAIT_TIMEOUTS.composerMs,
        run,
        "Timed out waiting for the ChatGPT composer."
      );

      await adapter.insertPrompt(composer, request.prompt);
      assertNotCancelled(run);

      emitDebug(request.id, "prompt-inserted", {
        composer: describeElementForDebug(composer),
        promptLength: request.prompt.length
      });

      emitState(request.id, REQUEST_STATES.PROMPT_INSERTED, {
        detail: "Prompt inserted into ChatGPT composer."
      });

      const previousMessages = adapter.findAssistantMessages();
      const previousAssistantBaseline = adapter.createAssistantMessageBaseline(previousMessages);
      resetNetworkCaptureForRequest(request.id);
      const sendButton = await waitFor(
        () => adapter.findSendButton(),
        WAIT_TIMEOUTS.sendButtonMs,
        run,
        "Timed out waiting for an enabled send button."
      );

      const promptSentAt = Date.now();
      // The send control is a plain composer submit action; activate it with one
      // click only so a prompt cannot be submitted twice before the UI rerenders.
      if (typeof sendButton.click === "function") {
        sendButton.click();
      } else {
        clickElement(sendButton);
      }
      emitDebug(request.id, "send-clicked", {
        sendButton: describeElementForDebug(sendButton),
        previousAssistantMessages: previousMessages.length,
        previousAssistantMessageIds: previousAssistantBaseline.messageIds.length,
        previousAssistantTextFingerprints: previousAssistantBaseline.textFingerprints.length
      });
      emitState(request.id, REQUEST_STATES.PROMPT_SENT, {
        detail: "Prompt sent through ChatGPT UI."
      });
      await assertExpectedVisiblePage(request, run, "prompt-sent");
      emitState(request.id, REQUEST_STATES.WAITING_FOR_ASSISTANT_MESSAGE, {
        detail: "Waiting for the newest assistant message."
      });

      let firstEmptyAssistantMessageAt = 0;
      const assistantMessage = await waitFor(
        () => {
          const textBearingMessage = adapter.findNewestTextBearingAssistantMessageAfter(previousAssistantBaseline);

          if (textBearingMessage) {
            return textBearingMessage;
          }

          const emptyMessage = adapter.findNewestAssistantMessageAfter(previousAssistantBaseline);

          if (emptyMessage) {
            firstEmptyAssistantMessageAt = firstEmptyAssistantMessageAt || Date.now();

            // ChatGPT often mounts an empty assistant container before streaming
            // actual text. Prefer a text-bearing node when it appears quickly;
            // otherwise fall back to the empty container so the observer can keep
            // polling the DOM/network/backend API instead of failing early.
            if (Date.now() - firstEmptyAssistantMessageAt >= 3500) {
              return emptyMessage;
            }
          }

          return null;
        },
        WAIT_TIMEOUTS.assistantMs,
        run,
        "Timed out waiting for a new assistant response."
      );
      emitDebug(request.id, "assistant-message-found", {
        message: describeElementForDebug(assistantMessage),
        textLength: normalizeText(adapter.extractAssistantText(assistantMessage)).length,
        waitedForTextBearingMessage: Boolean(firstEmptyAssistantMessageAt)
      });
      await assertExpectedVisiblePage(request, run, "assistant-message-found");

      await observeAssistantResponse({
        requestId: request.id,
        visibilityMode: getAutomationVisibilityMode(request),
        adapter,
        messageElement: assistantMessage,
        previousMessages: previousAssistantBaseline,
        responseAfterMs: promptSentAt - 500,
        promptText: request.prompt,
        run
      });
    }

    return Object.freeze({
      runAutomation
    });
  }

  runtime.automationRunner = Object.freeze({
    createRunner
  });
})();
