(() => {
  const relay = globalThis.ChatGptRelay = globalThis.ChatGptRelay || {};
  const runtime = relay.runtime = relay.runtime || {};

  function createMethods({
    compareDocumentOrder,
    extractConversationKey,
    extractReadableHtmlFromElement,
    extractReadableTextFromElement,
    findBestAssistantContentElement,
    getChatGptAccessToken,
    getElementLabel,
    isAllowedChatGptUrl,
    isInsideUserAuthoredMessage,
    isTransientAssistantStatusText,
    isVisible,
    normalizeAssistantMessageElement,
    normalizeText,
    queryAllSafe,
    selectLatestAssistantResponseFromConversationData,
    uniqueElements
  }) {
    return {
      findAssistantMessages() {
        const hinted = this.findAllByHints("assistantMessage", (element) => this.isHintedAssistantMessageCandidate(element));
        const candidates = [
          ...hinted,
          ...queryAllSafe('[data-message-author-role="assistant"]'),
          ...queryAllSafe('main [data-message-author-role="assistant"]'),
          ...queryAllSafe('main article[aria-label*="assistant" i]'),
          ...queryAllSafe('main [role="article"][aria-label*="assistant" i]'),
          ...queryAllSafe('main [data-message-id]'),
          ...queryAllSafe('main [class*="markdown"], main [data-testid*="markdown" i]')
        ];

        return uniqueElements(candidates)
          .map(normalizeAssistantMessageElement)
          .filter((element) => this.isAssistantMessageCandidate(element))
          .filter(isVisible)
          .sort(compareDocumentOrder);
      },

      createAssistantMessageBaseline(messages = this.findAssistantMessages()) {
        const elements = Array.isArray(messages)
          ? messages.filter(Boolean)
          : Array.from(messages?.elements || []).filter(Boolean);
        const messageIds = elements.map((message) => this.getAssistantMessageId(message)).filter(Boolean);
        const identities = elements.map((message) => this.getAssistantMessageIdentity(message)).filter(Boolean);
        const textFingerprints = elements.map((message) => this.getAssistantMessageTextFingerprint(message)).filter(Boolean);

        return {
          elements,
          messageIds,
          identities,
          textFingerprints
        };
      },

      findNewestAssistantMessageAfter(previousMessages, fallbackMessage) {
        const baseline = this.normalizeAssistantMessageBaseline(previousMessages);
        const messages = this.findAssistantMessages();
        const newMessages = messages.filter((message) => !this.isAssistantMessageInBaseline(message, baseline));

        if (newMessages.length) {
          return newMessages[newMessages.length - 1];
        }

        if (fallbackMessage && messages.includes(fallbackMessage)) {
          return fallbackMessage;
        }

        return null;
      },

      findNewestTextBearingAssistantMessageAfter(previousMessages, fallbackMessage) {
        const baseline = this.normalizeAssistantMessageBaseline(previousMessages);
        const messages = this.findAssistantMessages();
        const candidates = messages.filter((message) => message === fallbackMessage || !this.isAssistantMessageInBaseline(message, baseline));
        const textBearing = candidates.filter((message) => {
          const text = normalizeText(extractReadableTextFromElement(findBestAssistantContentElement(message)));

          return text.length > 0 && !isTransientAssistantStatusText(text);
        });

        return textBearing[textBearing.length - 1] || null;
      },

      extractAssistantText(messageElement) {
        const source = findBestAssistantContentElement(messageElement);
        const text = extractReadableTextFromElement(source);

        if (!text || isTransientAssistantStatusText(text)) {
          return "";
        }

        return text;
      },

      extractAssistantHtml(messageElement) {
        const source = findBestAssistantContentElement(messageElement);
        const text = extractReadableTextFromElement(source);

        if (isTransientAssistantStatusText(text)) {
          return "";
        }

        const html = extractReadableHtmlFromElement(source);

        if (normalizeText(html)) {
          return html;
        }

        return "";
      },

      async fetchLatestConversationAssistantResponse({ afterMs = 0, excludedMessageIds = [] } = {}) {
        const conversationKey = extractConversationKey(location.href);

        if (!conversationKey || !isAllowedChatGptUrl(new URL(location.href))) {
          return null;
        }

        const token = await getChatGptAccessToken();
        const headers = {
          accept: "application/json"
        };

        if (token) {
          headers.authorization = `Bearer ${token}`;
        }

        const endpoints = [
          `${location.origin}/backend-api/conversation/${encodeURIComponent(conversationKey)}`,
          `${location.origin}/backend-api/conversation/${encodeURIComponent(conversationKey)}?metadata=true`
        ];
        const errors = [];

        for (const endpoint of endpoints) {
          const response = await fetch(endpoint, {
            method: "GET",
            credentials: "include",
            cache: "no-store",
            headers
          });

          if (!response.ok) {
            errors.push(`${response.status} ${endpoint}`);
            continue;
          }

          const data = await response.json();
          const selected = selectLatestAssistantResponseFromConversationData(data, {
            afterMs,
            excludedMessageIds
          });

          return selected ? {
            ...selected,
            conversationKey
          } : null;
        }

        throw new Error(`Conversation API returned ${errors.join("; ") || "no usable response"}.`);
      },

      normalizeAssistantMessageBaseline(previousMessages) {
        if (previousMessages?.elements || previousMessages?.identities || previousMessages?.textFingerprints || previousMessages?.messageIds) {
          return {
            elements: new Set(Array.from(previousMessages.elements || []).filter(Boolean)),
            messageIds: new Set(Array.from(previousMessages.messageIds || []).filter(Boolean).map(String)),
            identities: new Set(Array.from(previousMessages.identities || []).filter(Boolean)),
            textFingerprints: new Set(Array.from(previousMessages.textFingerprints || []).filter(Boolean))
          };
        }

        const baseline = this.createAssistantMessageBaseline(Array.isArray(previousMessages) ? previousMessages : []);

        return {
          elements: new Set(baseline.elements),
          messageIds: new Set(baseline.messageIds.map(String)),
          identities: new Set(baseline.identities),
          textFingerprints: new Set(baseline.textFingerprints)
        };
      },

      isAssistantMessageInBaseline(message, baseline) {
        if (!message) {
          return false;
        }

        if (baseline.elements.has(message)) {
          return true;
        }

        const messageId = this.getAssistantMessageId(message);

        if (messageId && baseline.messageIds.has(String(messageId))) {
          return true;
        }

        const identity = this.getAssistantMessageIdentity(message);

        if (identity && baseline.identities.has(identity)) {
          return true;
        }

        const textFingerprint = this.getAssistantMessageTextFingerprint(message);

        return Boolean(textFingerprint && baseline.textFingerprints.has(textFingerprint));
      },

      getAssistantMessageId(message) {
        if (!message) {
          return "";
        }

        return message.getAttribute?.("data-message-id")
          || message.querySelector?.("[data-message-id]")?.getAttribute("data-message-id")
          || "";
      },

      getAssistantMessageIdentity(message) {
        const messageId = this.getAssistantMessageId(message);

        if (messageId) {
          return `message:${messageId}`;
        }

        return "";
      },

      getAssistantMessageTextFingerprint(message) {
        const text = normalizeText(extractReadableTextFromElement(findBestAssistantContentElement(message))).replace(/\s+/g, " ");

        if (!text || isTransientAssistantStatusText(text)) {
          return "";
        }

        return `text:${text.length}:${text.slice(0, 2048)}`;
      },

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
      },

      isAssistantMessageCandidate(element) {
        if (!element || !isVisible(element) || isInsideUserAuthoredMessage(element) || element.closest?.("form")) {
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

        const insideConversation = Boolean(element.closest("main"));
        const hasMarkdown = Boolean(
          element.matches?.('[class*="markdown"], [data-testid*="markdown" i]')
          || element.querySelector?.('[class*="markdown"], [data-testid*="markdown" i]')
        );
        const hasMessageStructure = Boolean(element.matches('article, [role="article"], [data-message-id]') || hasMarkdown);

        // ChatGPT's current project/offscreen layout can render the final answer
        // as a markdown block without an explicit assistant aria label. Do not
        // require the literal word "assistant" in the message text; that caused
        // the runner to latch onto an empty placeholder and then wait forever.
        return insideConversation && hasMessageStructure && hasMarkdown;
      },

      isHintedAssistantMessageCandidate(element) {
        if (!element || !isVisible(element) || !element.closest("main") || element.closest("form")) {
          return false;
        }

        return Boolean(
          element.matches?.('[data-message-author-role], [data-message-id], article, [role="article"], .markdown')
          || element.querySelector?.('[data-message-author-role], [data-message-id], .markdown')
        );
      }
    };
  }

  runtime.adapterAssistantResponse = Object.freeze({
    createMethods
  });
})();
