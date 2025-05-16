/* global console, ChromeUtils, FetchHTTP, ClientAuthDialogService  */

var { ExtensionCommon } = ChromeUtils.import("resource://gre/modules/ExtensionCommon.jsm");

ChromeUtils.defineESModuleGetters(this, {
    FetchHTTP: "resource:///modules/accountcreation/FetchHTTP.sys.mjs",
    ClientAuthDialogService: "resource://gre/modules/psm/ClientAuthDialogService.sys.mjs",
});

var apiClient = class extends ExtensionCommon.ExtensionAPI {
    getAPI() {
        return {
            apiClient: {
                request(url, args) {
                    return new Promise((resolve, reject) => {
                        let fetch = new FetchHTTP(
                            url,
                            args,
                            (s) => {
                                resolve(s);
                            },
                            (s) => {
                                reject(s);
                            },
                        );
                        fetch.start();
                    });
                },
                async get(url, header) {
                    try {
                        let cads = new ClientAuthDialogService();
                        console.log("ClientAuthDialogService:", cads);
                        return await this.request(url, {
                            post: false,
                            headers: header,
                            requireSecureAuth: true,
                            allowAuthPrompt: true,
                            allowCache: false,
                            username: "api",
                            password: "howdy_howdy_howdy",
                        });
                    } catch (e) {
                        console.error(e);
                    }
                },
                async post(url, header, body) {
                    try {
                        console.log("post unimplemented:", url, header, body);
                    } catch (e) {
                        console.error(e);
                    }
                },
            },
        };
    }
};

console.log(apiClient);
