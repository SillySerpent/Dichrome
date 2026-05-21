import { REQUEST_ERROR_CODES } from "./contracts.js";

const ERROR_PRESENTATIONS = Object.freeze({
  [REQUEST_ERROR_CODES.AUTH_REQUIRED]: Object.freeze({
    title: "Sign in to ChatGPT to continue.",
    detail: "Dichrome could not access your ChatGPT session. Open ChatGPT, sign in, then retry the request.",
    actionLabel: "Open ChatGPT"
  }),
  [REQUEST_ERROR_CODES.HIDDEN_FRAME_UNAVAILABLE]: Object.freeze({
    title: "The hidden ChatGPT workspace could not start.",
    detail: "The internal ChatGPT frame did not finish loading or did not connect to Dichrome. Retry setup after ChatGPT is reachable.",
    actionLabel: "Retry setup"
  }),
  [REQUEST_ERROR_CODES.PROJECT_UNAVAILABLE]: Object.freeze({
    title: "This ChatGPT project could not be found.",
    detail: "The selected project may have been renamed, deleted, or unavailable to this ChatGPT account. Refresh projects or choose another routing target.",
    actionLabel: "Refresh projects"
  }),
  [REQUEST_ERROR_CODES.MODEL_UNAVAILABLE]: Object.freeze({
    title: "This model is not available on your ChatGPT account.",
    detail: "Choose another model in Settings or disable exact model matching before retrying.",
    actionLabel: "Choose another model"
  }),
  [REQUEST_ERROR_CODES.UPLOAD_REJECTED]: Object.freeze({
    title: "ChatGPT rejected the attachment.",
    detail: "The file may be too large, unsupported, or blocked by the current ChatGPT composer state. Remove it or try a smaller file.",
    actionLabel: "Review attachments"
  }),
  [REQUEST_ERROR_CODES.RATE_LIMITED]: Object.freeze({
    title: "ChatGPT is temporarily rate limited.",
    detail: "The account or model appears to be rate limited. Retry later or choose a lighter model.",
    actionLabel: "Retry later"
  }),
  [REQUEST_ERROR_CODES.BRIDGE_DISCONNECTED]: Object.freeze({
    title: "The ChatGPT bridge disconnected while preparing the request.",
    detail: "The hidden workspace reloaded or lost its content-script bridge. Retry after the workspace reconnects.",
    actionLabel: "Reconnect"
  }),
  [REQUEST_ERROR_CODES.CHATGPT_UNAVAILABLE]: Object.freeze({
    title: "ChatGPT is unreachable right now.",
    detail: "Dichrome could not complete the request against ChatGPT. Check ChatGPT in a normal tab, then retry.",
    actionLabel: "Retry"
  })
});

const DEFAULT_PRESENTATION = ERROR_PRESENTATIONS[REQUEST_ERROR_CODES.CHATGPT_UNAVAILABLE];

export function getErrorPresentation(errorCode, rawMessage = "") {
  const presentation = ERROR_PRESENTATIONS[errorCode] || DEFAULT_PRESENTATION;
  const raw = String(rawMessage || "").trim();

  return {
    ...presentation,
    code: errorCode || REQUEST_ERROR_CODES.CHATGPT_UNAVAILABLE,
    rawMessage: raw
  };
}

export function formatUserFacingError(errorCode, rawMessage = "") {
  const presentation = getErrorPresentation(errorCode, rawMessage);
  const parts = [presentation.title, presentation.detail];

  if (presentation.rawMessage && !presentation.detail.includes(presentation.rawMessage)) {
    parts.push(`Technical detail: ${presentation.rawMessage}`);
  }

  return parts.filter(Boolean).join("\n");
}
