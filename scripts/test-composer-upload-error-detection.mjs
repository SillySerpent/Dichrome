import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const context = vm.createContext({});
const source = await readFile(new URL("../content/chatgpt/runtime/adapter/composer-controls.js", import.meta.url), "utf8");

vm.runInContext(source, context);

const { detectAttachmentUploadError } = context.ChatGptRelay.runtime.adapterComposerControls;

const userPrompt = createElement({
  text: "Why is my code still failing? def scaleTo0And255AndQuantize(pixel_array, image_width, image_height): cannot parse this file result",
  closestSelectors: ["data-message-author-role"]
});

assert.equal(
  detectAttachmentUploadError({
    normalizeText,
    queryAllSafe: () => [userPrompt],
    isVisible: () => true
  }),
  "",
  "User-authored prompt/code text must not be classified as an attachment upload error."
);

const alert = createElement({
  text: "Upload failed. The image is too large. Try again with a smaller file."
});

assert.equal(
  detectAttachmentUploadError({
    normalizeText,
    queryAllSafe: () => [alert],
    isVisible: () => true
  }),
  "Attachment upload failed: Upload failed. The image is too large. Try again with a smaller file."
);

const status = createElement({
  text: "Uploading file..."
});

assert.equal(
  detectAttachmentUploadError({
    normalizeText,
    queryAllSafe: () => [status],
    isVisible: () => true
  }),
  "",
  "Non-error upload status text must not be reported as a rejection."
);

const longPageText = createElement({
  text: `Attachment notes ${"not enough context ".repeat(80)} unsupported`
});

assert.equal(
  detectAttachmentUploadError({
    normalizeText,
    queryAllSafe: () => [longPageText],
    isVisible: () => true
  }),
  "",
  "Large page/message bodies must not be treated as toast-sized upload errors."
);

console.log("Composer upload error detection tests passed.");

function createElement({ text, closestSelectors = [] }) {
  return {
    innerText: text,
    textContent: text,
    closest(selector) {
      return closestSelectors.some((item) => selector.includes(item)) ? {} : null;
    }
  };
}

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}
