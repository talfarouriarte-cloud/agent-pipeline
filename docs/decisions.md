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

