(() => {
  const relay = globalThis.ChatGptRelay = globalThis.ChatGptRelay || {};
  const runtime = relay.runtime = relay.runtime || {};

  function createMethods({
    REQUEST_STATES,
    DomAdapterError,
    clickElement,
    elementMatchesText,
    emitState,
    isDisabled,
    isVisible,
    normalizeModelOptions,
    queryAllSafe,
    queryAllWithin,
    scoreModelOptionCandidate,
    scoreModelPickerCandidate,
    sleep,
    waitFor
  }) {
    return {
      async ensureModelSelection(modelOptions, requestId, run) {
        const model = normalizeModelOptions(modelOptions);

        if (!model.enabled || !model.label) {
          return;
        }

        const picker = this.findModelPickerButton();

        if (!picker) {
          this.handleModelSelectionIssue(requestId, model, `Could not find ChatGPT's model picker for requested model: ${model.label}`);
          return;
        }

        if (elementMatchesText(picker, model.label)) {
          emitState(requestId, REQUEST_STATES.MODEL_SELECTED, {
            detail: `Model already selected: ${model.label}`
          });
          return;
        }

        clickElement(picker);

        let option = null;

        try {
          option = await waitFor(
            () => this.findModelOption(model.label),
            8000,
            run,
            `Timed out waiting for model option: ${model.label}`
          );
        } catch (_error) {
          this.closeOpenMenu();
          this.handleModelSelectionIssue(requestId, model, `Requested model was not visible in the picker: ${model.label}`);
          return;
        }

        clickElement(option);
        await sleep(600);

        const selectedPicker = this.findModelPickerButton();

        if (selectedPicker && !elementMatchesText(selectedPicker, model.label)) {
          this.handleModelSelectionIssue(requestId, model, `Clicked model option, but the visible picker did not confirm: ${model.label}`);
          return;
        }

        emitState(requestId, REQUEST_STATES.MODEL_SELECTED, {
          detail: `Selected model: ${model.label}`
        });
      },

      findModelPickerButton() {
        const hinted = this.findByHints(
          "modelPicker",
          (element) => isVisible(element) && !isDisabled(element) && scoreModelPickerCandidate(element) > 0
        );

        if (hinted) {
          return hinted;
        }

        const candidates = queryAllSafe('header button, main button, button[aria-label*="model" i], button, [role="button"]')
          .filter((element) => isVisible(element) && !isDisabled(element))
          .map((element) => ({
            element,
            score: scoreModelPickerCandidate(element)
          }))
          .filter((candidate) => candidate.score > 0)
          .sort((a, b) => b.score - a.score);

        return candidates[0]?.element || null;
      },

      findModelOption(modelLabel) {
        const hinted = this.findByHints(
          "modelOption",
          (element) => isVisible(element) && !isDisabled(element) && scoreModelOptionCandidate(element, modelLabel) > 0
        );

        if (hinted) {
          return hinted;
        }

        const popupRoots = queryAllSafe('[role="menu"], [role="listbox"], [role="dialog"], [data-radix-popper-content-wrapper], [popover]')
          .filter(isVisible);
        const searchRoots = popupRoots.length ? popupRoots : [document.body];
        const candidates = searchRoots.flatMap((root) => queryAllWithin(root, 'button, [role="option"], [role="menuitem"], [cmdk-item], [data-testid], div'))
          .filter((element) => isVisible(element) && !isDisabled(element))
          .map((element) => ({
            element,
            score: scoreModelOptionCandidate(element, modelLabel)
          }))
          .filter((candidate) => candidate.score > 0)
          .sort((a, b) => b.score - a.score);

        return candidates[0]?.element || null;
      },

      handleModelSelectionIssue(requestId, model, message) {
        if (model.requireExact) {
          throw new DomAdapterError(message, this.collectSnapshot());
        }

        emitState(requestId, REQUEST_STATES.CHATGPT_TAB_READY, {
          detail: `${message}. Continuing with the current ChatGPT model.`
        });
      },

      closeOpenMenu() {
        document.dispatchEvent(new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          bubbles: true,
          cancelable: true
        }));
      }
    };
  }

  runtime.adapterModelSelection = Object.freeze({
    createMethods
  });
})();
