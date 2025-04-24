import { verbosity, generateUUID } from "./common.js";
import { config } from "./config.js";

/* globals console, document, messenger, setInterval, window */

const verbose = verbosity.rescan;

let hasLoaded = false;
let backgroundSuspended = false;

const TICK_INTERVAL = 1000;
let tickCount = 0;

// connection state vars
let port = null;
let backgroundCID = null;
const rescanCID = "rescan-" + generateUUID();

let ticker = null;

async function initialize() {
    try {
        console.log("rescan initialize");
        if (!ticker) {
            setInterval(onTick, TICK_INTERVAL);
        }
    } catch (e) {
        console.error(e);
    }
}

async function onTick() {
    try {
        tickCount++;
        if (tickCount % 60 === 0) {
            console.log("rescan.onTick:", ++tickCount);
        }
    } catch (e) {
        console.error(e);
    }
}

async function checkRescanStatus() {
    try {
        let activeRescans = await config.session.get(config.key.activeRescans);
        if (typeof activeRescans !== "object") {
            activeRescans = {};
        }
        for (const [rescanId, rescan] of Object.entries(activeRescans)) {
            const response = await sendMessage({
                id: "sendCommand",
                accountId: rescan.accountId,
                command: "rescanstatus",
                argument: rescanId,
            });
            rescan.status = response;
        }
        await config.session.set(config.key.activeRescans, activeRescans);
        console.log("activeRescans:", activeRescans);
    } catch (e) {
        console.error(e);
    }
}

async function newRescan(message) {
    try {
        console.log("newRescan:", message);
    } catch (e) {
        console.error(e);
    }
}

///////////////////////////////////////////////////////////////////////////////
//
//  messages handlers
//
///////////////////////////////////////////////////////////////////////////////

async function connect() {
    try {
        console.log("connect:", { port, backgroundCID, backgroundSuspended });
        if (port === null) {
            if (verbose) {
                console.debug("rescan: requesting background page...");
            }
            const background = await messenger.runtime.getBackgroundPage();
            if (verbose) {
                console.debug("background: page:", { url: background, suspended: backgroundSuspended });
            }

            if (verbose) {
                console.log("rescan connecting to background as:", rescanCID);
            }
            port = await messenger.runtime.connect({ name: rescanCID });
            port.onMessage.addListener(onPortMessage);
            port.onDisconnect.addListener(onDisconnect);
            if (verbose) {
                console.debug("rescan: connection pending on port:", port);
            }
        }
    } catch (e) {
        console.error(e);
    }
}

async function disconnect() {
    try {
        if (port !== null) {
            if (verbose) {
                console.debug("rescan: disconnecting");
            }
            await port.disconnect();
        }
    } catch (e) {
        console.error(e);
    }
}

async function onPortMessage(message, sender) {
    try {
        if (verbose) {
            console.debug("rescan.onPortMessage:", message, sender);
        }
        let ret = undefined;
        switch (message.id) {
            case "ENQ":
                if (message.dst !== rescanCID) {
                    throw new Error("destination CID mismatch");
                }
                backgroundCID = message.src;
                if (verbose) {
                    console.debug("rescan: set background CID:", backgroundCID);
                }
                ret = await messenger.runtime.sendMessage({ id: "ACK", src: rescanCID, dst: backgroundCID });
                if (verbose) {
                    console.debug("rescan: our ACK returned:", ret);
                }
                console.log("rescan connected to:", backgroundCID);

                // complete initialization now that we're connected to the background page
                await initialize();
                break;
            default:
                await onMessage(message, sender);
                break;
        }
    } catch (e) {
        console.error(e);
    }
}

async function onMessage(message, sender) {
    try {
        if (verbose) {
            console.debug("rescan.onMessage:", message, sender);
        }

        // process messages allowed without connection
        switch (message.id) {
            case "backgroundActivated":
                backgroundSuspended = false;
                console.log(message.id, { backgroundSuspended });
                return;
            case "backgroundSuspendCanceled":
                backgroundSuspended = false;
                console.log(message.id, { backgroundSuspended });
                return;
            case "backgroundSuspending":
                backgroundSuspended = true;
                console.log(message.id, { backgroundSuspended });
                return;
        }

        if (backgroundCID === null) {
            console.error("not connected, discarding:", message);
            return;
        }

        if (message.src === undefined || message.dst === undefined) {
            console.debug("missing src/dst, discarding:", message);
            return;
        }

        if (message.src !== backgroundCID) {
            console.error("unexpected src ID, discarding:", message);
            return;
        }

        if (message.dst !== rescanCID) {
            console.log("dstID mismatch, discarding:", message);
            return;
        }

        let response = undefined;

        switch (message.id) {
            case "newRescan":
                await newRescan(message);
                break;

            default:
                console.error("unknown message ID:", message);
                break;
        }

        if (response !== undefined) {
            if (typeof response !== "object") {
                response = { response: response };
            }
            if (verbose) {
                console.debug("rescan.onMessage: sending response:", response);
            }
        }
        return response;
    } catch (e) {
        console.error(e);
    }
}

async function onDisconnect(port) {
    try {
        port = null;
        backgroundCID = null;
        if (verbose) {
            console.log("rescan.onDisconnect:", { port, backgroundCID, backgroundSuspended });
        }
    } catch (e) {
        console.error(e);
    }
}

async function sendMessage(message) {
    try {
        if (verbose) {
            console.log("rescan.sendMessage:", { port, backgroundCID, backgroundSuspended });
        }

        if (typeof message === "string") {
            message = { id: message };
        }
        message.src = rescanCID;
        message.dst = backgroundCID;
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

////////////////////////////////////////////////////////////////////////////////
//
//  DOM event handlers
//
////////////////////////////////////////////////////////////////////////////////

async function onLoad() {
    try {
        document.title = await config.local.get(config.key.rescanTitle);
        if (verbose) {
            console.debug("rescan page loading");
        }

        if (hasLoaded) {
            throw new Error("redundant load event");
        }
        hasLoaded = true;

        if (verbose) {
            console.debug("editor page loaded");
        }

        await connect();
    } catch (e) {
        console.error(e);
    }
}

async function onUnload() {
    try {
        await disconnect();
    } catch (e) {
        console.error(e);
    }
}

// handler for runtime broadcast messages
messenger.runtime.onMessage.addListener(onMessage);

// DOM event handlers
window.addEventListener("load", onLoad);
window.addEventListener("beforeunload", onUnload);

document.getElementById("rescan-status-button").addEventListener("click", checkRescanStatus);
