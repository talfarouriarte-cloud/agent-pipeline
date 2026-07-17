<!-- synced from agent-pipeline@v1 — DO NOT EDIT locally; changes arrive as sync PRs -->
<!-- Los ejemplos históricos citan el repo de origen (finplan): son lecciones con evidencia, no normas de este repo. -->

---
name: proceso-diseño
description: Protocolo operativo de las sesiones de diseño Architect↔propietario, de exploración a ADR. Carga OBLIGATORIA al arrancar toda sesión de diseño (junto a las skills de contexto del proyecto y de estado del núcleo que declare el repo). Origen: los fallos de diseño de la etapa 2026-07-08/10 (R·3, menús en lote, normativizar sin cerrar). Mantenimiento: retro del Architect, marcador arch-edit.
---

# Proceso de diseño — protocolo de sesión

**Regla madre — UN TEMA A LA VEZ (decisión del propietario, verbatim: «es importante que trabajemos y confirmes los temas uno a uno»):** cada tema se explora, se concreta y se CIERRA explícitamente antes de abrir el siguiente. PROHIBIDO: menús de decisiones en paralelo, «defaults 1-N para veto en lote» (instancia real: 4 fijaciones enumeradas de golpe en R·3 — dos iban mal y el lote dificultó cazarlas), avanzar con cualquier desacuerdo abierto. Solo el propietario cierra un tema.

## Fase 1 — Exploración

- **Su marco primero.** Antes de enumerar opciones o alternativas, preguntar/escuchar el frame del propietario: las opciones del Architect contaminan la exploración (instancia: el menú «dos lecturas» cuando la suya era una tercera). Si él trae la pregunta, la primera tarea es entender su modelo, no proponer.
- **Anclaje académico como continuación natural.** La exploración se apoya y CONTINÚA en la literatura del proyecto (la declara spec.md / el anexo del repo) y en material externo pertinente (papers pertinentes al dominio), contrastando contra ella — no solo contra el razonamiento propio del Architect. Citar con fuente; si no se ha leído, decirlo y ofrecer buscarlo.
- **Challenge con base**: desacuerdo razonado, contraejemplos, riesgos — sin validación de relleno. Distinguir siempre sabido / inferido / desconocido.
- **Gate de salida**: el propietario cierra el marco EXPLÍCITAMENTE. Un «creo que» del Architect no es un cierre.

## Fase 2 — Concreción

- **Reformulación confirmada** (regla de ADR-206·R·4): el Architect reformula el framework EN TÉRMINOS DEL PROPIETARIO y este confirma o corrige ANTES de que nada se normativice. Una reformulación no confirmada que llega a un ADR es la clase de fallo más cara del sistema.
- **Fronteras como preguntas, una a una**: qué entra y qué no (las fronteras concretas del tema) se pregunta, no se asume — y se cierra cada frontera antes de abrir la siguiente. Ojo al patrón: si la pregunta enumera componentes, sospechar que el marco correcto vive un nivel de agregación más arriba (lección: agregación).
- **Dimensionado** con la heurística dura de partición (architect.md, criterios a-d) ANTES de prometer nada sobre nº de issues.
- **Gate de salida**: enumeración completa de lo que se va a escribir (ADR, rectificaciones, cierres, cadena de issues, destino de lo ya construido) y OK explícito del propietario a ESA enumeración.

## Fase 3 — Redacción

- **ADR**: citas VERBATIM grep-existentes (adr-lint verde antes de commitear — regla dura), bloque de decisión del propietario con sus palabras, alternativas descartadas con el porqué, coste de revertir. Las rectificaciones registran qué derogan y qué restauran.
- **Auto-consistencia de A-clauses (ADR cuantitativo)** <!-- arch-edit: auto-consistencia-aclauses ADR-225 2026-07-17 -->: antes de publicar, cada aserción ejecutable (A-clause) se RE-DERIVA de la cláusula definitoria del MISMO ADR y se cita al lado (patrón «A4 se deriva de D5 §…»). Si el valor de la aserción no sale VERBATIM de la definición autoritativa, es defecto de publicación — no se publica. `adr-lint` es sintáctico y NO caza esto. (Instancia: el «`0` en año 0» de ADR-225 §A4 contradecía su propia apertura `unidades_pendientes × precio_path` pre-vest y a §D5; llegó a implementación y lo cazó el Reviewer como bloqueante universal-strict en PR #1435 — una ronda REVIEW + rectificación de ADR in-flight.)
- **epic-context**: cap ~2.5k tokens; racional, alternativas RECHAZADAS, trampas, correcciones del humano; no-normativo y jamás citable.
- **Test de completitud — que el Creator no tenga que inventar** <!-- arch-edit: creator-invencion 2026-07-10 --> (decisión del propietario; error recurrente: la invención del Creator/resolver es cómo entran los drifts). Antes de publicar, recorre la DoD criterio a criterio preguntando: «¿qué decisión tendría que tomar aquí el Creator?». Cada respuesta cae en exactamente una de tres casas: (a) DERIVABLE con cita verbatim de ADR/spec ⇒ deja la cita en el body; (b) NO derivable ⇒ se cierra en diseño AHORA (vuelve a Fase 2 si hace falta) o se convierte en válvula de escala explícita («si encuentras X, NO elijas: escala con el análisis»); (c) libre de verdad (naming interno, orden de implementación) ⇒ se declara libre. Un criterio sin casa = el issue NO está listo. La invención jamás es una casa.
- **Issues**: bloques estándar (tests/commits/cierre/polaridad), citas textuales del ADR, válvulas de escape en criterios no-derivables, invariantes funcionales en el sentinel de auditoría, publicación en orden inverso, pre-fire checklist antes de armar.
- **Dry-run de invariantes** <!-- arch-edit: dry-run-invariantes ADR-224 2026-07-17 -->: cada invariante funcional de la épica se EJECUTA contra el árbol ACTUAL antes de hornearlo en el sentinel, declarando el resultado esperado pre-épica (p. ej. «rojo por ausencia; quedará verde con `npx vitest run <ruta>`»). Ese resultado esperado se MATERIALIZA junto al invariante en el bloque del sentinel de auditoría —estado declarado y consumible por el Auditor, no memoria de sesión— cerrando AP-008 §1-2; no es mecanizable en `adr-lint`/CI porque exige conocer el árbol pre-épica y el veredicto esperado, contexto que solo tiene el Architect al redactar. Los invariantes tipo grep llevan por defecto el filtro de código VIVO —excluir comentarios y `.test.`— salvo declaración explícita en contra. (Instancia: los invariantes 1-2 de la épica #1414 —grep crudo sin el calificador «referencias vivas»— daban falso-rojo porque los propios comentarios de demolición ya devolvían no-cero ANTES de la épica; el Auditor tuvo que re-derivar el filtro a mano.)
- **Verificación de estado al momento de escribir**, no al inicio de sesión: HEAD, numeración de ADR (grep, no memoria), cola de issues — el pipeline avanza solo (instancia real: numeración de ADR asumida con dos épicas de retraso).

## Heurísticas aprendidas (transversales)

Viven en el repo `user-context` (capa 2) — el Architect las carga al arrancar sesión y las escribe en el retro. Las heurísticas específicas del proyecto viven en las skills de capa 3 del repo.
