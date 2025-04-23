//
//  filterctl.js
//

import { accountEmailAddress, isValidEmailAddress, isValidBookName } from "./common.js";
import { isAccount, getAccount, getAccounts } from "./accounts.js";
import { config } from "./config.js";
import { verbosity } from "./common.js";
import { displayProcess } from "./display.js";

/* global console, messenger */

////////////////////////////////////////////////////////////////////////////////
//
//  CLASSES
//
//  FilterDataController
//	API for interacting with filterctl and manipulating Books and Classes
//
//  Books
//	set of FilterBook address books for an account
//
//  Classes
//	set sof SpamClass Levels for an account
//
//  Levels
//	internal class used by Classes
//
//  FilterData
//	base class for dataset items Books, Classes
//
////////////////////////////////////////////////////////////////////////////////

const verbose = verbosity.filterctl;

const DEFAULT_CLASS_LEVELS = {
    ham: 0,
    probable: 5,
    spam: 999,
};

const SUCCESS = true;
const FAILURE = false;

const MIN_SCORE = parseFloat(-100.0);
const MAX_SCORE = parseFloat(100.0);
const SPAM_SCORE = parseFloat(999);

const CLASSES = "classes";
const BOOKS = "books";

//
// validation functions
//
// validate* functions return { error: MESSAGE|false, value: VALIDATED_VALUE }
// isValid* return bool
//
function validationFailed(error = "validation failed", value = undefined, owner = undefined) {
    if (owner !== undefined) {
        owner.errors.push(error);
        owner.valid = false;
    }
    return value;
}

function validateType(type, owner = undefined) {
    if (typeof type === "string") {
        if (type === CLASSES || type === BOOKS) {
            return type;
        }
    }
    return validationFailed("unknown type:" + type, type, owner);
}

function isValidScore(score) {
    const stringValue = String(score);
    const parsedValue = parseFloat(stringValue);
    return isFinite(parsedValue) && !isNaN(parsedValue) && parsedValue.toString() === stringValue;
}

export function validateLevelName(name, owner = undefined) {
    if (typeof name !== "string") {
        return validationFailed("class name type not string", name, owner);
    }
    name = name.trim();
    name = name.replace(/\s/g, "_");
    if (name.length === 0) {
        return validationFailed("missing class name", name, owner);
    }
    if (!/^[a-zA-Z]/.test(name)) {
        return validationFailed("class names must start with a letter", name, owner);
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        return validationFailed(`illegal characters in class name: '${name}'`, name, owner);
    }
    return name;
}

export function validateLevelScore(score, owner = undefined) {
    if (typeof score !== "number" && typeof score !== "string") {
        return validationFailed("score type must be string or number", score, owner);
    }

    // check score string value
    if (typeof score === "string") {
        score = score.trim();
        if (score.length === 0) {
            return validationFailed("missing threshold value", score, owner);
        }
        if (!/^(-|)(([0-9]+(\.|)[0-9]*)|([0-9]*(\.|)[0-9]+))$/.test(score)) {
            return validationFailed(`illegal characters in threshold: '${score}'`, score, owner);
        }
    }

    if (!isValidScore(score)) {
        return validationFailed("illegal score value", score, owner);
    }
    return parseFloat(score);
}

async function validateAccountId(accountId, owner = undefined) {
    if (!(await isAccount(accountId))) {
        return validationFailed(`invalid accountId: ${accountId}`, accountId, owner);
    }
    return accountId;
}

export function validateEmailAddress(emailAddress, owner = undefined) {
    if (!isValidEmailAddress(emailAddress)) {
        return validationFailed("invalid email address", emailAddress, owner);
    }
    return emailAddress;
}

export function validateBookName(bookName, owner = undefined) {
    if (typeof bookName !== "string") {
        return validationFailed("book name type not string", bookName, owner);
    }
    if (!isValidBookName(bookName)) {
        return validationFailed("invalid book name", bookName, owner);
    }
    return bookName;
}

export class Level {
    constructor(name, score) {
        try {
            this.errors = [];
            this.set(name, score);
        } catch (e) {
            this.errors.push(e);
            console.error(e);
        } finally {
            this.valid = this.errors.length === 0;
        }
    }

    // return a deep copy of this instance
    clone() {
        try {
            let dup = new Level(this.name, this.score);
            if (!dup.valid) {
                throw new Error("Level: clone validation failed: " + dup.error);
            }
            return dup;
        } catch (e) {
            console.error(e);
        }
    }

    // return true if values of level differs from ours
    diff(level) {
        try {
            return this.name !== level.name || this.score !== level.score;
        } catch (e) {
            console.error(e);
        }
    }

    // note: set owner to catch validation errors in the caller instead of this instance
    set(name, score, owner = undefined) {
        try {
            this.name = validateLevelName(name, owner === undefined ? this : owner);
            this.score = validateLevelScore(score, owner === undefined ? this : owner);
            return this;
        } catch (e) {
            this.errors.push(e);
            if (owner !== undefined) {
                owner.errors.push(e);
            }
            console.error(e);
        }
    }
}

// base class for Classes, Books dataset items
export class FilterData {
    constructor(type) {
        try {
            this.accountId = undefined;
            this.valid = false;
            this.errors = [];
            this.type = validateType(type, this);
        } catch (e) {
            console.error(e);
            this.errors.push(e);
        } finally {
            this.setValid();
        }
    }

    setValid() {
        try {
            this.valid = this.errors.length === 0;
            return this.valid;
        } catch (e) {
            console.error(e);
        }
    }

    async setAccountId(accountId) {
        try {
            this.accountId = await validateAccountId(accountId, this);
            return this.setValid();
        } catch (e) {
            this.errors.push(e);
            console.error(e);
            return this.setValid();
        }
    }

    async parse(input) {
        try {
            if (verbose) {
                console.debug("FilterData.parse:", input);
            }
            if (typeof input === "string") {
                input = JSON.parse(input);
            }
            let emailAddress = validateEmailAddress(input.User, this);
            for (const account of Object.values(await getAccounts())) {
                if (accountEmailAddress(account) === emailAddress) {
                    if (this.accountId !== undefined && this.accountId !== account.id) {
                        this.errors.push("parsed User account mismatch");
                    }
                    this.accountId = account.id;
                    break;
                }
            }
            if (this.accountId === undefined) {
                this.errors.push("unknown account");
            }
            return input;
        } catch (e) {
            this.errors.push(e);
            console.error(e);
        } finally {
            this.setValid();
        }
    }
}

// Classes filterset element contains spam class filter levels for an account
export class Classes extends FilterData {
    constructor() {
        super(CLASSES);
        try {
            this.typeName = "FilterClasses";
            this.levels = [];
        } catch (e) {
            this.errors.push(e);
            console.error(e);
        } finally {
            this.setValid();
        }
    }

    isEmpty() {
        try {
            return this.levels.length === 0;
        } catch (e) {
            console.error(e);
        }
    }

    // return a deep copy of this instance
    async clone() {
        try {
            let dup = new Classes();
            dup.accountId = this.accountId;
            for (const level of this.levels) {
                dup.levels.push(level.clone());
            }
            await dup.validate();
            if (this.valid != dup.valid) {
                throw new Error("Classes: clone validation mismatch");
            }
            return dup;
        } catch (e) {
            console.error(e);
        }
    }

    // return array index of level name
    indexOf(levelName) {
        try {
            for (let i = 0; i < this.levels.length; i++) {
                if (this.levels[i].name === levelName) {
                    return i;
                }
            }
            return undefined;
        } catch (e) {
            console.error(e);
        }
    }

    // add a spam class level with specified name and threshold score
    addLevel(name, score) {
        try {
            let level = new Level(name, score, this);
            this.levels.push(level);
        } catch (e) {
            this.errors.push(e);
            console.error(e);
        } finally {
            this.setValid();
        }
    }

    // return true if any values of other differ from this instance
    diff(other, compareAccounts = true) {
        try {
            if (compareAccounts) {
                if (this.accountId !== other.accountId) {
                    return true;
                }
            }
            if (this.levels.length !== other.levels.length) {
                return true;
            }
            for (let i = 0; i < this.levels.length; i++) {
                if (this.levels[i].diff(other.levels[i])) {
                    return true;
                }
            }
            return false;
        } catch (e) {
            console.error(e);
        }
    }

    // return JSON renderable object
    async render() {
        try {
            const account = await getAccount(this.accountId);
            let output = { User: accountEmailAddress(account), Classes: [] };
            for (const level of this.levels) {
                output["Classes"].push({ name: String(level.name), score: parseFloat(level.score) });
            }
            if (verbose) {
                console.debug("Classes.render: returning:", output);
            }
            return output;
        } catch (e) {
            console.error(e);
        }
    }

    // parse from object or json string and validate
    async parse(input) {
        try {
            if (verbose) {
                console.debug("Classes.parse:", input);
            }

            input = await super.parse(input);
            let inputList = input.Classes;
            if (typeof inputList !== "object" || !Array.isArray(inputList)) {
                this.errors.push("input Classes is not a valid list");
                inputList = [];
            }
            for (const item of inputList) {
                if (typeof item !== "object" || item === null) {
                    this.errors.push("invalid item in Classes list: " + String(item));
                } else {
                    this.addLevel(item.name, item.score, this);
                }
            }
            return await this.validate();
        } catch (e) {
            this.errors.push(e);
            console.error(e);
            return this.setValid();
        }
    }

    async validate() {
        try {
            if (!(await isAccount(this.accountId))) {
                this.errors.push("invalid account");
            }

            if (this.levels.length < 2) {
                this.errors.push("level count below minimum");
            }

            let lastScore = undefined;
            let spamClassFound = false;
            let uniqueNames = new Set();
            let uniqueScores = new Set();

            for (const level of this.levels) {
                if (uniqueNames.has(level.name)) {
                    this.errors.push("duplicate class name");
                }
                uniqueNames.add(level.name);

                if (uniqueScores.has(level.score)) {
                    this.errors.push(`duplicate threshold value '${level.score}'`);
                }
                uniqueScores.add(level.score);

                if (lastScore !== undefined) {
                    if (level.score < lastScore) {
                        this.errors.push("thresholds not in ascending order");
                    }
                }
                lastScore = level.score;

                if (level.name === "spam") {
                    spamClassFound = true;

                    if (level.score !== SPAM_SCORE) {
                        this.errors.push("incorrect spam class threshold");
                    }
                } else {
                    if (level.score < MIN_SCORE || level.score > MAX_SCORE) {
                        this.errors.push(`threshold out of range: '${level.score}'`);
                    }
                }
            }

            if (!spamClassFound) {
                this.errors.push("missing spam class");
            }
            return this.setValid();
        } catch (e) {
            this.errors.push(e);
            console.error(e);
            return this.setValid();
        }
    }

    // render the command subject line for an update request
    async renderUpdateRequest() {
        try {
            var values = [];
            for (const level of this.levels) {
                values.push(level.name + "=" + String(level.score));
            }
            let request = {
                command: "reset " + values.join(" "),
                body: {},
            };
            return request;
        } catch (e) {
            console.error(e);
        }
    }
}

// Books filterset element contains address book filters for an account
export class Books extends FilterData {
    constructor() {
        super(BOOKS);
        try {
            this.typeName = "FilterBooks";
            this.books = new Map();
        } catch (e) {
            this.errors.push(e);
            console.error(e);
        } finally {
            this.setValid();
        }
    }

    isEmpty() {
        try {
            return this.books.size === 0;
        } catch (e) {
            console.error(e);
        }
    }

    addBook(name) {
        try {
            name = validateBookName(name, this);
            if (this.books.has(name)) {
                this.errors.push("book name exists");
            } else {
                this.books.set(name, []);
            }
        } catch (e) {
            this.errors.push(e);
            console.error(e);
        } finally {
            this.setValid();
        }
    }

    addAddress(bookName, address) {
        try {
            bookName = validateBookName(bookName, this);
            address = validateEmailAddress(address, this);
            let addresses = this.books.get(bookName);
            if (addresses === undefined) {
                this.errors.push("unknown book name");
                addresses = [];
            }
            let uniques = new Set();
            addresses.forEach((address) => uniques.add(address));
            if (uniques.has(address)) {
                console.warn("ignoring duplicate address:", address);
            } else {
                addresses.push(address);
            }
        } catch (e) {
            this.errors.push(e);
            console.error(e);
        } finally {
            this.setValid();
        }
    }

    names() {
        try {
            let names = [];
            for (const name of this.books.keys()) {
                names.push(name);
            }
            names.sort();
            return names;
        } catch (e) {
            console.error(e);
        }
    }

    addresses(bookName) {
        try {
            let addresses = this.books.get(bookName);
            if (addresses === undefined) {
                throw new Error("unknown book name");
            }
            let result = [];
            for (const address of addresses) {
                result.push(address);
            }
            result.sort();
            return result;
        } catch (e) {
            console.error(e);
        }
    }

    // return JSON renderable object
    async render() {
        try {
            const account = await getAccount(this.accountId);
            let output = { User: accountEmailAddress(account), Books: {} };
            for (const name of this.names()) {
                output.Books[name] = [];
                for (const address of this.addresses(name)) {
                    output.Books[name].push(address);
                }
            }
            if (verbose) {
                console.debug("Books.render: returning:", output);
            }
            return output;
        } catch (e) {
            console.error(e);
        }
    }

    // return a deep copy of this instance
    async clone() {
        try {
            let dup = new Books();
            dup.accountId = this.accountId;
            for (const name of this.names()) {
                dup.addBook(name);
                for (const address of this.addresses(name)) {
                    dup.addAddress(name, address);
                }
            }
            await dup.validate();
            if (this.valid != dup.valid) {
                throw new Error("Books: clone validation mismatch");
            }
            return dup;
        } catch (e) {
            console.error(e);
        }
    }

    // return true if values of other differ from values of this instance
    diff(other, compareAccounts = true) {
        try {
            if (compareAccounts) {
                if (this.accountId !== other.accountId) {
                    return true;
                }
            }
            if (this.books.size != other.books.size) {
                return true;
            }
            const thisNames = this.names();
            const otherNames = other.names();
            for (let i = 0; i < thisNames.length; i++) {
                const name = thisNames[i];
                if (name !== otherNames[i]) {
                    return true;
                }
                const thisAddresses = this.addresses(name);
                const otherAddresses = other.addresses(name);
                if (thisAddresses.length != otherAddresses.length) {
                    return true;
                }
                for (let j = 0; j < thisAddresses.length; j++) {
                    if (thisAddresses[j] !== otherAddresses[j]) {
                        return true;
                    }
                }
            }
            return false;
        } catch (e) {
            console.error(e);
        }
    }

    // parse object or json string
    async parse(input) {
        try {
            if (verbose) {
                console.debug("Books.parse:", input);
            }
            input = await super.parse(input);
            let inputBooks = input.Books;
            if (typeof inputBooks !== "object") {
                this.errors.push("input Books not an object");
                inputBooks = {};
            }
            for (let [name, addresses] of Object.entries(inputBooks)) {
                this.addBook(name);
                if (!Array.isArray(addresses)) {
                    this.errors.push("illegal address list type");
                    addresses = [];
                }
                for (const address of addresses) {
                    this.addAddress(name, address);
                }
            }
            return await this.validate();
        } catch (e) {
            this.errors.push(e);
            console.error(e);
            return this.setValid();
        }
    }

    async validate() {
        try {
            if (!(await isAccount(this.accountId))) {
                this.errors.push("invalid account");
            }
            if (!("books" in this)) {
                this.errors.push("missing books propery");
                return;
            }
            if (!(this.books instanceof Map)) {
                this.errors.push("books is not Map type");
                return;
            }
            for (let [name, list] of this.books) {
                validateBookName(name, this);
                if (!(list instanceof Array)) {
                    this.errors.push("invalid address list:" + String(list));
                    return;
                }
                for (let address of list) {
                    validateEmailAddress(address, this);
                }
            }
            return this.setValid();
        } catch (e) {
            this.errors.push(e);
            console.error(e);
            return this.setValid();
        }
    }

    async renderUpdateRequest() {
        try {
            let renderable = await this.render();
            let request = {
                command: "restore",
                body: { Dump: { Users: {} } },
            };
            let account = await getAccount(this.accountId);
            request.body.Dump.Users[accountEmailAddress(account)] = renderable;
            if (verbose) {
                console.debug("FilterBooks: renderUpdateRequest body:", request.body);
                console.debug("FilterBooks: request JSON:", JSON.stringify(request.body, null, 2));
            }
            return request;
        } catch (e) {
            console.error(e);
        }
    }
}

//
// a dataset is an instance of Classes or Books
// server datasets cache data from latest server response
// dirty datasets contain unsaved local changes
//
// datasets:
//   classes:
//     server:
//       accountId: Classes
//       accountId: Classes
//     dirty:
//       accountId: Clasees
//   books:
//	server:
//	  accountId: Books
//	  accountId: Books
//	dirty:
//

export class FilterDataController {
    constructor(email) {
        try {
            this.locked = false;
            this.waiting = [];
            this.email = email;
            this.initialize();
        } catch (e) {
            console.error(e);
        }
    }

    async lock() {
        try {
            while (this.locked) {
                await new Promise((resolve) => this.waiting.push(resolve));
            }
            this.locked = true;
        } catch (e) {
            console.error(e);
        }
    }

    unlock() {
        try {
            this.locked = false;
            if (this.waiting.length > 0) {
                const next = this.waiting.shift();
                next();
            }
        } catch (e) {
            console.error(e);
        }
    }

    initialize() {
        try {
            this.datasets = {
                classes: {
                    dirty: {},
                    server: {},
                },
                books: {
                    dirty: {},
                    server: {},
                },
            };
            this.passwords = new Map();
        } catch (e) {
            console.error(e);
        }
    }

    async readState() {
        try {
            const enabled = config.local.getBool(config.key.filterctlCacheEnabled);
            if (enabled) {
                console.warn("reading filterctl state from local storage");
                let state = await this.validateState(await config.local.get(config.key.filterctlState));
                this.datasets.classes.dirty = await this.initDatasets(CLASSES, state.classes.dirty);
                this.datasets.classes.server = await this.initDatasets(CLASSES, state.classes.server);
                this.datasets.books.dirty = await this.initDatasets(BOOKS, state.books.dirty);
                this.datasets.books.server = await this.initDatasets(BOOKS, state.books.server);
                this.passwords = await this.initPasswordCache(state.passwords);
            }
        } catch (e) {
            console.error(e);
        }
    }

    async writeState(flags = { force: false }) {
        try {
            const enabled = config.local.getBool(config.key.filterctlCacheEnabled);
            if (enabled || flags.force) {
                console.warn("writing filterctl state to local storage");
                await config.local.set(config.key.filterctlState, await this.state());
            }
        } catch (e) {
            console.error(e);
        }
    }

    async resetState() {
        try {
            this.initialize();
            await this.writeState({ force: true });
        } catch (e) {
            console.error(e);
        }
    }

    // ensure passed-in state object has valid structure
    async validateState(state) {
        try {
            if (typeof state !== "object") {
                if (verbose) {
                    console.debug("resetting undefined state");
                }
                state = {
                    classes: {
                        server: {},
                        dirty: {},
                    },
                    books: {
                        server: {},
                        dirty: {},
                    },
                    passwords: {},
                };
                this.initialize(state);
            }
            await this.validateSubState(state, state.classes.server);
            await this.validateSubState(state, state.classes.dirty);
            await this.validateSubState(state, state.books.server);
            await this.validateSubState(state, state.books.dirty);
            await this.validatePasswordCache(state.passwords);
            return state;
        } catch (e) {
            console.error(e);
        }
    }

    // ensure that state data subtree contains objects keyed by accountId
    async validateSubState(state, substate) {
        try {
            const accounts = await getAccounts();
            for (let [accountId, renderable] of Object.entries(substate)) {
                if (typeof renderable !== "object") {
                    console.debug("invalid state data", substate, state, accountId, renderable);
                    throw new Error("invalid state data");
                }
                if (!Object.hasOwn(accounts, accountId)) {
                    console.debug("invalid account in state", substate, state, accountId);
                    throw new Error("invalid state accountId");
                }
            }
        } catch (e) {
            console.error(e);
        }
    }

    // called with a sub-element of the state object passed to the constructor
    // returns object keyed by accountID with dataset values of type Books or Classes
    // these dataset objects are initialized from the state data and self-validate
    async initDatasets(type, substate) {
        try {
            validateType(type);
            let result = {};
            for (const [accountId, renderable] of Object.entries(substate)) {
                let dataset = await datasetFactory(type, renderable, accountId);
                if (dataset.valid) {
                    result[accountId] = dataset;
                } else {
                    throw new Error(dataset.errors);
                }
            }
            return result;
        } catch (e) {
            console.error(e);
        }
    }

    // takes password state as {string: string}, returns Map
    async initPasswordCache(substate) {
        try {
            let result = new Map();
            for (const [accountId, password] of Object.entries(substate)) {
                result.set(accountId, password);
            }
            return result;
        } catch (e) {
            console.error(e);
        }
    }

    // ensure password cache from state is an object with string keys and string values
    // otherwise return an empty password cache
    async validatePasswordCache(substate) {
        try {
            if (typeof substate !== "object") {
                throw new Error("invalid state password cache type");
            }
            let accounts = await getAccounts();
            for (const [accountId, password] of Object.entries(substate)) {
                if (typeof password !== "string" || password.length === 0) {
                    throw new Error("invalid password in state password cache");
                }
                if (!Object.hasOwn(accounts, accountId)) {
                    console.debug("invalid accountId in state password cache", accountId);
                    throw new Error("invalid accountId in state password cache");
                }
            }
            return substate;
        } catch (e) {
            console.error(e);
        }
    }

    // return JSON-renderable object containing controller's dataset state
    async state() {
        try {
            return {
                classes: {
                    dirty: await this.renderToState(this.datasets.classes.dirty),
                    server: await this.renderToState(this.datasets.classes.server),
                },
                books: {
                    dirty: await this.renderToState(this.datasets.books.dirty),
                    server: await this.renderToState(this.datasets.books.server),
                },
                passwords: await this.renderPasswordsToState(this.passwords),
            };
        } catch (e) {
            console.error(e);
        }
    }

    // return JSON-renderable version of the {accountID: dataset} object
    async renderToState(datasets) {
        try {
            if (verbose) {
                console.debug("renderToState:", datasets);
            }
            let output = {};
            for (let [accountId, dataset] of Object.entries(datasets)) {
                output[accountId] = await dataset.render();
            }
            if (verbose) {
                console.debug("renderToState returning:", output);
            }
            return output;
        } catch (e) {
            console.error(e);
        }
    }

    // return JSON-renderable password map
    async renderPasswordsToState(passwords) {
        try {
            if (verbose) {
                console.debug("renderPasswordsToState:", passwords);
            }
            let output = {};
            for (const [k, v] of this.passwords.entries()) {
                output[k] = v;
            }
            if (verbose) {
                console.debug("renderPasswordsToState returning:", output);
            }
            return output;
        } catch (e) {
            console.error(e);
        }
    }

    // return {accountId: dataset} mapping for all cached datasets including local unsaved changes
    async all(type) {
        try {
            validateType(type);
            let result = {};
            for (const [accountId, dataset] of Object.entries(this.datasets[type].server)) {
                if (accountId in this.datasets[type].dirty) {
                    result[accountId] = await this.datasets[type].dirty[accountId].clone();
                } else {
                    result[accountId] = await dataset.clone();
                }
            }
            return result;
        } catch (e) {
            console.error(e);
        }
    }

    async allClasses() {
        try {
            return await this.all(CLASSES);
        } catch (e) {
            console.error(e);
        }
    }

    async allBooks() {
        try {
            return await this.all(BOOKS);
        } catch (e) {
            console.error(e);
        }
    }

    async getDataset(type, accountId, flags = { throwError: true }) {
        try {
            validateType(type);
            await getAccount(accountId);
            if (Object.hasOwn(this.datasets[type].server, accountId)) {
                if (Object.hasOwn(this.datasets[type].dirty, accountId)) {
                    return await this.datasets[type].dirty[accountId].clone();
                }
                return await this.datasets[type].server[accountId].clone();
            }
            if (flags.throwError) {
                throw new Error(`${type} dataset not found for account ${accountId}`);
            }
            return undefined;
        } catch (e) {
            console.error(e);
        }
    }

    // check if data for the specified type and account has been requested and cached
    async isCached(type, accountId) {
        try {
            validateType(type);
            await getAccount(accountId);
            return Object.hasOwn(this.datasets[type].server, accountId);
        } catch (e) {
            console.error(e);
        }
    }

    async isClassesDatasetCached(accountId) {
        try {
            return await this.isCached(CLASSES, accountId);
        } catch (e) {
            console.error(e);
        }
    }

    async isBooksDatasetCached(accountId) {
        try {
            return await this.isCached(BOOKS, accountId);
        } catch (e) {
            console.error(e);
        }
    }

    // check if data for the specified type and account has pending local changes
    async isDirty(type, accountId) {
        try {
            validateType(type);
            await getAccount(accountId);
            let serverSet = this.datasets[type].server;
            let dirtySet = this.datasets[type].dirty;
            if (!Object.hasOwn(serverSet, accountId)) {
                return undefined;
                //FIXME: don't throw error if the caller is just asking if the account has unsaved changes
                //throw new Error(type + " dataset not found for account " + account.name);
            }
            if (!Object.hasOwn(dirtySet, accountId)) {
                return false;
            }
            const dirty = dirtySet[accountId].diff(serverSet[accountId]);
            if (!dirty) {
                delete this.datasets[type].dirty[accountId];
            }
            return dirty;
        } catch (e) {
            console.error(e);
        }
    }

    async isClassesDirty(accountId) {
        try {
            return await this.isDirty(CLASSES, accountId);
        } catch (e) {
            console.error(e);
        }
    }

    async isBooksDirty(accountId) {
        try {
            return await this.isDirty(BOOKS, accountId);
        } catch (e) {
            console.error(e);
        }
    }

    async getClasses(accountId, force = false) {
        try {
            await this.lock();
            return await this.get(CLASSES, accountId, force);
        } catch (e) {
            console.error(e);
        } finally {
            this.unlock();
        }
    }

    async getBooks(accountId, force = false) {
        try {
            await this.lock();
            return await this.get(BOOKS, accountId, force);
        } catch (e) {
            console.error(e);
        } finally {
            this.unlock();
        }
    }

    //
    // return value from get or set
    // return: {
    //	    success: bool
    //	    source: "cache" or "server"
    //	    message: "description of result or error message if failed"
    //	    books: dataset object
    //	    OR
    //	    classes: dataset_object
    // }
    //
    // return value will contain one of: (books, classes) depending on type parameter
    //

    async get(type, accountId, force = false) {
        try {
            validateType(type);
            await getAccount(accountId);

            if (!force) {
                if (await this.isCached(type, accountId)) {
                    let dataset = await this.getDataset(type, accountId);
                    return await this.validatedDatasetResult(type, accountId, dataset);
                }
            }

            if (verbose) {
                console.debug("get: sending filterctl dump request:", type, accountId);
            }
            let response = await this.email.sendRequest(accountId, "dump", {});
            if (verbose) {
                console.debug("get: filterctl response:", response);
            }
            if (response === undefined || !response) {
                console.error("filterctl request failed:", response);
                throw new Error("Unknown filterctl request failure");
            }

            // parse password from response
            // await this.passwords.set(account.id, response.Password);

            // parse classes from response
            let classes = await datasetFactory(CLASSES, response, accountId);
            if (!classes.valid) {
                console.error("Classes validation failure:", response, classes);
                throw new Error("Unexpected FilterClasses response");
            }
            this.datasets.classes.server[accountId] = classes;

            // parse books from response
            let books = await datasetFactory(BOOKS, response, accountId);
            if (!books.valid) {
                console.error("Books validation Failure:", response, books);
                throw new Error("Unexpected FilterBooks response");
            }
            this.datasets.books.server[accountId] = books;

            // clear pending changes only for the requested type
            delete this.datasets[type].dirty[accountId];

            let dataset = this.datasets[type].server[accountId];
            let message = dataset.typeName + " refreshed from server";

            await this.writeState();

            return await this.datasetResult(type, accountId, dataset, SUCCESS, message);
        } catch (e) {
            console.error(e);
            let error = "Error:" + String(e);
            return await this.datasetResult(type, accountId, undefined, FAILURE, error);
        }
    }

    async datasetResult(type, accountId, dataset, success, message, results = undefined) {
        try {
            let result = { success, message, accountId };
            if (dataset !== undefined) {
                result[type] = await dataset.render();
                result.valid = dataset.valid;
                result.dirty = await this.isDirty(dataset.type, accountId);
            }
            if (results != undefined) {
                result.results = results;
            }
            return result;
        } catch (e) {
            console.error(e);
        }
    }

    async setDataset(type, accountId, dataset) {
        try {
            validateType(type);
            await getAccount(accountId);
            let dirty = dataset.diff(this.datasets[type].server[accountId]);
            if (dirty) {
                this.datasets[type].dirty[accountId] = await dataset.clone();
            } else {
                delete this.datasets[type].dirty[accountId];
            }
            return dirty;
        } catch (e) {
            console.error(e);
        }
    }

    async set(type, accountId, dataset) {
        try {
            if (verbose) {
                console.debug("set:", type, accountId, dataset);
            }
            await dataset.validate();
            await this.setDataset(type, accountId, dataset);
            return await this.validatedDatasetResult(type, accountId, dataset);
        } catch (e) {
            console.error(e);
        }
    }

    async validatedDatasetResult(type, accountId, dataset) {
        try {
            let state = SUCCESS;
            let message = undefined;
            await dataset.validate();
            let dirty = await this.isDirty(type, accountId);
            if (dataset.valid) {
                if (dirty) {
                    message = "Unsaved Validated " + dataset.typeName + " changes";
                } else {
                    message = "Validated " + dataset.typeName;
                }
            } else {
                message = "Validation failed: " + dataset.errors[0];
                state = FAILURE;
            }
            return await this.datasetResult(type, accountId, dataset, state, message);
        } catch (e) {
            console.error(e);
        }
    }

    async setBooks(accountId, books) {
        try {
            await this.lock();
            if (verbose) {
                console.debug("setBooks:", accountId, books);
            }
            let updateBooks = await datasetFactory(BOOKS, books, accountId);
            if (verbose) {
                console.debug("setBooks updateBooks:", updateBooks);
            }
            return await this.set(BOOKS, accountId, books);
        } catch (e) {
            console.error(e);
        } finally {
            this.unlock();
        }
    }

    async setClasses(accountId, classes) {
        try {
            await this.lock();
            if (verbose) {
                console.debug("setClasses:", accountId, classes);
            }
            let updateClasses = await datasetFactory(CLASSES, classes, accountId);
            if (verbose) {
                console.debug("setClasses updateClasses:", updateClasses);
            }
            let result = await this.set(CLASSES, accountId, updateClasses);
            if (verbose) {
                console.debug("setClasses returning:", result);
            }
            return result;
        } catch (e) {
            console.error(e);
        } finally {
            this.unlock();
        }
    }

    async sendClasses(accountId, force = false) {
        try {
            await this.lock();
            if (verbose) {
                console.debug("sendClasses:", accountId, force);
            }
            let result = await this.send(CLASSES, accountId, force);
            if (verbose) {
                console.debug("sendClasses returning:", result);
            }
            return result;
        } catch (e) {
            console.error(e);
        } finally {
            this.unlock();
        }
    }

    async sendBooks(accountId, force = false) {
        try {
            await this.lock();
            if (verbose) {
                console.debug("sendBooks:", accountId, force);
            }
            let result = await this.send(BOOKS, accountId, force);
            if (verbose) {
                console.debug("sendBooks returning:", result);
            }
            return result;
        } catch (e) {
            console.error(e);
        } finally {
            this.unlock();
        }
    }

    async setDefaults(type, accountId) {
        try {
            let defaults = undefined;
            switch (type) {
                case CLASSES:
                    defaults = new Classes();
                    for (const [name, score] of Object.entries(DEFAULT_CLASS_LEVELS)) {
                        defaults.addLevel(name, score);
                    }
                    break;
                case BOOKS:
                    defaults = new Books();
                    break;
                default:
                    throw new Error("unexpected type");
            }
            await defaults.setAccountId(accountId);
            await defaults.validate();
            console.assert(defaults.valid, "setDefaults validation failed");
            await this.set(type, accountId, defaults);
            return await this.datasetResult(type, accountId, defaults, SUCCESS, defaults.typeName + " reset to default values");
        } catch (e) {
            console.error(e);
        }
    }

    async setBooksDefaults(accountId) {
        try {
            await this.lock();
            return await this.setDefaults(BOOKS, accountId);
        } catch (e) {
            console.error(e);
        } finally {
            this.unlock();
        }
    }

    async setClassesDefaults(accountId) {
        try {
            await this.lock();
            return await this.setDefaults(CLASSES, accountId);
        } catch (e) {
            console.error(e);
        } finally {
            this.unlock();
        }
    }

    async send(type, accountId, force) {
        try {
            validateType(type);
            await getAccount(accountId);
            const dataset = await this.getDataset(type, accountId);
            if (force || (await this.isDirty(type, accountId))) {
                await dataset.validate();
                if (!dataset.valid) {
                    throw new Error(`Validation failed: ${dataset.errors[0]}`);
                }
                let update = await dataset.renderUpdateRequest();
                if (verbose) {
                    console.debug("sending filterctl update:", update);
                }
                const response = await this.email.sendRequest(accountId, update.command, update.body);
                if (verbose) {
                    console.debug("filterctl update response", response);
                }

                let validator = await datasetFactory(type, response, accountId);
                if (!validator.valid) {
                    console.error("send: response failed validation:", dataset, update, response, validator);
                    throw new Error("Update response validation failure(3)");
                }

                // ensure dataset we sent matches the validator parsed from the server response
                if (dataset.diff(validator)) {
                    console.error("send: update response mismatch:", dataset, update, response, validator);
                    throw new Error("Update response mismatch(1)");
                }

                delete this.datasets[type].dirty[accountId];
                this.datasets[type].server[accountId] = await dataset.clone();

                // FIXME: redundant test
                let serverSet = this.datasets[type].server[accountId];
                if (dataset.diff(serverSet)) {
                    console.error("send: dataset mismatches server cache:", dataset, serverSet);
                    throw new Error("Update response mismatch(2)");
                }

                return await this.datasetResult(
                    type,
                    accountId,
                    validator,
                    SUCCESS,
                    dataset.typeName + " successfully uploaded to server",
                );
            }
            return await this.datasetResult(type, accountId, dataset, SUCCESS, dataset.typeName + " unchanged");
        } catch (e) {
            console.error(e);
            return await this.datasetResult(type, accountId, undefined, FAILURE, String(e));
        }
    }

    // send all dirty datasets of type to mailserver
    async sendAll(type, force = false) {
        try {
            validateType(type);
            let datasets = await this.all(type);
            let results = {};
            let success = true;
            let uploads = 0;
            let fails = 0;
            for (const accountId of Object.keys(datasets)) {
                const result = await this.send(type, accountId, force);
                results[accountId] = result;
                if (result.success) {
                    uploads++;
                } else {
                    fails++;
                    success = false;
                }
            }
            let message = "No pending changes.";
            if (uploads !== 0 || fails !== 0) {
                message = "Uploaded changes:";
                if (uploads > 0) {
                    message += " (" + uploads + " successful)";
                }
                if (fails > 0) {
                    message += " (" + fails + " failed)";
                }
            }
            return await this.datasetResult(type, undefined, undefined, success, message, results);
        } catch (e) {
            console.error(e);
        }
    }

    async sendAllClasses(force = false) {
        try {
            return await this.sendAll(CLASSES, force);
        } catch (e) {
            console.error(e);
        }
    }

    async sendAllBooks(force = false) {
        try {
            return await this.sendAll(BOOKS, force);
        } catch (e) {
            console.error(e);
        }
    }

    // refresh all datasets of type from mailserver
    async refreshAll(type) {
        try {
            validateType(type);
            let results = {};
            let success = true;
            let refreshes = 0;
            let fails = 0;
            let force = true;
            const accounts = await getAccounts();
            for (const accountId of Object.keys(accounts)) {
                const result = await this.get(type, accountId, force);
                results[accountId] = result;
                if (result.success) {
                    refreshes++;
                } else {
                    fails++;
                    success = false;
                }
            }
            let message = "No accounts to refresh.";
            if (refreshes !== 0 || fails !== 0) {
                message = "Refreshed from server:";
                if (refreshes > 0) {
                    message += " (" + refreshes + " successful)";
                }
                if (fails > 0) {
                    message += " (" + fails + " failed)";
                }
            }
            return await this.datasetResult(type, undefined, undefined, success, message, results);
        } catch (e) {
            console.error(e);
        }
    }

    async refreshAllClasses() {
        try {
            return await this.refreshAll(CLASSES);
        } catch (e) {
            console.error(e);
        }
    }

    async refreshAllBooks() {
        try {
            return await this.refreshAll(BOOKS);
        } catch (e) {
            console.error(e);
        }
    }

    async getPassword(accountId) {
        try {
            if (verbose) {
                console.log("getPassword:", accountId);
            }
            let password = this.passwords.get(accountId);
            if (password !== undefined) {
                if (verbose) {
                    console.log("returning cached password:", accountId);
                }
                return password;
            }
            await this.queryAccount(accountId);
            password = this.passwords.get(accountId);
            if (password === undefined) {
                throw new Error("password query failed");
            }
            return password;
        } catch (e) {
            console.error(e);
        }
    }

    async queryAccount(accountId) {
        try {
            if (verbose) {
                console.debug("queryAccount before:", this.passwords.map);
            }
            let account = await getAccount(accountId);
            console.assert(account.id === accountId);
            let username = accountEmailAddress(account);
            let message = await displayProcess(`Requesting cardDAV credentials for ${username}`);

            let response = await this.email.sendRequest(accountId, "passwd");
            if (verbose) {
                console.debug("queryAccounts: response:", response);
            }
            if (response.Success) {
                console.assert(response.User === username);
                this.passwords.set(accountId, response.Password);
                await message.complete(`Received cardDAV credentials for ${username}`);
                await this.writeState();
                if (verbose) {
                    console.debug("queryAccount after:", this.passwords.map);
                }
            } else {
                await message.fail(`CardDAV credential query for ${username}: ${response.message}`);
            }
            return;
        } catch (e) {
            console.error(e);
        }
    }

    async purgePending() {
        try {
            this.datasets[BOOKS].dirty = {};
            this.datasets[CLASSES].dirty = {};
        } catch (e) {
            console.error(e);
        }
    }

    async purgeCachedBooks(accountId) {
        try {
            await getAccount(accountId);
            delete this.datasets[BOOKS].server[accountId];
            delete this.datasets[BOOKS].dirty[accountId];
        } catch (e) {
            console.error(e);
        }
    }

    // FIXME: try doing this with carddav only
    async addSenderToFilterBook(accountId, senderAddress, bookName) {
        try {
            await getAccount(accountId);
            let command = "mkaddr " + bookName + " " + senderAddress;
            let response = await this.email.sendRequest(accountId, command, {});
            await this.purgeCachedBooks(accountId);
            if (verbose) {
                console.debug("get: filterctl response:", response);
            }
            return response;
        } catch (e) {
            console.error(e);
        }
    }

    async getCardDAVBooks(accountId, force = false) {
        try {
            const account = await getAccount(accountId);
            let username = accountEmailAddress(account);
            let books;
            if (force || books === undefined) {
                books = [];
                let password = await this.getPassword(accountId);
                for (const book of await messenger.cardDAV.list(username, password)) {
                    let listBook = Object.assign({}, book);
                    listBook.detail = Object.assign({}, book.detail);
                    books.push(listBook);
                }
            }
            console.assert(Array.isArray(books));
            console.log(`getCardDAVBooks(${username}) returning:`, books);
            return books;
        } catch (e) {
            console.error(e);
        }
    }
}

export async function datasetFactory(type, renderable = undefined, accountId = undefined) {
    try {
        if (verbose) {
            console.debug("datasetFactory:", type, renderable, accountId);
        }
        validateType(type);
        let dataset = undefined;
        switch (type) {
            case BOOKS:
                dataset = new Books();
                break;
            case CLASSES:
                dataset = new Classes();
                break;
        }
        if (accountId !== undefined) {
            await dataset.setAccountId(accountId);
        }
        if (renderable !== undefined) {
            await dataset.parse(renderable);
        }
        return dataset;
    } catch (e) {
        console.error(e);
    }
}

export const booksFactory = (renderable = undefined, accountId = undefined) => datasetFactory(BOOKS, renderable, accountId);
export const classesFactory = (renderable = undefined, accountId = undefined) => datasetFactory(CLASSES, renderable, accountId);

console.log("filterctl.js executing");
