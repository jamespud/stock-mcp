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
  const [rows] = await getPool().execute(sql, params);
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
