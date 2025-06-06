/* globals messenger, document, console */
import { config } from "./config.js";
import { initThemeSwitcher } from "./theme_switcher.js";

const optInCheckboxId = "#opt-in-checkbox";
const openButton = "#options-open-button";

initThemeSwitcher();

async function saveOptions(sender) {
    try {
        console.log("opt in clicked:", sender);
        const checked = sender.target.checked;
        await enableButton(checked);
        await config.local.reset();
        await config.session.reset();
        await config.local.setBool(config.local.key.optInApproved, checked);
        await config.local.setBool(config.local.key.autoOpenOptions, true);
        await messenger.runtime.reload();
    } catch (e) {
        console.error(e);
    }
}

async function restoreOptions() {
    try {
        var checked = await config.local.getBool(config.local.key.optInApproved);
        document.querySelector(optInCheckboxId).checked = checked;
        await enableButton(checked);
        await config.local.remove(config.local.key.autoOpenOptions);
    } catch (e) {
        console.error(e);
    }
}

async function enableButton(checked) {
    try {
        const button = document.querySelector(openButton);
        button.disabled = checked ? false : true;
    } catch (e) {
        console.error(e);
    }
}

async function openEditor() {
    // get the background page before sending in case it is sleeping
    await messenger.runtime.getBackgroundPage();
    await messenger.runtime.sendMessage({ id: "focusEditorWindow", src: "options", dst: "background" });
}

document.addEventListener("DOMContentLoaded", restoreOptions);
document.querySelector(optInCheckboxId).addEventListener("click", saveOptions);
document.querySelector(openButton).addEventListener("click", openEditor);
