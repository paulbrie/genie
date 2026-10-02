"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Database, Loader2, RefreshCw, Play, Save, Table2, SearchCode, File, X, Download, Trash2, HardDrive, Plus } from "lucide-react";
import { wsRequest, wsSend } from "@/lib/ws";
import { Select } from "@/components/ui/select";
import { ErrorMessage } from "@/components/ui/error-message";

// --- Types ---

interface DbTableInfo {
  name: string;
  rowCount: number | null;
}

interface DbQueryResult {
  columns: string[];
  rows: Record<string, any>[];
  rowCount: number;
  error?: string;
}

interface SavedQuery {
  id: string;
  projectId: string;
  userId: string;
  name: string;
  description: string;
  query: string;
  createdAt: string;
  updatedAt: string;
  userName: string | null;
  userAvatar: string | null;
}

interface BackupEntry {
  name: string;
  size: string;
  date: string;
  path: string;
}

export interface DbExplorerProject {
  id: string;
  dbUrl?: string;
  vpsInstances: { id: string; connection: { host: string } }[];
}

export interface DbExplorerInstance {
  id: string;
  connection: { host: string };
}

function formatCellValue(val: any): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

// --- Component ---

/** Pass `instance` to lock the explorer to a specific VM (used by the
 *  Manage popup); omit it to fall back to `vpsInstances[0]`. */
export function DbExplorer({ project, instance }: {
  project: DbExplorerProject;
  instance?: DbExplorerInstance;
}) {
  const inst = instance ?? project.vpsInstances[0];
  const [tables, setTables] = useState<DbTableInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableData, setTableData] = useState<DbQueryResult | null>(null);
  const [tableLoading, setTableLoading] = useState(false);
  const [sqlQuery, setSqlQuery] = useState("");
  const [sqlResult, setSqlResult] = useState<DbQueryResult | null>(null);
  const [sqlLoading, setSqlLoading] = useState(false);
  const [mode, setMode] = useState<"tables" | "sql" | "saved" | "backup">("tables");
  const [sidebarWidth, setSidebarWidth] = useState(192);
  const [dbUrl, setDbUrl] = useState(project.dbUrl || "");
  const [dbConnected, setDbConnected] = useState(false);
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [editingRow, setEditingRow] = useState<{ original: Record<string, any>; edited: Record<string, any>; columns: string[] } | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [primaryKeys, setPrimaryKeys] = useState<Record<string, string[]>>({});
  const [savedQueriesList, setSavedQueriesList] = useState<SavedQuery[]>([]);
  const [savedQueriesLoading, setSavedQueriesLoading] = useState(false);
  const [saveQueryForm, setSaveQueryForm] = useState<{ name: string; description: string; queryId?: string } | null>(null);
  const [saveQueryLoading, setSaveQueryLoading] = useState(false);
  const [databases, setDatabases] = useState<string[]>([]);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [backupCreating, setBackupCreating] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);

  // Auto-connect if project has a stored dbUrl, otherwise try to detect
  useEffect(() => {
    if (!inst) return;
    (async () => {
      let url = project.dbUrl || "";
      if (!url) {
        try {
          const res = await wsRequest("vps:db:detect", { projectId: project.id, instanceId: inst.id }, 15000);
          if (res.ok && res.url) url = res.url;
        } catch { /* ignore */ }
      }
      if (url) {
        setDbUrl(url);
        setConnectLoading(true);
        try {
          const connRes = await wsRequest("vps:db:tables", { projectId: project.id, instanceId: inst.id, dbUrl: url }, 15000);
          if (connRes.ok) {
            setTables(connRes.tables);
            setDbConnected(true);
            if (url !== (project.dbUrl || "")) wsSend("project:dbUrl:set", { id: project.id, dbUrl: url });
            // Load database list in background
            wsRequest("vps:db:databases", { projectId: project.id, instanceId: inst.id, dbUrl: url }, 15000)
              .then((dbRes: any) => { if (dbRes.ok) setDatabases(dbRes.databases || []); })
              .catch(() => {});
          } else {
            setConnectError(connRes.error);
          }
        } catch (err: any) {
          setConnectError(err.message);
        }
        setConnectLoading(false);
      }
      setLoading(false);
    })();
  }, [project.id, inst?.id]);

  const loadDatabases = useCallback(async (url: string) => {
    if (!inst) return;
    try {
      const res = await wsRequest("vps:db:databases", { projectId: project.id, instanceId: inst.id, dbUrl: url }, 15000);
      if (res.ok) setDatabases(res.databases || []);
    } catch { /* ignore */ }
  }, [project.id, inst?.id]);

  const connectDb = useCallback(async () => {
    if (!inst || !dbUrl.trim()) return;
    setConnectLoading(true);
    setConnectError(null);
    try {
      const trimmed = dbUrl.trim();
      const res = await wsRequest("vps:db:tables", { projectId: project.id, instanceId: inst.id, dbUrl: trimmed }, 15000);
      if (res.ok) {
        setTables(res.tables);
        setDbConnected(true);
        setConnectError(null);
        if (trimmed !== (project.dbUrl || "")) wsSend("project:dbUrl:set", { id: project.id, dbUrl: trimmed });
        loadDatabases(trimmed);
      } else {
        setConnectError(res.error);
      }
    } catch (err: any) {
      setConnectError(err.message);
    }
    setConnectLoading(false);
  }, [project.id, project.dbUrl, inst?.id, dbUrl, loadDatabases]);

  const dbUrlRef = useRef(dbUrl);
  dbUrlRef.current = dbUrl;

  const switchDatabase = useCallback(async (newDbName: string) => {
    if (!inst) return;
    const currentUrl = dbUrlRef.current;
    if (!currentUrl) return;
    // Parse URL and swap the database (pathname) portion
    try {
      const parsed = new URL(currentUrl);
      parsed.pathname = `/${newDbName}`;
      const newUrl = parsed.toString();
      dbUrlRef.current = newUrl;
      setDbUrl(newUrl);
      setLoading(true);
      setSelectedTable(null);
      setTableData(null);
      setError(null);
      try {
        const res = await wsRequest("vps:db:tables", { projectId: project.id, instanceId: inst.id, dbUrl: newUrl }, 15000);
        if (res.ok) {
          setTables(res.tables);
          setPrimaryKeys({});
        } else {
          setError(res.error);
        }
      } catch (err: any) {
        setError(err.message);
      }
      setLoading(false);
    } catch {
      // URL parsing failed, ignore
    }
  }, [project.id, inst?.id]);

  const refreshTables = useCallback(async () => {
    if (!inst || !dbUrl) return;
    setLoading(true);
    try {
      const res = await wsRequest("vps:db:tables", { projectId: project.id, instanceId: inst.id, dbUrl }, 15000);
      if (res.ok) setTables(res.tables);
    } catch { /* ignore */ }
    setLoading(false);
  }, [project.id, inst?.id, dbUrl]);

  const loadTableData = useCallback(async (tableName: string) => {
    if (!inst) return;
    setSelectedTable(tableName);
    setTableLoading(true);
    setTableData(null);
    try {
      const res = await wsRequest("vps:db:query", {
        projectId: project.id, instanceId: inst.id, dbUrl,
        query: `SELECT * FROM "${tableName}" LIMIT 100`,
      }, 30000);
      if (res.ok) {
        setTableData(res.result);
      } else {
        setTableData({ columns: [], rows: [], rowCount: 0, error: res.error });
      }
    } catch (err: any) {
      setTableData({ columns: [], rows: [], rowCount: 0, error: err.message });
    }
    setTableLoading(false);
  }, [project.id, inst?.id, dbUrl]);

  const runSql = useCallback(async () => {
    if (!inst || !sqlQuery.trim()) return;
    setSqlLoading(true);
    setSqlResult(null);
    try {
      const res = await wsRequest("vps:db:query", {
        projectId: project.id, instanceId: inst.id, dbUrl,
        query: sqlQuery.trim(),
      }, 30000);
      if (res.ok) {
        setSqlResult(res.result);
      } else {
        setSqlResult({ columns: [], rows: [], rowCount: 0, error: res.error });
      }
    } catch (err: any) {
      setSqlResult({ columns: [], rows: [], rowCount: 0, error: err.message });
    }
    setSqlLoading(false);
  }, [project.id, inst?.id, dbUrl, sqlQuery]);

  const fetchPrimaryKeys = useCallback(async (tableName: string): Promise<string[]> => {
    if (primaryKeys[tableName]) return primaryKeys[tableName];
    if (!inst) return [];
    try {
      const res = await wsRequest("vps:db:query", {
        projectId: project.id, instanceId: inst.id, dbUrl,
        query: `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = '"${tableName}"'::regclass AND i.indisprimary ORDER BY a.attnum`,
      }, 10000);
      const pks = res.ok && res.result?.rows ? res.result.rows.map((r: any) => r.attname) : [];
      setPrimaryKeys((prev) => ({ ...prev, [tableName]: pks }));
      return pks;
    } catch { return []; }
  }, [project.id, inst?.id, dbUrl, primaryKeys]);

  const openRowEditor = useCallback(async (row: Record<string, any>, columns: string[]) => {
    setEditingRow({ original: { ...row }, edited: { ...row }, columns });
    setEditError(null);
    if (selectedTable) fetchPrimaryKeys(selectedTable);
  }, [selectedTable, fetchPrimaryKeys]);

  const saveRow = useCallback(async () => {
    if (!inst || !editingRow || !selectedTable) return;
    const pks = primaryKeys[selectedTable] || await fetchPrimaryKeys(selectedTable);
    if (pks.length === 0) {
      setEditError("Cannot update: no primary key found for this table.");
      return;
    }

    const changed: string[] = [];
    for (const col of editingRow.columns) {
      if (editingRow.edited[col] !== editingRow.original[col]) {
        const val = editingRow.edited[col];
        changed.push(`"${col}" = ${val === null || val === "NULL" ? "NULL" : `'${String(val).replace(/'/g, "''")}'`}`);
      }
    }
    if (changed.length === 0) { setEditingRow(null); return; }

    const where = pks.map((pk) => {
      const val = editingRow.original[pk];
      return val === null ? `"${pk}" IS NULL` : `"${pk}" = '${String(val).replace(/'/g, "''")}'`;
    }).join(" AND ");

    const query = `UPDATE "${selectedTable}" SET ${changed.join(", ")} WHERE ${where}`;
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await wsRequest("vps:db:query", {
        projectId: project.id, instanceId: inst.id, dbUrl, query,
      }, 15000);
      if (res.ok) {
        setEditingRow(null);
        loadTableData(selectedTable);
      } else {
        setEditError(res.error || "Update failed");
      }
    } catch (err: any) {
      setEditError(err.message);
    }
    setEditSaving(false);
  }, [inst, editingRow, selectedTable, primaryKeys, fetchPrimaryKeys, project.id, dbUrl, loadTableData]);

  const loadSavedQueries = useCallback(async () => {
    setSavedQueriesLoading(true);
    try {
      const res = await wsRequest("db:saved-queries:list", { projectId: project.id }, 10000);
      if (res.ok) setSavedQueriesList(res.queries);
    } catch { /* ignore */ }
    setSavedQueriesLoading(false);
  }, [project.id]);

  useEffect(() => {
    if (mode === "saved") loadSavedQueries();
  }, [mode, loadSavedQueries]);

  const handleSaveQuery = useCallback(async () => {
    if (!saveQueryForm || !saveQueryForm.name.trim() || !sqlQuery.trim()) return;
    setSaveQueryLoading(true);
    try {
      const res = await wsRequest("db:saved-queries:save", {
        projectId: project.id,
        name: saveQueryForm.name.trim(),
        description: saveQueryForm.description.trim(),
        query: sqlQuery.trim(),
        queryId: saveQueryForm.queryId,
      }, 10000);
      if (res.ok) setSavedQueriesList(res.queries);
      setSaveQueryForm(null);
    } catch { /* ignore */ }
    setSaveQueryLoading(false);
  }, [project.id, saveQueryForm, sqlQuery]);

  const deleteSavedQuery = useCallback(async (queryId: string) => {
    try {
      const res = await wsRequest("db:saved-queries:delete", { projectId: project.id, queryId }, 10000);
      if (res.ok) setSavedQueriesList(res.queries);
    } catch { /* ignore */ }
  }, [project.id]);

  const loadSavedQuery = useCallback((sq: SavedQuery) => {
    setSqlQuery(sq.query);
    setMode("sql");
  }, []);

  const loadBackups = useCallback(async () => {
    if (!inst) return;
    setBackupsLoading(true);
    setBackupError(null);
    try {
      const res = await wsRequest("vps:db:backup:list", { projectId: project.id, instanceId: inst.id }, 15000);
      if (res.ok) setBackups(res.backups || []);
      else setBackupError(res.error);
    } catch (err: any) {
      setBackupError(err.message);
    }
    setBackupsLoading(false);
  }, [project.id, inst?.id]);

  const createBackup = useCallback(async () => {
    if (!inst || !dbUrl) return;
    setBackupCreating(true);
    setBackupError(null);
    try {
      const res = await wsRequest("vps:db:backup:create", { projectId: project.id, instanceId: inst.id, dbUrl }, 120000);
      if (res.ok) {
        loadBackups();
      } else {
        setBackupError(res.error);
      }
    } catch (err: any) {
      setBackupError(err.message);
    }
    setBackupCreating(false);
  }, [project.id, inst?.id, dbUrl, loadBackups]);

  const downloadBackup = useCallback(async (fileName: string) => {
    if (!inst) return;
    try {
      const res = await wsRequest("vps:db:backup:download", { projectId: project.id, instanceId: inst.id, fileName }, 60000);
      if (res.ok && typeof window !== "undefined") {
        const byteChars = atob(res.data);
        const byteArray = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
        const blob = new Blob([byteArray], { type: "application/gzip" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = res.fileName;
        a.click();
        URL.revokeObjectURL(url);
      } else if (!res.ok) {
        setBackupError(res.error);
      }
    } catch (err: any) {
      setBackupError(err.message);
    }
  }, [project.id, inst?.id]);

  const deleteBackup = useCallback(async (fileName: string) => {
    if (!inst || !confirm(`Delete backup "${fileName}"?`)) return;
    try {
      const res = await wsRequest("vps:db:backup:delete", { projectId: project.id, instanceId: inst.id, fileName }, 15000);
      if (res.ok) setBackups((prev) => prev.filter((b) => b.name !== fileName));
      else setBackupError(res.error);
    } catch (err: any) {
      setBackupError(err.message);
    }
  }, [project.id, inst?.id]);

  useEffect(() => {
    if (mode === "backup" && dbConnected) loadBackups();
  }, [mode, dbConnected, loadBackups]);

  if (!inst) return <div className="p-4 text-overlay0 text-md">No VPS instance available.</div>;

  // Connection form
  if (!dbConnected) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-surface0 bg-mantle shrink-0">
          <Database size={13} className="text-mauve" />
          <span className="text-text text-md">Database Explorer</span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4">
          {loading ? (
            <Loader2 size={18} className="text-mauve animate-spin" />
          ) : (
            <>
              <p className="text-overlay0 text-md">Enter a PostgreSQL connection URL</p>
              <input
                type="text"
                value={dbUrl}
                onChange={(e) => setDbUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && connectDb()}
                placeholder="postgres://user:pass@localhost:5432/dbname"
                className="w-full max-w-md bg-surface0 text-text text-md rounded px-3 py-2 outline-none focus:ring-1 focus:ring-mauve"
              />
              {connectError && <ErrorMessage>{connectError}</ErrorMessage>}
              <button
                onClick={connectDb}
                disabled={connectLoading || !dbUrl.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-mauve text-crust rounded hover:opacity-90 transition-opacity disabled:opacity-50 text-md"
              >
                {connectLoading ? <Loader2 size={13} className="animate-spin" /> : <Database size={13} />}
                Connect
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-surface0 bg-mantle shrink-0">
        <Database size={13} className="text-mauve" />
        <span className="text-text text-md">Database</span>
        {databases.length > 1 && (
          <Select
            value={(() => { try { return new URL(dbUrl).pathname.slice(1); } catch { return ""; } })()}
            onChange={(e) => switchDatabase(e.target.value)}
          >
            {databases.map((db) => (
              <option key={db} value={db}>{db}</option>
            ))}
          </Select>
        )}
        <div className="flex-1" />
        <div className="flex items-center gap-1 bg-surface0 rounded p-0.5">
          {(["tables", "sql", "saved", "backup"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2 py-0.5 rounded transition-colors text-md ${mode === m ? "bg-surface1 text-text" : "text-overlay1 hover:text-text"}`}
            >
              {m === "tables" ? "Tables" : m === "sql" ? "SQL" : m === "saved" ? "Saved" : "Backup"}
            </button>
          ))}
        </div>
        <button onClick={refreshTables} disabled={loading} className="text-overlay1 hover:text-text transition-colors p-1">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        </button>
      </div>

      {error && <ErrorMessage variant="banner">{error}</ErrorMessage>}

      {mode === "tables" ? (
        <div className="flex flex-1 overflow-hidden">
          {/* Table list sidebar */}
          <div className="overflow-y-auto shrink-0 relative" style={{ width: sidebarWidth }}>
            {tables.map((t) => (
              <button
                key={t.name}
                onClick={() => loadTableData(t.name)}
                className={`flex items-center gap-2 w-full min-w-0 px-3 py-1.5 text-left transition-colors text-md ${
                  selectedTable === t.name ? "bg-surface0 text-mauve" : "text-text hover:bg-surface0/50"
                }`}
              >
                <Table2 size={12} className="shrink-0 text-overlay1" />
                <span className="truncate min-w-0">{t.name}</span>
                {t.rowCount !== null && <span className="ml-auto text-overlay0 shrink-0 text-[11px]">{t.rowCount}</span>}
              </button>
            ))}
            {tables.length === 0 && !loading && (
              <div className="text-overlay0 text-center py-4 text-md">No tables</div>
            )}
            {/* Resize handle */}
            <div
              className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-mauve/40 active:bg-mauve/60 transition-colors"
              onPointerDown={(e) => {
                e.preventDefault();
                const startX = e.clientX;
                const startW = sidebarWidth;
                const onMove = (ev: PointerEvent) => {
                  setSidebarWidth(Math.max(100, Math.min(400, startW + ev.clientX - startX)));
                };
                const onUp = () => {
                  window.removeEventListener("pointermove", onMove);
                  window.removeEventListener("pointerup", onUp);
                };
                window.addEventListener("pointermove", onMove);
                window.addEventListener("pointerup", onUp);
              }}
            />
          </div>

          {/* Table data view */}
          <div className="flex-1 overflow-auto">
            {tableLoading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 size={18} className="text-mauve animate-spin" />
              </div>
            ) : tableData ? (
              tableData.error ? (
                <ErrorMessage className="p-3">{tableData.error}</ErrorMessage>
              ) : (
                <div className="overflow-auto h-full">
                  <table className="w-full border-collapse text-md">
                    <thead>
                      <tr className="bg-mantle sticky top-0">
                        {tableData.columns.map((col) => (
                          <th key={col} className="text-left px-2 py-1.5 border-b border-surface0 text-overlay1 font-medium whitespace-nowrap">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tableData.rows.map((row, i) => (
                        <tr
                          key={i}
                          className="border-b border-surface0/50 hover:bg-surface0/30 cursor-pointer"
                          onClick={() => openRowEditor(row, tableData.columns)}
                        >
                          {tableData.columns.map((col) => (
                            <td key={col} className="px-2 py-1 text-text whitespace-nowrap max-w-[200px] truncate">{formatCellValue(row[col])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {tableData.rows.length === 0 && <div className="text-overlay0 text-center py-4 text-md">No rows</div>}
                  {tableData.rows.length > 0 && (
                    <div className="px-2 py-1 text-overlay0 bg-mantle border-t border-surface0 text-[11px]">
                      Showing {tableData.rows.length} rows (limit 100)
                    </div>
                  )}
                </div>
              )
            ) : (
              <div className="flex items-center justify-center h-full text-overlay0 text-md">Select a table</div>
            )}
          </div>
        </div>
      ) : mode === "sql" ? (
        /* SQL mode */
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-surface0 shrink-0">
            <textarea
              value={sqlQuery}
              onChange={(e) => setSqlQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runSql(); } }}
              placeholder="SELECT * FROM ..."
              rows={3}
              className="flex-1 bg-surface0 text-text rounded px-3 py-2 outline-none focus:ring-1 focus:ring-mauve resize-none font-mono text-md"
            />
            <div className="flex flex-col gap-1.5 shrink-0 self-end">
              <button
                onClick={runSql}
                disabled={sqlLoading || !sqlQuery.trim()}
                className="flex items-center gap-1.5 px-3 py-2 bg-mauve text-crust rounded hover:opacity-90 transition-opacity disabled:opacity-50 text-md"
              >
                {sqlLoading ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                Run
              </button>
              <button
                onClick={() => setSaveQueryForm({ name: "", description: "" })}
                disabled={!sqlQuery.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-overlay1 hover:text-text border border-surface1 rounded hover:bg-surface0 transition-colors disabled:opacity-50 text-md"
              >
                <Save size={12} />
                Save
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto">
            {sqlLoading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 size={18} className="text-mauve animate-spin" />
              </div>
            ) : sqlResult ? (
              sqlResult.error ? (
                <ErrorMessage className="p-3 font-mono">{sqlResult.error}</ErrorMessage>
              ) : (
                <div className="overflow-auto h-full">
                  <table className="w-full border-collapse text-md">
                    <thead>
                      <tr className="bg-mantle sticky top-0">
                        {sqlResult.columns.map((col) => (
                          <th key={col} className="text-left px-2 py-1.5 border-b border-surface0 text-overlay1 font-medium whitespace-nowrap">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sqlResult.rows.map((row, i) => (
                        <tr key={i} className="border-b border-surface0/50 hover:bg-surface0/30">
                          {sqlResult.columns.map((col) => (
                            <td key={col} className="px-2 py-1 text-text whitespace-nowrap max-w-[200px] truncate">{formatCellValue(row[col])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="px-2 py-1 text-overlay0 bg-mantle border-t border-surface0 text-[11px]">
                    {sqlResult.rows.length} row{sqlResult.rows.length !== 1 ? "s" : ""} returned
                  </div>
                </div>
              )
            ) : (
              <div className="flex items-center justify-center h-full text-overlay0 text-md">
                Press Cmd+Enter to run query
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* Saved queries tab */}
      {mode === "saved" && (
        <div className="flex-1 overflow-y-auto">
          {savedQueriesLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 size={18} className="text-mauve animate-spin" />
            </div>
          ) : savedQueriesList.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-overlay0 gap-2 text-md">
              <SearchCode size={24} className="text-overlay0" />
              <p>No saved queries yet.</p>
              <p className="text-[12px]">Write a query in the SQL tab and save it.</p>
            </div>
          ) : (
            <div className="flex flex-col">
              {savedQueriesList.map((sq) => (
                <div
                  key={sq.id}
                  className="flex items-start gap-3 px-3 py-2.5 border-b border-surface0 hover:bg-surface0/30 transition-colors cursor-pointer group"
                  onClick={() => loadSavedQuery(sq)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-text font-medium truncate text-md">{sq.name}</span>
                    </div>
                    {sq.description && (
                      <p className="text-overlay0 mt-0.5 line-clamp-2 text-md">{sq.description}</p>
                    )}
                    <pre className="text-overlay1 mt-1 truncate font-mono text-[11px]">{sq.query}</pre>
                    <div className="flex items-center gap-2 mt-1">
                      {sq.userName && (
                        <span className="text-overlay0 flex items-center gap-1 text-[11px]">
                          {sq.userAvatar && <img src={sq.userAvatar} className="w-3 h-3 rounded-full" />}
                          {sq.userName}
                        </span>
                      )}
                      <span className="text-overlay0 text-[11px]">
                        {new Date(sq.updatedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 pt-0.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); setSqlQuery(sq.query); setSaveQueryForm({ name: sq.name, description: sq.description, queryId: sq.id }); setMode("sql"); }}
                      className="text-overlay1 hover:text-text p-1 rounded hover:bg-surface0"
                      title="Edit"
                    >
                      <File size={12} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteSavedQuery(sq.id); }}
                      className="text-overlay1 hover:text-red p-1 rounded hover:bg-surface0"
                      title="Delete"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Backup tab */}
      {mode === "backup" && (
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-surface0 shrink-0">
            <button
              onClick={createBackup}
              disabled={backupCreating}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-mauve text-crust rounded hover:opacity-90 transition-opacity disabled:opacity-50 text-md"
            >
              {backupCreating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              {backupCreating ? "Creating..." : "Create Backup"}
            </button>
            <div className="flex-1" />
            <button onClick={loadBackups} disabled={backupsLoading} className="text-overlay1 hover:text-text transition-colors p-1">
              {backupsLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            </button>
          </div>
          {backupError && <ErrorMessage variant="banner">{backupError}</ErrorMessage>}
          <div className="flex-1 overflow-y-auto">
            {backupsLoading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 size={18} className="text-mauve animate-spin" />
              </div>
            ) : backups.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-overlay0 gap-2 text-md">
                <HardDrive size={24} className="text-overlay0" />
                <p>No backups yet.</p>
                <p className="text-[12px]">Create a backup to save a pg_dump snapshot.</p>
              </div>
            ) : (
              <div className="flex flex-col">
                {backups.map((b) => (
                  <div
                    key={b.name}
                    className="flex items-center gap-3 px-3 py-2.5 border-b border-surface0 hover:bg-surface0/30 transition-colors group"
                  >
                    <HardDrive size={14} className="text-mauve shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-text text-md truncate block">{b.name}</span>
                      <span className="text-overlay0 text-[11px]">{b.size} &middot; {b.date}</span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button
                        onClick={() => downloadBackup(b.name)}
                        className="text-overlay1 hover:text-text p-1.5 rounded hover:bg-surface0"
                        title="Download"
                      >
                        <Download size={13} />
                      </button>
                      <button
                        onClick={() => deleteBackup(b.name)}
                        className="text-overlay1 hover:text-red p-1.5 rounded hover:bg-surface0"
                        title="Delete"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Save query dialog */}
      {saveQueryForm && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setSaveQueryForm(null)} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[340px] bg-mantle border border-surface0 rounded-lg shadow-xl z-50 flex flex-col">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-surface0">
              <span className="text-text font-medium text-md">{saveQueryForm.queryId ? "Update" : "Save"} Query</span>
              <div className="flex-1" />
              <button onClick={() => setSaveQueryForm(null)} className="text-overlay1 hover:text-text"><X size={14} /></button>
            </div>
            <div className="flex flex-col gap-3 px-4 py-3">
              <div className="flex flex-col gap-1">
                <label className="text-overlay1 text-md">Name</label>
                <input
                  type="text"
                  value={saveQueryForm.name}
                  onChange={(e) => setSaveQueryForm((p) => p ? { ...p, name: e.target.value } : null)}
                  placeholder="e.g. Active users"
                  className="bg-surface0 text-text rounded px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-mauve text-md"
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-overlay1 text-md">Description</label>
                <textarea
                  value={saveQueryForm.description}
                  onChange={(e) => setSaveQueryForm((p) => p ? { ...p, description: e.target.value } : null)}
                  placeholder="What does this query do?"
                  rows={2}
                  className="bg-surface0 text-text rounded px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-mauve resize-none text-md"
                />
              </div>
              <pre className="text-overlay1 bg-surface0 rounded px-2.5 py-1.5 font-mono overflow-x-auto whitespace-pre-wrap text-[11px] max-h-[80px]">
                {sqlQuery}
              </pre>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-surface0">
              <button onClick={() => setSaveQueryForm(null)} className="px-3 py-1.5 text-overlay1 hover:text-text text-md">Cancel</button>
              <button
                onClick={handleSaveQuery}
                disabled={saveQueryLoading || !saveQueryForm.name.trim()}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-mauve text-crust rounded hover:opacity-90 transition-opacity disabled:opacity-50 text-md"
              >
                {saveQueryLoading ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                {saveQueryForm.queryId ? "Update" : "Save"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Row edit drawer */}
      {editingRow && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setEditingRow(null)} />
          <div className="fixed top-0 right-0 h-full w-[380px] max-w-[90vw] bg-mantle border-l border-surface0 z-50 flex flex-col shadow-xl">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-surface0 bg-mantle shrink-0">
              <span className="text-text font-medium text-md">Edit Row</span>
              <div className="flex-1" />
              <button onClick={() => setEditingRow(null)} className="text-overlay1 hover:text-text transition-colors">
                <X size={14} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
              {editingRow.columns.map((col) => {
                const val = editingRow.edited[col];
                const isNull = val === null || val === undefined;
                return (
                  <div key={col} className="flex flex-col gap-1">
                    <label className="text-overlay1 font-medium text-md">{col}</label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={isNull ? "" : String(val)}
                        onChange={(e) => setEditingRow((prev) => prev ? {
                          ...prev,
                          edited: { ...prev.edited, [col]: e.target.value || null },
                        } : null)}
                        placeholder="NULL"
                        className={`flex-1 bg-surface0 text-text rounded px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-mauve font-mono text-md ${isNull ? "text-overlay0 italic" : ""}`}
                      />
                      <button
                        onClick={() => setEditingRow((prev) => prev ? {
                          ...prev,
                          edited: { ...prev.edited, [col]: null },
                        } : null)}
                        className={`px-1.5 py-1 rounded text-overlay1 hover:text-text hover:bg-surface0 transition-colors shrink-0 text-[10px] ${isNull ? "text-mauve" : ""}`}
                        title="Set NULL"
                      >
                        NULL
                      </button>
                    </div>
                    {editingRow.edited[col] !== editingRow.original[col] && (
                      <span className="text-yellow text-[11px]">
                        was: {formatCellValue(editingRow.original[col])}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {editError && (
              <ErrorMessage variant="banner" className="border-t border-red/20">{editError}</ErrorMessage>
            )}

            <div className="flex items-center gap-2 px-4 py-3 border-t border-surface0 bg-mantle shrink-0">
              <button
                onClick={() => setEditingRow(null)}
                className="px-3 py-1.5 text-overlay1 hover:text-text transition-colors rounded text-md"
              >
                Cancel
              </button>
              <div className="flex-1" />
              <button
                onClick={saveRow}
                disabled={editSaving}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-mauve text-crust rounded hover:opacity-90 transition-opacity disabled:opacity-50 text-md"
              >
                {editSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                Save
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
