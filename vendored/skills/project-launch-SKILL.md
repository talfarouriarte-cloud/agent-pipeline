<!-- synced from agent-pipeline@v1 — DO NOT EDIT locally; changes arrive as sync PRs -->

---
name: project-launch
description: Protocolo de génesis de proyecto del Architect. Cargar cuando el propietario pide dar de alta un repo nuevo (o migrar uno existente) al pipeline de agentes. Ejecuta por elicitación en sesión el contrato del consumidor de MIGRATION.md — el doc es el QUÉ; esta skill es el CÓMO.
---

# project-launch — génesis de proyecto por elicitación

**Regla madre (heredada de proceso-diseño): UN TEMA A LA VEZ.** Cada fase se
cierra explícitamente antes de abrir la siguiente; cierra el propietario, no
el Architect. Prohibido rellenar plantillas «por él»: el Architect PREGUNTA,
reformula, confirma y REDACTA — no inventa contenido de dominio.

**Prerequisito de arranque**: cargar la capa 2 (`user-context`) ANTES de la
primera pregunta — el proyecto nuevo hereda las preferencias del propietario
desde el minuto uno. Verificar que el PAT alcanza el repo nuevo Y user-context;
si no, parar y pedirlo.

## Fase 1 — Entrevista de spec

Objetivo: `spec.md` citable. El listón NO es estético: resolver-protocol define
derivabilidad como cita verbatim de ADR/spec — cada sección debe poder
responder «¿debe X comportarse como Y?» con una cita literal. Una spec vaga =
todo escala.

- Elicitar por secciones de la plantilla (visión → principios → stack/zonas de
  rigor → fronteras), una a una, reformulando en términos del propietario y
  confirmando antes de redactar.
- Test de salida por sección: el Architect enuncia 2-3 preguntas que un Creator
  haría a mitad de implementación y verifica que la sección las responde con
  cita. Si no, la sección no está cerrada.

## Fase 2 — ADRs fundacionales

- ADR-001 (fundación) + un ADR por decisión de arranque con compromiso futuro
  (plataforma, persistencia, esquema de datos, i18n/moneda, concurrencia —
  antipatrones (b) de architect.md §decisiones-con-compromiso): coste de
  revertir explícito y bloque verbatim del propietario.
- `node scripts/adr-lint.mjs` VERDE antes de dar la fase por cerrada.

## Fase 3 — Estructura del repo

- Copiar vendored/ y plantillas a su sitio (árbol de MIGRATION.md §A2);
  instanciar pipeline-map con los parámetros elegidos; redactar CLAUDE.md de
  dominio y los anexos de rol CON el propietario (los anexos son contrato del
  Reviewer/Creator: mismas reglas de cierre que la spec).

## Fase 4 — Alta operativa

- CI propio (sin suite ⇒ typecheck-only, pero el job DEBE materializar
  `ci-verde`); labels desde templates/labels.json; secrets (OAuth, ARM_TOKEN,
  PAT); stubs anclados a tag con los inputs de la instancia.
- Checklist mecánico antes de dar por cerrada la fase: cada input de cada stub
  verificado contra la realidad del repo (nombre del job de CI, rama, label).

## Fase 5 — Épica de rodaje

- Diseñar UNA épica pequeña (2 issues) que ejercite la cadena completa:
  issue → PR → veredicto → merge → launch-next → auditoría con invariantes.
  Sus invariantes funcionales SON la validación del alta.
- Gate de salida: rodaje verde de punta a punta + verificación visual del
  propietario. Solo entonces el repo entra en régimen normal.

## Registro

Al cerrar, el Architect registra el alta como ADR en el repo nuevo (parámetros
de instancia, tag anclado, desviaciones del contrato) y actualiza la instancia
de pipeline-map. Las correcciones del propietario durante la génesis van al
retro (capa 2 si son transversales).
