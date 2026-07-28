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
import { readdirSync, existsSync, readFileSync } from 'fs';
import { execFileSync } from 'child_process';

const DIR = 'docs/patches';
const errors = [];
const pendientes = [];
const aplicados = [];
const anclas = [];

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

if (errors.length) { console.error('CHECK-PATCHES ROJO:'); errors.forEach(e => console.error('  - ' + e)); process.exit(1); }
for (const p of pendientes) console.log(`::warning::check-patches — ${p}`);
aplicados.forEach(a => console.log(`  · ${a}`));
// El ancla ESTANCADA, la que no se puede derivar y la que no declara commit se
// anuncian (nunca silencio); la VIGENTE se informa, porque «no hay que tocar el
// SHA» es justo el dato que la rotación de tres rondas de AP-064 no tuvo. El
// nivel viene DECIDIDO en `verificarAncla`, no re-derivado de la prosa.
for (const a of anclas) console.log(a.nivel === 'warn' ? `::warning::check-patches — ${a.msg}` : `  · ${a.msg}`);
const vigentes = anclas.filter(a => a.vigente).length;
const contrastadas = anclas.filter(a => a.contrastado).length;
console.log(`check-patches verde: ${files.length} parche(s) en ${DIR}/, ${pendientes.length} pendiente(s) de aplicación humana, ${aplicados.length} ya aplicado(s), 0 derivado(s), ${vigentes} ancla(s) vigente(s) de ${anclas.length} evaluada(s), ${contrastadas} contrastada(s) contra su commit declarado.`);
