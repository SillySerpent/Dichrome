(() => {
  const relay = globalThis.ChatGptRelay = globalThis.ChatGptRelay || {};
  const runtime = relay.runtime = relay.runtime || {};

  function createClass({
    SNAPSHOT_LIMITS,
    collectCandidates,
    findVisible,
    normalizeAdapterHints,
    normalizeText,
    queryAllSafe,
    resolveHintElements,
    uniqueElements,
    waitFor
  }) {
    return class ChatGptDomAdapter {
      constructor(adapterHints) {
        this.adapterHints = normalizeAdapterHints(adapterHints);
      }

      async waitForAppShell(run) {
        await waitFor(
          () => this.findComposer() || this.findSidebar() || this.findProjectCreateButton() || findVisible(queryAllSafe("main")),
          30000,
          run,
          "Timed out waiting for the ChatGPT app shell to finish loading."
        );
      }

      detectBlockingUi() {
        const composer = this.findComposer();

        if (composer) {
          return "";
        }

        const bodyText = normalizeText(document.body?.innerText || "").toLowerCase();
        const path = location.pathname.toLowerCase();
        const hasLoginCopy = /\blog in\b|\bsign in\b/.test(bodyText) && /\bsign up\b|\bcreate account\b/.test(bodyText);

        if (path.includes("auth") || hasLoginCopy) {
          return "ChatGPT appears to be on a login or account gate. Open the ChatGPT tab and sign in before retrying.";
        }

        const visibleDialog = findVisible(Array.from(document.querySelectorAll('[role="dialog"], dialog')));

        if (visibleDialog) {
          const dialogText = normalizeText(visibleDialog.innerText || visibleDialog.textContent || "");

          if (dialogText && !/new chat|temporary chat/i.test(dialogText)) {
            return `ChatGPT is blocked by a modal dialog: ${dialogText.slice(0, 180)}`;
          }
        }

        return "";
      }

      collectSnapshot() {
        return {
          url: location.href,
          title: document.title,
          collectedAt: new Date().toISOString(),
          candidates: {
            inputs: collectCandidates(
              queryAllSafe('textarea, input[type="text"], input[type="search"], [contenteditable="true"], [role="textbox"]'),
              SNAPSHOT_LIMITS.inputs
            ),
            buttons: collectCandidates(
              queryAllSafe('button, [role="button"], input[type="submit"], input[type="file"]'),
              SNAPSHOT_LIMITS.buttons
            ),
            messages: collectCandidates(
              queryAllSafe('main [data-message-author-role], main [data-message-id], main article, main [role="article"], main [class*="markdown"]'),
              SNAPSHOT_LIMITS.messages
            )
          }
        };
      }

      findByHints(target, predicate) {
        return this.findAllByHints(target, predicate)[0] || null;
      }

      findAllByHints(target, predicate) {
        const hints = this.adapterHints
          .filter((hint) => hint.target === target)
          .sort((a, b) => b.confidence - a.confidence);
        const matches = [];

        for (const hint of hints) {
          for (const element of resolveHintElements(hint)) {
            if (predicate(element)) {
              matches.push(element);
            }
          }
        }

        return uniqueElements(matches);
      }
    };
  }

  runtime.adapterBase = Object.freeze({
    createClass
  });
})();
