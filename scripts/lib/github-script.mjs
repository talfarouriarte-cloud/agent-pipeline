// github-script — cargador COMPARTIDO de los bancos de steps `actions/github-script@v7`
// (central#318, ruling mensual 2026-10-05).
//
// POR QUÉ EXISTE. El guard de vuelo único (AP-100) llamaba a `getOctokit(...)` en su
// rama de bloqueo; `getOctokit` NO es un argumento de `actions/github-script@v7` y en
// el runner dio `ReferenceError` (asesoramiento#2707, run en rojo). Su banco
// (`check-flight-guard.mjs`) SÍ recorría esa rama y pasó en verde porque construía el
// script con un parámetro `getOctokit` inyectado y un mock: el banco simulaba un
// runtime que no existe. Cada banco construía su `AsyncFunction` a mano con la lista
// de parámetros que le convenía (`getOctokit`, `fetch`, `process`…), y cualquiera de
// ellos podía tapar un global inexistente o sombrear uno real.
//
// CONTRATO. El script se compila con EXACTAMENTE los argumentos que provee
// `actions/github-script@v7` — `github`, `context`, `core`, `glob`, `io`, `exec`,
// `require` — y nada más. Inyectar otro nombre es un ERROR del banco (lanza al
// llamar). Lo demás que un script usa (`fetch`, `process`, `setTimeout`…) son
// GLOBALES de Node en el runner igual que aquí: el banco los dobla en `globalThis`
// (opción `globales`) y en `process.env` (opción `env`) durante la llamada, y los
// restaura al salir. Un global que no existe en ninguno de los dos lados da
// `ReferenceError` en el banco igual que en el runner.
//
// Uso:
//   const run = cargarStep(script);
//   await run({ github, context, core }, { env: { X: '1' }, globales: { fetch } });
import { createRequire } from 'module';
import { join } from 'path';

export const ARGUMENTOS_GITHUB_SCRIPT = Object.freeze(['github', 'context', 'core', 'glob', 'io', 'exec', 'require']);

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// `glob`, `io` y `exec` existen en el runner; si el banco no los dobla, usarlos es un
// hallazgo (el banco no cubre esa costura), no un `undefined` silencioso.
const noDoblado = nombre => new Proxy({}, {
  get(_, prop) { throw new Error(`cargador: el script usa \`${nombre}.${String(prop)}\` y el banco no lo dobla`); },
});

export function cargarStep(script, nombre = 'step') {
  if (typeof script !== 'string') throw new Error(`cargador: ${nombre} sin script`);
  const fn = new AsyncFunction(...ARGUMENTOS_GITHUB_SCRIPT, script);
  return async (inyectados = {}, { env = null, globales = {} } = {}) => {
    const ajenos = Object.keys(inyectados).filter(k => !ARGUMENTOS_GITHUB_SCRIPT.includes(k));
    if (ajenos.length) {
      throw new Error(`cargador: ${nombre}: \`${ajenos.join('`, `')}\` no lo provee actions/github-script@v7 — prohibido inyectarlo (dóblalo como global si lo es en el runner)`);
    }
    const defecto = {
      glob: noDoblado('glob'), io: noDoblado('io'), exec: noDoblado('exec'),
      // github-script resuelve `require` desde el cwd del job (el checkout).
      require: createRequire(join(process.cwd(), 'noop.js')),
    };
    const args = ARGUMENTOS_GITHUB_SCRIPT.map(k => (k in inyectados ? inyectados[k] : defecto[k]));
    const envPrevio = process.env;
    const previos = Object.keys(globales).map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
    if (env) process.env = { ...envPrevio, ...env };
    for (const [k, v] of Object.entries(globales)) globalThis[k] = v;
    try {
      return await fn(...args);
    } finally {
      process.env = envPrevio;
      for (const [k, d] of previos) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
    }
  };
}
