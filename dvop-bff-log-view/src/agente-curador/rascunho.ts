/**
 * Funções puras portadas de `dvop-bff-curadoria/src/curador/curador.worker.ts`:
 * formatam o contexto do MS3 para o placeholder {{contexto}}, e decodificam/montam
 * o rascunho `{solucao, confianca, fontes}` devolvido pelo group `dvop-curador`.
 * Cópia paralela (mesmo padrão dos dois `agentix.service.ts`) — comportamento idêntico.
 */

export const AUTOR_IA = 'IA (Agentix)';
export const MAX_DOC_CHARS = 1200;
export const MAX_DOCS = 3;
export const MAX_SOLUCAO_CHARS = 20000;

/** Top-N documentos como texto para o placeholder {{contexto}} do goal. */
export function formatarContexto(documentos: Array<Record<string, unknown>>): string {
  if (!documentos || documentos.length === 0) {
    return '(nenhum documento encontrado)';
  }
  const blocos: string[] = [];
  documentos.slice(0, MAX_DOCS).forEach((doc, idx) => {
    const i = idx + 1;
    let conteudo = String(doc.conteudo ?? '');
    if (conteudo.length > MAX_DOC_CHARS) {
      conteudo = conteudo.slice(0, MAX_DOC_CHARS) + ' [...]';
    }
    const titulo = doc.titulo ?? 'sem título';
    const confianca = Number(doc.confianca || 0).toFixed(2);
    blocos.push(`${i}. ${titulo} (confiança ${confianca})\n${conteudo}`);
  });
  return blocos.join('\n\n');
}

/** Replica `base64.b64decode(validate=True).decode('utf-8')`: rejeita base64
 * não-canônico e utf-8 inválido via roundtrip. */
export function b64OuNull(bruto: string): string | null {
  const texto = Buffer.from(bruto, 'base64').toString('utf-8');
  const reencodado = Buffer.from(texto, 'utf-8').toString('base64').replace(/=+$/, '');
  return reencodado === bruto.replace(/=+$/, '') ? texto : null;
}

/** Conteúdo interno de uma cerca de código markdown (```json … ``` ou ``` … ```);
 * null se não houver cerca. O LLM real (gpt-4o-mini) embrulha o JSON assim mesmo
 * quando o prompt pede "SOMENTE o JSON" — sem descascar, o JSON.parse falha. */
export function semCercaMarkdown(bruto: string): string | null {
  const m = /```[a-zA-Z0-9]*\r?\n?([\s\S]*?)```/.exec(bruto);
  return m ? m[1].trim() : null;
}

/** JSON direto, JSON em cerca markdown, ou base64→JSON (as convenções do MVP-1 +
 * a cerca do LLM real); só aceita dict com 'solucao' não-vazia — senão null. */
export function decodificarRascunho(bruto: unknown): Record<string, unknown> | null {
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
    if (
      typeof dados === 'object' &&
      dados !== null &&
      !Array.isArray(dados) &&
      String((dados as Record<string, unknown>).solucao || '').trim()
    ) {
      return dados as Record<string, unknown>;
    }
  }
  return null;
}

/** Inversa de `montarRascunho`: separa o texto plano da cura pronta (rascunho do
 * MS 5) em `{ solucao, confianca, fontes }` para o cockpit reexibir com os chips.
 * Formato determinístico da cura da IA: `<solucao>\n\n---\nConfiança: <c>[ — Fontes:
 * <f1>, <f2>]`. Rascunho editado por humano (sem esse rodapé) volta como solução
 * inteira, sem confiança/fontes. Usa o ÚLTIMO separador (o rodapé é sempre o fim). */
export function parseCura(texto: string): { solucao: string; confianca: string | null; fontes: string[] } {
  const sep = '\n\n---\nConfiança: ';
  const i = texto.lastIndexOf(sep);
  if (i === -1) return { solucao: texto, confianca: null, fontes: [] };
  const solucao = texto.slice(0, i);
  const rodape = texto.slice(i + sep.length);
  const fsep = ' — Fontes: ';
  const j = rodape.indexOf(fsep);
  if (j === -1) return { solucao, confianca: rodape.trim() || null, fontes: [] };
  const confianca = rodape.slice(0, j).trim() || null;
  const fontes = rodape
    .slice(j + fsep.length)
    .split(', ')
    .map((f) => f.trim())
    .filter(Boolean);
  return { solucao, confianca, fontes };
}

/** Corpo do rascunho: solução + rodapé de confiança/fontes, truncado ao teto do
 * schema DraftIn.solucao do MS 5 (max_length=20000). */
export function montarRascunho(dados: Record<string, unknown>): string {
  const solucao = String(dados.solucao).trim();
  const confianca = String(dados.confianca || 'desconhecida');
  const fontes = ((dados.fontes || []) as unknown[]).map(String).filter((f) => f.trim());
  let rodape = 'Confiança: ' + confianca;
  if (fontes.length) {
    rodape += ' — Fontes: ' + fontes.join(', ');
  }
  return `${solucao}\n\n---\n${rodape}`.slice(0, MAX_SOLUCAO_CHARS);
}
