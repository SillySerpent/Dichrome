(() => {
  const relay = globalThis.ChatGptRelay = globalThis.ChatGptRelay || {};
  const runtime = relay.runtime = relay.runtime || {};

  async function waitFor(producer, timeoutMs, run, timeoutMessage) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      assertNotCancelled(run);

      const result = producer();

      if (result) {
        return result;
      }

      await sleep(150);
    }

    throw new Error(timeoutMessage);
  }

  async function waitForOptional(producer, timeoutMs, run) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      assertNotCancelled(run);

      const result = producer();

      if (result) {
        return result;
      }

      await sleep(150);
    }

    return null;
  }

  function assertNotCancelled(run) {
    if (run?.cancelled) {
      throw new Error("Automation cancelled.");
    }
  }

  function waitForMutationOrDelay(ms, setWake) {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(resolve, ms);

      setWake(() => {
        clearTimeout(timeoutId);
        resolve();
      });
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  runtime.wait = Object.freeze({
    assertNotCancelled,
    sleep,
    waitFor,
    waitForMutationOrDelay,
    waitForOptional
  });
})();
