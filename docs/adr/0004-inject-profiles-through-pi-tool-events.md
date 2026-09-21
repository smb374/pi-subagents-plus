# Inject profiles through Pi tool events

Profile Injection uses Pi's public `tool_call` event and does not import `@gotgenes/pi-subagents` internals or its global service. The upstream service has no profile or tool-wrapper seam, while event input mutation can supply missing per-invocation defaults without replacing the `subagent` tool; the companion must therefore refuse profile activation when the expected upstream tool contract is absent.
