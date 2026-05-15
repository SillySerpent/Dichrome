(() => {
  const relay = globalThis.ChatGptRelay = globalThis.ChatGptRelay || {};
  const runtime = relay.runtime = relay.runtime || {};

  function createBridge({
    AUTOMATION_MESSAGES,
    OFFSCREEN_FRAME_PORT_NAME,
    handleAutomationMessage,
    isChatGptLocation,
    isNonAutomationChatGptFrame
  }) {
    let offscreenBridgePort = null;
    let offscreenBridgeReconnectTimer = null;
    let offscreenBridgeAnnounceTimer = null;

    function setup() {
      if (!shouldConnect()) {
        return;
      }

      connect();
    }

    function connect() {
      if (!shouldConnect() || offscreenBridgePort) {
        return;
      }

      clearReconnectTimer();

      let port;

      try {
        port = chrome.runtime.connect({
          name: OFFSCREEN_FRAME_PORT_NAME
        });
      } catch (_error) {
        scheduleReconnect();
        return;
      }

      offscreenBridgePort = port;
      const announceReady = () => {
        if (offscreenBridgePort !== port) {
          return;
        }

        postToPort(port, {
          type: AUTOMATION_MESSAGES.offscreenFrameReady,
          frame: collectFrameInfo()
        });
      };

      port.onMessage.addListener((message) => {
        if (offscreenBridgePort !== port) {
          return;
        }

        if (message?.type !== AUTOMATION_MESSAGES.offscreenFrameCommand) {
          return;
        }

        const commandId = message.commandId || null;
        let responded = false;
        const sendResponse = (response) => {
          responded = true;
          postToPort(port, {
            type: AUTOMATION_MESSAGES.offscreenFrameCommandResponse,
            commandId,
            response
          });
        };

        try {
          const handled = handleAutomationMessage(message.payload, sendResponse);

          if (!handled && !responded) {
            sendResponse({
              ok: false,
              error: `Unsupported offscreen frame command: ${message.payload?.type || "unknown"}`
            });
          }
        } catch (error) {
          sendResponse({
            ok: false,
            error: error?.message || String(error)
          });
        }
      });

      port.onDisconnect.addListener(() => {
        if (offscreenBridgePort !== port) {
          return;
        }

        offscreenBridgePort = null;
        clearAnnounceTimer();
        scheduleReconnect();
      });

      announceReady();

      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", announceReady, {
          once: true
        });
      }

      window.addEventListener("load", announceReady, {
        once: true
      });
      window.setTimeout(announceReady, 1000);
      offscreenBridgeAnnounceTimer = window.setInterval(announceReady, 2000);
    }

    function postToPort(port, payload) {
      try {
        port.postMessage(payload);
      } catch (_error) {
        // The frame may be navigating and the port can close between command dispatch and acknowledgement.
      }
    }

    function scheduleReconnect() {
      if (offscreenBridgeReconnectTimer || !shouldConnect()) {
        return;
      }

      offscreenBridgeReconnectTimer = window.setTimeout(() => {
        offscreenBridgeReconnectTimer = null;
        connect();
      }, 1000);
    }

    function clearReconnectTimer() {
      if (!offscreenBridgeReconnectTimer) {
        return;
      }

      window.clearTimeout(offscreenBridgeReconnectTimer);
      offscreenBridgeReconnectTimer = null;
    }

    function clearAnnounceTimer() {
      if (!offscreenBridgeAnnounceTimer) {
        return;
      }

      window.clearInterval(offscreenBridgeAnnounceTimer);
      offscreenBridgeAnnounceTimer = null;
    }

    function shouldConnect() {
      return isOffscreenAutomationFrame();
    }

    function isOffscreenAutomationFrame() {
      if (window.top === window || !isChatGptLocation(location.href)) {
        return false;
      }

      // The offscreen host embeds the real ChatGPT app as a direct child iframe.
      // ChatGPT itself also creates nested same-origin utility iframes such as
      // /backend-api/sentinel/frame.html. Because the manifest uses all_frames,
      // those nested frames also receive this content script. They must not claim
      // the automation bridge; otherwise the background worker sends commands to
      // an empty sentinel frame with no composer/messages.
      if (!isDirectOffscreenAppFrame() || isNonAutomationChatGptFrame(location.href)) {
        return false;
      }

      return hasExtensionAncestor();
    }

    function isDirectOffscreenAppFrame() {
      try {
        return window.parent === window.top;
      } catch (_error) {
        return false;
      }
    }

    function hasExtensionAncestor() {
      const extensionOrigin = `chrome-extension://${chrome.runtime.id}`;

      try {
        const ancestorOrigins = window.location?.ancestorOrigins;

        for (let index = 0; ancestorOrigins && index < ancestorOrigins.length; index += 1) {
          if (ancestorOrigins[index] === extensionOrigin) {
            return true;
          }
        }
      } catch (_error) {
        // Fall back to document.referrer below.
      }

      const referrer = document.referrer || "";

      return referrer === extensionOrigin || referrer.startsWith(`${extensionOrigin}/`);
    }

    function collectFrameInfo() {
      return {
        href: location.href,
        readyState: document.readyState,
        visibilityState: document.visibilityState,
        hasFocus: document.hasFocus(),
        title: document.title || "",
        referrer: document.referrer || "",
        bodyTextLength: document.body?.innerText?.length || 0,
        collectedAt: new Date().toISOString()
      };
    }

    return Object.freeze({
      collectFrameInfo,
      isOffscreenAutomationFrame,
      setup
    });
  }

  runtime.offscreenBridge = Object.freeze({
    createBridge
  });
})();
