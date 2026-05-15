(() => {
  const relay = globalThis.ChatGptRelay = globalThis.ChatGptRelay || {};
  const runtime = relay.runtime = relay.runtime || {};
  const normalizeText = runtime.domUtils?.normalizeText || fallbackNormalizeText;

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

  runtime.adapterOptions = Object.freeze({
    normalizeProjectOptions,
    normalizeConversationOptions,
    normalizeModelOptions,
    normalizeAdapterHints
  });
})();
