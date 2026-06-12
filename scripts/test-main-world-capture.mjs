import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const messages = [];
const nowSeconds = Date.now() / 1000;
let responsePayload = {
  conversation_id: "conversation-1",
  mapping: {
    oldAssistant: {
      message: {
        id: "old-message",
        author: {
          role: "assistant"
        },
        content: {
          parts: ["Old answer ".repeat(80)]
        },
        status: "finished_successfully",
        update_time: nowSeconds - 60
      }
    },
    newAssistant: {
      message: {
        id: "new-message",
        author: {
          role: "assistant"
        },
        content: {
          parts: ["New short answer"]
        },
        status: "in_progress",
        update_time: nowSeconds
      }
    }
  }
};
const fakeResponse = {
  headers: {
    get(name) {
      return name.toLowerCase() === "content-type" ? "application/json" : "";
    }
  },
  clone() {
    return this;
  },
  async json() {
    return responsePayload;
  }
};
const context = vm.createContext({
  URL,
  Date,
  TextDecoder,
  location: {
    href: "https://chatgpt.com/c/conversation-1",
    origin: "https://chatgpt.com",
    hostname: "chatgpt.com"
  },
  window: {
    fetch: async () => fakeResponse,
    postMessage(message) {
      messages.push(message);
    }
  }
});
const source = await readFile(new URL("../content/chatgpt/main-world-capture.js", import.meta.url), "utf8");

vm.runInContext(source, context);
await context.window.fetch("https://chatgpt.com/backend-api/conversation", {
  method: "POST"
});
await new Promise((resolve) => setTimeout(resolve, 0));

const conversationMessages = messages.filter((message) => message.type === "CHATGPT_CONVERSATION_RESPONSE");
const latest = conversationMessages[conversationMessages.length - 1];

assert.equal(latest.text, "New short answer");
assert.equal(latest.messageId, "new-message");
assert.equal(latest.conversationKey, "conversation-1");

const previousMessageCount = conversationMessages.length;
responsePayload = {
  conversation_id: "conversation-2",
  mapping: {
    imageStatus: {
      message: {
        id: "image-status-message",
        author: {
          role: "assistant"
        },
        content: {
          parts: ["Analyzing image"]
        },
        status: "finished_successfully",
        update_time: Date.now() / 1000
      }
    }
  }
};

await context.window.fetch("https://chatgpt.com/backend-api/conversation", {
  method: "POST"
});
await new Promise((resolve) => setTimeout(resolve, 0));

const statusMessages = messages
  .filter((message) => message.type === "CHATGPT_CONVERSATION_RESPONSE")
  .slice(previousMessageCount);
const latestStatusMessage = statusMessages[statusMessages.length - 1];

assert.ok(statusMessages.length);
assert.equal(statusMessages.some((message) => message.text === "Analyzing image"), false);
assert.equal(latestStatusMessage.text, "");

console.log("Main-world capture tests passed.");
