# Pi Subagents Plus Design

## Purpose

Pi Subagents Plus is a companion to `@gotgenes/pi-subagents`. It adds two capabilities without replacing or importing the upstream runtime:

1. session-scoped model profiles that provide per-agent model and thinking defaults;
2. an explicitly synchronized bundle of curated agent definitions.

Use the terms in [`../CONTEXT.md`](../CONTEXT.md). The ADRs in [`adr/`](./adr/) record the decisions behind this design.

## Scope

The first release includes:

- discovery of user and trusted-project model-profile JSON files;
- strict profile validation and session-local activation;
- profile injection into new `subagent` tool calls;
- six semantic agent ports: `scout`, `delegate`, `researcher`, `worker`, `reviewer`, and `oracle`;
- status, synchronization, and removal commands for extension-owned agent files.

The first release does not include:

- profile creation, editing, renaming, deletion, or generation;
- persisted profile selection;
- profile propagation to child sessions or resumed subagents;
- support for the unrelated nicobailon `pi-subagents` runtime;
- direct imports from `@gotgenes/pi-subagents`;
- automatic writes during extension activation;
- mitigation of upstream project-agent trust behavior.

## Integration constraints

`src/index.ts` remains a synchronous, I/O-free `ExtensionAPI` factory. It registers commands and the `tool_call` handler immediately. Command callbacks and event callbacks lazily load implementation modules when invoked.

Each extension instance owns its active-profile state. State must not live in a module singleton because parent and child sessions load the extension in the same process. A child extension instance therefore begins with no Active Model Profile even if its parent has one.

The integration uses Pi public APIs only:

- command registration for user operations;
- `tool_call` input mutation for Profile Injection;
- `getAllTools()` for upstream contract detection;
- `ExtensionContext.isProjectTrusted()` for project-profile access;
- Pi's model registry for exact model availability;
- `withFileMutationQueue` around complete agent-file read-modify-write operations.

The package does not declare or import `@gotgenes/pi-subagents` as a runtime dependency. Compatibility is established by feature-detecting a registered tool named `subagent` with the expected `subagent_type`, `model`, `thinking`, and `resume` fields. The tested upstream version is documented in release and test evidence.

## Model profiles

### Locations and precedence

Profiles are direct `.json` children of these directories:

1. user: `$PI_CODING_AGENT_DIR/profiles/pi-subagents-plus/`;
2. project: `<cwd>/.pi/profiles/pi-subagents-plus/`.

Implementation uses Pi's public agent-directory helper and `CONFIG_DIR_NAME`; it does not hardcode expanded home paths or `.pi`.

Project profiles are discovered only when `ctx.isProjectTrusted()` is true. A project profile shadows a same-named user profile. If the project file is malformed or invalid, selection fails with that project error; it never falls back to the shadowed user file. An untrusted project contributes no profiles, so the user profile remains visible.

A profile name is the case-sensitive filename without `.json`. Command arguments must match a discovered name exactly and are never interpreted as paths.

### Schema

A profile is a strict, nonempty JSON object:

```json
{
  "scout": {
    "model": "provider/model-id",
    "thinking": "low"
  },
  "worker": {
    "model": "provider/other-model"
  }
}
```

Each top-level key is an agent selector. Selectors match `subagent_type` case-insensitively, consistent with upstream behavior. A profile may name an agent that is not currently installed because upstream exposes no public agent-type registry. Distinct keys that collide after case folding are invalid.

Each entry has:

- `model`: required exact `provider/model-id` string;
- `thinking`: optional value from `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`.

Profiles reject an empty map, unknown entry fields, malformed model identifiers, invalid thinking values, and case-folded selector collisions. No fuzzy model names are accepted.

### Discovery and validation

Every list, named-show, and use command reads the current files. An already Active Model Profile remains the validated in-memory snapshot captured when selected; later file edits do not alter it.

Selection is atomic. Before activation, the extension validates:

- JSON syntax and schema;
- all thinking values;
- case-folded selector uniqueness;
- every exact model against the current Pi model registry, including provider availability.

Agent selector existence is not validated. Reimplementing upstream's private agent discovery would create version drift and duplicate its trust behavior.

Listing includes each effective profile's origin and validation status. An invalid project shadow remains visible as an error and identifies the hidden user collision. Showing a named profile reports its current on-disk representation and origin.

### Commands

The extension registers:

- `/subagents:profile:list`
- `/subagents:profile:show [name]`
- `/subagents:profile:use <name>`
- `/subagents:profile:off`

`show` without a name displays the Active Model Profile snapshot. `off` is idempotent.

List and named-show can inspect files without the upstream tool. Use refuses activation when the expected `subagent` contract is absent. Active-show reports that the companion runtime is unavailable when that contract is absent. Agent-management commands remain available independently.

The command namespace intentionally follows upstream. See [ADR 0005](./adr/0005-use-the-upstream-command-namespace.md) for the accepted collision risk.

### Session lifetime

The active selection exists only in the extension instance's memory. It is not written to Pi settings, profile files, session entries, or other persistence. Consequently it:

- ends on extension or session reload;
- is not restored with a resumed parent session;
- is not inherited by child sessions;
- cannot change an already-created child.

### Profile Injection

The `tool_call` handler acts only when all conditions hold:

1. the tool name is `subagent`;
2. an Active Model Profile exists;
3. `resume` is absent;
4. `subagent_type` case-insensitively matches an entry.

For each of `model` and `thinking`, the handler writes the profile value only when the call omitted that field. Precedence is resolved independently:

1. explicit tool-call field;
2. Active Model Profile field;
3. agent frontmatter or upstream default.

An explicit model does not suppress profile thinking, and explicit thinking does not suppress the profile model. Invalid explicit values remain upstream's responsibility.

Profile Injection does not bypass an agent's `locked` declaration. Injected values enter the normal upstream invocation path; upstream may retain locked agent values and report that outcome.

The handler never changes resume calls, agent identity, prompts, context inheritance, background mode, turn limits, or any result.

## Bundled agents

### Provenance and adaptation

The initial bundle is a versioned semantic adaptation of these definitions from nicobailon `pi-subagents` v0.70.1:

- `scout`
- `delegate`
- `researcher`
- `worker`
- `reviewer`
- `oracle`

The package preserves the source's MIT copyright and permission notice in a distributed third-party notice. The ports are maintained as source files in this repository and updated deliberately in companion releases. Agent Sync never fetches or transforms remote definitions.

The ports preserve each role's purpose and important constraints while translating unsupported frontmatter, tool names, coordination instructions, and output conventions into `@gotgenes/pi-subagents` concepts. They are not verbatim copies.

### Capability policy

Bundled agents list only `@gotgenes/pi-subagents` core capability tools. They do not list `ask_parent` or `notify_parent`; upstream installs those protocol tools independently according to its runtime policy.

Initial frontmatter defaults are:

| Agent        | Capability tools                                      | Thinking | Prompt mode | Inherit context |
| ------------ | ----------------------------------------------------- | -------- | ----------- | --------------- |
| `scout`      | `read`, `grep`, `find`, `ls`, `bash`, `write`         | `low`    | `replace`   | no              |
| `delegate`   | `read`, `grep`, `find`, `ls`, `bash`, `edit`, `write` | omitted  | `append`    | no              |
| `researcher` | `read`, `grep`, `find`, `ls`, `bash`, `write`         | `medium` | `replace`   | no              |
| `worker`     | `read`, `grep`, `find`, `ls`, `bash`, `edit`, `write` | `high`   | `replace`   | yes             |
| `reviewer`   | `read`, `grep`, `find`, `ls`                          | `high`   | `replace`   | no              |
| `oracle`     | `read`, `grep`, `find`, `ls`, `bash`                  | `high`   | `replace`   | yes             |

Model defaults, turn limits, background defaults, and locks are omitted. Model profiles or upstream inheritance supply models.

The researcher retains web research as its purpose but uses available command-line utilities through `bash`. Its prompt requires primary-source evidence, clear attribution, and an explicit limitation report when the environment lacks suitable network or search utilities.

Prompts use upstream `ask_parent` semantics for blocking decisions and `notify_parent` semantics only when that tool is present. They do not mention nicobailon-specific supervisors, workflows, artifacts, settings, or extension-loading behavior.

## Agent Sync

### Destination and commands

Bundled agents are synchronized only to the user agent directory:

```text
$PI_CODING_AGENT_DIR/agents/<agent>.md
```

The extension registers:

- `/subagents:agents:status`
- `/subagents:agents:sync`
- `/subagents:agents:remove`

No command writes project `.pi/agents` files.

### Ownership metadata

Every generated file carries extension-specific frontmatter metadata containing:

- the owner identifier `@smb374/pi-subagents-plus`;
- the bundled source/version identifier;
- a SHA-256 hash of the generated content excluding the hash field itself.

Unknown frontmatter fields are intentionally used because upstream ignores them. The hashing rule must have one canonical byte representation and be shared by generation, status, sync, removal, and tests.

A regular file is an Owned Agent File only when its ownership metadata is well-formed and its stored hash matches its current generated content. A same-named unmarked file, malformed marker, symlink, non-regular entry, or hash mismatch is a conflict.

### Reconciliation plan

`status` performs no mutation. It compares bundled definitions with the destination and reports:

- `create`: bundled file is absent;
- `update`: unchanged owned file differs from the current bundle;
- `remove`: unchanged owned file is no longer in the bundle;
- `unchanged`: owned file equals the current bundle;
- `conflict`: the extension cannot prove safe ownership.

`sync` recomputes the plan inside one file-mutation queue and applies every safe create, update, and remove action. Conflicts remain untouched and are reported. Writes use staged temporary files and same-directory atomic replacement where supported. A failed action is reported precisely; it does not authorize mutation of a conflict.

This is a managed mirror, not a template copier. Users customize an agent by copying it to another name or removing the ownership metadata; the resulting file is then unmanaged and future syncs report a collision rather than replacing it.

### Full removal

`remove` recomputes the set of unchanged Owned Agent Files and previews the affected paths. In TUI mode it requires confirmation. Without interactive UI it refuses mutation unless the exact `--yes` argument is present. Conflicts and unmanaged files are never removed.

## Trust and security

Project model profiles are trusted project resources because they select code-executing providers and models. The extension consults `ctx.isProjectTrusted()` before reading them.

User model profiles and bundled user agents are user-owned resources and do not depend on project trust.

The installed upstream version currently discovers project `.pi/agents` without consulting Pi's trust state. This companion documents that upstream gap but does not duplicate agent discovery or block subagent calls. That behavior must be corrected upstream if stronger guarantees are required.

All command arguments that identify profiles are matched against discovered names rather than joined directly into paths. Agent-file mutation rejects symlinks and non-regular destination entries.

## Failure behavior

Failures are explicit and local:

- malformed or invalid profile: list/show reports the file error; use leaves the previous active profile unchanged;
- unavailable model: use fails atomically and leaves the previous active profile unchanged;
- missing or incompatible upstream tool: profile activation is unavailable; agent status/sync/removal still work;
- invalid explicit tool-call override: upstream handles it because injection never replaces explicit fields;
- agent-file collision or local edit: report conflict and preserve the file;
- partial filesystem failure: report completed and failed safe actions separately; never relabel uncertain files as synchronized;
- declined or missing removal confirmation: perform no removal.

User-facing errors identify the command, profile or path, failed condition, and required corrective action.

## Implementation shape

Keep the extension flat until concrete capabilities justify files. A suitable initial split is:

```text
src/
├── index.ts                 # synchronous registration and instance-local state
├── profiles.ts              # discovery, merge, validation, commands, injection
├── agent-sync.ts            # ownership parsing, reconciliation, commands
└── agents/                  # six bundled Markdown definitions
```

Pure functions own schema validation, precedence, case folding, ownership verification, and reconciliation planning. Pi mechanics remain at the command/event boundary. Filesystem mutation wraps the complete rescan-plan-apply sequence in `withFileMutationQueue`.

`index.ts` creates the instance-local profile state and passes it into lazily imported callbacks. Imported modules must not retain session state globally.

## Verification contract

Tests use observable behavior and real Pi loading rather than module mocks or method spies.

Required profile evidence:

- user discovery and trusted-project precedence;
- untrusted-project fallback to user profiles;
- invalid project shadow fails closed;
- strict schema, thinking, model, and case-fold collision validation;
- atomic use that preserves the previous selection on failure;
- current-file reads for list/show/use and snapshot behavior after activation;
- exact, field-by-field injection into new matching spawns;
- no injection for explicit fields, unmatched agents, resume calls, inactive profiles, or child extension instances;
- missing/incompatible upstream contract behavior;
- no profile persistence across a fresh extension instance.

Required agent-sync evidence:

- create, update, remove, unchanged, and conflict plans;
- unmanaged collision, modified-owned-file, malformed-marker, and symlink preservation;
- safe partial application with conflict reporting;
- TUI confirmation and non-TUI `--yes` removal behavior;
- all six packaged definitions parse under upstream frontmatter rules and expose the agreed defaults;
- package artifact contains the bundled definitions and third-party notice.

The existing load test continues to prove that direct extension loading performs no extension-owned I/O. Before handoff, run:

```bash
bun run verify
```
