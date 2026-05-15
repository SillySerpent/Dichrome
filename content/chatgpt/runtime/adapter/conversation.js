(() => {
  const relay = globalThis.ChatGptRelay = globalThis.ChatGptRelay || {};
  const runtime = relay.runtime = relay.runtime || {};

  function createMethods({
    REQUEST_STATES,
    clickElement,
    emitState,
    extractProjectPathSegment,
    getElementLabel,
    isDisabled,
    isOffscreenAutomationFrame,
    isVisible,
    normalizeComparableText,
    normalizeConversationOptions,
    normalizeProjectNavigationHref,
    normalizeProjectOptions,
    normalizeText,
    queryAllSafe,
    scoreNewChatCandidate,
    waitFor
  }) {
    return {
      async ensureFreshConversation(conversationOptions, projectOptions, requestId, run) {
        const conversation = normalizeConversationOptions(conversationOptions);

        if (conversation.mode === "continue" || !conversation.startNewChat) {
          emitState(requestId, REQUEST_STATES.CONVERSATION_READY, {
            detail: "Continuing the current ChatGPT conversation."
          });
          return;
        }

        if (!this.hasExistingConversation()) {
          emitState(requestId, REQUEST_STATES.CONVERSATION_READY, {
            detail: "Starting from a fresh ChatGPT composer."
          });
          return;
        }

        const originalUrl = location.href;
        const freshUrl = this.buildFreshConversationUrl(projectOptions) || `${location.origin}/`;
        const shouldPreferNavigation = isOffscreenAutomationFrame() || /\/g\/g-p-[^/]+\/c\//i.test(location.pathname);
        let usedDirectNavigation = false;

        if (!shouldPreferNavigation) {
          const newChatButton = this.findNewChatButton();

          if (newChatButton) {
            clickElement(newChatButton);
          } else {
            usedDirectNavigation = true;
            location.assign(freshUrl);
          }
        } else {
          usedDirectNavigation = true;
          location.assign(freshUrl);
        }

        if (usedDirectNavigation) {
          emitState(requestId, REQUEST_STATES.CHATGPT_TAB_READY, {
            detail: "Starting a fresh ChatGPT composer by direct navigation."
          });
        }

        await waitFor(
          () => this.findComposer() && (location.href !== originalUrl || !this.hasExistingConversation()),
          18000,
          run,
          "Timed out waiting for a fresh ChatGPT conversation."
        );

        await waitFor(
          () => !this.hasExistingConversation() || /\/project\/?$/i.test(location.pathname),
          10000,
          run,
          "Timed out waiting for ChatGPT to clear the previous conversation."
        );

        const project = normalizeProjectOptions(projectOptions);

        if (project.enabled && project.name && !this.hasProjectContext(project.name)) {
          await this.ensureProjectContext(project, requestId, run);
        }

        emitState(requestId, REQUEST_STATES.CONVERSATION_READY, {
          detail: "Started a fresh ChatGPT conversation."
        });
      },

      hasExistingConversation() {
        if (/\/c\//.test(location.pathname)) {
          return true;
        }

        return queryAllSafe('[data-message-author-role], main article, main [data-message-id]')
          .some((element) => isVisible(element) && normalizeText(element.innerText || element.textContent || ""));
      },

      buildFreshConversationUrl(projectOptions) {
        const project = normalizeProjectOptions(projectOptions);
        const projectSegment = extractProjectPathSegment(location.pathname);

        if (project.enabled && project.name && projectSegment) {
          return `${location.origin}/g/${projectSegment}/project`;
        }

        if (project.enabled && project.name) {
          const projectLink = this.findProjectNavigationItem(project.name);
          const href = projectLink?.href || projectLink?.getAttribute?.("href") || "";
          const projectUrl = normalizeProjectNavigationHref(href);

          if (projectUrl) {
            return projectUrl;
          }
        }

        return `${location.origin}/`;
      },

      findNewChatButton() {
        const candidates = queryAllSafe('a, button, [role="button"], [role="link"]')
          .filter((element) => isVisible(element) && !isDisabled(element))
          .map((element) => ({
            element,
            label: normalizeComparableText(getElementLabel(element))
          }))
          .filter(({ label }) => label === "new chat" || label.startsWith("new chat "))
          .sort((a, b) => scoreNewChatCandidate(b.element) - scoreNewChatCandidate(a.element));

        return candidates[0]?.element || null;
      }
    };
  }

  runtime.adapterConversation = Object.freeze({
    createMethods
  });
})();
