import { config } from "./config.js";
import { accountDomain, verbosity } from "./common.js";

/* globals messenger, console */

// control flags
const verbose = verbosity.domains;

///////////////////////////////////////////////////////////////////////////////
//
//  account data and selected account management
//
///////////////////////////////////////////////////////////////////////////////

export class Domains {
    async init() {
        try {
            this.accounts = {};
            this.accountDomains = {};
            for (const account of await messenger.accounts.list()) {
                if (account.type === "imap") {
                    this.accounts[account.id] = account;
                    this.accountDomains[account.id] = accountDomain(account);
                }
            }
            if (typeof this.domains === "object" && Object.keys(this.domains).length > 0) {
                return;
            }
            this.domains = await config.local.get(config.key.domain);
            if (typeof this.domains !== "object" || Object.keys(this.domains).length < 1) {
                this.domains = {};
            }

            // ensure domains has a value for all accounts
            for (const account of Object.values(this.accounts)) {
                let domain = this.accountDomains[account.id];
                if (!Object.hasOwn(this.domains, domain)) {
                    this.domains[domain] = false;
                }
            }

            // remove any domains not in accountDomains
            let domainList = Object.keys(this.domains);
            for (const domain of domainList) {
                if (!Object.values(this.accountDomains).includes(domain)) {
                    delete this.domains[domain];
                }
            }

            await this.write();
        } catch (e) {
            console.error(e);
        }
    }

    async write() {
        try {
            await this.init();
            // sanity check domains
            for (const [k, v] of Object.entries(this.domains)) {
                if (typeof k !== "string" || typeof v !== "boolean" || !Object.values(this.accountDomains).includes(k)) {
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
            await this.write();
        } catch (e) {
            console.error(e);
        }
    }

    async setEnabled(domain, enabled) {
        try {
            await this.init();
            console.assert(Object.hasOwn(this.domains, domain));
            console.assert(typeof enabled === "boolean");
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
            await this.init();
            const ret = [];
            for (const domain of Object.keys(this.domains)) {
                ret.push(domain);
            }
            return ret.sort();
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
            const enabled = await this.enabled();
            return enabled.includes(domain);
        } catch (e) {
            console.error(e);
        }
    }
}

export async function getEnabledDomains() {
    try {
        const domains = new Domains();
        const enabled = domains.enabled();
        if (verbose) {
            console.debug("getEnabledDomains returning: ", enabled);
        }
        return enabled;
    } catch (e) {
        console.error(e);
    }
}
