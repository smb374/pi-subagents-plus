import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { ProfileState } from "./profiles.ts";

/** Register the Pi Subagents Plus Pi extension. */
export default function extension(pi: ExtensionAPI): void {
    const state: ProfileState = {};
    for (const command of ["list", "show", "use", "off"] as const) {
        pi.registerCommand(`subagents:profile:${command}`, {
            description: `${command} a Model Profile.`,
            async handler(args, ctx) {
                const { runProfileCommand } = await import("./profiles.ts");
                await runProfileCommand(command, args, ctx, state, pi.getAllTools());
            },
        });
    }
    pi.on("tool_call", async (event) => {
        if (event.toolName !== "subagent") return;
        const { injectProfile } = await import("./profiles.ts");
        injectProfile(event.input, state);
    });
}
