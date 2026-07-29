#!/usr/bin/env node
// check-resolve-corpus — la SONDA sobre prosa REAL del belt `resolve-cross-issue-failsafe`
// (AP-064) deja de vivir en la sesión que la corrió y pasa a ser un gate del CI.
// Cierra el residual (b) de AP-073 y mecaniza la señal de disparo del (c).
//
// POR QUÉ EXISTE. AP-073 corrió `derivar` —la función real— sobre los comentarios
// reales del repo y encontró un FALSO POSITIVO que 28 casos sintéticos no vieron:
// el belt habría posteado `@claude arranca` sobre un issue que el resolver jamás
// declaró. La lección no fue «faltaban casos»: fue que los casos los escribía el
// mismo autor que escribía las regexes, luego no podían sorprender. El corpus real
// estaba a un `gh api` de distancia y nadie lo había corrido. AP-073 arregló los dos
// defectos y congeló los segmentos culpables como casos (o)–(s) del banco, pero
// dejó declarado, verbatim, que «la sonda vive en esta sesión, NO en el CI […]
// queda como trabajo disponible, no como decisión pendiente». Esto es ese trabajo.
//
// Un banco de casos congelados y una sonda sobre corpus vivo NO son lo mismo y no
// se sustituyen: el banco fija lo ya adjudicado (anti-regresión, offline, sin red);
// la sonda encuentra prosa que nadie ha visto todavía. El residual (c) de AP-073
// —«`FALLIDO` es vocabulario, luego se pudre; la señal de disparo para revisarlo es
// volver a correr la sonda sobre corpus real»— era un mandato de memoria: alguien
// tenía que acordarse. Aquí deja de serlo, porque el ancla de la calibración es el
// HASH DEL MÓDULO: tocar el vocabulario invalida la calibración y el CI lo exige.
//
// LAS DOS CAPAS, y por qué la de dientes es la que no necesita red:
//
//   L1 — CALIBRACIÓN VIGENTE (offline, SIEMPRE corre, ROJO).
//        `docs/corpus/resolve-cross-issue-corpus.json` sella el sha256 del módulo
//        contra el que se adjudicó el corpus. Si el módulo de hoy no es ése, la
//        adjudicación está CADUCADA: las regexes cambiaron y nadie ha vuelto a
//        mirarlas contra prosa real. Rojo. Es el mismo patrón que AP-065 aplicó al
//        ancla de los parches: anclar a un hecho ESTABLE y ponerle consumidor.
//        Solo se pone rojo en PRs que tocan el módulo — jamás en uno ajeno.
//
//   L2 — BARRIDO VIVO (exige red, FAIL-OPEN ANUNCIADO sin ella).
//        Re-deriva sobre los comentarios del repo del run y los contrasta con lo
//        sellado. Rojo en dos casos y solo en dos: (i) un veredicto SELLADO que ya
//        no reproduce —el sello se editó a mano, que es la clase AP-008 dentro del
//        gate que existe para cerrarla—, y (ii) prosa real NUEVA que haría ESCRIBIR
//        al belt sin que nadie la haya adjudicado. Todo lo demás (comentario
//        editado, comentario borrado, prosa nueva que no materializa) es aviso
//        NOMINAL: cola de adjudicación, no rojo. La dirección de este diseño es
//        deliberada — el coste de un rojo de más es un renglón de ledger; el de un
//        rojo de menos es que el belt escriba donde no debía, que el módulo califica
//        como el peor fallo de su clase.
//        L2 NO TIENE LA ASIMETRÍA DE L1, y hay que decirlo donde se lee: el rojo
//        (ii) es GLOBAL AL REPO, no al PR. Lo dispara prosa nueva de CUALQUIERA,
//        luego pone rojo el check de cualquier PR abierto —incluido uno que no
//        toca nada de esto— hasta que alguien selle y pushee el ledger. Y el
//        emisor más probable no es el resolver: el corpus se filtra por marcador
//        de CAPA, que llevan también los ~14 post-steps deterministas hermanos
//        (entre ellos el diag de rectificación en vuelo de AP-055, que interpola
//        encabezados ARBITRARIOS de `decisions.md`, con `#N` dentro). Desbloqueo:
//        `--sellar` + commit del ledger. Es fricción ACEPTADA, no un descuido —
//        acotarlo (p. ej. a comentarios posteriores a la fecha del sello)
//        reintroduciría la ventana ciega que la sonda existe para cerrar.
//
// EL SELLO NO SE PUEDE FALSIFICAR DESDE UN TECLADO. `--sellar` reescribe el ledger
// SOLO si L2 ha corrido de verdad en esa misma invocación; sin red se niega y lo
// dice. Sellar el hash nuevo sin volver a barrer es exactamente el atajo que
// convertiría esto en el dato-sin-consumidor que AP-065 tuvo que rescatar.
//
// EL MARCADOR DE ROL SE INYECTA, y hay que decirlo. Ningún comentario histórico
// puede llevarlo: lo obliga el prompt del parche PENDIENTE de `.github/workflows/**`
// (ADR-020). Sin inyección la sonda mediría la rama «sin marcador» —muda por
// diseño— y no la decisión que el belt tomará el día que corra. Con inyección mide
// lo que el belt HARÁ. La injerencia está acotada a eso: el marcador va en línea
// propia al final del cuerpo y `escanear` despoja los comentarios HTML antes de
// segmentar, luego no puede alterar ningún segmento.
//
// Verde: exit 0.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import { resolve, dirname } from 'path';

const require = createRequire(import.meta.url);
const SELLAR = process.argv.includes('--sellar');
const LEDGER = 'docs/corpus/resolve-cross-issue-corpus.json';
const MAX_PAGINAS = 20;          // 2000 comentarios; el truncado es ANUNCIADO
// Por página, no agregado. El peor caso teórico (20 páginas lentas-pero-vivas) son
// 5 min; el MEDIDO en el runner es 601 comentarios en 7 páginas y **2,4 s de reloj
// para el proceso entero** (2026-07-29), dos órdenes de magnitud por debajo. No se
// añade presupuesto global mientras la medida siga ahí: el fail-open que lo
// absorbería ya existe, y un timeout de más es un parámetro que nadie recalibra.
const TIMEOUT_MS = 15000;
const TOPE_AVISOS = 12;          // los avisos nominales también se truncan diciéndolo

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const rojo = (msg) => { console.error(`CHECK-RESOLVE-CORPUS ROJO: ${msg}`); process.exit(1); };
const aviso = (msg) => console.log(`::warning::check-resolve-corpus — ${msg}`);

// ── L0 · el módulo ───────────────────────────────────────────────────────────
// Mismas dos ubicaciones y mismo orden que `check-resolve-detection`: el central
// lo tiene en `vendored/` (el fichero FUENTE, el que un PR modifica) y el
// workspace del consumidor lo recibe en `scripts/` por el graft (AP-009).
const FUENTES = [
  'vendored/scripts/resolve-cross-issue-failsafe.cjs',
  'scripts/resolve-cross-issue-failsafe.cjs',
];
let fuente = null;
let belt = null;
for (const f of FUENTES) {
  if (!existsSync(f)) continue;
  belt = require(resolve(f));
  fuente = f;
  break;
}
if (!belt) {
  // Fail-open ANUNCIADO, nunca mudo: sin módulo no hay nada que calibrar — pero
  // que no lo haya tiene que verse. Es la misma decisión que toma el banco.
  aviso('no encuentro `resolve-cross-issue-failsafe.cjs` en ninguna de sus dos ubicaciones: la sonda NO se ha ejecutado.');
  process.exit(0);
}
const { derivar, PATRONES } = belt;
if (typeof derivar !== 'function' || !PATRONES || !PATRONES.CAPA_MARK) {
  rojo('el módulo ya no exporta `derivar` y `PATRONES.CAPA_MARK` — la sonda quedaría muda sin decirlo.');
}
const fuenteSha = sha256(readFileSync(fuente, 'utf8'));

// ── L1 · calibración vigente (offline, con dientes) ──────────────────────────
let ledger = null;
if (existsSync(LEDGER)) {
  try { ledger = JSON.parse(readFileSync(LEDGER, 'utf8')); }
  catch (e) { rojo(`\`${LEDGER}\` no parsea como JSON (${e.message}).`); }
}
if (!ledger && !SELLAR) {
  rojo(`falta \`${LEDGER}\` — la calibración del belt contra prosa real no existe. Créala con \`node scripts/check-resolve-corpus.mjs --sellar\` (exige red).`);
}
if (ledger) {
  const mal = [];
  if (!ledger.modulo || typeof ledger.modulo.sha256 !== 'string') mal.push('falta `modulo.sha256`');
  if (!Array.isArray(ledger.entradas)) mal.push('`entradas` no es un array');
  if (mal.length) rojo(`\`${LEDGER}\` mal formado — ${mal.join('; ')}.`);
  const ids = ledger.entradas.map((e) => e.id);
  if (new Set(ids).size !== ids.length) rojo(`\`${LEDGER}\` tiene entradas duplicadas por \`id\`.`);
}

// El rojo de L1 se DIFIERE hasta después de L2 cuando se está sellando: sellar es
// justo la operación que viene a repararlo. Fuera de `--sellar` muerde aquí.
const caducada = ledger && ledger.modulo.sha256 !== fuenteSha;
if (caducada && !SELLAR) {
  rojo(
    `la calibración contra prosa real está CADUCADA. \`${fuente}\` es ahora ${fuenteSha.slice(0, 12)} y el corpus se adjudicó contra ${String(ledger.modulo.sha256).slice(0, 12)}.\n` +
    '  El vocabulario de decisión del belt cambió y nadie lo ha vuelto a medir contra la prosa que el rol produce de verdad — que es exactamente como se coló el falso positivo de AP-073.\n' +
    '  Re-corre la sonda y vuelve a sellar:  node scripts/check-resolve-corpus.mjs --sellar\n' +
    '  (exige red; el sello se niega a escribirse si el barrido vivo no ha corrido).'
  );
}

// ── L2 · barrido vivo ────────────────────────────────────────────────────────
function repoDelRun() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const m = url.match(/github\.com[:/]([^/]+\/[^/.]+)/);
    if (m) return m[1];
  } catch { /* sin remoto: se anuncia abajo */ }
  return null;
}

// `direction=desc` NO es cosmético y no se toca sin leer esto (🟡 4 de la review
// de AP-074). El barrido tiene tope, luego algún día TRUNCA; lo que se decide con
// el orden es QUÉ mitad se pierde al truncar. En `asc` se pierden los comentarios
// MÁS NUEVOS — que son exactamente los que esta sonda existe para ver: «el banco
// fija lo ya adjudicado; la sonda encuentra lo que aún no lo está». Sería un rojo
// de MENOS —el lado que este diseño declara caro— y además silencioso, porque el
// truncado no puede poner rojo. En `desc` lo que cae fuera son entradas antiguas
// YA selladas, y su caída degrada al aviso nominal que ya existe («entrada sellada
// que ya no aparece en el corpus»). El fail-open se mueve al lado barato.
// Y no es una opinión nueva: el MÓDULO que esta sonda calibra ya pagina así, con
// ese porqué escrito (`resolve-cross-issue-failsafe.cjs:261-266`, «el truncado
// tiene que morder por el extremo que NO importa»). La sonda nació contradiciendo
// en su paginación al belt cuya paginación mide; ahora coinciden.
async function barrer(repoSlug, token) {
  const comentarios = [];
  let truncado = false;
  for (let page = 1; page <= MAX_PAGINAS; page++) {
    const url = `https://api.github.com/repos/${repoSlug}/issues/comments?per_page=100&page=${page}&sort=created&direction=desc`;
    const cab = { Accept: 'application/vnd.github+json', 'User-Agent': 'check-resolve-corpus' };
    if (token) cab.Authorization = `Bearer ${token}`;
    const r = await fetch(url, { headers: cab, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r.ok) throw new Error(`HTTP ${r.status} en la página ${page}`);
    const lote = await r.json();
    comentarios.push(...lote);
    if (lote.length < 100) return { comentarios, truncado };
    if (page === MAX_PAGINAS) truncado = true;
  }
  return { comentarios, truncado };
}

// El veredicto de UN comentario, normalizado a algo comparable y estable: el orden
// de `avisos` lo fija `escanear` (segmento a segmento) y no se reordena aquí — la
// CLASE y su multiplicidad son el dato que el epic-auditor cosecha (🔵 5 de AP-073).
function veredicto(c) {
  const cuerpo = `${c.body || ''}\n<!-- watchdog-rol: architect-resolve -->\n`;
  const { decl, avisos } = derivar([{ host: Number(String(c.issue_url || '').split('/').pop()), body: cuerpo, url: c.html_url }]);
  return {
    materializa: Object.entries(decl)
      .map(([n, d]) => ({ n: Number(n), desStall: !!d.desStall, arm: !!d.arm }))
      .sort((a, b) => a.n - b.n),
    avisos: avisos.map((a) => a.clase),
  };
}

const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const repoSlug = repoDelRun();
let vivo = null;
if (!repoSlug) {
  aviso('no puedo derivar el repo del run (`GITHUB_REPOSITORY` ausente y sin remoto `origin` de GitHub) — barrido vivo OMITIDO.');
} else {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || null;
  try {
    const { comentarios, truncado } = await barrer(repoSlug, token);
    if (truncado) aviso(`el barrido tocó el tope de ${MAX_PAGINAS} páginas en ${repoSlug}: hay comentarios ANTIGUOS sin mirar (el orden es \`desc\`, luego la prosa NUEVA sí entró entera). Sube \`MAX_PAGINAS\`.`);
    vivo = { comentarios, truncado, autenticado: !!token };
  } catch (e) {
    // Fail-open ANUNCIADO: sin red, sin token en un repo privado o con el rate
    // limit agotado, L2 no puede correr. No es rojo — L1 ya mordió lo que se puede
    // juzgar offline, y un CI que se pone rojo por la red ajena enseña a ignorarlo.
    aviso(`barrido vivo IMPOSIBLE sobre ${repoSlug} (${e.message})${token ? '' : ' — sin token (`GH_TOKEN`/`GITHUB_TOKEN`)'}: la sonda NO se ha ejecutado en esta corrida, solo la calibración offline.`);
  }
}

let entradasNuevas = null;
if (vivo) {
  const despoja = (s) => String(s || '').replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
  // El corpus es el de la CAPA, no el del ROL, y la diferencia importa: ningún
  // comentario histórico lleva el marcador de rol (lo obliga el parche pendiente),
  // así que filtrar por rol daría corpus vacío. El de capa es el superconjunto
  // más estrecho disponible — incluye los post-steps deterministas hermanos, y
  // eso es una PROPIEDAD, no ruido: si uno de ellos derivara una materialización,
  // el belt tendría un vecino capaz de disparar su aviso.
  const capa = vivo.comentarios.filter((c) => PATRONES.CAPA_MARK.test(despoja(c.body)));

  const porId = new Map((ledger?.entradas || []).map((e) => [e.id, e]));
  const vistos = new Set();
  const rojos = [];
  const nominales = [];
  entradasNuevas = [];

  for (const c of capa) {
    const v = veredicto(c);
    const cuerpoSha = sha256(c.body || '');
    const prev = porId.get(c.id);
    vistos.add(c.id);
    entradasNuevas.push({
      id: c.id,
      url: c.html_url,
      host: Number(String(c.issue_url || '').split('/').pop()),
      cuerpo_sha256: cuerpoSha,
      veredicto: v,
      nota: prev && prev.cuerpo_sha256 === cuerpoSha ? (prev.nota || '') : '',
    });

    if (!prev) {
      if (v.materializa.length) {
        rojos.push(
          `prosa real SIN ADJUDICAR que haría ESCRIBIR al belt: ${c.html_url} (#${c.id}) deriva ` +
          `${JSON.stringify(v.materializa)}. Léela: si la declaración es legítima, séllala ` +
          `(\`--sellar\`) y queda registrada; si no lo es, es un falso positivo de la misma clase que AP-073 y el arreglo va en el módulo.`
        );
      } else {
        nominales.push(`prosa de esta capa sin adjudicar (no materializa nada): ${c.html_url}${v.avisos.length ? ` · avisos: ${v.avisos.join(', ')}` : ''}`);
      }
      continue;
    }
    if (prev.cuerpo_sha256 !== cuerpoSha) {
      nominales.push(`comentario EDITADO desde el sello: ${c.html_url} — su veredicto vuelve a estar sin adjudicar${igual(prev.veredicto, v) ? ' (el veredicto no cambió)' : ` (veredicto AHORA ${JSON.stringify(v)})`}.`);
      continue;
    }
    if (!igual(prev.veredicto, v)) {
      rojos.push(
        `veredicto SELLADO que ya no reproduce sobre ${c.html_url}: el ledger dice ${JSON.stringify(prev.veredicto)} y la derivación de hoy da ${JSON.stringify(v)}, ` +
        'con el cuerpo del comentario byte a byte idéntico y el sha del módulo en su sitio. O el ledger se editó a mano, o el módulo cambió sin que L1 lo viera.'
      );
    }
  }

  for (const e of (ledger?.entradas || [])) {
    if (!vistos.has(e.id)) nominales.push(`entrada sellada que ya no aparece en el corpus (comentario borrado, o fuera del barrido): ${e.url || e.id}.`);
  }

  nominales.slice(0, TOPE_AVISOS).forEach(aviso);
  if (nominales.length > TOPE_AVISOS) aviso(`… y ${nominales.length - TOPE_AVISOS} aviso(s) nominal(es) más, truncados.`);

  if (rojos.length && !SELLAR) {
    console.error('CHECK-RESOLVE-CORPUS ROJO (barrido vivo):');
    rojos.forEach((r) => console.error('  - ' + r));
    process.exit(1);
  }
  if (rojos.length && SELLAR) {
    // Sellar NO es una amnistía silenciosa: lo que se selle queda escrito, pero el
    // humano/agente que sella tiene que haber leído esto.
    console.log('::warning::check-resolve-corpus — SELLANDO sobre hallazgos que habrían sido ROJO; quedan adjudicados por este sello:');
    rojos.forEach((r) => console.log(`::warning::  - ${r}`));
  }

  console.log(
    `check-resolve-corpus · barrido vivo: ${vivo.comentarios.length} comentarios de ${repoSlug}, ` +
    `${capa.length} con marcador de capa en línea propia${vivo.autenticado ? '' : ' (sin token)'}` +
    `${vivo.truncado ? ' · TRUNCADO por el tope de páginas: la cola antigua quedó fuera' : ''}.`
  );
}

// ── Sello ────────────────────────────────────────────────────────────────────
if (SELLAR) {
  if (!entradasNuevas) {
    rojo('`--sellar` sin barrido vivo: el sello certifica que el corpus REAL se ha vuelto a mirar, y sin red no se ha mirado nada. Sellar aquí produciría exactamente el dato-sin-consumidor que este gate existe para impedir.');
  }
  const salida = {
    _: 'Ledger de adjudicación del belt AP-064 sobre PROSA REAL. Lo escribe `scripts/check-resolve-corpus.mjs --sellar` (AP-074); NO se edita a mano — un veredicto tecleado que no reproduzca pone el barrido vivo ROJO.',
    modulo: { ruta: fuente, sha256: fuenteSha },
    barrido: {
      fecha: new Date().toISOString(),
      repo: repoSlug,
      comentarios: vivo.comentarios.length,
      con_marcador_de_capa: entradasNuevas.length,
      autenticado: vivo.autenticado,
      truncado: vivo.truncado,
    },
    entradas: entradasNuevas.sort((a, b) => a.id - b.id),
  };
  mkdirSync(dirname(LEDGER), { recursive: true });
  writeFileSync(LEDGER, JSON.stringify(salida, null, 2) + '\n');
  console.log(
    `check-resolve-corpus: sellado ${LEDGER} — módulo ${fuenteSha.slice(0, 12)}, ${salida.entradas.length} entrada(s) adjudicada(s)` +
    `${vivo.truncado ? ' · sobre un barrido TRUNCADO: lo sellado NO es el corpus entero (falta la cola antigua)' : ''}.`
  );
  process.exit(0);
}

const materializan = (ledger?.entradas || []).filter((e) => e.veredicto && e.veredicto.materializa.length).length;
// `truncado` ENTRA en la línea de resumen y no solo en el `::warning`: un «verde»
// que no distingue barrido completo de barrido truncado se lee como cobertura
// total, que es la lectura falsa de #166 servida por el propio gate que la cierra.
const truncado = (vivo && vivo.truncado) || !!(ledger && ledger.barrido && ledger.barrido.truncado);
console.log(
  `check-resolve-corpus verde: calibración VIGENTE contra ${fuente} (${fuenteSha.slice(0, 12)}), ` +
  `${(ledger?.entradas || []).length} comentario(s) real(es) adjudicado(s), ${materializan} materializaría(n)` +
  `${vivo ? '' : ' · barrido vivo OMITIDO (ver aviso)'}` +
  `${truncado ? ' · barrido TRUNCADO (no es el corpus entero; ver aviso)' : ''}.`
);
