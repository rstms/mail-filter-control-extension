import { verbosity, TICKS_PER_SECOND } from "./common.js";

/* global console, messenger, setTimeout, clearTimeout, setInterval, clearInterval */

const verbose = verbosity.display;

const defaults = {
    title: "Mail Filter",
    count: 0,
    total: 1,
    icon: "index",
    ticker: false,
    autoRemove: false,
    timeout: false,
};

function setActivityTicker(activity) {
    try {
        if (typeof activity.ticker === "number" && activity.ticker !== 0) {
            activity.tickerId = setInterval(() => {
                activity._tick();
            }, activity.ticker * TICKS_PER_SECOND);
        }
    } catch (e) {
        console.error(e);
    }
}

function setActivityTimeout(activity) {
    try {
        if (typeof activity.timeout === "number" && activity.timeout !== 0) {
            activity.timeoutId = setTimeout(() => {
                activity._timeout();
            }, activity.timeout * TICKS_PER_SECOND);
        }
    } catch (e) {
        console.error(e);
    }
}

function setActivityAutoremove(activity) {
    try {
        if (typeof activity.autoRemove === "number" && activity.autoRemove !== 0) {
            activity.autoremoveId = setTimeout(() => {
                activity.remove();
            }, activity.autoRemove * TICKS_PER_SECOND);
        }
    } catch (e) {
        console.error(e);
    }
}

class Activity {
    constructor() {
        this.id = null;
        this.tickerId = null;
        this.timeoutId = null;
        this.autoremoveId = null;
        this.isPending = false;
        this.parseOptions(defaults);
        this.context = {
            type: "mailfilter",
            title: "Mail Filter Control",
        };
    }

    parseOptions(options) {
        try {
            for (const [k, v] of Object.entries(options)) {
                if (v !== undefined) {
                    this[k] = v;
                }
            }
        } catch (e) {
            console.error(e);
        }
    }

    async addProcess(message, options = {}) {
        try {
            if (verbose) {
                console.log("addProcess:", message, options);
            }

            this.parseOptions(options);

            if (typeof this.ticker === "number" && this.ticker !== 0 && this.total === undefined) {
                // the caller set a ticker didn't specify a total and ticker is enabled, so use the timeout value for the total
                this.total = this.timeoutSeconds;
            }
            this.message = message;
            this.id = await messenger.activityManager.addProcess(this.title, this.message, this.total, {
                icon: this.icon,
                context: this.context,
                completed: this.count,
            });
            this.isPending = true;
            this.startTime = Date.now();
            setActivityTicker(this);
            setActivityTimeout(this);
            return this;
        } catch (e) {
            console.error(e);
        }
    }

    async remove() {
        try {
            if (verbose) {
                console.debug("remove:", this);
            }
            if (this.tickerId) {
                clearInterval(this.tickerId);
                this.tickerId = null;
            }
            if (this.timeoutId) {
                clearTimeout(this.timeoutId);
                this.timeoutId = null;
            }
            if (this.autoremoveId) {
                clearTimeout(this.autoremoveId);
                this.autoremoveId = null;
            }
            if (this.isPending) {
                await messenger.activityManager.updateProgress(this.id, this.message, this.total, { state: "completed" });
                this.isPending = false;
            }
            await messenger.activityManager.remove(this.id);
            this.id = null;
        } catch (e) {
            console.error(e);
        }
    }

    async addEvent(message, options = {}) {
        try {
            if (verbose) {
                console.log("addEvent:", message, options);
            }
            this.parseOptions(options);
            this.message = message;
            this.id = await messenger.activityManager.addEvent(this.title, message, { icon: this.icon, context: this.context });
            setActivityAutoremove(this);
        } catch (e) {
            console.error(e);
        }
    }

    async _timeout() {
        try {
            if (verbose) {
                console.debug("timeout:", this);
            }
            await this.remove();
            this.id = messenger.activityManager.addWarning(this.title, "Timeout: " + this.message, { context: this.context });
        } catch (e) {
            console.error(e);
        }
    }

    async _tick() {
        try {
            if (verbose) {
                console.debug("_tick:", this);
            }
            if (++this.count < this.total) {
                await messenger.activityManager.updateProgress(this.id, this.message, this.count);
            } else {
                await this._timeout();
            }
        } catch (e) {
            console.error(e);
        }
    }

    async complete(message, options = {}) {
        try {
            if (verbose) {
                console.log("complete:", message, options, this);
            }
            console.assert(this.isPending);
            await this.remove();
            await this.addEvent(message, options);
        } catch (e) {
            console.error(e);
        }
    }

    async fail(message, options = {}) {
        try {
            if (verbose) {
                console.log("fail:", message, options, this);
            }
            console.assert(this.isPending);
            await this.remove();
            this.id = messenger.activityManager.addWarning(this.title, "Failure: " + this.message, { context: this.context });
        } catch (e) {
            console.error(e);
        }
    }

    async update(message, count) {
        try {
            if (verbose) {
                console.log("update:", message, this);
            }
            if (typeof message !== "string") {
                throw new Error("message is not string");
            }
            if (typeof count !== "number") {
                throw new Error("count is not number");
            }
            if (!this.isPending) {
                throw new Error("cannot update: not a Progress activity");
            }
            this.message = message;
            this.count = count;
            await messenger.activityManager.updateProgress(this.id, this.message, this.count);
        } catch (e) {
            console.error(e);
        }
    }
}

export async function displayEvent(message, options = {}) {
    try {
        console.error("displayEvent called");
        let activity = new Activity();
        await activity.addEvent(message, options);
        return activity;
    } catch (e) {
        console.error(e);
    }
}

export async function displayProcess(message, count, total, options = {}) {
    try {
        console.error("displayProcess called");
        let activity = new Activity();
        options.count = count;
        options.total = total;
        await activity.addProcess(message, options);
        return activity;
    } catch (e) {
        console.error(e);
    }
}
