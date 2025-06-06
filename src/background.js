console.warn("BEGIN background.js");

import { isAccount, getAccounts, getAccount, getSelectedAccount } from "./accounts.js";
import { accountEmailAddress } from "./common.js";
import { displayProcess } from "./display.js";
import { FilterDataController } from "./filterctl.js";
import { email } from "./email.js";
import { config, updateActiveRescans } from "./config.js";
import { verbosity, isValidBookName } from "./common.js";
import { Requests } from "./requests.js";
import { moveMessagesToFilterBook } from "./filterbook.js";

/* globals console, messenger, window */

// control flags
const verbose = verbosity.background;

async function isApproved() {
    return config.local.getBool(config.local.key.optInApproved);
}

// close editor tab if open
async function closeEditor() {
    try {
        let tab = await findContentTab("editor", true);
        if (tab) {
            await messenger.tabs.remove(tab.id);
        }
    } catch (e) {
        console.error(e);
    }
}

async function initialize(mode) {
    try {
        if (await config.local.getBool(config.local.key.autoClearConsole)) {
            console.clear();
        }
        const manifest = await messenger.runtime.getManifest();
        const approved = await isApproved();
        console.log(`${manifest.name} v${manifest.version} (${mode}) Approved=${approved}`);

        if (verbose) {
            console.debug({ commands: await messenger.commands.getAll() });
        }

        if (await config.session.getBool(config.session.key.initialized)) {
            console.error("redundant initialize call");
        }

        await config.session.setBool(config.session.key.initialized, true);

        await closeEditor();

        if (!(await isApproved())) {
            await initMenus();
            await messenger.runtime.openOptionsPage();
            return;
        }

        // we've restarted so forget pending filterctl state
        let filterctl = await getFilterDataController();
        await filterctl.purgePending();
        // and forget sieveTrace state
        await config.session.remove(config.session.key.sieveTrace);
        await initMenus();
        await autoOpen();
    } catch (e) {
        console.error(e);
    }
}

async function getFilterDataController() {
    try {
        let filterDataController = new FilterDataController(email);
        await filterDataController.readState();
        return filterDataController;
    } catch (e) {
        console.error(e);
    }
}

async function onStartup() {
    try {
        await initialize("startup");
    } catch (e) {
        console.error(e);
    }
}

async function onInstalled() {
    try {
        await initialize("installed");
    } catch (e) {
        console.error(e);
    }
}

async function onUpdateAvailable(details) {
    try {
        console.warn("onUpdateAvailable:", details);
    } catch (e) {
        console.error(e);
    }
}

async function onSuspend() {
    try {
        console.warn("background suspending");
    } catch (e) {
        console.error(e);
    }
}

async function onSuspendCanceled() {
    try {
        console.warn("background suspend canceled");
    } catch (e) {
        console.error(e);
    }
}

async function contentTabTitle(name) {
    try {
        let key = undefined;
        switch (name) {
            case "editor":
                key = config.local.key.editorTitle;
                break;
            case "rescan":
                key = config.local.key.rescanTitle;
                break;
            default:
                throw new Error("unknown content tab name:" + name);
        }
        let title = await config.local.get(key);
        if (typeof title !== "string" || title === "") {
            throw new Error("content tab title value undefined:" + key);
        }
        return title;
    } catch (e) {
        console.error(e);
    }
}

async function findContentTab(name, force = false) {
    try {
        const title = await contentTabTitle(name);
        const tabs = await messenger.tabs.query({ type: "content", title });
        for (const tab of tabs) {
            if (tab.title === title) {
                return tab;
            }
        }
        if (force) {
            return await openContentTab(name);
        }
        return null;
    } catch (e) {
        console.error(e);
    }
}

async function focusEditorWindow() {
    try {
        if (verbose) {
            console.debug("focusEditorWindow");
        }

        // divert to options page if not approved
        if (!(await isApproved())) {
            await messenger.runtime.openOptionsPage();
            return;
        }
        let tab = await findContentTab("editor", true);
        await messenger.tabs.update(tab.id, { active: true });
    } catch (e) {
        console.error(e);
    }
}

async function focusRescanWindow() {
    try {
        if (verbose) {
            console.debug("focusRescanWindow");
        }

        // divert to options page if not approved
        if (!(await isApproved())) {
            await messenger.runtime.openOptionsPage();
            return;
        }
        let tab = await findContentTab("rescan", true);
        await messenger.tabs.update(tab.id, { active: true });
    } catch (e) {
        console.error(e);
    }
}

function openAndLoad(url, active = false) {
    if (verbose) {
        console.log("openAndLoad:", { url, active });
    }
    return new Promise((resolve, reject) => {
        try {
            let newTab = undefined;
            async function listener(tabId, info) {
                if (verbose) {
                    console.debug("tab update:", tabId, info);
                }
                if (newTab !== undefined && tabId === newTab.id && info.status === "complete") {
                    messenger.tabs.onUpdated.removeListener(listener);
                    if (verbose) {
                        console.debug("openAndLoad returning:", newTab);
                    }
                    resolve(newTab);
                }
            }
            messenger.tabs.onUpdated.addListener(listener);
            messenger.tabs.create({ url, active }).then((tab) => {
                if (verbose) {
                    console.debug("tab created:", tab);
                }
                newTab = tab;
            });
        } catch (e) {
            reject(e);
        }
    });
}

async function openContentTab(name) {
    try {
        const title = await contentTabTitle(name);
        const url = `./${name}.html`;
        if (verbose) {
            console.log("openContentTab:", { name, url, title });
        }
        var tab = await findContentTab(name);
        if (tab) {
            if (verbose) {
                console.debug("found existing content tab:", name, tab);
            }
        } else {
            if (verbose) {
                console.debug("opening content tab:", name, title, url);
            }
            tab = await openAndLoad(url);
        }
        let message = { id: "ENQ", src: "background", dst: name };
        if (verbose) {
            console.debug("background sending ENQ:", message);
        }
        let response = await messenger.runtime.sendMessage(message);
        if (verbose) {
            console.log("background sent ENQ, got:", response);
        }
        if (typeof response !== "object" || response.src !== name) {
            throw new Error(`failed opening content tab ${name}`);
        }
        if (verbose) {
            console.debug("openContentTab returning:", tab);
        }
        return tab;
    } catch (e) {
        console.error(e);
    }
}

async function sendMessage(message, force = false) {
    try {
        if (verbose) {
            console.log("background: sendMessage:", { message, force });
        }
        let name = message.dst;
        let tab = await findContentTab(name, force);
        if (!tab && !force) {
            if (verbose) {
                console.log("tab not open, not sending");
            }
            return;
        }
        message.src = "background";
        return await messenger.runtime.sendMessage(message);
    } catch (e) {
        console.error(e);
    }
}

///////////////////////////////////////////////////////////////////////////////
//
//  message handlers
//
///////////////////////////////////////////////////////////////////////////////

async function onCommand(command, tab) {
    try {
        if (verbose) {
            console.debug("onCommand:", command, tab);
        }

        if (!(await isApproved())) {
            await messenger.runtime.openOptionsPage();
            return;
        }
        if (!tab.type === "mail") {
            return;
        }
        let prefix = "mailfilter-add-sender-";
        if (command.substr(0, prefix.length) === prefix) {
            let suffix = command.substr(prefix.length);
            const accountId = await config.session.get(config.session.key.messageDisplayActionAccountId);
            if (await isAccount(accountId)) {
                const bookNames = await getBookNames(accountId);
                let bookName = undefined;
                if (suffix === "default") {
                    bookName = await getAddSenderTarget(accountId);
                } else {
                    const bookIndex = parseInt(suffix) - 1;
                    bookName = bookNames[bookIndex];
                }
                if (typeof bookName === "string" && bookName !== "") {
                    let messageList = await messenger.mailTabs.getSelectedMessages(tab.id);
                    console.log("Command AddSenderToAddressBook:", { command, accountId, bookName, messageList });
                    await addSenderToFilterBook(accountId, bookName, messageList);
                } else {
                    console.log("Command AddSenderToAddressBook: book not found:", { command, suffix, bookNames });
                }
            }
            return;
        }
        switch (command) {
            default:
                console.error("unknown command:", command);
                throw new Error("unknown command");
        }
    } catch (e) {
        console.error(e);
    }
}

function onMessage(message, sender) {
    try {
        if (verbose) {
            console.debug("background.onMessage:", message, sender);
            console.log("background.OnMessage received:", message.id, message.src);
        }

        if (!(typeof message.src === "string" && message.src.length > 0)) {
            console.error("missing src in message:", message);
            throw new Error("missing message src");
        }

        if (!(typeof message.dst === "string" && message.dst.length > 0)) {
            console.error("missing dst in message:", message);
            throw new Error("missing message dst");
        }

        if (message.dst != "background") {
            return false;
        }

        return new Promise((resolve) => {
            handleMessage(message, sender).then((response) => {
                resolve(response);
            });
        });
    } catch (e) {
        console.error(e);
    }
}

async function handleMessage(message, sender) {
    try {
        // process messages not requiring connection
        let response = undefined;
        switch (message.id) {
            case "focusEditorWindow":
                response = await focusEditorWindow();
                break;

            case "ENQ":
                response = { id: "ACK", src: "background", dst: message.src };
                if (verbose) {
                    console.log("background received ENQ, returning:", response);
                }
                break;

            case "getClasses":
                response = await handleGetClasses(message);
                break;
            case "setClasses":
                response = await handleSetClasses(message);
                break;
            case "sendClasses":
                response = await handleSendClasses(message);
                break;
            case "sendAllClasses":
                response = await handleSendAllClasses(message);
                break;
            case "refreshClasses":
                response = await handleRefreshClasses(message);
                break;
            case "refreshAllClasses":
                response = await handleRefreshAllClasses(message);
                break;
            case "setDefaultClasses":
                response = await handleSetDefaultClasses(message);
                break;
            case "getBooks":
                response = await handleGetBooks(message);
                break;
            case "setBooks":
                response = await handleSetBooks(message);
                break;
            case "sendBooks":
                response = await handleSendBooks(message);
                break;
            case "sendAllBooks":
                response = await handleSendAllBooks(message);
                break;
            case "refreshBooks":
                response = await handleRefreshBooks();
                break;
            case "refreshAllBooks":
                response = await handleRefreshAllBooks();
                break;
            case "setDefaultBooks":
                response = await handleSetDefaultBooks();
                break;
            case "setConfigValue":
                response = await handleSetConfigValue(message);
                break;
            case "getConfigValue":
                response = await handleGetConfigValue(message);
                break;
            case "resetConfigToDefaults":
                response = await handleResetConfigToDefaults(message);
                break;
            case "sendCommand":
                response = await handleSendCommand(message);
                break;
            case "getPassword":
                response = await handleGetPassword(message);
                break;
            case "setAddSenderTarget":
                response = await setAddSenderTarget(message.accountId, message.bookName);
                break;
            case "getAddSenderTarget":
                response = await getAddSenderTarget(message.accountId);
                break;
            case "initMenus":
                response = await initMenus();
                break;
            case "cacheControl":
                response = await handleCacheControl(message);
                break;
            case "getCardDAVBooks":
                response = await handleGetCardDAVBooks(message);
                break;
            /*
            case "addSenderToFilterBook":
                response = await handleAddSenderToFilterBook(message);
                break;
	    */

            default:
                console.error("background: received unexpected message:", message, sender);
                throw new Error("background received unexpected message:" + message.id);
        }
        if (typeof response !== "object") {
            response = { result: response };
        }
        return response;
    } catch (e) {
        console.error(e);
    }
}

///////////////////////////////////////////////////////////////////////////////
//
//  menu configuration
//
///////////////////////////////////////////////////////////////////////////////

let menuConfig = {
    rmfControlPanel: {
        properties: {
            title: "Mail Filter Control Panel",
            contexts: ["tools_menu", "action"],
        },
        onClicked: "onMenuControlPanelClicked",
    },

    rmfOpenRescans: {
        properties: {
            title: "Mail Filter Active Rescans",
            contexts: ["tools_menu", "action"],
        },
        onClicked: "onMenuOpenRescansClicked",
    },

    rmfAddSenderMessageList: {
        properties: {
            title: "Add Sender to Filter Book",
            contexts: ["message_list"],
            visible: false,
        },
        onCreated: "onMenuCreatedAddBooks",
        subId: "rmfBook",
        hideAfterCreate: true,
    },

    rmfAddSenderMessageDisplayAction: {
        properties: {
            title: "Add Sender to Filter Book",
            contexts: ["message_display_action"],
            visible: false,
        },
        onCreated: "onMenuCreatedAddBooks",
        subId: "rmfBook",
        hideAfterCreate: true,
    },

    rmfBook: {
        account: "__account-id__",
        book: "__book__",
        properties: {
            title: "Add sender to '__book__'",
        },
        onClicked: "onMenuAddSenderClicked",
        noInit: true,
    },

    rmfRescanMessagesSeparator: {
        properties: {
            type: "separator",
            contexts: ["message_list"],
        },
    },

    rmfRescanMessages: {
        properties: {
            title: "Rescan Selected Messages",
            contexts: ["message_list"],
        },
        onClicked: "onMenuRescanMessagesClicked",
    },

    rmfRescanFolder: {
        properties: {
            title: "Rescan All Messages in Folder",
            contexts: ["folder_pane"],
        },
        onClicked: "onMenuRescanFolderClicked",
    },

    rmfSelectAddSenderSeparator: {
        properties: {
            type: "separator",
            contexts: ["message_list", "message_display_action"],
        },
    },

    rmfSelectAddSenderTarget: {
        properties: {
            title: "Select 'Add Sender' Target",
            contexts: ["folder_pane", "message_list", "message_display_action"],
        },
        onCreated: "onMenuCreatedAddBooks",
        subId: "rmfTargetBook",
    },

    rmfSieveTrace: {
        properties: {
            title: "Sieve Trace Enabled",
            contexts: ["folder_pane"],
            type: "checkbox",
        },
        onCreated: "onMenuCreatedSieveTrace",
        onClicked: "onMenuClickedSieveTrace",
        onShown: "onMenuShownSieveTrace",
    },

    rmfTargetBook: {
        properties: {
            title: "__book__",
            type: "radio",
            parentId: "rmfSelectAddSenderTarget",
        },
        noInit: true,
        onClicked: "onMenuClickedSelectBook",
    },
};

function getMenuHandler(handlerName) {
    try {
        switch (handlerName) {
            case "onMenuControlPanelClicked":
                return onMenuControlPanelClicked;

            case "onMenuOpenRescansClicked":
                return onMenuOpenRescansClicked;

            case "onMenuCreatedAddBooks":
                return onMenuCreatedAddBooks;

            case "onMenuClickedSelectBook":
                return onMenuClickedSelectBook;

            case "onMenuAddSenderClicked":
                return onMenuAddSenderClicked;

            case "onMenuRescanMessagesClicked":
                return onMenuRescanMessagesClicked;

            case "onMenuRescanFolderClicked":
                return onMenuRescanFolderClicked;

            case "onMenuCreatedSieveTrace":
                return onMenuCreatedSieveTrace;

            case "onMenuClickedSieveTrace":
                return onMenuClickedSieveTrace;

            case "onMenuShownSieveTrace":
                return onMenuShownSieveTrace;
        }
        throw new Error(`unknown menu handler: ${handlerName}`);
    } catch (e) {
        console.error(e);
    }
}

async function getMenus() {
    try {
        let menus = await config.session.get(config.session.key.menuConfig);
        if (typeof menus !== "object" || Array.from(Object.keys(menus)).length === 0) {
            menus = await initMenus();
        }
        return menus;
    } catch (e) {
        console.error(e);
    }
}

// reset menu configuration from menu config data structure
async function initMenus() {
    try {
        console.log("initMenus");
        let menus = {};
        await messenger.menus.removeAll();

        if (!(await isApproved())) {
            console.log("initMenus: cleared");
            await messenger.menus.refresh();
            return;
        }
        for (let [mid, config] of Object.entries(menuConfig)) {
            if (config.noInit !== true) {
                await createMenu(menus, mid, config);
            }
        }
        await messenger.menus.refresh();

        // save menu config in session storage
        await config.session.set(config.session.key.menuConfig, menus);
        if (verbose) {
            console.log("saved menu config:", menus);
        }

        await updateMessageDisplayAction(await selectedMessagesAccountId());

        return menus;
    } catch (e) {
        console.error(e);
    }
}

// return the accountId of the currently selected messages
async function selectedMessagesAccountId() {
    try {
        const tabs = await messenger.tabs.query({ type: "mail" });
        for (const tab of tabs) {
            const selected = await messenger.mailTabs.getSelectedMessages(tab.id);
            for (const message of selected.messages) {
                const accountId = message.folder.accountId;
                if (await isAccount(accountId)) {
                    return accountId;
                }
                break;
            }
            break;
        }
    } catch (e) {
        console.error(e);
    }
}

/*
// return the tab of the currently selected messages
async function selectedMessagesTab() {
    try {
        const tabs = await messenger.tabs.query({ type: "mail" });
        for (const tab of tabs) {
            const selected = await messenger.mailTabs.getSelectedMessages(tab.id);
            for (const message of selected.messages) {
                const accountId = message.folder.accountId;
                if (await isAccount(accountId)) {
                    return tab;
                }
                break;
            }
            break;
        }
    } catch (e) {
        console.error(e);
    }
}
*/

async function updateMessageDisplayAction(accountId = undefined) {
    try {
        // if accountId specified, set to undefined if the account is not enabled
        if (accountId !== undefined) {
            if (!(await isAccount(accountId))) {
                accountId = undefined;
            }
        }
        const approved = await isApproved();
        if (!approved) {
            // set accountId to undefined to disable button when not approved
            accountId = undefined;
        }
        // save the accountId for use by message_display_action_menu onClicked
        await config.session.set(config.session.key.messageDisplayActionAccountId, accountId);
        if (approved && accountId !== undefined) {
            let targetBook = await getAddSenderTarget(accountId);
            if (typeof targetBook === "string" && targetBook !== "") {
                await messenger.messageDisplayAction.setTitle({ title: `Add sender to '${targetBook}'` });
                await messenger.messageDisplayAction.enable();
                return;
            }
        }
        await messenger.messageDisplayAction.setTitle({ title: "Add Sender Disabled" });
        await messenger.messageDisplayAction.disable();
    } catch (e) {
        console.error(e);
    }
}

async function createMenu(menus, mid, config) {
    try {
        if (verbose) {
            console.debug("createMenu:", mid, config);
        }

        if (Object.hasOwn(menus, mid)) {
            console.error("menu exists:", mid, config, menus);
            throw new Error("menu exists");
        }
        let properties = Object.assign({}, config.properties);
        properties.id = mid;
        let cid = await messenger.menus.create(properties);
        console.assert(cid === mid);
        let created = Object.assign({}, config);
        created.properties = Object.assign({}, config.properties);
        created.id = mid;
        created.subs = [];
        if (Object.hasOwn(created.properties, "parentId")) {
            created.pid = created.properties.parentId;
            if (!Object.hasOwn(menus, created.pid)) {
                console.error("nonexistent parent:", { config, properties, menus });
                throw new Error("nonexistent parent");
            }
            menus[created.pid].subs.push(created);
        }
        menus[mid] = created;
        if (verbose) {
            console.log("createMenu:", mid, {
                created,
                config,
                properties,
                menus,
            });
        }
        if (Object.hasOwn(created, "onCreated")) {
            const handler = getMenuHandler(created.onCreated);
            await handler(menus, created);
        }
    } catch (e) {
        console.error(e);
    }
}

///////////////////////////////////////////////////////////////////////////////
//
//  menu event handlers
//
///////////////////////////////////////////////////////////////////////////////

async function onMenuClicked(info, tab) {
    try {
        if (verbose) {
            console.debug("onMenuClicked:", { info, tab });
        }
        if (!Object.hasOwn(info, "menuItemId")) {
            console.error("missing menuItemId:", info, tab);
            throw new Error("missing menuItemId");
        }
        if (Object.hasOwn(info, "menuIds")) {
            console.error("unexpected menuIds:", info, tab);
            throw new Error("unexpected menuIds");
        }
        await onMenuEvent("onClicked", [info.menuItemId], info, tab);
    } catch (e) {
        console.error(e);
    }
}

async function onMenuShown(info, tab) {
    try {
        if (verbose) {
            console.debug("onMenuShown:", { info, tab });
        }
        if (!Object.hasOwn(info, "menuIds")) {
            console.error("missing menuIds:", info, tab);
            throw new Error("missing menuIds");
        }
        if (Object.hasOwn(info, "menuItemId")) {
            console.error("unexpected menuItemId:", info, tab);
            throw new Error("unexpected menuItemId");
        }
        await onMenuEvent("onShown", info.menuIds, info, tab);
    } catch (e) {
        console.error(e);
    }
}

async function onMenuEvent(menuEvent, mids, info, tab) {
    try {
        let menus = await getMenus();
        console.log("onMenuEvent:", { menus, menuEvent, mids, info, tab });
        if (menus === undefined) {
            return;
        }
        console.assert(Array.isArray(mids));
        let refresh = false;
        let detail = await menuEventDetail(info, tab);
        if (menuEvent === "onShown" && detail.setVisibility) {
            await setMenuVisibility(menus, detail);
            refresh = true;
        }
        for (let mid of mids) {
            if (Object.hasOwn(menus, mid)) {
                if (Object.hasOwn(menus[mid], menuEvent)) {
                    let handler = getMenuHandler(menus[mid][menuEvent]);
                    let changed = await handler(menus[mid], detail);
                    if (changed) {
                        refresh = true;
                    }
                }
            } else {
                console.error("menu not found:", menuEvent, mid, { detail, menus });
                throw new Error("menu not found");
            }
        }
        if (refresh) {
            if (verbose) {
                console.debug("refreshing menus");
            }
            await messenger.menus.refresh();
        }
    } catch (e) {
        console.error(e);
    }
}

async function setMenuVisibility(menus, detail) {
    let accountId = detail.accountId;
    let context = detail.context;
    try {
        //if (verbose) {
        console.debug("setMenuVisibility:", detail);
        //}

        let book = accountId === undefined ? undefined : await getAddSenderTarget(accountId);
        for (const config of Object.values(menus)) {
            if (config.properties.contexts.includes(context)) {
                let properties = {};
                if (config.hideAfterCreate === true) {
                    properties.visible = false;
                } else {
                    properties.visible = accountId !== undefined;
                    if (properties.visible) {
                        if (config.id === "rmfRescanMessages" || config.id === "rmfRescanFolder") {
                            // rescan visibility depends on selected folder
                            properties.visible = await getRescanVisibility(config.id, detail);
                        } else if (config.accountId !== undefined) {
                            // filterbook visibility depends on selected account
                            properties.visible = accountId === config.accountId;
                            if (config.properties.type === "radio") {
                                properties.checked = config.properties.title === book;
                            }
                        }
                    }
                }
                //if (verbose) {
                console.debug("updating menu:", config.id, properties);
                //}
                await messenger.menus.update(config.id, properties);
            }
        }
    } catch (e) {
        console.error(e);
    }
}

// return info about the account for onMenuShown handlers
async function menuEventDetail(info, tab) {
    try {
        if (verbose) {
            console.debug("menuEventDetail:", info, tab);
        }
        let ret = {
            info,
            tab,
            setVisibility: false,
            hasAccount: false,
        };

        const accounts = await getAccounts();

        if (Array.isArray(info.selectedFolders)) {
            console.assert(!Object.hasOwn(info, "displayedFolder"), "conflicting info folders");
            for (const folder of info.selectedFolders) {
                if (Object.hasOwn(accounts, folder.accountId)) {
                    ret.hasAccount = true;
                    ret.accountId = folder.accountId;
                }
                break;
            }
        } else if (Object.hasOwn(info, "displayedFolder")) {
            console.assert(!Object.hasOwn(info, "selectedFolders"), "conflicting info folders");
            if (Object.hasOwn(accounts, info.displayedFolder.accountId)) {
                ret.hasAccount = true;
                ret.accountId = info.displayedFolder.accountId;
            }
        }

        if (Object.hasOwn(info, "contexts")) {
            console.assert(Array.isArray(info.contexts));
            if (info.contexts.includes("folder_pane")) {
                console.assert(!info.contexts.includes("message_list"), "conflicting info context");
                console.assert(!info.contexts.includes("message_display_action"), "conflicting info context");
                ret.context = "folder_pane";
                ret.setVisibility = true;
            } else if (info.contexts.includes("message_list")) {
                console.assert(!info.contexts.includes("folder_pane"), "conflicting info context");
                console.assert(!info.contexts.includes("message_display_action"), "conflicting info context");
                ret.context = "message_list";
                ret.setVisibility = true;
            } else if (info.contexts.includes("message_display_action")) {
                console.assert(!info.contexts.includes("message_list"), "conflicting info context");
                console.assert(!info.contexts.includes("folder_pane"), "conflicting info context");
                ret.context = "message_display_action";
                // get accountId from the value stored by onDisplayedFolderChanged handler
                ret.accountId = await config.session.get(config.session.key.messageDisplayActionAccountId);
                if (!ret.accountId) {
                    // get accountId from the currently selected messages
                    let accountId = await selectedMessagesAccountId();
                    if (await isAccount(accountId)) {
                        ret.accountId = accountId;
                    }
                }
                ret.hasAccount = true;
                ret.setVisibility = true;
            }
        }
        if (verbose) {
            console.debug("menuEventDetail returning:", ret);
        }
        return ret;
    } catch (e) {
        console.error(e);
    }
}

// add filterbook submenus
async function onMenuCreatedAddBooks(menus, created) {
    try {
        if (verbose) {
            console.debug("onMenuCreatedAddBooks:", created);
        }
        const accounts = await getAccounts();
        for (const [accountId, account] of Object.entries(accounts)) {
            let accountEmail = accountEmailAddress(account);
            for (const bookName of await getBookNames(accountId)) {
                let config = newBookMenuConfig(menuConfig[created.subId], accountId, bookName, created);
                await createMenu(menus, `${created.id};${accountEmail};${accountId};${bookName}`, config);
            }
        }
        return true;
    } catch (e) {
        console.error(e);
    }
}

function newBookMenuConfig(srcConfig, accountId, bookName, created) {
    try {
        let config = Object.assign({}, srcConfig);
        config.properties = Object.assign({}, srcConfig.properties);
        config.accountId = accountId;
        config.book = bookName;
        config.properties.title = config.properties.title.replace(/__book__/, bookName);
        config.properties.contexts = created.properties.contexts;
        return config;
    } catch (e) {
        console.error(e);
    }
}

async function getSieveTrace(accountId) {
    try {
        let sieveTrace = await config.session.get(config.session.key.sieveTrace);
        if (!sieveTrace) {
            sieveTrace = {};
        }
        if (Object.hasOwn(sieveTrace, accountId)) {
            return sieveTrace[accountId] ? true : false;
        }
        let requests = new Requests();
        let response = await requests.get(accountId, "/sieve/trace/");
        if (!response.Success) {
            throw new Error("sieve state request failed:", response);
        }
        sieveTrace[accountId] = response.Enabled;
        await config.session.set(config.session.key.sieveTrace, sieveTrace);
        return sieveTrace[accountId] ? true : false;
    } catch (e) {
        console.error(e);
    }
}

async function setSieveTrace(accountId, enabled) {
    try {
        let action = enabled ? "Enabling" : "Disabling";
        let account = await getAccount(accountId);
        let email = accountEmailAddress(account);
        let display = await displayProcess(`${action} Sieve Trace for ${email}...`, 0, 10, { ticker: 1 });
        try {
            let requests = new Requests();
            var response;
            if (enabled) {
                response = await requests.put(accountId, "/sieve/trace/");
            } else {
                response = await requests.delete(accountId, "/sieve/trace/");
            }
            if (!response.Success) {
                throw new Error("sieve state request failed:", response);
            }
            let sieveTrace = await config.session.get(config.session.key.sieveTrace);
            if (!sieveTrace) {
                sieveTrace = {};
            }
            sieveTrace[accountId] = response.Enabled;
            await config.session.set(config.session.key.sieveTrace, sieveTrace);

            action = enabled ? "Enabled" : "Disabled";
            await display.complete(`${action} Sieve Trace for ${email}`);
            if (verbose) {
                console.log("setSieveTrace completed:", accountId, enabled);
            }
        } catch (e) {
            await display.fail(`${action} Sieve Trace for ${email} failed: ${e}`);
            console.error("setSieveTrace failed:", accountId, enabled, e);
        }
    } catch (e) {
        console.error(e);
    }
}

async function onMenuCreatedSieveTrace(menus, created) {
    try {
        if (verbose) {
            console.debug("onMenuCreatedSieveTrace:", created);
        }
        const accounts = await getAccounts();
        for (const accountId of Object.keys(accounts)) {
            await getSieveTrace(accountId);
        }
        return true;
    } catch (e) {
        console.error(e);
    }
}

async function onMenuShownSieveTrace(target, detail) {
    try {
        if (verbose) {
            console.debug("onMenuShownSieveTrace:", target.id, { target, detail });
        }
        let enabled = await getSieveTrace(detail.accountId);
        await messenger.menus.update(target.id, { checked: enabled });
        return true;
    } catch (e) {
        console.error(e);
    }
}

async function onMenuClickedSieveTrace(target, detail) {
    try {
        if (verbose) {
            console.log("onMenuClickedSieveTrace:", target.id, {
                target,
                detail,
            });
        }
        let wasEnabled = await getSieveTrace(detail.accountId);
        let isEnabled = !wasEnabled;
        await setSieveTrace(detail.accountId, isEnabled);
        await messenger.menus.update(target.id, { checked: isEnabled });
    } catch (e) {
        console.error(e);
    }
}

// hide rescan on ineligible account
async function getRescanVisibility(menuId, detail) {
    try {
        if (verbose) {
            console.debug("getRescanVisibility:", { menuId, detail });
        }
        if (detail.hasAccount) {
            var folderPath;
            var folderName;
            if (Object.hasOwn(detail, "info") && Object.hasOwn(detail.info, "displayedFolder")) {
                folderPath = detail.info.displayedFolder.path;
                folderName = detail.info.displayedFolder.name;
                if (menuId === "rmfRescanFolder") {
                    return false;
                }
            }
            if (Object.hasOwn(detail, "info") && Object.hasOwn(detail.info, "selectedFolders")) {
                if (detail.info.selectedFolders.length === 1) {
                    folderPath = detail.info.selectedFolders[0].path;
                    folderName = detail.info.selectedFolders[0].name;
                    if (menuId === "rmfRescanMessages") {
                        return false;
                    }
                }
            }
            if (verbose) {
                console.debug("rescan:", { detail, folderPath });
            }
            // enable rescan menu if folder not present in noRescanFolders
            let parts = folderPath.split("/");
            if (folderName !== "Root" && parts.length > 1) {
                folderName = parts[1];
            }
            const noRescanFolders = ["Root", "Junk", "Sent", "Drafts", "Trash"];
            if (!noRescanFolders.includes(folderName)) {
                return true;
            }
        }
        return false;
    } catch (e) {
        console.error(e);
    }
}

async function onActionButtonClicked(tab, info) {
    try {
        if (verbose) {
            console.debug("onActionButtonClicked:", { tab, info });
        }
        await focusEditorWindow();
    } catch (e) {
        console.error(e);
    }
}

// update checkmark on selected filter book
async function onMenuClickedSelectBook(target, detail) {
    try {
        if (verbose) {
            console.log("onMenuClickedSelectBook:", target.id, {
                target,
                detail,
            });
        }
        await setAddSenderTarget(target.accountId, target.book);
    } catch (e) {
        console.error(e);
    }
}

async function onMenuControlPanelClicked(target, detail) {
    try {
        if (verbose) {
            console.debug("onMenuControlPanelClicked:", target.id, { target, detail });
        }
        await focusEditorWindow();
    } catch (e) {
        console.error(e);
    }
}

async function onMenuOpenRescansClicked(target, detail) {
    try {
        if (verbose) {
            console.debug("onMenuOpenRescansClicked:", target.id, { target, detail });
        }
        await focusRescanWindow();
    } catch (e) {
        console.error(e);
    }
}

async function onMenuRescanFolderClicked(target, detail) {
    try {
        if (verbose) {
            console.log("onMenuRescanFolderClicked:", target.id, {
                target,
                detail,
            });
        }
        for (const folder of detail.info.selectedFolders) {
            let account = await getAccount(folder.accountId);
            let path = folder.path;
            await requestRescan(account, path, [], `Rescanning all messages in folder '${folder.path}'...`);
        }
    } catch (e) {
        console.error(e);
    }
}

async function onMenuRescanMessagesClicked(target, detail) {
    try {
        if (verbose) {
            console.log("onMenuRescanMessagesClicked:", target.id, {
                target,
                detail,
            });
        }
        let account = await getAccount(detail.info.displayedFolder.accountId);
        let path = detail.info.displayedFolder.path;
        let messageIds = [];

        let page = detail.info.selectedMessages;
        let messages = page.messages;
        while (messages.length) {
            for (const message of messages) {
                messageIds.push(message.headerMessageId.trim());
                console.assert(message.folder.path === path, "message path mismatch");
            }
            if (page.id) {
                page = await messenger.messages.continueList(page.id);
                messages = page.messages;
            } else {
                break;
            }
        }

        if (messageIds.length > 0) {
            await requestRescan(account, path, messageIds);
        }
    } catch (e) {
        console.error(e);
    }
}

async function requestRescan(account, path, messageIds) {
    try {
        let request = {
            Username: accountEmailAddress(account),
            Folder: path,
            MessageIds: messageIds,
        };
        //if (verbose) {
        console.log("Rescan request:", request);
        //}
        let requests = new Requests();
        let response = await requests.post(account.id, "/rescan/", request);
        //if (verbose) {
        console.log("Rescan response:", response);
        //}
        await findContentTab("rescan", true);
        await updateActiveRescans(response);
    } catch (e) {
        console.error(e);
    }
}

//////////////////////////////////////////////////////
//
// selected 'add sender' book management
//
//////////////////////////////////////////////////////

// read add sender target book name from config
async function getAddSenderTarget(accountId) {
    try {
        if (await isAccount(accountId)) {
            const bookNames = await getBookNames(accountId);
            let targets = await config.local.get(config.local.key.addSenderTarget);
            if (targets !== undefined) {
                if (Object.hasOwn(targets, accountId)) {
                    let target = targets[accountId];
                    // ensure the target is present in bookNames
                    if (bookNames.includes(target)) {
                        return target;
                    }
                }
            }
            for (const bookName of bookNames) {
                // select the first book
                await setAddSenderTarget(accountId, bookName);
                return bookName;
            }
        }
    } catch (e) {
        console.error(e);
    }
}

async function getBookNames(accountId, force = false) {
    try {
        const filterctl = await getFilterDataController();
        var books = [];
        const bookData = await filterctl.getBooks(accountId, force);
        for (const bookName of Object.keys(bookData.books.Books)) {
            books.push(bookName);
        }
        return books.sort();
    } catch (e) {
        console.error(e);
    }
}

async function setAddSenderTarget(accountId, bookName) {
    try {
        // side effect: throw error if invalid id
        await getAccount(accountId);
        let targets = await config.local.get(config.local.key.addSenderTarget);
        if (targets === undefined) {
            targets = {};
        }
        if (bookName !== targets[accountId]) {
            targets[accountId] = bookName;
            await config.local.set(config.local.key.addSenderTarget, targets);
            if (verbose) {
                console.debug("changed addSenderTarget:", accountId, bookName, targets);
            }

            // inform editor the addSender Target has Changed
            await sendMessage({
                id: "addSenderTargetChanged",
                accountId: accountId,
                bookName: bookName,
                dst: "editor",
            });

            // update the message display action button
            let messageDisplayActionAccountId = await config.session.get(config.session.key.messageDisplayActionAccountId);
            if (messageDisplayActionAccountId === accountId) {
                await updateMessageDisplayAction(accountId, bookName);
            }
        }
    } catch (e) {
        console.error(e);
    }
}

/*
async function handleAddSenderToFilterBook(message) {
    try {
        let tab = await selectedMessagesTab();
        await addSenderToFilterBook(message.accountId, tab, message.bookName);
    } catch (e) {
        console.error(e);
    }
}
*/

///////////////////////////////////////////////////////////////////////////////
//
//  Address Book Filter actions
//
///////////////////////////////////////////////////////////////////////////////

async function onMenuAddSenderClicked(target, detail) {
    try {
        // NOTE: event target,detail contain messages context-clicked, which
        // will differ from the selected messages
        // TODO: ensure the context-clicked messages are acted upon, rather than the selected messages

        if (verbose) {
            console.debug("onMenuAddSenderClicked:", target.id, { target, detail });
        }
        const fields = target.id.split(";");
        const mid = fields[0];
        const accountId = fields[2];
        const bookName = fields[3];
        let messageList = undefined;
        if (mid === "rmfAddSenderMessageList") {
            // this is a context-click in the message list
            // get target messages from the event info
            messageList = detail.info.selectedMessages;
        } else if (mid === "rmfAddSenderMessageDisplayAction") {
            // this is a message display action menu click
            // get target messages from the mailTab selected messages
            messageList = await messenger.mailTabs.getSelectedMessages(detail.tab.id);
        } else {
            throw new Error(`Unexpected menuId: ${target.id}`);
        }
        await addSenderToFilterBook(accountId, bookName, messageList);
    } catch (e) {
        console.error(e);
    }
}

// perform 'addSender' function on messageList
// TODO: move messages to FilterBook folder
// TODO: scan message folder for other messages with matching From address and move to FilterBook folder
async function addSenderToFilterBook(accountId, book, messageList) {
    try {
        //if (verbose) {
        console.debug("addSenderToFilterBook:", { accountId, book, messageList });
        //}

        // sendersAdded prevents multiple calls to processAddSender for the same From address
        let sendersAdded = new Map();

        const filterctl = await getFilterDataController();

        let folderIds = new Map();
        let messageIds = new Map();

        let page = messageList;
        let messages = page.messages;
        while (messages.length) {
            for (const message of messages) {
                if (accountId !== message.folder.accountId) {
                    console.error("message folder account mismatch:", { accountId, book, message });
                    throw new Error("message folder account mismatch");
                }
                var sender = String(message.author)
                    .replace(/^[^<]*</g, "")
                    .replace(/>.*$/g, "");

                if (!sendersAdded.has(sender)) {
                    // NOTE: not awaiting processAddSender
                    processAddSender(filterctl, accountId, sender, book);
                    sendersAdded.set(sender, true);
                }
                messageIds.set(message.id, true);
                folderIds.set(message.folder.id, true);
            }
            if (page.id) {
                page = await messenger.messages.continueList(page.id);
                messages = page.messages;
            } else {
                break;
            }
        }

        if (await config.local.getBool(config.local.key.addSenderFolderScan)) {
            for (const senderAddress of sendersAdded.keys()) {
                for (const folderId of folderIds.keys()) {
                    let scanIds = await scanFolderMessageSender(accountId, folderId, senderAddress);
                    for (const messageId of scanIds) {
                        messageIds.set(messageId, true);
                    }
                }
            }
        }
        await moveMessagesToFilterBook(accountId, book, Array.from(messageIds.keys()));
    } catch (e) {
        console.error(e);
    }
}

async function scanFolderMessageSender(accountId, folderId, senderAddress) {
    try {
        console.log("scanFolderMessageSender:", { accountId, folderId, senderAddress });
        let messageIds = [];
        let pageId = await messenger.messages.query({
            accountId,
            folderId,
            author: senderAddress,
            returnMessageListId: true,
        });
        while (pageId) {
            let page = await messenger.messages.continueList(pageId);
            for (const message of page.messages) {
                console.log("adding:", message.id, message);
                messageIds.push(message.id);
            }
            pageId = page.id;
        }
        return messageIds;
    } catch (e) {
        console.error(e);
    }
}

async function processAddSender(filterctl, accountId, sender, book) {
    try {
        if (verbose) {
            console.log("AddSender request:", accountId, sender, book);
        }
        let display = await displayProcess(`Adding '${sender}' to '${book}'...`, 0, 10, { ticker: 1 });
        try {
            let response = await filterctl.addSenderToFilterBook(accountId, sender, book);
            await display.complete(`Added '${sender}' to '${book}'`);
            if (verbose) {
                console.log("AddSender completed:", accountId, sender, book, response);
            }
        } catch (e) {
            await display.fail(`AddSender '${sender}' to '${book}' failed: ${e}`);
            if (verbose) {
                console.error("AddSender failed:", accountId, sender, book, e);
            }
        }
    } catch (e) {
        console.error(e);
    }
}

///////////////////////////////////////////////////////////////////////////////
//
//  Filter Data Controller
//
///////////////////////////////////////////////////////////////////////////////

async function handleCacheControl(message) {
    try {
        var result;
        switch (message.command) {
            case "clear":
                await config.local.remove(config.local.key.filterctlState);
                result = "cleared";
                break;
            case "enable":
                if (config.local.getBool(config.local.key.filterctlCacheEnabled, true)) {
                    // if already enabled, return without changing filterctl cache
                    return "enabled";
                }
                config.local.setBool(config.local.key.filterctlCacheEnabled, true);
                result = "enabled";
                break;
            case "disable":
                config.local.setBool(config.local.key.filterctlCacheEnabled, false);
                result = "disabled";
                break;
            default:
                throw new Error("unknown cacheControl command: " + message.command);
        }
        const filterctl = await getFilterDataController({ forceReload: true, readState: false, purgePending: true });
        await filterctl.resetState();
        return result;
    } catch (e) {
        console.error(e);
    }
}

async function handleGetCardDAVBooks(message) {
    try {
        const filterctl = await getFilterDataController();
        let books = await filterctl.getCardDAVBooks(message.accountId);
        let result = books;
        if (message.names === true) {
            result = [];
            for (const book of books) {
                result.push(book.name);
            }
        }
        return result;
    } catch (e) {
        console.error(e);
    }
}

async function handleGetBooks(message) {
    try {
        const filterctl = await getFilterDataController();
        const force = message.force ? true : false;
        const books = await filterctl.getBooks(message.accountId, force);
        return books;
    } catch (e) {
        console.error(e);
    }
}

async function handleSetBooks(message) {
    try {
        const filterctl = await getFilterDataController();
        const result = await filterctl.setBooks(message.accountId, message.books);
        await filterctl.writeState();
        return result;
    } catch (e) {
        console.error(e);
    }
}

async function handleSendBooks(message) {
    try {
        const filterctl = await getFilterDataController();
        const force = message.force ? true : false;
        let result = await filterctl.sendBooks(message.accountId, force);
        await filterctl.writeState();
        return result;
    } catch (e) {
        console.error(e);
    }
}

async function handleSendAllBooks(message) {
    try {
        const filterctl = await getFilterDataController();
        const force = message.force ? true : false;
        const result = await filterctl.sendAllBooks(force);
        await filterctl.writeState();
        return result;
    } catch (e) {
        console.error(e);
    }
}

async function handleRefreshBooks() {
    try {
        const filterctl = await getFilterDataController();
        let force = true;
        const accounts = await getAccounts();
        for (const accountId of Object.keys(accounts)) {
            await filterctl.getBooks(accountId, force);
        }
        await filterctl.writeState();
    } catch (e) {
        console.error(e);
    }
}

async function handleRefreshAllBooks() {
    try {
        const filterctl = await getFilterDataController();
        let force = true;
        const accounts = await getAccounts();
        for (const accountId of Object.keys(accounts)) {
            await filterctl.getBooks(accountId, force);
        }
        await filterctl.writeState();
    } catch (e) {
        console.error(e);
    }
}

async function handleSetDefaultBooks(message) {
    try {
        const filterctl = await getFilterDataController();
        const result = await filterctl.setDefaultBooks(message.accountId);
        await filterctl.writeState();
        return result;
    } catch (e) {
        console.error(e);
    }
}

///////////////////////////////////////////////////////////////////////////////
//
//  runtime message handlers
//
///////////////////////////////////////////////////////////////////////////////

async function handleGetClasses(message) {
    try {
        const filterctl = await getFilterDataController();
        const force = message.force ? true : false;
        const classes = await filterctl.getClasses(message.accountId, force);
        return classes;
    } catch (e) {
        console.error(e);
    }
}

async function handleSetClasses(message) {
    try {
        if (verbose) {
            console.debug("handleSetClasses:", message);
        }
        const filterctl = await getFilterDataController();
        const result = await filterctl.setClasses(message.accountId, message.classes);
        if (result.valid) {
            await filterctl.writeState();
        }
        return result;
    } catch (e) {
        console.error(e);
    }
}

async function handleSendClasses(message) {
    try {
        const filterctl = await getFilterDataController();
        const force = message.force ? true : false;
        let result = await filterctl.sendClassses(message.accountId, force);
        if (verbose) {
            console.debug("sendClasses result:", result);
        }
        await filterctl.writeState();
        return result;
    } catch (e) {
        console.error(e);
    }
}

async function handleSendAllClasses(message) {
    try {
        const filterctl = await getFilterDataController();
        const force = message.force ? true : false;
        const result = await filterctl.sendAllClasses(force);
        if (verbose) {
            console.debug("sendAllClasses result:", result);
        }
        await filterctl.writeState();
        return result;
    } catch (e) {
        console.error(e);
    }
}

async function handleRefreshClasses(message) {
    try {
        const filterctl = await getFilterDataController();
        const force = true;
        const result = await filterctl.getClasses(message.accountId, force);
        return result;
    } catch (e) {
        console.error(e);
    }
}

async function handleRefreshAllClasses() {
    try {
        const filterctl = await getFilterDataController();
        const result = await filterctl.refreshAllClasses();
        await filterctl.writeState();
        return result;
    } catch (e) {
        console.error(e);
    }
}

async function handleSetDefaultClasses(message) {
    try {
        const filterctl = await getFilterDataController();
        const result = await filterctl.setClassesDefaults(message.accountId);
        await filterctl.writeState();
        return result;
    } catch (e) {
        console.error(e);
    }
}

async function handleGetPassword(message) {
    try {
        const filterctl = await getFilterDataController();
        const password = await filterctl.getPassword(message.accountId);
        return password;
    } catch (e) {
        console.error(e);
    }
}

async function handleGetConfigValue(message) {
    try {
        return await config.local.get(message.key);
    } catch (e) {
        console.error(e);
    }
}

async function handleSetConfigValue(message) {
    try {
        await config.local.set(message.key, message.value);
    } catch (e) {
        console.error(e);
    }
}

async function handleResetConfigToDefaults(message) {
    try {
        if (verbose) {
            config.debug("resetConfigToDefaults:", message);
        }
        config.log;
    } catch (e) {
        console.error(e);
    }
}

async function handleSendCommand(message) {
    try {
        let account;
        if (Object.hasOwn(message, "accountId")) {
            account = await getAccount(message.accountId);
        } else {
            account = await getSelectedAccount();
        }
        var command = message.command.trim();
        if (message.argument) {
            command += " " + message.argument.trim();
        }
        return await email.sendRequest(account.id, command, message.body, message.timeout);
    } catch (e) {
        console.error(e);
    }
}

async function onDisplayedFolderChanged(tab, displayedFolder) {
    try {
        if (verbose) {
            console.log("onDisplayedFolderChanged:", displayedFolder.accountId, tab, displayedFolder);
        }
        let accountId = displayedFolder.accountId;
        let folder = displayedFolder.name;
        let email = "disabled";
        if (await isAccount(accountId)) {
            let account = await getAccount(accountId);
            email = accountEmailAddress(account);
        }
        console.log("displayedFolderChanged", { accountId, email, folder });
        await updateMessageDisplayAction(accountId);
    } catch (e) {
        console.error(e);
    }
}

async function onSelectedMessagesChanged(tab, selectedMessages) {
    try {
        if (verbose) {
            console.log("onSelectedMessagesChanged:", tab, selectedMessages);
        }
        for (const message of selectedMessages.messages) {
            let accountId = message.folder.accountId;
            await updateMessageDisplayAction(accountId);
            return;
        }
    } catch (e) {
        console.error(e);
    }
}

async function autoOpen() {
    try {
        let cacheCleared = await config.local.getBool(config.local.key.cacheCleared);
        await config.local.remove(config.local.key.cacheCleared);

        let autoOptions = await config.local.getBool(config.local.key.autoOpenOptions);
        await config.local.remove(config.local.key.autoOpenOptions);

        if (autoOptions === true) {
            await messenger.runtime.openOptionsPage();
        } else if (cacheCleared === true) {
            await focusEditorWindow();
        }
    } catch (e) {
        console.error(e);
    }
}

async function onLoad() {
    try {
        console.warn("onLoad");
        await autoOpen();
    } catch (e) {
        console.error(e);
    }
}

async function onFolderCreated(createdFolder) {
    try {
        console.log("onFolderCreated:", createdFolder);

        let autoFilterBooks = await config.local.getBool(config.local.key.autoFilterBooks);
        if (!autoFilterBooks) {
            return;
        }

        let accountId = createdFolder.accountId;
        let accountEnabled = await isAccount(accountId);
        if (!accountEnabled) {
            return;
        }

        let isFilterBookFolder = createdFolder.path.match(/^[/]FilterBooks[/]([^/][^/]*)$/);
        if (!isFilterBookFolder) {
            return;
        }

        let bookName = isFilterBookFolder[1].toLowerCase();

        const bookNames = await getBookNames(accountId, true);

        if (!bookNames.includes(bookName)) {
            if (!isValidBookName(bookName)) {
                let message = `FilterBook folder '${bookName}' is not a valid Filter Book name. A matching FilterBook can not be created, and the Mail Filter will not route messages to it.  Do you wish to delete this newly created folder?`;
                const confirmed = await messenger.servicesPrompt.confirm("Invalid FilterBook Name Format", message);
                if (confirmed) {
                    await messenger.folders.delete(createdFolder.id);
                }
                return;
            }
            await closeEditor();
            let response = await email.sendRequest(accountId, "mkbook " + bookName);
            console.log("created FilterBook:", response);
            await getBookNames(accountId, true);
            await initMenus();
        }
    } catch (e) {
        console.error(e);
    }
}

async function onFolderDeleted(folder) {
    try {
        console.log("onFolderDeleted:", folder);
        let accountId = folder.accountId;
        let enabled = await isAccount(accountId);
        let isFilterBook = folder.path.match(/^[/]FilterBooks[/]([^/][^/]*)$/);
        if (enabled && isFilterBook) {
            let bookName = isFilterBook[1].toLowerCase();
            const bookNames = await getBookNames(accountId, true);
            if (bookNames.includes(bookName)) {
                let message = `Do you want to delete FilterBook '${bookName}' including all sender addresses?`;
                let confirmed = await messenger.servicesPrompt.confirm("Confirm FilterBook Delete", message);
                if (confirmed) {
                    await closeEditor();
                    let response = await email.sendRequest(accountId, "rmbook " + bookName);
                    console.log("deleted FilterBook:", response);
                    await getBookNames(accountId, true);
                    await initMenus();
                }
            }
        }
    } catch (e) {
        console.error(e);
    }
}

async function onMessageDisplayActionClicked(tab, info) {
    try {
        if (verbose) {
            console.log("onMessageDisplayActionClicked:", { tab, info });
        }
        console.assert(tab.type === "mail", "unexpected tab type");
        let accountId = await selectedMessagesAccountId();
        console.assert(await isAccount(accountId), "messageDisplayActionClicked on disabled account");
        let bookName = await getAddSenderTarget(accountId);
        let messageList = await messenger.mailTabs.getSelectedMessages(tab.id);
        await addSenderToFilterBook(accountId, bookName, messageList);
    } catch (e) {
        console.error(e);
    }
}

///////////////////////////////////////////////////////////////////////////////
//
//  event wiring
//
///////////////////////////////////////////////////////////////////////////////

messenger.runtime.onInstalled.addListener(onInstalled);
messenger.runtime.onStartup.addListener(onStartup);
messenger.runtime.onSuspend.addListener(onSuspend);
messenger.runtime.onSuspendCanceled.addListener(onSuspendCanceled);
messenger.runtime.onUpdateAvailable.addListener(onUpdateAvailable);

messenger.runtime.onMessage.addListener(onMessage);

messenger.menus.onClicked.addListener(onMenuClicked);
messenger.menus.onShown.addListener(onMenuShown);

messenger.mailTabs.onDisplayedFolderChanged.addListener(onDisplayedFolderChanged);
messenger.mailTabs.onSelectedMessagesChanged.addListener(onSelectedMessagesChanged);

messenger.messageDisplayAction.onClicked.addListener(onMessageDisplayActionClicked);

messenger.commands.onCommand.addListener(onCommand);
messenger.action.onClicked.addListener(onActionButtonClicked);

messenger.folders.onCreated.addListener(onFolderCreated);
messenger.folders.onDeleted.addListener(onFolderDeleted);

window.addEventListener("load", onLoad);

console.warn("END background.js");
