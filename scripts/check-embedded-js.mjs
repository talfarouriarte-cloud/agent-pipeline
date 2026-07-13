#!/usr/bin/env node
// check-embedded-js — valida la SINTAXIS de los scripts JS embebidos en los
// steps `actions/github-script` de todos los workflows. Nacido del incidente
// 2026-07-13: una edición rompió un template literal del scan del watchdog
// (SyntaxError en runtime), check-yaml lo dio por bueno (valida YAML, no el
// JS embebido) y las capas 2-3 de vigilancia estuvieron caídas horas — sin
// que nadie lo detectara, porque el roto era el detector. Las expresiones
// `${{ ... }}` se sustituyen por un placeholder (GitHub las interpola antes
// del runtime). Verde: exit 0.
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import yaml from 'js-yaml';

const DIR = '.github/workflows';
const tmp = mkdtempSync(join(tmpdir(), 'ejs-'));
const errors = [];
let checked = 0;

for (const f of readdirSync(DIR).filter(f => /\.ya?ml$/.test(f)).sort()) {
  let doc;
  try { doc = yaml.load(readFileSync(`${DIR}/${f}`, 'utf8')); } catch { continue; } // check-yaml reporta
  for (const [jname, job] of Object.entries(doc.jobs || {})) {
    (job.steps || []).forEach((s, i) => {
      const script = s.with && s.with.script;
      if (typeof script !== 'string') return;
      checked++;
      // GH interpola ${{ ... }} antes del runtime: placeholder neutro.
      const src = '(async()=>{\n' + script.replace(/\$\{\{[^}]*\}\}/g, '0') + '\n})()';
      const fn = join(tmp, `${f}-${jname}-${i}.js`);
      writeFileSync(fn, src);
      try { execFileSync('node', ['--check', fn], { stdio: 'pipe' }); }
      catch (e) {
        const msg = (e.stderr || '').toString().split('\n').find(l => l.includes('Error')) || 'SyntaxError';
        errors.push(`${f} · job ${jname} · step ${i} («${(s.name || '').slice(0, 40)}»): ${msg.trim()}`);
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
