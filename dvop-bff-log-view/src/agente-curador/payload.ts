/**
 * Fonte única do payload de constants que o card do agente envia ao group
 * `dvop-curador`. Port fiel de `dvop-bff-curadoria/src/curador/payload.ts`:
 * cada par vira uma entrada em `constants` no contrato REST v2; o 1º par (`erro`)
 * também vira `payload.input`. A instrução fixa (system prompt) vive no
 * `bundle/curador/AGENTS.md` da imagem do sim-agentix, não aqui.
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
