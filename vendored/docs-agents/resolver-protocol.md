<!-- synced from agent-pipeline@v1 — DO NOT EDIT locally; changes arrive as sync PRs -->

# Protocolo de decisiones derivables (resolver-protocol)

Mandato compartido por Creator y Auditor en el punto de escalada. Objetivo:
las decisiones cuya respuesta YA está implicada por ADRs/spec no paran la
cadena; las que crean compromiso nuevo escalan a humano, siempre.

## Test de derivabilidad

Una decisión es **derivable** si y solo si puedes citar verbatim el ADR, la
sección de spec.md, o el **doc de contexto de la épica** (skill temporal
`epic-context-<ADR>`, si existe) que la implica. El doc de contexto es
NO-normativo: sirve para derivar, jamás para contradecir — si su contenido
choca con un ADR o con spec.md, gana el ADR/spec y el conflicto mismo es
NO derivable (escala). Consúltalo SOLO al llegar a este gate, no al arrancar
la sesión (presupuesto de contexto). Si necesitas interpretar, extrapolar o
elegir entre lecturas, NO es derivable. Si dos ADRs entran en conflicto,
NO es derivable (un conflicto es una decisión nueva).

## No derivables — régimen autónomo (2026-07-07)

Contrato del motor, dependencia nueva, ADR nuevo, cambio de spec, o lo que
el issue marque como decisión abierta: ya NO paran la cadena. Quien topa
con ellas en recuperación (etapa architect del Watchdog, Auditor) decide
con su mejor juicio y publica el racional completo con
`<!-- autonomous-decision -->` — decisión ejecutada, trazable y revertible;
el humano tiene veto asíncrono y «si se equivoca, se corrige».

Excepciones absolutas (humano siempre): `.github/workflows/*` y
los ficheros congelados del repo (lista en el anexo) (zonas protegidas), promoción de la rama por defecto a producción, y el
cortacircuito de doble rebote (ver watchdog.md).

## Formato de resolución (obligatorio, publicado como comentario)

```
<!-- derived-decision -->
**Decisión:** <una frase>
**Derivada de:** <ADR-NNN §x / spec.md §y>
**Cita:** "<texto verbatim>"
**Por qué la implica:** <1-2 frases>
```

Sin cita verbatim ⇒ no hay resolución: escala.

## Cap

Máximo 2 decisiones derivadas por issue. Una 3ª necesidad de derivar
significa que el issue está mal especificado: escala el issue entero al
humano, sin resolver la 3ª.

El humano tiene veto asíncrono: toda `derived-decision` es trazable y
revertible; si el humano la revoca, el correctivo es mecánico.

## Regla dura de citación (2026-07-08, incidente del drift λ)

Toda cita de ADR/spec/convención en una decisión (derivada o autónoma), en un body de issue o en un skill DEBE ser **textual, copiada del fichero fuente** y entrecomillada como blockquote — jamás parafraseada ni «recordada». Verificación mecánica: la frase citada debe existir literalmente en el doc referenciado (grep). Una paráfrasis presentada como cita es cómo entró el drift de la cadena M4b (autonomous-decision de 2026-07-08T10:19Z acuñó «cero re-simulación» atribuido a ADR-206·R·2 §1, que no lo contiene; el Architect lo propagó a #1134 sin verificar; tres issues y cuatro PRs se construyeron sobre la cita falsa). La regla obliga a TODOS los emisores: Creator, architect-resolve y el propio Architect.
