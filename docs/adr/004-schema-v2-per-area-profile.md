# ADR-004 — Schema v2: per-area profile + list_area_questions tool

Status: accepted
Date: 2026-05-18
Sprint: 11 (`sarturko-maker/goose` SPRINT_LOG)

## Context

Sprint 6 shipped this MCP with schema v1 — a unified profile where each
`PracticeArea` carries `{id, name, body, source}` and `body` is a free-text
default-description string. Sprint 11 vendors Anthropic's `claude-for-legal`
(per the parent repo's ADR-031) as a bundled in-house skill library. Upstream's
per-plugin cold-start interviews include area-specific questions that
materially shape how each plugin's skills perform. The Sprint 11 brief drops
the per-plugin onboarding scaffolding and folds the content into the unified
onboarding's new **P3.5 per-area mini-interview** phase.

Parent ADR: `/srv/projects/goose/docs/adr/032-onboarding-schema-v2-per-area-
interviews.md`. The parent decision spans schema, UI, system prompt, and this
MCP; this ADR records the sibling-repo side.

## Decision

Two changes:

1. **Schema v2.** `PracticeArea` gains optional `area_profile: Record<string,
   string> | null` — free-text answers keyed by question id (from the new
   tool, below). v1 profiles continue to load: `ProfileStore.read()` tries
   v2 first, falls back to v1, and calls `migrateV1ToV2` (synthesises
   `area_profile: null` on every area). Disk is not rewritten until the next
   `finalize_profile` call.
2. **New tool `list_area_questions(plugin_id)`.** Reads
   `${OSCAR_RESOURCES_ROOT}/skills/in-house-legal/<plugin_id>/onboarding-
   questions.json` and returns a `{plugin_id, questions: [{id, prompt,
   priority}, ...]}` payload. Returns an empty `questions` array when
   `OSCAR_RESOURCES_ROOT` is unset (dev fallback) or the file is missing.

`OSCAR_RESOURCES_ROOT` is set by the Electron main process when it spawns
this MCP (parent ADR-027 pattern; main passes the resolved resourcesPath as
an environment variable). The MCP does not probe filesystem paths itself.

## Rationale

- **`body: string` cannot carry structured Q&A.** Flat strings work for
  default-description copy but not for per-area answer maps. v2's
  `area_profile` is the cleanest shape; the migration cost is one read-time
  function.
- **Discover-via-tool, not via-config-path.** `list_area_questions` is the
  contract surface; the MCP doesn't depend on the bundled-skills directory
  layout beyond a single env var. Path-derived data lives in JSON files the
  per-plugin agents already produced (`onboarding-questions.json` per
  plugin); the MCP doesn't bake in those paths.
- **Read-time migration over file rewrite-on-load.** A v1 profile on disk
  stays v1 until the next `finalize_profile`. No "is the profile in a weird
  half-migrated state" failure mode; either you have a v1 file (migrate on
  read, schema looks like v2 in memory) or a v2 file (read directly).
- **Empty-array fallback for missing OSCAR_RESOURCES_ROOT.** In dev mode the
  variable is unset; the agent gracefully gets zero questions for an area
  rather than crashing. P3.5 still fires conversationally (the agent says
  "no per-area questions configured; moving on"), preserving the
  conversation flow.

## Consequences

- Package version bumps `0.1.0 → 0.2.0`. Consuming callers (Goose recipe at
  `ui/desktop/src/components/oscar/onboarding/onboardingRecipe.ts`) get the
  new tool automatically when the recipe is rebuilt.
- The recipe factory (per parent ADR-024) passes `OSCAR_RESOURCES_ROOT`
  through to the MCP spawn (parent step k); without it, P3.5 yields zero
  per-area questions but the rest of the onboarding flow is unaffected.
- v1 profiles still load — no forced re-onboarding for Sprint 10 dogfood
  users.
- Future schema bumps follow the same pattern: extend the schema, write
  `migrateV{N-1}ToV{N}`, prefer v_latest parse over v_prev in `read`.

## Supersedes

None. Companion to ADR-001 (persistence), ADR-002 (tool args A-class), and
the parent repo's ADR-032.
