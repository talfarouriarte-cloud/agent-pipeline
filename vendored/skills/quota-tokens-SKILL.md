<!-- synced from agent-pipeline@v1 — DO NOT EDIT locally; changes arrive as sync PRs -->
<!-- Los ejemplos históricos citan el repo de origen (finplan): son lecciones con evidencia, no normas de este repo. -->

---
name: quota-tokens
description: Cuota de Max, errores 429, generación del OAuth token, incompatibilidad OAuth Max vs Messages API, pricing del Reviewer. Leer al diagnosticar fallos de autenticación, 429 o costes de agentes.
---

# quota-tokens (extraído de docs/operational-notes.md, 2026-07-05, movimiento verbatim)

## Cuota de Max y errores 429

El plan Max comparte cuota entre tres usos:

- Uso interactivo en `claude.ai`.
- Action Claude Code (responde a `@claude` en GitHub).
- Action Reviewer (auto-dispara en PRs de `claude[bot]` — ADR-025; o
  via label `needs-review` para PRs humanos — ADR-021).

Plan $100/mes da unos 50-200 prompts cada 5 horas (los "buckets"
rotativos de Anthropic), más un límite semanal agregado.

**Causas posibles de un 429 `rate_limit_error`** — no asumas que es agotamiento
de cuota sin verificarlo:

1. **Burst limit por minuto.** Anthropic tiene límites separados de
   requests-per-minute, input-tokens-per-minute y output-tokens-per-minute
   que pueden disparar 429 sin tocar la cuota agregada. Recovery en
   ~60 segundos. Escenario típico: creator agent termina y Reviewer
   arranca inmediatamente con input grande — colisión per-minute.
2. **Cuota del bucket de 5h o semanal agotada.** Verificable en la app
   de Claude (Settings → Uso). Recovery en horas / hasta el lunes.
3. **Límite específico del modelo.** Opus 4.7 puede traer límites más
   estrictos que modelos anteriores en el mismo plan.

**Cómo distinguirlo:** comprueba el medidor en `claude.ai` (Settings →
Uso → Sesión actual y Límites semanales). Si los porcentajes son bajos,
es probable burst limit (hipótesis 1) — retry en 1-2 minutos. Si están
saturados, esperar al reset es la única salida (hipótesis 2). En todo
caso, guarda el `request-id` del log de la Action: sirve para soporte
si el patrón se repite con cuota baja.

**Mitigación estructural ya aplicada:** ADR-023 (caching del contexto
estable + drop de filesBlock + fallback a API key en errores
recuperables). El caso de PR1 (donde el Reviewer falló por 429
inmediatamente tras el creator) ya no debería ocurrir porque OAuth Max
tiene mucho más margen tras esos cambios, y aunque toque techo, el
fallback a API key absorbe el PR.

Si los 429 se vuelven crónicos pese a ADR-023 y la cuota está realmente
saturada, opciones residuales:

- Bajar el Reviewer a Sonnet (más cuota disponible).
- Mantener el Reviewer en una API key separada (más predecible, pero
  con coste explícito por PR).

## Generación del OAuth token de Max

Solo se hace una vez al año (token válido 365 días).

Pasos:

1. Crear un Codespace nuevo desde un **template de GitHub** (Node.js o
   Blank), no desde el repo. Esto evita problemas con el devcontainer
   del repo.
2. En el terminal: `npm install -g @anthropic-ai/claude-code`.
3. `claude setup-token`.
4. La URL que imprime el comando se abre en el navegador. Autenticar
   con la cuenta Max.
5. La página devuelve un código corto. Pegarlo en el terminal donde
   sigue esperando el comando.
6. El token se imprime en el terminal una sola vez (no se guarda en
   ningún archivo).
7. Copiarlo a GitHub Secrets del repo como `CLAUDE_CODE_OAUTH_TOKEN`.
8. Borrar el Codespace template — su único propósito ya está cumplido.

## Pricing del Reviewer: revisar trimestralmente

`scripts/reviewer.mjs` tiene constantes `PRICING` hardcodeadas para
calcular el coste estimado en el footer. Anthropic no expone API de
pricing, así que estas constantes pueden quedar desfasadas si cambian
las tarifas.

**Acción periódica:** cada 3 meses, comprobar
https://www.anthropic.com/pricing y actualizar las constantes en el
script si han cambiado. Actualizar también la fecha en el comentario
inmediatamente arriba de `PRICING` para dejar el anchor temporal en
`git blame`. Asume cache TTL de 5 min — si se cambia el `cache_control`
a `ttl: '1h'`, actualizar `cacheWrite5m` a 2.0x input (en lugar de
1.25x).

## OAuth Max + Messages API: incompatibilidad (mayo 2026)

Aprendizaje crónico tras facturación inesperada de ~20€/día detectada 2026-05-19.

### Hecho técnico

`CLAUDE_CODE_OAUTH_TOKEN` (`sk-ant-oat01-*`) **NO es válido contra Messages API de Anthropic directamente**. Solo funciona via:

- El binario `claude` CLI (`claude -p "..."` desde un shell).
- `anthropics/claude-code-action@v1` como GitHub Action (que internamente invoca el binario `claude`).
- Claude Code en cualquiera de sus formas.

Llamar Messages API directamente con el OAuth token (e.g., `new Anthropic({ authToken: oauthToken }).messages.create(...)` en una SDK) devuelve `401 invalid x-api-key`. La SDK no diferencia entre "OAuth no soportado aquí" y "API key inválida", así que el mensaje del error es confuso.

GitHub issue de referencia: `anthropics/claude-code#37205`. Docs oficiales: `https://code.claude.com/docs/en/authentication`.

### Implicaciones de ToS

`https://code.claude.com/docs/en/authentication` documenta que usar OAuth tokens de Claude Free/Pro/Max en "any other product, tool, or service, including the Agent SDK" viola **Consumer Terms of Service**. Enforcement empezó enero 2026 con bloqueos en clientes third-party (OpenClaw, OpenCode, etc.).

Aplica también si la infracción es no intencional (caso de este proyecto: el script tenía un fallback automático a API key que enmascaró la violación durante semanas).

### Diseño correcto para agentes propios en este repo

- **Si necesitas trabajo programmático bajo OAuth Max**: usar `anthropics/claude-code-action@v1` como GitHub Action, o `claude -p` CLI invocado desde un job. Estos NO llaman Messages API directa. El Reviewer (post 2026-05-19) y el Creator siguen este patrón.

- **Si necesitas llamar Messages API directamente** (cacheo fino, formato exacto del response, control sobre tokens): usar API key con facturación pay-per-token aceptada como coste explícito. Documentar el coste esperado en el ADR/issue correspondiente.

- **NO mezclar**: NO usar OAuth como primaria con API key como fallback en scripts que llaman Messages API. El fallback se activa silenciosamente y enmascara el coste real. Si quieres fallback, hazlo explícito al loggear (no silent retry) y monitorea Anthropic Console.

### Caso histórico

`scripts/reviewer.mjs` (eliminado 2026-05-19). Llamaba Messages API directamente con `new Anthropic({ authToken: oauthToken })`. La SDK internamente rechazaba el OAuth y caía a `apiKey: process.env.ANTHROPIC_API_KEY`. Los logs del script reportaban "OAuth Max OK" incorrectamente porque la SDK no diferenciaba ambos paths en su API pública.

Facturación ~20€/día sin detectar hasta que se quitó `ANTHROPIC_API_KEY` del secret y el job empezó a fallar con `401 invalid x-api-key`. PR de migración: el Reviewer pasó a usar `claude-code-action@v1` como el Creator.

### Cómo detectar problemas similares en el futuro

- **Anthropic Console → Usage**: filtrar por API key con uso reciente. Si la API key debería estar inactiva (toda la lógica usa OAuth) y tiene uso material, hay fallback silencioso en algún sitio.
- **Logs de scripts que llaman Messages API**: si reportan "OAuth OK" pero Anthropic Console muestra facturación → desconfía del log. Forzar `process.env.ANTHROPIC_API_KEY = ''` antes del `new Anthropic({...})` para test definitivo.
- **Test definitivo periódico**: quitar `ANTHROPIC_API_KEY` del secret de GitHub durante 24h. Si todo sigue funcionando, OAuth realmente funciona. Si algo falla, el componente que falla nunca funcionó vía OAuth y estaba facturando vía API.

## Heurísticas aprendidas (loop)

<!-- Sección entrenable (ADR-212): SOLO el process-reviewer edita aquí, con marcador `skill-edit` por línea y presupuesto de la épica. Todo lo demás de este fichero está FUERA del loop (precedencia ADR / mantenimiento propio). Vacía = sin heurísticas aceptadas aún. -->
