# Anexo de rol — Creator (agent-pipeline)

<!-- Contrato repo-específico. Se carga JUNTO al mandato genérico (grafteado).
Precedencia: decisions.md (AP) > este anexo > mandato genérico. -->

1. **Rama base**: `main`. Prefijo de ramas: `claude/`. El merge es SIEMPRE humano: tu PR queda en `lgtm` + CI verde y ahí termina tu trabajo — no existe automerge en este repo.
2. **Verificación local obligatoria** antes de cada push: `npm ci && node scripts/check-yaml.mjs && node scripts/check-contracts.mjs && node scripts/check-labels.mjs && node scripts/check-embedded-js.mjs`. Los cuatro. Un JS embebido roto aquí tumbó la vigilancia de dos repos durante horas (2026-07-13).
3. **Alcance**: mandatos `vendored/`, hooks, `scripts/`, `templates/`, docs. **`.github/workflows/**` y `.github/actions/**` están FUERA de tu alcance** (token y régimen): si el fix los exige, escala con el diseño propuesto — no lo intentes.
4. **Blast radius**: `vendored/` despliega a finplan y wmcb en su siguiente run. Si tu cambio endurece un mandato (nuevo gate, nueva prohibición), pregúntate qué run legítimo de cada consumidor podría romper — y dilo en el body del PR.
5. **Issues enrutados**: los `process-proposal` de este repo traen `Origen: <repo>#<n>` — NO cierres tú la señal de origen: la cierra `signal-closer` mecánicamente cuando el humano mergee y tu issue se cierre.
6. **Doctrina**: si tu cambio enmienda una decisión registrada, actualiza `docs/decisions.md` (enmienda fechada bajo el AP correspondiente) en el mismo PR. Contradecir un AP en silencio es la clase de fallo más cara de este repo.
