import assert from "node:assert/strict";
import {
  MAX_PENDING_ATTACHMENT_BYTES,
  MAX_PENDING_ATTACHMENTS,
  MAX_PENDING_IMAGE_ATTACHMENTS,
  estimateAttachmentBytes,
  getPendingAttachmentLimitViolation
} from "../sidepanel/runtime/attachment-limits.js";

const image = (sizeBytes = 1024) => ({
  kind: "image",
  mimeType: "image/png",
  sizeBytes,
  dataUrl: "data:image/png;base64,AAAA"
});
const file = (sizeBytes = 1024) => ({
  kind: "file",
  mimeType: "text/plain",
  sizeBytes,
  dataUrl: "data:text/plain;base64,AAAA"
});

assert.equal(
  getPendingAttachmentLimitViolation([], image()),
  ""
);

assert.match(
  getPendingAttachmentLimitViolation(Array.from({ length: MAX_PENDING_ATTACHMENTS }, () => file()), file()),
  /up to 6 files/
);

assert.match(
  getPendingAttachmentLimitViolation(Array.from({ length: MAX_PENDING_IMAGE_ATTACHMENTS }, () => image()), image()),
  /up to 4 images or screenshots/
);

assert.match(
  getPendingAttachmentLimitViolation([file(MAX_PENDING_ATTACHMENT_BYTES - 100)], file(200)),
  /8\.0 MB/
);

assert.equal(
  estimateAttachmentBytes({
    dataUrl: "data:text/plain;base64,YWJj"
  }),
  3
);

assert.equal(
  estimateAttachmentBytes({
    dataUrl: "data:text/plain,hello%20world"
  }),
  11
);

console.log("Side panel attachment limit tests passed.");
