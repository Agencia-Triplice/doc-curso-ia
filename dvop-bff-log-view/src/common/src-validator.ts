import { HttpException } from '@nestjs/common';

/**
 * Constrói o HttpException com corpo { detail } e também ajusta `.message`
 * (por padrão, o Nest usa "Http Exception" quando o response é um objeto
 * sem chave `message` — isso não afeta o corpo JSON devolvido por getResponse(),
 * só deixa o erro mais descritivo em logs/stack traces e em `toThrow(regex)`).
 */
function erroDetail(detail: string, status: 422 | 403): HttpException {
  const ex = new HttpException({ detail }, status);
  ex.message = detail;
  return ex;
}

export function validarSrc(src: string, allowedHostsCsv: string): string {
  let u: URL;
  try { u = new URL(src); } catch {
    throw erroDetail(`link inválido: ${JSON.stringify(src)} (esperado http(s)://host[:porta])`, 422);
  }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname) {
    throw erroDetail(`link inválido: ${JSON.stringify(src)} (esperado http(s)://host[:porta])`, 422);
  }
  const host = u.hostname.toLowerCase();
  const porta = u.port ? Number(u.port) : undefined;
  const hostPort = porta ? `${host}:${porta}` : host;
  const allowed = new Set(allowedHostsCsv.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  if (allowed.size && !allowed.has(host) && !allowed.has(hostPort)) {
    throw erroDetail(`host ${JSON.stringify(host)} não está na lista de hosts permitidos`, 403);
  }
  return `${u.protocol}//${host}${porta ? `:${porta}` : ''}`;
}
