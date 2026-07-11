<!-- synced from agent-pipeline@v1 — DO NOT EDIT locally; changes arrive as sync PRs -->
<!-- Los ejemplos históricos citan el repo de origen (finplan): son lecciones con evidencia, no normas de este repo. -->

---
name: delivery-bundles
description: Patrón canónico de entrega por zip self-contained desde el sandbox del Architect: sub-reglas de verificación, base de rama, string-replacements, smart quotes al pegar por web UI. Leer solo cuando se entrega trabajo por bundle en vez de por PR del Creator.
---

# delivery-bundles (extraído de docs/operational-notes.md, 2026-07-05, movimiento verbatim)

## Smart quotes / paste hazard al subir código vía web UI

Pegar archivos de código (.mjs, .ts, .json, etc.) vía "Edit file" en
la web UI o app móvil de GitHub puede convertir comillas ASCII (`'`,
`"`) en comillas tipográficas (`'`, `'`, `"`, `"`), rompiendo sintaxis
de JS/TS silenciosamente. Lección concreta: tras subir un script con
paste, el runner falló con `SyntaxError: Invalid or unexpected token`
en la línea de `import` por comillas curvas.

**Regla operativa:** para subir archivos de código desde mobile,
**siempre usar "Add file → Upload files"** (drag & drop o picker), no
"Edit file" + paste. El upload preserva los bytes exactos. Si paste es
la única opción, desactivar "Comillas tipográficas" en Ajustes →
General → Teclado del dispositivo iOS antes.

Para .md de proyecto u otros archivos de texto donde una comilla curva
no rompe nada, paste sigue siendo aceptable.

**Excepción para copy-paste desde bloques de código markdown del chat
de claude.ai:** los bloques de código (entre triples backticks)
preservan los bytes exactos al copiar. Pegar desde un bloque de chat
en GitHub web UI no introduce smart quotes porque el contenido viene
ya como texto monoespaciado puro. Es una vía válida cuando subir
archivo no es práctico.

## Pattern de delivery: archivos generados en sandbox de Claude

Para PRs del motor donde el código se pre-genera y verifica en mi
sandbox de claude.ai (typecheck strict + tests verdes antes de tocar
el repo), el flujo establecido es:

1. Yo genero los archivos en mi sandbox.
2. Te los presento para descarga (vía `present_files` del chat) o como
   bloques de código pegables.
3. Tú creas la rama de trabajo (`feat/<scope>`) en GitHub web UI desde
   el branch selector.
4. En esa rama, navegas a la carpeta destino (típicamente
   `packages/engine/src/shared/`).
5. `Add file → Upload files` con drag&drop de TODOS los archivos a la
   vez.
6. Commit a la rama.
7. Comentas al agente con `@claude` en un issue, indicando que los
   archivos ya están en la rama y pidiendo que: (a) trabaje en esa
   rama directamente sin crear una nueva, (b) aplique los edits
   puntuales que faltan (típicamente añadir exports a `index.ts`,
   extender `branded.ts` con tipos nuevos), (c) corra `pnpm typecheck`
   y `pnpm test` localmente, (d) commit + push + abra PR contra
   `develop`, (e) NO mergee.

Por qué este patrón:

- El agente NO genera el código (que ya está verificado), solo lo
  *transporta* + edits pequeños. Reduce el espacio de errores.
- El sandbox del Action no puede descargar adjuntos del issue
  (limitación del frontend de GitHub, ver sección dedicada). Subir
  los archivos al repo directamente es la única vía robusta.
- Si el código requiere cambios tras feedback del Reviewer, el
  agente los aplica a la misma rama sin tener que volver a transportar
  archivos.

### Pattern de delivery: zip self-contained con instrucciones embebidas (canónico desde PR3-bis)

Reemplaza al patrón anterior ("subir 9 archivos al repo via web UI uno a uno + comentar al agente con instrucciones largas"). El nuevo patrón:

**Estructura del zip que produce el sandbox de claude.ai:**
- Estructura interna **idéntica al repo destino** (los archivos van a sus paths automáticamente al unzip en root)
- Carpeta auxiliar `_<feature>/` con `INSTRUCTIONS.md` self-contained + cualquier ADR/fragmento de docs a aplicar

**Procedimiento humano (~2 minutos):**
1. Crear rama desde `main` en GitHub web UI.
2. Subir UN único zip al root de la rama via "Add file → Upload files" (drag & drop). Commit a la rama.
3. Abrir issue con un mensaje mínimo (3-5 líneas) al agente apuntando a `_<feature>/INSTRUCTIONS.md`.

**Procedimiento agente (autónomo):**
1. `unzip` el zip al root, `rm` el zip.
2. Leer `_<feature>/INSTRUCTIONS.md` y seguir paso a paso.
3. Aplicar appends/replaces a docs leyendo del filesystem (sin paste hazard).
4. Borrar la carpeta `_<feature>/`.
5. `pnpm typecheck` + `pnpm test`. Si fallan, parar sin commit.
6. Commit + push + abrir PR contra `develop`.

**Beneficios vs patrón previo:**
- 1 upload al repo en lugar de N
- Zero paste-hazard (todos los textos se leen del filesystem)
- El issue al agente cabe en 3-5 líneas
- INSTRUCTIONS.md vive con el código que ejecuta, no en un comentario perdido
- Las modificaciones a múltiples archivos del repo (motor + decisions.md + spec.md + esta nota) se aplican consistentemente sin transcribir manualmente

**Cuándo NO aplica:**
- PRs donde el agente debe escribir código nuevo (no transportar pre-verificado). Ahí el flujo `@claude` desde issue sin zip sigue siendo el correcto.
- PRs muy pequeños (<3 archivos): el zip añade más fricción que la que ahorra.

### Verificación de string-replacements antes de empacar el zip (sub-regla del patrón canónico)

Cuando el sandbox de claude.ai produce un `_<feature>/spec-update.md` u otro fichero con bloques "Buscar"/"Reemplazar por" para docs del repo (`spec.md`, `decisions.md`, `CLAUDE.md`, `operational-notes.md`), las cadenas de "Buscar" deben coincidir **literal y unívocamente** con el archivo destino actual. La verificación correcta es leer el archivo destino del filesystem del sandbox (`/mnt/project/spec.md`, etc.) y hacer `grep -F` exacto de cada cadena de búsqueda antes de empaquetar el zip. Asumir desde memoria cómo "está redactado" el archivo es modo de fallo: produce desalineaciones que el agente correctamente detecta y reporta (siguiendo INSTRUCTIONS.md), pero cuestan un round-trip humano evitable.

**Caso histórico**: PR3-bis (mayo 2026). El sandbox redactó tres `Buscar`/`Reemplazar` para `spec.md` desde memoria del documento, sin verificar contra el archivo real. Las tres fallaron al ejecutar. El agente paró correctamente; el humano tuvo que pegar las cadenas literales en un comentario al issue. Coste: ~10 min de chat, sin daño real al PR. Lección barata, pero la próxima debe verificarse antes de empaquetar.

**Aplica a**: cualquier `_<feature>/*-update.md` con bloques de string-replace literal. NO aplica a appends puros (donde el agente lee el contenido del fichero auxiliar y lo añade al final del destino) ni a archivos nuevos.

### Instrucción explícita "no crear rama nueva" en el patrón zip

El comportamiento por defecto de `claude-code-action` es crear una rama temporal con formato `claude/issue-{N}-{timestamp}` por cada invocación, partiendo del default branch. Si la tarea requiere que el agente trabaje en una rama de trabajo que el humano ya ha creado (caso del patrón zip canónico), el comment al agente DEBE incluir una instrucción literal explícita tipo: *"Trabaja en la rama X directamente. NO crees una rama nueva. Tu commit y PR salen desde esta misma rama."*

Sin esa instrucción explícita, el agente crea su propia rama, lo cual: (a) deja la rama del humano como "zombi" tras el merge (no se borra automáticamente), (b) duplica trabajo si el agente parte de un base distinto al esperado, (c) complica la trazabilidad cuando el humano ha aplicado pre-cambios manuales en la rama original (por ejemplo, fix del workflow vía web UI por restricción ADR-020).

**Caso histórico**: PR3-bis (mayo 2026), primer intento. El INSTRUCTIONS.md no incluía esa línea explícita; el agente creó `claude/issue-27-...` y trabajó ahí. Tras descubrir el bug del `reviewer.yml`, hubo que cerrar ese PR, borrar la rama del agente, subir el fix manualmente a la rama del humano, y reinvocar al agente con la instrucción explícita. Coste: round-trip evitable.

### Trade-off "no crear rama nueva" + "PR automático" en claude-code-action

El comportamiento por defecto de `claude-code-action` cuando crea su propia rama (`claude/issue-{N}-{timestamp}`) es: commit + push + abrir PR contra el target automáticamente. Cuando se le instruye explícitamente "no crees rama nueva, trabaja en esta rama" (override del default necesario para evitar la rama zombi del humano — Entrada 4), la action entra en lo que parece ser un modo cooperativo: hace commit + push, pero NO abre PR automáticamente. Deja un link "Create PR ➔" en su comentario final para que el humano cierre el ciclo a mano.

Si se quiere combinar **"no crear rama nueva" + "PR automático"** (que es el caso óptimo del patrón zip canónico — sin rama zombi y sin click manual del humano), el comment al agente DEBE incluir una directiva literal explícita tras la de "no crear rama nueva". Ejemplo:

> Tras el push, abre PR contra `develop` con `gh pr create --base develop --head <esta rama> --title "<title>" --body-file <body file>`. Title y body sugeridos: ... NO mergees.

Sin esa directiva, el agente queda en modo cooperativo y el humano completa el ciclo a mano. Funcionalmente válido, pero contradice el principio de "operativa ligera para el solista no técnico" (ADR-017, ADR-036).

**Caso histórico**: PR3-bis (mayo 2026), tercer turno del agente (post-fix del workflow yml). El comment sí incluía "no crees rama nueva" pero no incluía la directiva de `gh pr create`. Resultado: agente cooperó, humano tuvo que invocar al agente otra vez sólo para que abriera PR. Round-trip evitable.

**Refinamiento del template del patrón zip canónico (Entrada 2 de este mismo fichero)**: la sección "Procedimiento agente (autónomo)" del patrón canónico debe ahora incluir como pasos explícitos en INSTRUCTIONS.md tanto:

- "Trabaja en esta rama directamente. NO crees una rama nueva."
- "Tras el push, abre PR contra `develop` con `gh pr create ...`. NO mergees."

Sin ambas, el comportamiento de la action es ambiguo y produce uno de los dos modos de fallo (rama zombi del humano O ciclo abierto pendiente del humano).
### Precedente "fixes pequeños directo al PR sin bundle ni re-review" (post-PR4 review)

Durante la ronda de review de PR4 se aplicaron varios fixes pequeños directamente sobre la rama del PR (no como nuevo bundle, no requieren ronda de review independiente del Reviewer). Operacionalmente, el patrón del bundle canónico (Entrada 2 de este fichero) es **costoso para un fix de 1-3 líneas**: producir zip, INSTRUCTIONS.md, verificar string-replaces con `grep -F`, reinvocar al agente, esperar Reviewer otra vez. La fricción es desproporcionada.

**Cuándo aplica el patrón "directo al PR":**
- Fix de naturaleza small (typo, falta de defensive check, comentario aclaratorio, mensaje de error, ajuste de validation).
- Fix sobre código que el Reviewer ya aprobó en lo conceptual, donde el cambio no altera la lógica de negocio.
- Test del fix añadido en el mismo commit.
- Total: < 30 LOC, < 5 archivos.

**Cuándo NO aplica (mantener patrón canónico):**
- Cambio de comportamiento o de API.
- Cambios que tocan ADRs nuevos o existentes.
- Cualquier cambio que pueda razonablemente requerir lectura completa del Reviewer otra vez.
- Más de un solo concepto cohesivo en el lote de fixes.

**Procedimiento operativo del fix directo:**
1. Editar localmente o vía web UI del repo (según el caller).
2. Commit con `fix(scope):` siguiendo Conventional Commits.
3. Push a la rama del PR existente.
4. NO invocar `@claude` en el issue; el Reviewer no se re-dispara automáticamente.
5. Si el fix invalidaría algo que el Reviewer dijo en su review previa, mejor que el autor humano comente en el thread del PR explicitando el delta.

**Limitación honesta del precedente:** el coste evitado (15-30 min de bundle + round-trip) puede ser nulo si el fix es realmente delicado y se debió haber pasado por bundle. La línea entre "small" y "delicado" es de juicio. Default: si el autor humano duda, bundle. Si el autor humano está seguro de que es trivial, directo.

### Aprendizajes empíricos del bundle de PR5 (2026-05-09)

PR5 completó el cuarto bundle exitoso bajo el patrón canónico. Cosas que merecen anotarse para futuros bundles del motor:

- **Pre-flight grep antes de aceptar que un rename es "breaking" cuesta caro.** Antes de PR5 estábamos asumiendo que renombrar `annualExpenses → targetSpending` requería migration path, wrapper de retrocompatibilidad, o bump major. `grep -rn "annualExpenses"` sobre el repo entero (excluyendo `node_modules` y `pnpm-lock`) reveló: cero callers fuera de `packages/engine/src/shared/lifecycle.ts` y su propio test. Mientras la API pública del motor (`packages/engine/src/index.ts`) no esté consolidada, la "ruptura" interna es operativamente gratis: se renombra en dos archivos y queda cero deuda. **Patrón:** antes de aceptar que algo es "breaking change" en el motor, ejecutar el grep. Si no hay callers externos, el coste real es trivial y se puede decidir solo por claridad conceptual.

- **Discriminated unions con default explícito mantienen backward-compat sin esfuerzo cuando se extienden con nuevos `kind`.** PR5 añadió `WithdrawalStrategy` (3 kinds) con default `{ kind: 'fixed-real' }` que reproduce el comportamiento PR4 bit-exact. Esto convirtió un cambio que parecía "extender API" en "extender API + add default" sin reescribir tests existentes. **Patrón:** cuando se introduce discriminated union nueva en el motor para algo que ya tenía un comportamiento implícito, el `kind` por defecto debe ser exactamente ese comportamiento. Test de regresión: ejecutar la nueva API con default explícito y verificar que produce output idéntico al de no declararla.

- **Cross-validation entre campos atrapa malos usos del API que TypeScript no detecta.** PR5 añadió la regla "si `retirementYearOffset < maxYears` (existe decumulación), entonces `targetSpending` es obligatorio aunque sea opcional en el tipo". TypeScript no puede expresar esto. La validación en `validateAndDefault` con `RangeError` claro lo atrapa al runtime. **Patrón:** cuando un campo opcional se vuelve condicionalmente obligatorio, documentar la regla en el JSDoc del campo y enforce en `validateAndDefault` con mensaje que diga el qué y el porqué.

- **Tamaño del bundle de PR5:** ~350 LOC añadidos a `lifecycle.ts` (de 1027 a ~1380), 21 tests nuevos en `lifecycle.test.ts`, 4 ADRs nuevos + 3 follow-up, 1 README reescrito, 1 entrada apéndice spec.md. Está cerca del techo de lo que el patrón canónico maneja sin friccionar. PRs más grandes (>500 LOC al motor + más de 5 archivos de docs) deberían partirse.
### Verificar empíricamente la base de la rama de trabajo antes de empacar bundle (post-PR5)

Aprendizaje de la sesión PR5 (2026-05-09): el sandbox que produjo el bundle inicial asumió desde memoria del handover que `develop = main = post-PR4`. La afirmación era falsa — `main` estaba atrasado ~10 horas respecto a `develop` y no incluía PR4. La rama `Pr5` se cortó de `main`, así que cuando el agente intentó aplicar el bundle (que importaba de `mortality.js`), el typecheck falló: ese módulo no existía en `main`. Coste: round-trip del agente, diagnóstico, y borrado-recreación de la rama de trabajo desde `develop`.

**Regla operativa para futuros bundles:** antes de cerrar un bundle, verificar empíricamente la base contra la que se aplica. No asumir desde el handover. Verificación mínima:

- Si el sandbox tiene acceso al repo (vía herramientas tipo `gh`, o porque el humano sube el zip del estado actual), comparar con `git diff origin/main..origin/develop --stat` y leer si hay archivos relevantes para el bundle.
- Si el sandbox solo recibe un zip del repo, verificar el `dirname` raíz del zip: GitHub web UI nombra el directorio del zip como `<repo>-<branch>` (e.g., `asesoramiento-financiero-develop` vs `asesoramiento-financiero-main`). Si el handover dice "estoy mandándote main" pero el dirname dice `-develop`, descartar la afirmación del handover y preguntar.

**Regla operativa para el humano:** ramas de trabajo se cortan de `develop` por convención (`docs/conventions.md` § 3). Cortar de `main` introduce el riesgo descrito arriba: si `main` está detrás de `develop`, la rama de trabajo no tiene los cambios necesarios. Aunque "ahora `main` está al día" sea cierto en el momento de cortar, no es regla estable — la próxima vez que `main` esté detrás (lo cual es el estado por defecto bajo ADR-008), el patrón vuelve a fallar. Cortar siempre de `develop` evita el problema sin importar el estado de `main`.

**Caso histórico del round-trip:** PR5 (mayo 2026). El sandbox previo asumió la base; el agente paró correctamente al detectar el fallo del typecheck (siguió las instrucciones del bundle: "parar sin commit"); el humano descartó la rama y volvió a empezar desde `develop`. ~30 min perdidos, sin daño al PR final, pero evitable con la verificación pre-bundle.

## Heurísticas aprendidas (loop)

<!-- Sección entrenable (ADR-212): SOLO el process-reviewer edita aquí, con marcador `skill-edit` por línea y presupuesto de la épica. Todo lo demás de este fichero está FUERA del loop (precedencia ADR / mantenimiento propio). Vacía = sin heurísticas aceptadas aún. -->
