'use strict';
// absorcion — absorción de alcance de un issue encolado por OTRO PR, con
// consumidor mecánico (AP-122, central#307, ruling mensual 2026-11-01 punto 4).
//
// EL HUECO. Una adenda o ruling instruye a un PR a absorber el alcance de otro
// issue encolado #N, pero eso no dejaba estado: nadie retiraba `en-cola` de #N
// y el pop de cola armaba trabajo ya hecho. Ahora:
//  - el resolver, al adendar, publica en #N el marcador `cola-absorbida` y le
//    retira `en-cola` (mandato `watchdog.md`);
//  - el PR que absorbe lleva, a inicio de línea, `Absorbe #N` (mandato
//    `creator.md`);
//  - al MERGEAR ese PR, `epic-merge.yml` (`postMerge`) llama a
//    `materializarAbsorcion`: retira `en-cola`/`stalled`, pone
//    `estado:cierre-pendiente-humano`, comenta con el marcador y cierra
//    `completed`. El `issues:[closed]` resultante lo procesa `postStateClose`
//    (AP-031: label presente ⇒ consume los sentinels de #N);
//  - si el PR se CIERRA SIN MERGE, `cancelarAbsorcion` devuelve `en-cola` a
//    los #N que llevan el marcador de este PR (o de su issue).
//
// MARCADOR: `<!-- cola-absorbida: #<X> -->`, X = número del PR absorbente (o
// del issue absorbente si el PR aún no existe al adendar). Al leer, el número
// es opcional; la cancelación solo actúa sobre los marcadores de ESE PR/issue.
//
// ESPERA LEGÍTIMA (review PR #380, 🔴 1): un #N con absorción VIGENTE (último
// marcador `cola-absorbida` sin `cola-absorbida-cancelada` posterior) está
// abierto, armado y sin `en-cola`; el detector `issue-armed-no-pr` del Watchdog
// lo salta con `absorcionVigente` mientras el absorbente siga abierto.
//
// PROTEGIDOS (review PR #380, 🟡 3): `materializarAbsorcion` no cierra un #N
// con `serial-activo` (Creator en vuelo), kill-switch o de auditoría: aviso y
// sigue. No exige el marcador del resolver (AP-122 §4: `Absorbe #N` basta);
// la asimetría con la cancelación está declarada en AP-122 «Riesgos aceptados».
//
// La declaración `Absorbe #N` se lee por LÍNEA ANCLADA sobre el cuerpo
// despojado de código (jamás substring: «no Absorbe #12», «`Absorbe #12`» o
// `Absorbe#12` no declaran nada — clase AP-063).
//
// Zona de rigor `vendored/` (AP-068): todo diff despliega a los consumidores
// en su siguiente run. Banco: `scripts/check-absorcion.mjs`.

const { despojarCodigo } = require('./resolve-cross-issue-failsafe.cjs');

const ABSORBE_RE = /^Absorbe #(\d+)\s*$/;
const MARCA_RE = /<!--\s*cola-absorbida(?::\s*#(\d+))?\s*-->/g;
const marcaAbsorbida = (x) => `<!-- cola-absorbida: #${Number(x)} -->`;
const CANCELADA_RE = /<!--\s*cola-absorbida-cancelada\s*-->/;
const nombreLabel = (l) => (typeof l === 'string' ? l : (l && l.name) || '');
const PROTEGIDAS = ['serial-activo', 'human-needed', 'pause-agents', 'auditoria', 'auditoria-completa'];

// Números de issue declarados con `Absorbe #N` (uno por línea), sin duplicados.
function leerAbsorbidos(body) {
  const out = [];
  for (const linea of despojarCodigo(body).split(/\r?\n/)) {
    const m = linea.match(ABSORBE_RE);
    if (m && !out.includes(Number(m[1]))) out.push(Number(m[1]));
  }
  return out;
}

// Orígenes (números) citados por los marcadores `cola-absorbida` de un cuerpo
// despojado de código. `null` = marcador sin número.
function origenesMarca(body) {
  return [...despojarCodigo(body).matchAll(MARCA_RE)].map((m) => (m[1] ? Number(m[1]) : null));
}

// Absorción VIGENTE en los comentarios de un issue: `{ origen }` (X del último
// marcador `cola-absorbida`, `null` si no lleva número) cuando no hay un
// `cola-absorbida-cancelada` posterior; `null` si no hay absorción vigente.
function absorcionVigente(cs) {
  let ultimo = -1, origen = null;
  (cs || []).forEach((c, i) => {
    const os = origenesMarca(c.body || '');
    if (os.length) { ultimo = i; origen = os[os.length - 1]; }
  });
  if (ultimo < 0) return null;
  if ((cs || []).slice(ultimo + 1).some((c) => CANCELADA_RE.test(despojarCodigo(c.body || '')))) return null;
  return { origen };
}

async function comentarios({ github, owner, repo, issue_number }) {
  return github.paginate(github.rest.issues.listComments, { owner, repo, issue_number, per_page: 100 });
}

async function quitar({ github, owner, repo }, issue_number, name) {
  try { await github.rest.issues.removeLabel({ owner, repo, issue_number, name }); } catch (e) { /* ausente: ok */ }
}

// Merge del PR absorbente ⇒ cada #N abierto declarado queda cerrado por estado.
// Devuelve los números materializados. Fail-soft por issue (`warn`).
async function materializarAbsorcion({ github, owner, repo, prNumber, issues, warn = () => {} }) {
  const hechos = [];
  for (const n of issues || []) {
    try {
      const { data: it } = await github.rest.issues.get({ owner, repo, issue_number: n });
      if (it.state !== 'open' || it.pull_request) continue;
      const protegida = (it.labels || []).map(nombreLabel).find((l) => PROTEGIDAS.includes(l));
      if (protegida) { warn(`absorción #${n} (PR #${prNumber}): lleva \`${protegida}\` — no se cierra (trabajo vivo, kill-switch o auditoría).`); continue; }
      await quitar({ github, owner, repo }, n, 'en-cola');
      await quitar({ github, owner, repo }, n, 'stalled');
      await github.rest.issues.addLabels({ owner, repo, issue_number: n, labels: ['estado:cierre-pendiente-humano'] });
      const cs = await comentarios({ github, owner, repo, issue_number: n });
      const yaMaterializado = cs.some((c) => /<!--\s*cola-absorbida-mergeada\s*-->/.test(c.body || '')
        && origenesMarca(c.body).includes(Number(prNumber)));
      if (!yaMaterializado) {
        await github.rest.issues.createComment({ owner, repo, issue_number: n,
          body: `**epic-merge · absorción (AP-122)**: Alcance absorbido por el PR #${prNumber} mergeado (\`Absorbe #${n}\` en su body). Se retira \`en-cola\`/\`stalled\`, se pone \`estado:cierre-pendiente-humano\` y se cierra \`completed\`; el cierre por estado (AP-031) consume los sentinels de este issue.\n\n${marcaAbsorbida(prNumber)}\n<!-- cola-absorbida-mergeada -->` });
      }
      await github.rest.issues.update({ owner, repo, issue_number: n, state: 'closed', state_reason: 'completed' });
      hechos.push(n);
    } catch (e) { warn(`absorción #${n} (PR #${prNumber}): ${e.message}`); }
  }
  return hechos;
}

// PR absorbente cerrado SIN merge ⇒ devuelve `en-cola` a los #N abiertos que
// llevan un marcador `cola-absorbida` de este PR (o de su issue: `origenes`).
async function cancelarAbsorcion({ github, owner, repo, prNumber, origenes = [], issues, warn = () => {} }) {
  const validos = [prNumber, ...origenes].map(Number).filter((x) => x > 0);
  const hechos = [];
  for (const n of issues || []) {
    try {
      const { data: it } = await github.rest.issues.get({ owner, repo, issue_number: n });
      if (it.state !== 'open' || it.pull_request) continue;
      const cs = await comentarios({ github, owner, repo, issue_number: n });
      // Último marcador de ESTE origen; una cancelación posterior ya lo consumió.
      let ultimo = -1;
      cs.forEach((c, i) => { if (origenesMarca(c.body).some((o) => validos.includes(o))) ultimo = i; });
      if (ultimo < 0) continue;
      if (cs.slice(ultimo + 1).some((c) => CANCELADA_RE.test(c.body || ''))) continue;
      if (!(it.labels || []).some((l) => nombreLabel(l) === 'en-cola')) {
        await github.rest.issues.addLabels({ owner, repo, issue_number: n, labels: ['en-cola'] });
      }
      await github.rest.issues.createComment({ owner, repo, issue_number: n,
        body: `**epic-merge · absorción cancelada (AP-122)**: PR #${prNumber} cerrado sin merge; este issue vuelve a \`en-cola\` y lo arma el pop de cola por su orden.\n\n<!-- cola-absorbida-cancelada -->` });
      hechos.push(n);
    } catch (e) { warn(`cancelar absorción #${n} (PR #${prNumber}): ${e.message}`); }
  }
  return hechos;
}

module.exports = { leerAbsorbidos, origenesMarca, marcaAbsorbida, absorcionVigente, PROTEGIDAS, materializarAbsorcion, cancelarAbsorcion };
