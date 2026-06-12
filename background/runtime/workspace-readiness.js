export function createWorkspaceReadinessController({
  classifyHiddenCapabilityFailure,
  formatUserFacingError,
  probeOffscreenAutomationTarget,
  sleep
}) {
  async function checkChatGptWorkspace() {
    const capability = await probeHiddenAutomationWithWarmup({
      attempts: 3,
      initialDelayMs: 350
    });
    const errorCode = capability?.supported
      ? null
      : classifyHiddenCapabilityFailure(capability?.failureReason || "Hidden internal automation is unavailable.");

    return {
      ready: Boolean(capability?.supported),
      capability,
      errorCode,
      message: capability?.supported
        ? "Hidden ChatGPT workspace is ready."
        : formatUserFacingError(errorCode, capability?.failureReason || "Hidden internal automation is unavailable.")
    };
  }

  async function probeHiddenAutomationWithWarmup({ attempts = 2, initialDelayMs = 300 } = {}) {
    let lastCapability = null;

    for (let index = 0; index < attempts; index += 1) {
      lastCapability = await probeOffscreenAutomationTarget();

      if (lastCapability?.supported) {
        return lastCapability;
      }

      if (index < attempts - 1) {
        await sleep(initialDelayMs * (index + 1));
      }
    }

    return lastCapability;
  }

  return Object.freeze({
    checkChatGptWorkspace,
    probeHiddenAutomationWithWarmup
  });
}
