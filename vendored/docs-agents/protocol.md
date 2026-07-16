<!-- Las referencias ADR-NNN, #issue y fechas de incidentes de este doc son del repo de ORIGEN del framework (provenance histórica), NO del repo consumidor. No las resuelvas contra el decisions.md local. -->
<!-- synced from agent-pipeline@v1 — DO NOT EDIT locally; changes arrive as sync PRs -->

# Protocolo de coordinación entre agentes — vocabulario único

Los agentes se coordinan por **marcadores** (comentarios HTML invisibles en render)
y **labels**. Un marcador olvidado falla en silencio (ADR-209 sin `epic-audit`;
#1087 sin `partial-pr`): esta tabla es la fuente única del vocabulario y el
checklist antes de intervenir a mano. Append-only: si un workflow introduce un
marcador o label nuevo, se añade aquí en el mismo cambio.

## Principios de proceso

El vocabulario de abajo existe para cumplir tres reglas. Un proceso que las viola es un defecto de diseño, no un bug suelto.

1. **Estado materializado, no inferido.** Toda transición se declara con un marcador o label. Si el siguiente paso tiene que *inferir* el estado del contexto en vez de *leerlo* declarado, la costura está mal diseñada.
2. **Accountability de avance.** Cada agente responde no solo de ejecutar su tarea, sino de **materializar el estado que habilita al siguiente paso**. Cerrar la tarea sin dejar el estado declarado es incumplir, aunque la tarea esté bien hecha.
3. **El fallo vive en la costura.** Un marcador o label olvidado falla en silencio. Criterio de "arreglado": el estado queda declarado y verificable, no inferible. Un fix que solo hace **visible** la omisión a posteriori, sin **prevenirla** declarándola al armar, es parcial (patrón #14→#21).

## Marcadores

| Marcador | Lo emite | Lo consume | Efecto | Dónde vive |
|---|---|---|---|---|
| `<!-- launch-next: #N -->` | Architect (hornea al diseñar la épica) | epic-merge al mergear | Retira `stalled`/`human-needed` del issue N si las tiene (des-bloqueo mecánico, 2026-07-08: un eslabón re-armado por su cadena está desbloqueado por definición) y lo arma (`@claude` + `epic-auto-launch`) | Body del ISSUE, eslabones 1..N-1 |
| `<!-- epic-audit: <alcance> -->` | Architect (último issue de la épica); Auditor (último correctivo de su cadena — re-auditoría, UNA ronda) | epic-merge al mergear | Crea y arma el issue de auditoría | Body del ISSUE. Incompatible con `launch-next`/`epic-done` |
| `<!-- epic-done -->` | Architect | epic-merge al mergear | Fin de cadena SIN auditoría (solo si se omite deliberadamente) | Body del último ISSUE |
| `<!-- partial-pr -->` | Creator (PR híbrido) | epic-merge | Mergea SIN cerrar el issue; re-arma el mismo issue (cap 3) | Body del PR |
| `<!-- full-pr -->` | Creator (PR que completa el issue) | epic-merge | Mergea, cierra el issue y procesa sentinels. Obligatorio declarar uno de los dos (hook `pr-polarity`); sin declaración ⇒ se trata como parcial | Body del PR |
| `<!-- epic-partial-relaunch -->` | epic-merge al re-armar un parcial | epic-merge (DOS contadores: por ronda desde el último `relaunch-cap-reached`, cap 3; y ACUMULADO de vida, cap 6, nunca resetea) | Al 3º de la ronda: `stalled` (architect-resolve abre ronda nueva). Al 6º total: `stalled` + `rounds-cap-reached` | Comentario en el ISSUE |
| `<!-- relaunch-cap-reached -->` | epic-merge al alcanzar el cap de ronda | epic-merge (delimitador de ronda del contador) | Resetea el contador de RONDA (no el acumulado): un des-stall abre ronda fresca de 3 | Comentario en el ISSUE |
| `<!-- rounds-cap-reached -->` | epic-merge al 6º relanzamiento parcial ACUMULADO | architect-resolve (orden de partición) | El issue NO se re-arma más: partición OBLIGATORIA del alcance restante (hijos `epica` encadenados, heredan sentinel, padre cerrado con trazabilidad) | Comentario en el ISSUE |
| `<!-- watchdog-heartbeat-escalation -->` | watchdog-heartbeat al fallar el revival del Watchdog | Humano | Marca el issue `human-needed` de watchdog irreanimable (dedupe por título) | Body del issue de escalada |
| `<!-- epic-auto-launch -->` | epic-merge al encadenar | — (marca de máquina/auditoría) | Deja rastro del arm automático | Comentario en el ISSUE armado |
| `<!-- cadena-degradada-a-suelto -->` | Guard de cadena (`claude-code.yml`) al detectar «épica 1/1» sin sentinels (2026-07-15, central#36 — 5-whys de wmcb#61) | Auditor (rastro del horneado corregido) | Label de épica retirada, arm CONTINÚA como suelto (PR → review → merge → auditoría automática). El multi-eslabón roto conserva la escalada (`cadena-sin-auditoria`) | Comentario en el ISSUE |
| `<!-- ping-creator -->` | Reviewer (línea 2 del veredicto) y Watchdog | Filtro de claude-code.yml | Despierta al Creator aunque el render corrompa el `@claude` | Comentario en el PR |
| `<!-- epic-merge-diag -->` | epic-merge en cada evaluación | Humano/Architect por API; el camino de merge manual (dedupe: busca «MERGEADO») | Explica por qué (no) mergeó. **Leerlo antes de mergear a mano** | Comentario en el PR (se actualiza in-place) |
| `<!-- watchdog-rearm -->` | Watchdog (etapa architect) al re-armar | Watchdog (contador, cap 2) | Al 3º: label `stalled` + diagnóstico sin `@claude` | Comentario en issue/PR |
| `<!-- creator-blocked -->` | Creator, en su comentario de cierre al parar LIMPIO sin PR por bloqueo derivable por el Architect (serie/emisión ausente, hueco de dimensionado, ambigüedad de ADR) — jamás con PR abierto, jamás para decisión humana (`[NEEDS-HUMAN]`) | Post-step v3 de `claude-code.yml` (freshness vs comentario disparador, lección #180) | Materializa `stalled` con PAT (⇒ architect-resolve POR EVENTO, sin cron) + retira `serial-activo` | Comentario de cierre del Creator en el ISSUE (2026-07-14, finplan#1350) |
| `<!-- creator-blocked-materializado -->` | Post-step v3 de `claude-code.yml` | Auditor/5-whys (atribución de capa); humano | Diagnóstico de que el bloqueo declarado quedó materializado en el instante | Comentario del post-step en el issue |
| `<!-- creator-muerto-sin-pr -->` | Post-step «Materializar muerte del Creator sin PR» (`claude-code.yml`, 2026-07-13, incidente finplan#1318; v2 cubre success-sin-PR con commits, #1329) | Watchdog/architect-resolve (diagnóstico para el rearm: «no rehagas nada») ; Auditor | Acompaña a `stalled` + retirada de `serial-activo` — registro retroactivo: el marcador existía sin fila (violación del append-only, detectada 2026-07-14) | Comentario del post-step en el issue |
| `<!-- creator-escalated -->` | Creator, en su comentario de cierre al parar y escalar al Architect una decisión derivable-por-Architect DESDE DENTRO de un loop de PR (gate numérico de ADR tipo A3′, ambigüedad de diseño) — jamás sin PR abierto (eso es `creator-blocked`), jamás para decisión humana (`[NEEDS-HUMAN]`) | Post-step «Materializar escalada del Creator con PR abierto» de `claude-code.yml` (freshness vs comentario disparador, lección #180) | Materializa `stalled` con PAT (⇒ architect-resolve POR EVENTO, sin cron) + `estado:esperando-architect` visible | Comentario de cierre del Creator en el PR (2026-07-15, repesca finplan#1391, AP-017) |
| `<!-- creator-escalated-materializado -->` | Post-step «Materializar escalada del Creator con PR abierto» de `claude-code.yml` | Auditor/5-whys (atribución de capa); humano | Diagnóstico de que la escalada declarada quedó materializada en el instante (complemento con-PR de `creator-blocked-materializado`) | Comentario del post-step en el PR |
| `<!-- watchdog-rebase -->` | Watchdog (detect) en PR en conflicto | Watchdog (contador, cap 2) | Ping de rebase; al agotar: anomalía `pr-dirty-persistent` | Comentario en el PR |
| `<!-- watchdog-ci-retry -->` | Watchdog (detect) al reintentar CI rojo | Watchdog (contador, 1 retry) | Reincidencia → anomalía para la etapa architect | Comentario en el PR |
| `<!-- watchdog-ci-attributable -->` | Watchdog (detect, fast-path #1268 2026-07-12) al escalar CI rojo cuyos tests fallidos viven TODOS en ficheros del diff del PR (anotaciones del check run vs `pulls.listFiles`) | Watchdog (contador, cap 1); Creator (vía `ping-creator` del mismo comentario) | Escalada directa SIN quemar el retry de flaky; reincidencia sobre el mismo PR → anomalía `pr-ci-red-persistent` con `attributable: true` | Comentario en el PR |
| línea `pre-reviewer: …` (texto plano, NO comentario HTML) | Creator en el body de todo PR (#1259 2026-07-12) | NADIE mecánicamente (informativa por diseño: ningún workflow la parsea); Reviewer/Auditor la cruzan como evidencia | Hace evaluable el subagente pre-reviewer desde rastros públicos (`ejecutado · N hallazgos · M aplicados` o `no ejecutado — <motivo>`) | Body del PR |
| `<!-- sin-invariantes -->` | Guard de cadena (`claude-code.yml`) al armar una `epica` cuya cadena no declara `## Invariantes funcionales de la épica`; registrado retroactivamente (marcador previo sin fila — append-only, central#55) | Auditor (rastro del horneado sin superficie funcional declarada) | AVISO no bloqueante (el arm CONTINÚA). **Idempotente (AP-018 §1+§2): se emite UNA vez por issue** — el guard lee el marcador antes de comentar y no lo repostea en re-arms ni en el doble disparo `issues`+`issue_comment` | Comentario en el ISSUE |
| `<!-- panel-sin-consumir -->` | claude-code (guard de panel, 2026-07-12 — 3 lanzamientos con la limpieza de cola saltada) al bloquear un arm manual de `epica` con auditorías/process-proposals abiertas | architect-resolve (vía `stalled`); humano | El issue NO se arma; el panel de la épica anterior debe consumirse (cierre + línea de resolución) o forzarse el arm. **Dedup por marcador (AP-018 §1): el bloqueo se materializa una vez, no se repostea en re-arms ni en doble disparo** | Comentario en el ISSUE |
| `<!-- panel-ok -->` | Quien arma (Architect/humano). **Force PEGAJOSO (AP-018 §3, central#55): vale en CUALQUIER comentario de confianza (OWNER/MEMBER/COLLABORATOR) del issue**, no solo en el comentario de arm actual — el hecho «el panel está consumido» es por-issue, no por-comentario | claude-code (guard de panel) | Override explícito: arma aunque haya panel abierto (lanzamiento que debe preceder al cierre); un re-arm posterior no lo pierde | Comentario de confianza en el ISSUE (arm u otro) |
| `<!-- skill-edit: <tipo> <fecha> -->` | process-reviewer al ejecutar una edición del loop de skills (ADR-212) | Auditor (¿recurrió el tipo?); process-reviewer (revert a las 2 épicas sin mejora) | Marca qué heurística ataca qué patrón; ancla del revert | Línea editada en `## Heurísticas aprendidas (loop)` de la SKILL |
| `<!-- flaky-harvest -->` | Watchdog (step Harvest, tras el retry del modo d) | Auditor (conteo por épica); Creator/Architect (fix del test) | Registra los tests fallidos del attempt 1 (candidatos a flaky, confirmados si el re-run sale verde); ≥2 apariciones del mismo test en una épica ⇒ correctivo | Comentario en el PR |
| `<!-- watchdog-turn-relaunch -->` | Watchdog (dispatcher de turno, ADR-217) al relanzar mecánicamente una transición rota (re-labeled, re-arm) | Watchdog (contador, cap 2 — junto con `watchdog-handoff-fix` histórico) | Zombi persistente tras 2 relanzamientos ⇒ anomalía `turno-*-zombie-persistent` para architect-resolve | Comentario en el PR |
| `<!-- watchdog-handoff-fix -->` | HISTÓRICO (modo e, absorbido por el dispatcher de turno de ADR-217; cuenta para el cap de relanzamientos) al re-aplicar `needs-review` con el PAT tras un handoff Creator→Reviewer roto | Watchdog (contador, cap 2) | Reincidencia (2 fixes sin veredicto) → anomalía `reviewer-handoff-broken-persistent` para la etapa architect | Comentario en el PR |
| `<!-- turn-close-failsafe -->` | claude-code (step Auto-label, finplan#1322 2026-07-13) cuando una sesión de PR-loop convocada por `ping-creator` termina `success` con commits post-veredicto en el HEAD y SIN tag de cierre anclado | Reviewer (vía la `needs-review` que el mismo job aplica con PAT); Auditor (transición primaria por estado EJECUTADA con éxito en el mismo job, doctrina push-primario 2026-07-14 wmcb#38: NO es repesca — contabilizar como métrica informativa de omisión de prosa, mismo trato que la línea `pre-reviewer:`. Solo es repesca si la transición por estado TAMBIÉN falló: el relabel no disparó y la rescató Watchdog/humano/re-arm manual) | Materializa la transición Creator→Reviewer por estado (push) en el mismo job, latencia cero — el push ES el camino primario; el tag en prosa solo lo hace legible, no es la única ni la principal costura | Comentario en el PR |
| `<!-- open-review-failsafe -->` | Post-step open-review-failsafe (`claude-code.yml`, AP-016) al aplicar `needs-review` por PAT ante un `opened` perdido | Auditor/5-whys (métrica de arista single-shot rescatada); humano | Registro de que la transición Creator→Reviewer se materializó por estado en la apertura del PR | Comentario del post-step en el PR |
| `<!-- visual-cases-start/end -->` | Reviewer (delimita casos visuales) | visual.yml (los extrae a `/tmp/visual-cases.txt`) | Alimenta la verificación visual dirigida | Comentario del Reviewer |
| `<!-- process-review-done -->` | process-reviewer (línea final del comentario de resultado de su ciclo: lista de propuestas o `Sin propuestas.`) | process-review.yml (guard de idempotencia y fail-safe de presencia, finplan#1326 2026-07-13) | Materializa «revisión de proceso hecha»: sin él, el fail-safe marca el panel `process-review-pendiente` y pone el run en rojo — el exit code de la sesión no cuenta como resultado | Comentario en el issue de auditoría |

### Marcadores de decisión

| Marcador | Lo emite | Lo consume | Efecto | Dónde vive |
|---|---|---|---|---|
| `<!-- autonomous-decision -->` | architect-resolve / Auditor (decisión NO derivable, régimen autónomo) | Humano (veto asíncrono); cortacircuito de doble rebote | Decide y ejecuta sin parar la cadena; racional completo obligatorio | Comentario en issue o PR |

### Marcador de decisión derivada

| Marcador | Lo emite | Lo consume | Efecto | Dónde vive |
|---|---|---|---|---|
| `<!-- derived-decision -->` | Creator o Auditor (resolver-protocol) | Humano (veto asíncrono); trazabilidad | Resuelve sin parar la cadena una decisión implicada por ADR/spec, con cita verbatim obligatoria. Cap 2/issue | Comentario en issue o PR |

## Marcadores de cierre de turno (texto, no HTML)

Vocabulario: veredictos del Reviewer `LGTM` / `REVIEW` / `NITS` (primera palabra del
comentario); cierres del Creator `@reviewer` / `[READY-TO-MERGE]` / `[NEEDS-HUMAN]`.
Mecánica completa: CLAUDE.md § «Loop protocol with Reviewer» (casa única, no se duplica aquí).

**Transición Creator→Reviewer: el PUSH es la transición primaria (2026-07-14, wmcb#38).**
El cierre de prosa (`@reviewer`) es cortesía legible y vía rápida, NO el mecanismo: la
omisión observada es ~50% y el sistema no depende de ella. El post-step «Re-review por
estado» de claude-code re-etiqueta `needs-review` mecánicamente cuando la sesión hizo
push y el Auto-label no actuó. Un turno que empujó código YA transicionó; la prosa solo
lo hace legible.

## Labels

| Label | La pone | La consume | Efecto |
|---|---|---|---|
| `epica` | Architect al publicar la cadena (issues) | epic-merge (gate de auto-merge); Reviewer (LGTM pinga al Creator) | Activa el régimen de épica |
| `correctivo` | Auditor en sus issues | Convención (humano/Architect) | Identifica hijos de auditoría |
| `auditoria` | epic-merge al crear la auditoría | Convención; búsqueda de informes (sensor de proceso) | Identifica issues de auditoría |
| `needs-review` | Steps de claude-code (PAT): Auto-label (tras `@reviewer`) y Re-review-por-estado (tras push sin tag — transición primaria) | Reviewer (trigger `[opened, labeled]`; ignora `labeled` de `claude[bot]`) | Re-dispara la review. NUNCA ponerla como Creator |
| `estado:esperando-ci` / `-reviewer` / `-creator` | epic-merge en cada evaluación (quitadas al merge) | Humano | Estado de la cadena de un vistazo en la lista de PRs |
| `estado:esperando-architect` | Post-step `creator-escalated` de `claude-code.yml` (PAT), junto a `stalled` | Dispatcher de turno del watchdog (CEDE — no declara `turno-de-nadie`); architect-resolve (lo limpia al rular/re-armar); Humano (vistazo) | Materializa «escalado a architect-resolve, esperando ruling» desde dentro del loop de PR — el estado que faltaba y que degradaba una escalada correcta a `turno-de-nadie` (2026-07-15, repesca finplan#1391, AP-017) | Label en el PR |
| `stalled` | Watchdog/epic-merge al agotar caps | Etapa architect-resolve del Watchdog (régimen autónomo: diagnostica, decide, des-stallea y re-arma); el humano solo tras doble rebote (`human-needed`) | Cortacircuito de ronda, ya NO parada hasta humano |
| `pause-agents` | Humano | Watchdog y epic-merge (kill-switch) | Congela el ítem para todo el pipeline |
| `human-needed` | Reviewer (`[NEEDS-HUMAN]`) / Auditor | epic-merge (kill-switch) | Bloquea auto-merge; requiere decisión humana |
| `rondas:N` | epic-merge en cada merge parcial (N = parciales de la vida del issue; sustituye la anterior) | Humano/Architect (visibilidad) | Vida acumulada del issue de un vistazo; a `rondas:6` el siguiente parcial dispara `rounds-cap-reached` |
| `serial-activo` | claude-code.yml (guard serial) al DEJAR PASAR un arm desde issue — atómico con la comprobación | Creator (la borra al abrir su PR, post-step); Watchdog (la borra si el Creator murió sin PR) | Materializa «hay un Creator en vuelo» y cierra la ventana ciega entre arm y nacimiento del PR; el guard bloquea nuevos arms si está presente O hay PR claude/* abierto | Label en el issue lanzador |
| `serial-ok` | Humano (manual) | claude-code.yml (guard serial: omite el bloqueo) | Override del hard stop serial — arma aunque haya otro Creator en vuelo, bajo responsabilidad del que la pone | Label en el issue |
| `ci-verde` | ci.yml al terminar en verde (GITHUB_TOKEN; attempt 1 de código nuevo la retira junto a `lgtm`) | epic-merge (gate 1, hecho primario) | Hecho materializado ADR-218; su ausencia = CI pendiente/rojo para el head actual | Label en el PR |
| `lgtm` | reviewer.yml, post-step determinista tras la sesión (PAT — su `labeled` dispara epic-merge); retirada por veredicto REVIEW/NITS o por código nuevo (ci.yml) | epic-merge (gate 2, hecho primario; trigger `labeled`) | Hecho materializado ADR-218; el edge del orden LGTM-después-de-CI | Label en el PR |
| `auditoria-completa` | Auditor al terminar su informe (cierre del rol, con o sin correctivos) | process-review.yml (trigger `labeled`); Architect (marca de épica leída al limpiar la cola) | Dispara la revisión de proceso; el issue de auditoría queda ABIERTO como panel hasta el lanzamiento de la épica siguiente | Label en el issue de auditoría |
| `registro-decisiones` | watchdog-heartbeat (crea el issue-digest si no existe) | watchdog-heartbeat (localización idempotente); Humano (veto asíncrono) | Identifica el issue-registro de decisiones autónomas. NO cerrar |
| `process-proposal` | process-reviewer (`process-review.yml`, al cerrar auditoría) | Humano (gate de aplicación); Architect | Propuesta de mejora de proceso con evidencia+coste/riesgo; cap 2/épica; JAMÁS contiene la mención de arm |
