/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 kmljkjj and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChannelToolbarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { HeadingSecondary } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { copyToClipboard } from "@utils/clipboard";
import { Devs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { Margins } from "@utils/margins";
import { useAwaiter, useForceUpdater } from "@utils/react";
import definePlugin, { OptionType } from "@utils/types";
import { RenderModalProps } from "@vencord/discord-types";
import { ExperimentStore, FluxDispatcher, Modal, openModal, TextInput, Timestamp, useEffect, useState } from "@webpack/common";
import type { DispatchWithoutAction, SVGProps } from "react";

const cl = classNameFactory("vc-experiment-logs-");

const settings = definePluginSettings({
    showButton: {
        type: OptionType.BOOLEAN,
        description: "Show the Experiment Logs button in the channel toolbar",
        default: true
    },
    captureConsoleErrors: {
        type: OptionType.BOOLEAN,
        description: "Also capture console errors that mention experiments",
        default: true
    },
    maxEntries: {
        type: OptionType.NUMBER,
        description: "Maximum number of log entries to keep. Older entries are dropped when the limit is reached",
        default: 250
    }
});

type LogCategory = "event" | "override" | "error";

interface LogEntry {
    id: number;
    time: number;
    category: LogCategory;
    type: string;
    summary: string;
    detail?: string;
}

const EXPERIMENT_ACTION_RE = /EXPERIMENT|AB_TEST|TREATMENT|HOLDOUT|BUCKET/i;

const listeners = new Set<DispatchWithoutAction>();
const entries: LogEntry[] = [];
let nextId = 1;

let originalDispatch: ((...args: any[]) => any) | null = null;
let dispatchWrapper: ((...args: any[]) => any) | null = null;
let originalConsoleError: ((...args: unknown[]) => void) | null = null;

function notifyChange() {
    listeners.forEach(listener => listener());
}

function addEntry(category: LogCategory, type: string, summary: string, detail?: string) {
    entries.unshift({ id: nextId++, time: Date.now(), category, type, summary, detail });

    const limit = settings.store.maxEntries;
    if (typeof limit === "number" && limit > 0 && entries.length > limit)
        entries.length = limit;

    notifyChange();
}

function stringifyArg(arg: unknown): string {
    if (typeof arg === "string") return arg;
    if (arg instanceof Error) return `${arg.message} ${arg.stack ?? ""}`;
    try {
        const json = JSON.stringify(arg);
        return json === undefined ? String(arg) : json;
    } catch {
        return String(arg);
    }
}

function describeValue(value: unknown): string {
    if (value === null) return "null";
    if (Array.isArray(value)) return `[${value.length} items]`;
    if (typeof value === "object") {
        try {
            return `{${Object.keys(value as object).length} keys}`;
        } catch {
            return "[object]";
        }
    }
    return String(value).slice(0, 120);
}

function describePayload(payload: Record<string, unknown>): string {
    return Object.entries(payload)
        .filter(([key]) => key !== "type")
        .slice(0, 8)
        .map(([key, value]) => `${key}=${describeValue(value)}`)
        .join(", ");
}

function logFluxAction(payload: Record<string, unknown>) {
    const type = String(payload.type);
    const category: LogCategory = /OVERRIDE/i.test(type) ? "override" : "event";

    let detail: string | undefined;
    try {
        const json = JSON.stringify(payload);
        detail = json.length > 1200
            ? `${json.slice(0, 1200)}... (truncated, ${json.length} chars total)`
            : json;
    } catch {
        detail = undefined; // not serialisable
    }

    addEntry(category, type, describePayload(payload), detail);
}

function wrapDispatch() {
    if (dispatchWrapper) return;

    const dispatcher = FluxDispatcher as any;
    if (typeof dispatcher?.dispatch !== "function") return;

    originalDispatch = dispatcher.dispatch;
    dispatchWrapper = function (this: unknown, ...args: any[]) {
        const payload = args[0] as Record<string, unknown> | undefined;
        try {
            if (payload != null && typeof payload.type === "string" && EXPERIMENT_ACTION_RE.test(payload.type))
                logFluxAction(payload);
        } catch {
            // never break dispatch
        }
        return originalDispatch!.apply(this, args);
    };
    dispatcher.dispatch = dispatchWrapper;
}

function unwrapDispatch() {
    if (!originalDispatch || !dispatchWrapper) return;

    const dispatcher = FluxDispatcher as any;
    // only restore our wrapper if nobody else wrapped on top of it afterwards
    if (typeof dispatcher?.dispatch === "function" && dispatcher.dispatch === dispatchWrapper)
        dispatcher.dispatch = originalDispatch;

    originalDispatch = null;
    dispatchWrapper = null;
}

function capList(list: string[]): string {
    return list.length > 30
        ? `${list.slice(0, 30).join(", ")}... and ${list.length - 30} more`
        : list.join(", ");
}

function buildDiagnostics(): string[] {
    const lines: string[] = [];
    const store = ExperimentStore as any;

    if (!store) return ["ExperimentStore is not loaded yet. Connect to Discord and reopen this log."];

    try {
        lines.push(`Experiments loaded: ${store.hasLoadedExperiments}`);

        const state = store.getSerializedState?.();
        if (state) {
            if (state.assignmentFingerprint) lines.push(`Assignment fingerprint: ${state.assignmentFingerprint}`);
            if (state.assignmentSource) lines.push(`Assignment source: ${state.assignmentSource}`);
        }

        const userExperiments: Record<string, any> = store.getAllUserExperimentDescriptors?.() ?? {};
        const userNames = Object.keys(userExperiments);
        lines.push(`User experiments known: ${userNames.length}`);

        const overridden = userNames.filter(name => userExperiments[name]?.override);
        if (overridden.length)
            lines.push(`User experiments you override: ${overridden.map(name => `${name} -> bucket ${userExperiments[name]?.bucket}`).join(", ")}`);

        const holdouts = userNames
            .filter(name => userExperiments[name]?.holdoutName != null)
            .map(name => `${name} -> ${userExperiments[name].holdoutName}`);
        if (holdouts.length)
            lines.push(`Holdouts gating your buckets: ${capList(holdouts)}`);

        const guildExperiments: Record<string, any> = store.getGuildExperiments?.() ?? {};
        const guildNames = Object.keys(guildExperiments);
        const employeeOnly: string[] = [];
        const whitelisted: string[] = [];
        const guildOverrides: string[] = [];

        for (const name of guildNames) {
            const assignment = guildExperiments[name];
            if (!assignment) continue;

            if (Object.keys(assignment.overrides ?? {}).length > 0)
                guildOverrides.push(name);

            const populationsJson = JSON.stringify(assignment.populations ?? []);
            if (populationsJson.includes("INTERNAL_EMPLOYEE_ONLY"))
                employeeOnly.push(name);

            const whitelistMatch = populationsJson.match(/"guild_id":\{"\$in":(\[[^\]]*\])/);
            if (whitelistMatch) {
                try {
                    const guildIds = JSON.parse(whitelistMatch[1]);
                    if (Array.isArray(guildIds) && guildIds.length > 0)
                        whitelisted.push(name);
                } catch {
                    // malformed filter, ignore
                }
            }
        }

        lines.push(`Guild experiments known: ${guildNames.length}`);
        if (employeeOnly.length)
            lines.push(`Discord-employee-only guild experiments (cannot be enabled by you): ${capList(employeeOnly)}`);
        if (whitelisted.length)
            lines.push(`Guild experiments whitelisted to specific servers (you are likely not in them): ${capList(whitelisted)}`);
        if (guildOverrides.length)
            lines.push(`Guild experiments with dev overrides: ${capList(guildOverrides)}`);
    } catch (error) {
        lines.push(`Failed to read ExperimentStore: ${String(error)}`);
    }

    return lines;
}

function exportLogs(): string {
    return [
        "=== Equicord Experiment Logs ===",
        "",
        "--- Diagnostics ---",
        ...buildDiagnostics(),
        "",
        `--- Entries (newest first, ${entries.length} total) ---`,
        ...entries.map(entry =>
            `[${new Date(entry.time).toISOString()}] [${entry.category}] ${entry.type}: ${entry.summary}`
            + (entry.detail ? `\n    ${entry.detail}` : "")
        )
    ].join("\n");
}

function LogsIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 24 24" width={18} height={18} {...props}>
            <path fill="currentColor" d="M9 3h6a1 1 0 0 1 1 1v1h1.5A2.5 2.5 0 0 1 20 7.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5v-11A2.5 2.5 0 0 1 6.5 5H8V4a1 1 0 0 1 1-1Zm-2.5 4a.5.5 0 0 0-.5.5v11c0 .28.22.5.5.5h11a.5.5 0 0 0 .5-.5v-11a.5.5 0 0 0-.5-.5H6.5Zm2.25 2.5h6.5a.75.75 0 0 1 0 1.5h-6.5a.75.75 0 0 1 0-1.5Zm0 3.5h6.5a.75.75 0 0 1 0 1.5h-6.5a.75.75 0 0 1 0-1.5Zm0 3.5h4a.75.75 0 0 1 0 1.5h-4a.75.75 0 0 1 0-1.5Z" />
        </svg>
    );
}

function LogRow({ entry }: { entry: LogEntry; }) {
    const [showDetail, setShowDetail] = useState(false);

    const color = entry.category === "error"
        ? "var(--status-danger)"
        : entry.category === "override"
            ? "var(--text-brand)"
            : undefined;

    return (
        <div style={{ borderBottom: "1px solid var(--border-faint)", padding: "6px 0" }}>
            <div
                style={{ display: "flex", gap: "8px", alignItems: "baseline", cursor: entry.detail ? "pointer" : undefined }}
                onClick={() => setShowDetail(value => !value)}
            >
                <Timestamp timestamp={new Date(entry.time)} />
                <span style={{ color, fontWeight: 700, flexShrink: 0 }}>{entry.category.toUpperCase()}</span>
                <span style={{ color, flexShrink: 0 }}>{entry.type}</span>
                <span>{entry.summary}</span>
            </div>
            {showDetail && entry.detail && (
                <pre style={{ margin: "8px 0 0", whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: "12px" }}>
                    {entry.detail}
                </pre>
            )}
        </div>
    );
}

function LogsModal(props: RenderModalProps) {
    const forceUpdate = useForceUpdater();

    useEffect(() => {
        listeners.add(forceUpdate);
        return () => void listeners.delete(forceUpdate);
    }, []);

    const [filter, setFilter] = useState("");
    const [diagnostics, , diagnosticsPending] = useAwaiter(async () => buildDiagnostics(), { fallbackValue: [] as string[] });

    const lowerFilter = filter.toLowerCase();
    const visible = filter
        ? entries.filter(entry =>
            entry.type.toLowerCase().includes(lowerFilter)
            || entry.summary.toLowerCase().includes(lowerFilter))
        : entries;

    return (
        <Modal
            {...props}
            size="xl"
            title="Experiment Logs"
            subtitle="Live log of Discord experiment activity. Click an entry to reveal its raw payload."
            actions={[
                {
                    text: "Copy All",
                    variant: "secondary",
                    onClick: () => void copyToClipboard(exportLogs())
                },
                {
                    text: "Clear",
                    variant: "critical-primary",
                    disabled: entries.length === 0,
                    onClick() {
                        entries.length = 0;
                        notifyChange();
                    }
                }
            ]}
        >
            <TextInput
                placeholder="Filter by experiment name or action type..."
                value={filter}
                onChange={setFilter}
                className={Margins.bottom8}
            />

            <HeadingSecondary>Diagnostics</HeadingSecondary>
            {diagnosticsPending && <Paragraph size="sm">Loading experiment store...</Paragraph>}
            {diagnostics.map((line, i) => (
                <Paragraph key={i} size="sm" className={cl("diagnostic-line")}>{line}</Paragraph>
            ))}

            <Paragraph size="sm" className={Margins.top8}>
                A forced experiment may not show up if: the feature code is not in this build (the "An error occurred" screen),
                it is an Apex experiment assigned server-side, the guild experiment is restricted to other servers or Discord
                employees only, a holdout disables it, or the client was not fully restarted.
            </Paragraph>

            <div className={Margins.top16}>
                <HeadingSecondary>Event Log ({entries.length})</HeadingSecondary>
                {visible.length === 0 && (
                    <Paragraph size="sm">
                        No experiment activity recorded yet. Open the Experiments page or force an experiment to see events appear here.
                    </Paragraph>
                )}
                {visible.map(entry => <LogRow key={entry.id} entry={entry} />)}
            </div>
        </Modal>
    );
}

function LogsToolbarButton() {
    return (
        <ChannelToolbarButton
            className="vc-experiment-logs-btn"
            icon={LogsIcon}
            tooltip="Experiment Logs"
            onClick={() => openModal(modalProps => <LogsModal {...modalProps} />)}
        />
    );
}

export default definePlugin({
    name: "ExperimentsLogger",
    description: "Adds a channel toolbar button (next to the Help/DevTools button) that opens a detailed live log of Discord experiment activity: overrides, assignments, guild restrictions, holdouts and related errors",
    tags: ["Developers", "Utility"],
    authors: [Devs.kmljkjj],
    dependencies: ["HeaderBarAPI"],
    settings,

    headerBarButton: {
        location: "channeltoolbar",
        icon: LogsIcon,
        render: () => settings.store.showButton ? <LogsToolbarButton /> : null,
        priority: 1338
    },

    start() {
        let attempts = 0;
        const hookDispatcher = () => {
            if (FluxDispatcher) {
                wrapDispatch();
            } else if (++attempts < 30) {
                setTimeout(hookDispatcher, 1000);
            } else {
                addEntry("error", "PLUGIN_START", "FluxDispatcher was not found; flux event logging is disabled");
            }
        };
        hookDispatcher();

        originalConsoleError = console.error;
        console.error = (...args: unknown[]) => {
            try {
                if (settings.store.captureConsoleErrors) {
                    const text = args.map(stringifyArg).join(" ");
                    if (EXPERIMENT_ACTION_RE.test(text))
                        addEntry("error", "console.error", text.slice(0, 300), text.slice(0, 1200));
                }
            } catch {
                // never break console.error
            }
            originalConsoleError!(...args);
        };

        addEntry("event", "PLUGIN_START", "Experiment Logs is now recording experiment activity. Open the Experiments page or force an experiment to see events.");
    },

    stop() {
        unwrapDispatch();

        if (originalConsoleError) {
            console.error = originalConsoleError;
            originalConsoleError = null;
        }
    }
});
