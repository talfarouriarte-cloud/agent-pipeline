<!-- synced from agent-pipeline@v1 — DO NOT EDIT locally; changes arrive as sync PRs -->
<!-- Los ejemplos calibrados citan el repo de origen (finplan = asesoramiento-financiero): son anclas con evidencia, no normas de este repo. -->

---
name: talla-issue
description: Rúbrica común de talla de un issue (S/M/L/XL = 1/2/4/8 puntos) con criterios anclados y 7 ejemplos calibrados de finplan. Leer SIEMPRE antes de publicar una talla pre o post (Auditor, AP-099) o de dimensionar un issue contra ella.
---

# talla-issue — rúbrica común de talla (AP-099, central#281)

La talla es el **denominador** de la función objetivo del propietario:
**puntos entregados por token ponderado** (tokens × precio relativo de
`templates/model-costs.json` del central). Sin una rúbrica común y anclada,
dos sesiones dan tallas distintas al mismo issue y la serie mide ruido.

| Talla | Puntos |
|---|---|
| S | 1 |
| M | 2 |
| L | 4 |
| XL | 8 |

**Las líneas de código NO son criterio.** Ni `+/-`, ni nº de ficheros
como tal: son gameables y el ruling las deja solo como serie de CONTROL del
ledger. Si te descubres justificando una talla con «son muchas líneas»,
vuelve a los cinco criterios.

## Los cinco criterios (0 / 1 / 2 cada uno)

Puntúa cada criterio, suma (0–10) y convierte con la tabla de abajo.

| # | Criterio | 0 | 1 | 2 |
|---|---|---|---|---|
| C1 | **Criterios de DoD** verificables (cada ítem de DoD, aserción o test nombrado cuenta uno; los bloques estándar —typecheck, «tests tocados en verde», disciplina de commits— NO cuentan) | ≤ 3 | 4–6 | ≥ 7 |
| C2 | **Módulos / paquetes tocados** (módulo = directorio de primer nivel dentro de un paquete: `components/report`, `lib/plan`, `messages`; paquete = workspace: `packages/app`, `packages/engine`) | 1 módulo | 2–3 módulos del MISMO paquete | ≥ 4 módulos, o ≥ 2 paquetes |
| C3 | **Motor vs UI** | docs, config, estilo, lint | UI o lógica de app SIN semántica numérica nueva | motor (`packages/engine`) o semántica numérica (fórmula, precisión, distribución, tasa) aunque viva en la app |
| C4 | **Contrato** (firma exportada consumida fuera del módulo, formato persistido, clave/token de versión, emisión del motor, prototipo-contrato) | ninguno | cambio de contrato existente | contrato NUEVO |
| C5 | **Tests exigidos por rama** (los que la DoD pide crear o rectificar; «por rama» = uno por cada rama que el cambio abre: legacy/v2, `null`/valor, con/sin flag) | ninguno nuevo (solo existentes en verde) | 1–3 nuevos o rectificados, sin ramas | ≥ 4, o tests por rama |

| Suma | Talla |
|---|---|
| 0–2 | S |
| 3–5 | M |
| 6–8 | L |
| 9–10 | XL |

**En el central (`agent-pipeline`)** los ejes se leen así: C2 cuenta como
«paquetes» los tres hogares con blast radius distinto — `.github/**`,
`vendored/**` y `scripts/**`+`templates/**` (`docs/**` es un módulo más);
C3 vale 2 para todo cambio de `.github/workflows/**` o `vendored/**`
(despliega a los dos consumidores sin gradualidad), 1 para `scripts/**` y
0 para `docs/**`; C4 vale 1/2 para la superficie `workflow_call`
(manifiesto `workflow-contracts.json`) y para los marcadores de protocolo
que otro actor consume.

**Desempate:** si una suma cae en la frontera y dudas, NO redondees al alza
por prudencia: puntúa los cinco criterios literalmente y escribe la razón.
Una talla que no se puede justificar criterio a criterio no se publica.

## Ejemplos calibrados (finplan, cerrados y mergeados)

Puntuación sobre el issue TAL COMO SE ESCRIBIÓ (talla pre). Formato:
C1·C2·C3·C4·C5 = suma → talla.

| Issue | Qué era | C1·C2·C3·C4·C5 | Talla | Razón |
|---|---|---|---|---|
| finplan#2090 | `let lo` → `const lo` (rompía `next build`) | 0·0·1·0·0 = 1 | **S** | Un criterio de DoD (lint sin errores), un fichero de UI, sin contrato ni test nuevo. Ancla del suelo. |
| finplan#1847 | El pilar Herramientas enlaza siempre al índice; muere `resolveToolsPath` | 1·1·1·0·1 = 4 | **M** | 4 ítems de DoD; `components` + `lib/nav` (2 módulos, un paquete); UI; la función que muere es interna (sin consumidor fuera del módulo ⇒ C4 = 0); un test nuevo del enlace. |
| finplan#2118 | Selector truncado + gasto de vida en €/mes con conversión en el borde | 1·1·1·0·2 = 5 | **M** | 6 ítems de DoD; `styles` + `mortgage-compare` + `messages`; UI; el dato persistido NO cambia (el issue lo fija: sin migración ⇒ C4 = 0); 4 aserciones nuevas (render, conversión, hidratado, paridad). Frontera alta de M: un contrato tocado la habría subido a L. |
| finplan#1959 | Sección «Imprevistos» en Datos + infodot del fan | 1·2·1·0·2 = 6 | **L** | U1–U6 (6 aserciones); `plan-datos`, `PlanIndex`, `plan/vision`, `messages` (≥ 4 módulos); UI pura sobre el esquema de #1960 (sin contrato propio); 6 tests nuevos. |
| finplan#2206 | Spec base del explorador + post por retire-now + token `ax3` (E1 4/4) | 2·2·1·1·2 = 8 | **L** | ≥ 7 criterios; `lib/optimize`, página, skills, `docs/design`; lógica de app sin fórmula nueva; bump del token de caché persistido (`ax2`→`ax3`: cambio de contrato); tests por rama (sin frontera ⇒ error visible, `ax2` no se rehidrata). Frontera alta de L. |
| finplan#2101 | ADR-248·R·1: σ efectivo = ρ·σ, isolíneas rotuladas, par de legado sin ∞ | 2·2·2·1·2 = 9 | **XL** | ≥ 7 criterios; `lib`, `components`, `messages`, informe; **fórmula nueva** de una magnitud mostrada (C3 = 2 aunque viva en la app); cambia la semántica de `sigmaEff`, exportada; tests por rama (ρ ≤ 0 ⇒ 0) y de propiedad. |
| finplan#2011 | ADR-244 E11: momentos de `d` sobre el perímetro consumible P | 1·2·2·2·2 = 9 | **XL** | 5 criterios de DoD; `packages/engine` + `packages/app` (2 paquetes); motor; **emisión nueva** (`paths_household_consumable_return_by_year`: contrato nuevo); tests por rama (`v2` vs `'legacy'`, con/sin `never`). |

Lo que enseñan las anclas: **el tamaño del diff no decide** (el PR de
finplan#2090 es de 1 línea y el de finplan#1847 de ~100, y la diferencia de
talla viene de la DoD, los módulos y el test, no de las líneas;
finplan#2101 es XL por la fórmula, no por sus 15 ficheros).

## Talla pre y talla post (el Auditor, `epic-auditor.md`)

- **Talla pre**: con el issue tal como se escribió, ANTES de abrir su PR o
  su diff. Mide lo PROMETIDO. No leas ninguna talla que otro actor haya
  declarado: la independencia respecto del Architect consiste en que el
  Auditor no copia su dimensionamiento.
- **Talla post**: la misma rúbrica sobre lo realmente MERGEADO — C1 cuenta
  solo los criterios de DoD que verificaste entregados; C2 los módulos que
  el diff tocó de verdad; C3–C5 lo que hace el código mergeado, no lo que el
  issue anunciaba.
- **Post < pre** = alcance recortado (entrega parcial, criterios no
  verificados). **Post > pre** = el issue infradeclaraba (señal de la
  calidad del dimensionamiento, central#228/#237).
- Formato de publicación (marcadores, canal, orden): lo fija
  `epic-auditor.md` § «Ledger de valor por proceso». Esta skill solo fija
  la rúbrica.
