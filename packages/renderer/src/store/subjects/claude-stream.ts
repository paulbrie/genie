import { Subject } from "subjecto/core";
import type { ClaudeStreamState } from "../types/claude-stream";

/** All open durable Claude chat sessions, keyed by claudeStreamId. */
export const $claudeStream = new Subject<ClaudeStreamState>({ sessions: {} });
