/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = new URL("../", import.meta.url);

function source(path) {
    return ts.createSourceFile(path, readFileSync(new URL(path, root), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function javascript(text) {
    return ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
}

function loadPlugin() {
    const patches = [];
    const settings = { store: { toolbarDevMenu: false, enableExperimentEmbeds: true } };
    const context = vm.createContext({
        exports: {}, patches, definePlugin: plugin => plugin,
        definePluginSettings: () => settings,
        findByPropsLazy: () => ({}), IS_MAC: false,
        OptionType: { BOOLEAN: 0 }, Devs: {},
        ApplicationCommandInputType: { BUILT_IN: 0 },
        ErrorBoundary: { wrap: component => component },
        Vencord: { Plugins: { plugins: {} } }
    });
    const file = source("src/plugins/experiments/index.tsx");
    const printer = ts.createPrinter();
    const body = file.statements.filter(statement => !ts.isImportDeclaration(statement))
        .map(statement => printer.printNode(ts.EmitHint.Unspecified, statement, file)).join("\n");
    vm.runInContext(javascript(body) + "\nthis.status = getPatchStatus;", context);
    const plugin = context.exports.default;
    plugin.started = true;
    context.Vencord.Plugins.plugins.Experiments = plugin;
    return { context, plugin, patches, settings, status: context.status };
}

// Exercise the actual patchFactory implementation, not a simulated queue removal.
function loadPatcher(context) {
    const file = source("src/webpack/patchWebpack.ts");
    const factory = file.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === "patchFactory");
    Object.assign(context, {
        getBuildNumber: () => -1,
        traceFunctionWithResults: (_name, fn) => (...args) => [fn(...args), 0],
        logger: { warn() {}, error() {}, debug() {} },
        IS_REPORTER: false, IS_DEV: false, IS_COMPANION_TEST: false,
        SYM_ORIGINAL_FACTORY: Symbol("original")
    });
    vm.runInContext(javascript(factory.getText(file)), context);
    return context.patchFactory;
}

test("numeric treatment links cannot be intercepted by a matching label", () => {
    const { context, plugin } = loadPlugin();
    const file = source("src/utils/patches.ts");
    const canonicalizer = file.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === "canonicalizeMatch");
    vm.runInContext(javascript(canonicalizer.getText(file)), context);
    const patch = plugin.patches.find(patch => patch.find === ".EXPERIMENT_TREATMENT&&null");
    const [replacement] = patch.replacement;
    const original = '(function(e){let t=e.value;return e.treatments.find(n=>n.value===t)})';
    const patched = original.replace(context.exports.canonicalizeMatch(replacement.match), replacement.replace.replaceAll("$self", "Vencord.Plugins.plugins.Experiments"));
    assert.notEqual(patched, original, "exercise the actual label-link replacement");
    const select = vm.runInContext(patched, context);
    const numericLabel = { value: 1, label: "1" };
    const defaultTreatment = { value: -1, label: "None" };
    assert.equal(select({ url: "dev://experiment/example/-1", value: -1, treatments: [numericLabel, defaultTreatment] }), defaultTreatment);
    const enabled = { value: 2, label: "Enabled treatment" };
    assert.equal(select({ url: "dev://experiment/example/Enabled-treatment", value: NaN, treatments: [enabled] }), enabled);
});

for (const [name, replacement] of [
    ["has no effect", { match: /missingReplacement/, replace: "true" }],
    ["produces invalid JavaScript", { match: /return/, replace: "return (" }],
    ["throws", { match: /return/, replace() { throw new Error("replacement failed"); } }]
]) {
    test(`patch health does not report applied after a replacement ${name}`, () => {
        const { context, plugin, patches, status } = loadPlugin();
        const patch = plugin.patches[0];
        patch.replacement = [replacement];
        patches.push(patch);
        assert.equal(status(patch).label, "waiting for its module");
        loadPatcher(context)("fixture", function () { return "Object.defineProperties(this,{isDeveloper"; });
        assert.equal(patches.includes(patch), false, "the real patcher consumes failed patches");
        assert.notEqual(status(patch).label, "applied", "queue removal is not evidence of success");
        assert.notEqual(status(patch).icon, "✅");
    });
}

test("patch health respects plugin lifecycle and disabled settings", () => {
    const { plugin, patches, settings, status } = loadPlugin();
    const patch = plugin.patches[0];
    patches.push(patch);
    plugin.started = false;
    assert.equal(status(patch).label, "plugin not started");
    plugin.started = true;
    assert.equal(status(patch).label, "waiting for its module");
    const toolbarPatch = plugin.patches.find(patch => patch.find === '?"BACK_FORWARD_NAVIGATION":');
    assert.equal(status(toolbarPatch).label, "disabled by a setting");
    settings.store.toolbarDevMenu = true;
    assert.notEqual(status(toolbarPatch).label, "applied", "changing a restart-required setting cannot prove a skipped patch was applied");
});

test("label matching preserves named links and safely rejects invalid inputs", () => {
    const { plugin } = loadPlugin();
    assert.equal(plugin.matchExperiment("dev://experiment/example/Enabled-treatment", "Enabled Treatment!"), true);
    for (const [url, label] of [
        [undefined, "Enabled"], [42, "Enabled"], ["dev://experiment/example/enabled", null],
        ["dev://experiment/example/---", "!!!"], ["dev://experiment/example/", ""],
        ["dev://experiment/example/-1", "1"], ["dev://experiment/example/1", "1"],
        ["dev://experiment/example/0", "0"], ["dev://experiment/example/Enabled", "Disabled"]
    ]) {
        assert.equal(plugin.matchExperiment(url, label), false, `unexpected label match: ${url}, ${label}`);
    }
});
