///////////////////////////////////////////////////////////////////////////////
//
//  menu configuration
//
///////////////////////////////////////////////////////////////////////////////

export const menuConfig = {
    rmfControlPanel: {
        properties: {
            title: "Mail Filter Control Panel",
            contexts: ["tools_menu", "action", "folder_pane"],
        },
        onClicked: "onMenuControlPanelClicked",
    },

    rmfOpenRescans: {
        properties: {
            title: "Mail Filter Active Rescans",
            contexts: ["tools_menu", "action", "folder_pane"],
        },
        onClicked: "onMenuOpenRescansClicked",
    },

    rmfAddSenderAddress: {
        properties: {
            title: "Add Sender Address to Filter Book",
            contexts: ["message_list", "message_display_action"],
            checked: true,
        },
        onCreated: "onMenuAddBooksCreated",
        subId: "rmfBook",
        excludeFolders: ["Sent", "Drafts"],
        addressMode: "address",
        requireSelection: true,
    },

    rmfAddSenderDomain: {
        properties: {
            title: "Add Sender Domain to Filter Book",
            contexts: ["message_list", "message_display_action"],
            checked: true,
        },
        onCreated: "onMenuAddBooksCreated",
        subId: "rmfBook",
        excludeFolders: ["Sent", "Drafts"],
        addressMode: "domain",
        requireSelection: true,
    },

    rmfRemoveSenderAddress: {
        properties: {
            title: "Remove Sender Address from all Filter Books",
            contexts: ["message_list", "message_display_action"],
        },
        onClicked: "onMenuRemoveSenderClicked",
        excludeFolders: ["Sent", "Drafts"],
        addressMode: "address",
        requireSelection: true,
    },

    rmfRemoveSenderDomain: {
        properties: {
            title: "Remove Sender Domain from all Filter Books",
            contexts: ["message_list", "message_display_action"],
        },
        onClicked: "onMenuRemoveSenderClicked",
        excludeFolders: ["Sent", "Drafts"],
        addressMode: "domain",
        requireSelection: true,
    },

    rmfAddRecipientAddress: {
        properties: {
            title: "Add Recipient Address to Whitelist",
            contexts: ["message_list", "message_display_action"],
        },
        onClicked: "onMenuAddRecipientClicked",
        includeFolders: ["Sent"],
        addressMode: "address",
        requireSelection: true,
    },

    rmfAddRecipientDomain: {
        properties: {
            title: "Add Recipient Domain to Whitelist",
            contexts: ["message_list", "message_display_action"],
        },
        onClicked: "onMenuAddRecipientClicked",
        includeFolders: ["Sent"],
        addressMode: "domain",
        requireSelection: true,
    },

    rmfRemoveRecipientAddress: {
        properties: {
            title: "Remove Recipient Address from Whitelist",
            contexts: ["message_list", "message_display_action"],
        },
        onClicked: "onMenuRemoveRecipientClicked",
        includeFolders: ["Sent"],
        addressMode: "address",
        requireSelection: true,
    },

    rmfRemoveRecipientDomain: {
        properties: {
            title: "Remove Recipient Domain from Whitelist",
            contexts: ["message_list", "message_display_action"],
        },
        onClicked: "onMenuRemoveRecipientClicked",
        includeFolders: ["Sent"],
        addressMode: "address",
        requireSelection: true,
    },

    rmfFilterBookSeparator: {
        properties: {
            type: "separator",
            contexts: ["message_list", "message_display_action"],
        },
        excludeFolders: ["Sent", "Drafts"],
    },

    rmfSetDefaultFilterBook: {
        properties: {
            title: "Set Default Filter Book",
            contexts: ["message_list", "message_display_action"],
        },
        onCreated: "onMenuAddBooksCreated",
        subId: "rmfTargetBook",
        excludeFolders: ["Sent", "Drafts"],
    },

    rmfSetFilterBookMode: {
        properties: {
            title: "Set Filter Book Address Mode",
            contexts: ["message_list", "message_display_action"],
        },
        excludeFolders: ["Sent", "Drafts"],
    },

    rmfFilterBookAddressModeAddress: {
        properties: {
            title: "Match By Address",
            contexts: ["message_list", "message_display_action"],
            parentId: "rmfSetFilterBookMode",
            type: "radio",
        },
        onShown: "onMenuFilterBookAddressModeShown",
        onClicked: "onMenuFilterBookAddressModeClicked",
        excludeFolders: ["Sent", "Drafts"],
    },

    rmfFilterBookAddressModeDomain: {
        properties: {
            title: "Match By Domain",
            contexts: ["message_list", "message_display_action"],
            parentId: "rmfSetFilterBookMode",
            type: "radio",
        },
        onShown: "onMenuFilterBookAddressModeShown",
        onClicked: "onMenuFilterBookAddressModeClicked",
        excludeFolders: ["Sent", "Drafts"],
    },

    rmfRescanSeparator: {
        properties: {
            type: "separator",
            contexts: ["folder_pane", "message_list"],
        },
        excludeFolders: ["Sent", "Drafts"],
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

    rmfRescanFilterBooksFolder: {
        properties: {
            title: "Reapply Filter Books to All Messages in Folder",
            contexts: ["folder_pane"],
        },
        onClicked: "onMenuRescanFilterBooksFolderClicked",
        excludeFolders: ["Sent", "Drafts"],
    },

    rmfRescanFilterBooksMessages: {
        properties: {
            title: "Reapply Filter Books to Selected Messages",
            contexts: ["message_list"],
        },
        onClicked: "onMenuRescanFilterBooksMessagesClicked",
        excludeFolders: ["Sent", "Drafts"],
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

    rmfTargetBook: {
        account: "__account__",
        properties: {
            title: "__book__",
            type: "radio",
            parentId: "rmfSetDefaultFilterBook",
        },
        noInit: true,
        onClicked: "onMenuSetDefaultFilterBookClicked",
        excludeFolders: ["Sent", "Drafts"],
    },

    rmfBook: {
        account: "__account-id__",
        book: "__book__",
        properties: {
            title: "Add __mode__ to '__book__'",
        },
        onClicked: "onMenuAddSenderClicked",
        noInit: true,
        excludeFolders: ["Sent", "Drafts"],
        requireSelection: true,
    },
};
