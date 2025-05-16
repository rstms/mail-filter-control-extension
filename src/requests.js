import { getAccount } from "./accounts.js";
import { config } from "./config.js";
import { generateUUID } from "./common.js";
import { accountEmailAddress, accountDomain } from "./common.js";

/* global console, btoa, fetch */

export class Requests {
    constructor() {
        this.keys = null;
    }

    async readKeys() {
        try {
            if (this.keys === null) {
                this.keys = new Map();
            }
            let keys = await config.local.get(config.local.key.apiKeys);
            if (typeof keys === "object") {
                for (const [username, key] of Object.entries(keys)) {
                    this.keys.set(username, key);
                }
            }
        } catch (e) {
            console.error(e);
        }
    }

    async writeKeys() {
        try {
            await config.local.set(config.local.key.apiKeys, Object.fromEntries(this.keys.entries()));
        } catch (e) {
            console.error(e);
        }
    }

    async clearKeys() {
        try {
            this.keys = new Map();
        } catch (e) {
            console.error(e);
        }
    }

    async setKey(username, password) {
        try {
            const original = this.keys.get(username);
            const apiKey = btoa(`${username}:${password}`);
            if (apiKey !== original) {
                this.keys.set(username, apiKey);
                await this.writeKeys();
            }
        } catch (e) {
            console.error(e);
        }
    }

    async getKey(username) {
        try {
            if (this.keys === null || this.keys.has(username) === false) {
                await this.readKeys();
            }
            const apiKey = this.keys.get(username);
            if (typeof apiKey === "string" && apiKey.length > 0) {
                return apiKey;
            }
            throw new Error(`Invalid api key: ${username}`);
        } catch (e) {
            console.error(e);
        }
    }

    async request(accountId, path, options = {}, id = null) {
        try {
            const account = await getAccount(accountId);
            const username = accountEmailAddress(account);
            const domain = accountDomain(account);
            if (!id) {
                id = generateUUID();
            }
            if (!Object.hasOwn(options, "headers")) {
                options.headers = {};
            }
            options.headers["X-Api-Key"] = await this.getKey(username);
            options.headers["X-Request-Id"] = id;
            if (options.method === "POST") {
                options.headers["Content-Type"] = "application/json";
            }
            //let origin = await messenger.runtime.getURL("");
            //console.log("origin:", origin);
            options.credentials = "include";
            options.cache = "no-cache";
            options.mode = "cors";

            const url = `https://webmail.${domain}/mailfilter${path}`;

            console.log("<-- request:", url, options);
            const response = await fetch(url, options);
            console.log("--> response:", this.beautify(response));
            if (!response.ok) {
                throw new Error(`request failed: ${response}`);
            }
            const result = await response.json();
            console.log("result:", result);
            return result;
        } catch (e) {
            console.error(e);
        }
    }

    beautify(response) {
        try {
            const parsed = JSON.parse(response);
            return JSON.stringify(parsed, null, 2);
        } catch {
            return response;
        }
    }

    async get(accountId, path, id = null) {
        try {
            return await this.request(accountId, path, { method: "GET" }, id);
        } catch (e) {
            console.error(e);
        }
    }

    async post(accountId, path, body, id = null) {
        try {
            if (body === undefined || body === null) {
                body = {};
            }
            if (typeof body === "object") {
                body = JSON.stringify(body);
            } else {
                console.error("unexpected body type:", typeof body, { accountId, path, body, id });
                throw new Error("unexpected body type");
            }
            return await this.request(accountId, path, { method: "POST", body }, id);
        } catch (e) {
            console.error(e);
        }
    }
}
