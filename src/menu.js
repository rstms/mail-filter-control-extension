//////////////////////////////////////////////////////////////////////////////
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
        alwaysVisible: true,
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
        },
        onCreated: "onMenuAddBooksCreated",
        subId: "rmfBook",
        excludeFolders: ["^/Sent$", "^/Drafts$", "^/Archives/.*"],
        addressMode: "address",
        requireSelection: true,
    },

    rmfAddSenderDomain: {
        properties: {
            title: "Add Sender Domain to Filter Book",
            contexts: ["message_list", "message_display_action"],
        },
        onCreated: "onMenuAddBooksCreated",
        subId: "rmfBook",
        excludeFolders: ["^/Sent$", "^/Drafts$", "^/Archives/.*"],
        addressMode: "domain",
        requireSelection: true,
    },

    rmfFilterBookSeparator: {
        properties: {
            type: "separator",
            contexts: ["message_list", "message_display_action"],
        },
        excludeFolders: ["^/Sent$", "^/Drafts$", "^/Archives/.*"],
    },

    rmfRemoveSenderAddress: {
        properties: {
            title: "Remove Sender Address from all Filter Books",
            contexts: ["message_list", "message_display_action"],
        },
        onClicked: "onMenuRemoveSenderClicked",
        includeFolders: ["^/FilterBooks/[a-zA-Z_-]+$"],
        addressMode: "address",
        requireSelection: true,
    },

    rmfRemoveSenderAddressWhitelist: {
        properties: {
            title: "Remove Sender Address from Whitelist",
            contexts: ["message_list", "message_display_action"],
        },
        onClicked: "onMenuRemoveSenderClicked",
        includeFolders: ["^/INBOX/Whitelisted$"],
        addressMode: "address",
        requireSelection: true,
    },

    rmfRemoveSenderDomain: {
        properties: {
            title: "Remove Sender Domain from all Filter Books",
            contexts: ["message_list", "message_display_action"],
        },
        onClicked: "onMenuRemoveSenderClicked",
        includeFolders: ["^/FilterBooks/[a-zA-Z_-]+$"],
        addressMode: "domain",
        requireSelection: true,
    },

    rmfRemoveSenderDomainWhitelist: {
        properties: {
            title: "Remove Sender Domain from Whitelist",
            contexts: ["message_list", "message_display_action"],
        },
        onClicked: "onMenuRemoveSenderClicked",
        includeFolders: ["^/INBOX/Whitelisted$"],
        addressMode: "domain",
        requireSelection: true,
    },

    rmfAddRecipientAddress: {
        properties: {
            title: "Add Recipient Address to Whitelist",
            contexts: ["message_list", "message_display_action"],
        },
        onClicked: "onMenuAddRecipientClicked",
        includeFolders: ["^/Sent$"],
        addressMode: "address",
        requireSelection: true,
    },

    rmfAddRecipientDomain: {
        properties: {
            title: "Add Recipient Domain to Whitelist",
            contexts: ["message_list", "message_display_action"],
        },
        onClicked: "onMenuAddRecipientClicked",
        includeFolders: ["^/Sent$"],
        addressMode: "domain",
        requireSelection: true,
    },

    rmfRemoveRecipientAddress: {
        properties: {
            title: "Remove Recipient Address from Whitelist",
            contexts: ["message_list", "message_display_action"],
        },
        onClicked: "onMenuRemoveRecipientClicked",
        includeFolders: ["^/INBOX/Whitelisted$"],
        addressMode: "address",
        requireSelection: true,
    },

    rmfRemoveRecipientDomain: {
        properties: {
            title: "Remove Recipient Domain from Whitelist",
            contexts: ["message_list", "message_display_action"],
        },
        onClicked: "onMenuRemoveRecipientClicked",
        includeFolders: ["^/INBOX/Whitelisted$"],
        addressMode: "domain",
        requireSelection: true,
    },

    rmfSetDefaultBook: {
        properties: {
            title: "Set Default Filter Book",
            contexts: ["message_display_action"],
        },
        onCreated: "onMenuAddBooksCreated",
        subId: "rmfDefaultBook",
        excludeFolders: ["^/Sent$", "^/Drafts$", "^/Archives/.*"],
    },

    rmfSetAddressMode: {
        properties: {
            title: "Set Default Filter Book Address Mode",
            contexts: ["message_display_action"],
        },
        excludeFolders: ["^/Sent$", "^/Drafts$", "^/Archives/.*"],
    },

    rmfSetAddressModeAddress: {
        properties: {
            title: "Address",
            contexts: ["message_display_action"],
            parentId: "rmfSetAddressMode",
            type: "radio",
        },
        onShown: "onMenuAddressModeShown",
        onClicked: "onMenuAddressModeClicked",
        excludeFolders: ["^/Sent$", "^/Drafts$", "^/Archives/.*"],
        addressMode: "address",
    },

    rmfSetAddressModeDomain: {
        properties: {
            title: "Domain",
            contexts: ["message_display_action"],
            parentId: "rmfSetAddressMode",
            type: "radio",
        },
        onShown: "onMenuAddressModeShown",
        onClicked: "onMenuAddressModeClicked",
        excludeFolders: ["^/Sent$", "^/Drafts$", "^/Archives/.*"],
        addressMode: "domain",
    },

    rmfRescanSeparator: {
        properties: {
            type: "separator",
            contexts: ["folder_pane", "message_list"],
        },
        excludeFolders: ["^/Sent$", "^/Drafts$", "^/Archives/.*"],
    },

    rmfRescanFolder: {
        properties: {
            title: "Rescan All Messages in Folder",
            contexts: ["folder_pane"],
        },
        onClicked: "onMenuRescanFolderClicked",
        excludeFolders: ["^/Sent$", "^/Drafts$", "^/Archives/.*"],
    },

    rmfRescanMessages: {
        properties: {
            title: "Rescan Selected Messages",
            contexts: ["message_list"],
        },
        onClicked: "onMenuRescanMessagesClicked",
        excludeFolders: ["^/Sent$", "^/Drafts$", "^/Archives/.*"],
        requireSelection: true,
    },

    rmfRescanFilterBooksFolder: {
        properties: {
            title: "Reapply Filter Books to All Messages in Folder",
            contexts: ["folder_pane"],
        },
        onClicked: "onMenuRescanFilterBooksFolderClicked",
        excludeFolders: ["^/Sent$", "^/Drafts$", "^/Archives/.*"],
    },

    rmfRescanFilterBooksMessages: {
        properties: {
            title: "Reapply Filter Books to Selected Messages",
            contexts: ["message_list"],
        },
        onClicked: "onMenuRescanFilterBooksMessagesClicked",
        excludeFolders: ["^/Sent$", "^/Drafts$", "^/Archives/.*"],
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
        onShown: "onMenuSieveTraceShown",
        onClicked: "onMenuSieveTraceClicked",
    },

    rmfDefaultBook: {
        properties: {
            title: "__book__",
            type: "radio",
            parentId: "rmfSetDefaultBook",
        },
        titleTemplate: "__book__",
        noInit: true,
        onShown: "onMenuSetDefaultBookShown",
        onClicked: "onMenuSetDefaultBookClicked",
    },

    rmfBook: {
        book: "__book__",
        properties: {
            title: "Add sender __mode__ to '__book__'",
        },
        titleTemplate: "Add sender __mode__ to '__book__'",
        onShown: "onMenuAddSenderShown",
        onClicked: "onMenuAddSenderClicked",
        noInit: true,
        excludeFolders: ["^/Sent$", "^/Drafts$", "^/Archives/.*"],
        requireSelection: true,
    },
};
