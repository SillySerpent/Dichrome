(() => {
  const relay = globalThis.ChatGptRelay = globalThis.ChatGptRelay || {};

  relay.bootstrap = {
    runtimeLoaded: Boolean(window.__chatGptPageRelayAutomationLoaded),
    loadedAt: new Date().toISOString()
  };
})();
