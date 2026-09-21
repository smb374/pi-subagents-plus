import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    type AgentSession,
    createAgentSession,
    DefaultResourceLoader,
    SessionManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const extensionPath = fileURLToPath(new URL("../src/index.ts", import.meta.url));

// All Pi and extension I/O is confined to this fixture for the whole lifecycle.
describe("Pi Subagents Plus extension", { concurrent: false }, () => {
    let root: string;
    let agentDir: string;
    let previousAgentDir: string | undefined;
    const sessions: AgentSession[] = [];

    beforeEach(async () => {
        root = await mkdtemp(path.join(tmpdir(), "pi-subagents-plus-"));
        agentDir = path.join(root, "agent");
        previousAgentDir = process.env.PI_CODING_AGENT_DIR;
        process.env.PI_CODING_AGENT_DIR = agentDir;
    });

    afterEach(async () => {
        for (const session of sessions) session.dispose();
        sessions.length = 0;
        if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
        else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
        await rm(root, { recursive: true, force: true });
    });

    async function loadRunner() {
        const loader = new DefaultResourceLoader({
            cwd: root,
            agentDir,
            additionalExtensionPaths: [extensionPath],
            noSkills: true,
            noPromptTemplates: true,
            noThemes: true,
            noContextFiles: true,
        });
        await loader.reload();
        const loaded = loader.getExtensions();
        expect(loaded.errors).toEqual([]);
        expect(loaded.extensions).toHaveLength(1);
        const { session } = await createAgentSession({
            cwd: root,
            agentDir,
            resourceLoader: loader,
            sessionManager: SessionManager.inMemory(root),
            tools: [],
        });
        sessions.push(session);
        return session.extensionRunner;
    }

    it("loads the direct TypeScript entry without extension-owned I/O", async () => {
        const runner = await loadRunner();
        expect(runner.getAllRegisteredTools()).toEqual([]);
    });
});
