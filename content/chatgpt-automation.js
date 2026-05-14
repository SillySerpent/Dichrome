(() => {
  if (window.__chatGptPageRelayAutomationLoaded) {
    return;
  }

  window.__chatGptPageRelayAutomationLoaded = true;

  const REQUEST_STATES = Object.freeze({
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
  const VISIBILITY_MODES = Object.freeze({
    SEAMLESS: "seamless",
    SIDECAR: "sidecar",
    FOCUSED: "focused"
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

  let activeRun = null;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== "string") {
      return false;
    }

    if (message.type === "CHATGPT_AUTOMATION_PING") {
      sendResponse({
        ok: true,
        busy: Boolean(activeRun && !activeRun.finished)
      });
      return false;
    }

    if (message.type === "CHATGPT_AUTOMATION_DUMP") {
      sendResponse({
        ok: true,
        dump: collectAutomationDebugDump()
      });
      return false;
    }

    if (message.type === "CHATGPT_AUTOMATION_CANCEL") {
      if (activeRun && activeRun.requestId === message.requestId) {
        activeRun.cancelled = true;
      }

      sendResponse({
        ok: true
      });
      return false;
    }

    if (message.type === "CHATGPT_AUTOMATION_RUN") {
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

      runAutomation(message.request, activeRun)
        .catch((error) => emitError(message.request?.id, error))
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

    return false;
  });

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
      run
    });
  }

  async function observeAssistantResponse({ requestId, visibilityMode, adapter, messageElement, run }) {
    let trackedMessage = messageElement;
    let latestText = "";
    let latestHtml = "";
    let firstTextAt = 0;
    let lastTextChangeAt = Date.now();
    let lastEmitAt = 0;
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

        const newestMessage = adapter.findNewestAssistantMessageAfter([], trackedMessage);

        if (newestMessage) {
          trackedMessage = newestMessage;
        }

        const errorText = adapter.findErrorText();

        if (errorText) {
          throw new DomAdapterError(errorText, adapter.collectSnapshot());
        }

        const nextText = normalizeText(adapter.extractAssistantText(trackedMessage));
        const nextHtml = adapter.extractAssistantHtml(trackedMessage);

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
              detail: "Assistant response updated."
            });
          }
        }

        const stable = Boolean(latestText) && Date.now() - lastTextChangeAt >= STREAM_STABILITY_MS;
        const hasStopped = !adapter.findStopButton();
        const sendReady = Boolean(adapter.findSendButton());
        const minimumResponseAgeMet = firstTextAt && Date.now() - firstTextAt >= 900;

        if (stable && hasStopped && sendReady && minimumResponseAgeMet) {
          emitState(requestId, REQUEST_STATES.RESPONSE_COMPLETE, {
            text: latestText,
            html: latestHtml,
            detail: "Assistant response complete."
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

  class ChatGptDomAdapter {
    constructor(adapterHints) {
      this.adapterHints = normalizeAdapterHints(adapterHints);
    }

    async waitForAppShell(run) {
      await waitFor(
        () => this.findComposer() || this.findSidebar() || this.findProjectCreateButton() || findVisible(queryAllSafe("main")),
        30000,
        run,
        "Timed out waiting for the ChatGPT app shell to finish loading."
      );
    }

    async ensureProjectContext(projectOptions, requestId, run) {
      const project = normalizeProjectOptions(projectOptions);

      if (!project.enabled || !project.name) {
        return;
      }

      await this.ensureSidebarOpen();

      if (this.hasProjectContext(project.name)) {
        emitState(requestId, REQUEST_STATES.PROJECT_READY, {
          detail: `Already routed to project: ${project.name}`
        });
        return;
      }

      const existingProject = await waitForOptional(
        () => this.findProjectNavigationItem(project.name),
        3500,
        run
      );

      if (existingProject) {
        const originalUrl = location.href;
        clickProjectNavigationElement(existingProject);
        await this.waitForProjectContext(project.name, originalUrl, run);
        emitState(requestId, REQUEST_STATES.PROJECT_READY, {
          detail: `Routed to existing project: ${project.name}`
        });
        return;
      }

      if (!project.createIfMissing) {
        throw new DomAdapterError(`ChatGPT project was not found: ${project.name}`, this.collectSnapshot());
      }

      await this.createProject(project.name, requestId, run);
    }

    async createProject(projectName, requestId, run) {
      const createButton = this.findProjectCreateButton();

      if (!createButton) {
        throw new DomAdapterError("Could not find ChatGPT's New project control.", this.collectSnapshot());
      }

      clickElement(createButton);

      const dialog = await waitFor(
        () => this.findVisibleDialog(),
        10000,
        run,
        "Timed out waiting for the ChatGPT project creation dialog."
      );
      const nameInput = await waitFor(
        () => this.findProjectNameInput(dialog),
        10000,
        run,
        "Timed out waiting for the ChatGPT project name input."
      );

      await setEditableText(nameInput, projectName);

      const submitButton = await waitFor(
        () => this.findDialogAction(dialog, /create|continue|done|save/i),
        10000,
        run,
        "Timed out waiting for the ChatGPT project creation button."
      );
      const originalUrl = location.href;

      clickElement(submitButton);

      try {
        await this.waitForProjectContext(projectName, originalUrl, run);
      } catch (_error) {
        const createdProject = this.findProjectNavigationItem(projectName);

        if (!createdProject) {
          throw new DomAdapterError(`Project was created or submitted, but ChatGPT did not expose project context for: ${projectName}`, this.collectSnapshot());
        }

        clickProjectNavigationElement(createdProject);
        await this.waitForProjectContext(projectName, location.href, run);
      }

      emitState(requestId, REQUEST_STATES.PROJECT_READY, {
        detail: `Created and routed to project: ${projectName}`
      });
    }

    async ensureFreshConversation(conversationOptions, projectOptions, requestId, run) {
      const conversation = normalizeConversationOptions(conversationOptions);

      if (!conversation.startNewChat) {
        emitState(requestId, REQUEST_STATES.CONVERSATION_READY, {
          detail: "Continuing the current ChatGPT conversation."
        });
        return;
      }

      if (!this.hasExistingConversation()) {
        emitState(requestId, REQUEST_STATES.CONVERSATION_READY, {
          detail: "Starting from a fresh ChatGPT composer."
        });
        return;
      }

      const newChatButton = this.findNewChatButton();

      if (!newChatButton) {
        throw new DomAdapterError("Could not find ChatGPT's New chat control before sending a fresh request.", this.collectSnapshot());
      }

      const originalUrl = location.href;
      clickElement(newChatButton);

      await waitFor(
        () => !this.hasExistingConversation() || location.href !== originalUrl,
        12000,
        run,
        "Timed out waiting for a fresh ChatGPT conversation."
      );

      const project = normalizeProjectOptions(projectOptions);

      if (project.enabled && project.name && !this.hasProjectContext(project.name)) {
        await this.ensureProjectContext(project, requestId, run);
      }

      emitState(requestId, REQUEST_STATES.CONVERSATION_READY, {
        detail: "Started a fresh ChatGPT conversation."
      });
    }

    async ensureModelSelection(modelOptions, requestId, run) {
      const model = normalizeModelOptions(modelOptions);

      if (!model.enabled || !model.label) {
        return;
      }

      const picker = this.findModelPickerButton();

      if (!picker) {
        this.handleModelSelectionIssue(requestId, model, `Could not find ChatGPT's model picker for requested model: ${model.label}`);
        return;
      }

      if (elementMatchesText(picker, model.label)) {
        emitState(requestId, REQUEST_STATES.MODEL_SELECTED, {
          detail: `Model already selected: ${model.label}`
        });
        return;
      }

      clickElement(picker);

      let option = null;

      try {
        option = await waitFor(
          () => this.findModelOption(model.label),
          8000,
          run,
          `Timed out waiting for model option: ${model.label}`
        );
      } catch (_error) {
        this.closeOpenMenu();
        this.handleModelSelectionIssue(requestId, model, `Requested model was not visible in the picker: ${model.label}`);
        return;
      }

      clickElement(option);
      await sleep(600);

      const selectedPicker = this.findModelPickerButton();

      if (selectedPicker && !elementMatchesText(selectedPicker, model.label)) {
        this.handleModelSelectionIssue(requestId, model, `Clicked model option, but the visible picker did not confirm: ${model.label}`);
        return;
      }

      emitState(requestId, REQUEST_STATES.MODEL_SELECTED, {
        detail: `Selected model: ${model.label}`
      });
    }

    detectBlockingUi() {
      const composer = this.findComposer();

      if (composer) {
        return "";
      }

      const bodyText = normalizeText(document.body?.innerText || "").toLowerCase();
      const path = location.pathname.toLowerCase();
      const hasLoginCopy = /\blog in\b|\bsign in\b/.test(bodyText) && /\bsign up\b|\bcreate account\b/.test(bodyText);

      if (path.includes("auth") || hasLoginCopy) {
        return "ChatGPT appears to be on a login or account gate. Open the ChatGPT tab and sign in before retrying.";
      }

      const visibleDialog = findVisible(Array.from(document.querySelectorAll('[role="dialog"], dialog')));

      if (visibleDialog) {
        const dialogText = normalizeText(visibleDialog.innerText || visibleDialog.textContent || "");

        if (dialogText && !/new chat|temporary chat/i.test(dialogText)) {
          return `ChatGPT is blocked by a modal dialog: ${dialogText.slice(0, 180)}`;
        }
      }

      return "";
    }

    findComposer() {
      const hinted = this.findByHints("composer", (element) => this.isComposerCandidate(element));

      if (hinted) {
        return hinted;
      }

      const selectors = [
        'textarea[placeholder*="Message" i]',
        'textarea[aria-label*="Message" i]',
        '[contenteditable="true"][role="textbox"]',
        '[contenteditable="true"][aria-label*="Message" i]',
        '[role="textbox"][contenteditable="true"]',
        'form [contenteditable="true"]',
        'main [contenteditable="true"]'
      ];

      for (const selector of selectors) {
        const candidate = findVisible(queryAllSafe(selector).filter((element) => this.isComposerCandidate(element)));

        if (candidate) {
          return candidate;
        }
      }

      const textboxes = queryAllSafe('[role="textbox"], textarea, [contenteditable="true"]');

      return findVisible(textboxes.filter((element) => this.isComposerCandidate(element)));
    }

    async insertPrompt(composer, prompt) {
      await setEditableText(composer, prompt);
    }

    async attachFiles(attachments, requestId, run) {
      const imageAttachments = attachments.filter((attachment) => attachment?.kind === "image" && attachment.dataUrl);

      if (!imageAttachments.length) {
        return;
      }

      const input = await waitFor(
        () => this.findFileInput(),
        6000,
        run,
        "Timed out waiting for a ChatGPT file input for screenshot attachment."
      );
      const transfer = new DataTransfer();

      for (const attachment of imageAttachments) {
        const file = await dataUrlToFile(attachment.dataUrl, attachment.name || "screenshot.png", attachment.mimeType || "image/png");
        transfer.items.add(file);
      }

      input.files = transfer.files;
      input.dispatchEvent(new Event("input", {
        bubbles: true
      }));
      input.dispatchEvent(new Event("change", {
        bubbles: true
      }));

      emitState(requestId, REQUEST_STATES.CHATGPT_TAB_READY, {
        detail: `Attached ${imageAttachments.length} image file(s).`
      });

      await sleep(900);
    }

    findFileInput() {
      const hinted = this.findByHints("fileInput", (element) => this.isFileInputCandidate(element));

      if (hinted) {
        return hinted;
      }

      const inputs = Array.from(document.querySelectorAll('input[type="file"]'));

      return inputs.find((input) => this.isFileInputCandidate(input)) || null;
    }

    async ensureSidebarOpen() {
      if (this.findSidebar()) {
        return;
      }

      const toggle = findVisible(queryAllSafe('button, [role="button"]')
        .filter((element) => {
          const label = getElementLabel(element).toLowerCase();

          return /open sidebar|show sidebar|sidebar/.test(label) && !/close|hide/.test(label);
        }));

      if (toggle) {
        clickElement(toggle);
        await sleep(350);
      }
    }

    findSidebar() {
      return findVisible(queryAllSafe('aside, nav[aria-label*="sidebar" i], [data-testid*="sidebar" i], [aria-label*="chat history" i]')
        .filter((element) => {
          const text = getElementLabel(element).toLowerCase();

          return /project|chat|history/.test(text);
        }));
    }

    hasProjectContext(projectName) {
      return Boolean(this.findCurrentProjectIndicator(projectName));
    }

    findCurrentProjectIndicator(projectName) {
      const exactHeading = findVisible(queryAllSafe('main h1, main h2, [aria-current="page"], [data-current="true"]')
        .filter((element) => textMatchesName(getElementLabel(element), projectName)));

      if (exactHeading) {
        return exactHeading;
      }

      const pathLooksProjectScoped = /\/project|\/projects/.test(location.pathname.toLowerCase())
        || /project/.test(location.search.toLowerCase());

      if (!pathLooksProjectScoped) {
        return null;
      }

      const bodyText = normalizeComparableText(document.body?.innerText || document.body?.textContent || "");

      return bodyText.includes(normalizeComparableText(projectName)) ? document.body : null;
    }

    hasExistingConversation() {
      if (/\/c\//.test(location.pathname)) {
        return true;
      }

      return queryAllSafe('[data-message-author-role], main article, main [data-message-id]')
        .some((element) => isVisible(element) && normalizeText(element.innerText || element.textContent || ""));
    }

    findNewChatButton() {
      const candidates = queryAllSafe('a, button, [role="button"], [role="link"]')
        .filter((element) => isVisible(element) && !isDisabled(element))
        .map((element) => ({
          element,
          label: normalizeComparableText(getElementLabel(element))
        }))
        .filter(({ label }) => label === "new chat" || label.startsWith("new chat "))
        .sort((a, b) => scoreNewChatCandidate(b.element) - scoreNewChatCandidate(a.element));

      return candidates[0]?.element || null;
    }

    findProjectNavigationItem(projectName) {
      const hinted = this.findByHints(
        "projectNavigationItem",
        (element) => isProjectNavigationTarget(element, projectName)
      );

      if (hinted) {
        return hinted;
      }

      const root = this.findSidebar() || document.body;
      const candidates = queryAllWithin(root, 'a[href], [role="link"], [role="treeitem"], [aria-current], button')
        .filter((element) => isProjectNavigationTarget(element, projectName))
        .map((element) => ({
          element,
          score: scoreProjectCandidate(element, projectName)
        }))
        .filter((candidate) => candidate.score >= 80)
        .sort((a, b) => b.score - a.score);

      return candidates[0]?.element || null;
    }

    findSelectedProjectNavigationItem(projectName) {
      const projectItem = this.findProjectNavigationItem(projectName);

      if (projectItem && isSelectedNavigationElement(projectItem)) {
        return projectItem;
      }

      return null;
    }

    findProjectCreateButton() {
      const hinted = this.findByHints(
        "projectCreateButton",
        (element) => isVisible(element) && !isDisabled(element) && /new project|create project|add project/.test(getElementLabel(element).toLowerCase())
      );

      if (hinted) {
        return hinted;
      }

      const roots = uniqueElements([this.findSidebar(), document.body]);
      const candidates = roots.flatMap((root) => queryAllWithin(root, 'button, a, [role="button"], [role="menuitem"]'))
        .filter((element) => isVisible(element) && !isDisabled(element))
        .map((element) => ({
          element,
          label: getElementLabel(element).toLowerCase()
        }))
        .filter(({ label }) => /new project|create project|add project/.test(label))
        .sort((a, b) => scoreCreateProjectLabel(b.label) - scoreCreateProjectLabel(a.label));

      return candidates[0]?.element || null;
    }

    findVisibleDialog() {
      return findVisible(queryAllSafe('[role="dialog"], dialog'));
    }

    findProjectNameInput(dialog) {
      if (!dialog) {
        return null;
      }

      const hinted = this.findByHints(
        "projectNameInput",
        (element) => dialog.contains(element) && isVisible(element) && !isDisabled(element) && (isTextInput(element) || element.getAttribute("role") === "textbox" || element.isContentEditable)
      );

      if (hinted) {
        return hinted;
      }

      const inputs = queryAllWithin(dialog, 'input:not([type]), input[type="text"], textarea, [contenteditable="true"], [role="textbox"]')
        .filter((element) => isVisible(element) && !isDisabled(element));
      const preferred = inputs.find((element) => /project|name/.test(getElementLabel(element).toLowerCase()));

      return preferred || inputs[0] || null;
    }

    findDialogAction(dialog, labelPattern) {
      if (!dialog) {
        return null;
      }

      const actions = queryAllWithin(dialog, 'button, [role="button"], input[type="submit"]')
        .filter((element) => isVisible(element) && !isDisabled(element))
        .filter((element) => {
          const label = getElementLabel(element);

          return labelPattern.test(label) && !/cancel|back|close/i.test(label);
        });

      return actions[0] || null;
    }

    async waitForProjectContext(projectName, originalUrl, run) {
      await waitFor(
        () => {
          if (this.hasProjectContext(projectName)) {
            return true;
          }

          if (this.findSelectedProjectNavigationItem(projectName) && this.findComposer()) {
            return true;
          }

          return location.href !== originalUrl && this.findCurrentProjectIndicator(projectName);
        },
        18000,
        run,
        `Timed out waiting for ChatGPT project context: ${projectName}`
      );

      await sleep(400);
    }

    findModelPickerButton() {
      const hinted = this.findByHints(
        "modelPicker",
        (element) => isVisible(element) && !isDisabled(element) && scoreModelPickerCandidate(element) > 0
      );

      if (hinted) {
        return hinted;
      }

      const candidates = queryAllSafe('header button, main button, button[aria-label*="model" i], button, [role="button"]')
        .filter((element) => isVisible(element) && !isDisabled(element))
        .map((element) => ({
          element,
          score: scoreModelPickerCandidate(element)
        }))
        .filter((candidate) => candidate.score > 0)
        .sort((a, b) => b.score - a.score);

      return candidates[0]?.element || null;
    }

    findModelOption(modelLabel) {
      const hinted = this.findByHints(
        "modelOption",
        (element) => isVisible(element) && !isDisabled(element) && scoreModelOptionCandidate(element, modelLabel) > 0
      );

      if (hinted) {
        return hinted;
      }

      const popupRoots = queryAllSafe('[role="menu"], [role="listbox"], [role="dialog"], [data-radix-popper-content-wrapper], [popover]')
        .filter(isVisible);
      const searchRoots = popupRoots.length ? popupRoots : [document.body];
      const candidates = searchRoots.flatMap((root) => queryAllWithin(root, 'button, [role="option"], [role="menuitem"], [cmdk-item], [data-testid], div'))
        .filter((element) => isVisible(element) && !isDisabled(element))
        .map((element) => ({
          element,
          score: scoreModelOptionCandidate(element, modelLabel)
        }))
        .filter((candidate) => candidate.score > 0)
        .sort((a, b) => b.score - a.score);

      return candidates[0]?.element || null;
    }

    handleModelSelectionIssue(requestId, model, message) {
      if (model.requireExact) {
        throw new DomAdapterError(message, this.collectSnapshot());
      }

      emitState(requestId, REQUEST_STATES.CHATGPT_TAB_READY, {
        detail: `${message}. Continuing with the current ChatGPT model.`
      });
    }

    closeOpenMenu() {
      document.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
        cancelable: true
      }));
    }

    findSendButton() {
      const hinted = this.findByHints("sendButton", (element) => this.isSendButtonCandidate(element));

      if (hinted) {
        return hinted;
      }

      const buttons = queryAllSafe('button, [role="button"], input[type="submit"]');
      const scopedButtons = prioritizeComposerButtons(buttons, this.findComposer());

      return findVisible(scopedButtons.filter((element) => this.isSendButtonCandidate(element)));
    }

    findStopButton() {
      const hinted = this.findByHints("stopButton", (element) => this.isStopButtonCandidate(element));

      if (hinted) {
        return hinted;
      }

      const buttons = queryAllSafe('button, [role="button"]');

      return findVisible(buttons.filter((element) => this.isStopButtonCandidate(element)));
    }

    findAssistantMessages() {
      const hinted = this.findAllByHints("assistantMessage", (element) => this.isHintedAssistantMessageCandidate(element));
      const explicit = [
        ...hinted,
        ...queryAllSafe('[data-message-author-role="assistant"]'),
        ...queryAllSafe('main [data-message-author-role="assistant"]'),
        ...queryAllSafe('main article[aria-label*="assistant" i]'),
        ...queryAllSafe('main [role="article"][aria-label*="assistant" i]')
      ];
      const explicitVisible = uniqueElements(explicit)
        .filter((element) => this.isAssistantMessageCandidate(element))
        .filter(isVisible);

      if (explicitVisible.length) {
        return explicitVisible;
      }

      const markdownContainers = queryAllSafe('main [class*="markdown"], main [data-message-id]');

      return uniqueElements(markdownContainers)
        .map((element) => closestMessageContainer(element) || element)
        .filter((element) => this.isAssistantMessageCandidate(element))
        .filter(isVisible);
    }

    findNewestAssistantMessageAfter(previousMessages, fallbackMessage) {
      const previousSet = new Set(previousMessages || []);
      const messages = this.findAssistantMessages();
      const newMessages = messages.filter((message) => !previousSet.has(message));

      if (newMessages.length) {
        return newMessages[newMessages.length - 1];
      }

      if (fallbackMessage && messages.includes(fallbackMessage)) {
        return fallbackMessage;
      }

      return null;
    }

    extractAssistantText(messageElement) {
      if (!messageElement) {
        return "";
      }

      const nestedMarkdown = messageElement.querySelector('[data-message-author-role="assistant"] .markdown, .markdown, [data-testid*="markdown" i]');
      const preferred = messageElement.matches?.(".markdown")
        ? messageElement
        : nestedMarkdown;
      const source = preferred || messageElement;
      const clone = source.cloneNode(true);

      for (const element of clone.querySelectorAll('button, svg, nav, menu, script, style, [aria-hidden="true"], [data-testid*="copy" i]')) {
        element.remove();
      }

      return normalizeText(clone.innerText || clone.textContent || "");
    }

    extractAssistantHtml(messageElement) {
      if (!messageElement) {
        return "";
      }

      const nestedMarkdown = messageElement.querySelector('[data-message-author-role="assistant"] .markdown, .markdown, [data-testid*="markdown" i]');
      const preferred = messageElement.matches?.(".markdown")
        ? messageElement
        : nestedMarkdown;
      const source = preferred || messageElement;
      const clone = source.cloneNode(true);

      for (const element of clone.querySelectorAll('button, svg, nav, menu, script, style, iframe, object, embed, form, input, textarea, select, [aria-hidden="true"], [data-testid*="copy" i]')) {
        element.remove();
      }

      sanitizeElementTree(clone);

      return clone.innerHTML || escapeHtml(normalizeText(clone.textContent || ""));
    }

    findErrorText() {
      const bodyText = normalizeText(document.body?.innerText || "");
      const errorPatterns = [
        /something went wrong/i,
        /there was an error generating/i,
        /failed to generate/i,
        /network error/i,
        /unusual activity/i
      ];

      for (const pattern of errorPatterns) {
        const match = bodyText.match(pattern);

        if (match) {
          return `ChatGPT reported an error: ${match[0]}`;
        }
      }

      return "";
    }

    collectSnapshot() {
      return {
        url: location.href,
        title: document.title,
        collectedAt: new Date().toISOString(),
        candidates: {
          inputs: collectCandidates(
            queryAllSafe('textarea, input[type="text"], input[type="search"], [contenteditable="true"], [role="textbox"]'),
            SNAPSHOT_LIMITS.inputs
          ),
          buttons: collectCandidates(
            queryAllSafe('button, [role="button"], input[type="submit"], input[type="file"]'),
            SNAPSHOT_LIMITS.buttons
          ),
          messages: collectCandidates(
            queryAllSafe('main [data-message-author-role], main [data-message-id], main article, main [role="article"], main [class*="markdown"]'),
            SNAPSHOT_LIMITS.messages
          )
        }
      };
    }

    findByHints(target, predicate) {
      return this.findAllByHints(target, predicate)[0] || null;
    }

    findAllByHints(target, predicate) {
      const hints = this.adapterHints
        .filter((hint) => hint.target === target)
        .sort((a, b) => b.confidence - a.confidence);
      const matches = [];

      for (const hint of hints) {
        for (const element of resolveHintElements(hint)) {
          if (predicate(element)) {
            matches.push(element);
          }
        }
      }

      return uniqueElements(matches);
    }

    isComposerCandidate(element) {
      if (!element || !isVisible(element) || isDisabled(element)) {
        return false;
      }

      const editable = element.isContentEditable || element.getAttribute("contenteditable") === "true";

      if (!isTextInput(element) && !editable && element.getAttribute("role") !== "textbox") {
        return false;
      }

      const label = getElementLabel(element).toLowerCase();
      const insideMain = Boolean(element.closest("main, form"));
      const looksLikeComposer = /message|prompt|ask|chat|send/i.test(label)
        || element.tagName === "TEXTAREA"
        || editable;

      return insideMain && looksLikeComposer;
    }

    isSendButtonCandidate(element) {
      if (!element || !isVisible(element) || isDisabled(element)) {
        return false;
      }

      const label = getElementLabel(element).toLowerCase();
      const buttonLike = element.matches?.('button, [role="button"], input[type="submit"]');
      const sendLike = /send/.test(label)
        || /send-button|composer-submit|submit/i.test(element.getAttribute("data-testid") || "");
      const stopLike = /stop|cancel|interrupt/.test(label);

      return Boolean(buttonLike && sendLike && !stopLike);
    }

    isStopButtonCandidate(element) {
      if (!element || !isVisible(element) || isDisabled(element)) {
        return false;
      }

      const label = getElementLabel(element).toLowerCase();

      return /stop|stop generating|cancel response|interrupt/.test(label);
    }

    isFileInputCandidate(element) {
      if (!element || element.tagName !== "INPUT" || element.type !== "file" || isDisabled(element)) {
        return false;
      }

      const accept = String(element.accept || "").toLowerCase();

      return !accept || accept.includes("image") || accept.includes("png") || accept.includes("*/*");
    }

    isAssistantMessageCandidate(element) {
      if (!element || !isVisible(element)) {
        return false;
      }

      if (element.getAttribute("data-message-author-role") === "assistant") {
        return true;
      }

      const closestExplicit = element.closest?.('[data-message-author-role="assistant"]');

      if (closestExplicit) {
        return true;
      }

      const label = getElementLabel(element).toLowerCase();

      if (/assistant|chatgpt|chat gpt/.test(label)) {
        return true;
      }

      const role = element.getAttribute("role");
      const insideConversation = Boolean(element.closest("main"));
      const hasMessageStructure = Boolean(element.matches('article, [role="article"], [data-message-id]') || element.querySelector(".markdown"));

      return insideConversation && hasMessageStructure && /assistant|chatgpt|chat gpt/.test(normalizeText(element.textContent || "").slice(0, 300).toLowerCase());
    }

    isHintedAssistantMessageCandidate(element) {
      if (!element || !isVisible(element) || !element.closest("main") || element.closest("form")) {
        return false;
      }

      return Boolean(
        element.matches?.('[data-message-author-role], [data-message-id], article, [role="article"], .markdown')
        || element.querySelector?.('[data-message-author-role], [data-message-id], .markdown')
      );
    }
  }

  class DomAdapterError extends Error {
    constructor(message, snapshot) {
      super(message);
      this.name = "DomAdapterError";
      this.snapshot = snapshot;
    }
  }

  class VisibilityStateError extends Error {
    constructor(message) {
      super(message);
      this.name = "VisibilityStateError";
      this.suppressDomSnapshot = true;
    }
  }

  async function assertExpectedVisiblePage(request, run, stage) {
    const mode = getAutomationVisibilityMode(request);

    if (!requiresEmulatedVisibility(mode)) {
      return;
    }

    if (document.visibilityState === "visible") {
      return;
    }

    const becameVisible = await waitForOptional(
      () => document.visibilityState === "visible",
      2500,
      run
    );

    if (becameVisible) {
      return;
    }

    emitDebug(request.id, `${stage}-visibility-hidden`, {
      visibilityMode: mode,
      runtime: collectRuntimeDebug({
        activeRun: run
      })
    });

    throw new VisibilityStateError(
      `ChatGPT stayed hidden during ${stage}. Seamless streaming requires Chrome debugger focus emulation; close DevTools for the ChatGPT tab and retry, or switch routing mode to Focus ChatGPT.`
    );
  }

  function getAutomationVisibilityMode(request) {
    const mode = request?.chatOptions?.visibility?.mode;

    if (mode === VISIBILITY_MODES.SIDECAR || mode === VISIBILITY_MODES.FOCUSED || mode === VISIBILITY_MODES.SEAMLESS) {
      return mode;
    }

    return VISIBILITY_MODES.SEAMLESS;
  }

  function requiresEmulatedVisibility(mode) {
    return mode === VISIBILITY_MODES.SEAMLESS || mode === VISIBILITY_MODES.SIDECAR;
  }

  function emitState(requestId, state, { text, html, detail } = {}) {
    chrome.runtime.sendMessage({
      type: "CHATGPT_AUTOMATION_EVENT",
      requestId,
      state,
      text,
      html,
      detail
    }).catch(() => null);
  }

  function emitDebug(requestId, stage, data = {}) {
    const payload = {
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
    chrome.runtime.sendMessage({
      type: "CHATGPT_AUTOMATION_DEBUG",
      ...payload
    }).catch(() => null);
  }

  function emitError(requestId, error) {
    const payload = {
      type: "CHATGPT_AUTOMATION_EVENT",
      requestId,
      state: REQUEST_STATES.ERROR_STATE,
      error: serializeError(error),
      detail: "Automation failed."
    };

    if (!error?.suppressDomSnapshot) {
      payload.domSnapshot = error?.snapshot || new ChatGptDomAdapter([]).collectSnapshot();
    }

    chrome.runtime.sendMessage(payload).catch(() => null);
  }

  function collectAutomationDebugDump() {
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

  async function waitFor(producer, timeoutMs, run, timeoutMessage) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      assertNotCancelled(run);

      const result = producer();

      if (result) {
        return result;
      }

      await sleep(150);
    }

    throw new Error(timeoutMessage);
  }

  async function waitForOptional(producer, timeoutMs, run) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      assertNotCancelled(run);

      const result = producer();

      if (result) {
        return result;
      }

      await sleep(150);
    }

    return null;
  }

  function assertNotCancelled(run) {
    if (run?.cancelled) {
      throw new Error("Automation cancelled.");
    }
  }

  function clickElement(element) {
    element.focus?.();
    element.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      view: window
    }));
    element.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true,
      cancelable: true,
      view: window
    }));
    element.click();
  }

  function clickProjectNavigationElement(element) {
    const target = resolveProjectNavigationClickTarget(element);
    const rect = target.getBoundingClientRect();
    const clientX = Math.round(rect.left + Math.min(32, Math.max(8, rect.width * 0.25)));
    const clientY = Math.round(rect.top + rect.height / 2);

    target.focus?.();

    for (const type of ["mousedown", "mouseup", "click"]) {
      target.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX,
        clientY
      }));
    }
  }

  function resolveProjectNavigationClickTarget(element) {
    if (!element) {
      return element;
    }

    if (isProjectOverflowControl(element)) {
      return element;
    }

    const nestedLink = queryAllWithin(element, 'a[href], [role="link"], [role="treeitem"]')
      .find((candidate) => candidate !== element && isVisible(candidate) && !isProjectOverflowControl(candidate));

    return nestedLink || element;
  }

  function dispatchInputEvents(element) {
    element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "insertText"
    }));
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText"
    }));
    element.dispatchEvent(new Event("change", {
      bubbles: true
    }));
  }

  async function setEditableText(element, text) {
    element.focus();

    if (isTextInput(element)) {
      setNativeInputValue(element, text);
      dispatchInputEvents(element);
      await sleep(50);
      element.focus();
      return;
    }

    if (element.isContentEditable || element.getAttribute("contenteditable") === "true" || element.getAttribute("role") === "textbox") {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);

      const inserted = document.execCommand("insertText", false, text);

      if (!inserted || !normalizeText(element.innerText || element.textContent).includes(text.slice(0, 40))) {
        element.textContent = text;
      }

      dispatchInputEvents(element);
      await sleep(75);
      element.focus();
      return;
    }

    throw new Error("Editable text target is not writable.");
  }

  function prioritizeComposerButtons(buttons, composer) {
    if (!composer) {
      return buttons;
    }

    const form = composer.closest("form");
    const scoped = form
      ? buttons.filter((button) => form.contains(button))
      : buttons.filter((button) => distanceBetweenElements(composer, button) < 420);

    return scoped.length ? scoped : buttons;
  }

  function closestMessageContainer(element) {
    return element.closest('[data-message-author-role], [data-message-id], article, [role="article"]');
  }

  function resolveHintElements(hint) {
    const elements = [];

    if (hint.selector) {
      elements.push(...queryAllSafe(hint.selector));
    }

    const semanticCandidates = queryAllSafe('textarea, input, a, [contenteditable="true"], button, [role], [aria-label], [placeholder], [data-message-author-role], [data-message-id], article');

    for (const element of semanticCandidates) {
      if (hint.role && element.getAttribute("role") !== hint.role) {
        continue;
      }

      if (hint.ariaLabelIncludes && !getElementLabel(element).toLowerCase().includes(hint.ariaLabelIncludes.toLowerCase())) {
        continue;
      }

      if (hint.placeholderIncludes && !String(element.getAttribute("placeholder") || "").toLowerCase().includes(hint.placeholderIncludes.toLowerCase())) {
        continue;
      }

      if (hint.textIncludes && !normalizeText(element.textContent || "").toLowerCase().includes(hint.textIncludes.toLowerCase())) {
        continue;
      }

      if (hint.role || hint.ariaLabelIncludes || hint.placeholderIncludes || hint.textIncludes) {
        elements.push(element);
      }
    }

    return uniqueElements(elements);
  }

  function normalizeProjectOptions(value) {
    const source = value && typeof value === "object" ? value : {};

    return {
      enabled: Boolean(source.enabled),
      name: normalizeText(source.name || "").slice(0, 80),
      createIfMissing: source.createIfMissing !== false
    };
  }

  function normalizeConversationOptions(value) {
    const source = value && typeof value === "object" ? value : {};

    return {
      startNewChat: source.startNewChat !== false
    };
  }

  function normalizeModelOptions(value) {
    const source = value && typeof value === "object" ? value : {};

    return {
      enabled: Boolean(source.enabled),
      label: normalizeText(source.label || "").slice(0, 80),
      requireExact: Boolean(source.requireExact)
    };
  }

  function scoreProjectCandidate(element, projectName) {
    if (!isProjectNavigationTarget(element, projectName)) {
      return 0;
    }

    const label = getElementLabel(element);
    const comparableLabel = normalizeComparableText(label);
    const comparableName = normalizeComparableText(projectName);

    if (!comparableName) {
      return 0;
    }

    let score = 0;

    if (comparableLabel === comparableName || comparableLabel === `${comparableName} project`) {
      score += 110;
    } else if (comparableLabel.includes(comparableName)) {
      score += 75;
    } else {
      return 0;
    }

    const href = getElementHref(element);

    if (/project/.test(href)) {
      score += 50;
    }

    const aria = normalizeComparableText(element.getAttribute("aria-label") || "");

    if (aria.includes("project")) {
      score += 30;
    }

    const sectionText = normalizeComparableText(element.closest("section, nav, aside, [role='navigation'], div")?.innerText || "");

    if (sectionText.includes("projects")) {
      score += 20;
    }

    return score;
  }

  function isProjectNavigationTarget(element, projectName) {
    if (!element || !isVisible(element) || isDisabled(element) || isProjectOverflowControl(element)) {
      return false;
    }

    if (element.closest('[role="menu"], [role="dialog"]')) {
      return false;
    }

    const comparableLabel = normalizeComparableText(getElementLabel(element));
    const comparableName = normalizeComparableText(projectName);

    if (!comparableName || !comparableLabel.includes(comparableName)) {
      return false;
    }

    const tag = element.tagName;
    const role = element.getAttribute("role") || "";

    return tag === "A"
      || role === "link"
      || role === "treeitem"
      || element.hasAttribute("aria-current")
      || (tag === "BUTTON" && !isProjectOverflowControl(element));
  }

  function isProjectOverflowControl(element) {
    const label = normalizeComparableText(getElementLabel(element));
    const ariaLabel = normalizeComparableText(element?.getAttribute?.("aria-label") || "");
    const testId = normalizeComparableText(element?.getAttribute?.("data-testid") || "");
    const title = normalizeComparableText(element?.getAttribute?.("title") || "");
    const combined = `${label} ${ariaLabel} ${testId} ${title}`;

    if (element?.getAttribute?.("aria-haspopup") && !combined.includes("project")) {
      return true;
    }

    if (/more|options|menu|overflow|ellipsis|share|rename|delete|archive/.test(combined)) {
      return true;
    }

    return label === "..." || label === "\u2026" || combined.trim() === "";
  }

  function isSelectedNavigationElement(element) {
    const selectedTarget = element.closest?.('[aria-current="page"], [aria-current="true"], [aria-selected="true"], [data-selected="true"], [data-active="true"]')
      || element.matches?.('[aria-current="page"], [aria-current="true"], [aria-selected="true"], [data-selected="true"], [data-active="true"]');

    if (selectedTarget) {
      return true;
    }

    const className = String(element.className || element.closest?.("a, button, [role='link'], [role='treeitem']")?.className || "").toLowerCase();

    return /\b(active|selected|current)\b/.test(className);
  }

  function scoreNewChatCandidate(element) {
    const href = getElementHref(element);
    let score = 0;

    if (element.closest("aside, nav")) {
      score += 30;
    }

    if (href === "/" || href.endsWith("/")) {
      score += 20;
    }

    if (element.tagName === "A") {
      score += 10;
    }

    return score;
  }

  function scoreCreateProjectLabel(label) {
    if (/^new project$|^create project$/.test(label)) {
      return 100;
    }

    if (/new project|create project/.test(label)) {
      return 80;
    }

    return /add project/.test(label) ? 60 : 0;
  }

  function scoreModelPickerCandidate(element) {
    const label = normalizeComparableText(getElementLabel(element));

    if (!label || /send|stop|attach|upload|sidebar|project|new chat/.test(label)) {
      return 0;
    }

    const rect = element.getBoundingClientRect();
    let score = 0;

    if (/model|change model|select model/.test(label)) {
      score += 100;
    }

    if (/\bgpt\b|gpt-|gpt\s|auto|instant|thinking|pro|o3|o4/.test(label)) {
      score += 60;
    }

    if (rect.top >= 0 && rect.top < 180) {
      score += 30;
    }

    if (element.closest("header")) {
      score += 20;
    }

    return score;
  }

  function scoreModelOptionCandidate(element, modelLabel) {
    if (element.tagName === "DIV" && element.querySelector('button, [role="option"], [role="menuitem"]')) {
      return 0;
    }

    const label = normalizeComparableText(getElementLabel(element));
    const target = normalizeComparableText(modelLabel);

    if (!label || !target) {
      return 0;
    }

    if (label === target) {
      return 120;
    }

    if (label.startsWith(target)) {
      return 100;
    }

    if (label.includes(target)) {
      return 80;
    }

    return 0;
  }

  function textMatchesName(value, name) {
    const comparableValue = normalizeComparableText(value);
    const comparableName = normalizeComparableText(name);

    return comparableValue === comparableName || comparableValue === `${comparableName} project`;
  }

  function elementMatchesText(element, targetText) {
    const label = normalizeComparableText(getElementLabel(element));
    const target = normalizeComparableText(targetText);

    return Boolean(target && (label === target || label.includes(target)));
  }

  function normalizeComparableText(value) {
    return normalizeText(value).toLowerCase().replace(/\s+/g, " ");
  }

  function getElementHref(element) {
    const link = element.closest?.("a[href]") || (element.matches?.("a[href]") ? element : null);

    return String(link?.getAttribute("href") || link?.href || "").toLowerCase();
  }

  function normalizeAdapterHints(value) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((hint) => hint && typeof hint === "object")
      .map((hint) => ({
        target: String(hint.target || ""),
        strategy: String(hint.strategy || ""),
        selector: typeof hint.selector === "string" ? hint.selector : "",
        role: typeof hint.role === "string" ? hint.role : "",
        ariaLabelIncludes: typeof hint.ariaLabelIncludes === "string" ? hint.ariaLabelIncludes : "",
        placeholderIncludes: typeof hint.placeholderIncludes === "string" ? hint.placeholderIncludes : "",
        textIncludes: typeof hint.textIncludes === "string" ? hint.textIncludes : "",
        confidence: Number.isFinite(Number(hint.confidence)) ? Number(hint.confidence) : 0
      }))
      .filter((hint) => hint.target && hint.confidence >= 0);
  }

  function collectCandidates(elements, limit) {
    return uniqueElements(elements)
      .filter((element) => isVisible(element) || element.matches?.('input[type="file"]'))
      .slice(0, limit)
      .map((element) => {
        const rect = element.getBoundingClientRect();

        return {
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute("role") || "",
          ariaLabel: element.getAttribute("aria-label") || "",
          title: element.getAttribute("title") || "",
          placeholder: element.getAttribute("placeholder") || "",
          type: element.getAttribute("type") || "",
          dataTestId: element.getAttribute("data-testid") || "",
          contentEditable: element.getAttribute("contenteditable") || "",
          disabled: isDisabled(element),
          visible: isVisible(element),
          selector: stableElementSelector(element),
          textSample: normalizeText(element.innerText || element.textContent || "").slice(0, 180),
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        };
      });
  }

  function describeElementForDebug(element) {
    if (!element) {
      return null;
    }

    const rect = element.getBoundingClientRect();

    return {
      tag: element.tagName?.toLowerCase() || "",
      id: element.id || "",
      role: element.getAttribute?.("role") || "",
      ariaLabel: element.getAttribute?.("aria-label") || "",
      title: element.getAttribute?.("title") || "",
      placeholder: element.getAttribute?.("placeholder") || "",
      dataTestId: element.getAttribute?.("data-testid") || "",
      contentEditable: element.getAttribute?.("contenteditable") || "",
      disabled: isDisabled(element),
      visible: isVisible(element),
      textSample: normalizeText(element.innerText || element.textContent || "").slice(0, 160),
      selector: stableElementSelector(element),
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    };
  }

  function sanitizeElementTree(root) {
    const allowedTags = new Set([
      "A",
      "B",
      "BLOCKQUOTE",
      "BR",
      "CODE",
      "DEL",
      "DIV",
      "EM",
      "H1",
      "H2",
      "H3",
      "H4",
      "H5",
      "H6",
      "HR",
      "I",
      "KBD",
      "LI",
      "OL",
      "P",
      "PRE",
      "S",
      "SPAN",
      "STRONG",
      "SUB",
      "SUP",
      "TABLE",
      "TBODY",
      "TD",
      "TH",
      "THEAD",
      "TR",
      "UL"
    ]);
    const allowedAttributes = new Set(["class", "href", "title"]);

    for (const element of Array.from(root.querySelectorAll("*"))) {
      if (!allowedTags.has(element.tagName)) {
        element.replaceWith(document.createTextNode(element.textContent || ""));
        continue;
      }

      for (const attribute of Array.from(element.attributes)) {
        if (!allowedAttributes.has(attribute.name)) {
          element.removeAttribute(attribute.name);
          continue;
        }

        if (attribute.name === "href" && !/^https?:\/\//i.test(attribute.value)) {
          element.removeAttribute(attribute.name);
        }
      }
    }
  }

  function stableElementSelector(element) {
    if (!element?.tagName) {
      return "";
    }

    const tag = element.tagName.toLowerCase();
    const dataTestId = element.getAttribute("data-testid");
    const ariaLabel = element.getAttribute("aria-label");
    const role = element.getAttribute("role");
    const authorRole = element.getAttribute("data-message-author-role");

    if (dataTestId) {
      return `${tag}[data-testid="${cssEscape(dataTestId)}"]`;
    }

    if (authorRole) {
      return `${tag}[data-message-author-role="${cssEscape(authorRole)}"]`;
    }

    if (ariaLabel) {
      return `${tag}[aria-label="${cssEscape(ariaLabel)}"]`;
    }

    if (role) {
      return `${tag}[role="${cssEscape(role)}"]`;
    }

    return tag;
  }

  function cssEscape(value) {
    if (window.CSS?.escape) {
      return CSS.escape(value);
    }

    return String(value).replace(/["\\]/g, "\\$&");
  }

  function findVisible(elements) {
    return elements.find(isVisible) || null;
  }

  function isVisible(element) {
    if (!element || !element.isConnected) {
      return false;
    }

    const style = window.getComputedStyle(element);

    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }

    const rect = element.getBoundingClientRect();

    return rect.width > 0 && rect.height > 0;
  }

  function isDisabled(element) {
    return Boolean(
      element.disabled
      || element.getAttribute("aria-disabled") === "true"
      || element.closest("[disabled], [aria-disabled='true']")
    );
  }

  function isTextInput(element) {
    const type = String(element?.getAttribute("type") || "text").toLowerCase();

    return element?.tagName === "TEXTAREA"
      || (element?.tagName === "INPUT" && /text|search|url|email/.test(type));
  }

  function setNativeInputValue(element, value) {
    const descriptor = Object.getOwnPropertyDescriptor(element.constructor.prototype, "value")
      || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
      || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");

    if (descriptor?.set) {
      descriptor.set.call(element, value);
      return;
    }

    element.value = value;
  }

  function getElementLabel(element) {
    if (!element) {
      return "";
    }

    const labelledBy = element.getAttribute("aria-labelledby");
    const labelledText = labelledBy
      ? labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.innerText || document.getElementById(id)?.textContent || "")
        .join(" ")
      : "";

    return normalizeText([
      element.getAttribute("aria-label"),
      labelledText,
      element.getAttribute("title"),
      element.getAttribute("placeholder"),
      element.getAttribute("data-testid"),
      element.getAttribute("value"),
      element.innerText,
      element.textContent
    ].filter(Boolean).join(" "));
  }

  function distanceBetweenElements(a, b) {
    const aRect = a.getBoundingClientRect();
    const bRect = b.getBoundingClientRect();
    const ax = aRect.left + aRect.width / 2;
    const ay = aRect.top + aRect.height / 2;
    const bx = bRect.left + bRect.width / 2;
    const by = bRect.top + bRect.height / 2;

    return Math.hypot(ax - bx, ay - by);
  }

  function queryAllSafe(selector) {
    try {
      return Array.from(document.querySelectorAll(selector));
    } catch (_error) {
      return [];
    }
  }

  function queryAllWithin(root, selector) {
    if (!root) {
      return [];
    }

    try {
      const rootMatches = root.matches?.(selector) ? [root] : [];

      return [...rootMatches, ...Array.from(root.querySelectorAll(selector))];
    } catch (_error) {
      return [];
    }
  }

  function uniqueElements(elements) {
    return Array.from(new Set(elements.filter(Boolean)));
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function serializeError(error) {
    if (!error) {
      return "Unknown error";
    }

    if (typeof error === "string") {
      return error;
    }

    return error.message || String(error);
  }

  async function dataUrlToFile(dataUrl, name, mimeType) {
    const response = await fetch(dataUrl);
    const blob = await response.blob();

    return new File([blob], name, {
      type: mimeType || blob.type || "application/octet-stream"
    });
  }

  function waitForMutationOrDelay(ms, setWake) {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(resolve, ms);

      setWake(() => {
        clearTimeout(timeoutId);
        resolve();
      });
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
