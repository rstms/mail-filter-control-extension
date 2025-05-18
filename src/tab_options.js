//
// tab_options
//

import { Domains } from "./domains.js";
import { differ, verbosity, accountDomain, accountEmailAddress } from "./common.js";
import { config } from "./config.js";
import { getAccounts } from "./accounts.js";

/* globals document, console, messenger */
const verbose = verbosity.tab_options;

export class OptionsTab {
    constructor(sendMessage, handlers) {
        this.domains = new Domains();
        this.controls = {};
        this.pendingDomains = {};
        this.domainCheckbox = {};
        this.sendMessage = sendMessage;
        this.handlers = handlers;
    }

    async selectAccount(accountId) {
        try {
            this.accountId = accountId;
        } catch (e) {
            console.error(e);
        }
    }

    createDomainRow(index, domain, enabled) {
        try {
            const row = document.createElement("div");
            row.classList.add("form-check");
            row.id = "options-domain-row-" + index;

            const checkbox = document.createElement("input");
            checkbox.id = "options-domain-checkbox-" + index;
            checkbox.type = "checkbox";
            checkbox.checked = enabled;
            checkbox.classList.add("form-check-input");
            checkbox.addEventListener("change", this.handlers.DomainCheckboxChange);
            row.appendChild(checkbox);

            const label = document.createElement("label");
            label.id = "options-domain-label-" + index;
            label.classList.add("form-check-label");
            label.setAttribute("for", checkbox.id);
            label.textContent = domain;
            row.appendChild(label);

            return { row: row, checkbox: checkbox };
        } catch (e) {
            console.error(e);
        }
    }

    async populate() {
        try {
            this.controls.autoDelete.checked = await config.local.getBool(config.local.key.autoDelete);
            this.controls.advancedTabVisible.checked = await config.local.getBool(config.local.key.advancedTabVisible);
            this.controls.minimizeCompose.checked = await config.local.getBool(config.local.key.minimizeCompose);
            this.controls.backgroundSend.checked = await config.local.getBool(config.local.key.backgroundSend);
            this.controls.cacheResponses.checked = await config.local.getBool(config.local.key.filterctlCacheEnabled);

            await this.populateDomains();
        } catch (e) {
            console.error(e);
        }
    }

    async populateDomains() {
        try {
            if (verbose) {
                console.debug("BEGIN populateOptionsAccounts");
            }

            this.showDomainsButtons(false);

            var stack = this.controls.domainsStack;
            stack.innerHTML = "";
            this.domainCheckbox = {};
            this.pendingDomains = {};
            var index = 0;
            const domains = await this.domains.get({ refresh: true });
            for (const [domain, enabled] of Object.entries(domains)) {
                if (verbose) {
                    console.debug(index, domain, enabled);
                }
                const created = await this.createDomainRow(index, domain, enabled);
                this.pendingDomains[domain] = enabled;
                this.domainCheckbox[created.checkbox.id] = {
                    control: created.checkbox,
                    id: created.checkbox.id,
                    domain: domain,
                };
                stack.appendChild(created.row);
                index += 1;
            }
            await this.updateDomainsApplyButton();

            if (verbose) {
                console.debug("END populateOptionsAccounts");
            }
        } catch (e) {
            console.error(e);
        }
    }

    async updateDomainsApplyButton() {
        try {
            const domains = await this.domains.get({ refresh: true });
            const dirty = differ(this.pendingDomains, domains);
            if (verbose) {
                console.debug("updateDomainsApplyButton:", {
                    dirty: dirty,
                    pending: this.pendingDomains,
                    account: domains,
                });
            }
            this.showDomainsButtons(dirty);
        } catch (e) {
            console.error(e);
        }
    }

    showDomainsButtons(visible) {
        try {
            this.controls.domainsApplyButton.disabled = !visible;
            this.controls.domainsApplyButton.hidden = !visible;
            this.controls.domainsCancelButton.disabled = !visible;
            this.controls.domainsCancelButton.hidden = !visible;
        } catch (e) {
            console.error(e);
        }
    }

    async onDomainsApplyClick() {
        try {
            const domains = await this.domains.get({ refresh: true });
            if (differ(this.pendingDomains, domains)) {
                await this.domains.setAll(this.pendingDomains);
                await this.clearCache();
                this.controls.domainsStack.innerHTML = "";
                for (const [controlName, control] of Object.entries(this.controls)) {
                    console.log("disabling control:", controlName);
                    control.disabled = true;
                }
                const label = document.createElement("label");
                this.controls.domainsStack.appendChild(label);
                let accounts = await getAccounts();
                let queryAccountIds = new Map();
                for (const account of Object.values(accounts)) {
                    for (const domain of Object.keys(this.pendingDomains)) {
                        if (accountDomain(account) == domain) {
                            queryAccountIds.set(account.id, accountEmailAddress(account));
                        }
                    }
                }
                for (const [accountId, username] of queryAccountIds.entries()) {
                    label.textContent = `Requesting data for '${username}'...`;
                    await this.sendMessage({ id: "getBooks", accountId });
                }
                label.textContent = "Reloading extension...";
                await messenger.runtime.reload();
            }
        } catch (e) {
            console.error(e);
        }
    }

    async onDomainCheckboxChange(sender) {
        try {
            if (verbose) {
                console.debug("onDomainCheckboxChange:", sender);
            }
            const domain = this.domainCheckbox[sender.target.id].domain;
            const enabled = sender.target.checked;
            this.pendingDomains[domain] = enabled;
            await this.updateDomainsApplyButton();
        } catch (e) {
            console.error(e);
        }
    }

    async onAutoDeleteChange() {
        try {
            await config.local.setBool(config.local.key.autoDelete, this.controls.autoDelete.checked);
        } catch (e) {
            console.error(e);
        }
    }

    async onShowAdvancedTabChange() {
        try {
            await config.local.setBool(config.local.key.advancedTabVisible, this.controls.advancedTabVisible.checked);
        } catch (e) {
            console.error(e);
        }
    }

    async onMinimizeComposeChange() {
        try {
            await config.local.setBool(config.local.key.minimizeCompose, this.controls.minimizeCompose.checked);
        } catch (e) {
            console.error(e);
        }
    }

    async onBackgroundSendChange() {
        try {
            await config.local.setBool(config.local.key.backgroundSend, this.controls.backgroundSend.checked);
        } catch (e) {
            console.error(e);
        }
    }

    async onResetClick() {
        try {
            await config.local.reset();
            await config.session.reset();
            await messenger.runtime.reload();
        } catch (e) {
            console.error(e);
        }
    }

    async clearCache() {
        try {
            await config.local.remove(config.local.key.filterctlState);
            await config.local.remove(config.local.key.apiKeys);
            await config.session.remove(config.session.key.menuConfig);
            //await config.session.setBool(config.session.key.clearMenu, true);
        } catch (e) {
            console.error(e);
        }
    }

    async onClearCacheClick() {
        try {
            await this.clearCache();
            await config.local.setBool(config.local.key.cacheCleared, true);
            await messenger.runtime.reload();
        } catch (e) {
            console.error(e);
        }
    }

    async onCacheResponsesChange() {
        try {
            let enabled = this.controls.cacheResponses.checked;
            const command = enabled ? "enable" : "disable";
            await this.sendMessage({ id: "cacheControl", command: command });
        } catch (e) {
            console.error(e);
        }
    }
}
