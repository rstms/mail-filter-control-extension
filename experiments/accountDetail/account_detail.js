/* global ChromeUtils, Cc, Ci */

var { ExtensionCommon } = ChromeUtils.import("resource://gre/modules/ExtensionCommon.jsm");

// eslint-disable-next-line no-unused-vars
var accountDetail = class extends ExtensionCommon.ExtensionAPI {
    getAPI() {
        return {
            accountDetail: {
                async get(accountId) {
                    const accountManager = Cc["@mozilla.org/messenger/account-manager;1"].getService(Ci.nsIMsgAccountManager);
                    const account = accountManager.getAccount(accountId);
                    const defaultIdentity = account.defaultIdentity;
                    const server = account.incomingServer;

                    return {
                        id: accountId,
                        name: server.prettyName,
                        hostname: server.hostName,
                        username: server.username,
                        password: server.password,
                        domain: server.hostName.replace(/^[^.]*./, ""),
                        email: defaultIdentity.email,
                    };
                },
            },
        };
    }
};
