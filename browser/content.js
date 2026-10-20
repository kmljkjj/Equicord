if (typeof browser === "undefined") {
    var browser = chrome;
}

/**
 * --- Updater bridge ---
 *
 * The bundle is injected by the manifest in the MAIN world (like upstream),
 * so it always runs before any Discord script. This content script only
 * relays updater requests from the bundle to the background worker, which
 * performs the actual GitHub requests.
 *
 * Downloaded updates are stored in sessionStorage: on the next page load,
 * the bundle's built-in update banner (see makeExtensionUpdateBanner in
 * scripts/build/buildWeb.mjs) swaps the packaged build for the downloaded
 * one before any of Discord's scripts run.
 */
let lastCheckResult = null;

function postBridgeResult(request, payload) {
    window.postMessage({ type: `${request.type}:result`, id: request.id, payload }, "*");
}

function postBridgeError(request, error) {
    window.postMessage({
        type: `${request.type}:result`,
        id: request.id,
        error: String((error && error.message) || error || "Unknown error")
    }, "*");
}

function sendToBackground(message) {
    return new Promise(resolve => {
        try {
            browser.runtime.sendMessage(message, response => {
                // avoid unchecked-lastError warnings when no background page responds
                void browser.runtime.lastError;
                resolve(response ?? { ok: false, error: "No response from the background worker" });
            });
        } catch (error) {
            resolve({ ok: false, error: String(error) });
        }
    });
}

window.addEventListener("message", async event => {
    if (event.source !== window) return;

    const request = event.data;
    if (!request || typeof request.id !== "string" || typeof request.type !== "string") return;
    if (!request.type.startsWith("vc-updater:")) return;

    try {
        switch (request.type) {
            case "vc-updater:check": {
                const release = await sendToBackground({ action: "vc-updater:release", repo: request.repo });
                if (!release.ok) throw new Error(release.error);

                if (!release.meta || !release.meta.hash) {
                    throw new Error(
                        "The latest release has no update metadata yet. "
                        + "Update the extension once by re-downloading the zip."
                    );
                }

                if (release.meta.hash === request.hash) {
                    lastCheckResult = null;
                    postBridgeResult(request, { outdated: false, updates: [] });
                    return;
                }

                const compare = await sendToBackground({
                    action: "vc-updater:compare",
                    repo: request.repo,
                    from: request.hash,
                    to: release.meta.hash
                });
                if (!compare.ok) throw new Error(compare.error);

                lastCheckResult = {
                    jsUrl: release.js,
                    cssUrl: release.css,
                    hash: release.meta.hash,
                    version: release.meta.version,
                    timestamp: release.meta.timestamp ?? Date.now()
                };

                postBridgeResult(request, { outdated: true, updates: compare.commits });
                return;
            }
            case "vc-updater:download": {
                if (!lastCheckResult || !lastCheckResult.jsUrl) throw new Error("No update available; run a check first");

                const download = await sendToBackground({
                    action: "vc-updater:download",
                    jsUrl: lastCheckResult.jsUrl,
                    cssUrl: lastCheckResult.cssUrl
                });
                if (!download.ok) throw new Error(download.error);
                if (!download.code) throw new Error("Downloaded update is empty");

                try {
                    sessionStorage.setItem("vcWebUpdateMeta", JSON.stringify({
                        version: lastCheckResult.version,
                        timestamp: lastCheckResult.timestamp,
                        hash: lastCheckResult.hash
                    }));
                    sessionStorage.setItem("vcWebUpdateCode", download.code);
                    if (typeof download.css === "string" && download.css.length > 0)
                        sessionStorage.setItem("vcWebUpdateCss", download.css);
                } catch (error) {
                    throw new Error(
                        "Failed to store the update for the next page load: "
                        + String((error && error.message) || error)
                    );
                }

                postBridgeResult(request, { success: true });
                return;
            }
        }
    } catch (error) {
        postBridgeError(request, error);
    }
});

document.addEventListener(
    "DOMContentLoaded",
    () => {
        window.postMessage({
            type: "vencord:meta",
            meta: {
                EXTENSION_VERSION: browser.runtime.getManifest().version,
                EXTENSION_BASE_URL: browser.runtime.getURL(""),
                RENDERER_CSS_URL: browser.runtime.getURL("dist/Equicord.css"),
            }
        });

        chrome.runtime.onMessage.addListener(request => {
            window.postMessage({ type: "vencord:keybinds", meta: request.command });
        });

        window.addEventListener("message", event => {
            if (event.source !== window) return;

            if (event.data.type === "OPEN_SHORTCUTS") {
                chrome.runtime.sendMessage({ action: "openShortcuts" });
            }
        }, false);
    },
    { once: true }
);
