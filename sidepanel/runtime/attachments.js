import {
  PANEL_MESSAGES
} from "../../shared/contracts.js";
import { sendMessage } from "./client.js";

const MAX_FILE_ATTACHMENT_BYTES = 32 * 1024 * 1024;

export async function captureVisibleScreenshotAttachment() {
  const sourceTab = await queryActiveSourceTab().catch(() => null);
  const response = await sendMessage(PANEL_MESSAGES.CAPTURE_SCREENSHOT_ATTACHMENT, {
    sourceTab
  });
  const attachment = response.attachment;

  if (!attachment?.dataUrl) {
    throw new Error("Screenshot capture returned no image data.");
  }

  return {
    ...attachment,
    id: attachment.id || createLocalId(),
    kind: attachment.kind || "image",
    source: "screenshot",
    name: attachment.name || "Visible tab screenshot",
    mimeType: attachment.mimeType || "image/png",
    previewUrl: attachment.previewUrl || attachment.dataUrl
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

async function queryActiveSourceTab() {
  if (!chrome.tabs?.query) {
    return null;
  }

  const [lastFocusedTab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });

  if (isPotentialSourceTab(lastFocusedTab)) {
    return lastFocusedTab;
  }

  const [currentWindowTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return isPotentialSourceTab(currentWindowTab) ? currentWindowTab : null;
}

function isPotentialSourceTab(tab) {
  const url = tab?.url || tab?.pendingUrl || "";

  return Boolean(tab?.id && tab?.windowId && url && !/^chrome-extension:/i.test(url) && !/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(url));
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
