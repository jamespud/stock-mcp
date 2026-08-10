import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import mysql from "mysql2/promise";
import { config } from "./config.js";

let pool: mysql.Pool | null = null;

export function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      uri: config.databaseUrl,
      waitForConnections: true,
      connectionLimit: 8,
      namedPlaceholders: true,
      multipleStatements: true,
      timezone: "Z",
    });
  }
  return pool;
}

export async function query<T = any>(sql: string, params: any[] = []): Promise<T> {
  // Use the text protocol (query) instead of prepared statements (execute):
  // mysql2 sends JS numbers as DOUBLE in the binary protocol, which MySQL
  // 8.0.22+ rejects for LIMIT/OFFSET parameters ("Incorrect arguments to
  // mysqld_stmt_execute"). The text protocol formats values inline and avoids
  // this entire class of driver-level errors.
  const [rows] = await getPool().query(sql, params);
  return rows as T;
}

export async function initSchema(): Promise<void> {
  const schemaPath = resolve(process.cwd(), "db", "schema.sql");
  const sql = readFileSync(schemaPath, "utf8");
  const conn = await getPool().getConnection();
  try {
    await conn.query(sql);
    console.log("schema applied");
  } finally {
    conn.release();
  }
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** Batch upsert helper: rows as [sql, params][] executed sequentially. */
export async function runBatch(statements: Array<[string, any[]]>): Promise<void> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    for (const [sql, params] of statements) {
      await conn.execute(sql, params);
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
