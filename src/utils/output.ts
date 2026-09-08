/**
 * output.ts — structured output helpers.
 *
 * Handles the --json flag: when set, emit compact JSON to stdout for agent
 * consumption; otherwise pretty-print for humans.
 */

import { readFileSync } from "node:fs";

export function emit(data: unknown, jsonMode: boolean): void {
  if (jsonMode) {
    console.log(JSON.stringify(data));
  } else if (data === undefined || data === null) {
    console.log("(no output)");
  } else if (typeof data === "object") {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(String(data));
  }
}

export function error(msg: string, jsonMode = false): void {
  if (jsonMode) {
    console.error(JSON.stringify({ error: msg }));
  } else {
    console.error(`✗ ${msg}`);
  }
}

/**
 * Parse a JSON string or @file.json path into a JS object.
 */
export function parseJsonInput(value: string): unknown {
  if (value.startsWith("@")) {
    return JSON.parse(readFileSync(value.slice(1), "utf8"));
  }
  try {
    return JSON.parse(value);
  } catch {
    return value; // keep as string
  }
}

/**
 * camelCase a kebab-case or snake_case option name.
 */
export function camelCase(key: string): string {
  return key.replace(/[-_]([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * CLI 边界的 occupancies 类型归一:CLI 旗标是字符串域,agent 消费方(LLM)常把数字
 * 传成字符串("1"),后端 int64 校验拒收(adultCount:"1" → 400 mismatch type)。
 * 本函数是 canonical 强转点:adultCount→int,childrenAges→int[];无法解析的条目剔除,
 * 有效条目为 0 时返回空数组(由调用方决定报错文案)。
 */
export function normalizeRoomOccupancies(input: unknown): Array<{ adultCount: number; childrenAges: number[] }> {
  if (!Array.isArray(input)) return []
  const out: Array<{ adultCount: number; childrenAges: number[] }> = []
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) continue
    const adultCount = Number((raw as Record<string, unknown>).adultCount)
    if (!Number.isInteger(adultCount) || adultCount < 1) continue
    const childrenRaw = (raw as Record<string, unknown>).childrenAges
    const childrenAges = Array.isArray(childrenRaw)
      ? childrenRaw.map((c) => Number(c)).filter((c) => Number.isInteger(c) && c >= 0)
      : []
    out.push({ adultCount, childrenAges })
  }
  return out
}
