(() => {
  const relay = globalThis.ChatGptRelay = globalThis.ChatGptRelay || {};
  const runtime = relay.runtime = relay.runtime || {};
  const normalizeText = runtime.domUtils?.normalizeText || fallbackNormalizeText;

  function normalizeProjectOptions(value) {
    const source = value && typeof value === "object" ? value : {};

    return {
      enabled: Boolean(source.enabled),
      name: normalizeText(source.name || "").slice(0, 80),
      createIfMissing: source.createIfMissing !== false,
      ...normalizeProjectTarget(source)
    };
  }

  function normalizeConversationOptions(value) {
    const source = value && typeof value === "object" ? value : {};
    const mode = source.mode === "continue" ? "continue" : "new";

    return {
      mode,
      expectedConversationUrl: typeof source.expectedConversationUrl === "string" ? source.expectedConversationUrl : null,
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

  function fallbackNormalizeText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function normalizeProjectTarget(source) {
    const segment = sanitizeProjectSegment(source.segment || extractProjectSegmentFromUrl(source.url));
    const origin = extractAllowedChatGptOrigin(source.url) || location.origin || "https://chatgpt.com";

    return {
      segment,
      url: segment ? `${origin}/g/${segment}/project` : ""
    };
  }

  function sanitizeProjectSegment(value) {
    const text = normalizeText(value || "").slice(0, 160);

    return /^g-p-[a-z0-9-]+$/i.test(text) ? text : "";
  }

  function extractProjectSegmentFromUrl(value) {
    try {
      return new URL(value, location.origin).pathname.match(/^\/g\/(g-p-[^/]+)/i)?.[1] || "";
    } catch (_error) {
      return "";
    }
  }

  function extractAllowedChatGptOrigin(value) {
    try {
      const url = new URL(value, location.origin);

      if (url.protocol === "https:" && (url.hostname === "chatgpt.com" || url.hostname === "chat.openai.com")) {
        return url.origin;
      }
    } catch (_error) {
      return "";
    }

    return "";
  }

  runtime.adapterOptions = Object.freeze({
    normalizeProjectOptions,
    normalizeConversationOptions,
    normalizeModelOptions,
    normalizeAdapterHints
  });
})();
