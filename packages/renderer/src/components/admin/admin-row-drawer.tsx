"use client";

import { useState, useEffect, useCallback } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { AdminColumnInfo } from "@/store/types";
interface AdminRowDrawerProps {
  open: boolean;
  mode: "edit" | "create";
  columns: AdminColumnInfo[];
  primaryKey: string | null;
  row: Record<string, any> | null;
  onSave: (data: Record<string, any>) => void;
  onClose: () => void;
}

export function AdminRowDrawer({ open, mode, columns, primaryKey, row, onSave, onClose }: AdminRowDrawerProps) {
  const [formData, setFormData] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    const initial: Record<string, string> = {};
    for (const col of columns) {
      const val = row?.[col.name];
      initial[col.name] = val === null || val === undefined ? "" : typeof val === "object" ? JSON.stringify(val, null, 2) : String(val);
    }
    setFormData(initial);
  }, [open, row, columns]);

  const handleSubmit = useCallback(() => {
    const data: Record<string, any> = {};
    for (const col of columns) {
      if (mode === "edit" && col.name === primaryKey) continue;
      const raw = formData[col.name] ?? "";
      if (raw === "" && col.isNullable) {
        data[col.name] = null;
      } else if (col.dataType === "jsonb" || col.dataType === "json") {
        try { data[col.name] = JSON.parse(raw); } catch { data[col.name] = raw; }
      } else if (col.dataType === "boolean") {
        data[col.name] = raw === "true";
      } else if (col.dataType === "integer" || col.dataType === "bigint" || col.dataType === "smallint" || col.dataType === "real" || col.dataType === "double precision" || col.dataType === "numeric") {
        data[col.name] = raw === "" ? null : Number(raw);
      } else {
        data[col.name] = raw;
      }
    }
    onSave(data);
  }, [formData, columns, primaryKey, mode, onSave]);

  if (!open) return null;

  const isJsonLike = (dt: string) => dt === "jsonb" || dt === "json" || dt === "text";

  return (
    <div className="fixed right-0 top-0 h-screen w-[420px] z-50 bg-mantle border-l border-surface0 flex flex-col shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface0">
        <h2 className="text-base font-semibold text-text">
          {mode === "edit" ? "Edit Row" : "New Row"}
        </h2>
        <button
          onClick={onClose}
          className="p-1 bg-transparent border-none cursor-pointer text-overlay0 hover:text-text transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {columns.map((col) => {
          const isPk = col.name === primaryKey;
          const disabled = mode === "edit" && isPk;
          return (
            <div key={col.name}>
              <label className="block text-md font-medium text-subtext0 mb-1">
                {col.name}
                <span className="ml-1.5 text-overlay0 font-normal">
                  {col.dataType}
                  {col.isNullable ? " · nullable" : ""}
                  {isPk ? " · PK" : ""}
                </span>
              </label>
              {col.dataType === "boolean" ? (
                <Select
                  value={formData[col.name] ?? ""}
                  onChange={(e) => setFormData((prev) => ({ ...prev, [col.name]: e.target.value }))}
                  disabled={disabled}
                  className="w-full px-2 bg-background rounded text-base focus:border-mauve"
                >
                  {col.isNullable && <option value="">null</option>}
                  <option value="true">true</option>
                  <option value="false">false</option>
                </Select>
              ) : isJsonLike(col.dataType) && (formData[col.name]?.length ?? 0) > 80 ? (
                <textarea
                  value={formData[col.name] ?? ""}
                  onChange={(e) => setFormData((prev) => ({ ...prev, [col.name]: e.target.value }))}
                  disabled={disabled}
                  rows={4}
                  className="w-full px-2 py-1.5 bg-background border border-surface1 rounded text-base text-text font-mono resize-y disabled:opacity-50 outline-none focus:border-mauve"
                />
              ) : (
                <input
                  type="text"
                  value={formData[col.name] ?? ""}
                  onChange={(e) => setFormData((prev) => ({ ...prev, [col.name]: e.target.value }))}
                  disabled={disabled}
                  className="w-full px-2 py-1.5 bg-background border border-surface1 rounded text-base text-text disabled:opacity-50 outline-none focus:border-mauve"
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-surface0">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={handleSubmit}>
          {mode === "edit" ? "Save" : "Insert"}
        </Button>
      </div>
    </div>
  );
}
