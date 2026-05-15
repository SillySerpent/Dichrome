const RESPONSE_TYPEWRITER_MIN_CPS = 24;
const RESPONSE_TYPEWRITER_MAX_CPS = 54;
const RESPONSE_TYPEWRITER_CATCHUP_THRESHOLD = 7000;
const RESPONSE_TYPEWRITER_FORCE_CATCHUP_THRESHOLD = 20000;

export function createResponseAnimation({ renderMarkdownToHtml, resetAutoScroll, setHtml }) {
  let state = createEmptyState();

  function isTargetAhead(requestId, targetText) {
    return state.requestId === requestId && targetText && state.displayedText.length < targetText.length;
  }

  function startOrUpdate(requestId, targetText) {
    if (state.requestId !== requestId) {
      stop();
      resetAutoScroll();
      state = {
        requestId,
        targetText: targetText || "",
        displayedText: "",
        rafId: null,
        lastFrameAt: 0
      };
    } else {
      state.targetText = targetText || "";

      if (state.displayedText.length > state.targetText.length || !state.targetText.startsWith(state.displayedText)) {
        state.displayedText = "";
      }
    }

    if (!state.rafId) {
      state.rafId = window.requestAnimationFrame(step);
    }
  }

  function step(timestamp) {
    state.rafId = null;

    if (!state.requestId) {
      return;
    }

    const target = state.targetText || "";
    const displayed = state.displayedText || "";
    const remaining = target.length - displayed.length;

    if (remaining <= 0) {
      setHtml(renderMarkdownToHtml(target));
      return;
    }

    const lastFrameAt = state.lastFrameAt || timestamp;
    const elapsedMs = Math.max(16, timestamp - lastFrameAt);
    state.lastFrameAt = timestamp;

    const cps = remaining > RESPONSE_TYPEWRITER_FORCE_CATCHUP_THRESHOLD
      ? RESPONSE_TYPEWRITER_MAX_CPS
      : remaining > RESPONSE_TYPEWRITER_CATCHUP_THRESHOLD
        ? Math.round((RESPONSE_TYPEWRITER_MIN_CPS + RESPONSE_TYPEWRITER_MAX_CPS) / 2)
        : RESPONSE_TYPEWRITER_MIN_CPS;
    const nextLength = Math.min(target.length, displayed.length + Math.max(1, Math.ceil((cps * elapsedMs) / 1000)));

    state.displayedText = target.slice(0, nextLength);
    setHtml(renderMarkdownToHtml(state.displayedText));

    if (nextLength < target.length) {
      state.rafId = window.requestAnimationFrame(step);
    }
  }

  function stop() {
    if (state.rafId) {
      window.cancelAnimationFrame(state.rafId);
    }

    state = createEmptyState();
  }

  return Object.freeze({
    isTargetAhead,
    startOrUpdate,
    stop
  });
}

function createEmptyState() {
  return {
    requestId: null,
    targetText: "",
    displayedText: "",
    rafId: null,
    lastFrameAt: 0
  };
}
