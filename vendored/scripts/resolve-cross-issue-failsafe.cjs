'use strict';
// resolve-cross-issue-failsafe — post-step de terminal de architect-resolve
// (AP-064; extraído a módulo pusheable por AP-068).
//
// QUÉ CIERRA. architect-resolve DECLARÓ en el hilo de finplan#1696 «`stalled`
// retirada de #1694 y re-arm del eslabón 1/3 allí» y murió sin ejecutar
// NINGUNA de las dos: la sesión materializó primero el artefacto caro (editar
// el bloque de invariantes del issue comentado) y dejó el paso procedimental
// barato —relabel + arm en OTRO issue— al final, donde murió el presupuesto
// (clase AP-011). Fue silencioso porque la PROSA afirma la transición: el
// estado se leía de la declaración del agente, no del issue. Coste medido:
// 4 h 15 min de cadena parada y 3 corridas de resolver (1/3 existió solo para
// absorber a la anterior).
//
// Una transición cross-issue no tenía materialización por estado: su único
// portador era la prosa de una sesión que puede morir entre la declaración y
// la acción. Este belt es a architect-resolve lo que `turn-close-failsafe` es
// al Creator, `open-review-failsafe` a la apertura del PR y el post-step
// sin-veredicto (AP-025) al Reviewer: compara lo DECLARADO contra lo
// MATERIALIZADO al cerrar la sesión y ejecuta la diferencia. NUNCA decide nada
// nuevo — misma doctrina que AP-036: rular lo declarado, no juzgarlo.
//
// Idempotente por construcción: retirar una label ausente es no-op y el arm
// entra por el MISMO camino que cualquier otro (guard serial de
// `claude-code.yml`: si la serie está ocupada, encola), así que la doble
// ejecución (resolver vivo + belt) no colisiona.
//
// POR QUÉ VIVE AQUÍ Y NO EN `watchdog.yml` (AP-068). La GitHub App de
// claude-code-action no tiene permiso `workflows` (ADR-020, medido tres
// veces), luego un agente NO puede pushear `.github/workflows/**` y el belt
// entero viajaba como `docs/patches/*.patch` pendiente de un humano. La
// restricción de GitHub es POR PATH y solo cubre `.github/workflows/`: este
// módulo, servido al workspace del consumidor por `graft-vendored` (AP-009,
// mismo camino que `adr-lint.mjs`), es pusheable por un agente, lo gatea el
// CI del central y lo ejecuta el banco de casos — mientras que en el workflow
// solo queda un stub de ~10 líneas que lo invoca.
//
// Consecuencia operativa: TODO diff de este fichero despliega a los DOS
// consumidores en su siguiente run, sin gradualidad (zona de rigor `vendored/`).

const MARK = '<!-- resolve-cross-issue-materializado -->';
const ARM_MARKERS = ['arm-de-cola', 'epic-auto-launch', 'epic-partial-relaunch', 'watchdog-rearm'];
const MAX = 3;          // tope duro de materializaciones por corrida
const MAX_PAGS = 10;    // tope de páginas del barrido fresco

// ── Vocabulario ANCLADO de declaración (jamás substring suelto) ──
// Solo dos acciones, las únicas que el rol declara cross-issue: retirada de
// `stalled` y re-arm. Cualquier otra prosa se ignora.
// Ojo con `\w` en español: `á` NO es `\w` en JS, luego `retir\w*` se corta
// ANTES de la tilde y «Retiré la label `stalled`» —pretérito, la forma que el
// mandato PIDE— no casaba. La clase de caracteres incluye las vocales
// acentuadas y la ñ a propósito.
const DES_STALL = /(?:retir|quit|elimin|sac)[\wáéíóúüñ]*\s+(?:la\s+|el\s+)?(?:label\s+|etiqueta\s+)?[`'"]?stalled[`'"]?|[`'"]?stalled[`'"]?\s+(?:ya\s+)?(?:retirad|quitad|eliminad)[oa]s?|\bdes-?stall\w*/i;
const ARM = /\bre-?arm\w*|\barmad[oa]s?\b|\barm(?:o|é|a|ar|ado)\b|\brelanzamiento\b|\brelanz(?:o|é|ar|ado)\b/i;
// Polaridad y modo: la clase «regex polarity blindness» (central#119) ya
// mordió al INSTRUMENTO DE MEDIDA de la casa. Una frase que niega, condiciona
// o pospone la acción NO es una declaración de ejecución: fail-open (no actuar
// + warning nominal), nunca materializar.
const AMBIGUO = /\b(?:no|ni|sin|nunca|jam[áa]s|tampoco|pendiente|falta|faltan|queda|quedan|habr[íi]a|deber[íi]a|deber[áa]|hay que|convendr[íi]a|proceder[íi]a|tocar[íi]a|si|cuando|antes de|toca)\b/i;
// Cuarta cara de la misma clase: el FUTURO y la INTENCIÓN anuncian la acción,
// no la declaran ejecutada («se armará al mergear», «voy a re-armar #N»,
// «procedo a retirar `stalled`»). Se ancla a los MISMOS verbos de acción en
// vez de a un futuro genérico (`\w+ar[áé]`), que confundiría el pretérito
// «retiré» —una declaración de ejecución legítima— con un anuncio.
// El cierre es un lookahead, NO `\b`: tras `á` no hay `\b` posible (ni `á` ni
// el espacio siguiente son `\w`), así que un `\b` final haría la rama del
// futuro sintético inerte — la misma trampa que arriba.
const FUTURO = /\b(?:voy|vas|va|vamos|van|paso|pasamos|procedo|procedemos)\s+a\s+(?:\w+\s+){0,2}(?:re-?)?(?:arm|retir|quit|elimin|sac|relanz)ar\b|\b(?:re-?)?(?:arm|retir|quit|elimin|sac|relanz)ar(?:[áé](?:[ns]|is)?|emos)(?![a-záéíóúüñ])/i;
// Identidad POSITIVA del emisor. Ver el bloque del filtro en `derivar` para el
// porqué de las dos cosas (que sea del ROL y que esté en LÍNEA PROPIA).
const ROL = /^[ \t]*<!--\s*watchdog-rol:\s*architect-resolve\s*-->[ \t]*$/m;

// ── Derivación PURA: prosa → { declaraciones, avisos } ───────────────────────
// Separada del runtime a propósito (AP-068): es la parte que decide QUÉ se
// materializa y la única que ha fallado hasta ahora —dos veces por la misma
// causa (`á` no es `\w`), las dos cazadas EJECUTANDO el banco de casos, no
// releyendo el diff—. Al ser pura, `scripts/check-resolve-detection.mjs`
// ejecuta ESTA función y no una copia suya: hasta AP-068 el banco reimplantaba
// el pipeline de derivación y su deriva respecto del step era un residual
// declarado («si el step cambia de FORMA, esta función tiene que cambiar con
// él»). Ya no hay dos formas que sincronizar: hay una.
//
// `comentarios`: [{ host, body, url }] — `host` es el issue donde se publicó.
// Devuelve `{ decl, avisos }`; `decl` es issue destino → acciones declaradas
// (unión de todos los segmentos), `avisos` es [{ clase, mensaje }].
function derivar(comentarios) {
  const decl = {};
  const avisos = [];
  for (const c of comentarios) {
    const raw = c.body || '';
    if (raw.includes(MARK)) continue;                      // nuestro propio rastro
    // Identidad POSITIVA: EXCLUSIVAMENTE el marcador de ROL que el prompt del
    // resolver obliga a emitir. Ni el login del PAT (`REVIEWER_GITHUB_TOKEN`
    // es el mismo secreto en los cinco reusables y es además la cuenta del
    // propietario: leería como «declaración del resolver» cualquier prosa
    // PAT-autorada del repo, incluida la humana) ni el marcador de CAPA (lo
    // llevan también los ~14 post-steps deterministas de esta capa:
    // `watchdog-circuit-breaker`, el diag de rectificación en vuelo de AP-055
    // —que interpola encabezados ARBITRARIOS de `decisions.md`, con `#N`
    // dentro—, `SETTLE_MARK`, `REBASE_MARK`… Una lista NEGRA de esos
    // marcadores sería un mandato de memoria: este repo añade un belt por AP y
    // la lista se pudriría en silencio, con fallo «el belt actúa donde no
    // debía»). El guard positivo no se pudre: un belt nuevo no emite el
    // marcador del rol, luego nace excluido por defecto.
    //
    // En LÍNEA PROPIA, y sobre el cuerpo con el código ya despojado: un
    // marcador CITADO no es un marcador emitido. No es teórico — en el PR de
    // AP-064 una review quedó DESTRUIDA porque `epic-merge.yml:127` busca su
    // marcador con `body.includes(...)` y casó la review que lo citaba entre
    // backticks, sobrescribiéndola con su diag. Misma clase que AP-063:
    // EFECTUAR ≠ CITAR.
    if (!ROL.test(raw.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' '))) continue;
    const host = c.host;
    if (!host) continue;
    const prosa = raw.replace(/```[\s\S]*?```/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
    for (const seg of prosa.split(/\r?\n|(?<=[.;!?])\s+/)) {
      const desStall = DES_STALL.test(seg);
      const arm = ARM.test(seg);
      if (!desStall && !arm) continue;
      const refs = [...new Set([...seg.matchAll(/(?:^|[\s(\[,;:«"'])#(\d+)\b/g)].map((m) => Number(m[1])))].filter((n) => n !== host);
      if (!refs.length) continue;                          // declaración in-thread: no es esta clase
      if (AMBIGUO.test(seg)) {
        avisos.push({ clase: 'negada/condicional/pospuesta', mensaje: `resolve-cross-issue: #${host} declara una acción sobre #${refs.join(', #')} en una frase negada/condicional/pospuesta — no se deriva el par issue→acción; fail-open, sin actuar.` });
        continue;
      }
      if (FUTURO.test(seg)) {
        avisos.push({ clase: 'futuro/intención', mensaje: `resolve-cross-issue: #${host} declara una acción sobre #${refs.join(', #')} en futuro o de intención (anuncia la acción, no la declara ejecutada) — no se deriva el par issue→acción; fail-open, sin actuar.` });
        continue;
      }
      if (refs.length > 1) {
        avisos.push({ clase: 'multi-ref', mensaje: `resolve-cross-issue: #${host} cita ${refs.length} issues (#${refs.join(', #')}) en el mismo segmento — no se puede atribuir la acción; fail-open, sin actuar.` });
        continue;
      }
      const n = refs[0];
      const d = decl[n] || (decl[n] = { desStall: false, arm: false, host, url: c.url });
      if (desStall) d.desStall = true;
      if (arm) d.arm = true;
    }
  }
  return { decl, avisos };
}

// ── Runtime: lee el estado real y materializa SOLO la diferencia ─────────────
async function run({ github, context, core, skipLabels }) {
  const { owner, repo } = context.repo;
  const CAPA = `<!-- watchdog-capa: ${context.eventName} -->`;
  const SKIP_LABELS = (skipLabels || '').split(',').map((x) => x.trim()).filter(Boolean);

  // Frescura (lección #180): la ventana es la VIDA DE ESTE JOB, no un lookback
  // fijo. Sin ella, una declaración ya materializada por la corrida anterior se
  // volvería a leer como pendiente en cada tick. Si la API no responde, ventana
  // de respaldo acotada (la misma que usa el post-step hermano de ping-creator).
  let since = null;
  try {
    const { data: r } = await github.rest.actions.getWorkflowRun({ owner, repo, run_id: context.runId });
    since = r.run_started_at;
  } catch (e) {
    core.warning(`resolve-cross-issue: run_started_at ilegible (${e.message}) — ventana de respaldo de 40 min.`);
  }
  if (!since) since = new Date(Date.now() - 40 * 60 * 1000).toISOString();

  // Barrido PAGINADO: `since` acota por tiempo, no por volumen. Una sola página
  // se quedaría con 100 comentarios de la ventana y el resto caería en silencio.
  // El tope de páginas existe para no barrer sin límite un repo ruidoso, y al
  // alcanzarlo el fail-open es ANUNCIADO, jamás mudo.
  //
  // `direction: 'desc'` a propósito: el truncado tiene que morder por el extremo
  // que NO importa. La declaración del resolver es la más reciente de la ventana
  // por construcción (este belt corre al terminar su propia etapa), así que en
  // 'asc' el corte se comería justo lo que venimos a leer — quedaría mudo en el
  // único caso en que hace falta. El orden es indiferente para el resto: `decl`
  // es una UNIÓN y no depende de la secuencia.
  let frescos = [];
  try {
    const it = github.paginate.iterator(github.rest.issues.listCommentsForRepo, {
      owner, repo, since, per_page: 100, sort: 'created', direction: 'desc' });
    let pags = 0;
    for await (const { data } of it) {
      frescos.push(...data);
      if (++pags >= MAX_PAGS) {
        core.warning(`resolve-cross-issue: la ventana trae más de ${MAX_PAGS * 100} comentarios — barrido TRUNCADO; una declaración posterior a ese corte no se verá en esta corrida (la recoge el tick siguiente por \`stalled\` residual, AP-038).`);
        break;
      }
    }
  } catch (e) {
    core.warning(`resolve-cross-issue: barrido de comentarios frescos falló (${e.message}) — sin actuar.`);
    return;
  }
  // `since` de listCommentsForRepo filtra por `updated_at`, no por `created_at`:
  // una EDICIÓN posterior (un typo corregido horas más tarde) reinyectaría la
  // declaración en la ventana de otro tick, con el arm de la primera vez ya
  // fuera de ventana ⇒ doble arm. El dedupe del destino se hace por
  // `created_at`; el origen se filtra igual para que las dos puntas midan lo
  // mismo — «declaración de ESTA sesión» es cuándo se ESCRIBIÓ, no cuándo se
  // retocó.
  frescos = frescos.filter((c) => (c.created_at || '') >= since);

  const { decl, avisos } = derivar(frescos.map((c) => ({
    host: Number((c.issue_url || '').split('/').pop()),
    body: c.body,
    url: c.html_url,
  })));
  avisos.forEach((a) => core.warning(a.mensaje));

  if (!Object.keys(decl).length) { core.info('resolve-cross-issue: ninguna transición cross-issue declarada en la ventana — nada que verificar.'); return; }

  let hechos = 0;
  for (const [k, d] of Object.entries(decl)) {
    if (hechos >= MAX) { core.warning(`resolve-cross-issue: tope de ${MAX} materializaciones por corrida alcanzado — el resto lo recoge el tick siguiente.`); break; }
    const n = Number(k);
    let t;
    try { t = (await github.rest.issues.get({ owner, repo, issue_number: n })).data; }
    catch (e) { core.warning(`resolve-cross-issue: #${n} ilegible (${e.message}) — sin actuar.`); continue; }
    if (t.pull_request) { core.notice(`resolve-cross-issue: #${n} es un PR — fuera de alcance (el arm en PR lo cubre el post-step de ping-creator huérfano).`); continue; }
    if (t.state !== 'open') { core.notice(`resolve-cross-issue: #${n} cerrado — nada que reanudar.`); continue; }
    const labels = (t.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
    const excl = labels.filter((l) => SKIP_LABELS.includes(l));
    if (excl.length) { core.notice(`resolve-cross-issue: #${n} lleva label de exclusión (${excl.join(', ')}) — kill-switch, sin actuar.`); continue; }

    let cs = [];
    try { cs = await github.paginate(github.rest.issues.listComments, { owner, repo, issue_number: n, per_page: 100 }); }
    catch (e) { core.warning(`resolve-cross-issue: comentarios de #${n} ilegibles (${e.message}) — sin actuar.`); continue; }
    // Ventana = vida del job: cubre también el caso «el resolver armó ANTES de
    // resumirlo en el hilo ajeno», que un corte por la fecha de la declaración
    // leería como no-armado (doble arm).
    const enVentana = cs.filter((c) => (c.created_at || '') >= since);
    if (enVentana.some((c) => (c.body || '').includes(MARK))) { core.info(`resolve-cross-issue: #${n} ya materializado en esta ventana — idempotente, sin actuar.`); continue; }

    const armado = enVentana.some((c) => /^@claude/m.test(c.body || '') || ARM_MARKERS.some((m) => (c.body || '').includes(m)));
    // «Virgen» = sin NINGÚN `@claude` en todo su historial (watchdog.md
    // § Prohibiciones), y el historial incluye el CUERPO: un issue armado desde
    // su propio body no es virgen. El error iría en la dirección segura (se
    // clasificaría como virgen ⇒ no se arma), pero la lectura del mandato tiene
    // que ser la misma en las dos puntas.
    const virgen = !/^@claude/m.test(t.body || '') && !cs.some((c) => /^@claude/m.test(c.body || ''));
    const faltaDesStall = d.desStall && labels.includes('stalled');
    const faltaArm = d.arm && !armado && !virgen;
    if (d.arm && virgen) core.warning(`resolve-cross-issue: #${n} no tiene ningún @claude previo (issue virgen) — prohibición absoluta del rol (watchdog.md § Prohibiciones); no se arma.`);
    if (!faltaDesStall && !faltaArm) { core.info(`resolve-cross-issue: #${n} — lo declarado en #${d.host} ya está materializado (stalled: ${labels.includes('stalled') ? 'presente' : 'ausente'}; arm: ${armado ? 'posteado' : 'no requerido'}).`); continue; }

    // El comentario que sigue afirma un ESTADO: solo puede componerse con lo que
    // de verdad se materializó. Tragar el fallo de removeLabel y afirmar la
    // retirada igualmente reproduciría DENTRO del belt la clase exacta que
    // AP-064 existe para cerrar (prosa que afirma un estado no verificado) y le
    // dejaría al Auditor un rastro falso. Un 404 sí es benigno: la label ya no
    // está ⇒ estado deseado.
    let desStallOk = false;
    if (faltaDesStall) {
      try { await github.rest.issues.removeLabel({ owner, repo, issue_number: n, name: 'stalled' }); desStallOk = true; }
      catch (e) {
        if (e.status === 404) { desStallOk = true; core.info(`resolve-cross-issue: #${n} — \`stalled\` ya no estaba al retirarla (carrera con el resolver vivo); estado deseado alcanzado.`); }
        else { core.warning(`resolve-cross-issue: #${n} — removeLabel('stalled') falló (${e.message}); NO se afirma la retirada. Lo recoge el tick siguiente por \`stalled\` residual (AP-038).`); }
      }
    }
    if (!desStallOk && !faltaArm) { continue; }   // nada materializado: ni comentario ni marcador (que dedupearía el reintento)
    const detalle = [
      desStallOk ? '`stalled` retirada por estado' : null,
      faltaArm ? 'arm materializado (entra por el guard serial como cualquier otro: si la serie está ocupada, se encola)' : null,
    ].filter(Boolean).join(' · ');
    const cita = `el resolver del watchdog DECLARÓ en #${d.host} (${d.url}) una transición sobre ESTE issue y su sesión terminó sin ejecutarla`;
    const cabecera = faltaArm
      ? `@claude arranca — transición declarada por el resolver, materializada por estado: ${cita}.`
      : `**watchdog · resolve-cross-issue-failsafe**: ${cita}.`;
    await github.rest.issues.createComment({ owner, repo, issue_number: n,
      body: `${cabecera}\n\n${detalle}. Solo se ejecuta lo DECLARADO — este belt no decide nada nuevo (AP-064; doctrina AP-036: rular lo declarado, no juzgarlo).\n\n${faltaArm ? '<!-- watchdog-rearm -->\n' : ''}${MARK}\n${CAPA}` });
    hechos++;
    core.warning(`resolve-cross-issue: #${n} — transición declarada en #${d.host} materializada por estado (${detalle}).`);
  }
}

module.exports = run;
module.exports.derivar = derivar;
module.exports.PATRONES = { DES_STALL, ARM, AMBIGUO, FUTURO, ROL };
module.exports.MARK = MARK;
