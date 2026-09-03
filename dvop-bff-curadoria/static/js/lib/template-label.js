/**
 * Rótulo do chip de template (arquétipo de origem do repo) na fila e no caso.
 *
 * O template chega do MS 5 via BFF e pode ser null (colagem sem link de Actions,
 * ou repo sem a marca REPO_TEMPLATE/topic template-<x>). Nesse caso o chip mostra
 * um travessão — o card sempre exibe o campo, sinalizando "origem desconhecida"
 * em vez de omitir silenciosamente.
 */
export function rotuloTemplate(template) {
  return template ? template : '—';
}
