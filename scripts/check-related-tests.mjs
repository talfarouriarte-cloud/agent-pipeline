#!/usr/bin/env node
// check-related-tests — banco de `vendored/scripts/related-tests.mjs` y de las
// costuras de AP-148 (central#437, ruling mensual 2026-11-08 posición 26 +
// enmienda de las 10:39).
//
// Casos del script:
//  (a) los cambiados se reparten por paquete según la config;
//  (b) un paquete sin cambiados no se ejecuta;
//  (c) sin `.claude/related-tests.json` ⇒ `sin-config` sin ejecutar nada;
//  (d) formato del marcador (incluida la nota `tope-superado-por-diff`) y cuerpo
//      acotado al límite de tamaño del comentario;
//  (e) grafo `a.ts` ← `b.ts` ← `b.test.ts` y `a.test.ts`: con `a.ts` cambiado
//      se seleccionan los dos tests;
//  (e2) `src/lib/x.ts` borrado (o lado viejo de un renombrado) y `y.test.ts`
//      aún lo importa ⇒ `y.test.ts` seleccionado (de punta a punta);
//  (f) tope: 61 tests transitivos ⇒ (i), directos y transitivos por ruta hasta 60;
//  (f2) (i) con 63 ficheros ⇒ los 63, todo (ii) declarado, `tope-superado-por-diff`;
//  (f3) 2 de (i) y 70 directos ⇒ los 2 y los 58 primeros directos por ruta;
//  (g) alias de `tsconfig` `paths` resuelto;
//  (h) timeout simulado (subproceso real) ⇒ `tiempo-agotado`;
//  (i) segunda ejecución sobre otro head ⇒ PATCH del mismo comentario.
// Costuras del motor (`claude-code.yml`, predicado `isRelatedTests` compartido):
//  (j) tracking comment antes y `related-tests` después ⇒ `last` es el tracking;
//  (k) 8 comentarios de ronda + 1 `related-tests` ⇒ el recuento del cap da 8;
//  (l) `<!-- related-tests` fuera del inicio del cuerpo NO se excluye.
// Costuras de mandato: `reviewer.md` (tres reglas de contenido con su hallazgo
// literal y la regla del marcador del head), `creator.md` y `CLAUDE.loop.md`
// (ejecutar antes de (c) y en cada turno que empuja, antes del cierre).
// Cuelga del piggyback de `check-embedded-js.mjs` como sus hermanos.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';

const RT = await import(pathToFileURL('vendored/scripts/related-tests.mjs').href);
let casos = 0;
const fallos = [];
const ok = (cond, nombre) => { casos++; if (!cond) fallos.push(nombre); };
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const tmps = [];
function fixture(ficheros) {
  const d = mkdtempSync(join(tmpdir(), 'related-tests-'));
  tmps.push(d);
  for (const [ruta, txt] of Object.entries(ficheros)) {
    mkdirSync(dirname(join(d, ruta)), { recursive: true });
    writeFileSync(join(d, ruta), txt);
  }
  return d;
}
const espia = () => {
  const llamadas = [];
  const exec = async (cmd, cwd) => { llamadas.push({ cmd, cwd }); return { code: 0, salida: '', agotado: false }; };
  return { llamadas, exec };
};
const CONF = (pkgs) => JSON.stringify(pkgs.map((dir) => ({ dir, runner: 'npx vitest run', tests: 'src/**/*.test.{ts,tsx}' })));

// (a) reparto por paquete, rutas relativas al paquete.
{
  const rep = RT.repartir(['packages/app/src/x.ts', 'packages/engine/src/y.ts', 'docs/z.md', 'packages/app-legacy/src/w.ts'],
    [{ dir: 'packages/app' }, { dir: 'packages/engine/' }]);
  ok(igual(rep.map((p) => p.cambiados), [['src/x.ts'], ['src/y.ts']]), '(a) reparto por paquete (sin colar `app-legacy` en `app`)');
}

// (a)+(b) de punta a punta: dos paquetes, solo uno con cambiados.
{
  const d = fixture({
    '.claude/related-tests.json': CONF(['packages/app', 'packages/engine']),
    'packages/app/src/a.ts': 'export const a = 1;\n',
    'packages/app/src/a.test.ts': "import { a } from './a';\n",
    'packages/engine/src/e.ts': 'export const e = 1;\n',
    'packages/engine/src/e.test.ts': "import { e } from './e';\n",
  });
  const { llamadas, exec } = espia();
  const r = await RT.relatedTests({ cwd: d, cambiados: ['packages/app/src/a.ts'], exec });
  ok(llamadas.length === 1 && llamadas[0].cwd.endsWith('packages/app') && llamadas[0].cmd === "npx vitest run 'src/a.test.ts'", '(a) el runner del paquete recibe sus tests en rutas relativas');
  ok(r.paquetes.find((p) => p.dir === 'packages/engine')?.omitido === true && !llamadas.some((l) => l.cwd.endsWith('engine')), '(b) paquete sin cambiados no se ejecuta');
  ok(r.resultado === 'verde' && r.ejecutados === 1 && r.declarados === 0, '(a) verde con 1 ejecutado');
  const rojo = await RT.relatedTests({ cwd: d, cambiados: ['packages/app/src/a.ts'],
    exec: async () => ({ code: 1, salida: ' FAIL  src/a.test.ts > a\n', agotado: false }) });
  ok(rojo.resultado === 'rojo' && igual(rojo.rojos, ['packages/app/src/a.test.ts']), '(a) rojo con el fichero que falla, en ruta del repo');
}

// (c) sin config: sin-config, sin ejecutar.
{
  const d = fixture({ 'packages/app/src/a.test.ts': '' });
  const { llamadas, exec } = espia();
  const r = await RT.relatedTests({ cwd: d, cambiados: ['packages/app/src/a.test.ts'], exec });
  ok(r.resultado === 'sin-config' && llamadas.length === 0, '(c) sin-config sin ejecutar nada');
}

// (d) marcador.
{
  const sha = 'a'.repeat(40);
  const m = RT.marcador({ sha, resultado: 'verde', ejecutados: 3, declarados: 0 });
  ok(m === `<!-- related-tests: ${sha} verde ejecutados=3 declarados=0 -->` && RT.MARCA_RE.test(m), '(d) forma del marcador');
  const mt = RT.marcador({ sha, resultado: 'verde', ejecutados: 63, declarados: 5, tope: true });
  ok(RT.MARCA_RE.exec(mt)?.[5] === ' tope-superado-por-diff', '(d) la nota del tope va al final del marcador');
  const b = RT.cuerpo(sha, { resultado: 'verde', paquetes: [], ejecutados: 0, declarados: 0, tope: false, rojos: [] });
  ok(RT.isRelatedTests(b) && b.split('\n')[0] === RT.marcador({ sha, resultado: 'verde', ejecutados: 0, declarados: 0 }), '(d) el cuerpo empieza por el marcador');
  ok(!RT.MARCA_RE.test(`texto ${m}`), '(d) una cita en prosa no es marcador');
  // Cuerpo acotado: dos paquetes con 2000 declarados de ruta larga caben en el comentario.
  const largo = (i) => `src/features/modulo-con-nombre-largo/${String(i).padStart(4, '0')}/componente.test.tsx`;
  const pk = (dir) => ({ dir, hechos: [], ejecutar: [], declarar: Array.from({ length: 2000 }, (_, i) => largo(i)), delDiff: [] });
  const grande = RT.cuerpo(sha, { resultado: 'verde', paquetes: [pk('packages/app'), pk('packages/engine')], ejecutados: 0, declarados: 4000, tope: false, rojos: [] });
  ok(grande.length <= 60000 && RT.MARCA_RE.test(grande.split('\n')[0]) && /… y \d+ más/.test(grande), '(d) el cuerpo entero se recorta por debajo del límite del comentario');
}

// (e) grafo transitivo.
{
  const fich = { 'src/a.ts': 'export const a=1;', 'src/b.ts': "import { a } from './a.js';\nexport const b=a;",
    'src/b.test.ts': "import { b } from './b';", 'src/a.test.ts': "const m = await import('./a');", 'src/c.test.ts': "export * from './c';", 'src/c.ts': '' };
  const ficheros = Object.keys(fich).sort();
  const inv = RT.grafoInverso(ficheros, (f) => fich[f], []);
  const sel = RT.seleccionar({ cambiados: ['src/a.ts'], ficheros, esTest: (f) => /\.test\.ts$/.test(f), inv });
  ok(igual(sel.ejecutar, ['src/a.test.ts', 'src/b.test.ts']) && sel.declarar.length === 0, '(e) a.ts cambiado selecciona a.test.ts (directo) y b.test.ts (transitivo)');
}

// (e2) borrado: el test que aún importa la ruta vieja sale como directo.
{
  const d = fixture({
    '.claude/related-tests.json': CONF(['packages/app']),
    'packages/app/src/y.test.ts': "import { x } from './lib/x';\n",
    'packages/app/src/z.test.ts': 'export const z = 1;\n',
  });
  const { llamadas, exec } = espia();
  const r = await RT.relatedTests({ cwd: d, cambiados: ['packages/app/src/lib/x.ts'], exec });
  ok(llamadas.length === 1 && llamadas[0].cmd === "npx vitest run 'src/y.test.ts'" && r.ejecutados === 1, '(e2) un borrado selecciona a quien aún lo importa');
}

// (f)/(f2)/(f3) tope.
{
  const esTest = (f) => f.endsWith('.test.ts');
  const n = (i) => String(i).padStart(3, '0');
  // (f) 61 transitivos: a ← m ← t000..t060; más 1 test del diff y 3 directos.
  {
    const ficheros = ['a.ts', 'm.ts', 'd.test.ts', 'x0.test.ts', 'x1.test.ts', 'x2.test.ts'];
    const inv = new Map([['a.ts', new Set(['m.ts', 'x0.test.ts', 'x1.test.ts', 'x2.test.ts'])], ['m.ts', new Set()]]);
    for (let i = 0; i < 61; i++) { ficheros.push(`t${n(i)}.test.ts`); inv.get('m.ts').add(`t${n(i)}.test.ts`); }
    const sel = RT.seleccionar({ cambiados: ['a.ts', 'd.test.ts'], ficheros, esTest, inv });
    ok(sel.ejecutar.length === 60 && sel.ejecutar[0] === 'd.test.ts' && igual(sel.ejecutar.slice(1, 4), ['x0.test.ts', 'x1.test.ts', 'x2.test.ts'])
      && sel.ejecutar[4] === 't000.test.ts' && sel.ejecutar[59] === 't055.test.ts', '(f) (i), luego directos y transitivos por ruta hasta 60');
    ok(sel.declarar.length === 5 && sel.declarar[0] === 't056.test.ts' && !sel.tope, '(f) el resto se declara');
  }
  // (f2) 63 del diff.
  {
    const diff = Array.from({ length: 63 }, (_, i) => `d${n(i)}.test.ts`);
    const ficheros = [...diff, 'a.ts', 'z.test.ts'];
    const inv = new Map([['a.ts', new Set(['z.test.ts'])]]);
    const sel = RT.seleccionar({ cambiados: [...diff, 'a.ts'], ficheros, esTest, inv });
    ok(sel.ejecutar.length === 63 && igual(sel.declarar, ['z.test.ts']) && sel.tope === true, '(f2) (i) > 60 se ejecuta entero, (ii) declarado, tope-superado-por-diff');
  }
  // (f3) 2 del diff y 70 directos (insertados en orden inverso: el orden es por ruta).
  {
    const directos = Array.from({ length: 70 }, (_, i) => `p${n(69 - i)}.test.ts`);
    const ficheros = ['a.ts', 'd0.test.ts', 'd1.test.ts', ...directos];
    const inv = new Map([['a.ts', new Set(directos)]]);
    const sel = RT.seleccionar({ cambiados: ['a.ts', 'd1.test.ts', 'd0.test.ts'], ficheros, esTest, inv });
    ok(sel.ejecutar.length === 60 && igual(sel.ejecutar.slice(0, 3), ['d0.test.ts', 'd1.test.ts', 'p000.test.ts']) && sel.ejecutar[59] === 'p057.test.ts'
      && sel.declarar.length === 12 && sel.declarar[0] === 'p058.test.ts', '(f3) los 2 del diff y los 58 primeros directos por ruta');
  }
}

// (g) alias de tsconfig paths (con comentarios en el tsconfig, como los reales).
{
  const d = fixture({
    'tsconfig.json': '{\n  // alias\n  "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"], "@lib": ["src/lib/index.ts"] } },\n}\n',
    'src/core/x.ts': 'export const x = 1;', 'src/lib/index.ts': 'export {};',
  });
  const al = RT.aliases(d);
  const existe = new Set(['src/core/x.ts', 'src/lib/index.ts']);
  ok(RT.resolver('src/ui/v.test.ts', '@/core/x', existe, al) === 'src/core/x.ts' && RT.resolver('src/ui/v.test.ts', '@lib', existe, al) === 'src/lib/index.ts'
    && RT.resolver('src/ui/v.test.ts', 'react', existe, al) === null, '(g) alias `@/*` y exacto resueltos; paquete externo ignorado');
}

// (h) timeout con subproceso real: el runner duerme más que el plazo.
{
  const d = fixture({
    '.claude/related-tests.json': JSON.stringify([{ dir: '.', runner: `node -e "setTimeout(()=>{},30000)"`, tests: '**/*.test.ts' }]),
    'a.test.ts': '',
  });
  const t0 = Date.now();
  const r = await RT.relatedTests({ cwd: d, cambiados: ['a.test.ts'], timeoutMs: 400 });
  ok(r.resultado === 'tiempo-agotado' && r.ejecutados === 0 && r.declarados === 1 && Date.now() - t0 < 10000, '(h) timeout ⇒ tiempo-agotado, lo no ejecutado se declara');
}

// (i) PATCH del mismo comentario en la segunda ejecución.
{
  const comentarios = [{ id: 1, body: 'tracking' }];
  const llamadas = [];
  const api = async (m, ruta, datos) => {
    llamadas.push(m);
    if (m === 'GET') return comentarios.map((c) => ({ ...c }));
    if (m === 'POST') { const c = { id: comentarios.length + 1, body: datos.body }; comentarios.push(c); return c; }
    if (m === 'PATCH') { comentarios.find((c) => ruta.endsWith(`/${c.id}`)).body = datos.body; return {}; }
  };
  const b1 = RT.cuerpo('1'.repeat(40), { resultado: 'verde', paquetes: [], ejecutados: 0, declarados: 0, tope: false, rojos: [] });
  const b2 = RT.cuerpo('2'.repeat(40), { resultado: 'rojo', paquetes: [], ejecutados: 1, declarados: 0, tope: false, rojos: ['x.test.ts'] });
  const p1 = await RT.publicar({ pr: 7, body: b1, api });
  const p2 = await RT.publicar({ pr: 7, body: b2, api });
  ok(p1.metodo === 'POST' && p2.metodo === 'PATCH' && p2.id === p1.id && comentarios.length === 2 && comentarios[1].body === b2, '(i) segunda ejecución ⇒ PATCH del mismo id, no POST');
}

// (j)/(k)/(l) costuras del motor: el predicado de claude-code.yml, ejecutado.
{
  const wf = yaml.load(readFileSync('.github/workflows/claude-code.yml', 'utf8'));
  const scripts = Object.values(wf.jobs).flatMap((j) => j.steps ?? []).map((s) => ({ name: s.name, src: s.with?.script ?? '' }));
  const PRED = /const isRelatedTests = \(body\) => String\(body \?\? ''\)\.trimStart\(\)\.startsWith\('<!-- related-tests'\);/;
  const cap = scripts.find((s) => s.name === 'Check iteration cap (PR contexts only)');
  const auto = scripts.find((s) => /const last = botComments\[botComments\.length - 1\]/.test(s.src));
  const FILTRO = /c => c\.user\.login === 'claude\[bot\]' && !isRelatedTests\(c\.body\)/;
  ok(!!cap && PRED.test(cap.src) && FILTRO.test(cap.src), 'costura: el recuento del cap usa isRelatedTests');
  ok(!!auto && PRED.test(auto.src) && FILTRO.test(auto.src), 'costura: botComments del Auto-label usa isRelatedTests');
  ok(PRED.exec(cap?.src ?? '')?.[0] === PRED.exec(auto?.src ?? '')?.[0], 'costura: el predicado es el mismo en los dos sitios');
  // El predicado del workflow, ejecutado (no el del script): mismo texto que el de related-tests.mjs.
  const isRT = new Function(`${PRED.exec(cap?.src ?? '')?.[0] ?? 'const isRelatedTests = () => false;'} return isRelatedTests;`)();
  const filtro = (cs) => cs.filter((c) => c.user.login === 'claude[bot]' && !isRT(c.body));
  const bot = (body) => ({ user: { login: 'claude[bot]' }, body });
  const rt = bot(RT.cuerpo('3'.repeat(40), { resultado: 'verde', paquetes: [], ejecutados: 0, declarados: 0, tope: false, rojos: [] }));
  {
    const lista = filtro([bot('review'), bot('tracking @reviewer'), rt]);
    ok(lista[lista.length - 1].body === 'tracking @reviewer', '(j) related-tests posterior al tracking: `last` es el tracking');
  }
  ok(filtro([...Array.from({ length: 8 }, (_, i) => bot(`ronda ${i}`)), rt]).length === 8, '(k) 8 de ronda + 1 related-tests ⇒ el cap cuenta 8');
  ok(filtro([bot(`cita: ${RT.PREFIJO}: … -->`)]).length === 1 && filtro([bot(`\n  ${rt.body}`)]).length === 0, '(l) solo excluye si va al inicio del cuerpo (trimStart)');
}

// Costuras de mandato.
{
  const leer = (p) => readFileSync(p, 'utf8');
  for (const p of ['vendored/docs-agents/reviewer.md']) {
    const t = leer(p);
    ok(t.includes('comportamiento cambiado sin test: `<fichero>`'), `${p}: regla «comportamiento cambiado sin test»`);
    ok(t.includes('test no actualizado: `<test>` asierta `<x>` que el diff cambia'), `${p}: regla «test no actualizado»`);
    ok(/test aflojado: `<test>`/.test(t) && /`skip`, `todo`/.test(t), `${p}: regla «tests aflojados»`);
    ok(t.includes('tests relacionados sin verde en el head (`<resultado>`)') && /marcador `related-tests` del head/.test(t), `${p}: regla del marcador del head`);
  }
  for (const p of ['vendored/docs-agents/creator.md', 'vendored/CLAUDE.loop.md']) {
    const t = leer(p).replace(/\s+/g, ' ');   // CLAUDE.loop.md parte las frases en líneas de 70
    ok(t.includes('node scripts/related-tests.mjs') && /antes de \(c\)/i.test(t) && /cada turno que empuj/i.test(t)
      && /antes del comentario de cierre/i.test(t) && t.includes('600000'), `${p}: related-tests antes de (c) y en cada turno que empuja, con timeout 600000`);
  }
  ok(leer('vendored/CLAUDE.loop.md').replace(/\s+/g, ' ').includes('the single `related-tests` comment is edited in place and does not count toward the cap'), 'CLAUDE.loop.md: frase del cap');
}

for (const d of tmps) rmSync(d, { recursive: true, force: true });
if (fallos.length) {
  for (const f of fallos) console.error(`✗ check-related-tests: ${f}`);
  process.exit(1);
}
console.log(`check-related-tests verde: ${casos} casos (related-tests.mjs, filtros de claude-code.yml y mandatos, AP-148).`);
