# Runbook — Rotación del PAT del pipeline

Protocolo de operador (AP-091, central#259). El PAT es el **punto único de
fallo** del pipeline: lo usan a la vez el primario (Guard serial y post-steps
del Creator, labels y veredictos del Reviewer, merges de epic-merge) y el
rescate (Watchdog: re-arms, relabels, red de PR huérfano). Si caduca o se
regenera sin actualizar el secret, **caen juntos**.

Incidente que lo motiva (asesoramiento-financiero#2318, 2026-09-29): el PAT
se regeneró sin actualizar el secret. 4 ticks del Watchdog en rojo, 2 arranques
del Creator muertos con 401 tras 6-7 min de setup cada uno, y 49 min entre el
arm y el Creator vivo, ≥33 de ellos con la credencial ya restaurada. Desde
AP-091 el preflight de credencial escala en el primer tick; este runbook es la
otra mitad: que la rotación no produzca el incidente.

## Inventario: qué secret consume qué credencial

| Secret | Credencial | Repos que lo declaran | Quién lo consume |
|---|---|---|---|
| `REVIEWER_GITHUB_TOKEN` | PAT fine-grained del propietario (Contents RW, Issues RW, PRs RW, Actions read, Metadata read) sobre el repo | **Cada repo del pipeline**: `agent-pipeline` (stubs `self-*.yml`), `asesoramiento-financiero` (finplan), wmcb | Los 5 reusables vía stub (`claude-code`, `reviewer`, `epic-merge`, `watchdog`, `process-review`) y `self-mensual-queue.yml` en el central. Se expone además a los agentes como `ARM_TOKEN` (env del Creator) |
| `WORKFLOWS_PUSH_TOKEN` | PAT aparte (Contents + Workflows, **sin** PRs) | Solo `agent-pipeline` | Checkout y post-step «Push residual» del Creator del central (AP-012) |
| `CLAUDE_CODE_OAUTH_TOKEN` | OAuth de Claude Max (no es un PAT de GitHub) | Cada repo del pipeline | Creator, Reviewer, architect-resolve, process-review. Su caída no da 401 de GitHub: da sesiones muertas al nacer ⇒ escalada `pipeline-fleet-down` |

Si un consumidor declara en su stub un secret con otro nombre para el mismo PAT,
se añade a esta tabla en el mismo cambio que lo introduce.

Fuera de GitHub, en el consumidor:

- `asesoramiento-financiero`: constante `PAT_EXPIRY` de `scripts/vm-sonda.sh`
  (sonda de caducidad a T-7, mantenida a mano). La API no expone la caducidad
  del token a la App, así que esta constante es una costura manual: si no se
  actualiza, la sonda avisa de una caducidad que ya no es la real.

## Orden

Un PAT fine-grained **regenerado** invalida el valor anterior en el acto: entre
el paso 1 y el 2 el pipeline está caído. Hazlo seguido y, si puedes elegir el
momento, sin arms en vuelo.

1. **Regenerar** (o crear uno nuevo con los mismos permisos y repos) en
   GitHub → Settings → Developer settings → Fine-grained tokens. Anota la nueva
   fecha de caducidad.
2. **Actualizar el secret en TODOS los repos de la tabla**, no solo en el que
   dio el error:
   ```bash
   for r in agent-pipeline asesoramiento-financiero <repo-wmcb>; do
     gh secret set REVIEWER_GITHUB_TOKEN --repo talfarouriarte-cloud/$r
   done
   ```
   (`gh secret set` pide el valor por stdin; pégalo una vez por repo.) Si
   rotaste también `WORKFLOWS_PUSH_TOKEN`, solo en `agent-pipeline`.
3. **Actualizar la caducidad** en el consumidor: `PAT_EXPIRY` en
   `scripts/vm-sonda.sh` de `asesoramiento-financiero`.
4. **Verificar la credencial** antes de soltar el pipeline:
   ```bash
   GH_TOKEN=<nuevo-pat> gh api rate_limit --jq '.resources.core | "\(.remaining)/\(.limit)"'
   ```
   Un número ⇒ vale. `HTTP 401` ⇒ el valor no es el que crees.
5. **Probar el pipeline real**: `workflow_dispatch` del Watchdog en cada repo y
   confirmar que el run concluye `success`. Su primer step, «Preflight de
   credencial», es la comprobación del paso 4 hecha con el secret que ven los
   workflows:
   ```bash
   gh workflow run watchdog.yml --repo talfarouriarte-cloud/<repo>
   gh run list --workflow watchdog.yml --repo talfarouriarte-cloud/<repo> --limit 1
   ```
6. **Cerrar la escalada** si existe (issue `human-needed` con el marcador
   `watchdog-heartbeat-escalation` y el modo `pipeline-credential-401`),
   citando el run verde del paso 5. Cerrarla con el preflight aún en rojo solo
   hace que el siguiente tick la reabra.
7. **Re-armar lo que murió durante la caída.** Los arms que cayeron en el
   Guard serial no dejaron sesión ni rama. El Watchdog los recoge por
   `issue-armed-no-pr` tras su umbral; si hay prisa, basta un `@claude` en el
   issue (el Guard serial aborta limpio si ya hay un Creator en vuelo).

## Qué pasa si no se sigue

El preflight de credencial (primer step del Creator y del `detect` del
Watchdog) convierte el olvido en escalada `human-needed` en el primer tick
(<2 min) sin quemar minutos de setup. No sustituye al runbook: solo acorta el
incidente.
