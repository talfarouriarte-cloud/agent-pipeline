#!/usr/bin/env node
// related-tests — tests relacionados del head, en sesión, con marcador por SHA
// (AP-148, central#437, ruling mensual 2026-11-08 posición 26 + enmienda de las
// 10:39).
//
// Antes, «tests afectados» lo decidía el Creator a ojo y no quedaba rastro de qué
// corrió ni sobre qué SHA: en finplan (2026-11-04..08) el 23 % de los PRs llegó
// al CI con tests rojos deterministas, 9 de ellos en un test que el propio PR
// había tocado. Este script hace la selección mecánica y deja la evidencia:
//
//  1. Cambiados: `git diff --name-only <merge-base>..HEAD` contra la rama base,
//     repartidos por los paquetes de `.claude/related-tests.json`:
//       [{ "dir": "packages/app", "runner": "npx vitest run",
//          "tests": "src/**/*.test.{ts,tsx}" }, …]
//  2. Selección determinista (sin ejecutar nada): (i) los tests cambiados;
//     (ii) los tests que importan, directa o transitivamente, un cambiado del
//     mismo paquete. Grafo por escaneo estático de `import … from`, `import(…)`
//     y `export … from` con rutas relativas y alias de `tsconfig.json` `paths`.
//     Un import que no se resuelve se ignora.
//  3. Tope de 60 tests por paquete: (i) entero siempre; luego los directos y
//     después los transitivos, cada grupo por ruta ascendente, hasta 60. El
//     resto se declara (lo cubre el CI). (i) > 60 ⇒ `tope-superado-por-diff`.
//  4. Ejecuta el `runner` del paquete como subproceso, en lotes de 25 rutas,
//     con un timeout total de 8 min (por debajo de los 10 de la herramienta Bash).
//  5. Publica UN comentario por PR y lo edita (`PATCH`) en cada ejecución. Su
//     cuerpo empieza por `<!-- related-tests`: el cap de comentarios y el
//     Auto-label de `claude-code.yml` lo excluyen (`isRelatedTests`).
//
// Uso (Creator, herramienta Bash con `timeout: 600000`):
//   node scripts/related-tests.mjs [--base <rama>] [--pr <n>] [--no-publish]
// Salida: la línea del marcador por stdout; exit 1 solo con `rojo`.
// Banco: `scripts/check-related-tests.mjs`.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CONFIG = '.claude/related-tests.json';
export const TOPE = 60;
export const LOTE = 25;
export const TIMEOUT_MS = 8 * 60 * 1000;
export const NOTA_TOPE = 'tope-superado-por-diff';
const EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const SALTAR = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.turbo']);
const MAX_LISTA = 400;   // líneas por lista en el comentario (límite de 65 536 caracteres)

// Prefijo del cuerpo: el mismo predicado vive en `claude-code.yml` (cap y Auto-label).
export const PREFIJO = '<!-- related-tests';
export const isRelatedTests = (body) => String(body ?? '').trimStart().startsWith(PREFIJO);
export const MARCA_RE = /^<!-- related-tests: ([0-9a-f]{40}) (verde|rojo|tiempo-agotado|sin-config) ejecutados=(\d+) declarados=(\d+)( tope-superado-por-diff)? -->$/m;
export const marcador = ({ sha, resultado, ejecutados, declarados, tope = false }) =>
  `<!-- related-tests: ${sha} ${resultado} ejecutados=${ejecutados} declarados=${declarados}${tope ? ` ${NOTA_TOPE}` : ''} -->`;

// ── Glob mínimo: `**`, `*`, `?` y `{a,b}` (los que usan los configs de vitest).
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const fin = glob.indexOf('}', i);
      re += `(?:${glob.slice(i + 1, fin).split(',').map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|')})`;
      i = fin;
    } else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

// ── (a)/(b) Reparto de cambiados por paquete; rutas relativas al paquete.
export function repartir(cambiados, config) {
  return config.map((p) => {
    const dir = p.dir.replace(/\/+$/, '');
    const pre = dir === '' || dir === '.' ? '' : `${dir}/`;
    return { ...p, dir, cambiados: cambiados.filter((f) => f.startsWith(pre)).map((f) => f.slice(pre.length)).sort() };
  });
}

// ── Grafo de imports estático del paquete.
const ESPECIFICADORES = [
  /\b(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s+['"]([^'"]+)['"]/g,
];
export function especificadores(src) {
  const out = new Set();
  for (const re of ESPECIFICADORES) for (const m of src.matchAll(re)) out.add(m[1]);
  return [...out];
}

function listar(raiz) {
  const out = [];
  const pasear = (rel) => {
    let entradas;
    try { entradas = readdirSync(join(raiz, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entradas) {
      if (SALTAR.has(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) pasear(r);
      else if (e.isFile() && EXTS.some((x) => e.name.endsWith(x))) out.push(r);
    }
  };
  pasear('');
  return out.sort();
}

function leerJsonc(ruta) {
  try {
    const txt = readFileSync(ruta, 'utf8')
      .replace(/("(?:\\.|[^"\\])*")|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m, s) => s ?? '')
      .replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(txt);
  } catch { return null; }
}

// Alias de `compilerOptions.paths` (relativos a `baseUrl`, o al tsconfig si no hay).
export function aliases(raiz) {
  const tc = leerJsonc(join(raiz, 'tsconfig.json'));
  const co = tc?.compilerOptions ?? {};
  const base = posix.normalize(co.baseUrl ?? '.');
  return Object.entries(co.paths ?? {}).map(([patron, destinos]) => ({
    patron,
    destinos: (destinos ?? []).map((d) => posix.normalize(posix.join(base, d))),
  }));
}

function resolverFichero(rel, existe) {
  const cands = [rel, ...EXTS.map((x) => rel + x), ...EXTS.map((x) => `${rel}/index${x}`)];
  const js = rel.match(/^(.*)\.(m|c)?jsx?$/);   // ESM de TS: `./a.js` apunta a `./a.ts`
  if (js) cands.push(...['.ts', '.tsx', '.mts', '.cts'].map((x) => js[1] + x));
  return cands.find((c) => existe.has(c)) ?? null;
}

export function resolver(desde, spec, existe, alias) {
  if (spec.startsWith('./') || spec.startsWith('../')) {
    const rel = posix.normalize(posix.join(posix.dirname(desde), spec));
    return rel.startsWith('../') ? null : resolverFichero(rel, existe);
  }
  for (const { patron, destinos } of alias) {
    const comodin = patron.indexOf('*');
    let resto = null;
    if (comodin < 0) { if (spec === patron) resto = ''; }
    else if (spec.startsWith(patron.slice(0, comodin)) && spec.endsWith(patron.slice(comodin + 1))) {
      resto = spec.slice(comodin, spec.length - (patron.length - comodin - 1));
    }
    if (resto === null) continue;
    for (const d of destinos) {
      const hit = resolverFichero(posix.normalize(d.replace('*', resto)), existe);
      if (hit) return hit;
    }
  }
  return null;
}

// `leer(rel)` devuelve el fuente; `ficheros` son las rutas relativas al paquete.
export function grafoInverso(ficheros, leer, alias) {
  const existe = new Set(ficheros);
  const inv = new Map();
  for (const f of ficheros) {
    let src;
    try { src = leer(f); } catch { continue; }
    for (const spec of especificadores(src)) {
      const dst = resolver(f, spec, existe, alias);
      if (!dst || dst === f) continue;
      if (!inv.has(dst)) inv.set(dst, new Set());
      inv.get(dst).add(f);
    }
  }
  return inv;
}

// ── Selección con tope. Devuelve {ejecutar, declarar, delDiff, tope}.
export function seleccionar({ cambiados, ficheros, esTest, inv, tope = TOPE }) {
  const existe = new Set(ficheros);
  const delDiff = cambiados.filter((f) => existe.has(f) && esTest(f)).sort();
  const enDiff = new Set(delDiff);
  // BFS inverso desde los cambiados: distancia 1 = importador directo.
  const dist = new Map();
  let frente = cambiados.filter((f) => existe.has(f));
  for (const f of frente) dist.set(f, 0);
  for (let d = 1; frente.length; d++) {
    const sig = [];
    for (const f of frente) for (const imp of inv.get(f) ?? []) {
      if (!dist.has(imp)) { dist.set(imp, d); sig.push(imp); }
    }
    frente = sig;
  }
  const relacionados = [...dist].filter(([f, d]) => d > 0 && esTest(f) && !enDiff.has(f));
  const directos = relacionados.filter(([, d]) => d === 1).map(([f]) => f).sort();
  const transitivos = relacionados.filter(([, d]) => d > 1).map(([f]) => f).sort();
  const hueco = Math.max(0, tope - delDiff.length);
  const resto = [...directos, ...transitivos];
  return {
    ejecutar: [...delDiff, ...resto.slice(0, hueco)],
    declarar: resto.slice(hueco).sort(),
    delDiff,
    tope: delDiff.length > tope,
  };
}

// ── Ejecución: un subproceso por lote, con plazo común.
const citar = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
export function ejecutarLote(cmd, cwd, plazoMs) {
  return new Promise((res) => {
    if (plazoMs <= 0) return res({ code: null, salida: '', agotado: true });
    const hijo = spawn(cmd, { cwd, shell: true, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let salida = '';
    let agotado = false;
    const acumular = (b) => { salida += b; if (salida.length > 2_000_000) salida = salida.slice(-1_000_000); };
    hijo.stdout.on('data', acumular);
    hijo.stderr.on('data', acumular);
    const t = setTimeout(() => {
      agotado = true;
      try { process.kill(-hijo.pid, 'SIGKILL'); } catch { try { hijo.kill('SIGKILL'); } catch { /* ya muerto */ } }
    }, plazoMs);
    hijo.on('close', (code) => { clearTimeout(t); res({ code, salida, agotado }); });
    hijo.on('error', (e) => { clearTimeout(t); res({ code: 127, salida: String(e.message), agotado }); });
  });
}

// Ficheros que fallan según la salida del runner (`FAIL  <ruta>` de vitest/jest);
// sin coincidencias, el lote entero.
export function fallidos(lote, salida) {
  const limpia = salida.replace(/\x1b\[[0-9;]*m/g, '');
  const vistos = new Set();
  for (const m of limpia.matchAll(/^\s*(?:FAIL|×|✗)\s+(\S+)/gm)) vistos.add(m[1].replace(/^\.\//, ''));
  const hit = lote.filter((f) => [...vistos].some((v) => v === f || v.endsWith(`/${f}`) || f.endsWith(`/${v}`)));
  return hit.length ? hit : lote;
}

// ── Núcleo. `exec` y `cambiados` son inyectables para el banco.
export async function relatedTests({ cwd = process.cwd(), cambiados, timeoutMs = TIMEOUT_MS, exec = ejecutarLote, log = () => {} } = {}) {
  const rutaConfig = join(cwd, CONFIG);
  if (!existsSync(rutaConfig)) return { resultado: 'sin-config', paquetes: [], ejecutados: 0, declarados: 0, tope: false, rojos: [] };
  const config = JSON.parse(readFileSync(rutaConfig, 'utf8'));
  if (!Array.isArray(config)) throw new Error(`${CONFIG} no es un array de paquetes`);
  const inicio = Date.now();
  const paquetes = [];
  let agotado = false;
  for (const p of repartir(cambiados, config)) {
    if (!p.cambiados.length) { paquetes.push({ ...p, omitido: true, ejecutar: [], declarar: [], delDiff: [], rojos: [], tope: false }); continue; }
    const raiz = resolve(cwd, p.dir || '.');
    const ficheros = listar(raiz);
    const re = globToRegExp(p.tests);
    const inv = grafoInverso(ficheros, (f) => readFileSync(join(raiz, f), 'utf8'), aliases(raiz));
    const sel = seleccionar({ cambiados: p.cambiados, ficheros, esTest: (f) => re.test(f), inv });
    const rojos = [];
    const hechos = [];
    for (let i = 0; i < sel.ejecutar.length && !agotado; i += LOTE) {
      const lote = sel.ejecutar.slice(i, i + LOTE);
      const r = await exec(`${p.runner} ${lote.map(citar).join(' ')}`, raiz, timeoutMs - (Date.now() - inicio));
      if (r.agotado) { agotado = true; break; }
      hechos.push(...lote);
      if (r.code !== 0) {
        rojos.push(...fallidos(lote, r.salida).map((f) => posix.join(p.dir, f)));
        log(r.salida.split('\n').slice(-200).join('\n'));
      }
    }
    paquetes.push({ ...p, ...sel, hechos, rojos });
  }
  const rojos = paquetes.flatMap((p) => p.rojos);
  const ejecutados = paquetes.reduce((n, p) => n + (p.hechos?.length ?? 0), 0);
  const declarados = paquetes.reduce((n, p) => n + p.declarar.length + (p.ejecutar.length - (p.hechos?.length ?? p.ejecutar.length)), 0);
  const resultado = rojos.length ? 'rojo' : agotado ? 'tiempo-agotado' : 'verde';
  return { resultado, paquetes, ejecutados, declarados, tope: paquetes.some((p) => p.tope), rojos };
}

// ── Cuerpo del comentario.
const lista = (titulo, xs) => {
  const vis = xs.slice(0, MAX_LISTA).map((x) => `- \`${x}\``);
  if (xs.length > MAX_LISTA) vis.push(`- … y ${xs.length - MAX_LISTA} más`);
  return `<details><summary>${titulo} (${xs.length})</summary>\n\n${vis.join('\n') || '_ninguno_'}\n\n</details>`;
};
export function cuerpo(sha, r) {
  const lineas = [marcador({ sha, ...r }), '', `**related-tests** · head \`${sha.slice(0, 12)}\` · **${r.resultado}**${r.tope ? ` · ${NOTA_TOPE}` : ''} (AP-148)`, ''];
  if (r.resultado === 'sin-config') lineas.push(`Sin \`${CONFIG}\`: no se ejecuta nada (el repo no ha adoptado el gate).`);
  if (r.rojos.length) lineas.push('Fallan:', ...r.rojos.map((f) => `- \`${f}\``), '');
  if (r.resultado === 'tiempo-agotado') lineas.push('El plazo de 8 min venció: los no ejecutados cuentan como declarados.', '');
  for (const p of r.paquetes) {
    const pre = (f) => posix.join(p.dir, f);
    lineas.push(`#### \`${p.dir || '.'}\`${p.omitido ? ' — sin cambiados, no se ejecuta' : ''}`);
    if (p.omitido) continue;
    const noHechos = p.ejecutar.filter((f) => !p.hechos.includes(f));
    lineas.push(lista('ejecutados', p.hechos.map(pre)), lista('declarados (los cubre el CI)', [...noHechos, ...p.declarar].map(pre)), lista('tests del diff', p.delDiff.map(pre)), '');
  }
  return lineas.join('\n');
}

// ── (i) Publicación: un único comentario por PR; PATCH si ya existe.
export async function publicar({ pr, body, api }) {
  const comentarios = await api('GET', `repos/{owner}/{repo}/issues/${pr}/comments?per_page=100`, null, true);
  const previo = comentarios.find((c) => isRelatedTests(c.body));
  if (previo) {
    await api('PATCH', `repos/{owner}/{repo}/issues/comments/${previo.id}`, { body });
    return { metodo: 'PATCH', id: previo.id };
  }
  const nuevo = await api('POST', `repos/{owner}/{repo}/issues/${pr}/comments`, { body });
  return { metodo: 'POST', id: nuevo?.id };
}

function apiGh(metodo, ruta, datos, paginar = false) {
  const args = ['api', '-X', metodo, ruta];
  if (paginar) args.push('--paginate', '--slurp');
  if (datos) args.push('--input', '-');
  const out = execFileSync('gh', args, { input: datos ? JSON.stringify(datos) : undefined, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const j = out.trim() ? JSON.parse(out) : null;
  return paginar ? j.flat() : j;
}

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

function args(argv) {
  const o = { publicar: true };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') o.base = argv[++i];
    else if (argv[i] === '--pr') o.pr = argv[++i];
    else if (argv[i] === '--no-publish') o.publicar = false;
    else if (argv[i] === '--timeout-ms') o.timeoutMs = Number(argv[++i]);
  }
  return o;
}

async function main() {
  const o = args(process.argv.slice(2));
  const raiz = git('rev-parse', '--show-toplevel');
  process.chdir(raiz);
  const sha = git('rev-parse', 'HEAD');
  let pr = o.pr;
  let base = o.base;
  if (!pr || !base) {
    try {
      const v = JSON.parse(execFileSync('gh', ['pr', 'view', '--json', 'number,baseRefName'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
      pr ??= String(v.number); base ??= v.baseRefName;
    } catch { /* sin PR todavía */ }
  }
  base ??= 'main';
  try {
    if (git('rev-parse', '@{u}') !== sha) console.error('related-tests: aviso — el head no está pusheado; el marcador será de un SHA que el PR no tiene (AP-089: push antes de verificar).');
  } catch { /* sin upstream */ }
  let cambiados = [];
  if (existsSync(join(raiz, CONFIG))) {
    try { git('fetch', '--quiet', 'origin', base); } catch { /* fail-open: el ref local puede bastar */ }
    const mb = git('merge-base', 'HEAD', `origin/${base}`);
    cambiados = git('diff', '--name-only', '--diff-filter=ACMR', mb, 'HEAD').split('\n').filter(Boolean);
  }
  const r = await relatedTests({ cwd: raiz, cambiados, timeoutMs: o.timeoutMs || Number(process.env.RELATED_TESTS_TIMEOUT_MS) || TIMEOUT_MS, log: (s) => console.error(s) });
  const body = cuerpo(sha, r);
  if (o.publicar && pr) {
    try {
      const p = await publicar({ pr, body, api: apiGh });
      console.error(`related-tests: comentario ${p.metodo === 'PATCH' ? 'editado' : 'creado'} en el PR #${pr} (id ${p.id}).`);
    } catch (e) { console.error(`related-tests: no se pudo publicar en el PR #${pr} (${e.message.split('\n')[0]}). Pega el marcador a mano.`); }
  } else if (o.publicar) console.error('related-tests: sin PR para esta rama — no se publica (ejecútalo tras abrir el draft).');
  if (r.rojos.length) console.error(`related-tests: ROJO — ${r.rojos.join(', ')}`);
  console.log(marcador({ sha, ...r }));
  process.exit(r.resultado === 'rojo' ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(`related-tests: ${e.message}`); process.exit(2); });
}
