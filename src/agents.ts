import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    getAgentDir,
    withFileMutationQueue,
    type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

const AGENT_NAMES = ["scout", "delegate", "researcher", "worker", "reviewer", "oracle"] as const;
const OWNER = "@smb374/pi-subagents-plus";
const SOURCE = "nicobailon/pi-subagents@v0.70.1";
const HASH_KEY = "pi-subagents-plus-hash";
const OWNER_KEY = "pi-subagents-plus-owner";
const SOURCE_KEY = "pi-subagents-plus-source";
const SHA256 = /^[a-f0-9]{64}$/u;

export type AgentAction = "create" | "update" | "unchanged" | "conflict";
export type GeneratedAgent = { name: (typeof AGENT_NAMES)[number]; content: string };
export type AgentPlan = { name: GeneratedAgent["name"]; path: string; action: AgentAction };
type SafeAction = Extract<AgentAction, "create" | "update">;
export type AgentSyncResult = {
    completed: Array<{ name: string; action: SafeAction }>;
    failed: Array<{ name: string; action: SafeAction; error: string }>;
};

function canonicalize(content: string): string {
    return content.replaceAll("\r\n", "\n");
}

function hash(content: string): string {
    return createHash("sha256").update(canonicalize(content), "utf8").digest("hex");
}

function generatedContent(source: string): string {
    const normalized = canonicalize(source);
    const end = normalized.indexOf("\n---\n");
    if (!normalized.startsWith("---\n") || end === -1)
        throw new Error("The bundled agent has invalid frontmatter.");
    const metadata = `${OWNER_KEY}: ${OWNER}\n${SOURCE_KEY}: ${SOURCE}`;
    const withoutHash = `${normalized.slice(0, end)}\n${metadata}\n${normalized.slice(end + 1)}`;
    return `${normalized.slice(0, end)}\n${metadata}\n${HASH_KEY}: ${hash(withoutHash)}\n${normalized.slice(end + 1)}`;
}

function ownedContent(content: string): string | undefined {
    const normalized = canonicalize(content);
    const end = normalized.indexOf("\n---\n");
    if (!normalized.startsWith("---\n") || end === -1) return undefined;
    const frontmatter = normalized.slice(4, end).split("\n");
    const value = (key: string): string | undefined => {
        const values = frontmatter
            .filter((line) => line.startsWith(`${key}: `))
            .map((line) => line.slice(key.length + 2));
        return values.length === 1 ? values[0] : undefined;
    };
    const owner = value(OWNER_KEY);
    const source = value(SOURCE_KEY);
    const storedHash = value(HASH_KEY);
    if (owner !== OWNER || source !== SOURCE || storedHash === undefined) return undefined;
    if (!SHA256.test(storedHash)) return undefined;
    const withoutHash = normalized.replace(`${HASH_KEY}: ${storedHash}\n`, "");
    return hash(withoutHash) === storedHash ? withoutHash : undefined;
}

/* oxlint-disable antislop/no-runtime-typeof, antislop/no-unknown-parameters -- isCode parses Node.js file-system errors at this trust boundary. */
function isCode(error: unknown, code: string): error is { code: string } {
    return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

async function inspect(target: string, desired: string): Promise<AgentAction> {
    try {
        const status = await lstat(target);
        if (!status.isFile() || status.isSymbolicLink()) return "conflict";
        const content = await readFile(target, "utf8");
        if (ownedContent(content) === undefined) return "conflict";
        return canonicalize(content) === desired ? "unchanged" : "update";
    } catch (error: unknown) {
        if (isCode(error, "ENOENT")) return "create";
        return "conflict";
    }
}
export async function createBundledAgents(): Promise<GeneratedAgent[]> {
    return Promise.all(
        AGENT_NAMES.map(async (name) => ({
            name,
            content: generatedContent(
                await readFile(
                    fileURLToPath(new URL(`./agents/${name}.md`, import.meta.url)),
                    "utf8",
                ),
            ),
        })),
    );
}

export async function planAgentSync(
    agentDir: string,
    agents: GeneratedAgent[],
): Promise<AgentPlan[]> {
    return Promise.all(
        agents.map(async ({ name, content }) => {
            const target = path.join(agentDir, `${name}.md`);
            return { name, path: target, action: await inspect(target, content) };
        }),
    );
}

async function writeAtomically(target: string, content: string, action: SafeAction): Promise<void> {
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = path.join(
        path.dirname(target),
        `.${path.basename(target)}.${randomUUID()}.tmp`,
    );
    try {
        await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
        if (action === "create") {
            await link(temporary, target);
            return;
        }
        if ((await inspect(target, content)) !== "update")
            throw new Error("the path changed before replacement");
        // ponytail: Node lacks no-replace atomic update. Use renameat2(RENAME_EXCHANGE) when Node exposes it.
        await rename(temporary, target);
    } finally {
        await rm(temporary, { force: true });
    }
}

export async function applyAgentPlan(
    plan: AgentPlan[],
    agents: GeneratedAgent[],
): Promise<AgentSyncResult> {
    const generated = new Map(agents.map((agent) => [agent.name, agent]));
    const result: AgentSyncResult = { completed: [], failed: [] };
    for (const entry of plan) {
        if (entry.action !== "create" && entry.action !== "update") continue;
        const agent = generated.get(entry.name);
        if (agent === undefined) {
            result.failed.push({
                name: entry.name,
                action: entry.action,
                error: "the bundled agent is missing",
            });
            continue;
        }
        const current = await inspect(entry.path, agent.content);
        if (current !== entry.action) {
            result.failed.push({
                name: entry.name,
                action: entry.action,
                error: `the path changed from ${entry.action} to ${current}`,
            });
            continue;
        }
        try {
            await writeAtomically(entry.path, agent.content, entry.action);
            result.completed.push({ name: entry.name, action: entry.action });
        } catch (error: unknown) {
            result.failed.push({
                name: entry.name,
                action: entry.action,
                error: error instanceof Error ? error.message : "the file write failed",
            });
        }
    }
    return result;
}

export async function syncAgentDirectory(agentDir: string): Promise<{
    plan: AgentPlan[];
    result: AgentSyncResult;
}> {
    return withFileMutationQueue(agentDir, async () => {
        const agents = await createBundledAgents();
        const plan = await planAgentSync(agentDir, agents);
        return { plan, result: await applyAgentPlan(plan, agents) };
    });
}

export function formatAgentPlan(plan: AgentPlan[], command: string): string {
    return plan
        .map(({ action, path: target }) =>
            action === "conflict"
                ? `conflict: ${target}: the file is not an unchanged owned agent. Fix the file and run ${command} again.`
                : `${action}: ${target}`,
        )
        .join("\n");
}

export async function runAgentCommand(
    command: "status" | "sync",
    args: string,
    ctx: ExtensionCommandContext,
): Promise<void> {
    const name = `subagents:agents:${command}`;
    if (args.trim().length > 0) {
        ctx.ui.notify(
            `${name}: this command takes no arguments. Remove the argument and try again.`,
            "error",
        );
        return;
    }
    try {
        if (command === "status") {
            const plan = await planAgentSync(getAgentDir(), await createBundledAgents());
            ctx.ui.notify(formatAgentPlan(plan, name));
            return;
        }
        const { plan, result } = await syncAgentDirectory(getAgentDir());
        const completed = result.completed.map(
            ({ action, name: agent }) => `completed ${action}: ${agent}.md`,
        );
        const failed = result.failed.map(
            ({ action, error, name: agent }) =>
                `failed ${action}: ${agent}.md: ${error}. Fix the path and run ${name} again.`,
        );
        ctx.ui.notify(
            [...formatAgentPlan(plan, name).split("\n"), ...completed, ...failed].join("\n"),
        );
    } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : "an unknown error occurred";
        ctx.ui.notify(`${name}: ${detail}. Check the agent directory and try again.`, "error");
    }
}
