<!-- synced from agent-pipeline@v1 — DO NOT EDIT locally; changes arrive as sync PRs -->
<!-- Los ejemplos históricos citan el repo de origen (finplan): son lecciones con evidencia, no normas de este repo. -->

---
name: adr-docs
description: Convención de numeración de ADRs, registro de ADRs que requieren edit de workflow, docs de diseño de área vs ADR vs CHANGELOG (reglas 1-4), test de regresión asimétrico al arreglar bugs, autoría de issues para el Creator. Leer al redactar ADRs, issues o docs de diseño.
---

# adr-docs (extraído de docs/operational-notes.md, 2026-07-05, movimiento verbatim)

## ADRs que requieren edit de workflow: registrar estado de aplicación

Aprendido durante PR3 (mayo 2026). Un ADR puede documentar una
decisión que requiere edit en archivos que SOLO el humano puede tocar
(p.ej. ADR-024 y ADR-025 requirieron edits a `.github/workflows/` —
ADR-020 prohíbe que el agente los modifique). Si el ADR queda
mergeado pero el edit en el yml no se aplica, el comportamiento real
contradice silenciosamente al ADR.

Caso concreto en PR3: ADR-025 (auto-trigger del Reviewer en PRs de
`claude[bot]`) se documentó en `decisions.md` al cierre de PR2, pero
el edit a `.github/workflows/reviewer.yml` se quedó pendiente. Cuando
se abrió PR3, el Reviewer no auto-disparó. La discrepancia se detectó
solo al notar la ausencia del comentario del Reviewer.

**Convención operativa:** cuando un ADR requiera edit de workflow,
añadir al ADR mismo una línea de checklist:

- `[ ] decisions.md actualizado (este ADR escrito)`
- `[ ] Edit en .github/workflows/<file>.yml aplicado`

Marcar `[x]` cuando esté hecho. Antes de cerrar el chat donde se
discute el ADR, verificar que ambos checks están aplicados —
preferiblemente con un test funcional (abrir un PR de prueba que
ejercite el trigger).

## Convención de numeración de ADRs

Los ADRs son secuenciales en orden de aplicación, no de discusión. Si
discutes un cambio en un chat pero todavía no lo aplicas a
`decisions.md`, el siguiente número disponible NO está reservado —
otro cambio que se aplique antes se llevará ese número. Convención
operativa: solo asigna número definitivo cuando vas a pegarlo a
`decisions.md`. Si discutes varios ADRs en paralelo, redactalos como
borradores con número provisional, y renumera al pegar según el orden
real de aplicación.

Caso práctico: durante el chat de PR2 (mayo 2026), 5 ADRs sobre el
motor se discutieron como 024-028, pero antes de aplicarlos
emergieron dos cambios operativos urgentes (bypassPermissions y
auto-trigger del Reviewer) que se aplicaron primero como ADR-024 y
ADR-025. Los del motor terminaron como ADR-026 a ADR-030. Si hubiéramos
"reservado" 024-028 mentalmente, el orden cronológico de aplicación
habría quedado ilegible.

### Test de regresión asimétrico cuando se arregla un bug (PR7c, 2026-05-11)

Aprendizaje de PR7c round 1 del Reviewer: cuando un fix arregla un bug específico, el test que protege el fix debe cubrir el **comportamiento exacto corregido**, no casos vecinos simétricos.

**Caso histórico.** Reviewer detectó en PR7c que declarar `spec.utility` filtraba silenciosamente los arrays `paths_terminal_wealth` y `paths_consumption_total_real` al output del motor (O(nPaths) memoria sin que el caller los pidiera). El bug existía porque el mismo flag efectivo controlaba dos canales (captura interna + emisión al output) cuando deberían ser distintos.

El fix separó los canales correctamente. Pero los tests que el agente añadió cubrían:

- ✅ "utility omitido → arrays omitidos" (trivial, no cubre el bug).
- ✅ "utility + emitPaths=true → CE matches utility-only" (cubre captura CRN, no cubre emisión).

Y NO cubrían el caso material:

- ⚠️ "utility presente SIN emitPaths flags → CE presente, arrays ausentes" — **el caso exacto que el bug fallaba y el fix arregla**.

Si un futuro refactor volviera a filtrar los arrays cuando `utility` está sin flags, los tests del fix seguirían verdes. El bug entraría sin ser detectado.

**Patrón operativo.** Cuando se pide al agente que arregle un bug:

- Especificar EXPLÍCITAMENTE en el comment que el test debe **fallar antes del fix y pasar después**. Es la única garantía de que el test cubre el bug exacto, no casos cercanos.
- El test del fix debe replicar las condiciones del bug y assertear el comportamiento corregido. Tests vecinos (simétricos, complementarios, sanity) son útiles pero NO sustituyen al test asimétrico exacto.
- Si el agente añade tests "razonables" sin especificación explícita, hacer QA del coverage del fix: ¿este test fallaría si revertieras el fix? Si la respuesta es no, falta el test asimétrico.

**Aplicación retroactiva.** El test asimétrico se añadió en round 2 micro-fix de PR7c. Coste: ~10 líneas, una iteración más.

## Docs de diseño de área, CHANGELOG y disciplina documental

> Entrada añadida 2026-05-17. Cierra el loop pendiente del aprendizaje ya registrado más arriba ("Diseño en chats no migrados — recuperación 2026-05-17").

### Contexto y motivación

Hasta 2026-05-17 las decisiones de diseño técnico-conceptual del motor vivían en dos sitios:

1. **`decisions.md`** (ADRs cronológicas, inmutables) — captura *qué se decidió y cuándo*.
2. **Sesiones de diseño individuales** — capturan *cómo se pensó y por qué*, pero **se pierden** al cerrarse.

Mismo fallo repetido varias veces:
- Diseño detallado de balance personal + real estate + fiscalidad (mayo 2026). ADRs corridas (ADR-067/068/069), pero el razonamiento explicativo **se quedó en las sesiones** y no migró. Reabierto desde cero el 2026-05-17.
- Decisión `basis_real → basis_nominal` acordada en sesión previa: **nunca materializada** a ADR ni a PR. Reabierta el 2026-05-17 desde cero.
- Redacción de `docs/design/optimizer.md` el 2026-05-17: cuatro iteraciones fallidas — primero por leer `/mnt/project/` desactualizado, luego por no leer chats recientes, luego por documentar API sin verificar contra código real.

Diagnóstico añadido el 2026-05-17 al revisar el patrón "empresa de software":
- **No hay `CHANGELOG.md`** en ningún paquete. La fuente de "qué hay en v0.X" es el README + memoria.
- **`packages/engine/README.md` desactualizado** (declara v0.12.0; el motor real va por v0.18). Es mentira documental.
- **Cualquier matriz de features mantenida a mano dentro de los design docs sufriría lo mismo en proporción a su detalle.** Es deuda de mantenimiento que se desfasa en semanas.

### Regla 1: docs de diseño de área son documentos vivos

**Cada área temática del motor con suficiente complejidad para que el razonamiento exceda lo que una ADR puede capturar de forma concisa, mantiene un doc de diseño vivo en `docs/design/<área>.md`.**

Hoy aplica a:
- `docs/design/personal-balance.md` (balance personal + real estate + fiscalidad).
- `docs/design/optimizer.md` (función objetivo lifetime EU CRRA + dos Caminos + algoritmo).

Otras áreas candidatas futuras (no acción inmediata): shocks compuestos, multi-bucket fiscal pretax. Cuándo crearlos: cuando una sesión de diseño sobre esa área produzca > 4 decisiones sustantivas o cuando una ADR sea insuficiente para capturar el razonamiento.

#### Qué va en doc de diseño vs qué va en ADR vs qué va en CHANGELOG

| Tipo de contenido | Ubicación |
|---|---|
| Decisión cronológica con alternativas + consecuencias | ADR en `decisions.md` (corta, inmutable) |
| Razonamiento conceptual de por qué se modela algo así | Doc de diseño (vivo, actualizable) |
| Fórmulas operativas, shape de campos, mecánica de cálculo | Doc de diseño (referenciando JSDoc cuando aplique) |
| Mapa de limitaciones honestas | Doc de diseño |
| Inventario de follow-ups | Doc de diseño (migrar progresivamente a GitHub Issues) |
| Glosario de términos del área | Doc de diseño |
| Versión exacta + cambios incrementales por release | `packages/engine/CHANGELOG.md` (Keep a Changelog) |
| API surface (shapes exactos, signatures) | JSDoc en código |
| Roadmap accionable con prioridad | GitHub Issues con labels |

Cuando una decisión es mixta: ADR corta + sección en doc de diseño + referencia cruzada en ambas direcciones.

### Regla 2: status header por `##`, NO checklist por sección

Cada `##` sustantivo del doc de diseño lleva una línea `**Status:** ...` justo bajo el título. UNA línea, no tabla.

Ejemplos:
```
## 3. Primitiva única `optimizeLifecycle` (spec-driven)

**Status:** Implementado v0.16.0 (PR12d, 2026-05-16). Referencia: ADR-066.
```

```
## 11. Algoritmo: grid search MVP, Bayesian futuro, Bellman descartado

**Status:** Grid implementado v0.16. BO follow-up V0.2. Bellman naïve descartado empíricamente (no implementar). ADP regularizado follow-up V2.0.
```

```
## 6. Sale mechanics y opciones reales

**Status:** PR13a-1 (v0.18) bloquea con throw todo `saleStrategy` distinto de `'never'`. Nivel 1 + opCosts pendientes PR13a-3. Niveles 2-3 follow-up V0.2/V2.0.
```

Convenciones de status:
- **Implementado v0.X.Y (PRxx):** está en código + tests verde + versión exacta.
- **Aplazado V0.2 / V2.0:** decisión consolidada de no priorizar.
- **Diseñado, pendiente PRxx:** acordado pero sin código.
- **Histórico (removido en PRxx):** existió, ya no.
- **Superseded por ADR-XX:** la sección está obsoleta como diseño.

**Por qué status header y NO matriz de features:**

Una matriz mantenida a mano con sub-features (campo del API, output, default numérico) por sección suena rigurosa pero se desactualiza en semanas. El `README.md` de `@finplan/engine` declarando v0.12.0 cuando el motor va por v0.18 es la evidencia: cualquier matriz tendrá el mismo destino.

El status header de UNA línea solo cambia cuando cambia el status **estructural** (raro — implementado / aplazado / superseded). La granularidad fina (qué campo aterrizó cuándo) vive en `CHANGELOG.md` (que SÍ se actualiza en cada PR como DoD) y en JSDoc del código.

### Regla 3: `packages/<paquete>/CHANGELOG.md` Keep a Changelog format

**Estado actual:** no existe. **Requisito:** crear `packages/engine/CHANGELOG.md` retroactivo desde v0.6 (la primera versión razonable donde empezó a haber features sustantivos) + regla operativa que cada PR actualiza la entrada de la versión correspondiente.

Format Keep a Changelog (https://keepachangelog.com/en/1.1.0/):

```markdown
# Changelog

All notable changes to `@finplan/engine` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- ...

## [0.18.0] - 2026-05-XX

### Added
- `RealEstateUnit` shape v0.18 con array de unidades (ADR-067 §1, PR13a-1).

### Deprecated
- `paths_terminal_wealth` output (ADR-065). Criterio remoción: v1.0.0 + cero callers internos.

...
```

Cada release añade entradas. Cada PR actualiza la sección `[Unreleased]`; al bumpear versión, se mueve `[Unreleased]` a `[X.Y.Z] - YYYY-MM-DD` y se abre nueva `[Unreleased]` vacía.

### Regla 4: disciplina del autor antes de cerrar chat de diseño

**Si un chat de diseño con Claude produce decisión sustantiva, antes de cerrar el chat se hace una de estas dos cosas:**

1. **Si ya existe doc de diseño para el área:** redactar issue Creator que actualice el doc Y la ADR correspondiente si aplica. Issue materializado en GitHub, no en "pending TODO".
2. **Si no existe doc de diseño y la decisión es sustantiva:** redactar issue Creator que cree el doc, antes de cerrar el chat.

No se considera cerrado el chat hasta que la decisión esté materializada en repo o issue tracker. Verbalizar la decisión en chat NO es materializarla.

### Responsabilidades concretas

| Actor | Responsabilidad |
|---|---|
| **Autor humano** | Antes de cerrar chat de diseño con decisión sustantiva: redactar issue Creator que materialice la decisión (en doc + ADR si aplica). Verbalización no cuenta. |
| **Creator agent** | En CUALQUIER PR que toque código: actualizar `[Unreleased]` de `packages/<paquete>/CHANGELOG.md` con la entrada correspondiente (Added / Changed / Deprecated / Removed / Fixed). Si el área tiene doc de diseño en `docs/design/`: actualizar status header de la sección afectada SOLO si cambia el status estructural (raro). Si introduce concepto nuevo no documentado: añadirlo al doc. Si elimina concepto documentado: marcarlo deprecated o removido. |
| **Reviewer agent** | Verificar que `CHANGELOG.md` se ha actualizado coherentemente con los cambios de código (bloqueo de aprobación si falta). Verificar que el status header del doc de diseño es coherente con el estado tras el merge. Si el PR introduce sub-feature dentro de sección con doc de diseño, NO exige update del doc (esa info vive en CHANGELOG); solo exige update del status header si cambia el status estructural. |

### Sub-regla operativa: dónde leer la fuente de verdad antes de redactar

Aprendizaje del 2026-05-17 al reescribir `docs/design/optimizer.md` cuatro veces:

1. **`/mnt/project/decisions.md`** que vive en el project context puede ser snapshot anterior al estado real del repo. Si el último ADR es N pero el repo está en N+5, las ediciones del doc partirán de premisas obsoletas.
2. **Zips subidos por el usuario en la sesión** son la fuente más reciente disponible. Especificamente `asesoramiento-financiero-develop_*.zip` (numerados secuencialmente).
3. **Chats no migrados** contienen razonamiento que ni ADRs ni docs cubren. `conversation_search` los recupera.
4. **Código real del zip extraído** es la verdad operativa para shapes de API, exports, JSDoc. NUNCA documentar shape de API sin verificar contra `packages/engine/src/`.

**Procedimiento antes de redactar o actualizar un doc de diseño:**

```
Paso 1: Verificar qué ADRs existen en el repo real (NO en /mnt/project/).
  Si hay zip reciente subido por el usuario → extraerlo, leer decisions.md del zip.
  Si no hay zip → usar /mnt/project/ con consciencia de que puede estar desfasado;
                  preguntar al usuario por el estado actual si la decisión depende.

Paso 2: Verificar qué razonamiento NO está en ADRs.
  conversation_search con keywords del área para recuperar contexto.

Paso 3: Verificar shapes de API contra código real.
  grep / view sobre packages/engine/src/ del zip extraído.
  NO documentar interfaces inventadas: la API real puede divergir
  materialmente de lo que dice el último ADR.

Paso 4: Cruzar inconsistencias entre razonamiento de sesión y ADR vigente.
  Si el ADR difiere de la última decisión en sesión → marcar "decisión
  pendiente de migrar al ADR; estado vigente del código es X, propuesta es Y".

Paso 5: Redactar el doc con referencias precisas.
  ADR + sección de doc + archivo de código + número de línea cuando aplique.
```

Saltar el Paso 1 (asumir que `/mnt/project/` es el estado actual) o el Paso 3 (asumir shape de API basándose en ADRs sin verificar) son los errores que producen iteraciones fallidas.

### Aplicación retroactiva

- Los docs `docs/design/personal-balance.md` y `docs/design/optimizer.md` creados el 2026-05-17 materializan estas reglas por primera vez.
- `packages/engine/CHANGELOG.md` retroactivo desde v0.6 + refresh de README a v0.18 quedan como **issue Creator separado** (a pegar al repo después de esta nota).
- Listas de follow-ups en §12 personal-balance y §21 optimizer se mantienen como referencia conceptual. NO hay migración masiva planificada a GitHub Issues: cada ítem se promueve a issue (con labels `area:optimizer status:planned`, etc.) cuando emerja trabajo concreto sobre él. Que las listas se desactualicen entre tanto es esperado, no deuda.


## Autoría de issues para el Creator: doc dedicado y aprendizaje crónico

Existe `docs/agents/creator.md` con la guía completa para redactar issues que el Creator agent ejecuta como PRs. Cubre:

- Patrón canónico de invocación (`@claude` trigger, zip-en-rama para texto grande, workflow blindado contra fallback API key).
- Estructura recomendada del issue body (estado de partida verificable, scope, criterios de aceptación, out of scope, budget de turns).
- Heurísticas de budget: tabla de coste aproximado por tipo de trabajo + suma esperada para PR razonable.
- Patterns que matan el budget (sincronización masiva de docs prosa, renames batch sin instrucciones de sed, copy-paste literal en body, updates frecuentes del comment, etc.).
- Mitigaciones específicas (sed batch, zip-en-rama, limitación de updates del comment).
- Reglas absolutas (trigger, workflows no se tocan por el Creator, DoD de TOC/CHANGELOG/status headers, auth blindada).
- Historial de aprendizajes empíricos (PRs que fallaron y por qué).
- Cuándo dividir un PR (regla operativa: si budget estimado >70, dividir).

**Aprendizaje crónico observado (mayo 2026)**: dos PRs grandes consecutivos (PR13b monolítico, PR-basis-nominal monolítico) fallaron con `error_max_turns 100`. En ambos casos la causa fue el mismo patrón: **shape change + tests dispersos + docs prosa masiva en un solo issue**. La división retroactiva (a/b/c para PR13b; core + docs para basis-nominal) funcionó. La regla derivada: **sincronización de docs/design va siempre a PR separado cuando son >3 puntos**.

Cuando un PR del Creator falle por `error_max_turns` o muestre un patrón sub-óptimo no documentado, actualizar la tabla "Historial de aprendizajes empíricos" de `docs/agents/creator.md` con la fecha, el PR, el resultado y la lección. El doc se mantiene como histórico empírico, no como prescripción a priori.

## Heurísticas aprendidas (loop)

<!-- Sección entrenable (ADR-212): SOLO el process-reviewer edita aquí, con marcador `skill-edit` por línea y presupuesto de la épica. Todo lo demás de este fichero está FUERA del loop (precedencia ADR / mantenimiento propio). Vacía = sin heurísticas aceptadas aún. -->

## Literales must-copy en issues (2026-07-12, propuesta #1278)

Al redactar issues: todo literal que el Creator deba copiar FIEL (marcadores de coordinación propios del issue, cadenas de invariantes, mensajes exactos) va en **fenced code block** — sobrevive tanto al body raw como a cualquier render. PROHIBIDO encodearlo como comentario HTML inline entre backticks: el canal issue→Creator puede perderlo (caso #1271: el Creator recibió el marcador vacío, improvisó, y costó un ciclo correctivo entero). Los comentarios HTML quedan reservados a los marcadores de máquina del protocolo (protocol.md), que es su función: los consumen workflows que leen el body RAW.
