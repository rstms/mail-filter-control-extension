/* global console */

export const TICKS_PER_SECOND = 1000;

export const verbosity = {
    accounts: false,
    background: false,
    config: false,
    display: false,
    editor: false,
    email: false,
    filterctl: false,
    ports: false,
    rescan: false,
    tab_advanced: false,
    tab_books: false,
    tab_classes: false,
    tab_help: false,
    tab_options: false,
};

export function generateUUID() {
    try {
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
            const r = (Math.random() * 16) | 0; // Generate a random number between 0 and 15
            return (c === "x" ? r : (r & 0x3) | 0x8).toString(16); // Convert to hexadecimal
        });
    } catch (e) {
        console.error(e);
    }
}

export function domainPart(text) {
    try {
        if (text === undefined) {
            text = "";
        }
        text = String(text);
        return text.replace(/^[^@]*@*/, "");
    } catch (e) {
        console.error(e);
    }
}

export function differ(original, current) {
    try {
        if (original === current) {
            return false;
        }
        if (original == null || current == null || typeof original !== "object" || typeof current !== "object") {
            return true;
        }

        const originalKeys = Object.keys(original);
        const currentKeys = Object.keys(current);

        if (originalKeys.length !== currentKeys.length) {
            return true;
        }

        for (const key of originalKeys) {
            if (!(key in original)) {
                return true;
            }

            const originalValue = original[key];
            const currentValue = current[key];

            if (Array.isArray(originalValue) && Array.isArray(currentValue)) {
                if (
                    originalValue.length !== currentValue.length ||
                    originalValue.some((item, index) => differ(item, currentValue[index]))
                ) {
                    return true;
                }
            } else if (typeof OriginalValue === "object" || typeof currentValue === "object") {
                if (differ(originalValue, currentValue)) {
                    return true;
                }
            } else if (originalValue !== currentValue) {
                return true;
            }
        }
        return false;
    } catch (e) {
        console.error(e);
    }
}

// NOTE: call only from editor.js, classes_tab.js, or books_tab.js
export function selectedAccountId(accountSelect) {
    try {
        const index = accountSelect.selectedIndex;
        const selectedOption = accountSelect.options[index];
        return selectedOption.getAttribute("data-account-id");
    } catch (e) {
        console.error(e);
    }
}

export function selectedAccountEmailAddress(accountSelect) {
    try {
        const index = accountSelect.selectedIndex;
        const selectedOption = accountSelect.options[index];
        return selectedOption.getAttribute("data-account-id");
    } catch (e) {
        console.error(e);
    }
}

export function accountEmailAddress(account) {
    try {
        validateAccount(account);
        return account.identities[0].email;
    } catch (e) {
        console.error(e);
    }
}

export function accountDomain(account) {
    try {
        return domainPart(accountEmailAddress(account));
    } catch (e) {
        console.error(e);
    }
}

export function deepCopy(obj) {
    try {
        //console.debug("deepCopy:", obj);
        if (obj === undefined) {
            console.warn("deepCopy undefined");
        }
        const json = JSON.stringify(obj);
        //console.debug("deepCopy parsed:", json);
        const result = JSON.parse(json);
        //console.debug("deepCopy returning:", result);
        if (differ(obj, result)) {
            console.error("deepCopy result differs:", obj, result);
            throw new Error("deepCopy result differs");
        }
        return result;
    } catch (e) {
        console.error(e);
    }
}

export function isValidEmailAddress(address) {
    try {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (typeof address !== "string") {
            return false;
        }
        return emailRegex.test(address);
    } catch (e) {
        console.error(e);
    }
}

export function isValidBookName(name) {
    try {
        const bookNameRegex = /^[a-zA-Z][a-zA-Z0-9\\._-]*$/;
        if (typeof name !== "string") {
            return false;
        }
        return bookNameRegex.test(name);
    } catch (e) {
        console.error(e);
    }
}

// weakly validate a potential accountId
export function isValidAccountId(accountId) {
    return typeof accountId === "string";
}

// throw an error if the accountId is bad
export function validateAccountId(accountId) {
    if (!isValidAccountId(accountId)) {
        throw new Error(`invalid accountId: ${accountId}`);
    }
}

// return true if the account looks like an account object
export function isValidAccount(account) {
    return typeof account === "object" && typeof account.id === "string" && Array.isArray(account.identities);
}

// throw an error if the account doesn't look like one
export function validateAccount(account) {
    if (!isValidAccount(account)) {
        throw new Error(`invalid account: {$account}`);
    }
}

export function timestamp() {
    return new Date().toISOString();
}
