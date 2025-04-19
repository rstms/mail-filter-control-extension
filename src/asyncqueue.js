class QueueItem {
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

export class AsyncQueue {
    constructor() {
        this.queue = [];
        this.locked = false;
        this.waiting = [];
    }

    async lock() {
        while (this.locked) {
            await new Promise((resolve) => this.waiting.push(resolve));
        }
        this.locked = true;
    }

    unlock() {
        this.locked = false;
        if (this.waiting.length > 0) {
            const next = this.waiting.shift();
            next();
        }
    }

    async push(item) {
        try {
            await this.lock();
            this.queue.push(new QueueItem(item));
        } finally {
            this.unlock();
        }
    }

    async put(item) {
        return await this.push(item);
    }

    async shift() {
        try {
            await this.lock();
            var item = this.queue.shift();
            if (item) {
                item = item.item;
            }
            return item;
        } finally {
            this.unlock();
        }
    }

    async get() {
        return await this.shift();
    }

    async pop() {
        try {
            await this.lock();
            var item = this.queue.pop();
            if (item) {
                item = item.item;
            }
            return item;
        } finally {
            this.unlock();
        }
    }

    async size() {
        try {
            await this.lock();
            const length = this.queue.length;
            return length;
        } finally {
            this.unlock();
        }
    }

    async popAll() {
        try {
            await this.lock();
            let ret = [];
            for (const item of this.queue) {
                ret.push(item.item);
            }
            this.queue = [];
            return ret;
        } finally {
            this.unlock();
        }
    }

    async expire(timeout) {
        try {
            await this.lock();
            var active = [];
            var expired = [];
            for (let i = 0; i < this.queue.length; i++) {
                if (this.queue[i].age() > timeout) {
                    expired.push(this.queue[i].item);
                } else {
                    active.push(this.queue[i]);
                }
            }
            this.queue = active;
            return expired;
        } finally {
            this.unlock();
        }
    }
}
