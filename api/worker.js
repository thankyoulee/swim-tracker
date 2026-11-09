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

// 统一 CORS 响应头定义（防硬编码遗漏）
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, If-Match, if-match, authorization",
  "Access-Control-Expose-Headers": "ETag",
  "Access-Control-Max-Age": "86400",
};

/**
 * 安全的 JSON 响应构造器，向下兼容不支持 Response.json 的 Worker 环境
 */
function createJsonResponse(body, status = 200, extraHeaders = {}) {
  const jsonString = JSON.stringify(body);
  return new Response(jsonString, {
    status,
    headers: {
      ...CORS_HEADERS,
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
  async fetch(request, env, ctx) {
    // 1. 优先处理预检 OPTIONS 请求，确保任何情况下都不崩溃并附带完整 CORS 头
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    // 2. 全局异常兜底：防止未捕获异常抛出 1101，保证始终返回含 CORS 的 JSON 响应
    try {
      const url = new URL(request.url);

      // 根路径健康检查入口（直接访问 Worker 域名时不会再报 Error 1101）
      if (url.pathname === "/" || url.pathname === "") {
        return createJsonResponse({ status: "ok", service: "SwimTracker API" });
      }

      const match = url.pathname.match(/^\/records\/(\d{4}-\d{2}-\d{2})$/);
      if (!match) {
        return createJsonResponse({ error: "not_found", message: "API route not supported" }, 404);
      }

      if (!env.DB) {
        return createJsonResponse({ error: "database_unavailable", message: "D1 database binding 'DB' missing" }, 503);
      }

      const date = match[1];

      // 处理 GET 请求
      if (request.method === "GET") {
        const record = await getRecord(env.DB, date);
        return record
          ? createJsonResponse(record, 200, { ETag: String(record.version) })
          : createJsonResponse({ error: "not_found" }, 404);
      }

      // 拒绝非 PUT 请求
      if (request.method !== "PUT") {
        return createJsonResponse({ error: "method_not_allowed" }, 405, { Allow: "GET, PUT, OPTIONS" });
      }

      // 校验 If-Match 请求头
      const versionHeader = request.headers.get("if-match") || request.headers.get("If-Match");
      const expectedVersion = versionHeader === null ? NaN : Number(versionHeader);
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
        return createJsonResponse({ error: "if_match_required" }, 428);
      }

      let record;
      try {
        record = await request.json();
      } catch {
        return createJsonResponse({ error: "invalid_json" }, 400);
      }

      const validationError = validateRecord(date, record);
      if (validationError) {
        return createJsonResponse({ error: "invalid_record", detail: validationError }, 400);
      }

      const result = await putRecord(env.DB, date, record, expectedVersion);
      if (result.conflict) {
        return createJsonResponse(result, 409, { ETag: String(result.version) });
      }

      return createJsonResponse(result, 200, { ETag: String(result.version) });

    } catch (err) {
      // 捕捉所有意外运行时崩溃，防止暴露 1101，保证返回正确的 CORS 头
      console.error("Worker Execution Error:", err);
      return createJsonResponse(
        { error: "internal_server_error", message: err.message || "An unexpected error occurred" },
        500
      );
    }
  },
};