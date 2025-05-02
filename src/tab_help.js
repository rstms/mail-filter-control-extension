//
// tab_help
//

import { verbosity } from "./common.js";

/* globals console, document, messenger */

const verbose = verbosity.tab_help;

export class HelpTab {
    constructor(sendMessage) {
        this.controls = {};
        this.sendMessage = sendMessage;
        this.lines = [];
    }

    async populateCommandTable() {
        try {
            this.controls.tableBody.innerHTML = "";
            for (const command of await messenger.commands.getAll()) {
                let row = document.createElement("tr");

                let keyCell = document.createElement("td");
                let keyLabel = document.createElement("label");
                keyCell.appendChild(keyLabel);
                row.appendChild(keyCell);

                let descriptionCell = document.createElement("td");
                let descriptionLabel = document.createElement("label");
                descriptionCell.appendChild(descriptionLabel);
                row.appendChild(descriptionCell);

                this.controls.tableBody.appendChild(row);

                keyLabel.textContent = command.shortcut;
                descriptionLabel.textContent = command.description;
                if (verbose) {
                    console.log("row:", row.innerHTML);
                }
            }
            this.controls.table.hidden = false;
        } catch (e) {
            console.error(e);
        }
    }

    async populate(helpLines) {
        try {
            await this.populateCommandTable();
            let text = "";

            let manifest = await messenger.runtime.getManifest();
            let details = false;
            for (let line of helpLines) {
                if (verbose) {
                    console.log("line: ", "'" + line + "'");
                }
                line = line.trim();
                if (line.length === 0) {
                    continue;
                }
                if (line.startsWith("###")) {
                    line = line.replace(/^#*\s*/g, "");
                    line = line.replace(/\s*#*$/g, "");
                    text = `<b>${line} v ${manifest.version}</b><br>\n`;
                } else {
                    if (line.startsWith("#")) {
                        if (details) {
                            text += "</details>\n";
                            details = false;
                        }
                        line = line.replace(/^#+\s*/g, "");
                        line = line.replace(/\s*#*$/g, "");
                        text += `<br><details><summary><b>${line}</b></summary><br>\n`;
                        details = true;
                    } else {
                        text += `${line}\n`;
                    }
                }
                if (details) {
                    text += "</detail>\n";
                }
            }
            if (verbose) {
                for (const t of text.split("\n")) {
                    console.debug(t);
                }
            }
            this.controls.helpText.innerHTML = text;
        } catch (e) {
            console.error(e);
        }
    }
}
