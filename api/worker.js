// api/worker.js
import { getRecord, putRecord } from "./d1-client.js";

const STATUSES = new Set([
  "completed_target",
  "completed_below_target",
  "partial_completed",
  "proactive_deload",
  "canceled",
  "substituted",
  "external_interruption",
  "physically_stopped",
]);

function response(body, status = 200, extraHeaders = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, If-Match, if-match",
      "Access-Control-Expose-Headers": "ETag",
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function validateRecord(date, record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return "请求体必须是记录对象";
  if (record.date !== date) return "请求路径日期必须与记录日期一致";
  const dateValue = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(dateValue.getTime()) || dateValue.toISOString().slice(0, 10) !== date) return "无效的日历日期";
  if (!STATUSES.has(record.status)) return "无效的当日执行状态";
  if (!Array.isArray(record.sets) || !Array.isArray(record.detailed_splits)) return "缺少主组或分段数据";
  if (record.status !== "completed_target" && !record.variance_analysis?.reason?.trim()) return "非达标记录必须填写调整原因";
  if (record.daily_overall_rpe != null && (!Number.isFinite(record.daily_overall_rpe) || record.daily_overall_rpe < 0 || record.daily_overall_rpe > 10)) {
    return "RPE 必须在 0 到 10 之间";
  }
  if (record.actual_total_distance != null && (!Number.isFinite(record.actual_total_distance) || record.actual_total_distance < 0)) {
    return "实际距离必须为非负数";
  }
  for (const set of record.sets) {
    if (!set || typeof set !== "object" || !Number.isInteger(set.module_index) || set.module_index < 0 || typeof set.module_name !== "string" || !STATUSES.has(set.status)) {
      return "主组记录字段无效";
    }
    if (set.status !== "completed_target" && !set.variance_analysis?.reason?.trim()) return "非达标主组必须填写调整原因";
    if (!Array.isArray(set.alternative_items) || !set.alternative_items.every((item) => typeof item === "string")) return "替代项目必须是字符串数组";
    if (set.status === "substituted" && set.alternative_items.length === 0) return "方案替换必须填写替代项目";
  }
  for (const split of record.detailed_splits) {
    if (!split || typeof split !== "object" || !Number.isInteger(split.module_index) || split.module_index < 0 || !Number.isInteger(split.rep_index) || split.rep_index < 1
      || typeof split.module_name !== "string" || !Array.isArray(split.split_50m) || !Array.isArray(split.stroke_count)
      || !split.split_50m.every((value) => typeof value === "string")
      || !split.stroke_count.every((value) => Number.isInteger(value) && value >= 0)
      || typeof split.time_str !== "string" || (split.post_hr != null && (!Number.isFinite(split.post_hr) || split.post_hr < 0))) {
      return "分段记录字段无效";
    }
  }
  return null;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, If-Match, if-match",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const url = new URL(request.url);
    const match = url.pathname.match(/^\/records\/(\d{4}-\d{2}-\d{2})$/);
    if (!match) return response({ error: "not_found" }, 404);
    if (!env.DB) return response({ error: "database_unavailable" }, 503);

    const date = match[1];
    if (request.method === "GET") {
      const record = await getRecord(env.DB, date);
      return record
        ? response(record, 200, { ETag: String(record.version) })
        : response({ error: "not_found" }, 404);
    }

    if (request.method !== "PUT") {
      return response({ error: "method_not_allowed" }, 405, { Allow: "GET, PUT, OPTIONS" });
    }

    const versionHeader = request.headers.get("if-match");
    const expectedVersion = versionHeader === null ? NaN : Number(versionHeader);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
      return response({ error: "if_match_required" }, 428);
    }

    let record;
    try {
      record = await request.json();
    } catch {
      return response({ error: "invalid_json" }, 400);
    }
    const validationError = validateRecord(date, record);
    if (validationError) return response({ error: "invalid_record", detail: validationError }, 400);

    const result = await putRecord(env.DB, date, record, expectedVersion);
    if (result.conflict) return response(result, 409, { ETag: String(result.version) });
    return response(result, 200, { ETag: String(result.version) });
  },
};