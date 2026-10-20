if (typeof browser === "undefined") {
    var browser = chrome;
}

/**
 * --- Self-updating bundle loader ---
 *
 * The extension bundle is no longer injected directly by the manifest.
 * This loader first checks chrome.storage.local for a bundle downloaded by
 * the in-app Updater. If that stored bundle is newer than the packaged one,
 * it is injected instead. Otherwise the packaged bundle is injected.
 * This is what allows "Check for Updates" in the settings to actually apply updates.
 */
const UPDATE_KEY = "vcWebUpdate";
const BUNDLE_URL = browser.runtime.getURL("dist/Equicord.js");
const METADATA_URL = browser.runtime.getURL("extension-meta.json");

function injectScript(code, url) {
    const script = document.createElement("script");
    if (code != null) script.textContent = code;
    else script.src = url;
    (document.head ?? document.documentElement).appendChild(script);
}

function compareVersions(a, b) {
    const parse = v => String(v ?? "").split(".").map(n => parseInt(n, 10) || 0);
    const left = parse(a);
    const right = parse(b);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
        const diff = (left[i] ?? 0) - (right[i] ?? 0);
        if (diff !== 0) return diff > 0 ? 1 : -1;
    }
    return 0;
}

function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise(resolve => setTimeout(() => resolve(null), ms))
    ]);
}

async function loadEquicord() {
    let injected = false;

    try {
        const [storedData, packagedMeta] = await Promise.all([
            withTimeout(browser.storage.local.get(UPDATE_KEY).catch(() => null), 300),
            fetch(METADATA_URL).then(res => res.ok ? res.json() : null).catch(() => null)
        ]);

        const stored = storedData ? storedData[UPDATE_KEY] : null;
        const manifestVersion = browser.runtime.getManifest().version;
        const packagedVersion = packagedMeta?.version ?? manifestVersion;
        const packagedBuildTimestamp = packagedMeta?.buildTimestamp ?? 0;

        if (stored && typeof stored.code === "string" && stored.code.length > 0) {
            const storedIsNewer =
                (stored.version && compareVersions(stored.version, packagedVersion) > 0)
                || (stored.version === packagedVersion && (stored.timestamp ?? 0) > packagedBuildTimestamp);

            if (storedIsNewer) {
                injectScript(stored.code);
                injected = true;
            } else {
                // the packaged build is at least as new as the stored update; clear it
                browser.storage.local.remove(UPDATE_KEY).catch(() => { });
            }
        }
    } catch (error) {
        console.warn("Equicord: update loader failed, falling back to the packaged build", error);
    }

    if (!injected) injectScript(null, BUNDLE_URL);
}

loadEquicord();

/**
 * --- Updater bridge ---
 *
 * Relays updater requests from the injected bundle (MAIN world) to the
 * background worker, which performs the actual GitHub requests.
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

                await browser.storage.local.set({
                    [UPDATE_KEY]: {
                        code: download.code,
                        css: download.css ?? null,
                        hash: lastCheckResult.hash,
                        version: lastCheckResult.version,
                        timestamp: lastCheckResult.timestamp
                    }
                });

                postBridgeResult(request, { success: true });
                return;
            }
            case "vc-updater:get-css": {
                const data = await browser.storage.local.get(UPDATE_KEY).catch(() => null);
                const stored = data ? data[UPDATE_KEY] : null;
                postBridgeResult(request, { css: typeof stored?.css === "string" ? stored.css : null });
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
