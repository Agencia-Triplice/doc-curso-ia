import { Injectable } from '@nestjs/common';
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { ParConstante } from './payload';

/**
 * Registro do prompt REALMENTE enviado ao AgentiX quando o worker gerou o
 * rascunho — para a tela "ver prompt enviado ao agente" mostrar o que já foi
 * criado, e não uma reconstrução. SQLite próprio em PVC (mesmo padrão do
 * EligibilityStore); único-writer (o serviço roda réplica única, RWO no PVC).
 *
 * Guarda os pares (JSON) e o instante do registro. O worker sobrescreve a cada
 * nova geração; a curadoria apaga o registro quando o órfão sai da fila
 * (aprovado/descartado) — o fingerprint deixa de existir.
 */

const SCHEMA = `CREATE TABLE IF NOT EXISTS prompts_curador (
    fingerprint    TEXT PRIMARY KEY,
    pares_json     TEXT NOT NULL,
    registrado_em  TEXT NOT NULL
);`;

export interface PromptRegistro {
  fingerprint: string;
  pares: ParConstante[];
  registrado_em: string;
}

@Injectable()
export class PromptStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = DELETE');
    this.db.exec(SCHEMA);
  }

  registrar(fingerprint: string, pares: ParConstante[], now: string): void {
    this.db
      .prepare(
        `INSERT INTO prompts_curador (fingerprint, pares_json, registrado_em)
         VALUES (?,?,?)
         ON CONFLICT(fingerprint) DO UPDATE SET
           pares_json = excluded.pares_json,
           registrado_em = excluded.registrado_em`,
      )
      .run(fingerprint, JSON.stringify(pares), now);
  }

  get(fingerprint: string): PromptRegistro | null {
    const row = this.db
      .prepare('SELECT fingerprint, pares_json, registrado_em FROM prompts_curador WHERE fingerprint = ?')
      .get(fingerprint) as { fingerprint: string; pares_json: string; registrado_em: string } | undefined;
    if (!row) return null;
    return { fingerprint: row.fingerprint, pares: JSON.parse(row.pares_json), registrado_em: row.registrado_em };
  }

  delete(fingerprint: string): boolean {
    return this.db.prepare('DELETE FROM prompts_curador WHERE fingerprint = ?').run(fingerprint).changes > 0;
  }

  close(): void {
    this.db.close();
  }
}
