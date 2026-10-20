/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 kmljkjj and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChannelToolbarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { HeadingSecondary } from "@components/Heading";
import { ChevronSmallDownIcon, ChevronSmallUpIcon, CopyIcon, OpenExternalIcon } from "@components/Icons";
import { Paragraph } from "@components/Paragraph";
import { copyToClipboard } from "@utils/clipboard";
import { Devs } from "@utils/constants";
import { Margins } from "@utils/margins";
import { useAwaiter, useForceUpdater } from "@utils/react";
import definePlugin, { OptionType } from "@utils/types";
import { RenderModalProps } from "@vencord/discord-types";
import { ExperimentStore, FluxDispatcher, Modal, openModal, SettingsRouter, TextInput, Timestamp, useEffect, useState } from "@webpack/common";
import type { DispatchWithoutAction, ReactNode, SVGProps } from "react";

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

type DiagTone = "info" | "ok" | "warn" | "danger";

interface DiagnosticItem {
    label: string;
    value: string;
    tone: DiagTone;
}

const CATEGORY_META: Record<LogCategory, { emoji: string; color: string; label: string; }> = {
    event: { emoji: "⚡", color: "var(--text-link)", label: "Events" },
    override: { emoji: "🔧", color: "var(--text-brand)", label: "Overrides" },
    error: { emoji: "⚠️", color: "var(--status-danger)", label: "Errors" }
};

const TONE_COLORS: Record<DiagTone, string> = {
    info: "var(--text-link)",
    ok: "var(--text-positive)",
    warn: "var(--text-warning)",
    danger: "var(--status-danger)"
};

const GUIDE_REASONS = [
    "🚫 The feature's code is not in this client build — the \"An error occurred\" screen is the crash boundary of the missing component. Set the bucket back to None.",
    "🛰️ Apex experiments are assigned server-side and cannot be forced from the client.",
    "🏰 Guild experiments can be locked to specific server IDs or Discord employees only (INTERNAL_EMPLOYEE_ONLY); your user override does not change the server's eligibility.",
    "🧷 A holdout experiment can disable the one you forced, and a DEPENDENT_EXPERIMENT needs another one active too.",
    "🔄 Assignments are evaluated at boot — fully restart the client (including the tray icon) after forcing a bucket.",
    "🌐 On the web version, many desktop-only experiments have no effect."
];

const GUIDE_WORKFLOW = [
    "1️⃣ Search the experiment name on wumpus.tools or the rollout tracker below.",
    "2️⃣ Force the bucket, then fully restart the client.",
    "3️⃣ \"An error occurred\" screen → the feature code is missing from this build; set the bucket back to None.",
    "4️⃣ Nothing shows without an error → check the Diagnostics above for a holdout, or verify it is not an Apex / 0% rollout experiment."
];

const GUIDE_LINKS = [
    { name: "wumpus.tools", description: "Search any experiment by name and see its buckets (user / guild / developer lists)", url: "https://wumpus.tools" },
    { name: "rollouts.advaith.io", description: "Live server-side experiment rollout tracker", url: "https://rollouts.advaith.io" },
    { name: "docs.discord.food", description: "Technical documentation of how Discord experiments work", url: "https://docs.discord.food/topics/experiments" },
    { name: "discordpreviews.com", description: "Upcoming Discord features with screenshots", url: "https://discordpreviews.com" },
    { name: "Wumpus-Central", description: "Canary datamining and the guild experiment tracker", url: "https://github.com/Wumpus-Central" }
];

const EXPERIMENT_ACTION_RE = /EXPERIMENT|AB_TEST|TREATMENT|HOLDOUT|BUCKET/i;

const listeners = new Set<DispatchWithoutAction>();
const entries: LogEntry[] = [];
let nextId = 1;

let originalDispatch: ((...args: any[]) => any) | null = null;
let dispatchWrapper: ((...args: any[]) => any) | null = null;
let originalConsoleError: ((...args: unknown[]) => void) | null = null;

function openLink(url: string) {
    try {
        const native = (VencordNative as any)?.native;
        if (typeof native?.openExternal === "function") {
            native.openExternal(url);
            return;
        }
    } catch {
        // fall through to window.open
    }
    window.open(url, "_blank");
}

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

function buildDiagnostics(): DiagnosticItem[] {
    const items: DiagnosticItem[] = [];
    const store = ExperimentStore as any;

    if (!store)
        return [{ label: "ExperimentStore", value: "not loaded yet — connect to Discord and reopen this log", tone: "warn" }];

    try {
        items.push({
            label: "Experiments loaded",
            value: store.hasLoadedExperiments ? "yes" : "no (still loading)",
            tone: store.hasLoadedExperiments ? "ok" : "warn"
        });

        const state = store.getSerializedState?.();
        if (state) {
            if (state.assignmentFingerprint)
                items.push({ label: "Assignment fingerprint", value: String(state.assignmentFingerprint), tone: "info" });
            if (state.assignmentSource)
                items.push({ label: "Assignment source", value: String(state.assignmentSource), tone: "info" });
        }

        const userExperiments: Record<string, any> = store.getAllUserExperimentDescriptors?.() ?? {};
        const userNames = Object.keys(userExperiments);
        items.push({ label: "User experiments known", value: String(userNames.length), tone: "info" });

        const overridden = userNames.filter(name => userExperiments[name]?.override);
        if (overridden.length)
            items.push({
                label: "Your user overrides",
                value: overridden.map(name => `${name} → bucket ${userExperiments[name]?.bucket}`).join(", "),
                tone: "ok"
            });

        const holdouts = userNames
            .filter(name => userExperiments[name]?.holdoutName != null)
            .map(name => `${name} → ${userExperiments[name].holdoutName}`);
        if (holdouts.length)
            items.push({ label: "Holdouts gating your buckets", value: capList(holdouts), tone: "warn" });

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

        items.push({ label: "Guild experiments known", value: String(guildNames.length), tone: "info" });
        if (employeeOnly.length)
            items.push({ label: "Discord-employee-only guild experiments (cannot be enabled by you)", value: capList(employeeOnly), tone: "warn" });
        if (whitelisted.length)
            items.push({ label: "Guild experiments whitelisted to specific servers (you are likely not in them)", value: capList(whitelisted), tone: "warn" });
        if (guildOverrides.length)
            items.push({ label: "Guild experiments with dev overrides", value: capList(guildOverrides), tone: "info" });
    } catch (error) {
        items.push({ label: "Failed to read ExperimentStore", value: String(error), tone: "danger" });
    }

    return items;
}

function formatEntry(entry: LogEntry): string {
    return `[${new Date(entry.time).toISOString()}] [${entry.category}] ${entry.type}: ${entry.summary}`
        + (entry.detail ? `\n    ${entry.detail}` : "");
}

function exportLogs(): string {
    return [
        "=== Equicord Experiment Logs ===",
        "",
        "--- Diagnostics ---",
        ...buildDiagnostics().map(item => `${item.label}: ${item.value}`),
        "",
        `--- Entries (newest first, ${entries.length} total) ---`,
        ...entries.map(formatEntry)
    ].join("\n");
}

function FlaskIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 24 24" width={18} height={18} {...props}>
            <path fill="currentColor" d="M9.5 2.5h5a.75.75 0 0 1 .75.75V8l5.2 9.5A1.75 1.75 0 0 1 18.9 20H5.1a1.75 1.75 0 0 1-1.55-2.5L8.75 8V3.25a.75.75 0 0 1 .75-.75Z" />
        </svg>
    );
}

function LogRow({ entry }: { entry: LogEntry; }) {
    const [showDetail, setShowDetail] = useState(false);
    const meta = CATEGORY_META[entry.category];

    return (
        <div style={{ borderBottom: "1px solid var(--border-faint)", padding: "6px 0" }}>
            <div
                style={{ display: "flex", gap: "8px", alignItems: "center", cursor: entry.detail ? "pointer" : undefined }}
                onClick={() => setShowDetail(value => !value)}
            >
                <span title={meta.label} style={{ fontSize: 14, flexShrink: 0 }}>{meta.emoji}</span>
                <span title={meta.label} style={{ width: 7, height: 7, borderRadius: "50%", background: meta.color, flexShrink: 0 }} />
                <Timestamp timestamp={new Date(entry.time)} />
                <span
                    title={entry.type}
                    style={{
                        flexShrink: 0,
                        maxWidth: 260,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontFamily: "var(--font-code)",
                        fontSize: 11,
                        fontWeight: 600,
                        color: meta.color,
                        border: "1px solid var(--border-faint)",
                        borderRadius: "4px",
                        padding: "1px 6px"
                    }}
                >
                    {entry.type}
                </span>
                <span
                    title={entry.summary}
                    style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 }}
                >
                    {entry.summary}
                </span>
                <button
                    type="button"
                    aria-label="Copy this entry"
                    title="Copy this entry"
                    onClick={e => {
                        e.stopPropagation();
                        void copyToClipboard(formatEntry(entry));
                    }}
                    style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--text-muted)", display: "inline-flex", alignItems: "center", flexShrink: 0 }}
                >
                    <CopyIcon width={14} height={14} />
                </button>
                {entry.detail && (
                    showDetail
                        ? <ChevronSmallUpIcon width={16} height={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                        : <ChevronSmallDownIcon width={16} height={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                )}
            </div>
            {showDetail && entry.detail && (
                <pre style={{ margin: "8px 0 0", whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: 12, fontFamily: "var(--font-code)", padding: "8px", border: "1px solid var(--border-faint)", borderRadius: "6px" }}>
                    {entry.detail}
                </pre>
            )}
        </div>
    );
}

function DiagnosticRow({ item }: { item: DiagnosticItem; }) {
    return (
        <div style={{ display: "flex", gap: "8px", alignItems: "center", padding: "2px 0" }}>
            <span title={item.tone} style={{ width: 7, height: 7, borderRadius: "50%", background: TONE_COLORS[item.tone], flexShrink: 0 }} />
            <span style={{ color: "var(--text-muted)", flexShrink: 0, fontSize: 13 }}>{item.label}:</span>
            <span style={{ fontSize: 13, wordBreak: "break-word" }}>{item.value}</span>
        </div>
    );
}

function FilterChip({ active, color, onClick, children }: { active: boolean; color: string; onClick: () => void; children: ReactNode; }) {
    return (
        <button
            type="button"
            onClick={onClick}
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "4px 10px",
                borderRadius: "999px",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: active ? 700 : 500,
                color: active ? color : "var(--text-muted)",
                border: `1px solid ${active ? color : "var(--border-faint)"}`,
                background: "transparent"
            }}
        >
            {children}
        </button>
    );
}

function CollapsibleSection({ title, children }: { title: string; children: ReactNode; }) {
    const [open, setOpen] = useState(false);

    return (
        <div className={Margins.top16}>
            <div
                style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", userSelect: "none" }}
                onClick={() => setOpen(value => !value)}
            >
                {open
                    ? <ChevronSmallUpIcon width={16} height={16} />
                    : <ChevronSmallDownIcon width={16} height={16} />}
                <HeadingSecondary>{title}</HeadingSecondary>
            </div>
            {open && <div className={Margins.top8}>{children}</div>}
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
    const [category, setCategory] = useState<"all" | LogCategory>("all");
    const [diagnostics, , diagnosticsPending] = useAwaiter(async () => buildDiagnostics(), { fallbackValue: [] as DiagnosticItem[] });

    const counts: Record<LogCategory, number> = { event: 0, override: 0, error: 0 };
    for (const entry of entries) counts[entry.category]++;

    const lowerFilter = filter.toLowerCase();
    const visible = entries.filter(entry =>
        (category === "all" || entry.category === category)
        && (!filter
            || entry.type.toLowerCase().includes(lowerFilter)
            || entry.summary.toLowerCase().includes(lowerFilter)));

    return (
        <Modal
            {...props}
            size="xl"
            title="🧪 Experiment Logs"
            subtitle="Live log of Discord experiment activity. Click an entry to reveal its raw payload; open the Guide for help."
            actions={[
                {
                    text: "🧭 Open Experiments Page",
                    variant: "secondary",
                    onClick: () => {
                        try {
                            SettingsRouter.openUserSettings("Experiments");
                        } catch {
                            // The Experiments section may not exist yet during boot; open plain settings instead
                            try {
                                SettingsRouter.openUserSettings();
                            } catch {
                                // settings unavailable
                            }
                        }
                    }
                },
                {
                    text: "📋 Copy All",
                    variant: "secondary",
                    onClick: () => void copyToClipboard(exportLogs())
                },
                {
                    text: "🗑️ Clear",
                    variant: "critical-primary",
                    disabled: entries.length === 0,
                    onClick() {
                        entries.length = 0;
                        notifyChange();
                    }
                }
            ]}
        >
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }} className={Margins.bottom8}>
                <div style={{ flex: "1 1 220px", minWidth: 200 }}>
                    <TextInput
                        placeholder="🔎 Filter by experiment name or action type..."
                        value={filter}
                        onChange={setFilter}
                    />
                </div>
                <FilterChip active={category === "all"} color="var(--header-primary)" onClick={() => setCategory("all")}>
                    <span>🗂️</span> All <span style={{ opacity: 0.7 }}>{entries.length}</span>
                </FilterChip>
                {(Object.keys(CATEGORY_META) as LogCategory[]).map(cat => (
                    <FilterChip
                        key={cat}
                        active={category === cat}
                        color={CATEGORY_META[cat].color}
                        onClick={() => setCategory(category === cat ? "all" : cat)}
                    >
                        <span>{CATEGORY_META[cat].emoji}</span> {CATEGORY_META[cat].label} <span style={{ opacity: 0.7 }}>{counts[cat]}</span>
                    </FilterChip>
                ))}
            </div>

            <HeadingSecondary>🩺 Diagnostics</HeadingSecondary>
            {diagnosticsPending && <Paragraph size="sm">Loading experiment store…</Paragraph>}
            {diagnostics.map((item, i) => <DiagnosticRow key={i} item={item} />)}

            <Paragraph size="sm" className={Margins.top8}>
                💡 A forced experiment may not show up if its code is not in this build, it is an Apex experiment assigned
                server-side, a holdout gates it, or the client was not fully restarted — open the Guide below for details.
            </Paragraph>

            <CollapsibleSection title="📚 Guide & Resources">
                <Paragraph size="sm" className={Margins.bottom8}>Why a forced experiment may not show up:</Paragraph>
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "4px" }}>
                    {GUIDE_REASONS.map((reason, i) => (
                        <li key={i} style={{ fontSize: 13 }}>{reason}</li>
                    ))}
                </ul>

                <Paragraph size="sm" className={Margins.top8}>Recommended workflow:</Paragraph>
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "4px" }}>
                    {GUIDE_WORKFLOW.map((step, i) => (
                        <li key={i} style={{ fontSize: 13 }}>{step}</li>
                    ))}
                </ul>

                <div className={Margins.top8}>
                    {GUIDE_LINKS.map(link => (
                        <div key={link.url} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "4px 0" }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 14, fontWeight: 600 }}>{link.name}</div>
                                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{link.description}</div>
                            </div>
                            <button
                                type="button"
                                aria-label={`Open ${link.name}`}
                                title={`Open ${link.name}`}
                                onClick={() => openLink(link.url)}
                                style={{ background: "none", border: "1px solid var(--border-faint)", borderRadius: "6px", padding: "6px", cursor: "pointer", color: "var(--text-muted)", display: "inline-flex", flexShrink: 0 }}
                            >
                                <OpenExternalIcon width={16} height={16} />
                            </button>
                        </div>
                    ))}
                </div>
            </CollapsibleSection>

            <div className={Margins.top16}>
                <HeadingSecondary>🧾 Event Log ({entries.length})</HeadingSecondary>
                {visible.length === 0 && (
                    <Paragraph size="sm">
                        😴 No experiment activity recorded yet. Open the Experiments page or force an experiment to see events appear here.
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
            icon={FlaskIcon}
            tooltip="Experiment Logs"
            onClick={() => openModal(modalProps => <LogsModal {...modalProps} />)}
        />
    );
}

export default definePlugin({
    name: "ExperimentsLogger",
    description: "Adds a channel toolbar button (next to the Help/DevTools button) that opens a detailed live log of Discord experiment activity: overrides, assignments, guild restrictions, holdouts and related errors — with diagnostics, a troubleshooting guide and resource links",
    tags: ["Developers", "Utility"],
    authors: [Devs.kmljkjj],
    dependencies: ["HeaderBarAPI"],
    settings,

    headerBarButton: {
        location: "channeltoolbar",
        icon: FlaskIcon,
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
