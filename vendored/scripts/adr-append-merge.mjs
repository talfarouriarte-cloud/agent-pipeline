#!/usr/bin/env node
// adr-append-merge — merge mecánico de los conflictos append-only del registro de
// decisiones (central#370, AP-130) y de inserción común en `CHANGELOG.md`
// (central#418, AP-142).
//
// El registro del consumidor (ADR en `layout: "dir"`, último volumen en
// `layout: "volumes"`) es append-only y tiene un único final con DOS escritores:
// el Architect (enmiendas directas a la rama base) y el Creator (bloque de
// cierre al final, en el PR). Git no fusiona dos appends al mismo final: el PR
// queda `dirty`, sin merge-ref, sin CI ni Reviewer, y hasta AP-130 lo resolvía
// una sesión LLM convocada por el modo PR-dirty del Watchdog (#370: NULO + 53
// min; 3 `watchdog-rebase` en una épica). Con PRs paralelos (AP-121) el conflicto
// más común es otro: dos bloques insertados en el mismo punto de un
// `CHANGELOG.md`, bajo `## [Unreleased]` (asesoramiento #3547/#3554). Los dos son
// mecánicos por construcción: este módulo los resuelve.
//
// Contrato (ruling mensual 2026-11-01, posición 9; enmendado por el de
// 2026-11-04, posición 21):
//   - ficheros admitidos: los del registro (ruta por `adr-lint.config.json` con
//     el parser común, `loadConfig` de `./adr-registro.mjs`, AP-111; nunca una
//     ruta fija ni los defaults de `normalizeConfig`) con `resolverAppendOnly`, y
//     todo `CHANGELOG.md` (`CHANGELOG_RE`) con `resolverInsercionComun`. Sin config
//     el registro es el conjunto vacío;
//   - varios ficheros en conflicto: se resuelve solo si TODOS son admitidos y
//     TODOS se resuelven; el primero que no ⇒ su motivo (`no-append` si es
//     admitido, `fuera-del-registro` con config, `sin-config` sin ella);
//   - historia: commit de MERGE con dos padres (HEAD del PR y tip de
//     `origin/<base>`); sin reescritura ni force-push — el push es fast-forward;
//   - orden del contenido: registro = ancestro + bloque de la base + bloque del
//     PR; CHANGELOG = bloque del PR encima del de la base;
//   - todo lo demás (edición en medio, add/add, workflows en la base, error) ⇒
//     `git merge --abort`, árbol limpio y `{ ok: false, na: <motivo> }`.
//
// CLI: `node adr-append-merge.mjs --repo <dir> --base <rama> --head <rama>`.
// Salida JSON en stdout, SIEMPRE `{ ok: true, sha, rutas, resueltas }` o
// `{ ok: false, na, detalle? }`, exit 0 en ambos casos (el llamador decide).
// `resueltas`: `[{ ruta, modo: 'append' | 'insercion' }]`, en el orden de `rutas`.
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { loadConfig } from './adr-registro.mjs';

// Filtro (v) del merge mecánico delante del Gate 0 (AP-142): vive en `.cjs` para
// que el scan lo cargue con `require`; aquí se reexporta.
const MM = createRequire(import.meta.url)('./merge-mecanico.cjs');
export const esContendiente = MM.esContendiente;
export const libreDeContendiente = MM.libreDeContendiente;

export const MOTIVOS = Object.freeze(['sin-config', 'workflows-en-base', 'fuera-del-registro', 'no-append', 'merge-error']);
export const CONFIG = 'adr-lint.config.json';
export const CHANGELOG_RE = /(^|\/)CHANGELOG\.md$/;
export const AP = 'AP-142';

const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Rutas del registro (relativas a la raíz del repo, separador `/`) como RegExp.
export function registroPaths(cfg) {
  if (cfg.layout === 'dir') return new RegExp(`^${escRe(cfg.dir.replace(/\/+$/, ''))}/ADR-\\d+\\.md$`);
  return new RegExp(`^(?:${cfg.volumes.map(escRe).join('|')})$`);
}

// Pura. `ancestro` null ⇒ add/add (sin etapa :1) ⇒ null. Comparación byte a
// byte: el llamador pasa cadenas `latin1` (1 carácter = 1 byte). Un bloque de la
// base sin `\n` final recibe uno antes del bloque del PR (si no, las dos
// últimas/primeras líneas se pegarían).
export function resolverAppendOnly({ ancestro, ours, theirs }) {
  if (ancestro == null || ours == null || theirs == null) return null;
  const A = ancestro === '' || ancestro.endsWith('\n') ? ancestro : ancestro + '\n';
  if (!ours.startsWith(A) || !theirs.startsWith(A)) return null;
  let base = theirs.slice(A.length);
  const pr = ours.slice(A.length);
  if (base && pr && !base.endsWith('\n')) base += '\n';
  return A + base + pr;
}

// Pura. Inserción en el mismo punto por los dos lados (AP-142). Por líneas (con su
// `\n`): P = prefijo común de las tres versiones (|P| ≤ |ancestro|); S = sufijo
// común calculado SOLO sobre lo que queda del ancestro tras P (|S| ≤ |ancestro| −
// |P|: P y S no se solapan aunque haya líneas en blanco repetidas junto a la
// inserción). Aplica si P + S === ancestro (nada del ancestro borrado ni
// cambiado): ⇒ P + X(ours, el PR) + Y(theirs, la base) + S. Si no ⇒ null.
const lineas = s => (s === '' ? [] : s.split(/(?<=\n)/));
export function resolverInsercionComun({ ancestro, ours, theirs }) {
  if (ancestro == null || ours == null || theirs == null) return null;
  const A = lineas(ancestro), O = lineas(ours), T = lineas(theirs);
  let p = 0;
  while (p < A.length && p < O.length && p < T.length && A[p] === O[p] && A[p] === T[p]) p++;
  let s = 0;
  const tope = Math.min(A.length - p, O.length - p, T.length - p);
  while (s < tope && A[A.length - 1 - s] === O[O.length - 1 - s] && A[A.length - 1 - s] === T[T.length - 1 - s]) s++;
  if (p + s !== A.length) return null;
  let X = O.slice(p, O.length - s).join('');
  const Y = T.slice(p, T.length - s).join('');
  // Con S vacío, el bloque del PR puede acabar sin `\n` (fin de fichero).
  if (X && Y && !X.endsWith('\n')) X += '\n';
  return A.slice(0, p).join('') + X + Y + A.slice(A.length - s).join('');
}

const ID = ['-c', 'user.name=agent-pipeline watchdog', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com'];

export function mergeAppendOnly({ repoDir, base, headRef, ap = AP }) {
  const git = (...a) => spawnSync('git', [...ID, ...a], { cwd: repoDir, encoding: 'latin1', maxBuffer: 64 * 1024 * 1024 });
  const out = (...a) => { const r = git(...a); if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${(r.stderr || '').trim()}`); return r.stdout; };
  let enMerge = false;
  const limpiar = () => {
    if (enMerge) git('merge', '--abort');
    git('reset', '--hard', '-q');
  };
  try {
    // La config se lee del árbol del PR, tras el checkout. Sin config el registro
    // es vacío: `sin-config` sale después de ver los conflictos (AP-142).
    out('checkout', '-q', '-B', headRef, `origin/${headRef}`);
    const hayCfg = existsSync(join(repoDir, CONFIG));
    const reg = hayCfg ? registroPaths(loadConfig(join(repoDir, CONFIG))) : null;
    const mb = out('merge-base', 'HEAD', `origin/${base}`).trim();
    if (out('diff', '--name-only', mb, `origin/${base}`, '--', '.github/workflows/').trim())
      return { ok: false, na: 'workflows-en-base' };
    enMerge = true;
    const m = git('merge', '--no-ff', '--no-commit', `origin/${base}`);
    if (m.status !== 0 && m.status !== 1) { limpiar(); return { ok: false, na: 'merge-error', detalle: (m.stderr || '').trim().slice(0, 300) }; }
    const conflictos = out('diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean);
    if (conflictos.length === 0) { limpiar(); return { ok: false, na: 'merge-error', detalle: 'merge sin conflictos (el PR no está en conflicto con la base)' }; }
    const etapa = (n, ruta) => { const r = git('show', `:${n}:${ruta}`); return r.status === 0 ? r.stdout : null; };
    const resueltas = [], contenidos = [];
    for (const ruta of conflictos) {
      const modo = reg && reg.test(ruta) ? 'append' : CHANGELOG_RE.test(ruta) ? 'insercion' : null;
      if (!modo) { limpiar(); return { ok: false, na: hayCfg ? 'fuera-del-registro' : 'sin-config', detalle: ruta }; }
      const v = { ancestro: etapa(1, ruta), ours: etapa(2, ruta), theirs: etapa(3, ruta) };
      const res = modo === 'append' ? resolverAppendOnly(v) : resolverInsercionComun(v);
      if (res == null) { limpiar(); return { ok: false, na: 'no-append', detalle: ruta }; }
      resueltas.push({ ruta, modo });
      contenidos.push(res);
    }
    resueltas.forEach(({ ruta }, i) => writeFileSync(join(repoDir, ruta), Buffer.from(contenidos[i], 'latin1')));
    out('add', '--', ...conflictos);
    out('commit', '-q', '--no-edit', '-m', `merge(registro): append-only de ${conflictos.join(', ')} (watchdog, ${ap})`);
    enMerge = false;
    return { ok: true, sha: out('rev-parse', 'HEAD').trim(), rutas: conflictos, resueltas };
  } catch (e) {
    try { limpiar(); } catch { /* el árbol lo descarta el runner */ }
    return { ok: false, na: 'merge-error', detalle: String(e.message || e).slice(0, 300) };
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = k => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
  let r;
  try {
    const repoDir = arg('repo'), base = arg('base'), headRef = arg('head');
    r = repoDir && base && headRef
      ? mergeAppendOnly({ repoDir, base, headRef })
      : { ok: false, na: 'merge-error', detalle: 'uso: --repo <dir> --base <rama> --head <rama>' };
  } catch (e) { r = { ok: false, na: 'merge-error', detalle: String(e.message || e).slice(0, 300) }; }
  process.stdout.write(JSON.stringify(r) + '\n');
}
