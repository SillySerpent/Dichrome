export function resolveSelectedContextUpdate({
  currentContext = null,
  dismissedSelectionKey = "",
  selection = null
} = {}) {
  const text = normalizeSelectionText(selection?.text || "");

  if (!text) {
    return {
      selectedContext: null,
      dismissedSelectionKey: "",
      changed: Boolean(currentContext)
    };
  }

  const key = createSelectionKey(text);

  if (key === dismissedSelectionKey) {
    return {
      selectedContext: null,
      dismissedSelectionKey,
      changed: Boolean(currentContext)
    };
  }

  const selectedContext = {
    id: key,
    text,
    sourceTitle: String(selection?.title || ""),
    sourceUrl: String(selection?.url || "")
  };

  return {
    selectedContext,
    dismissedSelectionKey,
    changed: !isSameSelectedContext(currentContext, selectedContext)
  };
}

export function createSelectionKey(text) {
  return normalizeSelectionText(text).slice(0, 1000);
}

export function normalizeSelectionText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function isSameSelectedContext(left, right) {
  return Boolean(
    left
    && right
    && left.id === right.id
    && left.text === right.text
    && left.sourceTitle === right.sourceTitle
    && left.sourceUrl === right.sourceUrl
  );
}
