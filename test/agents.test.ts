import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
    applyAgentPlan,
    applyAgentRemoval,
    createBundledAgents,
    planAgentSync,
    type AgentPlan,
} from "../src/agents.ts";

const AGENT_NAMES = ["scout", "delegate", "researcher", "worker", "reviewer", "oracle"] as const;

describe("Agent Sync", () => {
    let agentDir: string;

    beforeEach(async () => {
        agentDir = await mkdtemp(path.join(tmpdir(), "pi-subagents-plus-agents-"));
    });

    afterEach(async () => {
        await rm(agentDir, { recursive: true, force: true });
    });

    it("plans six creates without writing files", async () => {
        const plan = await planAgentSync(agentDir, await createBundledAgents());

        expect(plan.map(({ action, name }) => ({ action, name }))).toEqual(
            AGENT_NAMES.map((name) => ({ action: "create", name })),
        );
        await expect(lstat(path.join(agentDir, "scout.md"))).rejects.toMatchObject({
            code: "ENOENT",
        });
    });

    it("shares one canonical hash rule between generated and inspected files", async () => {
        const agents = await createBundledAgents();
        const scout = agents.find(({ name }) => name === "scout");
        if (scout === undefined) throw new Error("The scout agent is missing.");

        await writeFile(path.join(agentDir, "scout.md"), scout.content);

        const plan = await planAgentSync(agentDir, agents);

        expect(plan.find(({ name }) => name === "scout")?.action).toBe("unchanged");
    });

    it("uses the same hash for CRLF agent content", async () => {
        const agents = await createBundledAgents();
        const scout = agents.find(({ name }) => name === "scout");
        if (scout === undefined) throw new Error("The scout agent is missing.");

        await writeFile(path.join(agentDir, "scout.md"), scout.content.replaceAll("\n", "\r\n"));

        const plan = await planAgentSync(agentDir, agents);

        expect(plan.find(({ name }) => name === "scout")?.action).toBe("unchanged");
    });

    it.each(["unmarked", "malformed", "hash mismatch"])(
        "keeps a %s file as a conflict",
        async (kind) => {
            const agents = await createBundledAgents();
            const scout = agents.find(({ name }) => name === "scout");
            if (scout === undefined) throw new Error("The scout agent is missing.");

            const target = path.join(agentDir, "scout.md");
            const content =
                kind === "unmarked"
                    ? "unmanaged"
                    : kind === "malformed"
                      ? scout.content.replace(
                            "pi-subagents-plus-owner: github:smb374/pi-subagents-plus\n",
                            "",
                        )
                      : scout.content.replace(
                            /pi-subagents-plus-hash: [a-f0-9]{64}/u,
                            "pi-subagents-plus-hash: 0000000000000000000000000000000000000000000000000000000000000000",
                        );
            await writeFile(target, content);

            const plan = await planAgentSync(agentDir, agents);

            expect(plan.find(({ name }) => name === "scout")?.action).toBe("conflict");
            await expect(readFile(target, "utf8")).resolves.toBe(content);
        },
    );

    it("keeps a symlink as a conflict", async () => {
        const agents = await createBundledAgents();
        const target = path.join(agentDir, "scout.md");
        const linked = path.join(agentDir, "linked.md");
        await writeFile(linked, "unmanaged");
        await symlink(linked, target);

        const plan = await planAgentSync(agentDir, agents);

        expect(plan.find(({ name }) => name === "scout")?.action).toBe("conflict");
    });

    it("reports completed and failed safe actions after a path changes", async () => {
        const agents = await createBundledAgents();
        const plan = await planAgentSync(agentDir, agents);
        await mkdir(path.join(agentDir, "worker.md"));

        const result = await applyAgentPlan(plan, agents);

        expect(result.completed.map(({ name }) => name)).toContain("scout");
        expect(result.failed.find(({ name }) => name === "worker")?.error).toContain("changed");
        expect((await lstat(path.join(agentDir, "worker.md"))).isDirectory()).toBe(true);
    });

    it("creates the bundle and then plans it as unchanged", async () => {
        const agents = await createBundledAgents();
        const result = await applyAgentPlan(await planAgentSync(agentDir, agents), agents);

        expect(result.failed).toEqual([]);
        expect(result.completed.map(({ name }) => name)).toEqual(AGENT_NAMES);
        expect(await planAgentSync(agentDir, agents)).toEqual<AgentPlan[]>(
            AGENT_NAMES.map((name) => ({
                name,
                path: path.join(agentDir, `${name}.md`),
                action: "unchanged" as const,
            })),
        );
    });

    it("removes only unchanged owned files and plans them as creates", async () => {
        const agents = await createBundledAgents();
        await applyAgentPlan(await planAgentSync(agentDir, agents), agents);
        const edited = path.join(agentDir, "scout.md");
        const unmanaged = path.join(agentDir, "delegate.md");
        const editedContent = `${await readFile(edited, "utf8")}\nlocal edit`;
        await writeFile(edited, editedContent);
        await writeFile(unmanaged, "unmanaged");
        const linked = path.join(agentDir, "worker.md");
        await rm(linked);
        await symlink(unmanaged, linked);
        const malformed = path.join(agentDir, "reviewer.md");
        const malformedContent = (await readFile(malformed, "utf8")).replace(
            "pi-subagents-plus-owner: github:smb374/pi-subagents-plus\n",
            "",
        );
        await writeFile(malformed, malformedContent);
        const plan = await planAgentSync(agentDir, agents);

        const result = await applyAgentRemoval(plan, agents);
        expect(result.failed).toEqual([]);
        expect(result.completed.map((target) => path.basename(target, ".md"))).toEqual([
            "researcher",
            "oracle",
        ]);
        expect(await readFile(edited, "utf8")).toBe(editedContent);
        expect(await readFile(unmanaged, "utf8")).toBe("unmanaged");
        expect((await lstat(linked)).isSymbolicLink()).toBe(true);
        expect(await readFile(malformed, "utf8")).toBe(malformedContent);
        expect((await planAgentSync(agentDir, agents)).map(({ action }) => action)).toEqual([
            "conflict",
            "conflict",
            "create",
            "conflict",
            "conflict",
            "create",
        ]);
    });

    it("refuses to remove a file that changes after the plan", async () => {
        const agents = await createBundledAgents();
        await applyAgentPlan(await planAgentSync(agentDir, agents), agents);
        const plan = await planAgentSync(agentDir, agents);
        const target = path.join(agentDir, "scout.md");
        await writeFile(target, `${await readFile(target, "utf8")}\nlocal edit`);

        const result = await applyAgentRemoval(plan, agents);
        expect(
            result.failed.find(({ path: failedPath }) => failedPath === target)?.error,
        ).toContain("changed");
        expect((await planAgentSync(agentDir, agents))[0]?.action).toBe("conflict");
    });
});
