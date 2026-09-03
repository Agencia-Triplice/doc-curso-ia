// Formata um instante ISO (ex.: "2026-08-27T10:00:00+00:00") para uma data/hora
// legível em pt-BR ("27/08/2026, 10:00"). Entrada vazia/ inválida devolve string
// vazia / o valor cru — nunca lança (usado direto no render das listas).
export function formatarDataHora(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  try {
    return d.toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return String(iso);
  }
}
