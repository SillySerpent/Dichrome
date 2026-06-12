# Plans

## Cleanup Baseline

Dichrome is now structured around one default companion route plus one switchable beta automation route:

```text
User side-panel shell
-> active mode registry
-> Mode 2 ChatGPT sidebar companion by default
-> shared source actions for selection and screenshots
-> optional Mode 1 original Dichrome beta
-> hidden internal ChatGPT workspace for Mode 1 only
-> normalized response/error/result events for Mode 1
-> Mode 1 rendering layer
```

Mode 2 is the first-run default. Mode 1 remains available as `Mode 1 - Original Dichrome Beta` after an explicit warning acknowledgement. Visible ChatGPT tabs are allowed only for explicit authentication/setup handoff through `OPEN_CHATGPT_AUTH`; Mode 2's companion popup window is user-triggered and is not an automation target.

Completed cleanup:

- Visible-tab automation helpers and debugger focus-emulation code were removed from the product route and package.
- `WORKSPACE_READY` replaced newly emitted hidden-workspace readiness events. Old stored `CHATGPT_TAB_READY` records are normalized when panel state is read.
- Visibility settings are hidden-only at schema version 6: `{ "mode": "hidden" }`.
- Obsolete visible-window storage is no longer read and is removed best-effort from local extension storage.
- Background listener registration, request orchestration, workspace readiness, event persistence, error classification, and side-panel open/close state are split into focused runtime modules.
- Side-panel message-card rendering, pending attachment rendering, and status formatting are split out of the main app module.
- Project-history payload normalization is split from the ChatGPT-side project-history controller.
- Response escaping and sanitization helpers are split behind the existing `shared/response-formatting.js` facade.
- Non-Chromium package support was removed; Dichrome no longer carries alternate-browser manifests, sidebar-host automation, or compatibility code.
- The root side panel is a shell that loads Mode 2 by default and loads Mode 1 only after a user switch.
- Mode switching is stored in `dichrome.activeMode`; fresh installs default to Mode 2, while legacy original Dichrome storage migrates to Mode 1.
- Mode 1 switching is guarded with an early beta acknowledgement and active-request cancellation guard.
- Mode 2 code is integrated under `background/mode2/`, `content/mode2/`, and `sidepanel/mode2/`; the standalone prototype source folder is no longer part of the package.
- Shared context-menu, selection-popover, visible screenshot, and keyboard shortcut entrypoints now dispatch through the active mode.
- Static validation fails if deleted visible-tab automation files, visible automation route helpers, user-facing debug/repair controls, or old visible route strings return.

## Maintenance Checklist

Before changing hidden automation, request state, side-panel rendering, or packaging:

```bash
npm run check
npm test
git diff --check
```

Before uploading or reviewing a store package:

```bash
npm run package
```

Keep these docs synchronized when behavior changes:

- `README.md`
- `docs/architecture.md`
- `docs/module-map.md`
- `docs/hidden-internal-invariants.md`
- `docs/setup-and-usage.md`
- `docs/manual-smoke-tests.md`
- `docs/chrome-web-store-submission.md`
- `docs/privacy-policy.md`
- `docs/mode-integration-plan.md`

Manual browser smoke coverage remains required for Mode 2 embedded/fallback ChatGPT behavior, mode switching and switch guards, Chrome offscreen iframe behavior in Mode 1, signed-out handoff, real ChatGPT project routing/history, model picker changes, upload limits, visible screenshot capture, and follow-up conversation continuity.
