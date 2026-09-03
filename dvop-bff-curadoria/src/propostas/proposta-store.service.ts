import { Injectable } from '@nestjs/common';
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

/**
 * Proposta de PR gerada pelo agente para um caso da curadoria — SQLite
 * próprio do bff-curadoria (mesmo padrão do EligibilityStore/PromptStore),
 * único-writer (o serviço roda réplica única, RWO no PVC).
 *
 * Uma linha por fingerprint: nasce em `gerando` (criarGerando), evolui via
 * `atualizar` (set dinâmico, lista branca de colunas) até `pronta` |
 * `erro_geracao` → `pr_aberto` | `pr_rejeitado`. Timestamps sempre recebidos
 * por parâmetro — nunca gerados aqui.
 */

const SCHEMA = `CREATE TABLE IF NOT EXISTS proposta_pr (
    fingerprint     TEXT PRIMARY KEY,
    servico         TEXT,
    estado          TEXT NOT NULL,
    resumo          TEXT,
    titulo_pr       TEXT,
    corpo_pr        TEXT,
    arquivos_json   TEXT,
    n_arquivos      INTEGER,
    n_linhas_diff   INTEGER,
    session_id      TEXT,
    instrucao       TEXT,
    paths_json      TEXT,
    solucao         TEXT,
    assinatura      TEXT,
    motivo          TEXT,
    gerado_em       TEXT,
    aprovado_por    TEXT,
    aprovado_em     TEXT,
    pr_numero       INTEGER,
    pr_url          TEXT,
    atualizado_em   TEXT NOT NULL
);`;

const COLUNAS = [
  'fingerprint',
  'servico',
  'estado',
  'resumo',
  'titulo_pr',
  'corpo_pr',
  'arquivos_json',
  'n_arquivos',
  'n_linhas_diff',
  'session_id',
  'instrucao',
  'paths_json',
  'solucao',
  'assinatura',
  'motivo',
  'gerado_em',
  'aprovado_por',
  'aprovado_em',
  'pr_numero',
  'pr_url',
  'atualizado_em',
] as const;

const COLUNAS_SELECT = COLUNAS.join(', ');

// Lista branca das colunas que `atualizar` pode setar dinamicamente — nunca
// interpolar chaves de `patch` direto na query (proteção contra injeção de
// identificador SQL). `fingerprint` fica de fora: é a chave, não um patch.
const COLUNAS_PATCHAVEIS = new Set<string>(COLUNAS.filter((c) => c !== 'fingerprint' && c !== 'atualizado_em'));

export interface PropostaRow {
  fingerprint: string;
  servico: string | null;
  estado: string;
  resumo: string | null;
  titulo_pr: string | null;
  corpo_pr: string | null;
  arquivos_json: string | null;
  n_arquivos: number | null;
  n_linhas_diff: number | null;
  session_id: string | null;
  instrucao: string | null;
  paths_json: string | null;
  solucao: string | null;
  assinatura: string | null;
  motivo: string | null;
  gerado_em: string | null;
  aprovado_por: string | null;
  aprovado_em: string | null;
  pr_numero: number | null;
  pr_url: string | null;
  atualizado_em: string;
}

export interface PropostaInput {
  fingerprint: string;
  servico: string | null;
  assinatura: string | null;
  solucao: string | null;
  instrucao: string | null;
  paths: string[];
}

@Injectable()
export class PropostaStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = DELETE');
    this.db.exec(SCHEMA);
  }

  criarGerando(input: PropostaInput, now: string): PropostaRow {
    this.db
      .prepare(
        `INSERT INTO proposta_pr (fingerprint, servico, estado, assinatura, solucao, instrucao, paths_json, atualizado_em)
         VALUES (?,?,'gerando',?,?,?,?,?)
         ON CONFLICT(fingerprint) DO UPDATE SET
           servico = excluded.servico,
           estado = 'gerando',
           resumo = NULL,
           titulo_pr = NULL,
           corpo_pr = NULL,
           arquivos_json = NULL,
           n_arquivos = NULL,
           n_linhas_diff = NULL,
           session_id = NULL,
           instrucao = excluded.instrucao,
           paths_json = excluded.paths_json,
           solucao = excluded.solucao,
           assinatura = excluded.assinatura,
           motivo = NULL,
           gerado_em = NULL,
           aprovado_por = NULL,
           aprovado_em = NULL,
           pr_numero = NULL,
           pr_url = NULL,
           atualizado_em = excluded.atualizado_em`,
      )
      .run(input.fingerprint, input.servico, input.assinatura, input.solucao, input.instrucao, JSON.stringify(input.paths), now);
    return this.get(input.fingerprint) as PropostaRow;
  }

  get(fingerprint: string): PropostaRow | null {
    const row = this.db.prepare(`SELECT ${COLUNAS_SELECT} FROM proposta_pr WHERE fingerprint = ?`).get(fingerprint) as
      | PropostaRow
      | undefined;
    return row ?? null;
  }

  atualizar(fingerprint: string, patch: Partial<PropostaRow>, now: string): PropostaRow {
    const chaves = Object.keys(patch).filter((chave) => COLUNAS_PATCHAVEIS.has(chave));
    const sets = chaves.map((chave) => `${chave} = ?`);
    sets.push('atualizado_em = ?');
    const valores = chaves.map((chave) => (patch as Record<string, unknown>)[chave]);
    valores.push(now);
    valores.push(fingerprint);

    const result = this.db.prepare(`UPDATE proposta_pr SET ${sets.join(', ')} WHERE fingerprint = ?`).run(...valores);
    if (result.changes === 0) {
      throw new Error(`PropostaStore.atualizar: fingerprint não encontrado: ${fingerprint}`);
    }
    return this.get(fingerprint) as PropostaRow;
  }

  /**
   * Transição atômica de estado (compare-and-swap): move a proposta de `de`
   * para `para` SOMENTE se ela ainda estiver em `de`. Como better-sqlite3 é
   * síncrono, o UPDATE condicional é atômico — dois `aprovar` concorrentes para
   * o mesmo fingerprint disputam aqui e só um vê `changes === 1`. Devolve `true`
   * para o vencedor, `false` se a proposta já não estava em `de`.
   */
  transicionarEstado(fingerprint: string, de: string, para: string, now: string): boolean {
    const result = this.db
      .prepare('UPDATE proposta_pr SET estado = ?, atualizado_em = ? WHERE fingerprint = ? AND estado = ?')
      .run(para, now, fingerprint, de);
    return result.changes === 1;
  }

  listByEstado(estado: string, limit: number): PropostaRow[] {
    return this.db
      .prepare(`SELECT ${COLUNAS_SELECT} FROM proposta_pr WHERE estado = ? ORDER BY atualizado_em DESC, fingerprint LIMIT ?`)
      .all(estado, limit) as PropostaRow[];
  }

  delete(fingerprint: string): boolean {
    return this.db.prepare('DELETE FROM proposta_pr WHERE fingerprint = ?').run(fingerprint).changes > 0;
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM proposta_pr').get() as { c: number };
    return row.c;
  }

  ping(): void {
    this.db.prepare('SELECT 1').run();
  }

  close(): void {
    this.db.close();
  }
}
