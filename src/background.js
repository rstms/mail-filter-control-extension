console.warn("BEGIN background.js");

import { isAccount, getAccounts, getAccount, getSelectedAccount } from "./accounts.js";
import * as ports from "./ports.js";
import { accountEmailAddress } from "./common.js";
import { displayProcess } from "./display.js";
import { FilterDataController } from "./filterctl.js";
import { email } from "./email.js";
import { config } from "./config.js";
import { verbosity } from "./common.js";

/* globals messenger, console, window */

// FIXME: test when no imap accounts are present
// FIXME  test when no domains are selected

// control flags
const verbose = verbosity.background;

// state vars
let loaded = false;
let filterDataController = null;
let initialized = false;
let approved = false;

let pendingConnections = new Map();
const backgroundId = "background-page";

// updated when messageDisplayAction button is updated
let messageDisplayActionAccountId = undefined;

// updated when onDisplayedFolderChanged events received
let displayedFolderAccountId = undefined;

let menus = {};

///////////////////////////////////////////////////////////////////////////////
//
//  startup and suspend state management
//
///////////////////////////////////////////////////////////////////////////////

/*
class InitState {
    constructor() {
        this.complete = false;
        this.resolve = null;
    }

    setCompleted() {
        console.log("InitState: setCompleted");
        this.complete = true;
        if (this.resolve !== null) {
            console.log("InitState: resolving:", true);
            this.resolve(true);
        }
    }

    isCompleted() {
        return new Promise((resolve) => {
            if (this.complete) {
                console.log("InitState: returning true without wait");
                resolve(true);
            } else {
                console.log("InitState: returning promise");
                this.resolve = resolve;
            }
        });
    }
}

let initState = new InitState();
*/

async function initialize(mode) {
    try {
        if (await config.local.getBool(config.key.autoClearConsole)) {
            console.clear();
        }

        console.warn("initialize:", { mode, approved });

        const manifest = await messenger.runtime.getManifest();
        await messenger.backgroundSend.set(false);
        let backgroundSend = await messenger.backgroundSend.get();
        console.log(`${manifest.name} v${manifest.version} (${mode}) Approved=${approved} backgroundSend=${backgroundSend}`);

        if (verbose) {
            console.debug({
                config: await config.local.getAll(),
                commands: await messenger.commands.getAll(),
            });
        }

        console.assert(loaded, "initialize called before onLoad");

        if (!approved) {
            await messenger.runtime.openOptionsPage();
            return;
        }

        await getFilterDataController({ readState: true, purgePending: true });

        await initMenus();

        initialized = true;
    } catch (e) {
        console.error(e);
    }
}

async function getFilterDataController(flags = { force: false, readState: true, purgePending: false }) {
    try {
        if (filterDataController === null || flags.force) {
            filterDataController = new FilterDataController(email);
            if (flags.readState) {
                console.warn("reloading filterctl state");
                await filterDataController.readState();
            }
        }
        if (flags.purgePending) {
            await filterDataController.purgePending();
        }
        return filterDataController;
    } catch (e) {
        console.error(e);
    }
}

async function onStartup() {
    try {
        const approved = await isApproved();
        console.warn("onStartup:", { approved });
        await initialize("startup");
    } catch (e) {
        console.error(e);
    }
}

async function onInstalled() {
    try {
        const approved = await isApproved();
        console.warn("onInstalled:", { approved });
        await initialize("installed");
    } catch (e) {
        console.error(e);
    }
}

async function postEditorMessage(message, flags = { requireSuccess: false }) {
    try {
        var port = await ports.get("editor", ports.NO_WAIT);
        if (port === undefined) {
            if (flags.requireSuccess === false) {
                return false;
            }
            throw new Error("editor not connected");
        } else {
            if (typeof message === "string") {
                message = { id: message };
            }
            message.src = backgroundId;
            await port.postMessage(message);
        }
        return true;
    } catch (e) {
        console.error(e);
    }
}

async function onSuspend() {
    try {
        console.warn("background suspending");
        await postEditorMessage("backgroundSuspending");
    } catch (e) {
        console.error(e);
    }
}

async function onSuspendCanceled() {
    try {
        console.warn("background suspend canceled");
        await postEditorMessage("backgroundSuspendCanceled");
    } catch (e) {
        console.error(e);
    }
}

async function findEditorTab() {
    try {
        const editorTitle = await config.local.get(config.key.editorTitle);
        const tabs = await messenger.tabs.query({ type: "content", title: editorTitle });
        for (const tab of tabs) {
            if (tab.title === editorTitle) {
                return tab;
            }
        }
        return null;
    } catch (e) {
        console.error(e);
    }
}

async function reconnectEditor(flags = { activate: false }) {
    try {
        if (verbose) {
            console.debug("reconnectEditor");
        }

        var editorTab = await findEditorTab();
        if (verbose) {
            console.debug("editor tab:", editorTab);
        }

        var port = await ports.get("editor", ports.NO_WAIT);
        if (verbose) {
            console.debug("editor port:", port);
        }

        if (editorTab) {
            if (flags.activate) {
                await messenger.tabs.update(editorTab.id, { active: true });
            }
            if (port === undefined) {
                // editor is open but port is null; assume we're coming back from being suspended
                if (verbose) {
                    console.debug("sending activated notification");
                }
                let response = await messenger.runtime.sendMessage({ id: "backgroundActivated", src: backgroundId });
                if (verbose) {
                    console.debug("activated notification response:", response);
                }
            }
            return true;
        }
        if (verbose) {
            console.debug("editor tab not open");
        }
        return false;
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
        if (!(await checkApproved())) {
            return;
        }

        if (!(await reconnectEditor({ activate: true }))) {
            await messenger.tabs.create({ url: "./editor.html" });
        }
    } catch (e) {
        console.error(e);
    }
}

///////////////////////////////////////////////////////////////////////////////
//
//  messages handler
//
///////////////////////////////////////////////////////////////////////////////

async function onConnect(port) {
    try {
        if (verbose) {
            console.debug("onConnect:", port);
        }
        port.onMessage.addListener(onPortMessage);
        port.onDisconnect.addListener(onDisconnect);
        if (pendingConnections.has(port.name)) {
            console.error("onConnect: pending connection exists:", port.name);
        }
        pendingConnections.set(port.name, port);
        if (verbose) {
            console.log("background received connection request:", port.name);
        }
        port.postMessage({ id: "ENQ", src: backgroundId, dst: port.name });

        if (verbose) {
            console.debug("returning from onConnect");
        }
    } catch (e) {
        console.error(e);
    }
}

async function onPortMessage(message, sender) {
    try {
        if (verbose) {
            console.debug("background.onPortMessage:", message, sender);
        }
        console.error("unexpected port message:", message, sender);
    } catch (e) {
        console.error(e);
    }
}

async function onCommand(command, tab) {
    try {
        if (verbose) {
            console.debug("onCommand:", command, tab);
        }
        if (!(await checkApproved())) {
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

async function onMessage(message, sender) {
    try {
        if (verbose) {
            console.debug("background.onMessage:", message, sender);
            console.log("background.OnMessage received:", message.id, message.src);
        }

        let response = undefined;
        let port = undefined;

        // process messages not requiring connection
        switch (message.id) {
            case "focusEditorWindow":
                await focusEditorWindow();
                return;

            case "ACK":
                if (message.id === "ACK") {
                    port = pendingConnections.get(message.src);
                } else {
                    port = await ports.get(message.src, ports.NO_WAIT);
                }
                console.log("background accepted connection:", port.name);
                ports.add(port);
                pendingConnections.delete(port.name);
                response = { background: backgroundId };
                response[ports.portLabel(port)] = port.name;
                return response;

            case "isInitialized":
                return initialized;
            //await initState.isCompleted();
        }

        if (message.src === undefined || message.dst === undefined) {
            console.error("missing src/dst, discarding:", message);
            return false;
        }

        /*
        if (message.dst !== backgroundId) {
            console.error("unexpected dst ID, discarding:", message);
            return false;
        }
	*/

        /*
        if (port === undefined) {
            console.error("unexpected src ID, discarding:", message);
            return false;
        }
	*/

        switch (message.id) {
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
            case "findEditorTab":
                response = await findEditorTab();
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
                break;
        }
        if (response !== undefined) {
            if (typeof response !== "object") {
                response = { result: response };
            }
        }
        if (verbose) {
            console.log("background.onMessage returning:", response);
        }
        return response;
    } catch (e) {
        console.error(e);
    }
}

async function onDisconnect(port) {
    try {
        if (verbose) {
            console.debug("onDisconnect:", port);
        }
        ports.remove(port);
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

// reset menu configuration from menu config data structure
async function initMenus() {
    try {
        menus = {};
        await messenger.menus.removeAll();
        if (approved) {
            for (let [mid, config] of Object.entries(menuConfig)) {
                if (config.noInit !== true) {
                    await createMenu(mid, config);
                }
            }
        }
        await messenger.menus.refresh();

        // save menu config in session storage
        await config.session.set(config.key.menuConfig, menus);
        console.log("saved menu config:", menus);

        // FIXME: maybe we don't need to update the messaage display action here
        // because it will be done on onDisplayedFolderChanged and/or onSelectedMessagesChanged
        const accountId = await selectedMessagesAccountId();
        await updateMessageDisplayAction(accountId);
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
        // if accountd specified, ensure it is valid
        if (accountId !== undefined) {
            if (!(await isAccount(accountId))) {
                accountId = undefined;
                book = undefined;
            }
        }
        messageDisplayActionAccountId = accountId;
        if (approved && accountId !== undefined) {
            if (book === undefined) {
                book = await getAddSenderTarget(accountId);
            }
            await messenger.messageDisplayAction.setTitle({ title: "Add to '" + book + "'" });
            await messenger.messageDisplayAction.enable();
        } else {
            await messenger.messageDisplayAction.setTitle({ title: "Add Sender Disabled" });
            await messenger.messageDisplayAction.disable();
        }
    } catch (e) {
        console.error(e);
    }
}

async function createMenu(mid, config) {
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
            await handler(created);
        }
    } catch (e) {
        console.error(e);
    }
}

///////////////////////////////////////////////////////////////////////////////
//
//  menu handler helpers
//
///////////////////////////////////////////////////////////////////////////////

async function isApproved() {
    try {
        return await config.local.getBool(config.key.optInApproved);
    } catch (e) {
        console.error(e);
    }
}

// if opt-in not approved, divert to extension options panel and return false
async function checkApproved() {
    try {
        let approved = await isApproved();
        if (!approved) {
            await messenger.runtime.openOptionsPage();
        }
        return approved;
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
            console.debug("onMenuClicked:", { info, tab, approved, loaded });
        }
        if (!approved) {
            return;
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
        let initialized = await messenger.storage.session.get(["initialized"]);
        if (verbose) {
            console.debug("onMenuShown:", { info, tab, approved, loaded, initialized });
        }
        if (!approved) {
            return;
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
        console.assert(Array.isArray(mids));
        let refresh = false;
        let detail = await menuEventDetail(info, tab);
        if (menuEvent === "onShown" && detail.setVisibility) {
            await setMenuVisibility(detail.accountId, detail.context);
            refresh = true;
        }
        for (let mid of mids) {
            if (Object.hasOwn(menus, mid)) {
                if (Object.hasOwn(menus[mid], menuEvent)) {
                    let handler = getMenuHandler(menus[mid][menuEvent]);
                    let changed = await handler(menus[mid], detail);
                    refresh ||= changed;
                }
            } else {
                console.error("menu not found:", menuEvent, mid, { detail, menus });
                throw new Error("menu not found");
            }
        }
        if (refresh) {
            await messenger.menus.refresh();
        }
    } catch (e) {
        console.error(e);
    }
}

async function setMenuVisibility(accountId, context) {
    try {
        if (verbose) {
            console.debug("setMenuVisibility:", accountId, context);
        }

        let book = accountId === undefined ? undefined : await getAddSenderTarget(accountId);
        for (const config of Object.values(menus)) {
            if (config.properties.contexts.includes(context)) {
                let properties = {};
                properties.visible = accountId !== undefined;
                if (properties.visible && config.accountId !== undefined) {
                    properties.visible = accountId === config.accountId;
                    if (config.properties.type === "radio") {
                        properties.checked = config.properties.title === book;
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
async function onMenuCreatedAddBooks(created) {
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
                await createMenu(id, config);
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
                messageDisplayActionAccountId,
                displayedFolderAccountId,
            });
        }
        console.assert(target.accountId === messageDisplayActionAccountId);
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
                messageDisplayActionAccountId,
                displayedFolderAccountId,
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
                messageDisplayActionAccountId,
                displayedFolderAccountId,
            });
        }
        let account = await getAccount(detail.info.displayedFolder.accountId);
        let path = detail.info.displayedFolder.path;
        let messageIds = [];
        for (const message of detail.info.selectedMessages.messages) {
            messageIds.push(message.headerMessageId);
            console.assert(message.folder.path === path, "message path mismatch");
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

        let message = `Rescanning message ${messageIds[0]} in folder ${path}...`;
        if (messageIds.length > 1) {
            message = `Rescanning ${messageIds.length} Messages in folder '${path}'...`;
        }
        let display = await displayProcess(message, { total: messageIds.length, timeoutSeconds: 300 });
        const body = JSON.stringify(request, null, 2);
        console.log({ message, request, body });
        email
            .sendRequest(account.id, "rescan", body)
            .then((response) => {
                console.log("Rescan response:", response);
                let outcome = response.success ? "complete" : "failed";
                display.complete(`Rescan ${outcome}: ${response.message}`);
            })
            .catch((e) => {
                console.error("Rescan failed:", e);
                display.complete(`Rescan failed: ${e}`);
            });
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
            let targets = await config.local.get(config.key.addSenderTarget);
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

// write add sender target book name to config
async function setAddSenderTarget(accountId, bookName) {
    try {
        // side effect: throw error if invalid id
        await getAccount(accountId);
        let targets = await config.local.get(config.key.addSenderTarget);
        if (targets === undefined) {
            targets = {};
        }
        if (bookName !== targets[accountId]) {
            targets[accountId] = bookName;
            await config.local.set(config.key.addSenderTarget, targets);
            if (verbose) {
                console.debug("changed addSenderTarget:", accountId, bookName, targets);
            }
            await postEditorMessage({
                id: "addSenderTargetChanged",
                accountId: accountId,
                bookName: bookName,
            });
            if (messageDisplayActionAccountId !== undefined && messageDisplayActionAccountId === accountId) {
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
        let sendersAdded = [];
        const filterctl = await getFilterDataController();
        for (const message of messageList.messages) {
            if (accountId !== message.folder.accountId) {
                console.error("message folder account mismatch:", { accountId, tab, book, message });
                throw new Error("message folder account mismatch");
            }
            const fullMessage = await messenger.messages.getFull(message.id);
            const headers = fullMessage.headers;
            if (verbose) {
                console.debug({ author: message.author, accountId, book, message, headers });
            }
            var sender = String(message.author)
                .replace(/^[^<]*</g, "")
                .replace(/>.*$/g, "");
            if (!sendersAdded.includes(sender)) {
                let display = await displayProcess(`Adding '${sender}' to '${book}'...`);
                console.log("AddSender request:", sender, book, accountId);
                filterctl
                    .addSenderToFilterBook(accountId, sender, book)
                    .then((response) => {
                        display.complete(`Added '${sender}' to '${book}'`).then(() => {
                            console.log("AddSender completed:", sender, book, accountId, response);
                        });
                    })
                    .catch((e) => {
                        display.complete(`AddSender '${sender}' to '${book}' failed: ${e}`).then(() => {
                            console.error("AddSender failed:", sender, book, accountId, e);
                        });
                    });
                sendersAdded.push(sender);
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
        switch (message.command) {
            case "clear":
                await getFilterDataController({ force: true, resetState: true });
                return "cleared";
            case "enable":
                await getFilterDataController({ force: true, enablePersistence: true });
                return "enabled";
            case "disable":
                await getFilterDataController({ force: true, enablePersistence: false });
                return "disabled";
            default:
                throw new Error("unknown cacheControl command: " + message.command);
        }
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
        await filterctl.writeState();
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

async function onLoad() {
    try {
        loaded = true;
        approved = await isApproved();
        console.warn("onLoad:", { approved });

        if (approved) {
            let menuConfig = await config.session.get(config.key.menuConfig);
            if (menuConfig !== undefined) {
                // we're awakening from suspension, so restore the menu config
                menus = menuConfig;
            }
        }

        if (await config.local.getBool(config.key.reloadAutoOptions)) {
            await config.local.remove(config.key.reloadAutoOptions);
            await messenger.runtime.openOptionsPage();
            return;
        }
        let autoOpen = await config.local.getBool(config.key.autoOpen);
        if (await config.local.getBool(config.key.reloadPending)) {
            await config.local.remove(config.key.reloadPending);
            autoOpen = true;
        }
        if (autoOpen) {
            await focusEditorWindow();
        }
    } catch (e) {
        console.error(e);
    }
}

async function onUpdateAvailable(details) {
    try {
        console.log("onUpdateAvailable:", details);
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

messenger.runtime.onConnect.addListener(onConnect);
messenger.runtime.onMessage.addListener(onMessage);

messenger.menus.onClicked.addListener(onMenuClicked);
messenger.menus.onShown.addListener(onMenuShown);

//messenger.windows.onCreated.addListener(onWindowCreated);

//messenger.tabs.onCreated.addListener(onTabCreated);
//messenger.tabs.onActivated.addListener(onTabActivated);
//messenger.tabs.onUpdated.addListener(onTabUpdated);
//messenger.tabs.onRemoved.addListener(onTabRemoved);

//messenger.messageDisplay.onMessagesDisplayed.addListener(onMessagesDisplayed);
messenger.mailTabs.onDisplayedFolderChanged.addListener(onDisplayedFolderChanged);
messenger.mailTabs.onSelectedMessagesChanged.addListener(onSelectedMessagesChanged);

messenger.commands.onCommand.addListener(onCommand);

messenger.messageDisplayAction.onClicked.addListener(onMessageDisplayActionClicked);
messenger.action.onClicked.addListener(onActionButtonClicked);

window.addEventListener("load", onLoad);

console.warn("END background.js");
