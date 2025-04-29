import { config } from "./config.js";
import { accountDomain, differ, verbosity } from "./common.js";

/* globals messenger, console */

// control flags
const verbose = verbosity.domains;

///////////////////////////////////////////////////////////////////////////////
//
//  account data and selected account management
//
///////////////////////////////////////////////////////////////////////////////

export class Domains {
    constructor() {
        this.domains = undefined;
    }
    async init() {
        try {
            this.accountDomains = await this.all();

            if (typeof this.domains !== "object") {
                this.domains = {};
                for (const domain of this.accountDomains) {
                    this.domains[domain] = false;
                }
            }

            // read enabled domains from config
            let configDomains = await config.local.get(config.key.domain);

            // ensure the configDomains are a valid object
            if (typeof configDomains !== "object") {
                configDomains = {};
            }

            // update this.domains with any enabled found in config
            for (const domain of this.accountDomains) {
                let enabled = configDomains[domain];
                if (typeof enabled === "boolean") {
                    this.domains[domain] = enabled;
                }
            }

            // write any changes to config
            if (differ(configDomains, this.domains)) {
                await this.write();
            }
        } catch (e) {
            console.error(e);
        }
    }

    async write() {
        try {
            // sanity check domains
            for (const [k, v] of Object.entries(this.domains)) {
                if (typeof k !== "string" || typeof v !== "boolean" || !this.accountDomains.includes(k)) {
                    console.error("write: invalid domains:", this.domains);
                    throw new Error("invalid domains");
                }
            }
            // update local storage domains
            await config.local.set(config.key.domain, this.domains);
        } catch (e) {
            console.error(e);
        }
    }

    async refresh() {
        try {
            this.domains = undefined;
            await this.init();
        } catch (e) {
            console.error(e);
        }
    }

    async get(flags = {}) {
        try {
            if (flags.refresh === true) {
                this.domains = undefined;
            }
            await this.init();
            return this.domains;
        } catch (e) {
            console.error(e);
        }
    }

    async setAll(domains) {
        try {
            this.domains = Object.assign({}, domains);
            this.accountDomains = await this.all();
            await this.write();
        } catch (e) {
            console.error(e);
        }
    }

    async setEnabled(domain, enabled) {
        try {
            await this.init();
            if (!Object.hasOwn(this.domains, domain)) {
                throw new Error("invalid domain:" + domain);
            }
            enabled = enabled ? true : false;
            if (this.domains[domain] !== enabled) {
                this.domains[domain] = enabled;
                await this.write();
            }
        } catch (e) {
            console.error(e);
        }
    }

    async all() {
        try {
            let domains = {};
            for (const account of await messenger.accounts.list()) {
                if (account.type === "imap") {
                    domains[accountDomain(account)] = true;
                }
            }
            return Array.from(Object.keys(domains)).sort();
        } catch (e) {
            console.error(e);
        }
    }

    async enabled() {
        try {
            await this.init();
            const ret = [];
            for (const [domain, enabled] of Object.entries(this.domains)) {
                if (enabled) {
                    ret.push(domain);
                }
            }
            return ret.sort();
        } catch (e) {
            console.error(e);
        }
    }

    async isEnabled(domain) {
        try {
            const enabledDomains = await this.enabled();
            return enabledDomains.includes(domain);
        } catch (e) {
            console.error(e);
        }
    }
}

let domains = new Domains();

export async function getEnabledDomains() {
    try {
        const enabled = await domains.enabled();
        if (verbose) {
            console.debug("getEnabledDomains returning: ", enabled);
        }
        return enabled;
    } catch (e) {
        console.error(e);
    }
}
