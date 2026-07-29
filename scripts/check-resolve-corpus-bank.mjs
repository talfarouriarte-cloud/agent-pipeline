#!/usr/bin/env node
// check-resolve-corpus-bank — el BANCO de `check-resolve-corpus.mjs` (AP-075).
//
// POR QUÉ EXISTE. AP-074 construyó la sonda que calibra al belt de AP-064 contra
// prosa real, y la verificó con **6 mutaciones ejecutadas a mano en una sesión**:
// módulo mutado ⇒ CADUCADA, veredicto sellado editado ⇒ rojo, repo inalcanzable ⇒
// fail-open, `--sellar` sin barrido ⇒ se niega, ledger ausente ⇒ rojo nominal.
// Todas ciertas, todas reales — y **nada las vuelve a correr**. Es exactamente la
// clase de #166 un piso por debajo de la sonda que la cierra: un paso barato cuyo
// único portador es que alguien se acuerde de repetirlo. El instrumento que existe
// para que una verificación no viva en la prosa de una sesión vivía en la prosa de
// una sesión.
//
// La distancia entre «residual declarado» y «residual cerrado» en este repo es
// tener banco (AP-069, AP-070). Este es el banco.
//
// CÓMO CORRE SIN RED Y SIN FLAKEAR. `check-resolve-corpus.mjs` acepta un corpus de
// FIXTURE por `CHECK_RESOLVE_CORPUS_FIXTURE`, que sustituye a la API. Cada caso se
// ejecuta en un `cwd` temporal propio —el script resuelve el módulo y el ledger
// relativos al cwd—, con `GITHUB_REPOSITORY` BORRADO del entorno para que ninguna
// rama pueda tocar la red por accidente. Se asierta el EXIT CODE y la prosa que el
// script emite, que es su interfaz real con quien lo lee en un run rojo.
//
// La costura no debilita el gate: en modo fixture el barrido se anuncia como
// no-productivo, y el sello que produce queda marcado (`barrido.fixture: true`),
// lo que lo hace ROJO en cuanto alguien lo lee en modo producción. El caso (k)
// asierta justo eso.
//
// Verde: exit 0.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, rmSync } from 'fs';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const REPO = process.cwd();
const SCRIPT = resolve(REPO, 'scripts/check-resolve-corpus.mjs');
const MODULO = 'vendored/scripts/resolve-cross-issue-failsafe.cjs';
const LEDGER_REL = 'docs/corpus/resolve-cross-issue-corpus.json';
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

if (!existsSync(SCRIPT)) {
  console.log('::warning::check-resolve-corpus-bank — no encuentro `scripts/check-resolve-corpus.mjs`: el banco NO se ha ejecutado.');
  process.exit(0);
}
if (!existsSync(resolve(REPO, MODULO))) {
  console.log('::warning::check-resolve-corpus-bank — no encuentro el módulo del belt: el banco NO se ha ejecutado.');
  process.exit(0);
}
const MODULO_SHA = sha256(readFileSync(resolve(REPO, MODULO), 'utf8'));

// ── Prosa de los fixtures ────────────────────────────────────────────────────
// La INSTANCIA CANÓNICA de #166, verbatim del mandato: es la única frase cuyo
// comportamiento el repo tiene congelado en tres sitios (el módulo, su banco y el
// caso (r) de anti-regresión), luego usarla aquí hace que un cambio en el
// vocabulario del belt se note también en este banco.
const CANON = 'stalled retirada de #1694 y re-arm del eslabón 1/3 allí (detalle en su hilo).';
const CAPA = '<!-- watchdog-capa: schedule -->';
const ROL = '<!-- watchdog-rol: architect-resolve -->';

const com = (id, host, body) => ({
  id,
  body,
  html_url: `https://github.com/x/y/issues/${host}#issuecomment-${id}`,
  issue_url: `https://api.github.com/repos/x/y/issues/${host}`,
});

// ── Arnés ────────────────────────────────────────────────────────────────────
const fallos = [];
let corridos = 0;

function caso(nombre, { ledger, fixture, sellar = false, modulo = true }, esperado) {
  corridos++;
  const dir = mkdtempSync(join(tmpdir(), 'corpus-bank-'));
  try {
    if (modulo) {
      mkdirSync(join(dir, 'vendored/scripts'), { recursive: true });
      copyFileSync(resolve(REPO, MODULO), join(dir, MODULO));
    }
    if (ledger !== undefined) {
      mkdirSync(join(dir, 'docs/corpus'), { recursive: true });
      writeFileSync(join(dir, LEDGER_REL), typeof ledger === 'string' ? ledger : JSON.stringify(ledger, null, 2) + '\n');
    }
    const env = { ...process.env };
    delete env.GITHUB_REPOSITORY;          // ninguna rama puede alcanzar la red
    delete env.CHECK_RESOLVE_CORPUS_FIXTURE;
    if (fixture) {
      const fp = join(dir, 'fixture.json');
      writeFileSync(fp, JSON.stringify(fixture, null, 2));
      env.CHECK_RESOLVE_CORPUS_FIXTURE = fp;
    }
    const r = spawnSync('node', [SCRIPT, ...(sellar ? ['--sellar'] : [])], { cwd: dir, env, encoding: 'utf8' });
    const salida = `${r.stdout || ''}${r.stderr || ''}`;
    const err = [];
    if (r.status !== esperado.exit) err.push(`exit ${r.status} (esperaba ${esperado.exit})`);
    for (const s of esperado.dice || []) if (!salida.includes(s)) err.push(`no dice ${JSON.stringify(s)}`);
    for (const s of esperado.calla || []) if (salida.includes(s)) err.push(`dice ${JSON.stringify(s)} y no debería`);
    if (esperado.ledger) {
      // La aserción se ejecuta DENTRO de un try: varias parsean el ledger, y un
      // ledger que no parsea es justo lo que algunas mutaciones producen. Sin
      // esto, la mutación no rompe un caso — **tumba el banco entero** con un
      // stack trace, que es indistinguible de «el banco está roto» y no dice qué
      // caso mordió. Lo destapó la mutación M3 de AP-075.
      const txt = existsSync(join(dir, LEDGER_REL)) ? readFileSync(join(dir, LEDGER_REL), 'utf8') : null;
      try {
        const e = esperado.ledger(txt);
        if (e) err.push(e);
      } catch (ex) { err.push(`la aserción sobre el ledger lanzó (${ex.message})`); }
    }
    if (err.length) fallos.push(`${nombre}: ${err.join(' · ')}\n      salida: ${salida.trim().split('\n').slice(0, 6).join(' ⏎ ')}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ledgerVigente = (entradas, extra = {}) => ({
  _: 'fixture de banco',
  modulo: { ruta: MODULO, sha256: MODULO_SHA },
  barrido: { fecha: '2026-07-29T00:00:00.000Z', repo: 'x/y', comentarios: entradas.length, autenticado: false, truncado: false, ...extra },
  entradas,
});
const entrada = (c, veredicto, extra = {}) => ({
  id: c.id, url: c.html_url, host: 1696, cuerpo_sha256: sha256(c.body), rol: 'inyectado', veredicto, nota: '', ...extra,
});
const VER_CANON = { materializa: [{ n: 1694, desStall: true, arm: true }], avisos: [] };
const VER_MUDO = { materializa: [], avisos: [] };

// ── L1 · calibración offline (la capa con dientes) ───────────────────────────

caso('(a) ledger AUSENTE, sin --sellar ⇒ ROJO', { ledger: undefined }, {
  exit: 1, dice: ['falta `docs/corpus/resolve-cross-issue-corpus.json`', '--sellar'],
});

caso('(b) ledger CADUCADO (el módulo no es el sellado) ⇒ ROJO', {
  ledger: { ...ledgerVigente([]), modulo: { ruta: MODULO, sha256: 'f'.repeat(64) } },
}, { exit: 1, dice: ['CADUCADA', 'vuelve a sellar'] });

caso('(c) ledger CADUCADO CON --sellar ⇒ el rojo de L1 se DIFIERE (muere en el sello, no en L1)', {
  ledger: { ...ledgerVigente([]), modulo: { ruta: MODULO, sha256: 'f'.repeat(64) } }, sellar: true,
}, { exit: 1, dice: ['sin barrido vivo'], calla: ['CADUCADA'] });

caso('(d) módulo AUSENTE ⇒ fail-open ANUNCIADO, jamás mudo', { ledger: ledgerVigente([]), modulo: false }, {
  exit: 0, dice: ['no encuentro', 'la sonda NO se ha ejecutado'],
});

// ── Ledger CORRUPTO — residual (f) de AP-074 ─────────────────────────────────
// El script anuncia `--sellar` como su reparación y `--sellar` moría por la misma
// corrupción que venía a reparar. (e)/(f)/(g) fijan el rojo fuera de `--sellar`;
// (h) fija que la corrupción YA NO cortocircuita antes del barrido; (i) que la
// reconstrucción ocurre de verdad y que la pérdida de notas se dice en voz alta.

caso('(e) ledger que NO PARSEA, sin --sellar ⇒ ROJO que nombra la reparación real', { ledger: '{ esto no es json' }, {
  exit: 1, dice: ['no parsea como JSON', '--sellar', 'PIERDE las `nota`', 'NO lo edites a mano'],
});

caso('(f) ledger MAL FORMADO (sin `modulo.sha256`), sin --sellar ⇒ ROJO', { ledger: { entradas: [] } }, {
  exit: 1, dice: ['mal formado', 'falta `modulo.sha256`'],
});

caso('(g) ledger con ids DUPLICADOS, sin --sellar ⇒ ROJO', {
  ledger: ledgerVigente([entrada(com(1, 1696, 'x' + CAPA), VER_MUDO), entrada(com(1, 1696, 'y' + CAPA), VER_MUDO)]),
}, { exit: 1, dice: ['duplicadas por `id`'] });

// La corrupción SIGUE dicha bajo `--sellar` —degradarla a silencio sería otra
// pérdida silenciosa—: lo que cambia es su GRADO. El caso asierta las dos cosas a
// la vez, que es lo que lo hace no-vacuo: aparece como `::warning`, y el rojo que
// mata la corrida es el del sello sin barrido, no el de la corrupción.
caso('(h) ledger que NO PARSEA, CON --sellar ⇒ la corrupción baja a AVISO y NO cortocircuita', {
  ledger: '{ esto no es json', sellar: true,
}, {
  exit: 1,
  dice: ['::warning::check-resolve-corpus — `docs/corpus/resolve-cross-issue-corpus.json` no parsea como JSON', 'sin barrido vivo'],
  calla: ['ROJO: `docs/corpus/resolve-cross-issue-corpus.json` no parsea'],
});

caso('(i) ledger que NO PARSEA, CON --sellar y corpus ⇒ RECONSTRUIDO, y la pérdida de notas se ANUNCIA', {
  ledger: '{ esto no es json', sellar: true, fixture: [com(9001, 1696, `Sin acción por esta vía.\n${CAPA}`)],
}, {
  exit: 0, dice: ['`--sellar` lo RECONSTRUYE', 'se PIERDEN', 'sellado'],
  ledger: (t) => {
    if (!t) return 'no se escribió el ledger';
    const l = JSON.parse(t);
    if (l.entradas.length !== 1) return `el ledger reconstruido tiene ${l.entradas.length} entradas, esperaba 1`;
    if (l.barrido.fixture !== true) return 'el sello de fixture no quedó marcado con `barrido.fixture: true`';
    return null;
  },
});

// ── El sello no se falsifica desde un teclado ────────────────────────────────

caso('(j) `--sellar` SIN barrido vivo ⇒ se niega y el ledger queda BYTE A BYTE intacto', {
  ledger: ledgerVigente([]), sellar: true,
}, {
  exit: 1, dice: ['sin barrido vivo'],
  ledger: (t) => (t === JSON.stringify(ledgerVigente([]), null, 2) + '\n' ? null : 'el ledger se tocó pese a negarse a sellar'),
});

caso('(k) ledger SELLADO DESDE FIXTURE leído en modo producción ⇒ ROJO (la costura de banco se autodenuncia)', {
  ledger: ledgerVigente([], { fixture: true }),
}, { exit: 1, dice: ['FIXTURE de banco', 'no adjudica nada'] });

// ── L2 · barrido (sobre fixture: determinista y sin red) ─────────────────────

{
  const c = com(9101, 1696, `${CANON}\n${CAPA}`);
  caso('(l) rojo (ii): prosa que MATERIALIZA y nadie ha adjudicado ⇒ ROJO', {
    ledger: ledgerVigente([]), fixture: [c],
  }, { exit: 1, dice: ['SIN ADJUDICAR', '"n":1694', 'inyectado por la sonda'] });

  caso('(m) rojo (i): veredicto SELLADO que ya no reproduce con el cuerpo idéntico ⇒ ROJO', {
    ledger: ledgerVigente([entrada(c, VER_MUDO)]), fixture: [c],
  }, { exit: 1, dice: ['ya no reproduce', 'se editó a mano'] });

  // La aserción de FIXTURE se ancla al fragmento `materializaría(n) · corrida de
  // FIXTURE`, que SOLO puede existir dentro de la línea del verde: el `::warning`
  // de arriba dice «corpus de FIXTURE», no «corrida». Es lo que hace al caso
  // morder si alguien retira la interpolación o la mueve a otra línea — un
  // `::warning` arriba no desmiente un verde abajo (🟡 2 de la review de AP-075).
  caso('(n) prosa adjudicada y estable ⇒ VERDE, el resumen distingue nativo de inyectado y el verde DECLARA que es de fixture', {
    ledger: ledgerVigente([entrada(c, VER_CANON)]), fixture: [c],
  }, { exit: 0, dice: ['1 con marcador de capa o de ROL', '(0 con el de ROL NATIVO)', 'verde', 'materializaría(n) · corrida de FIXTURE'] });
}

// ── UNIÓN CAPA ∪ ROL — el hallazgo de AP-075 ─────────────────────────────────
// Un comentario del resolver que cumple su mandato de ROL y olvida el de CAPA es
// prosa sobre la que el belt ESCRIBE. Con la selección por CAPA a secas, la sonda
// ni lo miraba: rojo de MENOS y silencioso. Este caso muere si alguien vuelve a
// estrechar el filtro.
caso('(o) SOLO marcador de ROL (sin el de CAPA) y materializa ⇒ entra en el corpus y es ROJO, marcado NATIVO', {
  ledger: ledgerVigente([]), fixture: [com(9201, 1696, `${CANON}\n${ROL}`)],
}, { exit: 1, dice: ['SIN ADJUDICAR', 'ROL NATIVO', 'el belt escribirá ahí'] });

// ── Avisos NOMINALES: cola de adjudicación, jamás rojo ───────────────────────

caso('(p) prosa nueva de la capa que NO materializa ⇒ aviso nominal, VERDE', {
  ledger: ledgerVigente([]), fixture: [com(9301, 1696, `Sin acción por esta vía.\n${CAPA}`)],
}, { exit: 0, dice: ['sin adjudicar (no materializa nada)'] });

caso('(q) entrada sellada que ya no aparece en el corpus ⇒ aviso nominal, VERDE', {
  ledger: ledgerVigente([entrada(com(9401, 1696, `x\n${CAPA}`), VER_MUDO)]), fixture: [],
}, { exit: 0, dice: ['ya no aparece en el corpus'] });

// ── (f1) de AP-074: la `nota` SOBREVIVE a la edición del cuerpo, marcada ─────

{
  const viejo = com(9501, 1696, `Versión VIEJA del cuerpo.\n${CAPA}`);
  const nuevo = com(9501, 1696, `Versión NUEVA del cuerpo.\n${CAPA}`);
  const sellado = ledgerVigente([entrada(viejo, VER_MUDO, { nota: 'adjudicado a mano por el Auditor' })]);

  caso('(r) cuerpo EDITADO desde el sello ⇒ aviso nominal y la `nota` se CONSERVA marcada', {
    ledger: sellado, fixture: [nuevo], sellar: true,
  }, {
    exit: 0, dice: ['EDITADO desde el sello'],
    ledger: (t) => {
      const n = JSON.parse(t).entradas[0].nota;
      return n === '[cuerpo editado desde la adjudicación] adjudicado a mano por el Auditor'
        ? null : `la nota quedó como ${JSON.stringify(n)} — la adjudicación previa se perdió`;
    },
  });

  // El cuerpo sellado tiene que ser DISTINTO del de hoy, o el caso no llega
  // siquiera a la rama que dice probar: con el cuerpo estable gana el primer
  // ternario y la idempotencia nunca se ejercita. Nació así y lo destapó la
  // mutación M7, no releer el diff — tercera ronda consecutiva en este issue en
  // que un caso propio nace vacuo y solo lo caza ejecutar mutaciones.
  caso('(s) segunda edición sobre una nota YA marcada ⇒ NO se vuelve a prefijar (idempotencia)', {
    ledger: ledgerVigente([entrada(viejo, VER_MUDO, { nota: '[cuerpo editado desde la adjudicación] adjudicado a mano por el Auditor' })]),
    fixture: [nuevo], sellar: true,
  }, {
    exit: 0,
    ledger: (t) => {
      const n = JSON.parse(t).entradas[0].nota;
      const veces = n.split('[cuerpo editado desde la adjudicación]').length - 1;
      return veces === 1 ? null : `la marca aparece ${veces} veces: ${JSON.stringify(n)}`;
    },
  });

  caso('(t) cuerpo estable ⇒ la `nota` se conserva SIN marca', {
    ledger: sellado, fixture: [viejo], sellar: true,
  }, {
    exit: 0,
    ledger: (t) => {
      const n = JSON.parse(t).entradas[0].nota;
      return n === 'adjudicado a mano por el Auditor' ? null : `la nota quedó como ${JSON.stringify(n)}`;
    },
  });
}

// ── L2b · `barrer()` — la CAPA DE RED, residual (c) de AP-075 ────────────────
// Los casos de arriba corren sobre la costura de FIXTURE, que sustituye el corpus
// ENTERO: `barrer()` no se ejecuta ni una vez en ninguno de ellos. Eso es
// exactamente lo que AP-075 dejó declarado —«paginación, `direction: desc`,
// timeout, fail-open por HTTP siguen sin banco; la mutación M7 de AP-074, hecha a
// mano bajando `MAX_PAGINAS`, es su única verificación»—. Aquí `barrer()` corre
// ENTERA: lo que se sustituye es el `fetch` GLOBAL del subproceso
// (`scripts/lib/fetch-doble.mjs`, cargado por `--import`), no una rama del script.
//
// El doble se autodenuncia por los tres sitios (no-op sin plan, anuncio por
// stderr, `barrido.doble` en lo que selle) y el caso (bb) asierta el tercero.
const DOBLE = resolve(REPO, 'scripts/lib/fetch-doble.mjs');
const CORPUS_MARCADO = com(9601, 1696, `${CANON}\n${CAPA}`);

function casoRed(nombre, { ledger, plan, sellar = false, token = false }, esperado) {
  corridos++;
  const dir = mkdtempSync(join(tmpdir(), 'corpus-bank-red-'));
  try {
    mkdirSync(join(dir, 'vendored/scripts'), { recursive: true });
    copyFileSync(resolve(REPO, MODULO), join(dir, MODULO));
    if (ledger !== undefined) {
      mkdirSync(join(dir, 'docs/corpus'), { recursive: true });
      writeFileSync(join(dir, LEDGER_REL), typeof ledger === 'string' ? ledger : JSON.stringify(ledger, null, 2) + '\n');
    }
    const planPath = join(dir, 'plan.json');
    const logPath = join(dir, 'log.json');
    writeFileSync(planPath, JSON.stringify({ paginas: plan }, null, 2));
    const env = { ...process.env };
    delete env.CHECK_RESOLVE_CORPUS_FIXTURE;
    delete env.GH_TOKEN;
    delete env.GITHUB_TOKEN;
    // El repo del run tiene que existir para que el script LLEGUE a `barrer()`;
    // que no toque la red lo garantiza el doble, no la ausencia de la variable.
    env.GITHUB_REPOSITORY = 'x/y';
    env.CHECK_RESOLVE_CORPUS_FETCH_PLAN = planPath;
    env.CHECK_RESOLVE_CORPUS_FETCH_LOG = logPath;
    if (token) env.GH_TOKEN = 'token-de-banco';
    const r = spawnSync('node', ['--import', DOBLE, SCRIPT, ...(sellar ? ['--sellar'] : [])], { cwd: dir, env, encoding: 'utf8' });
    const salida = `${r.stdout || ''}${r.stderr || ''}`;
    const err = [];
    if (r.status !== esperado.exit) err.push(`exit ${r.status} (esperaba ${esperado.exit})`);
    for (const s of esperado.dice || []) if (!salida.includes(s)) err.push(`no dice ${JSON.stringify(s)}`);
    for (const s of esperado.calla || []) if (salida.includes(s)) err.push(`dice ${JSON.stringify(s)} y no debería`);
    for (const asercion of ['log', 'ledger']) {
      if (!esperado[asercion]) continue;
      const p = asercion === 'log' ? logPath : join(dir, LEDGER_REL);
      const txt = existsSync(p) ? readFileSync(p, 'utf8') : null;
      try {
        const e = esperado[asercion](asercion === 'log' ? (txt ? JSON.parse(txt) : []) : txt);
        if (e) err.push(e);
      } catch (ex) { err.push(`la aserción sobre \`${asercion}\` lanzó (${ex.message})`); }
    }
    if (err.length) fallos.push(`${nombre}: ${err.join(' · ')}\n      salida: ${salida.trim().split('\n').slice(0, 6).join(' ⏎ ')}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (!existsSync(DOBLE)) {
  console.log('::warning::check-resolve-corpus-bank — falta `scripts/lib/fetch-doble.mjs`: los casos de la capa de RED (residual (c) de AP-075) NO se han ejecutado.');
} else {
  // (u) La paginación de verdad: tres páginas, la última corta, y el barrido PARA
  // ahí. Si siguiera pidiendo, el doble lanza «fuera del plan» y el fail-open lo
  // absorbería en verde — por eso el conteo de llamadas es una aserción y no un
  // detalle: es lo único que distingue «paró porque el lote era corto» de «paró
  // porque se rompió».
  casoRed('(u) paginación de 3 páginas (100+100+3) ⇒ 203 comentarios y EXACTAMENTE 3 llamadas', {
    ledger: ledgerVigente([]),
    plan: [{ relleno: 100, desde: 5000 }, { relleno: 100, desde: 4900 }, { relleno: 3, desde: 4800 }],
  }, {
    exit: 0, dice: ['203 comentarios de x/y', '(sin token)'],
    log: (l) => (l.length === 3 ? null : `el script hizo ${l.length} llamadas, esperaba 3`),
  });

  // (v) `direction=desc` y el `signal` del timeout, asertados sobre la URL REAL
  // que sale del proceso. `desc` tiene un porqué escrito sobre `barrer()` (qué
  // mitad se pierde al truncar) y ahora además tiene consumidor; el `signal` es
  // lo único que hace de `TIMEOUT_MS` un timeout y no una constante decorativa.
  casoRed('(v) toda petición lleva `direction=desc`, `per_page=100`, su `page=N` y el `signal` del timeout', {
    ledger: ledgerVigente([]),
    plan: [{ relleno: 100, desde: 5000 }, { relleno: 2, desde: 4900 }],
  }, {
    exit: 0,
    log: (l) => {
      for (const [k, e] of l.entries()) {
        if (!e.url.includes('direction=desc')) return `la llamada ${k + 1} no pide \`direction=desc\`: ${e.url}`;
        if (!e.url.includes('per_page=100')) return `la llamada ${k + 1} no pide \`per_page=100\`: ${e.url}`;
        if (!e.url.includes(`page=${k + 1}&`)) return `la llamada ${k + 1} no pide \`page=${k + 1}\`: ${e.url}`;
        if (!e.conSignal) return `la llamada ${k + 1} va SIN \`signal\`: el timeout no está cableado`;
      }
      return null;
    },
  });

  casoRed('(w) con `GH_TOKEN` ⇒ la petición va AUTENTICADA y el resumen deja de decir «sin token»', {
    ledger: ledgerVigente([]), token: true, plan: [{ relleno: 2, desde: 5000 }],
  }, {
    exit: 0, calla: ['(sin token)'],
    log: (l) => (l[0] && l[0].autorizada ? null : 'la petición fue anónima pese a haber `GH_TOKEN`'),
  });

  // (x) El fallo llega en la página 2, con la 1 ya en la mano: el barrido entero
  // se descarta y se ANUNCIA. Adjudicar sobre medio corpus sería peor que no
  // adjudicar — las entradas selladas que no aparecieran pasarían por «borradas».
  casoRed('(x) HTTP no-ok en una página POSTERIOR ⇒ fail-open ANUNCIADO, VERDE, y NADA se adjudica a medias', {
    ledger: ledgerVigente([]),
    plan: [{ relleno: 100, desde: 5000 }, { status: 502 }],
  }, {
    exit: 0,
    dice: ['barrido vivo IMPOSIBLE sobre x/y', 'HTTP 502 en la página 2', 'sin token', 'barrido vivo OMITIDO'],
    calla: ['comentarios de x/y'],
  });

  casoRed('(y) TIMEOUT de la petición ⇒ fail-open ANUNCIADO, VERDE', {
    ledger: ledgerVigente([]), plan: [{ timeout: true }],
  }, { exit: 0, dice: ['barrido vivo IMPOSIBLE', 'aborted due to timeout', 'barrido vivo OMITIDO'] });

  // (z) El tope de páginas: 20 llenas ⇒ TRUNCADO. La mutación M7 de AP-074 medía
  // esto a mano bajando `MAX_PAGINAS`; aquí se ejecuta en cada CI. Se asierta que
  // el truncado aparece en el `::warning` Y en la línea del VERDE (AP-074: un
  // verde que no distingue barrido completo de truncado se lee como cobertura).
  casoRed('(z) 20 páginas llenas ⇒ TRUNCADO anunciado, en el verde, y ni una llamada de más', {
    ledger: ledgerVigente([]),
    plan: Array.from({ length: 20 }, (_, k) => ({ relleno: 100, desde: 9000 - k * 100 })),
  }, {
    exit: 0, dice: ['tope de 20 páginas', 'barrido TRUNCADO'],
    log: (l) => (l.length === 20 ? null : `el script hizo ${l.length} llamadas, esperaba el tope de 20`),
  });

  // (aa) EL HALLAZGO DE AP-076, congelado. Un comentario creado mientras
  // paginamos desplaza el corte y el último elemento de la página 1 REAPARECE al
  // principio de la 2. Sin dedupe: dos entradas con el mismo `id` en el sello, y
  // ese ledger es CORRUPTO según la propia L1 ⇒ ROJO en el CI de cualquier PR,
  // reparable solo re-sellando, lo que PIERDE todas las `nota`. El caso muere si
  // alguien quita el dedupe: la aserción sobre el ledger es la que muerde.
  casoRed('(aa) deriva de paginación: el mismo comentario en el corte de página ⇒ descartado por `id`, ANUNCIADO, y el sello sale SIN duplicados', {
    ledger: ledgerVigente([]), sellar: true,
    plan: [
      { relleno: 99, desde: 5000, items: [CORPUS_MARCADO] },
      { relleno: 99, desde: 4900, items: [CORPUS_MARCADO] },
      { relleno: 2, desde: 4800 },
    ],
  }, {
    exit: 0, dice: ['el corpus se movió DURANTE el barrido', '1 comentario(s) repetido(s)', 'sellado'],
    ledger: (t) => {
      if (!t) return 'no se escribió el ledger';
      const l = JSON.parse(t);
      const ids = l.entradas.map((e) => e.id);
      if (ids.length !== new Set(ids).size) return `el sello salió con ids DUPLICADOS (${JSON.stringify(ids)}) — su propia L1 lo declara corrupto`;
      if (ids.length !== 1) return `el sello tiene ${ids.length} entradas, esperaba 1`;
      // La otra mitad de la autodenuncia: (bb) fija la LECTURA de `barrido.doble`;
      // esto fija su ESCRITURA. Sin las dos, quitar una de ellas deja el camino
      // abierto y ningún caso muere.
      return l.barrido.doble === true ? null : 'el sello nacido con la red doblada NO quedó marcado con `barrido.doble: true`';
    },
  });

  // (bb) La autodenuncia del doble, simétrica a la del fixture (caso (k)): un
  // sello nacido con la red doblada, leído en modo producción, es ROJO. Sin esto
  // el doble sería el único camino del repo capaz de fabricar un ledger que
  // PARECE de producción.
  caso('(bb) ledger SELLADO con la RED DOBLADA leído en modo producción ⇒ ROJO', {
    ledger: ledgerVigente([], { doble: true }),
  }, { exit: 1, dice: ['doble de banco', 'no adjudica nada'] });

  casoRed('(cc) el VERDE de una corrida con la red doblada DECLARA que no dice nada de ningún repo real', {
    ledger: ledgerVigente([]), plan: [{ relleno: 2, desde: 5000 }],
  }, { exit: 0, dice: ['verde', 'RED DOBLADA', 'la red de este proceso está SUSTITUIDA'] });
}

// ── Veredicto ────────────────────────────────────────────────────────────────
if (fallos.length) {
  console.error('CHECK-RESOLVE-CORPUS-BANK ROJO:');
  fallos.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log(
  `check-resolve-corpus-bank verde: ${corridos} casos ejecutando \`scripts/check-resolve-corpus.mjs\` de verdad ` +
  '(subproceso, cwd temporal, sin red) — L1 con dientes, ledger corrupto bajo `--sellar` (residual (f) de AP-074), ' +
  'los dos rojos de L2, la unión CAPA∪ROL (AP-075), la supervivencia marcada de la `nota` y la capa de RED sobre el ' +
  'doble de `fetch` —paginación, `desc`, timeout, fail-open por HTTP y la deriva de paginación (residual (c) de AP-075, AP-076)—.'
);
