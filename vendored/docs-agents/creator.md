<!-- Las referencias ADR-NNN, #issue y fechas de incidentes de este doc son del repo de ORIGEN del framework (provenance histórica), NO del repo consumidor. No las resuelvas contra el decisions.md local. -->
<!-- synced from agent-pipeline@v1 — DO NOT EDIT locally; changes arrive as sync PRs -->

# Creator — Autoría de issues y patrón de invocación

> Guía operativa para redactar issues que el Creator agent ejecuta como PRs. Equivalente al `reviewer.md` (criterio del Reviewer) y `architect.md` (rol del Architect), pero del lado del **input** que llega al Creator, no del lado del agente.

## Rol del Creator

`anthropics/claude-code-action@v1` corriendo en `.github/workflows/claude-code.yml`. Modelo: `claude-opus-4-8`. Cap: `--max-turns 100`. Permission mode: `bypassPermissions`. Auth: OAuth Max **únicamente** (la API key está blindada con `env: ANTHROPIC_API_KEY: ""` en el step; el Creator falla si OAuth Max está caído en lugar de facturar silenciosamente).

Diferencia clave con el Reviewer: ambos son **black box** post 2026-05-19 (usan `claude-code-action@v1`, no podemos instrumentar tools individuales). Hasta 2026-05-19 el Reviewer fue script propio (`scripts/reviewer.mjs`) con footer transparente; se migró a action por incompatibilidad OAuth + Messages API (ver skill `quota-tokens`). Toda inferencia sobre coste/comportamiento ahora viene del log de la action (con `show_full_output: false` por seguridad — los turns individuales no están en stdout) y del comentario que cada agente actualiza.

## Patrón canónico de invocación

### Issue body con `@claude`

El trigger del workflow es la frase literal `@claude` en el body del issue (o en un comment, según configuración del workflow). **SIEMPRE** incluirla en la línea inicial del issue body. Sin ella, el Creator no se activa.

Patrón recomendado:

```markdown
> @claude — [descripción corta en 1-2 frases del PR a ejecutar].
> El archivo `XXX.zip` está en la raíz de la rama de este PR si aplica.
```

### Material grande: zip-en-rama, no body

Para texto literal o código grande que el Creator tiene que aplicar/copiar (e.g., un ADR de 100+ líneas, una librería externa, un patch grande):

1. **NO pegarlo en el issue body**. Cada turn del Creator re-incluye el prompt completo en su contexto → 100 líneas de texto literal × 100 turns = overhead grande de tokens, y el Creator probablemente lo procesa con `Edit` línea a línea (caro).
2. **SÍ pegar como zip en la raíz de la rama** del PR. El Creator hace `cat archivo >> destino` o `mv archivo destino` en 1-3 turns vs ~10-30 turns de copy-paste literal.

#### Variante recomendada: zip-en-base (cero directivas no-estándar)

Procedimiento canónico actual del proyecto (2026-05-18 en adelante, refinado tras caso histórico documentado abajo):

1. **El humano commitea el zip a la rama base directamente** antes de invocar:
   ```bash
   git checkout <rama-base>
   cp ~/adr-XXX-block.zip ./
   git add adr-XXX-block.zip
   git commit -m "chore(transient): adr-XXX-block.zip — REVERT if Creator fails"
   git push origin <rama-base>
   ```
   Requiere permiso de push directo a la rama base (admin override de branch protection si aplica).

2. **Humano invoca `@claude` en el issue**. El Creator usa flujo default:
   - Crea rama propia `claude/issue-{N}-{timestamp}` desde la rama base.
   - Ve el zip en la raíz (commit transitorio del humano lo incluye en la rama base).
   - Aplica el contenido.
   - **Borra el zip como parte de uno de los commits del PR** (`git rm adr-XXX-block.zip`).
   - Push + apertura automática del PR contra la rama base.

3. **Cuando el PR se mergea**, la rama base queda sin zip + con los cambios aplicados. Git history mantiene el commit del humano (zip añadido) + commit del Creator (zip borrado + cambios).

**Verificación previa OBLIGATORIA en el issue**:

```bash
ls <NOMBRE-ZIP>.zip
# Si "No such file", ABORTAR con comentario explicando.
# NO improvisar el contenido — causaría divergencia con el texto canónico que el humano preparó.
```

**Ventajas vs variante "zip-en-rama del humano"**:

- CERO directivas no-estándar en el issue (no "trabaja en esta rama", no "abre PR con gh pr create").
- Flujo Creator default → PR automático sin intervención del humano.
- Simétrico con cualquier otro PR del Creator. Misma plantilla de issue.
- Sin "rama zombi" del humano tras el merge.

**Riesgos (mitigables)**:

- Si el Creator falla (max_turns, auth), el zip queda residual en la rama base. Humano hace `git revert HEAD` o `git rm` + commit limpio. ~30 seg.
- Develop deja de ser "estado canónico del motor" durante el período entre commit del humano y merge del PR (segundos a minutos). Cosmético en flujo serial.
- Requiere permiso de push directo a la rama base.

#### Variante alternativa: zip-en-rama del humano (cuando no hay push directo a la rama base)

Si por branch protection u otra razón el humano NO puede pushear directo a la rama base, usar el patrón antiguo documentado en la skill `delivery-bundles` §"Instrucción explícita 'no crear rama nueva'" + §"Trade-off 'no crear rama nueva' + 'PR automático'". Requiere DOS directivas obligatorias en el issue body:

1. *"Trabaja en la rama `<NOMBRE-RAMA>` directamente. NO crees una rama nueva."*
2. *"Tras el push, abre PR contra la rama base con `gh pr create --base <rama-base> --head <NOMBRE-RAMA> --title '...' --body-file '...'`. NO mergees."*

Si falta cualquiera, el flujo falla (caso histórico abajo).

#### Modos de fallo y casos históricos

- **Variante base, zip no presente**: el Creator detecta con verificación previa y aborta. Sin coste perdido.

- **Variante rama del humano, falta directiva 1** ("trabaja en esta rama"): el Creator crea su rama desde la rama base, NO ve el zip, **improvisa transcribiendo desde el spec del issue**, gasta turns. Caso histórico: 2026-05-18 PR-basis-nominal-core primer intento (issue #131): el zip estaba en `Issue-basis-nominal-core` pero el Creator arrancó en `claude/issue-131-...` y no encontró el zip. Improvisó el ADR-039-bis manualmente desde el spec, completó 3/14 items, se quedó sin turns. Coste: ~$6 reportado + run perdido. **El humano refinó el protocolo a "zip-en-base" para eliminar esta clase de fallo entera.**

- **Variante rama del humano, falta directiva 2** ("tras el push, abre PR"): el Creator commitea y pushea, deja link "Create PR ➔". Humano abre PR a mano o reinvoca. Caso histórico: PR3-bis (mayo 2026) tercer turno. Coste: round-trip humano evitable.

### Workflows files: régimen por repo

- **Consumidores (finplan, wmcb):** el Creator NO modifica `.github/workflows/*` (ADR-020 + freeze de workflows de consumidor). Si el PR requiere tocar un workflow, lo hace el humano a mano; el issue debe indicarlo explícitamente.
- **Central (`agent-pipeline`, AP-012 enmiendas 2026-07-15/16):** el Creator SÍ trabaja workflows, con una mecánica en dos tiempos que DEBE conocer para no mal-clasificar su cierre:
  1. **Commitea en local TODO el trabajo** (workflows incluidos) — persistencia incremental normal.
  2. **Su `git push` en sesión SERÁ RECHAZADO** si el diff toca `.github/workflows/**`: la action pisa las credenciales del checkout (`configureGitAuth` borra el extraheader y re-autentica `origin` con su token de App, sin permiso `workflows`). Esto NO es un blocker: el post-step «Push residual con token de workflows (post-sesión)» publica la rama con el PAT del secret y abre el PR si falta.
  3. **Cierre correcto:** informa «commits locales listos; la rama y el PR los publica el post-step de rescate». **JAMÁS** emitas `[NEEDS-HUMAN]`, pidas al humano aplicar un parche, ni vuelques el diff como comentario por «falta de permiso de push a workflows» — es el flujo NORMAL del central, no una escalada (falso positivo observado: central#56, run 29480172647, que pidió parche manual mientras el rescate abría el PR #66 dos minutos después).

## Estructura recomendada del issue body

Plantilla en orden:

1. **Línea trigger** (`@claude` + descripción de 1-2 frases).
2. **Estado de partida** (verificable con `grep` o equivalente) con criterio de aborto si no se cumple.
3. **Procedimiento** (si hay zip o pasos manuales no obvios).
4. **Scope del PR** (secciones A, B, C... cada una con cambios concretos y referencias a líneas aproximadas).
5. **Tests requeridos** (con número de tests, no descripción vaga) + **Protocolo de tests**: solo ficheros afectados (con el comando por-fichero definido en tu ANEXO de rol), NUNCA la suite completa.
6. **Bump de versión + CHANGELOG** explícitos.
7. **Criterios de aceptación** (lista numerada con `✅`), cerrando con **un paso de verificación end-to-end** que demuestre que el conjunto funciona (comando concreto + resultado esperado), y la regla de **evidencia**: el comentario de cierre pega la salida literal de typecheck + tests afectados (CLAUDE.md § "Evidencia, no afirmación").
8. **Out of scope** (qué NO toca este PR).
9. **Labels sugeridos**.

Lo que **NO incluir**:

- Texto literal grande (>50 líneas) → va en zip.
- Justificación exhaustiva del cambio → va en el ADR (referenciar el ADR, no repetirlo).
- Pseudo-código de cada línea → suficiente con interface/firma + descripción.

## Decisiones de diseño a mitad de issue (resolver-protocol)

Si topas con una decisión de diseño no cerrada, ANTES de declarar escalada aplica `docs/agents/resolver-protocol.md`: si es derivable (cita verbatim de ADR/spec que la implica), resuélvela publicando el bloque `<!-- derived-decision -->` y continúa; si no lo es —contrato del motor, semántica, ADR nuevo, conflicto entre ADRs— escala como hasta ahora. Cap 2 por issue.

### Materializar la escalada: tabla de decisión (blocked vs escalated vs NEEDS-HUMAN)

Cuando NO puedes resolver por resolver-protocol y tienes que ESCALAR, el marcador de cierre que emites depende de DÓNDE estás y de QUIÉN debe resolver. Emitir el equivocado degrada la escalada a anomalía o la manda al dueño incorrecto. **La escalada NO vive en prosa: sin el marcador correcto ningún estado de despacho se materializa** (causa raíz de finplan#1391, AP-017: escalada correcta en prosa ⇒ `turno-de-nadie` ⇒ rescatada por fallback 22 min tarde).

| Situación | Marcador de cierre | Qué materializa el post-step | Dónde lo emites |
|---|---|---|---|
| Paras **SIN PR abierto**, decisión derivable-por-Architect (serie/emisión ausente del estado derivado, hueco de dimensionado, ambigüedad de ADR que un `autonomous-decision` cierra) | `<!-- creator-blocked -->` (HTML) | `stalled` (PAT ⇒ architect-resolve por evento) + retira `serial-activo` + pop de cola | Comentario de cierre en el **ISSUE** |
| Paras **CON PR abierto**, decisión derivable-por-Architect desde dentro del loop (gate numérico de ADR tipo A3′, ambigüedad de diseño) | `<!-- creator-escalated -->` (HTML) | `stalled` (PAT ⇒ architect-resolve por evento) + `estado:esperando-architect` (el dispatcher de turno cede) | Comentario de cierre en el **PR** |
| Decisión genuinamente **HUMANA** (contrato público exportado, semántica numérica/precisión, ruta security-sensitive, ambigüedad del Reviewer) | `[NEEDS-HUMAN]: <razón>` (texto, ABRIENDO su línea) | `human-needed`, para el loop hasta humano | Comentario de cierre |
| Concluyes tras re-verificación que **el alcance YA está completo en la rama base** y NO queda PR que abrir (p.ej. el fix llegó por otro PR; el trabajo ya está mergeado) — **estado terminal, NO escalada** | `<!-- creator-alcance-completo -->` (HTML) | retira `serial-activo` si la tenías + pop de cola + `estado:cierre-pendiente-humano`; **NO** `human-needed` ni `stalled` (el cierre lo hace el humano) | Comentario de cierre en el **ISSUE** |
| Respuesta conversacional normal (converger con el Reviewer, contestar una pregunta) | ninguno (o `@reviewer` según CLAUDE.md § Loop protocol) | — | — |

Reglas duras: `creator-escalated` es el complemento EXACTO de `creator-blocked` — **JAMÁS emitas `creator-escalated` sin PR abierto** (usa `creator-blocked`) ni **`creator-blocked` con PR abierto** (usa `creator-escalated`); **JAMÁS uses ninguno de los dos para una decisión humana** (eso es `[NEEDS-HUMAN]`, intacto). Ambos marcadores son **HTML anclado** — el post-step los detecta como comentario, nunca como substring de prosa (clase PR #1133): escríbelos en su propia línea. La decisión concreta que escalas va en la PROSA del mismo comentario (qué gate, qué ADR, qué ambigüedad) para que architect-resolve rule sin re-derivarla.

`<!-- creator-alcance-completo -->` NO es una escalada: es el veredicto terminal «no queda nada que codear ni que abrir». Distínguelo de `creator-blocked` (no puedes avanzar por un hueco → alguien debe resolver) y de `creator-muerto-sin-pr` (dejaste commits ahead sin abrir PR → hay que abrirlo): emítelo SOLO si verificaste que el alcance está íntegro en la rama base y NO tienes commits ahead pendientes de PR. Falso positivo típico: el fix del issue entró por otro PR (polaridad `partial` mal marcada) y una re-verificación posterior confirma que no queda trabajo — SIN este marcador, el post-step lo clasificaría como escalada no-declarada y aplicaría `human-needed` (central#46, AP-020). El cierre del issue lo hace el humano (central: cierre/merge no se delega, AP-019); tú solo materializas el veredicto.

## Subagentes (contexto separado — úsalo para no quemar el tuyo)

Tienes dos subagentes en `.claude/agents/`. Cuándo invocarlos:

- **`investigador`** — al arrancar el issue, si necesitas mapear un área o verificar anclas antes de editar. La exploración NO debe consumir tu contexto de implementación: delega, recibe hallazgos anclados, implementa. Si reporta DISCREPANCIAS con las anclas del issue, corrige el plan antes de tocar código; si reporta DEPENDENCIAS DETECTADAS que bloquean el alcance, aplica el protocolo de PR híbrido en vez de improvisar.
- **`pre-reviewer`** — UNA sola pasada, tras tu último commit y antes de `gh pr create`. Aplica solo hallazgos de corrección/alcance; su informe no es el Reviewer: no re-invoques tras aplicar (el loop real es con Opus). `SIN HALLAZGOS` ⇒ abre el PR.

## Budget de turns: heurísticas

Cap operativo: 100 turns. Si la suma estimada supera 70, dividir el PR.

| Tipo de trabajo | Coste aproximado | Notas |
|---|---|---|
| Cambio de shape en un type (1 archivo) | ~3-5 turns | Read del archivo + Edit |
| Cambio de firma de N funciones | ~5N turns | Read + Edit por callsite |
| Cambio de fórmula concentrado | ~5-10 turns | Si la fórmula vive en pocas funciones |
| Validación nueva | ~3-5 turns | Edit del validador + tests |
| Tests nuevos por bloque de 5-7 | ~10-15 turns | Bloque coherente con setup compartido |
| Tests existentes a editar individualmente | ~1 turn cada | Si hay N tests, son N turns |
| Tests existentes con mismo rename (batch sed) | ~3 turns total | Grep + sed + verificación |
| Sincronización docs prosa por punto | ~2-3 turns cada | Localizar + Edit + verificar |
| Copy-paste literal de >50 líneas en body | ~5-10 turns | Mejor zip-en-rama |
| Aplicar zip-en-rama (cat/mv) | ~3 turns | Cualquier tamaño |
| Regenerar fixture pinned | ~5-10 turns | Ejecutar script + verificar + comparar |
| suite completa con ajustes iterativos | ~10-30 turns | Variable según fallos |
| Bump + CHANGELOG | ~3 turns | Edits localizados |
| Update del comment de progreso | 1 turn cada vez | Limitarlos a fin de sección |
| Lectura exploratoria del repo (Read en archivos nuevos para el Creator) | ~5-15 turns | Antes de cambios invasivos |

**Suma ejemplo (PR razonable, debería caber en 100)**:
- Shape change + firmas: 15
- Fórmula nueva: 10
- Tests nuevos: 12
- Tests existentes via sed: 3
- Fixture regen: 10
- Bump + CHANGELOG: 3
- Verificación final + ajustes: 20
- **Total: 73**. Margen aceptable.

**Suma ejemplo (PR que NO cabe, dividir)**:
- Shape change + firmas: 15
- Fórmula nueva: 10
- Tests nuevos: 12
- Tests existentes via sed: 3
- Fixture regen: 10
- **Sincronización docs/design (10 puntos): 25**
- Bump + CHANGELOG: 3
- Verificación final: 20
- **Total: 98**. Sin margen. Dividir docs en PR separado.

## Patterns que matan el budget

Por orden de severidad observada:

1. **Sincronización masiva de docs prosa** (>3 puntos a sincronizar). Lineal en turns sin compresión. **Regla**: cuando hay >3 puntos, sincronización va a PR separado.

2. **Rename de campo público con N callsites/tests dispersos**. Cada uno es un turn de open-edit-verify. **Mitigación**: instruir batch con sed/awk + inspección previa explícitamente en el issue.

3. **Copy-paste literal grande dentro del body del issue**. **Mitigación**: zip-en-rama.

4. **Updates frecuentes del comment de progreso**. Si el todo list tiene 14 items y se marca tras cada uno → 14 turns en housekeeping. **Mitigación**: instruir "actualiza al final de cada sección, no tras cada subtarea".

5. **suite global con cadena de fallos iterativos**. Si los tests existentes asumen un patrón que cambia, el Creator itera ajustes-test-ajustes-test. **Mitigación**: separar el cambio que rompe tests (sed batch primero) del cambio que añade lógica.

6. **Lectura exploratoria reactiva**. Si el issue no nombra los archivos clave, el Creator hace `Glob` + `Grep` + `Read` en cascada para descubrirlos. **Mitigación**: el issue debe nombrar archivos y líneas aproximadas explícitamente.

## Mitigaciones específicas

### Para renames batch

```markdown
### F. Tests existentes con `.basis` o `basis:`

Hay ~27 líneas en 6 archivos. Listado verificable:

```bash
grep -n "\.campoViejo\b" <ruta-del-paquete>/*.test.ts
```

**Hacer batch con `sed`** tras inspeccionar manualmente que el patrón es seguro:

```bash
sed -i 's/\.campoViejo\b/\.campoNuevo/g' <ruta-del-paquete>/*.test.ts
```

Verificar con un grep posterior que ya no quedan menciones de `.basis` en tests. 1 turn de inspección + 1 turn de sed + 1 de verificación = 3 turns vs ~27 con Edit individual.
```

### Para zips-en-rama

```markdown
## Procedimiento ADR (primer commit del PR)

El bloque del ADR está en `adr-XXX-block.zip` en la raíz del repo.

\`\`\`bash
unzip adr-XXX-block.zip -d /tmp/adr
echo "" >> docs/decisions/decisions-150-current.md
cat /tmp/adr/adr-XXX-block.md >> docs/decisions/decisions-150-current.md
node scripts/generate-toc.mjs
rm adr-XXX-block.zip
rm -rf /tmp/adr
\`\`\`
```

### Para limitar updates del comment

Añadir al inicio del issue:

```markdown
> @claude — actualiza el todo comment al final de cada sección (A, B, C, ...), no tras cada subtarea individual. Reduce overhead de housekeeping.
```

## Cadena de épica: mergear y lanzar el siguiente (ADR-193)

En régimen de épica (ADR-193) el Creator no se detiene al abrir el PR: cierra el ciclo y encadena.

**Marca de épica:** al abrir el PR de un issue que lleva la label `epica`, el Creator añade la label `epica` también al PR. El Reviewer la usa para saber que, al dar `LGTM`, debe pingar al Creator (en vez de dejar el merge al humano).

**Disparador del cierre:** el Creator ejecuta la secuencia de abajo (merge + cadena) en la corrida que **despierta el `LGTM` del Reviewer sobre un PR `epica`**. El LGTM es lo único que lo activa a mergear; antes de eso solo aplica reviews/nits. El **merge y el sentinel de lanzamiento son un único cierre**: el mismo comment con el que el Creator cierra tras mergear lleva el `<!-- launch-next: #N -->`, y de ese comment lo lee el step `launch-next` del workflow. No son dos eventos.

Secuencia:

1. **Aplica reviews y nits.** El Reviewer pinga en cada ronda NITS (ya no solo la primera); aplica y responde hasta que el Reviewer quede limpio (`LGTM` o sin ping). El `CAP` de rondas del workflow escala a humano si no converge. La mecánica de cierre de turno (marcadores `@reviewer` / `[READY-TO-MERGE]` / `[NEEDS-HUMAN]`, re-trigger vía Auto-label, anti-recursión) vive en **CLAUDE.md § "Loop protocol with Reviewer"** — única casa, no se duplica aquí.
2. **Cuando el Reviewer está limpio Y el CI pasa limpio:** el Creator **mergea su propio PR** (tiene `contents: write` + `pull-requests: write`) y **borra la rama**. El "CI limpio" es comprobación MECÁNICA, no supuesto: como la rama puede no tener required-checks que bloqueen el merge, el Creator DEBE confirmar que la conclusión del job `Verify (build, typecheck, test)` del workflow `CI` sobre el head del PR es `success` (vía `gh pr checks <PR>` o la status/checks API) ANTES de mergear. Si está pendiente, espera; si está en rojo o falla/falta, NO mergea → escala (ver abajo). El CI es el único verificador independiente intra-épica; saltárselo vacía la red entera.
3. **Verifica la implementación del issue recién mergeado** contra sus criterios de aceptación, leyendo la rama base fresca.
4. **Señaliza el siguiente issue de la épica para lanzar.** El Creator NO postea el `@claude` del siguiente directamente: sus tools usan el token del job, cuyos eventos NO disparan otro workflow (anti-recursión de GitHub). En su lugar emite el sentinel de cierre `<!-- launch-next: #N -->` (N = número del siguiente issue de la épica); un step de `claude-code.yml` con el PAT `REVIEWER_GITHUB_TOKEN` —el mismo patrón que el step `Auto-label`— postea el `@claude` sobre el issue N, y ESE evento (al venir de un PAT) sí dispara la siguiente corrida del Creator. Si es el último issue de la épica, el Creator NO emite `launch-next` y para: el terminador ya vive en el BODY del issue, horneado por el Architect — `<!-- epic-audit: ... -->` (cierre con auditoría automática, el caso normal) o `<!-- epic-done -->` (cierre sin auditoría, solo si se decidió omitirla deliberadamente). `epic-merge.yml` lee el body del issue al mergear y actúa.

**Escalada — qué para la cadena y llama al humano (NO se auto-resuelve):**
- **CI no pasa:** el Creator interpreta el fallo, lo explica en el PR, y llama al humano. NO intenta arreglarlo a ciegas. El portero es el CI determinista, no el Creator.
- **La verificación del paso 3 encuentra el issue anterior defectuoso:** para y escala. Esto es un *escape del gate* (CI + Reviewer pasaron pero algo está mal); auto-repararlo sería el mismo modelo calificando su propia tarea y enterrando el fallo. Escalar, no autorreparar.
- **`CAP` de rondas agotado** en el loop con el Reviewer: el workflow escala solo.

La cadena es autocontenida frente a señales objetivas (CI, Reviewer, nits) y escala frente a lo que significa que la red falló. Mergear NO requiere OK humano por PR en régimen de épica; el humano aprobó la secuencia por adelantado y prueba al final (ADR-193).

## Reglas absolutas

- **Convenciones de dominio obligatorias**: viven en `docs/agents/creator-annex.md` del repo (i18n, rutas canónicas, zonas de rigor). LÉELO junto a este doc; el Reviewer marca sus violaciones como 🔴.
- **Trigger phrase**: cada issue debe contener `@claude` literal.
- **Workflows files**: en los consumidores el Creator no los toca (ADR-020; el humano a mano). En el central los trabaja y commitea; la rama la publica el post-step de rescate — ver § "Workflows files: régimen por repo". La falta de push en sesión NO es `[NEEDS-HUMAN]` ni blocker.
- **Persistencia incremental**: commit + push tras cada sección con estado verde (typecheck + tests del área OK). NO acumular en working tree esperando "tener todo listo". Detalle en § "Persistencia incremental" abajo.
- **TOC de decisions.md**: las ADRs viven en volúmenes `docs/decisions/decisions-*.md` (las nuevas van SIEMPRE al volumen `-current`); `decisions.md` raíz es el índice global. Si el PR añade/renombra/cambia estado de un ADR → ejecutar `node scripts/generate-toc.mjs` antes de commitear (CLAUDE.md § "Mantenimiento del TOC").
- **CHANGELOG**: si el PR produce cambio visible para el caller del paquete → entrada en `packages/<paquete>/CHANGELOG.md` (CLAUDE.md § "CHANGELOG y docs de diseño"). Refactor interno puro: no requiere.
- **Status headers de docs/design**: si el PR cambia el status estructural de una sección de un área con doc (`docs/design/<área>.md`) → actualizar el status header.
- **Auth blindaje**: el step `Run Claude Code` del workflow tiene `env: ANTHROPIC_API_KEY: ""` para forzar OAuth-only. NO removerlo. Si OAuth Max falla, el job debe fallar (rojo) en lugar de caer a API key facturada silenciosamente.

## Persistencia incremental: commit + push tras cada sección

### El problema

`claude-code-action@v1` corre dentro de un job de GitHub Actions con timeout efectivo de ~13-15 min en trabajos largos (observado empíricamente; el cap `--max-turns 100` rara vez es el límite real — el timeout del job sí lo es). Si el Creator está a mitad de una sección cuando el job se cae por timeout, **todos los cambios en working tree se pierden** y el siguiente intento (cuando el humano reinvoca con `@claude continúa`) arranca desde el último push, no desde donde quedó el working tree del job muerto.

### Caso histórico que motiva la regla

Issue #169 (PR-C4 — port UI fase 4). 4 intentos consecutivos del Creator entre las 09:46 y las 11:42 del 2026-05-21:

| Intento | Branch | Duración | Resultado | Coste |
|---|---|---|---|---|
| 1 | `claude/issue-169-20260521-0946` | 13 min | timeout, §A sin pushear | §A perdida |
| 2 | `claude/issue-169-20260521-1017` | 15 min | dividió a PR-C4a + PR-C4b. **Pusheó §A + §B + CHANGELOG**. PR-C4a (#170) abierto ✓ | recuperado por commits intermedios |
| 3 | `claude/issue-169-20260521-1035` | 16 min | timeout. §I/§H/§C+D pusheados ✓; §E a medias **perdida** | §E perdida |
| 4 | `claude/issue-169-20260521-1107` | 14 min | timeout pero todas las secciones (§I/§H/§E/§F/§C+D) pusheadas ✓ | reanudable en intento 5 |
| 5 | `claude/issue-169-20260521-1142` | 7 min | §G + CHANGELOG + PR-C4b abierto ✓ | éxito |

Patrón claro: los intentos que **pusheaban tras cada sección** (2, 4, 5) preservaron avance. Los que acumulaban en working tree (1, 3) lo perdieron.

### Protocolo obligatorio

Para PRs con scope mediano-grande (>3 secciones del issue):

```bash
# Después de completar §X y verificar typecheck + tests de la zona afectada:
git add <archivos-de-§X>
git commit -m "feat(scope): <descripción §X>"

# Push inmediato — NO esperar a §Y. La action expone un helper bajo
# $GITHUB_ACTION_PATH/scripts/git-push.sh que gestiona el token de la
# GitHub App; bare `git push` puede fallar dentro del contexto del job:
"$GITHUB_ACTION_PATH"/scripts/git-push.sh origin <rama-actual>
```

(El system prompt que recibe el Creator instruye este mismo helper —
hard-codeado al pin `@v1` del action en el prompt. Usar la variable
`$GITHUB_ACTION_PATH` en el doc desacopla la documentación del pin
concreto: si el repo migra a `@v2`, la variable sigue resolviendo al
path correcto sin tocar este texto.)

Después del push, actualizar el comment de progreso marcando §X como hecha y registrando el SHA del commit. Si el job se muere a continuación, el humano (o el siguiente turn) ve exactamente dónde quedó.

### Cuándo NO commitear inmediatamente

- **Sección rompe tests temporalmente y la siguiente los arregla.** Patrón típico: §A renombra un campo público y §B actualiza los tests. Si commiteamos tras §A, dejamos la rama base roja. **Juntar §A + §B en un commit.**
- **Sección es exploratoria y no produce código final.** Si la sección es "leer el módulo X para entender el shape", NO genera commit; los siguientes Read del Creator no necesitan persistirse.
- **Sub-paso dentro de una sección sin estado coherente.** "Añadir el type" y "añadir el constructor" suelen ser sub-pasos de una misma sección. No partir en dos commits.

La regla operativa: **un commit por sección verde estable**, no un commit por subtarea ni un commit "limpio" final al merge.

### Coste vs ahorro

| Concepto | Coste estimado |
|---|---|
| Overhead por commit + push | 1-2 turns |
| Overhead por sección típica (1 commit) | 1-2 turns |
| Overhead total en PR de 6 secciones | 6-12 turns |
| Coste de un timeout sin pushear (todo perdido) | el PR entero (50-100 turns repetidos) |
| Coste de un timeout con todo pusheado salvo §en-curso | solo la §en-curso (5-15 turns repetidos) |

Esperanza estimada de timeout en PR >70 turns: ~30% (4/13 intentos en histórico reciente). Esperanza estimada de timeout en PR <50 turns: ~5%. La ~40-turns es la heurística empírica que motiva el trigger operativo del protocolo (">3 secciones del issue", arriba); en PRs por debajo de ese umbral los commits intermedios suelen ser overhead innecesario.

### Patrón de comment de progreso compatible

Actualizar el todo comment tras cada **commit pusheado**, no tras cada subtarea — equivale a la regla operativa existente del Creator ("actualiza al final de cada sección"). El comment refleja el estado pusheado del remoto, no el del working tree local del job. Si el humano lee el comment y reinvoca, ve la verdad de remote.

Plantilla:

```markdown
- [x] **§A.** Store + adapter → commit `b4483f4` ✓ pushed
- [x] **§B.** useChartData con withdrawals → commit `bca05d6` ✓ pushed
- [ ] **§C.** FanChart extension (en curso)
```

Cuando el job muere, el "(en curso)" marca exactamente la frontera de recuperación.

### Cuándo abrir el PR

**Literales must-copy (2026-07-12, propuesta #1278 del repo de origen — un ciclo correctivo entero por UNA línea perdida en render):** si el issue especifica un literal a copiar (marcador de coordinación, cadena de invariante, mensaje exacto) y NO es legible en el contexto que has recibido, recupéralo del body RAW: `gh issue view <n> --json body` (los comentarios HTML sobreviven SIEMPRE en el raw; tu vista renderizada puede perderlos). Si tampoco aparece en el raw, escala al humano con el cierre correspondiente del loop protocol — JAMÁS improvises el literal de memoria.

**Huella del pre-reviewer (2026-07-12, propuesta #1259 del repo de origen — sin rastro público el mecanismo es inevaluable):** el body de todo PR que abras incluye UNA línea obligatoria: `pre-reviewer: ejecutado · N hallazgos · M aplicados` (o `pre-reviewer: no ejecutado — <motivo>`). Solo la huella, no el informe: es texto informativo que ningún workflow parsea.

El PR se abre al final, una vez todas las secciones están pusheadas. Verificaciones locales antes de abrir: el chequeo estático y **solo los ficheros de test que has tocado**, ambos con los comandos de tu ANEXO de rol. **NO abrir PR mid-flight** — un PR con secciones a medias dispara al Reviewer prematuramente.

> **REGLA DURA — NUNCA corras la suite completa en tu sandbox.** NO ejecutes la suite completa, ni el runner sin rutas, ni la build global (comandos concretos: ANEXO de rol). La suite completa **te cuelga** (causa confirmada de parada repetida de épicas) y es **redundante**: CI corre la suite completa + typecheck + build sobre el PR como gate de merge. Tu trabajo: tocar solo lo tuyo, correr **solo tus ficheros de test afectados** (comando: ANEXO de rol), commit + push conforme avanzas (por sección/fichero), abrir PR. El conjunto lo valida CI, no tú. Nunca acumules trabajo sin commitear esperando a una verificación amplia.

Si el job muere antes de abrir el PR pero con todas las secciones pusheadas, el siguiente intento solo necesita ejecutar las verificaciones finales + `gh pr create`. Bajo coste de turns.

## Historial de aprendizajes empíricos

| Fecha | PR | Resultado | Lección extraída |
|---|---|---|---|
| 2026-05-18 | PR13b monolítico (issue #123) | `error_max_turns` 101 turns, `total_cost_usd: 11.13` reportado | El scope era todo ADR-068 (shape + mecánica + outputs + 7 grupos de tests + docs). Inviable en 100 turns. Split en a/b/c funcionó. |
| 2026-05-18 | PR-basis-nominal monolítico | `error_max_turns` 101 turns, `total_cost_usd: 7.71` reportado | Sincronización masiva de docs (9+1 puntos) + rename batch de tests sin sed instructions + ADR copy-paste literal de 110 líneas. Split en core + docs implementado retroactivamente. |
| 2026-05-18 | PR-basis-nominal-core (1er intento, issue #131) | `error_max_turns` 101 turns, `total_cost_usd: 6.13` reportado. **3/14 items completados.** | El zip-en-rama del humano no se aplicó porque el issue no incluía las dos directivas obligatorias. El Creator arrancó en su propia rama, no encontró el zip, improvisó el ADR, se quedó sin turns. La rama del Creator nunca se pusheó. **Lección operativa**: refinar el protocolo a "zip-en-base" elimina la clase entera de fallos por directivas omitidas. Documentado en este doc § "Variante recomendada: zip-en-base". |

**Patrón empírico**: PRs que tocan **shape público + tests dispersos + docs prosa masiva** no caben en 100 turns. La regla operativa derivada: **docs prosa va siempre a PR separado cuando son >3 puntos**.

**Nota sobre coste reportado vs facturado**: el `total_cost_usd` que la SDK reporta es estimación a precios API y puede o no corresponder con facturación real. Bajo OAuth Max activo, el coste real es $0 (subscription). Verificación empírica: Anthropic Console → Usage del día del run; si la API key NO aparece facturada en esa franja, el blindaje funciona.

## Cuándo dividir un PR (regla operativa)

Antes de finalizar el issue, sumar el budget estimado de turns. Si supera **70**, dividir. Estrategias de división, en orden de preferencia:

1. **(Código) + (Docs)**: si hay sincronización masiva de docs, va aparte.
2. **(Shape + validación con flag de "implementación pendiente") + (Implementación)**: patrón PR13b-a + PR13b-b. El primer PR introduce el shape + lanza `RangeError` "pendiente PR-X"; el segundo elimina el throw y aplica la mecánica.
3. **(Core) + (Outputs derivados)**: si la mecánica del bucle es separable de los outputs nuevos del `LifecycleResult`. Patrón PR13b-b + PR13b-c.
4. **(Tests existentes con sed) + (Cambio lógico)**: si los tests existentes hay que renombrarlos masivamente, primer PR es solo el rename (sed batch, no toca lógica); segundo PR es el cambio.

Cada sub-PR debe tener criterios de aceptación independientes y pasar **sus tests afectados** por sí solo (no asumir que el siguiente PR arreglará algo). La suite completa la corre CI, no el Creator.

### PRs parciales en épicas (obligatorio si divides)

Trocear un issue de épica en varios PRs está permitido, con tres reglas duras (motivado por #954/#957: la Slice 2 murió en silencio al cerrar el auto-merge el issue con la Slice 1):

0. **Polaridad obligatoria en el body de TODO PR** (un hook bloquea `gh pr create` sin ella): `<!-- full-pr -->` si completa todo el alcance del issue; `<!-- partial-pr -->` si es híbrido/parcial. Sin declaración, epic-merge trata el PR como parcial.
1. Todo PR que NO cubra el alcance completo del issue lleva **`<!-- partial-pr -->`** en su body, más la lista explícita de lo que queda pendiente. El epic-merge, al ver el marcador, mergea SIN cerrar el issue y te re-arma en el mismo issue para el alcance restante.
2. Un PR parcial **nunca** lleva `Closes #N` ni "cierra" el issue en su texto de forma que GitHub lo interprete.
3. **No dejes preguntas de diseño como bloqueo silencioso de la siguiente slice.** Si el issue trae las decisiones (p.ej. una sección "Decisiones confirmadas"), ejecútalas. Si de verdad falta una decisión humana, termina con **`[NEEDS-HUMAN]`** explícito en tu comentario de cierre — nunca un PR parcial + espera muda.
4. **Escalado determinista al Architect (2026-07-14, finplan#1350).** Si paras SIN abrir PR por un hueco que el Architect puede resolver — serie/emisión ausente del estado derivado, hueco de dimensionado del issue, ambigüedad de ADR que un `autonomous-decision` puede cerrar — tu comentario de cierre termina con el marcador **`<!-- creator-blocked -->`** (además del informe de alcance restante). Un post-step determinista materializa `stalled` con PAT en el instante ⇒ architect-resolve dispara POR EVENTO, sin esperar al cron. Reglas: JAMÁS lo uses si abriste PR (con PR abierto el complemento es **`<!-- creator-escalated -->`** — ver § «Materializar la escalada: tabla de decisión», AP-017); JAMÁS para decisiones genuinamente humanas (eso sigue siendo `[NEEDS-HUMAN]`); una respuesta conversacional normal (contestar una pregunta, converger con el Reviewer) NO lleva el marcador.
5. **Re-arm de un parcial FANTASMA — desenlace determinista resto-vacío (2026-07-17, repesca finplan#1466, AP-026).** Si el `@claude` que te re-arma lleva el marcador **`<!-- epic-partial-relaunch-por-estado -->`**, el parcial que se mergeó lo abrió el post-step DESDE EL ESTADO (el Creator anterior murió con commits en verde sin abrir PR): su «Alcance restante: desconocido» es un **placeholder**, no trabajo real pendiente. Re-verifica contra el HEAD y aplica el desenlace terminal: **si NADA queda sin cubrir ⇒ cierra tu turno con `<!-- creator-alcance-completo -->`** (HTML anclado, su propia línea, en el ISSUE — § «Materializar la escalada: tabla de decisión»). **NUNCA recomiendes «cerrar el issue a mano» en prosa**: el post-step no lee prosa, y sin el marcador tu turno degrada a `human-needed` (fue el incidente exacto — cola fantasma + cirugía de cadena humana). Si SÍ queda alcance real, cúbrelo y abre el PR (`full-pr` si lo completa). Red por estado: aunque olvides el marcador, un belt del post-step lo deriva del `epic-partial-relaunch-por-estado` del disparador y materializa el mismo terminal — pero emitir el marcador es tu vía primaria y la que deja el veredicto explícito.

## Cuándo NO dividir

- Si el PR es ~50-65 turns, no dividir solo por miedo. La división tiene su propio coste (PRs separados = más rondas de Reviewer + dos contextos de partida que verificar).
- Si el cambio es lógicamente atómico y dividirlo dejaría el motor en un estado inconsistente.

---

**Mantenimiento de este doc**: añadir nueva fila a la tabla "Historial de aprendizajes empíricos" cada vez que un PR del Creator falle por `error_max_turns` o muestre un patrón sub-óptimo no documentado. Si emerge una mitigación nueva, añadirla a la sección "Mitigaciones específicas".

## Ports de prototipo: copiar, no inventar

Cuando un issue porta un prototipo (ver conventions §11), la fuente citada es el **contrato**. Copia **literal** los textos, clases y estructura. Prohibido parafrasear, simplificar, resumir o "mejorar" el copy o el layout.

Si un texto o elemento del prototipo parece incorrecto o entra en conflicto con el modelo/restricciones, **NO lo cambies**: déjalo como en la fuente y **señálalo en el comentario del PR** para decisión humana. Inventar, parafrasear o reescribir copy del prototipo es divergencia, aunque "suene mejor".
