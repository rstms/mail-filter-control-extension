/* global console, ChromeUtils, Cc, Ci */

var { ExtensionCommon } = ChromeUtils.import("resource://gre/modules/ExtensionCommon.jsm");

// eslint-disable-next-line no-unused-vars
var credentials = class extends ExtensionCommon.ExtensionAPI {
    getAPI() {
        return {
            credentials: {
                async get(accountId) {
                    const server = Cc["@mozilla.org/messenger/account-manager;1"]
                        .getService(Ci.nsIMsgAccountManager)
                        .getAccount(accountId).incomingServer;
                    console.log(server);
                    return {
                        id: accountId,
                        name: server.prettyName,
                        hostname: server.hostName,
                        username: server.username,
                        password: server.password,
                    };
                },
            },
        };
    }
};
