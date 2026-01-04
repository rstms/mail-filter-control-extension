/* global ExtensionCommon, Services */

// eslint-disable-next-line no-unused-vars
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
