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
// EL MARCADOR DE ROL SE INYECTA **SOLO DONDE FALTA**, y el matiz es una medida,
// no un refinamiento. AP-074 escribió aquí que «ningún comentario histórico puede
// llevarlo: lo obliga el prompt del parche PENDIENTE de `.github/workflows/**`».
// Es FALSO y se midió en AP-075: **2 de los 13** comentarios del corpus lo llevan
// NATIVO (los dos rulings de architect-resolve sobre el central#166). La premisa
// confundía dos mandatos distintos: el marcador de CAPA lo pide el prompt de
// `watchdog.yml` (pendiente en su parte de belt, pero VIVO en su parte de prompt)
// y el de ROL lo pide `vendored/docs-agents/watchdog.md`, mergeado desde #170 y
// vivo desde entonces. Los emite la MISMA sesión LLM por DOS mandatos
// independientes, luego cumplir uno no implica cumplir el otro.
//
// De ahí las dos consecuencias que este script implementa:
//
//   1. El corpus se selecciona por CAPA **∪ ROL**, no por CAPA a secas. El belt
//      keya por ROL; seleccionar por CAPA dejaba fuera, por construcción, un
//      comentario del resolver que cumpliera su mandato de ROL y olvidara el de
//      CAPA — es decir, prosa sobre la que el belt SÍ ESCRIBE y la sonda NO MIRA.
//      Hoy la intersección lo tapa (los 2 nativos llevan también CAPA), pero eso
//      es una coincidencia del corpus de hoy, no una propiedad. La unión es
//      estrictamente más ancha: nunca puede ver menos.
//   2. La inyección es CONDICIONAL y queda registrada por entrada (`rol`:
//      `nativo` | `inyectado`). Sin inyección la sonda mediría la rama «sin
//      marcador» —muda por diseño— y no la decisión que el belt tomará el día que
//      corra; con inyección indiscriminada perdía la distinción entre «el belt
//      escribiría aquí SI el emisor cumpliera» y «el belt escribirá aquí». La
//      injerencia sigue acotada: el marcador va en línea propia al final del
//      cuerpo y `escanear` despoja los comentarios HTML antes de segmentar, luego
//      no puede alterar ningún segmento.
//
// EL FIXTURE (`CHECK_RESOLVE_CORPUS_FIXTURE`) es la costura de BANCO, y su
// existencia es el cierre de la clase de #166 un piso por debajo de esta sonda:
// AP-074 verificó estas ramas con **6 mutaciones ejecutadas a mano en una sesión**,
// y nada las vuelve a correr. Con el fixture, `scripts/check-resolve-corpus-bank.mjs`
// las ejecuta en cada CI, sin red y sin flakear. Dos guards impiden que la costura
// se convierta en el atajo que falsifica el gate: en modo fixture el barrido se
// ANUNCIA como no-productivo, y el sello que produzca queda marcado
// (`barrido.fixture: true`) — un ledger así leído en modo producción es ROJO.
//
// EL DOBLE DE RED (`scripts/lib/fetch-doble.mjs`, AP-076) es la SEGUNDA costura, y
// existe porque la primera no podía cubrir lo que faltaba: el fixture sustituye el
// corpus entero y por tanto SALTA `barrer()`, que era el residual (c) de AP-075
// —«paginación, `direction: desc`, timeout y fail-open por HTTP siguen sin banco»—.
// El doble se instala por `--import` en el subproceso del banco y sustituye el
// `fetch` GLOBAL: `barrer()` corre ENTERA, con su bucle de páginas, su
// `AbortSignal` y su `throw` por HTTP. Se autodenuncia igual que el fixture
// (`barrido.doble: true` ⇒ ROJO leído en producción), y correrla destapó el fallo
// que arregla este AP: la paginación en `desc` sobre una lista que muta DUPLICA en
// el corte de página, y el sello salía con entradas repetidas que la propia L1
// declara corruptas. Ver el porqué entero sobre `barrer()`.
//
// Verde: exit 0.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import { resolve, dirname } from 'path';

const require = createRequire(import.meta.url);
const SELLAR = process.argv.includes('--sellar');
// Costura de banco. Ver la cabecera: solo la usa `check-resolve-corpus-bank.mjs`,
// se anuncia siempre y lo que sella queda marcado como no-productivo.
const FIXTURE = process.env.CHECK_RESOLVE_CORPUS_FIXTURE || null;
// La OTRA costura de banco (AP-076). El fixture sustituye el corpus ENTERO y por
// tanto SALTA `barrer()` de principio a fin, que era justo el residual (c) de
// AP-075: paginación, `desc`, timeout y fail-open por HTTP sin banco. El doble de
// `scripts/lib/fetch-doble.mjs` se instala por `--import` en el subproceso del
// banco y sustituye el `fetch` GLOBAL, no una rama de este script — `barrer()`
// corre entera y de verdad. Este flag no la habilita: solo LEE su huella, para
// que un sello nacido con la red doblada no pueda pasar por uno de producción
// (la misma autodenuncia que `barrido.fixture`, AP-075). Sin ella, el doble sería
// el único camino del repo capaz de producir un sello indistinguible del real.
const DOBLE = !!globalThis.__CHECK_RESOLVE_CORPUS_FETCH_DOBLE__;
const LEDGER = 'docs/corpus/resolve-cross-issue-corpus.json';
// La marca que conserva una `nota` cuya adjudicación es de un cuerpo ANTERIOR
// (residual (f) de AP-074): descartarla en silencio borraba el único texto libre
// del ledger justo cuando deja de ser fiable, que es cuando hace falta leerlo.
const NOTA_EDITADA = '[cuerpo editado desde la adjudicación] ';
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
// `ROL` entra en el contrato exigido junto a `CAPA_MARK` (AP-075): desde que el
// corpus se selecciona por la UNIÓN, perderlo no dejaría a la sonda muda del todo
// —seguiría viendo la rama CAPA— sino muda EXACTAMENTE en la mitad que el belt
// keya, que es el fallo caro y el silencioso.
if (typeof derivar !== 'function' || !PATRONES || !PATRONES.CAPA_MARK || !PATRONES.ROL) {
  rojo('el módulo ya no exporta `derivar` y `PATRONES.{CAPA_MARK,ROL}` — la sonda quedaría muda sin decirlo.');
}
const fuenteSha = sha256(readFileSync(fuente, 'utf8'));
const despoja = (s) => String(s || '').replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');

// ── L1 · calibración vigente (offline, con dientes) ──────────────────────────
// Un ledger CORRUPTO no mata la corrida ANTES de llegar al sello (residual (f) de
// AP-074, y era un defecto de utilidad, no de rigor): el script anuncia `--sellar`
// como su comando de reparación, y `--sellar` moría por la misma corrupción que
// venía a reparar. El caso más plausible de corrupción —un ledger editado a mano y
// mal cerrado— no tenía más salida que borrar el fichero, y nada lo decía. Ahora
// la corrupción se DIFIERE bajo `--sellar` (que lo reconstruye desde el corpus
// real) y sigue siendo ROJO fuera de él. Lo que se pierde al reconstruir —las
// `nota` de las entradas anteriores— se dice en voz alta, porque perderlas en
// silencio sería la clase que este gate existe para cerrar.
let ledger = null;
let corrupto = null;
if (existsSync(LEDGER)) {
  try { ledger = JSON.parse(readFileSync(LEDGER, 'utf8')); }
  catch (e) { corrupto = `no parsea como JSON (${e.message})`; }
}
if (!corrupto && ledger) {
  const mal = [];
  if (!ledger.modulo || typeof ledger.modulo.sha256 !== 'string') mal.push('falta `modulo.sha256`');
  if (!Array.isArray(ledger.entradas)) mal.push('`entradas` no es un array');
  if (mal.length) corrupto = `está mal formado — ${mal.join('; ')}`;
  else {
    const ids = ledger.entradas.map((e) => e.id);
    if (new Set(ids).size !== ids.length) corrupto = 'tiene entradas duplicadas por `id`';
    // Un sello de BANCO no puede pasar por sello de producción: la costura de
    // fixture se autodenuncia en cuanto se lee fuera de su modo. Sin esto, la
    // costura sería exactamente el atajo que `--sellar` sin barrido ya impide.
    else if (ledger.barrido && ledger.barrido.fixture && !FIXTURE) corrupto = 'se selló desde un FIXTURE de banco (`barrido.fixture: true`), no desde el corpus real — no adjudica nada';
    else if (ledger.barrido && ledger.barrido.doble && !DOBLE) corrupto = 'se selló con la red SUSTITUIDA por el doble de banco (`barrido.doble: true`), no contra la API real — no adjudica nada';
  }
}
if (corrupto) {
  if (SELLAR) {
    ledger = null;
    aviso(`\`${LEDGER}\` ${corrupto}: \`--sellar\` lo RECONSTRUYE desde el corpus real. Las \`nota\` de adjudicación de las entradas anteriores se PIERDEN — no son recuperables desde aquí.`);
  } else {
    rojo(
      `\`${LEDGER}\` ${corrupto}.\n` +
      '  Repáralo re-sellando (NO lo edites a mano):  node scripts/check-resolve-corpus.mjs --sellar\n' +
      '  Exige red, reconstruye el ledger desde el corpus real y PIERDE las `nota` de adjudicación de las entradas anteriores.'
    );
  }
}
if (!ledger && !SELLAR) {
  rojo(`falta \`${LEDGER}\` — la calibración del belt contra prosa real no existe. Créala con \`node scripts/check-resolve-corpus.mjs --sellar\` (exige red).`);
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
// EL DEDUPE POR `id` NO ES DEFENSA GENÉRICA: paga el precio que `desc` tiene y
// que nadie había puesto en la cuenta (AP-076, MEDIDO). Paginar por `page=N` una
// lista que MUTA durante el barrido deriva, y el sentido de la deriva lo fija el
// orden: en `desc` los comentarios nuevos entran por la CABEZA, luego cada
// comentario creado mientras barremos desplaza el corte de página hacia atrás y
// el último elemento de la página N REAPARECE al principio de la N+1. En `asc`
// no pasa (los nuevos entran por la cola). Es decir: `desc` sigue siendo la
// elección correcta —lo que se pierde al TRUNCAR es lo antiguo, ver arriba— pero
// tiene este precio, y sin pagarlo la elección es un fallo silencioso.
//
// Lo que costaba, medido de punta a punta: el duplicado entra dos veces en
// `entradasNuevas`, `--sellar` escribe un ledger con dos entradas del mismo `id`,
// y ese ledger es CORRUPTO según la propia L1 de este script («tiene entradas
// duplicadas por `id`») ⇒ ROJO en el CI de CUALQUIER PR abierto, cuya reparación
// anunciada es re-sellar, que PIERDE todas las `nota`. Un sello que se envenena
// a sí mismo, disparado por que alguien comente en el repo durante los 2,4 s del
// barrido — en un repo donde los bots comentan todo el rato.
//
// La deriva se ANUNCIA (aviso nominal): es información sobre el barrido, no un
// fallo del corpus. Y se anuncia en los TRES sitios que la sobreviven —el aviso, el
// campo `barrido.duplicados` del sello y la línea del verde—, igual que `truncado` y
// que `fixture`: el conteo es la única señal de que el corpus se MOVIÓ mientras se
// le miraba, y dejarlo morir en un `::warning` lo devuelve a la memoria de quien
// corrió el barrido, que es justo de donde este gate lo saca.
//
// Y la mitad simétrica —un comentario BORRADO a mitad de barrido desplaza el corte
// hacia delante y SALTA un elemento— no la cierra el dedupe y queda declarada como
// residual: exige paginación por cursor, no cabe aquí, y su frecuencia es la de los
// borrados, no la de las altas. `duplicados` es además su único PROXY observable:
// las dos son la misma deriva y solo una deja huella.
async function barrer(repoSlug, token) {
  const porId = new Map();
  let truncado = false;
  let duplicados = 0;
  for (let page = 1; page <= MAX_PAGINAS; page++) {
    const url = `https://api.github.com/repos/${repoSlug}/issues/comments?per_page=100&page=${page}&sort=created&direction=desc`;
    const cab = { Accept: 'application/vnd.github+json', 'User-Agent': 'check-resolve-corpus' };
    if (token) cab.Authorization = `Bearer ${token}`;
    const r = await fetch(url, { headers: cab, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r.ok) throw new Error(`HTTP ${r.status} en la página ${page}`);
    const lote = await r.json();
    for (const c of lote) {
      if (porId.has(c.id)) duplicados++;
      else porId.set(c.id, c);
    }
    if (lote.length < 100) break;
    if (page === MAX_PAGINAS) truncado = true;
  }
  return { comentarios: [...porId.values()], truncado, duplicados };
}

// El veredicto de UN comentario, normalizado a algo comparable y estable: el orden
// de `avisos` lo fija `escanear` (segmento a segmento) y no se reordena aquí — la
// CLASE y su multiplicidad son el dato que el epic-auditor cosecha (🔵 5 de AP-073).
// La inyección es CONDICIONAL (AP-075) y `rol` viaja FUERA del veredicto a
// propósito: el veredicto es lo que se contrasta contra el sello, y meterle un
// campo nuevo pondría ROJO las 13 entradas selladas por un cambio de esquema —un
// rojo que no es un hallazgo—. `rol` es un dato de la ENTRADA, y su consumidor es
// la lectura del rojo (ii): «nativo + materializa» es prosa sobre la que el belt
// ESCRIBIRÁ el día que se aplique el parche; «inyectado + materializa» es prosa
// sobre la que escribiría SI su emisor cumpliera el mandato del marcador.
function veredicto(c) {
  const raw = c.body || '';
  const nativo = PATRONES.ROL.test(despoja(raw));
  const cuerpo = nativo ? raw : `${raw}\n<!-- watchdog-rol: architect-resolve -->\n`;
  const { decl, avisos } = derivar([{ host: Number(String(c.issue_url || '').split('/').pop()), body: cuerpo, url: c.html_url }]);
  return {
    rol: nativo ? 'nativo' : 'inyectado',
    v: {
      materializa: Object.entries(decl)
        .map(([n, d]) => ({ n: Number(n), desStall: !!d.desStall, arm: !!d.arm }))
        .sort((a, b) => a.n - b.n),
      avisos: avisos.map((a) => a.clase),
    },
  };
}

const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const repoSlug = FIXTURE ? null : repoDelRun();
let vivo = null;
if (FIXTURE) {
  // Modo banco: el corpus sale de un fichero, no de la API. Se anuncia SIEMPRE —
  // un barrido que no es de producción no puede pasar por uno que lo sea— y lo
  // que selle queda marcado (`barrido.fixture`), lo que lo hace ROJO en cuanto
  // alguien lo lea en modo producción.
  aviso(`corpus de FIXTURE (\`${FIXTURE}\`), NO de producción: esta corrida no dice NADA del corpus real. Solo lo usa \`scripts/check-resolve-corpus-bank.mjs\`.`);
  let comentarios;
  try { comentarios = JSON.parse(readFileSync(FIXTURE, 'utf8')); }
  catch (e) { rojo(`el fixture \`${FIXTURE}\` no se puede leer (${e.message}).`); }
  if (!Array.isArray(comentarios)) rojo(`el fixture \`${FIXTURE}\` no es un array de comentarios.`);
  vivo = { comentarios, truncado: false, autenticado: false, duplicados: 0 };
} else if (!repoSlug) {
  aviso('no puedo derivar el repo del run (`GITHUB_REPOSITORY` ausente y sin remoto `origin` de GitHub) — barrido vivo OMITIDO.');
} else {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || null;
  try {
    const { comentarios, truncado, duplicados } = await barrer(repoSlug, token);
    if (truncado) aviso(`el barrido tocó el tope de ${MAX_PAGINAS} páginas en ${repoSlug}: hay comentarios ANTIGUOS sin mirar (el orden es \`desc\`, luego la prosa NUEVA sí entró entera). Sube \`MAX_PAGINAS\`.`);
    if (duplicados) aviso(`el corpus se movió DURANTE el barrido: ${duplicados} comentario(s) repetido(s) en el corte de página (alguien comentó mientras paginábamos en \`desc\`), descartado(s) por \`id\`. Sin el dedupe, el sello saldría con entradas duplicadas y su propia L1 lo declararía corrupto (AP-076).`);
    vivo = { comentarios, truncado, autenticado: !!token, duplicados };
  } catch (e) {
    // Fail-open ANUNCIADO: sin red, sin token en un repo privado o con el rate
    // limit agotado, L2 no puede correr. No es rojo — L1 ya mordió lo que se puede
    // juzgar offline, y un CI que se pone rojo por la red ajena enseña a ignorarlo.
    aviso(`barrido vivo IMPOSIBLE sobre ${repoSlug} (${e.message})${token ? '' : ' — sin token (`GH_TOKEN`/`GITHUB_TOKEN`)'}: la sonda NO se ha ejecutado en esta corrida, solo la calibración offline.`);
  }
}

let entradasNuevas = null;
let nativos = 0;
if (vivo) {
  // El corpus es la UNIÓN de CAPA y ROL (AP-075), y la unión no es celo: es el
  // único conjunto que contiene lo que el belt lee. El belt keya por ROL; la
  // selección era por CAPA sobre la premisa —medida FALSA en AP-075— de que
  // ningún comentario podía llevar el de ROL. Los dos marcadores los emite la
  // misma sesión LLM por DOS mandatos independientes (`watchdog.yml` pide el de
  // capa, `watchdog.md` el de rol), luego un comentario del resolver con ROL y
  // sin CAPA es construible hoy — y era, exactamente, prosa que el belt
  // materializa y la sonda no miraba: un rojo de MENOS, el lado que este diseño
  // declara caro. La rama CAPA se conserva entera: incluye los post-steps
  // deterministas hermanos, y eso es una PROPIEDAD, no ruido — si uno de ellos
  // derivara una materialización, la sonda la VE (rojo (ii)) aunque el belt en
  // runtime la fuera a descartar por no llevar marcador de ROL. Dicho con
  // precisión (🔵 2 de la review de AP-075): la clase de aviso
  // `sin-marcador-de-rol` del módulo NO puede aparecer en el ledger, porque la
  // sonda inyecta el marcador cuando falta; lo que cubre la rama CAPA es la
  // materialización, que es un rojo MÁS fuerte que ese aviso, no ese aviso.
  const capa = vivo.comentarios.filter((c) => {
    const d = despoja(c.body);
    return PATRONES.CAPA_MARK.test(d) || PATRONES.ROL.test(d);
  });

  const porId = new Map((ledger?.entradas || []).map((e) => [e.id, e]));
  const vistos = new Set();
  const rojos = [];
  const nominales = [];
  entradasNuevas = [];

  for (const c of capa) {
    const { rol, v } = veredicto(c);
    if (rol === 'nativo') nativos++;
    const cuerpoSha = sha256(c.body || '');
    const prev = porId.get(c.id);
    vistos.add(c.id);
    // La `nota` SOBREVIVE a la edición del cuerpo, marcada (residual (f) de
    // AP-074). Descartarla era una pérdida silenciosa del único texto libre del
    // ledger, justo en el momento en que deja de ser fiable — que es cuando hace
    // falta leerla, no cuando sobra. La marca es idempotente: re-sellar sobre una
    // nota ya marcada no la vuelve a prefijar.
    const notaPrev = (prev && prev.nota) || '';
    const nota = !notaPrev ? ''
      : prev.cuerpo_sha256 === cuerpoSha ? notaPrev
      : notaPrev.startsWith(NOTA_EDITADA) ? notaPrev
      : NOTA_EDITADA + notaPrev;
    entradasNuevas.push({
      id: c.id,
      url: c.html_url,
      host: Number(String(c.issue_url || '').split('/').pop()),
      cuerpo_sha256: cuerpoSha,
      rol,
      veredicto: v,
      nota,
    });

    if (!prev) {
      if (v.materializa.length) {
        rojos.push(
          `prosa real SIN ADJUDICAR que haría ESCRIBIR al belt: ${c.html_url} (#${c.id}) deriva ` +
          `${JSON.stringify(v.materializa)} (marcador de ROL ${rol === 'nativo' ? 'NATIVO — el belt escribirá ahí en cuanto se aplique el parche' : 'inyectado por la sonda — el belt escribiría ahí si su emisor cumpliera el mandato del marcador'}). ` +
          `Léela: si la declaración es legítima, séllala ` +
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

  // `nativos` entra en la línea de resumen porque es el número que refuta la
  // premisa con la que nació este gate («ningún comentario histórico puede llevar
  // el marcador de ROL»): un dato en prosa se pudre, uno impreso en cada corrida
  // no. Y es el que dice cuánta de la prosa medida es la que el belt leerá de
  // verdad frente a la que solo lee la sonda gracias a su inyección.
  console.log(
    `check-resolve-corpus · barrido vivo: ${vivo.comentarios.length} comentarios de ${FIXTURE ? `FIXTURE ${FIXTURE}` : repoSlug}, ` +
    `${capa.length} con marcador de capa o de ROL en línea propia (${nativos} con el de ROL NATIVO)${vivo.autenticado ? '' : ' (sin token)'}` +
    `${vivo.truncado ? ' · TRUNCADO por el tope de páginas: la cola antigua quedó fuera' : ''}.`
  );
}

// ── Sello ────────────────────────────────────────────────────────────────────
if (SELLAR) {
  if (!entradasNuevas) {
    rojo('`--sellar` sin barrido vivo: el sello certifica que el corpus REAL se ha vuelto a mirar, y sin red no se ha mirado nada. Sellar aquí produciría exactamente el dato-sin-consumidor que este gate existe para impedir.');
  }
  const salida = {
    _: 'Ledger de adjudicación del belt AP-064 sobre PROSA REAL. Lo escribe `scripts/check-resolve-corpus.mjs --sellar` (AP-074; la unión CAPA∪ROL y el campo `rol`, AP-075). NO se edita a mano: un veredicto tecleado que no reproduzca pone el barrido vivo ROJO, y un ledger corrupto se repara RE-SELLANDO —lo que pierde las `nota`—, no a mano.',
    modulo: { ruta: fuente, sha256: fuenteSha },
    barrido: {
      fecha: new Date().toISOString(),
      repo: FIXTURE ? `fixture:${FIXTURE}` : repoSlug,
      // `fixture: true` es lo que hace que la costura de banco no pueda pasar por
      // un sello de producción: leído sin `CHECK_RESOLVE_CORPUS_FIXTURE`, es ROJO.
      fixture: !!FIXTURE,
      // Lo mismo para el doble de red (AP-076): la costura se autodenuncia en el
      // artefacto que produce, no en la memoria de quien la usó.
      doble: DOBLE,
      comentarios: vivo.comentarios.length,
      con_marcador_de_capa_o_rol: entradasNuevas.length,
      con_marcador_de_rol_nativo: nativos,
      autenticado: vivo.autenticado,
      truncado: vivo.truncado,
      // `duplicados` es la ÚNICA señal observable de que el corpus SE MOVIÓ durante
      // el barrido, y por tanto el único proxy que este gate tiene del SALTO por
      // borrado —la mitad simétrica de la deriva, residual (a) de AP-076, que es un
      // rojo de MENOS y por construcción invisible—. Un sello nacido sobre un corpus
      // en movimiento es precisamente aquel cuya completitud está en duda: si vive
      // solo en el `::warning` de la corrida que lo produjo, dentro de tres meses
      // nadie puede saber si el ledger vigente se selló sobre un barrido quieto o
      // sobre uno derivando (🟡 3 de la review de AP-076).
      duplicados: vivo.duplicados,
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
const rolNativo = (ledger?.entradas || []).filter((e) => e.rol === 'nativo').length;
// `truncado` ENTRA en la línea de resumen y no solo en el `::warning`: un «verde»
// que no distingue barrido completo de barrido truncado se lee como cobertura
// total, que es la lectura falsa de #166 servida por el propio gate que la cierra.
// El MISMO argumento, y más fuerte, para `fixture` (🟡 2 de la review de AP-075):
// los dos guards de la costura protegen el SELLO —el barrido se anuncia y el
// ledger que produce queda marcado—, pero el VERDE, que es la última línea y la
// que se lee, era indistinguible de uno de producción. Un `::warning` arriba no
// desmiente un verde abajo: la degradación se dice en la línea que se lee.
const truncado = (vivo && vivo.truncado) || !!(ledger && ledger.barrido && ledger.barrido.truncado);
// Y el MISMO argumento para `duplicados`, que además es el único dato que dice si el
// corpus estaba QUIETO mientras se le miraba: se lee del barrido de hoy o, si hoy no
// hubo barrido, del que produjo el sello vigente — exactamente como `truncado`.
const derivado = (vivo && vivo.duplicados) || (ledger && ledger.barrido && ledger.barrido.duplicados) || 0;
console.log(
  `check-resolve-corpus verde: calibración VIGENTE contra ${fuente} (${fuenteSha.slice(0, 12)}), ` +
  `${(ledger?.entradas || []).length} comentario(s) real(es) adjudicado(s) (${rolNativo} con marcador de ROL NATIVO), ${materializan} materializaría(n)` +
  `${FIXTURE ? ` · corrida de FIXTURE (\`${FIXTURE}\`): NO dice NADA del corpus real` : ''}` +
  `${DOBLE ? ' · corrida con la RED DOBLADA (`scripts/lib/fetch-doble.mjs`): NO dice NADA de ningún repo real' : ''}` +
  `${vivo ? '' : ' · barrido vivo OMITIDO (ver aviso)'}` +
  `${truncado ? ' · barrido TRUNCADO (no es el corpus entero; ver aviso)' : ''}` +
  `${derivado ? ` · el corpus DERIVÓ durante el barrido: ${derivado} comentario(s) repetido(s) en el corte de página, descartado(s) por \`id\`` : ''}.`
);
