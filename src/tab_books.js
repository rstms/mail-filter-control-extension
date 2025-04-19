//
// books editor tab
//

import { Books, booksFactory, validateBookName } from "./filterctl.js";
import { accountEmailAddress, isValidBookName, verbosity } from "./common.js";
import { getAccount, getAccounts, getSelectedAccount } from "./accounts.js";

/* globals console, document, messenger */

/////////////////////////////
//
// control elements:
//
// accountSelect
// bookSelect
//
// addressesMenu
//
// statusSpan
//
// addInput
// addButton
// deleteInput
// deleteButton
//
// addressesSelect
//
// addSenderSpan
// addSenderMenu
//
// connectionsDropdown
//
// table
// tableBody
// tableRow
//
// scanButton
// disconnectButton
//

const verbose = verbosity.tab_books;
const dumpHTML = false;

//const DROPDOWN_MENU_PREFIX = '<a class="dropdown-item" href="#">';
//const DROPDOWN_MENU_SUFFIX = "</a>";

export class BooksTab {
    constructor(disableEditorControl, sendMessage, handlers) {
        this.initialized = false;
        this.disableEditorControl = disableEditorControl;
        this.sendMessage = sendMessage;
        this.handlers = handlers;
        this.controls = {};
        this.accounts = undefined;

        // current Books object
        this.books = undefined;

        // current account object
        this.account = undefined;

        this.booksIndex = {};
        this.accountIndex = {};

        // per account data
        this.connectedBooks = {};
        this.serverBooks = {};
        this.selectedBooks = {};
    }

    // called when account selection changes
    async selectAccount(accountId) {
        try {
            if (verbose) {
                console.debug("Books.selectAccount:", accountId);
            }
            this.account = await getAccount(accountId);
            await this.populate();
            await this.populateAddSenderTarget();
            await this.populateConnections(this.isConnectionsExpanded());
        } catch (e) {
            console.error(e);
        }
    }

    // request books for selected account from filterctl
    async getBooks(flags) {
        try {
            if (verbose) {
                console.debug("BooksTab.getBooks", flags);
            }

            let disableStatusPrompt = flags.disableStatusPrompt === true;
            let disablePopulate = flags.disablePopulate === true;
            let disableStatusUpdate = flags.disableStatusUpdate === true;

            if (!disableStatusPrompt) {
                await this.setStatus("Requesting FilterBooks refresh...", "FilterBooks request failed");
            }
            const response = await this.sendMessage({
                id: "getBooks",
                accountId: this.account.id,
                force: flags.force === true,
            });
            const books = await this.handleResponse(response, disablePopulate, disableStatusUpdate);
            if (verbose) {
                console.debug("BooksTab.getBooks: returning:", books);
            }
            return books;
        } catch (e) {
            console.error(e);
        }
    }

    // handle filterctl response
    async handleResponse(response, disablePopulate = false, disableStatusUpdate = false) {
        try {
            if (verbose) {
                if (verbose) {
                    console.debug("handleResponse:", response);
                }
            }
            let books = response.books;
            if (typeof books !== "undefined") {
                if (typeof books === "object") {
                    // parse the rendered message data into a Books object
                    console.assert(response.accountId === this.account.id, "server response account ID mismatch");
                    books = await booksFactory(response.books, response.accountId);
                }
                console.assert(books instanceof Books, "books is not an instance of Books");
                if (!disablePopulate) {
                    await this.populate(books);
                }
            }
            if (!disableStatusUpdate) {
                await this.setStatus(response.message);
            }
            if (verbose) {
                console.debug("handleResponse: returning:", books);
            }
            return books;
        } catch (e) {
            console.error(e);
        }
    }

    async sendCommand(command, argument) {
        try {
            const message = {
                id: "sendCommand",
                accountId: this.account.id,
                command: command,
                argument: argument,
            };
            this.setStatus("Sending command: '" + command + " " + argument + "'...", "Error: timeout awaiting command response");
            const response = await this.sendMessage(message);
            if (verbose) {
                console.debug("response:", response);
            }
            if (response === undefined) {
                this.setStatus("Error: command failed");
            } else {
                this.setStatus(response.Message);
            }
            return response;
        } catch (e) {
            console.error(e);
        }
    }

    setStatus(text, timeoutText = undefined) {
        try {
            if (verbose) {
                console.debug("books.setStatus:", text);
            }

            //
            // TODO: if timeout active, clear it
            //

            if (text === undefined) {
                console.error("caller attempted to set status to undefined");
                return;
            }

            this.controls.statusSpan.innerHTML = text;

            if (timeoutText !== undefined) {
                // TODO: disable controls and set timer
            }
        } catch (e) {
            console.error(e);
        }
    }

    async enableControls(enabled) {
        try {
            let names = [
                "accountSelect",
                "bookSelect",
                "addressesButton",
                "addressesMenu",
                "addSenderButton",
                "addSenderMenu",
                "addInput",
                "deleteInput",
                "connectionsDropdown",
                "table",
                "scanButton",
                "disconnectButton",
            ];

            for (const name of names) {
                this.controls[name].disabled = !enabled;
            }
            this.enableAddButton(enabled);
            this.enableDeleteButton(enabled);
        } catch (e) {
            console.error(e);
        }
    }

    enableAddButton(enabled = undefined) {
        try {
            if (enabled !== false) {
                let name = this.controls.addInput.value.trim();
                enabled = isValidBookName(name) && !this.isBookName(name);
            }
            this.controls.addButton.disabled = !enabled;
            return enabled;
        } catch (e) {
            console.error(e);
        }
    }

    enableDeleteButton(enabled = undefined) {
        try {
            if (enabled !== false) {
                enabled = this.isBookName(this.controls.deleteInput.value.trim());
            }
            this.controls.deleteButton.disabled = !enabled;
        } catch (e) {
            console.error(e);
        }
    }

    async getCardDAVPassword(account) {
        try {
            let response = await this.sendMessage({ id: "getPassword", accountId: account.id });
            if (verbose) {
                console.debug("getPassword: response:", response);
            }
            return response.result;
        } catch (e) {
            console.error(e);
        }
    }

    async initialize() {
        try {
            this.accounts = await getAccounts();
            this.account = await getSelectedAccount();
            let i = 0;
            this.accountIndex = {};
            for (const account of Object.values(this.accounts)) {
                this.accountIndex[i] = account;
                this.accountIndex[account.id] = account;
                this.accountIndex[accountEmailAddress(account)] = account;
                i++;
            }
            this.controls.addButton.disabled = true;
            this.controls.deleteButton.disabled = true;
            this.initialized = true;
        } catch (e) {
            console.error(e);
        }
    }

    async populate(books = undefined) {
        try {
            if (verbose) {
                console.debug("populate");
            }
            if (!this.initialized) {
                await this.initialize();
            }
            if (books === undefined) {
                books = await this.getBooks({ disablePopulate: true });
            }
            this.books = books;
            if (verbose) {
                console.debug("populate: books:", this.books);
            }
            await this.populateBooks();
            await this.enableControls(true);
        } catch (e) {
            console.error(e);
        }
    }

    async populateBooks() {
        try {
            this.controls.bookSelect.innerHTML = "";
            this.booksIndex = {};
            let i = 0;
            for (const name of this.books.names()) {
                this.booksIndex[name] = i;
                this.booksIndex[i] = name;
                i++;
                const row = document.createElement("option");
                row.textContent = name;
                this.controls.bookSelect.appendChild(row);
            }
            await this.selectBook();
        } catch (e) {
            console.error(e);
        }
    }

    // return selected book name for selected account
    selectedBook() {
        try {
            let bookName = this.selectedBooks[this.account.id];
            if (bookName === undefined) {
                bookName = this.books.names()[0];
            }
            this.selectedBooks[this.account.id] = bookName;
            return bookName;
        } catch (e) {
            console.error(e);
        }
    }

    // handle new selected book, updating controls and saving selected book for each account
    async selectBook(bookName = undefined) {
        try {
            if (verbose) {
                console.debug("booksTab.selectBook:", bookName);
            }
            if (bookName === undefined) {
                bookName = this.selectedBook();
            }
            this.selectedBooks[this.account.id] = bookName;
            this.controls.bookSelect.selectedIndex = this.booksIndex[bookName];
        } catch (e) {
            console.error(e);
        }
    }

    async populateDropdown(control, items) {
        try {
            control.innerHTML = "";
            for (const text of items) {
                let label = document.createElement("a");
                label.classList.add("dropdown-item");
                label.setAttribute("href", "#");
                label.textContent = text;
                control.appendChild(label);
            }
        } catch (e) {
            console.error(e);
        }
    }

    async populateAddSenderTarget(bookName = undefined) {
        try {
            if (bookName === undefined) {
                let response = await this.sendMessage({ id: "getAddSenderTarget", accountId: this.account.id });
                bookName = response.result;
            }
            this.controls.addSenderSpan.innerHTML = " " + bookName + " ";
        } catch (e) {
            console.error(e);
        }
    }

    async populateConnections(force = false) {
        try {
            if (this.tableRowTemplate === undefined) {
                let rows = this.controls.tableBody.getElementsByTagName("tr");
                this.tableRowTemplate = rows[0];
                if (dumpHTML) {
                    console.debug("tableRowTemplate:", this.tableRowTemplate);
                }
                this.controls.tableBody.innerHTML = "";
            }

            if (!this.isConnectionsExpanded()) {
                return;
            }

            await this.scanConnectedBooks(force);

            let cxnmap = {};
            for (const cxn of this.connectedBooks[this.account.id]) {
                if (cxn !== undefined) {
                    cxnmap[cxn.book] = cxn;
                }
            }
            this.controls.tableBody.innerHTML = "";
            for (const book of Object.keys(cxnmap).sort()) {
                let cxn = cxnmap[book];
                let row = document.createElement("tr");

                let templateCells = this.tableRowTemplate.getElementsByTagName("td");
                for (let i = 0; i < 3; i++) {
                    let cell = document.createElement("td");
                    cell.innerHTML = templateCells[i].innerHTML;
                    row.appendChild(cell);
                }

                this.controls.tableBody.appendChild(row);

                for (const label of row.getElementsByTagName("label")) {
                    let cellId = label.getAttribute("data-cell-id");
                    switch (cellId) {
                        case "book-name":
                            label.textContent = cxn.book;
                            break;
                        case "connection-name":
                            label.textContent = cxn.token;
                            break;
                    }
                }
                for (const check of row.getElementsByTagName("input")) {
                    let cellId = check.getAttribute("data-cell-id");
                    switch (cellId) {
                        case "connected":
                            check.checked = cxn.connected;
                            check.setAttribute("data-cxn-uuid", cxn.uuid);
                            check.addEventListener("click", this.handlers.ConnectionChanged);
                            break;
                    }
                }
            }
        } catch (e) {
            console.error(e);
        }
    }

    isConnectionsExpanded() {
        try {
            const expanded = this.controls.connectionsDropdown.getAttribute("aria-expanded") === "true";
            if (verbose) {
                console.debug("isConnectionsExpanded returning:", expanded);
            }
            return expanded;
        } catch (e) {
            console.error(e);
        }
    }

    async saveChanges() {
        try {
            if (verbose) {
                console.debug("books tab save changes");
            }
            // books tab has no pending state
            return { succes: true };
        } catch (e) {
            console.error(e);
        }
    }

    //////////////////////////////////////////////////////
    //
    // carddav connection management
    //
    //////////////////////////////////////////////////////

    //////////////////////////////////////////////////////////////////////////
    //
    // list cardDAV books available for account
    //
    //////////////////////////////////////////////////////////////////////////

    async scanServerBooks(force = false) {
        try {
            if (force) {
                this.serverBooks[this.account.id] = undefined;
            }
            if (this.serverBooks[this.account.id] !== undefined) {
                return;
            }
            this.serverBooks[this.account.id] = {};

            const username = accountEmailAddress(this.account);
            const password = await this.getCardDAVPassword(this.account);
            this.setStatus("Scanning CardDAV server books...");
            if (verbose) {
                console.debug("calling cardDAV.list...");
            }
            let books = await messenger.cardDAV.list(username, password);
            if (verbose) {
                console.debug("cardDAV.list returned:", books);
            }
            this.setStatus("CardDAV server scan complete");
            for (const book of books) {
                console.assert(book.username === username);
                this.serverBooks[this.account.id][book.name] = book;
            }
            if (verbose) {
                console.debug("scanServerBooks complete.  serverBooks:", this.serverBooks);
            }
        } catch (e) {
            console.error(e);
        }
    }

    //
    // list connected cardDAV books in address books
    //

    // scan connected books for all accounts
    async scanConnectedBooks(force = false) {
        try {
            if (verbose) {
                console.debug("scanConnectedBooks:", force);
            }

            if (force) {
                this.connectedBooks = {};
            }

            if (this.connectedBooks[this.account.id] !== undefined) {
                return;
            }

            this.connectedBooks = {};
            for (const accountId of Object.keys(this.accounts)) {
                this.connectedBooks[accountId] = [];
            }

            this.setStatus("Scanning Address Book CardDAV connections...");
            if (verbose) {
                console.debug("calling cardDAV.connected...");
            }
            const connected = await messenger.cardDAV.connected();
            if (verbose) {
                console.debug("cardDAV.connected returned:", connected);
            }
            this.setStatus("Address Book CardDAV scan complete");

            let hasConnection = {};

            for (const cxn of connected) {
                let account = this.accountIndex[cxn.username];
                if (account === undefined) {
                    throw new Error("connection has invalid username");
                }
                this.connectedBooks[account.id].push(cxn);
                hasConnection[cxn.book] = true;
            }

            await this.scanServerBooks(force);
            for (const [name, cxn] of Object.entries(this.serverBooks[this.account.id])) {
                if (hasConnection[name] !== true) {
                    console.assert(cxn !== undefined);
                    if (cxn !== undefined) {
                        this.connectedBooks[this.account.id].push(cxn);
                    }
                }
            }
            if (verbose) {
                console.debug("scanConnectedBooks complete. connectedBooks:", this.connectedBooks);
            }
        } catch (e) {
            console.error(e);
        }
    }

    connectionName(account, bookName) {
        try {
            let name = accountEmailAddress(account) + "-" + bookName;
            return name.replace(/[^a-zA-Z0-9]/g, "-");
        } catch (e) {
            console.error(e);
        }
    }

    async isConnectedBook(bookName) {
        try {
            await this.scanConnectedBooks();
            let connected = false;
            for (const cxn of this.connectedBooks[this.account.id]) {
                if (cxn.book === bookName && cxn.connected === true && cxn.type === "connection") {
                    connected = true;
                    break;
                }
            }
            if (verbose) {
                console.debug("isConnectedBook:", bookName, connected);
            }
            return connected;
        } catch (e) {
            console.error(e);
        }
    }

    async connectBook(cxn) {
        try {
            if (cxn.connected === true) {
                console.error("connection already connected:", cxn, this.account);
                this.setStatus("FilterBook " + cxn.book + "is already connected");
                return false;
            } else if (cxn.type !== "listing") {
                console.error("connection not listing:", cxn, this.account);
                this.setStatus("FilterBook " + cxn.book + "is not connectable");
                return false;
            } else if (cxn.username !== accountEmailAddress(this.account)) {
                console.error("connection username mismatch:", cxn, this.account);
                this.setStatus("FilterBook " + cxn.book + " is not associated with the selected account");
                return false;
            }
            this.setStatus("Connecting FilterBook '" + cxn.book + "'...");

            const password = await this.getCardDAVPassword(this.account);
            if (verbose) {
                console.debug("calling cardDAV.connect:", cxn.username, password, cxn.token);
            }
            let result = await messenger.cardDAV.connect(cxn.username, password, cxn.token);
            if (verbose) {
                console.debug("connectBook: cardDAV.connect returned:", result);
            }

            this.setStatus("FilterBook '" + cxn.book + "' is connected as '" + cxn.token + "'...");
            await this.scanConnectedBooks(true);
            await this.populateConnections(true);
            return true;
        } catch (e) {
            console.error(e);
        }
    }

    async disconnectBook(cxn) {
        try {
            if (verbose) {
                console.debug("disconnectBook:", cxn);
            }
            if (verbose) {
                console.debug("calling cardDAV.disconnect:", cxn.uuid);
            }
            let result = await messenger.cardDAV.disconnect(cxn.uuid);
            if (verbose) {
                console.debug("cardDAV.disconnect returned:", result);
            }
        } catch (e) {
            console.error(e);
        }
    }

    async disconnectAllBooks() {
        try {
            if (verbose) {
                console.debug("disconnectAllBooks");
            }
            await this.scanConnectedBooks();
            let count = 0;
            for (const cxn of this.connectedBooks[this.account.id]) {
                count++;
                await this.disconnectBook(cxn);
            }
            if (verbose) {
                console.debug("disconnected:", count);
            }
            if (count > 0) {
                await this.scanConnectedBooks(true);
                await this.populateConnections();
            }
        } catch (e) {
            console.error(e);
        }
    }

    //////////////////////////////////////////////////////
    //
    // address book add/delete functions
    //
    //////////////////////////////////////////////////////

    isBookName(name) {
        try {
            for (const bookName of this.books.names()) {
                if (name === bookName) {
                    return true;
                }
            }
            return false;
        } catch (e) {
            console.error(e);
        }
    }

    validateBookName(bookName) {
        try {
            let catcher = { errors: [] };
            const validated = validateBookName(bookName, catcher);
            for (const error of catcher.errors) {
                this.setStatus("Add Disabled: " + error);
                return false;
            }
            this.setStatus("Ready to Add: " + validated);
            return validated;
        } catch (e) {
            console.error(e);
        }
    }

    async addOrDeleteBook(command, prefix, control) {
        try {
            if (verbose) {
                console.debug("onAddClick");
            }
            let bookName = control.value.trim();
            bookName = this.validateBookName(bookName);
            if (bookName === false) {
                return;
            }
            // we may be deleting the selected book
            if (bookName === this.selectedBook()) {
                this.selectedBooks[this.account.id] = undefined;
            }
            control.value = "";
            this.setStatus(prefix + " FilterBook '" + bookName + "'...");
            let response = await this.sendCommand(command, bookName);
            if (verbose) {
                console.debug("addOrDeleteBook: response:", response);
            }
            // force refresh filterctl because we changed the books
            await this.getBooks({ force: true, noPrompt: true });
            // tell background to initialize the menus
            await this.sendMessage("initMenus");
            await this.populateConnections(true);
        } catch (e) {
            console.error(e);
        }
    }

    //////////////////////////////////////////////////////
    //
    // control event handlers
    //
    //////////////////////////////////////////////////////

    async onBookSelectChange(sender) {
        try {
            if (verbose) {
                console.debug("onBookSelectChange:", sender);
            }
            const index = sender.target.selectedIndex;
            const bookName = this.booksIndex[index];
            if (verbose) {
                console.debug("onBookSelectChange:", index, bookName, sender.target.id);
            }
            await this.selectBook(bookName);
        } catch (e) {
            console.error(e);
        }
    }

    // switch to connect/disconnect current book cardDAV address book connection
    async onConnectionChanged(sender) {
        try {
            if (verbose) {
                console.debug("onConnectionChanged:", sender.target.checked, sender);
            }
            let uuid = sender.target.getAttribute("data-cxn-uuid");
            for (const cxn of this.connectedBooks[this.account.id]) {
                if (cxn.uuid === uuid) {
                    if (sender.target.checked) {
                        console.assert(cxn.connected === false);
                        if (verbose) {
                            console.debug("connect:", sender.target, cxn);
                        }
                        await this.connectBook(cxn);
                    } else {
                        console.assert(cxn.connected === true);
                        if (verbose) {
                            console.debug("disconnect:", sender.target, cxn);
                        }
                        await this.disconnectBook(cxn);
                    }
                }
            }
            await this.populateConnections(true);
        } catch (e) {
            console.error(e);
        }
    }

    // scan carddav connections button
    async onScanClick() {
        try {
            if (verbose) {
                console.debug("onScanClick");
            }
            await this.populateConnections(true);
        } catch (e) {
            console.error(e);
        }
    }

    async onConnectionsDropdownChange() {
        try {
            let expanded = this.isConnectionsExpanded();
            if (verbose) {
                console.debug("onConnectionsDropdownChange:", expanded);
            }
            if (expanded) {
                this.controls.connectionsDropdown.textContent = "Hide Connections";
                this.populateConnections(true);
            } else {
                this.controls.connectionsDropdown.textContent = "Show Connections";
            }
        } catch (e) {
            console.error(e);
        }
    }

    async onAddressesClick() {
        try {
            if (verbose) {
                console.debug("onAddressesClick");
            }
            this.populateDropdown(this.controls.addressesMenu, this.books.addresses(this.selectedBook()));
        } catch (e) {
            console.error(e);
        }
    }

    async onAddSenderClick() {
        try {
            if (verbose) {
                console.debug("onAddSenderClick");
            }
            this.populateDropdown(this.controls.addSenderMenu, this.books.names());
        } catch (e) {
            console.error(e);
        }
    }

    async handleAddSenderTargetChanged(message) {
        try {
            if (!this.initialized) {
                await this.initialize();
            }
            if (message.accountId === this.account.id) {
                await this.populateAddSenderTarget(message.bookName);
            }
        } catch (e) {
            console.error(e);
        }
    }

    // select current book as account 'add sender' target
    async onAddSenderMenuClick(sender) {
        try {
            if (verbose) {
                console.debug("onAddSenderMenuClick:", sender, sender.target.textContent);
            }
            const bookName = sender.target.textContent;
            await this.populateAddSenderTarget(bookName);
            await this.sendMessage({
                id: "setAddSenderTarget",
                accountId: this.account.id,
                bookName: bookName,
            });
        } catch (e) {
            console.error(e);
        }
    }

    // disconnect all button
    async onDisconnectClick() {
        try {
            if (verbose) {
                console.debug("onDisconnectClick");
            }
            await this.disconnectAllBooks();

            if (verbose) {
                console.debug("connectedBooks:", this.connectedBooks);
            }
        } catch (e) {
            console.error(e);
        }
    }

    async onAddInputKeyup() {
        try {
            this.validateBookName(this.controls.addInput.value.trim());
            this.enableAddButton();
        } catch (e) {
            console.error(e);
        }
    }

    async onAddClick() {
        try {
            await this.addOrDeleteBook("mkbook", "Adding", this.controls.addInput);
        } catch (e) {
            console.error(e);
        }
    }

    async onDeleteInputKeyup() {
        try {
            this.enableDeleteButton();
        } catch (e) {
            console.error(e);
        }
    }

    async onDeleteClick() {
        try {
            await this.addOrDeleteBook("rmbook", "Deleting", this.controls.deleteInput);
        } catch (e) {
            console.error(e);
        }
    }
}
