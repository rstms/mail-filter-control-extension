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
        let destFolder = `/FilterBooks/${book}`;
        if (book === "whitelist") {
            destFolder = "/INBOX/Whitelisted";
        }
        const destination = await getFolderByPath(accountId, destFolder);
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
        var parentName = "FilterBooks";
        var folderName = name;
        if (name === "whitelist") {
            parentName = "INBOX";
            folderName = "Whitelisted";
        }
        if (await isFolder(accountId, `/${parentName}/${folderName}`)) {
            return;
        }
        // ensure parent exists
        if (!(await isFolder(accountId, `/${parentName}`))) {
            const rootFolder = await getFolderByPath(accountId, "/");
            const parent = await messenger.folders.create(rootFolder.id, parentName);
            if (verbose) {
                console.debug("folders.create parent folder created:", accountId, parent);
            }
        }
        // create folder under parent
        const parent = await getFolderByPath(accountId, `/${parentName}`);
        const folder = await messenger.folders.create(parent.id, folderName);
        if (verbose) {
            console.log("created:", accountId, folder);
        }
    } catch (e) {
        console.error(e);
    }
}
