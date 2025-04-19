import { config } from "./config.js";
import { accountDomain, isValidAccountId, validateAccountId, verbosity } from "./common.js";
import { getEnabledDomains } from "./domains.js";

/* globals messenger, console */

// control flags
const verbose = verbosity.accounts;

///////////////////////////////////////////////////////////////////////////////
//
//  account data and selected account management
//
///////////////////////////////////////////////////////////////////////////////

export async function getAccounts() {
    try {
        let accounts = {};
        let domains = await getEnabledDomains();
        for (const account of await messenger.accounts.list()) {
            if (account.type === "imap") {
                if (domains.includes(accountDomain(account))) {
                    accounts[account.id] = account;
                }
            }
        }
        if (verbose) {
            console.debug("getAccounts returning:", accounts);
        }
        return accounts;
    } catch (e) {
        console.error(e);
    }
}

export async function isAccount(accountId) {
    try {
        if (!isValidAccountId(accountId)) {
            return false;
        }
        const accounts = await getAccounts();
        return Object.hasOwn(accounts, accountId);
    } catch (e) {
        console.error(e);
    }
}

export async function getAccount(accountId) {
    try {
        validateAccountId(accountId);
        const accounts = await getAccounts();
        if (!Object.hasOwn(accounts, accountId)) {
            throw new Error(`account not found: ${accountId}`);
        }
        return accounts[accountId];
    } catch (e) {
        console.error(e);
    }
}

export async function getSelectedAccount() {
    try {
        const accounts = await getAccounts();
        const selectedId = await config.local.get(config.key.selectedAccount);
        if (selectedId !== undefined && Object.hasOwn(accounts, selectedId)) {
            return accounts[selectedId];
        }
        for (const account of Object.values(accounts)) {
            console.warn(`selected account reset to ${account}`);
            await config.local.set(config.key.selectedAccount, account.id);
            return account;
        }
        console.warn("no enabled account exists");
    } catch (e) {
        console.error(e);
    }
}

export async function selectAccount(accountId) {
    try {
        const account = await getAccount(accountId);
        await config.local.set(config.key.selectedAccount, account.id);
    } catch (e) {
        console.error(e);
    }
}
