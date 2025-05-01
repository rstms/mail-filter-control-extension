import { differ, verbosity } from "./common.js";

/* globals console, messenger */

const verbose = verbosity.config;

const readback = true;

const READBACK_TRIES = 5;

const DEFAULTS = {
    editorTitle: "Mail Filter Control",
    rescanTitle: "Active Rescans",
    preferredTheme: "auto",
    optInApproved: false,
    domain: {},
    advancedTabVisible: false,
    autoDelete: true,
    filterctlCacheEnabled: true,
    autoClearConsole: false,
    minimizeCompose: true,
    backgroundSend: true,
};

class ConfigBase {
    constructor(storage, name, keys) {
        this.storage = storage;
        this.name = name;
        this.locked = false;
        this.waiting = [];
        this.key = {};
        for (const key of keys) {
            this.key[key] = key;
        }
    }

    validateKey(key) {
        if (!Object.keys(this.key).includes(key)) {
            let keys = String(Object.keys(this.key).join(", "));
            throw new Error(`${this.name} config key '${key}' not one of [${keys}]`);
        }
    }

    async lock() {
        try {
            while (this.locked) {
                await new Promise((resolve) => this.waiting.push(resolve));
            }
            this.locked = true;
        } catch (e) {
            console.error(e);
        }
    }

    unlock() {
        try {
            this.locked = false;
            if (this.waiting.length > 0) {
                const next = this.waiting.shift();
                next();
            }
        } catch (e) {
            console.error(e);
        }
    }

    async reset() {
        try {
            await this.lock();
            const current = await this.storage.get();
            var result = "(already empty)";
            if (Object.keys(current).length !== 0) {
                await this.storage.clear();
                result = "cleared";
            }
            await this.checkReadback("reset", undefined, undefined);
            if (verbose) {
                console.debug("reset:", this.name, result);
            }
        } catch (e) {
            console.error(e);
        } finally {
            this.unlock();
        }
    }

    async getBool(key, useDefaults = true) {
        try {
            return (await this.get(key, useDefaults)) ? true : false;
        } catch (e) {
            console.error(e);
        }
    }

    async getAll(useDefaults = true) {
        try {
            await this.lock();
            let value = await this.storage.get();
            if (this.name == "local" && useDefaults) {
                for (const [key, defaultValue] of Object.entries(DEFAULTS)) {
                    if (value[key] === undefined) {
                        value[key] = defaultValue;
                    }
                }
            }
            if (verbose) {
                console.debug("getAll returning:", this.name, value);
            }
            return value;
        } catch (e) {
            console.error(e);
        } finally {
            this.unlock();
        }
    }

    async get(key, useDefaults = true) {
        try {
            this.validateKey(key);
            await this.lock();
            const values = await this.storage.get([key]);
            var value = values[key];
            if (this.name === "local" && useDefaults) {
                if (value === undefined) {
                    // storage had no value, try default value
                    value = DEFAULTS[key];
                }
            }
            if (verbose) {
                console.debug("get returning:", this.name, key, value);
            }
            return value;
        } catch (e) {
            console.error(e);
        } finally {
            this.unlock();
        }
    }

    async checkReadback(action, key, expected) {
        try {
            if (verbose) {
                console.debug("checkReadback:", action, key, expected);
            }
            if (!readback) {
                console.debug("readback disabled");
                return;
            }

            for (let i = 0; i < READBACK_TRIES; i++) {
                if (key === undefined) {
                    const readback = await this.storage.get();
                    if (Object.keys(readback).length === 0) {
                        if (verbose) {
                            console.debug("readback success:", action);
                        }
                        return;
                    }
                } else {
                    const updated = await this.storage.get([key]);
                    const readback = updated[key];
                    if (!differ(readback, expected)) {
                        if (verbose) {
                            console.debug("readback success:", action, readback, expected);
                        }
                        return;
                    }
                    console.debug("readback mismatch:", {
                        retry: i + 1,
                        action: action,
                        key: key,
                        expected: expected,
                        readback: readback,
                    });
                }
                console.warn("readback mismatch: try:", i + 1);
            }
            throw new Error("config readback failed");
        } catch (e) {
            console.error(e);
        }
    }

    async setBool(key, value) {
        try {
            return await this.set(key, value ? true : false);
        } catch (e) {
            console.error(e);
        }
    }

    async set(key, value) {
        try {
            this.validateKey(key);
            await this.lock();
            if (verbose) {
                console.debug("set:", this.name, key, value);
            }
            const update = {};
            update[key] = value;
            await this.storage.set(update);
            await this.checkReadback("set", key, value);
        } catch (e) {
            console.error(e);
        } finally {
            this.unlock();
        }
    }

    async remove(key) {
        try {
            this.validateKey(key);
            await this.lock();
            if (verbose) {
                console.debug("remove:", this.name, key);
            }
            await this.storage.remove([key]);
            await this.checkReadback("remove", key, undefined);
        } catch (e) {
            console.error(e);
        } finally {
            this.unlock();
        }
    }
}

//persistent while extension installed
class ConfigLocal extends ConfigBase {
    constructor() {
        super(messenger.storage.local, "local", [
            // user configurable options
            "optInApproved",
            "domain",
            "autoDelete",
            "advancedTabVisible",
            "minimizeCompose",
            "backgroundSend",
            "filterctlCacheEnabled",

            // response data caches
            "usageResponse",
            "filterctlState",

            // internal state
            "addSenderTarget",
            "selectedAccount",

            // internal config
            "autoClearConsole",
            "emailResponseTimeout",
            "editorTitle",
            "rescanTitle",
            "preferredTheme",
        ]);
    }
}

// application execution lifetime
class ConfigSession extends ConfigBase {
    constructor() {
        super(messenger.storage.session, "session", [
            // background page state
            "initialized",
            "menuConfig",
            "messageDisplayActionAccountId",

            // rescan status
            "activeRescans",

            // auto-open on reload flags
            "autoOpenOptions",
            "autoOpenEditor",
        ]);
    }
}

export const config = {
    local: new ConfigLocal(),
    session: new ConfigSession(),
};

export async function updateActiveRescans(rescanResponse, prune = false) {
    try {
        if (typeof rescanResponse !== "object" || typeof rescanResponse.Status !== "object") {
            console.error("invalid rescanResponse:", rescanResponse);
            throw new Error("invalid rescanResponse");
        }
        let activeRescans = await config.session.get(config.session.key.activeRescans);
        if (typeof activeRescans !== "object") {
            activeRescans = {};
        }
        var updated = {};
        for (const [rescanId, rescanStatus] of Object.entries(rescanResponse.Status)) {
            updated[rescanId] = Object.assign({}, rescanStatus);
            activeRescans[rescanId] = Object.assign({}, rescanStatus);
        }
        if (prune) {
            activeRescans = updated;
        }
        await config.session.set(config.session.key.activeRescans, activeRescans);
    } catch (e) {
        console.error(e);
    }
}
