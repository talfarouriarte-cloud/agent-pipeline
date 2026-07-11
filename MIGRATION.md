# MIGRATION.md — onboarding and migration guide

Two paths: **A) new repo from scratch** and **B) existing repo already running a local copy of the pipeline** (the originating project is the documented case). Read README.md first — the three layers, the one-writer rule and the consumer contract are assumed known here.

> **Status note.** The per-workflow input reference (§4) is finalized during Phase A of the rollout (extraction of the five workflows to `workflow_call`). Until Phase A lands, input names in this guide are indicative; the extraction is the source of truth and this file is updated in the same commit.

---

## 0. Prerequisites (both paths)

- [ ] `agent-pipeline` released at a tag you will pin to.
- [ ] A fine-grained PAT covering the consumer repo (Contents RW, Issues RW, PR RW, Actions read, metadata read) — stored as the consumer's `ARM_TOKEN`-class secret, never committed.
- [ ] Anthropic OAuth token (Claude Max) as consumer secret.
- [ ] The human operator understands the two human gates that never delegate: workflow/`prototype`-class frozen-file commits, and default-branch → production promotion.

## A. New repo from scratch

Order matters: the pipeline cannot derive decisions until spec/ADRs exist (consumer contract §1-2).

**A0. Branch structure.** Create the working branch (conventionally `develop`) and set it as the repo default branch — the pipeline operates ONLY on the default branch; the production branch (conventionally `main`) receives human-gated promotions and nothing else. On a repo whose deploy is coupled to a branch (e.g. GitHub Pages serving `main`), this split IS the staging mechanism: promotion = deploy. All stub `default_branch` inputs and the pipeline-map instance must match the choice made here.

**A1. Documents first.**
1. Copy `templates/spec.template.md` → `spec.md`; fill vision, principles, stack, boundaries. Minimum bar: enough that an implementation question of the form "should X behave like Y?" can be answered by quoting it.
2. Copy `templates/decisions.template.md` → `decisions.md`; register ADR-001 (project foundation) in adr-lint format. Run `node scripts/adr-lint.mjs` green.
3. Copy `templates/CLAUDE.domain.template.md` → `CLAUDE.md` domain section; write `docs/conventions.md`.
4. Copy `templates/role-annex.template.md` → one annex per role with repo-specific mandates (branch names, test commands, protected paths).
5. Instantiate `templates/pipeline-map.template.md` → `.claude/skills/pipeline-map/SKILL.md`.

**A2. Vendored files.** Copy `vendored/` into place (`.claude/hooks/`, `.claude/agents/`, `.claude/settings.json`, `docs/agents/*.md`, `scripts/adr-lint.mjs`). Keep the `synced from agent-pipeline@<sha>` headers intact.

**A3. CI.** Create the repo's own `ci.yml`: at minimum typecheck + the test command the stubs will pass as input, with a job name matching the merge-gate input, writing the `ci-verde` label on green. A repo with no test suite starts with typecheck-only CI — the gate still needs the green fact materialized.

**A4. Labels & secrets.** Apply `templates/labels.json` (via `gh label` or API). Set secrets: Anthropic OAuth, `ARM_TOKEN`, PAT.

**A5. Stubs.** Copy the five stubs, pin `@<tag>`, fill inputs (default branch, test/typecheck commands, caps, canonical doc names, CI job name). Add `watchdog-heartbeat` from template — on GitHub-hosted runners, NOT on the runner infra the other workflows use.

**A6. Shakedown epic.** Design a deliberately small 2-issue epic exercising the full chain: issue → Creator PR → Reviewer verdict → auto-merge → `launch-next` → audit issue created and armed. Verify: labels materialize (`ci-verde`, `lgtm`, `estado:*`), commit statuses mirror (`epic-merge / gate`, `watchdog / turno`), audit runs invariants. Only after a green shakedown does real work start.

## B. Existing repo with a local pipeline

Risk lives here — this is a production repo. Rules:

**B1. Preconditions.** Queue EMPTY (no open armed issues, no open PRs, no in-flight Actions). Promote default branch → production branch first: it is the functional rollback baseline.

**B2. One workflow at a time.** For each of the five, in this order — `reviewer` → `claude-code` → `epic-merge` → `watchdog` → `process-review`:
1. Replace the local yml with the pinned stub (human-execute commit, as all workflow commits are).
2. Trigger the workflow's cheapest real path (a trivial PR for reviewer; a trivial issue for claude-code) and verify behavior identical to the local version.
3. Only then move to the next. Any failure: `git revert` the stub commit — the local yml returns, nothing else moved.

The order starts with the lowest-blast-radius workflow (reviewer: worst case is a missed review on a test PR) and ends with the ones that write state (epic-merge) and self-heal (watchdog).

**B3. Vendored-file swap.** Replace local copies of hooks/subagents/protocol docs with the vendored versions + headers. These should be near-identical at migration time (they were extracted FROM this repo); diff before replacing — any local drift found is either upstreamed to the central first or documented as a repo annex.

**B4. Two-layer split of role docs.** Local role docs are split: generic mandate stays only in the vendored copy; everything repo-specific moves to `docs/agents/<role>-annex.md`. The agent prompt loads mandate + annex. Verbatim-citation rules are unaffected (they cite ADR/spec, which never leave layer 3).

**B5. Shakedown epic** as in A6, on the migrated stack, before reopening the normal queue.

**B6. User-layer extraction (once, at first migration).** Owner-preference and collaboration-heuristic skills move OUT of the project repo into `user-context`. The Architect's session-start protocol becomes: tarball(project) + tarball(user-context). The project repo keeps no copy (one writer, one home).

## C. Rollout plan for the current repos (2026-07-11)

Order **A → C → B** (decision 2026-07-07, registered in ADR-219): extract first, onboard the low-stakes repo second, migrate the production repo last.

| Phase | What | State |
|---|---|---|
| **A — extract** | Convert the five finplan workflows to `workflow_call` in `agent-pipeline`; populate `vendored/` + `templates/`; finalize input reference in §4; tag `v1`. Architect drafts everything; human commits (layer-1 rule). | **Next.** Repos created, PAT scoped ✓ |
| **C — onboard `what-money-cant-buy`** | Path A above. Notes from recon: public, default `main`, no test suite (⇒ A3 typecheck-only CI), near-empty ("totalmente amateur") — free field. Its shakedown epic doubles as validation that the framework/domain separation is real, on a repo where breaking costs nothing. | After A |
| **B — migrate finplan** | Path B above. Also executes B6 (user-layer extraction to `user-context`). | After C has run at least one clean epic |

## 4. Per-workflow input reference

Generated from the Phase-A extraction (agent-pipeline@v1). All inputs have defaults; stubs override per repo. Secret names are fixed by contract: `CLAUDE_CODE_OAUTH_TOKEN` (Claude Max OAuth), `REVIEWER_GITHUB_TOKEN` (fine-grained PAT; also exposed to agents as ARM token).

| Workflow | Inputs (default) | Secrets |
|---|---|---|
| claude-code | runner (ubuntu-latest), default_branch (main), creator_model (claude-opus-4-8), creator_max_turns (200), bot_comment_cap (8) | both |
| reviewer | runner, reviewer_model (claude-opus-4-8), reviewer_max_turns (50), timeout_minutes (15), agent_branch_prefix (claude/), review_context ("") | both |
| epic-merge | runner, default_branch, ci_workflow_name (CI), epic_label (epica), partial_round_cap (3), partial_lifetime_cap (6) | PAT |
| watchdog | runner, default_branch, ci_workflow_name, creator_workflow_name (Claude Code), reviewer_workflow_name (Opus Reviewer), epic_merge_workflow_name (Epic Merge), extra_pipeline_workflows (""), epic_label, resolve_model (claude-opus-4-8), resolve_max_turns (40), lookback_min (45) | both |
| process-review | runner, default_branch, process_model (claude-fable-5), process_fallback_model (claude-opus-4-8), process_max_turns (60), timeout_minutes (20) | both |

Stub-side responsibilities (not inputs): event triggers, `workflow_run` workflow-name lists, concurrency groups (reviewer and epic-merge and watchdog MUST use `cancel-in-progress: false`), and permissions blocks. Ready-made stubs live in `templates/stubs/`.

New in the extraction (not present in the originating repo's local versions): the Creator trigger now gates on `author_association` OWNER/MEMBER/COLLABORATOR — required for public consumers; machine pings arrive via the owner's PAT and pass the gate.

## 5. Known traps (inherited from production incidents — do not relearn)

- `cancel-in-progress: true` on reviewer concurrency kills in-flight reviews on label events. Must be `false`.
- Any text-based trigger must be line-anchored or an HTML marker; substring matching caused a frozen-PR incident.
- Ubicloud-class runner billing lapses fail SILENTLY (jobs queue forever, looks like a universal stall). The heartbeat must live on GitHub-hosted runners.
- GitHub stores issue bodies with `\r\n`; normalize before string ops. Large files via Git Blobs endpoint, not Contents API.
- A mandate expansion without the matching tool/budget expansion (allowedTools, max-turns) fails at the last step and masquerades as a design escalation. Audit both in the same change.
