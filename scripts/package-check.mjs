import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bunExecutable = process.platform === "win32" ? "bun.exe" : "bun";

const SettingsManifestSchema = Type.Object({
    definition: Type.String(),
    prevalidation: Type.String(),
    schema: Type.String(),
    readme: Type.String(),
});
const PackageManifestSchema = Type.Object({
    name: Type.String(),
    main: Type.String(),
    devDependencies: Type.Object({
        "@earendil-works/pi-coding-agent": Type.String(),
    }),
    pi: Type.Object({ extensions: Type.Array(Type.String(), { minItems: 1 }) }),
    piExtensionSettings: Type.Optional(SettingsManifestSchema),
});
const PackedFileLine = /^packed\s+\S+\s+(.+)$/u;

/**
 * @param {string} packListing
 * @returns {string[]}
 */
function parsePackedPaths(packListing) {
    const paths = [];

    for (const line of packListing.split("\n")) {
        const packedPath = PackedFileLine.exec(line)?.[1];

        if (packedPath !== undefined) paths.push(packedPath);
    }

    if (paths.length === 0) throw new Error("bun pm pack --dry-run listed no packed files");

    return paths;
}

const packageManifest = Value.Parse(
    PackageManifestSchema,
    JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")),
);
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "pi-subagents-plus-package-check-"));
const packDirectory = path.join(temporaryRoot, "pack");
const consumerDirectory = path.join(temporaryRoot, "consumer");

try {
    await mkdir(packDirectory, { recursive: true });
    const { stdout: packListing } = await execFileAsync(
        bunExecutable,
        ["pm", "pack", "--dry-run", "--ignore-scripts"],
        { cwd: packageRoot, encoding: "utf8" },
    );
    const { stdout: packOutput } = await execFileAsync(
        bunExecutable,
        ["pm", "pack", "--quiet", "--ignore-scripts", "--destination", packDirectory],
        { cwd: packageRoot, encoding: "utf8" },
    );
    const packedFilename = path.basename(packOutput.trim());
    if (!packedFilename.endsWith(".tgz")) throw new Error("bun pm pack did not produce a tarball");

    const files = new Set(parsePackedPaths(packListing));
    const configuredPaths = [packageManifest.main, ...packageManifest.pi.extensions];
    if (packageManifest.piExtensionSettings !== undefined) {
        configuredPaths.push(
            packageManifest.piExtensionSettings.definition,
            packageManifest.piExtensionSettings.prevalidation,
            packageManifest.piExtensionSettings.schema,
            packageManifest.piExtensionSettings.readme,
        );
    }
    for (const configuredPath of configuredPaths) {
        const packedPath = configuredPath.replace(/^\.\//u, "");
        if (!files.has(packedPath)) {
            throw new Error(`package artifact is missing declared file: ${packedPath}`);
        }
    }
    for (const file of files) {
        if (file.startsWith("node_modules/") || file.includes("/node_modules/")) {
            throw new Error(`package artifact contains a nested dependency: ${file}`);
        }
        if (file.startsWith("test/") || file.startsWith("scripts/")) {
            throw new Error(`package artifact contains development-only files: ${file}`);
        }
    }

    const workspacePaths = new Set([packageRoot, packageRoot.split(path.sep).join("/")]);
    const textExtensions = new Set([".js", ".json", ".map", ".md", ".mjs", ".ts"]);
    for (const file of files) {
        if (!textExtensions.has(path.extname(file))) continue;
        const content = await readFile(path.join(packageRoot, file), "utf8");
        for (const workspacePath of workspacePaths) {
            if (content.includes(workspacePath)) {
                throw new Error(
                    `package artifact file contains an absolute workspace path: ${file}`,
                );
            }
        }
    }

    await mkdir(consumerDirectory, { recursive: true });
    await writeFile(
        path.join(consumerDirectory, "package.json"),
        `${JSON.stringify({ private: true, type: "module" }, undefined, 2)}\n`,
    );
    await execFileAsync(
        bunExecutable,
        ["add", "--ignore-scripts", path.join(packDirectory, packedFilename)],
        { cwd: consumerDirectory, encoding: "utf8" },
    );

    const installedRoot = path.join(
        consumerDirectory,
        "node_modules",
        ...packageManifest.name.split("/"),
    );
    const extensionPaths = [path.join(installedRoot, packageManifest.main)];
    if (packageManifest.piExtensionSettings !== undefined) {
        const settingsPath = path.join(
            installedRoot,
            path.dirname(packageManifest.piExtensionSettings.definition),
            "settings.ts",
        );
        const settingsCheckPath = path.join(consumerDirectory, "settings-check.ts");
        await writeFile(
            settingsCheckPath,
            [
                `import definition from ${JSON.stringify(pathToFileURL(settingsPath).href)};`,
                "export default function settingsCheck() {",
                '    if (definition === undefined) throw new Error("settings definition did not load");',
                "}",
                "",
            ].join("\n"),
        );
        extensionPaths.push(settingsCheckPath);
    }

    const loader = new DefaultResourceLoader({
        cwd: consumerDirectory,
        agentDir: path.join(temporaryRoot, "agent"),
        additionalExtensionPaths: extensionPaths,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
    });
    await loader.reload();
    const loaded = loader.getExtensions();
    if (loaded.errors.length > 0 || loaded.extensions.length !== extensionPaths.length) {
        throw new Error(`The installed extension did not load: ${JSON.stringify(loaded.errors)}`);
    }

    console.log("package check passed");
} finally {
    await rm(temporaryRoot, { recursive: true, force: true });
}
