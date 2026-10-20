#!/usr/bin/node
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 kmljkjj and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
*/

// @ts-check

/**
 * Validates the built asar archives (dist/desktop.asar, dist/equibop.asar):
 * - required entry points exist inside the archive and are non-empty;
 * - the embedded package.json is valid JSON whose "main" points to an
 *   existing archive entry;
 * - every archived file can be extracted;
 * - when the source directory is still present, the archive matches the
 *   files on disk byte for byte (sha256), so a stale archive can never
 *   be released by accident.
 *
 * Exits with code 1 if any target fails validation, or if no target
 * could be validated at all (e.g. the script is run before building).
 */

import { extractFile, listPackage } from "@electron/asar";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * @type {{ name: string; asar: string; dir: string; main: string; required: string[] }[]}
 */
const TARGETS = [
    {
        name: "desktop",
        asar: "dist/desktop.asar",
        dir: "dist/desktop",
        main: "patcher.js",
        required: ["patcher.js", "renderer.js", "preload.js", "package.json"]
    },
    {
        name: "equibop",
        asar: "dist/equibop.asar",
        dir: "dist/equibop",
        main: "main.js",
        required: ["main.js", "renderer.js", "preload.js", "package.json"]
    }
];

const sha256 = /** @type {(buf: Buffer) => string} */ (buf => createHash("sha256").update(buf).digest("hex"));

/**
 * @param {string} entry asar entry path, possibly prefixed with "./" or "/"
 * @returns {string} normalized entry path
 */
function normalizeEntry(entry) {
    return entry.replace(/^\.\//, "").replace(/^\/+/, "");
}

/**
 * @param {string} targetName
 * @param {string} message
 * @returns {void}
 */
function fail(targetName, message) {
    console.error(`[${targetName}] ${message}`);
    process.exitCode = 1;
}

/**
 * @param {typeof TARGETS[number]} target
 * @returns {Promise<void>}
 */
async function validateTarget(target) {
    if (!existsSync(target.asar)) {
        console.log(`[${target.name}] ${target.asar} not found, skipping`);
        return;
    }

    console.log(`[${target.name}] validating ${target.asar}`);

    const entries = listPackage(target.asar, { isPack: false })
        .map(normalizeEntry);
    const entrySet = new Set(entries);

    for (const required of target.required) {
        if (!entrySet.has(required)) {
            fail(target.name, `required file "${required}" is missing from the archive`);
            return;
        }
        if (extractFile(target.asar, required).length === 0) {
            fail(target.name, `required file "${required}" is empty`);
            return;
        }
    }

    let pkg;
    try {
        pkg = JSON.parse(extractFile(target.asar, "package.json").toString("utf8"));
    } catch (error) {
        fail(target.name, `package.json is not valid JSON: ${String(error)}`);
        return;
    }

    if (typeof pkg?.main !== "string" || pkg.main !== target.main) {
        fail(target.name, `package.json "main" must be "${target.main}", got ${JSON.stringify(pkg?.main)}`);
        return;
    }
    if (!entrySet.has(target.main)) {
        fail(target.name, `package.json "main" ("${target.main}") does not match any archive entry`);
        return;
    }

    for (const entry of entries) {
        if (entry.endsWith("/")) continue;
        try {
            if (extractFile(target.asar, entry).length === 0) {
                fail(target.name, `archived file "${entry}" is empty`);
                return;
            }
        } catch (error) {
            fail(target.name, `failed to extract "${entry}": ${String(error)}`);
            return;
        }
    }

    if (existsSync(target.dir)) {
        const missing = entries.filter(entry => !existsSync(join(target.dir, entry)));
        if (missing.length !== 0) {
            fail(target.name, `archive contains files absent from ${target.dir}: ${missing.join(", ")}`);
            return;
        }

        for (const entry of entries) {
            if (entry.endsWith("/")) continue;
            const archivedHash = sha256(extractFile(target.asar, entry));
            const diskHash = sha256(readFileSync(join(target.dir, entry)));
            if (archivedHash !== diskHash) {
                fail(target.name, `"${entry}" differs between ${target.asar} and ${target.dir}`);
                return;
            }
        }
    }

    console.log(`[${target.name}] OK (${entries.length} entries checked)`);
}

/**
 * @returns {Promise<void>}
 */
async function main() {
    for (const target of TARGETS) {
        await validateTarget(target);
    }

    const anyArchive = TARGETS.some(target => existsSync(target.asar));
    if (!anyArchive) {
        console.error("No asar archive found; run `pnpm buildStandalone` first");
        process.exitCode = 1;
        return;
    }

    if (process.exitCode) {
        console.error("Archive validation failed");
    } else {
        console.log("All archives validated successfully");
    }
}

await main();
