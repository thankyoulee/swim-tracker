// js/config.js
export const STATUSES = {
  completed_target: "完成且达标",
  completed_below_target: "完成未达标",
  partial_completed: "部分完成",
  proactive_deload: "主动减量保护",
  canceled: "临时取消",
  substituted: "方案替换",
  external_interruption: "外部中断",
  physically_stopped: "身体不适终止",
};

export const HR_ZONES = {
  z1: "恢复",
  z2: "有氧",
  z3: "阈值",
  z4: "高强度",
  z5: "冲刺",
};

// 确保为干净的纯文本 URL 字符串（部署后请替换为你真实的 Cloudflare 域名）
export const API_BASE_URL = "https://winter-sky-b882swim-tracker-api.chengyujie5856.workers.dev";
