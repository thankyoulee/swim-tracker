const DB_NAME = "SwimTrackerDB";
const DB_VERSION = 1;

class LocalStorageController {
  db = null;

  async init() {
    if (!("indexedDB" in globalThis)) return null;
    try {
      this.db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("records")) {
            db.createObjectStore("records", { keyPath: "date" });
          }
          if (!db.objectStoreNames.contains("ui_state")) {
            db.createObjectStore("ui_state", { keyPath: "key" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("本地数据库被其他页面阻塞"));
      });
    } catch (error) {
      this.db = null;
      console.warn("IndexedDB 不可用，切换到 LocalStorage", error);
    }
    return this.db;
  }

  async saveRecord(record, { sync = true } = {}) {
    if (!record?.date) throw new TypeError("记录必须包含 date");
    if (!this.db) {
      if (!("localStorage" in globalThis)) throw new Error("本地存储不可用");
      localStorage.setItem(`records:${record.date}`, JSON.stringify(record));
      if (sync) queueCloudSync(record);
      return record;
    }
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("records", "readwrite");
      tx.objectStore("records").put(record);
      tx.oncomplete = () => {
        if (sync) queueCloudSync(record);
        resolve(record);
      };
      tx.onerror = () => reject(tx.error || new Error("保存训练记录失败"));
      tx.onabort = () => reject(tx.error || new Error("保存训练记录已中止"));
    });
  }

  async getRecord(date) {
    if (!this.db) {
      const value = localStorage.getItem(`records:${date}`);
      return value ? JSON.parse(value) : null;
    }
    return new Promise((resolve, reject) => {
      const request = this.db.transaction("records", "readonly").objectStore("records").get(date);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async put(storeName, value) {
    if (!this.db) {
      localStorage.setItem(`${storeName}:${value.date ?? value.key}`, JSON.stringify(value));
      return value;
    }
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("本地写入已中止"));
    });
  }

  async get(storeName, key) {
    if (!this.db) {
      const value = localStorage.getItem(`${storeName}:${key}`);
      return value ? JSON.parse(value) : null;
    }
    return new Promise((resolve, reject) => {
      const request = this.db.transaction(storeName, "readonly").objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async migrateLegacyData(days) {
    const readAll = (storeName) => {
      if (!this.db) {
        const prefix = storeName === "records" ? "records:" : "ui_state:";
        return Object.keys(localStorage).filter((key) => key.startsWith(prefix)).flatMap((key) => {
          try {
            return [JSON.parse(localStorage.getItem(key))];
          } catch {
            return [];
          }
        });
      }
      return new Promise((resolve, reject) => {
        const request = this.db.transaction(storeName, "readonly").objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    };
    const targets = new Map(days.map((day) => [day.date.slice(5), day.date]));
    const legacyDate = (value) => {
      const match = String(value).match(/(\d{1,2})月(\d{1,2})日/);
      return match ? targets.get(`${String(Number(match[1])).padStart(2, "0")}-${String(Number(match[2])).padStart(2, "0")}`) : null;
    };
    const [records, states] = await Promise.all([readAll("records"), readAll("ui_state")]);
    let migratedRecords = 0;
    let migratedStates = 0;

    for (const record of records) {
      const date = legacyDate(record.date);
      if (!date || await this.getRecord(date)) continue;
      await this.saveRecord({ ...record, date }, { sync: false });
      migratedRecords += 1;
    }
    for (const state of states) {
      if (!state?.key?.startsWith("checks:")) continue;
      const date = legacyDate(state.key.slice("checks:".length));
      if (!date) continue;
      const key = `checks:${date}`;
      if (await this.get("ui_state", key)) continue;
      await this.put("ui_state", { ...state, key });
      migratedStates += 1;
    }
    return { migratedRecords, migratedStates };
  }
}

function queueCloudSync(record) {
  void import("./cloud-sync.js")
    .then(({ syncRecord }) => syncRecord(record))
    .catch((error) => console.warn("云同步已保留在本地，稍后重试", error));
}

export const dbController = new LocalStorageController();
