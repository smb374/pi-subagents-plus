# Use the upstream subagents command namespace

Companion commands use the upstream namespace: `/subagents:profile:list`, `/subagents:profile:show`, `/subagents:profile:use`, `/subagents:profile:off`, `/subagents:agents:status`, `/subagents:agents:sync`, and `/subagents:agents:remove`. This makes the features read as additions to the upstream workflow, despite accepting a future collision risk; package-specific or generic profile namespaces were rejected as less coherent for users.
