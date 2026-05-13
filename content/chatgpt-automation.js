(() => {
  if (window.__chatGptPageRelayAutomationLoaded) {
    return;
  }

  window.__chatGptPageRelayAutomationLoaded = true;

  const REQUEST_STATES = Object.freeze({
    CHATGPT_TAB_READY: "CHATGPT_TAB_READY",
    PROMPT_INSERTED: "PROMPT_INSERTED",
    PROMPT_SENT: "PROMPT_SENT",
    WAITING_FOR_ASSISTANT_MESSAGE: "WAITING_FOR_ASSISTANT_MESSAGE",
    STREAMING_RESPONSE: "STREAMING_RESPONSE",
    RESPONSE_COMPLETE: "RESPONSE_COMPLETE",
    ERROR_STATE: "ERROR_STATE"
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

    emitState(request.id, REQUEST_STATES.CHATGPT_TAB_READY, {
      detail: "ChatGPT tab automation script is ready."
    });

    const blockingUi = adapter.detectBlockingUi();

    if (blockingUi) {
      throw new DomAdapterError(blockingUi, adapter.collectSnapshot());
    }

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
    emitState(request.id, REQUEST_STATES.PROMPT_SENT, {
      detail: "Prompt sent through ChatGPT UI."
    });
    emitState(request.id, REQUEST_STATES.WAITING_FOR_ASSISTANT_MESSAGE, {
      detail: "Waiting for the newest assistant message."
    });

    const assistantMessage = await waitFor(
      () => adapter.findNewestAssistantMessageAfter(previousMessages),
      WAIT_TIMEOUTS.assistantMs,
      run,
      "Timed out waiting for a new assistant response."
    );

    await observeAssistantResponse({
      requestId: request.id,
      adapter,
      messageElement: assistantMessage,
      run
    });
  }

  async function observeAssistantResponse({ requestId, adapter, messageElement, run }) {
    let trackedMessage = messageElement;
    let latestText = "";
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

        const newestMessage = adapter.findNewestAssistantMessageAfter([], trackedMessage);

        if (newestMessage) {
          trackedMessage = newestMessage;
        }

        const errorText = adapter.findErrorText();

        if (errorText) {
          throw new DomAdapterError(errorText, adapter.collectSnapshot());
        }

        const nextText = normalizeText(adapter.extractAssistantText(trackedMessage));

        if (nextText && nextText !== latestText) {
          latestText = nextText;
          firstTextAt = firstTextAt || Date.now();
          lastTextChangeAt = Date.now();

          if (Date.now() - lastEmitAt >= STREAM_EMIT_THROTTLE_MS) {
            lastEmitAt = Date.now();
            emitState(requestId, REQUEST_STATES.STREAMING_RESPONSE, {
              text: latestText,
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
      composer.focus();

      if (isTextInput(composer)) {
        composer.value = prompt;
        dispatchInputEvents(composer);
        await sleep(50);
        composer.focus();
        return;
      }

      if (composer.isContentEditable || composer.getAttribute("contenteditable") === "true") {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(composer);
        selection.removeAllRanges();
        selection.addRange(range);

        const inserted = document.execCommand("insertText", false, prompt);

        if (!inserted || !normalizeText(composer.innerText || composer.textContent).includes(prompt.slice(0, 40))) {
          composer.textContent = prompt;
        }

        dispatchInputEvents(composer);
        await sleep(75);
        composer.focus();
        return;
      }

      throw new DomAdapterError("Composer candidate is not editable.", this.collectSnapshot());
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

  function emitState(requestId, state, { text, detail } = {}) {
    chrome.runtime.sendMessage({
      type: "CHATGPT_AUTOMATION_EVENT",
      requestId,
      state,
      text,
      detail
    }).catch(() => null);
  }

  function emitError(requestId, error) {
    const snapshot = error?.snapshot || new ChatGptDomAdapter([]).collectSnapshot();

    chrome.runtime.sendMessage({
      type: "CHATGPT_AUTOMATION_EVENT",
      requestId,
      state: REQUEST_STATES.ERROR_STATE,
      error: serializeError(error),
      detail: "Automation failed.",
      domSnapshot: snapshot
    }).catch(() => null);
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

    const semanticCandidates = queryAllSafe('textarea, input, [contenteditable="true"], button, [role], [aria-label], [placeholder], [data-message-author-role], [data-message-id], article');

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
    return element?.tagName === "TEXTAREA"
      || (element?.tagName === "INPUT" && /text|search/.test(element.type || ""));
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
