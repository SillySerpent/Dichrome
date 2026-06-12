import {
  REQUEST_ERROR_CODES,
  normalizeRequestState
} from "../../shared/contracts.js";

export function formatRequestStatus(request) {
  if (!request) {
    return "Ready";
  }

  if (isAuthRequired(request)) {
    return "Sign in required";
  }

  return formatState(request.state);
}

export function isAuthRequired(request) {
  return request?.errorCode === REQUEST_ERROR_CODES.AUTH_REQUIRED;
}

export function formatState(state) {
  if (normalizeRequestState(state) === "WORKSPACE_READY") {
    return "hidden workspace ready";
  }

  return String(normalizeRequestState(state) || "IDLE").toLowerCase().replace(/_/g, " ");
}

export function formatHistoryMeta(conversation, projectName = "") {
  const updated = formatCompactDate(conversation.updatedAt || conversation.createdAt);
  const project = conversation.projectName || projectName || "";

  return [updated, project].filter(Boolean).join(" - ") || "Project conversation";
}

export function formatCompactDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
}
