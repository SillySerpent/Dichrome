# Plans

## Hidden Internal Cleanup And Robustness Plan

This plan is the next development phase after the Chrome Web Store readiness pass. The product direction is to make Dichrome a stable sidebar client backed by one normal automation route:

```text
User sidebar UI
-> central state/routing controller
-> hidden internal ChatGPT automation pathway
-> normalized response/error/result events
-> sidebar rendering layer
```

Visible ChatGPT tabs are allowed only for explicit authentication/setup handoff. They must not be a normal automation fallback.

### Phase 1: Remove User-Facing Debug And Repair Surfaces

Tasks:

- Remove the normal side-panel `Routing, automation, and debug` details block from the main user experience.
- Remove visible local repair controls, debug dump button, event log, automation target status, and automation mode selector from `sidepanel/sidepanel.html`.
- Keep product-facing controls only: project history, workspace/project affordance, model choice, message composer, attachments, retry/cancel, and explicit login/setup action when needed.
- Remove corresponding unused DOM bindings and event handlers from `sidepanel/runtime/dom.js` and `sidepanel/runtime/app.js`.
- Keep internal debug collection callable only from extension internals or a future separate developer surface.

Acceptance criteria:

- Main UI no longer shows repair/debug/local controls.
- Normal users never see "automation target", "debug dump", "local repair", or event-log internals.
- Hidden internal send, follow-up, project history, model selection, and attachments still work through the product UI.
- Side-panel layout tests assert these debug/repair controls are absent from visible HTML.

### Phase 2: Make Hidden Internal The Only Normal Automation Route

Tasks:

- Coerce stored visibility settings to hidden internal during settings sanitization.
- Migrate legacy `single-tab`, `sidecar`, `focused`, and `seamless` values to hidden.
- Remove the normal request fallback from hidden internal to inactive/visible ChatGPT tabs in `background/runtime/app.js`.
- Convert hidden-frame unavailable, frame disconnected, and frame-policy failures into explicit user-facing error codes instead of automatic tab fallback.
- Keep one visible-tab path for user-triggered authentication/setup handoff only.
- Rename user-facing and log wording away from "tab ready" and competing modes; use "workspace ready" or "hidden workspace ready".
- Audit permissions after route removal. Remove `debugger` if no normal path uses focus emulation, and remove `windows` if auth handoff does not need window management.

Acceptance criteria:

- No normal request creates, focuses, or controls a visible ChatGPT tab.
- No side-panel option offers single-tab, sidecar, or focused modes.
- Hidden internal failure produces a bounded terminal state, not a hidden loop or tab fallback.
- Tests prove stale non-hidden visibility settings sanitize to hidden.

### Phase 3: First-Run And Logged-Out State Handling

Tasks:

- Add `REQUEST_ERROR_CODES` to shared contracts and persist `errorCode` on request records.
- Include at least: `AUTH_REQUIRED`, `HIDDEN_FRAME_UNAVAILABLE`, `PROJECT_UNAVAILABLE`, `MODEL_UNAVAILABLE`, `UPLOAD_REJECTED`, `RATE_LIMITED`, and `CHATGPT_UNAVAILABLE`.
- Detect logged-out/account-gate states from ChatGPT `/auth` URLs, login/signup copy, missing/invalid ChatGPT session token, 401/403 backend responses, and hidden frame composer/session unavailability.
- Add side-panel auth state rendering with: "Sign in to ChatGPT to use Dichrome." and a user action labelled "Open ChatGPT to sign in."
- After login, retry by re-probing hidden internal and reloading project history once.
- On fresh install or stale cached project state, start from `idle` or `loading` instead of showing misleading empty history.

Acceptance criteria:

- Logged-out send and project-history load show actionable login UI.
- Project history has explicit `logged-out` state and does not silently fail.
- Retry after login is deterministic and bounded.
- Stale cached project/conversation state is cleared or revalidated before display.

### Phase 4: Model, Upload, And Usage-Limit Robustness

Tasks:

- Keep model selection as a pre-send invariant.
- If the requested model cannot be found, confirmed, or is visibly unavailable/upgrade-gated, stop before prompt insertion.
- Show concise user-facing model errors, for example: "Model not available on this ChatGPT account: Thinking."
- Do not update active conversation metadata after failed model selection.
- Track pending attachments as `ready`, `uploading`, `uploaded`, `rejected`, or `failed`.
- Detect file too large, unsupported type, no compatible file input, ChatGPT upload rejection, image/file limit reached, and temporary upload failures.
- Prevent send success UI when any required attachment failed.
- Detect common rate, usage, and temporary limit copy in ChatGPT error UI and map it to `RATE_LIMITED` or `CHATGPT_UNAVAILABLE`.

Acceptance criteria:

- Unavailable model and failed model switch are visible, specific, and pre-send.
- Failed attachments do not remain as "ready" chips.
- The user can remove failed attachments or retry where safe.
- Rate/limit errors are surfaced as product messages, not raw debug strings.

### Phase 5: Project History Controller And UI Cleanup

Tasks:

- Replace boolean-heavy project history state with one authoritative status model: `idle`, `loading`, `loaded`, `empty`, `error`, `logged-out`, and `pending-auth`.
- Make the side panel the single project-history load coordinator.
- Make background project-history commands execute one hidden-history operation and return a normalized result/error.
- Remove background tab fallback and hidden-failure cache behavior from project-history list/load paths.
- Coalesce duplicate list/load requests by project key and cursor.
- Preserve scroll position when appending older conversations by anchoring on old/new `scrollHeight` delta.
- Preserve `historyList.scrollTop` when selecting a lower conversation.
- Remove hover-only expansion behavior that collapses/expands the list unexpectedly.
- Use stable row heights, larger spacing, controlled max height, and graceful title truncation.

Acceptance criteria:

- Clicking a lower conversation does not jump the history scroll.
- Loading older history preserves scroll anchoring.
- Already-loaded conversations are not redundantly reloaded.
- Status text no longer flickers between competing loading phrases.
- History UI reads as a stable product surface, not a debug list.

### Phase 6: Dead-Path Removal, Observability, And Docs

Tasks:

- After hidden-only behavior is covered by tests, remove or isolate dead tab automation helpers, focus-emulation paths, local repair settings, and retry-with-hints flow.
- Remove legacy docs/manual smoke tests for single-tab, sidecar, focused, and local repair.
- Keep structured internal logs with consistent fields: `scope`, `requestId`, `projectKey`, `conversationId`, `phase`, `errorCode`, and `attempt`.
- Bound all retry loops with explicit max attempts and delay caps.
- Update README, architecture notes, hidden-internal invariants, Chrome Web Store submission notes, privacy policy, and manual smoke tests to match hidden-internal-only behavior.

Acceptance criteria:

- `rg` finds no user-facing references to single-tab, sidecar, focused mode, local repair, or debug dump.
- Validator fails if visible debug/repair controls or non-hidden user automation modes return.
- Store permission justifications match the manifest after permission removal.
- Manual smoke docs cover hidden internal, login handoff, project history, model errors, upload errors, and fresh install.

## Interface And State Changes

- Add `REQUEST_ERROR_CODES` in shared contracts and persist `errorCode` on request records.
- Add normalized project-history statuses: `idle`, `loading`, `loaded`, `empty`, `error`, `logged-out`, and `pending-auth`.
- Add a user-triggered auth handoff command, either `OPEN_CHATGPT_AUTH` or a narrowed replacement for `OPEN_CHATGPT_TAB`; it must be documented as login/setup only.
- Replace user-facing `CHATGPT_TAB_READY` wording with hidden-workspace wording first. Rename the enum later only if the blast radius stays manageable.

## Test Requirements

Use the existing dependency-free Node test style under `scripts/test-*.mjs`.

Required coverage:

- Legacy visibility settings sanitize to hidden.
- Hidden internal unavailable returns a clear error, not tab fallback.
- Logged-out first run and project-history logged-out state.
- Successful hidden internal project-history load.
- Project not found.
- Duplicate project-history load coalescing.
- Stale cached project state.
- Project-history pagination preserves scroll anchor.
- Selecting a lower conversation preserves list scroll.
- Unavailable model and failed model switch stop before prompt insertion.
- Upload rejection, file too large, and unsupported file state.
- Successful normal send and follow-up through hidden internal.

Standard gate before each cleanup commit:

```bash
npm run check
npm test
git diff --check
npm run package
```

Manual Chrome verification remains required for hidden-frame login/session behavior, real ChatGPT model picker behavior, and real file upload limit behavior.

## Assumptions

- The next implementation should not preserve automatic inactive-tab fallback as a normal product path.
- A visible ChatGPT page is allowed only as an explicit user-triggered login/setup handoff.
- `.dist/` artifacts remain ignored and must not be committed.
