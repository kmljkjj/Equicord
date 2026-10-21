/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType } from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import { disableStyle, enableStyle } from "@api/Styles";
import { BaseText } from "@components/BaseText";
import ErrorBoundary from "@components/ErrorBoundary";
import { ErrorCard } from "@components/ErrorCard";
import { HeadingPrimary, HeadingSecondary } from "@components/Heading";
import { OpenExternalIcon } from "@components/Icons";
import { Paragraph } from "@components/Paragraph";
import { Devs, IS_MAC } from "@utils/constants";
import { Margins } from "@utils/margins";
import definePlugin, { OptionType, Patch } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { ExperimentStore, React, SettingsRouter } from "@webpack/common";
import { patches } from "@webpack/patcher";

import pageStyle from "./style.css?managed";

const KbdStyles = findByPropsLazy("key", "combo");
const modKey = IS_MAC ? "cmd" : "ctrl";
const altKey = IS_MAC ? "opt" : "alt";

const RESOURCES: Array<{ name: string; description: string; url: string; emoji: string; }> = [
    { name: "wumpus.tools", description: "Search any experiment by name and see its buckets (user / guild / developer lists)", url: "https://wumpus.tools", emoji: "🧪" },
    { name: "rollouts.advaith.io", description: "Live server-side experiment rollout tracker", url: "https://rollouts.advaith.io", emoji: "📊" },
    { name: "docs.discord.food", description: "Technical documentation of how Discord experiments work", url: "https://docs.discord.food/topics/experiments", emoji: "📚" },
    { name: "discordpreviews.com", description: "Upcoming Discord features with screenshots", url: "https://discordpreviews.com", emoji: "🖼️" }
];

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

const settings = definePluginSettings({
    hideWarningCard: {
        type: OptionType.BOOLEAN,
        description: "Hide the warning card shown above the experiment list",
        default: false
    },
    toolbarDevMenu: {
        type: OptionType.BOOLEAN,
        description: "Change the Help (?) toolbar button (top right in chat) to Discord's developer menu",
        default: false,
        restartNeeded: true
    },
    enableExperimentEmbeds: {
        type: OptionType.BOOLEAN,
        description: "Enable the experiment & playground embeds on sent dev:// links",
        default: true,
        restartNeeded: true
    }
});

// Give access to Discord's hidden developer experiments & co
const developerAccessPatch: Patch = {
    plugin: "Experiments",
    find: "Object.defineProperties(this,{isDeveloper",
    replacement: {
        match: /(?<={isDeveloper:\{[^}]+?,get:\(\)=>)\i/,
        replace: "true"
    }
};

// Make the client initialize the developer experiments on CONNECTION_OPEN
const connectionInitPatch: Patch = {
    plugin: "Experiments",
    find: 'type:"user",revision',
    replacement: {
        match: /!(\i)(?=&&"CONNECTION_OPEN")/,
        replace: "!($1=true)"
    }
};

// Show the warning card and a filter bar above the experiment list on the Experiments page
const experimentsPagePatch: Patch = {
    plugin: "Experiments",
    find: 'placeholder:"Search experiments"',
    replacement: [
        {
            match: /(?<=children:\[)(?=null!=.{0,150}"Installation ID:)/,
            replace: "$self.showWarningCard()?$self.WarningCard():null,$self.FiltersBar(),"
        },
        // for some reason the installation id and copy buttons are on
        // different lines so it looks stupid when the card above is added
        {
            match: /(?<=,marginBottom:16)(?=\},children:\[)/,
            replace: ',flexDirection:"row",alignItems:"center"'
        }
    ]
};

// Change top right toolbar button from the help one to the dev one
const toolbarDevMenuPatch: Patch = {
    plugin: "Experiments",
    find: '?"BACK_FORWARD_NAVIGATION":',
    replacement: {
        match: /hasBugReporterAccess:(\i)/,
        replace: "_hasBugReporterAccess:$1=true"
    },
    predicate: () => settings.store.toolbarDevMenu
};

// Disable opening the bug report menu when clicking the top right toolbar dev button
const toolbarDevMenuClickPatch: Patch = {
    plugin: "Experiments",
    find: 'navId:"staff-help-popout"',
    replacement: {
        match: /(isShown.+?)onClick:\i/,
        replace: (_, rest) => `${rest}onClick:()=>{}`
    },
    predicate: () => settings.store.toolbarDevMenu
};

// Enable experiment embed on sent experiment links
const experimentEmbedPatch: Patch = {
    plugin: "Experiments",
    find: "Clear Treatment ",
    replacement: {
        match: /\i?\.isStaff\(\)/,
        replace: "true"
    },
    predicate: () => settings.store.enableExperimentEmbeds
};

// Fix some tricky experiments name causing a client crash
const experimentEmbedCrashFixPatch: Patch = {
    plugin: "Experiments",
    find: "Clear Treatment ",
    replacement: {
        match: /\.isStaffPersonal\(\).+?if\(null==(\i)\|\|null==\i(?=\)return null;)/,
        replace: "$&||({})[$1]!=null"
    }
};

// Fix another function which causes crashes with tricky experiment names and the experiment embed
const serverAssignmentCrashFixPatch: Patch = {
    plugin: "Experiments",
    find: "}getServerAssignment(",
    replacement: {
        match: /}getServerAssignment\((\i),\i,\i\){/,
        replace: "$&if($1==null)return;"
    }
};

// Enable playground embed on sent playground links
// dev://playground/mana, dev://playground/payments, dev://playground/virtual-currency,
// dev://playground/nitro, dev://playground/mfa, dev://playground/cms, dev://playground/void
const playgroundEmbedPatch: Patch = {
    plugin: "Experiments",
    find: '"Open Playground',
    replacement: {
        match: /isStaff\(\)\|\|/,
        replace: "$& true||"
    },
    predicate: () => settings.store.enableExperimentEmbeds
};

const experimentUrlRegexPatch: Patch = {
    plugin: "Experiments",
    // Expands the experiment regex to allow negative numbers as well as text in the last segment of the URL.
    find: '"^dev://experiment/',
    replacement: {
        match: /\[0-9\]\+(?=\)\)\?\$")/,
        replace: "[a-zA-Z0-9-]+"
    }
};

const experimentLabelMatchPatch: Patch = {
    plugin: "Experiments",
    find: ".EXPERIMENT_TREATMENT&&null",
    replacement: [
        {
            // Allow linking experiments by their label instead of their value.
            match: /(?<=find\(\i=>)((\i).value===\i)/,
            replace: "{return($1)||($self.matchExperiment(arguments[0]?.url,$2?.label))}"
        }
    ]
};

// Every patch above, with a human-readable name for the Patch Health section.
const PATCH_HEALTH: Array<{ name: string; patch: Patch; }> = [
    { name: "Developer access (isDeveloper)", patch: developerAccessPatch },
    { name: "Developer init (CONNECTION_OPEN)", patch: connectionInitPatch },
    { name: "Experiments page (warning card & filters)", patch: experimentsPagePatch },
    { name: "Toolbar dev menu", patch: toolbarDevMenuPatch },
    { name: "Toolbar dev menu click", patch: toolbarDevMenuClickPatch },
    { name: "Experiment embeds", patch: experimentEmbedPatch },
    { name: "Experiment embed crash fix", patch: experimentEmbedCrashFixPatch },
    { name: "Server assignment crash fix", patch: serverAssignmentCrashFixPatch },
    { name: "Playground embeds", patch: playgroundEmbedPatch },
    { name: "Experiment URL regex", patch: experimentUrlRegexPatch },
    { name: "Experiment label links", patch: experimentLabelMatchPatch }
];

interface PatchStatus {
    icon: string;
    label: string;
    color: string;
}

// The patcher also removes patches after failed or ineffective replacements.
// Queue membership can show pending work, but cannot prove successful application.
function getPatchStatus(patch: Patch): PatchStatus {
    try {
        const plugin = Vencord.Plugins.plugins.Experiments;
        if (!plugin?.started) return { icon: "❔", label: "plugin not started", color: "var(--text-muted)" };

        if (patch.predicate && !patch.predicate()) return { icon: "⏸️", label: "disabled by a setting", color: "var(--text-muted)" };
        if (patches.includes(patch)) return { icon: "⏳", label: "waiting for its module", color: "var(--text-warning)" };

        return { icon: "❔", label: "not queued (result unverified)", color: "var(--text-muted)" };
    } catch {
        return { icon: "❔", label: "unknown", color: "var(--text-muted)" };
    }
}

function getBuildChannel(): string {
    try {
        if (IS_WEB) {
            const host = location.hostname.toLowerCase();
            if (host.startsWith("canary.")) return "canary";
            if (host.startsWith("ptb.")) return "ptb";
            return "stable";
        }
        const channel = (globalThis as any).DiscordNative?.app?.getReleaseChannel?.();
        if (typeof channel === "string" && channel.length > 0) return channel;
    } catch {
        // release channel unavailable; keep the fallback
    }
    return "unknown";
}

type ExperimentTypeFilter = "all" | "user" | "guild";
type ExperimentForcedFilter = "all" | "forced" | "default";

interface ExperimentEntry {
    id: string;
    title: string;
    type: "user" | "guild" | "other";
    forced: boolean;
}

interface ExperimentIndex {
    entries: ExperimentEntry[];
    hasTypes: boolean;
    hasForced: boolean;
}

let experimentIndexCache: ExperimentIndex | null | undefined;

function invalidateExperimentIndex() {
    experimentIndexCache = undefined;
}

// Best-effort, strictly read-only snapshot of the experiment catalog, taken from
// Discord's own ExperimentStore. Everything is defensive: if Discord's internals
// ever change, this simply returns null and the filter chips disappear instead
// of breaking the Experiments page.
function getExperimentIndex(): ExperimentIndex | null {
    if (experimentIndexCache !== undefined) return experimentIndexCache;

    let result: ExperimentIndex | null = null;
    try {
        const store = ExperimentStore as any;
        if (store == null || typeof store.getRegisteredExperiments !== "function") {
            experimentIndexCache = null;
            return null;
        }

        const registered = store.getRegisteredExperiments();
        const pairs: Array<[string, any]> = registered instanceof Map
            ? Array.from(registered.entries(), ([id, descriptor]) => [String(id), descriptor])
            : Array.isArray(registered)
                ? registered.map((descriptor, i) => [String(descriptor?.title ?? i), descriptor] as [string, any])
                : registered != null && typeof registered === "object"
                    ? Object.entries(registered)
                    : [];

        const hasOverrideGetter = typeof store.getExperimentOverrideDescriptor === "function";
        const entries: ExperimentEntry[] = [];
        const seen = new Set<string>();

        for (const [id, descriptor] of pairs) {
            if (descriptor == null || typeof descriptor !== "object") continue;
            const title = typeof descriptor.title === "string" && descriptor.title.length > 0
                ? descriptor.title
                : id;
            if (seen.has(title)) continue;
            seen.add(title);

            const type = descriptor.type === "user" || descriptor.type === "guild"
                ? descriptor.type
                : "other";

            let forced = false;
            if (hasOverrideGetter) {
                try {
                    forced = store.getExperimentOverrideDescriptor(id)?.override === true;
                } catch {
                    // override lookup failed for this one; keep forced = false
                }
            }

            entries.push({ id, title, type, forced });
        }

        if (entries.length >= 5) {
            entries.sort((a, b) => a.title.localeCompare(b.title));
            result = {
                entries,
                hasTypes: entries.some(e => e.type === "user") && entries.some(e => e.type === "guild"),
                hasForced: hasOverrideGetter
            };
        }
    } catch {
        // Discord's store did not expose a usable catalog; no filter chips then
    }

    experimentIndexCache = result;
    return result;
}

// Types the value into Discord's own "Search experiments" input so the native
// experiment list filters itself live. Falls back silently if unreachable.
function setNativeSearchValue(value: string) {
    try {
        const input = document.querySelector<HTMLInputElement>('input[placeholder="Search experiments"]');
        if (!input) return;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        if (setter) setter.call(input, value);
        else input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
    } catch {
        // native input not reachable; our search box still filters the jump list
    }
}

interface CustomEmote {
    name: string;
    id: string;
    animated?: boolean;
}

// Emotes rendered on the filter bar, served straight from the Discord emoji CDN
// so they work for everyone. If one is ever deleted, the component falls back to
// the other file extension, then to the original Unicode emoji.
const EMOTES: Record<"search" | "user" | "guild" | "other" | "forced" | "notForced" | "rescan", CustomEmote> = {
    search: { name: "ablobpeek", id: "454790904763383853", animated: true },
    user: { name: "blobthinking", id: "454791313385324544" },
    guild: { name: "blobparty", id: "401421290939875328", animated: true },
    other: { name: "blobidea", id: "454791313364090900" },
    forced: { name: "ablobglarezoom", id: "454790902284550184", animated: true },
    notForced: { name: "blobmelt", id: "454791312181297163" },
    rescan: { name: "loading", id: "464531708054601738", animated: true }
};

function CustomEmoji({ emote, fallback, className }: { emote: CustomEmote | null; fallback: string; className?: string; }) {
    const [stage, setStage] = React.useState(0);

    if (emote?.id && stage < 2) {
        const ext = (stage === 0 ? emote.animated === true : emote.animated !== true) ? "gif" : "png";

        return (
            <img
                className={`vc-exp-emoji${className ? ` ${className}` : ""}`}
                src={`https://cdn.discordapp.com/emojis/${emote.id}.${ext}?size=44&quality=lossless`}
                alt={fallback}
                onError={() => setStage(s => s + 1)}
            />
        );
    }

    return <span className={className} aria-hidden={true}>{fallback}</span>;
}

function FilterChip({ label, icon, active, onClick }: { label: string; icon?: React.ReactNode; active: boolean; onClick: () => void; }) {
    return (
        <button
            type="button"
            className={active ? "vc-exp-chip vc-exp-chip-active" : "vc-exp-chip"}
            aria-pressed={active}
            onClick={onClick}
        >
            {icon}
            {label}
        </button>
    );
}

export default definePlugin({
    name: "Experiments",
    description: "Enable Access to Experiments & other dev-only features in Discord!",
    tags: ["Developers", "Utility"],
    authors: [
        Devs.Megu,
        Devs.Ven,
        Devs.Nickyux,
        Devs.BanTheNons,
        Devs.Nuckyz,
    ],

    isModified: true,
    dependencies: ["CommandsAPI"],
    settings,

    start: () => enableStyle(pageStyle),
    stop: () => disableStyle(pageStyle),

    commands: [
        {
            name: "experiments",
            description: "Open Discord's Experiments page.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: () => {
                try {
                    SettingsRouter.openUserSettings("Experiments");
                } catch {
                    // The Experiments section may not exist yet during boot; open plain settings instead
                    try { SettingsRouter.openUserSettings(); } catch { /* settings unavailable */ }
                }
            }
        }
    ],

    patches: [
        developerAccessPatch,
        connectionInitPatch,
        experimentsPagePatch,
        toolbarDevMenuPatch,
        toolbarDevMenuClickPatch,
        experimentEmbedPatch,
        experimentEmbedCrashFixPatch,
        serverAssignmentCrashFixPatch,
        playgroundEmbedPatch,
        experimentUrlRegexPatch,
        experimentLabelMatchPatch
    ],
    showWarningCard(): boolean {
        return !settings.store.hideWarningCard;
    },

    matchExperiment(url?: string, label?: string): boolean {
        if (typeof url !== "string" || typeof label !== "string") return false;
        const items = url.split("/");
        const treatment = items[items.length - 1];
        // Numeric links must use the value comparison, never a normalized label.
        // Otherwise a label such as "1" can intercept the default (-1) treatment.
        if (/^-?\d+$/.test(treatment)) return false;
        const labelCleaned = label.replace(/[^a-zA-Z0-9]+/g, "").toLowerCase();
        const urlEndCleaned = items[items.length - 1]?.replace(/[^a-zA-Z0-9]+/g, "").toLowerCase();
        return !!labelCleaned && urlEndCleaned !== undefined && labelCleaned === urlEndCleaned;
    },

    settingsAboutComponent: () => {
        let combo: React.ReactNode = `${modKey}+${altKey}+O`;
        try {
            if (KbdStyles?.combo && KbdStyles.key) {
                combo = (
                    <div className={KbdStyles.combo} style={{ display: "inline-flex" }}>
                        <kbd className={KbdStyles.key}>{modKey}</kbd>{" "}
                        <kbd className={KbdStyles.key}>{altKey}</kbd>{" "}
                        <kbd className={KbdStyles.key}>O</kbd>{" "}
                    </div>
                );
            }
        } catch {
            // kbd combo classes not found; keep plain text fallback
        }

        const buildChannel = getBuildChannel();
        const platform = IS_WEB ? "web (browser extension)" : "desktop";

        return (
            <React.Fragment>
                <HeadingSecondary>More Information</HeadingSecondary>
                <BaseText size="md">
                    {IS_WEB
                        ? "You are running the web version. Use your browser's developer tools (F12) to inspect the Discord page."
                        : <>You can open Discord's DevTools via {" "}{combo}</>}
                </BaseText>

                <div className={Margins.top16}>
                    <HeadingSecondary>🖥️ Build Context</HeadingSecondary>
                </div>
                <BaseText size="md">
                    Platform: {platform} · Release channel: {buildChannel}
                </BaseText>
                {buildChannel === "stable" && (
                    <BaseText size="sm" color="text-feedback-warning">
                        Heads up: most experiments are datamined on Canary, so a lot of them have no code at all in Stable
                        builds. If an experiment page shows an error, its feature is simply not in your build — set it back
                        to None and the error disappears.
                    </BaseText>
                )}

                <div className={Margins.top16}>
                    <HeadingSecondary>🩺 Patch Health</HeadingSecondary>
                </div>
                <BaseText size="sm">
                    Queue status of the client patches this plugin registers. A patch stays "waiting" until Discord loads
                    its target module. "Not queued" does not verify success: failed patches also leave the queue.
                    Setting changes marked as requiring a restart only take effect after restarting Discord.
                </BaseText>
                {PATCH_HEALTH.map(({ name, patch }) => {
                    const status = getPatchStatus(patch);
                    return (
                        <div key={name} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "3px 0" }}>
                            <span aria-hidden={true}>{status.icon}</span>
                            <span style={{ flex: 1, minWidth: 0, fontSize: 14 }}>{name}</span>
                            <span style={{ fontSize: 12, color: status.color }}>{status.label}</span>
                        </div>
                    );
                })}

                <div className={Margins.top16}>
                    <HeadingSecondary>Useful Resources</HeadingSecondary>
                </div>
                <BaseText size="md">
                    Search experiment names, see live rollouts and read the technical documentation before forcing anything:
                </BaseText>
                {RESOURCES.map(resource => (
                    <div key={resource.url} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "4px 0" }}>
                        <span aria-hidden={true} style={{ fontSize: 16 }}>{resource.emoji}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 600 }}>{resource.name}</div>
                            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{resource.description}</div>
                        </div>
                        <button
                            type="button"
                            aria-label={`Open ${resource.name}`}
                            title={`Open ${resource.name}`}
                            onClick={() => openLink(resource.url)}
                            style={{ background: "none", border: "1px solid var(--border-faint)", borderRadius: "6px", padding: "6px", cursor: "pointer", color: "var(--text-muted)", display: "inline-flex", flexShrink: 0 }}
                        >
                            <OpenExternalIcon width={16} height={16} />
                        </button>
                    </div>
                ))}
            </React.Fragment>
        );
    },

    FiltersBar: ErrorBoundary.wrap(() => {
        const [query, setQuery] = React.useState("");
        const [typeFilter, setTypeFilter] = React.useState<ExperimentTypeFilter>("all");
        const [forcedFilter, setForcedFilter] = React.useState<ExperimentForcedFilter>("all");
        const [, rescan] = React.useState(0);

        // Keep our search box in sync with Discord's own "Search experiments" input
        React.useEffect(() => {
            const input = document.querySelector<HTMLInputElement>('input[placeholder="Search experiments"]');
            if (!input) return;
            setQuery(input.value ?? "");
            const sync = () => setQuery(input.value ?? "");
            input.addEventListener("input", sync);
            return () => input.removeEventListener("input", sync);
        }, []);

        const applySearch = (value: string) => {
            setQuery(value);
            setNativeSearchValue(value);
        };

        const index = getExperimentIndex();

        const chipsActive = typeFilter !== "all" || forcedFilter !== "all";
        const needle = query.trim().toLowerCase();
        let matches: ExperimentEntry[] | null = null;
        if (index && chipsActive) {
            matches = index.entries.filter(entry =>
                (typeFilter === "all" || entry.type === typeFilter)
                && (forcedFilter === "all" || (forcedFilter === "forced") === entry.forced)
                && (!needle || entry.title.toLowerCase().includes(needle))
            );
        }

        return (
            <div className="vc-exp-filters">
                <div className="vc-exp-filters-row">
                    <div className="vc-exp-search">
                        <CustomEmoji emote={EMOTES.search} fallback="🔍" className="vc-exp-search-icon" />
                        <input
                            type="text"
                            className="vc-exp-search-input"
                            value={query}
                            placeholder="Filter experiments"
                            aria-label="Filter experiments by name"
                            onChange={e => applySearch(e.currentTarget.value)}
                        />
                        {query.length > 0 && (
                            <button
                                type="button"
                                className="vc-exp-search-clear"
                                aria-label="Clear search"
                                title="Clear search"
                                onClick={() => applySearch("")}
                            >
                                ✕
                            </button>
                        )}
                    </div>

                    {index?.hasTypes && (
                        <div className="vc-exp-chip-group" role="group" aria-label="Filter by experiment type">
                            <FilterChip label="All" active={typeFilter === "all"} onClick={() => setTypeFilter("all")} />
                            <FilterChip label="User" icon={<CustomEmoji emote={EMOTES.user} fallback="👤" />} active={typeFilter === "user"} onClick={() => setTypeFilter("user")} />
                            <FilterChip label="Server" icon={<CustomEmoji emote={EMOTES.guild} fallback="🏠" />} active={typeFilter === "guild"} onClick={() => setTypeFilter("guild")} />
                        </div>
                    )}

                    {index?.hasForced && (
                        <div className="vc-exp-chip-group" role="group" aria-label="Filter by force status">
                            <FilterChip label="All" active={forcedFilter === "all"} onClick={() => setForcedFilter("all")} />
                            <FilterChip label="Forced" icon={<CustomEmoji emote={EMOTES.forced} fallback="🎯" />} active={forcedFilter === "forced"} onClick={() => setForcedFilter("forced")} />
                            <FilterChip label="Not forced" icon={<CustomEmoji emote={EMOTES.notForced} fallback="⚪" />} active={forcedFilter === "default"} onClick={() => setForcedFilter("default")} />
                        </div>
                    )}
                </div>

                {matches !== null && (
                    <div className="vc-exp-jump">
                        <div className="vc-exp-jump-head">
                            <span>
                                {matches.length} matching experiment{matches.length === 1 ? "" : "s"} — click one to open it in the list below
                            </span>
                            <button
                                type="button"
                                className="vc-exp-jump-refresh"
                                aria-label="Rescan experiments"
                                title="Rescan experiments"
                                onClick={() => {
                                    invalidateExperimentIndex();
                                    rescan(n => n + 1);
                                }}
                            >
                                <CustomEmoji emote={EMOTES.rescan} fallback="↻" />
                            </button>
                        </div>
                        {matches.length === 0
                            ? <div className="vc-exp-jump-empty">Nothing matches these filters. Try "All".</div>
                            : (
                                <div className="vc-exp-jump-list">
                                    {matches.slice(0, 60).map(entry => (
                                        <button
                                            key={entry.id}
                                            type="button"
                                            className="vc-exp-jump-item"
                                            onClick={() => applySearch(entry.title)}
                                            title={entry.title}
                                        >
                                            <span className="vc-exp-jump-name">{entry.title}</span>
                                            <span className="vc-exp-jump-badges">
                                                <span className="vc-exp-jump-badge" aria-hidden={true}>
                                                    <CustomEmoji emote={entry.type === "user" ? EMOTES.user : entry.type === "guild" ? EMOTES.guild : EMOTES.other} fallback={entry.type === "user" ? "👤" : entry.type === "guild" ? "🏠" : "❔"} />
                                                </span>
                                                {entry.forced && (
                                                    <span className="vc-exp-jump-badge" aria-hidden={true}><CustomEmoji emote={EMOTES.forced} fallback="🎯" /></span>
                                                )}
                                            </span>
                                        </button>
                                    ))}
                                    {matches.length > 60 && (
                                        <div className="vc-exp-jump-more">
                                            … and {matches.length - 60} more — refine the search to narrow it down
                                        </div>
                                    )}
                                </div>
                            )
                        }
                    </div>
                )}
            </div>
        );
    }, { noop: true }),

    WarningCard: ErrorBoundary.wrap(() => (
        <ErrorCard id="vc-experiments-warning-card" className={Margins.bottom16}>
            <div className="vc-exp-warn-head">
                <span className="vc-exp-warn-icon" aria-hidden={true}>⚠️</span>
                <HeadingPrimary>Hold on!!</HeadingPrimary>
            </div>

            <Paragraph>
                Experiments are unreleased Discord features. They might not work, or even break your client or get your account disabled.
            </Paragraph>

            <Paragraph className={Margins.top8}>
                Only use experiments if you know what you're doing. Equicord is not responsible for any damage caused by enabling experiments.

                If you don't know what an experiment does, ignore it. Do not ask us what experiments do either, we probably don't know.
            </Paragraph>

            <Paragraph className={Margins.top8}>
                No, you cannot use server-side features like checking the "Send to Client" box: the server only accepts experiment overrides from Discord staff.
            </Paragraph>

            <Paragraph className={Margins.top8}>
                Why a forced experiment may not show anything: newer Apex experiments are assigned server-side and cannot be forced from the client;
                guild experiments can be locked to specific server IDs or Discord employees only (INTERNAL_EMPLOYEE_ONLY);
                a holdout experiment may disable the one you enabled;
                and some features only apply after a full client restart, not just a reload.
            </Paragraph>

            <Paragraph className={Margins.top8}>
                If an experiment shows an "An error occurred" screen, the feature's code is not in your client build. Set it back to None and the error disappears.
            </Paragraph>

            {IS_WEB && (
                <Paragraph className={Margins.top8}>
                    Note: you are using the web version. Many desktop-only experiments have no effect here.
                </Paragraph>
            )}
        </ErrorCard>
    ), { noop: true })
});
