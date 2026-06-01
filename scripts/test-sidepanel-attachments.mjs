import assert from "node:assert/strict";
import {
  createImageAttachmentFromUrl,
  createImageAttachmentsFromUrls
} from "../sidepanel/runtime/attachments.js";

const originalFetch = globalThis.fetch;
const calls = [];

try {
  globalThis.fetch = async (url, options) => {
    calls.push({
      url,
      options
    });

    if (url.includes("not-image")) {
      return createResponse({
        ok: true,
        status: 200,
        contentType: "text/html",
        blob: new Blob(["<html></html>"], {
          type: "text/html"
        })
      });
    }

    if (url.includes("blocked")) {
      return createResponse({
        ok: false,
        status: 403,
        contentType: "text/plain",
        blob: new Blob(["blocked"], {
          type: "text/plain"
        })
      });
    }

    return createResponse({
      ok: true,
      status: 200,
      contentType: "image/png",
      blob: new Blob(["abc"], {
        type: "image/png"
      })
    });
  };

  const remote = await createImageAttachmentFromUrl("https://example.test/path/plot.png?token=1");

  assert.equal(calls[0].url, "https://example.test/path/plot.png?token=1");
  assert.equal(calls[0].options.credentials, "include");
  assert.equal(remote.kind, "image");
  assert.equal(remote.source, "url");
  assert.equal(remote.name, "plot.png");
  assert.equal(remote.mimeType, "image/png");
  assert.equal(remote.sizeBytes, 3);
  assert.equal(remote.dataUrl, "data:image/png;base64,YWJj");
  assert.equal(remote.previewUrl, remote.dataUrl);

  const dataUrl = await createImageAttachmentFromUrl("data:image/png;base64,AAAA");

  assert.equal(dataUrl.name, "pasted-image.png");
  assert.equal(dataUrl.mimeType, "image/png");
  assert.equal(dataUrl.dataUrl, "data:image/png;base64,AAAA");

  await assert.rejects(
    () => createImageAttachmentFromUrl("https://example.test/not-image"),
    /did not return an image/
  );

  await assert.rejects(
    () => createImageAttachmentFromUrl("https://example.test/blocked.png"),
    /HTTP 403/
  );

  const batch = await createImageAttachmentsFromUrls([
    "https://example.test/path/plot.png?token=1",
    "https://example.test/path/plot.png?token=1",
    "https://example.test/not-image"
  ]);

  assert.equal(batch.attachments.length, 1);
  assert.equal(batch.rejected.length, 1);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Side panel attachment tests passed.");

function createResponse({ ok, status, contentType, blob }) {
  return {
    ok,
    status,
    headers: {
      get(name) {
        return name.toLowerCase() === "content-type" ? contentType : "";
      }
    },
    blob: async () => blob
  };
}
