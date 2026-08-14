import { generateUUID, verbosity } from "./common.js";

/* global console, btoa, fetch, messenger */
const verbose = verbosity.requests;

export class Requests {
    constructor() {
        this.keys = null;
    }

    async request(accountId, path, options = {}, id = null) {
        let url = undefined;
        let response = undefined;
        let result = undefined;
        try {
            if (verbose) {
                let origin = await messenger.runtime.getURL("/");
                console.debug("origin:", origin);
            }
            if (!id) {
                id = generateUUID();
            }
            if (!Object.hasOwn(options, "headers")) {
                options.headers = {};
            }
            const account = await messenger.accountDetail.get(accountId);
            options.headers["X-Api-Key"] = btoa(`${account.email}:${account.password}`);
            options.headers["X-Request-Id"] = id;
            const method = options.method;
            if (method === "POST") {
                options.headers["Content-Type"] = "application/json";
            }
            options.credentials = "include";
            options.cache = "no-cache";
            options.mode = "cors";

            url = `https://webmail.${account.domain}:4443/mailfilter${path}`;
            if (verbose) {
                console.debug("<-- request:", method, url, options);
            }
            response = await fetch(url, options);
            if (verbose) {
                console.debug("--> response:", response);
            }
            if (!response.ok) {
                throw new Error(`request returned ${response.status} (${response.statusText})`);
            }
            result = await response.json();
            if (verbose) {
                console.log("result:", result);
            }
            if (!result || result === undefined) {
                throw new Error("response JSON decode failed");
            }
            return result;
        } catch (e) {
            if (options && options.headers && options.headers["X-Api-Key"]) {
                options.headers["X-Api-Key"] = "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
            }
            console.error(e, { url, accountId, path, id, options, response, result });
            await messenger.servicesPrompt.alert(
                "Mailfilter Control Panel",
                `Network request failed.  Please contact technical support.\n\n` +
                    `Request: ${options.method} ${url}\n` +
                    `Failure: ${e}\n` +
                    `Detail: ${JSON.stringify({ accountId, path, id, options }, null, 2)}\n`,
            );
            throw e;
        }
    }

    async get(accountId, path, id = null) {
        try {
            return await this.request(accountId, path, { method: "GET" }, id);
        } catch (e) {
            console.error(e);
        }
    }

    async put(accountId, path, id = null) {
        try {
            return await this.request(accountId, path, { method: "PUT" }, id);
        } catch (e) {
            console.error(e);
        }
    }

    async delete(accountId, path, id = null) {
        try {
            return await this.request(accountId, path, { method: "DELETE" }, id);
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

    resetBody(args) {
        try {
            let levels = [];
            for (let arg of args) {
                let fields = arg.split("=");
                levels.push({
                    Name: fields[0],
                    Score: parseFloat(fields[1]),
                });
            }
            return { Classes: levels };
        } catch (e) {
            console.error(e);
        }
    }
}
