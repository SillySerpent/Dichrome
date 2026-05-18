(() => {
  const relay = globalThis.ChatGptRelay = globalThis.ChatGptRelay || {};
  const runtime = relay.runtime = relay.runtime || {};

  function createMethods({
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
  }) {
    return {
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
      },

      async insertPrompt(composer, prompt) {
        await setEditableText(composer, prompt);
      },

      async attachFiles(attachments, requestId, run) {
        const fileAttachments = attachments.filter((attachment) => attachment?.dataUrl);

        if (!fileAttachments.length) {
          return;
        }

        const input = await waitFor(
          () => this.findFileInput(),
          6000,
          run,
          "Timed out waiting for a ChatGPT file input for attachment upload."
        );
        const transfer = new DataTransfer();

        for (const attachment of fileAttachments) {
          const fallbackName = attachment.kind === "image" ? "screenshot.png" : "attachment";
          const fallbackType = attachment.kind === "image" ? "image/png" : "application/octet-stream";
          const file = await dataUrlToFile(attachment.dataUrl, attachment.name || fallbackName, attachment.mimeType || fallbackType);
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
          detail: `Attached ${fileAttachments.length} file(s).`
        });

        await sleep(900);
      },

      findFileInput() {
        const hinted = this.findByHints("fileInput", (element) => this.isFileInputCandidate(element));

        if (hinted) {
          return hinted;
        }

        const inputs = Array.from(document.querySelectorAll('input[type="file"]'));

        return inputs.find((input) => this.isFileInputCandidate(input)) || null;
      },

      findSendButton() {
        const hinted = this.findByHints("sendButton", (element) => this.isSendButtonCandidate(element));

        if (hinted) {
          return hinted;
        }

        const buttons = queryAllSafe('button, [role="button"], input[type="submit"]');
        const scopedButtons = prioritizeComposerButtons(buttons, this.findComposer());

        return findVisible(scopedButtons.filter((element) => this.isSendButtonCandidate(element)));
      },

      findStopButton() {
        const hinted = this.findByHints("stopButton", (element) => this.isStopButtonCandidate(element));

        if (hinted) {
          return hinted;
        }

        const buttons = queryAllSafe('button, [role="button"]');

        return findVisible(buttons.filter((element) => this.isStopButtonCandidate(element)));
      },

      isComposerIdle() {
        const composer = this.findComposer();

        if (!composer || isDisabled(composer)) {
          return false;
        }

        return !normalizeText(composer.innerText || composer.textContent || composer.value || "");
      },

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
      },

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
      },

      isStopButtonCandidate(element) {
        if (!element || !isVisible(element) || isDisabled(element)) {
          return false;
        }

        const label = getElementLabel(element).toLowerCase();

        return /stop|stop generating|cancel response|interrupt/.test(label);
      },

      isFileInputCandidate(element) {
        if (!element || element.tagName !== "INPUT" || element.type !== "file" || isDisabled(element)) {
          return false;
        }

        const accept = String(element.accept || "").toLowerCase();

        return !accept || accept.includes("image") || accept.includes("png") || accept.includes("*/*");
      }
    };
  }

  runtime.adapterComposerControls = Object.freeze({
    createMethods
  });
})();
