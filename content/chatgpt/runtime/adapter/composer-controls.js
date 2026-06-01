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
        const fileAttachments = attachments
          .filter((attachment) => attachment?.dataUrl)
          .map(normalizeAttachmentForUpload);

        if (!fileAttachments.length) {
          return;
        }

        const input = await waitFor(
          () => this.findFileInput(fileAttachments),
          6000,
          run,
          `Timed out waiting for a compatible ChatGPT file input for ${formatAttachmentNames(fileAttachments)}.`
        );
        const uploadBaseline = collectAttachmentUploadStatus({
          attachments: fileAttachments,
          baselineCount: 0,
          getElementLabel,
          isVisible,
          normalizeText,
          queryAllSafe
        });
        const transfer = new DataTransfer();

        for (const attachment of fileAttachments) {
          const file = await dataUrlToFile(attachment.dataUrl, attachment.name, attachment.mimeType);
          transfer.items.add(file);
        }

        try {
          input.files = transfer.files;
        } catch (error) {
          throw new Error(`ChatGPT file input rejected ${formatAttachmentNames(fileAttachments)}: ${error?.message || String(error)}`);
        }

        input.dispatchEvent(new Event("input", {
          bubbles: true
        }));
        input.dispatchEvent(new Event("change", {
          bubbles: true
        }));

        emitState(requestId, REQUEST_STATES.CHATGPT_TAB_READY, {
          detail: `Uploading ${fileAttachments.length} attachment${fileAttachments.length === 1 ? "" : "s"} into ChatGPT.`
        });

        await sleep(150);
        await waitFor(
          () => {
            const uploadError = detectAttachmentUploadError({ normalizeText, queryAllSafe, isVisible });

            if (uploadError) {
              throw new Error(uploadError);
            }

            const status = collectAttachmentUploadStatus({
              attachments: fileAttachments,
              baselineCount: uploadBaseline.count,
              getElementLabel,
              isVisible,
              normalizeText,
              queryAllSafe
            });

            return status.ready ? status : null;
          },
          getAttachmentUploadTimeoutMs(fileAttachments),
          run,
          `Timed out waiting for ChatGPT to finish attaching ${formatAttachmentNames(fileAttachments)}.`
        );

        emitState(requestId, REQUEST_STATES.CHATGPT_TAB_READY, {
          detail: `ChatGPT accepted ${fileAttachments.length} attachment${fileAttachments.length === 1 ? "" : "s"}.`
        });
      },

      findFileInput(attachments = []) {
        const hinted = this.findByHints("fileInput", (element) => this.isFileInputCandidate(element, attachments));

        if (hinted) {
          return hinted;
        }

        const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
        const candidates = inputs.filter((input) => this.isFileInputCandidate(input, attachments));

        return candidates
          .sort((left, right) => scoreFileInputCandidate(right, attachments, getElementLabel) - scoreFileInputCandidate(left, attachments, getElementLabel))[0] || null;
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

      isFileInputCandidate(element, attachments = []) {
        if (!element || element.tagName !== "INPUT" || element.type !== "file" || isDisabled(element)) {
          return false;
        }

        const label = getElementLabel(element).toLowerCase();

        if (/\b(avatar|profile photo|account photo|cover photo|background image)\b/.test(label)) {
          return false;
        }

        return isFileInputCompatibleWithAttachments(element, attachments);
      }
    };
  }

  runtime.adapterComposerControls = Object.freeze({
    createMethods,
    collectAttachmentUploadStatus,
    isFileInputCompatibleWithAttachments,
    detectAttachmentUploadError
  });

  function normalizeAttachmentForUpload(attachment) {
    const kind = attachment.kind === "image" ? "image" : "file";
    const fallbackName = kind === "image" ? "screenshot.png" : "attachment";
    const fallbackType = kind === "image" ? "image/png" : "application/octet-stream";

    return {
      ...attachment,
      kind,
      name: String(attachment.name || fallbackName).trim() || fallbackName,
      mimeType: String(attachment.mimeType || fallbackType).trim() || fallbackType
    };
  }

  function getAttachmentUploadTimeoutMs(attachments) {
    return Math.min(45000, 12000 + attachments.length * 6000);
  }

  function scoreFileInputCandidate(input, attachments, getElementLabel) {
    let score = 0;
    const tokens = parseAcceptTokens(input.accept);
    const label = getElementLabel(input).toLowerCase();

    if (!tokens.length) {
      score += 2;
    } else if (attachments.every((attachment) => attachmentMatchesAcceptTokens(attachment, tokens))) {
      score += 8;
    }

    if (input.multiple || attachments.length <= 1) {
      score += 2;
    }

    if (/\b(attach|upload|file|image|photo|document)\b/.test(label)) {
      score += 4;
    }

    if (/\b(avatar|profile photo|account photo|cover photo|background image)\b/.test(label)) {
      score -= 20;
    }

    return score;
  }

  function isFileInputCompatibleWithAttachments(input, attachments = []) {
    const acceptedAttachments = attachments.filter(Boolean);

    if (!acceptedAttachments.length) {
      return true;
    }

    if (input?.webkitdirectory || input?.directory) {
      return false;
    }

    const tokens = parseAcceptTokens(input?.accept || "");

    return !tokens.length || acceptedAttachments.every((attachment) => attachmentMatchesAcceptTokens(attachment, tokens));
  }

  function parseAcceptTokens(accept) {
    return String(accept || "")
      .split(",")
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean);
  }

  function attachmentMatchesAcceptTokens(attachment, tokens) {
    if (!tokens.length) {
      return true;
    }

    return tokens.some((token) => attachmentMatchesAcceptToken(attachment, token));
  }

  function attachmentMatchesAcceptToken(attachment, token) {
    if (token === "*/*") {
      return true;
    }

    const mimeType = String(attachment?.mimeType || "").split(";")[0].trim().toLowerCase();
    const extension = getAttachmentExtension(attachment?.name);

    if (token.startsWith(".")) {
      return extension === token;
    }

    if (token.endsWith("/*")) {
      const group = token.slice(0, -1);
      return Boolean(mimeType && mimeType.startsWith(group));
    }

    if (token.includes("/")) {
      return mimeType === token;
    }

    return false;
  }

  function getAttachmentExtension(name) {
    const match = String(name || "").toLowerCase().match(/(\.[a-z0-9][a-z0-9_-]{0,15})$/);

    return match ? match[1] : "";
  }

  function collectAttachmentUploadStatus({
    attachments,
    baselineCount = 0,
    getElementLabel,
    isVisible,
    normalizeText,
    queryAllSafe
  }) {
    const expectedAttachments = attachments.map(normalizeAttachmentForUpload);
    const elements = collectAttachmentUploadElements({
      attachments: expectedAttachments,
      getElementLabel,
      isVisible,
      normalizeText,
      queryAllSafe
    });
    const text = normalizeText(elements.map((element) => getElementLabel(element)).join("\n"));
    const matchedNames = expectedAttachments
      .filter((attachment) => attachmentNameAppearsInText(attachment, text))
      .map((attachment) => attachment.name);
    const pending = elements.some((element) => isPendingAttachmentUploadText(getElementLabel(element)))
      || queryAllSafe('[role="progressbar"], progress')
        .filter((element) => !isInsideMessageContainer(element))
        .some(isVisible);
    const addedCount = Math.max(0, elements.length - baselineCount);

    return {
      ready: !pending && (matchedNames.length >= expectedAttachments.length || addedCount >= expectedAttachments.length),
      pending,
      count: elements.length,
      addedCount,
      matchedNames
    };
  }

  function collectAttachmentUploadElements({
    attachments,
    getElementLabel,
    isVisible,
    normalizeText,
    queryAllSafe
  }) {
    const selector = [
      '[data-testid*="attachment" i]',
      '[data-testid*="file" i]',
      '[data-testid*="upload" i]',
      '[aria-label*="attachment" i]',
      '[aria-label*="file" i]',
      '[aria-label*="upload" i]',
      '[class*="attachment" i]',
      '[class*="file-preview" i]',
      '[class*="upload" i]',
      '[role="status"]',
      '[aria-live]:not([aria-live="off"])'
    ].join(",");
    const expectedNames = attachments.map((attachment) => createAttachmentNameMatchers(attachment)).flat();
    const candidates = queryAllSafe(selector)
      .filter((element) => element && isVisible(element) && !isInsideMessageContainer(element))
      .filter((element) => isAttachmentUploadCandidate(element, {
        expectedNames,
        getElementLabel,
        normalizeText
      }));

    return collapseNestedElements(candidates);
  }

  function isAttachmentUploadCandidate(element, {
    expectedNames,
    getElementLabel,
    normalizeText
  }) {
    const label = normalizeText(getElementLabel(element));
    const comparableLabel = normalizeComparableUploadText(label);

    if (!comparableLabel) {
      return false;
    }

    if (expectedNames.some((name) => name.length >= 4 && comparableLabel.includes(name))) {
      return true;
    }

    if (isUploadControlOnly(element, comparableLabel)) {
      return false;
    }

    return isPendingAttachmentUploadText(comparableLabel)
      || /\b(attachment|attached|uploaded|file|image|document|pdf|png|jpg|jpeg|webp|gif|csv|txt|docx?|xlsx?|pptx?)\b/.test(comparableLabel);
  }

  function isUploadControlOnly(element, comparableLabel) {
    const buttonLike = element.matches?.('button, [role="button"], [role="menuitem"], [role="option"], input[type="button"], input[type="file"]');

    if (!buttonLike) {
      return false;
    }

    return /\b(attach|add|upload|remove|delete|dismiss|cancel)\b/.test(comparableLabel)
      && /\b(file|files|attachment|attachments|image|images|photo|photos|upload)\b/.test(comparableLabel);
  }

  function isInsideMessageContainer(element) {
    return Boolean(element?.closest?.('[data-message-author-role], [data-message-id], article, [role="article"], textarea, [contenteditable="true"]'));
  }

  function collapseNestedElements(elements) {
    const collapsed = [];

    for (const element of elements) {
      const nestedInExisting = collapsed.some((existing) => existing !== element && existing.contains?.(element));

      if (nestedInExisting) {
        continue;
      }

      for (let index = collapsed.length - 1; index >= 0; index -= 1) {
        if (element.contains?.(collapsed[index])) {
          collapsed.splice(index, 1);
        }
      }

      collapsed.push(element);
    }

    return collapsed;
  }

  function attachmentNameAppearsInText(attachment, text) {
    const comparableText = normalizeComparableUploadText(text);

    return createAttachmentNameMatchers(attachment)
      .some((matcher) => matcher.length >= 4 && comparableText.includes(matcher));
  }

  function createAttachmentNameMatchers(attachment) {
    const name = normalizeComparableUploadText(attachment?.name || "");
    const withoutExtension = name.replace(/\s*\.[a-z0-9][a-z0-9_-]{0,15}$/, "").trim();
    const matchers = [name];

    if (withoutExtension.length >= 6) {
      matchers.push(withoutExtension);
    }

    return Array.from(new Set(matchers.filter(Boolean)));
  }

  function isPendingAttachmentUploadText(value) {
    return /\b(uploading|processing|reading|preparing|scanning|attaching|queued|pending)\b/i.test(value || "");
  }

  function normalizeComparableUploadText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\u00a0/g, " ")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function formatAttachmentNames(attachments) {
    const names = attachments.map((attachment) => attachment?.name).filter(Boolean);

    if (!names.length) {
      return "the selected attachment";
    }

    if (names.length === 1) {
      return names[0];
    }

    return `${names.slice(0, 3).join(", ")}${names.length > 3 ? `, and ${names.length - 3} more` : ""}`;
  }

  function detectAttachmentUploadError({ normalizeText, queryAllSafe, isVisible }) {
    const candidates = queryAllSafe('[role="alert"], [role="status"], [aria-live]:not([aria-live="off"]), [role="dialog"], dialog, [data-testid*="toast" i], [class*="toast" i], [class*="error" i]')
      .filter(isVisible)
      .filter(isAttachmentErrorSurface)
      .map((element) => normalizeText(element.innerText || element.textContent || ""))
      .filter(Boolean);

    const errorText = candidates.find((text) => {
      return /\b(upload|file|image|attachment)\b/i.test(text)
        && /\b(limit|too large|unsupported|failed|try again|could not|cannot|maximum|upgrade|not allowed|rejected)\b/i.test(text);
    });

    if (!errorText) {
      return "";
    }

    return `Attachment upload failed: ${errorText.slice(0, 220)}`;
  }

  function isAttachmentErrorSurface(element) {
    if (!element) {
      return false;
    }

    if (element.closest?.('[data-message-author-role], [data-message-id], article, [role="article"], textarea, [contenteditable="true"]')) {
      return false;
    }

    const text = String(element.innerText || element.textContent || "").trim();

    if (!text || text.length > 900) {
      return false;
    }

    return true;
  }
})();
