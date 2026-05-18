const RESPONSE_TYPEWRITER_MIN_CPS = 42;
const RESPONSE_TYPEWRITER_MAX_CPS = 2400;
const RESPONSE_TYPEWRITER_TARGET_CATCHUP_MS = 850;
const RESPONSE_TYPEWRITER_LARGE_TARGET_CATCHUP_MS = 1500;

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
        state.displayedText = state.displayedText.slice(0, findCommonPrefixLength(state.displayedText, state.targetText));
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

    const cps = calculateTypewriterCps({
      displayedLength: displayed.length,
      remaining,
      targetLength: target.length
    });
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

export function calculateTypewriterCps({ displayedLength = 0, remaining = 0, targetLength = 0 } = {}) {
  if (remaining <= 0) {
    return RESPONSE_TYPEWRITER_MIN_CPS;
  }

  const catchupWindowMs = targetLength >= 12000 || remaining >= 6000
    ? RESPONSE_TYPEWRITER_LARGE_TARGET_CATCHUP_MS
    : RESPONSE_TYPEWRITER_TARGET_CATCHUP_MS;
  const catchupCps = Math.ceil((remaining * 1000) / catchupWindowMs);
  const targetSizeBoost = targetLength >= 12000
    ? 5
    : targetLength >= 5000
      ? 3
      : targetLength >= 1500
        ? 2
        : 1;
  const progressBoost = displayedLength > 0 && remaining > displayedLength
    ? 1.35
    : 1;
  const dynamicCps = Math.max(
    RESPONSE_TYPEWRITER_MIN_CPS * targetSizeBoost * progressBoost,
    catchupCps
  );

  return Math.max(
    RESPONSE_TYPEWRITER_MIN_CPS,
    Math.min(RESPONSE_TYPEWRITER_MAX_CPS, Math.round(dynamicCps))
  );
}

function findCommonPrefixLength(left, right) {
  const limit = Math.min(left.length, right.length);

  for (let index = 0; index < limit; index += 1) {
    if (left[index] !== right[index]) {
      return index;
    }
  }

  return limit;
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
