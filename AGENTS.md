# AGENTS.md

## Work and verification

Read `package.json`, affected code, and installed Pi public types/docs/examples before changing an integration. Use public extension APIs; do not modify installed Pi source or depend on private implementation. Run `npm run verify` before handing off changes.

Keep the direct TypeScript entry `src/index.ts` and its default `ExtensionAPI` factory synchronous and free of settings I/O or feature initialization. Register resources immediately; load expensive implementation when its callback needs it. Pi-host packages remain optional `"*"` peers and development dependencies, not bundled copies.

## Settings

This extension was generated without a settings subsystem. Do not add one solely for an `enabled` switch; Pi package configuration can prevent the extension from loading. Add `@zigai/pi-extension-settings` only when the extension gains real user-editable behavior, then follow its installed `docs/manual-setup.md` and `docs/runtime.md` guidance.

## Resource and UI ownership

Do not add a generic lifecycle framework. For owned asynchronous work/resources, handle cancellation, stale completion, failed activation, and exactly-once disposal; dispose before clearing state and test failure/replacement paths.

Renderers receive `ToolRenderContext`, not `ExtensionContext`. Never load settings there or retain an execution context for rendering. Use arguments, results, and renderer state; return a component even for history or before execution/activation. Guard dialogs with `ctx.hasUI` and terminal-only UI with `ctx.mode === "tui"`.

## Implementation and evidence

Keep small extensions flat and split substantial behavior by concrete capability. Separate pure decisions from Pi mechanics; avoid unchecked casts, non-null assertions, speculative abstractions, and pass-through layers.

Give tools/commands useful descriptions, use Pi's `StringEnum` for model-facing enums, and truncate large tool output with a path to the full output. File tools use `withFileMutationQueue` around the complete read-modify-write operation.

Test observable behavior without module mocks or method spies. Keep real loader tests isolated for the whole lifecycle. Add enabled/disabled, failure, async, TUI, and RPC evidence only for behavior the extension actually owns.

Keep `scripts/package-check.mjs` focused on the published npm artifact: declared files, dependency topology, excluded development files, absolute-path leakage, and loading the installed tarball. Preserve pre-commit and CI's `npm ci` / `npm run verify` gates.

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues in `smb374/pi-subagents-plus`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles, each label string equal to its role name (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
