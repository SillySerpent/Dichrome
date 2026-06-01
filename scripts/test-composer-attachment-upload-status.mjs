import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const context = vm.createContext({});
const source = await readFile(new URL("../content/chatgpt/runtime/adapter/composer-controls.js", import.meta.url), "utf8");

vm.runInContext(source, context);

const {
  collectAttachmentUploadStatus,
  isFileInputCompatibleWithAttachments
} = context.ChatGptRelay.runtime.adapterComposerControls;

const pdfAttachment = {
  kind: "file",
  name: "report.pdf",
  mimeType: "application/pdf"
};
const textAttachment = {
  kind: "file",
  name: "notes.txt",
  mimeType: "text/plain"
};
const imageAttachment = {
  kind: "image",
  name: "chart.png",
  mimeType: "image/png"
};

assert.equal(
  isFileInputCompatibleWithAttachments(createInput({ accept: "image/*" }), [pdfAttachment]),
  false,
  "Image-only ChatGPT inputs must not be used for document uploads."
);

assert.equal(
  isFileInputCompatibleWithAttachments(createInput({ accept: ".pdf,application/msword" }), [pdfAttachment]),
  true,
  "Extension and MIME accept tokens should allow matching document uploads."
);

assert.equal(
  isFileInputCompatibleWithAttachments(createInput({ accept: "image/*,.pdf,text/plain" }), [imageAttachment, pdfAttachment, textAttachment]),
  true,
  "Mixed image/document batches should use only inputs that accept every queued file."
);

assert.equal(
  isFileInputCompatibleWithAttachments(createInput({ accept: "", webkitdirectory: true }), [pdfAttachment]),
  false,
  "Directory upload inputs are not compatible with message attachments."
);

const attachButton = createElement({
  text: "Attach files",
  attributes: {
    "data-testid": "composer-button-file-upload"
  },
  buttonLike: true
});
const baseline = collectAttachmentUploadStatus({
  attachments: [pdfAttachment],
  baselineCount: 0,
  getElementLabel,
  isVisible,
  normalizeText,
  queryAllSafe: createQuery([attachButton])
});

assert.equal(baseline.ready, false);
assert.equal(baseline.count, 0, "A plain attach button is not an accepted-file chip.");

const uploadMenuStatus = collectAttachmentUploadStatus({
  attachments: [pdfAttachment],
  baselineCount: 0,
  getElementLabel,
  isVisible,
  normalizeText,
  queryAllSafe: createQuery([createElement({
    text: "Upload from computer",
    attributes: {
      role: "menuitem"
    },
    menuLike: true
  })])
});

assert.equal(uploadMenuStatus.ready, false);
assert.equal(uploadMenuStatus.count, 0, "A generic upload menu item must not prove that a file attached.");

const pendingStatus = collectAttachmentUploadStatus({
  attachments: [pdfAttachment],
  baselineCount: baseline.count,
  getElementLabel,
  isVisible,
  normalizeText,
  queryAllSafe: createQuery([createElement({
    text: "Uploading report.pdf",
    attributes: {
      "data-testid": "attachment-upload"
    }
  })])
});

assert.equal(pendingStatus.pending, true);
assert.equal(pendingStatus.ready, false);

const readyStatus = collectAttachmentUploadStatus({
  attachments: [pdfAttachment],
  baselineCount: baseline.count,
  getElementLabel,
  isVisible,
  normalizeText,
  queryAllSafe: createQuery([createElement({
    text: "report.pdf",
    attributes: {
      "data-testid": "file-preview"
    }
  })])
});

assert.equal(readyStatus.pending, false);
assert.equal(readyStatus.ready, true);
assert.deepEqual(readyStatus.matchedNames, ["report.pdf"]);

const previousMessageWithSameName = createElement({
  text: "report.pdf",
  attributes: {
    "data-testid": "file-preview"
  },
  closestSelectors: ["data-message-author-role"]
});
const ignoredMessageStatus = collectAttachmentUploadStatus({
  attachments: [pdfAttachment],
  baselineCount: baseline.count,
  getElementLabel,
  isVisible,
  normalizeText,
  queryAllSafe: createQuery([previousMessageWithSameName])
});

assert.equal(ignoredMessageStatus.ready, false, "Message-history text must not prove that a new upload attached.");

const twoImageStatus = collectAttachmentUploadStatus({
  attachments: [imageAttachment, {
    ...imageAttachment,
    name: "diagram.png"
  }],
  baselineCount: 0,
  getElementLabel,
  isVisible,
  normalizeText,
  queryAllSafe: createQuery([
    createElement({
      text: "Image",
      attributes: {
        "data-testid": "attachment-preview"
      }
    }),
    createElement({
      text: "Image",
      attributes: {
        "data-testid": "attachment-preview"
      }
    })
  ])
});

assert.equal(twoImageStatus.ready, true, "Generic visible attachment chips can confirm image uploads when names are hidden.");

console.log("Composer attachment upload status tests passed.");

function createInput({
  accept,
  webkitdirectory = false
}) {
  return {
    accept,
    webkitdirectory
  };
}

function createElement({
  text,
  attributes = {},
  buttonLike = false,
  menuLike = false,
  closestSelectors = []
}) {
  return {
    innerText: text,
    textContent: text,
    contains() {
      return false;
    },
    closest(selector) {
      return closestSelectors.some((item) => selector.includes(item)) ? {} : null;
    },
    getAttribute(name) {
      return attributes[name] || "";
    },
    matches(selector) {
      return (buttonLike && selector.includes("button"))
        || (menuLike && selector.includes("menuitem"));
    }
  };
}

function createQuery(elements) {
  return (selector) => selector.includes("progressbar") || selector.includes("progress")
    ? []
    : elements;
}

function getElementLabel(element) {
  return normalizeText([
    element.getAttribute?.("aria-label"),
    element.getAttribute?.("data-testid"),
    element.innerText,
    element.textContent
  ].filter(Boolean).join(" "));
}

function isVisible() {
  return true;
}

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}
