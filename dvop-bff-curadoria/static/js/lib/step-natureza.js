/**
 * Classificador heurístico da NATUREZA da etapa que falhou, para enriquecer o
 * painel de Contexto do caso mesmo quando o MS 5 não capturou workflow/job/step
 * (campos nulos): infere "o que a etapa faz" a partir do texto que sempre existe
 * — a assinatura normalizada — reforçado por step_cmd/job/workflow quando há.
 *
 * É uma INFERÊNCIA (rotulada como tal na UI), não um fato do run: a versão "de
 * verdade" desse contexto virá no prompt do Agentix (frente 2). Ordem das regras
 * importa — específico antes de genérico (push de imagem contém "build").
 *
 * @param {{assinatura?: string|null, step_cmd?: string|null, job?: string|null,
 *          workflow?: string|null}} item
 * @returns {{etapa: string, descricao: string}|null} null = não classificado
 */
const REGRAS = [
  {
    re: /blob upload|manifest|registry|docker push|buildah|asset already exists|image (push|tag)|\bpush(ing)? (the )?image/i,
    etapa: 'Publicação de imagem no registry',
    descricao: 'envia a imagem/manifest da aplicação para o registry de containers',
  },
  {
    re: /argocd|app sync|rollout|helm|kubectl|deploy(ment)?|manifesto no config/i,
    etapa: 'Deploy / sync no cluster',
    descricao: 'renderiza os manifestos e sincroniza a aplicação no cluster',
  },
  {
    re: /gitleaks|trivy|semgrep|fortify|sonar|\bscan\b|eslint|\blint\b|quality gate/i,
    etapa: 'Análise estática / segurança',
    descricao: 'roda linters e scanners de qualidade/segurança sobre o código',
  },
  {
    re: /jest|vitest|pytest|coverage|\btest(s|ing)?\b|spec\.ts/i,
    etapa: 'Execução de testes',
    descricao: 'roda a suíte de testes automatizados do projeto',
  },
  {
    re: /npm (ci|install|error)|pnpm|yarn install|e[0-9]{3}\b|node_modules|dependenc/i,
    etapa: 'Instalação de dependências',
    descricao: 'baixa e instala os pacotes/dependências do projeto',
  },
  {
    re: /\bbuild\b|compile|tsc\b|nest build|mvn (package|verify|compile)|gradle|webpack/i,
    etapa: 'Build / compilação',
    descricao: 'compila e empacota o artefato da aplicação',
  },
];

export function naturezaFalha(item) {
  const heno = [item.assinatura, item.step_cmd, item.job, item.workflow]
    .filter((p) => p)
    .join(' \n ');
  if (!heno) return null;
  for (const regra of REGRAS) {
    if (regra.re.test(heno)) return { etapa: regra.etapa, descricao: regra.descricao };
  }
  return null;
}
