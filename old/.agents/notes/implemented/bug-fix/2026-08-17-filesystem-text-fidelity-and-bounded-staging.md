# Agent Note: Preserve text fidelity and bound atomic staging names

Status: implemented

English | [中文](2026-08-17-filesystem-text-fidelity-and-bounded-staging.zh.md)

## Problem

Literal editing normalized CRLF before matching and normalized a second time while restoring the dominant storage style. A source sequence containing a lone carriage return immediately before CRLF therefore lost one carriage return on write-back. Dominant-style detection sampled only the first 4096 UTF-16 code units, so a longer file whose later lines established the dominant style could be rewritten in the wrong style. Separately, local atomic staging repeated the complete destination basename in both generated path components, causing otherwise valid long filenames to exceed a filesystem component limit. Model-facing read truncation could also end on the high half of a UTF-16 surrogate pair.

## Decision

Local and E2B literal editing scans the complete decoded edit basis to count LF and CRLF separators. CRLF restoration expands the already-canonical LF separators exactly once; it does not normalize again, so a lone carriage return retained in the canonical text remains present after restoration. Local atomic writes use fixed-length generated staging-directory names and the fixed filename `content.tmp`, independent of the destination basename. Read truncation keeps its configured UTF-16 code-unit limit and backs up one code unit when the limit falls between a valid surrogate pair.

## Alternatives considered

**Reject files containing a lone carriage return next to CRLF.** Rejected because literal editing can preserve these bytes without weakening binary or UTF-8 validation, while rejection would remove editing support from valid text files.

**Encode anomalous carriage returns with a sentinel during normalization.** Rejected because direct single-pass restoration preserves them without inventing an escape value that could collide with file content.

**Keep a prefix sample for line-ending detection.** Rejected because the decoded edit basis is already resident in memory and a linear scan adds bounded CPU without another allocation; a prefix cannot represent a file whose dominant style changes later.

**Truncate by Unicode code point instead of UTF-16 code unit.** Rejected because the public configuration and JavaScript string APIs define the existing limit in characters as UTF-16 code units. Backing up only at a surrogate boundary preserves valid output without expanding the configured cap or changing ordinary truncation.

## Consequences

Literal edits preserve adjacent lone carriage returns and consistently choose the dominant style of the full file. The full scan is linear in the already-decoded input. A returned truncated line can contain one fewer code unit than its configured maximum when the boundary intersects a surrogate pair. Atomic staging paths add fixed overhead independent of the target filename while retaining sibling-directory publication, exclusive creation, private modes, Windows DACL handling, and cleanup behavior.
