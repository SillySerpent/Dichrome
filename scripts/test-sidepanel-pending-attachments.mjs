import assert from "node:assert/strict";
import { installFakeDocument } from "./test-utils/fake-dom.mjs";
import {
  appendPendingAttachment,
  renderPendingAttachments
} from "../sidepanel/runtime/pending-attachments.js";

installFakeDocument();

let generatedId = 0;
const createLocalId = () => `local-${generatedId += 1}`;
const baseAttachment = {
  name: "screen.png",
  mimeType: "image/png",
  sizeBytes: 100,
  dataUrl: "data:image/png;base64,AAAA"
};

const accepted = appendPendingAttachment([], baseAttachment, {
  createLocalId,
  getLimitViolation: () => ""
});

assert.equal(accepted.added, true);
assert.equal(accepted.attachments[0].id, "local-1");
assert.equal(accepted.attachments[0].kind, "image");
assert.equal(accepted.attachments[0].previewUrl, baseAttachment.dataUrl);

const rejected = appendPendingAttachment(accepted.attachments, {
  name: "blocked.pdf",
  mimeType: "application/pdf",
  dataUrl: "data:application/pdf;base64,AAAA"
}, {
  createLocalId,
  getLimitViolation: () => "Too many attachments."
});

assert.equal(rejected.added, false);
assert.equal(rejected.attachments, accepted.attachments);
assert.equal(rejected.limitViolation, "Too many attachments.");

const container = document.createElement("div");

renderPendingAttachments({
  container,
  attachments: accepted.attachments,
  formatBytes: (value) => `${value} B`
});

assert.equal(container.className, "");
assert.equal(container.children.length, 1);
assert.equal(container.children[0].className, "attachment-chip");
assert.equal(container.children[0].children[1].children[0].textContent, "screen.png");
assert.equal(container.children[0].children[2].dataset.removeAttachment, "local-1");

renderPendingAttachments({
  container,
  attachments: [],
  formatBytes: () => ""
});

assert.equal(container.className, "hidden");
assert.equal(container.children.length, 0);

console.log("Side panel pending attachment tests passed.");
