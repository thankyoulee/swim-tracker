import { STATUSES } from "../config.js";

export function generateJSONReport(record) {
	return JSON.stringify(record, null, 2);
}

export function generateMarkdownReport(plan, record) {
	const lines = [
		`# 游泳训练报告：${record.date} (${record.athlete || "李文勇"})`,
		"",
		`- 计划距离：${plan.dist}（${plan.planned_distance ?? 0}m）`,
		`- 实际距离：${record.actual_total_distance ?? 0}m`,
		`- 当日状态：${STATUSES[record.status] || record.status || "未标记"}`,
		`- RPE：${record.daily_overall_rpe ?? "未录入"}/10`,
		`- 晨脉：${record.resting_hr ?? "未录入"} bpm`,
		`- 教练/自评备注：${record.coach_notes || "无"}`,
		"",
		"## 主组执行明细",
		"",
	];
	const splits = record.detailed_splits || [];
	for (const set of record.sets || []) {
		lines.push(`### ${set.module_name}：${STATUSES[set.status] || set.status || "未标记"}`, "");
		if (set.variance_analysis?.reason) lines.push(`- 偏差原因：${set.variance_analysis.reason}`);
		if (set.alternative_items?.length) lines.push(`- 替代项目：${set.alternative_items.join("；")}`);
		const setSplits = splits.filter((split) => split.module_index === set.module_index);
		if (setSplits.length) {
			lines.push("", "| 趟次 | 50m 分段 | 总成绩 | 划次 | 组后心率 |", "| --- | --- | --- | --- | --- |");
			for (const split of setSplits) {
				lines.push(`| ${split.rep_index} | ${(split.split_50m || []).join(", ")} | ${split.time_str || "-"} | ${(split.stroke_count || []).join(", ")} | ${split.post_hr ?? "-"} bpm |`);
			}
		}
		lines.push("");
	}
	if (!record.sets?.length && splits.length) {
		lines.push("| 主组 | 趟次 | 50m 分段 | 总成绩 | 划次 | 组后心率 |", "| --- | --- | --- | --- | --- | --- |");
		for (const split of splits) {
			lines.push(`| ${split.module_name || "主组"} | ${split.rep_index} | ${(split.split_50m || []).join(", ")} | ${split.time_str || "-"} | ${(split.stroke_count || []).join(", ")} | ${split.post_hr ?? "-"} bpm |`);
		}
	}
	return lines.join("\n");
}

export function generateCSVReport(record) {
	const headers = ["日期", "运动员", "当日状态", "实际总距(m)", "RPE", "晨脉(bpm)", "主组", "主组状态", "偏差原因", "替代项目", "趟次", "50m分段", "总成绩", "划次", "组后心率(bpm)"];
	const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
	const splits = record.detailed_splits || [];
	const rows = splits.length ? splits.map((split) => {
		const set = (record.sets || []).find((item) => item.module_index === split.module_index) || {};
		return [record.date, record.athlete, STATUSES[record.status] || record.status, record.actual_total_distance, record.daily_overall_rpe, record.resting_hr, set.module_name || split.module_name, STATUSES[set.status] || set.status, set.variance_analysis?.reason, (set.alternative_items || []).join("; "), split.rep_index, (split.split_50m || []).join("; "), split.time_str, (split.stroke_count || []).join("; "), split.post_hr];
	}) : (record.sets || []).map((set) => [record.date, record.athlete, STATUSES[record.status] || record.status, record.actual_total_distance, record.daily_overall_rpe, record.resting_hr, set.module_name, STATUSES[set.status] || set.status, set.variance_analysis?.reason, (set.alternative_items || []).join("; "), "", "", "", "", ""]);
	if (!rows.length) rows.push([record.date, record.athlete, STATUSES[record.status] || record.status, record.actual_total_distance, record.daily_overall_rpe, record.resting_hr, "", "", record.variance_analysis?.reason, "", "", "", "", "", ""]);
	return `\uFEFF${[headers, ...rows].map((row) => row.map(quote).join(",")).join("\r\n")}`;
}

export function downloadReport(content, filename, type) {
	const url = URL.createObjectURL(new Blob([content], { type }));
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyReport(content) {
	if (!navigator.clipboard?.writeText) throw new Error("当前环境不支持剪贴板写入");
	await navigator.clipboard.writeText(content);
}
