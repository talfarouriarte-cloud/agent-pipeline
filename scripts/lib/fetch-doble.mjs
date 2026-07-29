// fetch-doble — el DOBLE de red de `scripts/check-resolve-corpus.mjs` (AP-076).
//
// POR QUÉ EXISTE. AP-075 cerró el banco de la sonda sobre su costura de FIXTURE,
// que sustituye el corpus ENTERO por un fichero y por tanto salta `barrer()` de
// principio a fin. Su residual (c) lo dejó escrito verbatim: «el banco ejercita
// `check-resolve-corpus.mjs`, no la capa de red: `barrer()` —paginación,
// `direction: desc`, timeout, fail-open por HTTP— sigue sin banco, y la mutación
// M7 de AP-074 (que la midió a mano bajando `MAX_PAGINAS`) sigue siendo su única
// verificación». Esto es ese banco.
//
// POR QUÉ NO ES OTRA COSTURA EN EL SCRIPT. Se instala por `--import` en el
// subproceso del banco: `check-resolve-corpus.mjs` no cambia una línea de su capa
// de red y ejecuta su `barrer()` REAL —el bucle de páginas, el `AbortSignal`, el
// `throw` por HTTP y el fail-open que lo absorbe—. Lo que se sustituye es el
// `fetch` global, que es la frontera del proceso, no del script.
//
// TRES GUARDS, y ninguno es ceremonial (la doctrina de la costura de AP-075: una
// costura de banco se autodenuncia en cuanto sale de su modo):
//   1. Sin `CHECK_RESOLVE_CORPUS_FETCH_PLAN` el módulo es un NO-OP: importarlo por
//      accidente no puede desconectar la red de nadie.
//   2. Al instalarse lo ANUNCIA por stderr. Cualquier corrida que lo use lo dice
//      en su propio log, sin depender de que el script colabore.
//   3. Marca `globalThis.__CHECK_RESOLVE_CORPUS_FETCH_DOBLE__`, que el script lee
//      para estampar `barrido.doble: true` en lo que selle. Un ledger así, leído
//      en modo producción, es ROJO — igual que el sello de fixture. Sin esto el
//      doble sería el único camino del repo capaz de producir un sello que PARECE
//      de producción.
//
// EL PLAN es un JSON `{ paginas: [...] }` consumido EN ORDEN, una entrada por
// llamada. Cada entrada es una de:
//   { relleno: N, desde: ID }        → 200 con N comentarios sintéticos (ids desc)
//   { items: [...] }                 → 200 con esos comentarios (se concatenan tras el relleno)
//   { status: 4xx|5xx }              → respuesta no-ok (ejercita el `throw` de `barrer`)
//   { timeout: true }                → rechaza como lo hace `AbortSignal.timeout`
// Una llamada más allá del plan es un ERROR explícito, no una respuesta vacía:
// que el script pida más páginas de las previstas es un hallazgo, no un silencio.
//
// El log (`CHECK_RESOLVE_CORPUS_FETCH_LOG`) registra, por llamada, la URL, si
// llevaba `Authorization` y si llevaba `signal`. Es lo que permite al banco
// asertar `direction=desc`, `per_page=100`, la secuencia de `page=N` y que el
// timeout esté CABLEADO — no solo que exista la constante.
import { readFileSync, writeFileSync } from 'fs';

const PLAN = process.env.CHECK_RESOLVE_CORPUS_FETCH_PLAN || null;
const LOG = process.env.CHECK_RESOLVE_CORPUS_FETCH_LOG || null;

if (PLAN) {
  const plan = JSON.parse(readFileSync(PLAN, 'utf8'));
  const paginas = plan.paginas || [];
  const registro = [];
  let i = 0;

  const comentario = (id, host, body) => ({
    id,
    body,
    html_url: `https://github.com/x/y/issues/${host}#issuecomment-${id}`,
    issue_url: `https://api.github.com/repos/x/y/issues/${host}`,
  });

  globalThis.__CHECK_RESOLVE_CORPUS_FETCH_DOBLE__ = true;
  process.stderr.write(
    `::warning::fetch-doble — la red de este proceso está SUSTITUIDA por el plan \`${PLAN}\` (${paginas.length} respuesta(s)): esta corrida NO dice nada de ningún repo real.\n`
  );

  globalThis.fetch = async (url, init = {}) => {
    const cab = (init && init.headers) || {};
    registro.push({ url: String(url), autorizada: !!cab.Authorization, conSignal: !!(init && init.signal) });
    if (LOG) writeFileSync(LOG, JSON.stringify(registro, null, 2));
    const p = paginas[i++];
    if (!p) throw new Error(`fetch-doble: llamada ${i} fuera del plan (${paginas.length} previstas) — ${url}`);
    if (p.timeout) {
      // La misma forma con la que rechaza `fetch` cuando muerde `AbortSignal.timeout`.
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }
    const status = p.status || 200;
    const cuerpo = [];
    if (p.relleno) {
      // Ids DESCENDENTES, como el `direction=desc` que el script pide: el relleno
      // no puede contradecir al orden que el banco asierta.
      for (let k = 0; k < p.relleno; k++) cuerpo.push(comentario(p.desde - k, 1, `relleno ${p.desde - k}`));
    }
    for (const it of p.items || []) cuerpo.push(it);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => cuerpo,
    };
  };
}
