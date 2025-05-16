/* global Components, console, ChromeUtils, MessageSend, Cc, Ci */

var { ExtensionCommon } = ChromeUtils.import("resource://gre/modules/ExtensionCommon.jsm");
var { MailServices } = ChromeUtils.import("resource:///modules/MailServices.jsm");

ChromeUtils.defineESModuleGetters(this, {
    MessageSend: "resource:///modules/MessageSend.sys.mjs",
});

var backgroundSend = class extends ExtensionCommon.ExtensionAPI {
    getAPI() {
        return {
            backgroundSend: {
                async sendMail(message) {
                    class MessageSender {
                        constructor(message) {
                            this.stopped = false;
                            this.drafted = false;

                            this.accountId = message.accountId;
                            const account = MailServices.accounts.getAccount(message.accountId);
                            this.identity = null;
                            for (const aid of account.identities) {
                                if (aid.key === message.identityId) {
                                    this.identity = aid;
                                    break;
                                }
                            }
                            this.fields = Cc["@mozilla.org/messengercompose/composefields;1"].createInstance(Ci.nsIMsgCompFields);
                            this.fields.from = message.from;
                            this.fields.to = message.to;
                            this.fields.subject = message.subject;

                            if (Array.isArray(message.headers)) {
                                for (const header of message.headers) {
                                    this.fields.setHeader(header.key, header.value);
                                }
                            }

                            if (typeof message.messageId === "string") {
                                this.fields.messageId = message.messageId;
                            }

                            this.body = message.body;
                            if (typeof this.body !== "string" || this.body === "") {
                                this.body = "{}";
                            }
                            /*
                            console.log("MessageSender constructor: ", {
                                accountId: this.accountid,
                                identity: this.identity,
                                fields: this.fields,
                                body: this.body,
                            });
			    */
                        }

                        onStartSending() {
                            //console.log("onStartSending");
                        }
                        onProgress() {
                            //console.log("onProgress");
                        }
                        onStopSending(msgId, status) {
                            //console.log("onStopSending:", { msgId, status });
                            this.messageId = msgId.replace(/^<|>$/g, "");
                            this.status = status;
                            this.stopped = true;
                            if (Components.isSuccessCode(status)) {
                                this.checkResolve();
                            } else {
                                this.reject(new Error(`SendFailed: msgId=${msgId} status=${status}`));
                            }
                        }
                        onGetDraftFolderURI(msgId, folderURI) {
                            //console.log("onGetDraftFolderURI:", { msgId, folderURI });
                            this.messageId = msgId.replace(/^<|>$/g, "");
                            this.folderURI = folderURI;
                            this.drafted = true;
                            this.checkResolve();
                        }
                        onSendNotPerformed() {
                            //console.log("onSendNotPerformed");
                            this.reject(new Error("SendNotPerformed"));
                        }
                        onTransportSecurityError() {
                            //console.log("onTransportSecurityError");
                            this.reject(new Error("TransportSecurityError"));
                        }

                        checkResolve() {
                            if (this.stopped && this.drafted) {
                                this.resolve({ messageId: this.messageId, folderURI: this.folderURI, status: this.status });
                            }
                        }

                        result() {
                            return new Promise((resolve, reject) => {
                                this.resolve = resolve;
                                this.reject = reject;
                                this.sender = new MessageSend();
                                //console.log("calling createAndSendMessage");
                                this.sender
                                    .createAndSendMessage(
                                        null, // editor
                                        this.identity, // userIdentity
                                        this.accountId, // accountKey
                                        this.fields, // compFields
                                        false, // isDigest
                                        false, // dontDeliver
                                        Ci.nsIMsgSend.nsIMsgDeliverNow, // deliverMode
                                        null, // msgToReplace
                                        "text/plain", // bodyType
                                        this.body, // body
                                        null, // parentWindow
                                        null, // progress
                                        this, // listener
                                        null, // smtpPassword
                                        null, // originalMsgURI
                                        Ci.nsIMsgCompType.New, // compType
                                    )
                                    .then(() => {
                                        //console.log("createAndSendMessage returned:", ret);
                                    });
                            });
                        }
                    }

                    const sender = new MessageSender(message);
                    const result = await sender.result();
                    return result;
                },
            },
        };
    }
};
console.log(backgroundSend);
