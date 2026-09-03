/**
 * Fonte ÚNICA do payload de constants que o curador envia ao AgentiX.
 *
 * O worker (`curador.worker.ts`) usa esta função para montar o que é enviado no
 * Invoke, e o endpoint `GET /v1/fila/:fp/prompt-agente` a reusa para reconstruir
 * o prompt de rascunhos gerados antes do registro em disco. Manter um builder só
 * garante que "o que a tela mostra" é exatamente "o que o worker envia".
 *
 * Cada par vira uma entrada em `constants` no contrato REST v2; o 1º par (`erro`)
 * também vira `payload.input`. A instrução fixa (system prompt) NÃO está aqui —
 * ela vive no corpo de `bundle/curador/AGENTS.md` na imagem do sim-agentix.
 */

export interface ParConstante {
  key: string;
  value: string;
}

/** Monta os pares chave/valor enviados ao group `dvop-curador`. */
export function montarPayloadCurador(
  orfao: Record<string, any>,
  contexto: string,
  persona: string,
  dossieTemplate: string,
): ParConstante[] {
  const assinatura = orfao.assinatura;
  return [
    { key: 'erro', value: assinatura },
    { key: 'assinatura', value: assinatura },
    { key: 'servico', value: orfao.servico || 'desconhecido' },
    { key: 'nivel', value: orfao.nivel || 'desconhecido' },
    { key: 'contexto', value: contexto },
    { key: 'persona', value: persona },
    { key: 'dossie_template', value: dossieTemplate },
    { key: 'workflow', value: String(orfao.workflow ?? '') },
    { key: 'job', value: String(orfao.job ?? '') },
    { key: 'step_cmd', value: String(orfao.step_cmd ?? '') },
    { key: 'exit_code', value: orfao.exit_code != null ? String(orfao.exit_code) : '' },
  ];
}
