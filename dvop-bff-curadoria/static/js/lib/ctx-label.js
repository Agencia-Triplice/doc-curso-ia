/**
 * Trilha de contexto "workflow › job › step" na fila e no caso. Espelha
 * run-link.js: retorna HTMLElement ou null (omitido quando não há contexto).
 * @param {(tag: string, className?: string, text?: string) => HTMLElement} el
 * @param {{workflow?: string|null, job?: string|null, step_cmd?: string|null}} item
 * @returns {HTMLElement|null}
 */
export function trilhaContexto(el, item) {
  const partes = [item.workflow, item.job, item.step_cmd].filter((p) => p);
  if (!partes.length) return null;
  return el('span', 'tag ctx', partes.join(' › '));
}
