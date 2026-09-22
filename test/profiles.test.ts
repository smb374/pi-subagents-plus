import { describe, expect, it } from "vitest";

import { injectProfile, validateProfile, type ProfileState } from "../src/profiles.ts";

describe("model profile validation", () => {
    it("accepts a strict profile with an optional thinking value", () => {
        expect(
            validateProfile({ scout: { model: "openrouter/openai/gpt-5", thinking: "low" } }),
        ).toEqual({
            ok: true,
            value: { scout: { model: "openrouter/openai/gpt-5", thinking: "low" } },
        });
    });

    it("preserves a __proto__ selector as a validated entry", () => {
        const result = validateProfile(JSON.parse('{"__proto__":{"model":"openrouter/a"}}'));
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value.__proto__).toEqual({ model: "openrouter/a" });
    });

    it.each([
        [{}, "must contain at least one selector"],
        [{ scout: { model: "bad" } }, "must be provider/model-id"],
        [{ scout: { model: "openrouter/a", extra: true } }, "has an unknown field"],
        [{ scout: { model: "openrouter/a", thinking: "fast" } }, "has an invalid thinking value"],
        [
            { Scout: { model: "openrouter/a" }, scout: { model: "openrouter/b" } },
            "collides case-insensitively",
        ],
    ])("rejects %j", (profile, error) => {
        const result = validateProfile(profile);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain(error);
    });
});

describe("Model Profile injection", () => {
    const state: ProfileState = {
        active: {
            name: "test",
            profile: { Scout: { model: "openrouter/openai/gpt-5", thinking: "low" } },
        },
    };

    it("adds only missing defaults for a case-insensitive new spawn", () => {
        const input = { subagent_type: "scout", model: "explicit/model" };
        injectProfile(input, state);
        expect(input).toEqual({
            subagent_type: "scout",
            model: "explicit/model",
            thinking: "low",
        });
    });

    it("does not alter resumed spawns", () => {
        const input = { subagent_type: "scout", resume: "run-id" };
        injectProfile(input, state);
        expect(input).toEqual({ subagent_type: "scout", resume: "run-id" });
    });
});
