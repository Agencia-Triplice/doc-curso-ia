import { Injectable } from '@nestjs/common';
import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

const SCHEMA = `CREATE TABLE IF NOT EXISTS srv_requests (
  hash TEXT PRIMARY KEY, method TEXT NOT NULL, url TEXT NOT NULL, params TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL);`;

function normParams(params: Record<string, unknown> | null | undefined): Record<string, string> {
  if (!params) return {};
  const out: Record<string, string> = {};
  for (const k of Object.keys(params).sort()) out[k] = String(params[k]);
  return out;
}
// json.dumps(sort_keys, separators=(",",":"), ensure_ascii=False) — reproduzido
function canonical(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stringifyValue((obj as any)[k])).join(',') + '}';
}
function stringifyValue(v: unknown): string {
  if (v && typeof v === 'object' && !Array.isArray(v)) return canonical(v as Record<string, unknown>);
  return JSON.stringify(v);
}
export function requestHash(method: string, url: string, params: Record<string, unknown> | null): string {
  const canonicalStr = canonical({ method: method.toUpperCase(), url, params: normParams(params) });
  return createHash('sha256').update(canonicalStr, 'utf-8').digest('hex');
}

export interface AuditRow { hash: string; method: string; url: string; params: Record<string, string>; count: number; first_seen: string; last_seen: string; }

@Injectable()
export class RequestAuditService {
  private readonly db: Database.Database;
  constructor(dbPath: string, private readonly maxRows: number) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.exec(SCHEMA);
  }
  record(method: string, url: string, params: Record<string, unknown> | null): string {
    const digest = requestHash(method, url, params);
    const now = new Date().toISOString();
    const paramsJson = canonical(normParams(params));
    this.db.prepare(`INSERT INTO srv_requests (hash,method,url,params,count,first_seen,last_seen)
      VALUES (?,?,?,?,1,?,?) ON CONFLICT(hash) DO UPDATE SET count=count+1, last_seen=excluded.last_seen`)
      .run(digest, method.toUpperCase(), url, paramsJson, now, now);
    this.db.prepare(`DELETE FROM srv_requests WHERE hash IN (
      SELECT hash FROM srv_requests ORDER BY last_seen DESC, hash LIMIT -1 OFFSET ?)`).run(this.maxRows);
    return digest;
  }
  get(digest: string): AuditRow | null {
    const row = this.db.prepare('SELECT * FROM srv_requests WHERE hash=?').get(digest) as any;
    return row ? this.toRow(row) : null;
  }
  listEntries(limit: number): AuditRow[] {
    const rows = this.db.prepare('SELECT * FROM srv_requests ORDER BY count DESC, last_seen DESC LIMIT ?').all(limit) as any[];
    return rows.map((r) => this.toRow(r));
  }
  summary(): { total_requests: number; unique_requests: number } {
    const r = this.db.prepare('SELECT COUNT(*) AS u, COALESCE(SUM(count),0) AS t FROM srv_requests').get() as any;
    return { total_requests: r.t, unique_requests: r.u };
  }
  private toRow(r: any): AuditRow { return { ...r, params: JSON.parse(r.params) }; }
}
