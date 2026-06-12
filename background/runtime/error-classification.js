import {
  REQUEST_ERROR_CODES
} from "../../shared/contracts.js";
import {
  serializeError
} from "../constants.js";

export function createCodedError(message, errorCode) {
  const error = new Error(message);
  error.errorCode = errorCode || REQUEST_ERROR_CODES.CHATGPT_UNAVAILABLE;
  return error;
}

export function classifyHiddenCapabilityFailure(message) {
  return classifyRequestError(message || "Hidden internal automation is unavailable.");
}

export function classifyRequestError(error) {
  const message = serializeError(error).toLowerCase();

  if (/\b(log in|login|sign in|sign-in|auth|account gate|401|403|session|access token)\b/.test(message)) {
    return REQUEST_ERROR_CODES.AUTH_REQUIRED;
  }

  if (/\b(model|picker)\b/.test(message) && /\b(unavailable|not available|not selectable|not confirm|not found|upgrade|plan|tier|rejected)\b/.test(message)) {
    return REQUEST_ERROR_CODES.MODEL_UNAVAILABLE;
  }

  if (/\b(upload|attachment|file input|file too large|unsupported file|image limit|file limit|rejected)\b/.test(message)) {
    return REQUEST_ERROR_CODES.UPLOAD_REJECTED;
  }

  if (/\b(rate limit|usage limit|too many requests|temporarily unavailable|try again later|429)\b/.test(message)) {
    return REQUEST_ERROR_CODES.RATE_LIMITED;
  }

  if (/\b(project)\b/.test(message) && /\b(not found|unavailable|requires|routing|history)\b/.test(message)) {
    return REQUEST_ERROR_CODES.PROJECT_UNAVAILABLE;
  }

  if (/\b(disconnect|disconnected|receiving end does not exist|message port closed|could not establish connection|bridge)\b/.test(message)) {
    return REQUEST_ERROR_CODES.BRIDGE_DISCONNECTED;
  }

  if (/\b(hidden|offscreen|frame|iframe)\b/.test(message)) {
    return REQUEST_ERROR_CODES.HIDDEN_FRAME_UNAVAILABLE;
  }

  return REQUEST_ERROR_CODES.CHATGPT_UNAVAILABLE;
}
