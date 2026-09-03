import { anotarElegibilidade } from '../src/eligibility/eligibility-annotate';
import { ElegibilidadeRow } from '../src/eligibility/eligibility-store.service';

const vinculo = (fp: string): ElegibilidadeRow => ({
  fingerprint: fp,
  remediacao_id: 'versao-ja-publicada',
  remediacao_versao: '1.0.0',
  assinatura: 'erro X',
  servico: 'dvop-srv-demo',
  autor: 'tiago',
  criado_em: '2026-08-03T10:00:00+00:00',
  atualizado_em: '2026-08-03T10:00:00+00:00',
});

describe('anotarElegibilidade', () => {
  it('marca o item com vínculo', () => {
    const mapa = new Map([['fp1', vinculo('fp1')]]);
    const [item] = anotarElegibilidade([{ fingerprint: 'fp1', solucao: 'sol' }], (i) => i.fingerprint, mapa);
    expect(item).toEqual({
      fingerprint: 'fp1',
      solucao: 'sol',
      elegivel: true,
      remediacao_id: 'versao-ja-publicada',
      remediacao_versao: '1.0.0',
    });
  });

  it('marca como não elegível quem não tem vínculo', () => {
    const [item] = anotarElegibilidade([{ fingerprint: 'fp2' }], (i) => i.fingerprint, new Map());
    expect(item).toMatchObject({ elegivel: false, remediacao_id: null, remediacao_versao: null });
  });

  it('trata chave nula (documento antigo, sem origem) como não elegível', () => {
    const mapa = new Map([['fp1', vinculo('fp1')]]);
    const [item] = anotarElegibilidade([{ id: 7, origem_fingerprint: null }], (i) => i.origem_fingerprint, mapa);
    expect(item).toMatchObject({ elegivel: false, remediacao_id: null, remediacao_versao: null });
  });
});
