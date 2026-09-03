import { iniciarRouter, recarregarAtual } from './router.js';
import { aviso } from './ui.js';
import * as apiMod from './api.js';
import { mount as inicio } from './views/inicio.js';
import { mount as fila } from './views/fila.js';
import { mount as caso } from './views/caso.js';
import { mount as cache } from './views/cache.js';
import { mount as cacheDetalhe } from './views/cache-detalhe.js';
import { mount as base } from './views/base.js';
import { mount as baseDetalhe } from './views/base-detalhe.js';
import { mount as modelos } from './views/modelos.js';
import { mount as credencial } from './views/credencial.js';
import { mount as login } from './views/login.js';

const app = document.getElementById('app');
const view = document.getElementById('view');

// Guarda contra duplo-render: um 401 aciona handler401 (irParaLogin) DENTRO de
// api() e ainda lança, então o catch do chamador chamaria irParaLogin de novo —
// dois mounts assíncronos = dois cartões. A flag garante um só.
let loginMontado = false;
function irParaLogin() {
  if (loginMontado) return;
  loginMontado = true;
  app.classList.add('deslogado');
  view.replaceChildren();
  login(view);
}

// intervalo do poll rápido dos contadores voláteis (fila/cache) — reflete um
// caso novo na fila sem F5, sem bater em MS3/MS8 a cada ciclo.
const CONTADORES_MS = 8000;

// Lê /v1/info e escreve os contadores voláteis (fila + cache do MS5).
async function lerInfo() {
  const i = await apiMod.info();
  document.getElementById('cont-fila').textContent = i.fila ?? '–';
  document.getElementById('cont-cache').textContent = i.solucoes ?? '–';
}

// Poll rápido, silencioso: só fila/cache. Erro transitório não vira aviso (o
// refresh completo em 60s é quem surfaça a falha).
export async function atualizarInfo() {
  try { await lerInfo(); } catch { /* silencioso no poll rápido */ }
}

// Contadores do menu: Fila/Cache de /v1/info; Base do total de /v1/documentos.
// Falha do MS3 (503) deixa a Base como '–', sem derrubar os outros.
export async function atualizarContadores() {
  try { await lerInfo(); } catch (e) { aviso(e.message); }
  try {
    const d = await apiMod.documentos(1);
    document.getElementById('cont-base').textContent = d.total ?? '–';
  } catch { document.getElementById('cont-base').textContent = '–'; }
  try {
    const r = await apiMod.remediacoes();
    document.getElementById('cont-modelos').textContent = r.total ?? '–';
  } catch { document.getElementById('cont-modelos').textContent = '–'; }
  // marcador, não contador: o PAT do executor vive só em memória e some no
  // restart do pod. Sem este '!' no menu, a queda passaria despercebida até
  // um PR não abrir.
  try {
    const c = await apiMod.credencial();
    document.getElementById('cont-credencial').textContent = c.presente ? '✓' : '!';
  } catch { document.getElementById('cont-credencial').textContent = '–'; }
}

function montarChipUsuario(usuario) {
  const antigo = document.getElementById('chip-usuario');
  if (antigo) antigo.remove();
  const chip = document.createElement('div');
  chip.id = 'chip-usuario';
  chip.className = 'chip-usuario';
  const nome = document.createElement('span');
  nome.className = 'chip-nome';
  nome.textContent = usuario.nome;
  const sair = document.createElement('button');
  sair.className = 'chip-sair';
  sair.textContent = 'sair';
  sair.addEventListener('click', async () => {
    try { await apiMod.logout(); } catch { /* segue para login de qualquer jeito */ }
    location.assign('/');
  });
  chip.append(nome, sair);
  // v2: o chip mora na faixa slim do topo (#topbar-user); fallback para #menu.
  (document.getElementById('topbar-user') || document.getElementById('menu')).appendChild(chip);
}

async function boot() {
  apiMod.onNaoAutenticado(irParaLogin);
  let usuario;
  try {
    usuario = await apiMod.me();
  } catch {
    irParaLogin();
    return;
  }
  app.classList.remove('deslogado');
  montarChipUsuario(usuario);
  iniciarRouter(view, { inicio, fila, caso, cache, 'cache-detalhe': cacheDetalhe, base, 'base-detalhe': baseDetalhe, modelos, credencial });
  atualizarContadores();
  // fila/cache atualizam rápido (contador reflete caso novo sem F5); base/
  // modelos/credencial e a re-montagem das demais listas seguem no ritmo lento.
  setInterval(atualizarInfo, CONTADORES_MS);
  setInterval(() => { atualizarContadores(); recarregarAtual(); }, 60000);
}

boot();
