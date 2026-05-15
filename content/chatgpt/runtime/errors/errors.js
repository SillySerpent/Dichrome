(() => {
  const relay = globalThis.ChatGptRelay = globalThis.ChatGptRelay || {};
  const runtime = relay.runtime = relay.runtime || {};

  class DomAdapterError extends Error {
    constructor(message, snapshot) {
      super(message);
      this.name = "DomAdapterError";
      this.snapshot = snapshot;
    }
  }

  class VisibilityStateError extends Error {
    constructor(message) {
      super(message);
      this.name = "VisibilityStateError";
      this.suppressDomSnapshot = true;
    }
  }

  function serializeError(error) {
    if (!error) {
      return "Unknown error";
    }

    if (typeof error === "string") {
      return error;
    }

    return error.message || String(error);
  }

  runtime.errors = Object.freeze({
    DomAdapterError,
    VisibilityStateError,
    serializeError
  });
})();
