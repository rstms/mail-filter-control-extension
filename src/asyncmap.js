/* global console */

class MapItem {
    constructor(item) {
        this.item = item;
        this.created = new Date();
    }

    age() {
        const now = new Date();
        const elapsed = Math.floor((now - this.created) / 1000);
        return elapsed;
    }
}

export class AsyncMap {
    constructor() {
        this.map = new Map();
        this.locked = false;
        this.waiting = [];
    }

    async lock() {
        try {
            while (this.locked) {
                await new Promise((resolve) => this.waiting.push(resolve));
            }
            this.locked = true;
        } catch (e) {
            console.error(e);
        }
    }

    unlock() {
        try {
            this.locked = false;
            if (this.waiting.length > 0) {
                const next = this.waiting.shift();
                next();
            }
        } catch (e) {
            console.error(e);
        }
    }

    async set(key, item, locked = false) {
        try {
            if (!locked) {
                await this.lock();
            }
            this.map.set(key, new MapItem(item));
        } catch (e) {
            console.error(e);
        } finally {
            if (!locked) {
                this.unlock();
            }
        }
    }

    async get(key, locked = false) {
        try {
            if (!locked) {
                await this.lock();
            }
            var item = this.map.get(key);
            if (item) {
                item = item.item;
            }
            return item;
        } catch (e) {
            console.error(e);
        } finally {
            if (!locked) {
                this.unlock();
            }
        }
    }

    async scan(callback, raw = false) {
        try {
            await this.lock();
            var found = new Map();
            for (const [key, value] of this.map.entries()) {
                if (await callback(key, raw ? value : value.item)) {
                    found.set(key, value.item);
                }
            }
            for (const key of found.keys()) {
                await this.map.delete(key);
            }
            this.unlock();
            return found;
        } catch (e) {
            console.error(e);
        }
    }

    async pop(key) {
        try {
            await this.lock();
            var ret = null;
            if (this.map.has(key)) {
                ret = this.map.get(key).item;
                this.map.delete(key);
            }
            this.unlock();
            return ret;
        } catch (e) {
            console.error(e);
        }
    }

    async size() {
        try {
            await this.lock();
            const count = this.map.size;
            this.unlock();
            return count;
        } catch (e) {
            console.error(e);
        }
    }

    async keys() {
        try {
            await this.lock();
            var ret = [];
            for (const key of this.map.keys()) {
                ret.push(key);
            }
            this.unlock();
            return ret;
        } catch (e) {
            console.error(e);
        }
    }

    async has(key) {
        try {
            await this.lock();
            const ret = this.map.has(key);
            this.unlock();
            return ret;
        } catch (e) {
            console.error(e);
        }
    }

    async expire(timeout) {
        try {
            async function check(key, value) {
                return value.age() > timeout;
            }
            return await this.scan(check, true);
        } catch (e) {
            console.error(e);
        }
    }
}
