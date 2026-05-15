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
        detail: "ChatGPT tab automation script is ready."
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
      resetNetworkCaptureForRequest(request.id);
      const sendButton = await waitFor(
        () => adapter.findSendButton(),
        WAIT_TIMEOUTS.sendButtonMs,
        run,
        "Timed out waiting for an enabled send button."
      );

      clickElement(sendButton);
      emitDebug(request.id, "send-clicked", {
        sendButton: describeElementForDebug(sendButton),
        previousAssistantMessages: previousMessages.length
      });
      emitState(request.id, REQUEST_STATES.PROMPT_SENT, {
        detail: "Prompt sent through ChatGPT UI."
      });
      await assertExpectedVisiblePage(request, run, "prompt-sent");
      emitState(request.id, REQUEST_STATES.WAITING_FOR_ASSISTANT_MESSAGE, {
        detail: "Waiting for the newest assistant message."
      });

      const assistantMessage = await waitFor(
        () => adapter.findNewestAssistantMessageAfter(previousMessages),
        WAIT_TIMEOUTS.assistantMs,
        run,
        "Timed out waiting for a new assistant response."
      );
      emitDebug(request.id, "assistant-message-found", {
        message: describeElementForDebug(assistantMessage),
        textLength: normalizeText(adapter.extractAssistantText(assistantMessage)).length
      });
      await assertExpectedVisiblePage(request, run, "assistant-message-found");

      await observeAssistantResponse({
        requestId: request.id,
        visibilityMode: getAutomationVisibilityMode(request),
        adapter,
        messageElement: assistantMessage,
        previousMessages,
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
