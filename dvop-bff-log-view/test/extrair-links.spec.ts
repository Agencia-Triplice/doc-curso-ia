import { ehLinkActions, ehLinkJob, extrairLinks } from '../src/diagnostico/extrair-links';

const RUN = 'https://github.com/hathach/tinyusb/actions/runs/26448362837';
const JOB = `${RUN}/job/77862198412`;
const GHE = 'https://ghe.empresa.com.br/org/app/actions/runs/9/job/8';
const PR = 'https://github.com/org/app/pull/42';

describe('ehLinkActions', () => {
  it.each([RUN, JOB, `${RUN}/attempts/2`, GHE, `${RUN}/`])('aceita %s', (u) => {
    expect(ehLinkActions(u)).toBe(true);
  });
  it.each([PR, 'https://confluence.corp/x', 'https://github.com/o/r/actions', `${JOB}extra`])(
    'rejeita %s', (u) => { expect(ehLinkActions(u)).toBe(false); },
  );
});

describe('ehLinkJob', () => {
  it.each([JOB, GHE, `${RUN}/attempts/2/job/99`])('aceita link de job %s', (u) => {
    expect(ehLinkJob(u)).toBe(true);
  });
  it.each([RUN, `${RUN}/`, `${RUN}/attempts/2`, PR])('rejeita run cru/não-job %s', (u) => {
    expect(ehLinkJob(u)).toBe(false);
  });
});

describe('extrairLinks', () => {
  it('mensagem sem URL → texto integral, listas vazias', () => {
    const r = extrairLinks('  timeout no gateway  ');
    expect(r).toEqual({ actions: [], outras: [], texto: 'timeout no gateway' });
  });
  it('1 link de Actions com texto em volta', () => {
    const r = extrairLinks(`estou com esse erro aq ${JOB}`);
    expect(r.actions).toEqual([JOB]);
    expect(r.outras).toEqual([]);
    expect(r.texto).toBe('estou com esse erro aq');
  });
  it('pontuação colada na URL é removida', () => {
    const r = extrairLinks(`veja ${RUN}.`);
    expect(r.actions).toEqual([RUN]);
    expect(r.texto).toBe('veja');
  });
  it('link que não é de Actions vai para outras', () => {
    const r = extrairLinks(`quebrou depois do ${PR}`);
    expect(r.outras).toEqual([PR]);
    expect(r.actions).toEqual([]);
  });
  it('2 links misturados preservam a ordem', () => {
    const r = extrairLinks(`o run ${GHE} quebrou depois do ${PR}, aparece ECONNREFUSED`);
    expect(r.actions).toEqual([GHE]);
    expect(r.outras).toEqual([PR]);
    expect(r.texto).toBe('o run quebrou depois do , aparece ECONNREFUSED');
  });
  it('URL repetida entra uma vez só', () => {
    const r = extrairLinks(`${RUN} e de novo ${RUN}`);
    expect(r.actions).toEqual([RUN]);
  });
  it('"github.com/..." sem esquema NÃO é link (fica no texto)', () => {
    const r = extrairLinks('github.com/o/r/actions/runs/1 sem esquema');
    expect(r.actions).toEqual([]);
    expect(r.texto).toBe('github.com/o/r/actions/runs/1 sem esquema');
  });
  it('mensagem terminando em pontuação sem URL fica intacta', () => {
    expect(extrairLinks('Erro fatal!').texto).toBe('Erro fatal!');
    expect(extrairLinks('o que aconteceu?').texto).toBe('o que aconteceu?');
  });
  it('pontuação no fim que não é da URL é preservada', () => {
    const r = extrairLinks(`confira ${RUN} urgente!`);
    expect(r.actions).toEqual([RUN]);
    expect(r.texto).toBe('confira urgente!');
  });
});
