(() => {
  const relay = globalThis.ChatGptRelay = globalThis.ChatGptRelay || {};
  const runtime = relay.runtime = relay.runtime || {};

  function createController({
    VISIBILITY_MODES,
    VisibilityStateError,
    collectRuntimeDebug,
    emitDebug,
    waitForOptional
  }) {
    async function assertExpectedVisiblePage(request, run, stage) {
      const mode = getAutomationVisibilityMode(request);

      if (!requiresEmulatedVisibility(mode)) {
        return;
      }

      if (document.visibilityState === "visible") {
        return;
      }

      const becameVisible = await waitForOptional(
        () => document.visibilityState === "visible",
        2500,
        run
      );

      if (becameVisible) {
        return;
      }

      emitDebug(request.id, `${stage}-visibility-hidden`, {
        visibilityMode: mode,
        runtime: collectRuntimeDebug({
          activeRun: run
        })
      });

      throw new VisibilityStateError(
        `ChatGPT stayed hidden during ${stage}. Background streaming requires Chrome debugger focus emulation; close DevTools for the ChatGPT tab and retry, or switch routing mode to Focus ChatGPT.`
      );
    }

    function getAutomationVisibilityMode(request) {
      const mode = request?.chatOptions?.visibility?.mode;

      if (mode === VISIBILITY_MODES.OFFSCREEN_FRAME || mode === VISIBILITY_MODES.SIDECAR || mode === VISIBILITY_MODES.FOCUSED || mode === VISIBILITY_MODES.HIDDEN || mode === VISIBILITY_MODES.SINGLE_TAB) {
        return mode;
      }

      return VISIBILITY_MODES.HIDDEN;
    }

    function requiresEmulatedVisibility(mode) {
      return mode === VISIBILITY_MODES.HIDDEN || mode === VISIBILITY_MODES.SINGLE_TAB || mode === VISIBILITY_MODES.SIDECAR;
    }

    return Object.freeze({
      assertExpectedVisiblePage,
      getAutomationVisibilityMode,
      requiresEmulatedVisibility
    });
  }

  runtime.visibility = Object.freeze({
    createController
  });
})();
