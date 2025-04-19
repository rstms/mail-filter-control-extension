import { initThemeSwitcher } from "./theme_switcher.js";
import { config } from "./config.js";
import { differ, accountEmailAddress, verbosity } from "./common.js";
import { ClassesTab } from "./tab_classes.js";
import { BooksTab } from "./tab_books.js";
import { OptionsTab } from "./tab_options.js";
import { AdvancedTab } from "./tab_advanced.js";
import { HelpTab } from "./tab_help.js";
import { generateUUID } from "./common.js";
import { getAccount, getAccounts, getSelectedAccount } from "./accounts.js";

// FIXME: add refresh command to filterctl to get classes, books,  account data in one filterctl response

// FIXME: implement all element event listeners here and call functions on tab objects
// FIXME: share controls container between this page and all tab objects

/* globals messenger, window, document, console, MutationObserver */
const verbose = verbosity.editor;

//const disconnectOnBackgroundSuspend = false;

initThemeSwitcher();

let hasLoaded = false;
let backgroundSuspended = false;
let usagePopulated = false;
let accountsPopulated = false;

let activeTab = "classes";

// map between select element index and accountId
let accountIndex = {};

// connection state vars
let port = null;
let backgroundCID = null;
const editorCID = "editor-" + generateUUID();

let controls = {};

let tab = {
    classes: new ClassesTab(disableEditorControl, sendMessage, enableTab, {
        InputKeypress: onClassesInputKeypress,
        NameChanged: onClasessNameChanged,
        SliderMoved: onClassesSliderMoved,
        ScoreChanged: onClassesScoreChanged,
        CellDelete: onClassesCellDelete,
        CellInsert: onClassesCellInsert,
    }),
    books: new BooksTab(disableEditorControl, sendMessage, {
        ConnectionChanged: onBooksConnectionChanged,
    }),
    options: new OptionsTab(sendMessage, { DomainCheckboxChange: onOptionsDomainCheckboxChange }),
    advanced: new AdvancedTab(sendMessage),
    help: new HelpTab(sendMessage),
};

////////////////////////////////////////////////////////////////////////////////
//
//  selected account init
//
////////////////////////////////////////////////////////////////////////////////

// called from the background page message handler
async function populateAccounts() {
    try {
        if (verbose) {
            console.debug("BEGIN populateAccounts");
        }

        if (accountsPopulated) {
            return;
        }

        if (Object.keys(await getAccounts()).length < 1) {
            await enableTab("options", true);
            await selectTab("options");
            return;
        }

        const accounts = await getAccounts();
        const selectedAccount = await getSelectedAccount();

        // disable the select controls while updating
        await enableAccountControls(false);

        // clear account select contents
        tab.classes.controls.accountSelect.innerHTML = "";
        tab.books.controls.accountSelect.innerHTML = "";
        tab.advanced.controls.selectedAccount.value = "";

        // initialize the select control dropdown lists
        if (verbose) {
            console.debug("editor.populateAccounts:", { accounts, selectedAccount });
        }

        let i = 0;
        accountIndex = {};
        for (let [id, account] of Object.entries(accounts)) {
            if (verbose) {
                console.debug({ i, id, account });
            }
            accountIndex[id] = i;
            accountIndex[i] = id;
            addAccountSelectRow(tab.classes.controls.accountSelect, id, accountEmailAddress(account));
            addAccountSelectRow(tab.books.controls.accountSelect, id, accountEmailAddress(account));
            i++;
        }

        await updateAccountControls(selectedAccount.id);

        // enable the tabs
        await enableTab("classes", true);
        await enableTab("books", true);
        await enableTab("options", true);
        await enableTab("advanced", true);
        await enableTab("help", true);

        accountsPopulated = true;

        if (verbose) {
            console.debug("END populateAccountSelect", { accounts, selectedAccount });
        }
    } catch (e) {
        console.error(e);
    }
}

function addAccountSelectRow(control, id, name) {
    try {
        const option = document.createElement("option");
        option.setAttribute("data-account-id", id);
        option.textContent = name;
        if (verbose) {
            console.debug("addAccountSelectRow:", control, id, name);
        }
        control.appendChild(option);
    } catch (e) {
        console.error(e);
    }
}

////////////////////////////////////////////////////////////////////////////////
//
//  selected account control functions
//
////////////////////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////////////////////
//
// updateAccountControls:   set the account controls elements state
//		    to synchronize the selected account when changed
//
// callers:
//  - populateAccounts - the select controls have been (re)initialized
//  - onAccountSelectChange - one of the select controls has been changed
//  - handleUpdateEditorSelectedAccount - background page sent setSelectedAccount message
//
////////////////////////////////////////////////////////////////////////////////

async function updateAccountControls(accountId) {
    try {
        if (verbose) {
            console.debug("updateAccountControls:", accountId);
        }
        let account = await getAccount(accountId);
        let index = accountIndex[accountId];
        if (index === undefined) {
            console.error("updateAccountControls: unknown accountId:", accountId);
            throw new Error("unknown account");
        }

        // classes
        tab.classes.controls.accountSelect.selectedIndex = index;
        await tab.classes.selectAccount(accountId);

        // books
        tab.books.controls.accountSelect.selectedIndex = index;
        await tab.books.selectAccount(accountId);

        // advanced
        await tab.advanced.selectAccount(accountId);

        if (verbose) {
            console.log("updateAccountControls:", accountEmailAddress(account));
        }
        return true;
    } catch (e) {
        console.error(e);
    }
}

////////////////////////////////////////////////////////////////////////////////
//
// event handlers
//
// handle classes and books select control changed events
//
// event emitters:
//  - tab.classes.controls.accountSelect
//  - tab.books.controls.accountSelect
//
////////////////////////////////////////////////////////////////////////////////
async function onAccountSelectChange(sender) {
    try {
        const index = sender.target.selectedIndex;
        if (verbose) {
            console.debug("onAccountSelectChange:", index, sender.target.id);
        }
        if (sender.target === tab.classes.controls.accountSelect || sender.target === tab.books.controls.accountSelect) {
            const accountId = accountIndex[index];
            await updateAccountControls(accountId);
        } else {
            throw new Error("onAccountSelectChange: unexpected event sender:", sender);
        }
    } catch (e) {
        console.error(e);
    }
}

////////////////////////////////////////////////////////////////////////////////
//
//  tab management
//
////////////////////////////////////////////////////////////////////////////////

function getTabControls(name) {
    try {
        var tab = null;
        var link = null;
        var navlink = null;
        switch (name) {
            case "classes":
                tab = controls.classesTab;
                link = controls.classesTabLink;
                navlink = controls.classesNavLink;
                break;
            case "books":
                tab = controls.booksTab;
                link = controls.booksTabLink;
                navlink = controls.booksNavLink;
                break;
            case "options":
                tab = controls.optionsTab;
                link = controls.optionsTabLink;
                navlink = controls.optionsNavLink;
                break;
            case "advanced":
                tab = controls.advancedTab;
                link = controls.advancedTabLink;
                navlink = controls.advancedNavLink;
                break;
            case "help":
                tab = controls.helpTab;
                link = controls.helpTabLink;
                navlink = controls.helpNavLink;
                break;
            default:
                throw new Error("unknown tab: " + name);
        }
        return { tab: tab, link: link, navlink: navlink };
    } catch (e) {
        console.error(e);
    }
}

function enableTab(name, enabled) {
    try {
        const tabControls = getTabControls(name);

        tabControls.link.disabled = !enabled;
        if (enabled) {
            tabControls.navlink.classList.remove("disabled");
        } else {
            tabControls.navlink.classList.add("disabled");
        }
        if (verbose) {
            console.log(enabled ? "enabled tab: " : "disabled tab:", {
                tabId: tabControls.tab.id,
                link: tabControls.link.id,
                navLink: tabControls.navlink.id,
            });
        }
    } catch (e) {
        console.error(e);
    }
}

async function onTabShow(sender) {
    try {
        if (verbose) {
            console.debug("handleTabShow:", sender);
        }
        let cancelVisible = false;
        let applyVisible = false;
        let okButtonText = "Close";
        switch (sender.srcElement) {
            case controls.classesNavLink:
                activeTab = "classes";
                await tab.classes.populate();
                cancelVisible = true;
                applyVisible = true;
                okButtonText = "Ok";
                break;
            case controls.booksNavLink:
                activeTab = "books";
                await tab.books.populate();
                break;
            case controls.optionsNavLink:
                activeTab = "options";
                await tab.options.populate();
                break;
            case controls.advancedNavLink:
                activeTab = "advanced";
                await populateUsageControls();
                break;
            case controls.helpNavLink:
                activeTab = "help";
                await populateUsageControls();
                break;
        }
        if (verbose) {
            console.log("active tab:", activeTab);
        }
        controls.cancelButton.hidden = !cancelVisible;
        controls.applyButton.hidden = !applyVisible;
        controls.okButton.textContent = okButtonText;
    } catch (e) {
        console.error(e);
    }
}

async function setAdvancedTabVisible(visible = undefined) {
    try {
        if (visible === undefined) {
            visible = await config.local.getBool(config.key.advancedTabVisible);
        }
        controls.advancedTab.hidden = !visible;
        controls.advancedTabLink.hidden = !visible;
        tab.options.controls.advancedTabVisible.checked = visible;
    } catch (e) {
        console.error(e);
    }
}

////////////////////////////////////////////////////////////////////////////////
//
//  populate advanced / help controls
//
////////////////////////////////////////////////////////////////////////////////

async function populateUsageControls() {
    try {
        if (!usagePopulated) {
            tab.advanced.setStatus("Updating commands...");
            tab.help.controls.helpText.innerHTML = "Updating help...";
            usagePopulated = true;
            let response = await config.local.get(config.key.usageResponse);
            if (response === undefined) {
                response = await requestUsage();
                if (response !== undefined) {
                    await config.local.set(config.key.usageResponse, response);
                    let readback = await config.local.get(config.key.usageResponse);
                    console.assert(!differ(response, readback), "cached usageResponse readback differs");
                }
            }
            if (!validateUsageResponse(response)) {
                throw new Error("invalid usage response");
            }
            usagePopulated = true;
            await tab.help.populate(response.Help);
            await tab.advanced.populate(response.Commands);
        }
    } catch (e) {
        console.error(e);
    }
}

function validateUsageResponse(response) {
    try {
        if (typeof response !== "object") {
            return false;
        }
        if (!Array.isArray(response.Help)) {
            return false;
        }
        if (response.Help.length < 1) {
            return false;
        }
        for (const line of response.Help) {
            if (typeof line !== "string") {
                return false;
            }
        }
        if (!Array.isArray(response.Commands)) {
            return false;
        }
        if (response.Commands.length < 1) {
            return false;
        }
        for (const line of response.Commands) {
            if (typeof line !== "string") {
                return false;
            }
        }
        return true;
    } catch (e) {
        console.error(e);
    }
}

async function requestUsage() {
    try {
        const selectedAccount = await getSelectedAccount();
        const message = {
            id: "sendCommand",
            accountId: selectedAccount.id,
            command: "usage",
        };

        if (verbose) {
            console.debug("requesting usage:", message);
        }
        const response = await sendMessage(message);
        if (verbose) {
            console.debug("usageResponse:", response);
        }
        return response;
    } catch (e) {
        console.error(e);
    }
}

////////////////////////////////////////////////////////////////////////////////
//
//  requests RPC handlers and connection management
//
////////////////////////////////////////////////////////////////////////////////

// return bool: true if successfully changed
async function selectTab(name) {
    try {
        if (verbose) {
            console.debug("selectTab:", name);
        }
        let link = undefined;
        switch (name) {
            case "classes":
                link = controls.classesNavLink;
                break;
            case "books":
                link = controls.booksNavLink;
                break;
            case "options":
                link = controls.optionsNavLink;
                break;
            case "advanced":
                link = controls.advancedNavLink;
                break;
            case "help":
                link = controls.helpNavLink;
                break;
        }
        if (link === undefined) {
            throw new Error("selectTab: unexpected tab name:", name);
        }
        if (link.disabled) {
            console.warn("selectTab: tab link disabled:", { name: name, link: link });
            return false;
        }
        link.click();
        if (verbose) {
            console.log("tab selected:", name);
        }
        return true;
    } catch (e) {
        console.error(e);
    }
}

async function disableEditorControl(id, disable) {
    try {
        if (verbose) {
            console.log("disableEditorControl:", id, disable);
        }
        let control = controls[id];
        control.disabled = disable;
    } catch (e) {
        console.error(e);
    }
}

///////////////////////////////////////////////////////////////////////////////
//
//  messages handlers
//
///////////////////////////////////////////////////////////////////////////////

async function connect() {
    try {
        console.log("connect:", { port, backgroundCID, backgroundSuspended });
        if (port === null) {
            if (verbose) {
                console.debug("editor: requesting background page...");
            }
            const background = await messenger.runtime.getBackgroundPage();
            if (verbose) {
                console.debug("background: page:", { url: background, suspended: backgroundSuspended });
            }

            if (verbose) {
                console.log("editor connecting to background as:", editorCID);
            }
            port = await messenger.runtime.connect({ name: editorCID });
            port.onMessage.addListener(onPortMessage);
            port.onDisconnect.addListener(onDisconnect);
            if (verbose) {
                console.debug("editor: connection pending on port:", port);
            }
        }
    } catch (e) {
        console.error(e);
    }
}

async function disconnect() {
    try {
        if (port !== null) {
            if (verbose) {
                console.debug("disconnecting");
            }
            await port.disconnect();
        }
    } catch (e) {
        console.error(e);
    }
}

async function onPortMessage(message, sender) {
    try {
        if (verbose) {
            console.debug("editor.onPortMessage:", message, sender);
        }
        let ret = undefined;
        switch (message.id) {
            case "ENQ":
                if (message.dst !== editorCID) {
                    throw new Error("destination CID mismatch");
                }
                backgroundCID = message.src;
                if (verbose) {
                    console.debug("editor: set background CID:", backgroundCID);
                }
                ret = await messenger.runtime.sendMessage({ id: "ACK", src: editorCID, dst: backgroundCID });
                if (verbose) {
                    console.debug("ACK returned:", ret);
                }
                console.log("editor connected to:", backgroundCID);
                // complete initialization now that we're connected to the background page
                await populateAccounts();
                break;
            default:
                await onMessage(message, sender);
                break;
        }
    } catch (e) {
        console.error(e);
    }
}

async function onMessage(message, sender) {
    try {
        if (verbose) {
            console.debug("editor.onMessage:", message, sender);
        }

        // process messages allowed without connection
        switch (message.id) {
            case "backgroundActivated":
                backgroundSuspended = false;
                console.log(message.id, { backgroundSuspended });
                return;
            case "backgroundSuspendCanceled":
                backgroundSuspended = false;
                console.log(message.id, { backgroundSuspended });
                return;
            case "backgroundSuspending":
                backgroundSuspended = true;
                console.log(message.id, { backgroundSuspended });
                return;
            case "addSenderTargetChanged":
                await tab.books.handleAddSenderTargetChanged(message);
                return;
        }

        if (backgroundCID === null) {
            console.error("not connected, discarding:", message);
            return;
        }

        if (message.src === undefined || message.dst === undefined) {
            console.debug("missing src/dst, discarding:", message);
            return;
        }

        if (message.src !== backgroundCID) {
            console.error("unexpected src ID, discarding:", message);
            return;
        }

        if (message.dst !== editorCID) {
            console.error("unexpected dst ID, discarding:", message);
            return;
        }

        let response = undefined;

        switch (message.id) {
            default:
                console.error("unknown message ID:", message);
                break;
        }

        if (response !== undefined) {
            if (typeof response !== "object") {
                response = { response: response };
            }
            if (verbose) {
                console.debug("editor.onMessage: sending response:", response);
            }
        }
        return response;
    } catch (e) {
        console.error(e);
    }
}

async function onDisconnect(port) {
    try {
        port = null;
        backgroundCID = null;
        if (verbose) {
            console.log("onDisconnect:", { port, backgroundCID, backgroundSuspended });
        }
    } catch (e) {
        console.error(e);
    }
}

async function sendMessage(message) {
    try {
        if (verbose) {
            console.log("sendMessage:", { port, backgroundCID, backgroundSuspended });
        }

        /*
        if (backgroundSuspended) {
            console.debug("suspended; awaiting background initialization");
            let initialized = await messenger.runtime.sendMessage({ id: "isInitialized", src: editorCID, dst: backgroundCID });
            console.debug("isInitialized returned:", initialized);
            if (initialized) {
                backgroundSuspended = false;
            }
        }
	*/

        /*
	if (port === null || backgroundCID === null) {
            console.log("reconnecting");
            await connect();
            await connected();
            console.log("reconnected");
        }

        if (port === null || backgroundCID === null) {
            console.error("SendMessage: port not connected:", port, backgroundCID, backgroundSuspended, message);
            throw new Error("SendMessage: port not connected");
        }
	*/

        if (typeof message === "string") {
            message = { id: message };
        }
        message.src = editorCID;
        message.dst = backgroundCID;
        if (verbose) {
            console.debug("editor.sendMessage:", message);
        }
        let result = await messenger.runtime.sendMessage(message);
        if (verbose) {
            console.debug("editor.sendMessage returned:", result);
        }
        return result;
    } catch (e) {
        console.error(e);
    }
}

////////////////////////////////////////////////////////////////////////////////
//
//  DOM element connection and event handlers
//
////////////////////////////////////////////////////////////////////////////////

async function onLoad() {
    try {
        if (verbose) {
            console.debug("editor page loading");
        }

        if (hasLoaded) {
            throw new Error("redundant load event");
        }
        hasLoaded = true;

        // disable all tabs and account select until we receive accounts from the background page
        await enableTab("classes", false);
        await enableTab("books", false);
        await enableTab("options", false);
        await enableTab("advanced", false);
        await enableTab("help", false);
        await enableAccountControls(false);
        tab.help.controls.table.hidden = true;

        // set advanced tab visible state from the local.storage config
        await setAdvancedTabVisible();

        await connect();

        if (verbose) {
            console.debug("editor page loaded");
        }
    } catch (e) {
        console.error(e);
    }
}

async function enableAccountControls(enabled) {
    try {
        if (verbose) {
            console.debug("enableAccountControls:", enabled);
        }
        await tab.classes.enableControls(enabled);
        await tab.books.enableControls(enabled);
    } catch (e) {
        console.error(e);
    }
}

async function onUnload() {
    try {
        await disconnect();
    } catch (e) {
        console.error(e);
    }
}

async function onStorageChange(changes, areaName) {
    if (verbose) {
        console.debug("editor: onStorageChange:", changes, areaName);
    }
    if (areaName == "local") {
        const change = changes.advancedTabVisible;
        if (change !== undefined) {
            await setAdvancedTabVisible(change.newValue ? true : false);
        }
    }
}

async function onApplyClick() {
    try {
        await tab.classes.saveChanges();
        await tab.books.saveChanges();
    } catch (e) {
        console.error(e);
    }
}

async function onCancelClick() {
    try {
        window.close();
    } catch (e) {
        console.error(e);
    }
}

async function onOkClick() {
    try {
        console.log("okButtonClick");
        var state = undefined;
        switch (activeTab) {
            case "classes":
                state = await tab.classes.saveChanges();
                break;
            default:
                state = { success: true };
        }
        if (typeof state === "object" && state.success) {
            window.close();
        }
    } catch (e) {
        console.error(e);
    }
}

function addControl(name, elementId, eventName = null, handler = null) {
    try {
        return addTabControl(undefined, name, elementId, eventName, handler);
    } catch (e) {
        console.error(e);
    }
}

function addTabControl(tab, name, elementId, eventName = null, handler = null) {
    try {
        var element = document.getElementById(elementId);
        if (!element) {
            throw new Error(`addControl: ${elementId} not found`);
        }
        if (tab !== undefined) {
            tab.controls[name] = element;
        } else {
            controls[name] = element;
        }

        if (eventName) {
            element.addEventListener(eventName, handler);
        }
    } catch (e) {
        console.error(e);
    }
}

async function onOptionsDomainCheckboxChange(sender) {
    try {
        await tab.options.onDomainCheckboxChange(sender);
    } catch (e) {
        console.error(e);
    }
}

async function onClassesInputKeypress(sender) {
    try {
        await tab.classes.onInputKeypress(sender);
    } catch (e) {
        console.error(e);
    }
}

async function onClasessNameChanged() {
    try {
        await tab.classes.onNameChanged();
    } catch (e) {
        console.error(e);
    }
}

async function onClassesSliderMoved(sender) {
    try {
        await tab.classes.onSliderMoved(sender);
    } catch (e) {
        console.error(e);
    }
}

async function onClassesScoreChanged(sender) {
    try {
        await tab.classes.onScoreChanged(sender);
    } catch (e) {
        console.error(e);
    }
}

async function onClassesCellDelete(sender) {
    try {
        await tab.classes.onCellDelete(sender);
    } catch (e) {
        console.error(e);
    }
}

async function onClassesCellInsert(sender) {
    try {
        await tab.classes.onCellInsert(sender);
    } catch (e) {
        console.error(e);
    }
}

async function onBooksConnectionChanged(sender) {
    try {
        await tab.books.onConnectionChanged(sender);
    } catch (e) {
        console.error(e);
    }
}

// classes tab controls
addTabControl(tab.classes, "accountSelect", "classes-account-select", "change", onAccountSelectChange);
addTabControl(tab.classes, "statusMessage", "classes-status-message-span");
addTabControl(tab.classes, "statusLabel", "classes-status-label-span");
addTabControl(tab.classes, "tableBody", "level-table-body");
addTabControl(tab.classes, "tableGridRow", "table-grid-row");
addTabControl(tab.classes, "tableGridColumn", "table-grid-column");
addTabControl(tab.classes, "saveButton", "classes-save-button", "click", () => {
    tab.classes.onSaveClick();
});
addTabControl(tab.classes, "defaultsButton", "classes-defaults-button", "click", () => {
    tab.classes.onDefaultsClick();
});
addTabControl(tab.classes, "refreshButton", "classes-refresh-button", "click", () => {
    tab.classes.onRefreshClick();
});
addTabControl(tab.classes, "refreshAllButton", "classes-refresh-all-button", "click", () => {
    tab.classes.onRefreshAllClick();
});

// books tab controls
addTabControl(tab.books, "accountSelect", "books-account-select", "change", onAccountSelectChange);
addTabControl(tab.books, "statusSpan", "books-status-span");

addTabControl(tab.books, "bookSelect", "books-book-select", "change", (e) => {
    tab.books.onBookSelectChange(e);
});
addTabControl(tab.books, "addressesButton", "books-addresses-button", "click", (e) => {
    tab.books.onAddressesClick(e);
});
addTabControl(tab.books, "addressesMenu", "books-addresses-menu");

addTabControl(tab.books, "addInput", "books-add-input", "keyup", (e) => {
    tab.books.onAddInputKeyup(e);
});
addTabControl(tab.books, "addButton", "books-add-button", "click", () => {
    tab.books.onAddClick();
});

addTabControl(tab.books, "deleteInput", "books-delete-input", "keyup", (e) => {
    tab.books.onDeleteInputKeyup(e);
});
addTabControl(tab.books, "deleteButton", "books-delete-button", "click", () => {
    tab.books.onDeleteClick();
});

addTabControl(tab.books, "addSenderSpan", "books-add-sender-span");
addTabControl(tab.books, "addSenderButton", "books-add-sender-button", "click", (e) => {
    tab.books.onAddSenderClick(e);
});
addTabControl(tab.books, "addSenderMenu", "books-add-sender-menu", "click", (e) => {
    tab.books.onAddSenderMenuClick(e);
});

addTabControl(tab.books, "table", "books-connections-table");
addTabControl(tab.books, "tableBody", "books-connections-table-body");
addTabControl(tab.books, "tableRow", "books-connections-table-row");

addTabControl(tab.books, "scanButton", "books-connections-scan-button", "click", () => {
    tab.books.onScanClick();
});
addTabControl(tab.books, "disconnectButton", "books-connections-disconnect-button", "click", () => {
    tab.books.onDisconnectClick();
});

addTabControl(tab.books, "connectionsDropdown", "books-connections-dropdown");

let tabConnectionsObserver = new MutationObserver((e) => {
    tab.books.onConnectionsDropdownChange(e);
});
tabConnectionsObserver.observe(tab.books.controls.connectionsDropdown, { attributes: true });

// options tab controls
addTabControl(tab.options, "autoDelete", "options-auto-delete-checkbox", "change", () => {
    tab.options.onAutoDeleteChange();
});
addTabControl(tab.options, "advancedTabVisible", "options-show-advanced-checkbox", "change", () => {
    tab.options.onShowAdvancedTabChange();
});
addTabControl(tab.options, "minimizeCompose", "options-minimize-compose-checkbox", "change", () => {
    tab.options.onMinimizeComposeChange();
});
addTabControl(tab.options, "cacheResponses", "options-cache-responses-checkbox", "change", () => {
    tab.options.onCacheResponsesChange();
});
addTabControl(tab.options, "resetButton", "options-reset-button", "click", () => {
    tab.options.onResetClick();
});
addTabControl(tab.options, "clearCacheButton", "options-clear-cache-button", "click", () => {
    tab.options.onClearCacheClick();
});
addTabControl(tab.options, "domainsStack", "options-domains-stack");
addTabControl(tab.options, "domainsApplyButton", "options-domains-apply-changes", "click", () => {
    tab.options.onDomainsApplyClick();
});
addTabControl(tab.options, "domainsCancelButton", "options-domains-cancel-changes", "click", () => {
    tab.options.populateDomains();
});

// advanced tab controls
addTabControl(tab.advanced, "selectedAccount", "advanced-selected-account-input");
addTabControl(tab.advanced, "command", "advanced-command-select", "change", (sender) => {
    tab.advanced.onCommandChange(sender);
});
addTabControl(tab.advanced, "argument", "advanced-argument-input");
addTabControl(tab.advanced, "sendButton", "advanced-send-button", "click", () => {
    tab.advanced.onSendClick();
});
addTabControl(tab.advanced, "status", "advanced-status-span");
addTabControl(tab.advanced, "output", "advanced-output");

// help tab controls
addTabControl(tab.help, "helpText", "help-text");
addTabControl(tab.help, "table", "help-table");
addTabControl(tab.help, "tableBody", "help-table-body");

// tabs
addControl("classesTab", "tab-classes");
addControl("booksTab", "tab-books");
addControl("optionsTab", "tab-options");
addControl("advancedTab", "tab-advanced");
addControl("helpTab", "tab-help");

// tablinks
addControl("classesTabLink", "tab-classes-link");
addControl("booksTabLink", "tab-books-link");
addControl("optionsTabLink", "tab-options-link");
addControl("advancedTabLink", "tab-advanced-link");
addControl("helpTabLink", "tab-help-link");

// navlinks
addControl("classesNavLink", "classes-navlink", "shown.bs.tab", onTabShow);
addControl("booksNavLink", "books-navlink", "shown.bs.tab", onTabShow);
addControl("optionsNavLink", "options-navlink", "shown.bs.tab", onTabShow);
addControl("advancedNavLink", "advanced-navlink", "shown.bs.tab", onTabShow);
addControl("helpNavLink", "help-navlink", "shown.bs.tab", onTabShow);

addControl("applyButton", "apply-button", "click", onApplyClick);
addControl("okButton", "ok-button", "click", onOkClick);
addControl("cancelButton", "cancel-button", "click", onCancelClick);

// handler for runtime broadcast messages
messenger.runtime.onMessage.addListener(onMessage);

// DOM event handlers
window.addEventListener("load", onLoad);
window.addEventListener("beforeunload", onUnload);
messenger.storage.onChanged.addListener(onStorageChange);
