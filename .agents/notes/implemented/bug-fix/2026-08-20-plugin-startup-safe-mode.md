# Agent Note: Plugin startup safe mode

Status: implemented

English | [中文](2026-08-20-plugin-startup-safe-mode.zh.md)

## Problem

A plugin import or activation failure can reject the profile before the web or terminal surface becomes usable. The existing fail-loud path reports the failure and exits, but gives the operator no way to start the harness long enough to repair the offending plugin.

## Decision

The CLI treats Loader activation failures as recoverable once per invocation. The first child restart keeps the normal profile composition and appends in-memory `disabled: true` patches for entries named by the Loader error. If no entry can be identified, or that retry fails, a second restart uses all-plugin recovery: it resolves only the shipped profile bundles and omits the profile patch, home patch, and `--patch` overlays.

Recovery is process-scoped and does not remove npm packages or rewrite profile files. Environment inputs are bounded and validated before they become patch ids. A recovery child cannot recurse after the all-plugin attempt fails; it returns the original startup failure.

Set `DSH_SAFE_MODE_DISABLED=1` to disable automatic recovery while diagnosing the original fail-fast path.

## Consequences

The operator gets a usable safe session and a stderr report naming suspected entry ids and module names. A culprit retry preserves unrelated plugins; the all-plugin fallback intentionally provides only the shipped base surface, so application features supplied by skipped plugins are unavailable until the normal profile is repaired. Installed packages remain available for inspection or removal with the explicit plugin command.

## Testing

`identifyStartupPluginFailures` covers exact entry matching and non-plugin patch errors. `loadProfile(..., { bundles })` covers resolving an allowlisted bundle set without importing a skipped broken bundle. A built-bin subprocess fixture proves that a failed entry is reported and disabled, an unrelated healthy entry reaches its running state, the recovery process shuts down normally, and the profile manifest and patch remain byte-identical. The pre-existing fail-fast E2E runs with `DSH_SAFE_MODE_DISABLED=1`. Focused CLI and app-boot tests pass after restoring the local dependency view; the earlier pnpm rebuild failure at `node-pty@1.2.0-beta.15` was an environment setup failure, not a product result.
