/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ErrorCard } from "@components/ErrorCard";
import { UpdateLogger } from "@utils/updater";
import { ConfirmModal,openModal, Parser } from "@webpack/common";

function getErrorMessage(e: any) {
    const { code, path, cmd, stderr, message } = e ?? {};

    // structured error from a spawned command (e.g. the desktop git updater)
    if (code && cmd) {
        if (code === "ENOENT")
            return `Command \`${path}\` not found.\nPlease install it and try again.`;

        const extra = stderr || `Code \`${code}\`. See the console for more info.`;

        return `An error occurred while running \`${cmd}\`:\n${extra}`;
    }

    // plain errors (e.g. the extension updater bridge) carry a useful
    // message; surface it instead of hiding it behind a generic text
    if (typeof message === "string" && message.length > 0)
        return message;

    return "An unknown error occurred.\nPlease try again or see the console for more info.";
}

export function runWithDispatch(dispatch: React.Dispatch<React.SetStateAction<boolean>>, action: () => any) {
    return async () => {
        dispatch(true);

        try {
            await action();
        } catch (e: any) {
            UpdateLogger.error(e);

            const err = getErrorMessage(e);

            openModal(props => (
                <ConfirmModal
                    {...props}
                    title="Oops!"
                    confirmText="OK"
                    variant="primary"
                >
                    <ErrorCard>
                        {err.split("\n").map((line, idx) =>
                            <div key={idx}>{Parser.parse(line)}</div>
                        )}
                    </ErrorCard>
                </ConfirmModal>
            ));
        } finally {
            dispatch(false);
        }
    };
}
