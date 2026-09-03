import { ElegibilidadeRow } from './eligibility-store.service';

/** Chips que Cache e Base exibem: se o erro está marcado como elegível a PR e
 * qual modelo de PR está atrelado. */
export interface ChipElegibilidade {
  elegivel: boolean;
  remediacao_id: string | null;
  remediacao_versao: string | null;
}

const SEM_VINCULO: ChipElegibilidade = { elegivel: false, remediacao_id: null, remediacao_versao: null };

/**
 * Anota cada item com o vínculo de elegibilidade. Puro: o mapa vem pronto de quem
 * chama (uma leitura só do store, não N). `chaveDe` extrai o fingerprint — direto na
 * solução do cache, `origem_fingerprint` no documento da base; chave nula (documento
 * anterior à coluna de origem) devolve "não elegível".
 */
export function anotarElegibilidade<T>(
  itens: T[],
  chaveDe: (item: T) => string | null | undefined,
  mapa: Map<string, ElegibilidadeRow>,
): Array<T & ChipElegibilidade> {
  return itens.map((item) => {
    const chave = chaveDe(item);
    const vinculo = chave ? mapa.get(chave) : undefined;
    return {
      ...item,
      ...(vinculo
        ? { elegivel: true, remediacao_id: vinculo.remediacao_id, remediacao_versao: vinculo.remediacao_versao }
        : SEM_VINCULO),
    };
  });
}
