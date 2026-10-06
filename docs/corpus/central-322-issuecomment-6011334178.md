**watchdog · architect-resolve (régimen autónomo) — issue 322: sin re-arm, fundida en #325.**

<!-- autonomous-decision -->

**Diagnóstico (lectura fresca por API, 2026-10-06 ~07:10Z)**

- El arm de la cola mensual (07:01:52Z, posición 1) perdió el TOCTOU del guard serial frente al arm de #318 (el run `37427163651` de este issue terminó en segundos con `serial-toctou-cruzado` ⇒ `stalled`, «architect-resolve lo re-arma cuando la serie quede libre»).
- Antes de que la serie quedara libre, el propietario cambió la premisa: a las 07:07:49Z declaró este issue **fundido en #325** (label `mensual:fundida`, antes `mensual:aprobada`) y su ruling queda sustituido por el de #325. #325 lleva el ruling APROBADA con `serial-ok`, está armado y su sesión de Creator está EN CURSO (run `37427785150`, `in_progress`, arrancó 07:08:01Z). No hay PR abierta todavía; no hay `pausa-cola` que la retenga (su Creator corre).
- Cap: 0 comentarios `watchdog-rearm` previos, 0 `autonomous-decision` previos.

**Decisión**

**No se re-arma #322.** `mensual:fundida` significa «se ejecuta dentro del PR de otra; no se arma por separado» (`docs/architect-mejora-continua.md` § Cola mensual). Re-armarlo abriría un segundo Creator sobre el MISMO fichero (`vendored/scripts/adr-lint.mjs`) que el de #325 ya está editando: PR duplicado con conflicto garantizado. El `stalled` del guard serial era una señal del régimen anterior a la fusión; mantenerlo re-derivaría `stalled-autonomous-resolve` en cada tick (AP-038) sobre un ítem que ya no tiene trabajo propio.

Acciones ejecutadas en este issue:
- `stalled` retirada de #322.
- `human-needed` puesta en #322 — único mecanismo a mi alcance para sacarlo del radar del detector: sin label de exclusión, un issue fundido (abierto por diseño hasta que mergee su vehículo, con un arm de hace minutos y sin PR) dispara `issue-armed-no-pr` en cada tick durante las 72 h de `ARM_WINDOW_H`, una sesión de resolver por tick para no hacer nada. Es la misma clase que AP-051 cerró con `skip_labels` para los paneles abiertos-por-diseño.

**Lo que queda pendiente del humano (barato)**

1. **Cierre de #322.** `self-mensual-queue.yml` cierra las fundidas al mergear el vehículo SOLO si algún comentario casa con la regex `FUNDIDA en #325\b` (mayúsculas, sin `central`). El comentario de fusión dice «Fundida en central#325», que NO casa. Para que el cierre automático funcione dejo aquí la forma canónica, en línea propia:

FUNDIDA en #325

   Alternativa equivalente: que el PR de #325 lleve `Closes #322` en el body (el ruling de #325 dice «funde #322», pero su arm manual no incluyó la cláusula «`Closes #<n>` por cada fundida» del arm automático). Si ninguna de las dos vías cierra el issue al mergear, cerrarlo a mano como `completed`. `human-needed` no estorba al cierre automático.
2. **Hueco de mecánica** (candidato a `process-proposal` o a enmienda en `self-watchdog.yml`, path `.github/workflows/` ⇒ humano): añadir `mensual:fundida` al input `skip_labels` del stub `self-watchdog.yml` (hoy `pause-agents,human-needed,auditoria,registro-decisiones`). Un issue fundido es abierto-por-diseño con arm reciente y sin PR: para el detector es stall eterno hasta que mergee su vehículo. Sin eso, cada fusión posterior al arm reproducirá este episodio y obligará a un `human-needed` artificial como el de hoy.
3. Nota lateral verificada: el ruling de #325 dice «en paralelo con central#318», pero #318 ya está CERRADO (su Creator fue el ganador del TOCTOU; el run `37427161475` duró 1,5 min). No afecta a #325 (armado con `serial-ok`); lo dejo anotado por si el propietario esperaba ese paralelismo.

Sin arm en este comentario a propósito: la continuación del alcance de #322 es la sesión de #325 ya en curso.

<!-- watchdog-rearm -->
<!-- watchdog-rol: architect-resolve -->
<!-- watchdog-capa: workflow_run -->
