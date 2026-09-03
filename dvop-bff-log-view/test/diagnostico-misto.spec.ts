import { HttpException } from '@nestjs/common';
import { DiagnosticoMistoService } from '../src/diagnostico/diagnostico-misto.service';
import { UpstreamError } from '../src/common/upstream-error';

const RUN = 'https://github.com/o/r/actions/runs/1';
const RUN2 = 'https://github.com/o/r/actions/runs/2';
const RUN3 = 'https://github.com/o/r/actions/runs/3';
const RUN4 = 'https://github.com/o/r/actions/runs/4';
const PR = 'https://github.com/o/r/pull/9';
const JOB = 'https://github.com/o/r/actions/runs/1/job/11';

const importacaoOk = {
  jobs_falhos: [{ job_id: 1 }], workflow: 'build', branch: 'main',
  linhas_coletadas: 12, accepted: 12, rejected: [],
  diagnostico: { resultado: 'escalado', fingerprint: 'fp1' },
};

// default: run "cru" tem 1 job com falha → itemDeLink cai no importar (comportamento
// anterior à feature preservado). Overrides sem jobsFalhos herdam este default.
const umJobFalho = () => ({ jobs_falhos: [{ job_id: 1, nome: 'ci / build', html_url: `${RUN}/job/11` }] });

function fabrica(over: Partial<Record<'diag' | 'mcpgh' | 'triagem' | 'agentix', any>> = {}) {
  const diag = over.diag ?? { diagnosticar: jest.fn().mockResolvedValue({ resultado: 'escalado', fingerprint: 'fpt' }) };
  const jobsFalhosDefault = jest.fn().mockResolvedValue(umJobFalho());
  const mcpgh = over.mcpgh
    ? { jobsFalhos: jobsFalhosDefault, ...over.mcpgh }
    : { enabled: true, importar: jest.fn().mockResolvedValue(importacaoOk), jobsFalhos: jobsFalhosDefault };
  const triagem = over.triagem ?? { triar: jest.fn().mockResolvedValue(null) };
  const agentix = over.agentix ?? { enabled: true };
  return { svc: new DiagnosticoMistoService(diag, mcpgh, triagem, agentix), diag, mcpgh, triagem, agentix };
}

describe('DiagnosticoMistoService — escada', () => {
  it('texto puro (caso simples): 1 item texto, sem triagem, contexto vazio', async () => {
    const { svc, triagem, diag } = fabrica();
    const r: any = await svc.diagnosticar({ message: 'timeout no gateway' });
    expect(triagem.triar).not.toHaveBeenCalled();
    expect(diag.diagnosticar).toHaveBeenCalledWith({ message: 'timeout no gateway' });
    expect(r.origem).toBe('misto');
    expect(r.contexto_usuario).toBe('');
    expect(r.triagem).toEqual({ usada: false, intencao: 'diagnosticar' });
    expect(r.itens).toEqual([{ tipo: 'texto', papel: 'erro', diagnostico: { resultado: 'escalado', fingerprint: 'fpt' } }]);
  });
  it('1 link Actions + texto (caso simples): item link, texto vira contexto, sem triagem', async () => {
    const { svc, triagem, mcpgh } = fabrica();
    const r: any = await svc.diagnosticar({ message: `estou com esse erro aq ${RUN}` });
    expect(triagem.triar).not.toHaveBeenCalled();
    expect(mcpgh.importar).toHaveBeenCalledWith(RUN, null);
    expect(r.contexto_usuario).toBe('estou com esse erro aq');
    expect(r.itens).toEqual([{
      tipo: 'link', url: RUN, papel: 'erro',
      importacao: { jobs_falhos: 1, workflow: 'build', branch: 'main', passo_falho: null, linhas_coletadas: 12 },
      diagnostico: { resultado: 'escalado', fingerprint: 'fp1' },
    }]);
  });
  it('link com job falho: importacao.passo_falho vem do 1º job com falha', async () => {
    const importar = jest.fn().mockResolvedValue({
      jobs_falhos: [{ job_id: 7 }], workflow: 'build', branch: 'main',
      linhas_coletadas: 5,
      trace: { github: { jobs: [
        { job_id: 6, passo_falho: null },
        { job_id: 7, passo_falho: { numero: 4, nome: 'Run GDD-Core/esteiras/actions/docker-build@main' } },
        { job_id: 8, passo_falho: { numero: 2, nome: 'Outro' } },
      ] } },
    });
    const { svc } = fabrica({ mcpgh: { enabled: true, importar } });
    const r: any = await svc.diagnosticar({ message: `erro ${RUN}` });
    expect(r.itens[0].importacao.passo_falho).toEqual({ numero: 4, nome: 'Run GDD-Core/esteiras/actions/docker-build@main' });
  });
  it('link sem trace: importacao.passo_falho = null', async () => {
    const { svc } = fabrica(); // importacaoOk não tem trace
    const r: any = await svc.diagnosticar({ message: `erro ${RUN}` });
    expect(r.itens[0].importacao.passo_falho).toBeNull();
  });
  it('github_token do body vai como token do importar', async () => {
    const { svc, mcpgh } = fabrica();
    await svc.diagnosticar({ message: RUN, github_token: 'ghp_x' });
    expect(mcpgh.importar).toHaveBeenCalledWith(RUN, 'ghp_x');
  });
  it('ambíguo (2+ links) chama a triagem e aplica a classificação', async () => {
    const msg = `veja ${RUN} e ${PR}, deu ECONNREFUSED`;
    const triagem = { triar: jest.fn().mockResolvedValue({
      intencao: 'duvida',
      links: [{ url: RUN, papel: 'erro' }, { url: PR, papel: 'referencia' }],
      erro_texto: 'ECONNREFUSED', contexto: 'veja, deu erro',
    }) };
    const { svc, diag } = fabrica({ triagem });
    const r: any = await svc.diagnosticar({ message: msg });
    expect(triagem.triar).toHaveBeenCalledWith(msg);
    expect(r.triagem).toEqual({ usada: true, intencao: 'duvida' });
    expect(r.contexto_usuario).toBe('veja, deu erro');
    expect(r.itens.map((i: any) => [i.tipo, i.papel])).toEqual(
      [['link', 'erro'], ['texto', 'erro'], ['link', 'referencia']]);
    expect(diag.diagnosticar).toHaveBeenCalledWith({ message: 'ECONNREFUSED' });
  });
  it('ambíguo com triagem null (fallback): Actions em ordem até o teto, excedente/outras viram referencia', async () => {
    const { svc, mcpgh } = fabrica();
    const r: any = await svc.diagnosticar({ message: `${RUN} ${RUN2} ${RUN3} ${RUN4} ${PR}` });
    expect(mcpgh.importar).toHaveBeenCalledTimes(3);
    expect(r.triagem).toEqual({ usada: false, intencao: 'diagnosticar' });
    const refs = r.itens.filter((i: any) => i.papel === 'referencia').map((i: any) => i.url);
    expect(refs).toEqual([RUN4, PR]);
  });
  it('fallback só com link não-Actions + texto: item texto + referencia', async () => {
    const { svc, diag } = fabrica();
    const r: any = await svc.diagnosticar({ message: `deu erro estranho ${PR}` });
    expect(diag.diagnosticar).toHaveBeenCalledWith({ message: 'deu erro estranho' });
    expect(r.itens.map((i: any) => i.tipo)).toEqual(['texto', 'link']);
  });
  it('triagem sem item acionável (schema válido, mas nada erro/erro_texto) com determinístico acionável → descartada, fallback', async () => {
    const triagem = { triar: jest.fn().mockResolvedValue({
      intencao: 'duvida', links: [], erro_texto: '', contexto: 'x',
    }) };
    const { svc, mcpgh } = fabrica({ triagem });
    const r: any = await svc.diagnosticar({ message: `${RUN} ${RUN2}` });
    expect(triagem.triar).toHaveBeenCalled();
    expect(mcpgh.importar).toHaveBeenCalledTimes(2);
    expect(r.triagem).toEqual({ usada: false, intencao: 'diagnosticar' });
    expect(r.itens.map((i: any) => [i.tipo, i.papel])).toEqual([['link', 'erro'], ['link', 'erro']]);
  });
});

describe('DiagnosticoMistoService — run cru pede o job específico', () => {
  const doisJobs = {
    jobs_falhos: [
      { job_id: 1, nome: 'ci / build', html_url: `${RUN}/job/11` },
      { job_id: 2, nome: 'ci / test', html_url: `${RUN}/job/22` },
    ],
  };
  it('run cru com 1 job falho: consulta jobs-falhos e segue o import', async () => {
    const { svc, mcpgh } = fabrica();
    const r: any = await svc.diagnosticar({ message: RUN });
    expect(mcpgh.jobsFalhos).toHaveBeenCalledWith(RUN, null);
    expect(mcpgh.importar).toHaveBeenCalledWith(RUN, null);
    expect(r.itens[0].tipo).toBe('link');
    expect(r.itens[0].importacao).toBeDefined();
  });
  it('run cru com 2 jobs falhos: item precisa_job, NÃO importa', async () => {
    const jobsFalhos = jest.fn().mockResolvedValue(doisJobs);
    const importar = jest.fn().mockResolvedValue(importacaoOk);
    const { svc } = fabrica({ mcpgh: { enabled: true, importar, jobsFalhos } });
    const r: any = await svc.diagnosticar({ message: RUN });
    expect(importar).not.toHaveBeenCalled();
    expect(r.itens[0].tipo).toBe('precisa_job');
    expect(r.itens[0].jobs_falhos).toEqual(doisJobs.jobs_falhos);
    expect(r.itens[0].mensagem).toContain('2 jobs');
    // sem diagnóstico → agente não elegível
    expect(r.agente).toEqual({ elegivel: false, motivo: 'nenhum diagnóstico executado' });
  });
  it('run cru sem job falho (0): item precisa_job com mensagem de "não encontrei"', async () => {
    const jobsFalhos = jest.fn().mockResolvedValue({ jobs_falhos: [] });
    const importar = jest.fn().mockResolvedValue(importacaoOk);
    const { svc } = fabrica({ mcpgh: { enabled: true, importar, jobsFalhos } });
    const r: any = await svc.diagnosticar({ message: RUN });
    expect(importar).not.toHaveBeenCalled();
    expect(r.itens[0].tipo).toBe('precisa_job');
    expect(r.itens[0].jobs_falhos).toEqual([]);
    expect(r.itens[0].mensagem).toContain('Não encontrei');
  });
  it('link de job específico: NÃO consulta jobs-falhos, importa direto', async () => {
    const jobsFalhos = jest.fn();
    const importar = jest.fn().mockResolvedValue(importacaoOk);
    const { svc } = fabrica({ mcpgh: { enabled: true, importar, jobsFalhos } });
    await svc.diagnosticar({ message: JOB });
    expect(jobsFalhos).not.toHaveBeenCalled();
    expect(importar).toHaveBeenCalledWith(JOB, null);
  });
  it('github_token do body vai também para jobs-falhos', async () => {
    const { svc, mcpgh } = fabrica();
    await svc.diagnosticar({ message: RUN, github_token: 'ghp_x' });
    expect(mcpgh.jobsFalhos).toHaveBeenCalledWith(RUN, 'ghp_x');
  });
});

describe('DiagnosticoMistoService — erros por item e 503', () => {
  it('mcp-github não configurado e trabalho SÓ de links → HttpException 503', async () => {
    const { svc } = fabrica({ mcpgh: { enabled: false, importar: jest.fn() } });
    await expect(svc.diagnosticar({ message: RUN })).rejects.toMatchObject({ status: 503 });
  });
  it('mcp-github não configurado com item de texto junto → erro por item, sem lançar', async () => {
    const triagem = { triar: jest.fn().mockResolvedValue({
      intencao: 'diagnosticar', links: [{ url: RUN, papel: 'erro' }], erro_texto: 'boom', contexto: '',
    }) };
    const { svc } = fabrica({ triagem, mcpgh: { enabled: false, importar: jest.fn() } });
    const r: any = await svc.diagnosticar({ message: `boom ${RUN} ${PR}` });
    expect(r.itens[0].erro.status).toBe(503);
    expect(r.itens[1].diagnostico).toBeDefined();
  });
  it('importar falha (UpstreamError 404) → item com erro, resposta 200 parcial', async () => {
    const importar = jest.fn()
      .mockRejectedValueOnce(new UpstreamError(404, 'run ou job não encontrado no GitHub'))
      .mockResolvedValueOnce(importacaoOk);
    const { svc } = fabrica({ mcpgh: { enabled: true, importar } });
    const r: any = await svc.diagnosticar({ message: `${RUN} ${RUN2}` });
    expect(r.itens[0].erro).toEqual({ status: 404, detail: 'run ou job não encontrado no GitHub' });
    expect(r.itens[1].diagnostico.resultado).toBe('escalado');
  });
  it('diagnóstico de texto 503 (cache off) → erro por item', async () => {
    const diag = { diagnosticar: jest.fn().mockRejectedValue(new HttpException({ detail: 'diagnóstico indisponível: configure LOG_BFF_CACHE_URL' }, 503)) };
    const { svc } = fabrica({ diag });
    const r: any = await svc.diagnosticar({ message: 'boom' });
    expect(r.itens[0].erro).toEqual({ status: 503, detail: 'diagnóstico indisponível: configure LOG_BFF_CACHE_URL' });
  });
});

describe('DiagnosticoMistoService — elegibilidade do agente', () => {
  it('cache_exato → não elegível (solução curada)', async () => {
    const diag = { diagnosticar: jest.fn().mockResolvedValue({ resultado: 'cache_exato', solucao: 's' }) };
    const { svc } = fabrica({ diag });
    const r: any = await svc.diagnosticar({ message: 'boom' });
    expect(r.agente).toEqual({ elegivel: false, motivo: 'solução curada encontrada' });
  });
  it('escalado + Agentix on → elegível', async () => {
    const r: any = await fabrica().svc.diagnosticar({ message: 'boom' });
    expect(r.agente).toEqual({ elegivel: true, motivo: 'sem solução curada' });
  });
  it('escalado + Agentix off → não elegível (agente não configurado)', async () => {
    const { svc } = fabrica({ agentix: { enabled: false } });
    const r: any = await svc.diagnosticar({ message: 'boom' });
    expect(r.agente).toEqual({ elegivel: false, motivo: 'agente não configurado' });
  });
  it('nenhum diagnóstico executado (só referências) → não elegível', async () => {
    const triagem = { triar: jest.fn().mockResolvedValue({
      intencao: 'duvida', links: [{ url: PR, papel: 'referencia' }], erro_texto: '', contexto: '',
    }) };
    const { svc } = fabrica({ triagem });
    const r: any = await svc.diagnosticar({ message: PR });
    expect(r.agente).toEqual({ elegivel: false, motivo: 'nenhum diagnóstico executado' });
  });
});
