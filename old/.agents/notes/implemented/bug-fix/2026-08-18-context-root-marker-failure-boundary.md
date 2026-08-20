# Agent Note: bound instruction discovery at unavailable root markers

Status: implemented

English | [中文](2026-08-18-context-root-marker-failure-boundary.zh.md)

## Problem

Workspace instruction discovery distinguished a present root marker from every other outcome. A filesystem provider resolution or metadata failure therefore looked like confirmed absence, and discovery continued into parent directories. A session whose own marker was temporarily unobservable could receive `AGENTS.md` content from a different ancestor project.

## Decision

Root-marker probes have three outcomes: present, absent, and unavailable. A present configured marker selects its directory as the project root. Confirmed absence permits the search to continue upward. When no configured marker is present and at least one probe is unavailable, the current directory becomes the conservative root; discovery retains instructions between that directory and the session cwd but does not cross into its parent. Provider and host-filesystem probes use the same classification, and missing-path errors remain confirmed absence.

The root is recomputed at each context composition. When a temporary failure clears, the normal baseline identity comparison can replace the conservative instruction chain with the fully observed chain.

## Verification and boundary

The regression places a session below an outer marked project, makes the session cwd marker probe fail, and gives both directories distinct instruction files. The composed baseline retains the cwd instruction and excludes the outer project instruction. Existing coverage keeps confirmed missing markers, ordinary marked ancestors, multiple candidates, cancellation, resume, and unavailable instruction-file candidates distinct from this root-discovery rule.

This decision bounds root discovery only. An instruction candidate inside the selected chain still follows its existing tri-state availability and sibling-candidate behavior.

## Alternatives considered

**Continue treating probe failures as absence.** This preserves broader discovery during transient provider failures but allows an unobserved directory boundary to import a different project's instructions into model context.

**Abort the complete instruction injection.** This fails closed against ancestor content but also discards directly observable cwd instructions. Bounding the root preserves the safe portion of the chain.

**Always fall back to the session cwd after any failure.** A failure several directories above the cwd would unnecessarily discard observable instructions below that directory. The failing directory itself is the narrowest root that prevents crossing the unknown boundary.

## Consequences

Provider and host-filesystem failures cannot make workspace context cross an unobservable root boundary. A transient failure can temporarily omit valid broader instructions, but directly observable instructions at and below the conservative root remain available, and a later composition repairs the baseline after observation recovers.
