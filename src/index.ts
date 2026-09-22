import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { ProfileState } from "./profiles.ts";

/** Register the Pi Subagents Plus Pi extension. */
export default function extension(pi: ExtensionAPI): void {
    const state: ProfileState = {};

    for (const command of ["list", "show", "use", "off"] as const) {
        pi.registerCommand(`subagents:profile:${command}`, {
            description: `${command} a Model Profile.`,
            async getArgumentCompletions(prefix) {
                if (command !== "show" && command !== "use") return null;

                const { completeProfileNames } = await import("./profiles.ts");
                return completeProfileNames(prefix);
            },
            async handler(args, ctx) {
                const { runProfileCommand } = await import("./profiles.ts");
                await runProfileCommand(command, args, ctx, state, pi.getAllTools());
            },
        });
    }

    for (const command of ["status", "sync"] as const) {
        pi.registerCommand(`subagents:agents:${command}`, {
            description:
                command === "status"
                    ? "List the six managed agent files without changing them."
                    : "Create or update only unchanged extension-owned agent files.",
            async handler(args, ctx) {
                const { runAgentCommand } = await import("./agents.ts");
                await runAgentCommand(command, args, ctx);
            },
        });
    }

    pi.on("tool_call", async (event) => {
        if (event.toolName !== "subagent") return;

        const { injectProfile } = await import("./profiles.ts");
        injectProfile(event.input, state);
    });
}
