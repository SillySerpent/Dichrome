(() => {
  if (!["http:", "https:"].includes(location.protocol)
    || ["chatgpt.com", "chat.openai.com"].includes(location.hostname)
    || document.querySelector("[data-chatgpt-sidebar-popover]")) return;

  const prefix = "chatgpt-sidebar:";
  let host, shadow, feedback, more, timer, frame;
  let selectedText = "";
  let busy = false;
  let interacting = false;
  let dismissedText = "";

  const inside = (event) => host && event.composedPath().includes(host);
  document.addEventListener("pointerdown", (event) => {
    interacting = Boolean(inside(event));
    if (!interacting) hide();
  }, true);
  document.addEventListener("pointerup", (event) => {
    if (!inside(event)) schedule();
    setTimeout(() => { interacting = false; }, 0);
  }, true);
  document.addEventListener("pointercancel", () => { interacting = false; }, true);
  document.addEventListener("selectionchange", () => {
    if (!interacting && !busy) schedule();
  });
  document.addEventListener("keyup", (event) => {
    if (event.key === "Escape") {
      dismissedText = selectedText;
      hide();
    } else if (!inside(event)) schedule();
  }, true);
  window.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type !== `${prefix}get-selection`) return false;
    respond({ selectedText: readSelection()?.text || "", pageTitle: document.title, pageUrl: location.href });
    return false;
  });

  function schedule() {
    clearTimeout(timer);
    if (busy || interacting) return;
    timer = setTimeout(() => {
      const selection = readSelection();
      if (!selection) { dismissedText = ""; hide(); return; }
      if (selection.text === dismissedText) return;
      selectedText = selection.text;
      show(selection.rect);
    }, 80);
  }

  function readSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    if (selection.anchorNode?.parentElement?.closest('input, textarea, [contenteditable="true"]')) return null;
    const text = selection.toString().trim();
    if (text.length < 2) return null;
    const range = selection.getRangeAt(selection.rangeCount - 1);
    const rects = [...range.getClientRects()].filter((rect) => rect.width && rect.height);
    const rect = rects.at(-1) || range.getBoundingClientRect();
    return rect.width && rect.height ? { text, rect } : null;
  }

  function show(rect) {
    ensurePopover();
    feedback.hidden = true;
    more.hidden = true;
    shadow.querySelector('[aria-expanded]').setAttribute("aria-expanded", "false");
    host.style.setProperty("display", "block", "important");
    host.style.setProperty("visibility", "hidden", "important");
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const box = host.getBoundingClientRect();
      const left = Math.max(8, Math.min(rect.left, innerWidth - box.width - 8));
      const below = rect.bottom + 6;
      const top = below + box.height < innerHeight - 8 ? below : Math.max(8, rect.top - box.height - 6);
      host.style.setProperty("left", `${Math.round(left)}px`, "important");
      host.style.setProperty("top", `${Math.round(top)}px`, "important");
      host.style.setProperty("visibility", "visible", "important");
    });
  }

  function ensurePopover() {
    if (host) return;
    host = document.createElement("div");
    host.setAttribute("data-chatgpt-sidebar-popover", "true");
    for (const [property, value] of Object.entries({
      all: "initial", position: "fixed", "z-index": "2147483647", display: "none",
      "max-width": "calc(100vw - 16px)", "color-scheme": "dark"
    })) host.style.setProperty(property, value, "important");
    shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      * {box-sizing:border-box} [hidden] {display:none!important}
      .surface {padding:3px;background:#202826;color:#edf5f1;border:1px solid #45534e;
        border-radius:9px;box-shadow:0 4px 16px #0003;font:12px/1.4 system-ui,sans-serif;max-width:calc(100vw - 16px)}
      .toolbar,.more {display:flex;align-items:center;gap:1px;flex-wrap:wrap}
      button {font:500 12px/1 system-ui,sans-serif;color:inherit;border:0;border-radius:5px;
        background:transparent;cursor:pointer;padding:8px 7px;min-height:28px}
      button:hover {background:#35483f} button:focus-visible {outline:2px solid #8ce6b9;outline-offset:-2px}
      button:disabled {opacity:.5;cursor:wait} .ask {color:#9aebc1} .more {border-top:1px solid #45534e;margin-top:3px;padding-top:3px}
      .feedback {max-width:260px;padding:6px 8px;color:#b9f3d3;white-space:normal}
      .feedback[data-error=true] {color:#ffd2bd}
    `;
    const surface = document.createElement("div");
    surface.className = "surface";
    const toolbar = document.createElement("div");
    toolbar.className = "toolbar";
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "Dichrome selection actions");
    more = document.createElement("div");
    more.className = "more";
    more.hidden = true;
    more.id = "moreActions";
    for (const [action, label] of [["ask", "Ask"], ["summarize", "Summarize"], ["explain", "Explain"]]) {
      const button = makeButton(label, () => runAction(action));
      if (action === "ask") button.className = "ask";
      toolbar.append(button);
    }
    const expand = makeButton("···", () => {
      more.hidden = !more.hidden;
      expand.setAttribute("aria-expanded", String(!more.hidden));
      const rect = host.getBoundingClientRect();
      if (rect.bottom > innerHeight - 8) host.style.setProperty("top", `${Math.max(8, innerHeight - rect.height - 8)}px`, "important");
    });
    expand.setAttribute("aria-label", "More selection actions");
    expand.setAttribute("aria-expanded", "false");
    expand.setAttribute("aria-controls", "moreActions");
    toolbar.append(expand);
    for (const [action, label] of [["rewrite", "Rewrite"], ["define", "Define"], ["screenshot", "Screenshot"]]) {
      more.append(makeButton(label, () => runAction(action)));
    }
    feedback = document.createElement("div");
    feedback.className = "feedback";
    feedback.setAttribute("role", "status");
    feedback.hidden = true;
    surface.append(toolbar, more, feedback);
    shadow.append(style, surface);
    document.documentElement.append(host);
  }

  function makeButton(label, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => { event.stopPropagation(); void action(); });
    return button;
  }

  async function runAction(action) {
    if (busy) return;
    busy = true;
    clearTimeout(timer);
    const buttons = [...shadow.querySelectorAll("button")];
    buttons.forEach((button) => { button.disabled = true; });
    feedback.hidden = false;
    feedback.dataset.error = "false";
    feedback.textContent = "Opening Dichrome…";
    try {
      // Keep this send in the click gesture, before any asynchronous work.
      const response = await chrome.runtime.sendMessage(action === "screenshot" ? {
        type: `${prefix}capture-visible-tab`, source: "selection-popover"
      } : {
        type: `${prefix}selection-action`, action, selectedText,
        pageTitle: document.title, pageUrl: location.href
      });
      if (!response?.ok || response.queued === false) throw new Error(response?.error || "Select some text and try again.");
      if (response.panelOpened === false) {
        feedback.textContent = "Context saved. Open Dichrome from the extension toolbar.";
        feedback.dataset.error = "true";
      } else {
        feedback.textContent = "Ready in Dichrome. Review your context in the sidebar.";
        dismissedText = selectedText;
        timer = setTimeout(hide, 2400);
      }
    } catch (error) {
      feedback.dataset.error = "true";
      feedback.textContent = /context invalidated|receiving end/i.test(error?.message || "")
        ? "Dichrome was reloaded. Refresh this page and try again."
        : error?.message || "Could not open Dichrome. Try again.";
    } finally {
      busy = false;
      buttons.forEach((button) => { button.disabled = false; });
    }
  }

  function hide() {
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    host?.style.setProperty("display", "none", "important");
  }
})();
