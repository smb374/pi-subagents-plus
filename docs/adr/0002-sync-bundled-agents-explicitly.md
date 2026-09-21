# Sync bundled agents explicitly

Bundled agents become available through an explicit Agent Sync command rather than automatic activation-time writes. The command maintains an extension-owned mirror in the user's agent directory: it may update or remove only owned files and refuses unmanaged filename collisions. `@gotgenes/pi-subagents` only discovers filesystem agent definitions, while silent startup mutation or unrestricted overwrites would blur ownership and make replacement or failure behavior difficult to control.
