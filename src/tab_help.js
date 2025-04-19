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
                console.log("row:", row.innerHTML);
            }
            this.controls.table.hidden = false;
        } catch (e) {
            console.error(e);
        }
    }

    async populate(helpLines) {
        try {
            const manifest = await messenger.runtime.getManifest();

            await this.populateCommandTable();
            let text = "";

            for (let line of helpLines) {
                if (verbose) {
                    console.log("line: ", "'" + line + "'");
                }
                line = line.replace(/^\s*/, "");
                line = line.replace(/\s*$/, "");
                line = line.replace(/^##+\s*/g, "<b>");
                line = line.replace(/^#+\s*/g, "<br><br><b>");
                line = line.replace(/\s*##+$/g, "  v" + manifest.version + "</b><br>");
                line = line.replace(/\s*#+$/g, "</b><br>");
                text += " " + line + "\n";
                if (verbose) {
                    console.log("line: ", "'" + line + "'");
                    console.log("---");
                }
            }
            if (verbose) {
                console.debug(text);
            }
            this.controls.helpText.innerHTML = text;
        } catch (e) {
            console.error(e);
        }
    }
}
