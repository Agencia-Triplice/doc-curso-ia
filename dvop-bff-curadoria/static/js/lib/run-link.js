/**
 * Link para o run de CI que originou o órfão (GitHub Actions), na fila e no caso.
 *
 * O run_url chega do MS 5 via BFF e pode ser null (colagem de texto puro, sem link
 * de Actions, ou repo cuja esteira não propaga o run). Diferente do chip de template
 * — que sempre aparece com "—" —, o link do run é OMITIDO quando não há URL: não há
 * travessão clicável. Quando presente, abre em nova aba com rel=noopener e, dentro do
 * card da fila, não dispara a navegação para o caso (stopPropagation).
 *
 * Só aceita http/https no href: o run_url vem do backend e, se adulterado, um
 * `javascript:`/`data:` no href executaria no clique (XSS). URL inválida ou de
 * outro esquema → link OMITIDO, como se não houvesse run_url.
 *
 * @param {(tag: string, className?: string, text?: string) => HTMLElement} el fábrica de elementos
 * @param {string|null|undefined} runUrl
 * @returns {HTMLAnchorElement|null}
 */
function safeHttpUrl(u) {
  try { const p = new URL(String(u)); return (p.protocol === 'https:' || p.protocol === 'http:') ? p.href : null; }
  catch { return null; }
}

export function linkRun(el, runUrl) {
  if (!runUrl) return null;
  const href = safeHttpUrl(runUrl);
  if (!href) return null;
  const a = /** @type {HTMLAnchorElement} */ (el('a', 'tag run-link', 'ver run ↗'));
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.addEventListener('click', (e) => e.stopPropagation());
  return a;
}
