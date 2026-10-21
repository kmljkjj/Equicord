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

function loadVariable() {
    const file = new URL("../src/equicordplugins/userpluginInstaller.dev/VariableWithCallbacks.ts", import.meta.url);
    const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    });
    const context = vm.createContext({ exports: {}, Date: { now: () => 123 } });
    vm.runInContext(outputText, context);
    return context.exports.VariableWithCallbacks;
}

test("callbacks registered within one millisecond have distinct removable IDs", () => {
    const Variable = loadVariable();
    const value = new Variable(0);
    const calls = [];
    const first = value.registerCallback(() => calls.push("first"));
    const second = value.registerCallback(() => calls.push("second"));
    assert.notEqual(first, second);
    value.deregisterCallback(second);
    value.value(1);
    assert.deepEqual(calls, ["first"]);
});

test("a self-removing callback does not skip the next subscriber", () => {
    const Variable = loadVariable();
    const value = new Variable(0);
    const calls = [];
    value.registerCallback((_value, id) => {
        calls.push("once");
        value.deregisterCallback(id);
    });
    value.registerCallback(() => calls.push("persistent"));
    value.value(1);
    assert.deepEqual(calls, ["once", "persistent"]);
    value.value(2);
    assert.deepEqual(calls, ["once", "persistent", "persistent"]);
});
