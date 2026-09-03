import { Injectable } from '@nestjs/common';
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

// Vínculo erro→remediação ("elegível a PR") — SQLite próprio do bff-curadoria.
// Único estado local do serviço; mirror fiel de ms7/app/services/eligibility_store.py.

const SCHEMA = `CREATE TABLE IF NOT EXISTS elegibilidade (
    fingerprint       TEXT PRIMARY KEY,
    remediacao_id     TEXT NOT NULL,
    remediacao_versao TEXT NOT NULL,
    assinatura        TEXT NOT NULL,
    servico           TEXT,
    autor             TEXT,
    criado_em         TEXT NOT NULL,
    atualizado_em     TEXT NOT NULL
);`;

const COLUNAS = 'fingerprint, remediacao_id, remediacao_versao, assinatura, servico, autor, criado_em, atualizado_em';

export interface ElegibilidadeRow {
  fingerprint: string;
  remediacao_id: string;
  remediacao_versao: string;
  assinatura: string;
  servico: string | null;
  autor: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface ElegibilidadeInput {
  fingerprint: string;
  remediacao_id: string;
  remediacao_versao: string;
  assinatura: string;
  servico?: string | null;
  autor?: string | null;
}

@Injectable()
export class EligibilityStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = DELETE');
    this.db.exec(SCHEMA);
  }

  upsert(data: ElegibilidadeInput, now: string): ElegibilidadeRow {
    this.db
      .prepare(
        `INSERT INTO elegibilidade (${COLUNAS})
         VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(fingerprint) DO UPDATE SET
           remediacao_id = excluded.remediacao_id,
           remediacao_versao = excluded.remediacao_versao,
           assinatura = excluded.assinatura,
           servico = excluded.servico,
           autor = excluded.autor,
           atualizado_em = excluded.atualizado_em`,
      )
      .run(
        data.fingerprint,
        data.remediacao_id,
        data.remediacao_versao,
        data.assinatura,
        data.servico ?? null,
        data.autor ?? null,
        now,
        now,
      );
    return this.get(data.fingerprint) as ElegibilidadeRow;
  }

  get(fingerprint: string): ElegibilidadeRow | null {
    const row = this.db.prepare(`SELECT ${COLUNAS} FROM elegibilidade WHERE fingerprint = ?`).get(fingerprint) as
      | ElegibilidadeRow
      | undefined;
    return row ?? null;
  }

  delete(fingerprint: string): boolean {
    const result = this.db.prepare('DELETE FROM elegibilidade WHERE fingerprint = ?').run(fingerprint);
    return result.changes > 0;
  }

  list(limit: number): ElegibilidadeRow[] {
    return this.db
      .prepare(`SELECT ${COLUNAS} FROM elegibilidade ORDER BY atualizado_em DESC, fingerprint LIMIT ?`)
      .all(limit) as ElegibilidadeRow[];
  }

  /** Todos os vínculos indexados por fingerprint — uma leitura só para anotar
   * listas inteiras de solução/documento sem N consultas. */
  mapa(): Map<string, ElegibilidadeRow> {
    const linhas = this.db.prepare(`SELECT ${COLUNAS} FROM elegibilidade`).all() as ElegibilidadeRow[];
    return new Map(linhas.map((linha) => [linha.fingerprint, linha]));
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM elegibilidade').get() as { c: number };
    return row.c;
  }

  ping(): void {
    this.db.prepare('SELECT 1').run();
  }

  close(): void {
    this.db.close();
  }
}
