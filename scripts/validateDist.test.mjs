/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 kmljkjj and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createPackage } from "@electron/asar";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const validator = fileURLToPath(new URL("./validateDist.mjs", import.meta.url));

async function withArchive(run) {
    const root = await mkdtemp(join(process.env.TMPDIR || tmpdir(), "equicord-dist-test-"));
    const source = join(root, "dist/desktop");
    await mkdir(source, { recursive: true });
    try {
        for (const [name, content] of Object.entries({
            "package.json": JSON.stringify({ main: "patcher.js" }),
            "patcher.js": "// patcher",
            "renderer.js": "// renderer",
            "preload.js": "// preload"
        })) {
            await writeFile(join(source, name), content);
        }
        await run({
            source,
            pack: () => createPackage(source, join(root, "dist/desktop.asar")),
            validate: () => spawnSync(process.execPath, [validator], { cwd: root, encoding: "utf8" })
        });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

test("accepts valid nested archive directories", () => withArchive(async ({ source, pack, validate }) => {
    const nested = join(source, "assets/nested/icon.txt");
    await mkdir(dirname(nested), { recursive: true });
    await writeFile(nested, "icon");
    await pack();
    const result = validate();
    assert.equal(result.status, 0, result.stdout + result.stderr);
}));

test("rejects source files missing from the archive", () => withArchive(async ({ source, pack, validate }) => {
    await pack();
    await writeFile(join(source, "forgotten.js"), "// omitted from archive");
    const result = validate();
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /forgotten\.js/);
}));

test("rejects archive files whose source content has changed", () => withArchive(async ({ source, pack, validate }) => {
    await pack();
    await writeFile(join(source, "renderer.js"), "// changed after packaging");
    const result = validate();
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /renderer\.js.*differs/);
}));
