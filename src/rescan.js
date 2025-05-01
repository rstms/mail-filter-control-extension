import { verbosity, accountDomain } from "./common.js";
import { config, updateActiveRescans } from "./config.js";
import { getAccounts } from "./accounts.js";
import { initThemeSwitcher } from "./theme_switcher.js";
import { displayEvent } from "./display.js";

/* globals console, document, messenger, setTimeout, clearTimeout, window */

const verbose = verbosity.rescan;

let timer = null;
const ACTIVE_REFRESH_SECONDS = 1;
const INACTIVE_REFRESH_SECONDS = 30;

let rescanStack = null;
let rescanTemplate = null;

initThemeSwitcher();
let reportedRescans = new Map();
let errorIds = new Map();

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
        await refreshRescanStatus();
    } catch (e) {
        console.error(e);
    }
}

async function refreshRescanStatus() {
    try {
        if (verbose) {
            console.log("refreshRescanStatus");
        }
        const accounts = await getAccounts();
        let domainAccounts = {};
        for (const [accountId, account] of Object.entries(accounts)) {
            domainAccounts[accountDomain(account)] = accountId;
        }
        //let updated = {};
        for (const accountId of Object.values(domainAccounts)) {
            const response = await sendMessage({
                id: "sendCommand",
                accountId: accountId,
                command: "rescanstatus",
            });
            if (verbose) {
                console.debug("rescanstatus response:", response);
            }
            await updateActiveRescans(response, true);
            /*
	    if (typeof response !== "object" || typeof response.Status !== "object") {
                console.error("unexpected rescanstatus response:", response);
		resetRefreshTimer(ACTIVE_REFRESH_SECONDS);
	    } else {
		for (const [rescanId, rescanStatus] of Object.entries(response.Status)) {
		    updated[rescanId] = Object.assign({}, rescanStatus);
		}
		await updateActiveRescans({ Status: updated }, true);
	    }
	    */
        }
    } catch (e) {
        console.error(e);
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

async function updateDisplay(rescans = undefined) {
    try {
        if (rescans === undefined) {
            rescans = await config.session.get(config.session.key.activeRescans);
        }
        let rescansFound = false;
        let runningRescansFound = false;
        if (verbose) {
            console.log("updateDisplay:", rescans);
        }

        let ids = Object.keys(rescans).sort();
        for (const id of ids) {
            let rescan = rescans[id];
            rescansFound = true;
            if (rescan.Running) {
                runningRescansFound = true;
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
            if (rescan.Errors.length > 0) {
                errorIds.set(id, true);
                console.log("setting errorIds:", { errorIds });
                let content = "<details>\n";
                content += "<summary>Error Details</summary>\n";

                errorPanel.hidden = false;
                for (const error of Array.from(rescan.Errors)) {
                    content += `<p>Error: ${error.Message}<br>\n`;
                    for (const [key, value] of Object.entries(error.Headers)) {
                        content += `${key}: ${value}<br>\n`;
                    }
                    content += `Pathname: ${error.Pathname}</p>\n`;
                }
                content += "</details>";
                errorPanel.innerHTML = content;
                errorPanel.hidden = false;
            }
        }

        await removeExpiredElements(Array.from(Object.keys(rescans)));

        if (rescansFound) {
            resetRefreshTimer(runningRescansFound ? ACTIVE_REFRESH_SECONDS : INACTIVE_REFRESH_SECONDS);
        } else if (errorIds.size === 0) {
            console.log("rescan would close:", { rescansFound, errorIds });
            //window.close();
        }
    } catch (e) {
        console.error(e);
    }
}

async function removeExpiredElements(rescanIds) {
    try {
        for (const element of document.getElementsByClassName("progress")) {
            const item = element.parentElement;
            let itemRescanId = item.id.replace(/^item-/, "");
            if (verbose) {
                console.debug({ itemRescanId }, rescanIds.includes(itemRescanId));
            }
            if (rescanIds.includes(itemRescanId)) {
                // don't remove active rescans
                continue;
            }
            if (errorIds.has(itemRescanId) === true) {
                // don't remove rescans with errors
                continue;
            }
            rescanStack.removeChild(item);
        }
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

async function sendMessage(message) {
    try {
        message.src = "rescan";
        message.dst = "background";

        if (verbose) {
            console.debug("rescan.sendMessage:", message);
        }
        let result = await messenger.runtime.sendMessage(message);
        if (verbose) {
            console.debug("rescan.sendMessage returned:", result);
        }
        return result;
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
        if (verbose) {
            console.debug("storageChanged:", { changes, areaName });
        }
        if (areaName === "session") {
            let rescanChanges = changes[config.session.key.activeRescans];
            if (rescanChanges !== undefined) {
                await updateDisplay(rescanChanges.newValue);
            }
        }
    } catch (e) {
        console.error(e);
    }
}

window.addEventListener("load", onLoad);
window.addEventListener("beforeunload", onBeforeUnload);
window.addEventListener("DOMContentLoaded", onDOMContentLoaded);
document.getElementById("rescan-refresh-button").addEventListener("click", onRefreshClicked);
messenger.storage.onChanged.addListener(onStorageChanged);
messenger.runtime.onMessage.addListener(onMessage);
