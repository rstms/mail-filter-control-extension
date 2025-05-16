import { generateUUID, differ, verbosity, domainPart, accountEmailAddress, accountDomain } from "./common.js";
import { AsyncMap } from "./asyncmap.js";
import { config } from "./config.js";
import { getAccount } from "./accounts.js";
import { Requests } from "./requests.js";

/* global console, messenger, setTimeout, clearTimeout, setInterval, clearInterval, window */

// FIXME: remove compose window if message send fails
// FIXME: track the progress window
// FIXME: track the error message popup dialog when send fails

const verbose = verbosity.email;
const logQueue = false;

const REQUEST_TIMEOUT_SECONDS = 30;
const NO_TIMEOUT = 0;
const RESPONSE_EXPIRE_SECONDS = 10;
const RESPONSE_CHECK_INTERVAL = 1024;
const AUTO_DELETE_EXPIRE_SECONDS = 15;

// only consider last 24 hours for autodelete
const AUTODELETE_SEARCH_OFFSET_TICKS = 24 * 60 * 60 * 1000;

const moduleCID = "module-" + generateUUID();

class EmailRequest {
    constructor(controller, id, autoDelete, minimizeCompose, backgroundSend) {
        this.controller = controller;
        this.id = id;
        this.autoDelete = autoDelete;
        this.minimizeCompose = minimizeCompose;
        this.backgroundSend = backgroundSend;
        this.account = null;
        this.command = null;
        this.response = null;
        this.timer = null;
        this.resolvePromise = null;
        this.rejectPromise = null;
        if (verbose) {
            console.debug("New EmailRequest:", moduleCID, this.controller.CID, this.id);
        }
    }

    send(account, command, body, timeout = REQUEST_TIMEOUT_SECONDS) {
        if (verbose) {
            console.debug("send:", account, command, body, timeout, this);
        }
        return new Promise((resolve, reject) => {
            try {
                this.resolvePromise = resolve;
                this.rejectPromise = reject;
                this.account = account;
                this.command = command;
                if (body === undefined || body === null || body === "") {
                    this.body = "{}";
                } else if (typeof body === "string") {
                    this.body = body;
                } else {
                    this.body = JSON.stringify(body, null, 2);
                }

                if (timeout !== NO_TIMEOUT) {
                    this.timer = setTimeout(() => {
                        this.reject(new Error("request timeout:", this));
                    }, timeout * 1000);
                }

                this.controller.pendingRequests.set(this.id, this).then(() => {
                    if (verbose && logQueue) {
                        console.log("send: pushed to pendingRequests:", this.id, this);
                    }
                    this.controller.sendmail(this).then((sent) => {
                        if (verbose) {
                            console.debug("controller.sendmail returned:", sent);
                        }
                    });
                });
            } catch (e) {
                this.reject(e);
            }
        });
    }

    remove() {
        try {
            if (verbose) {
                console.debug("remove:", this);
            }

            if (this.timer) {
                clearTimeout(this.timer);
                this.timer = null;
            }

            this.controller.pendingRequests.pop(this.id).then((request) => {
                if (request) {
                    if (verbose && logQueue) {
                        console.log("remove: popped from pendingRequests:", this.id, request);
                    }
                    console.assert(this.id === request.id, "remove: sanity check failed: request id mismatch", this, request);
                }
                this.controller.pendingResponses.pop(this.id).then((response) => {
                    if (response) {
                        if (verbose && logQueue) {
                            console.log("remove: popped from pendingResponses:", this.id, response);
                        }
                        console.assert(
                            this.id === this.getBodyRequest(response),
                            "remove: sanity check failed: response id mismatches body request field",
                            this,
                            response,
                        );
                    }
                });
            });
        } catch (e) {
            console.error(e);
        }
    }

    reject(error) {
        console.warn("reject:", this);
        this.remove();
        this.rejectPromise(error);
    }

    // FIXME: remove parameters from resolve -- they are only for sanity checks
    resolve(request, response) {
        try {
            console.assert(this === request, "resolve: request not this", request, this);
            console.assert(!differ(response, this.response), "resolve: response differs from this.response", response, this.response);

            if (verbose) {
                console.debug("resolve:", this, this.response);
            }
            if (this.response) {
                // push this id to resolvedRequests for duplicate response detection
                this.controller.resolvedRequests.set(this.id, true).then(() => {
                    if (verbose && logQueue) {
                        console.log("resolve: pushed to resolvedRequests:", this.id, true);
                    }
                    this.remove();
                    this.resolvePromise(this.response);
                });
            } else {
                this.reject(new Error("resolved with null response", this));
            }
        } catch (e) {
            this.rejectPromise(e);
        }
    }
}

class EmailController {
    constructor() {
        try {
            this.CID = "controller-" + generateUUID();
            this.pendingRequests = new AsyncMap(); // active requests		    key: UUID	    value: EmailRequest
            this.pendingResponses = new AsyncMap(); // unmatched received responses	    key: requestId  value: response body data
            this.processedMessages = new AsyncMap(); // messages already processed	    key: Message-ID value: requestId
            this.resolvedRequests = new AsyncMap(); // requests already resolved	    key: requestID  value: bool
            this.autoDeleteState = new AsyncMap();

            if (verbose) {
                console.debug("New EmailController:", moduleCID, this.CID);
            }
        } catch (e) {
            console.error(e);
        }
    }

    async hasPendingActivity() {
        try {
            if ((await this.pendingRequests.size()) > 0) {
                return true;
            }
            if ((await this.pendingResponses.size()) > 0) {
                return true;
            }
            if ((await this.autoDeleteState.size()) > 0) {
                return true;
            }
            return false;
        } catch (e) {
            console.error(e);
        }
    }

    async startup() {
        try {
            this.responseCheckTimer = setInterval(() => {
                this.checkPending();
            }, RESPONSE_CHECK_INTERVAL);
            if (verbose) {
                console.debug("EmailController: startup", this.CID);
            }
        } catch (e) {
            console.error(e);
        }
    }

    async shutdown() {
        try {
            if (verbose) {
                console.debug("EmailController: shutdown", this.CID);
            }
            if (this.responseCheckTimer) {
                clearInterval(this.responseCheckTimer);
                this.responseCheckTimer = null;
            }
        } catch (e) {
            console.error(e);
        }
    }

    safeParseJSON(body) {
        try {
            return JSON.parse(body);
        } catch (e) {
            console.warn(e);
            return undefined;
        }
    }

    stripMessageId(messageId) {
        try {
            return messageId.replace(/^<|>$/g, "");
        } catch (e) {
            console.error(e);
        }
    }

    getBodyRequest(request) {
        try {
            var value = request.request;
            if (value === undefined) {
                value = request.Request;
            }
            return value;
        } catch (e) {
            console.error(e);
        }
    }

    async logQueueState(label) {
        try {
            const requests = await this.pendingRequests.size();
            const responses = await this.pendingResponses.size();
            const processed = await this.processedMessages.size();
            const resolved = await this.resolvedRequests.size();
            console.info(label, {
                module: moduleCID,
                email: this.CID,
                requests: requests,
                responses: responses,
                processed: processed,
                resolved: resolved,
                pendingRequests: await this.pendingRequests.keys(),
                pendingResponses: await this.pendingResponses.keys(),
                processedMessages: await this.processedMessages.keys(),
                resolvedRequests: await this.resolvedRequests.keys(),
            });
        } catch (e) {
            console.error(e);
        }
    }

    async checkPending() {
        try {
            const responseCount = await this.pendingResponses.size();

            // if there are outstanding requests or responses
            if (await this.hasPendingActivity()) {
                // keep the background page from suspending while we have pending activity
                await messenger.runtime.getBackgroundPage();
                if (verbose && logQueue) {
                    await this.logQueueState("checkPending:");
                }
            }

            if (responseCount > 0) {
                // check for pending messages with responses available, returning list of requests found
                const found = await this.pendingRequests.scan((key, value) => {
                    return this.checkPendingRequest(key, value);
                });
                for (const [requestId, request] of found.entries()) {
                    console.assert(
                        !(await this.pendingResponses.has(requestId)),
                        "checkPending: scan result requestId still present in this.pendingResponses",
                        requestId,
                        request,
                    );
                    request.resolve(request, request.response);
                }

                // delete pending responses for requests that have already been resolved
                const pendingResponseIds = await this.pendingResponses.keys();
                for (const responseId of pendingResponseIds) {
                    if (await this.resolvedRequests.has(responseId)) {
                        console.warn("deleting pending response for resolved request:", responseId);
                        await this.pendingResponses.pop(responseId);
                    }
                }

                // check for expired responses
                const expiredResponses = await this.pendingResponses.expire(RESPONSE_EXPIRE_SECONDS);
                for (const [responseId, response] of expiredResponses.entries()) {
                    console.error("checkPending: response expired:", responseId, response);
                    if (verbose && logQueue) {
                        console.log("checkPending: expired from this.pendingResponses:", responseId, response);
                    }
                    console.assert(
                        !(await this.pendingResponses.has(responseId)),
                        "responseId still found in this.pendingResponses after expire",
                        responseId,
                        response,
                    );
                }
            }

            // process autoDeletes
            const completedAutoDeletes = await this.autoDeleteState.scan((id, state) => {
                return this.processPendingAutoDelete(id, state);
            });
            for (const [id, state] of completedAutoDeletes.entries()) {
                if (verbose) {
                    console.debug("autoDelete completed:", id, state);
                }
            }

            // expire autoDeletes
            const expiredAutoDeletes = await this.autoDeleteState.expire(AUTO_DELETE_EXPIRE_SECONDS);
            for (const [id, state] of expiredAutoDeletes.entries()) {
                if (verbose) {
                    console.debug("autoDelete expired:", id, state);
                }
            }
        } catch (e) {
            console.error(e);
        }
    }

    async setAutoDeleteState(accountId, folder, state) {
        try {
            if (await config.local.getBool(config.local.key.autoDelete)) {
                await this.autoDeleteState.set(accountId + "_" + folder, { accountId, folder, state });
            }
        } catch (e) {
            console.error(e);
        }
    }

    async processPendingAutoDelete(id, autoDelete) {
        try {
            if (autoDelete.state === "clean") {
                return true;
            }
            let deleted = await this.autoDeleteScan(autoDelete.accountId, autoDelete.folder);
            switch (autoDelete.state) {
                case "dirty":
                    if (deleted > 0) {
                        if (verbose) {
                            console.debug("autoDelete:", id, "dirty->pending");
                        }
                        autoDelete.state = "pending";
                    }
                    break;
                case "pending":
                    if (deleted === 0) {
                        if (verbose) {
                            console.debug("autoDelete:", id, "pending->clean");
                        }
                        autoDelete.state = "clean";
                        return true;
                    }
                    break;
                default:
                    console.error("unexpected state:", autoDelete);
            }
            return false;
        } catch (e) {
            console.error(e);
        }
    }

    // When a pendingRequest has a matching pendingResponse:
    //  - pop the response from this.pendingResponses
    //  - set the response data in the request object
    //  - include the request in the scan return data
    //  Note: the scan function runs with a lock on the scanned AsyncMap
    async checkPendingRequest(requestId, request) {
        try {
            console.assert(requestId === request.id, "sanity check failed", requestId, request);
            const response = await this.pendingResponses.pop(requestId);
            if (response) {
                if (verbose && logQueue) {
                    console.log("checkPendingRequest: popped from this.pendingResponses:", requestId, response);
                }
                console.assert(
                    requestId === this.getBodyRequest(response),
                    "sanity check failed: requestId mismatches response body request field",
                    requestId,
                    request,
                    response,
                );
                if (verbose) {
                    console.debug("checkPendingRequest: response found, setting response in request");
                }
                request.response = response;
                return true;
            } else {
                return false;
            }
        } catch (e) {
            console.error(e);
        }
    }

    async minimizeComposeWindow(composer) {
        try {
            await messenger.windows.update(composer.windowId, { state: "minimized" });
        } catch (e) {
            console.error(e);
        }
    }

    async composeSendmail(request) {
        try {
            if (verbose) {
                console.debug("composeSendmail:", request);
            }
            const identity = request.account.identities[0];
            const domain = domainPart(identity.email);
            const msg = {
                identityId: identity.id,
                to: ["filterctl@" + domain],
                from: identity.name + " <" + identity.email + ">",
                subject: request.command,
                isPlainText: true,
                plainTextBody: request.body,
                customHeaders: [{ name: "X-Filterctl-Request-Id", value: request.id }],
            };

            const comp = await messenger.compose.beginNew();
            if (verbose) {
                console.debug("sendmail: comp:", comp);
            }

            if (request.minimizeCompose) {
                await this.minimizeComposeWindow(comp);
            }

            const details = await messenger.compose.getComposeDetails(comp.id);
            if (verbose) {
                console.debug("getComposeDetails:", details);
                console.debug("calling setComposeDetails:", comp.id, msg);
            }
            await messenger.compose.setComposeDetails(comp.id, msg);
            if (verbose) {
                console.debug("setComposeDetails returned");
                console.debug("calling sendMessage:", comp.id);
            }
            const sent = await messenger.compose.sendMessage(comp.id);
            if (verbose) {
                console.debug("sendMessage returned:", sent);
            }
            if (await config.local.getBool(config.local.key.autoDelete)) {
                for (const message of sent.messages) {
                    await this.deleteMessage(message);
                }
            }

            await this.checkPending();
            return sent;
        } catch (e) {
            console.error(e);
        }
    }

    async sendmail(request) {
        try {
            console.assert(await this.pendingRequests.has(request.id), "sanity check failed: id should be pending");

            if (!request.backgroundSend) {
                return await this.composeSendmail(request);
            }
            if (verbose) {
                console.debug("sendmail:", request);
            }

            const identity = request.account.identities[0];
            const domain = accountDomain(request.account);
            const recipient = "filterctl@" + domain;

            const message = {
                accountId: request.account.id,
                identityId: identity.id,
                to: recipient,
                from: `${identity.name} <${identity.email}>`,
                subject: `${request.command}`,
                body: `${request.body}`,
                headers: [{ key: "X-Filterctl-Request-Id", value: `${request.id}` }],
            };

            if (verbose) {
                console.debug("calling sendMail:", message);
            }
            const sent = await messenger.backgroundSend.sendMail(message);

            if (verbose) {
                console.debug("sendMail returned:", sent);
            }

            await this.checkPending();
            await this.setAutoDeleteState(request.account.id, "sent", "dirty");
            return sent;
        } catch (e) {
            console.error(e);
        }
    }

    isFilterctlMessage(folderType, filterctlAddress, message) {
        try {
            switch (folderType) {
                case "sent":
                    if (message.folder.path === "/Sent" && message.recipients[0] === filterctlAddress) {
                        return true;
                    } else {
                        console.error("Delete query found unexpected Sent message:", message);
                    }
                    break;
                case "inbox":
                    if (
                        message.folder.path === "/INBOX" &&
                        message.author === filterctlAddress &&
                        message.subject === "filterctl response"
                    ) {
                        return true;
                    } else {
                        console.error("Delete query found unexpected INBOX message:", message);
                    }
                    break;
            }
            return false;
        } catch (e) {
            console.error(e);
        }
    }

    async autoDeleteScan(accountId, folderType) {
        try {
            if (verbose) {
                console.debug("autoDeleteScan:", accountId, folderType);
            }
            if (!(await config.local.getBool(config.local.key.autoDelete))) {
                return;
            }
            let deletedCount = 0;
            const account = await getAccount(accountId);
            const email = accountEmailAddress(account);
            const domain = accountDomain(account);
            const filterctlAddress = "filterctl@" + domain;
            const currentDate = new Date();
            const startDate = new Date(currentDate.getTime() - AUTODELETE_SEARCH_OFFSET_TICKS);

            let folders = await messenger.folders.query({ accountId, specialUse: [folderType] });
            for (const folder of folders) {
                if (verbose) {
                    console.debug("Scanning folder:", email, filterctlAddress, folder.path);
                }
                let folderScanComplete = false;
                while (!folderScanComplete) {
                    let queryResult = undefined;
                    switch (folderType) {
                        case "sent":
                            queryResult = await messenger.messages.query({
                                accountId,
                                folderId: folder.id,
                                recipients: filterctlAddress,
                                fromMe: true,
                                fromDate: startDate,
                            });
                            break;
                        case "inbox":
                            queryResult = await messenger.messages.query({
                                accountId,
                                folderId: folder.id,
                                author: filterctlAddress,
                                toMe: true,
                                fromDate: startDate,
                            });
                            break;
                        default:
                            throw new Error(`unexpected autodelete folder type ${folderType}`);
                    }
                    let messagesToDelete = new Map();

                    let page = queryResult;
                    let messages = page.messages;
                    while (messages.length) {
                        for (const message of messages) {
                            if (this.isFilterctlMessage(folderType, filterctlAddress, message)) {
                                messagesToDelete.set(message.id, message);
                            }
                        }
                        if (page.id) {
                            page = await messenger.messages.continueList(page.id);
                            messages = page.messages;
                        } else {
                            // page has null id; there are no continued messages
                            break;
                        }
                    }

                    if (messagesToDelete.size > 0) {
                        deletedCount += messagesToDelete.size;
                        if (verbose) {
                            console.debug(
                                "Deleting filterctl messages:",
                                accountEmailAddress(account),
                                folder.path,
                                Array.from(messagesToDelete.values()),
                            );
                        }
                        await messenger.messages.delete(Array.from(messagesToDelete.keys()), true);
                    } else {
                        folderScanComplete = true;
                    }
                }
            }
            return deletedCount;
        } catch (e) {
            console.error(e);
        }
    }

    async getMessageBody(message) {
        try {
            const fullMessage = await messenger.messages.getFull(message.id);
            for (const part of fullMessage.parts) {
                if (part.contentType === "text/plain") {
                    const body = part.body;
                    if (verbose) {
                        console.debug("body:", body);
                    }
                    return body;
                }
            }
            throw new Error("failed to find message body:", message);
        } catch (e) {
            console.error(e);
        }
    }

    async getMessageHeaders(message) {
        try {
            const fullMessage = await messenger.messages.getFull(message.id);
            return fullMessage.headers;
        } catch (e) {
            console.error(e);
        }
    }

    async deleteMessage(message) {
        try {
            if (verbose) {
                console.debug("deleteMessage:", message.folder.id, message);
            }
            await messenger.messages.delete([message.id], true);
        } catch (e) {
            console.error(e);
        }
    }

    async receive(folder, messageList) {
        try {
            if (verbose) {
                console.debug("receive:", folder, messageList);
            }
            let count = 0;
            for (const message of messageList.messages) {
                if (verbose) {
                    console.debug("receive: message[" + count + "]:", message);
                }
                count++;
                if (message.subject === "filterctl response") {
                    const headers = await this.getMessageHeaders(message);
                    let requestId = null;
                    if (await this.processedMessages.has(message.headerMessageId)) {
                        let pmRequest = await this.processedMessages.get(message.headerMessageId);
                        let pmBody = await this.getMessageBody(message);
                        var pmResponse = this.safeParseJSON(pmBody);
                        if (verbose) {
                            console.debug("receive: Message-Id has been processed, discarding duplicate 'new' message:", {
                                processedMessagesKey: message.headerMessageId,
                                processedMessagesValue: pmRequest,
                                responseBody: pmResponse,
                                headers: headers,
                                message: message,
                            });
                        }
                        if (verbose && logQueue) {
                            await this.logQueueState("receive: Message-ID in this.processedMessages:");
                        }
                    } else {
                        // this header contains the message-id of the request email message
                        requestId = this.stripMessageId(headers["x-filterctl-request-id"][0]);
                        if (!requestId) {
                            console.error("filterctl response message has no requestId:", message, headers);
                        }
                    }

                    if (requestId) {
                        if (verbose) {
                            console.debug("receive: new response received:", {
                                requestId: requestId,
                                message: message,
                                headers: headers,
                            });
                        }

                        if (message.read) {
                            console.error("receive: message has already been read:", message);
                        }

                        var body = await this.getMessageBody(message);
                        var response = this.safeParseJSON(body);

                        console.assert(
                            this.getBodyRequest(response) === requestId,
                            "receive: response header mismatches body request field:",
                            {
                                requestID: requestId,
                                response: response,
                                message: message,
                                headers: headers,
                            },
                        );

                        // save this messageId for duplicate detection
                        await this.processedMessages.set(message.headerMessageId, requestId);
                        if (verbose && logQueue) {
                            console.log("receive: pushed to processedMessages:", message.headerMessageId, requestId);
                        }

                        let alreadyResolved = await this.resolvedRequests.get(requestId);
                        if (alreadyResolved === true) {
                            if (verbose) {
                                console.debug("receive: requestID has already been resolved, discarding 'new' message", {
                                    requestId: requestId,
                                    message: message,
                                    headers: headers,
                                    response: response,
                                });
                            }
                            if (verbose && logQueue) {
                                await this.logQueueState("receive: requestId in this.resolvedRequests:");
                            }
                        } else {
                            // not already resolved, check if there's a pending request
                            let request = await this.pendingRequests.get(requestId);
                            if (request !== undefined) {
                                if (verbose) {
                                    console.debug("receive: pending request found, resolving", requestId, request, response);
                                }
                                request.response = response;
                                request.resolve(request, response);
                            } else {
                                await this.pendingResponses.set(requestId, response);
                                if (verbose && logQueue) {
                                    console.log("receive: pushed to pendingResponses:", requestId, response);
                                }
                            }
                        }
                    }

                    // do a check without waiting for the timer
                    await this.checkPending();
                    await this.setAutoDeleteState(folder.accountId, "inbox", "dirty");
                }
            }
        } catch (e) {
            console.error(e);
        }
    }

    async sendEmailRequest(id, accountId, command, body = undefined, timeout = undefined) {
        try {
            if (verbose) {
                console.log("email.sendRequest:", { accountId, command, body, timeout });
            }
            const autoDelete = await config.local.getBool(config.local.key.autoDelete);
            const minimizeCompose = await config.local.getBool(config.local.key.minimizeCompose);
            const backgroundSend = await config.local.getBool(config.local.key.backgroundSend);
            const account = await getAccount(accountId);
            let request = new EmailRequest(this, id, autoDelete, minimizeCompose, backgroundSend);
            var ret = await request.send(account, command, body, timeout);
            if (verbose) {
                console.log("sendEmailRequest returning:", ret);
            }
            return ret;
        } catch (e) {
            console.error(e);
        }
    }

    async sendRequest(accountId, commandLine, body = undefined, timeout = undefined) {
        try {
            const id = generateUUID();
            let args = commandLine.split(" ");
            const command = args.shift();
            switch (command) {
                case "passwd":
                    break;
                case "dump":
                    return await this.cmdUserDump(id, accountId, command, args, body, timeout);
                case "reset":
                    break;
                case "restore":
                    break;
                case "mkaddr":
                    break;
                case "mkbook":
                    return await this.cmdAddBook(id, accountId, command, args, body, timeout);
                case "rmbook":
                    break;
                case "usage":
                    break;
                default:
                    console.error("unexpected command:", { accountId, command, body, timeout });
                    throw new Error(`unexpected command: ${command}`);
            }
            return await this.sendEmailRequest(id, accountId, commandLine, body, timeout);
        } catch (e) {
            console.error(e);
        }
    }

    async cmdUserDump(id, accountId, command, args, body, timeout) {
        try {
            const requests = new Requests();
            let result = await requests.get(accountId, "/userdump/", id);

            let commandLine = command + " " + args.join(" ");
            let emailResult = await this.sendEmailRequest(id, accountId, commandLine, body, timeout);

            console.log(differ(result, emailResult), { result, emailResult });
            return emailResult;
        } catch (e) {
            console.error(e);
        }
    }

    async cmdAddBook(id, accountId, command, args, body, timeout) {
        try {
            const requests = new Requests();
            let result = await requests.post(accountId, "/book/", { BookName: args[0] }, id);

            let commandLine = command + " " + args.join(" ");
            let emailResult = await this.sendEmailRequest(id, accountId, commandLine, body, timeout);

            console.log(differ(result, emailResult), { result, emailResult });
            return emailResult;
        } catch (e) {
            console.error(e);
        }
    }

    async onBeforeUnload() {
        try {
            await messenger.messages.onNewMailReceived.removeListener(this.receive);
        } catch (e) {
            console.error(e);
        }
    }
}

export const email = new EmailController();

async function receiver(folder, messageList) {
    await email.receive(folder, messageList);
}

async function onLoad() {
    console.warn("email loading");
    await email.startup();
    await messenger.messages.onNewMailReceived.addListener(receiver);
}

async function onBeforeUnload() {
    console.warn("email unloading");
    await messenger.messages.onNewMailReceived.removeListener(receiver);
    await email.shutdown();
}

window.addEventListener("load", onLoad);
window.addEventListener("beforeunload", onBeforeUnload);
