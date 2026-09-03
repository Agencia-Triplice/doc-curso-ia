/**
 * Match determinístico erro↔remediação. Puro (sem I/O), reusado pelo endpoint
 * de remediações aplicáveis e pela blindagem do upsert de elegibilidade.
 *
 * Regra (AND entre as chaves presentes):
 *  - SEM assinatura_regex → não casa (fail-closed).
 *  - assinatura_regex testada contra (erro.assinatura ?? "").
 *  - arquetipos, se não-vazio, deve incluir erro.template.
 *  - servicos,   se não-vazio, deve incluir erro.servico.
 * Regex inválida (defensivo, apesar do fail-fast do MS8) → não casa, sem lançar.
 *
 * RESTRIÇÃO DE AUTORIA (assinatura_regex): o valor é compilado no MS8 no dialeto
 * Java, mas o match roda aqui com `new RegExp` (JS). Só um `(?i)` INICIAL é
 * traduzido para a flag 'i'. Qualquer construto Java-only (`(?s)`/`(?m)` inicial,
 * `(?i:…)`, possessivo `a++`, grupo atômico `(?>…)`, `\A`/`\z`) que o `new RegExp`
 * não aceite cai no catch → NÃO casa, POR DESIGN (fail-closed, sem lançar). Autores
 * de catálogo devem escrever regex compatível com JS. Ver testes em
 * remediacao-match.spec.ts (piloto e tradeoff Java-only).
 */
export interface ErroParaMatch {
  assinatura?: string | null;
  servico?: string | null;
  template?: string | null;
}

export interface AplicabilidadeRem {
  assinatura_regex?: string | null;
  arquetipos?: string[] | null;
  servicos?: string[] | null;
}

/**
 * Compila o assinatura_regex do MS8 (dialeto Java) para JS. Só um `(?i)` INICIAL
 * é traduzido para a flag 'i'; o resto segue como está. Lança (como `new RegExp`)
 * se o padrão não for aceito pelo motor JS — é este o gate do dialeto Java×JS.
 */
export function compilarAssinaturaJs(regex: string): RegExp {
  let fonte = regex;
  let flags = '';
  const pref = fonte.match(/^\(\?i\)/);
  if (pref) {
    fonte = fonte.slice(pref[0].length);
    flags = 'i';
  }
  return new RegExp(fonte, flags);
}

/** true se o assinatura_regex compila no motor JS (o que o match de fato roda). */
export function assinaturaCompativelJs(regex: string): boolean {
  try {
    compilarAssinaturaJs(regex);
    return true;
  } catch {
    return false;
  }
}

export function casaRemediacao(
  erro: ErroParaMatch,
  rem: { aplicabilidade?: AplicabilidadeRem | null },
): boolean {
  const aplic = rem.aplicabilidade;
  if (!aplic || !aplic.assinatura_regex) return false;
  // Fail-closed: sem assinatura no erro, não casa mesmo que o regex aceite
  // string vazia (ex.: '.*') — nunca inferir match por ausência de dado.
  if (erro.assinatura == null) return false;

  // O regex vem do YAML do MS8 em sintaxe Java: um `(?i)` inicial é flag
  // inline lá, mas `new RegExp('(?i)...')` LANÇA em JS. compilarAssinaturaJs
  // traduz um `(?i)` no começo para a flag 'i' do JS; qualquer outra sintaxe
  // segue como está.
  let re: RegExp;
  try {
    re = compilarAssinaturaJs(aplic.assinatura_regex);
  } catch {
    return false;
  }
  if (!re.test(erro.assinatura ?? '')) return false;

  const arquetipos = aplic.arquetipos ?? [];
  if (arquetipos.length && !arquetipos.includes(erro.template ?? '')) return false;

  const servicos = aplic.servicos ?? [];
  if (servicos.length && !servicos.includes(erro.servico ?? '')) return false;

  return true;
}

export function remediacoesQueCasam<T extends { aplicabilidade?: AplicabilidadeRem | null }>(
  erro: ErroParaMatch,
  catalogo: T[],
): T[] {
  return catalogo.filter((rem) => casaRemediacao(erro, rem));
}
