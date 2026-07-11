<!-- synced from agent-pipeline@v1 — DO NOT EDIT locally; changes arrive as sync PRs -->
<!-- Los ejemplos históricos citan el repo de origen (finplan): son lecciones con evidencia, no normas de este repo. -->

---
name: sandbox-actions
description: Mecánica del sandbox de claude-code-action y de GitHub Actions: permisos, adjuntos, qué workflow corre cuándo, ramas desde default y recuperación de base, código de rama HEAD, gap PR-no-automático, max-turns, comentarios # en if:, next lint roto, workflow de probes, Visual encadenado. Leer al operar o diagnosticar el pipeline de agentes.
---

# sandbox-actions (extraído de docs/operational-notes.md, 2026-07-05, movimiento verbatim)

## Sandbox del Action: permisos amplios via bypassPermissions

Tras ADR-024, el sandbox del Action corre con `--permission-mode
bypassPermissions`. Esto significa que el agente puede ejecutar
cualquier comando bash sin pedir aprobación interactiva. Lo que ANTES
estaba bloqueado por defecto (pnpm, curl, wget, unzip, etc.) AHORA
funciona sin fricción.

Implicaciones operativas:

- **El agente PUEDE correr `pnpm typecheck` y `pnpm test` localmente
  antes de commitear.** Esto es importante exigírselo en el prompt del
  issue para PRs del motor (donde un error de tipo o un test fallido
  delegado al CI cuesta 2-3 minutos perdidos por iteración). El
  prompt debe decir: "corre pnpm typecheck y pnpm test antes de
  commit. Si fallan, NO hagas commit, reporta y para."
- **El agente PUEDE descargar archivos externos via curl/wget** —
  con la limitación de plataforma de GitHub documentada en la sección
  siguiente.
- **Las restricciones de tarea ("no instales deps", "solo crea
  archivos en X carpeta", "no toques workflows") siguen vivas en el
  prompt del issue.** ADR-024 amplió el sandbox, no las restricciones
  lógicas.
- **ADR-020 sigue intacto:** la GitHub App del agente no tiene
  permiso `workflows`. El agente NO puede modificar
  `.github/workflows/`, ni con bypassPermissions ni sin él. Esa es
  la contención fuerte y permanente.

## Sandbox del Action y descarga de adjuntos: límite del frontend de GitHub

**Aprendido durante PR2 (issue #21, mayo 2026).** Aunque
bypassPermissions desbloquea curl/wget, las URLs de adjuntos al issue
de tipo `https://github.com/user-attachments/files/<id>/<name>` NO son
endpoints REST. Solo el navegador autenticado vía cookie de sesión
(`_gh_sess`) puede descargarlas; ni los PAT ni los tokens del GitHub
App (`ghs_...`) sirven, porque la ruta se sirve desde el frontend de
github.com, no desde la API. El agente recibe **404** sin importar el
header de Authorization que pase.

**Es una limitación de la plataforma. No se arregla editando el
workflow ni el sandbox.**

**Patrón canónico para entregar archivos al agente:**

NO adjuntar zips al issue como attachments. EN SU LUGAR:

1. **Subir los archivos directamente al repo en una rama de trabajo**
   via la web UI: en la rama destino (típicamente `feat/<scope>`),
   navegar a la carpeta destino, `Add file → Upload files`, drag&drop
   los archivos. Commit a esa rama.
2. **Comentar al agente** indicando que los archivos ya están en la
   rama y pidiéndole que continúe desde ahí (sin crear su propia
   rama nueva).

Variante: subir los archivos a `main` antes de invocar al agente. Las
ramas del agente parten de main, así que las heredarían
automáticamente. Solo aplica si el código está plenamente verificado
y aceptado en producción.

**Anti-pattern explícito:**

- Adjuntar zip al issue y esperar que el agente lo descargue. **No
  funcionará.**
- Pegar archivos `.ts` largos en el cuerpo del issue como bloques de
  código markdown. Body limit ~65k caracteres; PRs reales del motor
  lo exceden. Smart-quotes hazard si edita desde mobile.
- Pedir al agente que descargue desde gist o release-asset
  privadas. Los release-assets de releases publicados sí responden a
  Authorization Bearer; los drafts y los gists privados no
  necesariamente.

**Excepción donde la URL pública SÍ funciona:** si el archivo está en
una URL pública sin autenticación (ej.
`http://www.econ.yale.edu/~shiller/data/ie_data.xls`, datasets
públicos de FRED, releases de GitHub publicados), el agente puede
descargarlo directamente con `curl` gracias a ADR-024. La limitación
de plataforma solo aplica a `user-attachments` específicamente.
Patrón canónico de bumps del dataset Shiller usa esta vía (ver
"Procedimiento de bump del dataset Shiller").

## Gap conocido: PR no se crea automáticamente desde issue

`claude-code-action` cuando trabaja desde un comentario `@claude` en
un issue, push-ea la rama pero NO crea el PR — emite una compare URL
que el humano abre y confirma manualmente. Consecuencias:

1. El PR aparece con autor = humano, no `claude[bot]`.
2. El trigger del Reviewer `opened && user.login == 'claude[bot]'`
   no dispara.
3. Resultado neto: el humano tiene que pinchar la URL + añadir
   manualmente la label `needs-review` para arrancar el ciclo.

**Esto NO es un fallo del Action; es su comportamiento documentado**
(es la base de cuándo el humano tiene la última palabra antes de
abrir un PR). Pero introduce fricción en el flujo ADR-063, que
asumía auto-trigger sin intervención.

**Opciones para cerrar el gap (decisión humana):**

- (a) Forzar al agente a `gh pr create` desde el sandbox tras
  push. El agente ya tiene el token y permisos para abrir PRs.
  Coste: añadir una instrucción explícita en `CLAUDE.md` o en el
  prompt del action. Riesgo: PRs prematuros si el agente confunde
  scope.
- (b) Relajar el trigger del Reviewer en `reviewer.yml`: en vez de
  `user.login == 'claude[bot]'`, usar
  `startsWith(head.ref, 'claude/')`. Cubre el caso donde el humano
  hace `Create PR` desde la compare URL: la rama sigue siendo la
  del agente, sólo cambia quién aprieta el botón. Coste: una línea
  de YAML, ningún cambio de UX.

**Decisión adoptada (2026-05-14):** ambas opciones, en capas
distintas:

- **(a) ya operativa** vía la sección "PR creation: open the PR
  explicitly" en `CLAUDE.md`. El agente abre el PR él mismo con
  `gh pr create --base develop` tras push, así el PR queda con
  autor = `claude[bot]` y el trigger `opened+claude[bot]` de
  `reviewer.yml` dispara sin más cambios. No requiere editar
  workflows (ADR-020).
- **(b) sigue en checklist humano** de ADR-063 como defensa en
  profundidad: si el agente olvida ejecutar `gh pr create`, o si un
  humano abre el PR desde la compare URL por la razón que sea, el
  trigger relajado a `startsWith(head.ref, 'claude/')` recoge el
  caso. (a) es la capa preferida, (b) es la red.

Coste extra de (a): un comando `gh pr create` por issue. Beneficio:
elimina el cuello de botella humano-pincha-URL del flujo ADR-063 sin
tocar workflows.

## `--max-turns` de la action

- 30 es insuficiente para tareas con varios archivos.
- 100 es razonable cuando se autentica con OAuth Max (no hay coste por
  uso, solo cuota de bucket).
- Para tareas muy acotadas (cambio de una línea, búsqueda y reemplazo)
  añadir explícitamente "máximo X turnos" en el cuerpo del issue evita
  exploración innecesaria.

Causas típicas de gastar turnos sin avanzar:

- Intentar editar archivos en `.github/workflows/` (prohibido por la
  app — ver ADR-020). El sandbox lo deja intentar pero el push se
  rechaza.
- Buscar archivos en rutas incorrectas cuando la instrucción del issue
  no las da explícitas.
- Verificar permisos externos (acceso a modelos, billing) que la
  instrucción no pide.
- Iterar sobre un push rechazado por permisos sin reportar el error.
- Intentar descargar un adjunto del issue tipo `user-attachments/...`
  (404 sistemático — ver sección sobre límite del frontend de GitHub).

## GitHub Actions: qué workflow se ejecuta cuándo

- **Eventos `issue_comment` y `issues`:** GitHub usa el archivo de
  workflow del default branch del repo (`main`). No el de la rama del
  PR aunque el comentario sea sobre un PR.
- **Eventos `pull_request`:** GitHub usa el workflow de la rama HEAD
  del PR (la que se está mergeando), siempre que el PR sea de una rama
  interna del mismo repo.

Consecuencia práctica: cualquier cambio en un workflow que afecte al
trigger por `@claude` en issues/comments tiene que estar mergeado en
`main` antes de poder probarse.

## `claude-code-action` parte ramas desde el default branch

La action crea sus ramas siempre desde `main`, ignorando lo que diga el
issue. Si la tarea depende de cambios que solo están en `develop`:

- Replicar a `main` antes (commit directo o PR rápido), o
- Tras el PR del agente, usar el botón "Update branch" para mergear
  `develop` en la rama del PR, o
- Editar a mano los archivos faltantes en la rama del PR.

Caso típico que provocó esto: PR de migración del Reviewer a OAuth.
La rama del agente partió de `main` (con `reviewer.yml` viejo) y
modificó `reviewer.mjs` (a OAuth). El Reviewer del propio PR falló
porque el workflow seguía pasando la variable vieja.

**Implicación operativa importante:** antes de cualquier PR del agente
que dependa de código previo, promociona `develop → main` para que la
rama del agente parta de un `main` actualizado. Esto NO es ceremonial
— es la diferencia entre que el agente pueda importar de un módulo
existente o que se quede sin contexto.

### Procedimiento de recuperación que ejecuta el agente, no el humano

El humano no siempre tiene tiempo de promocionar `develop → main`
antes de mandar la tarea. Para que el agente no se quede ciego en ese
caso, **el agente debe realinear su rama a `origin/develop` como
PRIMER paso** en cualquier issue, antes de leer código o tocar
archivos. Comandos exactos:

```bash
git fetch origin
git status                                      # working tree limpio
git log --oneline origin/main..origin/develop   # ¿develop adelanta?
# Si develop adelanta (caso típico):
git reset --hard origin/develop
```

Este reset es seguro porque la action **no precommitea cambios** en la
rama nueva: la rama temporal `claude/issue-{N}-{timestamp}` arranca
idéntica al default branch, sin diffs. Si `git status` muestra cambios
inesperados, NO hagas reset destructivo — algo no esperado pasó (e.g.,
el humano subió archivos a la rama antes de invocar al agente, como en
el patrón canónico de delivery del bundle zip); reporta y espera.

**Caso histórico que motivó la regla (2026-05-13, issue #62 / PR11).**
Tres invocaciones consecutivas del agente sobre el mismo issue
arrancaron en ramas basadas en `main` (commit `0025845`, mergeado vía
PR#53 hace días); `develop` estaba ~30 commits por delante con PR10
ya integrado. Los primeros dos runs fallaron temprano sin que el
agente notara el problema; el tercer run lo identificó pero ya había
quemado dos ciclos del bucket de cuota. La regla de realineación
explícita arriba evita exactamente ese fallo.

**¿Por qué no resuelve esto la action automáticamente?** Porque la
action es upstream (`anthropics/claude-code-action`) y respeta el
default branch del repo. Cambiar `develop` a default branch en GitHub
romperia el flujo `develop → main` documentado en `docs/conventions.md`
y ADR-008 (staging vs producción). Mantener `main` como default y
realinear en el agente es el menor de dos males.

## Workflows los edita el humano

Por seguridad de la GitHub App (ADR-020), el agente no puede editar
archivos en `.github/workflows/`. Para cambios en workflows:

- Web UI de GitHub (lápiz en el archivo). Funciona desde móvil y
  desktop.
- O local con git push directo si tienes la rama checked out.

No te molestes en delegárselo al agente — gastará turnos sin avanzar.

## Workflows + scripts auxiliares ejecutan código de la rama HEAD del PR

Cuando un PR está abierto, el workflow del Reviewer (y cualquier script
que invoque, como `scripts/reviewer.mjs`) ejecuta la versión de esos
archivos **en la rama HEAD del PR**, no en `main`. Implicación: si
cambias el script en `main` mientras hay un PR abierto, ese PR sigue
ejecutándose con la versión vieja hasta que:

- Se haga "Update branch" desde la UI del PR para mergear `main` en la
  rama del PR, o
- Se cierre y reabra el PR (a veces no basta), o
- El PR original se mergee y se abra uno nuevo desde `main`
  actualizado.

Lección concreta: durante el hardening del Reviewer, una versión nueva
del script committeada a `main` no se aplicó al PR de docs abierto
hasta que se editó el script en la propia rama del PR. Si vas a probar
cambios al Reviewer (o a cualquier workflow/script invocado), edita en
la misma rama del PR de prueba — no en `main`.

### Workflow dedicado para `probe-spike-variance` full run (2026-05-14)

Tras 3 intentos fallidos vía `claude-code-action` para ejecutar `scripts/probe-spike-variance.ts` en full run, se añade `.github/workflows/probe-spike-variance.yml` como workflow dedicado disparable via `workflow_dispatch`.

**Diagnóstico del fracaso del agent path (registrado para no repetir el patrón):**

- **Intento 1** (default heap ~2GB): aborto con `JavaScript heap out of memory`. RSS pico 2.12GB durante la primera llamada a `lifecycle()` con `N=300k`, `horizon=30y`, `emitPathsTerminalWealth=true`. Limitación estructural del motor a N grande sin chunking.
- **Intento 2** (heap a 6GB via `NODE_OPTIONS=--max-old-space-size=6144`): aborto con OOM aún. RSS pico 6.17GB; el SO entró en swap thrash (`mu ≈ 0.006-0.015` — 98%+ del wall-clock en GC, 111k major page faults). Working set estructural del motor a N=300k excede 6GB en una sola llamada. Subir a 7GB chocaría con la RAM física del runner (~7.8 GiB).
- **Intento 3** (post-chunking del script, 6 batches × N=50k): job de 2h 31m con el agent activo solo ~7 min reales. Token GitHub de la App expiró durante la espera del script (~1h techo de los tokens de App). Sin output del script visible al usuario durante la espera. Sin PR ni commit al final.

El chunking del script (un PR previo) resolvió los OOMs operativamente — cada batch de N=50k cabe en heap default. Pero el wall-clock real en el runner standard (2 vCPUs) es ~2-3h, lo que **excede la vida del token de la App de `claude-code-action`**. Conclusión: el agent path NO es viable para scripts CPU-bound de >1h. Necesitamos un canal distinto.

**Solución: workflow dedicado vía `workflow_dispatch`.**

- Trigger manual desde GitHub UI (Actions → "Probe Spike Variance Full Run" → "Run workflow").
- `GITHUB_TOKEN` del workflow dura todo el job (no expira a 1h como el de la App).
- Sin overhead de agent (sin context loading, sin Anthropic API calls, sin coste de plan Max).
- Output stream-friendly: visible en tiempo real en el log del run.
- Al terminar: branch nueva `chore/golden-cache-spike-variance-run-<run_id>` con el JSON cacheado commiteado por `github-actions[bot]` + URL del Create PR en el log final + log capturado como artifact retention 30 días.
- Timeout configurado a 360 min (6h). Wall-clock típico esperado 2-3h.

**Procedimiento operativo:**

1. Disparar el run: GitHub → Actions → "Probe Spike Variance Full Run" → "Run workflow" (rama por defecto: `develop`).
2. Esperar 2-3h. Log visible en tiempo real en la pestaña del run.
3. Al terminar exitosamente, el log final muestra:
   ```
   Branch pushed: chore/golden-cache-spike-variance-run-<id>
   Open PR manually: https://github.com/.../compare/develop...chore/golden-cache-spike-variance-run-<id>?quick_pull=1
   ```
4. Abrir PR desde esa URL. Reviewer Opus 4.7 auto-dispara según labels del repo.
5. Evaluar las 3 señales del log del workflow (mismas documentadas en la entrada original del script): `mean(mse_spike) < mean(mse_direct) × 0.7`, `spike_better_count ≥ 15`, ausencia de sesgo direccional. Veredicto manual del humano sobre el output.
6. Mergear el PR del golden cacheado si las señales son útiles para PR12b (o cualquier consumer downstream).

**Cuándo usar este workflow:**

- Antes de redactar PR12b: decidir K=2 default direct vs spike sobre output del baseline.
- Cuando emerja sospecha de regresión del estimator (e.g., cambios en `crra.ts` o calibración Shiller).
- Cuando se actualice la calibración Shiller y se quiera revalidar.

**Cuándo NO usar este workflow:**

- Validación de regresión rápida → usar `--dry-run` del script en local (segundos).
- Cambios al script en sí (lógica del experimento) → PR normal contra `develop` con dry-run en CI.

**Limitación honest:** este workflow ejecuta UN perfil hardcoded en `scripts/probe-spike-variance.ts` (`specFor` líneas ~110-150). Para validar perfiles distintos, el script tendría que parametrizarse vía CLI flags + carpeta de perfiles (`scripts/validation-harness/`). Esa generalización queda como follow-up V0.2 si emerge demanda real de validar otros perfiles más allá del baseline.

**Lección operativa generalizable (no solo este script):** scripts CPU-bound >1h NO son operables vía `claude-code-action` por el techo del token de App. Cualquier futura validación numérica de larga duración (e.g., calibración Shiller con N grande, regression tests del optimizer K=2 con full grid 5×5×5×5) debe usar `workflow_dispatch` dedicado, no agent invocation. Patrón replicable: 1 workflow dedicado por script de validación, con `permissions.contents: write`, branch + commit + URL del Create PR en el log final, log como artifact 30 días.

## Visual: invocación encadenada desde el Reviewer + cap por SHA único

Visual se introdujo en ADR-085 como agente de inspección visual de la preview de Vercel. Tres puntos operativos a recordar:

1. **El Reviewer es quien decide cuándo invocar a Visual** en PRs de UI. El prompt del Reviewer (`docs/agents/reviewer.md` § "Invocación de Visual al final del PR") tiene las tres condiciones que se evalúan: veredicto `LGTM`/`NITS`, PR toca archivos UI, no hay informe de Visual previo sobre el SHA actual.

2. **Paso de contexto Reviewer → Visual vía bloque delimitado en el comment.** El Reviewer pega los casos dirigidos entre los marcadores HTML `<!-- visual-cases-start -->` y `<!-- visual-cases-end -->` en su comment. El workflow de Visual hace `awk` sobre el comment disparador para extraer ese bloque y lo deposita en `/tmp/visual-cases.txt` antes de invocar a Claude. Si el bloque no existe (camino manual), Visual ejecuta solo la suite fija + exploración libre.

3. **Cap por SHA único.** Antes de ejecutar, el workflow de Visual hace una query a la API de GitHub buscando comments previos del propio Visual que contengan en su body tanto `"🔍 Visual — informe"` como `"SHA:** <sha-corto>"`. Si encuentra al menos uno, aborta con un comment breve. Esto evita re-ejecuciones manuales por error y trabajo redundante. La inspección se libera automáticamente cuando hay un commit nuevo (cambia el SHA).

**Autenticación.** Visual usa `CLAUDE_CODE_OAUTH_TOKEN` (mismo secret que Creator y Reviewer, plan Max). Blindaje explícito contra `ANTHROPIC_API_KEY` con `env: ANTHROPIC_API_KEY: ""` en el step de Claude (mismo patrón que `claude-code.yml`).

## Bug operativo: comentarios `#` dentro de `if: |` rompen el workflow silenciosamente

Síntoma observado en PR #211 (2026-05-24): tras pegar el fix del sentinel ZWJ (ADR-086) en `claude-code.yml`, el Creator dejó de arrancar para ningún evento (issues abiertos, comments del Reviewer, comments del humano con `@claude`). El workflow no aparecía en la pestaña Actions tras el evento; el `if:` evaluaba a falso siempre.

**Causa.** GitHub Actions parsea el contenido de un bloque `if: |` como una **expression**, no como YAML con comentarios. Los `#` dentro del bloque NO son comentarios; son caracteres literales que envenenan la expresión y la hacen evaluar a falso silenciosamente. El workflow no logguea un error ni aparece en la UI con estado "Failed" — simplemente nunca dispara.

**Fix.** Los comentarios `#` deben ir FUERA del bloque `if: |`, encima del `if:`:

```yaml
# CORRECTO
jobs:
  myjob:
    # Comentario explicativo del filtro.
    # Más detalle del filtro.
    if: |
      (github.event_name == 'X' && contains(body, 'Y')) ||
      (github.event_name == 'Z' && ...)

# INCORRECTO — los `#` rompen la expression
jobs:
  myjob:
    if: |
      # Comentario explicativo del filtro.  <-- INVALIDA TODO el if:
      (github.event_name == 'X' && contains(body, 'Y'))
```

**Lección.** Cuando edites un `if: |` en cualquier workflow del repo:

- Comentarios siempre arriba del `if:`, nunca dentro.
- Verifica disparando el evento esperado (issue nuevo, comment, etc.) y mira la pestaña Actions. Si no aparece run nuevo, el `if:` está roto.
- Aplica también a cualquier otro bloque `|` que se evalúe como expression (no solo `if:`).

## `next lint` roto: ESLint 9 vs `eslint-config-next@14` (2026-06-12)

**Entorno.** `pnpm -F app lint` (que ejecuta `next lint`) fallaba de forma
global y previa a cualquier cambio reciente. `pnpm test` y `pnpm typecheck`
seguían verdes; sólo el lint estaba degradado. Detectado por el Creator
durante #487, registrado y arreglado en #491.

**Causa.** La raíz declaraba `eslint: ^9.12.0` (resuelto a **9.39.4**).
`eslint-config-next@14.2.35` declara peer `eslint: "^7.23.0 || ^8.0.0"` —
**ESLint 9 NO es un peer soportado por Next 14**. Además `next lint` (Next
14) construye el objeto `ESLint` pasándole opciones legacy
(`useEslintrc`, `extensions`, `resolvePluginsRelativeTo`, `rulePaths`,
`ignorePath`, `reportUnusedDisableDirectives`) que **ESLint 9 eliminó**.
Resultado: `next lint` aborta con `Invalid Options: Unknown options ...`
ANTES de lintar una sola línea. El mismo break afecta al lint del engine
(`eslint "src/**/*.ts"`), que bajo ESLint 9 busca flat-config y no la
encuentra.

**Por qué NO flat-config / NO Next 15.** Migrar a flat config
(`eslint.config.js` + `FlatCompat`) no arregla `next lint`: el fallo está
en las opciones del *constructor* `ESLint`, no en el formato de config —
`next lint` seguiría pasándolas. La vía limpia para ESLint 9 es Next 15
(`eslint-config-next@15`, que soporta flat config y el peer eslint 9),
pero subir Next de major está **prohibido** por el alcance de #491.

**Fix (mínima intervención).** Pin `eslint` a `^8.57.1` (última 8.x,
soportada por el peer de Next 14) en `package.json` raíz, y añadir
`eslint: ^8.57.1` como devDependency directa de `@finplan/app`. Esto
último es necesario porque, sin un eslint local al paquete app, pnpm
resolvía el peer de `eslint-config-next` contra el `eslint@9.39.4` hoisteado
(el lockfile fijaba `eslint-config-next@14.2.35(eslint@9.39.4)` aunque
`require.resolve` cayera en 8.57.1) — frágil y dependiente del hoisting.
Con el eslint local el lockfile fija `eslint-config-next@...(eslint@8.57.1)`,
determinista. `.eslintrc.cjs` (app y engine) queda **intacto**: no cambia
el set de reglas, sólo se restaura su enforcement.

**Salvaguarda disparada (#491 punto 3).** Al volver a correr, `next lint`
revela **73 errores + 4 warnings preexistentes** en código de la app
(70 `eqeqeq`, 3 `react/display-name`; warnings: 3 `react-hooks/exhaustive-deps`,
1 `@next/next/no-page-custom-font`), que NUNCA se enforzaron mientras el
lint estuvo roto. No son reglas nuevas: son las ya declaradas en
`.eslintrc.cjs`. Por la salvaguarda del issue ("si aparecen >0 errores en
código existente, PARA y enumera antes de tocar código de la app"), #491
NO toca código de la app: la limpieza (la mayoría de `eqeqeq` es
auto-fixable con `next lint --fix`) es decisión humana posterior. El lint
del engine, además, escupe ~29 `Parsing error` en `*.test.ts` porque el
`tsconfig.json` del engine los excluye del `project` del parser — bug de
config preexistente e independiente, fuera de alcance de #491 (criterio
"cero diffs en motor").

**Cómo detectar/recordar.** Si `next lint` falla con `Invalid Options:
Unknown options useEslintrc, extensions, ...`, es ESLint 9 contra Next ≤14.
El upgrade real es Next 15; mientras tanto, ESLint queda anclado a 8.x.
ESLint 8.57.1 está EOL/deprecated, pero es la única línea compatible con
el peer de Next 14 — no es un olvido, es la restricción del ecosistema.

## Heurísticas aprendidas (loop)

<!-- Sección entrenable (ADR-212): SOLO el process-reviewer edita aquí, con marcador `skill-edit` por línea y presupuesto de la épica. Todo lo demás de este fichero está FUERA del loop (precedencia ADR / mantenimiento propio). Vacía = sin heurísticas aceptadas aún. -->
