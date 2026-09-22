import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

const agentsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/agents");

const BUNDLED_AGENTS = ["scout", "delegate", "researcher", "worker", "reviewer", "oracle"] as const;
const UPSTREAM_BUILTIN_TOOLS = new Set(["read", "grep", "find", "ls", "bash", "edit", "write"]);

type BundledDefaults = {
    tools: string[];
    thinking?: string;
    prompt_mode: string;
    inherit_context: boolean;
};

const EXPECTED_DEFAULTS = {
    scout: {
        tools: ["read", "grep", "find", "ls", "bash", "write"],
        thinking: "low",
        prompt_mode: "replace",
        inherit_context: false,
    },
    delegate: {
        tools: ["read", "grep", "find", "ls", "bash", "edit", "write"],
        prompt_mode: "append",
        inherit_context: false,
    },
    researcher: {
        tools: ["read", "grep", "find", "ls", "bash", "write"],
        thinking: "medium",
        prompt_mode: "replace",
        inherit_context: false,
    },
    worker: {
        tools: ["read", "grep", "find", "ls", "bash", "edit", "write"],
        thinking: "high",
        prompt_mode: "replace",
        inherit_context: true,
    },
    reviewer: {
        tools: ["read", "grep", "find", "ls"],
        thinking: "high",
        prompt_mode: "replace",
        inherit_context: false,
    },
    oracle: {
        tools: ["read", "grep", "find", "ls", "bash"],
        thinking: "high",
        prompt_mode: "replace",
        inherit_context: true,
    },
} satisfies Record<(typeof BUNDLED_AGENTS)[number], BundledDefaults>;

// Design-quoted minimal Child Protocol reminder every bundled prompt must carry verbatim.
const MINIMAL_REMINDER =
    "Parent coordination: `ask_parent` is available; `notify_parent` is available when mid-run updates are enabled. Follow their tool descriptions when coordination is needed. These protocol tools are supplied independently of this agent's capability allowlist.";

// nicobailon-specific runtime concepts the ports must not mention.
const FORBIDDEN_PROMPT_TERMS = [
    "contact_supervisor",
    "watchdog_diff",
    "web_search",
    "fetch_content",
    "get_search_content",
    "source_check",
    "intercom",
    "supervisor",
    "systemPromptMode",
    "inheritProjectContext",
    "inheritSkills",
    "acceptanceRole",
    "aliases",
];

type BundledFrontmatter = {
    description?: string;
    tools?: string;
    thinking?: string;
    prompt_mode?: string;
    inherit_context?: boolean;
};

async function readAgent(agent: (typeof BUNDLED_AGENTS)[number]) {
    const content = await readFile(path.join(agentsDir, `${agent}.md`), "utf8");
    return parseFrontmatter<BundledFrontmatter>(content);
}

describe("bundled agent definitions", () => {
    it("ships exactly the six bundled definitions plus the third-party notice", async () => {
        const files = await readdir(agentsDir);

        expect(files.sort()).toEqual(
            [...BUNDLED_AGENTS.map((agent) => `${agent}.md`), "THIRD-PARTY-NOTICE.md"].sort(),
        );
    });

    for (const agent of BUNDLED_AGENTS) {
        it(`${agent} exposes the agreed frontmatter defaults`, async () => {
            const { frontmatter } = await readAgent(agent);
            const expected: BundledDefaults = EXPECTED_DEFAULTS[agent];

            expect(frontmatter.description).toEqual(expect.any(String));
            expect(frontmatter.tools?.split(",").map((tool) => tool.trim())).toEqual(
                expected.tools,
            );

            expect(frontmatter.thinking).toBe(expected.thinking);
            expect(frontmatter.prompt_mode).toBe(expected.prompt_mode);
            expect(frontmatter.inherit_context).toBe(expected.inherit_context);

            // Model defaults, turn limits, background defaults, and locks are omitted.
            expect(frontmatter).not.toHaveProperty("model");
            expect(frontmatter).not.toHaveProperty("max_turns");
            expect(frontmatter).not.toHaveProperty("run_in_background");
            expect(frontmatter).not.toHaveProperty("locked");
        });

        it(`${agent} carries the minimal reminder and no foreign runtime concepts`, async () => {
            const { frontmatter, body } = await readAgent(agent);

            expect(body).toContain(MINIMAL_REMINDER);
            expect([...body.matchAll(/`ask_parent`/gu)]).toHaveLength(1);
            expect([...body.matchAll(/`notify_parent`/gu)]).toHaveLength(1);

            const lowered = body.toLowerCase();
            for (const term of FORBIDDEN_PROMPT_TERMS) {
                expect(lowered.includes(term.toLowerCase())).toBe(false);
            }

            // Only upstream core capability tools; protocol tools stay runtime-injected.
            const tools = frontmatter.tools?.split(",").map((tool) => tool.trim()) ?? [];
            for (const tool of tools) {
                expect(UPSTREAM_BUILTIN_TOOLS.has(tool)).toBe(true);
            }

            expect(tools).not.toContain("ask_parent");
            expect(tools).not.toContain("notify_parent");
        });
    }

    it("distributes the upstream MIT copyright and permission notice", async () => {
        const notice = await readFile(path.join(agentsDir, "THIRD-PARTY-NOTICE.md"), "utf8");

        expect(notice).toContain("Copyright (c) 2026 Nico Bailon");
        expect(notice).toContain("Permission is hereby granted, free of charge");
        expect(notice).toContain("v0.70.1");
    });
});
