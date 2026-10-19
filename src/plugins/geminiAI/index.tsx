/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 kmljkjj and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { Menu } from "@webpack/common";

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/";

const settings = definePluginSettings({
    apiKey: {
        type: OptionType.STRING,
        description: "Your Google Gemini API key. Get a free one at aistudio.google.com/apikey",
        default: ""
    },
    model: {
        type: OptionType.STRING,
        description: "Gemini model to use",
        default: "gemini-flash-latest"
    },
    targetLanguage: {
        type: OptionType.STRING,
        description: "Language used by the AI Translate action and the /ai-translate command",
        default: "French"
    }
});

function checkApiKey(): string | null {
    const { apiKey } = settings.store;
    if (!apiKey) {
        return "GeminiAI: no API key set. Open Settings > Equicord > GeminiAI and paste your free Gemini API key (aistudio.google.com/apikey).";
    }
    return null;
}

async function askGemini(prompt: string, systemInstruction?: string): Promise<string> {
    const { apiKey, model } = settings.store;

    const res = await fetch(`${GEMINI_API_URL}${model}:generateContent`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {})
        })
    });

    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Gemini API error ${res.status}${body ? `: ${body.slice(0, 300)}` : ""}`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts
        ?.map((part: { text?: string; }) => part?.text ?? "")
        .join("") ?? "";
    if (!text.trim()) throw new Error("Gemini returned an empty response");
    return text.trim();
}

async function runAiTask(channelId: string, task: () => Promise<string>) {
    try {
        const result = await task();
        const content = result.length > 1900 ? `${result.slice(0, 1900)}...` : result;
        sendBotMessage(channelId, { content });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sendBotMessage(channelId, { content: `GeminiAI error: ${message.slice(0, 400)}` });
    }
}

function getMessageContent(message: Message): string {
    const { content } = message as Message & { content?: string; };
    return content?.trim() ?? "";
}

const messageCtxPatch: NavContextMenuPatchCallback = (children, props) => {
    const message = props?.message as Message | undefined;
    if (!message) return;

    const content = getMessageContent(message);
    if (!content) return;

    const group = findGroupChildrenByChildId("copy-text", children);
    if (!group) return;

    const copyIdx = group.findIndex(c => c?.props?.id === "copy-text");
    const insertAt = copyIdx === -1 ? group.length : copyIdx + 1;

    group.splice(
        insertAt,
        0,
        <Menu.MenuItem
            label="AI Translate"
            id="vc-gemini-translate"
            action={() => runAiTask(message.channel_id, async () => {
                const keyError = checkApiKey();
                if (keyError) return keyError;
                const { targetLanguage } = settings.store;
                return askGemini(
                    `Translate the following message to ${targetLanguage}. Output only the translation.\n\n${content.slice(0, 3000)}`,
                    "You are a translation engine. Output only the translation of the given message, without any explanation."
                );
            })}
        />,
        <Menu.MenuItem
            label="AI Summarize"
            id="vc-gemini-summarize"
            action={() => runAiTask(message.channel_id, async () => {
                const keyError = checkApiKey();
                if (keyError) return keyError;
                return askGemini(
                    `Summarize the following message in one or two short sentences.\n\n${content.slice(0, 6000)}`,
                    "You are a summarization engine. Output only the summary, without any explanation."
                );
            })}
        />
    );
};

export default definePlugin({
    name: "GeminiAI",
    description: "Brings Google Gemini AI into Discord: /ai chatbot, /ai-translate, and AI Translate / AI Summarize actions in the message context menu",
    tags: ["AI", "Utility"],
    authors: [Devs.kmljkjj],
    dependencies: ["CommandsAPI"],
    settings,

    commands: [
        {
            name: "ai",
            description: "Ask Google Gemini anything (the reply is only visible to you)",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "message",
                    description: "Your prompt for Gemini",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                }
            ],
            execute: async (args, ctx) => {
                const prompt = findOption(args, "message", "");
                if (!prompt?.trim()) return;

                await runAiTask(ctx.channel.id, async () => {
                    const keyError = checkApiKey();
                    if (keyError) return keyError;
                    return askGemini(prompt.slice(0, 4000));
                });
            }
        },
        {
            name: "ai-translate",
            description: "Translate a text with Google Gemini (the reply is only visible to you)",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "text",
                    description: "The text to translate",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                }
            ],
            execute: async (args, ctx) => {
                const text = findOption(args, "text", "");
                if (!text?.trim()) return;

                await runAiTask(ctx.channel.id, async () => {
                    const keyError = checkApiKey();
                    if (keyError) return keyError;
                    const { targetLanguage } = settings.store;
                    return askGemini(
                        `Translate the following text to ${targetLanguage}. Output only the translation.\n\n${text.slice(0, 4000)}`,
                        "You are a translation engine. Output only the translation, without any explanation."
                    );
                });
            }
        }
    ],

    contextMenus: {
        message: messageCtxPatch
    }
});
