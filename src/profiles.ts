/* oxlint-disable antislop/no-runtime-typeof, antislop/no-unknown-parameters, antislop/no-unsafe-dictionary-type -- validateProfile parses JSON at this trust boundary. */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
    CONFIG_DIR_NAME,
    getAgentDir,
    type ExtensionCommandContext,
    type ExtensionContext,
    type ToolInfo,
} from "@earendil-works/pi-coding-agent";

type Thinking = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
type ProfileEntry = { model: string; thinking?: Thinking };
export type ModelProfile = Record<string, ProfileEntry>;
export type ProfileState = { active?: { name: string; profile: ModelProfile } };
type ProfileFile = {
    name: string;
    origin: "user" | "project";
    profile?: ModelProfile;
    error?: string;
    content?: string;
    hiddenUser?: boolean;
};

type Validation = { ok: true; value: ModelProfile } | { ok: false; error: string };
const THINKING = new Set<string>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const MODEL = /^[^/\s]+\/.+$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && !Array.isArray(value) && typeof value === "object";
}

function isThinking(value: unknown): value is Thinking {
    return typeof value === "string" && THINKING.has(value);
}

export function validateProfile(value: unknown): Validation {
    if (!isRecord(value) || Object.keys(value).length === 0)
        return { ok: false, error: "must contain at least one selector" };
    const profile: ModelProfile = {};
    const selectors = new Set<string>();
    for (const [selector, entry] of Object.entries(value)) {
        const folded = selector.toLocaleLowerCase();
        if (selectors.has(folded))
            return { ok: false, error: `selector '${selector}' collides case-insensitively` };
        selectors.add(folded);
        if (!isRecord(entry))
            return { ok: false, error: `selector '${selector}' must contain an object` };
        for (const key of Object.keys(entry))
            if (key !== "model" && key !== "thinking")
                return { ok: false, error: `selector '${selector}' has an unknown field '${key}'` };
        if (typeof entry.model !== "string" || !MODEL.test(entry.model))
            return { ok: false, error: `selector '${selector}' model must be provider/model-id` };
        if (entry.thinking !== undefined && !isThinking(entry.thinking))
            return { ok: false, error: `selector '${selector}' has an invalid thinking value` };
        profile[selector] =
            entry.thinking === undefined
                ? { model: entry.model }
                : { model: entry.model, thinking: entry.thinking };
    }
    return { ok: true, value: profile };
}

async function readDirectory(
    directory: string,
    origin: ProfileFile["origin"],
): Promise<ProfileFile[]> {
    let names: string[];
    try {
        names = await readdir(directory);
    } catch (error: unknown) {
        if (isRecord(error) && error.code === "ENOENT") return [];
        throw error;
    }
    return Promise.all(
        names
            .filter((name) => name.endsWith(".json"))
            .map(async (file) => {
                const name = file.slice(0, -".json".length);
                try {
                    const content = await readFile(path.join(directory, file), "utf8");
                    const parsed: unknown = JSON.parse(content);
                    const checked = validateProfile(parsed);
                    return checked.ok
                        ? { name, origin, profile: checked.value, content }
                        : { name, origin, error: checked.error, content };
                } catch (error: unknown) {
                    return {
                        name,
                        origin,
                        error:
                            error instanceof Error
                                ? `invalid JSON: ${error.message}`
                                : "invalid JSON",
                    };
                }
            }),
    );
}

async function discover(ctx: ExtensionContext): Promise<ProfileFile[]> {
    const user = await readDirectory(
        path.join(getAgentDir(), "profiles", "pi-subagents-plus"),
        "user",
    );
    if (!ctx.isProjectTrusted()) return user;
    const project = await readDirectory(
        path.join(ctx.cwd, CONFIG_DIR_NAME, "profiles", "pi-subagents-plus"),
        "project",
    );
    const userNames = new Set(user.map(({ name }) => name));
    return [
        ...user.filter(({ name }) => !project.some((profile) => profile.name === name)),
        ...project.map((profile) => ({ ...profile, hiddenUser: userNames.has(profile.name) })),
    ];
}

function report(ctx: ExtensionContext, message: string, type: "info" | "error" = "info"): void {
    ctx.ui.notify(message, type);
}

function upstreamAvailable(tools: ToolInfo[]): boolean {
    const tool = tools.find(({ name }) => name === "subagent");
    const parameters: unknown = tool?.parameters;
    const properties: unknown = isRecord(parameters) ? parameters.properties : undefined;
    if (!isRecord(properties)) return false;
    return ["subagent_type", "model", "thinking", "resume"].every((field) =>
        Object.hasOwn(properties, field),
    );
}

function profileText(profile: ProfileFile): string {
    const status = profile.error === undefined ? "valid" : `invalid: ${profile.error}`;
    const hidden = profile.hiddenUser === true ? "; hides the user profile" : "";
    return `${profile.name} (${profile.origin}, ${status}${hidden})`;
}

export async function runProfileCommand(
    command: "list" | "show" | "use" | "off",
    args: string,
    ctx: ExtensionCommandContext,
    state: ProfileState,
    tools: ToolInfo[],
): Promise<void> {
    const name = args.trim();
    if (command === "off") {
        delete state.active;
        report(ctx, "Model Profile is off.");
        return;
    }
    if (command === "show" && name.length === 0) {
        if (!upstreamAvailable(tools))
            report(
                ctx,
                "subagents:profile:show: the companion runtime is unavailable. Load a compatible subagent tool.",
                "error",
            );
        else
            report(
                ctx,
                state.active === undefined
                    ? "No Active Model Profile."
                    : `${state.active.name}:\n${JSON.stringify(state.active.profile, undefined, 2)}`,
            );
        return;
    }
    const profiles = await discover(ctx);
    if (command === "list") {
        report(
            ctx,
            profiles.length === 0 ? "No Model Profiles." : profiles.map(profileText).join("\n"),
        );
        return;
    }
    const profile = profiles.find((candidate) => candidate.name === name);
    if (profile === undefined) {
        report(
            ctx,
            `subagents:profile:${command}: '${name}' was not found. Use subagents:profile:list.`,
            "error",
        );
        return;
    }
    if (command === "show") {
        report(ctx, `${profileText(profile)}\n${profile.content ?? ""}`);
        return;
    }
    if (!upstreamAvailable(tools)) {
        report(
            ctx,
            `subagents:profile:use: '${name}' needs a compatible subagent tool. Load the upstream runtime.`,
            "error",
        );
        return;
    }
    if (profile.error !== undefined || profile.profile === undefined) {
        report(
            ctx,
            `subagents:profile:use: '${name}' is invalid: ${profile.error ?? "unknown error"}. Fix the profile file.`,
            "error",
        );
        return;
    }
    for (const { model } of Object.values(profile.profile)) {
        const [provider, ...ids] = model.split("/");
        const modelId = ids.join("/");
        if (
            provider === undefined ||
            !ctx.modelRegistry
                .getAvailable()
                .some((candidate) => candidate.provider === provider && candidate.id === modelId)
        ) {
            report(
                ctx,
                `subagents:profile:use: '${name}' model '${model}' is unavailable. Configure the provider and model.`,
                "error",
            );
            return;
        }
    }
    state.active = { name, profile: structuredClone(profile.profile) };
    report(ctx, `Active Model Profile: ${name}.`);
}

export function injectProfile(input: Record<string, unknown>, state: ProfileState): void {
    const subagentType = input.subagent_type;
    if (
        state.active === undefined ||
        input.resume !== undefined ||
        typeof subagentType !== "string"
    )
        return;
    const entry = Object.entries(state.active.profile).find(
        ([selector]) => selector.toLocaleLowerCase() === subagentType.toLocaleLowerCase(),
    )?.[1];
    if (entry === undefined) return;
    if (input.model === undefined) input.model = entry.model;
    if (input.thinking === undefined && entry.thinking !== undefined)
        input.thinking = entry.thinking;
}
