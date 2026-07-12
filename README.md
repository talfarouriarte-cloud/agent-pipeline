# agent-pipeline

Reusable multi-agent development pipeline for GitHub repositories. Chains of issues ("epics") execute end-to-end without human intervention — issue → implementation PR → adversarial review → auto-merge → next issue → final audit → correctives — with autonomous stall recovery, a self-improving process loop, and asynchronous human veto. Extracted from a production repo where it has run since 2026-04 across ~1,200 issues/PRs.

---

## 1. The agents

| Agent | Runs as | Does | Never does |
|---|---|---|---|
| **Architect** | Chat session (claude.ai project) | Designs ADRs, dimensions and chains issues, bakes coordination sentinels into issue bodies, runs process review at epic start, publishes the human-corrections ledger at epic launch | Implement code; publish/arm without human OK; merge |
| **Creator** | Claude Code GitHub Action, fired by `@claude` | Implements exactly one issue per PR. If scope doesn't fit one green PR: delivers a hybrid PR marked `partial-pr` with a verifiable remaining-scope report — never restructures the chain | Chain surgery (creating/re-chaining issues); running the full test suite (CI's job); opening a PR without a polarity marker |
| **Reviewer** | Separate workflow, stronger model | Adversarial diff review against the issue contract; verdicts LGTM / REVIEW / NITS; pings the Creator only on non-LGTM; a deterministic post-step materializes LGTM as a label | Chain-level completeness review (Auditor's job) |
| **Auditor** | Armed automatically when an epic's last issue merges | Compares the merged tree against the epic's TOTAL scope; **executes the epic's functional invariants** (2–4 runnable promises the Architect declared at design time, output pasted as evidence); creates chained corrective issues (≤3) or escalates; publishes process observations and per-process value metrics | Legislating process; re-auditing beyond one corrective round |
| **Watchdog** | Cron + workflow-completion events | Detects stalls and anomalies; deterministic retries (red CI, startup failures, broken handoffs); attributable-red fast-path (if every failing test file belongs to the PR's own diff, skip the flaky retry and escalate to the Creator directly); **architect-resolve stage**: on escalations, diagnoses and decides autonomously, re-dimensions oversized issues, de-stalls and re-arms | Creating scope; touching human-flagged items; workflows; branch promotion |
| **process-reviewer** | Fired when an audit completes | Reads the audit's process metrics across epics; publishes ≤2 evidence-backed process proposals; runs the **skill-optimization loop**: bounded edits to trainable skills' learning sections, reverted if the targeted failure type doesn't improve within 2 epics; publish-before-commit order with post-commit integrity check, and a deterministic failure step so a dead session never leaves the epic's panel silently empty | Editing outside learning sections; arming anything; proposing without metric evidence |
| **Subagents** (investigador, pre-reviewer) | Inside Creator sessions | Read-only code mapping and anchor verification; one pre-review pass before PR creation (max 5 correctness/scope findings) | Writing code; style bikeshedding; looping |

Separation of powers is structural: the Architect designs but cannot merge; the Creator implements but cannot restructure; the Reviewer verdicts but cannot audit completeness; the Auditor audits but cannot legislate; the process-reviewer proposes but cannot arm.

## 2. Lifecycle of an epic

1. **Design.** The Architect designs the epic as a complete sequence: each issue a closed contract (nothing left to Creator invention — every decision either derivable by verbatim quote from ADR/spec, closed at design time, or declared genuinely free), sized by a hard partition heuristic (crossing package boundaries, >5 acceptance criteria, any open design decision, or an enumerable DoD ⇒ split by default). Issues carry semantic anchors (function/type names, ADR IDs, behavioral criteria), never file:line — the code moves between merges and no one re-anchors mid-epic.
2. **Approval & launch.** The human approves the sequence once, up front. A mechanical pre-publication checklist (assert/grep over the drafted bodies, not memory) verifies chain sentinels before anything is published. The first issue is armed.
3. **Execution loop.** Creator opens a PR → CI runs (package-scoped on PR events; the full suite runs ONLY in CI) → Reviewer verdicts → on LGTM + green CI the merge gate merges, closes or reopens the issue depending on PR polarity (`full-pr` closes; `partial-pr` reopens and re-arms the same issue, capped per round and per lifetime), consumes the `launch-next` sentinel and arms the next issue. No human in the loop.
4. **Audit.** The last issue carries an `epic-audit` sentinel instead; merging it creates and arms the Auditor, which runs the epic's functional invariants, files correctives (auto-chained, one re-audit round) or escalates, and publishes process metrics.
5. **Human gate at the end.** Visual/functional acceptance on the merged default branch is the delivery gate. Before the next epic, default → production branch is promoted as the functional rollback baseline.

## 3. Coordination protocol

A single append-only vocabulary doc defines every marker and label with emitter/consumer/effect (vendored: `protocol.md`). Key mechanisms:

- **HTML sentinels in issue bodies** (`launch-next`, `epic-audit`, polarity markers) drive chaining. Text-based triggers are line-anchored or replaced by HTML markers — substring matching on prose is banned (a backticked mention once froze a PR for hours).
- **Materialized facts.** The merge gate never re-derives state: CI writes a `ci-verde` label on green; the Reviewer's post-step writes `lgtm`; new commits invalidate both. Each fact is written by its owner, and label events provide the ordering edges (e.g. LGTM-after-CI) that workflow-run events miss.
- **Turn-based state.** The whose-turn function is derived from the protocol doc per open PR. "No one's turn" is an immediate anomaly; "agent's turn but agent not running" is a zombie ⇒ mechanical relaunch. Interventions are mirrored as commit statuses on the PR head, so the gate and the watchdog are visible in the PR checks box.
- **Decision protocol** (vendored: `resolver-protocol.md`). Mid-implementation decisions are *derivable* only against a verbatim, grep-existing quote from ADR/spec — then the Creator proceeds, publishing a `derived-decision` comment (capped per issue). Non-derivable ⇒ escalate; in autonomous regime the architect-resolve stage decides with full rationale via `autonomous-decision` comments. All decision comments are synced to a digest issue: **the human veto is asynchronous and corrective, not a gate.**

## 4. Autonomy and human gates

Everything self-heals except an exhaustive list of human gates:

1. Commits to `.github/workflows/*` and designated frozen files (human-execute: agents draft, the human commits — the automation must not be able to modify its own CI supervision).
2. Default-branch → production promotion.
3. The final breaker: the same item re-escalating after an autonomous recovery **with zero merged PRs in between** (genuine thrash, not convergence) ⇒ `human-needed` + stop.

Everything else — stalls, red CI, broken handoffs, oversized issues, mid-epic decisions — is resolved autonomously and logged for asynchronous veto.

## 5. Failure detection and recovery

- **Watchdog**: universal stall signature (armed work + no runs + silence), deterministic-signature interventions act immediately (a missing mechanical trace needs no aging), retry caps everywhere, flaky-test harvesting (retried flakies are RECORDED, not just self-resolved; recurrence triggers a corrective).
- **Heartbeat**: a zero-LLM cron on infrastructure deliberately independent from the main runners — it watches the watcher and revives it by dispatch. Rationale: managed-runner billing failures are silent (jobs queue forever, indistinguishable from a universal stall).
- **Hooks** (vendored, deterministic, fail-open): commit discipline (blocks edits when too much work is unpushed), test discipline (blocks full-suite runs inside agent sessions), PR polarity (blocks PR creation without a scope marker).

## 6. The improvement loop

The pipeline audits itself at three levels:

1. **Per-epic**: the Auditor's report — scope completeness, functional invariants executed, PRs-per-issue calibration (feeds the Architect's sizing), autonomous-decision rate, and a **value ledger** classifying every process step per PR as PRODUCTIVE / SENSOR / NULL / REDUNDANT / REVERTED (redundant cost that "works" trips no failure metric — it must be hunted by query).
2. **Cross-epic**: the process-reviewer reads metrics across audits and publishes evidence-backed proposals; friction patterns seen in ≥2 epics become concrete changes, patterns seen once are noted and waited on.
3. **The Architect itself**: its costliest failures happen in chat, before anything lands — invisible to repo audits. Countermeasure: at every epic launch the Architect publishes the epic's **human-corrections ledger** into the outgoing audit and self-updates its own context skills from those corrections.

Audit and proposal issues stay OPEN between epics as the living panel of what the epic left pending; the Architect closes them (each with a resolution line) when launching the next epic.

## 7. Skills management

Skills are on-demand context documents (`.claude/skills/<name>/SKILL.md`). The framework manages them by layer and by lifecycle:

**By layer:**

| Layer | Skills | Written by |
|---|---|---|
| 1 · Framework | Pipeline mechanics (sandbox/Actions quirks, quota/auth, ADR-authoring discipline, delivery patterns, design-session protocol BASE) + the `pipeline-map` TEMPLATE | Human (via Architect drafts) |
| 2 · User | Owner preferences, learned collaboration heuristics (the self-edited sections of design-process skills) | Architect, at epic-launch retros |
| 3 · Project | Domain knowledge (model/engine state, product state, dataset quirks, infra ops), the `pipeline-map` INSTANCE, epic-context skills, trainable skills | The pipeline |

**By lifecycle (layer 3):**

- **Synced state skills** (e.g. model-state): every issue implementing a relevant ADR carries a DoD item updating the skill + its sync header; the Reviewer verifies fidelity per PR, the Auditor checks aggregate staleness.
- **Epic-context skills**: created by the Architect at epic launch (rationale, REJECTED alternatives, semantic traps, human corrections from the design session — what the ADR compresses), non-normative and never citable, consulted at escalation gates, **archived by the Auditor** when the books close (ownership matters: unowned skills leak as stale ambient context).
- **Trainable skills**: contain a marked learning section that ONLY the process-reviewer's bounded loop edits, with commit markers and revert-on-no-improvement. Creation threshold is high (a homeless finding cluster persisting ≥2 epics); retirement on zero loads.
- **`pipeline-map`**: the schematic map of the whole system, updated in the SAME commit as any pipeline change — the anti-knowledge-loss invariant.

**Cross-layer promotion is never automatic**: a layer-3 learned heuristic that proves transversal is promoted to layer 1/2 by explicit human/Architect act.

## 8. The three-layer architecture

The system separates three natures of knowledge with different lifecycles, writers and sensitivities:

| Layer | Repo | Visibility | Contains | Written by |
|---|---|---|---|---|
| 1 · Framework | `agent-pipeline` (this repo) | public | How the agents work: workflows, hooks, subagents, generic role mandates, protocol docs, framework skills, templates, migration guide | **Human only** (Architect drafts, human commits) |
| 2 · User | `user-context` | private | Who they work with: owner preferences and transversal collaboration heuristics | **Architect only** (chat, epic-launch retro, human OK per push) |
| 3 · Project | one per project | any | What they work on: spec, ADRs, domain CLAUDE.md, role annexes, domain skills, CI, labels, secrets, stubs | **The pipeline** |

**One-writer-per-layer is a hard rule.** It eliminates cross-repo write surface for autonomous agents: a chat-session error cannot contaminate every consumer at once, and every framework change reaches production repos as something the human explicitly approves. Hybrid pieces split along the writer seam: a design-process skill's protocol base is layer 1; its learned-heuristics section is layer 2. Trainable skills can only be layer 3 — the process-reviewer runs in the project repo's Actions and has no cross-repo write.

## 9. How layers interact

Nothing propagates automatically. Three mechanisms:

1. **Workflows — `workflow_call` with pinned refs.** Consumers hold ~10-line stubs calling `agent-pipeline/.github/workflows/<name>.yml@<tag>`. Single-operator mode pins `@main` (§13); multi-operator mode pins tag/SHA, upgrading = editing the stub (human-execute). Exception: `watchdog-heartbeat` ships as a template, not callable — its function requires infrastructure independent of the consumer's runners.
2. **Vendored files — physical copies with sync PRs.** Claude Code and hooks only read the checkout where they run, so `.claude/` contents, generic role mandates, protocol docs and `adr-lint.mjs` are copied into each consumer, headed `<!-- synced from agent-pipeline@<sha> — DO NOT EDIT locally -->`. Central changes propagate mechanically (Architect commit or auto-merged sync PR): the human gate lives at the CENTRAL commit, not at each consumer — a second per-repo merge adds clicks, not decisions (owner correction, 2026-07-11). A locally edited vendored file is a grep-detectable anomaly (candidate Auditor check).
3. **Templates — copied once at onboarding, never synced.** Skeletons of spec/decisions/CLAUDE.md/annexes/pipeline-map/labels become layer-3 property on copy.

Layer 2 needs no repo mechanism: the Architect reads it via PAT at session start (any project) and writes it at retros.

## 10. Repository layout

```
agent-pipeline/
├── .github/workflows/       # callable: claude-code, reviewer, epic-merge,
│                            #           watchdog, process-review
├── vendored/
│   ├── claude/              # hooks/ (3), agents/ (2 subagents), settings.json
│   ├── docs-agents/         # generic mandates: creator, reviewer, epic-auditor,
│   │                        # watchdog + protocol.md, resolver-protocol.md
│   ├── skills/              # framework skills (§7, layer 1)
│   └── scripts/             # adr-lint.mjs
├── templates/               # spec, decisions, CLAUDE.domain, role-annex,
│                            # pipeline-map, watchdog-heartbeat.yml, labels.json
├── sync/                    # sync-PR tooling
├── MIGRATION.md
└── README.md
```

## 11. Consumer contract

A repo can run the pipeline iff it provides:

1. **`spec.md`** — vision, principles, stack, boundaries. Not a courtesy doc: the decision protocol defines derivability as a verbatim quote from ADR/spec; without it nothing derives and every decision escalates.
2. **ADRs** in the format `adr-lint.mjs` enforces (unique numbering, mandatory sections, owner-verbatim decision blocks in rectifications, attributed quotes that grep-exist outside their own block).
3. **`CLAUDE.md`** (vendored loop mechanics + domain layer), **role annexes**, **`docs/conventions.md`**.
4. **Own CI** with the job name the merge gate expects, materializing `ci-verde` on green.
5. **Labels** from the template; **secrets**: Anthropic OAuth, `ARM_TOKEN`, fine-grained PAT.
6. **Stubs** pinned per §13 (single-operator mode: `@main`; multi-operator: a release tag).

## 12. Security model

- Public repo, hard conditions: **zero secrets, zero owner-personal content, zero project-domain content.**
- Callable workflows gate agent triggers on `author_association` (OWNER/MEMBER) — forks and drive-by comments cannot arm agents in consumers.
- Consumers supply all credentials as their own secrets; the central grants nothing.
- Human-execute on layer 1 means the automation can never modify its own supervision.

## 13. Versioning

**Single-operator mode (owner decision, 2026-07-12): consumers pin `@main`.** With one operator, the human gate already lives at the central commit — the upload IS the release; a downstream re-pin step decided nothing and left mixed-version states latent (a consumer ran 10 days on a stale watchdog with a known bug because re-pinning was per-file-per-repo). Rollback = re-upload the previous file. Historical tags (`v1`…`v1.4`) remain as immutable reference points.

If the framework ever gains consumers not operated by the owner, revert to tagged releases: consumers pin to tags; breaking changes to inputs or the coordination protocol bump the major, with release notes listing the required stub diff.
