<!-- Las referencias ADR-NNN, #issue y fechas de incidentes de este doc son del repo de ORIGEN del framework (provenance histórica), NO del repo consumidor. No las resuelvas contra el decisions.md local. -->
<!-- synced from agent-pipeline@v1 — DO NOT EDIT locally; changes arrive as sync PRs -->

# Protocolo de coordinación entre agentes — vocabulario único

Los agentes se coordinan por **marcadores** (comentarios HTML invisibles en render)
y **labels**. Un marcador olvidado falla en silencio (ADR-209 sin `epic-audit`;
#1087 sin `partial-pr`): esta tabla es la fuente única del vocabulario y el
checklist antes de intervenir a mano. Append-only: si un workflow introduce un
marcador o label nuevo, se añade aquí en el mismo cambio.

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
| `<!-- ping-creator -->` | Reviewer (línea 2 del veredicto) y Watchdog | Filtro de claude-code.yml | Despierta al Creator aunque el render corrompa el `@claude` | Comentario en el PR |
| `<!-- epic-merge-diag -->` | epic-merge en cada evaluación | Humano/Architect por API; el camino de merge manual (dedupe: busca «MERGEADO») | Explica por qué (no) mergeó. **Leerlo antes de mergear a mano** | Comentario en el PR (se actualiza in-place) |
| `<!-- watchdog-rearm -->` | Watchdog (etapa architect) al re-armar | Watchdog (contador, cap 2) | Al 3º: label `stalled` + diagnóstico sin `@claude` | Comentario en issue/PR |
| `<!-- watchdog-rebase -->` | Watchdog (detect) en PR en conflicto | Watchdog (contador, cap 2) | Ping de rebase; al agotar: anomalía `pr-dirty-persistent` | Comentario en el PR |
| `<!-- watchdog-ci-retry -->` | Watchdog (detect) al reintentar CI rojo | Watchdog (contador, 1 retry) | Reincidencia → anomalía para la etapa architect | Comentario en el PR |
| `<!-- skill-edit: <tipo> <fecha> -->` | process-reviewer al ejecutar una edición del loop de skills (ADR-212) | Auditor (¿recurrió el tipo?); process-reviewer (revert a las 2 épicas sin mejora) | Marca qué heurística ataca qué patrón; ancla del revert | Línea editada en `## Heurísticas aprendidas (loop)` de la SKILL |
| `<!-- flaky-harvest -->` | Watchdog (step Harvest, tras el retry del modo d) | Auditor (conteo por épica); Creator/Architect (fix del test) | Registra los tests fallidos del attempt 1 (candidatos a flaky, confirmados si el re-run sale verde); ≥2 apariciones del mismo test en una épica ⇒ correctivo | Comentario en el PR |
| `<!-- watchdog-turn-relaunch -->` | Watchdog (dispatcher de turno, ADR-217) al relanzar mecánicamente una transición rota (re-labeled, re-arm) | Watchdog (contador, cap 2 — junto con `watchdog-handoff-fix` histórico) | Zombi persistente tras 2 relanzamientos ⇒ anomalía `turno-*-zombie-persistent` para architect-resolve | Comentario en el PR |
| `<!-- watchdog-handoff-fix -->` | HISTÓRICO (modo e, absorbido por el dispatcher de turno de ADR-217; cuenta para el cap de relanzamientos) al re-aplicar `needs-review` con el PAT tras un handoff Creator→Reviewer roto | Watchdog (contador, cap 2) | Reincidencia (2 fixes sin veredicto) → anomalía `reviewer-handoff-broken-persistent` para la etapa architect | Comentario en el PR |
| `<!-- visual-cases-start/end -->` | Reviewer (delimita casos visuales) | visual.yml (los extrae a `/tmp/visual-cases.txt`) | Alimenta la verificación visual dirigida | Comentario del Reviewer |

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

## Labels

| Label | La pone | La consume | Efecto |
|---|---|---|---|
| `epica` | Architect al publicar la cadena (issues) | epic-merge (gate de auto-merge); Reviewer (LGTM pinga al Creator) | Activa el régimen de épica |
| `correctivo` | Auditor en sus issues | Convención (humano/Architect) | Identifica hijos de auditoría |
| `auditoria` | epic-merge al crear la auditoría | Convención; búsqueda de informes (sensor de proceso) | Identifica issues de auditoría |
| `needs-review` | Step Auto-label de claude-code (PAT) tras `@reviewer` | Reviewer (trigger `[opened, labeled]`; ignora `labeled` de `claude[bot]`) | Re-dispara la review. NUNCA ponerla como Creator |
| `estado:esperando-ci` / `-reviewer` / `-creator` | epic-merge en cada evaluación (quitadas al merge) | Humano | Estado de la cadena de un vistazo en la lista de PRs |
| `stalled` | Watchdog/epic-merge al agotar caps | Etapa architect-resolve del Watchdog (régimen autónomo: diagnostica, decide, des-stallea y re-arma); el humano solo tras doble rebote (`human-needed`) | Cortacircuito de ronda, ya NO parada hasta humano |
| `pause-agents` | Humano | Watchdog y epic-merge (kill-switch) | Congela el ítem para todo el pipeline |
| `human-needed` | Reviewer (`[NEEDS-HUMAN]`) / Auditor | epic-merge (kill-switch) | Bloquea auto-merge; requiere decisión humana |
| `rondas:N` | epic-merge en cada merge parcial (N = parciales de la vida del issue; sustituye la anterior) | Humano/Architect (visibilidad) | Vida acumulada del issue de un vistazo; a `rondas:6` el siguiente parcial dispara `rounds-cap-reached` |
| `ci-verde` | ci.yml al terminar en verde (GITHUB_TOKEN; attempt 1 de código nuevo la retira junto a `lgtm`) | epic-merge (gate 1, hecho primario) | Hecho materializado ADR-218; su ausencia = CI pendiente/rojo para el head actual | Label en el PR |
| `lgtm` | reviewer.yml, post-step determinista tras la sesión (PAT — su `labeled` dispara epic-merge); retirada por veredicto REVIEW/NITS o por código nuevo (ci.yml) | epic-merge (gate 2, hecho primario; trigger `labeled`) | Hecho materializado ADR-218; el edge del orden LGTM-después-de-CI | Label en el PR |
| `auditoria-completa` | Auditor al terminar su informe (cierre del rol, con o sin correctivos) | process-review.yml (trigger `labeled`); Architect (marca de épica leída al limpiar la cola) | Dispara la revisión de proceso; el issue de auditoría queda ABIERTO como panel hasta el lanzamiento de la épica siguiente | Label en el issue de auditoría |
| `registro-decisiones` | watchdog-heartbeat (crea el issue-digest si no existe) | watchdog-heartbeat (localización idempotente); Humano (veto asíncrono) | Identifica el issue-registro de decisiones autónomas. NO cerrar |
| `process-proposal` | process-reviewer (`process-review.yml`, al cerrar auditoría) | Humano (gate de aplicación); Architect | Propuesta de mejora de proceso con evidencia+coste/riesgo; cap 2/épica; JAMÁS contiene la mención de arm |
