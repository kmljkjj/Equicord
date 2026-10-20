/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 kmljkjj and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BadgePosition, ProfileBadge } from "@api/Badges";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { UserStore } from "@webpack/common";

/**
 * Client-side only: shows selected Discord-style badges on YOUR profile in YOUR client.
 * Other users still see your real badges. No real privileges are granted.
 */
const DISCORD_BADGES = [
    {
        id: "staff",
        description: "Discord Staff",
        iconSrc: "https://cdn.jsdelivr.net/gh/mezotv/discord-badges@main/assets/discord-staff.svg",
        settingKey: "staff" as const
    },
    {
        id: "partner",
        description: "Partnered Server Owner",
        iconSrc: "https://cdn.jsdelivr.net/gh/mezotv/discord-badges@main/assets/discord-partner.svg",
        settingKey: "partner" as const
    },
    {
        id: "certified_moderator",
        description: "Moderator Programs Alumni",
        iconSrc: "https://cdn.jsdelivr.net/gh/mezotv/discord-badges@main/assets/discord-mod.svg",
        settingKey: "certifiedModerator" as const
    },
    {
        id: "hypesquad",
        description: "HypeSquad Events",
        iconSrc: "https://cdn.jsdelivr.net/gh/mezotv/discord-badges@main/assets/hype-squad-events.svg",
        settingKey: "hypesquad" as const
    },
    {
        id: "bravery",
        description: "HypeSquad Bravery",
        iconSrc: "https://cdn.jsdelivr.net/gh/mezotv/discord-badges@main/assets/hype-squad-bravery.svg",
        settingKey: "bravery" as const
    },
    {
        id: "brilliance",
        description: "HypeSquad Brilliance",
        iconSrc: "https://cdn.jsdelivr.net/gh/mezotv/discord-badges@main/assets/hype-squad-brilliance.svg",
        settingKey: "brilliance" as const
    },
    {
        id: "balance",
        description: "HypeSquad Balance",
        iconSrc: "https://cdn.jsdelivr.net/gh/mezotv/discord-badges@main/assets/hype-squad-balance.svg",
        settingKey: "balance" as const
    },
    {
        id: "bug_hunter_1",
        description: "Discord Bug Hunter",
        iconSrc: "https://cdn.jsdelivr.net/gh/mezotv/discord-badges@main/assets/discord-bug-hunter-green.svg",
        settingKey: "bugHunter1" as const
    },
    {
        id: "bug_hunter_2",
        description: "Discord Bug Hunter Gold",
        iconSrc: "https://cdn.jsdelivr.net/gh/mezotv/discord-badges@main/assets/discord-bug-hunter-gold.svg",
        settingKey: "bugHunter2" as const
    },
    {
        id: "early_supporter",
        description: "Early Supporter",
        iconSrc: "https://cdn.jsdelivr.net/gh/mezotv/discord-badges@main/assets/discord-early-supporter.svg",
        settingKey: "earlySupporter" as const
    },
    {
        id: "active_developer",
        description: "Active Developer",
        iconSrc: "https://cdn.jsdelivr.net/gh/mezotv/discord-badges@main/assets/active-developer.svg",
        settingKey: "activeDeveloper" as const
    },
    {
        id: "verified_developer",
        description: "Early Verified Bot Developer",
        iconSrc: "https://cdn.jsdelivr.net/gh/mezotv/discord-badges@main/assets/discord-bot-dev.svg",
        settingKey: "verifiedDeveloper" as const
    },
    {
        id: "nitro",
        description: "Nitro Subscriber",
        iconSrc: "https://cdn.jsdelivr.net/gh/mezotv/discord-badges@main/assets/discord-nitro.svg",
        settingKey: "nitro" as const
    },
    {
        id: "nitro_basic",
        description: "Nitro Basic",
        iconSrc: "https://cdn.jsdelivr.net/gh/mezotv/discord-badges@main/assets/discord-nitro-basic.svg",
        settingKey: "nitroBasic" as const
    },
] as const;

const settings = definePluginSettings({
    staff: { type: OptionType.BOOLEAN, description: "Discord Staff", default: true },
    partner: { type: OptionType.BOOLEAN, description: "Partnered Server Owner", default: true },
    certifiedModerator: { type: OptionType.BOOLEAN, description: "Moderator Programs Alumni", default: true },
    hypesquad: { type: OptionType.BOOLEAN, description: "HypeSquad Events", default: true },
    bravery: { type: OptionType.BOOLEAN, description: "HypeSquad Bravery", default: true },
    brilliance: { type: OptionType.BOOLEAN, description: "HypeSquad Brilliance", default: true },
    balance: { type: OptionType.BOOLEAN, description: "HypeSquad Balance", default: true },
    bugHunter1: { type: OptionType.BOOLEAN, description: "Bug Hunter", default: true },
    bugHunter2: { type: OptionType.BOOLEAN, description: "Bug Hunter Gold", default: true },
    earlySupporter: { type: OptionType.BOOLEAN, description: "Early Supporter", default: true },
    activeDeveloper: { type: OptionType.BOOLEAN, description: "Active Developer", default: true },
    verifiedDeveloper: { type: OptionType.BOOLEAN, description: "Early Verified Bot Developer", default: true },
    nitro: { type: OptionType.BOOLEAN, description: "Nitro Subscriber", default: true },
    nitroBasic: { type: OptionType.BOOLEAN, description: "Nitro Basic", default: false },
});

function isSelf(userId: string): boolean {
    const me = UserStore.getCurrentUser()?.id;
    return !!me && me === userId;
}

function buildBadges(): ProfileBadge[] {
    return DISCORD_BADGES
        .filter(b => settings.store[b.settingKey])
        .map(b => ({
            id: `self_all_badges_${b.id}`,
            description: b.description,
            iconSrc: b.iconSrc,
            position: BadgePosition.START,
            props: {
                style: {
                    borderRadius: "50%",
                    transform: "scale(0.9)"
                }
            }
        } satisfies ProfileBadge));
}

const SelfAllBadgesRoot: ProfileBadge = {
    id: "self_all_badges_root",
    position: BadgePosition.START,
    shouldShow: ({ userId }) => isSelf(userId),
    getBadges: ({ userId }) => {
        if (!isSelf(userId)) return [];
        return buildBadges();
    }
};

export default definePlugin({
    name: "SelfAllBadges",
    description: "Show selected Discord-style badges on your own profile only (client-side). Others still see your real badges.",
    tags: ["Appearance", "Fun"],
    authors: [Devs.kmljkjj],
    dependencies: ["BadgeAPI"],
    settings,

    userProfileBadge: SelfAllBadgesRoot
});
