# Registro de decisiones — agent-pipeline (central)

Decisiones estructurales del repo central `agent-pipeline`, que sirve sus
workflows por `workflow_call` a los consumidores (finplan, wmcb). Viven aquí,
no en el `decisions.md` de finplan, porque el central sirve a varios consumidores
y sus decisiones no son de finplan (mismo criterio de "un hogar, un escritor" que
sacó las preferencias del propietario a `user-context`).

Numeración propia `AP-NNN`, distinta de los `ADR-NNN` de finplan para no
confundirlas. **Sin `adr-lint`**: en finplan el lint existe porque el pipeline
mergea ADRs de forma autónoma; aquí nada aterriza sin merge humano sobre PR —
esa revisión es el gate. Formato ligero a propósito: contexto, decisión,
alternativas descartadas, reversibilidad, fecha. No es el aparato de finplan.

> **AP-001 y AP-002 son reconstrucciones** del estado del repo, no decisiones
> presenciadas al tomarse. Se registran para dejar constancia; su racional debe
> verificarse contra los ficheros, no tomarse como verbatim del propietario.

---

## AP-001 — Fase B: el central sirve los workflows por `workflow_call` *(reconstruido)*

**Contexto.** Los 5 workflows del pipeline (`claude-code`, `epic-merge`,
`process-review`, `reviewer`, `watchdog`) son reusables `workflow_call` que viven
en el central. Cada consumidor tiene stubs que delegan en ellos anclando `@main`
(verificado en los 5 stubs de finplan). Un cambio en `main` del central despliega
a todos los consumidores en su siguiente run.

**Decisión.** El central es la fuente única de la lógica de workflow; los
consumidores solo declaran triggers y delegan. Todo parche de lógica se hace
sobre el central, nunca sobre el stub (parchear el stub es parchear un fichero
muerto). Evaluar el blast radius compartido antes de cualquier cambio.

**Alternativas descartadas.** Duplicar la lógica por consumidor (drift garantizado).
Anclar por tag en vez de `@main` (los tags quedaron como milestones documentados,
no como pin de release para repos owner-operated).

**Reversibilidad.** Alta en teoría (re-inlinar en cada consumidor), cara en la
práctica (N copias que mantener). Es la arquitectura base, no un experimento.

**Fecha.** Anterior a esta sesión; registrado 2026-07-12.

---

## AP-002 — Manifiesto de labels + anti-drift *(reconstruido)*

**Contexto.** Un consumidor nuevo se provisiona desde `templates/labels.json`. Si
una label que un workflow usa no está declarada, el consumidor nace roto.

**Decisión.** `templates/labels.json` (labels a provisionar) + `templates/labels-usage.json`
(qué workflow usa qué label) + `scripts/check-labels.mjs`, que verifica en el CI
que toda label fija usada está declarada, todo workflow está declarado y no hay
declaraciones huérfanas.

**Alternativas descartadas.** Confiar en que las labels se creen a mano por
consumidor (drift silencioso — el modo de fallo que este check caza).

**Reversibilidad.** Alta; es un check aditivo.

**Fecha.** 2026-07-12 (creado ese día como primer check propio del central).

---

## AP-003 — Contrato publicado de reusables + `check-contracts`

**Contexto.** La superficie `workflow_call` (inputs, secrets required) de cada
reusable es un contrato que los stubs de los consumidores deben satisfacer.
Romperla —quitar/renombrar un input, pasarlo a `required`, quitarle el `default`,
volver un secret `required`— rompe a los dos consumidores en su siguiente run, y
hasta ahora eso ocurría por un drag-and-drop invisible, sin nada que lo cazara.

**Decisión.** El central **publica** el contrato en `templates/workflow-contracts.json`
y `scripts/check-contracts.mjs` lo verifica en el CI con semántica **asimétrica**:
lo compatible (input nuevo con default, secret que deja de ser required) pasa en
silencio; lo rompedor exige editar el contrato **a propósito**, convirtiendo un
cambio de superficie en un acto deliberado en dos partes (implementación +
anuncio de la ruptura). Al hacer un cambio rompedor en un reusable, su entrada en
el contrato se actualiza en el **mismo PR**.

**Límite (honesto).** Caza superficie, no runtime: tamaño de expresión, permisos
del caller y contexto de evento heredado siguen necesitando rodaje real. El check
es necesario, no suficiente; el shakedown en tráfico real sigue siendo el gate final.

**Alternativas descartadas.** Diff contra el commit padre + marcador de override
(no publica nada, y la decisión fue que el central *posee y publica* el contrato).
Validar cross-repo los stubs desde el central (frágil, y le haría conocer
consumidores que no le pertenecen).

**Reversibilidad.** Alta; check aditivo.

**Fecha.** 2026-07-12.

---

## AP-004 — Protección de `main`

**Contexto.** `main` del central desplegaba a los dos consumidores sin ningún gate:
push directo sin required checks. El repo de más blast radius era el menos gobernado.

**Decisión.** `main` protegida: PR obligatorio (sin push directo), status check
`Verificación de plantillas` requerido y verde, rama al día (`strict`), sin
aprobaciones requeridas (0), `enforce_admins: true`, sin force-push ni borrado.

**`enforce_admins: true` es load-bearing, no cosmético.** El PAT del Architect
tiene `admin`; con `enforce_admins: false` el propio PAT podría saltarse la
protección y pushear un workflow directo a `main`, reabriendo el agujero. Con
`true`, nadie la bypassa.

**Alternativas descartadas.** Detección post-hoc sin fricción (una ruptura
llegaría a `main` antes de verse). Acotar la protección por path (GitHub no lo
permite: es todo-o-nada sobre la rama).

**Reversibilidad.** Inmediata (un admin la retira). Es configuración, no código.

**Fecha.** 2026-07-12.

---

## AP-005 — `main`-directo, sin `develop`

**Contexto.** finplan tiene `develop`→`main` porque un pipeline autónomo escribe
`develop` a ritmo de épica y `main` es el punto limpio tras el filtro humano.

**Decisión.** El central se queda **`main`-directo vía PR**, sin `develop`. Aquí
no existe ese escritor autónomo: `main` lo escribimos solo el propietario y el
Architect, con revisión humana ya incorporada en el merge del PR. Un `develop`
intermedio sería un gate que no decide nada (su única pregunta —¿revisado y
verde?— ya la responde el PR contra `main`).

**Alternativas descartadas.** Importar `develop`→`main` de finplan (ceremonia sin
la razón de finplan). Rollback: `git revert` de un PR concreto, más limpio que
rebobinar un `main` promocionado en bloque.

**Reversibilidad.** Alta (añadir `develop` si algún día hay un escritor autónomo
sobre el central).

**Fecha.** 2026-07-12.

---

## AP-006 — Régimen de aterrizaje de cambios en el central

**Contexto.** Con `main` protegida, hay que definir quién crea y quién mergea, y
cómo aterrizan los workflows (que no puede escribir el PAT).

**Decisión.**
- **No-workflow** (docs, templates, scripts): el Architect crea el PR por API;
  el propietario mergea. El Architect **no mergea nunca**.
- **Workflow** (`.github/workflows/*`): el propietario los sube a rama+PR y los
  mergea. El Architect prepara el fichero con el nombre de destino.
- El PAT se mantiene **sin permiso `Workflows`** (opción (a)). Así "el humano
  aterriza los workflows" es **mecánico** (el token no puede escribirlos), no
  disciplina.

**Relación con ADR-020 (finplan).** No lo deroga. ADR-020 protege a la App de
Claude Code corriendo *dentro* del CI (credencial distinta, sin `Workflows`); eso
queda intacto. AP-006 fija el mecanismo de aterrizaje de cambios autorizados por
humano, y elige la variante que mantiene esa garantía a nivel de token.

**Divergencia con finplan.** En finplan el humano sube workflows por drag-and-drop
a la rama de trabajo; aquí, por `main` protegida, se suben a rama+PR y se mergean.

**Alternativa descartada.** Dar `Workflows` al PAT (opción (b)) para que el
Architect cree también los PRs de workflow: descartada porque el PAT actúa con la
identidad del propietario —GitHub no distingue autor de mergeador— y "el humano
aterriza workflows" pasaría de mecánico a disciplina no forzable.

**Reversibilidad.** Alta (cambiar el scope del PAT).

**Fecha.** 2026-07-12.

> **Enmienda (2026-07-13).** El aterrizaje de workflows cambia de "el propietario sube a rama+PR" a: **el Architect abre también los PRs de workflows con un token dedicado** (`Credencial_Workflows`: Contents+Workflows RW, **acotado a `agent-pipeline`**, caduca 2026-08-12); el propietario sigue mergeando todo. Motivo: la subida manual resultó fricción impracticable en operación real. La garantía cambia de forma: de "el token no puede escribir workflows" a "token acotado a un solo repo + merge humano obligatorio (AP-004)". El PAT general sigue sin `Workflows`.

---

## AP-007 — Startup-failures de los reusables: limitación conocida

**Contexto.** Al editar-y-pushear un reusable (`secrets: required`), GitHub deja
un run rojo de **0 jobs** (startup-failure): no ejecuta nada, cero impacto en
consumidores. Verificado: 3 de los 5 reusables no tienen runs; 2 tienen un único
rojo de 0 jobs atado al commit que los editó. No es "rojo crónico en cada push".

**Decisión.** No tocar. Es cosmético y no hay fix limpio (GitHub no ofrece
silenciar startup-failures; una guarda ad-hoc sería una pieza mono-función para un
problema estético). Se registra como limitación conocida.

**Pendiente honesto.** El disparador exacto (por qué 2 sí y 3 no) no está clavado;
no se persiguió por no justificar el coste frente a la molestia.

**Reversibilidad.** N/A (no-acción).

**Fecha.** 2026-07-12.


---

## AP-008 — Doctrina de proceso: estado materializado y accountability en las costuras

**Contexto.** Las mejoras de proceso recurrentes comparten una clase: un agente cierra su tarea sin materializar el estado que habilita al siguiente paso, y el fallo vive en la costura entre agentes (guard inerte por input ausente, omisión visibilizada pero no prevenida). Sin una lente escrita, ese criterio vivía en la memoria de la sesión — contra el propio principio.

**Decisión.** Se adopta como doctrina de proceso del pipeline la lente de tres principios: (1) estado materializado, no inferido; (2) accountability de avance (cada agente responde de materializar el estado que habilita al siguiente, no solo de su tarea); (3) el fallo vive en la costura. Hogar canónico: el preámbulo de `vendored/docs-agents/protocol.md`, el doc que ya registra el vocabulario de marcadores/labels que la materializa. Criterio de "arreglado": estado declarado y verificable, no inferible; un fix que solo visibiliza sin prevenir es parcial.

**Alternativas descartadas.** Doc propio `principios-proceso.md` (mono-función; separaría la doctrina de la tabla que la materializa). Registrarla solo aquí sin texto agent-facing (sería memoria de decisión, no doctrina vendorizada que los agentes leen).

**Reversibilidad.** Alta (texto de mandato vendorizado).

**Fecha.** 2026-07-12.

---

## AP-009 — Capa vendored servida en runtime (graft): fin del vendoring por copia

**Contexto.** La Fase B copiaba `vendored/` a cada consumidor y propagaba cambios con PRs de sync manuales (`sync-to-consumer.sh`). Coste recurrente inasumible por cambio de doctrina, y drift real: mejoras del propietario (07-10/07-12) quedaron editadas en copias locales sin subir al central, y al cablear el graft quedaron temporalmente eclipsadas en runtime (corregido en PR #8, upstream previo a la limpieza). El acuerdo original —común en central, custom en local— estaba implementado a medias: separaba pero seguía copiando.

**Decisión.** La composite action **`.github/actions/graft-vendored`** injerta la capa común desde `agent-pipeline@main` en el workspace, en runtime, en cada run de los reusables que cargan agentes (`claude-code`, `reviewer`, `process-review`, `watchdog`; `epic-merge` no carga agente). Todo lo injertado se registra en `.git/info/exclude` (el Creator no puede re-commitearlo). `CLAUDE.md` se compone loop-del-central + `CLAUDE.domain.md` local. Los consumidores committean solo su capa propia (dominio, annexes, stubs; finplan además `adr-lint.mjs` mientras su CI local lo invoque — deuda anotada). `sync-to-consumer.sh` retirado. Verificado en real: process-review (finplan, run 29236975396) y Reviewer (wmcb, PR #29), ambos verdes.

**Alternativas descartadas.** Automatizar los PRs de sync (mantenía la copia y el ritual, solo lo desatendía). Referenciar con tags de versión (reintroducía la promoción de tags que el modo single-operator descartó a propósito).

**Reversibilidad.** Media: revertir exige re-copiar vendored a los consumidores y quitar el step de los 4 reusables. El sync retirado está en el historial de git.

**Fecha.** 2026-07-13.

---

## AP-010 — Serialidad por clase: solo arms que producen PRs de código

**Contexto.** El guard serial (incidente #1303) marcaba `serial-activo` a TODO arm, con retirada asignada solo al Creator (al abrir su PR) o al watchdog. Un arm de auditoría nunca abre PR → label huérfana → deadlock real (finplan #1312 bloqueó los lanzamientos). Por la doctrina AP-008: estado de entrada materializado sin accountability de salida para una clase entera de agente.

**Decisión.** La serialidad se define por su motivo: **un solo agente que produce PRs de código en vuelo**. Arms cuyo issue lleva `auditoria`/`auditoria-completa` quedan fuera del régimen: ni reciben `serial-activo`, ni bloquean, ni son bloqueados. (`process-review` ya estaba fuera: no pasa por el guard.) Implementado en el guard de `claude-code.yml` con el racional inline.

**Alternativas descartadas.** Asignar al Auditor la retirada de la label (mandato = memoria del agente; la exención por clase es mecanismo en el punto de decisión).

**Reversibilidad.** Alta (condición del guard).

**Fecha.** 2026-07-13.

---

## AP-011 — Arquitectura de vigilancia en tres capas

**Contexto.** Incidente finplan#1319 (2026-07-13): el Creator omitió el cierre `@reviewer`; los ticks event-driven del watchdog llegaron dentro de la ventana de liveness, se auto-descartaron en silencio, y la evaluación quedó en manos del cron — **79 minutos de hueco con cron `*/20`** (el heartbeat ya documentaba el cron de GitHub como best-effort: 2 runs en 5h). El evento despertaba al vigilante exactamente cuando el vigilante se negaba a mirar.

**Decisión (del propietario).** La vigilancia del pipeline son tres capas, y **cada activación de una capa es un failure auditable de la capa anterior** (se integra con el 5-whys del Auditor y el fix obligatorio del process-reviewer):
1. **El agente mueve el proceso**: cada transición se materializa en el propio run del agente (post-steps deterministas, re-review por estado). Latencia cero. Camino primario.
2. **Fin de workflow + bound**: el tick `workflow_run` del watchdog hace settle por el bound de liveness COMPLETO (330s) antes de escanear — cada fin de run de agente garantiza una evaluación EFECTIVA a ~5.5 min del evento. (GitHub no tiene disparo diferido nativo: el settle en runner es la implementación; coste céntimos, solo en ticks event-driven.)
3. **Cron + heartbeat**: red final, solo para silencio total del pipeline. NO es una capa de latencia.

**Atribución mecánica de capa:** todo comentario del watchdog (mecánico o del architect-resolve) lleva `<!-- watchdog-capa: <event_name> -->` — el 5-whys del Auditor atribuye cada repesca a la capa que la recogió sin interpretar: capa 3 encontrando trabajo = failure de capa 2; capa 2 actuando = failure de capa 1.

**Alternativas descartadas.** Densificar el cron (best-effort documentado; no es capa de latencia). Scheduler externo (pieza nueva fuera de GitHub). Scan de dos fases con re-evaluación (más complejo que subir el settle al bound; mismo resultado).

**Enmienda (2026-07-16): medición de capas en la transición Creator→Reviewer + regla de encabezado.** Muestreo de los últimos 12 PRs de agente por repo (36): arista de nacimiento, 8/36 reviews llegaron por `open-review-failsafe` (~22% — el `opened` de GitHub se pierde con regularidad en los tres repos; sustrato, sin fix de nuestro lado, coste ~90s de settle); arista de rondas, `turn-close-failsafe` en 11/36 (~31% — el Creator omite el tag de cierre, 7/7 casos inspeccionados sin `@reviewer` en el comentario final). Dato conductual: los mismos cierres sin tag llevan todos su footer formulario de rama — el Creator cumple reglas posicionales/de plantilla e incumple pasos-finales-sueltos. Fix de prosa dirigido: CLAUDE.loop.md pasa el tag de paso final a **encabezado del comentario de cierre** (primera línea). Reduce la tasa; no la lleva a 0 — el belt se queda, y su coste hoy es solo el comentario diagnóstico (la label aterriza en el mismo job, latencia cero). Línea base para la próxima auditoría: 22% / 31%.

**Reversibilidad.** Alta (valor del settle + marcador).

**Fecha.** 2026-07-13.

---

## AP-012 — El central como consumidor de sí mismo: ciclo de mejora automatizado

**Contexto.** El ciclo de mejora (señal → propuesta → implementación → despliegue → cierre) lo ejecutaba a mano el Architect de chat: inventario multi-repo, implementación, PRs, cierres cross-repo. La evidencia del 2026-07-14 (8 señales procesadas en una mañana, la mayoría con diseño ya hecho por los 5-whys) mostró que la parte rutinaria es trabajo de Creator con buen contrato.

**Decisión (del propietario).** En tres fases, todas desplegadas:
1. **Routing por eje al publicar**: el process-reviewer de cada consumidor abre las propuestas de mecánica directamente como issue del central (`Origen: <repo>#<n>` en el body); las locales quedan en su repo.
2. **Agentes en el central** (stubs `self-claude-code`, `self-reviewer`): los issues del central los ejecuta su propio Creator y los revisa su propio Reviewer, con dominio y annexes propios. **Límites duros**: `.github/workflows/**` y `.github/actions/**` fuera del alcance del Creator (escala al Architect); **no existe automerge en el central** — el merge humano es el único gate y no se delega (los cambios al sistema que gobierna a los agentes son exactamente donde ese gate justifica su existencia).
3. **Cierre cross-repo mecánico** (`signal-closer.yml`): issue del central cerrado como completado con `Origen:` ⇒ resolución comentada y señal de origen cerrada.

**Redefinición del Reviewer en el central** (annex): prioridades = blast radius (vendored despliega a 2 consumidores sin gradualidad), coherencia normativa del corpus (agüar un AP registrado = 🔴 sin válvula), prosa-vs-mecanismo (mandato de memoria donde cabe gate = hallazgo, AP-008), contratos (semántica además del check). El mandato genérico del reviewer queda saneado de dominio finplan (movido a su annex).

**Cola serial con arm automático (enmienda mismo día).** La serialidad (un Creator en vuelo, AP-010) aplica en el central como en todo repo — y el hueco «arm bloqueado = evento perdido» se cierra en el reusable, para los tres repos: el guard serial etiqueta `en-cola` al bloquear (estado materializado); al liberarse la serie por un merge sin sucesor (suelto, epic-audit, epic-done), `epic-merge` arma el issue en cola MÁS ANTIGUO (FIFO, `@claude` con PAT, marcador `arm-de-cola`). En el central: stub `self-epic-merge` con `automerge: false` (el merge sigue siendo humano; el stub solo procesa el post-merge) y `loose_audit: false`.

**Enmienda (2026-07-15, decisión del propietario): el Creator del central puede empujar workflows a rama.** La experiencia del primer día del régimen (2 de 3 propuestas escaladas por perímetro; ~70% de las señales de mecánica tocan workflows) mostró que el veto de push convertía al Architect de chat en cuello de botella sin añadir seguridad real: el gate es el merge humano + branch protection, no el push a rama. Implementación estructural, no de prosa: PAT dedicado mínimo (Contents+Workflows, SIN Pull requests) que entra SOLO en el checkout del job creator — **mergear le es materialmente imposible** (sin permiso de PRs; la App no mergea; `enforce_admins`). La escalada queda reservada a decisiones de diseño no derivables.

**Enmienda (2026-07-16): el push de workflows del Creator es post-sesión (rescate), no en sesión.** Verificado en código (`claude-code-action@v1`, `src/github/operations/git-config.ts::configureGitAuth`): la action **borra el `http.<server>/.extraheader` que deja `actions/checkout`** y re-autentica `origin` con su propio token (App `ghs_` u `OVERRIDE_GITHUB_TOKEN`). El PAT cableado en el checkout es por tanto letra muerta para la sesión: el camino canónico de push para diffs con `.github/workflows/**` es el post-step «Push residual con token de workflows (post-sesión)», que lee el secret `WORKFLOWS_PUSH_TOKEN` directamente, publica la rama y abre el PR (demostrado: PR #66 ← run 29480172647). Incidente que motiva la enmienda: el Creator, sin conocer el mecanismo, reportó bloqueo total, pidió parche manual y emitió `[NEEDS-HUMAN]` falso (`creator.md` corregido en este cambio). **Alternativas descartadas:** `OVERRIDE_GITHUB_TOKEN` con el PAT (la action lo usaría para TODA su API: exige ensanchar el PAT a Issues/PRs — deshace la contención de la enmienda anterior — y los comentarios saldrían con la identidad del propietario, con riesgo de auto-disparo del stub por `issue_comment`); exponer el PAT como env del step del agente (token con push a workflows al alcance del LLM en runtime — superficie de inyección que el diseño actual, secret solo en checkout y post-step, evita). El cableado del checkout puede retirarse como limpieza (PR de workflows aparte); mantenerlo es inocuo.

**El rol de chat** pasa de procesar la cola a: gatear diseño, atender escaladas (workflows), e incidentes.

**Alternativas descartadas.** Automerge en el central con gates reforzados (el merge humano ES el régimen, AP-004/006). Watchdog propio del central (volumen bajo; humano en el loop de cada merge; reevaluar si crece).

**Reversibilidad.** Alta: retirar stubs y signal-closer; el routing de Fase 1 revierte con un cambio de prompt.

**Fecha.** 2026-07-14.

---

## AP-013 — El veredicto de auditoría se materializa por ESTADO, no por prosa del tracking comment

**Contexto.** El marcador `<!-- audit-verdict: (clean|findings) -->` del Auditor (wmcb#53) es la mitad-Auditor de la condición de auto-archivo del panel (co-presencia con `process-proposals`, `process-review.yml`). El mandato pedía escribirlo como línea final del informe, pero el informe se materializa cuando la action REESCRIBE el tracking comment de `claude[bot]` («Claude finished…»), y **ese canal elimina todos los comentarios HTML**: el marcador nunca sobrevive. Evidencia empírica dura: 5/5 hilos de auditoría sin marcador y 4/4 re-arms humanos ESTÉRILES (wmcb#55/#58/#65/#66/#68; finplan#1381/#1383/#1386). El re-arm no puede arreglarlo por construcción — la prosa del tracking comment ni siquiera PUEDE portar el estado. Con el auto-archivo (central#30) condicionado a ese marcador, todos los paneles quedaban abiertos señalando falso «ciclo incompleto» y rebotando arms aguas abajo (finplan#1378 `panel-sin-consumir`). Clase de fallo: *transición-por-prosa-no-verificada* agravada — el canal primario es incapaz de portar el estado.

**Decisión (del propietario).** Dos capas, doctrina estado-primario (protocol.md §Principios: estado materializado, no inferido; un fix que solo visibiliza la omisión a posteriori es parcial — el estado se materializa en el mismo job):

1. **Post-step determinista en el workflow del Auditor** (reusable `claude-code.yml`, step «Materializar auditoria-completa»). El `verdict-rearm` (que pedía prosa y era estéril por construcción) se sustituye por DERIVACIÓN POR ESTADO cuando el informe está publicado sin `audit-verdict`: correctivos vinculados al panel (issues `correctivo` por cross-reference del timeline) ≥ 1 ⇒ `findings`; 0 correctivos y sin escalada (`human-needed`) ⇒ `clean`; el post-step publica ÉL el marcador por canal PAT (que conserva HTML) y aplica `auditoria-completa`. **Ambigüedad ⇒ NO deriva:** 0 correctivos con escalada presente (hallazgo/escalado sin correctivo materializado) es fail-safe VISIBLE (run rojo + panel abierto), simétrico a finplan#1326 — un `clean` mal derivado archivaría un panel con hallazgos, por eso `clean` exige ausencia total de señal de hallazgo.
2. **Mandato `epic-auditor.md`** (vendored + `docs/agents/`): el Auditor publica el marcador como comentario SEPARADO vía `gh api` (canal que demostradamente conserva HTML), nunca como línea final del tracking comment; nota general de la limitación del canal para cualquier marcador de agente publicado por tracking comment. Cada correctivo incluye un back-ref al panel de auditoría que lo origina, para que la derivación por estado del post-step pueda contarlos.

**Alternativas descartadas.** Insistir con el re-arm humano/automático del marcador (4/4 estéril — el canal, no el modelo, es la causa; ADR-008/AP-008). Parsear la prosa del informe para el veredicto (sigue siendo transición-por-prosa; el estado — correctivos, escalada — es la verdad materializada). Derivar siempre `findings` en ausencia de marcador (perdería la señal `clean` legítima que el auto-archivo necesita).

**Reversibilidad.** Alta: la derivación es una rama del post-step; el mandato revierte a texto.

**Fecha.** 2026-07-15.

---

## AP-014 — Invariante de la cola serial: todo camino que libera la serie hace pop de cola en el mismo job

**Contexto.** Deadlock observado 2026-07-15 (central#44/#46/#47): el post-step `creator-muerto-sin-pr` liberó la serie (`serial-activo` retirada) a las 16:00 y la cola (#46, #47 `en-cola`) quedó muerta — serie libre, cero PRs, nadie armado. Causa: de los tres caminos del post-step de `claude-code.yml` que liberan la serie, dos hacían pop de cola (`escalada-materializada` y `creator-blocked`, central#34) y el tercero — `creator-muerto-sin-pr`, anterior a central#34 y no retrofitado — no. El único otro pop vivía en el `armQueue` de epic-merge, que solo dispara **por merge**: una liberación sin merge dejaba la cola esperando un evento que podía no llegar nunca. Clase de fallo: costura entre agentes (AP-008 §3), variante del deadlock AP-010 (estado retirado por un camino que no habilita el paso siguiente).

**Decisión (del propietario).** Invariante mecánico: **liberar la serie ⇒ pop de cola (FIFO `en-cola` por `created_at`) en el MISMO job que la libera**, sin excepciones por camino. Implementación: añadir la llamada a `popQueue` en el camino `creator-muerto-sin-pr` (los otros dos ya cumplían). `armQueue` de epic-merge se mantiene como está (es el pop del camino merge y sigue el mismo contrato); la nota «si tocas uno, toca el otro» sigue vigente.

**Alternativas descartadas.** Rearmar automáticamente el MISMO issue muerto (retomar el cierre): cambia la doctrina de rearm (watchdog/humano con diagnóstico hecho) e introduce riesgo de bucle de reintentos; el pop de cola no lo excluye — el rearm del issue muerto hará cola por el guard serial como cualquier otro. Un watchdog que vigile «serie libre + cola no vacía»: poll con latencia frente a push con latencia cero desde el job que ya sabe que liberó (misma razón que AP-008.1).

**Reversibilidad.** Alta: una llamada en un camino del post-step.

**Fecha.** 2026-07-15.

---

## AP-015 — Creación idempotente del issue de auditoría en epic-merge: dedupe fuertemente consistente

**Contexto.** Duplicados observados 2026-07-15 (wmcb#65/#66): DOS runs de Epic Merge del MISMO merge (evento `pull_request`, 12 s de gap) alcanzaron `postMerge` y ambos ejecutaron `issues.create` incondicional → dos issues de auditoría byte-idénticos para el mismo alcance. Coste aguas abajo: dos sesiones de Auditor, dos re-arms humanos, y panel dividido (la revisión de proceso corrió sobre uno mientras el otro quedó abierto sin revisar). El «dedupe» que en otras ventanas (wmcb#67→#68) sí colapsó a UNA auditoría no vivía en el `create` sino en el guard de reproceso del camino manual, que se apoya en el **search index de GitHub** (eventualmente consistente): en ventanas de lag del índice el duplicado pasa. Clase de fallo: costura rota por lectura no fuertemente consistente (protocol.md §1 y §3).

**Decisión (del propietario, ejecutada por el Creator del central).** Hacer idempotente de verdad la creación en el reusable central `epic-merge.yml`, en tres cinturones fuertemente consistentes y deterministas (helper `createAuditIdempotent`, aplicado a los DOS caminos — suelto y épica):

1. **Serialización por rama a nivel de JOB** (`concurrency: epic-merge-<repo>-<rama>`, `cancel-in-progress:false`). Viaja por graft (AP-009) sin tocar los stubs de los consumidores. Ordena las evaluaciones del mismo merge para que el 2º run observe el claim del 1º; necesaria pero no suficiente (con `cancel:false` ambos runs ejecutan).
2. **Claim materializado en el PR mergeado** (protocol.md §1, estado materializado no inferido): un comentario dedicado con marcador `<!-- audit-claim: <título> -->`, leído con `listComments` (lectura por-issue = fuertemente consistente, NO el search index). Comentario SEPARADO del `epic-merge-diag` a propósito: `diag()` reescribe el cuerpo COMPLETO de su comentario en cada llamada, así que un claim embebido allí lo borraría el siguiente `diag()`, reabriendo la carrera.
3. **Cinturón por label** (`listForRepo` REST, NO search) filtrando por **título exacto** = scopeKey (frontera de ciclo exacta, no solo label ⇒ no suprime un panel nuevo legítimo del mismo issue), y **cinturón post-create determinista**: si la carrera coló ≥2 auditorías abiertas con el mismo título, sobrevive la de número MENOR (resolución idéntica en todo run, sin humano); las mayores se cierran `not_planned` apuntando a la superviviente.

**Alternativas descartadas.** Solo `concurrency` (no basta con `cancel:false`). Dedupe por search index (la causa raíz del racy). Embeber el claim en `epic-merge-diag` (lo borra el siguiente `diag()`). Dedupe solo por label sin título exacto (demasiado agresivo: suprimiría un panel nuevo legítimo del mismo issue).

**Contrato `workflow_call`.** Sin cambios (no añade inputs/secrets) ⇒ `templates/workflow-contracts.json` intacto (AP-003).

**Reversibilidad.** Alta: un helper y una clave de concurrency de job; los `create` originales se recuperan revirtiendo el refactor.

**Fecha.** 2026-07-15.

---

## AP-016 — Materialización por estado de la transición Creator→Reviewer en la APERTURA del PR (open-review-failsafe)

**Contexto.** El evento `opened` que auto-dispara `reviewer.yml` al nacer un PR es el ÚLTIMO edge single-shot del camino crítico Creator→Reviewer. Es un disparo ÚNICO y NO idempotente de GitHub Actions: si el evento no se entrega, no hay run, no hay veredicto y la transición queda colgada. Evidencia (finplan#1382, 2026-07-15): PR abierto por `claude[bot]` a las 13:04:12Z, el `opened` no produjo run — sin veredicto ni `needs-review` durante ~19 min; el dispatcher de turno del watchdog (ADR-217) relanzó la transición a las 13:23:39Z (`<!-- watchdog-turn-relaunch -->`, «PR sin veredicto ni needs-review (trigger opened perdido)»). Convergió sin humano, pero **el fallback trabajando ES el failure del camino primario** (doctrina del propietario, 2026-07-13). La doctrina push-primario (AP-013, wmcb#38) ya había materializado POR ESTADO todas las demás aristas Creator→Reviewer del loop — cierre sin tag (turn-close-failsafe), push sin relabel (re-review-por-estado), `lgtm`/`ci-verde` como hechos (ADR-218) — y el nacimiento del PR era el único edge que seguía colgado de un solo disparo. Clase de fallo: *transición crítica dependiente de un evento único no idempotente* (protocol.md §1).

**Decisión (del propietario, ejecutada por el Creator del central).** Añadir un post-step al reusable `claude-code.yml` (open-review-failsafe), gemelo por estado del turn-close-failsafe pero en la apertura. En cuanto el post-step detecta el nacimiento del PR (misma detección que la liberación de `serial-activo`), tras un settle al bound de liveness (~90s, física de materialización de runs — ADR-217 §3) consulta los runs de `reviewer.yml` asociados al head SHA del PR (`listWorkflowRunsForRepo({head_sha})`, identificados por `name` vía el input nuevo `reviewer_workflow_name`, default `Opus Reviewer`, idéntico contrato que watchdog.yml); si NO existe ninguno, aplica `needs-review` con el PAT (`REVIEWER_GITHUB_TOKEN`) — el mismo mecanismo y actor que el turn-close-failsafe: el `labeled` del PAT dispara al Reviewer, y su guard ya ignora `labeled` de `claude[bot]`. El **DEDUPE (consulta previa de runs) es la CONDICIÓN DE APLICABILIDAD, no un extra**: sin él, el belt doblaría una review Opus completa en CADA PR. Idempotente: si el `opened` disparó (caso común), el run existe y el step no toca nada. El desdoble de tokens (lectura de runs con el GITHUB_TOKEN default —`actions: read` añadido a los permisos del job—, escritura con el PAT) es el mismo del modo e) del watchdog.

**Alternativas descartadas.** Dejar el rescate al dispatcher de turno del watchdog (ADR-217): es poll con latencia (~19 min medidos) y, sobre todo, hace primario a un fallback — contra la doctrina push-primario. Aplicar `needs-review` SIN dedupe: doblaría una review Opus en cada PR (coste sistémico, no puntual). Reintentar el `opened` (no es reintetable — es un evento de plataforma). Filtrar los runs por fichero de stub en vez de por `name`: el nombre de fichero del stub difiere por consumidor; el `name` («Opus Reviewer») es la convención estable ya usada por el watchdog.

**Riesgo residual.** Carrera settle-vs-arranque: si el run del `opened` se materializa DESPUÉS del check de 90s, el belt aplica `needs-review` y nacen 2 runs una vez (`reviewer.yml` tiene concurrency por PR con `cancel-in-progress:false` — corren ambas). Coste puntual, no sistémico. Métrica de verificación: los relanzamientos del dispatcher de turno por `opened` perdido deben caer a ~0 en la próxima auditoría de cada consumidor (ADR-217 queda como red, caps intactos).

**Contrato `workflow_call`.** Input nuevo `reviewer_workflow_name` CON default (no-romper — «pasa en silencio», AP-003); publicado igualmente en `templates/workflow-contracts.json` por higiene, como hace watchdog.yml.

**Reversibilidad.** Alta: un post-step, un input con default y un permiso de lectura; se revierte quitando el step.

**Fecha.** 2026-07-15.

---

## AP-017 — Materialización por estado de la escalada del Creator CON PR abierto (creator-escalated)

**Contexto.** El Creator, al toparse dentro de un loop de PR con una decisión que no puede resolver por resolver-protocol pero que el Architect SÍ puede (gate numérico de ADR tipo A3′, ambigüedad de diseño), debe PARAR y escalar (mandato del propio ADR). Pero esa escalada vivía SOLO en prosa: no existía transición materializada. Evidencia (finplan#1391, repesca del ciclo finplan#1390/#1391, auditoría finplan#1392): el Creator escaló correctamente el 🔴(b) del gate A3′ de ADR-210 al Architect en un comentario del PR (19:35), pero ningún estado de despacho se materializó — el PR quedó `estado:esperando-creator`, el dispatcher de turno (ADR-217) lo declaró `turno-de-nadie`, y architect-resolve solo llegó vía el caza-anomalías del Watchdog (`watchdog-rearm`, 20:02:36): **~22 min de escalada→ruling rescatados por FALLBACK, no por HANDOFF directo**. Causa raíz de DISEÑO (5-whys del Auditor): el gate de escalada del Creator carece de transición materializada; el estado «escalado a architect-resolve, esperando ruling» no existía, así que una escalada correcta degradaba a anomalía — el estado se INFERÍA del `turno-de-nadie` en vez de LEERSE declarado (violación del principio 1 de protocol.md: «estado materializado, no inferido»). Clase de fallo: *transición-por-prosa-no-verificada* (AP-013), complemento exacto del hueco que `creator-blocked` (finplan#1350) resolvió para el stop limpio PRE-código SIN PR, que se excluye explícitamente «jamás con PR abierto».

**Decisión (del propietario, ejecutada por el Creator del central).** Cuatro piezas, doctrina estado-primario:

1. **Marcador nuevo `<!-- creator-escalated -->`** (vendored `protocol.md`): lo emite el Creator en su comentario de cierre al escalar al Architect una decisión derivable-por-Architect DESDE DENTRO de un loop de PR. **Tabla de decisión en `creator.md`** (parte de la DoD, evita el solape de vocabulario): sin-PR ⇒ `creator-blocked`; con-PR ⇒ `creator-escalated`; decisión genuinamente humana ⇒ `[NEEDS-HUMAN]` (intacto). Detección ANCLADA como HTML, jamás substring de prosa (clase PR #1133).
2. **Post-step en `claude-code.yml`** (self-contained, gemelo del creator-blocked pero en contexto PR-loop; freshness-checked contra el comentario disparador — lección #180): materializa con el PAT en el instante `stalled` (⇒ architect-resolve POR EVENTO — watchdog `pull_request labeled stalled`, sin esperar al cron) + `estado:esperando-architect` visible en el PR, y publica `<!-- creator-escalated-materializado -->`. El PAT (`REVIEWER_GITHUB_TOKEN`) es CONDICIÓN: un `labeled` del GITHUB_TOKEN default no dispararía al watchdog (anti-loop de GitHub). El step Re-review-por-estado cede al ver `estado:esperando-architect` (evita doble dueño si el Creator pusheó parcial y luego escaló).
3. **Cesión del dispatcher de turno (`watchdog.yml`, ADR-217):** antes de derivar turno, CEDE (mismo patrón que la cesión sobre `dirty`) ante PRs con `estado:esperando-architect` en vez de caer al `else` y declarar `turno-de-nadie`. La regla de mantenimiento ADR-217 §5 (todo marcador/label nuevo en protocol.md actualiza `turnoDe` en el mismo cambio) se cumple: `turnoDe` y la doctrina de `watchdog.md` (mode 5 + architect-resolve) se tocan en el mismo cambio. architect-resolve limpia `estado:esperando-architect` (además de `stalled`) al rular/re-armar.
4. **Docs vendorizados:** filas append-only en `protocol.md` (2 marcadores + label `estado:esperando-architect`), tabla de decisión en `creator.md`, cesión + limpieza en `watchdog.md`.

**Riesgos (contrastados con Known failure classes del pipeline-map).** *Regex polarity blindness* (clase PR #1133): marcador HTML anclado, nunca substring. *Mandate/actor drift* (clase 5): el label se aplica con PAT o el `labeled` no dispara al watchdog. *Interacción con el dispatcher:* el caza-anomalías queda intacto como red; el estado se retira en el mismo paso en que architect-resolve actúa (un estado de cesión mal limpiado enmascararía zombis reales — por eso `watchdog.md` obliga a retirar `estado:esperando-architect` al re-armar). *Solape de vocabulario:* la tabla de decisión en `creator.md` es parte de la DoD.

**Contrato `workflow_call`.** Sin cambios: reusa el secret `REVIEWER_GITHUB_TOKEN` (ya required en claude-code.yml y watchdog.yml), sin inputs nuevos; `estado:esperando-architect` es label dinámica (`estado:*`, auto-creada por addLabels — fuera de `labels.json`/`labels-usage.json`). `templates/workflow-contracts.json` intacto (AP-003).

**Alternativas descartadas.** Dejar el rescate al caza-anomalías del watchdog (es poll con latencia — 22 min medidos — y hace primario a un fallback, contra la doctrina push-primario AP-013/AP-016). Reusar `creator-blocked` para el caso con-PR (gobierna el flujo issue-driven sin PR; su post-step early-returna al ver PR abierto — no cubre el loop). Añadir `estado:esperando-architect` al `skip()` del dispatcher en vez de una cesión mid-loop (más amplio de lo necesario y excluiría también el modo-d de CI; la cesión `dirty` — el precedente citado — es mid-loop `continue`).

**Reversibilidad.** Alta: un post-step, una cesión de un `continue`, filas de doc y un marcador; se revierte quitando el step y la cesión.

**Fecha.** 2026-07-15.

---

## AP-018 — Guards de auditoría idempotentes: dedup por marcador y force pegajoso (estado materializado, no inferido)

**Contexto.** Los dos guards de arm de `claude-code.yml` (`check_chain` → `sin-invariantes`, no bloqueante; `check_panel` → `panel-sin-consumir`, bloqueante) depositaban ruido y bloqueaban arms legítimos por tres defectos independientes de la MISMA clase raíz: violación de AP-008 §1 (estado materializado, no inferido). Evidencia (finplan#1394, 2026-07-15, épica nodo-bit-exacto): en ~1h15 los guards depositaron **8 comentarios automáticos** — `sin-invariantes` ×5 (byte-idénticos) y `panel-sin-consumir` ×3.

1. **Doble disparo por evento de arm.** El primer arm produjo el par de avisos DOS veces con ~25 s de diferencia (20:55:55/57 y 20:56:20/22): dos triggers del stub (`issues` + `issue_comment`) reaccionando al mismo arm, cada run corriendo los guards y comentando.
2. **Aviso informativo sin estado materializado.** `sin-invariantes` no bloquea (el arm CONTINÚA) pero se reposteaba íntegro en cada re-arm aunque nada cambiara: el estado «ya avisé» no existía en ningún sitio.
3. **Force del guard bloqueante no pegajoso.** `panel-sin-consumir` se forzó con `<!-- panel-ok -->` a las 21:09Z; el re-arm de 21:53Z fue abortado por el mismo guard (run 29453493296, 11 s) porque ese comentario concreto omitía el marcador. El force era por-comentario, pero el hecho que certifica («el panel X está consumido») es por-issue/por-panel.

**Decisión (del propietario, ejecutada por el Creator del central).** Un solo remedio homogéneo, coherente con la doctrina estado-primario (AP-008/AP-013): **materializar el estado leyéndolo por-issue (fuertemente consistente, NO el search index — clase AP-015) en vez de inferirlo o re-emitirlo**. Sin tocar los triggers del stub (cambiarlos rompería el arm humano por body y por comentario) — la costura correcta es la idempotencia del guard, no el número de disparos.

1. **`sin-invariantes` idempotente (§1+§2):** antes de comentar, `listComments` y saltar si el marcador `<!-- sin-invariantes -->` ya existe. Cubre el repost en re-arm (§2) y el doble disparo del mismo arm cuando el gap supera la propagación (§1).
2. **`panel-sin-consumir` dedup (§1):** el `stalled` se re-asegura (idempotente), pero el comentario de bloqueo solo se emite si el marcador no está ya presente en el issue.
3. **Force `panel-ok` PEGAJOSO (§3):** el guard lee el marcador de CUALQUIER comentario de confianza del issue (`author_association` ∈ {OWNER, MEMBER, COLLABORATOR} — mismo gate de actor que el arm; en repo público un comentario ajeno no debe forzar), no solo del comentario de arm actual. Un re-arm posterior sin repetir el marcador ya no reabre el bloqueo.

**Doc vendorizado.** `protocol.md`: registro retroactivo de `<!-- sin-invariantes -->` (marcador previo sin fila — misma violación append-only ya corregida para `creator-muerto-sin-pr`), y actualización de las filas `panel-sin-consumir`/`panel-ok` a la mecánica idempotente/pegajosa.

**Riesgo residual.** Carrera del dedup en el doble disparo verdaderamente simultáneo (<propagación de `listComments`): dos runs podrían leer «sin marcador» antes de que cualquiera comente y doblar UNA vez. Coste puntual, no sistémico (los ~25 s medidos bastan para la consistencia por-issue); el lock por evento-arm se descartó por complejidad frente a un fallo puntual raro. La doble EJECUCIÓN del Creator sigue cubierta por el guard serial (`serial-activo`), independiente de este cambio.

**Alcance del agravante estructural.** El agravante estructural del panel (un guard cuyo predicado depende de una acción — `close` de #1381 — fuera del allowlist de TODOS los agentes es un guard que solo un humano puede apagar) se dejó fuera de este ADR por ser un fork de diseño. **Resuelto en AP-019** (opción B del fork: estado declarado `consumido`) tras instrucción explícita del propietario.

**Contrato `workflow_call`.** Sin cambios (no añade inputs/secrets) ⇒ `templates/workflow-contracts.json` intacto (AP-003).

**Reversibilidad.** Alta: tres dedup/lecturas por-issue y filas de doc; se revierte quitando los `listComments` de guarda.

**Fecha.** 2026-07-16.

---

## AP-019 — Guard de panel: estado DECLARADO de consumo (cierra la clase «guard que solo un humano puede apagar»)

**Contexto.** AP-018 dejó explícitamente fuera el agravante ESTRUCTURAL del guard `check_panel`, por ser un fork de diseño no derivable en aquella sesión. Este ADR lo resuelve tras instrucción explícita del propietario (arm de central#55, 2026-07-16: «continúa con el alcance restante; si completa el issue, no lo marques parcial»).

El predicado de `check_panel` era: bloquea el arm si hay auditorías/process-proposals **`open`**. «Consumir» el panel significaba CERRARLO con línea de resolución. Pero `close` está fuera del allowlist de TODOS los agentes (Creator, Reviewer, Watchdog — el watchdog solo tiene `gh issue view/comment/edit/create`, nunca `close`). Consecuencia: **un guard cuyo predicado depende de una acción que ningún agente puede ejecutar solo lo puede apagar un humano.** Evidencia (finplan#1381, 2026-07-15): el panel se declaró consumido TRES veces y el guard siguió bloqueando porque el issue seguía `open`; lo cerró el propietario a mano.

**Fork del issue (central#55).** *(A)* meter `close` en el allowlist del watchdog; *(B)* que el guard acepte el estado DECLARADO (`consumido` materializado) en vez de `open/closed`.

**Decisión: opción (B).** Es la derivable por la doctrina que este mismo hilo estableció — **estado materializado, no inferido** (AP-008 §1, AP-018): el guard lee el marcador `<!-- panel-consumido: #N -->` de CUALQUIER comentario de confianza (OWNER/MEMBER/COLLABORATOR — mismo gate de actor que `panel-ok`) del issue armado y excluye ese panel de la lista de bloqueo aunque siga `open`. **Declarar consumo es un comentario, DENTRO del allowlist de todo agente** ⇒ la clase «solo un humano lo apaga» queda cerrada. La opción (A) se descarta: añade una capacidad DESTRUCTIVA (`close` del ciclo de vida del issue) al watchdog, con blast radius mayor y sin necesidad — es reestructura de allowlist, alcance del Architect.

**Diferencia con `panel-ok`.** `panel-ok` es bypass TOTAL del guard (arma con panel abierto porque el lanzamiento debe preceder al cierre). `panel-consumido: #N` es per-panel: resuelve panels UNO a UNO y el guard pasa verde solo cuando TODOS están consumidos o cerrados — es el estado declarado que faltaba, no un override. El cierre real del panel puede seguir ocurriendo después (signal-closer, epic-merge, humano); el guard ya no depende HARD de él.

**Implementación.** `check_panel` reusa la lectura `issueComments` de AP-018 (sin API extra): recoge los `panel-consumido: #N` de comentarios de confianza a un `Set`, dedup del panel por nº y filtra la lista `open`. El comentario de bloqueo `panel-sin-consumir` enumera las tres salidas (consumir/declarar/forzar).

**Doc vendorizado.** `protocol.md`: alta de la fila `<!-- panel-consumido: #N -->` y actualización de la fila `panel-sin-consumir`.

**Contrato `workflow_call`.** Sin cambios (no añade inputs/secrets) ⇒ `templates/workflow-contracts.json` intacto (AP-003).

**Reversibilidad.** Alta: una lectura de marcador + filtro en un solo step y una fila de doc; se revierte quitando el `Set` `consumed` y su filtro.

**Fecha.** 2026-07-16.

---

## AP-020 — El estado terminal «alcance completo, sin PR» libera la serie y arma la cola (cierra la clase AP-010)

**Contexto.** Deadlock/degradación observada 2026-07-15 (central#46): la sesión final del Creator (18:35Z) concluyó con veredicto verificado «alcance COMPLETO en la rama base, no queda PR que abrir» — el fix del issue había llegado por otro PR (#53, cuyo marcador `partial-pr` fue falso positivo de polaridad). El post-step success-sin-PR de `claude-code.yml` ya libera la serie por tres caminos (v3 `creator-blocked`, v4 escalada no-declarada, `creator-muerto-sin-pr` + pop de cola AP-014), pero NINGUNO clasifica correctamente el veredicto terminal legítimo: una sesión `success` sin commits ahead, sin marcador de bloqueo y con la serie ocupada caía en la clasificación **v4 «escalada no-declarada» ⇒ `human-needed`** — un falso positivo que trata como fallo lo que fue el cierre CORRECTO de la serie (el Creator hizo lo debido: re-verificó y encontró el alcance íntegro). Resultado: #46 quedó `serial-activo`+`human-needed` y la cola (#47/#54) retenida. Clase de fallo: misma familia que AP-010 (la serie solo se liberaba por caminos que la MATERIALIZAN como fallo o como merge) — todo estado terminal legítimo que no desemboca en merge dejaba el veredicto mal materializado. Coherente con protocol.md §Principios: cada agente habilita el paso siguiente; el fin de turno del agente —no solo el merge— es un liberador de la serie (AP-014 lo estableció para la muerte; esta instancia lo extiende al cierre limpio sin PR).

**Decisión (del propietario, ejecutada por el Creator del central).** Cerrar la clase con un ramal propio, no un post-step ad hoc, doctrina estado-primario:

1. **Marcador nuevo `<!-- creator-alcance-completo -->`** (vendored `protocol.md` + `docs/agents/`): lo emite el Creator en su comentario de cierre en el ISSUE al concluir, tras re-verificación, que el alcance está completo en la rama base y no queda PR que abrir. HTML anclado, jamás substring de prosa (clase PR #1133). **Tabla de decisión en `creator.md`** actualizada: distingue `creator-alcance-completo` (veredicto terminal, no escalada) de `creator-blocked` (hueco a resolver), `creator-muerto-sin-pr` (commits ahead sin PR) y `[NEEDS-HUMAN]` (decisión humana).
2. **Ramal v5 en el post-step success-sin-PR de `claude-code.yml`** (chequeado ANTES de la clasificación v4, freshness vs comentario disparador — lección #180): si el marcador está fresco ⇒ retira `serial-activo` si el issue la tenía + **pop de cola** (`popQueue`, espejo del `armQueue` de epic-merge — AP-014: todo camino que libera la serie hace pop en el mismo job) + aplica `estado:cierre-pendiente-humano`, y publica `<!-- creator-alcance-completo-materializado -->`. **NO** aplica `human-needed` ni `stalled` (no es fallo ni escalada). El pop de cola SOLO ocurre si la serie estaba ocupada por este issue (no doble-arma si otro la tenía).
3. **El cierre del issue sigue siendo HUMANO** en el central (merge/cierre no se delega — es el gate que justifica su existencia, AP-004/006/012; coherente con AP-019, que rehusó dar `close` a los agentes y eligió estado declarado): el post-step materializa el estado declarado `estado:cierre-pendiente-humano`, no un `close` de agente. El humano verifica el veredicto y cierra.

**El merge deja de ser el único liberador legítimo por-valor:** epic-merge conserva su rol (pop del camino merge), pero el fin de turno del agente con veredicto alcance-completo es ahora un liberador más — como ya lo eran la muerte (AP-014) y el bloqueo declarado (v3/v4).

**Fail-safe conservado.** Sin el marcador, una sesión success-sin-PR-sin-commits con la serie ocupada sigue cayendo en v4 (`human-needed` + libera + pop): la serie NUNCA queda colgada (no reintroduce el deadlock); el marcador solo distingue el cierre limpio del que necesita humano. La ausencia de marcador es fail-safe VISIBLE (humano mira), simétrico a la doctrina de AP-013.

**Riesgos (contrastados con Known failure classes).** *Regex polarity blindness* (PR #1133): marcador HTML anclado, nunca substring. *Falso positivo del propio marcador:* el ramal exige `!hasCommits` (una sesión con commits ahead sin PR va a `creator-muerto-sin-pr`, que abre el PR — no se pierde trabajo); la tabla de decisión en `creator.md` acota cuándo emitirlo. *Mandate/actor drift:* el post-step usa el PAT (`REVIEWER_GITHUB_TOKEN`) ya presente en el step; `estado:cierre-pendiente-humano` es label dinámica (`estado:*`, auto-creada por addLabels — fuera de `labels.json`/`labels-usage.json`, mismo trato que `estado:esperando-architect` en AP-017).

**Contrato `workflow_call`.** Sin cambios (no añade inputs/secrets; reusa el PAT ya required) ⇒ `templates/workflow-contracts.json` intacto (AP-003).

**Alternativas descartadas.** Otro post-step ad hoc para la instancia 3 (parchea la instancia, no cierra la clase — el propietario lo excluyó explícitamente). Auto-cerrar el issue desde el post-step (añade acción destructiva de ciclo de vida al agente, contra AP-019 y el gate de cierre humano del central). Derivar «alcance completo» por estado sin marcador (ambiguo frente a la escalada no-declarada: ambas son success-sin-PR-sin-commits — solo el Creator sabe cuál es; sin señal declarada se pierde la distinción, exactamente el error que este ADR corrige).

**Enmienda v5.2 (2026-07-16, incidente central#59): el primer alcance-completo real no se materializó — dos defectos mecánicos.** El estreno del ramal sobre #59 (ronda 2: veredicto correcto «alcance completo, sin PR que abrir», cero commits) falló por dos vías independientes, ninguna del diseño v5: **(A) el rescate inventaba trabajo sobre rama virgen** — `git rev-list --count origin/$BRANCH..HEAD || echo "1"` devuelve el fallback cuando `origin/$BRANCH` no existe (rama jamás pusheada), con lo que un no-op legítimo se convertía en `AHEAD=1`, push de rama vacía y muerte de `gh pr create` («No commits between…») ⇒ job rojo. Fix: la referencia de medición es `origin/$BRANCH` si existe, si no `origin/$BASE`; sin referencia verificable se aborta sin rescatar; y guard anti-PR-vacío (PR solo con diff real contra la base). **(C) el guard v4 y `materializeScopeComplete()` leían labels del payload del evento, no vivas**: el comentario de rearm de epic-merge precede a la re-aplicación de `serial-activo`, así que el post-step veía «conversacional sin serie» con la serie ocupada y retornaba sin materializar nada — cerrojo silencioso, la clase exacta que AP-020 mataba. Fix: helper `liveLabels()` (GET del issue en el instante) para toda lectura de labels del post-step. El estado de #59 se materializó a mano (cirugía del Architect, espejo del materializador). Señal de prosa acompañante, sin fix mecánico aquí: el Creator omitió el marcador `<!-- creator-alcance-completo -->` pese al mandato (0/1) — la red ES este post-step, de ahí que sus dos defectos fueran cerrojo total.
**Reversibilidad.** Alta: un ramal en un post-step, un marcador, filas de doc y una label dinámica; se revierte quitando el bloque `if (scopeComplete)`.

**Enmienda v5.1 (2026-07-16, central#56, criterio 1 «success O muerte»).** La primera implementación (#66) alojó el ramal `scopeComplete` DENTRO del bloque `if (outcome === 'success' && !hasCommits)` — cubría el cierre limpio pero NO la otra mitad literal del criterio 1 del issue: «sesión terminal (success **o muerte**)». Un veredicto `creator-alcance-completo` posteado justo antes de una muerte por `max_turns` (outcome ≠ `success`) caía en el ramal genérico de muerte (`creator-muerto-sin-pr` ⇒ `stalled`), misclasificando el veredicto correcto como stall. Enmienda: (1) la materialización se extrae al helper `materializeScopeComplete()` y la detección de marcador fresco al helper `freshScopeComplete()`, ambos definidos una sola vez; (2) el camino de muerte-sin-PR, ANTES de materializar `creator-muerto-sin-pr`, chequea `!hasCommits` + marcador fresco y, si presente, materializa alcance-completo igual que el camino `success`. Con commits ahead el ramal NO aplica (el marcador sería contradictorio — hay trabajo sin PR — y `creator-muerto-sin-pr` ordena abrirlo), preservando el guard `!hasCommits` del diseño original. Sin cambios de contrato ni de vocabulario: el marcador y su semántica son idénticos; solo se amplía la cobertura del post-step a ambos terminales legítimos.

**Fecha.** 2026-07-16.

---

## AP-021 — El aviso `sin-invariantes` se materializa como transición con dueño (stall ⇒ architect-resolve; force pegajoso doc-only)

**Contexto.** El aviso de horneado `<!-- sin-invariantes -->` del guard `check_chain` de `claude-code.yml` (AP-018) era **informativo SIN consumidor**: disparaba, el arm CONTINUABA y nadie tenía en su mandato responderlo. Resultado observado en las DOS únicas épicas con superficie funcional desde que existe el aviso: **épica correctivos finplan#1378** (aviso 2×, ignorado; superficie funcional real — pool persistente + diag — y la verificación funcional del Auditor degradó a los AC del Creator como sustituto) y **épica nodo-bit-exacto finplan#1394→#1393** (aviso 6×, ignorado; fix de nivel de nodo en motor-consumidor + gate de interacción UI, verificación degradada a las aserciones del ADR). El process-review de la aud. finplan#1383 dejó el tripwire explícito: «si la siguiente repite el aviso ignorado, valorar hacerlo accionable». Recurrió. Causa raíz (protocol.md §1-2, doctrina estado-materializado AP-008): el estado «esta épica necesita bloque de invariantes» se AVISABA pero no se MATERIALIZABA como transición con dueño — un aviso que el sistema puede ignorar indefinidamente es ruido, y el coste lo pagaba el Auditor época tras época. Complementa a AP-018 (central#55, que arregló la MECÁNICA DE EMISIÓN — doble disparo, dedup, force pegajoso): este ADR arregla la AUSENCIA DE CONSUMIDOR.

**Decisión (del propietario, ejecutada por el Creator del central).** Convertir el aviso en despacho materializado con dueño, en el mismo guard `check_chain`:

1. **Stall materializado (marcador `<!-- sin-invariantes-stall -->`).** Al armar el PRIMER eslabón de una cadena `epica` cuyo cierre transitivo no declara `## Invariantes funcionales de la épica` en ningún issue Y sin override: en vez de comentar-y-continuar, el guard aplica `stalled` (el step usa el PAT `REVIEWER_GITHUB_TOKEN`, así el `labeled=stalled` dispara al watchdog POR EVENTO — patrón `creator-blocked`/finplan#1350) + comentario de diagnóstico dedupeado por marcador, y aborta el arm (`broken='true'`). El Auditor conserva el rastro.
2. **architect-resolve resuelve en un run** (mandato en `watchdog.md`): (a) la épica tiene superficie funcional ⇒ **edita el issue de épica añadiendo el bloque** (2-4 invariantes ejecutables derivados verbatim del ADR citado) y des-stallea/re-arma; o (b) es doc-only ⇒ publica el marcador nuevo `<!-- invariantes-na -->` que el guard honra de forma **PEGAJOSA para toda la cadena** (mismo criterio de force por-issue que `panel-ok`, AP-018 §3) y des-stallea/re-arma. Si añadir el bloque exige una decisión de diseño no tomada ⇒ escala al Architect con el `stalled` puesto.
3. **Arms posteriores pasan en silencio.** Con el bloque presente (`hasInvariants`), con `invariantes-na` declarado por comentario de confianza, o siendo el (re)arm de un eslabón NO-raíz — marcado por `epic-auto-launch` (epic-merge) **o** `watchdog-rearm` (watchdog), cuya casa canónica del bloque queda aguas arriba e invisible al traversal forward: cero re-avisos y cero re-stalls (converge con el dedup de AP-018 §2).

**Orden de guards (riesgo 2 del issue, failure class 3 del pipeline-map).** El `stalled` debe ponerse ANTES de que el guard serial deje pasar el arm, para no colgar `serial-activo`. `check_chain` corre ANTES de `check_serial`, y `check_serial` está gateado en `check_chain.outputs.broken != 'true'`: al abortar en horneado, serial NO corre y no marca `serial-activo`. El orden ya lo garantiza sin cambios adicionales; documentado en el guard.

**Scope del stall al arm inicial GENUINO de la raíz.** El guard debe disparar SOLO en el `@claude` del Auditor/humano (ARM_TOKEN) que arma por primera vez la raíz — el único que NO trae marcador de encadenado ni de re-arm. Un eslabón NO-raíz se (re)arma por DOS vías, no una (corrección central#59 review, la premisa «downstream ⟺ epic-auto-launch» era incompleta): (1) epic-merge encadena con `epic-auto-launch`; (2) el watchdog re-arma con `watchdog-rearm` cuando el Creator de un eslabón intermedio muere sin PR. En ambas la casa canónica del bloque (issue de épica) queda aguas arriba, invisible al traversal forward desde el eslabón intermedio — sin eximirlas se re-stallearía la cadena a mitad de vuelo (falso stall de un eslabón legítimo en vuelo, exactamente el fallo que la exención previene). El proxy correcto no es un marcador concreto sino **la ausencia de todo marcador de re-arm de cadena** (`isChainRearm = epic-auto-launch || watchdog-rearm`). Es seguro además porque un `watchdog-rearm` SIEMPRE implica que el eslabón ya superó el guard una vez: el arm inicial sin bloque aborta ANTES de armar Creator (`broken='true'`), así que nunca existe un Creator que muera y dispare un `watchdog-rearm` inicial — eximirlo no oculta ninguna omisión real. Como el disparo queda acotado al arm de la raíz, el traversal forward arranca EN la raíz y lee su bloque directamente: la opción (a) de architect-resolve (editar el issue de épica) limpia el stall sin necesidad de traversal-hacia-arriba ni de tocar el mandato de `watchdog.md`.

**Riesgos (contrastados con Known failure classes).** *Latencia de lanzamiento:* la cadena sin bloque se para al armar hasta el ruling — acotado a solo el primer eslabón de cadenas defectuosas, y el camino (a) es lo que hoy hace el humano tarde o nunca. *Invariantes de baja calidad de architect-resolve:* un bloque por ruling puede ser peor que el del Architect — mitigado porque el Auditor ya audita «bad invariant ⇒ Architect's retro» y el veto humano asíncrono aplica al `autonomous-decision`; la regla de cita-verbatim del resolver-protocol acota la invención.

**Doc vendorizado.** `protocol.md`: fila `<!-- sin-invariantes -->` marcada SUPERADA (append-only, no se borra), alta de `<!-- sin-invariantes-stall -->` y `<!-- invariantes-na -->`. `watchdog.md`: mandato de architect-resolve para el tipo `sin-invariantes-stall`.

**Contrato `workflow_call`.** Sin cambios (no añade inputs/secrets; reusa el PAT `REVIEWER_GITHUB_TOKEN` ya required por el step) ⇒ `templates/workflow-contracts.json` intacto (AP-003).

**Reversibilidad.** Alta: el bloque `if (!hasInvariants)` del guard, dos filas de doc y un párrafo de mandato; se revierte restaurando el aviso no bloqueante (`broken='false'`).

**Fecha.** 2026-07-16.

---

## AP-022 — El bloque `permissions` del job del reusable es superficie de contrato: `permissions_required` en el manifiesto + fidelidad y ⊇ en `check-contracts` (cierra la clase del incidente #57)

**Contexto.** 2026-07-15 ~22:58Z: PR #57 añadió `actions: read` a los `permissions` del job del reusable `claude-code.yml`. Regla de GitHub para `workflow_call`: el callee no puede pedir más permisos que los que concede el caller, y un stub con bloque `permissions` EXPLÍCITO deja en `none` toda clave no listada. Los stubs (central `self-*.yml` y consumidores) declaran `permissions` explícito sin `actions` ⇒ `startup_failure` inmediato y SIMULTÁNEO en toda la flota. Agravante estructural del modelo graft/`@main` (AP-009): el stub referencia `@main`, así que el breaking change se propaga en el instante del merge, sin ventana de canario ni rollout. Se resolvió con un hotfix callee-only (leer runs con el PAT en vez de exigir `actions: read` al `GITHUB_TOKEN` — `claude-code.yml` open-review-failsafe, líneas 826-833).

Clase de fallo: **el bloque `permissions` del stub/job del reusable es superficie de contrato caller↔callee, y `templates/workflow-contracts.json` no la modelaba.** El `check-contracts` de #57 pasó en verde porque AP-003 solo verifica inputs/secrets. Cualquier permiso nuevo en el job del reusable era un breaking change de flota invisible para la gobernanza. AP-003 fijó el principio («romper la superficie de un reusable exige editar el contrato a propósito») pero dejó `permissions` fuera del modelo; este ADR lo incorpora.

**Decisión (del propietario, ejecutada por el Creator del central).** Evaluadas las tres propuestas del issue:

1. **Contrato — ADOPTADA e implementada.** Se añade `permissions_required` a cada entrada de `templates/workflow-contracts.json`: la **unión (máximo scope por clave) de los permisos que los jobs del reusable piden al caller** (nivel de job REEMPLAZA al de workflow en GitHub — no se fusiona). `scripts/check-contracts.mjs` verifica dos cosas:
   - **Fidelidad exacta** reusable↔contrato. A diferencia de inputs (asimétrico), aquí cualquier deriva es rotura publicable: pedir MÁS es `startup_failure` de flota instantáneo (#57); pedir MENOS deja el contrato rancio. Ambas exigen editar `permissions_required` A PROPÓSITO — justo lo que faltó en #57. (Verificado: inyectar `actions: read` en el job del reusable ⇒ CI ROJO con mensaje accionable; revertir ⇒ verde.)
   - **⊇ asimétrico stub↔reusable**: cada stub del central (los `self-*.yml`; los de los consumidores viven en otros repos e son invisibles al CI del central) debe CONCEDER ⊇ los `permissions_required` del reusable que invoca. Conceder de más es válido; omitir una clave de un bloque explícito (⇒ `none`) es el fallo de #57. Un stub sin bloque `permissions` explícito hereda el default del repo (no razonable estáticamente) y se omite del check ⊇. (Verificado: quitar `issues: write` a `self-claude-code.yml` ⇒ ROJO.)

   El check del central no ve los stubs de finplan/wmcb, pero (a) la **fidelidad** corre en el CI donde vive el reusable — es exactamente donde #57 habría ido rojo — y (b) publicar `permissions_required` da a los consumidores la especificación que sus stubs deben satisfacer.

2. **Doctrina — ADOPTADA.** Los permisos del job del reusable quedan **congelados**. Toda capacidad nueva que requiera permisos se resuelve con los PAT ya en env (patrón del hotfix: leer/escribir con `REVIEWER_GITHUB_TOKEN` en vez de pedir el permiso al `GITHUB_TOKEN`) o se tramita como **migración de flota explícita: stubs primero (conceder el permiso en TODOS los stubs), reusable después** — orden inverso al de #57. Añadir un permiso a `permissions_required` sin esa migración previa es, por construcción, un breaking change; el check lo hace un acto deliberado, no un efecto colateral.

3. **Canario — RECHAZADA (evaluada).** Que el central consuma `@main` mientras los consumidores anclan un tag/rama estable reintroduciría una forma de sync que AP-009 («Capa vendored servida en runtime (graft): fin del vendoring por copia») eliminó deliberadamente, y añade coste de promoción manual permanente para cubrir una clase de fallo que las propuestas 1+2 ya cierran en origen. La gobernanza (hacer el breaking change imposible de introducir en silencio) es preferible al rollout (amortiguar su propagación). Queda descartada; si en el futuro apareciera una clase de rotura de flota NO detectable por contrato, se reabre.

**Riesgos (contrastados con Known failure classes).** *Cobertura parcial del ⊇:* el CI del central solo ve sus `self-*.yml`; los stubs de los consumidores no se verifican aquí — mitigado porque la **fidelidad** (el guard que caza la regresión de #57) sí corre en origen y `permissions_required` queda publicado como spec. *Semántica de `permissions` mal modelada:* GitHub reemplaza (no fusiona) el bloque a nivel de job; `requiredPermissions()` toma job-level si existe, si no workflow-level, y `none` no impone mínimo — cubre los cinco reusables actuales (incluido watchdog, multi-job con override). *Falso positivo por bloque de default:* un stub sin `permissions` explícito se omite del ⊇ (no se puede razonar sobre el default del repo). *Forma `read-all`/`write-all`:* no usada por ningún workflow del repo; si se introdujera, `requiredPermissions`/`grantedPermissions` la tratarían como sin-mínimo — documentado como límite conocido. *Bloque `permissions:` bare (null):* YAML lo parsea a `null` y `typeof null === 'object'`; un helper `asPerms` lo colapsa a `{}` en ambos sitios, de modo que un stub que bloquea todo con `permissions:` (config legítima = concede `none`) recibe el diagnóstico accionable del ⊇ («concede `X:none` pero el reusable exige `X:write`») en vez de un `TypeError`, y un job del reusable con bloque bare se lee como `none` (no como «hereda workflow-level») mirando la PRESENCIA de la clave, no `typeof` — semántica GitHub correcta.

**Alternativas descartadas.** Verificar los stubs de los consumidores desde el central (imposible: viven en otros repos; el modelo es publicar contrato + disciplina del consumidor, AP-003). Semántica asimétrica también para permisos (permitir que el reusable pida MENOS que el contrato en silencio): rechazada — el punto es que TODA deriva de permisos sea deliberada; el filo de esta clase (rotura de flota instantánea) justifica la estrictez frente al trato asimétrico de inputs.

**Contrato `workflow_call`.** `templates/workflow-contracts.json` se AMPLÍA con `permissions_required` en los cinco reusables (superficie nueva del propio manifiesto; no cambia inputs/secrets). Los valores publicados reflejan el estado actual en disco tras el hotfix ⇒ CI verde en este PR.

**Reversibilidad.** Alta: dos helpers + dos bloques de check en `check-contracts.mjs` y un campo por entrada en el manifiesto; se revierte quitando `permissions_required` y los bloques de fidelidad/⊇.

**Fecha.** 2026-07-16.

---

## AP-023 — La transición Creator→PR se EJECUTA por estado: el post-step abre el PR desde la rama viva, no re-arma otra sesión (cierra la clase AP-016 extendida al nacimiento del PR)

**Contexto.** Clase con ≥2 instancias, la última auditada (repesca finplan#1404 → auditoría finplan#1406, 2026-07-16). La transición Creator→PR seguía anclada a un **ACTO terminal del agente** (abrir el PR como último paso de la sesión) en vez de derivarse del **estado observable** (rama `claude/*` con commits ahead + issue referenciado). Cuando la sesión moría tarde con TODO el estado necesario ya presente, la transición no ocurría por vía mecánica: se rescataba re-armando OTRA sesión-agente completa cuyo único Δ esencial era el acto de abrir el PR. Instancias: **finplan#1318** (2026-07-13, origen del post-step «Materializar muerte del Creator sin PR»), **finplan#1329** (v2, cubre `success`-sin-PR con commits), **finplan#1404** (repesca: sesión Creator de 24m41s terminó con el alcance completo commiteado en verde y SIN PR ⇒ post-step materializó `creator-muerto-sin-pr`+`stalled` ⇒ re-arm del Watchdog ⇒ SEGUNDA sesión Creator de 10m31s cuyo Δ fue abrir el PR). El ciclo cerró en verde, pero por el fallback: **el fallback trabajando ES el failure del camino primario** (doctrina push-primario wmcb#38). Causa raíz del 5-whys (finplan#1406): violación del principio 1 de protocol.md (estado materializado, no inferido) en su forma EJECUTIVA — el post-step DECLARABA el estado (`creator-muerto-sin-pr`) pero no EJECUTABA la transición que ese estado ya determina. Misma clase que AP-016 cerró para el edge `opened`, extendida al NACIMIENTO del PR.

**Decisión (del propietario, ejecutada por el Creator del central).** Extender el post-step existente «Materializar muerte del Creator sin PR» de `claude-code.yml` para que, con rama UTILIZABLE (`claude/issue-N-*` con commits ahead y sin PR abierto), ABRA el PR desde el estado en vez de declararlo y stallear:

1. **Apertura determinista.** El post-step abre el PR (`github.rest.pulls.create` con el PAT — ver fix del Riesgo 1) con base = rama base del repo, head = la rama del Creator muerto, body con `Refs #N`, la línea `pre-reviewer: no ejecutado — PR abierto por post-step desde estado` (mantiene evaluable la huella pública), y el marcador nuevo `<!-- pr-abierto-por-estado -->` (fila append-only en `protocol.md`).
2. **Polaridad PARCIAL forzada.** El post-step no puede juzgar full/partial ⇒ declara `<!-- partial-pr -->` explícito (mismo trato que el default del protocolo: sin declaración = parcial), con `Refs #N` en vez de `Closes #N` y una sección «Alcance restante» de texto fijo. Fail-safe conocido: si mergea, epic-merge re-arma el issue (cap 3/6) y un alcance realmente completo termina en `creator-alcance-completo` (AP-020, camino ya materializado y barato) o en cierre humano del suelto.
3. **NO stallear ni re-armar.** La transición quedó EJECUTADA; `stalled`+re-arm quedan SOLO para el caso RESIDUAL (sin rama utilizable / apertura imposible), que conserva su comportamiento previo (`creator-muerto-sin-pr` + `stalled` + `serial-activo` retirada + pop de cola).

**Riesgo 1 — trigger del Reviewer (clase label/concurrency), auditado; CORREGIDO tras review #73.** La propuesta anticipó que un PR de autor no-`claude[bot]` podría no disparar el edge `opened` de `reviewer.yml`. La auditoría reveló lo CONTRARIO relevante: el gate de `reviewer.yml` corre `opened` para CUALQUIER rama `claude/*` (`isAgentBranch`, independiente del autor) y un PAT SÍ dispara `opened` ⇒ abrir con PAT + aplicar `needs-review` **doblaría** la sesión Opus. El refinamiento inicial —**abrir con el `GITHUB_TOKEN` default** para suprimir `opened` + `needs-review` por PAT como única arista— resolvía el doble-review pero introdujo un DEFECTO de segundo orden que el análisis no cubría (detectado en la review de #73): la anti-recursión de GitHub es SIMÉTRICA — un evento del token default no dispara NINGÚN workflow, **incluido CI**. `ci.yml` dispara con `on: pull_request` (`ci.yml:13`) y escribe `ci-verde` solo en ese evento (`ci.yml:65`); sin él, epic-merge queda en `estado:esperando-ci` para siempre (`epic-merge.yml:555-567`: `ci-verde` en labels O un run de CI exitoso para el head SHA — ninguno existe sin el evento `pull_request`, y el CI del central solo dispara `push:[main]` + `pull_request`, no sobre ramas `claude/**`) y el required-check del suelto nunca corre (deadlock, no espera). **Fix adoptado:** abrir el PR con el **PAT** (`github.rest.pulls.create`, `github` del step ya usa `REVIEWER_GITHUB_TOKEN`), IGUAL que el rescate de push normal (`gh pr create`, L664), y **NO aplicar `needs-review`**. El `opened` del PAT es la ÚNICA arista y dispara AMBOS: CI (⇒ `ci-verde`) y la review (gate `opened` + `isAgentBranch` de `reviewer.yml`). Una sola review (no se dobla, porque no hay `labeled`), CI presente, PR mergeable. Cumple el intento de la propuesta (review por estado, no por acto terminal) sin doble review y sin perder CI.

**Riesgo 2 — CI rojo no verificado.** Abrir desde estado no certifica verde; el gate materializado `ci-verde`+`lgtm` (ADR-218) ya protege el merge — un PR rojo espera su turno como cualquiera. (Nota tras review #73: la premisa «CI corre y puede salir rojo» solo se cumple porque el fix del Riesgo 1 abre con el PAT; con el token default CI NO corría en absoluto — ausencia de check, peor que rojo.)

**Riesgo 3 — actor guard / permisos (clase mandate/toolbox/actor-guard drift), auditado.** Al cambiar QUIÉN abre el PR: (a) los guards aguas abajo keyan por **prefijo de rama `claude/*`, no por autor** — epic-merge identifica PRs por `head.ref.startsWith('claude/issue-N-')` y lee veredictos por `REVIEWER_LOGIN`; el dispatcher de turno del watchdog por `head.ref.startsWith('claude/')`; el gate de needs-review del Reviewer exige `sender != claude[bot]` (el sender es el usuario del PAT) ⇒ un PR abierto por token no-`claude[bot]` es transparente para todos. (b) Permisos: `pulls.create` con el PAT (`REVIEWER_GITHUB_TOKEN`) requiere `pull-requests: write`, ya concedido en el job del reusable (y ⊇ en los stubs, AP-022); el PAT ya lo usaba este step para `stalled`/`needs-review`. (c) La retirada de `serial-activo` al nacer el PR la hace ahora ESTE step (el Creator murió y no la retirará): espejo del post-step «Liberar serial-activo al existir PR». **NO** pop de cola: el PR abierto ES la señal de vuelo (el guard serial bloquea con PR `claude/*` abierto) — la serie la libera el MERGE + arma la cola, como cualquier PR.

**Riesgo 4 — re-arm parcial en cadena.** La polaridad parcial forzada consume 1 slot del cap de relanzamientos del issue (cap 3 ronda / 6 vida); aceptable (el caso es raro), documentado en la fila del marcador `pr-abierto-por-estado`.

**Riesgo 5 — carrera de idempotencia (pre-review H2).** El early-check del step (`prs.some(...)`, retorno anticipado) cierra la ventana común, pero dos runs solapados del mismo issue podrían llegar ambos a `pulls.create`; el segundo recibe 422 «already exists». Sin distinguirlo, el `catch` lo trataría como «apertura imposible» y caería al residual (`stalled` + retira `serial-activo` + pop de cola) sobre un issue que YA tiene PR en vuelo — comentario `creator-muerto-sin-pr` espurio + segundo Creator armado desde cola (viola la serialidad). Mitigación: si la apertura falla, se re-consulta la lista de PRs abiertos y, si existe uno para `claude/issue-N-*`, el step hace no-op (la transición ya la ejecutó el otro run) — solo cae al residual si NO hay PR (apertura genuinamente imposible).

**Doc vendorizado.** `protocol.md`: alta de `<!-- pr-abierto-por-estado -->` (body del PR) y `<!-- creator-muerto-sin-pr-abierto-por-estado -->` (comentario del post-step); fila de `<!-- creator-muerto-sin-pr -->` anotada como NARROWED al caso residual.

**Contrato `workflow_call`.** Sin cambios (no añade inputs/secrets; reusa el PAT ya required y el `github.token` default ya disponible; `permissions_required` intacto — `pull-requests: write` ya está) ⇒ `templates/workflow-contracts.json` intacto (AP-003).

**Alternativas descartadas.** Abrir con PAT + `needs-review` (doblaría la review Opus vía `opened`+`labeled`, auditado en Riesgo 1). Abrir con el `GITHUB_TOKEN` default para suprimir `opened` + `needs-review` por PAT (refinamiento inicial; **descartado tras review #73**: la anti-recursión es simétrica y mataría también CI ⇒ `ci-verde` nunca se materializa y el PR queda inmergeable — ver Riesgo 1). Reordenar el step para reusar el post-step `open-review-failsafe` como dedup (más invasivo en un fichero de blast radius doble; abrir con el PAT y confiar en el `opened` — como el rescate de push normal — logra la arista única sin mover steps). Mantener el re-arm de sesión (parchea la instancia, no cierra la clase — es exactamente el fallback que este ADR elimina).

**Reversibilidad.** Alta: un bloque `if (hasCommits && branchRef)` en el post-step, la captura de `branchRef`, y filas de doc; se revierte dejando caer todo al camino residual `creator-muerto-sin-pr`.

**Fecha.** 2026-07-16.

## AP-024 — La materialización de `lgtm` se EJECUTA por estado desde el Watchdog: red por-estado para la ventana de crash del post-step del Reviewer (misma clase que AP-016/AP-023)

**Contexto.** Repesca finplan#1438 (épica ADR-225), auditada en finplan#1439 (5-whys). El run *Opus Reviewer* `29539243435` posteó el veredicto **LGTM en prosa** (2026-07-16 22:25:09Z) y **crasheó ~20 s después** (respuesta HTML de error de la API de GitHub en el post-procesado), ANTES de que su post-step determinista escribiera la label `lgtm` (ADR-218). Cadena de consecuencias: (1) `epic-merge` evaluó el gate con `ci-verde` OK + `lgtm` ausente ⇒ no mergeó; (2) al ser `workflow_run`/`labeled`-driven, el crash mató la label **y su evento `labeled`** — el edge de ADR-218 nunca existió y nada re-disparó la evaluación; (3) el dispatcher de turno del Watchdog rescató re-aplicando `needs-review` ⇒ **una sesión Opus completa re-revisó el PR solo para que su post-step re-escribiera una label** que el veredicto en prosa ya determinaba. Causa raíz de diseño: la transición *veredicto-en-prosa → hecho-materializado (`lgtm`)* estaba acoplada a que un ÚNICO run sobreviviera a su propio post-procesado — no idempotente ni reintentable; un fallo transitorio de infra en la ventana prosa→label orfana el gate de merge. Clase: estado que debía estar materializado queda inferible-pero-no-declarado (protocol.md § Principios 1 y 3 — el fallo vive en la costura). Misma clase que AP-016 cerró para el edge `opened` y AP-023 para el nacimiento del PR, aquí en la costura veredicto→label.

**Decisión (del propietario, ejecutada por el Creator del central; issue nace armado en central#76).** Doble red, misma doctrina que AP-016/AP-023 (materializar por estado, no re-armar sesión). La red primaria (2) del propósito **ya estaba implementada**: la materialización del veredicto en `reviewer.yml` ya vive en un step con `if: always()` (paso «Materializar veredicto (label lgtm)», ADR-218) que lee el último veredicto posteado y escribe/retira la label aunque el step de sesión haya muerto tras postear la prosa. Ese step, sin embargo, NO cubre la **muerte total del runner/job** antes de alcanzarlo (el modo exacto del incidente). Se añade por tanto la red por-estado (1) en `watchdog.yml`:

1. **Firma determinista nueva en el dispatcher de turno (`watchdog.yml`, etapa detect, cero-LLM).** En la rama `lastV === 'LGTM'` (que hoy solo declaraba `turno-epic-merge-zombie` sin `fix` ⇒ escalada Opus), si el PR abierto cumple: (a) último veredicto del Reviewer `LGTM` (primera palabra del comentario, cabecera ADR-063, anclado — regex `verdictRe`, jamás substring); (b) label `lgtm` AUSENTE; (c) head SIN commits posteriores al comentario del veredicto (`getCommit(pr.head.sha).commit.committer.date` vs `lastVerdict.created_at`, **misma comprobación que el `turn-close-failsafe`**) ⇒ re-aplicar `lgtm` con el PAT (`REVIEWER_GITHUB_TOKEN`; su `labeled` re-dispara `epic-merge`, mismo edge de ADR-218). Marcador propio `<!-- watchdog-lgtm-rematerialize -->`, **cap 1** por PR (contador independiente del cap 2 de `watchdog-turn-relaunch`), fila append-only en la fuente única `vendored/docs-agents/protocol.md` (`docs/agents/protocol.md` la recibe por graft en runtime, AP-009 — NO es un fichero trackeado: está en `.git/info/exclude` y `graft-vendored` lo materializa con `cp -f`; forzar su commit crearía una segunda fuente de verdad que el próximo graft pisa. El «×2» de la DoD lo entrega el graft, no dos commits). Firma determinista de rastro-mecánico-ausente ⇒ actúa **sin aging** (regla general del pipeline-map, lección PR #1133).

**Riesgo 1 — merge de código no revisado.** Si hay commits DESPUÉS del veredicto, `ci.yml` (attempt 1) ya retiró `ci-verde`+`lgtm`; re-materializar `lgtm` saltaría esa invalidación. Mitigación implementada: la firma exige head-SHA sin commits posteriores al comentario del veredicto (comprobación (c)), y es **fail-closed** — si `getCommit` falla, `headAfterVerdict` queda en `true` y NO se re-materializa (cae a `turno-epic-merge-zombie` → architect-resolve, comportamiento previo).

**Riesgo 2 — regex polarity blindness (clase conocida del pipeline-map).** El scan de prosa se ancla a la primera palabra del comentario del Reviewer vía `verdictRe = /^\s*(LGTM|REVIEW|NITS)\b/` (cabecera de control ADR-063), reutilizando el mismo parser que ya usa el dispatcher — nunca substring en el body.

**Riesgo 3 — interacción con REVIEW/NITS posteriores.** La firma exige que `lastV` (el ÚLTIMO veredicto por orden de comentarios) sea `LGTM`; un veredicto más reciente la desactiva por construcción (se evalúa `verdicts[verdicts.length - 1]`).

**Riesgo 4 — loop.** Cap 1 vía marcador propio + `fix` que auto-comenta (self-comment, `return true`) ⇒ no consume ni interfiere con el cap 2 de relanzamiento de turno. Reincidencia (label sigue ausente tras el cap 1, o `lgtm` presente pero sin merge) ⇒ `turno-epic-merge-zombie` a architect-resolve, como antes. El post-step `if: always()` del Reviewer sigue siendo el camino PRIMARIO; esto es la red por-estado para la ventana de crash del runner.

**Contrato `workflow_call`.** Sin cambios: no añade inputs/secrets (reusa el PAT `REVIEWER_GITHUB_TOKEN` ya required y `github.token` default), y los permisos del job `detect` ya incluyen `pull-requests: write` ⇒ `templates/workflow-contracts.json` intacto (AP-003, AP-022).

**Alternativas descartadas.** Mover TODA la materialización a un job separado de `reviewer.yml` con `needs`/`if: always()` (el step actual ya es `if: always()`; un job aparte no cubre mejor la muerte del RUNNER completo, que es el modo del incidente, y añade superficie — la única red que cubre esa ventana es la por-estado externa del Watchdog). Re-armar la sesión del Reviewer (exactamente el fallback caro que este AP elimina: una sesión Opus para re-escribir una label ya determinada). Firma con aging (contradice la regla del pipeline-map: la label la pone un mecanismo en segundos; si no está, no aparecerá por esperar — lección PR #1133). Re-materializar sin la comprobación (c) de commits posteriores (abriría el Riesgo 1: merge de código cuya invalidación de CI se saltaría).

**Reversibilidad.** Alta: el cambio es un bloque `if (!hasLgtm && !headAfterVerdict && remats < 1)` dentro de la rama `lastV === 'LGTM'` ya existente, más la constante del marcador y las filas de doc; se revierte dejando la rama con su `why` original (sin `fix` ⇒ `turno-epic-merge-zombie`, comportamiento previo).

**Fecha.** 2026-07-17.

## AP-025 — El terminal «sesión del Reviewer muerta SIN veredicto» se materializa por estado en `reviewer.yml`: rama sin-veredicto del post-step + auditoría de presupuesto (misma clase que AP-016/AP-023/AP-024)

**Contexto.** Repesca finplan#1450 (épica ADR-226, auditoría finplan#1454). El 5-whys del Auditor atribuyó el relanzamiento Creator→Reviewer del Watchdog a «entrega del webhook `opened` perdida»; la evidencia de runs lo desmiente: (a) `05:10:53Z` PR #1450 abierto por `claude[bot]` (head `dc60776`); (b) `05:10:57Z` `reviewer.yml` run `29556672419` dispara sobre `opened` — **el webhook SÍ se entregó**; (c) `05:11:39Z` el `open-review-failsafe` (AP-016) dedupea correctamente (run en curso); (d) `05:20:27Z` el run del Reviewer **muere**: `Execution failed: Reached maximum number of turns (50)` — **sin postear veredicto alguno**; (e) `05:29:05Z` el dispatcher de turno del Watchdog rescata re-aplicando `needs-review`, rotulando «trigger opened perdido» (inferido, erróneo — semilla del 5-whys equivocado). **Causa raíz de diseño:** el terminal «Reviewer muerto SIN veredicto» no tenía materialización por estado — la transición quedaba colgada hasta el paso del Watchdog (~9-18 min + un slot de su cap). Es la **2ª épica consecutiva de la misma CLASE** (materialización acoplada a la liveness del run del Reviewer): finplan#1438 → **AP-024** (veredicto en prosa, label no materializada) y ahora finplan#1450 (ningún veredicto). AP-024 NO cubre esta instancia: su red lee el último veredicto posteado, y aquí NO hay veredicto que leer. Las dos ramas son **disjuntas por «¿existe veredicto para el head?»**. **Causa contribuyente (clase mandate/budget drift):** el mandato universal-strict del Reviewer (2026-07-12) expandió el trabajo por sesión; `--max-turns 50` no se auditó en el mismo cambio — 1ª muerte por presupuesto observada del Reviewer.

**Decisión (del propietario, ejecutada por el Creator del central; issue nace armado en central#79).** Misma doctrina que AP-016/AP-023/AP-024 (materializar por estado, cero LLM, no re-armar sesión):

1. **Rama sin-veredicto del post-step determinista (`reviewer.yml`).** El paso `if: always()` que ya materializaba `lgtm` (ADR-218) pasa a tener **dos ramas disjuntas** por «¿veredicto VIGENTE para el head SHA?». Vigente = último comentario de veredicto (primera palabra `LGTM|REVIEW|NITS`, cabecera ADR-063, anclado — `verdictRe`, jamás substring) posteado DESPUÉS del `committer.date` del head (misma comprobación que el `turn-close-failsafe`/lgtm-remat; **fail-closed** a «hay veredicto» si `getCommit` falla). CON veredicto ⇒ materializa `lgtm` (rama previa, intacta; disjunta de central#76/AP-024). SIN veredicto (incluido `vs.length === 0` y el caso multironda del REVIEW previo) ⇒ re-aplicar `needs-review` con el **PAT** (`REVIEWER_GITHUB_TOKEN`; un `labeled` del GITHUB_TOKEN no dispara `reviewer.yml`, mismo canal que la label `lgtm` de ADR-218): **sesión fresca por EVENTO, latencia cero**. Marcador `<!-- reviewer-no-verdict-relaunch: <headSha> -->`, **cap 1 por head SHA**; reincidencia ⇒ NO re-etiquetar (una 2ª muerte por presupuesto sobre el mismo head = la review no cabe en el presupuesto, no un flake) ⇒ `stalled` con el PAT (⇒ architect-resolve por evento) + `<!-- reviewer-no-verdict-persistent -->`. Filas append-only en la fuente única `vendored/docs-agents/protocol.md` (el `docs/agents/protocol.md` lo sirve el graft en runtime, AP-009 — NO trackeado).

2. **Auditoría de presupuesto (clase mandate/budget drift, mismo cambio).** `--max-turns` de `reviewer.yml` 50 → 80 (default + stub `self-reviewer.yml`; solo se paga si se usa) Y `timeout_minutes` 15 → 22 — el wall-clock DEBE escalar con los turns o el bump es inerte (a 50 turns la muerte de finplan#1450 llegó a los ~9 min; 80 turns rozarían los 15 min y el timeout se volvería el nuevo modo de muerte). Complemento model-side: instrucción de **degradación honesta** en `reviewer.md` (a presupuesto casi agotado, postear `REVIEW` con hallazgos PARCIALES y la cabecera de control ANTES de morir, declarando la cobertura incompleta — nunca un LGTM/NITS que finja cobertura). El post-step (1) es la red que cubre CUALQUIER muerte; el bump ataca la FRECUENCIA.

3. **Higiene del dedupe de AP-016 (`claude-code.yml`).** El `open-review-failsafe` dedupea contra runs del Reviewer para el head; se restringe a `queued`/`in_progress`/`success` — un run ya concluido en `failure` sin veredicto NO cuenta como «trigger opened OK» (lo cubre la rama (1)). En la instancia de finplan#1450 el run estaba en curso, así que esto solo no la habría evitado (por eso el fix es (1)); esto cierra la variante run-ya-muerto.

4. **Cosmética del dispatcher (`watchdog.yml`).** La rama `!lastVerdict` del dispatcher de turno rotulaba una causa inferida («trigger opened perdido»); pasa a rotular el ESTADO observado («PR sin veredicto ni needs-review; último run del Reviewer para el head: <conclusión>»), consultando la conclusión del último run del Reviewer sobre el head. Puramente cosmético (el `fix` es idéntico): evita sembrar 5-whys erróneos en las auditorías (ocurrió en finplan#1454).

**Riesgo 1 — regex polarity blindness (clase conocida del pipeline-map).** Detección de veredicto anclada a la primera palabra del comentario (`/^\s*(LGTM|REVIEW|NITS)\b/`, cabecera ADR-063), nunca substring — mismo parser que AP-024 y el dispatcher.

**Riesgo 2 — loop de relabels.** Cap 1 por head SHA vía marcador; reincidencia va a architect-resolve (`stalled`), no a otra sesión Opus. El `cancel-in-progress: false` del stub garantiza que el relabel (post-conclusión) no mata reviews en vuelo. **El cap depende de PAGINAR los comentarios**: la API de issue-comments devuelve orden ascendente (los 100 más antiguos en la página 1), así que en un PR de épica multironda (>100 comentarios — la clase exacta de finplan#1450) el marcador recién posteado y los veredictos recientes viven en páginas 2+; sin `github.paginate` el cap contaría 0 (loop) y `vs` saldría vacío (relanzamiento espurio de un PR ya revisado). Con el `if (!vs.length) return;` previo esa limitación de paginación era benigna; la rama sin-veredicto la vuelve dañina, por eso el step pagina completo (hallazgo del pre-reviewer).

**Riesgo 3 — guard anti-recursión del Reviewer.** El relabel sale con el PAT, no con el GITHUB_TOKEN (su `labeled` no dispararía `reviewer.yml`); el guard del Reviewer ignora `labeled` de `claude[bot]` — el sender del PAT es el usuario del propietario (no-bot), así que dispara.

**Riesgo 4 — colisión con central#76/AP-024 y doble relabel.** Las ramas son disjuntas por presencia-de-veredicto (con veredicto ⇒ label; sin veredicto ⇒ relanzar). Aplicadas en el MISMO step, sin carrera. La higiene (3) puede hacer que el `open-review-failsafe` y la rama (1) re-apliquen `needs-review` en la MISMA ventana run-ya-muerto (narrow); el peor caso es una review redundante (clase REDUNDANT del ledger, benigna con `cancel-in-progress: false`), acotada por el cap 1 de (1).

**Riesgo 5 — falso positivo multironda.** Un REVIEW de una ronda previa (head viejo) NO cuenta como veredicto del head nuevo (comprobación `created_at` > `committer.date`), así que un push sin re-review posterior cae correctamente en la rama sin-veredicto. Simétrico: un veredicto fresco del head desactiva la rama sin-veredicto por construcción.

**Contrato `workflow_call`.** Sin cambios de superficie: los inputs `reviewer_max_turns`/`timeout_minutes` ya existían con default (solo cambia el VALOR del default, no `has_default`/`required`); no añade inputs/secrets; los permisos del job (`issues: write`, `pull-requests: write`) ya cubren el relabel/`stalled` ⇒ `templates/workflow-contracts.json` intacto (AP-003, AP-022). Se añade `stalled` a la lista de `reviewer.yml` en `templates/labels-usage.json` (check-labels).

**Alcance no aplicable al central.** El `pipeline-map` es artefacto per-consumidor (finplan/wmcb); el central solo tiene la plantilla (`templates/pipeline-map.template.md`), sin instancia que actualizar.

**Alternativas descartadas.** Re-armar la sesión del Reviewer desde el Watchdog (el fallback caro que este AP elimina — la latencia + slot del cap). Firma con aging (contradice la regla del pipeline-map: la materialización es de estado, no de envejecimiento). Solo el bump de presupuesto sin la red (2) sin (1) — un bump nunca elimina la cola de la distribución; la red por-estado es la garantía dura. Solo la higiene (3) — no cubre la instancia real (run en curso, no muerto).

**Reversibilidad.** Alta: la rama sin-veredicto es un bloque `if (!verdictForHead)` antes de la lógica `lgtm` ya existente; se revierte restaurando el `if (!vs.length) return;` original. El bump de presupuesto y la cosmética del dispatcher son cambios locales aislados.

**Fecha.** 2026-07-17.
