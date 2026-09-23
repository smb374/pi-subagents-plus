import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
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
const upstreamExtensionPath = fileURLToPath(
    new URL("../node_modules/@gotgenes/pi-subagents/src/index.ts", import.meta.url),
);

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

    async function loadRunner(includeUpstream = false) {
        const loader = new DefaultResourceLoader({
            cwd: root,
            agentDir,
            additionalExtensionPaths: includeUpstream
                ? [upstreamExtensionPath, extensionPath]
                : [extensionPath],
            noSkills: true,
            noPromptTemplates: true,
            noThemes: true,
            noContextFiles: true,
        });
        await loader.reload();
        const loaded = loader.getExtensions();
        expect(loaded.errors).toEqual([]);
        expect(loaded.extensions).toHaveLength(includeUpstream ? 2 : 1);
        const { session } = await createAgentSession({
            cwd: root,
            agentDir,
            resourceLoader: loader,
            sessionManager: SessionManager.inMemory(root),
            tools: includeUpstream ? ["subagent"] : [],
        });
        sessions.push(session);

        return session.extensionRunner;
    }

    it("loads the direct TypeScript entry without extension-owned I/O", async () => {
        const runner = await loadRunner();
        expect(runner.getAllRegisteredTools()).toEqual([]);
        expect(
            runner
                .getRegisteredCommands()
                .map(({ name }) => name)
                .sort(),
        ).toEqual([
            "subagents:agents:status",
            "subagents:agents:sync",
            "subagents:profile:list",
            "subagents:profile:off",
            "subagents:profile:show",
            "subagents:profile:use",
        ]);
    });

    it("runs status without writes and sync creates only bundled agents", async () => {
        const runner = await loadRunner();
        const status = runner.getCommand("subagents:agents:status");
        const sync = runner.getCommand("subagents:agents:sync");
        if (status === undefined || sync === undefined)
            throw new Error("The Agent Sync commands are not registered.");

        await status.handler("", runner.createCommandContext());
        await expect(readdir(path.join(agentDir, "agents"))).rejects.toMatchObject({
            code: "ENOENT",
        });

        await sync.handler("", runner.createCommandContext());
        expect((await readdir(path.join(agentDir, "agents"))).sort()).toEqual([
            "delegate.md",
            "oracle.md",
            "researcher.md",
            "reviewer.md",
            "scout.md",
            "worker.md",
        ]);
        await status.handler("", runner.createCommandContext());
    });

    it("completes profile names without JSON suffixes", async () => {
        await mkdir(path.join(agentDir, "profiles", "pi-subagents-plus"), { recursive: true });
        await writeFile(
            path.join(agentDir, "profiles", "pi-subagents-plus", "smoke.json"),
            '{"scout":{"model":"openrouter/a"}}',
        );
        const runner = await loadRunner();
        const command = runner
            .getRegisteredCommands()
            .find(({ name }) => name === "subagents:profile:use");
        if (command === undefined) throw new Error("The use command is not registered.");

        await expect(command.getArgumentCompletions?.("sm")).resolves.toEqual([
            { value: "smoke", label: "smoke" },
        ]);
    });

    it("injects an Active Model Profile through the real upstream tool contract", async () => {
        await mkdir(path.join(agentDir, "profiles", "pi-subagents-plus"), { recursive: true });
        await writeFile(
            path.join(agentDir, "models.json"),
            '{"providers":{"test":{"baseUrl":"http://127.0.0.1","api":"openai-completions","apiKey":"test","models":[{"id":"model"}]}}}',
        );
        await writeFile(
            path.join(agentDir, "profiles", "pi-subagents-plus", "smoke.json"),
            '{"Scout":{"model":"test/model","thinking":"low"}}',
        );
        const runner = await loadRunner(true);
        expect(runner.getModelRegistry().getAvailable()).toContainEqual(
            expect.objectContaining({ provider: "test", id: "model" }),
        );

        expect(runner.getToolDefinition("subagent")).toBeDefined();
        const use = runner.getCommand("subagents:profile:use");
        if (use === undefined) throw new Error("The profile use command is not registered.");

        await use.handler("smoke", runner.createCommandContext());

        const matching = { subagent_type: "scout" };
        await runner.emitToolCall({
            type: "tool_call",
            toolCallId: "matching",
            toolName: "subagent",
            input: matching,
        });
        expect(matching).toEqual({ subagent_type: "scout", model: "test/model", thinking: "low" });

        const blankFields = { subagent_type: "scout", resume: "", model: "", thinking: "" };
        await runner.emitToolCall({
            type: "tool_call",
            toolCallId: "blank-fields",
            toolName: "subagent",
            input: blankFields,
        });
        expect(blankFields).toEqual({
            subagent_type: "scout",
            model: "test/model",
            thinking: "low",
        });

        const explicitModel = { subagent_type: "Scout", model: "call/model" };
        await runner.emitToolCall({
            type: "tool_call",
            toolCallId: "explicit-model",
            toolName: "subagent",
            input: explicitModel,
        });
        expect(explicitModel).toEqual({
            subagent_type: "Scout",
            model: "call/model",
            thinking: "low",
        });

        const explicitThinking = { subagent_type: "scout", thinking: "high" };
        await runner.emitToolCall({
            type: "tool_call",
            toolCallId: "explicit-thinking",
            toolName: "subagent",
            input: explicitThinking,
        });
        expect(explicitThinking).toEqual({
            subagent_type: "scout",
            model: "test/model",
            thinking: "high",
        });

        const otherTool = { subagent_type: "scout" };
        await runner.emitToolCall({
            type: "tool_call",
            toolCallId: "other-tool",
            toolName: "other-tool",
            input: otherTool,
        });
        expect(otherTool).toEqual({ subagent_type: "scout" });

        for (const input of [
            { subagent_type: "worker" },
            { subagent_type: "scout", resume: "agent-id" },
            { subagent_type: "scout", model: "call/model", thinking: "high" },
        ]) {
            const expected = structuredClone(input);
            await runner.emitToolCall({
                type: "tool_call",
                toolCallId: crypto.randomUUID(),
                toolName: "subagent",
                input,
            });
            expect(input).toEqual(expected);
        }

        const separateRunner = await loadRunner(true);
        const withoutActiveProfile = { subagent_type: "scout" };
        await separateRunner.emitToolCall({
            type: "tool_call",
            toolCallId: "no-active-profile",
            toolName: "subagent",
            input: withoutActiveProfile,
        });
        expect(withoutActiveProfile).toEqual({ subagent_type: "scout" });
    });
});
