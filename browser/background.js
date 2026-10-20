/**
 * @template T
 * @param {T[]} arr
 * @param {(v: T) => boolean} predicate
 */
function removeFirst(arr, predicate) {
    const idx = arr.findIndex(predicate);
    if (idx !== -1) arr.splice(idx, 1);
}

chrome.webRequest.onHeadersReceived.addListener(
    ({ responseHeaders, type, url }) => {
        if (!responseHeaders) return;

        if (type === "main_frame" && url.includes("discord.com")) {
            // In main frame requests, the CSP needs to be removed to enable fetching of custom css
            // as desired by the user
            removeFirst(responseHeaders, h => h.name.toLowerCase() === "content-security-policy");
        } else if (type === "stylesheet" && url.startsWith("https://raw.githubusercontent.com/")) {
            // Most users will load css from GitHub, but GitHub doesn't set the correct content type,
            // so we fix it here
            removeFirst(responseHeaders, h => h.name.toLowerCase() === "content-type");
            responseHeaders.push({
                name: "Content-Type",
                value: "text/css"
            });
        }
        return { responseHeaders };
    },
    { urls: ["https://raw.githubusercontent.com/*", "*://*.discord.com/*"], types: ["main_frame", "stylesheet"] },
    ["blocking", "responseHeaders"]
);

/**
 * --- In-app self-updater ---
 *
 * Performs the GitHub requests behind the Updater tab. The content script
 * relays window messages from the injected bundle to this background page.
 */
const UPDATER_REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const UPDATER_SHA_RE = /^[\w-]+$/;
const UPDATER_URL_RE = /^https:\/\/(github\.com|objects\.githubusercontent\.com)\//;

async function fetchJson(url) {
    const res = await fetch(url, { headers: { "Accept": "application/vnd.github+json" } });
    if (!res.ok) throw new Error("GitHub request failed (" + res.status + "): " + url);
    return res.json();
}

async function handleUpdaterRequest(message) {
    switch (message && message.action) {
        case "vc-updater:release": {
            const repo = String((message && message.repo) || "");
            if (!UPDATER_REPO_RE.test(repo)) throw new Error("Invalid repo: " + repo);

            const release = await fetchJson("https://api.github.com/repos/" + repo + "/releases/latest");

            const metaAsset = (release.assets || []).find(a => a.name === "extension-meta.json");
            const jsAsset = (release.assets || []).find(a => a.name === "extension.js");
            const cssAsset = (release.assets || []).find(a => a.name === "extension.css");
            if (!metaAsset || !jsAsset || !cssAsset)
                throw new Error("The latest release is missing the updater assets. Re-download the extension zip once.");

            const meta = await fetchJson(metaAsset.browser_download_url);

            return {
                ok: true,
                meta,
                js: jsAsset.browser_download_url,
                css: cssAsset.browser_download_url
            };
        }
        case "vc-updater:compare": {
            const repo = String((message && message.repo) || "");
            const from = String((message && message.from) || "");
            const to = String((message && message.to) || "");
            if (!UPDATER_REPO_RE.test(repo)) throw new Error("Invalid repo: " + repo);
            if (!UPDATER_SHA_RE.test(from) || !UPDATER_SHA_RE.test(to)) throw new Error("Invalid commit hash");

            const compare = await fetchJson("https://api.github.com/repos/" + repo + "/compare/" + from + "..." + to);

            const commits = (compare.commits || []).map(c => ({
                hash: c.sha,
                author: (c.author && c.author.login) || (c.commit && c.commit.author && c.commit.author.name) || "Unknown",
                message: c.commit.message.split("\n")[0]
            }));

            return { ok: true, commits };
        }
        case "vc-updater:download": {
            const jsUrl = String((message && message.jsUrl) || "");
            if (!UPDATER_URL_RE.test(jsUrl)) throw new Error("Invalid update URL: " + jsUrl);

            const jsRes = await fetch(jsUrl);
            if (!jsRes.ok) throw new Error("Failed to download the update (" + jsRes.status + ")");
            const code = await jsRes.text();
            if (!code) throw new Error("The downloaded update is empty");

            let css = null;
            const cssUrl = String((message && message.cssUrl) || "");
            if (cssUrl && UPDATER_URL_RE.test(cssUrl)) {
                const cssRes = await fetch(cssUrl);
                if (cssRes.ok) css = await cssRes.text();
            }

            return { ok: true, code, css };
        }
        default:
            return null;
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const handled = handleUpdaterRequest(message);
    if (handled) {
        handled
            .then(sendResponse)
            .catch(error => sendResponse({ ok: false, error: String((error && error.message) || error) }));
        return true;
    }
});
