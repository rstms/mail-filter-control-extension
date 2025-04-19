/* global console, ChromeUtils, Services */

var { ExtensionCommon } = ChromeUtils.import("resource://gre/modules/ExtensionCommon.jsm");
var { MailServices } = ChromeUtils.import("resource:///modules/MailServices.jsm");

var backgroundSend = class extends ExtensionCommon.ExtensionAPI {
    getAPI() {
        return {
            backgroundSend: {
                async set(enable) {
                    Services.prefs.setBoolPref("mailnews.sendInBackground", enable);
                    Services.prefs.setBoolPref("mailnews.show_send_progress", !enable);
                },
                async get() {
                    return Services.prefs.getBoolPref("mailnews.sendInBackground");
                },
                async flush() {
                    let localFolders = MailServices.accounts.localFoldersServer.rootFolder;
                    let outbox = localFolders.getChildNamed("Outbox");
                    if (outbox) {
                        let count = 0;
                        let enumerator = outbox.messages;
                        while (enumerator.hasMoreElements()) {
                            enumerator.getNext();
                            ++count;
                        }
                        console.log("outbox:", count, outbox);
                        if (count > 0) {
                            let cmd = "cmd_sendUnsentMsgs";
                            let window = Services.wm.getMostRecentWindow("mail:3pane");
                            let dispatcher = window.document.commandDispatcher;
                            let controller = dispatcher.getControllerForCommand(cmd);
                            controller.doCommand(cmd);
                        }
                    }
                },
            },
        };
    }
};

console.log(backgroundSend);
