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
- **epic-context**: cap ~2.5k tokens; racional, alternativas RECHAZADAS, trampas, correcciones del humano; no-normativo y jamás citable.
- **Test de completitud — que el Creator no tenga que inventar** <!-- arch-edit: creator-invencion 2026-07-10 --> (decisión del propietario; error recurrente: la invención del Creator/resolver es cómo entran los drifts). Antes de publicar, recorre la DoD criterio a criterio preguntando: «¿qué decisión tendría que tomar aquí el Creator?». Cada respuesta cae en exactamente una de tres casas: (a) DERIVABLE con cita verbatim de ADR/spec ⇒ deja la cita en el body; (b) NO derivable ⇒ se cierra en diseño AHORA (vuelve a Fase 2 si hace falta) o se convierte en válvula de escala explícita («si encuentras X, NO elijas: escala con el análisis»); (c) libre de verdad (naming interno, orden de implementación) ⇒ se declara libre. Un criterio sin casa = el issue NO está listo. La invención jamás es una casa.
- **Issues**: bloques estándar (tests/commits/cierre/polaridad), citas textuales del ADR, válvulas de escape en criterios no-derivables, invariantes funcionales en el sentinel de auditoría, publicación en orden inverso, pre-fire checklist antes de armar.
- **Verificación de estado al momento de escribir**, no al inicio de sesión: HEAD, numeración de ADR (grep, no memoria), cola de issues — el pipeline avanza solo (instancia real: numeración de ADR asumida con dos épicas de retraso).

## Heurísticas aprendidas (transversales)

Viven en el repo `user-context` (capa 2) — el Architect las carga al arrancar sesión y las escribe en el retro. Las heurísticas específicas del proyecto viven en las skills de capa 3 del repo.
