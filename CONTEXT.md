# Pi Subagents Plus

Pi Subagents Plus is a companion to `@gotgenes/pi-subagents`. It adds session-level model selection and curated agent definitions without replacing the upstream subagent runtime.

## Language

**Model Profile**:
A named mapping from agent type to an exact model identifier and an optional thinking level. Its values are defaults: an explicit subagent invocation takes precedence.
_Avoid_: Profile, agent override

**User Model Profile**:
A model profile available across projects for one user.
_Avoid_: Global profile

**Project Model Profile**:
A model profile supplied by a trusted project. It overrides a same-named user model profile; an untrusted project contributes no model profiles.
_Avoid_: Local profile

**Active Model Profile**:
The model profile selected for the current parent session. It affects new subagent spawns only, ends with that session, and is not inherited by child sessions.
_Avoid_: Current profile, global profile

**Profile Injection**:
The application of an Active Model Profile to missing model or thinking fields on a new subagent invocation. Explicit invocation values and locked agent values retain precedence.
_Avoid_: Tool wrapping, profile enforcement

**Bundled Agent**:
A curated semantic adaptation of an agent definition from the nicobailon `pi-subagents` package. It uses only `@gotgenes/pi-subagents` core capability tools and relies on upstream for parent-coordination protocol tools.
_Avoid_: Built-in agent, default agent, copied agent

**Child Protocol**:
The parent-coordination channel installed by `@gotgenes/pi-subagents` independently of an agent's capability allowlist. Every child can ask its parent for blocking information, and can send one-way material updates while mid-run updates are enabled.
_Avoid_: Coordination tools, supervisor bridge

**Agent Sync**:
An explicit user action that reconciles extension-managed bundled agents in the user's agent directory. It updates and removes only files owned by Pi Subagents Plus and refuses to overwrite unmanaged collisions.
_Avoid_: Install, automatic provisioning

**Owned Agent File**:
A synced agent definition marked as managed by Pi Subagents Plus and carrying the hash of its generated content. Agent Sync can reconcile an unchanged owned file but treats local edits and unmarked same-named files as conflicts.
_Avoid_: User agent

**Interactive Test Instance**:
A disposable Pi process with an isolated agent directory, home directory, and neutral workspace that loads only the companion, its upstream runtime, and test model configuration. It isolates Pi configuration but is not a security sandbox.
_Avoid_: Test sandbox, development Pi
