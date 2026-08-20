import { isAccount, getAccounts, getAccount, getSelectedAccount } from "./accounts.js";
import { accountEmailAddress, differ, isObject } from "./common.js";
import { displayProcess } from "./display.js";
import { FilterDataController } from "./filterctl.js";
import { email } from "./email.js";
import { config, updateActiveRescans } from "./config.js";
import { popupAlert, verbosity, isValidBookName, filterBookAddress } from "./common.js";
import { Requests } from "./requests.js";
import { moveMessagesToFilterBook, moveMessagesToInbox } from "./filterbook.js";
import { menuConfig } from "./menu.js";

/* globals console, messenger, window */

// control flags
const verbose = verbosity.background;

// constants for filter book operations
const SENDER_ADDRESS = "sender address";
const SENDER_DOMAIN = "sender domain";
const RECIPIENT_ADDRESS = "recipient address";
const RECIPIENT_DOMAIN = "recipient domain";
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

        // initialize selected messages

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
        console.log("onUpdateAvailable:", details);
    } catch (e) {
        console.error(e);
    }
}

async function onSuspend() {
    try {
        console.log("background suspending");
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

        // test if the command is one of the keyboard macros configured in manifest.json
        const match = command.match(/^mailfilter-(add|remove)-(sender|recipient)-(address|domain)-([0-9])\s*$/);
        if (match !== null) {
            const address = {
                operation: match[1],
                source: match[2],
                mode: match[3],
                target: match[4],
            };

            const selected = await getSelectedMessages();
            if (selected && selected.valid && selected.count > 0) {
                let book = undefined;
                if (address.target === "default") {
                    book = await getDefaultBook(selected.account.id);
                } else {
                    const bookNames = await getBookNames(selected.account.id);
                    const bookIndex = parseInt(address.target) - 1;
                    book = bookNames[bookIndex];
                }
                if (typeof book === "string" && book !== "") {
                    await filterBookAction(selected, address.operation, address.source + " " + address.mode, book);
                } else {
                    console.error("book not found:", { command, tab, address });
                    throw new Error(`book not found: command='${command}'`);
                }
            } else {
                console.log("ignoring command:", { command, tab, selected });
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
            case "setDefaultBook":
                response = await setDefaultBook(message.accountId, message.bookName, { fromHandleMessage: true });
                break;
            case "getDefaultBook":
                response = await getDefaultBook(message.accountId);
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

            case "onMenuSetDefaultBookShown":
                return onMenuSetDefaultBookShown;

            case "onMenuSetDefaultBookClicked":
                return onMenuSetDefaultBookClicked;

            case "onMenuRescanMessagesClicked":
                return onMenuRescanMessagesClicked;

            case "onMenuRescanFolderClicked":
                return onMenuRescanFolderClicked;

            case "onMenuRescanFilterBooksMessagesClicked":
                return onMenuRescanFilterBooksMessagesClicked;

            case "onMenuRescanFilterBooksFolderClicked":
                return onMenuRescanFilterBooksFolderClicked;

            case "onMenuSieveTraceClicked":
                return onMenuSieveTraceClicked;

            case "onMenuSieveTraceShown":
                return onMenuSieveTraceShown;

            case "onMenuAddSenderShown":
                return onMenuAddSenderShown;

            case "onMenuAddSenderClicked":
                return onMenuAddSenderClicked;

            case "onMenuRemoveSenderClicked":
                return onMenuRemoveSenderClicked;

            case "onMenuAddRecipientClicked":
                return onMenuAddRecipientClicked;

            case "onMenuRemoveRecipientClicked":
                return onMenuRemoveRecipientClicked;

            case "onMenuAddressModeShown":
                return onMenuAddressModeShown;

            case "onMenuAddressModeClicked":
                return onMenuAddressModeClicked;
        }
        throw new Error(`unknown menu handler: ${handlerName}`);
    } catch (e) {
        console.error(e);
    }
}

function menuCreateCallback() {
    try {
        if (messenger.runtime.lastError) {
            console.error("menuCreate failed with:", messenger.runtime.lastError);
        }
    } catch (e) {
        console.error(e);
    }
}

async function menuRefresh(menus, force = false) {
    try {
        if (await config.session.getBool(config.session.key.menuInitPending)) {
            if (verbose) {
                console.log("menu refresh deferred while menu init pending");
            }
            return;
        }
        // update all menus with pending changes
        for (const menu of Object.values(menus)) {
            if (menu.dirty || force) {
                // bizarre destructuring assignment to remove id from properties
                const { id, ...properties } = menu.properties;
                console.warn("messenger.menus.update:", { id, properties });
                await messenger.menus.update(id, properties);
                menu.dirty = false;
            }
        }
        console.warn("messenger.menus.refresh");
        return await messenger.menus.refresh();
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

// reset context menus from menu config data structure
async function initMenus(message) {
    try {
        // check initPending lock
        if (await config.session.getBool(config.session.key.menuInitPending)) {
            console.warn("menuInitPending set; ignoring reentrant initMenus call");
            return;
        }

        console.warn("BEGIN initMenus:", message);

        // set initPending lock
        await config.session.setBool(config.session.key.menuInitPending, true);

        let menus = {};
        console.warn("messenger.menus.removeAll");
        await messenger.menus.removeAll();
        console.warn("messenger.menus.refresh");
        await messenger.menus.refresh();

        if (!(await isApproved())) {
            console.warn("END initMenus: extension not approved, menus cleared");
            await config.session.setBool(config.session.key.menuInitPending, false);
            return;
        }

        let display = await displayProcess(`Configuring Mail Filter Menus...`, 0, 1, { autoRemove: 300 });

        for (let [mid, config] of Object.entries(menuConfig)) {
            if (config.noInit !== true) {
                await createMenu(menus, mid, config);
            }
        }

        // save menu config in session storage
        await config.session.set(config.session.key.menuConfig, menus);
        console.warn("saved menu config:", menus);

        // clear initPending lock and refresh the menus
        await config.session.setBool(config.session.key.menuInitPending, false);
        await menuRefresh(menus);

        await updateMessageDisplayAction();

        await display.complete("Mail Filter Menus Configured");

        if (verbose) {
            console.warn("END initMenus");
        }

        return menus;
    } catch (e) {
        console.error(e);
    }
}

async function disableMessageDisplayAction(selected = null) {
    try {
        if (!selected) {
            selected = await querySelectedMessages();
        }
        if (selected && selected.any) {
            await messenger.messageDisplayAction.setTitle({ title: null });
            await messenger.messageDisplayAction.disable();
        }
    } catch (e) {
        console.error(e);
    }
}

async function updateMessageDisplayAction(selected = null) {
    try {
        if (verbose) {
            console.log("updateMessageDisplayAction:", selected);
        }

        if (!(await isApproved())) {
            //return await disableMessageDisplayAction();
            return;
        }

        let action = {
            enabled: false,
        };

        if (!selected) {
            selected = await querySelectedMessages();
        }

        if (selected && selected.valid) {
            action.enabled = true;
            action.accountId = selected.account.Id;
            action.folderId = selected.folder.id;
            action.folderPath = selected.folder.path;
            action.operation = ADD;
            action.book = await getDefaultBook(selected.account.id);
            action.addressMode = await getAddressMode(selected.account.id);
            let titleMode = undefined;
            let senderType = undefined;
            let recipientType = undefined;
            switch (action.addressMode) {
                case "address":
                    titleMode = "Address";
                    senderType = SENDER_ADDRESS;
                    recipientType = RECIPIENT_ADDRESS;
                    break;
                case "domain":
                    titleMode = "Domain";
                    senderType = SENDER_DOMAIN;
                    recipientType = RECIPIENT_DOMAIN;
                    break;
                default:
                    throw new Error(`unexpected addressMode '${action.addressMode}'`);
            }

            let groups = undefined;

            // override action parameters for selected folders
            switch (action.folderPath) {
                case "/Sent":
                    action.addressType = recipientType;
                    action.book = "whitelist";
                    action.title = `Add Recipient ${titleMode} to Whitelist`;
                    break;
                case "/INBOX/Whitelisted":
                    action.operation = REMOVE;
                    action.addressType = recipientType;
                    action.book = "whitelist";
                    action.title = `Remove Sender ${titleMode} from Whitelist`;
                    break;
                default:
                    groups = action.folderPath.match("/FilterBooks/([^/]+)$");
                    if (groups) {
                        action.operation = REMOVE;
                        action.addressType = senderType;
                        action.book = groups[1];
                        action.title = `Remove Sender ${titleMode} from ${action.book}`;
                    } else {
                        action.addressType = senderType;
                        action.title = `Add Sender ${titleMode} to '${action.book}'`;
                    }
                    break;
            }

            // only update the UI if there are selected messages to avoid setTitle hang
            await messenger.messageDisplayAction.setTitle({ title: action.title });
            await messenger.messageDisplayAction.enable();
        } else {
            await disableMessageDisplayAction(selected);
        }
        // save the action parameters for use by message_display_action_menu onClicked
        await config.session.set(config.session.key.messageDisplayAction, action);
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
        let created = Object.assign({}, config);
        created.properties = Object.assign({}, config.properties);
        created.id = mid;
        created.properties.id = mid;
        created.subs = [];
        // default to visible
        created.properties.visible = true;
        created.properties.enabled = true;
        if (config.hideAfterCreate) {
            // menuConfig has hideAfterCreate: true
            created.properties.visible = false;
        }
        console.warn("messenger.menus.create:", created.properties);
        const cid = await messenger.menus.create(created.properties, menuCreateCallback);
        console.assert(cid === mid);

        // if the config shows we have a parent
        if (Object.hasOwn(created.properties, "parentId")) {
            // remember the parent id (pid) in the menuConfig
            created.pid = created.properties.parentId;
            if (!Object.hasOwn(menus, created.pid)) {
                console.error("nonexistent parent:", { created, menus, mid, config });
                throw new Error("nonexistent parent");
            }
            // add this menu to the parent list of sub-menus
            menus[created.pid].subs.push(created);
        }
        menus[mid] = created;

        // NOTE: menu's onCreated is called after the menu has been created in the API
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
        if (verbose) {
            console.log("onMenuEvent:", { menus, menuEvent, mids, info, tab });
        }
        if (!menus) {
            return;
        }
        console.assert(Array.isArray(mids));
        let refresh = false;

        let detail = await menuEventDetail(info, tab);
        console.assert(isObject(detail.account), "missing account in menu detail");
        console.assert(isObject(detail.folder), "missing folder in menu detail");

        if (menuEvent === "onShown") {
            for (const menu of Object.values(menus)) {
                // set item visibility
                const wasVisible = menu.properties.visible;
                menu.properties.visible = await menuItemVisible(menu, detail);
                if (menu.properties.visible !== wasVisible) {
                    refresh = true;
                    menu.dirty = true;
                }

                // set menu item enabled
                const wasEnabled = menu.properties.enabled;
                menu.properties.enabled = await menuItemEnabled(menu, detail);
                if (menu.properties.enabled != wasEnabled) {
                    refresh = true;
                    menu.dirty = true;
                }
            }
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
            await menuRefresh(menus);
        }
    } catch (e) {
        console.error(e);
    }
}

// return boolean indicating whether menu item should be visible
async function menuItemVisible(menu, detail) {
    try {
        // if not in the selected context, item is invisible
        if (!menu.properties.contexts.includes(detail.context)) {
            return false;
        }

        if (menu.alwaysVisible) {
            return true;
        }

        if (menu.hideAfterCreate) {
            return false;
        }

        if (!isObject(detail.folder)) {
            console.error(`menu ${menu.id} detail has no folder; setting visible=false`);
            return false;
        }

        if (!isObject(detail.account)) {
            console.error(`menu ${menu.id} detail has no account; setting visible=false`);
            return false;
        }

        if (!(await isAccount(detail.account.id))) {
            // menu invisible; account is not mailfilter-enabled
            console.error(`menu ${menu.id} account not enabled; setting visible=false`);
            return false;
        }

        if (menu.accountId) {
            // menu config specifies an accountId, so be visible only if that account has focus
            if (menu.accountId !== detail.account.id) {
                console.debug(
                    `menu ${menu.id} accountId=${menu.accountId} != detail.account.id=${detail.account.id}; setting visible=false`,
                );
                return false;
            }
        }

        // if menu config excludes folders, ensure we're not in an excluded folder
        if (Array.isArray(menu.excludeFolders)) {
            if (folderMatches(detail.folder, menu.excludeFolders)) {
                return false;
            }
        }

        // if menu config includes folders, ensure we're in an included folder
        if (Array.isArray(menu.includeFolders)) {
            if (!folderMatches(detail.folder, menu.includeFolders)) {
                return false;
            }
        }

        return true;
    } catch (e) {
        console.error(e);
        return false;
    }
}

// return boolean indicating whether menu item should be enabled
async function menuItemEnabled(menu, detail) {
    try {
        let enabled = true;
        if (menu.requireSelection) {
            enabled = detail.selectedMessagesPresent;
        }
        return enabled;
    } catch (e) {
        console.error(e);
        return false;
    }
}

function folderMatches(folder, patterns) {
    try {
        if (Array.isArray(patterns)) {
            for (const pattern of patterns) {
                if (folder.path.match(pattern)) {
                    return true;
                }
            }
        }
        return false;
    } catch (e) {
        console.error(e);
    }
}

// return info about the account and folder for onMenuShown, onMenuClicked handlers
async function menuEventDetail(info, tab) {
    try {
        if (verbose) {
            console.log("menuEventDetail:", info, tab);
        }
        let ret = {
            info,
            tab,
        };

        if (!Array.isArray(info.contexts)) {
            console.debug({ info });
            throw new Error("info.contexts is not Array type");
        }

        // validate context
        console.debug("info.contexts:", info.contexts);
        if (info.contexts.includes("folder_pane")) {
            console.assert(isObject(info.selectedFolders), "folder_pane event missing info.selectedFolders");
            console.assert(!isObject(info.displayedFolder), "folder_pane event has unexpected info.displayedFolder");
            console.assert(!info.contexts.includes("message_list"), "conflicting info context");
            console.assert(!info.contexts.includes("message_display_action"), "conflicting info context");
            console.assert(!info.contexts.includes("tools_menu"), "conflicting info context");
            console.assert(
                Array.isArray(info.selectedFolders),
                `unexpected info.selectedFolders type: ${typeof info.selectedFolders}`,
            );
            console.assert(info.selectedFolders.length === 1, "ignoring multiple folder selection");
            ret.context = "folder_pane";
            if (info.selectedFolders.length === 1) {
                ret.folder = info.selectedFolders[0];
            }
        } else if (info.contexts.includes("message_list")) {
            console.assert(isObject(info.displayedFolder), "message_list event missing info.displayedFolder");
            console.assert(!isObject(info.selectedFolders), "message_list event has unexpected info.selectedFolders");
            console.assert(!info.contexts.includes("folder_pane"), "conflicting info context");
            console.assert(!info.contexts.includes("message_display_action"), "conflicting info context");
            console.assert(!info.contexts.includes("tools_menu"), "conflicting info context");
            console.assert(isObject(info.selectedMessages), "message_list event missing info.selectedMessages");
            ret.context = "message_list";
            ret.folder = info.displayedFolder;
        } else if (info.contexts.includes("message_display_action")) {
            console.assert(!isObject(info.displayedFolder), "message_display_action event has unexpected info.displayedFolder");
            console.assert(!isObject(info.selectedFolders), "message_display_action event has unexpected info.selectedFolders");
            console.assert(!info.contexts.includes("message_list"), "conflicting info context");
            console.assert(!info.contexts.includes("folder_pane"), "conflicting info context");
            console.assert(!info.contexts.includes("tools_menu"), "conflicting info context");
            console.assert(isObject(info.selectedMessages), "message_display_action event missing info.selectedMessages");
            ret.context = "message_display_action";
            const selected = await getSelectedMessages();
            ret.folder = await messenger.folders.get(selected.folderId);
        } else if (info.contexts.includes("tools_menu")) {
            console.assert(!isObject(info.displayedFolder), "tools_menu event has unexpected info.displayedFolder");
            console.assert(!isObject(info.selectedFolders), "tools_menut event has unexpected info.selectedFolders");
            console.assert(!info.contexts.includes("message_list"), "conflicting info context");
            console.assert(!info.contexts.includes("folder_pane"), "conflicting info context");
            console.assert(!info.contexts.includes("message_display_action"), "conflicting info context");
            ret.context = "tools_menu";
        } else {
            throw new Error(`unexpected info.contexts: ${info.contexts}`);
        }

        if (ret.context !== "tools_menu") {
            if (ret.folder) {
                if (await isAccount(ret.folder.accountId)) {
                    ret.account = await getAccount(ret.folder.accountId);
                }
            }

            if (!isObject(ret.folder)) {
                throw new Error("missing folder");
            }
            if (!isObject(ret.account)) {
                throw new Error("missing account");
            }
        }

        console.debug("menuEventDetail:", ret);
        return ret;
    } catch (e) {
        console.error(e);
    }
}

// domain filterbook submenus
async function onMenuAddressModeShown(menu, detail) {
    try {
        if (verbose) {
            console.log("onMenuAddressModeShown:", { menu, detail });
        }
        if (detail.account) {
            let mode = await getAddressMode(detail.account.id);
            if (menu.properties.checked !== mode) {
                menu.properties.checked = mode;
                menu.dirty = true;
                return true;
            }
        }
        return false;
    } catch (e) {
        console.error(e);
    }
}

async function onMenuAddressModeClicked(menu, detail) {
    try {
        console.log("onMenuAddressModeClicked:", { menu, detail });
        await setAddressMode(detail.account.id, menu.addressMode);
        return true;
    } catch (e) {
        console.error(e);
    }
}

// add filterbook submenus
// NOTE: this adds dynamic filter book entries for all accounts
async function onMenuAddBooksCreated(menus, parent) {
    try {
        if (verbose) {
            console.log("onMenuAddBooksCreated:", parent);
        }
        const accounts = await getAccounts();
        for (const [accountId, account] of Object.entries(accounts)) {
            let accountEmail = accountEmailAddress(account);
            let bookNames = await getBookNames(accountId);
            if (bookNames && Array.isArray(bookNames)) {
                for (const bookName of await getBookNames(accountId)) {
                    const bookMenu = Object.assign({}, menuConfig[parent.subId]);
                    bookMenu.properties = Object.assign({}, menuConfig[parent.subId].properties);
                    bookMenu.dynamic = true;
                    bookMenu.accountId = accountId;
                    bookMenu.book = bookName;
                    bookMenu.addressMode = parent.addressMode;
                    bookMenu.includeFolders = parent.includeFolders;
                    bookMenu.excludeFolders = parent.excludeFolders;
                    bookMenu.properties.contexts = parent.properties.contexts;
                    bookMenu.properties.visible = true;
                    bookMenu.properties.parentId = parent.id;
                    bookMenu.properties.title = bookMenu.titleTemplate
                        .replace(/__mode__/, bookMenu.addressMode)
                        .replace(/__book__/, bookMenu.book);
                    let bookMenuId = `${parent.id};${accountEmail};${accountId};${bookName}`;
                    await createMenu(menus, bookMenuId, bookMenu);
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
            console.error("setSieveTrace failed:", accountId, enabled, e);
            await display.fail(`${action} Sieve Trace for ${email} failed: ${e}; please contact support.`);
        }
    } catch (e) {
        console.error(e);
    }
}

async function onMenuSieveTraceCreated(menus, created) {
    try {
        if (verbose) {
            console.log("onMenuSieveTraceCreated:", { menus, created });
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

async function onMenuSieveTraceShown(menu, detail) {
    try {
        if (verbose) {
            console.log("onMenuSieveTraceShown:", menu.id, { menu, detail });
        }
        let refresh = false;
        if (detail.account && (await isAccount(detail.account.id))) {
            const wasChecked = menu.properties.checked;
            menu.properties.checked = await getSieveTrace(detail.account.id);
            if (menu.properties.checked !== wasChecked) {
                menu.dirty = true;
                refresh = true;
            }
        } else {
            const wasVisible = menu.properties.visible;
            menu.properties.visible = false;
            if (menu.properties.visible !== wasVisible) {
                menu.dirty = true;
                refresh = true;
            }
        }
        return refresh;
    } catch (e) {
        console.error(e);
    }
}

async function validateOnClicked(menu, detail, selected) {
    try {
        if (!(await isAccount(detail.account.id))) {
            throw new Error(`invalid detail account: ${detail.account.id}`);
        }
        if (!(await isAccount(selected.account.id))) {
            throw new Error(`invalid selected account: ${selected.account.id}`);
        }
        if (menu.accountId && menu.accountId !== selected.account.id) {
            throw new Error(`accountId mismatch menu=${menu.accountId} selected=${selected.account.id}`);
        }
        if (detail.account && detail.account.id !== selected.account.id) {
            throw new Error(`accountId mismatch: detail=${detail.account.id} selected=${selected.account.id}`);
        }
        if (detail.folder && detail.folder.path !== selected.folder.path) {
            throw new Error(`folder mismatch: detail=${detail.folder.path} selected=${selected.folder.path}`);
        }
        if (typeof menu.excludeFolders === Array && folderMatches(menu.excludeFolders, selected.folder.path)) {
            throw new Error(`menu clicked in excluded folder '${selected.folder.path}' ${menu.excludeFolders}`);
        }
        if (typeof menu.includeFolders === Array && !folderMatches(menu.includeFolders, selected.folder.path)) {
            throw new Error(`menu clicked outside of included folder '${selected.folder.path}' ${menu.includeFolders}`);
        }
        if (detail.info && detail.info.selectedMessages) {
            if (differ(detail.info.selectedMessages.messages, selected.messages)) {
                const message = "The context-clicked message differs from the selected messages";
                await popupAlert("Ambiguous selection", message);
                return false;
            }
        }
        return true;
    } catch (e) {
        console.error(e);
        return false;
    }
}

async function onMenuAddSenderShown(menu, detail) {
    try {
        console.log("onMenuAddSenderShown:", menu.id, { menu, detail });
        if (!menu.dynamic) {
            throw new Error(`missing dynamic flag`);
        }
        const title = menu.titleTemplate.replace(/__mode__/, menu.addressMode).replace(/__book__/, menu.book);
        if (title !== menu.properties.title) {
            menu.properties.title = title;
            menu.dirty = true;
            return true;
        }
        return false;
    } catch (e) {
        console.error(e);
    }
}

async function onMenuAddSenderClicked(menu, detail) {
    try {
        if (verbose) {
            console.log("onMenuAddSenderClicked:", menu.id, { menu, detail });
        }
        if (!menu.dynamic) {
            throw new Error(`missing dynamic flag`);
        }
        let mode = undefined;
        switch (menu.addressMode) {
            case "address":
                mode = SENDER_ADDRESS;
                break;
            case "domain":
                mode = SENDER_DOMAIN;
                break;
            default:
                console.debug("unexpected addressMode:", { menu });
                throw new Error(`unexpected addressMode: ${menu.addressMode}`);
        }
        const selected = await querySelectedMessages();
        if (!(await validateOnClicked(menu, detail, selected))) {
            throw new Error("validateOnClicked failed");
        }
        return await filterBookAction(selected, ADD, mode, menu.book);
    } catch (e) {
        console.error(e);
    }
}

async function onMenuRemoveSenderClicked(menu, detail) {
    try {
        if (verbose) {
            console.log("onMenuRemoveSenderAddressClicked:", menu.id, { menu, detail });
        }
        let mode = undefined;
        switch (menu.addressMode) {
            case "address":
                mode = SENDER_ADDRESS;
                break;
            case "domain":
                mode = SENDER_DOMAIN;
                break;
            default:
                throw new Error(`unexpected addressMode: ${menu.addressMode}`);
        }
        const selected = await querySelectedMessages();
        if (!(await validateOnClicked(menu, detail, selected))) {
            throw new Error("validateOnClicked failed");
        }
        return await filterBookAction(selected, REMOVE, mode, menu.book);
    } catch (e) {
        console.error(e);
    }
}

async function onMenuAddRecipientClicked(menu, detail) {
    try {
        if (verbose) {
            console.log("onMenuAddRecipientClicked:", menu.id, { menu, detail });
        }
        let mode = undefined;
        switch (menu.addressMode) {
            case "address":
                mode = RECIPIENT_ADDRESS;
                break;
            case "domain":
                mode = RECIPIENT_DOMAIN;
                break;
            default:
                throw new Error(`unexpected addressMode: ${menu.addressMode}`);
        }
        const selected = await querySelectedMessages();
        if (!(await validateOnClicked(menu, detail, selected))) {
            throw new Error("validateOnClicked failed");
        }
        return await filterBookAction(selected, ADD, mode, "whitelist");
    } catch (e) {
        console.error(e);
    }
}

async function onMenuRemoveRecipientClicked(menu, detail) {
    try {
        if (verbose) {
            console.log("onMenuRemoveRecipientClicked:", menu.id, { menu, detail });
        }
        let mode = undefined;
        switch (menu.addressMode) {
            case "address":
                mode = RECIPIENT_ADDRESS;
                break;
            case "domain":
                mode = RECIPIENT_DOMAIN;
                break;
            default:
                throw new Error(`unexpected addressMode: ${menu.addressMode}`);
        }
        const selected = await querySelectedMessages();
        if (!(await validateOnClicked(menu, detail, selected))) {
            throw new Error("validateOnClicked failed");
        }
        return await filterBookAction(selected, REMOVE, mode, "whitelist");
    } catch (e) {
        console.error(e);
    }
}

async function filterBookAction(selected, action, addressType, book) {
    try {
        if (verbose) {
            console.log("filterBookAction:", { selected, action, addressType, book });
        }

        // FIXME: ensure no filter book actions on: /Trash /Drafts /Junk /Archives/*

        // validate action and setup for title generation
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
                throw new Error(`unknown action '${action}'`);
        }

        // validate addressType
        switch (addressType) {
            case SENDER_ADDRESS:
            case SENDER_DOMAIN:
            case RECIPIENT_ADDRESS:
            case RECIPIENT_DOMAIN:
                break;
            default:
                throw new Error(`unknown addressType '${addressType}'`);
        }

        // FIXME: this should be validated upstream
        /*
        if (!(await validateOnClicked(menu, detail, selected))) {
            throw new Error("validateOnClicked failed");
        }
	*/

        // FIXME: show addresses added/removed from filterbook
        // FIXME: when adding addresses/domains to a filterbook, also scan INBOX for matching messages and move them

        const addresses = await scanMessageAddresses(addressType, selected.messageList);
        if (!addresses || addresses.length < 1) {
            console.warn("no addresses selected");
            return false;
        }
        console.debug("addresses:", addresses);

        const filterctl = await getFilterDataController();
        const total = addresses.length;

        op.description = "addresses";
        if (total === 1) {
            op.description = "address";
        }

        let addressList = "[" + addresses.join(", ") + "]";
        if (total > 4) {
            addressList = "[" + addresses.slice(0, 2).join(", ") + ` (plus ${total - 3} others)]`;
        }

        const title = `${op.action} ${addressType} ${op.direction} ${book}`;
        const message = `${op.action} ${total} ${addressType} ${op.description} ${addressList} ${op.direction} ${book}?`;
        let confirmed = true;
        if (total > 1) {
            confirmed = await messenger.servicesPrompt.confirm(
                `Confirm ${op.action} ${total} ${op.description} ${op.direction} ${book}`,
                message,
            );
        }
        if (confirmed) {
            const display = await displayProcess(
                `${title} - ${op.actioning} ${addressType} ${op.description} ${op.direction} ${book}...`,
                0,
                total,
            );
            let count = 0;
            for (const address of addresses) {
                const status = `${title} - ${op.actioning} ${addressType} ${address} ${op.direction} ${book}`;
                await display.update(status, ++count);
                if (verbose) {
                    console.debug(status);
                }
                const messageIds = await scanMessageFolderMatchingAddresses(selected.folder, addressType, address);
                switch (action) {
                    case ADD:
                        await filterctl.addAddressToFilterBook(selected.account.id, address, book);
                        // when adding address to filterbook, scan current folder and move all matching messages to filterbook folder
                        await moveMessagesToFilterBook(title, selected.account.id, book, messageIds);
                        break;
                    case REMOVE:
                        await filterctl.removeAddressFromFilterBooks(selected.account.id, address);
                        // when removing address from filterbooks (including whitelist), scan current folder and move matching messages to INBOX
                        await moveMessagesToInbox(title, selected.account.id, messageIds);
                        break;
                    default:
                        throw new Error(`Unexpected action: ${action}`);
                }
            }
            await display.complete(
                `${title} - ${op.actioned} ${total} ${addressType} ${op.description} ${addressList} ${op.direction} ${book}`,
            );
        }
        return true;
    } catch (e) {
        console.error(e);
    }
}

async function onMenuSieveTraceClicked(menu, detail) {
    try {
        if (verbose) {
            console.log("onMenuSieveTraceClicked:", menu.id, {
                menu,
                detail,
            });
        }
        let traceEnabled = (await getSieveTrace(detail.accountId)) ? false : true;
        await setSieveTrace(detail.accountId, traceEnabled);
        return true;
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

// select default filter book
async function onMenuSetDefaultBookClicked(menu, detail) {
    try {
        if (verbose) {
            console.log("onMenuSetDefaultBookClicked:", menu.id, {
                menu,
                detail,
            });
        }
        await setDefaultBook(menu.accountId, menu.book, { folder: detail.folder });
    } catch (e) {
        console.error(e);
    }
}

// set checkmark on default filter book selection
async function onMenuSetDefaultBookShown(menu, detail) {
    try {
        console.log("onMenuSetDefaultBookShown:", menu.id, {
            menu,
            detail,
        });
        if (menu.properties.title !== menu.book) {
            menu.properties.title = menu.book;
            menu.dirty = true;
            return true;
        }
        return false;
    } catch (e) {
        console.error(e);
    }
}

async function onMenuControlPanelClicked(menu, detail) {
    try {
        if (verbose) {
            console.log("onMenuControlPanelClicked:", menu.id, { menu, detail });
        }
        await focusEditorWindow();
    } catch (e) {
        console.error(e);
    }
}

async function onMenuOpenRescansClicked(menu, detail) {
    try {
        if (verbose) {
            console.log("onMenuOpenRescansClicked:", menu.id, { menu, detail });
        }
        await focusRescanWindow();
    } catch (e) {
        console.error(e);
    }
}

async function onMenuRescanFolderClicked(menu, detail) {
    try {
        if (verbose) {
            console.log("onMenuRescanFolderClicked:", menu.id, {
                menu,
                detail,
            });
        }
        if (detail.info.selectedFolders.length !== 1) {
            throw new Error(`expected single selected folder; got ${detail.info.selectedFolders.length}`);
        }
        const folder = detail.info.selectedFolders[0];
        let account = await getAccount(folder.accountId);
        let path = folder.path;
        if (await requestRescan(account, path, [], `Rescanning all messages in folder '${folder.path}'...`)) {
            await focusRescanWindow();
        }
    } catch (e) {
        console.error(e);
    }
}

async function onMenuRescanMessagesClicked(menu, detail) {
    try {
        if (verbose) {
            console.log("onMenuRescanMessagesClicked:", menu.id, {
                menu,
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

async function onMenuRescanFilterBooksFolderClicked(menu, detail) {
    try {
        if (verbose) {
            console.log("onMenuRescanFilterBooksFolderClicked:", menu.id, {
                menu,
                detail,
            });
        }
        if (detail.info.selectedFolders.length !== 1) {
            throw new Error(`expected single selected folder; got ${detail.info.selectedFolders.length}`);
        }
        const folder = detail.info.selectedFolders[0];
        const messageMap = await mapMessageFolderSenderIds(folder);
        if (!messageMap) {
            throw new Error("no messages selected");
        }
        const account = await getAccount(folder.accountId);
        if (!account) {
            throw new Error("invalid account");
        }
        await rescanFilterBooks(account.id, messageMap, `Reapplying filter books rules to all messages in folder '${folder.path}'...`);
    } catch (e) {
        console.error(e);
    }
}

async function onMenuRescanFilterBooksMessagesClicked(menu, detail) {
    try {
        if (verbose) {
            console.log("onMenuRescanFilterBooksMessagesClicked:", menu.id, {
                menu,
                detail,
            });
        }
        const selected = await querySelectedMessages();
        if (!selected) {
            throw new Error("querySelectedMessages failed");
        }
        if (!(await validateOnClicked(menu, detail, selected))) {
            throw new Error("validateOnClicked failed");
        }
        const messageMap = await mapMessageListSenderIds(selected.messageList);
        if (!messageMap) {
            throw new Error("mapMessageSelectionSenderIds failed");
        }
        await rescanFilterBooks(selected.account.id, messageMap, "Reapplying filter books rules to selected messages...");
    } catch (e) {
        console.error(e);
    }
}

export async function getTargetBook(address, books) {
    try {
        if (verbose) {
            console.debug("getTargetBook:", address, books);
        }
        for (const [book, addrs] of Object.entries(books)) {
            if (addrs.includes(address)) {
                return book;
            }
        }
        return "inbox";
    } catch (e) {
        console.error(e);
    }
}

export async function rescanFilterBooks(accountId, messageMap, title) {
    try {
        if (verbose) {
            console.debug("rescanFilterBooks:", accountId, messageMap, title);
        }
        const filterctl = await getFilterDataController();
        const bookData = await filterctl.getBooks(accountId);
        const books = bookData.books.Books;
        const targets = new Map();
        for (const [sender, messageIds] of messageMap.entries()) {
            if (verbose) {
                console.log("rescanFilterBooks loop: ", sender, messageIds);
            }
            const book = await getTargetBook(sender, books);
            if (!targets.has(book)) {
                targets.set(book, new Array());
            }
            targets.set(book, targets.get(book).concat(messageIds));
        }
        for (const [book, messageIds] of targets.entries()) {
            if (book === "inbox") {
                await moveMessagesToInbox(title, accountId, messageIds);
            } else {
                await moveMessagesToFilterBook(title, accountId, book, messageIds);
            }
        }
    } catch (e) {
        console.error(e);
    }
}

//////////////////////////////////////////////////////
//
// default FilterBook management
//
//////////////////////////////////////////////////////

// read default filter book for account from config
async function getDefaultBook(accountId) {
    try {
        if (await isAccount(accountId)) {
            const bookNames = await getBookNames(accountId);
            const targets = await config.local.get(config.local.key.defaultFilterBook);
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

async function getAddressMode(accountId) {
    try {
        if (await isAccount(accountId)) {
            const modes = await config.local.get(config.local.key.filterBookAddressMode);
            if (modes !== undefined) {
                if (Object.hasOwn(modes, accountId)) {
                    const mode = modes[accountId];
                    if (mode === "address" || mode === "domain") {
                        return mode;
                    }
                    console.error("config get filterBookAddressMode returned unexpected value:", { mode });
                }
            }
            // default to address mode
            return "address";
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

async function setDefaultBook(accountId, bookName, params = {}) {
    try {
        if (verbose) {
            console.log("setDefaultBook:", { accountId, bookName, params });
        }

        // side effect: throw error if invalid id
        await getAccount(accountId);

        let targets = await config.local.get(config.local.key.defaultFilterBook);
        if (!targets) {
            targets = {};
        }
        if (bookName !== targets[accountId]) {
            targets[accountId] = bookName;
            await config.local.set(config.local.key.defaultFilterBook, targets);
            if (verbose) {
                console.debug("changed defaultFilterBook:", { accountId, bookName, targets });
            }

            // if not called from handleMessage (editor) inform editor that the addSender Target has Changed
            if (!params.fromHandleMessage) {
                await sendMessage({
                    id: "defaultBookChanged",
                    accountId: accountId,
                    bookName: bookName,
                    dst: "editor",
                });
            }

            // if folder provided and matches selected messages, update the message display action button
            if (params.folder) {
                const selected = await querySelectedMessages();
                if (selected && selected.folder && selected.folder.id == params.folder.id) {
                    await updateMessageDisplayAction(selected);
                }
            }
        }
    } catch (e) {
        console.error(e);
    }
}

async function setAddressMode(accountId, mode, folder = undefined) {
    try {
        console.log("setAddressMode:", { accountId, mode, folder });

        // side effect: throw error if invalid id
        await getAccount(accountId);

        if (mode !== "address" && mode !== "domain") {
            throw new Error(`attempt to set illegal mode: '${mode}' for account '${accountId}'`);
        }

        let modes = await config.local.get(config.local.key.filterBookAddressMode);
        if (!modes) {
            modes = {};
        }
        if (mode !== modes[accountId]) {
            mode[accountId] = mode;
            await config.local.set(config.local.key.filterBookAddressMode, modes);
            if (verbose) {
                console.debug("changed filterBookAddressMode:", { accountId, mode, modes });
            }

            // update the message display action button if active
            const selected = await querySelectedMessages();
            if (selected && selected.account && selected.account.id === accountId) {
                await updateMessageDisplayAction(selected);
            }
        }
    } catch (e) {
        console.error(e);
    }
}

// return first email address in addressList
async function parseEmailAddress(addressList) {
    try {
        for (const address of addressList) {
            const parsedAddrs = await messenger.messengerUtilities.parseMailboxString(address);
            for (const parsed of parsedAddrs) {
                if (parsed.email) {
                    return parsed.email;
                }
            }
        }
        return null;
    } catch (e) {
        console.error(e);
    }
}

// generator for iterating through an API MessageList
async function* messageListItems(list) {
    let page = await list;
    for (let message of page.messages) {
        yield message;
    }
    while (page.id) {
        page = await messenger.messages.continueList(page.id);
        for (let message of page.messages) {
            yield message;
        }
    }
}

// scan a MessageList and return a list of unique addresses of the given addressType
async function scanMessageAddresses(addressType, messageList) {
    try {
        if (verbose) {
            console.log("scanMessageAddresses:", { addressType, messageList });
        }
        let addressMap = new Map();
        let addressList = undefined;
        let flags = undefined;

        async function handleMessage(message) {
            switch (addressType) {
                case RECIPIENT_ADDRESS:
                    addressList = message.recipients;
                    flags = { domain: false };
                    break;
                case RECIPIENT_DOMAIN:
                    addressList = message.recipients;
                    flags = { domain: true };
                    break;
                case SENDER_ADDRESS:
                    addressList = [message.author];
                    flags = { domain: false };
                    break;
                case SENDER_DOMAIN:
                    addressList = [message.author];
                    flags = { domain: true };
                    break;
                default:
                    throw new Error(`unexpected addressType: ${addressType}`);
            }
            for (const address of addressList) {
                const parsedList = await messenger.messengerUtilities.parseMailboxString(address);
                for (const parsed of parsedList) {
                    if (parsed.email) {
                        addressMap.set(filterBookAddress(parsed.email, flags));
                    } else {
                        console.error("missing email address:", parsed);
                    }
                }
            }
            return true;
        }

        await scanMessageList(messageList, handleMessage);

        return Array.from(addressMap.keys());
    } catch (e) {
        console.error(e);
    }
}

// scan all messages in folder for matching sender or recipient address and return array of message IDs
async function scanMessageFolderMatchingAddresses(folder, addressType, address) {
    try {
        if (verbose) {
            console.log("scanMessageFolderAddresses:", { folder, addressType, address });
        }
        let messageIds = new Map();
        const accountId = folder.accountId;
        const folderId = folder.id;

        switch (addressType) {
            case RECIPIENT_ADDRESS:
                await scanMessageList(
                    await messenger.messages.query({ accountId, folderId, recipients: [address] }),
                    async (message) => {
                        messageIds.set(message.id, true);
                        return true;
                    },
                );
                break;
            case RECIPIENT_DOMAIN:
                await scanMessageList(await messenger.messages.query({ accountId, folderId }), async (message) => {
                    if (await domainMatch(message.recipients, address)) {
                        messageIds.set(message.id, true);
                    }
                    return true;
                });
                break;
            case SENDER_ADDRESS:
                await scanMessageList(await messenger.messages.query({ accountId, folderId, author: address }), async (message) => {
                    messageIds.set(message.id, true);
                    return true;
                });
                break;

            case SENDER_DOMAIN:
                await scanMessageList(await messenger.messages.query({ accountId, folderId }), async (message) => {
                    if (await domainMatch([message.author], address)) {
                        messageIds.set(message.id, true);
                    }
                    return true;
                });
                break;
            default:
                throw new Error(`unexpected addressType: ${addressType}`);
        }
        return Array.from(messageIds.keys());
    } catch (e) {
        console.error(e);
    }
}

async function domainMatch(headerStrings, address) {
    try {
        const domain = address.replace(/^[^@]*/, "");
        for (const headerString of headerStrings) {
            const parsedMailboxes = await messenger.messengerUtilities.parseMailboxString(headerString);
            for (const parsedMailbox of parsedMailboxes) {
                if (parsedMailbox.email.replace(/^[^@]*/, "") === domain) {
                    return true;
                }
            }
        }
        return false;
    } catch (e) {
        console.error(e);
    }
}

// scan all messages in folder returning map of sender addresses to list of message IDs
async function mapMessageFolderSenderIds(folder) {
    try {
        if (verbose) {
            console.log("mapMessageFolderSenderIds:", folder);
        }
        const messageList = await messenger.messages.query({ accountId: folder.accountId, folderId: folder.id });
        return await mapMessageListSenderIds(messageList);
    } catch (e) {
        console.error(e);
    }
}

// scan MessageList returning map of sender addresses to list of message IDs
async function mapMessageListSenderIds(messageList) {
    try {
        if (verbose) {
            console.log("mapMessageListSenderIds:", messageList);
        }
        let ret = new Map();
        await scanMessageList(messageList, async (message) => {
            const sender = await parseEmailAddress([message.author]);
            if (sender) {
                if (!ret.has(sender)) {
                    ret.set(sender, new Array());
                }
                ret.get(sender).push(message.id);
            }
            return true;
        });
        return ret;
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

async function onDisplayedFolderChanged(tab, folder) {
    try {
        if (verbose) {
            console.log("onDisplayedFolderChanged:", { tab, folder });
        }
        const displayedFolder = {
            id: folder.id,
            path: folder.path,
            accountId: folder.accountId,
        };
        await config.session.set(config.session.key.displayedFolder, displayedFolder);
        console.debug("displayedFolderChanged", displayedFolder);
    } catch (e) {
        console.error(e);
    }
}

async function onSelectedMessagesChanged(tab, selectedMessages) {
    try {
        if (verbose) {
            console.log("onSelectedMessagesChanged:", tab, selectedMessages);
        }
        const selected = await scanMessageList(selectedMessages);
        if (!selected) {
            throw new Error("scanMessageList failed");
        }
        await setSelectedMessages(selected);
        if (selected.valid) {
            await updateMessageDisplayAction(selected);
        }
    } catch (e) {
        console.error(e);
    }
}

async function getSelectedMessages() {
    try {
        let selected = await config.session.get(config.session.key.selectedMessages);
        if (!isObject(selected)) {
            selected = { valid: false };
        }
        if (selected.valid && selected.folderId) {
            selected.folder = await messenger.folders.get(selected.folderId);
        }
        if (selected.valid && selected.accountId && (await isAccount(selected.accountId))) {
            selected.account = await getAccount(selected.accountId);
        }
        return selected;
    } catch (e) {
        console.error(e);
    }
}

async function setSelectedMessages(selected) {
    try {
        const values = {
            valid: selected.valid,
            count: selected.count,
        };
        if (selected.account) {
            values.accountId = selected.account.id;
        }
        if (selected.folder) {
            values.folderId = selected.folder.id;
        }
        await config.session.set(config.session.key.selectedMessages, values);
    } catch (e) {
        console.error(e);
    }
}

async function querySelectedMessages() {
    try {
        const tabs = await messenger.tabs.query({ type: "mail" });
        console.debug({ tabs });
        console.assert(Array.isArray(tabs), "unexpected tabs type");
        console.assert(tabs.length === 1, "unexpected tabs length");
        const messageList = await messenger.mailTabs.getSelectedMessages(tabs[0].id);
        const selected = scanMessageList(messageList);
        return selected;
    } catch (e) {
        console.error(e);
    }
}

async function scanMessageList(messageList, callback = null) {
    let any = false;
    try {
        let folder = null;
        let account = null;
        let count = 0;
        let valid = false;

        let messages = messageListItems(messageList);
        for await (const message of messages) {
            any = true;
            if (folder) {
                if (message.folder.id !== folder.id) {
                    throw new Error("selected messages span multiple folders");
                }
            } else {
                folder = message.folder;
            }

            if (account) {
                if (message.folder.accountId !== account.id) {
                    throw new Error("selected messages span multiple accounts");
                }
            } else {
                if (await isAccount(message.folder.accountId)) {
                    account = await getAccount(message.folder.accountId);
                } else {
                    throw new Error("selected message account not enabled");
                }
            }

            count++;
            valid = true;

            if (callback) {
                if (!(await callback(message))) {
                    throw new Error("stopped by callback");
                }
            }
        }
        return { valid, any, count, account, folder, messageList };
    } catch (e) {
        console.error(e);
        return { valid: false, any, error: e };
    }
}

async function onLoad() {
    try {
        if (verbose) {
            console.warn("onLoad");
        }
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

        if (!(await isApproved())) {
            await focusEditorWindow();
            return;
        }

        if (tab.type !== "mail") {
            console.warn("outside mail tab");
            return;
        }

        const selected = await querySelectedMessages();

        if (!selected) {
            throw new Error("querySelectedMessages failed");
        }

        if (!selected.valid) {
            throw new Error("no messages selected");
        }

        const action = await config.session.get(config.session.key.messageDisplayAction);
        console.log("got messageDisplayAction:", action);

        if (action.enabled) {
            if (selected.account.id !== action.accountId) {
                throw new Error(`account mismatch: selected=${selected.account.id}, action=${action.accountId}`);
            }
            if (selected.folder.id !== action.folderId) {
                throw new Error(`folder mismatch: selected=${selected.folder.id}, action=${action.folderId}`);
            }
            const book = await getDefaultBook(selected.folder.id);
            if (book !== action.book) {
                throw new Error(`book mismatch: default=${book}, stored=${action.book}`);
            }
            return await filterBookAction(selected, action.operation, action.addressType, action.book);
        }
    } catch (e) {
        console.error(e);
    }
}

async function onAfterSend(tab, sendInfo) {
    try {
        if (verbose) {
            console.debug("onAfterSend: ", tab, sendInfo);
        }
        const addressMap = new Map();
        let accountId;
        for (const header of sendInfo.messages) {
            accountId = header.folder.accountId;
            for (const headerString of header.recipients) {
                const parsedMailboxes = await messenger.messengerUtilities.parseMailboxString(headerString);
                for (const parsedMailbox of parsedMailboxes) {
                    addressMap.set(parsedMailbox.email, true);
                }
            }
        }
        const addresses = Array.from(addressMap.keys());
        if (verbose) {
            console.debug("sent to: ", addresses);
        }
        const filterctl = await getFilterDataController();
        for (const address of addresses) {
            const whitelisted = await filterctl.bookContainsAddress(accountId, "whitelist", address, { domain: true });
            if (whitelisted) {
                if (verbose) {
                    console.debug(`address ${address} is already whitelisted`);
                }
            } else {
                if (verbose) {
                    console.debug(`address ${address} is not whitelisted`);
                }
                const prompt = `Add "${address}" to whitelist?`;
                if (await messenger.servicesPrompt.confirm("New mail recipient", prompt)) {
                    if (verbose) {
                        console.debug(`user accepted, adding ${address} whitelist`);
                    }
                    await filterctl.addAddressToFilterBook(accountId, address, "whitelist");
                } else {
                    if (verbose) {
                        console.debug(`user declined, not adding ${address} to whitelist`);
                    }
                }
            }
        }
    } catch (e) {
        console.error(e);
    }
}

///////////////////////////////////////////////////////////////////////////////
//
//  event wiring
//
///////////////////////////////////////////////////////////////////////////////

messenger.compose.onAfterSend.addListener(onAfterSend);

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
