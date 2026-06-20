// background.js

const MENU_IDS = {
addSelection: "notedock_add_selection",
addImage: "notedock_add_image",
addPageLink: "notedock_add_page_link"
};

function getApi() {
return typeof browser !== "undefined" ? browser : chrome;
}

const api = getApi();

function isFirefoxLike() {
return (
    typeof browser !== "undefined" &&
    typeof browser.sidebarAction !== "undefined"
);
}

// Safe UUID generator fallback for older browsers
function uuid() {
return crypto.randomUUID 
    ? crypto.randomUUID() 
    : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function openExtensionSidebar(tab) {
try {
    // Firefox Sidebar
    if (isFirefoxLike() && api.sidebarAction?.open) {
    await api.sidebarAction.open();
    return;
    }

    // Chrome / Edge Side Panel
    if (api.sidePanel?.open && tab?.windowId !== undefined) {
    await api.sidePanel.open({
        windowId: tab.windowId
    });
    }
} catch (err) {
    console.error("Failed to open sidebar:", err);
}
}

function createMenus() {
api.contextMenus.removeAll(() => {
    api.contextMenus.create({
    id: MENU_IDS.addSelection,
    title: "Add selected text to NoteDock",
    contexts: ["selection"]
    });

    api.contextMenus.create({
    id: MENU_IDS.addImage,
    title: "Add image to NoteDock",
    contexts: ["image"]
    });

    api.contextMenus.create({
    id: MENU_IDS.addPageLink,
    title: "Add page link to NoteDock",
    contexts: ["page"]
    });
});
}

api.runtime.onInstalled.addListener(() => {
createMenus();
});

api.runtime.onStartup?.addListener(() => {
createMenus();
});

// For Chrome Side Panel behavior
if (api.sidePanel && api.sidePanel.setPanelBehavior) {
api.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
}

// Fallback for Firefox or older setups
api.action.onClicked.addListener(async (tab) => {
await openExtensionSidebar(tab);
});

api.contextMenus.onClicked.addListener(async (info, tab) => {
try {
    let pendingClip = null;

    switch (info.menuItemId) {
    case MENU_IDS.addSelection:
        pendingClip = {
        id: uuid(),
        createdAt: Date.now(),
        clipType: "selection",
        text: info.selectionText || "",
        pageUrl: info.pageUrl || tab?.url || "",
        pageTitle: tab?.title || ""
        };
        break;

    case MENU_IDS.addImage:
        pendingClip = {
        id: uuid(),
        createdAt: Date.now(),
        clipType: "image",
        srcUrl: info.srcUrl || "",
        pageUrl: info.pageUrl || tab?.url || "",
        pageTitle: tab?.title || ""
        };
        break;

    case MENU_IDS.addPageLink:
        pendingClip = {
        id: uuid(),
        createdAt: Date.now(),
        clipType: "page",
        pageUrl: info.pageUrl || tab?.url || "",
        pageTitle: tab?.title || tab?.url || ""
        };
        break;

    default:
        return;
    }

    // Save clip for sidebar consumption
    await api.storage.local.set({
    pending_clip: pendingClip
    });

    // Open sidebar after saving
    await openExtensionSidebar(tab);
} catch (error) {
    console.error("Failed to process context menu action:", error);
}
});