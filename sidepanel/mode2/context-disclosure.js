export function createContextDisclosure({ topBar, contextPanel, contextToggle }) {
  const contains = (target) => target instanceof Node
    && (topBar.contains(target) || contextPanel.contains(target));
  let pointerInside = false;
  let keyboardOpen = false;
  let closeTimer;

  function setOpen(open) {
    clearTimeout(closeTimer);
    const restoreFocus = !open && contextPanel.contains(document.activeElement);
    contextPanel.hidden = !open;
    contextPanel.inert = !open;
    contextToggle.setAttribute("aria-expanded", String(open));
    if (!open) {
      keyboardOpen = false;
      if (restoreFocus) contextToggle.focus();
    }
  }

  for (const region of [topBar, contextPanel]) {
    region.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "touch") return;
      clearTimeout(closeTimer);
      pointerInside = true;
      // Only entering the toolbar reveals context; moving between its children does not reopen it after Escape.
      if (region === topBar && !contains(event.relatedTarget)) setOpen(true);
    });
    region.addEventListener("pointerleave", (event) => {
      if (event.pointerType === "touch") return;
      pointerInside = contains(event.relatedTarget);
      if (!pointerInside) {
        clearTimeout(closeTimer);
        closeTimer = setTimeout(() => {
          if (!(keyboardOpen && contains(document.activeElement))) setOpen(false);
        }, 160);
      }
    });
    region.addEventListener("keydown", (event) => {
      if (event.key === "Tab" && !contextPanel.hidden) keyboardOpen = true;
    });
    region.addEventListener("focusout", (event) => {
      if (!pointerInside && !contains(event.relatedTarget)) setOpen(false);
    });
  }

  contextToggle.addEventListener("click", (event) => {
    const keyboard = event.detail === 0;
    const toggle = keyboard || event.pointerType === "touch";
    setOpen(toggle ? contextPanel.hidden : true);
    keyboardOpen = keyboard && !contextPanel.hidden;
  });
  document.addEventListener("pointerdown", (event) => {
    keyboardOpen = false;
    if (!contains(event.target)) setOpen(false);
  });

  return Object.freeze({ setOpen });
}
