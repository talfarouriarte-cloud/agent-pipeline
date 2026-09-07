#!/usr/bin/env node
// check-adr-lint — banco de casos EJECUTABLE de `vendored/scripts/adr-lint.mjs`
// (AP-084). El fichero es el fuente vendorizado que el graft (AP-009) sirve a
// finplan y wmcb en cada run; hasta ahora no tenía ningún banco en el central:
// la única evidencia de una regla nueva era una corrida a mano pegada en el
// body de un PR del consumidor (finplan#2009 `adr-lint-selftest.mjs`, que
// además nada invocaba). Un banco que vive fuera del árbol es disciplina sin
// consumidor.
//
// Método: se monta un corpus mínimo en un directorio temporal (índice + un
// volumen + adr-lint.config.json) y se ejecuta el lint REAL con `cwd` allí.
// Se asierta el exit code y, en rojo, el mensaje de la regla que debe morder.
// Verde: exit 0. Rojo: una regla dejó de cazar su clase (o caza lo que no debe).
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const LINT = resolve('vendored/scripts/adr-lint.mjs');
if (!existsSync(LINT)) { console.error(`check-adr-lint ROJO: no existe ${LINT}`); process.exit(1); }

// Corpus base — 3 ADRs, cada uno con las secciones que la regla 4 exige, sin
// citas atribuidas (regla 2 fuera de juego) ni deroga/rectifica (regla 3).
const adr = (n, t) => `## ADR-${n} — ${t}\n\nTexto.\n\n**Alternativas descartadas.** Ninguna.\n\n**Coste de revertir.** Bajo.\n\n---\n\n`;
const VOL = adr(1, 'Uno') + adr(2, 'Dos') + adr(3, 'Tres');
const IDX_LINES = ['- [ADR-1](docs/decisions/decisions.md#adr-1) — Uno',
                   '- [ADR-2](docs/decisions/decisions.md#adr-2) — Dos',
                   '- [ADR-3](docs/decisions/decisions.md#adr-3) — Tres'];
const CFG = { volumes: ['docs/decisions/vol.md'], index: 'decisions.md', strictFrom: 1, extraSources: [] };

function run(nombre, { vol = VOL, idx = IDX_LINES.join('\n') + '\n', cfg = CFG } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'adr-lint-bank-'));
  try {
    mkdirSync(join(dir, 'docs/decisions'), { recursive: true });
    writeFileSync(join(dir, 'docs/decisions/vol.md'), vol);
    writeFileSync(join(dir, 'decisions.md'), idx);
    writeFileSync(join(dir, 'adr-lint.config.json'), JSON.stringify(cfg));
    const r = spawnSync(process.execPath, [LINT], { cwd: dir, encoding: 'utf8' });
    return { nombre, code: r.status, out: (r.stdout || '') + (r.stderr || '') };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const casos = [
  // Control: sin él, todo caso negativo sería vacuo (un lint que siempre falla pasaría el banco).
  { r: run('control verde'), esperaCode: 0 },
  // Regla 1 (preexistente): cabecera sin entrada en el índice.
  { r: run('regla 1 · cabecera sin índice', { idx: IDX_LINES.slice(0, 2).join('\n') + '\n' }),
    esperaCode: 1, esperaMsg: 'ADR-3 sin entrada en el índice' },
  // Regla 1b (AP-084): índice conserva ADR-3, el volumen la perdió (blob stale — finplan 0e762ba).
  { r: run('regla 1b · índice sin cabecera', { vol: adr(1, 'Uno') + adr(2, 'Dos') }),
    esperaCode: 1, esperaMsg: 'ADR-3 en el índice sin cabecera en ningún volumen' },
  // Regla 1c (AP-084): la MISMA línea de entrada repetida byte a byte.
  { r: run('regla 1c · entrada duplicada', { idx: [...IDX_LINES, IDX_LINES[1]].join('\n') + '\n' }),
    esperaCode: 1, esperaMsg: 'ADR-2 duplicado en el índice' },
  // 1c NO muerde en la colisión de N con líneas distintas (finplan ADR-144, preexistente):
  // es defecto de contenido, fuera de la regla. Congela el diseño «por línea, no por N».
  { r: run('regla 1c · colisión de N con líneas distintas NO es duplicado',
           { idx: [...IDX_LINES, '- [ADR-2](docs/decisions/vol.md#adr-2-bis) — Dos (heredada)'].join('\n') + '\n' }),
    esperaCode: 0 },
  // 1b con espacios: la normalización de la entrada no debe romper la detección de la cabecera.
  { r: run('regla 1b · entrada con sangría de lista', { idx: '  - [ADR-9] — Nueve\n' + IDX_LINES.join('\n') + '\n' }),
    esperaCode: 1, esperaMsg: 'ADR-9 en el índice sin cabecera' },
];

let rojo = 0;
for (const { r, esperaCode, esperaMsg } of casos) {
  const okCode = r.code === esperaCode;
  const okMsg = !esperaMsg || r.out.includes(esperaMsg);
  if (okCode && okMsg) { console.log(`  ✔ ${r.nombre}`); continue; }
  rojo++;
  console.error(`  ✘ ${r.nombre}: exit ${r.code} (esperado ${esperaCode})${esperaMsg && !okMsg ? `, falta mensaje «${esperaMsg}»` : ''}`);
  console.error(r.out.split('\n').map(l => '      ' + l).join('\n'));
}
if (rojo) { console.error(`check-adr-lint ROJO: ${rojo}/${casos.length} casos.`); process.exit(1); }
console.log(`check-adr-lint verde: ${casos.length} casos sobre vendored/scripts/adr-lint.mjs.`);
