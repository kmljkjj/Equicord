/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Run the real function body without booting Discord or its webpack modules.
function loadFunction(relativePath, name, globals) {
    const file = new URL(`../${relativePath}`, import.meta.url);
    const source = ts.createSourceFile(file.pathname, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let declaration;
    function visit(node) {
        if ((ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name?.getText(source) === name) {
            assert.equal(declaration, undefined, `Ambiguous function: ${name}`);
            declaration = node;
        }
        ts.forEachChild(node, visit);
    }
    visit(source);
    assert.ok(declaration, `Missing function: ${name}`);
    const text = declaration.getText(source);
    const expression = ts.isMethodDeclaration(declaration)
        ? `({${text}}).${name}`
        : `(${text.replace(/^export\s+/, "")})`;
    const { outputText } = ts.transpileModule(`globalThis.subject = ${expression};`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 }
    });
    const context = vm.createContext(globals);
    vm.runInContext(outputText, context, { filename: file.pathname });
    return context.subject;
}

test("UserpluginInstaller stop preserves other settings entries when its section is absent", () => {
    const first = { key: "first" };
    const last = { key: "last" };
    const customEntries = [first, last];
    const stop = loadFunction("src/equicordplugins/userpluginInstaller.dev/index.tsx", "stop", {
        plSettings: { customEntries }
    });

    stop.call({ section: { key: "vencord_userplugins" } });

    assert.deepEqual(customEntries, [first, last]);
});

test("UserpluginInstaller stop removes only its own section and is safe to repeat", () => {
    const first = { key: "first" };
    const section = { key: "vencord_userplugins" };
    const last = { key: "last" };
    const customEntries = [first, section, last];
    const stop = loadFunction("src/equicordplugins/userpluginInstaller.dev/index.tsx", "stop", {
        plSettings: { customEntries }
    });

    stop.call({ section });
    assert.deepEqual(customEntries, [first, last]);
    stop.call({ section });
    assert.deepEqual(customEntries, [first, last]);
});

test("FavoriteAnything sending an attachment preserves queued uploads after it", async () => {
    const file = { name: "favorite.png" };
    const first = { item: { file: { name: "first.png" } } };
    const favorite = { item: { file }, filename: "favorite.png" };
    const last = { item: { file: { name: "last.png" } } };
    const queue = [first, favorite, last];
    let remaining;
    let sent;
    const sendAttachment = loadFunction("src/equicordplugins/favoriteAnything/utils.tsx", "sendAttachment", {
        fetchAttachment: async () => file,
        UploadHandler: { promptToUpload: async () => {} },
        UploadAttachmentStore: { getUploads: () => queue },
        UploadManager: { setUploads: value => { remaining = value; } },
        DraftType: { ChannelMessage: 0 },
        PendingReplyStore: { getPendingReply: () => null },
        MessageActions: { getSendMessageOptionsForReply: () => ({}) },
        FluxDispatcher: { dispatch() {} },
        sendMessage: (...args) => { sent = args; }
    });

    await sendAttachment({ filename: "favorite.png" }, { id: "channel" });

    assert.deepEqual(Array.from(remaining.uploads), [first, last]);
    assert.equal(remaining.channelId, "channel");
    assert.deepEqual(Array.from(sent[3].attachmentsToUpload), [favorite]);
    assert.deepEqual(queue, [first, favorite, last]);
});
