/* global console, ChromeUtils, CardDAVUtils, CryptoUtils  */

var { ExtensionCommon } = ChromeUtils.import("resource://gre/modules/ExtensionCommon.jsm");
var { MailServices } = ChromeUtils.import("resource:///modules/MailServices.jsm");

ChromeUtils.defineESModuleGetters(this, {
    CardDAVUtils: "resource:///modules/CardDAVUtils.sys.mjs",
    CryptoUtils: "resource://services-crypto/utils.sys.mjs",
});

const NULL_BOOKS_RETRY_LIMIT = 3;
const DETECT_BOOKS_RETRY_LIMIT = 5;

// eslint-disable-next-line no-unused-vars
var cardDAV = class extends ExtensionCommon.ExtensionAPI {
    getAPI() {
        return {
            cardDAV: {
                pathToken(path) {
                    let parts = path.split("/");
                    let index = parts.indexOf("addressbooks");
                    return parts[index + 2];
                },
                pathUsername(path) {
                    let parts = path.split("/");
                    let index = parts.indexOf("addressbooks");
                    return parts[index + 1];
                },
                tokenBook(email, token) {
                    return token.substring(email.length + 1);
                },
                hostname(username) {
                    return "https://" + username.split("@")[1];
                },
                book(dir) {
                    let serverURL = dir.getStringValue("carddav.url", "");
                    let username = this.pathUsername(serverURL);
                    let token = this.pathToken(serverURL);
                    let book = this.tokenBook(username, token);
                    return {
                        name: dir.dirName,
                        token: token,
                        book: book,
                        username: username,
                        url: serverURL,
                        uuid: dir.UID,
                        connected: true,
                        type: "connection",
                        detail: {
                            uri: dir.URI,
                            fileName: dir.fileName,
                            description: dir.description,
                            childCardCount: dir.childCardCount,
                            prefId: dir.prefId,
                            type: dir.type,
                            isMailList: dir.isMailList,
                            isRemote: dir.isRemote,
                            isSecure: dir.isSecure,
                            readOnly: dir.readOnly,
                            supportsMailingLists: dir.supportsMailingLists,
                        },
                    };
                },
                async connected() {
                    let books = [];
                    for (const dir of MailServices.ab.directories) {
                        if (dir.dirType === MailServices.ab.CARDDAV_DIRECTORY_TYPE) {
                            books.push(this.book(dir));
                        }
                    }
                    return books;
                },
                async generateHashUUID(url) {
                    const hex = await CryptoUtils.sha256(url);
                    return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}`;
                },
                async list(username, password) {
                    //console.log("list:", username, password);
                    let bookNames = [];
                    let books = {};
                    let hostname = this.hostname(username);
                    let tries = 0;
                    let matched = false;
                    while (!matched) {
                        let detected = await CardDAVUtils.detectAddressBooks(username, password, hostname, false);
                        //console.log("detected:", detected);
                        if (detected.length === 0) {
                            if (++tries >= NULL_BOOKS_RETRY_LIMIT) {
                                matched = true;
                            }
                        }
                        for (const book of detected) {
                            let token = this.pathToken(book.url.pathname);
                            let uuid = await this.generateHashUUID(book.url.href + username);
                            let email = this.pathUsername(book.url.pathname);
                            matched = username === email;
                            if (!matched) {
                                console.error("username mismatch:", username, email, book);
                                if (++tries < DETECT_BOOKS_RETRY_LIMIT) {
                                    break;
                                }
                                throw new Error("retries exceeded");
                            }
                            bookNames.push(book.name);
                            books[book.name] = {
                                name: book.name,
                                token: token,
                                book: this.tokenBook(username, token),
                                username: username,
                                url: book.url.href,
                                uuid: uuid,
                                connected: false,
                                type: "listing",
                                detail: {
                                    hostname: book.url.host,
                                    href: book.url.href,
                                    origin: book.url.origin,
                                    pathname: book.url.pathname,
                                },
                            };
                        }
                    }
                    // return the list sorted by book name
                    bookNames.sort();
                    let ret = [];
                    for (const name of bookNames) {
                        ret.push(books[name]);
                    }
                    //console.log("list returning:", ret);
                    return ret;
                },
                async connect(username, password, token) {
                    //console.log("connect:", username, password, token);
                    let result = {
                        username: username,
                        token: token,
                        connected: false,
                    };
                    let serverBook = undefined;
                    let books = await CardDAVUtils.detectAddressBooks(username, password, this.hostname(username), false);
                    //console.log("connect: books:", books);
                    for (const book of books) {
                        let bookToken = this.pathToken(book.url.pathname);
                        if (bookToken === token) {
                            serverBook = book;
                            break;
                        }
                    }
                    if (serverBook === undefined) {
                        result.error = "token not found";
                        return result;
                    }
                    const cxn = await serverBook.create();

                    //FIXME: try a book that doesn't exist to see what failure returns

                    if (cxn._initialized !== true || typeof cxn._uid !== "string" || cxn._uid.length !== 36) {
                        result.error = "connection failed";
                        return result;
                    }
                    // read in the new directory and change the name to the token
                    let dir = MailServices.ab.getDirectoryFromUID(cxn._uid);
                    dir.dirName = token;
                    let book = this.book(dir);
                    return book;
                },
                async disconnect(uuid) {
                    let ret;
                    let dir = MailServices.ab.getDirectoryFromUID(uuid);
                    if (dir) {
                        MailServices.ab.deleteAddressBook(dir.URI);
                        ret = `${uuid} disconnected`;
                    } else {
                        ret = `${uuid} not found`;
                    }
                    return ret;
                },
                async get(uuid) {
                    //console.log("get:", uuid);
                    let dir = MailServices.ab.getDirectoryFromUID(uuid);
                    //console.log("get: dir:", dir);
                    let book = this.book(dir);
                    //console.log("get: book:", book);
                    if (dir.dirType === MailServices.ab.CARDDAV_DIRECTORY_TYPE) {
                        book = this.book(dir);
                    } else {
                        book = {
                            uuid: uuid,
                            connected: false,
                            type: "error",
                            error: "not a cardDAV directory",
                        };
                    }
                    //console.log("get returning:", book.user);
                    return book;
                },
            },
        };
    }
};
