#!/usr/bin/env node
// check-sync-labels — banco de `sync-labels.mjs` (AP-132, central#319) contra
// un DOBLE de `fetch` que guarda las labels por repo y registra cada llamada.
// Casos del ruling: (a) crear, (b) alinear, (c) idempotencia, (d) labels
// ajenas intactas + ninguna llamada de borrado en el fuente, (e) sin token
// no-op, (f) descripción > 100 ⇒ exit 1 sin llamadas, (g) paginación.
// Los recuentos son POR REPO: el banco inyecta un único repo salvo en (h),
// que comprueba los tres de `REPOS`.
//
// Cuelga del piggyback de `check-embedded-js.mjs`.
import { readFileSync } from 'fs';
import { plan, main, REPOS } from './sync-labels.mjs';

const fallos = [];
let casos = 0;
const R = 'o/r';
const TOKEN = { LABELS_SYNC_TOKEN: 't' };

function doble(estado = {}) {
  const repos = Object.fromEntries(Object.entries(estado).map(([r, ls]) => [r, ls.map(l => ({ ...l }))]));
  const llamadas = [];
  const fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const u = new URL(url);
    llamadas.push({ method, path: u.pathname + u.search, body: opts.body ? JSON.parse(opts.body) : null });
    const m = u.pathname.match(/^\/repos\/([^/]+\/[^/]+)\/labels(?:\/(.+))?$/);
    if (!m) return { ok: false, status: 404, json: async () => ({}) };
    const ls = (repos[m[1]] ||= []);
    let data = {};
    if (method === 'GET') {
      const page = Number(u.searchParams.get('page') || 1), per = Number(u.searchParams.get('per_page') || 30);
      data = ls.slice((page - 1) * per, page * per);
    } else if (method === 'POST') {
      ls.push(JSON.parse(opts.body));
    } else if (method === 'PATCH') {
      const l = ls.find(x => x.name === decodeURIComponent(m[2]));
      if (!l) return { ok: false, status: 404, json: async () => ({}) };
      Object.assign(l, JSON.parse(opts.body));
    } else {
      ls.splice(0, ls.length);   // cualquier otro método (un borrado) destruye el estado: el banco lo ve
    }
    return { ok: true, status: 200, json: async () => data };
  };
  const escrituras = () => llamadas.filter(c => c.method !== 'GET');
  return { fetch, llamadas, escrituras, repos };
}

async function correr(d, { template, env = TOKEN, repos = [R] } = {}) {
  const lines = [];
  const code = await main({ fetch: d.fetch, env, repos, template, log: l => lines.push(l) });
  return { code, lines };
}

function caso(nombre, ok, detalle = '') {
  casos++;
  if (!ok) fallos.push(`${nombre}${detalle ? ` — ${detalle}` : ''}`);
}

const A = { name: 'A', color: 'd93f0b', description: 'una label' };

// (a) repo vacío ⇒ create A, 1 POST
{
  const p = plan([A], []);
  caso('(a) plan', JSON.stringify(p) === JSON.stringify([{ op: 'create', name: 'A', color: 'd93f0b', description: 'una label' }]), JSON.stringify(p));
  const d = doble({ [R]: [] });
  const r = await correr(d, { template: [A] });
  const w = d.escrituras();
  caso('(a) 1 POST', r.code === 0 && w.length === 1 && w[0].method === 'POST' && w[0].body.name === 'A' && w[0].body.color === 'd93f0b', JSON.stringify(w));
  caso('(a) resumen', r.lines.includes(`${R}: 1 create, 0 update, 0 sin cambio`), r.lines.join(' | '));
  // (c) idempotencia: segunda corrida sobre el estado resultante ⇒ 0 escrituras
  const antes = d.llamadas.length;
  const r2 = await correr(d, { template: [A] });
  caso('(c) segunda corrida sin escrituras', r2.code === 0 && d.llamadas.slice(antes).every(c => c.method === 'GET'));
  caso('(c) resumen 0/0', r2.lines.includes(`${R}: 0 create, 0 update, 1 sin cambio`), r2.lines.join(' | '));
}

// (b) A con otro color / otra descripción ⇒ update A, 1 PATCH con los campos de la plantilla
for (const [k, e] of [['color', { ...A, color: 'ededed' }], ['descripción', { ...A, description: '' }], ['descripción null', { ...A, description: null }]]) {
  const p = plan([A], [e]);
  caso(`(b) plan ${k}`, p.length === 1 && p[0].op === 'update', JSON.stringify(p));
  const d = doble({ [R]: [e] });
  const r = await correr(d, { template: [A] });
  const w = d.escrituras();
  caso(`(b) 1 PATCH ${k}`, r.code === 0 && w.length === 1 && w[0].method === 'PATCH'
    && w[0].path === `/repos/${R}/labels/A` && w[0].body.color === A.color && w[0].body.description === A.description, JSON.stringify(w));
}
// (b') nombre con «:» ⇒ PATCH con el nombre codificado
{
  const t = { name: 'prioridad:alta', color: 'd93f0b', description: 'x' };
  const d = doble({ [R]: [{ ...t, color: 'ffffff' }] });
  await correr(d, { template: [t] });
  caso("(b') PATCH codificado", d.escrituras()[0]?.path === `/repos/${R}/labels/prioridad%3Aalta` && d.repos[R][0].color === 'd93f0b');
}

// (c) A idéntica (color con «#» y mayúsculas incluido) ⇒ plan [], 0 escrituras
{
  caso('(c) plan idéntica', plan([A], [{ ...A }]).length === 0);
  caso('(c) plan color normalizado', plan([A], [{ ...A, color: '#D93F0B' }]).length === 0);
  const d = doble({ [R]: [{ ...A }] });
  const r = await correr(d, { template: [A] });
  caso('(c) 0 escrituras', r.code === 0 && d.escrituras().length === 0);
}

// (d) labels ajenas (dinámicas) ⇒ intactas; el fuente no tiene ningún borrado
{
  const ajenas = [{ name: 'estado:x', color: '000000', description: 'viva' }, { name: 'rondas:3', color: '111111', description: '' }];
  caso('(d) plan ignora ajenas', plan([], ajenas).length === 0);
  const d = doble({ [R]: ajenas });
  const r = await correr(d, { template: [] });
  caso('(d) 0 escrituras sin plantilla', r.code === 0 && d.escrituras().length === 0);
  const d2 = doble({ [R]: [...ajenas, { ...A, color: 'ededed' }] });
  await correr(d2, { template: [A] });
  caso('(d) solo toca la de la plantilla', d2.escrituras().length === 1 && d2.escrituras()[0].path.endsWith('/labels/A'));
  caso('(d) ajenas intactas', JSON.stringify(d2.repos[R].slice(0, 2)) === JSON.stringify(ajenas));
  const src = readFileSync('scripts/sync-labels.mjs', 'utf8');
  caso("(d) fuente sin method: 'DELETE'", !/method:\s*['"`]DELETE/.test(src));
  caso('(d) fuente sin DELETE ni delete', !/DELETE/.test(src) && !/['"`]delete['"`]/.test(src));
}

// (e) sin token ⇒ exit 0, notice, 0 llamadas
for (const env of [{}, { LABELS_SYNC_TOKEN: '' }]) {
  const d = doble({ [R]: [] });
  const r = await correr(d, { template: [A], env });
  caso(`(e) no-op ${JSON.stringify(env)}`, r.code === 0 && d.llamadas.length === 0
    && r.lines.includes('::notice::sync-labels: sin LABELS_SYNC_TOKEN, no-op'), JSON.stringify(r));
}

// (f) descripción de 101 ⇒ plan lanza, exit 1, 0 llamadas (ni GET)
{
  const larga = { name: 'L', color: 'ffffff', description: 'x'.repeat(101) };
  let lanza = false;
  try { plan([larga], []); } catch { lanza = true; }
  caso('(f) plan lanza', lanza);
  let cien = true;
  try { plan([{ ...larga, description: 'é'.repeat(100) }], []); } catch { cien = false; }
  caso('(f) 100 caracteres multibyte pasa', cien);
  const d = doble({ [R]: [] });
  const r = await correr(d, { template: [A, larga] });
  caso('(f) exit 1, 0 llamadas', r.code === 1 && d.llamadas.length === 0, JSON.stringify(r));
}

// (g) repo con 120 labels ⇒ 2 GET antes de planificar; ninguna se re-crea
{
  const muchas = Array.from({ length: 120 }, (_, i) => ({ name: `L${i}`, color: 'aaaaaa', description: '' }));
  const d = doble({ [R]: muchas });
  const r = await correr(d, { template: [{ name: 'L110', color: 'aaaaaa', description: '' }] });
  const gets = d.llamadas.filter(c => c.method === 'GET');
  caso('(g) 2 GET paginados', gets.length === 2 && gets[1].path.includes('page=2'), JSON.stringify(gets));
  caso('(g) la de la página 2 no se re-crea', r.code === 0 && d.escrituras().length === 0);
}

// (h) los tres repos de REPOS, cada uno con su estado; un repo caído no para a los demás
{
  caso('(h) REPOS', REPOS.length === 3 && REPOS.includes('talfarouriarte-cloud/agent-pipeline'));
  const d = doble({ [REPOS[0]]: [{ ...A }], [REPOS[1]]: [{ ...A, color: 'ededed' }], [REPOS[2]]: [] });
  const r = await correr(d, { template: [A], repos: REPOS });
  const w = d.escrituras();
  caso('(h) 1 PATCH + 1 POST', r.code === 0 && w.length === 2 && w[0].method === 'PATCH' && w[0].path.includes(REPOS[1])
    && w[1].method === 'POST' && w[1].path.includes(REPOS[2]), JSON.stringify(w));
  const caido = doble({ [REPOS[2]]: [] });
  const f = caido.fetch;
  caido.fetch = async (url, o) => (url.includes(REPOS[0]) ? { ok: false, status: 500, json: async () => ({}) } : f(url, o));
  const r2 = await correr(caido, { template: [A], repos: [REPOS[0], REPOS[2]] });
  caso('(h) repo caído ⇒ exit 1, el resto se sincroniza', r2.code === 1 && caido.escrituras().length === 1, JSON.stringify(r2));
}

// La plantilla real valida (lo mismo que exige check-labels).
{
  let ok = true;
  try { plan(JSON.parse(readFileSync('templates/labels.json', 'utf8')), []); } catch { ok = false; }
  caso('plantilla real ≤ 100', ok);
}

if (fallos.length) { console.error('CHECK-SYNC-LABELS ROJO:'); fallos.forEach(f => console.error('  - ' + f)); process.exit(1); }
console.log(`check-sync-labels verde: ${casos} casos.`);
