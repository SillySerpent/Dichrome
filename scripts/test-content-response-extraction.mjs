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
        id: "user-message",
        author: {
          role: "human"
        },
        content: {
          parts: [
            {
              text: "Prompt"
            }
          ]
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
const messages = extraction.selectConversationMessagesFromConversationData(data);

assert.equal(latest.messageId, "new-message");
assert.equal(latest.text, "New\n\nanswer");
assert.equal(latest.html, "");
assert.equal(messages.map((message) => message.role).join(","), "user,assistant,assistant");
assert.equal(messages[0].id, "user-message");
assert.equal(messages[0].text, "Prompt");
assert.equal(messages[2].text, "New\n\nanswer");
assert.equal(extraction.selectLatestAssistantResponseFromConversationData(data, {
  excludedMessageIds: ["new-message"]
}).messageId, "old-message");
assert.equal(extraction.selectLatestAssistantResponseFromConversationData(data, {
  afterMs: Date.now() + 60_000
}), null);
assert.equal(extraction.selectLatestAssistantResponseFromConversationData({
  mapping: {
    staleAssistant: {
      id: "staleAssistant",
      message: {
        id: "stale-message",
        author: {
          role: "assistant"
        },
        content: {
          parts: ["Older answer without a timestamp"]
        },
        status: "finished_successfully"
      }
    }
  }
}, {
  afterMs: Date.now() - 1000
}), null);
assert.equal(extraction.shouldPreferBackendResponse("Long backend answer text", "short", "explain term"), true);
assert.equal(extraction.shouldPreferBackendResponse("", "dom", "explain"), false);
assert.equal(extraction.isLowConfidenceDomResponse("term", "define selected word"), true);
assert.equal(extraction.isLowConfidenceDomResponse("This is a full explanation.", "define selected word"), false);
assert.equal(extraction.isFinishedBackendStatus("finished_successfully"), true);
assert.equal(extraction.isFinishedBackendStatus("streaming"), false);
assert.equal(extraction.isTransientAssistantStatusText("Thinking"), true);
assert.equal(extraction.isTransientAssistantStatusText("Thought for a couple of seconds"), true);
assert.equal(extraction.isTransientAssistantStatusText("Analyzing image"), true);
assert.equal(extraction.isTransientAssistantStatusText("Analysing the attached file..."), true);
assert.equal(extraction.isLowConfidenceDomResponse("Thinking", "Can you see this?"), true);
assert.equal(extraction.isTransientAssistantStatusText("Thinking through the tradeoffs, this answer is complete."), false);
assert.equal(extraction.isTransientAssistantStatusText("Analyzing image quality requires checking the light source."), false);

const metadataFallback = extraction.selectConversationMessagesFromConversationData({
  mapping: {
    userFallback: {
      id: "userFallback",
      message: {
        id: "user-fallback-message",
        author: {
          role: "user"
        },
        content: {
          parts: []
        },
        metadata: {
          user_message_text: "Recovered user text"
        },
        create_time: nowSeconds
      }
    }
  }
});

assert.equal(metadataFallback[0].text, "Recovered user text");

console.log("Content response extraction tests passed.");
