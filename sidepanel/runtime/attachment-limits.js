export const MAX_PENDING_ATTACHMENTS = 6;
export const MAX_PENDING_IMAGE_ATTACHMENTS = 4;
export const MAX_PENDING_ATTACHMENT_BYTES = 8 * 1024 * 1024;

export function getPendingAttachmentLimitViolation(existingAttachments, candidateAttachment) {
  const existing = Array.isArray(existingAttachments) ? existingAttachments : [];
  const candidate = candidateAttachment && typeof candidateAttachment === "object" ? candidateAttachment : null;

  if (!candidate) {
    return "Attachment could not be added.";
  }

  if (existing.length >= MAX_PENDING_ATTACHMENTS) {
    return `You can attach up to ${MAX_PENDING_ATTACHMENTS} files per message. Remove one before adding another.`;
  }

  if (isImageAttachment(candidate) && countImageAttachments(existing) >= MAX_PENDING_IMAGE_ATTACHMENTS) {
    return `You can attach up to ${MAX_PENDING_IMAGE_ATTACHMENTS} images or screenshots per message. Remove one before adding another.`;
  }

  const nextTotalBytes = totalAttachmentBytes(existing) + estimateAttachmentBytes(candidate);

  if (nextTotalBytes > MAX_PENDING_ATTACHMENT_BYTES) {
    return `Attachments are limited to ${formatBytes(MAX_PENDING_ATTACHMENT_BYTES)} per message. Remove an attachment or send screenshots separately.`;
  }

  return "";
}

export function estimateAttachmentBytes(attachment) {
  const explicitSize = Number(attachment?.sizeBytes);

  if (Number.isFinite(explicitSize) && explicitSize > 0) {
    return explicitSize;
  }

  const dataUrl = String(attachment?.dataUrl || "");
  const commaIndex = dataUrl.indexOf(",");

  if (!dataUrl || commaIndex === -1) {
    return 0;
  }

  const metadata = dataUrl.slice(0, commaIndex);
  const payload = dataUrl.slice(commaIndex + 1);

  if (/;base64/i.test(metadata)) {
    return Math.floor(payload.replace(/=+$/, "").length * 3 / 4);
  }

  try {
    return decodeURIComponent(payload).length;
  } catch (_error) {
    return payload.length;
  }
}

function countImageAttachments(attachments) {
  return attachments.filter(isImageAttachment).length;
}

function isImageAttachment(attachment) {
  return attachment?.kind === "image" || String(attachment?.mimeType || "").startsWith("image/");
}

function totalAttachmentBytes(attachments) {
  return attachments.reduce((total, attachment) => total + estimateAttachmentBytes(attachment), 0);
}

function formatBytes(value) {
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
