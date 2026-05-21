import {
  PANEL_MESSAGES,
  REQUEST_ERROR_CODES
} from "../../shared/contracts.js";
import { sendMessage } from "./client.js";

const MAX_FILE_ATTACHMENT_BYTES = 32 * 1024 * 1024;

export async function captureVisibleScreenshotAttachment() {
  await ensureScreenshotHostAccess();
  const response = await sendMessage(PANEL_MESSAGES.CAPTURE_VISIBLE_TAB_SCREENSHOT);

  if (!response?.screenshot) {
    throw new Error("Screenshot capture returned no image data.");
  }

  return {
    id: createLocalId(),
    kind: "image",
    source: "screenshot",
    name: "Visible tab screenshot",
    mimeType: "image/png",
    sizeBytes: response.sizeBytes || response.screenshot.length,
    dataUrl: response.screenshot,
    previewUrl: response.screenshot
  };
}

export async function createFileAttachments(fileList) {
  const files = Array.from(fileList || []);
  const attachments = [];
  const rejected = [];

  for (const file of files) {
    if (file.size > MAX_FILE_ATTACHMENT_BYTES) {
      rejected.push(`${file.name} is larger than ${formatBytes(MAX_FILE_ATTACHMENT_BYTES)}.`);
      continue;
    }

    attachments.push({
      id: createLocalId(),
      kind: file.type.startsWith("image/") ? "image" : "file",
      source: "file",
      name: file.name || "Attachment",
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size || 0,
      dataUrl: await readFileAsDataUrl(file)
    });
  }

  return {
    attachments,
    rejected
  };
}

export function removeAttachmentFromList(attachments, attachmentId) {
  return (attachments || []).filter((attachment) => attachment.id !== attachmentId);
}

async function ensureScreenshotHostAccess() {
  if (!chrome.permissions?.request || !chrome.tabs?.query) {
    return;
  }

  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  const originPattern = getHostPermissionPattern(tab?.url || "");

  if (!originPattern) {
    const error = new Error("Screenshots cannot be captured from browser-internal pages. Open a normal webpage and try again.");
    error.errorCode = REQUEST_ERROR_CODES.UPLOAD_REJECTED;
    throw error;
  }

  const alreadyGranted = await chrome.permissions.contains({
    origins: [originPattern]
  });

  if (alreadyGranted) {
    return;
  }

  const granted = await chrome.permissions.request({
    origins: [originPattern]
  });

  if (!granted) {
    const error = new Error("Chrome site access is required to attach a screenshot from this page.");
    error.errorCode = REQUEST_ERROR_CODES.UPLOAD_REJECTED;
    throw error;
  }
}

function getHostPermissionPattern(value) {
  try {
    const url = new URL(value);

    if (!/^https?:$/.test(url.protocol)) {
      return "";
    }

    return `${url.protocol}//${url.host}/*`;
  } catch (_error) {
    return "";
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Unable to read attachment."));
    reader.readAsDataURL(file);
  });
}

function createLocalId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function formatBytes(value) {
  if (!Number.isFinite(value)) {
    return "0 B";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
