export interface LinksDaMensagem { actions: string[]; outras: string[]; texto: string; }

// URL geral (esquema obrigatório — o BFF nunca "adivinha" esquema aqui)
const URL_RE = /https?:\/\/[^\s<>"']+/gi;
// pontuação de frase colada no fim da URL ("veja https://x/1." → sem o ponto)
const PONTUACAO_FINAL_RE = /[.,;:!?)\]}>'"]+$/;
// mesmo charset de owner/repo do RUN_RE do mcp-github (GithubFetch.java)
const ACTIONS_RE = new RegExp(
  '^https?://[^/\\s]+/[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*'
  + '/actions/runs/\\d+(?:/attempts/\\d+)?(?:/job/\\d+)?/?$', 'i',
);

// link de um job específico (…/job/<n>), possivelmente com /attempts/<n>
const JOB_RE = new RegExp(
  '^https?://[^/\\s]+/[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*'
  + '/actions/runs/\\d+(?:/attempts/\\d+)?/job/\\d+/?$', 'i',
);

export function ehLinkActions(url: string): boolean {
  return ACTIONS_RE.test(url);
}

// true só para o link do job (…/job/<n>); um link de run "cru" dá false
export function ehLinkJob(url: string): boolean {
  return JOB_RE.test(url);
}

export function extrairLinks(mensagem: string): LinksDaMensagem {
  const actions: string[] = []; const outras: string[] = [];
  const vistos = new Set<string>();
  let texto = mensagem;
  for (const bruta of mensagem.match(URL_RE) ?? []) {
    const url = bruta.replace(PONTUACAO_FINAL_RE, '');
    const sobra = bruta.slice(url.length);
    // split/join em vez de regex: a URL contém metacaracteres; a pontuação
    // de frase colada na URL (sobra) volta para o texto
    texto = texto.split(bruta).join(' ' + sobra);
    if (vistos.has(url)) continue;
    vistos.add(url);
    (ehLinkActions(url) ? actions : outras).push(url);
  }
  texto = texto.replace(/\s+/g, ' ').trim();
  // pontuação órfã no fim (sobra de URL que fechava a frase) cai fora;
  // pontuação presa a uma palavra ("urgente!") fica
  texto = texto.replace(/(?:\s|^)[.,;:!?)\]}>'"]+$/, '').trim();
  return { actions, outras, texto };
}
