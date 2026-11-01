#!/usr/bin/env node
// adr-append-merge — merge mecánico de un conflicto append-only en el registro
// de decisiones (central#370, AP-130).
//
// El registro del consumidor (ADR en `layout: "dir"`, último volumen en
// `layout: "volumes"`) es append-only y tiene un único final con DOS escritores:
// el Architect (enmiendas directas a la rama base) y el Creator (bloque de
// cierre al final, en el PR). Git no fusiona dos appends al mismo final: el PR
// queda `dirty`, sin merge-ref, sin CI ni Reviewer, y hasta AP-130 lo resolvía
// una sesión LLM convocada por el modo PR-dirty del Watchdog (#370: NULO + 53
// min; 3 `watchdog-rebase` en una épica). Un conflicto entre dos appends sobre
// el mismo ancestro es mecánico por construcción: este módulo lo resuelve.
//
// Contrato (ruling mensual 2026-11-01, posición 9):
//   - la ruta del registro sale de `adr-lint.config.json` con el parser común
//     (`loadConfig` de `./adr-registro.mjs`, AP-111), nunca de una ruta fija; sin
//     ese fichero en la raíz del clon el paso NO aplica (`na: sin-config`: no se
//     usan los defaults de `normalizeConfig`);
//   - historia: commit de MERGE con dos padres (HEAD del PR y tip de
//     `origin/<base>`); sin reescritura ni force-push — el push es fast-forward;
//   - orden del contenido: ancestro + bloque de la base + bloque del PR;
//   - todo lo demás (varios conflictos, conflicto fuera del registro, edición en
//     medio, add/add, workflows en la base, error) ⇒ `git merge --abort`, árbol
//     limpio y `{ ok: false, na: <motivo> }`: el Watchdog cae al rebase LLM.
//
// CLI: `node adr-append-merge.mjs --repo <dir> --base <rama> --head <rama>`.
// Salida JSON en stdout, SIEMPRE `{ ok: true, sha, ruta }` o
// `{ ok: false, na, detalle? }`, exit 0 en ambos casos (el llamador decide).
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { loadConfig } from './adr-registro.mjs';

export const MOTIVOS = Object.freeze(['sin-config', 'workflows-en-base', 'varios-conflictos', 'fuera-del-registro', 'no-append', 'merge-error']);
export const CONFIG = 'adr-lint.config.json';

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

const ID = ['-c', 'user.name=agent-pipeline watchdog', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com'];

export function mergeAppendOnly({ repoDir, base, headRef, ap = 'AP-130' }) {
  const git = (...a) => spawnSync('git', [...ID, ...a], { cwd: repoDir, encoding: 'latin1', maxBuffer: 64 * 1024 * 1024 });
  const out = (...a) => { const r = git(...a); if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${(r.stderr || '').trim()}`); return r.stdout; };
  let enMerge = false;
  const limpiar = () => {
    if (enMerge) git('merge', '--abort');
    git('reset', '--hard', '-q');
  };
  try {
    // La config se lee del árbol del PR, tras el checkout.
    out('checkout', '-q', '-B', headRef, `origin/${headRef}`);
    if (!existsSync(join(repoDir, CONFIG))) return { ok: false, na: 'sin-config' };
    const cfg = loadConfig(join(repoDir, CONFIG));
    const mb = out('merge-base', 'HEAD', `origin/${base}`).trim();
    if (out('diff', '--name-only', mb, `origin/${base}`, '--', '.github/workflows/').trim())
      return { ok: false, na: 'workflows-en-base' };
    enMerge = true;
    const m = git('merge', '--no-ff', '--no-commit', `origin/${base}`);
    if (m.status !== 0 && m.status !== 1) { limpiar(); return { ok: false, na: 'merge-error', detalle: (m.stderr || '').trim().slice(0, 300) }; }
    const conflictos = out('diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean);
    if (conflictos.length === 0) { limpiar(); return { ok: false, na: 'merge-error', detalle: 'merge sin conflictos (el PR no está en conflicto con la base)' }; }
    if (conflictos.length > 1) { limpiar(); return { ok: false, na: 'varios-conflictos', detalle: conflictos.join(', ') }; }
    const [ruta] = conflictos;
    if (!registroPaths(cfg).test(ruta)) { limpiar(); return { ok: false, na: 'fuera-del-registro', detalle: ruta }; }
    const etapa = n => { const r = git('show', `:${n}:${ruta}`); return r.status === 0 ? r.stdout : null; };
    const res = resolverAppendOnly({ ancestro: etapa(1), ours: etapa(2), theirs: etapa(3) });
    if (res == null) { limpiar(); return { ok: false, na: 'no-append', detalle: ruta }; }
    writeFileSync(join(repoDir, ruta), Buffer.from(res, 'latin1'));
    out('add', '--', ruta);
    out('commit', '-q', '--no-edit', '-m', `merge(registro): append-only de ${ruta} (watchdog, ${ap})`);
    enMerge = false;
    return { ok: true, sha: out('rev-parse', 'HEAD').trim(), ruta };
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
