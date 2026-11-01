#!/usr/bin/env node
// check-mandatos — banco de las reglas de plantilla del Architect (AP-131,
// central#302/#303/#344/#369, ruling mensual 2026-11-01 posición 10).
//
// Verifica por grep literal sobre los mandatos vendorizados:
//  (a) architect.md tiene `## 9. Plantilla del issue suelto` y, dentro de esa
//      sección y en ese orden, los seis encabezados de la plantilla;
//  (b) critic.md tiene la fila `| Q |` y el veredicto «A–D, F–I, Q»;
//  (c) proceso-diseño-SKILL.md tiene los marcadores `medida-roja-rectificacion`
//      y `estado-arbol-medido`;
//  (d) architect.md §4 tiene `docs/archive/<nombre>-SKILL.md` y el fichero no
//      contiene `_archive`;
//  (e) epic-auditor.md tiene `contextos de épica cargables sin épica viva`.
// Además se ejercita a sí mismo: cada literal revertido en memoria tiene que
// poner el banco ROJO (criterio falsable de la pieza 6).
// Cuelga del piggyback de `check-embedded-js.mjs` como sus hermanos.
import { readFileSync } from 'fs';

const RUTAS = {
  architect: 'vendored/docs-agents/architect.md',
  critic: 'vendored/docs-agents/critic.md',
  auditor: 'vendored/docs-agents/epic-auditor.md',
  diseno: 'vendored/skills/proceso-diseño-SKILL.md',
};

const ENCABEZADOS = [
  '## Alcance',
  '## Cláusulas del ADR que este suelto consume',
  '## Fuente de cada magnitud mostrada',
  '## Invariantes funcionales',
  '## DoD',
  '## Contexto de decisión (no normativa)',
];

// Tramo de una sección `## <n>. …` hasta la siguiente `## <m>. …` (o el final).
function seccion(texto, cabecera) {
  const i = texto.indexOf(cabecera);
  if (i < 0) return null;
  const resto = texto.slice(i + cabecera.length);
  const j = resto.search(/^## \d+\. /m);
  return j < 0 ? resto : resto.slice(0, j);
}

function comprobar(t) {
  const fallos = [];
  const s9 = seccion(t.architect, '## 9. Plantilla del issue suelto');
  if (s9 === null) fallos.push('(a) architect.md sin `## 9. Plantilla del issue suelto`');
  else {
    let desde = 0;
    for (const h of ENCABEZADOS) {
      const k = s9.indexOf('`' + h + '`', desde);
      if (k < 0) { fallos.push(`(a) §9 sin el encabezado \`${h}\` (o fuera de orden)`); break; }
      desde = k + h.length;
    }
  }
  if (!/^\| Q \|/m.test(t.critic)) fallos.push('(b) critic.md sin la fila `| Q |`');
  if (!t.critic.includes('A–D, F–I, Q')) fallos.push('(b) critic.md sin «A–D, F–I, Q» en el veredicto');
  for (const m of ['medida-roja-rectificacion', 'estado-arbol-medido']) {
    if (!t.diseno.includes(m)) fallos.push(`(c) proceso-diseño-SKILL.md sin el marcador \`${m}\``);
  }
  const s4 = seccion(t.architect, '## 4. Registro de decisiones');
  if (s4 === null || !s4.includes('docs/archive/<nombre>-SKILL.md')) fallos.push('(d) architect.md §4 sin `docs/archive/<nombre>-SKILL.md`');
  if (t.architect.includes('_archive')) fallos.push('(d) architect.md contiene `_archive`');
  if (!t.auditor.includes('contextos de épica cargables sin épica viva')) fallos.push('(e) epic-auditor.md sin «contextos de épica cargables sin épica viva»');
  return fallos;
}

const textos = Object.fromEntries(Object.entries(RUTAS).map(([k, p]) => [k, readFileSync(p, 'utf8')]));

const reales = comprobar(textos);
if (reales.length) {
  for (const f of reales) console.error(`CHECK-MANDATOS ROJO: ${f}`);
  process.exit(1);
}

// Mutaciones: cada una revierte UN literal y tiene que dar rojo.
const MUTACIONES = [
  ['a: sin §9', t => ({ ...t, architect: t.architect.replace('## 9. Plantilla del issue suelto', '## 9. Otra cosa') })],
  ['a: sin alcance', t => ({ ...t, architect: t.architect.replace('`## Alcance`', '`## Ámbito`') })],
  ['a: sin sección de cláusulas', t => ({ ...t, architect: t.architect.replace('`## Cláusulas del ADR que este suelto consume`', '`## Cláusulas`') })],
  ['a: sin fuente de magnitudes', t => ({ ...t, architect: t.architect.replace('`## Fuente de cada magnitud mostrada`', '`## Fuentes`') })],
  ['a: sin invariantes', t => ({ ...t, architect: t.architect.replace('`## Invariantes funcionales`', '`## Invariantes`') })],
  ['a: sin DoD', t => ({ ...t, architect: t.architect.replace('`## DoD`', '`## Hecho`') })],
  ['a: sin contexto de decisión', t => ({ ...t, architect: t.architect.replace('`## Contexto de decisión (no normativa)`', '`## Contexto`') })],
  ['b: sin fila Q', t => ({ ...t, critic: t.critic.replace(/^\| Q \|/m, '| X |') })],
  ['b: veredicto sin Q', t => ({ ...t, critic: t.critic.replace('A–D, F–I, Q', 'A–D, F–I') })],
  ['c: sin medida-roja', t => ({ ...t, diseno: t.diseno.replace('medida-roja-rectificacion', 'x') })],
  ['c: sin medido', t => ({ ...t, diseno: t.diseno.replace('estado-arbol-medido', 'x') })],
  ['d: sin destino', t => ({ ...t, architect: t.architect.replace('docs/archive/<nombre>-SKILL.md', 'docs/otro') })],
  ['d: con _archive', t => ({ ...t, architect: t.architect + '\n.claude/skills/_archive/\n' })],
  ['e: sin métrica', t => ({ ...t, auditor: t.auditor.replace('contextos de épica cargables sin épica viva', 'x') })],
];
for (const [nombre, mutar] of MUTACIONES) {
  if (comprobar(mutar(textos)).length === 0) {
    console.error(`CHECK-MANDATOS ROJO: la mutación «${nombre}» no pone rojo el banco`);
    process.exit(1);
  }
}

console.log(`check-mandatos verde: 5 literales presentes y ${MUTACIONES.length} mutaciones rojas.`);
