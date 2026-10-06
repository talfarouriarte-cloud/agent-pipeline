<!-- Las referencias ADR-NNN, #issue y fechas de incidentes de este doc son del repo de ORIGEN del framework (provenance histórica), NO del repo consumidor. No las resuelvas contra el decisions.md local. -->

# Architect — mandato común (herramientas y reglas de trabajo)

> **Mandato común; lo específico del repo vive en `docs/agents/architect.md` del consumidor; en conflicto, gana este.**
>
> Los Architects de consumidor son sesiones de chat que leen el repo por API y NO reciben el graft de `vendored/`. Este fichero se lee al arrancar directamente desde `agent-pipeline@main` (central#327). Explica cómo se USA cada herramienta, no cómo está implementada; la implementación y su porqué viven en `vendored/docs-agents/protocol.md` y en `docs/decisions.md` del central. El Architect central documenta aquí toda herramienta nueva para Architects, en el mismo PR que la introduce.
>
> El graft NO sirve este fichero a `docs/agents/` de los consumidores: allí `docs/agents/architect.md` es el mandato LOCAL y no se pisa.

## 1. Enmiendas en vuelo

Sirve para corregir o ampliar un encargo mientras el Creator trabaja en él, o antes de que su eslabón se arme, sin carrera.

- **Cómo publicar una enmienda.** Escribe un comentario en el issue o en su PR con el texto de la enmienda y, en una línea propia, el marcador:

  ```
  <!-- enmienda -->
  ```

  **Sin ping.** Solo cuenta si lo publica una identidad de confianza (`OWNER`/`MEMBER`/`COLLABORATOR`; tu token actúa como el propietario). El id del comentario es la identidad de la enmienda. Si la editas después, el Creator lee la versión vigente.
- **No hace falta vigilar el run.** Con el Creator en vuelo, al terminar su turno el post-step publica UN comentario de re-arm (marcador `rearm-enmienda`) con ping que enlaza lo pendiente. Un ping tuyo que choque con un Creator en vuelo sobre un PR ya no se pierde: el guard de vuelo único lo difiere (`disparo-pendiente`) y se entrega en ese mismo re-arm.
- **PR en espera (sin Creator en vuelo).** Tampoco hace falta pingar. Si el PR ya tenía `lgtm` o espera el CI, el gate de `epic-merge` ve la enmienda sin acuse al evaluar el merge, no mergea y publica él el re-arm del Creator, con los mismos límites. Si espera al Reviewer, su `LGTM` no contará y re-arma al Creator. Si espera al Creator (veredicto REVIEW/NITS), su siguiente turno la lee al arrancar. Si quieres que entre ya, basta un único `@claude` explícito: ese turno la lee al arrancar.
- **Nada mergea sin acuse.** Mientras la enmienda no tenga acuse, el `LGTM` del Reviewer no cuenta (se retira `lgtm` y el turno vuelve al Creator) y `epic-merge` no mergea (su diag enlaza la enmienda).
- **Cómo comprobar el acuse.** Busca en el issue o en el PR un comentario del Creator con `enmienda-aplicada: <id>` o `enmienda-rechazada: <id>` (en un comentario HTML, en línea propia). Un rechazo trae el motivo en prosa y pone `human-needed`: el turno es tuyo o del propietario.
- **Eslabones aún no armados.** Publica la enmienda en el issue del eslabón y no lo armes por ella: el Creator la lee al armarse (foto pre-sesión `.enmiendas-pendientes.md`) y la acusa en su primer turno.
- **Límites.** Un solo re-arm por conjunto de pendientes y un máximo de 3 por ítem en 24 h. Al superarlo, `human-needed` y comentario, sin re-arm. Si el Creator re-armado termina su turno sin acusar, también `human-needed`: el turno es tuyo (acusa a mano con `enmienda-aplicada: <id>` en un comentario HTML, re-arma con un ping explícito o retira la enmienda). Con `pause-agents` o `human-needed` en el ítem no se re-arma: el turno es humano.

## 2. Cola de la serie

- **`prioridad:urgente`** se cuela entre eslabones: en el siguiente límite de eslabón se arma la urgente y el eslabón queda suspendido hasta que se cierre. **`prioridad:alta`** sale de la cola antes que lo normal, pero espera al fin de la épica en marcha (AP-102). Solo las pones a petición expresa del propietario.
- **Una etiqueta de prioridad NO encola.** Ordena lo que ya está `en-cola`. Para que entre en la cola hay que armarlo (el guard serial lo encola si la serie está ocupada).
- **`pausa-cola`** en cualquier issue abierto: la serie no arma nada nuevo y lo que está en vuelo termina. Al quitarla, la cola sigue sola (AP-103). La pone y la quita el humano.
- **`pause-agents`** es por ítem y solo actúa AL ARRANCAR un run: no mata una sesión en vuelo. En un PR va en el PR, no en el issue. Sirve de hold de intervención: ponla, espera a que acaben los runs del ítem, escribe y quítala con un único disparo explícito. Para corregir un encargo en vuelo, la herramienta preferente es la enmienda (§ 1).
- **`serial-ok`** en el issue: override del hard stop serial. Arma aunque haya otro Creator en vuelo, bajo responsabilidad del que la pone.

## 3. Armar y pingar

- **Jamás la mención al agente** (arroba + claude) en el body de un issue, ni siquiera entre backticks: el trigger es un substring crudo y arma al instante (y en cada edición del body). Para hablar de ella, escribe «arroba + claude».
- **Un único ping por intención.** Dos pings seguidos son dos sesiones o un descarte. Para añadir algo a un encargo en vuelo, usa una enmienda (§ 1), no un segundo ping.
- Arma con un comentario de confianza en el issue (o en el PR, para el loop del PR). Comprueba después que el run arrancó en vez de volver a pingar.

## 4. Registro de decisiones

Regla común de escritura (central#325, AP-106):

- **Nunca** `PUT` por Contents API sobre un fichero EXISTENTE del registro (volúmenes, `ADR-NNN.md`, índice). Con volúmenes de MB no hay forma de haberlo leído entero, así que la vía es git: clone → script → commit → push.
- Antes del push, captura el estado remoto de la rama (`git fetch` y `origin/<rama>`). Tras el push, `adr-lint --ids-vs <ese estado>` (no `HEAD~1`). Si falla, restaura desde ese estado y avisa al propietario.
- Antes de cualquier commit que toque el registro, `adr-lint` en verde. Ojo: normaliza espacios pero no las marcas de markdown. Una cita «…» de 40 palabras o más tiene que coincidir con el corpus, incluidos los `**`.
- Tras el corte a `layout: "dir"` (central#331, AP-109), una rectificación se AÑADE al final del fichero de su ADR, nunca en medio. Lo vigila `adr-lint --append-only-vs <ref>`, con `<ref>` = el estado previo al push (el mismo que en `--ids-vs`), nunca un ref fijo como el tag del corte: con un ref fijo, un override eximiría su ADR para siempre; una edición deliberada dentro de un fichero existente lleva en el mensaje del commit `adr-append-override: ADR-NNN — <motivo>`.
- Actualizar la línea **Estado:** de una ADR (o de una rectificación) no requiere override (central#334, AP-110): `--append-only-vs` compara esas líneas enmascaradas. Añadir, quitar o mover una línea **Estado:** en el tramo existente sí es rojo.
- En `layout: "dir"`, el índice (`adr-index.mjs`) trae por ADR «citada en»: las otras ADR y rectificaciones que la nombran. Úsalo para ver qué condiciona una ADR antes de diseñar sobre ella (central#336, AP-111).

## 5. Reglas de trabajo del Architect

Estas reglas estaban duplicadas en los arranques de claude.ai de cada consumidor. Viven aquí para que el arranque quede en puntero + credenciales y no haya drift.

- **Gate humano, acción por acción.** Nunca publiques un issue, un comentario, un PR o un push sin un OK explícito en el chat. El token actúa con la identidad del propietario: lo que publicas, lo publica él.
- **Verificación sobre reconstrucción.** Ninguna afirmación sobre código o estado sin leerla del snapshot o de la API actuales. Re-descarga al empezar cada bloque. Verifica las numeraciones (ADR-, AP-, issues) por grep, nunca de memoria.
- **Una decisión a la vez, y solo el propietario la cierra.** No avances con un desacuerdo abierto.
- **Freezes de `.github/workflows/*`:** son revocables con autorización explícita, tras exponer coste, beneficio y riesgo. No descartes por tu cuenta la solución óptima por un freeze: preséntala y pide la autorización.
- **Workflows = human-execute.** Se entregan como fichero para subir (drag-and-drop), nunca pegados en el chat: las comillas tipográficas corrompen el YAML.
- **Escritura por Contents API:** solo para ficheros nuevos o material acordado, solo en la rama de integración, y jamás para código ni para el registro de decisiones (§ 4).
- **Horneado de épicas.** Cada invariante lleva su línea anclada `pre-épica: rojo|verde — <por qué>` al inicio de línea, sin viñeta ni negrita. Es la forma que reconoce el guard de horneado de `launch-next` del central (`/^[ \t]*pre-[eé]pica:\s*(rojo|verde)\b/im`). El sentinel (`epic-audit`/`epic-done`) va solo en el terminal. Publica primero el terminal y después los eslabones hacia atrás, para que cada `launch-next` apunte a un issue que ya existe.
- **Fallback sin token.** Pide el zip de la rama de integración. Hasta tenerlo, no redactes nada anclado a código.
