import { generateUUID, verbosity } from "./common.js";

/* global console, setTimeout, clearTimeout */

const PORT_CONNECT_TIMEOUT = 3000;

const verbose = verbosity.ports;

export const WAIT = 0;
export const NO_WAIT = 1;
export const WAIT_FOREVER = 2;

export let connectedPorts = new Map();
export let connectedPortLabels = new Map();

let portWaiters = {};

export function get(name, waitMode = WAIT, timeout = PORT_CONNECT_TIMEOUT) {
    return new Promise((resolve, reject) => {
        try {
            if (waitMode === NO_WAIT) {
                let port = connectedPorts.get(name);
                if (port === undefined) {
                    port = connectedPortLabels.get(name);
                }
                resolve(port);
            } else {
                const id = generateUUID();
                var timer = null;
                if (waitMode === WAIT && timeout !== 0) {
                    timer = setTimeout(() => {
                        delete portWaiters[id];
                        reject(new Error("port connection timeout", name));
                    }, timeout);
                }
                portWaiters[id] = {
                    id: id,
                    name: name,
                    resolve: resolve,
                    reject: reject,
                    timer: timer,
                };
            }
        } catch (e) {
            reject(e);
        }
    });
}

const ADD_PORT = 1;
const REMOVE_PORT = 2;

function manage(port, op) {
    try {
        for (const [id, waiter] of Object.entries(portWaiters)) {
            if (waiter.name === port.name || waiter.name === portLabel(port)) {
                clearTimeout(waiter.timer);
                delete portWaiters[id];
                switch (op) {
                    case ADD_PORT:
                        waiter.resolve(port);
                        break;
                    case REMOVE_PORT:
                        waiter.reject(new Error("port removed: " + port.name));
                        break;
                    default:
                        throw new Error(`unexpected op: ${op}`);
                }
            }
        }
    } catch (e) {
        console.error(e);
    }
}

export function portLabel(port) {
    try {
        if (verbose) {
            console.debug("portLabel:", port);
        }
        let label = port.name.replace(/-.*$/g, "");
        if (verbose) {
            console.debug("portLabel returning:", label);
        }
        return label;
    } catch (e) {
        console.error(e);
    }
}

export function add(port) {
    try {
        if (verbose) {
            console.debug("add:", port);
        }
        connectedPorts.set(port.name, port);
        connectedPortLabels.set(portLabel(port), port);
        return manage(port, ADD_PORT);
    } catch (e) {
        console.error(e);
    }
}

export function remove(port) {
    try {
        if (verbose) {
            console.debug("remove:", port);
        }
        connectedPorts.delete(port.name);
        connectedPortLabels.delete(portLabel(port));
        return manage(port, REMOVE_PORT);
    } catch (e) {
        console.error(e);
    }
}
