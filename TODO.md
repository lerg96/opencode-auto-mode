# TODO

## 1. Doble `permission.asked` / doble LLM call por comando

opencode dispara el evento `permission.asked` **dos veces** con el mismo `callID` por cada comando. La primera vez el plugin usa el resultado almacenado en `decisions`, pero la segunda no encuentra el resultado (ya se borró con `decisions.delete(callID)` en `src/plugin.ts:880`) y **re-clasifica** el comando de nuevo contra el LLM (perdida: 2 LLM calls + ruido en el log).

- **Evidencia**: log de `git stash drop` y `Get-Content ... auto-mode.log` muestran dos `permission.asked` con el mismo callID y dos `LLM classify`.
- **Ubicación**: `src/plugin.ts` — evento `permission.asked` (~línea 863-911) y `decisions` map.
- **Posible fix**: mantener la decisión en el map hasta que lleguen ambos eventos (o no borrar tras el primer uso y solo marcar), o deduplicar por callID.

## 2. `auto-retry` no le pasa al agente el motivo de la denegación

Hoy el modo `auto-retry` (y `both` antes de escalar) solo responde `reject` en `permission.asked` (`src/plugin.ts:908-909`). El agente recibe un "permission denied" genérico de opencode sin saber **por qué** se denegó, así que no puede corregir el comando.

- **Idea**: inyectar el mensaje de `DenyAndContinueService` ("Action blocked by auto-mode rule [LLM]. Reason: ... Please find a safer approach.") como resultado del tool hook (p.ej. devolver `{ permission: 'deny', result: <mensaje> }` desde `tool.execute.before`) para que el agente vea el motivo y proponga un approach más seguro.
- **Ubicación**: `src/plugin.ts` — `applyDenyMode` (~línea 120-145), `DenyAndContinueService` (`src/deny-and-continue/`).

## 3. Incluir la razón del LLM en la pregunta al usuario (modo `ask-user`)

Cuando `denyMode: "ask-user"` y el LLM deniega, el plugin solo deja que opencode pregunte ("permission.asked: asking user (no auto decision)" en `src/plugin.ts:882-885`) sin inyectar el motivo. El usuario debería ver la razón del LLM (p.ej. "permanently discards staged changes...") en el prompt para decidir mejor.

- **Nota**: en la prueba con `git stash drop` el usuario sí alcanzó a ver el reason del LLM, pero llega a través del prompt nativo de opencode (mostrando el comando), no como mensaje estructurado del plugin.
- **Idea**: devolver un resultado/mensaje desde `tool.execute.before` (o pasar el reason en la decisión `ask`) para que opencode lo renderice junto a la pregunta.
- **Ubicación**: `src/plugin.ts` — `applyDenyMode` línea 128-131 (`reason: `${reason} — user confirmation required``) y el hook `tool.execute.before`.