import { STATUSES } from "../config.js";
import { dbController } from "./local-storage.js";
import { copyReport, downloadReport, generateCSVReport, generateJSONReport, generateMarkdownReport } from "./exporter.js";

const asNumber = (value) => value === "" ? null : Number(value);
const parseList = (value) => value.split(",").map((part) => part.trim()).filter(Boolean);

export function mountRecord(root, day, record, onSave = (value) => dbController.saveRecord(value)) {
  const initial = record || { date: day.date, athlete: "李文勇", sets: [], detailed_splits: [] };
  let status = initial.status || "completed_target";
  let pendingSave = Promise.resolve();
  let hideStatusTimer;

  root.replaceChildren();
  let statusLine = document.getElementById("save-toast");
  if (!statusLine) {
    statusLine = document.createElement("div");
    statusLine.id = "save-toast";
    document.body.append(statusLine);
  }
  statusLine.classList.add("hidden");
  statusLine.setAttribute("role", "status");
  statusLine.setAttribute("aria-live", "polite");

  const form = document.createElement("div");
  form.innerHTML = `
    <div class="field"><label for="record-distance">实际完成总距（米）</label><input id="record-distance" name="actual_total_distance" type="number" min="0"></div>
    <div class="field"><label for="record-rpe">当日 RPE（0–10）</label><input id="record-rpe" name="daily_overall_rpe" type="number" min="0" max="10"></div>
    <div class="field"><label for="record-hr">晨脉 / 静息心率（bpm）</label><input id="record-hr" name="resting_hr" type="number" min="0"></div>
    <div class="field"><label for="record-notes">教练 / 自评备注</label><textarea id="record-notes" name="coach_notes" rows="3"></textarea></div>
    <h3>当日执行状态</h3><div class="status-grid"></div>
    <div class="field variance"><label for="variance-reason">调整原因与分析</label><textarea id="variance-reason" name="variance_reason" rows="3"></textarea></div>
    <section class="detailed-groups"><h3>主组详细分段与划次</h3><div class="groups"></div></section>
    <div class="actions">
      <button type="button" id="export-json">下载 JSON</button>
      <button type="button" id="copy-json">复制 JSON</button>
      <button type="button" id="copy-md">复制 Markdown</button>
      <button type="button" id="export-md">下载 Markdown</button>
      <button type="button" id="copy-csv">复制 CSV</button>
      <button type="button" id="export-csv">下载 CSV</button>
    </div>`;
  root.append(form);

  const field = (name) => form.querySelector(`[name="${name}"]`);
  const setValue = (name, value) => { field(name).value = value ?? ""; };
  setValue("actual_total_distance", initial.actual_total_distance);
  setValue("daily_overall_rpe", initial.daily_overall_rpe);
  setValue("resting_hr", initial.resting_hr);
  setValue("coach_notes", initial.coach_notes);
  setValue("variance_reason", initial.variance_analysis?.reason);
  field("variance_reason").required = status !== "completed_target";

  const statusGrid = form.querySelector(".status-grid");
  for (const [key, label] of Object.entries(STATUSES)) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.status = key;
    button.textContent = label;
    button.classList.toggle("selected", status === key);
    statusGrid.append(button);
  }
  form.querySelector(".variance").classList.toggle("hidden", status === "completed_target");

  const keyModules = day.modules
    .map((module, moduleIndex) => ({ module, moduleIndex }))
    .filter(({ module }) => module.type === "main" || module.is_key_set === true);
  const groups = form.querySelector(".groups");
  for (const { module, moduleIndex } of keyModules) {
    const details = document.createElement("details");
    details.className = "module";
    details.open = true;
    const summary = document.createElement("summary");
    summary.textContent = `${module.name} · ${module.items.length} 项`;
    const list = document.createElement("div");
    list.className = "split-list";
    list.dataset.moduleIndex = String(moduleIndex);
    const savedSet = (initial.sets || []).find((set) => set.module_index === moduleIndex) || {};
    const audit = document.createElement("div");
    audit.className = "set-audit";
    audit.dataset.moduleIndex = String(moduleIndex);
    const statusLabel = document.createElement("label");
    statusLabel.className = "field";
    statusLabel.append("主组执行状态");
    const setStatus = document.createElement("select");
    setStatus.dataset.setField = "status";
    for (const [value, label] of Object.entries(STATUSES)) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      setStatus.append(option);
    }
    setStatus.value = savedSet.status || "completed_target";
    statusLabel.append(setStatus);
    const variance = document.createElement("label");
    variance.className = "field set-variance";
    variance.append("偏差原因");
    const varianceInput = document.createElement("textarea");
    varianceInput.dataset.setField = "variance";
    varianceInput.rows = 2;
    varianceInput.value = savedSet.variance_analysis?.reason || "";
    varianceInput.required = setStatus.value !== "completed_target";
    variance.append(varianceInput);
    variance.hidden = setStatus.value === "completed_target";
    const alternative = document.createElement("label");
    alternative.className = "field";
    alternative.append("替代项目");
    const alternativeInput = document.createElement("textarea");
    alternativeInput.dataset.setField = "alternative_items";
    alternativeInput.rows = 2;
    alternativeInput.value = (savedSet.alternative_items || []).join("\n");
    alternativeInput.required = setStatus.value === "substituted";
    alternative.append(alternativeInput);
    audit.append(statusLabel, variance, alternative);
    setStatus.addEventListener("change", () => {
      variance.hidden = setStatus.value === "completed_target";
      varianceInput.required = setStatus.value !== "completed_target";
      alternativeInput.required = setStatus.value === "substituted";
      if (!variance.hidden) details.open = true;
      void saveNow();
    });
    details.append(summary, audit, list);
    groups.append(details);

    const splits = (initial.detailed_splits || []).filter((split) => split.module_index === moduleIndex);
    splits.forEach((split, index) => list.append(makeSplitRow(split, index + 1)));
    const add = document.createElement("button");
    add.type = "button";
    add.className = "add-split";
    add.textContent = "+ 添加一趟";
    add.addEventListener("click", async () => {
      list.append(makeSplitRow({ module_index: moduleIndex }, list.querySelectorAll(".split-row").length + 1));
      await saveNow();
    });
    details.append(add);
  }

  function makeSplitRow(split, fallbackRep) {
    const row = document.createElement("fieldset");
    row.className = "split-row row";
    row.innerHTML = `<legend>第 ${fallbackRep} 趟</legend>
      <label class="field">趟次<input data-split="rep_index" type="number" min="1"></label>
      <label class="field">50m 分段成绩（逗号分隔）<input data-split="split_50m" inputmode="decimal" placeholder="38.5, 44.5"></label>
      <label class="field">总成绩<input data-split="time_str" placeholder="例如 1:23.5"></label>
      <label class="field">划次（逗号分隔）<input data-split="stroke_count" inputmode="numeric" placeholder="14, 15"></label>
      <label class="field">组后即刻心率（bpm）<input data-split="post_hr" type="number" min="0" inputmode="numeric"></label>`;
    row.dataset.moduleIndex = String(split.module_index);
    row.querySelector('[data-split="rep_index"]').value = split.rep_index ?? fallbackRep;
    row.querySelector('[data-split="split_50m"]').value = Array.isArray(split.split_50m) ? split.split_50m.join(", ") : (split.split_50m || "");
    row.querySelector('[data-split="time_str"]').value = split.time_str || "";
    row.querySelector('[data-split="stroke_count"]').value = Array.isArray(split.stroke_count) ? split.stroke_count.join(", ") : (split.stroke_count || "");
    row.querySelector('[data-split="post_hr"]').value = split.post_hr ?? "";
    return row;
  }

  function collectRecord() {
    const sets = [...form.querySelectorAll(".set-audit")].map((audit) => {
      const moduleIndex = Number(audit.dataset.moduleIndex);
      const setStatus = audit.querySelector('[data-set-field="status"]').value;
      const previous = (initial.sets || []).find((set) => set.module_index === moduleIndex) || {};
      return {
        ...previous,
        module_index: moduleIndex,
        module_name: day.modules[moduleIndex].name,
        status: setStatus,
        variance_analysis: setStatus === "completed_target" ? null : {
          reason: audit.querySelector('[data-set-field="variance"]').value,
        },
        alternative_items: audit.querySelector('[data-set-field="alternative_items"]').value
          .split("\n").map((item) => item.trim()).filter(Boolean),
      };
    });
    const detailed_splits = [...form.querySelectorAll(".split-row")].map((row) => {
      const field = (name) => row.querySelector(`[data-split="${name}"]`).value.trim();
      return {
        module_index: Number(row.dataset.moduleIndex),
        module_name: day.modules[Number(row.dataset.moduleIndex)].name,
        rep_index: Number(field("rep_index")) || 1,
        split_50m: parseList(field("split_50m")),
        time_str: field("time_str"),
        stroke_count: parseList(field("stroke_count")).map(Number),
        post_hr: asNumber(field("post_hr")),
      };
    });
    return {
      ...initial,
      date: day.date,
      status,
      actual_total_distance: asNumber(field("actual_total_distance").value) || 0,
      daily_overall_rpe: asNumber(field("daily_overall_rpe").value),
      resting_hr: asNumber(field("resting_hr").value),
      coach_notes: field("coach_notes").value,
      variance_analysis: status === "completed_target" ? null : { reason: field("variance_reason").value },
      detailed_splits,
      sets,
      updated_at: new Date().toISOString(),
    };
  }

  async function saveNow() {
    clearTimeout(hideStatusTimer);
    statusLine.classList.remove("hidden");
    statusLine.textContent = "保存中…";
    const missingSetReason = [...form.querySelectorAll(".set-audit")].some((audit) => {
      const setStatus = audit.querySelector('[data-set-field="status"]').value;
      const reason = audit.querySelector('[data-set-field="variance"]').value.trim();
      const alternatives = audit.querySelector('[data-set-field="alternative_items"]').value.trim();
      return (setStatus !== "completed_target" && !reason) || (setStatus === "substituted" && !alternatives);
    });
    if ((status !== "completed_target" && !field("variance_reason").value.trim()) || missingSetReason) {
      statusLine.textContent = "请补全未达标原因；方案替换时还需填写替代项目";
      return;
    }
    const snapshot = collectRecord();
    pendingSave = pendingSave.catch(() => {}).then(() => onSave(snapshot));
    try {
      await pendingSave;
      statusLine.textContent = "已保存";
      hideStatusTimer = setTimeout(() => { statusLine.classList.add("hidden"); }, 1500);
    } catch (error) {
      statusLine.textContent = "保存失败，请保持页面开启后重试";
      console.error("训练记录自动保存失败", error);
    }
  }

  form.addEventListener("blur", (event) => {
    if (event.target.matches("input, textarea, select")) void saveNow();
  }, true);
  statusGrid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-status]");
    if (!button) return;
    status = button.dataset.status;
    statusGrid.querySelectorAll("[data-status]").forEach((item) => item.classList.toggle("selected", item === button));
    form.querySelector(".variance").classList.toggle("hidden", status === "completed_target");
    field("variance_reason").required = status !== "completed_target";
    void saveNow();
  });

  const recordForExport = () => collectRecord();
  const markdownForExport = () => generateMarkdownReport(day, recordForExport());
  const csvForExport = () => generateCSVReport(recordForExport());
  const copyWithFeedback = (content) => {
    void copyReport(content).then(() => {
      statusLine.classList.remove("hidden");
      statusLine.textContent = "已复制到剪贴板";
    }).catch((error) => {
      statusLine.classList.remove("hidden");
      statusLine.textContent = "复制失败，请检查浏览器剪贴板权限";
      console.warn("报告复制失败", error);
    });
  };
  form.querySelector("#export-json").addEventListener("click", () => {
    downloadReport(generateJSONReport(recordForExport()), `${day.date}.json`, "application/json");
  });
  form.querySelector("#copy-json").addEventListener("click", () => copyWithFeedback(generateJSONReport(recordForExport())));
  form.querySelector("#copy-md").addEventListener("click", () => copyWithFeedback(markdownForExport()));
  form.querySelector("#export-md").addEventListener("click", () => {
    downloadReport(markdownForExport(), `${day.date}.md`, "text/markdown;charset=utf-8");
  });
  form.querySelector("#copy-csv").addEventListener("click", () => copyWithFeedback(csvForExport()));
  form.querySelector("#export-csv").addEventListener("click", () => {
    downloadReport(csvForExport(), `${day.date}.csv`, "text/csv;charset=utf-8");
  });
}
