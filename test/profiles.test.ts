import { describe, expect, it } from "vitest";

import { validateProfile } from "../src/profiles.ts";

describe("model profile validation", () => {
    it("accepts a strict profile with an optional thinking value", () => {
        expect(
            validateProfile({ scout: { model: "openrouter/openai/gpt-5", thinking: "low" } }),
        ).toEqual({
            ok: true,
            value: { scout: { model: "openrouter/openai/gpt-5", thinking: "low" } },
        });
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
