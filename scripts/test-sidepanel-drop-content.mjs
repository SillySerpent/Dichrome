import assert from "node:assert/strict";
import {
  buildTextInsertion,
  extractDroppedImageUrls,
  extractDroppedPromptText,
  extractTextFromHtmlDrop,
  getDroppedFiles,
  isLikelyImageUrl
} from "../sidepanel/runtime/drop-content.js";

const textDrop = createDataTransfer({
  "text/plain": "  Selected page text\r\nwith spacing  "
});

assert.equal(extractDroppedPromptText(textDrop), "Selected page text\nwith spacing");

const richDrop = createDataTransfer({
  "text/plain": "Plain selected text",
  "text/html": "<div><strong>Rich selected text</strong></div>"
});

assert.equal(
  extractDroppedPromptText(richDrop),
  "Plain selected text",
  "Readable plain text should be preferred for selected rich webpage content."
);

const imageDrop = createDataTransfer({
  "text/plain": "https://example.test/image.png",
  "text/html": '<img alt="Chart preview" src="https://example.test/image.png">'
});

assert.equal(
  extractDroppedPromptText(imageDrop),
  "",
  "Dragged webpage images should become attachment candidates instead of prompt text."
);
assert.deepEqual(
  extractDroppedImageUrls(imageDrop),
  ["https://example.test/image.png"],
  "Dragged webpage images should expose their source URL for attachment."
);

const queryImageDrop = createDataTransfer({
  "text/plain": "https://coderunner.auckland.ac.nz/pluginfile.php/42785/question/questiontext/576583/2/920382/step1_2.png?time=1778649324204"
});

assert.equal(extractDroppedPromptText(queryImageDrop), "");
assert.deepEqual(extractDroppedImageUrls(queryImageDrop), [
  "https://coderunner.auckland.ac.nz/pluginfile.php/42785/question/questiontext/576583/2/920382/step1_2.png?time=1778649324204"
]);

const mixedDrop = createDataTransfer({
  "text/plain": "Look at this https://example.test/plot.webp?token=abc",
  "text/html": '<p>Look at this</p><img src="https://example.test/plot.webp?token=abc">'
});

assert.equal(extractDroppedPromptText(mixedDrop), "Look at this");
assert.deepEqual(extractDroppedImageUrls(mixedDrop), ["https://example.test/plot.webp?token=abc"]);

const srcsetDrop = createDataTransfer({
  "text/html": '<picture><source srcset="https://example.test/small.jpg 1x, https://example.test/large.jpg 2x"></picture>'
});

assert.deepEqual(
  extractDroppedImageUrls(srcsetDrop),
  ["https://example.test/small.jpg", "https://example.test/large.jpg"]
);

const extensionlessImageDrop = createDataTransfer({
  "text/html": '<img src="https://example.test/pluginfile.php/42785/question/image?time=1778649324204">'
});

assert.deepEqual(extractDroppedImageUrls(extensionlessImageDrop), [
  "https://example.test/pluginfile.php/42785/question/image?time=1778649324204"
]);

const uriDrop = createDataTransfer({
  "text/uri-list": "# source page\nhttps://example.test/article\n"
});

assert.equal(extractDroppedPromptText(uriDrop), "https://example.test/article");
assert.deepEqual(extractDroppedImageUrls(uriDrop), []);

assert.equal(isLikelyImageUrl("https://example.test/image.png?cache=1"), true);
assert.equal(isLikelyImageUrl("https://example.test/article"), false);
assert.equal(isLikelyImageUrl("data:image/png;base64,AAAA"), true);

assert.equal(
  extractTextFromHtmlDrop("<p>Hello&nbsp;world</p><script>bad()</script>"),
  "Hello world"
);

const insertedAtEnd = buildTextInsertion({
  value: "Explain this",
  selectionStart: 12,
  selectionEnd: 12
}, "dropped text");

assert.deepEqual(insertedAtEnd, {
  value: "Explain this\ndropped text",
  selectionStart: 25,
  selectionEnd: 25
});

const insertedOverSelection = buildTextInsertion({
  value: "Ask old content now",
  selectionStart: 4,
  selectionEnd: 15
}, "new content");

assert.deepEqual(insertedOverSelection, {
  value: "Ask new content now",
  selectionStart: 15,
  selectionEnd: 15
});

const fileFromList = { name: "image.png" };
assert.deepEqual(getDroppedFiles({
  files: [fileFromList]
}), [fileFromList]);

const fileFromItem = { name: "fallback.txt" };
assert.deepEqual(getDroppedFiles({
  files: [],
  items: [{
    kind: "file",
    getAsFile: () => fileFromItem
  }]
}), [fileFromItem]);

console.log("Side panel drop content tests passed.");

function createDataTransfer(dataByType) {
  return {
    files: [],
    items: [],
    getData(type) {
      return dataByType[type] || "";
    }
  };
}
