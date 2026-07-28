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
//      `fetch-depth: 1`, así que en CI normalmente NO estará— queda un aviso
//      nominal y CERO veredicto: nunca un silencio, nunca un rojo espurio.
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
const imagenes = (txt) => {
  const out = [];
  const re = /^diff --git a\/(\S+) b\/\S+$[\s\S]*?^index ([0-9a-f]+)\.\.([0-9a-f]+)/gm;
  for (const m of txt.matchAll(re)) out.push({ path: m[1], pre: m[2], post: m[3] });
  return out;
};

const casa = (largo, corto) => largo != null && corto != null && largo.startsWith(corto);
const NULO = (sha) => /^0+$/.test(sha);

// Verifica el ancla de UN parche. `aplicado` decide contra qué imagen se
// compara el árbol. Empuja a `anclas`/`errors`; nunca lanza.
const verificarAncla = (f, sha, imgs, aplicado) => {
  if (!imgs.length) { anclas.push(`${f}: ancla NO verificable — no se pudo derivar ninguna pre-imagen \`index <pre>..<post>\` del diff`); return; }

  // L1 — árbol vs imagen esperada. Se usa `git hash-object` sobre el fichero
  // del disco (no `rev-parse HEAD:<path>`) para que un árbol sucio —el de un
  // humano que acaba de hacer `git apply`— se lea por lo que ES, no por HEAD.
  const desfase = [];
  for (const { path, pre, post } of imgs) {
    const esperado = aplicado ? post : pre;
    if (NULO(esperado)) { if (existsSync(path) !== aplicado) desfase.push(`${path} (fichero nuevo: presencia inesperada)`); continue; }
    const real = existsSync(path) ? git('hash-object', path) : null;
    if (!casa(real, esperado)) desfase.push(`${path} (árbol ${real ? real.slice(0, 7) : 'ausente'} ≠ ${aplicado ? 'post' : 'pre'}-imagen ${esperado})`);
  }
  const estado = desfase.length
    ? `ESTANCADA — el parche sigue aplicando por contexto, pero el árbol ya no es byte a byte la ${aplicado ? 'post' : 'pre'}-imagen declarada: ${desfase.join(', ')}. Regenera el parche y actualiza \`verificado-contra:\``
    : `VIGENTE — el árbol es exactamente la ${aplicado ? 'post' : 'pre'}-imagen declarada (${imgs.length} fichero(s)); NO hay que tocar \`verificado-contra:\``;

  // L2 — el commit declarado, si está en el clon.
  if (!sha) { anclas.push(`${f}: ancla ${estado}. Sin \`# verificado-contra:\` en la cabecera: la provenance no se puede contrastar contra ningún commit`); return; }
  if (git('cat-file', '-t', sha) !== 'commit') { anclas.push(`${f}: ancla ${estado}. Commit declarado \`${sha}\` NO presente en el clon (esperable con \`fetch-depth: 1\`) ⇒ contraste contra commit OMITIDO`); return; }

  const falsos = [];
  for (const { path, pre } of imgs) {
    const enSha = git('rev-parse', `${sha}:${path}`);
    if (NULO(pre)) { if (enSha) falsos.push(`${path} (declarado nuevo, pero ya existía en ${sha})`); continue; }
    if (!casa(enSha, pre)) falsos.push(`${path} (${sha} tiene ${enSha ? enSha.slice(0, 7) : 'nada'}, el parche declara pre-imagen ${pre})`);
  }
  if (falsos.length) errors.push(`${f}: ancla FALSA — la cabecera afirma \`verificado-contra: ${sha}\`, pero el parche NO fue generado contra ese árbol: ${falsos.join(', ')}. Corrige el SHA o regenera el parche.`);
  else anclas.push(`${f}: ancla ${estado}. Contraste contra \`${sha}\`: pre-imagen CONFIRMADA en ese commit`);
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
// El ancla ESTANCADA o no contrastable se anuncia (nunca silencio); la VIGENTE
// se informa, porque «no hay que tocar el SHA» es justo el dato que la
// rotación de tres rondas de AP-064 no tuvo.
for (const a of anclas) console.log(a.includes('VIGENTE') ? `  · ${a}` : `::warning::check-patches — ${a}`);
const vigentes = anclas.filter(a => a.includes('VIGENTE')).length;
console.log(`check-patches verde: ${files.length} parche(s) en ${DIR}/, ${pendientes.length} pendiente(s) de aplicación humana, ${aplicados.length} ya aplicado(s), 0 derivado(s), ${vigentes} ancla(s) vigente(s) de ${anclas.length} contrastada(s).`);
