import { getRawClient } from "./db/index.js";

// --- Validation helpers ---

let validTables: Set<string> | null = null;
let validColumnsCache: Map<string, Set<string>> = new Map();

async function getValidTables(): Promise<Set<string>> {
  if (validTables) return validTables;
  const sql = getRawClient();
  const rows = await sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
  `;
  validTables = new Set(rows.map((r: any) => r.tablename));
  return validTables;
}

async function getValidColumns(tableName: string): Promise<Set<string>> {
  if (validColumnsCache.has(tableName)) return validColumnsCache.get(tableName)!;
  const sql = getRawClient();
  const rows = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${tableName}
  `;
  const cols = new Set(rows.map((r: any) => r.column_name));
  validColumnsCache.set(tableName, cols);
  return cols;
}

function assertValidIdentifier(name: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid identifier: ${name}`);
  }
}

async function assertTableExists(tableName: string): Promise<void> {
  assertValidIdentifier(tableName);
  const tables = await getValidTables();
  if (!tables.has(tableName)) {
    throw new Error(`Table not found: ${tableName}`);
  }
}

async function assertColumnsExist(tableName: string, columns: string[]): Promise<void> {
  const valid = await getValidColumns(tableName);
  for (const col of columns) {
    assertValidIdentifier(col);
    if (!valid.has(col)) {
      throw new Error(`Column '${col}' not found in table '${tableName}'`);
    }
  }
}

// Invalidate caches when schema might change (after DDL in raw SQL)
function invalidateCaches(): void {
  validTables = null;
  validColumnsCache.clear();
}

// --- Public API ---

export interface TableInfo {
  name: string;
  rowCount: number;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  isNullable: boolean;
  columnDefault: string | null;
  ordinalPosition: number;
}

export interface PaginatedRows {
  rows: Record<string, any>[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export async function listTables(): Promise<TableInfo[]> {
  invalidateCaches();
  const sql = getRawClient();
  const tableNames = await sql`
    SELECT tablename AS name
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `;
  const results: TableInfo[] = [];
  for (const { name } of tableNames) {
    const [{ count }] = await sql.unsafe(`SELECT COUNT(*)::int AS count FROM "${name}"`);
    results.push({ name, rowCount: count });
  }
  return results;
}

export async function getTableColumns(tableName: string): Promise<ColumnInfo[]> {
  await assertTableExists(tableName);
  const sql = getRawClient();
  const rows = await sql`
    SELECT
      column_name,
      data_type,
      is_nullable,
      column_default,
      ordinal_position
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${tableName}
    ORDER BY ordinal_position
  `;
  return rows.map((r: any) => ({
    name: r.column_name,
    dataType: r.data_type,
    isNullable: r.is_nullable === "YES",
    columnDefault: r.column_default,
    ordinalPosition: r.ordinal_position,
  }));
}

export async function getPrimaryKey(tableName: string): Promise<string | null> {
  await assertTableExists(tableName);
  const sql = getRawClient();
  const rows = await sql`
    SELECT a.attname
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    JOIN pg_class c ON c.oid = i.indrelid
    WHERE c.relname = ${tableName} AND i.indisprimary
    LIMIT 1
  `;
  return rows.length > 0 ? rows[0].attname : null;
}

export async function getTableRows(
  tableName: string,
  opts: { page?: number; pageSize?: number; orderBy?: string; orderDir?: string } = {}
): Promise<PaginatedRows> {
  await assertTableExists(tableName);
  const sql = getRawClient();
  const page = opts.page ?? 1;
  const pageSize = Math.min(opts.pageSize ?? 50, 500);
  const offset = (page - 1) * pageSize;

  const orderBy = opts.orderBy || "ctid";
  const orderDir = opts.orderDir === "desc" ? "DESC" : "ASC";

  if (orderBy !== "ctid") {
    await assertColumnsExist(tableName, [orderBy]);
  }

  const countResult = await sql.unsafe(`SELECT COUNT(*)::int AS total FROM "${tableName}"`);
  const totalCount = countResult[0].total;

  const orderClause = orderBy === "ctid" ? "ctid" : `"${orderBy}"`;
  const rows = await sql.unsafe(
    `SELECT * FROM "${tableName}" ORDER BY ${orderClause} ${orderDir} LIMIT $1 OFFSET $2`,
    [pageSize, offset]
  );

  return { rows: Array.from(rows), totalCount, page, pageSize };
}

export async function getRow(
  tableName: string,
  pkCol: string,
  pkVal: string
): Promise<Record<string, any> | null> {
  await assertTableExists(tableName);
  await assertColumnsExist(tableName, [pkCol]);
  const sql = getRawClient();
  const rows = await sql.unsafe(
    `SELECT * FROM "${tableName}" WHERE "${pkCol}" = $1 LIMIT 1`,
    [pkVal]
  );
  return rows.length > 0 ? rows[0] : null;
}

export async function insertRow(
  tableName: string,
  data: Record<string, any>
): Promise<Record<string, any>> {
  await assertTableExists(tableName);
  const columns = Object.keys(data);
  if (columns.length === 0) throw new Error("No data to insert");
  await assertColumnsExist(tableName, columns);

  const sql = getRawClient();
  const colList = columns.map((c) => `"${c}"`).join(", ");
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
  const values = columns.map((c) => data[c]);

  const rows = await sql.unsafe(
    `INSERT INTO "${tableName}" (${colList}) VALUES (${placeholders}) RETURNING *`,
    values
  );
  return rows[0];
}

export async function updateRow(
  tableName: string,
  pkCol: string,
  pkVal: string,
  data: Record<string, any>
): Promise<Record<string, any>> {
  await assertTableExists(tableName);
  const columns = Object.keys(data);
  if (columns.length === 0) throw new Error("No data to update");
  await assertColumnsExist(tableName, [pkCol, ...columns]);

  const sql = getRawClient();
  const setClauses = columns.map((c, i) => `"${c}" = $${i + 1}`).join(", ");
  const values = [...columns.map((c) => data[c]), pkVal];

  const rows = await sql.unsafe(
    `UPDATE "${tableName}" SET ${setClauses} WHERE "${pkCol}" = $${columns.length + 1} RETURNING *`,
    values
  );
  if (rows.length === 0) throw new Error("Row not found");
  return rows[0];
}

export async function deleteRow(
  tableName: string,
  pkCol: string,
  pkVal: string
): Promise<Record<string, any>> {
  await assertTableExists(tableName);
  await assertColumnsExist(tableName, [pkCol]);

  const sql = getRawClient();
  const rows = await sql.unsafe(
    `DELETE FROM "${tableName}" WHERE "${pkCol}" = $1 RETURNING *`,
    [pkVal]
  );
  if (rows.length === 0) throw new Error("Row not found");
  return rows[0];
}

export async function executeRawSql(
  query: string
): Promise<{ rows: Record<string, any>[]; columns: string[]; rowCount: number }> {
  invalidateCaches();
  const sql = getRawClient();
  try {
    const result = await sql.unsafe(query);
    const rows = Array.from(result);
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { rows, columns, rowCount: result.count ?? rows.length };
  } catch (err: any) {
    throw new Error(err.message);
  }
}
