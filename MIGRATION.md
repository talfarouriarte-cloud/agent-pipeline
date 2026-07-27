# MIGRATION.md — onboarding and migration guide

Two paths: **A) new repo from scratch** and **B) existing repo already running a local copy of the pipeline** (the originating project is the documented case). Read README.md first — the three layers, the one-writer rule and the consumer contract are assumed known here.

> **Operating-mode note (2026-07-12).** Single-operator mode is active (README §13): consumers pin `@main` and every human upload to the central IS the release. The only reference to release tags left below is §0 (A5, B2 and §4 were rewritten to `@main` on 2026-07-27, AP-052); it describes multi-operator consumption — valid the day the framework gains consumers not operated by the owner; meanwhile tags are cut as documented milestones after real-traffic shakedown (README §13).

> **Status note.** The per-workflow input reference (§4) is finalized during Phase A of the rollout (extraction of the five workflows to `workflow_call`). Until Phase A lands, input names in this guide are indicative; the extraction is the source of truth and this file is updated in the same commit.

---

## 0. Prerequisites (both paths)

- [ ] `agent-pipeline` reachable from the consumer. In single-operator mode (the current one, README §13) the stubs track `@main` and there is nothing to release: a merged central PR IS the deployment. Only a consumer *not* operated by the owner pins a release tag — and then this line means "a tag exists and you pinned it".
- [ ] A fine-grained PAT covering the consumer repo (Contents RW, Issues RW, PR RW, Actions read, metadata read) — stored as the consumer's `ARM_TOKEN`-class secret, never committed.
- [ ] Anthropic OAuth token (Claude Max) as consumer secret.
- [ ] The human operator understands the two human gates that never delegate: workflow/`prototype`-class frozen-file commits, and default-branch → production promotion.

## A. New repo from scratch

Order matters: the pipeline cannot derive decisions until spec/ADRs exist (consumer contract §1-2).

**A1. Documents first.**
1. Copy `templates/spec.template.md` → `spec.md`; fill vision, principles, stack, boundaries. Minimum bar: enough that an implementation question of the form "should X behave like Y?" can be answered by quoting it.
2. Copy `templates/decisions.template.md` → `decisions.md`; register ADR-001 (project foundation) in adr-lint format. Run `node scripts/adr-lint.mjs` green.
3. Compose `CLAUDE.md` = `vendored/CLAUDE.loop.md` (loop mechanics — MANDATORY: omitting it breaks PR creation, the "orphan PR" failure class) + `templates/CLAUDE.domain.template.md` filled in; write `docs/conventions.md`.
4. Copy `templates/role-annex.template.md` → one annex per role with repo-specific mandates (branch names, test commands, protected paths).
5. Instantiate `templates/pipeline-map.template.md` → `.claude/skills/pipeline-map/SKILL.md`.

**A7-bis · Architect role doc (2026-07-13, REQUIREMENT).** Every consumer MUST commit `docs/agents/architect.md`: the repo-local role of its (human-session) Architect — domain, protected files, issue/epic protocol, domain survival rules. A consumer without it leaves its Architect roleless; the observed failure mode (wmcb#31/#32) is that a roleless Architect climbs the dependency chain, finds the central's `architect-mejora-continua.md` and adopts the WRONG role. The graft action verifies presence on every run and emits a loud warning if missing.

**A2. Vendored layer (2026-07-13, AP-009).** Do NOT copy `vendored/` into the consumer: the `graft-vendored` composite action injects it at runtime in every reusable run (mandates, subagents, hooks, settings, generic skills). The consumer commits only its own layer: `CLAUDE.domain.md`, `docs/agents/*-annex.md`, stubs, and — only if its local CI invokes it — `scripts/adr-lint.mjs`.

**A3. CI.** Create the repo's own `ci.yml`: at minimum typecheck + the test command the stubs will pass as input, with a job name matching the merge-gate input, writing the `ci-verde` label on green. A repo with no test suite starts with typecheck-only CI — the gate still needs the green fact materialized.

**A4. Labels & secrets.** Apply `templates/labels.json` (via `gh label` or API). Set secrets: Anthropic OAuth, `ARM_TOKEN`, PAT.

**A5. Stubs.** Copy the five stubs — they ship pinned to `@main`, and they stay that way: owner-operated consumers track `@main` so that a merged central PR IS the deployment (README §13); tags are documented milestones that nothing consumes. Fill in only what is *instance truth*: default branch, CI job name, runner, canonical label and workflow names. Everything else keeps the central default — see the pinning rule below. Add `watchdog-heartbeat` from template — on GitHub-hosted runners, NOT on the runner infra the other workflows use.

> **Pinning rule (AP-052).** Every `with:` line is an override of a central default, so every line has to earn its place: fill in what is *instance truth* (branch names, CI job name, runner, caps you deliberately chose) and leave everything else out. Never pin a **lesson-bearing** input (§4) — its default carries an AP behind it, and pinning it below the central value silently reverts a fix that is already deployed everywhere else. If you pin one anyway, the line ships with an annotation (reason + AP reference); a pin without annotation is a defect **by doctrine — nothing enforces it**. The reusable cannot see your annotation: it only receives input *values*, never the comments around them. What it *does* flag, on every run, is a lesson-bearing input received **below** the central default (annotated or not); a pin equal to the default is invisible until the AP is amended upwards (by which point the run has already happened on the stale budget), a pin above it is invisible always, and so is any pin of a non-lesson-bearing input. Read the mechanism's coverage in §4 before assuming a wrong pin will announce itself.

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

All inputs have defaults; stubs override per repo. Secret names are fixed by contract: `CLAUDE_CODE_OAUTH_TOKEN` (Claude Max OAuth), `REVIEWER_GITHUB_TOKEN` (fine-grained PAT; also exposed to agents as ARM token), plus the optional `WORKFLOWS_PUSH_TOKEN` on `claude-code` — not `required` in the contract, but the token that backs the residual push of `.github/workflows/**` (central#46); provision it if agents in your repo must touch workflow files at all (ADR-020). **Values below re-verified against HEAD on 2026-07-27** — the table had drifted (it still taught the pre-AP-025 reviewer budget and the pre-AP-044 model ids), and a stale reference table is how a consumer ends up pinning a value the central abandoned (AP-052).

| Workflow | Inputs (default) | Secrets |
|---|---|---|
| claude-code | runner (ubuntu-latest), default_branch (main), creator_model (claude-opus-5), creator_max_turns (200), bot_comment_cap (8), epic_label (epica), reviewer_workflow_name (Opus Reviewer) | both |
| reviewer | runner (ubuntu-latest), reviewer_model (claude-opus-5), **reviewer_max_turns (80 — lesson-bearing, AP-025)**, **timeout_minutes (22 — lesson-bearing, AP-025)**, agent_branch_prefix (claude/), review_context ("") | both |
| epic-merge | runner, default_branch, ci_workflow_name (CI), epic_label (epica), partial_round_cap (3), partial_lifetime_cap (6), automerge (true), loose_audit (true) | PAT |
| watchdog | runner, default_branch, ci_workflow_name (CI), creator_workflow_name (Claude Code), reviewer_workflow_name (Opus Reviewer), epic_merge_workflow_name (Epic Merge), extra_pipeline_workflows (""), epic_label (epica), resolve_model (claude-opus-5), resolve_max_turns (40), lookback_min (45), skip_labels (pause-agents,human-needed,auditoria,process-proposal,registro-decisiones) | both |
| process-review | runner, default_branch, process_model (claude-fable-5), process_fallback_model (claude-opus-5), process_max_turns (60), timeout_minutes (20) | both |

**Lesson-bearing inputs (AP-052).** Some defaults are not instance preferences but *lessons learned*, each with an AP behind it. Pinning one below the central default silently cancels a fix that is already deployed — "a merged central PR IS the deployment" (README §13) stops being true for that repo, and nothing in any readable state says so. The machine-readable list is `lesson_bearing` in `templates/workflow-contracts.json`; `check-contracts` keeps it faithful to the real defaults. At runtime the reusable emits a `::notice` plus a job-summary table whenever it receives such a pin *below* the default (a pin above is deliberate over-provisioning, not a lost lesson), and the Reviewer's no-verdict escalation comment carries the offending pin inline: `pin-divergente: reviewer_max_turns=50 (default central: 80, AP-025)`.

**Coverage of the runtime notice — read the limits, they are not symmetric.** It fires only when the received value is *below* the default — and the default it compares against is the one the central serves **today** (the table ships inside the reusable, resolved at `@main` on every run), not the one that was current when your stub was written. Cases it does NOT see, or sees only late:

- A pin **equal** to the default: nothing to flag today (no lesson lost yet). The day the AP is amended **upwards**, that same pin is suddenly below the new default and the notice *does* fire — but a notice is a diagnosis, not a fix: that session already ran on the pre-lesson budget, which is precisely where finplan#1674 cost two human interventions.
- A pin **above** the default (deliberate over-provisioning) — deliberately suppressed. This is the mechanism's *permanent* blind spot: if an AP is ever amended **downwards**, yesterday's equal-to-default pin lands above the new value and is never flagged at all.
- Any pin of an input not declared `lesson_bearing`.
- Whether a pin is annotated — annotations are comments in the consumer's stub and never leave it.

The notice is a belt for the one case that already cost an incident, not a general pin auditor.

**Default rule: do not pin them.** Leave the line out and the central default rules, so future lessons arrive on their own — this is the only thing that protects the "equal to the default" case **before the fact**, which no mechanism catches in time (and, on a downward amendment, catches at all). If a repo genuinely needs a different value, the pin ships **with an annotation** stating *why this repo overrides a lesson-bearing input* (not merely why the value is what it is) plus the AP reference. A pin without annotation is a defect by doctrine; nothing in CI will tell you.

Stub-side responsibilities (not inputs): event triggers, `workflow_run` workflow-name lists, concurrency groups (reviewer and epic-merge and watchdog MUST use `cancel-in-progress: false`), and permissions blocks. Ready-made stubs live in `templates/stubs/`.

New in the extraction (not present in the originating repo's local versions): the Creator trigger now gates on `author_association` OWNER/MEMBER/COLLABORATOR — required for public consumers; machine pings arrive via the owner's PAT and pass the gate.

## 5. Known traps (inherited from production incidents — do not relearn)

- `cancel-in-progress: true` on reviewer concurrency kills in-flight reviews on label events. Must be `false`.
- Any text-based trigger must be line-anchored or an HTML marker; substring matching caused a frozen-PR incident.
- Ubicloud-class runner billing lapses fail SILENTLY (jobs queue forever, looks like a universal stall). The heartbeat must live on GitHub-hosted runners.
- GitHub stores issue bodies with `\r\n`; normalize before string ops. Large files via Git Blobs endpoint, not Contents API.
- A mandate expansion without the matching tool/budget expansion (allowedTools, max-turns) fails at the last step and masquerades as a design escalation. Audit both in the same change.
- A stub pin outlives the lesson it predates. Consumers pin `@main`, so a central fix deploys the moment it merges — but only for inputs the stub does *not* pin. finplan's stub kept `reviewer_max_turns: 50` after the central raised the default to 80 (AP-025): the fix was deployed and inert, costing three no-verdict Reviewer deaths and the only two human interventions of an otherwise clean epic (AP-052). Deployment state was *inferred*, never *read*. When a default moves because of a lesson, the release notes name the input and the AP (README §13), and the reusable now says so out loud on every run that receives a stale pin.
