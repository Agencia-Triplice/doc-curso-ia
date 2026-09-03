/**
 * Chip da branch do run de CI (head_branch) que originou o órfão, na fila e no caso.
 *
 * A branch chega do MS 5 via BFF e pode ser null (colagem de texto puro sem run, ou
 * run sem head_branch). Como o link do run (lib/run-link.js), é OMITIDO quando não há
 * branch — nada de chip vazio. Quando presente, mostra `branch <nome>`.
 *
 * @param {(tag: string, className?: string, text?: string) => HTMLElement} el
 * @param {string|null|undefined} branch
 * @returns {HTMLElement|null}
 */
export function chipBranch(el, branch) {
  if (!branch) return null;
  return el('span', 'tag branch', 'branch ' + branch);
}
