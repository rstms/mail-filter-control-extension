/* globals console, window */

import { initThemeSwitcher } from "./theme_switcher.js";

initThemeSwitcher();

async function onLoad() {
    console.log("popup loaded");
}

async function onUnload() {
    console.log("popup unloading");
}

window.addEventListener("load", onLoad);
window.addEventListener("beforeunload", onUnload);

//console.log("Hello, World! --popup.js");
