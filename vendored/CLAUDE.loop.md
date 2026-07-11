<!-- synced from agent-pipeline@v1.1 — DO NOT EDIT locally; changes arrive as sync PRs -->
<!-- Esta es la MITAD VENDORIZADA de CLAUDE.md (mecánica del loop). El CLAUDE.md
del repo consumidor = esta sección + la sección «## Dominio de este repo»
(templates/CLAUDE.domain.template.md), que declara: rama base y de producción,
comandos de typecheck/tests, zonas de rigor, ficheros congelados. -->

# CLAUDE.md — mecánica del loop de agentes (agent-pipeline)

## Reglas del loop (mecánica vendorizada — agent-pipeline)

- Lee las secciones de `spec.md` y los ADRs que el issue cite antes
  de cualquier cambio relevante (lectura scoped — ver cabecera).
- Si una decisión afecta arquitectura o el motor, propón un ADR antes
  de codear.
- No introduzcas dependencias runtime nuevas sin ADR explícito.
- Merge: a la rama de PRODUCCIÓN, NUNCA (promoción humana). A la rama BASE (la declara la sección Dominio de este fichero): en régimen
  de épica (label `epica`) el merge es automático con CI verde +
  LGTM del Reviewer, según el protocolo de cadena (ADR-193); fuera
  de épica, solo abre el PR y deja el merge al humano.
- Tests pasando son condición necesaria pero no suficiente para
  considerar un PR completo: la coherencia con `spec.md` y los
  filtros transversales también lo es.
- **Evidencia, no afirmación:** en el comentario de cierre de cada
  PR (o de cada sección grande), pega la salida LITERAL de
  del typecheck del repo y de los tests de los ficheros afectados (comandos en la sección Dominio; líneas
  de resumen bastan). Afirmar "tests en verde" sin pegar la salida
  incumple la DoD; el Reviewer puede exigir la cita.
- Si el trabajo desborda el contexto disponible, parte el PR en
  unidades menores y abre el primero solicitando feedback antes de
  continuar.

### Compactación de contexto

Si tu contexto se compacta a mitad de sesión, preserva SIEMPRE en el
resumen: (1) la lista de ficheros modificados y su estado
(commiteado/pusheado o dirty), (2) los comandos de test de los
ficheros afectados (`npx vitest run <rutas>`), (3) el número de issue
y la rama de trabajo, (4) las secciones del issue ya completadas.
Perder esto es la causa raíz de trabajo repetido y ramas huérfanas.

### Limitaciones operativas que tienes que conocer

- **No modifiques archivos en `.github/workflows/` nunca.** La GitHub
  App de claude-code-action no tiene permiso `workflows`; los intentos
  de push se rechazan y consumen turnos sin avanzar (ver ADR-020). Si
  una tarea requiere cambios en workflows, indícalo en tu respuesta y
  déjaselo al humano.
- **Tu rama debe partir de la rama BASE del repo (sección Dominio); verifícalo siempre.**
  La política es: ramas de trabajo se cortan de la rama base (la
  línea de integración) y los PRs van contra ella. La rama de
  producción queda como línea de release. PERO `claude-code-action`
  crea sus ramas siempre desde el default branch del repo ignorando
  esta política (limitación de la action — ver
  skill `sandbox-actions` §”`claude-code-action` parte ramas desde
  el default branch”). Si el default branch NO es la rama base, **la
  rama donde te invocan está basada en la rama equivocada y le faltan
  commits de integración que muchas tareas necesitan**.
  
  **Primer paso operativo en cualquier issue, antes de leer código o
  tocar archivos (verificación barata, no-op si ya estás alineado):**
  
  ```bash
  git fetch origin
  git status   # working tree debe estar limpio (la action no precommitea)
  git log --oneline HEAD..origin/<rama-base> | head -5  # ¿la base adelanta?
  # Si adelanta, realinear:
  git reset --hard origin/<rama-base>
  ```
  
  Si el working tree NO está limpio, NO hagas reset destructivo —
  reporta y para; algo no esperado está pasando. Si el issue indica
  explícitamente otra base, sigue esa instrucción; en ausencia de
  instrucción explícita, **parte siempre de `origin/<rama-base>`**.
  
  Esta realineación NO es ceremonial. Saltársela es la causa raíz de
  fallos del tipo “imports a módulos inexistentes”, “tests se rompen
  con errores sin sentido”, “el código que el issue describe no
  está donde el issue dice”. El coste de la realineación es un comando
  bash; el coste de olvidarla es turnos consumidos diagnosticando.
- **El sandbox del Action permite ejecutar comandos bash sin
  aprobación interactiva** (ADR-024 — `--permission-mode bypassPermissions` activo). PUEDES correr los comandos de build/typecheck/test del repo, `curl`, `unzip`, etc. Si el prompt
  del issue te pide verificación local antes de commit, hazla. Si
  typecheck o test fallan, **NO hagas commit**: reporta en tu
  respuesta y para. La excepción permanente sigue siendo
  `.github/workflows/` (ADR-020).
- **Adjuntos al issue tipo `user-attachments/files/...` NO se pueden
  descargar.** Es una limitación de plataforma de GitHub (frontend-
  only, requiere cookie de sesión, no responde a tokens de la App).
  Si una tarea depende de un adjunto, el humano lo subirá
  directamente al repo en una rama de trabajo y te lo indicará en
  el comentario. NO insistas con curl/wget — fallará con 404.
- **El Reviewer auto-dispara en PRs creados por
  `claude[bot]`** (ADR-025). El
  Reviewer correrá solo cuando lo abras. No es tu trabajo añadir
  label — eso lo decide el humano para sus propios PRs (no para los
  tuyos).
- Si una tarea parece estar consumiendo turnos sin avanzar, repasa si
  estás chocando con una de las limitaciones anteriores antes de
  seguir iterando.

### Separación de poderes en el pipeline (decisión del propietario, 2026-07-04/05)

El objetivo es que las cadenas corran solas de spec a valor completo. Cada agente tiene UN poder; ejercer el de otro es violación de proceso (el 2026-07-04 se perdieron 3 cadenas por el Creator haciendo cirugía de cola: arm paralelo #1052, sentinel perdido #1038, launch-next vacío #1056).

- **Creator — codifica.** Un issue = UNA PR (`Closes #N` solo en ella; PROHIBIDO «PR-1 de N»). Si el alcance no cabe en una PR entregable en verde: entrega lo que quepa (PR híbrido) y cierra con `### Alcance restante (para el Architect)` listando verbatim las subtareas no entregadas y dependencias descubiertas. NO crea hijos, NO arma, NO re-encadena, NO toca sentinels; si el issue original llevaba `launch-next`, lo conserva intacto.
- **Architect — reestructura.** Dimensiona issues para que la partición sea excepción; convierte informes de restante en issues encadenados; único que crea alcance nuevo o reordena cadenas en construcción.
- **Auditor — declara spec faltante Y cierra el bucle.** Al auditar una épica: crea issues `correctivo` con el alcance del hueco VERBATIM (cero diseño nuevo), label `epica`, encadenados con `launch-next`, **arma el primero** (comentario `@claude` posteado con `GH_TOKEN="$ARM_TOKEN"` — actor humano; sin ARM_TOKEN: no armar y decirlo), y el último hijo lleva `<!-- epic-audit: correctivos <rango> -->` para re-auditoría automática. Única excepción: si el hueco exige una decisión de diseño no tomada ⇒ correctivo SIN armar + escalado al Architect.
- **Watchdog — relanza.** Retries, rebases, rescate de cadenas huérfanas. Jamás crea alcance.

## Loop protocol with Reviewer

When working on a PR (you, as the Creator agent), end every turn
with **exactly one** of these closing markers:

- `@reviewer` — you addressed Reviewer comments and committed the
  changes. Workflow auto-labels `needs-review` (forcing remove+add)
  to re-trigger the Reviewer. Do NOT add the `needs-review` label
  yourself: the Reviewer's guard ignores `labeled` events from
  `claude[bot]` (anti-recursion); only the workflow's Auto-label
  step (PAT) can re-trigger it. A push alone does NOT re-trigger
  the Reviewer either (its trigger is `[opened, labeled]`, no
  `synchronize`). Without the closing `@reviewer` the chain hangs
  waiting for an LGTM that never comes (seen in PR #948).
- `[READY-TO-MERGE]` — the PR is complete, no outstanding Reviewer
  comments, all checks passing. Brief one-line justification.
  **Epic-PR restriction (2026-07-10, deadlock PR #1201):** once the
  Reviewer has issued ANY verdict on an epic PR (`epica` chain), you
  may NOT close with this tag — after addressing REVIEW/NITS items you
  close with `@reviewer`, always: the epic-merge gate only accepts the
  Reviewer's LGTM, never your self-certification, so a READY-TO-MERGE
  close silently orphans the loop (the Reviewer is never re-summoned
  and the gate waits forever). READY-TO-MERGE remains valid on epic
  PRs only BEFORE any verdict exists, and on non-epic (classic) PRs.
- `[NEEDS-HUMAN]: <reason>` — you have doubt for stability reasons
  (see criteria below). The workflow adds label `human-needed` and
  stops the loop.

**Closing tags must OPEN their own line.** The Auto-label step anchors
detection to line start (`/^\s*TAG/m`) — a tag mentioned mid-sentence
or in backticks does NOT count as a closing tag, and conversely: never
start a line with one of these tags unless you mean to emit it.
(2026-07-08, PR #1133: a backticked *mention* of `[NEEDS-HUMAN]` in the
Creator's prose was substring-matched, froze the PR under `human-needed`
with red CI, outside the watchdog's radar — same bug class already fixed
for `@claude` in ADR-064.)

**Initial PR open from an issue:** you don’t need to add any closing
tag. Opening the PR triggers the Reviewer automatically (via the
`opened` event, condition on `claude[bot]` as author). The closing
tags only apply when responding inside a PR loop.

**If the Reviewer issues verdict `LGTM` or `NITS` (no `@claude` ping):**
do not respond. The loop ends silently and the human decides the
merge. Do not consume a turn closing with `[READY-TO-MERGE]` — it
adds nothing and burns one slot of the cap=8. The closing tags are
only useful when the Reviewer pinged you (verdict `REVIEW`). The
verdict and `@claude` ping live at the START of the Reviewer’s
comment (ADR-063 — see `docs/agents/reviewer.md` § “Cabecera de
control de loop”) so they survive truncation if the review body
overflows token budget.

**Escalate with `[NEEDS-HUMAN]` if any of these apply:**

- The change touches public module contracts (exported signatures,
  persisted data formats).
- The change affects numerical semantics (precision, stability,
  PRNG/distribution edge cases).
- The change touches security-sensitive paths (the Domain section
  lists them), secrets, ciphers, or concurrency primitives.
- The Reviewer’s comment is ambiguous (admits more than one
  reasonable interpretation).

If none apply, treat the Reviewer’s comment as clear: apply, commit,
end with `@reviewer`.

**Hard caps enforced by the workflow:**

- Maximum 8 `claude[bot]` comments on a PR before the workflow
  forces `human-needed` and stops you.
- If you observe label `pause-agents`, stop immediately.

See ADR-064 (which supersedes ADR-063) in `decisions.md` for the
full rationale.

## PR creation: open the PR explicitly (OBLIGATORIO)

When you finish work on an issue and have committed + pushed your
branch, **open the PR yourself** with `gh pr create` rather than
relying on `claude-code-action`’s auto-PR behavior, which is
unreliable when invoked via `@claude` in issue bodies (documented
gap in skill `sandbox-actions`). Without this step the PR ends up
authored by the human who clicks the compare URL, which breaks the
Reviewer auto-trigger.

```bash
gh pr create \
  --base <rama-base> \
  --head "$(git branch --show-current)" \
  --title "<concise descriptive title>" \
  --body "<body con `Closes #<issue>`, resumen de cambios y el MARCADOR DE POLARIDAD>"
```

**Polaridad obligatoria en el body de TODO PR** (el hook `pr-polarity`
bloquea `gh pr create` sin ella): `<!-- full-pr -->` si completa TODO
el alcance del issue; `<!-- partial-pr -->` si es híbrido/parcial. Sin
declaración, epic-merge trata el PR como parcial. Terminar la sesión
con un enlace «Create PR» prellenado en vez de crear el PR INCUMPLE
esta sección: rompe la cadena (clase de fallo «PR huérfano»,
what-money-cant-buy #7/#6, 2026-07-11).

Do NOT merge — only open. The PR being opened by you (`claude[bot]`)
is what makes the Reviewer auto-fire via the `opened` event trigger
in `reviewer.yml`.

