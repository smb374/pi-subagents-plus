# Pi Subagents Plus

An extension to extend @gotgenes/pi-subagents for personal needs

## Install

```sh
pi install npm:@smb374/pi-subagents-plus
```

## Usage

Model Profiles are JSON files in `$PI_CODING_AGENT_DIR/profiles/pi-subagents-plus/` or, for trusted projects, `.pi/profiles/pi-subagents-plus/`.

Use `/subagents:profile:list`, `/subagents:profile:show [name]`, `/subagents:profile:use <name>`, and `/subagents:profile:off` to inspect and select profiles.
## Development

Requires [Bun](https://bun.sh) for dependency management and scripts.

```sh
just setup
just install
just coverage
```

`src/index.ts` is the direct TypeScript entry; `bun run verify` checks source, tests, and the packaged artifact.


## License

[BSD-3-Clause](LICENSE)

