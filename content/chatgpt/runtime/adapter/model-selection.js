(() => {
  const relay = globalThis.ChatGptRelay = globalThis.ChatGptRelay || {};
  const runtime = relay.runtime = relay.runtime || {};

  function createMethods({
    REQUEST_STATES,
    DomAdapterError,
    clickElement,
    elementMatchesText,
    emitState,
    getElementLabel,
    isDisabled,
    isVisible,
    normalizeComparableText,
    normalizeModelOptions,
    normalizeText,
    queryAllSafe,
    queryAllWithin,
    scoreModelOptionCandidate,
    scoreModelPickerCandidate,
    sleep,
    uniqueElements,
    waitFor,
    waitForOptional
  }) {
    return {
      async ensureModelSelection(modelOptions, requestId, run) {
        const model = normalizeModelOptions(modelOptions);

        if (!model.enabled || !model.label) {
          return;
        }

        const selectedPicker = this.findSelectedModelPicker(model.label);

        if (selectedPicker) {
          emitState(requestId, REQUEST_STATES.MODEL_SELECTED, {
            detail: `Model already selected: ${model.label}`
          });
          return;
        }

        const opened = await this.openModelPickerForOption(model, run);

        if (!opened.option) {
          this.closeOpenMenu();
          this.handleModelSelectionIssue(requestId, model, buildModelSelectionFailureMessage(model.label, opened));
          return;
        }

        const clickTarget = resolveModelOptionClickTarget(opened.option);
        const clickedOptionLabel = normalizeComparableText(getElementLabel(opened.option));
        clickElement(clickTarget);

        const confirmed = await waitForOptional(
          () => this.isModelSelectionConfirmed(model.label, { requireExact: model.requireExact }),
          4500,
          run
        );

        if (!confirmed && !clickedModelOptionMatches(clickedOptionLabel, model.label, { requireExact: model.requireExact })) {
          this.closeOpenMenu();
          this.handleModelSelectionIssue(requestId, model, `Clicked model option, but the visible picker did not confirm: ${model.label}`);
          return;
        }

        this.closeOpenMenu();
        emitState(requestId, REQUEST_STATES.MODEL_SELECTED, {
          detail: `Selected model: ${model.label}`
        });
      },

      findModelPickerButton() {
        return this.findModelPickerCandidates()[0]?.element || null;
      },

      findModelPickerCandidates() {
        const composer = this.findComposer?.() || null;
        const hinted = this.findAllByHints(
          "modelPicker",
          (element) => isVisible(element) && !isDisabled(element) && scoreModelPickerCandidate(element) > 0
        );
        const semantic = queryAllSafe([
          'main button',
          'main [role="button"]',
          'main [aria-haspopup]',
          'header button',
          'button[aria-label*="model" i]',
          'button[aria-haspopup]',
          '[role="button"][aria-haspopup]',
          '[data-testid*="model" i]'
        ].join(', '));

        return uniqueElements([...hinted, ...semantic])
          .filter((element) => isVisible(element) && !isDisabled(element))
          .map((element, index) => ({
            element,
            index,
            score: scoreModelPickerElement(element, composer, {
              getElementLabel,
              normalizeComparableText,
              scoreModelPickerCandidate
            })
          }))
          .filter((candidate) => candidate.score > 0)
          .sort((a, b) => b.score - a.score || a.index - b.index);
      },

      findSelectedModelPicker(modelLabel) {
        return this.findModelPickerCandidates()
          .find(({ element }) => elementMatchesText(element, modelLabel))?.element || null;
      },

      async openModelPickerForOption(model, run) {
        const modelLabel = model.label;
        const pickers = this.findModelPickerCandidates();
        const attempted = [];
        let bestVisibleOption = null;
        let bestOpenDebug = [];
        let bestVisibleOptionDebug = [];

        if (!pickers.length) {
          return {
            option: null,
            attempted,
            openDebug: this.collectOpenModelMenuDebug(modelLabel),
            visibleOptions: this.collectVisibleModelOptionDebug(modelLabel, { requireExact: model.requireExact })
          };
        }

        for (const { element: picker, score } of pickers.slice(0, 12)) {
          this.closeOpenMenu();
          await sleep(100);
          clickElement(picker);
          await sleep(160);

          const openDebug = this.collectOpenModelMenuDebug(modelLabel);
          const attempt = describeModelElement(picker, score, { openDebug });
          attempted.push(attempt);

          const option = await waitForOptional(
            () => this.findModelOption(modelLabel, { requireExact: model.requireExact }),
            2200,
            run
          );

          if (option) {
            return {
              option,
              attempted,
              openDebug,
              visibleOptions: this.collectVisibleModelOptionDebug(modelLabel, { requireExact: model.requireExact })
            };
          }

          const visibleOptions = this.findModelOptionCandidates(modelLabel, { includeZeroScore: true, requireExact: model.requireExact });
          const visibleOptionDebug = this.collectVisibleModelOptionDebug(modelLabel, { requireExact: model.requireExact });

          if (!bestVisibleOption && visibleOptions.length) {
            bestVisibleOption = visibleOptions[0]?.element || null;
          }

          if (openDebug.length > bestOpenDebug.length) {
            bestOpenDebug = openDebug;
          }

          if (visibleOptionDebug.length > bestVisibleOptionDebug.length) {
            bestVisibleOptionDebug = visibleOptionDebug;
          }
        }

        return {
          option: bestVisibleOption && scoreModelOptionCandidate(bestVisibleOption, modelLabel, { requireExact: model.requireExact }) > 0 ? bestVisibleOption : null,
          attempted,
          openDebug: bestOpenDebug,
          visibleOptions: bestVisibleOptionDebug.length ? bestVisibleOptionDebug : this.collectVisibleModelOptionDebug(modelLabel, { requireExact: model.requireExact })
        };
      },

      findModelOption(modelLabel, options = {}) {
        const hinted = this.findByHints(
          "modelOption",
          (element) => isVisible(element) && !isDisabled(element) && scoreModelOptionCandidate(element, modelLabel, { requireExact: options.requireExact }) > 0
        );

        if (hinted) {
          return hinted;
        }

        return this.findModelOptionCandidates(modelLabel, { requireExact: options.requireExact })[0]?.element || null;
      },

      findModelOptionCandidates(modelLabel, options = {}) {
        const menuRoots = findOpenModelMenuRoots({ queryAllSafe, isVisible });

        // Do not search the whole ChatGPT document for selectable model options.
        // The sidebar/history often contains conversation titles such as
        // "Thinking Model Inquiry"; treating those as model options can click a
        // previous chat and make a supposedly fresh request continue the wrong
        // conversation. Only actual open picker/menu roots are valid selection
        // scopes. Debug collection may still inspect the body separately.
        if (!menuRoots.length) {
          return [];
        }

        const searchRoots = uniqueElements(menuRoots.filter(Boolean));
        const selector = [
          'button',
          'a',
          'li',
          '[role="option"]',
          '[role="menuitem"]',
          '[role="menuitemradio"]',
          '[role="radio"]',
          '[aria-checked]',
          '[aria-selected]',
          '[cmdk-item]',
          '[data-radix-collection-item]',
          '[data-testid]',
          '[data-value]',
          '[data-state]',
          'div',
          'span',
          'p'
        ].join(', ');

        return uniqueElements(searchRoots.flatMap((root) => queryAllWithin(root, selector)))
          .filter((element) => isVisible(element) && !isDisabled(element))
          .map((element, index) => ({
            element,
            index,
            score: scoreModelOptionCandidate(element, modelLabel, { requireExact: options.requireExact })
          }))
          .filter((candidate) => options.includeZeroScore ? candidate.score >= 0 : candidate.score > 0)
          .sort((a, b) => b.score - a.score || a.index - b.index);
      },

      collectVisibleModelOptionDebug(modelLabel, options = {}) {
        return this.findModelOptionCandidates(modelLabel, { includeZeroScore: true, requireExact: options.requireExact })
          .filter(({ score }) => score > 0)
          .slice(0, 12)
          .map(({ element, score }) => describeModelElement(element, score));
      },

      collectOpenModelMenuDebug(modelLabel = "") {
        const target = normalizeComparableText(modelLabel || "");
        const roots = findOpenModelMenuRoots({ queryAllSafe, isVisible });
        const rootItems = roots
          .map((element) => describeModelElement(element, 0))
          .filter((item) => item.text || item.ariaLabel || item.role)
          .slice(0, 8);
        const modelishItems = queryAllSafe('body button, body [role="option"], body [role="menuitem"], body [role="menuitemradio"], body [aria-checked], body [aria-selected], body [data-radix-collection-item], body [cmdk-item], body div, body span')
          .filter((element) => isVisible(element) && !isDisabled(element))
          .map((element) => ({
            element,
            label: normalizeComparableText(getElementLabel(element))
          }))
          .filter(({ label }) => label && (countModelTerms(label) > 0 || (target && label.includes(target))))
          .slice(0, 20)
          .map(({ element }) => describeModelElement(element, 0));

        return uniqueDebugItems([...rootItems, ...modelishItems]).slice(0, 16);
      },

      isModelSelectionConfirmed(modelLabel, options = {}) {
        const selectedPicker = this.findSelectedModelPicker(modelLabel);

        if (selectedPicker) {
          return true;
        }

        const selectedOption = this.findModelOptionCandidates(modelLabel, { requireExact: options.requireExact })
          .find(({ element }) => isSelectedModelOptionElement(element));

        return Boolean(selectedOption);
      },

      handleModelSelectionIssue(requestId, model, message) {
        throw new DomAdapterError(message, this.collectSnapshot());
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

  function scoreModelPickerElement(element, composer, {
    getElementLabel,
    normalizeComparableText,
    scoreModelPickerCandidate
  }) {
    const label = normalizeComparableText(getElementLabel(element));
    const metadata = normalizeComparableText([
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("data-testid"),
      element.getAttribute?.("title"),
      element.getAttribute?.("aria-haspopup"),
      element.getAttribute?.("role")
    ].filter(Boolean).join(" "));
    const combined = `${label} ${metadata}`.trim();

    if (!combined || /send|stop|attach|upload|sidebar|project|new chat|voice|dictation|microphone|share|profile|conversation options|history-item/.test(combined)) {
      return 0;
    }

    let score = scoreModelPickerCandidate(element);

    if (composer && isNearComposerControl(element, composer) && /\b(auto|instant|thinking|reasoning|extended|standard|fast|pro)\b/.test(label)) {
      score += 240;
    }

    if (composer && isNearComposerControl(element, composer) && /\b(gpt|model|reason|reasoning|thinking)\b/.test(combined)) {
      score += 120;
    }

    if (/^\s*(auto|instant|thinking|extended|standard|fast|pro)\s*$/.test(label)) {
      score += 90;
    }

    if (/\bextended\b/.test(label)) {
      // The current ChatGPT composer commonly renders the model/reasoning
      // picker as a small button labelled "Extended" beside the composer.
      // It is a better target than generic header/sidebar buttons.
      score += 55;
    }

    return score;
  }

  function isNearComposerControl(element, composer) {
    if (!element || !composer) {
      return false;
    }

    const rect = element.getBoundingClientRect?.();
    const composerRect = composer.getBoundingClientRect?.();

    if (!rect || !composerRect) {
      return false;
    }

    const elementCx = rect.left + rect.width / 2;
    const elementCy = rect.top + rect.height / 2;
    const composerCx = composerRect.left + composerRect.width / 2;
    const composerCy = composerRect.top + composerRect.height / 2;
    const distance = Math.hypot(elementCx - composerCx, elementCy - composerCy);
    const sameRow = Math.abs(elementCy - composerCy) <= 95;
    const nearbyHorizontally = rect.left >= composerRect.left - 120 && rect.left <= composerRect.right + 420;

    return distance <= 620 || (sameRow && nearbyHorizontally);
  }

  function findOpenModelMenuRoots({ queryAllSafe, isVisible }) {
    return queryAllSafe([
      '[role="menu"]',
      '[role="listbox"]',
      '[role="dialog"]',
      '[role="presentation"]',
      '[data-radix-popper-content-wrapper]',
      '[data-radix-menu-content]',
      '[data-radix-select-content]',
      '[data-radix-dropdown-menu-content]',
      '[data-headlessui-state]',
      '[popover]',
      '[cmdk-list]'
    ].join(', ')).filter(isVisible);
  }

  function resolveModelOptionClickTarget(element) {
    if (!element) {
      return element;
    }

    const actionableSelector = 'button, [role="option"], [role="menuitem"], [role="menuitemradio"], [role="radio"], [aria-checked], [aria-selected], [cmdk-item], [data-radix-collection-item], a, li';

    if (element.matches?.(actionableSelector)) {
      return element;
    }

    return element.closest?.(actionableSelector)
      || element.querySelector?.(actionableSelector)
      || element;
  }

  function clickedModelOptionMatches(clickedOptionLabel, modelLabel, options = {}) {
    const target = normalizeDebugText(modelLabel).toLowerCase();
    const label = normalizeDebugText(clickedOptionLabel).toLowerCase();

    if (!target || !label) {
      return false;
    }

    if (options.requireExact) {
      return label === target || new RegExp(`(^|[^a-z0-9])${escapeRegExp(target)}([^a-z0-9]|$)`, "i").test(label);
    }

    if (target === "thinking") {
      return /(^|[^a-z0-9])(thinking|reasoning|reason)([^a-z0-9]|$)/i.test(label);
    }

    if (target === "instant") {
      return /(^|[^a-z0-9])(instant|fast|quick)([^a-z0-9]|$)/i.test(label);
    }

    return label.includes(target);
  }

  function escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function isSelectedModelOptionElement(element) {
    if (!element) {
      return false;
    }

    const selectedAttribute = element.getAttribute?.("aria-checked") === "true"
      || element.getAttribute?.("aria-selected") === "true"
      || element.getAttribute?.("data-state") === "checked"
      || element.getAttribute?.("data-selected") === "true";
    const className = String(element.className || element.closest?.("button, [role], li")?.className || "");

    return selectedAttribute || /\b(selected|current|checked|active)\b/i.test(className);
  }

  function describeModelElement(element, score = 0, extra = {}) {
    const rect = element?.getBoundingClientRect?.() || {};

    return {
      tag: element?.tagName?.toLowerCase?.() || "",
      role: element?.getAttribute?.("role") || "",
      ariaLabel: element?.getAttribute?.("aria-label") || "",
      title: element?.getAttribute?.("title") || "",
      dataTestId: element?.getAttribute?.("data-testid") || "",
      ariaHaspopup: element?.getAttribute?.("aria-haspopup") || "",
      ariaExpanded: element?.getAttribute?.("aria-expanded") || "",
      score,
      text: normalizeDebugText(element?.innerText || element?.textContent || "").slice(0, 180),
      rect: {
        x: Math.round(rect.x || 0),
        y: Math.round(rect.y || 0),
        width: Math.round(rect.width || 0),
        height: Math.round(rect.height || 0)
      },
      ...extra
    };
  }

  function buildModelSelectionFailureMessage(modelLabel, opened) {
    const attemptedCount = opened?.attempted?.length || 0;
    const optionCount = opened?.visibleOptions?.length || 0;
    const openDebugCount = opened?.openDebug?.length || 0;
    const attempts = attemptedCount
      ? ` Tried ${attemptedCount} possible picker button(s). First attempts: ${JSON.stringify(opened.attempted.slice(0, 4))}`
      : " No model picker button was detected.";
    const optionHint = optionCount
      ? ` Best visible candidate(s): ${JSON.stringify(opened.visibleOptions.slice(0, 4))}`
      : openDebugCount
        ? ` Open-menu/model-ish visible item(s): ${JSON.stringify(opened.openDebug.slice(0, 6))}`
        : " No visible model picker menu or matching model option candidates were detected after opening the picker.";

    return `Requested model was not selectable in the picker: ${modelLabel}.${attempts}${optionHint}`;
  }

  function normalizeDebugText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function countModelTerms(value) {
    const text = String(value || "");
    const matches = text.match(/\b(auto|automatic|instant|thinking|reason|reasoning|extended|standard|fast|quick|pro|gpt|o3|o4|deep research)\b/gi);

    return matches ? matches.length : 0;
  }

  function uniqueDebugItems(items) {
    const seen = new Set();
    const result = [];

    for (const item of items) {
      const key = [item.tag, item.role, item.ariaLabel, item.dataTestId, item.text, item.rect?.x, item.rect?.y].join("|");

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      result.push(item);
    }

    return result;
  }
})();
