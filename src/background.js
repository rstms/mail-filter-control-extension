console.warn("BEGIN background.js");

import { isAccount, getAccounts, getAccount, getSelectedAccount } from "./accounts.js";
import { accountEmailAddress, differ } from "./common.js";
import { displayProcess } from "./display.js";
import { FilterDataController } from "./filterctl.js";
import { email } from "./email.js";
import { config, updateActiveRescans } from "./config.js";
import { verbosity, isValidBookName } from "./common.js";
import { Requests } from "./requests.js";
import { moveMessagesToFilterBook, moveMessagesToInbox } from "./filterbook.js";
import { menuConfig } from "./menu.js";

/* globals console, messenger, window */

// control flags
const verbose = verbosity.background;

// constants for filter book operations
const SENDER = "sender";
const RECIPIENT = "recipient";
const ADD = "add";
const REMOVE = "remove";

///////////////////////////////////////////////////////////////////////////////
//
//  initialization functions
//
///////////////////////////////////////////////////////////////////////////////

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
            await initMenus("approve extension on options page");
            await messenger.runtime.openOptionsPage();
            return;
        }

        // we've restarted so forget pending filterctl state
        let filterctl = await getFilterDataController();
        await filterctl.purgePending();

        // and forget sieveTrace state
        await config.session.remove(config.session.key.sieveTrace);

        await initMenus("extension startup");
        await autoOpen();
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
            console.log("focusEditorWindow");
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
            console.log("focusRescanWindow");
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
        let tab = await findContentTab(name);
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
            console.debug("background sent ENQ, got:", response);
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
                console.debug("tab not open, not sending");
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
            console.log("onCommand:", command, tab);
        }

        if (!(await isApproved())) {
            await messenger.runtime.openOptionsPage();
            return;
        }
        if (tab.type !== "mail") {
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
                    console.debug("Command AddSenderToFilterBook:", { command, accountId, bookName, messageList });
                    await addSenderToFilterBook(accountId, bookName, messageList);
                } else {
                    console.debug("Command AddSenderToAddressBook: book not found:", { command, suffix, bookNames });
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
            console.log("background.onMessage:", message, sender);
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
                    console.debug("background received ENQ, returning:", response);
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
                response = await setAddSenderTarget(message.accountId, message.bookName, { fromHandleMessage: true });
                break;
            case "getAddSenderTarget":
                response = await getAddSenderTarget(message.accountId);
                break;
            case "initMenus":
                response = await initMenus("editor filter book change");
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

function getMenuHandler(handlerName) {
    try {
        switch (handlerName) {
            case "onMenuAddBooksCreated":
                return onMenuAddBooksCreated;

            case "onMenuSieveTraceCreated":
                return onMenuSieveTraceCreated;

            case "onMenuControlPanelClicked":
                return onMenuControlPanelClicked;

            case "onMenuOpenRescansClicked":
                return onMenuOpenRescansClicked;

            case "onMenuSelectBookClicked":
                return onMenuSelectBookClicked;

            case "onMenuRescanMessagesClicked":
                return onMenuRescanMessagesClicked;

            case "onMenuRescanFolderClicked":
                return onMenuRescanFolderClicked;

            case "onMenuSieveTraceClicked":
                return onMenuSieveTraceClicked;

            case "onMenuSieveTraceShown":
                return onMenuSieveTraceShown;

            case "onMenuAddSenderClicked":
                return onMenuAddSenderClicked;

            case "onMenuRemoveSenderClicked":
                return onMenuRemoveSenderClicked;

            case "onMenuAddRecipientClicked":
                return onMenuAddRecipientClicked;

            case "onMenuRemoveRecipientClicked":
                return onMenuRemoveRecipientClicked;
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
            menus = await initMenus("restoring stored config");
        }
        return menus;
    } catch (e) {
        console.error(e);
    }
}

// reset menu configuration from menu config data structure
async function initMenus(message) {
    try {
        // check initPending lock
        if (await config.session.getBool(config.session.key.menuInitPending)) {
            console.warn("menuInitPending set; ignoring reentrant initMenus call");
            return;
        }

        if (verbose) {
            console.warn("BEGIN initMenus:", message);
        }

        // set initPending lock
        await config.session.setBool(config.session.key.menuInitPending, true);

        let menus = {};
        await messenger.menus.removeAll();
        await messenger.menus.refresh();

        if (!(await isApproved())) {
            console.warn("END initMenus: extension not approved, menus cleared");
            await config.session.setBool(config.session.key.menuInitPending, false);
            return;
        }

        //await setMenuInitPending(`Menu update pending (${message})...`);

        for (let [mid, config] of Object.entries(menuConfig)) {
            if (config.noInit !== true) {
                await createMenu(menus, mid, config);
            }
        }
        // save menu config in session storage
        await config.session.set(config.session.key.menuConfig, menus);
        if (verbose) {
            console.debug("saved menu config:", menus);
        }

        const info = await querySelectedMessages();
        await updateMessageDisplayAction(info.accountId, info.folderName);

        // clear initPending lock
        await config.session.setBool(config.session.key.menuInitPending, false);

        //await messenger.menus.remove("rmfMenuUpdatePending");
        await messenger.menus.refresh();
        if (verbose) {
            console.warn("END initMenus");
        }

        return menus;
    } catch (e) {
        console.error(e);
    }
}

// return bool if messages are selected
async function anyMessagesSelected() {
    try {
        const tabs = await messenger.tabs.query({ type: "mail" });
        for (const tab of tabs) {
            const selected = await messenger.mailTabs.getSelectedMessages(tab.id);
            for (const message of selected.messages) {
                return true;
            }
        }
        return false;
    } catch (e) {
        console.error(e);
    }
}

// return accountId, folderName, folderId, folderPath and optional array of currently selected messages
async function querySelectedMessages(options = {}) {
    try {
        let info = { count: 0 };
        if (options.messages) {
            info.messages = new Array();
        }
        const tabs = await messenger.tabs.query({ type: "mail" });
        for (const tab of tabs) {
            const selected = await messenger.mailTabs.getSelectedMessages(tab.id);
            for (const message of selected.messages) {
                if (await isAccount(message.folder.accountId)) {
                    if (info.accountId) {
                        if (info.accountId !== message.folder.accountId) {
                            console.error("multiple accounts in selected messages");
                            return {};
                        }
                    } else {
                        info.accountId = message.folder.accountId;
                    }
                }
                if (info.folderName) {
                    if (info.folderName !== message.folder.name) {
                        console.error("multiple folder names in selected messages");
                        return {};
                    }
                } else {
                    info.folderName = message.folder.name;
                }
                if (info.folderId) {
                    if (info.folderId !== message.folder.id) {
                        console.error("multiple folder ids in selected messages");
                        return {};
                    }
                } else {
                    info.folderId = message.folder.id;
                }

                if (info.folderPath) {
                    if (info.folderPath !== message.folder.path) {
                        console.error("multiple folder paths in selected messages");
                        return {};
                    }
                } else {
                    info.folderPath = message.folder.path;
                }
                if (options.messages) {
                    info.messages.push(message);
                }
                info.count++;
            }
        }
        return info;
    } catch (e) {
        console.error(e);
    }
}

async function updateMessageDisplayAction(accountId = undefined, folder = undefined) {
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

        // check if there are selected messages to avoid messageDisplayAction.SetTitle hang
        const enabled = await anyMessagesSelected();

        // save the accountId for use by message_display_action_menu onClicked
        await config.session.set(config.session.key.messageDisplayActionAccountId, accountId);

        if (approved && folder !== "Sent" && accountId !== undefined) {
            let targetBook = await getAddSenderTarget(accountId);
            if (typeof targetBook === "string" && targetBook !== "" && enabled) {
                await messenger.messageDisplayAction.setTitle({ title: `Add sender to '${targetBook}'` });
                await messenger.messageDisplayAction.enable();
            }
        } else {
            if (enabled) {
                await messenger.messageDisplayAction.setTitle({ title: "" });
                await messenger.messageDisplayAction.disable();
            }
        }
    } catch (e) {
        console.error(e);
    }
}

async function createMenu(menus, mid, config) {
    try {
        if (verbose) {
            console.log("createMenu:", mid, config);
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
            console.debug("createMenu:", mid, {
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
            console.log("onMenuClicked:", { info, tab });
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
            console.log("onMenuShown:", { info, tab });
        }
        const initPending = await config.session.getBool(config.session.key.menuInitPending);
        if (initPending) {
            console.warn("ignoring menu shown while init pending");
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
        let menus = await getMenus();
        console.log("onMenuEvent:", { menus, menuEvent, mids, info, tab });
        if (menus === undefined) {
            return;
        }
        console.assert(Array.isArray(mids));
        let refresh = false;
        let detail = await menuEventDetail(info, tab);
        if (menuEvent === "onShown") {
            await setMenuVisibility(menus, detail);
        }
        for (let mid of mids) {
            if (Object.hasOwn(menus, mid)) {
                if (Object.hasOwn(menus[mid], menuEvent)) {
                    let handler = getMenuHandler(menus[mid][menuEvent]);
                    if (await handler(menus[mid], detail)) {
                        refresh = true;
                    }
                }
            } else {
                console.error("menu not found:", menuEvent, mid, { detail, menus });
                throw new Error("menu not found");
            }
        }
        if (refresh) {
            if (await config.session.getBool(config.session.key.menuInitPending)) {
                console.warn("ignoring menu refresh while init pending");
            } else {
                if (verbose) {
                    console.debug("refreshing menus");
                }
                await messenger.menus.refresh();
            }
        }
    } catch (e) {
        console.error(e);
    }
}

async function getMenuItemVisibility(config, detail) {
    try {
        // if not in the selected context, item is invisible
        if (!config.properties.contexts.includes(detail.context)) {
            return false;
        }

        // these menu ids are always visible if in context
        switch (config.id) {
            case "rmfControlPanel":
                switch (detail.context) {
                    case "tools_menu":
                    case "action":
                        return true;
                }
                return false;
            case "rmfOpenRescans":
                return true;
        }

        // don't show menu items if account is not enabled for mailfilter
        if (!detail.accountId) {
            console.warn(`menu ${config.id} detail has no accountId; setting visible to false`);
            return false;
        }

        if (config.hideAfterCreate === true) {
            return false;
        }

        // if menu config excludes folders, ensure we're not in an excluded folder
        if (Object.hasOwn(config, "excludeFolders")) {
            if (!detail.folderName) {
                throw new Error("missing folder in menu detail");
            }
            if (config.excludeFolders.indexOf(detail.folderName) !== -1) {
                return false;
            }
        }

        // if menu config includes folders, ensure we're in an included folder
        if (Object.hasOwn(config, "includeFolders")) {
            if (!detail.folderName) {
                throw new Error("missing folder in menu detail");
            }
            if (config.includeFolders.indexOf(detail.folderName) === -1) {
                return false;
            }
        }

        if (Object.hasOwn(config, "accountId")) {
            if (detail.accountId !== config.accountId) {
                return false;
            }
        }

        switch (config.id) {
            case "rmfRescanMessages":
            case "rmfRescanFolder":
            case "rmfRescanSeparator":
                return await getRescanVisibility(config.id, detail);
        }

        return true;
    } catch (e) {
        console.error(e);
    }
}

async function setMenuVisibility(menus, detail) {
    try {
        if (verbose) {
            console.log("setMenuVisibility:", config.id, config, detail);
        }
        let refresh = false;
        let book = detail.accountId === undefined ? undefined : await getAddSenderTarget(detail.accountId);
        let selectionPresent = await anyMessagesSelected();
        for (const config of Object.values(menus)) {
            // set item visibility
            const original = Object.assign({}, config.properties);
            config.properties.visible = await getMenuItemVisibility(config, detail);

            // disable if no messages selected
            if (config.requireSelection) {
                config.properties.enabled = selectionPresent;
            }

            // set default book checked state
            if (config.properties.visible && config.properties.type === "radio") {
                config.properties.checked = config.properties.title === book;
            }
            if (verbose) {
                console.debug("updating menu:", config.id, config.properties);
            }
            let changed = false;
            if (differ(original, config.properties)) {
                changed = true;
            }
            if (!config.initialized) {
                changed = true;
                config.initialized = true;
            }
            if (changed) {
                refresh = true;
                await messenger.menus.update(config.id, config.properties);
            }
        }
        if (refresh) {
            if (await config.session.getBool(config.session.key.menuInitPending)) {
                console.warn("skipping menu refresh during init pending: ", config.id);
            } else {
                await messenger.menus.refresh();
            }
        }
        return refresh;
    } catch (e) {
        console.error(e);
    }
}

// return info about the account for onMenuShown handlers
async function menuEventDetail(info, tab) {
    try {
        if (verbose) {
            console.log("menuEventDetail:", info, tab);
        }
        let ret = {
            info,
            tab,
            setVisibility: false,
            hasAccount: false,
            folderName: undefined,
        };

        const accounts = await getAccounts();

        if (Array.isArray(info.selectedFolders)) {
            console.assert(!Object.hasOwn(info, "displayedFolder"), "conflicting info folders");
            if (info.selectedFolders.length > 1) {
                console.warn("ignoring multiple folder selection");
                return ret;
            }
            ret.folderName = info.selectedFolders[0].name;
            if (Object.hasOwn(accounts, info.selectedFolders[0].accountId)) {
                ret.hasAccount = true;
                ret.accountId = info.selectedFolders[0].accountId;
            }
        } else if (Object.hasOwn(info, "displayedFolder")) {
            console.assert(!Object.hasOwn(info, "selectedFolders"), "conflicting info folders");
            ret.folderName = info.displayedFolder.name;
            if (Object.hasOwn(accounts, info.displayedFolder.accountId)) {
                ret.hasAccount = true;
                ret.accountId = info.displayedFolder.accountId;
            }
        }

        if (!Object.hasOwn(info, "contexts")) {
            console.warn("missing info.contexts");
        } else {
            console.assert(Array.isArray(info.contexts), "info.contexts is not Array");
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
                // get accountId from the value stored by onDisplayedFolderChanged handler
                ret.hasAccount = true;
                ret.accountId = await config.session.get(config.session.key.messageDisplayActionAccountId);
                if (!ret.accountId) {
                    const info = await querySelectedMessages();
                    if (await isAccount(info.accountId)) {
                        ret.accountId = info.accountId;
                    }
                    ret.folderName = info.folderName;
                }
                ret.context = "message_display_action";
                ret.setVisibility = true;
            } else if (info.contexts.includes("tools_menu")) {
                console.assert(!info.contexts.includes("message_list"), "conflicting info context");
                console.assert(!info.contexts.includes("folder_pane"), "conflicting info context");
                console.assert(!info.contexts.includes("message_display_action"), "conflicting info context");
                ret.context = "tools_menu";
            } else {
                console.warn("unexpected info.contexts:", info.contexts);
            }
        }

        if (!ret.folderName) {
            console.warn("detail missing folderName");
            if (ret.context === "message_display_action") {
                for (const folder of await messenger.mailTabs.getSelectedFolders()) {
                    ret.folderName = folder.name;
                    break;
                }
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
async function onMenuAddBooksCreated(menus, created) {
    try {
        if (verbose) {
            console.log("onMenuAddBooksCreated:", created);
        }
        const accounts = await getAccounts();
        for (const [accountId, account] of Object.entries(accounts)) {
            let accountEmail = accountEmailAddress(account);
            let bookNames = await getBookNames(accountId);
            if (bookNames && Array.isArray(bookNames)) {
                for (const bookName of await getBookNames(accountId)) {
                    let config = newBookMenuConfig(menuConfig[created.subId], accountId, bookName, created);
                    await createMenu(menus, `${created.id};${accountEmail};${accountId};${bookName}`, config);
                }
            } else {
                console.warn("no books:", accountId);
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
        config.dynamic = true;
        config.accountId = accountId;
        config.book = bookName;
        config.properties.title = config.properties.title.replace(/__book__/, bookName);
        config.properties.contexts = created.properties.contexts;
        config.properties.visible = false;
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
                console.debug("setSieveTrace completed:", accountId, enabled);
            }
        } catch (e) {
            await display.fail(`${action} Sieve Trace for ${email} failed: ${e}`);
            console.error("setSieveTrace failed:", accountId, enabled, e);
        }
    } catch (e) {
        console.error(e);
    }
}

async function onMenuSieveTraceCreated(menus, created) {
    try {
        if (verbose) {
            console.log("onMenuSieveTraceCreated:", created);
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

///////////////////////////////////////////////////////////////////////////////
//
//  Address Book Filter actions
//
///////////////////////////////////////////////////////////////////////////////

async function onMenuSieveTraceShown(target, detail) {
    try {
        if (verbose) {
            console.log("onMenuSieveTraceShown:", target.id, { target, detail });
        }
        if (detail.accountId === undefined || detail.accountId === "") {
            await messenger.menus.update(target.id, { visible: false });
            return true;
        }
        let enabled = await getSieveTrace(detail.accountId);
        await messenger.menus.update(target.id, { checked: enabled });
        return true;
    } catch (e) {
        console.error(e);
    }
}

async function validateOnClicked(config, detail, accountId, folderName, messages) {
    try {
        if (config.accountId && config.accountId !== accountId) {
            throw new Error(`accountId mismatch config=${config.accountId} selected=${accountId}`);
        }
        if (detail.accountId && detail.accountId !== accountId) {
            throw new Error(`accountId mismatch: detail=${config.accountId} selected=${accountId}`);
        }
        if (detail.folderName && detail.folderName !== folderName) {
            throw new Error(`folder name mismatch`);
        }
        if (config.excludeFolders && config.excludeFolders.includes(folderName)) {
            throw new Error(`disabled in ${folderName} folder`);
        }
        if (config.includeFolders && !config.includeFolders.includes(folderName)) {
            throw new Error(`disabled outside ${folderName} folder`);
        }
        if (detail.info && detail.info.selectedMessages) {
            if (differ(messages, detail.info.selectedMessages.messages)) {
                const message = "The context-clicked message differs from the selected messages";
                await messenger.servicesPrompt.alert("Ambiguous selection", message);
                return false;
            }
        }
        if (!(await isAccount(accountId))) {
            throw new Error(`invalid account: ${accountId}`);
        }
        return true;
    } catch (e) {
        console.error(e);
        return false;
    }
}

async function onMenuAddSenderClicked(config, detail) {
    try {
        if (verbose) {
            console.log("onMenuAddSenderClicked:", config.id, { config, detail });
        }
        if (!config.dynamic) {
            throw new Error(`config missing dynamic flag`);
        }
        const filterBook = config.book;
        const selected = await querySelectedMessages({ messages: true });
        if (await validateOnClicked(config, detail, selected.accountId, selected.folderName, selected.messages)) {
            return await filterBookAction(ADD, SENDER, selected.accountId, filterBook, selected.messages, filterBook);
        }
    } catch (e) {
        console.error(e);
    }
}

// add selected messages to named filterbook
async function addSenderToFilterBook(accountId, filterBook) {
    try {
        if (verbose) {
            console.log("onMenuRemoveSenderClicked:", accountId, filterBook);
        }
        const selected = await querySelectedMessages({ messages: true });
        if (!selected) {
            throw new Error("querySelectedMessages failed");
        }
        let config = {
            excludeFolders: ["Sent", "Drafts"],
        };
        if (await validateOnClicked(config, {}, accountId, selected.folderName, selected.messages)) {
            await filterBookAction(ADD, SENDER, accountId, filterBook, selected.messages, filterBook);
        }
    } catch (e) {
        console.error(e);
    }
}

async function onMenuRemoveSenderClicked(config, detail) {
    try {
        if (verbose) {
            console.log("onMenuRemoveSenderClicked:", config.id, { config, detail });
        }
        const selected = await querySelectedMessages({ messages: true });
        if (await validateOnClicked(config, detail, selected.accountId, selected.folderName, selected.messages)) {
            return await filterBookAction(REMOVE, SENDER, selected.accountId, "all filterbooks", selected.messages, "inbox");
        }
    } catch (e) {
        console.error(e);
    }
}

async function onMenuAddRecipientClicked(config, detail) {
    try {
        if (verbose) {
            console.log("onMenuAddRecipientClicked:", config.id, { config, detail });
        }
        const selected = await querySelectedMessages({ messages: true });
        if (await validateOnClicked(config, detail, selected.accountId, selected.folderName, selected.messages)) {
            return await filterBookAction(ADD, RECIPIENT, selected.accountId, "whitelist", selected.messages, false);
        }
    } catch (e) {
        console.error(e);
    }
}

async function onMenuRemoveRecipientClicked(config, detail) {
    try {
        if (verbose) {
            console.log("onMenuRemoveRecipientClicked:", config.id, { config, detail });
        }
        const selected = await querySelectedMessages({ messages: true });
        if (await validateOnClicked(config, detail, selected.accountId, selected.folderName, selected.messages)) {
            return await filterBookAction(REMOVE, RECIPIENT, selected.accountId, "whitelist", selected.messages, false);
        }
    } catch (e) {
        console.error(e);
    }
}

async function filterBookAction(action, addressType, accountId, filterBook, messages, moveDestination = undefined) {
    try {
        if (verbose) {
            console.log("doFilterBookAction: ", action, addressType, accountId, filterBook, messages, moveDestination);
        }

        let op = {};
        switch (action) {
            case ADD:
                op.action = "Add";
                op.actioning = "Adding";
                op.actioned = "Added";
                op.direction = "to";
                break;
            case REMOVE:
                op.action = "Remove";
                op.actioning = "Removing";
                op.actioned = "Removed";
                op.direction = "from";
                break;
            default:
                console.error("unknown action: ", action);
                return;
        }

        const addresses = await scanMessageAddresses(addressType, messages);
        if (addresses.length < 1) {
            console.warn("no addresses selected");
            return false;
        }

        const fids = await scanMessageFolderIds(messages);
        if (fids.length !== 1) {
            console.warn("multiple folders selected");
            return false;
        }
        const folderId = fids[0];

        const filterctl = await getFilterDataController();
        const total = addresses.length;

        op.description = "addresses";
        if (total === 1) {
            op.description = "address";
        }

        const title = `${op.action} ${addressType} ${op.direction} ${filterBook}`;
        const message = `${op.action} ${total} ${addressType} ${op.description} ${op.direction} ${filterBook}?`;
        let confirmed = true;
        if (total > 1) {
            confirmed = await messenger.servicesPrompt.confirm(
                "Confirm ${op.action} ${total} ${op.description} ${op.direction} ${filterBook}",
                message,
            );
        }
        if (confirmed) {
            const display = await displayProcess(
                `${title} - ${op.actioning} ${addressType} ${op.description} ${op.direction} ${filterBook}...`,
                0,
                total,
            );
            let count = 0;
            for (const address of addresses) {
                const status = `${title} - ${op.actioning} ${addressType} ${op.description} ${op.direction} ${filterBook}`;
                await display.update(status, ++count);
                if (verbose) {
                    console.debug(status);
                }
                switch (action) {
                    case ADD:
                        await filterctl.addAddressToFilterBook(accountId, address, filterBook);
                        break;
                    case REMOVE:
                        await filterctl.removeAddressFromFilterBooks(accountId, address);
                        break;
                    default:
                        throw new Error(`Unexpected action: ${action}`);
                }
                if (moveDestination) {
                    const messageIds = await scanMessageFolderMatchingAddresses(accountId, folderId, addressType, address);
                    if (moveDestination === "inbox") {
                        await moveMessagesToInbox(title, accountId, messageIds);
                    } else {
                        await moveMessagesToFilterBook(title, accountId, moveDestination, messageIds);
                    }
                }
            }
            await display.complete(
                `${title} - ${op.actioned} ${total} ${addressType} ${op.description} ${op.direction} ${filterBook}`,
            );
        }
        return true;
    } catch (e) {
        console.error(e);
    }
}

async function onMenuSieveTraceClicked(target, detail) {
    try {
        if (verbose) {
            console.log("onMenuSieveTraceClicked:", target.id, {
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
            console.log("getRescanVisibility:", { menuId, detail });
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
            console.log("onActionButtonClicked:", { tab, info });
        }
        await focusEditorWindow();
    } catch (e) {
        console.error(e);
    }
}

// update checkmark on selected filter book
async function onMenuSelectBookClicked(config, detail) {
    try {
        if (verbose) {
            console.log("onMenuSelectBookClicked:", config.id, {
                config,
                detail,
            });
        }
        const info = await querySelectedMessages();
        if (!info) {
            throw new Error("selected message query failed");
        }
        await setAddSenderTarget(config.accountId, config.book);
        await updateMessageDisplayAction(config.accountId, info.folderName);
    } catch (e) {
        console.error(e);
    }
}

async function onMenuControlPanelClicked(target, detail) {
    try {
        if (verbose) {
            console.log("onMenuControlPanelClicked:", target.id, { target, detail });
        }
        await focusEditorWindow();
    } catch (e) {
        console.error(e);
    }
}

async function onMenuOpenRescansClicked(target, detail) {
    try {
        if (verbose) {
            console.log("onMenuOpenRescansClicked:", target.id, { target, detail });
        }
        await focusRescanWindow();
    } catch (e) {
        console.error(e);
    }
}

async function onMenuRescanFolderClicked(target, detail) {
    try {
        // FIXME: check onClick parameters
        if (verbose) {
            console.log("onMenuRescanFolderClicked:", target.id, {
                target,
                detail,
            });
        }
        for (const folder of detail.info.selectedFolders) {
            let account = await getAccount(folder.accountId);
            let path = folder.path;
            if (await requestRescan(account, path, [], `Rescanning all messages in folder '${folder.path}'...`)) {
                await focusRescanWindow();
            }
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
        // FIXME: check onClick parameters
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

        if (messageIds.length === 0) {
            return;
        }
        if (await requestRescan(account, path, messageIds)) {
            await focusRescanWindow();
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
        if (verbose) {
            console.log("Rescan request:", request);
        }
        let requests = new Requests();
        let response = await requests.post(account.id, "/rescan/", request);
        if (verbose) {
            console.debug("Rescan response:", response);
        }
        await findContentTab("rescan", true);
        await updateActiveRescans(response);
        return true;
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
            const targets = await config.local.get(config.local.key.addSenderTarget);
            if (targets !== undefined) {
                if (Object.hasOwn(targets, accountId)) {
                    const target = targets[accountId];
                    // ensure the target is present in bookNames
                    if (bookNames.includes(target)) {
                        return target;
                    }
                }
            }
            for (const bookName of bookNames) {
                // no setting found, so return the first book
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
        let books = [];
        const bookData = await filterctl.getBooks(accountId, force);
        for (const bookName of Object.keys(bookData.books.Books)) {
            books.push(bookName);
        }
        return books.sort();
    } catch (e) {
        console.error(e);
    }
}

async function setAddSenderTarget(accountId, bookName, folderName = undefined, options = {}) {
    try {
        // side effect: throw error if invalid id
        await getAccount(accountId);
        let targets = await config.local.get(config.local.key.addSenderTarget);
        if (!targets) {
            targets = {};
        }
        if (bookName !== targets[accountId]) {
            targets[accountId] = bookName;
            await config.local.set(config.local.key.addSenderTarget, targets);
            if (verbose) {
                console.debug("changed addSenderTarget:", accountId, bookName, targets);
            }

            // if not called from handleMessage (editor) inform editor the addSender Target has Changed
            if (!options.fromHandleMessage) {
                await sendMessage({
                    id: "addSenderTargetChanged",
                    accountId: accountId,
                    bookName: bookName,
                    dst: "editor",
                });
            }

            // update the message display action button
            const messageDisplayActionAccountId = await config.session.get(config.session.key.messageDisplayActionAccountId);
            if (messageDisplayActionAccountId === accountId) {
                await updateMessageDisplayAction(accountId, folderName);
            }
        }
    } catch (e) {
        console.error(e);
    }
}

// parse email addresses from strings in addressList and set each as a key in addressMap
async function mapParsedAddresses(addressMap, addressList) {
    try {
        for (const address of addressList) {
            const parsedAddrs = await messenger.messengerUtilities.parseMailboxString(address);
            for (const parsed of parsedAddrs) {
                if (parsed.email) {
                    addressMap.set(parsed.email, true);
                } else {
                    console.warn(parsed.email, "missing email address in ", parsed);
                }
            }
        }
        return addressMap;
    } catch (e) {
        console.error(e);
    }
}

// scan a messageList and return a list of unique sender or recipient addresses
async function scanMessageAddresses(addressType, messages) {
    try {
        if (verbose) {
            console.log("scanMessageListAddresses:", { addressType, messages });
        }
        let addrs = new Map();
        for (const message of messages) {
            switch (addressType) {
                case "recipient":
                    addrs = await mapParsedAddresses(addrs, message.recipients);
                    break;
                case "sender":
                    addrs = await mapParsedAddresses(addrs, [message.author]);
                    break;
                default:
                    throw new Error(`unexpected addressType: ${addressType}`);
            }
        }
        return Array.from(addrs.keys());
    } catch (e) {
        console.error(e);
    }
}

// return array of unique folderIds from list of messages
async function scanMessageFolderIds(messages) {
    try {
        if (verbose) {
            console.log("scanMessageFolders:", messages);
        }
        let folders = new Map();
        for (const message of messages) {
            folders.set(message.folder.id, true);
        }
        return Array.from(folders.keys());
    } catch (e) {
        console.error(e);
    }
}

// scan all messages in folder for matching sender or recipient address and return list of message IDs
async function scanMessageFolderMatchingAddresses(accountId, folderId, addressType, address) {
    try {
        if (verbose) {
            console.log("scanMessageFolderAddresses:", { addressType, accountId, folderId });
        }
        let messageIds = new Map();
        let params = {
            accountId,
            folderId,
            returnMessageListId: true,
        };
        switch (addressType) {
            case "recipient":
                params.recipients = [address];
                break;
            case "sender":
                params.author = address;
                break;
            default:
                throw new Error(`unexpected addressType: ${addressType}`);
        }

        let pageId = await messenger.messages.query(params);
        while (pageId) {
            let page = await messenger.messages.continueList(pageId);
            for (const message of page.messages) {
                messageIds.set(message.id, true);
            }
            pageId = page.id;
        }
        return Array.from(messageIds.keys());
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
            console.log("handleSetClasses:", message);
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
        console.debug("displayedFolderChanged", { accountId, email, folder });
        await updateMessageDisplayAction(accountId, folder);
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
            await updateMessageDisplayAction(accountId, message.folder.name);
            return;
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
            console.debug("created FilterBook:", response);
            await getBookNames(accountId, true);
        }
        await initMenus("filter book created");
    } catch (e) {
        console.error(e);
    }
}

async function onFolderDeleted(folder) {
    try {
        console.log("onFolderDeleted:", folder);
        const accountId = folder.accountId;
        const enabled = await isAccount(accountId);
        const isFilterBook = folder.path.match(/^[/]FilterBooks[/]([^/][^/]*)$/);
        if (enabled && isFilterBook) {
            const bookName = isFilterBook[1].toLowerCase();
            const bookNames = await getBookNames(accountId, true);
            if (bookNames.includes(bookName)) {
                const message = `Do you want to delete FilterBook '${bookName}' including all sender addresses?`;
                const confirmed = await messenger.servicesPrompt.confirm("Confirm FilterBook Delete", message);
                if (confirmed) {
                    await closeEditor();
                    let response = await email.sendRequest(accountId, "rmbook " + bookName);
                    console.debug("deleted FilterBook:", response);
                    await getBookNames(accountId, true);
                    await initMenus("filter book deleted");
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

        if (tab.type !== "mail") {
            console.warn("outside mail tab");
            return;
        }

        const selectedMessages = await querySelectedMessages({ messages: true });
        if (!selectedMessages) {
            throw new Error("selected message query failed");
        }
        switch (selectedMessages.count) {
            case 0:
                return;
            case 1:
                break;
            default:
                throw new Error("multiple messages selected");
        }
        switch (selectedMessages.folderName) {
            case "Sent":
            case "Drafts":
                throw new Error(`disabled in ${selectedMessages.folderName} folder`);
        }
        const accountId = await config.session.get(config.session.key.messageDisplayActionAccountId);
        if (!(await isAccount(accountId))) {
            throw new Error(`invalid account ${accountId}`);
        }
        if (accountId !== selectedMessages.accountId) {
            throw new Error(`account mismatch: expected ${accountId}, got ${selectedMessages.accountId}`);
        }

        const filterBook = await getAddSenderTarget(accountId);
        return await filterBookAction(ADD, SENDER, accountId, filterBook, selectedMessages.messages, filterBook);
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
