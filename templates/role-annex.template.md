# <rol>-annex.md — anexo de repo al mandato genérico

<!-- PLANTILLA agent-pipeline. El mandato genérico del rol llega vendorizado en
docs/agents/<rol>.md y ordena leer este anexo. Aquí vive TODO lo específico del
repo. Ejemplo de contenido para un reviewer-annex.md (adaptar por rol): -->

## Contexto del proyecto

- Qué es el producto (1-2 líneas, puntero a spec.md).
- Estructura de paquetes y qué zona es de rigor especial.

## Checks de dominio

- (ej.) En `<ruta-del-núcleo>`: primitivas puras, deterministas, con tests y
  referencia a fuente.

## Skills de estado sincronizadas

- (ej.) `.claude/skills/<estado-del-nucleo>/SKILL.md`: los PR que implementen
  ADRs de esa zona DEBEN actualizarla (fidelidad + cabecera de sync).

## Rutas UI para Visual

- (ej.) `src/components/**`, `src/app/**` — o «no aplica».

## Ficheros congelados del repo

- `.github/workflows/*` (siempre) + los propios del repo.
