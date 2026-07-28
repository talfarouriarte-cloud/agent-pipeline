#!/usr/bin/env node
// check-embedded-js — valida la SINTAXIS de los scripts JS embebidos en los
// steps `actions/github-script` de todos los workflows. Nacido del incidente
// 2026-07-13: una edición rompió un template literal del scan del watchdog
// (SyntaxError en runtime), check-yaml lo dio por bueno (valida YAML, no el
// JS embebido) y las capas 2-3 de vigilancia estuvieron caídas horas — sin
// que nadie lo detectara, porque el roto era el detector. Las expresiones
// `${{ ... }}` se sustituyen por un placeholder (GitHub las interpola antes
// del runtime). Verde: exit 0.
//
// AP-059 (2026-07-28): cubre TAMBIÉN `templates/**` — no solo los workflows
// propios. `templates/watchdog-heartbeat.template.yml` es un workflow completo
// con ~150 líneas de github-script que el consumidor copia TAL CUAL, y no lo
// miraba ningún check: un SyntaxError ahí se despliega a mano y mata al
// vigilante del vigilante en silencio, que es la clase exacta que este script
// nació para cerrar (un piso más arriba). El propio AP-059 introdujo la
// regresión —un comentario JS abierto con `#` en vez de `//`— al editar ese
// template, y solo la cazó al extender esta cobertura.
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import yaml from 'js-yaml';

// Barrido RECURSIVO (`recursive: true`, Node ≥ 20) y no una lista horneada de
// subdirectorios: con `['…/workflows', 'templates', 'templates/stubs']` no
// recursivo, un `templates/<subdir-nuevo>/*.yml` quedaba fuera de cobertura EN
// SILENCIO y el único guard era un criterio falsable del AP («debe reportar N
// scripts») — mandato de memoria donde cabe mecanismo.
const DIRS = ['.github/workflows', 'templates'];
const tmp = mkdtempSync(join(tmpdir(), 'ejs-'));
const errors = [];
let checked = 0;

const files = DIRS.flatMap(d => {
  let names = [];
  try { names = readdirSync(d, { recursive: true }); } catch { return []; }   // directorio ausente: nada que validar
  return names.filter(f => /\.ya?ml$/.test(f)).sort().map(f => [d, f]);
});

for (const [DIR, f] of files) {
  const rel = `${DIR}/${f}`;
  let doc;
  try { doc = yaml.load(readFileSync(rel, 'utf8')); } catch { continue; } // check-yaml reporta
  for (const [jname, job] of Object.entries((doc && doc.jobs) || {})) {
    ((job && job.steps) || []).forEach((s, i) => {
      const script = s.with && s.with.script;
      if (typeof script !== 'string') return;
      checked++;
      // GH interpola ${{ ... }} antes del runtime: placeholder neutro.
      const src = '(async()=>{\n' + script.replace(/\$\{\{[^}]*\}\}/g, '0') + '\n})()';
      const fn = join(tmp, `${rel.replace(/\//g, '_')}-${jname}-${i}.js`);
      writeFileSync(fn, src);
      try { execFileSync('node', ['--check', fn], { stdio: 'pipe' }); }
      catch (e) {
        const msg = (e.stderr || '').toString().split('\n').find(l => l.includes('Error')) || 'SyntaxError';
        errors.push(`${rel} · job ${jname} · step ${i} («${(s.name || '').slice(0, 40)}»): ${msg.trim()}`);
      }
    });
  }
}

if (errors.length) {
  console.error('CHECK-EMBEDDED-JS ROJO (script embebido con sintaxis rota — fallará en runtime):');
  errors.forEach(e => console.error('  - ' + e));
  process.exit(1);
}
console.log(`check-embedded-js verde: ${checked} scripts embebidos parsean.`);
