(() => {
  const relay = globalThis.ChatGptRelay = globalThis.ChatGptRelay || {};
  const runtime = relay.runtime = relay.runtime || {};

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

  function dispatchInputEvents(element, text = "") {
    element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "insertText",
      data: text
    }));
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: text
    }));
    element.dispatchEvent(new Event("change", {
      bubbles: true
    }));
  }

  async function setEditableText(element, text) {
    element.focus();

    if (isTextInput(element)) {
      setNativeInputValue(element, text);
      dispatchInputEvents(element, text);
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

      dispatchInputEvents(element, text);
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

  function normalizeAssistantMessageElement(element) {
    if (!element) {
      return null;
    }

    const assistantRoot = element.closest?.('[data-message-author-role="assistant"]');

    if (assistantRoot) {
      return assistantRoot;
    }

    const messageRoot = closestMessageContainer(element);

    if (messageRoot && !isInsideUserAuthoredMessage(messageRoot)) {
      return messageRoot;
    }

    return element;
  }

  function isInsideUserAuthoredMessage(element) {
    return Boolean(element?.closest?.('[data-message-author-role="user"], [data-message-author-role="tool"]'));
  }

  function compareDocumentOrder(a, b) {
    if (a === b) {
      return 0;
    }

    const position = a.compareDocumentPosition?.(b) || 0;

    if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
      return -1;
    }

    if (position & Node.DOCUMENT_POSITION_PRECEDING) {
      return 1;
    }

    return 0;
  }

  function findBestAssistantContentElement(messageElement) {
    if (!messageElement) {
      return null;
    }

    if (messageElement.matches?.('[class*="markdown"], [data-testid*="markdown" i]')) {
      return messageElement;
    }

    const contentCandidates = queryAllWithin(messageElement, '[class*="markdown"], [data-testid*="markdown" i], [data-message-content], [data-testid*="message" i]')
      .filter((element) => !isInsideUserAuthoredMessage(element))
      .filter((element) => normalizeText(element.innerText || element.textContent || ""));

    if (contentCandidates.length) {
      return contentCandidates[contentCandidates.length - 1];
    }

    return messageElement;
  }

  function extractReadableTextFromElement(element) {
    if (!element) {
      return "";
    }

    const clone = element.cloneNode(true);

    removeNonResponseNodes(clone);

    return normalizeText(clone.innerText || clone.textContent || "");
  }

  function extractReadableHtmlFromElement(element) {
    if (!element) {
      return "";
    }

    const clone = element.cloneNode(true);

    removeNonResponseNodes(clone);
    sanitizeElementTree(clone);

    return clone.innerHTML || escapeHtml(normalizeText(clone.textContent || ""));
  }

  function removeNonResponseNodes(root) {
    if (!root?.querySelectorAll) {
      return;
    }

    for (const element of root.querySelectorAll('button, svg, nav, menu, script, style, iframe, object, embed, form, input, textarea, select, [aria-hidden="true"], [data-testid*="copy" i], [data-testid*="feedback" i]')) {
      element.remove();
    }
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

    const previousValue = element.value || "";

    if (descriptor?.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }

    // React-controlled inputs can ignore synthetic input events if its private
    // value tracker already believes the DOM value is current. Resetting it to
    // the previous value makes the following input event look like a real edit.
    element._valueTracker?.setValue?.(previousValue);
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

  async function dataUrlToFile(dataUrl, name, mimeType) {
    const response = await fetch(dataUrl);
    const blob = await response.blob();

    return new File([blob], name, {
      type: mimeType || blob.type || "application/octet-stream"
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  runtime.domUtils = Object.freeze({
    clickElement,
    dispatchInputEvents,
    setEditableText,
    prioritizeComposerButtons,
    closestMessageContainer,
    normalizeAssistantMessageElement,
    isInsideUserAuthoredMessage,
    compareDocumentOrder,
    findBestAssistantContentElement,
    extractReadableTextFromElement,
    extractReadableHtmlFromElement,
    removeNonResponseNodes,
    resolveHintElements,
    collectCandidates,
    describeElementForDebug,
    sanitizeElementTree,
    stableElementSelector,
    cssEscape,
    findVisible,
    isVisible,
    isDisabled,
    isTextInput,
    setNativeInputValue,
    getElementLabel,
    distanceBetweenElements,
    queryAllSafe,
    queryAllWithin,
    uniqueElements,
    normalizeText,
    escapeHtml,
    dataUrlToFile
  });
})();
