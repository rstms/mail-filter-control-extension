/* global console, ChromeUtils, Services */

var { ExtensionCommon } = ChromeUtils.import("resource://gre/modules/ExtensionCommon.jsm");

var servicesPrompt = class extends ExtensionCommon.ExtensionAPI {
    getAPI() {
        return {
            servicesPrompt: {
                async confirm(title, message) {
                    return Services.prompt.confirm(null, title, message);
                },
            },
        };
    }
};

console.log(servicesPrompt);
