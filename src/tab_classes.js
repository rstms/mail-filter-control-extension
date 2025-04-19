import { Classes, Level, classesFactory } from "./filterctl.js";
import { verbosity } from "./common.js";
import { getAccount, getAccounts, getSelectedAccount } from "./accounts.js";

/* globals document, console, setTimeout, clearTimeout */

const verbose = verbosity.tab_classes;

const dumpHTML = false;

const MIN_LEVELS = 2;
const MAX_LEVELS = 16;
const MIN_SCORE = -10;
const MAX_SCORE = 10;
const STEP_SCORE = 0.1;

const STATUS_PENDING_TIMEOUT = 5120;

export class ClassesTab {
    constructor(disableEditorControl, sendMessage, enableTab, handlers) {
        this.controls = {};
        this.disableEditorControl = disableEditorControl;
        this.sendMessage = sendMessage;
        this.enableTab = enableTab;
        this.accounts = undefined;
        this.cellTemplate = null;
        this.tableRendered = false;
        this.handlers = handlers;
        this.account = undefined;
        this.classes = undefined;
        this.sliderMoveBuffer = null;
        this.sliderDrag = false;
    }

    async selectAccount(accountId) {
        try {
            this.account = await getAccount(accountId);
            await this.populate();
        } catch (e) {
            console.error(e);
        }
    }

    async getClasses(flags = { disablePopulate: false, disableUpdateStatus: false }) {
        try {
            if (verbose) {
                console.debug("ClassesTab.getClasses:", flags, this);
            }
            await this.setStatusPending("Requesting classes...");
            let response = await this.sendMessage({ id: "getClasses", accountId: this.account.id });
            let classes = await this.handleResponse(response, flags);
            if (verbose) {
                console.debug("getClasses returning:", classes);
            }
            return classes;
        } catch (e) {
            console.error(e);
        }
    }

    async handleResponse(response, flags = { disablePopulate: false, disableUpdateStatus: false }) {
        try {
            if (verbose) {
                console.debug("handleResponse:", response);
            }

            let classes = response.classes;
            if (typeof classes !== "undefined") {
                if (typeof classes === "object") {
                    if (classes instanceof Classes) {
                        console.assert(classes instanceof Classes, "unexpected: classes IS an instance of Classes");
                    }
                    // parse message object into a Classes
                    console.assert(response.accountId === this.account.id, "server response account ID mismatch");
                    classes = await classesFactory(response.classes, response.accountId);
                    if (verbose) {
                        console.debug("ClassesTab.handleResponse:", response.valid, classes.valid, classes, response);
                    }
                }
                response.classes = classes;
                console.assert(classes instanceof Classes, "classes is not an instance of Classes");

                if (!flags.disablePopulate) {
                    await this.populate(classes);
                }
            }

            if (!flags.disableUpdateStatus) {
                await this.updateStatus(response);
            }
            if (verbose) {
                console.debug("handleResponse: returning:", response.classes);
            }
            return response.classes;
        } catch (e) {
            console.error(e);
        }
    }

    async getLevels() {
        try {
            let i = 0;
            let classes = await classesFactory();
            await classes.setAccountId(this.account.id);
            if (verbose) {
                console.debug("getLevels: initialized classes:", classes);
            }
            while (true) {
                const nameElement = document.getElementById(`level-name-${i}`);
                if (!nameElement) {
                    break;
                }
                const name = nameElement.value;
                const scoreElement = document.getElementById(`level-score-${i}`);
                const score = name === "spam" ? 999 : scoreElement.value;
                if (verbose) {
                    console.debug("getLevels: adding:", i, name, score);
                }
                classes.addLevel(name, score);
                i += 1;
            }

            if (verbose) {
                console.debug("getLevels: returning:", classes);
            }
            return classes;
        } catch (e) {
            console.error(e);
        }
    }

    async onCellDelete(event) {
        try {
            if (verbose) {
                console.debug("cell delete");
            }
            const row = parseInt(event.srcElement.getAttribute("data-row"));
            var classes = await this.getLevels();
            classes.levels.splice(row, 1);
            await this.updateClasses(classes);
        } catch (e) {
            console.error(e);
        }
    }

    round(score) {
        try {
            return Math.round(parseFloat(score) * 10) / 10;
        } catch (e) {
            console.error(e);
        }
    }

    async onSliderMoved(event) {
        try {
            if (verbose) {
                console.debug("slider moved:", event);
            }
            switch (event.type) {
                case "mousedown":
                    this.sliderDrag = true;
                    this.sliderMoveBuffer = null;
                    return;
                case "mouseup":
                    if (this.sliderDrag && this.sliderMoveBuffer !== null) {
                        await this.processSliderMove(this.sliderMoveBuffer);
                    }
                    this.sliderDrag = false;
                    this.sliderMoveBuffer = null;
                    return;
                case "mouseleave":
                    if (this.sliderDrag && this.sliderMoveBuffer !== null) {
                        await this.processSliderMove(this.sliderMoveBuffer);
                    }
                    this.sliderDrag = false;
                    this.sliderMoveBuffer = null;
                    return;
                case "input":
                    break;
                default:
                    console.error("unexpected event:", event);
                    throw new Error("unexpected event");
            }
            const row = parseInt(event.srcElement.getAttribute("data-row"));
            const score = document.getElementById(`level-score-${row}`);
            const slider = event.srcElement;
            const value = slider.value;
            const update = {
                row,
                slider,
                score,
                value,
                levels: [],
                accountId: this.account.id,
            };
            const classes = await this.getLevels();
            for (const level of classes.levels) {
                update.levels.push({ name: level.name, score: level.score });
            }

            if (this.sliderDrag) {
                score.value = this.round(value);
                this.sliderMoveBuffer = update;
                return;
            }
            await this.processSliderMove(update);
        } catch (e) {
            console.error(e);
        }
    }

    async processSliderMove(update) {
        try {
            if (verbose) {
                console.debug("onSliderMoved:", update);
            }

            // get the element value rounded to tenths
            let value = this.round(update.value);

            // limit slider to stay below the next level
            if (update.row < update.levels.length - 1) {
                let nextLevelValue = this.round(update.levels[update.row + 1].score);
                if (value >= nextLevelValue) {
                    value = nextLevelValue - 0.1;
                }
            }

            // limit slider to stay above the previous level
            if (update.row > 0) {
                let lastLevelValue = this.round(update.levels[update.row - 1].score);
                if (value <= lastLevelValue) {
                    value = lastLevelValue + 0.1;
                }
            }

            // round the slider to tenths after the calculations
            value = this.round(value);
            update.levels[update.row].score = value;
            let classes = await classesFactory();
            await classes.setAccountId(update.accountId);
            for (const level of update.levels) {
                classes.addLevel(level.name, level.score);
            }
            update.slider.value = value;
            update.score.value = value;
            await this.updateClasses(classes);
        } catch (e) {
            console.error(e);
        }
    }

    async onScoreChanged(event) {
        try {
            if (verbose) {
                console.debug("score changed");
            }
            const row = parseInt(event.srcElement.getAttribute("data-row"));
            const slider = document.getElementById(`level-slider-${row}`);
            slider.value = `${event.srcElement.value}`;
            await this.updateClasses();
        } catch (e) {
            console.error(e);
        }
    }

    async onNameChanged() {
        try {
            if (verbose) {
                console.debug("name changed");
            }
            await this.updateClasses();
        } catch (e) {
            console.error(e);
        }
    }

    newLevelName(levels) {
        try {
            let i = 0;
            while (true) {
                let name = `class${i}`;
                let found = false;
                for (let level of levels) {
                    if (level.name === name) {
                        found = true;
                    }
                }
                if (!found) {
                    return name;
                }
                i += 1;
            }
        } catch (e) {
            console.error(e);
        }
    }

    async onCellInsert(event) {
        try {
            const row = parseInt(event.srcElement.getAttribute("data-row"));
            if (verbose) {
                console.debug("cellInsert:", event, row);
            }
            let classes = await this.getLevels();
            let newScore = parseFloat(classes.levels[row].score);
            let nextScore = parseFloat(classes.levels[row + 1].score);
            if (nextScore === 999) {
                nextScore = MAX_SCORE;
            }
            newScore += (nextScore - newScore) / 2;
            newScore = this.round(newScore);
            classes.levels.splice(row + 1, 0, new Level(this.newLevelName(classes.levels), String(newScore)));
            await this.updateClasses(classes);
        } catch (e) {
            console.error(e);
        }
    }

    appendCell(row, index, id, control, text, disabled) {
        try {
            const cell = document.createElement("td");
            const element = document.createElement(control);

            for (let [key, value] of Object.entries(this.cellTemplate[id].attributes)) {
                if (id === "level-slider") {
                    switch (key) {
                        case "min":
                            value = MIN_SCORE;
                            break;
                        case "max":
                            value = MAX_SCORE;
                            break;
                        case "step":
                            value = STEP_SCORE;
                            break;
                    }
                }
                element.setAttribute(key, value);
            }

            for (const value of this.cellTemplate[id].classes) {
                element.classList.add(value);
            }
            element.id = id + "-" + index;
            element.setAttribute("data-row", index);
            if (disabled) {
                element.disabled = true;
            }

            if (control === "button") {
                element.textContent = text;
            } else {
                element.value = text;
            }

            cell.appendChild(element);
            row.appendChild(cell);
            return element;
        } catch (e) {
            console.error(e);
        }
    }

    async initCellTemplate() {
        try {
            let cells = {
                "level-name": { id: "cell-class-input" },
                "level-score": { id: "cell-score-input" },
                "level-slider": { id: "cell-score-slider" },
                "level-delete": { id: "cell-add-button" },
                "level-insert": { id: "cell-delete-button" },
            };
            for (const key of Object.keys(cells)) {
                const el = document.getElementById(cells[key].id);
                if (verbose) {
                    console.debug("cell:", key, el);
                }
                cells[key].attributes = {};
                cells[key].classes = [];
                for (const name of el.getAttributeNames()) {
                    switch (name) {
                        case "id":
                            break;
                        case "class":
                            break;
                        default:
                            cells[key].attributes[name] = el.getAttribute(name);
                            break;
                    }
                }
                for (const elClass of el.classList) {
                    cells[key].classes.push(elClass);
                }
            }
            cells["level-name"].attributes.rstmsKeyFilter = "name";
            cells["level-score"].attributes.rstmsKeyFilter = "score";
            //cells["level-slider"].classes.push("flex-fill");
            this.cellTemplate = cells;
            if (verbose) {
                console.debug("cellTemplate:", this.cellTemplate);
            }
        } catch (e) {
            console.error(e);
        }
    }

    async onInputKeypress(event) {
        try {
            const key = String.fromCharCode(event.which);
            const element = event.srcElement;
            const mode = element.getAttribute("rstmsKeyFilter");
            if (mode) {
                const value = element.value.trim();
                switch (mode) {
                    case "name":
                        if (value.length == 0) {
                            if (!/^[a-zA-Z]$/.test(key)) {
                                event.preventDefault();
                            }
                        } else {
                            if (!/^[a-zA-Z0-9_.-]$/.test(key)) {
                                event.preventDefault();
                            }
                        }
                        break;
                    case "score":
                        if (!/^[0-9.-]$/.test(key)) {
                            event.preventDefault();
                        }
                        break;
                }
            }
        } catch (e) {
            console.error(e);
        }
    }

    async populate(classes = undefined) {
        try {
            if (verbose) {
                console.debug("BEGIN populateRows");
            }

            if (this.accounts === undefined) {
                this.accounts = await getAccounts();
            }

            if (this.account === undefined) {
                this.account = await getSelectedAccount();
            }

            if (this.account === undefined) {
                throw new Error("ClassesTab.populate: invalid account:" + String(this.account));
            }

            if (classes == undefined) {
                // disablePopulate to prevent infinite loop
                classes = await this.getClasses({ disablePopulate: true });
            }
            this.classes = classes;

            if (verbose) {
                console.debug("ClassesTab.populate: classes:", classes);
            }
            let levels = (await classes.render()).Classes;
            if (verbose) {
                console.debug("ClassesTab.populate: levels:", levels);
            }

            if (!levels || !Array.isArray(levels)) {
                throw new Error("ClassesTab.populate: invalid levels", levels);
            }

            if (!this.cellTemplate) {
                if (dumpHTML) {
                    console.debug(this.controls.tableBody.innerHTML);
                }
                await this.initCellTemplate();
            }

            let table = this.controls.tableBody;
            if (verbose) {
                console.debug("table:", table);
            }
            let tableRows = table.childNodes;
            if (!this.tableRendered || tableRows.length !== levels.length) {
                tableRows = null;
                this.controls.tableBody.innerHTML = "";
            }
            var index = 0;
            for (const level of levels) {
                let name = level.name;
                let score = level.score;
                let disabled = false;
                let sliderValue = `${score}`;
                if (index === levels.length - 1) {
                    disabled = true;
                    score = "infinite";
                    sliderValue = String(MAX_SCORE);
                }
                let nameControl = undefined;
                let scoreControl = undefined;
                let sliderControl = undefined;
                if (tableRows == null) {
                    let row = document.createElement("tr");
                    nameControl = this.appendCell(row, index, "level-name", "input", name, disabled);
                    scoreControl = this.appendCell(row, index, "level-score", "input", score, disabled);
                    sliderControl = this.appendCell(row, index, "level-slider", "input", sliderValue, disabled);
                    if (!disabled) {
                        nameControl.addEventListener("keypress", this.handlers.InputKeypress);
                        nameControl.addEventListener("change", this.handlers.NameChanged);
                        sliderControl.addEventListener("input", this.handlers.SliderMoved);
                        sliderControl.addEventListener("mousedown", this.handlers.SliderMoved);
                        sliderControl.addEventListener("mouseup", this.handlers.SliderMoved);
                        sliderControl.addEventListener("mouseleave", this.handlers.SliderMoved);
                        scoreControl.addEventListener("change", this.handlers.ScoreChanged);
                        scoreControl.addEventListener("keypress", this.handlers.InputKeypress);
                    }
                    let deleteDisabled = disabled | (levels.length <= MIN_LEVELS);
                    const deleteButton = this.appendCell(row, index, "level-delete", "button", "delete", deleteDisabled);
                    if (!deleteDisabled) {
                        deleteButton.addEventListener("click", this.handlers.CellDelete);
                    }
                    let addDisabled = disabled | (levels.length >= MAX_LEVELS);
                    const insertButton = this.appendCell(row, index, "level-insert", "button", "+", addDisabled);
                    if (!addDisabled) {
                        insertButton.addEventListener("click", this.handlers.CellInsert);
                    }
                    this.controls.tableBody.appendChild(row);
                    this.tableRendered = true;
                } else {
                    let row = tableRows.item(index);
                    let cells = row.getElementsByTagName("input");
                    nameControl = cells[0];
                    scoreControl = cells[1];
                    sliderControl = cells[2];
                }
                nameControl.value = name;
                scoreControl.value = score;
                sliderControl.value = sliderValue;
                if (verbose) {
                    console.debug("setRowValues:", index, {
                        name: [name, nameControl.id, nameControl.value],
                        score: [score, scoreControl.id, scoreControl.value],
                        slider: [sliderValue, sliderControl.id, sliderControl.value],
                    });
                }
                index += 1;
            }

            if (verbose) {
                for (let i = 0; i < levels.length; i++) {
                    let id = `level-slider-${i}`;
                    const slider = document.getElementById(id);
                    console.debug("readback:", i, id, slider.value);
                }
            }

            // check that editedLevels returns the same data we set
            const controlLevels = await this.getLevels();
            await classes.validate();
            await controlLevels.validate();
            let mismatch = classes.diff(controlLevels);
            if (mismatch) {
                console.debug("classes:", classes);
                console.debug("controls:", controlLevels);
                throw new Error("editedLevels() return differs from background getClasses() return");
            }
            if (verbose) {
                console.debug("populate: controls data valid:", controlLevels.valid);
            }
            await this.enableControls(controlLevels.valid ? true : false);

            if (verbose) {
                console.debug("END populateRows");
            }
        } catch (e) {
            console.error(e);
        }
    }

    async updateClasses(classes = undefined, sendToServer = false) {
        try {
            if (verbose) {
                console.debug("updateClasses: classes", classes);
            }
            if (classes === undefined) {
                classes = await this.getLevels();
            }
            let message = {
                id: sendToServer ? "sendClasses" : "setClasses",
                accountId: classes.accountId,
                classes: await classes.render(),
            };
            await this.setStatusPending("sending classes...");
            if (verbose) {
                console.debug("updateClasses: sending:", message);
            }
            let response = await this.sendMessage(message);
            if (verbose) {
                console.debug("updateClasses: received:", response);
            }
            await this.handleResponse(response);
        } catch (e) {
            console.error(e);
        }
    }

    async statusPendingTimeout() {
        await this.updateStatus({ success: false, message: "Pending operation timed out." });
    }

    async setStatusPending(message) {
        try {
            if (this.statusPendingTimer) {
                clearTimeout(this.statusPendingTimer);
            }
            this.statusPendingTimer = setTimeout(this.statusPendingTimeout, STATUS_PENDING_TIMEOUT);
            await this.updateStatus({ success: true, message: message, disable: true });
        } catch (e) {
            console.error(e);
        }
    }

    async updateStatus(state = undefined) {
        try {
            if (verbose) {
                console.debug("updateStatus:", state);
            }

            if (state === undefined) {
                console.warn("ignoring undefined status update");
                return;
            }

            if (this.statusPendingTimer) {
                clearTimeout(this.statusPendingTimer);
                this.statusPendingTimer = null;
            }

            let statusText = "Status";
            this.valid = false;
            let disable = state.disable === true ? true : false;
            if ("classes" in state) {
                this.valid = state.classes.valid;
                if (!this.valid) {
                    console.warn("status not valid");
                }
                this.dirty = state.dirty ? true : false;
                if (this.dirty) {
                    if (this.valid) {
                        statusText = "Status (Unsaved Changes)";
                    } else {
                        statusText = "Status (Save Disabled)";
                        disable = true;
                    }
                }
            }
            this.controls.statusLabel.innerHTML = statusText;
            this.controls.statusMessage.innerHTML = typeof state.message === "string" ? state.message : "";
            await this.enableControls(!disable);
        } catch (e) {
            console.error(e);
        }
    }

    async enableControls(enabled) {
        try {
            this.controls.accountSelect.disabled = !enabled;
            this.controls.saveButton.disabled = !enabled;
            await this.disableEditorControl("applyButton", !enabled);
            await this.disableEditorControl("okButton", !enabled);
            await this.enableTab("books", enabled);
        } catch (e) {
            console.error(e);
        }
    }

    async saveChanges() {
        try {
            await this.setStatusPending("sending changed classes...");
            const response = await this.sendMessage({ id: "sendAllClasses", force: false });
            if (verbose) {
                console.debug("saveChanges: sendAllClasses returned:", response);
            }
            await this.handleResponse(response);
            return response;
        } catch (e) {
            console.error(e);
            await this.updateStatus({ success: false, message: "Pending operation failed." });
        }
    }

    async onSaveClick() {
        try {
            this.saveChanges();
        } catch (e) {
            console.error(e);
        }
    }

    async onDefaultsClick() {
        try {
            const response = await this.sendMessage({ id: "setDefaultClasses", accountId: this.account.id });
            if (verbose) {
                console.debug("onDefaultsClick: setDefaultClasses returned:", response);
            }
            await this.handleResponse(response);
        } catch (e) {
            console.error(e);
        }
    }

    async onRefreshAllClick() {
        try {
            await this.setStatusPending("Requesting all classes...");
            const response = await this.sendMessage("refreshAllClasses");
            if (verbose) {
                console.debug("onRefreshAllClick: refreshAllClasses returned:", response);
            }
            response.classes = response.results[this.account.id].classes;
            await this.handleResponse(response);
        } catch (e) {
            console.error(e);
        }
    }

    async onRefreshClick() {
        try {
            await this.setStatusPending("Requesting classes...");
            const response = await this.sendMessage({ id: "refreshClasses", accountId: this.account.id });
            if (verbose) {
                console.debug("onRefreshClick: refreshClasses returned:", response);
            }
            await this.handleResponse(response);
        } catch (e) {
            console.error(e);
        }
    }
}
