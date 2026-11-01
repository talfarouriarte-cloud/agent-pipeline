#!/usr/bin/env node
// sync-labels — sincroniza `templates/labels.json` con el central y los dos
// consumidores (AP-132, central#319). Nada creaba las labels de la plantilla en
// los repos: las de AP-102/AP-103 llegaron a `main` sin existir en ningún repo,
// el propietario las creó y recortó a mano (5-oct), y `process-review-pendiente`
// seguía ausente en wmcb.
//
// Idempotente: crea las que falten y alinea color y descripción de las que
// difieran. NUNCA borra: `plan` no emite operaciones de borrado y este fichero no tiene
// ninguna llamada de borrado; una label del repo que no está en la plantilla
// (las dinámicas `estado:*`, `rondas:N` de check-labels.mjs) se ignora. No
// recorta: una descripción > 100 caracteres (límite de GitHub) es error y el
// runner sale con 1 antes de la primera llamada a la API.
//
// Lo corre `self-sync-labels.yml` en push a `main` que toque la plantilla o este
// script, y por dispatch. Token: `LABELS_SYNC_TOKEN` (PAT con Issues: write en
// los tres repos); sin él, no-op con notice. Banco: `check-sync-labels.mjs`.
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';

export const REPOS = [
  'talfarouriarte-cloud/agent-pipeline',
  'talfarouriarte-cloud/asesoramiento-financiero',
  'talfarouriarte-cloud/what-money-cant-buy',
];
export const MAX_DESC = 100;
const API = 'https://api.github.com';

const norm = c => String(c || '').replace(/^#/, '').toLowerCase();

export function validar(template) {
  const largas = template.filter(l => [...(l.description || '')].length > MAX_DESC);
  if (largas.length) {
    throw new Error(`descripción > ${MAX_DESC} caracteres en la plantilla: ${largas.map(l => `${l.name} (${[...l.description].length})`).join(', ')}`);
  }
}

// Pura: plantilla + labels existentes del repo ⇒ operaciones. Solo recorre la
// plantilla, así que una label ajena no puede producir operación ninguna.
export function plan(template, existing) {
  validar(template);
  const porNombre = new Map(existing.map(l => [l.name, l]));
  const ops = [];
  for (const t of template) {
    const color = norm(t.color);
    const description = t.description || '';
    const e = porNombre.get(t.name);
    if (!e) ops.push({ op: 'create', name: t.name, color, description });
    else if (norm(e.color) !== color || (e.description || '') !== description) ops.push({ op: 'update', name: t.name, color, description });
  }
  return ops;
}

async function api(fetch, token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status}`);
  return res.json();
}

async function listar(fetch, token, repo) {
  const todas = [];
  for (let page = 1; ; page++) {
    const lote = await api(fetch, token, 'GET', `/repos/${repo}/labels?per_page=100&page=${page}`);
    todas.push(...lote);
    if (lote.length < 100) return todas;
  }
}

export async function main({
  fetch = globalThis.fetch,
  env = process.env,
  repos = REPOS,
  template = JSON.parse(readFileSync('templates/labels.json', 'utf8')),
  log = console.log,
} = {}) {
  try { validar(template); }
  catch (e) { log(`::error::sync-labels: ${e.message}`); return 1; }
  const token = env.LABELS_SYNC_TOKEN;
  if (!token) { log('::notice::sync-labels: sin LABELS_SYNC_TOKEN, no-op'); return 0; }

  let rojo = false;
  for (const repo of repos) {
    try {
      const ops = plan(template, await listar(fetch, token, repo));
      for (const o of ops) {
        const body = { color: o.color, description: o.description };
        if (o.op === 'create') await api(fetch, token, 'POST', `/repos/${repo}/labels`, { name: o.name, ...body });
        else await api(fetch, token, 'PATCH', `/repos/${repo}/labels/${encodeURIComponent(o.name)}`, body);
        log(`${repo}: ${o.op} ${o.name}`);
      }
      const n = op => ops.filter(o => o.op === op).length;
      log(`${repo}: ${n('create')} create, ${n('update')} update, ${template.length - ops.length} sin cambio`);
    } catch (e) {
      // Un repo caído no detiene a los demás; el run sale rojo al final.
      log(`::error::sync-labels: ${repo}: ${e.message}`);
      rojo = true;
    }
  }
  return rojo ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
