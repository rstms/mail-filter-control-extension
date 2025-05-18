console.warn("BEGIN background.js");

import { isAccount, getAccounts, getAccount, getSelectedAccount } from "./accounts.js";
import { accountEmailAddress } from "./common.js";
import { displayProcess } from "./display.js";
import { FilterDataController } from "./filterctl.js";
import { email } from "./email.js";
import { config, updateActiveRescans } from "./config.js";
import { verbosity } from "./common.js";
import { Requests } from "./requests.js";

/* globals console, messenger, window */

// control flags
const verbose = verbosity.background;

async function isApproved() {
    return config.local.getBool(config.local.key.optInApproved);
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

        if (!(await isApproved())) {
            await initMenus();
            await messenger.runtime.openOptionsPage();
            return;
        }

        await initAPIKeys(mode === "initialize");

        // we've restarted so forget pending filterctl state
        let filterctl = await getFilterDataController();
        await filterctl.purgePending();
        await initMenus();
        await autoOpen();
    } catch (e) {
        console.error(e);
    }
}

async function initAPIKeys(clear = false) {
    try {
        const requests = new Requests();
        if (clear) {
            await requests.clearKeys();
        } else {
            await requests.readKeys();
        }
        const accounts = await getAccounts();
        for (const account of Object.values(accounts)) {
            const username = accountEmailAddress(account);
            let key = await requests.getKey(account.id, username);
            console.log("apiKey:", username, key);
        }
        await requests.writeKeys();
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
        let prefix = "mailfilter-add-sender-";
        if (command.substr(0, prefix.length) === prefix) {
            let suffix = command.substr(prefix.length);
            const tabs = await messenger.tabs.query({ type: "mail" });
            console.assert(tabs.length === 1, "unexpected mail tab query result");
            console.assert(tabs[0].id === tab.id, "command tab is not mail tab");
            return await addSenderAction(tabs[0], suffix);
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
            contexts: ["tools_menu"],
        },
        onClicked: "onMenuControlPanelClicked",
    },

    rmfSelectBook: {
        properties: {
            title: "Set Filter Book Target",
            contexts: ["folder_pane", "message_list"],
        },
        onCreated: "onMenuCreatedAddBooks",
        subId: "rmfBook",
    },

    rmfBook: {
        account: "__account-id__",
        book: "__book__",
        properties: {
            title: "__book__",
            contexts: ["folder_pane", "message_list"],
            parentId: "rmfSelectBook",
            type: "radio",
        },
        onClicked: "onMenuClickedSelectBook",
        noInit: true,
    },

    rmfAddSenderToFilterBook: {
        properties: {
            title: "Add Sender to '__book__'",
            contexts: ["message_list"],
        },
        onClicked: "onMenuAddSenderClicked",
        onShown: "onMenuShownUpdateAddSenderTitle",
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
            title: "Rescan All Messages",
            contexts: ["folder_pane"],
        },
        onClicked: "onMenuRescanFolderClicked",
    },
};

function getMenuHandler(handlerName) {
    try {
        switch (handlerName) {
            case "onMenuControlPanelClicked":
                return onMenuControlPanelClicked;

            case "onMenuCreatedAddBooks":
                return onMenuCreatedAddBooks;

            case "onMenuClickedSelectBook":
                return onMenuClickedSelectBook;

            case "onMenuAddSenderClicked":
                return onMenuAddSenderClicked;

            case "onMenuShownUpdateAddSenderTitle":
                return onMenuShownUpdateAddSenderTitle;

            case "onMenuRescanMessagesClicked":
                return onMenuRescanMessagesClicked;

            case "onMenuRescanFolderClicked":
                return onMenuRescanFolderClicked;
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
        let menus = {};
        await messenger.menus.removeAll();
        if (!(await isApproved())) {
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

async function updateMessageDisplayAction(accountId = undefined, book = undefined) {
    try {
        // if accountId specified, ensure it is valid
        if (accountId !== undefined) {
            if (!(await isAccount(accountId))) {
                accountId = undefined;
                book = undefined;
            }
        }
        await config.session.set(config.session.key.messageDisplayActionAccountId, accountId);
        const approved = await isApproved();
        if (approved && accountId !== undefined) {
            if (book === undefined) {
                book = await getAddSenderTarget(accountId);
            }
            if (book !== undefined) {
                await messenger.messageDisplayAction.setTitle({ title: "Add to '" + book + "'" });
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
    if (menus === undefined) {
        menus = await getMenus();
    }
    let accountId = detail.accountId;
    let context = detail.context;
    try {
        if (verbose) {
            console.debug("setMenuVisibility:", accountId, context);
        }

        let book = accountId === undefined ? undefined : await getAddSenderTarget(accountId);
        for (const config of Object.values(menus)) {
            if (config.properties.contexts.includes(context)) {
                let properties = {};
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
                if (verbose) {
                    console.debug("updating menu:", config.id, properties);
                }
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
                ret.context = "folder_pane";
                ret.setVisibility = true;
            } else if (info.contexts.includes("message_list")) {
                console.assert(!info.contexts.includes("folder_pane"), "conflicting info context");
                ret.context = "message_list";
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
                let config = Object.assign({}, menuConfig.rmfBook);
                config.properties = Object.assign({}, menuConfig.rmfBook.properties);
                let id = `rmfBook-${accountEmail}-${bookName}`;
                config.accountId = accountId;
                config.book = bookName;
                config.properties.title = bookName;
                config.properties.parentId = created.id;
                await createMenu(menus, id, config);
            }
        }
        return true;
    } catch (e) {
        console.error(e);
    }
}

// change text to show selected filter book name or hide if inactive account
async function onMenuShownUpdateAddSenderTitle(target, detail) {
    try {
        if (verbose) {
            console.debug("onMenuShownUpdateAddSenderTitle:", { target, detail });
        }
        if (detail.hasAccount) {
            let book = await getAddSenderTarget(detail.accountId);
            console.assert(target.properties.title === "Add Sender to '__book__'");
            let title = target.properties.title.replace(/__book__/, book);
            await messenger.menus.update(target.id, { title });
        } else {
            await messenger.menus.update(target.id, { visible: false });
        }
        return true;
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
            console.debug("onMenuControlPanel clicked:", target.id, { target, detail });
        }
        await focusEditorWindow();
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
            let targets = await config.local.get(config.local.key.addSenderTarget);
            if (targets !== undefined) {
                if (Object.hasOwn(targets, accountId)) {
                    return targets[accountId];
                }
            }
            for (const bookName of await getBookNames(accountId)) {
                await setAddSenderTarget(accountId, bookName);
                return bookName;
            }
        }
    } catch (e) {
        console.error(e);
    }
}

async function getBookNames(accountId) {
    try {
        const filterctl = await getFilterDataController();
        var books = [];
        const bookData = await filterctl.getBooks(accountId);
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

///////////////////////////////////////////////////////////////////////////////
//
//  Address Book Filter actions
//
///////////////////////////////////////////////////////////////////////////////

async function onMenuAddSenderClicked(target, detail) {
    try {
        if (verbose) {
            console.debug("onMenuAddSenderToFilterBook:", target.id, { target, detail });
        }
        const book = await getAddSenderTarget(detail.accountId);
        await addSenderToFilterBook(detail.accountId, detail.tab, book);
    } catch (e) {
        console.error(e);
    }
}

// perform 'addSender' function on selected messages in tab with specified target book
async function addSenderToFilterBook(accountId, tab, book) {
    try {
        if (verbose) {
            console.debug("addSenderToFilterBook:", accountId, tab, book);
        }
        const messageList = await messenger.mailTabs.getSelectedMessages(tab.id);
        if (verbose) {
            console.debug("messageList:", messageList);
        }
        let sendersAdded = new Map();
        const filterctl = await getFilterDataController();

        let page = messageList;
        let messages = page.messages;
        while (messages.length) {
            for (const message of messages) {
                if (accountId !== message.folder.accountId) {
                    console.error("message folder account mismatch:", { accountId, tab, book, message });
                    throw new Error("message folder account mismatch");
                }
                var sender = String(message.author)
                    .replace(/^[^<]*</g, "")
                    .replace(/>.*$/g, "");

                if (!sendersAdded.has(sender)) {
                    // not awaiting processAddSender
                    processAddSender(filterctl, accountId, sender, book);
                    sendersAdded.set(sender, true);
                }
            }
            if (page.id) {
                page = await messenger.messages.continueList(page.id);
                messages = page.messages;
            } else {
                break;
            }
        }
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

/*
async function messageDisplayActionMessagesAccountId(messages) {
    try {
        let messageAccountIds = new Set();
        let accountId;
        for (const message of messages) {
            accountId = message.folder.accountId;
            messageAccountIds.add(accountId);
        }

        // ensure all selected messages have the same accountId
        if (messageAccountIds.size !== 1) {
            console.error({ messageAccountIds, messages });
            throw new Error("unexpected multiple accountIds in selected messages");
        }

        // ensure the accountId is a valid enabled account
        if (!(await isAccount(accountId))) {
            throw new Error("message display action clicked on inactive account");
        }

        // sanity check that accountId matches messageDispayActionId
        console.assert(accountId === messageDisplayActionAccountId, "unexpected message display action message account");

        return accountId;
    } catch (e) {
        console.error(e);
    }
}
*/

async function addSenderAction(tab, bookIndex = "default") {
    try {
        const accountId = await selectedMessagesAccountId();
        if (accountId !== undefined) {
            let book;
            if (bookIndex === "default") {
                book = await getAddSenderTarget(accountId);
            } else {
                const books = await getBookNames(accountId);
                const indexed = books[parseInt(bookIndex) - 1];
                if (indexed !== undefined) {
                    book = indexed.name;
                }
            }
            if (book !== undefined) {
                await addSenderToFilterBook(accountId, tab, book);
            }
        }
    } catch (e) {
        console.error(e);
    }
}

async function onMessageDisplayActionClicked(tab, info) {
    try {
        if (verbose) {
            console.debug("onMessageDisplayActionClicked:", tab, info);
        }
        await addSenderAction(tab, "default");
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

/*
async function onDisplayedFolderChanged(tab, displayedFolder) {
    try {
        if (verbose) {
            console.log("onDisplayedFolderChanged:", tab, displayedFolder);
        }
        let accountId = displayedFolder.accountId;
        if (!(await isAccount(accountId))) {
            accountId = undefined;
        }
        await updateMessageDisplayAction(accountId);
    } catch (e) {
        console.error(e);
    }
}
*/

async function onSelectedMessagesChanged(tab, selectedMessages) {
    try {
        if (verbose) {
            console.log("onSelectedMessagesChanged:", tab, selectedMessages);
        }
        for (const message of selectedMessages.messages) {
            let accountId = message.folder.accountId;
            if (await isAccount(accountId)) {
                await updateMessageDisplayAction(accountId);
            } else {
                await updateMessageDisplayAction();
            }
            return;
        }
        await updateMessageDisplayAction();
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
        //await initAPIKeys();
        await autoOpen();
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

//messenger.mailTabs.onDisplayedFolderChanged.addListener(onDisplayedFolderChanged);
messenger.mailTabs.onSelectedMessagesChanged.addListener(onSelectedMessagesChanged);

messenger.commands.onCommand.addListener(onCommand);
messenger.messageDisplayAction.onClicked.addListener(onMessageDisplayActionClicked);
messenger.action.onClicked.addListener(onActionButtonClicked);

window.addEventListener("load", onLoad);

console.warn("END background.js");
