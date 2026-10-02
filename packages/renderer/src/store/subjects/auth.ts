import { Subject } from "subjecto/core";
import type { AuthState } from "../types/auth";

export const $auth = new Subject<AuthState>({ status: "loading", user: null, token: null, impersonatedBy: null });
