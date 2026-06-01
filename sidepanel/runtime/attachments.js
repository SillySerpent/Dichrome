import {
  PANEL_MESSAGES
} from "../../shared/contracts.js";
import { sendMessage } from "./client.js";

const MAX_FILE_ATTACHMENT_BYTES = 32 * 1024 * 1024;
const IMAGE_MIME_EXTENSION = Object.freeze({
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp"
});

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

export async function createImageAttachmentsFromUrls(urls) {
  const attachments = [];
  const rejected = [];

  for (const url of dedupeUrls(urls)) {
    try {
      attachments.push(await createImageAttachmentFromUrl(url));
    } catch (error) {
      rejected.push(error.message || String(error));
    }
  }

  return {
    attachments,
    rejected
  };
}

export async function createImageAttachmentFromUrl(url) {
  const normalizedUrl = normalizeImageSourceUrl(url);

  if (!normalizedUrl) {
    throw new Error("Dropped image URL is not a supported HTTP, HTTPS, or data image URL.");
  }

  if (normalizedUrl.startsWith("data:image/")) {
    const mimeType = getDataUrlMimeType(normalizedUrl) || "image/png";
    const sizeBytes = estimateDataUrlBytes(normalizedUrl);

    if (sizeBytes > MAX_FILE_ATTACHMENT_BYTES) {
      throw new Error(`Dropped image is larger than ${formatBytes(MAX_FILE_ATTACHMENT_BYTES)}.`);
    }

    return {
      id: createLocalId(),
      kind: "image",
      source: "url",
      name: `pasted-image.${extensionForMimeType(mimeType)}`,
      mimeType,
      sizeBytes,
      dataUrl: normalizedUrl,
      previewUrl: normalizedUrl
    };
  }

  if (typeof fetch !== "function") {
    throw new Error("This browser cannot fetch the dropped image URL.");
  }

  const response = await fetch(normalizedUrl, {
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error(`Could not attach image from ${normalizedUrl}: HTTP ${response.status}.`);
  }

  const contentType = normalizeMimeType(response.headers?.get?.("content-type") || "");
  const blob = await response.blob();
  const mimeType = normalizeMimeType(blob.type || contentType);

  if (!mimeType.startsWith("image/")) {
    throw new Error(`Dropped URL did not return an image: ${normalizedUrl}.`);
  }

  if (blob.size > MAX_FILE_ATTACHMENT_BYTES) {
    throw new Error(`${fileNameFromUrl(normalizedUrl, mimeType)} is larger than ${formatBytes(MAX_FILE_ATTACHMENT_BYTES)}.`);
  }

  const imageBlob = blob.type ? blob : new Blob([blob], {
    type: mimeType
  });
  const dataUrl = await blobToDataUrl(imageBlob, mimeType);

  return {
    id: createLocalId(),
    kind: "image",
    source: "url",
    name: fileNameFromUrl(normalizedUrl, mimeType),
    mimeType,
    sizeBytes: blob.size || estimateDataUrlBytes(dataUrl),
    dataUrl,
    previewUrl: dataUrl
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

async function blobToDataUrl(blob, mimeType = "") {
  if (typeof FileReader === "function") {
    return readFileAsDataUrl(blob);
  }

  if (typeof Buffer !== "undefined") {
    const arrayBuffer = await blob.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const dataUrlMimeType = normalizeMimeType(mimeType || blob.type || "application/octet-stream");

    return `data:${dataUrlMimeType};base64,${base64}`;
  }

  throw new Error("This browser cannot read the dropped image.");
}

function normalizeImageSourceUrl(value) {
  const text = String(value || "").trim();

  if (/^data:image\//i.test(text)) {
    return text;
  }

  try {
    const url = new URL(text);

    if (!/^https?:$/.test(url.protocol)) {
      return "";
    }

    return url.href;
  } catch (_error) {
    return "";
  }
}

function getDataUrlMimeType(dataUrl) {
  return normalizeMimeType(String(dataUrl || "").match(/^data:([^;,]+)/i)?.[1] || "");
}

function estimateDataUrlBytes(dataUrl) {
  const value = String(dataUrl || "");
  const commaIndex = value.indexOf(",");

  if (commaIndex === -1) {
    return value.length;
  }

  const metadata = value.slice(0, commaIndex);
  const payload = value.slice(commaIndex + 1);

  if (/;base64/i.test(metadata)) {
    return Math.floor(payload.replace(/=+$/, "").length * 3 / 4);
  }

  return decodeURIComponent(payload).length;
}

function fileNameFromUrl(url, mimeType) {
  let name = "";

  try {
    const parsed = new URL(url);
    name = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "");
  } catch (_error) {
    name = "";
  }

  const extension = extensionForMimeType(mimeType);

  if (!name) {
    return `pasted-image.${extension}`;
  }

  const sanitized = name.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 160);

  if (/\.[a-z0-9]{2,5}$/i.test(sanitized)) {
    return sanitized;
  }

  return `${sanitized}.${extension}`;
}

function extensionForMimeType(mimeType) {
  return IMAGE_MIME_EXTENSION[normalizeMimeType(mimeType)] || "png";
}

function normalizeMimeType(value) {
  return String(value || "").split(";")[0].trim().toLowerCase();
}

function dedupeUrls(urls) {
  const seen = new Set();
  const deduped = [];

  for (const url of urls || []) {
    const normalized = normalizeImageSourceUrl(url);

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    deduped.push(normalized);
  }

  return deduped;
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
