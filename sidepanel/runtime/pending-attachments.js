export function appendPendingAttachment(pendingAttachments, attachment, {
  createLocalId,
  getLimitViolation
}) {
  const normalizedAttachment = normalizePendingAttachment(attachment, createLocalId);
  const limitViolation = getLimitViolation(pendingAttachments, normalizedAttachment);

  if (limitViolation) {
    return {
      added: false,
      attachments: pendingAttachments,
      limitViolation,
      attachment: normalizedAttachment
    };
  }

  return {
    added: true,
    attachments: [
      ...pendingAttachments,
      normalizedAttachment
    ],
    limitViolation: "",
    attachment: normalizedAttachment
  };
}

export function renderPendingAttachments({
  container,
  attachments,
  formatBytes
}) {
  container.replaceChildren();
  container.classList.toggle("hidden", attachments.length === 0);

  for (const attachment of attachments) {
    container.append(createAttachmentChip(attachment, formatBytes));
  }
}

function normalizePendingAttachment(attachment, createLocalId) {
  const mimeType = String(attachment.mimeType || "application/octet-stream");

  return {
    id: attachment.id || createLocalId(),
    kind: attachment.kind || (mimeType.startsWith("image/") ? "image" : "file"),
    name: attachment.name || "attachment",
    mimeType,
    sizeBytes: attachment.sizeBytes || null,
    dataUrl: attachment.dataUrl,
    previewUrl: attachment.previewUrl || (mimeType.startsWith("image/") ? attachment.dataUrl : "")
  };
}

function createAttachmentChip(attachment, formatBytes) {
  const chip = document.createElement("div");
  chip.className = "attachment-chip";

  if (attachment.previewUrl) {
    const image = document.createElement("img");
    image.width = 34;
    image.height = 30;
    image.decoding = "sync";
    image.loading = "eager";
    image.src = attachment.previewUrl;
    image.alt = "";
    chip.append(image);
  } else {
    const icon = document.createElement("span");
    icon.className = "file-icon";
    icon.textContent = "File";
    chip.append(icon);
  }

  const body = document.createElement("div");
  body.className = "attachment-body";
  const name = document.createElement("strong");
  name.textContent = attachment.name;
  const meta = document.createElement("span");
  meta.textContent = [attachment.mimeType, formatBytes(attachment.sizeBytes)].filter(Boolean).join(" · ");
  body.append(name, meta);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "tiny-button";
  remove.textContent = "Remove";
  remove.dataset.removeAttachment = attachment.id;

  chip.append(body, remove);
  return chip;
}
