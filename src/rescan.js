import { verbosity, accountDomain } from "./common.js";
import { config, updateActiveRescans } from "./config.js";
import { initThemeSwitcher } from "./theme_switcher.js";
import { displayEvent } from "./display.js";
import { Requests } from "./requests.js";
import { getAccounts } from "./accounts.js";

/* globals console, document, messenger, setTimeout, clearTimeout, window */

const verbose = verbosity.rescan;

let timer = null;
const ACTIVE_REFRESH_SECONDS = 1;
const INACTIVE_REFRESH_SECONDS = 30;

let refreshPending = false;
let closePending = false;
let autoClose = true;

let rescanStack = null;
let rescanTemplate = null;

const requests = new Requests();

initThemeSwitcher();
let reportedRescans = new Map();

// rescans keyed by accountId-rescanId that have action or error detail
let detailIds = new Map();

// rescans keyed by accountId-rescanId that are present in the rescan status response
let rescanIds = new Map();

function resetRefreshTimer(seconds = 0) {
    try {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        if (seconds !== 0) {
            if (verbose) {
                console.debug("setting refresh timout:", seconds);
            }
            timer = setTimeout(refreshRescanStatus, seconds * 1000);
        }
    } catch (e) {
        console.error(e);
    }
}

async function onRefreshClicked() {
    try {
        if (verbose) {
            console.log("onRefreshClicked");
        }
        detailIds.clear();
        rescanIds.clear();
        rescanStack.innerHTML = "";
        autoClose = false;
        closePending = false;
        await config.session.remove(config.session.key.activeRescans);
        await refreshRescanStatus(true);
    } catch (e) {
        console.error(e);
    }
}

async function onClearClicked() {
    try {
        detailIds.clear();
        rescanStack.innerHTML = "";
        autoClose = false;
        closePending = false;
        await updateDisplay();
    } catch (e) {
        console.error(e);
    }
}

function onCloseClicked() {
    try {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        window.close();
    } catch (e) {
        console.error(e);
    }
}

async function refreshAccountIds(allAccounts = false) {
    try {
        let accounts = await getAccounts();
        let refreshAccounts = new Map();
        if (allAccounts) {
            for (const account of Object.values(accounts)) {
                refreshAccounts.set(accountDomain(account), account.id);
            }
        } else {
            for (const rescanId of rescanIds.keys()) {
                let account = accounts[rescanId.replace(/-.*$/, "")];
                refreshAccounts.set(accountDomain(account), account.id);
            }
        }
        return Array.from(refreshAccounts.values());
    } catch (e) {
        console.error(e);
    }
}

async function refreshRescanStatus(allAccounts = false) {
    try {
        if (verbose) {
            console.log("refreshRescanStatus:", { allAccounts });
        }
        timer = null;
        if (closePending) {
            // updateDisplay wants to close, so don't request a new refresh this tick
            return await updateDisplay();
        }
        refreshPending = true;
        enableButtons(false);
        let accountIds = await refreshAccountIds(allAccounts);
        for (const accountId of accountIds) {
            try {
                const response = await requests.get(accountId, "/rescan/");
                if (verbose) {
                    console.debug("rescanstatus response:", accountId, response);
                }
                // just send the response to updateActiveRescans
                // the display is updated in the handler of the resulting storage change event
                try {
                    await updateActiveRescans(response, accountId);
                } catch (e) {
                    console.error(e);
                }
            } catch (e) {
                console.error(e);
            }
        }
    } catch (e) {
        console.error(e);
    } finally {
        refreshPending = false;
        enableButtons(true);
        if (!timer) {
            resetRefreshTimer(ACTIVE_REFRESH_SECONDS);
        }
    }
}

function onDOMContentLoaded() {
    try {
        rescanTemplate = document.getElementById("rescan-item").innerHTML;
        if (verbose) {
            console.log("rescanTemplate:", rescanTemplate);
        }
        rescanStack = document.getElementById("rescan-stack");
        rescanStack.innerHTML = "";
    } catch (e) {
        console.error(e);
    }
}

async function updateDisplay() {
    try {
        // read all the active rescans from storage
        let rescans = await config.session.get(config.session.key.activeRescans);

        if (typeof rescans !== "object") {
            rescans = {};
        }

        if (verbose) {
            console.log("updateDisplay:", rescans);
        }

        let nextRefresh = INACTIVE_REFRESH_SECONDS;
        let ids = Object.keys(rescans).sort();
        for (const id of ids) {
            let rescan = rescans[id];
            rescanIds.set(id, true);
            if (rescan.Running) {
                nextRefresh = ACTIVE_REFRESH_SECONDS;
            }

            let fields = renderRescanStatus(rescan);
            let itemId = "item-" + id;
            let labelId = "label-" + id;
            let progressId = "progress-" + id;
            let progressBarId = "progress-bar-" + id;
            let errorPanelId = "error-panel-" + id;
            let label = undefined;
            let progress = undefined;
            let progressBar = undefined;
            let errorPanel = undefined;
            if (document.getElementById(itemId)) {
                label = document.getElementById(labelId);
                progress = document.getElementById(progressId);
                progressBar = document.getElementById(progressBarId);
                errorPanel = document.getElementById(errorPanelId);
            } else {
                let item = document.createElement("div");
                item.innerHTML = rescanTemplate;
                item.classList.add("border");
                item.classList.add("rounded-0");
                item.style.padding = "10px";
                item.id = itemId;
                label = item.getElementsByClassName("form-label")[0];
                label.id = labelId;
                progress = item.getElementsByClassName("progress")[0];
                progress.id = progressId;
                progressBar = item.getElementsByClassName("progress-bar")[0];
                progressBar.id = progressBarId;
                rescanStack.appendChild(item);
                errorPanel = item.getElementsByClassName("rescan-errors")[0];
                errorPanel.id = errorPanelId;
                errorPanel.hidden = true;
            }
            label.textContent = fields.join("\t");
            if (rescan.Running) {
                const percentage = (rescan.Completed / rescan.Total) * 100;
                progressBar.style.width = percentage + "%";
                progressBar.setAttribute("aria-valuenow", rescan.Completed);
                progressBar.textContent = "";
            } else {
                if (!progress.hidden) {
                    progress.hidden = true;
                    if (!reportedRescans.has(id)) {
                        await displayEvent(fields.join(" "), { title: "Mail Filter Rescan" });
                        reportedRescans.set(id, true);
                    }
                }
            }

            let actionContent = makeDetailContent("Action", rescan.Actions);
            let errorContent = makeDetailContent("Error", rescan.Errors);
            if (actionContent || errorContent) {
                errorPanel.innerHTML = actionContent + (actionContent ? "\n<br>\n" : "") + errorContent;
                errorPanel.hidden = false;
                // prevent automatic close if action or error detail is present
                autoClose = false;
                detailIds.set(id, true);
            }
        }

        closePending = await removeExpiredElements(Array.from(Object.keys(rescans)));

        if (autoClose && closePending && !refreshPending) {
            return await onCloseClicked();
        }
        resetRefreshTimer(nextRefresh);
    } catch (e) {
        console.error(e);
    }
}

function makeDetailContent(label, details) {
    try {
        let content = "";
        if (details.length > 0) {
            content = "<details>\n";
            content += `<summary>${label} Details</summary>\n`;
            for (const detail of details) {
                content += `<p>${label}: ${detail.Message}<br>\n`;
                for (const [key, value] of Object.entries(detail.Headers)) {
                    content += `${key}: ${value}<br>\n`;
                }
                content += `Pathname: ${detail.Pathname}</p>\n`;
            }
            content += "</details>";
        }
        return content;
    } catch (e) {
        console.error(e);
    }
}

async function removeExpiredElements(activeIds) {
    try {
        // activeIds is the list of currently active rescanIds from storage

        // remove rescanIds that are not in activeIds
        for (const id of Array.from(rescanIds.keys())) {
            if (!activeIds.includes(id)) {
                rescanIds.delete(id);
            }
        }

        // remove display elements that are not either active or an error
        let empty = true;
        for (const element of document.getElementsByClassName("progress")) {
            const item = element.parentElement;
            let itemRescanId = item.id.replace(/^item-/, "");
            if (verbose) {
                console.debug({ itemRescanId }, rescanIds.has(itemRescanId));
            }
            if (rescanIds.has(itemRescanId)) {
                // don't remove active rescans
                empty = false;
                continue;
            }
            if (detailIds.has(itemRescanId)) {
                // don't remove rescans with details
                empty = false;
                continue;
            }
            rescanStack.removeChild(item);
        }
        if (detailIds.size > 0) {
            // always return non-empty if details are present
            empty = false;
        }
        return empty;
    } catch (e) {
        console.error(e);
    }
}

function renderRescanStatus(rescan) {
    try {
        let content = [];
        content.push(rescan.Request.Username);
        content.push(rescan.Request.Folder);
        if (rescan.Total === 1) {
            content.push("<" + rescan.Request.MessageIds[0] + ">");
        } else {
            content.push(`<${rescan.Total} messages>`);
        }
        content.push(rescan.Running ? "Running" : "Complete");
        content.push(`[${rescan.Completed} of ${rescan.Total}]`);
        if (rescan.FailCount > 0) {
            content.push(`(${rescan.FailCount} failed)`);
        }
        if (rescan.Running) {
            let latest = rescan.LatestFile.replace(/^[^/]*[/]/g, "");
            content.push(latest);
        }
        if (rescan.Actions.length > 0) {
            let moved = {};
            for (const action of rescan.Actions) {
                let words = action.Message.split(" ");
                let maildir = words[words.length - 1];
                if (!Object.hasOwn(moved, maildir)) {
                    moved[maildir] = 0;
                }
                moved[maildir] = moved[maildir] + 1;
            }
            for (const [k, v] of Object.entries(moved)) {
                content.push(`<${v} moved to ${k}>`);
            }
        }
        return content;
    } catch (e) {
        console.error(e);
    }
}

function onMessage(message, sender) {
    try {
        if (message.dst !== "rescan") {
            return false;
        }
        return new Promise((resolve) => {
            handleMessage(message, sender).then((response) => {
                resolve(response);
            });
        });
    } catch (e) {
        console.error(e);
    }
}

async function handleMessage(message, sender) {
    try {
        if (verbose) {
            console.debug("rescan.onMessage:", message, sender);
            if (verbose) {
                console.log("rescan onMessage:", message.id);
            }
        }
        var response;
        switch (message.id) {
            case "ENQ":
                response = { id: "ACK", src: "rescan", dst: message.src };
                if (verbose) {
                    console.log("resend received ENQ, returning:", response);
                }
                return response;

            case "rescanStarted":
                return await updateDisplay();
        }
        console.error("unexpected message:", message);
        throw new Error("unexpected message:" + message.id);
    } catch (e) {
        console.error(e);
    }
}

async function onLoad() {
    try {
        console.warn("rescan loading");
        document.title = await config.local.get(config.local.key.rescanTitle);
    } catch (e) {
        console.error(e);
    }
}

async function onBeforeUnload() {
    try {
        console.warn("rescan unloading");
        resetRefreshTimer();
    } catch (e) {
        console.error(e);
    }
}

async function onStorageChanged(changes, areaName) {
    try {
        if (areaName === "session" && Object.hasOwn(changes, config.session.key.activeRescans)) {
            if (verbose) {
                console.log("activeRescans changed; calling updateDisplay");
            }
            await updateDisplay();
        }
    } catch (e) {
        console.error(e);
    }
}

function enableButtons(enabled) {
    try {
        document.getElementById("rescan-refresh-button").disabled = !enabled;
        document.getElementById("rescan-clear-button").disabled = !enabled;
    } catch (e) {
        console.error(e);
    }
}

window.addEventListener("load", onLoad);
window.addEventListener("beforeunload", onBeforeUnload);
window.addEventListener("DOMContentLoaded", onDOMContentLoaded);
document.getElementById("rescan-refresh-button").addEventListener("click", onRefreshClicked);
document.getElementById("rescan-clear-button").addEventListener("click", onClearClicked);
document.getElementById("rescan-close-button").addEventListener("click", onCloseClicked);
messenger.storage.onChanged.addListener(onStorageChanged);
messenger.runtime.onMessage.addListener(onMessage);
