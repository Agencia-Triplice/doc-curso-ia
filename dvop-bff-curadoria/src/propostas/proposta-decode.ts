/**
 * Helpers puros de decode da proposta AgentiX + guardrail (teto de escopo).
 *
 * `decodificarProposta` espelha `decodificarRascunho` de `curador.worker.ts`
 * (raw JSON → cerca markdown → base64→JSON), reusando os mesmos primitivos
 * `semCercaMarkdown`/`b64OuNull` — só muda o shape validado (proposta de PR,
 * não rascunho de solução). `contarLinhasDiff` replica byte-a-byte o
 * `linhasDiff` de `ExecutorRemediacao.java` (MS8): `List.removeAll` do Java
 * não é diferença de multiset — remove TODAS as ocorrências de um valor de
 * `a` se esse valor aparece (em qualquer quantidade) em `b`. A implementação
 * abaixo usa `Set` para reproduzir esse comportamento membership-based, não
 * um diff por contagem.
 */

import { semCercaMarkdown, b64OuNull } from '../curador/curador.worker';

/** Operação do arquivo na proposta. `editar` (default) cobre editar E criar —
 * o executor cria quando o arquivo ainda não existe (sha nulo → PUT contents
 * cria). `excluir` remove o arquivo (conteúdo novo é ignorado). */
export type OperacaoArquivo = 'editar' | 'excluir';

export interface ArquivoProposta {
  path: string;
  conteudo_novo: string;
  operacao: OperacaoArquivo;
}

export interface PropostaDecodificada {
  aplica: boolean;
  resumo: string;
  titulo: string;
  corpo: string;
  arquivos: ArquivoProposta[];
}

export interface ArquivoComAtual {
  path: string;
  conteudo_atual: string;
  conteudo_novo: string;
  operacao: OperacaoArquivo;
}

export interface TetoResultado {
  ok: boolean;
  nArquivos: number;
  nLinhas: number;
}

const MANIFESTOS_COMUNS = ['package.json', 'pyproject.toml', 'pom.xml'];

// caminho de arquivo plausível: sequência sem espaço com extensão (ex.:
// src/x.ts, pom.xml, requirements.txt) — heurística, não parser de path.
const PATH_RE = /[\w][\w./-]*\.[A-Za-z0-9]+/g;

// apelidos comuns citados sem extensão numa instrução em linguagem natural
// ("adicionar data no readme", "mexe no pom") → caminho canônico no repo. É
// uma heurística: só conhece estes nomes; qualquer outro arquivo precisa ser
// citado com a extensão no texto (aí o PATH_RE o pega).
const APELIDOS_ARQUIVO: Record<string, string> = {
  readme: 'README.md',
  pom: 'pom.xml',
  changelog: 'CHANGELOG.md',
  dockerfile: 'Dockerfile',
  makefile: 'Makefile',
  license: 'LICENSE',
  gitignore: '.gitignore',
};

/** Item de arquivo bruto do agente é válido se tem `path` string não-vazio e,
 * quando NÃO é exclusão, um `conteudo_novo` string. Para `operacao:"excluir"` o
 * `conteudo_novo` é dispensável (o arquivo será removido). `operacao`, quando
 * presente, só pode ser `editar` ou `excluir`. */
function arquivoValido(a: unknown): boolean {
  if (typeof a !== 'object' || a === null) {
    return false;
  }
  const r = a as Record<string, unknown>;
  if (typeof r.path !== 'string' || !r.path.trim()) {
    return false;
  }
  if (r.operacao !== undefined && r.operacao !== 'editar' && r.operacao !== 'excluir') {
    return false;
  }
  if (r.operacao !== 'excluir' && typeof r.conteudo_novo !== 'string') {
    return false;
  }
  return true;
}

/** Normaliza um item bruto (já validado) para `ArquivoProposta`: `operacao`
 * default `editar`, `conteudo_novo` default `''` (exclusão não carrega conteúdo). */
function normalizarArquivo(a: unknown): ArquivoProposta {
  const r = a as Record<string, unknown>;
  const operacao: OperacaoArquivo = r.operacao === 'excluir' ? 'excluir' : 'editar';
  return {
    path: r.path as string,
    conteudo_novo: typeof r.conteudo_novo === 'string' ? r.conteudo_novo : '',
    operacao,
  };
}

/** JSON direto, JSON em cerca markdown, ou base64→JSON; só aceita dict com
 * `titulo`/`corpo` não-vazios e `arquivos` array não-vazio de
 * `{path, conteudo_novo}` (zero arquivos não é proposta válida — MS8 exige
 * `min=1`) — senão null. */
export function decodificarProposta(bruto: unknown): PropostaDecodificada | null {
  if (typeof bruto !== 'string' || !bruto.trim()) {
    return null;
  }
  const candidatos: string[] = [bruto];
  const semCerca = semCercaMarkdown(bruto);
  if (semCerca !== null) {
    candidatos.push(semCerca);
  }
  const decodificado = b64OuNull(bruto.trim());
  if (decodificado !== null) {
    candidatos.push(decodificado);
  }
  for (const texto of candidatos) {
    let dados: unknown;
    try {
      dados = JSON.parse(texto);
    } catch {
      continue;
    }
    if (typeof dados !== 'object' || dados === null || Array.isArray(dados)) {
      continue;
    }
    const d = dados as Record<string, unknown>;

    // Veredito de inaplicabilidade: resposta válida SEM arquivos a mudar. O ramo
    // "propor mudança" abaixo exige titulo/corpo/arquivos>=1; o "não se aplica"
    // não — só sinaliza aplica:false + motivo (resumo). Sem isto, um aplica:false
    // com arquivos:[] cairia como null e viraria erro_geracao em vez de nao_aplicavel.
    if (d.aplica === false) {
      return {
        aplica: false,
        resumo: String(d.resumo ?? ''),
        titulo: String(d.titulo ?? '').trim(),
        corpo: String(d.corpo ?? '').trim(),
        arquivos: [],
      };
    }

    const titulo = String(d.titulo ?? '').trim();
    const corpo = String(d.corpo ?? '').trim();
    if (
      !titulo ||
      !corpo ||
      !Array.isArray(d.arquivos) ||
      d.arquivos.length < 1 ||
      !d.arquivos.every(arquivoValido)
    ) {
      continue;
    }
    return {
      aplica: d.aplica === undefined ? true : d.aplica === true,
      resumo: String(d.resumo ?? ''),
      titulo,
      corpo,
      arquivos: d.arquivos.map(normalizarArquivo),
    };
  }
  return null;
}

/** Linhas adicionadas + removidas — mesmo algoritmo (e a mesma semântica de
 * `List.removeAll`) de `linhasDiff` no MS8 `ExecutorRemediacao.java`. */
export function contarLinhasDiff(atual: string, novo: string): number {
  const a = atual.split('\n');
  const b = novo.split('\n');
  const setA = new Set(a);
  const setB = new Set(b);
  const soA = a.filter((linha) => !setB.has(linha));
  const soB = b.filter((linha) => !setA.has(linha));
  return soA.length + soB.length;
}

/** Guardrail de escopo: soma o diff de todos os arquivos e checa contra os
 * tetos de arquivos/linhas — espelha o bloqueio `escopo_excedido` do MS8. */
export function dentroDoTeto(
  arquivos: ArquivoComAtual[],
  maxArquivos: number,
  maxLinhas: number,
): TetoResultado {
  const nArquivos = arquivos.length;
  const nLinhas = arquivos.reduce(
    (soma, a) => soma + contarLinhasDiff(a.conteudo_atual, a.conteudo_novo),
    0,
  );
  return { ok: nArquivos <= maxArquivos && nLinhas <= maxLinhas, nArquivos, nLinhas };
}

/** Arquivos citados numa instrução em linguagem natural: caminhos literais com
 * extensão (`config.yaml`, `src/App.java`) + apelidos comuns sem extensão
 * (`readme`→`README.md`, `pom`→`pom.xml`). Heurística — só conhece os apelidos
 * de `APELIDOS_ARQUIVO`; nomes fora disso precisam vir com a extensão no texto.
 * O apelido casa só como palavra inteira (não dentro de outra). */
export function referenciasDeArquivo(instrucao?: string): string[] {
  if (!instrucao || !instrucao.trim()) {
    return [];
  }
  const literais = instrucao.match(PATH_RE) ?? [];
  const apelidos = Object.entries(APELIDOS_ARQUIVO)
    .filter(([chave]) => new RegExp(`\\b${chave}\\b`, 'i').test(instrucao))
    .map(([, caminho]) => caminho);
  return [...new Set([...literais, ...apelidos])];
}

/** Paths candidatos para a proposta. Sempre une os arquivos citados na
 * `instrucao` (linguagem natural) — é o que faz o agente tocar TODOS os
 * arquivos do prompt, não só os manifestos. Base do union: os paths manuais
 * (escopo cadastrado), se houver; senão os paths plausíveis da assinatura +
 * manifestos comuns. Dedup. Lista vazia é resultado válido — quem decide o que
 * fazer com ela é o worker; o teto de escopo (arquivos/linhas) é a barreira
 * real, não esta lista. */
export function selecionarCandidatos(
  assinatura: string,
  instrucao?: string,
  pathsManuais?: string[],
): string[] {
  const daInstrucao = referenciasDeArquivo(instrucao);
  if (pathsManuais && pathsManuais.length > 0) {
    return [...new Set([...pathsManuais, ...daInstrucao])];
  }
  const achados = assinatura.match(PATH_RE) ?? [];
  return [...new Set([...achados, ...MANIFESTOS_COMUNS, ...daInstrucao])];
}
