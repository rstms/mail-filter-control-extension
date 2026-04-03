///////////////////////////////////////////////////////////////////////////////
//
//  menu configuration
//
///////////////////////////////////////////////////////////////////////////////

export const menuConfig = {
    rmfControlPanel: {
        properties: {
            title: "Mail Filter Control Panel",
            contexts: ["tools_menu", "action", "message_list", "message_display_action"],
        },
        onClicked: "onMenuControlPanelClicked",
    },

    rmfOpenRescans: {
        properties: {
            title: "Mail Filter Active Rescans",
            contexts: ["tools_menu", "action"],
        },
        onClicked: "onMenuOpenRescansClicked",
    },

    rmfAddSenderMessageList: {
        properties: {
            title: "Add Sender to Filter Book",
            contexts: ["message_list"],
        },
        onCreated: "onMenuAddBooksCreated",
        subId: "rmfBook",
        hideAfterCreate: true,
        excludeFolders: ["Sent"],
    },

    rmfAddSenderMessageDisplayAction: {
        properties: {
            title: "Add Sender to Filter Book",
            contexts: ["message_display_action"],
        },
        onCreated: "onMenuAddBooksCreated",
        subId: "rmfBook",
        hideAfterCreate: true,
        excludeFolders: ["Sent"],
    },

    rmfRescanMessagesSeparator: {
        properties: {
            type: "separator",
            contexts: ["message_list"],
        },
        excludeFolders: ["Sent"],
    },

    rmfRescanFolder: {
        properties: {
            title: "Rescan All Messages in Folder",
            contexts: ["folder_pane"],
        },
        onClicked: "onMenuRescanFolderClicked",
        excludeFolders: ["Sent", "Drafts"],
    },

    rmfRescanMessages: {
        properties: {
            title: "Rescan Selected Messages",
            contexts: ["message_list"],
        },
        onClicked: "onMenuRescanMessagesClicked",
        excludeFolders: ["Sent", "Drafts"],
        requireSelection: true,
    },

    rmfRemoveSender: {
        properties: {
            title: "Remove sender from all Filter Books",
            contexts: ["message_list"],
        },
        onClicked: "onMenuRemoveSenderClicked",
        excludeFolders: ["Sent"],
        requireSelection: true,
    },

    rmfAddRecipient: {
        properties: {
            title: "Add recipient to whitelist",
            contexts: ["message_list"],
        },
        onClicked: "onMenuAddRecipientClicked",
        includeFolders: ["Sent"],
        requireSelection: true,
    },

    rmfRemoveRecipient: {
        properties: {
            title: "Remove recipient from whitelist",
            contexts: ["message_list"],
        },
        onClicked: "onMenuRemoveRecipientClicked",
        includeFolders: ["Sent"],
        requireSelection: true,
    },

    rmfSieveSeparator: {
        properties: {
            type: "separator",
            contexts: ["folder_pane"],
        },
    },

    rmfSieveTrace: {
        properties: {
            title: "Sieve Trace Enabled",
            contexts: ["folder_pane"],
            type: "checkbox",
        },
        onCreated: "onMenuSieveTraceCreated",
        onClicked: "onMenuSieveTraceClicked",
        onShown: "onMenuSieveTraceShown",
    },

    rmfBook: {
        account: "__account-id__",
        book: "__book__",
        properties: {
            title: "Add sender to '__book__'",
        },
        onClicked: "onMenuAddSenderClicked",
        noInit: true,
        excludeFolders: ["Sent"],
        requireSelection: true,
    },

    rmfSelectAddSenderSeparator: {
        properties: {
            type: "separator",
            contexts: ["message_display_action"],
        },
        excludeFolders: ["Sent"],
    },

    rmfSelectAddSenderTarget: {
        properties: {
            title: "Select 'Add Sender' Target",
            contexts: ["message_display_action"],
        },
        onCreated: "onMenuAddBooksCreated",
        subId: "rmfTargetBook",
        excludeFolders: ["Sent"],
    },

    rmfTargetBook: {
        account: "__account__",
        properties: {
            title: "__book__",
            type: "radio",
            parentId: "rmfSelectAddSenderTarget",
        },
        noInit: true,
        onClicked: "onMenuSelectBookClicked",
        excludeFolders: ["Sent"],
    },
};
