import { FRAME_MESSAGES } from "./frame-client.js";
import { createContextDisclosure } from "./context-disclosure.js";

export const CONTEXT_KEYS = Object.freeze({
  prompt: "dichrome.mode2.latestPrompt",
  screenshot: "dichrome.mode2.latestScreenshot",
  notice: "dichrome.mode2.latestNotice",
  draft: "dichrome.mode2.promptDraft",
  attached: "dichrome.mode2.attachedScreenshotId"
});

export function createContextController({ elements, frameClient, showStatus }) {
  const storage = chrome.storage.session || chrome.storage.local;
  let prompt = null;
  let screenshot = null;
  let revision = 0;
  let noticeId;
  let frameReady = false;
  let attachedImageId;
  let pendingImageId;
  let draftWrites = Promise.resolve();
  const attemptedImages = new Set();
  let attachmentTask = null;
  const { setOpen } = createContextDisclosure(elements);
  const run = (button, action) => async () => {
    button.disabled = true;
    try { await action(); } catch (error) { showStatus(error.message || String(error), "error"); }
    finally { button.disabled = button === elements.insertPrompt && !frameReady; }
  };

  elements.promptText.addEventListener("input", () => {
    if (!prompt) return;
    const draft = { promptId: prompt.id, text: elements.promptText.value };
    draftWrites = draftWrites.then(() => storage.set({ [CONTEXT_KEYS.draft]: draft }))
      .catch((error) => showStatus(`Could not save your edit: ${error.message}`, "error"));
  });
  elements.insertPrompt.addEventListener("click", run(elements.insertPrompt, async () => {
    const text = elements.promptText.value.trim();
    if (!text) throw new Error("Write a prompt before inserting it.");
    showStatus("Inserting your prompt…", "info");
    await frameClient.request(FRAME_MESSAGES.INSERT_PROMPT, { prompt: text });
    showStatus("Prompt inserted. Review it in ChatGPT, then press Send when ready.", "success");
  }));
  elements.copyPrompt.addEventListener("click", run(elements.copyPrompt, async () => {
    if (!elements.promptText.value.trim()) throw new Error("Write a prompt before copying it.");
    await navigator.clipboard.writeText(elements.promptText.value);
    showStatus("Prompt copied. Paste it into ChatGPT.", "success");
  }));
  elements.clearPrompt.addEventListener("click", run(elements.clearPrompt, async () => {
    await draftWrites;
    await storage.remove([CONTEXT_KEYS.prompt, CONTEXT_KEYS.draft, CONTEXT_KEYS.notice]);
    await refresh();
    elements.contextToggle.focus();
    showStatus("Selected text cleared from Dichrome.", "success");
  }));
  elements.clearScreenshot.addEventListener("click", run(elements.clearScreenshot, async () => {
    await storage.remove([CONTEXT_KEYS.screenshot, CONTEXT_KEYS.attached, CONTEXT_KEYS.notice]);
    await refresh();
    elements.contextToggle.focus();
    showStatus("Screenshot cleared from Dichrome. Any image already in ChatGPT stays there.", "success");
  }));
  elements.attachScreenshot.addEventListener("click", () => void attachImage(screenshot));
  elements.copyScreenshot.addEventListener("click", run(elements.copyScreenshot, async () => {
    if (!screenshot?.dataUrl) throw new Error("Capture a screenshot first.");
    if (!globalThis.ClipboardItem) throw new Error("Image copying is unavailable. Use Save instead.");
    // Start the clipboard write during the click; image conversion can finish asynchronously.
    const blob = fetch(screenshot.dataUrl).then((response) => response.blob());
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    showStatus("Screenshot copied. Paste it into ChatGPT.", "success");
  }));
  elements.downloadScreenshot.addEventListener("click", () => {
    if (!screenshot?.dataUrl) return;
    const anchor = document.createElement("a");
    anchor.href = screenshot.dataUrl;
    anchor.download = `dichrome-screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
    anchor.click();
    showStatus("Screenshot download started.", "success");
  });

  async function refresh() {
    const currentRevision = ++revision;
    const state = await storage.get(Object.values(CONTEXT_KEYS));
    if (currentRevision !== revision) return;
    const nextPrompt = state[CONTEXT_KEYS.prompt] || null;
    const nextImage = state[CONTEXT_KEYS.screenshot] || null;
    const hasNewImage = nextImage?.id && nextImage.id !== screenshot?.id;
    if (hasNewImage && Date.now() - Date.parse(nextImage.createdAt) < 30000) pendingImageId = nextImage.id;
    if (nextPrompt?.id !== prompt?.id) {
      const draft = state[CONTEXT_KEYS.draft];
      elements.promptText.value = nextPrompt && draft?.promptId === nextPrompt.id ? draft.text : nextPrompt?.prompt || "";
    }
    prompt = nextPrompt;
    screenshot = nextImage;
    attachedImageId = state[CONTEXT_KEYS.attached];
    elements.promptCard.hidden = !prompt?.prompt;
    elements.screenshotCard.hidden = !screenshot?.dataUrl;
    elements.promptLabel.textContent = prompt?.actionLabel || "Selected text";
    setSource(elements.promptSource, prompt);
    elements.screenshotSource.textContent = screenshot?.sourceTitle || "Visible page";
    if (screenshot?.dataUrl) elements.screenshotPreview.src = screenshot.dataUrl;
    else elements.screenshotPreview.removeAttribute("src");
    const count = Number(Boolean(prompt?.prompt)) + Number(Boolean(screenshot?.dataUrl));
    elements.contextCount.textContent = String(count);
    elements.emptyContext.hidden = count > 0;
    const notice = state[CONTEXT_KEYS.notice];
    if (notice?.id && notice.id !== noticeId && !attachmentTask) {
      noticeId = notice.id;
      showStatus(notice.message, notice.kind);
    }
    if (hasNewImage) attachRecentImage();
  }

  function attachRecentImage() {
    if (frameReady && screenshot?.id === pendingImageId && screenshot?.id
      && screenshot.id !== attachedImageId && !attemptedImages.has(screenshot.id)) void attachImage(screenshot);
  }

  async function attachImage(image) {
    if (!image?.dataUrl || attachmentTask) return;
    attemptedImages.add(image.id);
    elements.attachScreenshot.disabled = true;
    elements.attachScreenshot.textContent = "Attaching…";
    showStatus("Attaching screenshot to ChatGPT…", "info");
    attachmentTask = frameClient.request(FRAME_MESSAGES.ATTACH_SCREENSHOT, { screenshot: image }, 45000);
    try {
      await attachmentTask;
      await storage.set({ [CONTEXT_KEYS.attached]: image.id });
      if (screenshot?.id === image.id) showStatus("Screenshot attached. Add your question in ChatGPT when ready.", "success");
    } catch (error) {
      if (screenshot?.id === image.id) showStatus(`Screenshot saved. ${error.message} You can also copy or save the image.`, "warning");
    } finally {
      attachmentTask = null;
      elements.attachScreenshot.disabled = !frameReady;
      elements.attachScreenshot.textContent = "Attach image";
      attachRecentImage();
    }
  }

  return Object.freeze({ refresh, setOpen, setFrameReady(ready) {
    frameReady = ready;
    elements.insertPrompt.disabled = !ready;
    elements.attachScreenshot.disabled = !ready || Boolean(attachmentTask);
    if (ready) attachRecentImage();
  } });
}

function setSource(element, record) {
  element.textContent = record?.sourceTitle || "Selected page";
  element.removeAttribute("href");
  try {
    const url = new URL(record?.sourceUrl);
    if (["http:", "https:"].includes(url.protocol)) {
      element.href = url.href;
      element.title = url.href;
    }
  } catch { element.removeAttribute("title"); }
}
