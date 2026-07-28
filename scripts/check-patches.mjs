#!/usr/bin/env node
// check-patches — consumidor mecánico de los parches PENDIENTES DE APLICACIÓN
// HUMANA (2026-07-28, hallazgo 🟡 6 de la review de AP-064).
//
// La GitHub App de claude-code-action no tiene permiso `workflows` (ADR-020),
// así que un cambio en `.github/workflows/**` producido por un agente no puede
// pushearse: viaja como `docs/patches/*.patch` y lo aplica un humano. Ese
// pendiente era un mandato de MEMORIA HUMANA sin consumidor — el patrón que
// este repo se comprometió a no acumular (AP-008) — y además tiene una forma
// de fallo silenciosa propia: el hunk va anclado a un fichero que el repo toca
// a menudo, luego el primer cambio que aterrice cerca lo rompe SIN RUIDO, y
// nadie se entera hasta que alguien intenta aplicarlo semanas después.
//
// Este check le pone consumidor. Para cada `docs/patches/*.patch`:
//   - aplica limpio          → PENDIENTE: se anuncia (una línea por parche,
//                              con el SHA contra el que se verificó si el
//                              propio parche lo declara). NO es rojo: el
//                              pendiente es legítimo hasta que el humano actúe.
//   - reverse-aplica limpio  → YA APLICADO: el parche es artefacto de
//                              provenance; se puede borrar. Tampoco es rojo.
//   - ninguna de las dos     → ROJO: el parche ha DERIVADO respecto del árbol.
//                              Ya no es aplicable y nadie lo sabía.
// Verde (o pendiente): exit 0. Corre en el CI del central.
//
// ─── El ANCLA de provenance también tiene consumidor (2026-07-28, AP-065) ───
//
// La cabecera del parche declara `# verificado-contra: <sha>` y afirmaba que
// «`check-patches.mjs` lo revalida en cada corrida de CI». NO lo hacía: lo
// IMPRIMÍA. La validación de arriba se hace contra el ÁRBOL DE TRABAJO, que es
// otra afirmación — luego el SHA era un dato tecleado a mano SIN consumidor,
// es decir la clase AP-008 exacta que este check nació para cerrar, un piso
// más abajo y dentro del propio gate. Podía nombrar un commit inexistente, o
// uno contra el que el parche jamás aplicó, sin que nada se pusiera rojo.
//
// Y el mantenimiento a mano no puede converger: escribir el SHA dentro del
// parche CAMBIA el parche, luego el commit que lo contiene nunca es el que
// nombra. Medido en AP-064: la ronda 2 declaró `a27743e` (su commit previo) y
// la ronda 3 lo «corrigió» a `cc3c440` (su commit previo) — el mismo desfase,
// arrastrado, dos veces cazado por lectura y dos veces «arreglado» subiendo el
// número.
//
// La salida es dejar de anclar al COMMIT y anclar a lo que el parche fija de
// verdad: su PRE-IMAGEN, los blobs `index <pre>..<post>` que el propio diff
// declara por fichero. Eso sí es un hecho estable y comprobable:
//   L1 (siempre, y funciona en clon shallow): el árbol debe estar en la
//      pre-imagen si el parche está PENDIENTE, y en la post-imagen si está
//      APLICADO. Si coincide, el ancla está VIGENTE y no hay que tocar el SHA
//      — que es lo que corta la rotación. Si no, el ancla está ESTANCADA
//      (`::warning`, nunca rojo: el parche sigue aplicando, solo que con
//      contexto y no byte a byte).
//   L2 (fail-open): si el commit declarado está PRESENTE en el clon, sus blobs
//      deben coincidir con la pre-imagen; si no coinciden, la cabecera afirma
//      algo FALSO ⇒ ROJO. Si el commit no está —`actions/checkout@v4` clona a
//      `fetch-depth: 1`, así que en CI normalmente NO estará— el contraste se
//      OMITE y se dice en la línea informativa del ancla, con CERO veredicto:
//      nunca un silencio, nunca un rojo espurio. Deliberadamente NO es
//      `::warning`: en CI ese caso se da en TODAS las corridas, y un aviso que
//      salta siempre deja de ser señal (por eso el nivel de esa línea lo fija
//      L1, que sí distingue estados). Sí son `::warning` los dos casos que son
//      anómalos de verdad: ancla ESTANCADA, y parche SIN cabecera
//      `# verificado-contra:` o del que no se puede derivar pre-imagen.
//
// El veredicto del ancla viaja como VALOR (`{ vigente, contrastado, nivel }`),
// no como substring de la prosa: enrutar el log o contar por `includes('…')`
// acopla dos decisiones mecánicas a la redacción de una frase — la misma clase
// AP-008 que este bloque cierra un piso más abajo (🟡 3 de la review de AP-065).
// ─── L3: los ESPEJOS del ancla en el corpus (2026-07-28, AP-069) ─────────────
//
// AP-065 dejó declarado el residual (b): «la cita del SHA en el cuerpo de
// AP-064 sigue siendo un espejo a mano sin consumidor; bajo AP-065 ya no hay
// que rotarlo, así que su forma de fallo pasa de "se pudre cada ronda" a "se
// pudre solo si `watchdog.yml` cambia", pero no se cierra aquí». Se pudrió en
// la ronda SIGUIENTE: AP-068 regeneró el parche de AP-064 (239 → 31 líneas) y
// movió su `# verificado-contra:` a `b6de3e3`, mientras `decisions.md` seguía
// afirmando «`cc3c440` sigue siendo correcto» — un enunciado FALSO sobre el
// ancla, en el registro normativo, dentro del propio AP que existe para que
// nadie lea un dato sin consumidor.
//
// El arreglo NO es rotar el espejo a mano otra vez (eso es lo que AP-065
// demostró que no converge): es darle consumidor. Un espejo se declara con un
// marcador anclado en `docs/decisions.md`,
//   ancla-espejo: <fichero>.patch = <sha>
// y este check exige que case con la cabecera `# verificado-contra:` del
// parche, que es la copia NORMATIVA. Mentir en el corpus pasa a ser ROJO.
//
// Dos precauciones, las dos con precedente en este repo:
//   · El marcador se exige en LÍNEA PROPIA y tras despojar los bloques
//     cercados, porque un marcador CITADO no es un marcador EMITIDO (clase
//     AP-063: EFECTUAR ≠ CITAR; en la ronda 2 de AP-064 un `body.includes(…)`
//     casó una review que citaba el marcador entre backticks y la sobrescribió).
//     Así el propio AP-069 puede DOCUMENTAR el marcador sin dispararlo.
//   · NO se exige que exista espejo: un AP puede no citar el SHA, y forzarlo
//     sería una política que este check no toma (misma forma que el residual
//     (c) de AP-065 sobre la cabecera ausente). Lo que se prohíbe es el espejo
//     que MIENTE, no el espejo que falta.
//
// La extracción de espejos es una función PURA con BANCO propio en este mismo
// fichero, y su ausencia (corpus movido o partido en volúmenes) es un fail-open
// ANUNCIADO: las dos cosas por la review de AP-069 (🟡 3 y 🟡 2), y las dos por
// la misma razón que el resto del fichero — una regex sobre prosa cuya única
// prueba es la lectura del diff, y un gate que deja de mirar sin decirlo, son
// las dos formas de esta clase.
import { readdirSync, existsSync, readFileSync } from 'fs';
import { execFileSync } from 'child_process';

const DIR = 'docs/patches';
const CORPUS = 'docs/decisions.md';
const errors = [];
const pendientes = [];
const aplicados = [];
const anclas = [];
const espejos = [];
const shaDeclarado = new Map();   // parche → SHA de su cabecera (la copia normativa)

const files = existsSync(DIR) ? readdirSync(DIR).filter(f => f.endsWith('.patch')).sort() : [];

const aplica = (file, reverse) => {
  const args = ['apply', '--check', ...(reverse ? ['--reverse'] : []), `${DIR}/${file}`];
  try { execFileSync('git', args, { stdio: 'pipe' }); return null; }
  catch (e) { return String(e.stderr || e.message).trim().split('\n')[0]; }
};

const git = (...args) => {
  try { return execFileSync('git', args, { stdio: 'pipe' }).toString().trim(); }
  catch { return null; }
};

// Pre/post-imágenes que el propio diff declara: `diff --git a/<p> b/<p>` y, a
// continuación, `index <pre>..<post>`. Los SHA vienen ABREVIADOS, así que toda
// comparación es por prefijo (y en la dirección correcta: el declarado es el
// corto). Un fichero nuevo lleva `0000000` como pre-imagen.
//
// Se trocea POR ENTRADA antes de buscar el `index` (🟡 2 de la review): un solo
// regex con `[\s\S]*?` entre la cabecera y el `index` no está acotado a la
// entrada, así que ante un `diff --git` SIN línea `index` —renombrado puro
// (`similarity index 100%` no casa `^index`) o cambio de modo puro— el lazy
// saltaría a la entrada siguiente y emparejaría el path de A con los blobs de
// B, perdiendo B de paso. Ese emparejamiento cruzado llega hasta L2, donde un
// blob que no casa es ROJO: un rojo espurio sobre un parche válido. Troceando,
// cruzar es estructuralmente imposible.
const imagenes = (txt) => {
  const out = [];
  for (const bloque of txt.split(/^(?=diff --git )/m)) {
    const cab = /^diff --git a\/(\S+) b\/\S+$/m.exec(bloque);
    if (!cab) continue;
    const idx = /^index ([0-9a-f]+)\.\.([0-9a-f]+)/m.exec(bloque);
    if (!idx) continue;   // rename/modo puros: no declaran blobs, no hay nada que contrastar
    out.push({ path: cab[1], pre: idx[1], post: idx[2] });
  }
  return out;
};

const casa = (largo, corto) => largo != null && corto != null && largo.startsWith(corto);
// L1/L2 comparan un SHA de 40 (`git hash-object`/`rev-parse`) contra el
// abreviado que el diff declara: ahí la dirección está garantizada. L3 no la
// tiene —las DOS puntas son texto tecleado, y la cabecera se lee con `{7,40}`—,
// luego compara sobre el prefijo del MÁS CORTO: una cabecera de 7 con un espejo
// de 40 daría si no un ROJO espurio que pide acortar el espejo, es decir
// converger por el lado equivocado (🔵 4 de la review de AP-069).
const casaPrefijo = (a, b) => {
  if (a == null || b == null) return false;
  const n = Math.min(a.length, b.length);
  return a.slice(0, n) === b.slice(0, n);
};
const NULO = (sha) => /^0+$/.test(sha);

// Verifica el ancla de UN parche. `aplicado` decide contra qué imagen se
// compara el árbol. Empuja a `anclas`/`errors`; nunca lanza.
//   `vigente`     — L1 dijo que el árbol ES la imagen esperada.
//   `contrastado` — L2 llegó a comparar contra el commit declarado (sirve de
//                   denominador honesto: sin él, el resumen contaba como
//                   «contrastadas» las anclas que nunca tocaron un commit).
//   `nivel`       — 'warn' ⇒ `::warning`; 'info' ⇒ línea `·`.
const verificarAncla = (f, sha, imgs, aplicado) => {
  // Sin ninguna entrada con `index` (parche de solo renombrados o solo modo) L1
  // y L2 quedan MUDAS a la vez: es la degradación total del ancla, y por eso
  // sale con aviso propio en vez de confundirse con un veredicto emitido.
  if (!imgs.length) { anclas.push({ f, vigente: false, contrastado: false, nivel: 'warn', msg: `${f}: ancla NO verificable — no se pudo derivar ninguna pre-imagen \`index <pre>..<post>\` del diff (¿renombrados o cambios de modo puros?): L1 y L2 quedan sin contraste, el ancla NO está comprobada` }); return; }

  // L1 — árbol vs imagen esperada. Se usa `git hash-object` sobre el fichero
  // del disco (no `rev-parse HEAD:<path>`) para que un árbol sucio —el de un
  // humano que acaba de hacer `git apply`— se lea por lo que ES, no por HEAD.
  const desfase = [];
  for (const { path, pre, post } of imgs) {
    const esperado = aplicado ? post : pre;
    // Imagen NULA = el fichero no existe en ese lado del diff, y eso vale para
    // las DOS combinaciones alcanzables (alta sin aplicar, borrado ya
    // aplicado): en ambas el árbol correcto es «ausente». La condición no
    // depende de `aplicado` — compararla contra él invertía la rama del
    // borrado aplicado (🟡 1 de la review).
    if (NULO(esperado)) { if (existsSync(path)) desfase.push(`${path} (debería estar ausente ${aplicado ? 'tras aplicar el borrado' : 'hasta aplicar el alta'}, y existe)`); continue; }
    const real = existsSync(path) ? git('hash-object', path) : null;
    if (!casa(real, esperado)) desfase.push(`${path} (árbol ${real ? real.slice(0, 7) : 'ausente'} ≠ ${aplicado ? 'post' : 'pre'}-imagen ${esperado})`);
  }
  const vigente = !desfase.length;
  const nivel = vigente ? 'info' : 'warn';
  const estado = vigente
    ? `VIGENTE — el árbol es exactamente la ${aplicado ? 'post' : 'pre'}-imagen declarada (${imgs.length} fichero(s)); NO hay que tocar \`verificado-contra:\``
    : `ESTANCADA — el parche sigue aplicando por contexto, pero el árbol ya no es byte a byte la ${aplicado ? 'post' : 'pre'}-imagen declarada: ${desfase.join(', ')}. Regenera el parche y actualiza \`verificado-contra:\``;

  // L2 — el commit declarado, si está en el clon.
  // Cabecera ausente: anómalo (el ancla no existe) ⇒ `::warning` propio, aunque
  // L1 esté VIGENTE. Commit ausente del clon: esperado en CI en cada corrida
  // ⇒ el nivel lo fija L1 y el dato viaja en la línea del ancla.
  if (!sha) { anclas.push({ f, vigente, contrastado: false, nivel: 'warn', msg: `${f}: ancla ${estado}. Sin \`# verificado-contra:\` en la cabecera: la provenance no se puede contrastar contra ningún commit` }); return; }
  if (git('cat-file', '-t', sha) !== 'commit') { anclas.push({ f, vigente, contrastado: false, nivel, msg: `${f}: ancla ${estado}. Commit declarado \`${sha}\` NO presente en el clon (esperable con \`fetch-depth: 1\`) ⇒ contraste contra commit OMITIDO` }); return; }

  const falsos = [];
  for (const { path, pre } of imgs) {
    const enSha = git('rev-parse', `${sha}:${path}`);
    if (NULO(pre)) { if (enSha) falsos.push(`${path} (declarado nuevo, pero ya existía en ${sha})`); continue; }
    if (!casa(enSha, pre)) falsos.push(`${path} (${sha} tiene ${enSha ? enSha.slice(0, 7) : 'nada'}, el parche declara pre-imagen ${pre})`);
  }
  if (falsos.length) errors.push(`${f}: ancla FALSA — la cabecera afirma \`verificado-contra: ${sha}\`, pero el parche NO fue generado contra ese árbol: ${falsos.join(', ')}. Corrige el SHA o regenera el parche.`);
  else anclas.push({ f, vigente, contrastado: true, nivel, msg: `${f}: ancla ${estado}. Contraste contra \`${sha}\`: pre-imagen CONFIRMADA en ese commit` });
};

for (const f of files) {
  // El parche puede declarar el SHA contra el que se verificó, en una línea de
  // comentario `# verificado-contra: <sha>` antes del primer `diff --git`.
  const txt = readFileSync(`${DIR}/${f}`, 'utf8');
  const cab = txt.split('diff --git')[0];
  const sha = /verificado-contra:\s*([0-9a-f]{7,40})/i.exec(cab);
  if (sha) shaDeclarado.set(f, sha[1]);
  const ref = sha ? ` (verificado contra ${sha[1]})` : '';
  const imgs = imagenes(txt);
  const fwd = aplica(f, false);
  if (!fwd) {
    pendientes.push(`${f}: aplica limpio — PENDIENTE de \`git apply ${DIR}/${f}\` por un humano${ref}`);
    verificarAncla(f, sha && sha[1], imgs, false);
    continue;
  }
  const rev = aplica(f, true);
  if (!rev) {
    aplicados.push(`${f}: ya aplicado en el árbol — artefacto de provenance, borrable`);
    verificarAncla(f, sha && sha[1], imgs, true);
    continue;
  }
  // DERIVADO: el ancla no se contrasta — el veredicto ya es rojo y añadir un
  // segundo diagnóstico sobre un parche inaplicable solo tapa el primero.
  errors.push(`${f}: DERIVADO — ni aplica ni reverse-aplica contra el árbol actual; el pendiente que transporta ya no es ejecutable. Regenéralo o bórralo. (git apply: ${fwd})`);
}

// ── L3 — espejos del ancla en el corpus ──
// El marcador se busca en LÍNEA PROPIA y sobre el texto con el código
// despojado: un marcador citado no es un marcador emitido (AP-063).
//
// El despojo cubre las TRES formas de citar que Markdown admite (🔵 5 de la
// review): bloques cercados con ``` o con ~~~ (de tres caracteres o más),
// spans de backticks EN LÍNEA —el mismo strip extra que el belt hace en
// `resolve-cross-issue-failsafe.cjs`— y, por la vía del ancla, los bloques de
// código INDENTADOS: en Markdown cuatro espacios (o un tabulador) abren bloque
// de código, luego un marcador solo cuenta como EMITIDO con sangría de 0 a 3
// ESPACIOS. Con `[ \t]*` la boca del bloque indentado quedaba viva: un marcador
// citado dentro de un ejemplo sangrado se leía como emitido.
//
// `INLINE` es defensa en profundidad y se declara como tal: MEDIDO por mutación
// —apagarlo deja el banco VERDE—, porque a quien rechaza el marcador entre
// backticks es al ANCLA (con un backtick delante, la línea ya no empieza por
// `<!--`). Se conserva por simetría con el strip que el belt hace en
// `resolve-cross-issue-failsafe.cjs` y porque el día que el ancla se relaje es
// la única red que queda; lo que NO se hace es venderlo como load-bearing.
const CERCA = /^[ \t]*(?:`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*(?:`{3,}|~{3,})[^\n]*$/gm;
const INLINE = /`+[^`\n]*`+/g;
const ESPEJO_RE = /^ {0,3}<!--\s*ancla-espejo:\s*([A-Za-z0-9._-]+\.patch)\s*=\s*([0-9a-f]{7,40})\s*-->[ \t]*$/gm;

// Extracción PURA, para que sus ramas tengan banco (🟡 3 de la review): la
// evidencia de que el despojo y el ancla hacen lo que dicen vivía en el body de
// un PR, y un banco que vive en un hilo es disciplina sin consumidor — en
// cuanto alguien toca una de estas tres regexes la evidencia ya no está y el
// cambio se juzga LEYENDO, que es la clase exacta que este script persigue.
export const espejosEmitidos = (texto) =>
  [...texto.replace(CERCA, '\n').replace(INLINE, ' ').matchAll(ESPEJO_RE)].map(([, f, sha]) => ({ f, sha }));

// Banco de L3 — [nombre, corpus de prueba, espejos esperados]. Corre en cada
// invocación: es barato (ocho cadenas en memoria) y su coste de NO correr es
// que la única prueba de L3 vuelva a ser la lectura del diff.
const MK = (f, sha) => `<!-- ancla-espejo: ${f} = ${sha} -->`;
const BANCO_L3 = [
  ['emitido en línea propia', `prosa\n${MK('A.patch', 'abc1234')}\nmás prosa`, [{ f: 'A.patch', sha: 'abc1234' }]],
  ['dos emitidos en el mismo corpus', `${MK('A.patch', 'abc1234')}\ntexto\n${MK('B.patch', 'beef0000000')}`, [{ f: 'A.patch', sha: 'abc1234' }, { f: 'B.patch', sha: 'beef0000000' }]],
  ['CITADO en bloque cercado con ```', `Así se emite:\n\`\`\`\n${MK('A.patch', 'dead000')}\n\`\`\`\n`, []],
  ['CITADO en bloque cercado con ~~~', `Así se emite:\n~~~\n${MK('A.patch', 'dead000')}\n~~~\n`, []],
  // Los dos siguientes los rechaza el ANCLA, no el strip (medido: apagar
  // `INLINE` deja el banco verde). Se conservan porque lo que el banco congela
  // es la CONDUCTA —citar no es emitir—, no qué línea la produce.
  ['CITADO entre backticks en línea', `El marcador \`${MK('A.patch', 'dead000')}\` va anclado.`, []],
  ['CITADO entre backticks ocupando la línea entera', `\`${MK('A.patch', 'dead000')}\`\n`, []],
  ['CITADO en bloque INDENTADO (4 espacios)', `Ejemplo:\n\n    ${MK('A.patch', 'dead000')}\n`, []],
  ['sangría de lista (3 espacios) SÍ es emisión', `- item:\n   ${MK('A.patch', 'abc1234')}\n`, [{ f: 'A.patch', sha: 'abc1234' }]],
  ['pegado a otro texto en la misma línea NO es emisión', `ver ${MK('A.patch', 'dead000')} aquí`, []],
];
for (const [nombre, txt, esperado] of BANCO_L3) {
  const got = espejosEmitidos(txt);
  if (JSON.stringify(got) !== JSON.stringify(esperado)) {
    errors.push(`banco de L3 — ${nombre}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(got)}. El extractor de espejos ya no hace lo que L3 declara: sus veredictos sobre ${CORPUS} NO son de fiar.`);
  }
}

// Fail-open ANUNCIADO, nunca mudo (🟡 2 de la review; misma doctrina que
// `check-resolve-detection`): si el corpus no está donde se le espera —el día
// que este repo lo parta en volúmenes, como ya hizo el corpus que consume
// `adr-lint.mjs`—, L3 no corre y TODOS los espejos dejan de estar vigilados. El
// único rastro sería un `0 espejo(s)` en el resumen, que nadie contrasta contra
// nada: exactamente la clase AP-008 que L3 nace para cerrar, un piso más arriba.
const l3Corrido = existsSync(CORPUS);
if (!l3Corrido) {
  console.log(`::warning::check-patches — no encuentro \`${CORPUS}\`: L3 NO se ha ejecutado y NINGÚN espejo del ancla está vigilado (¿se movió o se partió en volúmenes el corpus? Actualiza \`CORPUS\` en este script).`);
} else {
  const corpus = readFileSync(CORPUS, 'utf8');
  for (const { f, sha: espejo } of espejosEmitidos(corpus)) {
    if (!files.includes(f)) { errors.push(`${CORPUS}: espejo \`ancla-espejo: ${f}\` — ese parche NO existe en ${DIR}/. O se renombró y el espejo se quedó atrás, o el parche ya se aplicó y se borró: retira el espejo con él.`); continue; }
    const normativo = shaDeclarado.get(f);
    if (!normativo) { errors.push(`${CORPUS}: espejo \`ancla-espejo: ${f} = ${espejo}\` — el parche NO declara \`# verificado-contra:\` en su cabecera, luego el espejo no refleja nada: no hay copia normativa contra la que contrastarlo.`); continue; }
    // Las dos puntas son texto tecleado y cualquiera puede venir abreviada: se
    // compara sobre el prefijo del más corto (`casaPrefijo`), no en una
    // dirección supuesta.
    if (!casaPrefijo(normativo, espejo)) { errors.push(`${CORPUS}: espejo DESFASADO de \`${f}\` — el corpus declara \`${espejo}\` y la cabecera normativa del parche declara \`${normativo}\`. La cabecera manda (AP-065): actualiza el espejo a \`<!-- ancla-espejo: ${f} = ${normativo} -->\`.`); continue; }
    espejos.push(`${CORPUS}: espejo de \`${f}\` FIEL a la cabecera normativa (\`${espejo}\`)`);
  }
}

if (errors.length) { console.error('CHECK-PATCHES ROJO:'); errors.forEach(e => console.error('  - ' + e)); process.exit(1); }
for (const p of pendientes) console.log(`::warning::check-patches — ${p}`);
aplicados.forEach(a => console.log(`  · ${a}`));
// El ancla ESTANCADA, la que no se puede derivar y la que no declara commit se
// anuncian (nunca silencio); la VIGENTE se informa, porque «no hay que tocar el
// SHA» es justo el dato que la rotación de tres rondas de AP-064 no tuvo. El
// nivel viene DECIDIDO en `verificarAncla`, no re-derivado de la prosa.
for (const a of anclas) console.log(a.nivel === 'warn' ? `::warning::check-patches — ${a.msg}` : `  · ${a.msg}`);
espejos.forEach(e => console.log(`  · ${e}`));
const vigentes = anclas.filter(a => a.vigente).length;
const contrastadas = anclas.filter(a => a.contrastado).length;
// El estado de L3 se REPORTA, no se deduce del conteo: «0 espejos» y «L3 no
// corrió» son dos hechos distintos y el resumen no puede confundirlos.
const l3 = l3Corrido
  ? `${espejos.length} espejo(s) del ancla fiel(es) en ${CORPUS} (banco de L3: ${BANCO_L3.length} casos)`
  : `L3 NO ejecutado (${CORPUS} ausente): ningún espejo vigilado`;
console.log(`check-patches verde: ${files.length} parche(s) en ${DIR}/, ${pendientes.length} pendiente(s) de aplicación humana, ${aplicados.length} ya aplicado(s), 0 derivado(s), ${vigentes} ancla(s) vigente(s) de ${anclas.length} evaluada(s), ${contrastadas} contrastada(s) contra su commit declarado, ${l3}.`);
