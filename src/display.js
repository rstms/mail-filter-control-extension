import { verbosity } from "./common.js";

/* global console, messenger, setTimeout, clearTimeout, setInterval, clearInterval */

const verbose = verbosity.display;

const TICKS_PER_SECOND = 1000;

const defaults = {
    title: "Mail Filter",
    count: 0,
    total: 1,
    icon: "index",
    ticker: true,
    tickerSeconds: 1,
    autoRemove: true,
    autoRemoveSeconds: 5,
    timeout: true,
    timeoutSeconds: 10,
};

function setActivityTicker(activity) {
    try {
        if (activity.ticker && activity.tickerSeconds !== 0) {
            activity.tickerId = setInterval(() => {
                activity._tick();
            }, activity.tickerSeconds * TICKS_PER_SECOND);
        }
    } catch (e) {
        console.error(e);
    }
}

function setActivityTimeout(activity) {
    try {
        if (activity.timeout && activity.timeoutSeconds !== 0) {
            activity.timeoutId = setTimeout(() => {
                activity._timeout();
            }, activity.timeoutSeconds * TICKS_PER_SECOND);
        }
    } catch (e) {
        console.error(e);
    }
}

function setActivityAutoremove(activity) {
    try {
        if (activity.autoRemove && activity.autoRemoveSeconds !== 0) {
            activity.autoremoveId = setTimeout(() => {
                console.log("AUTOREMOVE");
                activity.remove();
            }, activity.autoRemoveSeconds * TICKS_PER_SECOND);
        }
    } catch (e) {
        console.error(e);
    }
}

class Activity {
    constructor() {
        this.tickerId = null;
        this.timeoutId = null;
        this.arutoremoveId = null;
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

            let callerSetTotal = Object.hasOwn(options, "total");

            this.parseOptions(options);

            if (callerSetTotal) {
                // if caller set the total disable the timer tick, the caller will update for each item
                this.ticker = false;
            } else if (this.ticker) {
                // the caller didn't specify a total and ticker is enabled, so use the timeout value for the total
                this.total = this.timeoutSeconds;
            }
            this.message = message;
            this.id = await messenger.activityManager.addProcess(this.title, this.message, this.total, {
                icon: this.icon,
                context: this.context,
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

    async update(message, options = {}) {
        try {
            if (verbose) {
                console.log("update:", message, options, this);
            }
            console.assert(this.isPending);
            let count = options.count;
            if (count === undefined) {
                count = ++this.count;
            }
            this.parseOptions(options);
            this.count = count;
            await messenger.activityManager.updateProgress(this.id, this.message, this.count, { total: this.total });
        } catch (e) {
            console.error(e);
        }
    }
}

export async function displayEvent(message) {
    try {
        let activity = new Activity();
        await activity.addEvent(message);
        return activity;
    } catch (e) {
        console.error(e);
    }
}

export async function displayProcess(message) {
    try {
        let activity = new Activity();
        await activity.addProcess(message);
        return activity;
    } catch (e) {
        console.error(e);
    }
}
