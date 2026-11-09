// js/modules/cloud-sync.js
import { API_BASE_URL } from "../config.js";

const QUEUE_KEY = "swimtracker:sync-queue";
const VERSIONS_KEY = "swimtracker:record-versions";
let flushPromise = null;

function readJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}

function endpointURL(endpoint) {
  let raw = endpoint || API_BASE_URL || localStorage.getItem("swimtracker:api-url") || "";
  // 过滤可能误入的 Markdown 标记或空格
  raw = raw.replace(/^\[|\]$/g, "").replace(/\)$/, "").trim();
  return raw;
}

export function configureSyncEndpoint(endpoint) {
  if (endpoint) localStorage.setItem("swimtracker:api-url", endpoint.replace(/\/$/, ""));
  return flushSyncQueue();
}

export async function syncRecord(record, endpoint = "") {
  const queue = readJSON(QUEUE_KEY, {});
  const versions = readJSON(VERSIONS_KEY, {});
  queue[record.date] = {
    record: { ...record, version: versions[record.date] ?? record.version ?? 0 },
    queued_at: new Date().toISOString(),
  };
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));

  const targetURL = endpointURL(endpoint);
  if (!targetURL || globalThis.navigator?.onLine === false) {
    console.warn("⚠️ API 地址未配置或处于离线状态，训练记录已暂存本地队列。");
    return { queued: true };
  }
  return flushSyncQueue(endpoint);
}

export async function fetchRemoteRecord(date, endpoint = "") {
  const baseURL = endpointURL(endpoint).replace(/\/$/, "");
  if (!baseURL || globalThis.navigator?.onLine === false) return null;
  const response = await fetch(`${baseURL}/records/${encodeURIComponent(date)}`, {
    mode: "cors", // 显式声明跨域
    headers: { "Accept": "application/json" }
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`读取云端记录失败：HTTP ${response.status}`);
  return response.json();
}

export function flushSyncQueue(endpoint = "") {
  if (flushPromise) return flushPromise;
  flushPromise = flush(endpoint).finally(() => { flushPromise = null; });
  return flushPromise;
}

async function flush(endpoint) {
  const baseURL = endpointURL(endpoint).replace(/\/$/, "");
  if (!baseURL || globalThis.navigator?.onLine === false) return { queued: true };
  const versions = readJSON(VERSIONS_KEY, {});
  const queue = readJSON(QUEUE_KEY, {});
  const results = [];

  for (const [date, entry] of Object.entries(queue)) {
    const record = entry.record || entry;
    const expectedVersion = versions[date] ?? record.version ?? 0;
    
    try {
      const response = await fetch(`${baseURL}/records/${encodeURIComponent(date)}`, {
        method: "PUT",
        mode: "cors", // 强制跨域模式
        headers: { 
          "Content-Type": "application/json", // 首字母大写规范化
          "If-Match": String(expectedVersion) // 首字母大写规范化
        },
        body: JSON.stringify(record),
      });

      const result = await response.json().catch(() => ({}));
      if (response.status === 409 || result.conflict) {
        if (result.version) {
          versions[date] = result.version;
          localStorage.setItem(VERSIONS_KEY, JSON.stringify(versions));
        }
        results.push({ date, conflict: true, serverVersion: result.version });
        continue;
      }

      if (!response.ok) throw new Error(`同步 ${date} 失败：HTTP ${response.status}`);

      versions[date] = result.version;
      localStorage.setItem(VERSIONS_KEY, JSON.stringify(versions));
      
      const latestQueue = readJSON(QUEUE_KEY, {});
      if (latestQueue[date]?.queued_at === entry.queued_at) delete latestQueue[date];
      localStorage.setItem(QUEUE_KEY, JSON.stringify(latestQueue));
      
      results.push({ date, synced: true, version: result.version });
    } catch (err) {
      console.error(`记录 [${date}] 同步异常:`, err);
    }
  }

  return { queued: Object.keys(readJSON(QUEUE_KEY, {})).length, results };
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => { 
    void flushSyncQueue().catch((error) => console.error("云端同步失败", error)); 
  });
}