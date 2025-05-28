import { verbosity } from "./common.js";

/* globals console, messenger */

const verbose = verbosity.filterbook;

export async function getFolderByPath(accountId, path) {
    try {
        if (verbose) {
            console.debug("getFolderByPath:", accountId, path);
        }
        const folders = await messenger.folders.query({ accountId });
        if (verbose) {
            console.log(folders);
        }
        for (const folder of folders) {
            if (folder.path === path) {
                return folder;
            }
        }
    } catch (e) {
        console.error(e);
    }
}

export async function moveMessagesToFilterBook(accountId, book, messageIds) {
    try {
        if (verbose) {
            console.debug("moveMessagesToFilterBook:", accountId, book, messageIds);
        }
        const destination = await getFolderByPath(accountId, `/FilterBooks/${book}`);
        if (destination) {
            await messenger.messages.move(messageIds, destination.id);
        } else {
            console.warn("not moving; destination FilterBook not found", { messageIds });
        }
    } catch (e) {
        console.error(e);
    }
}

export async function isFolder(accountId, path) {
    try {
        let folders = await messenger.folders.query({ accountId, path });
        if (folders.length === 1) {
            return true;
        }
        return false;
    } catch (e) {
        console.error(e);
    }
}

export async function folderInfoByPath(accountId, path) {
    try {
        if (await isFolder(accountId, path)) {
            const folder = await getFolderByPath(accountId, path);
            return await messenger.folders.getFolderInfo(folder.id);
        }
    } catch (e) {
        console.error(e);
    }
}

export async function folderMessageCountByPath(accountId, path) {
    try {
        let count = 0;
        const info = await folderInfoByPath(accountId, path);
        if (info) {
            count = info.totalMessageCount;
        }
        return count;
    } catch (e) {
        console.error(e);
    }
}

export async function makeFilterBookFolder(accountId, name) {
    try {
        if (verbose) {
            console.debug("makeFilterBookFolder:", accountId, name);
        }
        const path = `/FilterBooks/${name}`;
        if (await isFolder(accountId, path)) {
            if (verbose) {
                console.log("exists:", { accountId, name, path });
            }
            return;
        }
        if (!(await isFolder(accountId, "/FilterBooks"))) {
            const rootFolder = await getFolderByPath(accountId, "/");
            let ret = await messenger.folders.create(rootFolder.id, "FilterBooks");
            if (verbose) {
                console.debug("folders.create:", rootFolder.id, "FilterBooks", ret);
            }
        }
        const filterBooksFolder = await getFolderByPath(accountId, "/FilterBooks");
        let ret = await messenger.folders.create(filterBooksFolder.id, name);
        if (verbose) {
            console.debug("folders.create:", filterBooksFolder.id, name, ret);
            let folder = await getFolderByPath(accountId, path);
            if (verbose) {
                console.log("created:", folder);
            }
        }
    } catch (e) {
        console.error(e);
    }
}
