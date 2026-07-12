/**
 * output.ts — structured output helpers.
 *
 * Handles the --json flag: when set, emit compact JSON to stdout for agent
 * consumption; otherwise pretty-print for humans.
 */

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
    return JSON.parse(Bun.file(value.slice(1)).textSync());
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