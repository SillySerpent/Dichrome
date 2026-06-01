const MAX_DROPPED_TEXT_LENGTH = 20000;
const IMAGE_URL_EXTENSION_PATTERN = /\.(avif|bmp|gif|heic|heif|jpeg|jpg|png|svg|webp)(?:[?#].*)?$/i;

export function getDroppedFiles(dataTransfer) {
  if (!dataTransfer) {
    return [];
  }

  const files = Array.from(dataTransfer.files || []).filter(Boolean);

  if (files.length) {
    return files;
  }

  return Array.from(dataTransfer.items || [])
    .filter((item) => item?.kind === "file")
    .map((item) => item.getAsFile?.())
    .filter(Boolean);
}

export function extractDroppedPromptText(dataTransfer) {
  if (!dataTransfer) {
    return "";
  }

  const imageUrls = extractDroppedImageUrls(dataTransfer);
  const plainText = normalizeDroppedText(readTransferData(dataTransfer, "text/plain"));
  const uriText = normalizeUriList(readTransferData(dataTransfer, "text/uri-list"));
  const htmlText = extractTextFromHtmlDrop(readTransferData(dataTransfer, "text/html"));
  const parts = [];

  if (htmlText && shouldPreferHtmlDropText(htmlText, plainText)) {
    parts.push(htmlText);
  } else if (plainText) {
    parts.push(removeImageUrlsFromText(plainText, imageUrls));
  } else if (htmlText) {
    parts.push(removeImageUrlsFromText(htmlText, imageUrls));
  }

  if (uriText && !parts.some((part) => containsEquivalentText(part, uriText))) {
    parts.push(removeImageUrlsFromText(uriText, imageUrls));
  }

  return truncateDroppedText(dedupeLines(parts).join("\n"));
}

export function extractDroppedImageUrls(dataTransfer) {
  if (!dataTransfer) {
    return [];
  }

  const urls = [
    ...extractImageUrlsFromHtml(readTransferData(dataTransfer, "text/html")),
    ...extractImageUrlsFromText(readTransferData(dataTransfer, "text/uri-list")),
    ...extractImageUrlsFromText(readTransferData(dataTransfer, "text/plain"))
  ];

  return dedupeUrls(urls);
}

export function buildTextInsertion({ value = "", selectionStart = null, selectionEnd = null } = {}, insertedText = "") {
  const text = normalizeDroppedText(insertedText);

  if (!text) {
    return {
      value: String(value || ""),
      selectionStart: Number.isFinite(selectionStart) ? selectionStart : String(value || "").length,
      selectionEnd: Number.isFinite(selectionEnd) ? selectionEnd : String(value || "").length
    };
  }

  const currentValue = String(value || "");
  const start = clampIndex(selectionStart, currentValue.length);
  const end = Math.max(start, clampIndex(selectionEnd, currentValue.length, start));
  const before = currentValue.slice(0, start);
  const after = currentValue.slice(end);
  const prefix = before && !/\s$/.test(before) ? "\n" : "";
  const suffix = after && !/^\s/.test(after) ? "\n" : "";
  const nextValue = `${before}${prefix}${text}${suffix}${after}`;
  const caret = before.length + prefix.length + text.length;

  return {
    value: nextValue,
    selectionStart: caret,
    selectionEnd: caret
  };
}

export function insertDroppedTextIntoComposer(textarea, text) {
  if (!textarea) {
    return false;
  }

  const next = buildTextInsertion({
    value: textarea.value,
    selectionStart: textarea.selectionStart,
    selectionEnd: textarea.selectionEnd
  }, text);

  if (next.value === textarea.value) {
    return false;
  }

  textarea.value = next.value;
  textarea.selectionStart = next.selectionStart;
  textarea.selectionEnd = next.selectionEnd;
  textarea.dispatchEvent(new Event("input", {
    bubbles: true
  }));
  textarea.focus();

  return true;
}

export function extractTextFromHtmlDrop(html) {
  const source = String(html || "");

  if (!source.trim()) {
    return "";
  }

  if (typeof DOMParser === "function") {
    return extractTextFromHtmlDocument(source);
  }

  return extractTextFromHtmlFallback(source);
}

export function isLikelyImageUrl(value) {
  const url = normalizePotentialUrl(value);

  if (!url) {
    return false;
  }

  if (url.startsWith("data:image/")) {
    return true;
  }

  try {
    const parsed = new URL(url);

    return /https?:/.test(parsed.protocol) && IMAGE_URL_EXTENSION_PATTERN.test(parsed.pathname);
  } catch (_error) {
    return false;
  }
}

function extractTextFromHtmlDocument(html) {
  try {
    const document = new DOMParser().parseFromString(html, "text/html");
    const body = document.body;

    if (!body) {
      return "";
    }

    for (const element of body.querySelectorAll("script, style, iframe, object, embed, input, textarea, select, button")) {
      element.remove();
    }

    const bodyText = normalizeDroppedText(body.innerText || body.textContent || "");
    const descriptors = collectLinkDescriptors(body, bodyText);

    return dedupeLines([bodyText, ...descriptors]).join("\n");
  } catch (_error) {
    return extractTextFromHtmlFallback(html);
  }
}

function collectLinkDescriptors(root, existingText) {
  const descriptors = [];

  for (const link of Array.from(root.querySelectorAll("a[href]"))) {
    const href = normalizeDroppedText(link.getAttribute("href") || link.href || "");
    const label = normalizeDroppedText(link.innerText || link.textContent || "");

    if (href && !containsEquivalentText(existingText, href)) {
      descriptors.push(label && label !== href ? `${label}: ${href}` : href);
    }
  }

  return descriptors;
}

function extractTextFromHtmlFallback(html) {
  const withoutHiddenBlocks = String(html || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  const text = normalizeDroppedText(decodeHtmlEntities(
    withoutHiddenBlocks
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  ));

  return text;
}

function extractImageUrlsFromHtml(html) {
  const source = String(html || "");

  if (!source.trim()) {
    return [];
  }

  if (typeof DOMParser === "function") {
    try {
      const document = new DOMParser().parseFromString(source, "text/html");

      return Array.from(document.querySelectorAll("img, source"))
        .flatMap((element) => [
          element.getAttribute("src"),
          element.getAttribute("currentSrc"),
          element.getAttribute("data-src"),
          ...extractUrlsFromSrcset(element.getAttribute("srcset"))
        ])
        .map(normalizePotentialUrl)
        .filter(Boolean);
    } catch (_error) {
      return extractImageUrlsFromHtmlFallback(source);
    }
  }

  return extractImageUrlsFromHtmlFallback(source);
}

function extractImageUrlsFromHtmlFallback(html) {
  const urls = [];

  for (const match of String(html || "").matchAll(/<(?:img|source)\b[^>]*>/gi)) {
    const tag = match[0];

    urls.push(
      getHtmlAttribute(tag, "src"),
      getHtmlAttribute(tag, "data-src"),
      ...extractUrlsFromSrcset(getHtmlAttribute(tag, "srcset"))
    );
  }

  return urls.map(normalizePotentialUrl).filter(Boolean);
}

function extractImageUrlsFromText(value) {
  return extractUrlsFromText(value).filter(isLikelyImageUrl);
}

function extractUrlsFromText(value) {
  const urls = [];
  const text = String(value || "");

  for (const line of text.split(/\s+/)) {
    const cleaned = normalizePotentialUrl(line.replace(/^Image:\s*/i, ""));

    if (cleaned) {
      urls.push(cleaned);
    }
  }

  return urls;
}

function extractUrlsFromSrcset(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function getHtmlAttribute(tag, name) {
  const pattern = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = String(tag || "").match(pattern);

  return decodeHtmlEntities(match?.[2] || match?.[3] || match?.[4] || "");
}

function readTransferData(dataTransfer, type) {
  try {
    return typeof dataTransfer.getData === "function" ? dataTransfer.getData(type) : "";
  } catch (_error) {
    return "";
  }
}

function normalizeUriList(value) {
  return normalizeDroppedText(
    String(value || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .join("\n")
  );
}

function removeImageUrlsFromText(value, imageUrls) {
  let text = normalizeDroppedText(value);

  for (const imageUrl of imageUrls) {
    text = text
      .replace(new RegExp(`Image:\\s*${escapeRegExp(imageUrl)}`, "gi"), "")
      .replace(new RegExp(escapeRegExp(imageUrl), "g"), "");
  }

  return normalizeDroppedText(text);
}

function normalizePotentialUrl(value) {
  const text = decodeHtmlEntities(String(value || "").trim())
    .replace(/^["'(<]+/, "")
    .replace(/[>"'),.]+$/, "");

  if (!text) {
    return "";
  }

  if (/^data:image\//i.test(text)) {
    return text;
  }

  try {
    const parsed = new URL(text);

    if (!/^https?:$/.test(parsed.protocol)) {
      return "";
    }

    return parsed.href;
  } catch (_error) {
    return "";
  }
}

function normalizeDroppedText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateDroppedText(value) {
  const text = normalizeDroppedText(value);

  if (text.length <= MAX_DROPPED_TEXT_LENGTH) {
    return text;
  }

  return text.slice(0, MAX_DROPPED_TEXT_LENGTH).trimEnd();
}

function shouldPreferHtmlDropText(htmlText, plainText) {
  if (!plainText) {
    return true;
  }

  return /^Image:/i.test(htmlText) && /^https?:\/\//i.test(plainText);
}

function containsEquivalentText(container, value) {
  const normalizedContainer = normalizeComparableText(container);
  const normalizedValue = normalizeComparableText(value);

  return Boolean(normalizedValue && normalizedContainer.includes(normalizedValue));
}

function normalizeComparableText(value) {
  return normalizeDroppedText(value).toLowerCase();
}

function dedupeLines(parts) {
  const seen = new Set();
  const lines = [];

  for (const part of parts) {
    for (const line of normalizeDroppedText(part).split("\n")) {
      const normalized = normalizeComparableText(line);

      if (!normalized || seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      lines.push(line);
    }
  }

  return lines;
}

function dedupeUrls(urls) {
  const seen = new Set();
  const deduped = [];

  for (const url of urls) {
    const normalized = normalizePotentialUrl(url);

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    deduped.push(normalized);
  }

  return deduped;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'");
}

function clampIndex(value, length, fallback = length) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(length, Math.max(0, number));
}
