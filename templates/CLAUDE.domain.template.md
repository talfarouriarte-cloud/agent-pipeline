<!-- PLANTILLA agent-pipeline: sección de DOMINIO de CLAUDE.md. La mecánica
del loop (marcadores de cierre, polaridad de PR, protocolo Creator↔Reviewer)
llega vendorizada; esta sección añade lo específico del repo. -->

## Dominio de este repo

- **Qué es**: (una frase, con puntero a spec.md).
- **Rama base**: `<rama>`. **Rama de producción**: `<rama>`.
- **Comandos**: typecheck `<cmd>`, tests de ficheros concretos `<cmd> <rutas>`
  (NUNCA la suite completa en sesión: es del CI).
- **Zonas de rigor especial**: (rutas + qué rigor aplica; espejo de spec §3).
- **Ficheros congelados** (human-execute): `.github/workflows/*` siempre;
  añadir aquí los del repo.
- **Convenciones de dominio**: (i18n, naming, unidades... o puntero a
  conventions.md).
