/* globals console, window, document */

// JavaScript snippet handling Dark/Light mode switching
import { config } from "./config.js";

async function getStoredTheme() {
    try {
        var theme = await config.local.get(config.key.preferredTheme);
        //console.log("getStoredTheme storage get returned:", result);
        if (theme !== "dark" && theme !== "light") {
            theme = "auto";
        }
        //console.log("getStoredTheme returning:", theme);
        return theme;
    } catch (e) {
        console.error(e);
    }
}

async function setStoredTheme(theme) {
    try {
        //console.log("setStoredTheme setting:", theme);
        await config.local.set(config.key.preferredTheme, theme);
        //console.log("setStoredTheme set:", theme);
    } catch (e) {
        console.error(e);
    }
}

const forcedTheme = document.documentElement.getAttribute("data-bss-forced-theme");

async function getPreferredTheme() {
    try {
        if (forcedTheme) {
            //console.log("getPreferredTheme returning (forcedTheme):", forcedTheme);
            return forcedTheme;
        }

        const storedTheme = await getStoredTheme();
        if (storedTheme) {
            //console.log("getPreferredTheme returning (storedTheme):", storedTheme);
            return storedTheme;
        }

        const pageTheme = document.documentElement.getAttribute("data-bs-theme");

        if (pageTheme) {
            //console.log("getPreferredTheme returning (pageTheme):", pageTheme);
            return pageTheme;
        }

        const ret = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
        //console.log("getPreferredTheme returning (matchMedia):", ret);
        return ret;
    } catch (e) {
        console.error(e);
    }
}

async function setTheme(theme) {
    try {
        //console.log("setTheme:", theme);
        if (theme === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
            //console.log("settingTheme (auto-prefers-dark):", "dark");
            document.documentElement.setAttribute("data-bs-theme", "dark");
        } else {
            //console.log("settingTheme (else):", theme);
            document.documentElement.setAttribute("data-bs-theme", theme);
        }
    } catch (e) {
        console.error(e);
    }
}

async function showActiveTheme(theme) {
    try {
        //console.log("showActiveTheme:", theme, focus);
        const themeSwitchers = [].slice.call(document.querySelectorAll(".theme-switcher"));

        if (!themeSwitchers.length) return;

        document.querySelectorAll("[data-bs-theme-value]").forEach((element) => {
            element.classList.remove("active");
            element.setAttribute("aria-pressed", "false");
        });

        for (const themeSwitcher of themeSwitchers) {
            const btnToActivate = themeSwitcher.querySelector('[data-bs-theme-value="' + theme + '"]');

            if (btnToActivate) {
                btnToActivate.classList.add("active");
                btnToActivate.setAttribute("aria-pressed", "true");
            }
        }
    } catch (e) {
        console.error(e);
    }
}

async function onThemeSwitcherWatchMediaChange() {
    try {
        //console.log("onThemeSwitcherWatchMediaChange");
        const storedTheme = await getStoredTheme();
        if (storedTheme !== "light" && storedTheme !== "dark") {
            await setTheme(await getPreferredTheme());
        }
    } catch (e) {
        console.error(e);
    }
}

async function onThemeSwitcherClick(e) {
    try {
        //console.log("onThemeSwitcherClick");
        e.preventDefault();
        const theme = e.target.getAttribute("data-bs-theme-value");
        await setStoredTheme(theme);
        await setTheme(theme);
        await showActiveTheme(theme);
    } catch (e) {
        console.error(e);
    }
}

async function onThemeSwitcherDOMContentLoaded() {
    try {
        //console.log("onThemeSwitcherDOMContentLoaded");
        const theme = await getPreferredTheme();
        await setTheme(theme);
        await showActiveTheme(theme);
        for (const toggle of document.querySelectorAll("[data-bs-theme-value]")) {
            toggle.addEventListener("click", onThemeSwitcherClick);
        }
    } catch (e) {
        console.error(e);
    }
}

export function initThemeSwitcher() {
    try {
        //console.log("initThemeSwitcher");
        window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", onThemeSwitcherWatchMediaChange);
        window.addEventListener("DOMContentLoaded", onThemeSwitcherDOMContentLoaded);
    } catch (e) {
        console.error(e);
    }
}
