// setPinnedAssistantVm round-trip — Subject update + localStorage persistence.
// Storage key is "genie.assistant.pinnedVm" (renderer-private).

import { describe, it, expect, beforeEach } from "vitest";
import { setPinnedAssistantVm } from "./chat";
import { $pinnedAssistantVm } from "../subjects/chat";
import type { PinnedAssistantVm } from "../types/chat";

const KEY = "genie.assistant.pinnedVm";

const samplePin: PinnedAssistantVm = {
  label: "taz-prod-1",
  host: "2001:470:1f15:97::1",
  projectId: "p-1",
  projectName: "Prod",
  instanceId: "i-1",
  provider: "tazcloud",
};

beforeEach(() => {
  localStorage.clear();
  $pinnedAssistantVm.next(null);
});

describe("setPinnedAssistantVm", () => {
  it("writes the Subject and persists JSON to localStorage", () => {
    setPinnedAssistantVm(samplePin);

    expect($pinnedAssistantVm.getValue()).toEqual(samplePin);
    expect(localStorage.getItem(KEY)).toBe(JSON.stringify(samplePin));
  });

  it("clears both Subject and localStorage when called with null", () => {
    setPinnedAssistantVm(samplePin);
    expect(localStorage.getItem(KEY)).not.toBeNull();

    setPinnedAssistantVm(null);

    expect($pinnedAssistantVm.getValue()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("overwrites a previously stored pin", () => {
    setPinnedAssistantVm(samplePin);
    const other: PinnedAssistantVm = { ...samplePin, label: "different", instanceId: "i-2" };
    setPinnedAssistantVm(other);

    expect($pinnedAssistantVm.getValue()).toEqual(other);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(other);
  });
});

describe("$pinnedAssistantVm survives a notional reload", () => {
  it("the persisted value can be re-read with the same JSON shape", () => {
    setPinnedAssistantVm(samplePin);

    // Read back via the storage API the way loadPinFromStorage() does on init.
    const raw = localStorage.getItem(KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as PinnedAssistantVm;
    expect(parsed).toEqual(samplePin);
  });
});
