/**
 * state.ts — session state for REPL mode.
 *
 * Tracks the active profile, last response, and a simple history deque.
 */

import type { Profile } from "./config.ts";

export interface HistoryEntry {
  path: string;
  body: unknown;
  response: unknown;
}

export class SessionState {
  profile: Profile | null = null;
  lastResponse: unknown = null;
  history: HistoryEntry[] = [];
  private maxHistory = 20;

  record(path: string, body: unknown, response: unknown): void {
    this.history.push({ path, body, response });
    if (this.history.length > this.maxHistory) this.history.shift();
    this.lastResponse = response;
  }

  undo(): HistoryEntry | undefined {
    return this.history.pop();
  }

  get prompt(): string {
    if (!this.profile) return "hotelbyte> ";
    let tag = this.profile.name;
    if (this.profile.env !== "uat") tag += `[${this.profile.env}]`;
    return `hotelbyte(${tag})> `;
  }
}

let _state: SessionState | null = null;

export function getState(): SessionState {
  if (!_state) _state = new SessionState();
  return _state;
}

export function resetState(): void {
  _state = null;
}