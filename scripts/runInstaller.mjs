/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
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
*/

import "./checkNodeVersion.js";

import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { Readable } from "stream";
import { finished } from "stream/promises";
import { fileURLToPath } from "url";

const BASE_URL = "https://github.com/Equicord/Equilotl/releases/latest/download/";

const BASE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE_DIR = join(BASE_DIR, "dist", "Installer");

function byArch(files) {
    return files[process.arch] ?? files.default;
}

function getFilename() {
    switch (process.platform) {
        case "win32":
            return byArch({
                arm64: "EquilotlCli-arm64.exe",
                default: "EquilotlCli.exe"
            });
        case "darwin":
            return byArch({
                x64: "EquilotlCli-x64",
                arm64: "EquilotlCli-arm64",
                default: "EquilotlCli-universal"
            });
        case "linux":
            return byArch({
                arm64: "EquilotlCli-linux-arm64",
                default: "EquilotlCli-linux"
            });
        default:
            throw new Error("Unsupported platform: " + process.platform);
    }
}

async function sha256File(file) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file))
        hash.update(chunk);
    return hash.digest("hex");
}

/**
 * Verifies the downloaded binary against the .sha256 checksum published on
 * the same release, if one exists. This protects against corrupted and
 * incomplete downloads. Note that it cannot protect against a compromised
 * release, because an attacker controlling the release could replace the
 * checksum as well; that would require signatures published by the
 * Equilotl project itself.
 */
async function verifyChecksum(filename, file) {
    let res;
    try {
        res = await fetch(BASE_URL + filename + ".sha256");
    } catch {
        console.warn("Could not fetch the published checksum; skipping checksum verification.");
        return;
    }

    if (!res.ok) {
        console.warn("No checksum published for " + filename + "; skipping checksum verification.");
        return;
    }

    const expectedHash = (await res.text()).trim().split(/\s+/)[0];
    if (!/^[0-9a-f]{64}$/i.test(expectedHash)) {
        console.warn("The published checksum for " + filename + " is malformed; skipping checksum verification.");
        return;
    }

    const actualHash = await sha256File(file);
    if (actualHash.toLowerCase() !== expectedHash.toLowerCase())
        throw new Error("The downloaded installer failed checksum verification. Not executing it.");
}

async function ensureBinary() {
    const filename = getFilename();
    console.log("Downloading " + filename);

    mkdirSync(FILE_DIR, { recursive: true });

    const outputFile = join(FILE_DIR, filename);
    // one etag file per binary, so switching platform or arch never reuses
    // the etag of a different file
    const etagFile = join(FILE_DIR, `etag-${filename}.txt`);
    const etag = existsSync(outputFile) && existsSync(etagFile)
        ? readFileSync(etagFile, "utf-8")
        : null;

    const res = await fetch(BASE_URL + filename, {
        headers: {
            "User-Agent": "Equicord (https://github.com/Equicord/Equicord)",
            "If-None-Match": etag
        }
    });

    if (res.status === 304) {
        console.log("Up to date, not redownloading!");
        return outputFile;
    }
    if (!res.ok)
        throw new Error(`Failed to download installer: ${res.status} ${res.statusText}`);

    // download to a temporary file and only move it into place once it is
    // complete and verified, so an interrupted download can never leave a
    // truncated binary behind that a later run would consider valid
    const tempFile = `${outputFile}.tmp-${process.pid}`;

    try {
        const body = Readable.fromWeb(res.body);
        await finished(body.pipe(createWriteStream(tempFile, {
            mode: 0o755,
            autoClose: true
        })));

        if (statSync(tempFile).size === 0)
            throw new Error("The downloaded installer is empty.");

        await verifyChecksum(filename, tempFile);

        renameSync(tempFile, outputFile);
    } finally {
        rmSync(tempFile, { force: true });
    }

    const responseEtag = res.headers.get("etag");
    if (responseEtag)
        writeFileSync(etagFile, responseEtag);

    console.log("Finished downloading!");

    return outputFile;
}

const installerBin = await ensureBinary();

console.log("Now running Installer...");

const argStart = process.argv.indexOf("--");
const args = argStart === -1 ? [] : process.argv.slice(argStart + 1);

try {
    execFileSync(installerBin, args, {
        stdio: "inherit",
        env: {
            ...process.env,
            EQUICORD_USER_DATA_DIR: BASE_DIR,
            EQUICORD_DIRECTORY: join(BASE_DIR, "dist/desktop"),
            EQUICORD_DEV_INSTALL: "1"
        }
    });
} catch (error) {
    console.error("The installer failed with an error:", error?.message ?? error);
    console.error("Please check the logs above.");
    process.exitCode = 1;
}
