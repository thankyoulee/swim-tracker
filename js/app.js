// js/app.js
import { dbController } from "./modules/local-storage.js";
import { renderPlan } from "./modules/plan-renderer.js";
import { mountTimer } from "./modules/timer-engine.js";
import { mountRecord } from "./modules/record-panel.js";
import { fetchRemoteRecord, flushSyncQueue } from "./modules/cloud-sync.js";
import { bindSwipe } from "./utils/touch-helper.js";

const days = await (await fetch("data/plans/2026-11.json", { cache: "no-store" })).json();
await dbController.init();
await dbController.migrateLegacyData(days);

// 应用启动时自动清空后台未发同步队列
void flushSyncQueue().catch((error) => console.error("云端同步失败，记录仍保存在本地", error));

const savedIndex = Number((await dbController.get("ui_state", "day"))?.value);
let index = Number.isInteger(savedIndex) && savedIndex >= 0 && savedIndex < days.length ? savedIndex : 0;
let activeWeek = days[index].week;
let renderToken = 0;
const nav = document.querySelector("#date-pills");
const mount = document.querySelector("#plan-mount");
const weekSelector = document.querySelector("#week-selector");
const weeks = [...new Set(days.map((day) => day.week))];

weekSelector.replaceChildren(...weeks.map((week) => {
  const option = document.createElement("option");
  option.value = week;
  option.textContent = week;
  return option;
}));

async function show() {
  const token = ++renderToken;
  const day = days[index];
  activeWeek = day.week;
  weekSelector.value = activeWeek;
  const visibleDays = days.map((item, i) => ({ item, i })).filter(({ item }) => item.week === activeWeek);
  
  nav.replaceChildren(...visibleDays.map(({ item, i }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.shortDate;
    button.classList.toggle("active", i === index);
    button.addEventListener("click", () => go(i));
    return button;
  }));

  await dbController.put("ui_state", { key: "day", value: index });
  const [savedChecks] = await Promise.all([
    dbController.get("ui_state", `checks:${day.date}`),
  ]);
  
  if (token !== renderToken) return;
  const checks = { ...(savedChecks?.value || {}) };
  renderPlan(day, mount, savedChecks?.value || {}, (key, checked) => {
    checks[key] = checked;
    void dbController.put("ui_state", { key: `checks:${day.date}`, value: checks });
  });
}

function go(nextIndex) {
  index = (nextIndex + days.length) % days.length;
  void show();
}

weekSelector.addEventListener("change", () => {
  const firstDayIndex = days.findIndex((day) => day.week === weekSelector.value);
  if (firstDayIndex >= 0) go(firstDayIndex);
});

bindSwipe(mount, (direction) => go(index + direction));
mountTimer(document.querySelector("#timer-mount"));

function setDrawer(id, open) {
  if (open) {
    const otherId = id === "timer-drawer" ? "record-drawer" : "timer-drawer";
    const otherDrawer = document.getElementById(otherId);
    if (otherDrawer) {
      otherDrawer.classList.remove("open");
      otherDrawer.setAttribute("aria-hidden", "true");
    }
  }
  const drawer = document.getElementById(id);
  drawer.classList.toggle("open", open);
  drawer.setAttribute("aria-hidden", String(!open));
}

document.addEventListener("timer:open", (e) => {
  setDrawer("timer-drawer", true);
});

document.addEventListener("record:open", (event) => {
  void openRecord(event.detail?.moduleIndex);
});

document.querySelector("#open-timer-btn").addEventListener("click", () => setDrawer("timer-drawer", true));
document.querySelector("#open-record-btn").addEventListener("click", () => openRecord());

async function openRecord(moduleIndex) {
  const day = days[index];
  
  // 1. 先优先从本地获取，确保瞬时渲染
  let record = await dbController.getRecord(day.date);
  
  // 2. 挂载界面
  mountRecord(document.querySelector("#record-form-container"), day, record, async (value) => {
    await dbController.saveRecord(value);
    if (typeof flushSyncQueue === 'function') {
      flushSyncQueue().catch(e => console.error("后台同步失败", e));
    }
  });

  setDrawer("record-drawer", true);

  if (Number.isInteger(moduleIndex)) {
    const list = document.querySelector(`.split-list[data-module-index="${moduleIndex}"]`);
    if (list) {
      list.closest("details").open = true;
      setTimeout(() => {
        list.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 300);
    }
  }

  // 3. 【修复死锁关键】：后台异步向云端同步拉取最新记录，如果云端有更新，则静默更新本地并重载抽屉
  if (typeof fetchRemoteRecord === 'function') {
    try {
      const remoteRecord = await fetchRemoteRecord(day.date);
      if (remoteRecord && JSON.stringify(remoteRecord) !== JSON.stringify(record)) {
        await dbController.saveRecord(remoteRecord, { sync: false });
        // 云端存在新数据，重新渲染记录抽屉
        mountRecord(document.querySelector("#record-form-container"), day, remoteRecord, async (value) => {
          await dbController.saveRecord(value);
          if (typeof flushSyncQueue === 'function') {
            flushSyncQueue().catch(e => console.error("后台同步失败", e));
          }
        });
      }
    } catch (error) {
      console.warn("从云端拉取最新数据失败或处于离线模式:", error);
    }
  }
}

document.querySelectorAll(".close-btn").forEach((button) => {
  button.addEventListener("click", () => setDrawer(button.dataset.target, false));
});

void show();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});