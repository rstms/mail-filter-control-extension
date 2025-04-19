/* global console, ChromeUtils, Components, ActivityManager, Ci */

var { ExtensionCommon } = ChromeUtils.import("resource://gre/modules/ExtensionCommon.jsm");

ChromeUtils.defineESModuleGetters(this, {
    ActivityManager: "resource:///modules/ActivityManager.sys.mjs",
});

const ActivityEvent = Components.Constructor("@mozilla.org/activity-event;1", "nsIActivityEvent", "init");
const ActivityProcess = Components.Constructor("@mozilla.org/activity-process;1", "nsIActivityProcess", "init");
const ActivityWarning = Components.Constructor("@mozilla.org/activity-warning;1", "nsIActivityWarning", "init");

const processStates = {
    notStarted: Ci.nsIActivityProcess.STATE_NOTSTARTED,
    inProgress: Ci.nsIActivityProcess.STATE_INPROGRESS,
    completed: Ci.nsIActivityProcess.STATE_COMPLETED,
    canceled: Ci.nsIActivityProcess.STATE_CANCELED,
    paused: Ci.nsIActivityProcess.STATE_PAUSED,
    waitingForInput: Ci.nsIActivityProcess.STATE_WAITINGFORINPUT,
    waitingForRetry: Ci.nsIActivityProcess.STATE_WAITINGFORRETRY,
};

function getState(stateName) {
    let state = processStates[stateName];
    if (state === undefined) {
        throw new Error(`'${stateName}' not one of ${Object.keys(processStates)}`);
    }
    return state;
}

const iconClasses = {
    add: "addItem",
    compact: "compactMail",
    copy: "copyMail",
    delete: "deleteMail",
    defaultEvent: "defaultEvent",
    defaultProcess: "defaultProcess",
    index: "indexMail",
    move: "moveMail",
    remove: "removeItem",
    send: "sendMail",
    sync: "syncMail",
    undo: "undo",
};

function getIconClass(iconName) {
    let iconClass = iconClasses[iconName];
    if (iconClass === undefined) {
        throw new Error(`'${iconName}' not one of ${Object.keys(iconClasses)}`);
    }
    return iconClass;
}

var activityManager = class extends ExtensionCommon.ExtensionAPI {
    getAPI() {
        return {
            activityManager: {
                get contexts() {
                    if (this._contexts === undefined) {
                        this._contexts = new Map();
                    }
                    return this._contexts;
                },
                get manager() {
                    if (this._manager === undefined) {
                        this._manager = new ActivityManager();
                    }
                    return this._manager;
                },
                _setContext(_event, context) {
                    if (!this.contexts.has(context.type)) {
                        this.contexts.set(context.type, { type: context.type, title: context.title });
                    }
                    _event.contextType = context.type;
                    _event.contextDisplayText = context.title;
                    _event.contextObj = this.contexts.get(context.type);
                    _event.groupingStyle = Ci.nsIActivity.GROUPING_STYLE_BYCONTEXT;
                },
                async addEvent(title, detail, options) {
                    let startTime = Date.now();
                    if (options && options.startTime) {
                        startTime = options.startTime;
                    }
                    let completionTime = Date.now();
                    if (options && options.completionTime) {
                        completionTime = options.completionTime;
                    }
                    const _event = new ActivityEvent(title, null, detail, startTime, completionTime);
                    let iconClass = "defaultEvent";
                    if (options && options.icon && options.icon !== "default") {
                        iconClass = getIconClass(options.icon);
                    }
                    if (options && options.context) {
                        this._setContext(_event, options.context);
                    }
                    _event.iconClass = iconClass;
                    return this.manager.addActivity(_event);
                },
                async addProcess(title, detail, total, options) {
                    const _event = new ActivityProcess(title, null);
                    let iconClass = "defaultProcess";
                    if (options && options.icon && options.icon !== "default") {
                        iconClass = getIconClass(options.icon);
                    }
                    _event.iconClass = iconClass;
                    let completed = 0;
                    if (options && options.completed) {
                        completed = options.completed;
                    }
                    if (options && options.context) {
                        this._setContext(_event, options.context);
                    }
                    let id = this.manager.addActivity(_event);
                    _event.setProgress(detail, completed, total);
                    if (options && options.state) {
                        _event.state = getState(options.state);
                    }
                    return id;
                },
                async addWarning(title, detail, options) {
                    const _event = new ActivityWarning(title, null, detail);
                    if (options && options.context) {
                        this._setContext(_event, options.context);
                    }
                    return this.manager.addActivity(_event);
                },
                async updateProgress(id, message, completed, options) {
                    let _event = this.manager.getActivity(id);
                    let total = _event.totalWorkUnits;
                    if (options && options.total) {
                        total = options.total;
                    }
                    _event.setProgress(message, completed, total);
                    if (options && options.state) {
                        _event.state = getState(options.state);
                    }
                },
                async setState(id, state) {
                    let _event = this.manager.getActivity(id);
                    _event.state = getState(state);
                },
                async remove(id) {
                    this.manager.removeActivity(id);
                },
                async iconNames() {
                    return Object.keys(iconClasses);
                },
                async stateNames() {
                    return Object.keys(processStates);
                },
            },
        };
    }
};

console.log(activityManager);
