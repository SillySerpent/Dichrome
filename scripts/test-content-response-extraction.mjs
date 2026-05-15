import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const context = vm.createContext({});
const source = await readFile(new URL("../content/chatgpt/runtime/response/extraction.js", import.meta.url), "utf8");

vm.runInContext(source, context);

const extraction = context.ChatGptRelay.runtime.responseExtraction;
const nowSeconds = Math.floor(Date.now() / 1000);
const data = {
  mapping: {
    user: {
      id: "user",
      message: {
        author: {
          role: "user"
        },
        content: {
          parts: ["Prompt"]
        },
        create_time: nowSeconds - 10
      }
    },
    oldAssistant: {
      id: "oldAssistant",
      message: {
        id: "old-message",
        author: {
          role: "assistant"
        },
        content: {
          parts: ["Old answer"]
        },
        status: "finished_successfully",
        create_time: nowSeconds - 5
      }
    },
    newAssistant: {
      id: "newAssistant",
      message: {
        id: "new-message",
        author: {
          role: "assistant"
        },
        content: {
          parts: [
            {
              parts: ["New", "answer"]
            }
          ]
        },
        metadata: {
          finish_details: {
            type: "stop"
          }
        },
        update_time: nowSeconds
      }
    }
  }
};

const latest = extraction.selectLatestAssistantResponseFromConversationData(data);

assert.equal(latest.messageId, "new-message");
assert.equal(latest.text, "New\n\nanswer");
assert.equal(latest.html, "");
assert.equal(extraction.shouldPreferBackendResponse("Long backend answer text", "short", "explain term"), true);
assert.equal(extraction.shouldPreferBackendResponse("", "dom", "explain"), false);
assert.equal(extraction.isLowConfidenceDomResponse("term", "define selected word"), true);
assert.equal(extraction.isLowConfidenceDomResponse("This is a full explanation.", "define selected word"), false);
assert.equal(extraction.isFinishedBackendStatus("finished_successfully"), true);
assert.equal(extraction.isFinishedBackendStatus("streaming"), false);

console.log("Content response extraction tests passed.");
