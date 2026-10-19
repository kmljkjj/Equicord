/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType } from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import { BaseText } from "@components/BaseText";
import ErrorBoundary from "@components/ErrorBoundary";
import { ErrorCard } from "@components/ErrorCard";
import { HeadingPrimary, HeadingSecondary } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { Devs, IS_MAC } from "@utils/constants";
import { Margins } from "@utils/margins";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { React, SettingsRouter } from "@webpack/common";

const KbdStyles = findByPropsLazy("key", "combo");
const modKey = IS_MAC ? "cmd" : "ctrl";
const altKey = IS_MAC ? "opt" : "alt";

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
    }
});

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
        {
            find: "Object.defineProperties(this,{isDeveloper",
            replacement: {
                match: /(?<={isDeveloper:\{[^}]+?,get:\(\)=>)\i/,
                replace: "true"
            }
        },
        {
            find: 'type:"user",revision',
            replacement: {
                match: /!(\i)(?=&&"CONNECTION_OPEN")/,
                replace: "!($1=true)"
            }
        },
        {
            find: 'placeholder:"Search experiments"',
            replacement: [
                {
                    match: /(?<=children:\[)(?=null!=.{0,150}"Installation ID:)/,
                    replace: "$self.showWarningCard()?$self.WarningCard():null,"
                },
                // for some reason the installation id and copy buttons are on
                // different lines so it looks stupid when the card above is added
                {
                    match: /(?<=,marginBottom:16)(?=\},children:\[)/,
                    replace: ',flexDirection:"row",alignItems:"center"'
                }
            ]
        },
        // Change top right toolbar button from the help one to the dev one
        {
            find: '?"BACK_FORWARD_NAVIGATION":',
            replacement: {
                match: /hasBugReporterAccess:(\i)/,
                replace: "_hasBugReporterAccess:$1=true"
            },
            predicate: () => settings.store.toolbarDevMenu
        },
        // Disable opening the bug report menu when clicking the top right toolbar dev button
        {
            find: 'navId:"staff-help-popout"',
            replacement: {
                match: /(isShown.+?)onClick:\i/,
                replace: (_, rest) => `${rest}onClick:()=>{}`
            },
            predicate: () => settings.store.toolbarDevMenu
        },
        // Enable experiment embed on sent experiment links
        {
            find: "Clear Treatment ",
            replacement: [
                {
                    match: /\i\?\.isStaff\(\)/,
                    replace: "true"
                },
                // Fix some tricky experiments name causing a client crash
                {
                    match: /\.isStaffPersonal\(\).+?if\(null==(\i)\|\|null==\i(?=\)return null;)/,
                    replace: "$&||({})[$1]!=null"
                }
            ]
        },
        // Fix another function which causes crashes with tricky experiment names and the experiment embed
        {
            find: "}getServerAssignment(",
            replacement: {
                match: /}getServerAssignment\((\i),\i,\i\){/,
                replace: "$&if($1==null)return;"
            }
        },
        // Enable playground embed on sent playground links
        // dev://playground/mana, dev://playground/payments, dev://playground/virtual-currency,
        // dev://playground/nitro, dev://playground/mfa, dev://playground/cms, dev://playground/void
        {
            find: '"Open Playground',
            replacement: {
                match: /isStaff\(\)\|\|/,
                replace: "$& true||"
            }
        },
        {
            // Expands the experiment regex to allow negative numbers as well as text in the last segment of the URL.
            find: '"^dev://experiment/',
            replacement: {
                match: /\[0-9\]\+(?=\)\)\?\$")/,
                replace: "[a-zA-Z0-9-]+"
            }
        },
        {
            find: ".EXPERIMENT_TREATMENT&&null",
            replacement: [
                {
                    // Allow linking experiments by their label instead of their value.
                    match: /(?<=find\(\i=>)((\i).value===\i)/,
                    replace: "{return($1)||($self.matchExperiment(arguments[0]?.url,$2?.label))}"
                }
            ]
        },
    ],
    showWarningCard(): boolean {
        return !settings.store.hideWarningCard;
    },

    matchExperiment(url?: string, label?: string): boolean {
        if (typeof url !== "string" || typeof label !== "string") return false;
        const items = url.split("/");
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

        return (
            <React.Fragment>
                <HeadingSecondary>More Information</HeadingSecondary>
                <BaseText size="md">
                    {IS_WEB
                        ? "You are running the web version. Use your browser's developer tools (F12) to inspect the Discord page."
                        : <>You can open Discord's DevTools via {" "}{combo}</>}
                </BaseText>
            </React.Fragment>
        );
    },

    WarningCard: ErrorBoundary.wrap(() => (
        <ErrorCard id="vc-experiments-warning-card" className={Margins.bottom16}>
            <HeadingPrimary>Hold on!!</HeadingPrimary>

            <Paragraph>
                Experiments are unreleased Discord features. They might not work, or even break your client or get your account disabled.
            </Paragraph>

            <Paragraph className={Margins.top8}>
                Only use experiments if you know what you're doing. Equicord is not responsible for any damage caused by enabling experiments.

                If you don't know what an experiment does, ignore it. Do not ask us what experiments do either, we probably don't know.
            </Paragraph>

            <Paragraph className={Margins.top8}>
                No, you cannot use server-side features like checking the "Send to Client" box.
            </Paragraph>

            {IS_WEB && (
                <Paragraph className={Margins.top8}>
                    Note: you are using the web version. Many desktop-only experiments have no effect here.
                </Paragraph>
            )}
        </ErrorCard>
    ), { noop: true })
});
