import { el, aviso } from '../ui.js';
import { authConfig, entrarComPat } from '../api.js';

/** Tela de login: botão GitHub (se configurado) + entrada por PAT. */
export async function mount(container) {
  const erro = new URLSearchParams(location.search).get('erro');
  if (erro) aviso(mensagemErro(erro));

  const cartao = el('div', 'login-cartao');
  cartao.appendChild(el('h1', 'login-titulo', 'Curadoria'));
  cartao.appendChild(el('p', 'login-sub', 'Entre para acessar a fila de curadoria.'));

  let cfg = { github: false, pat: true };
  try { cfg = await authConfig(); } catch { /* usa defaults */ }

  if (cfg.github) {
    const bt = el('a', 'btn-github', '🐙  Entrar com GitHub');
    bt.href = '/auth/github';
    cartao.appendChild(bt);
  }

  if (cfg.pat) {
    if (cfg.github) cartao.appendChild(el('div', 'login-ou', 'ou'));
    const campo = document.createElement('input');
    campo.type = 'password';
    campo.placeholder = 'Personal Access Token';
    campo.autocomplete = 'off';
    campo.maxLength = 255;
    campo.className = 'login-nome';
    const bt = el('button', 'primario', 'Entrar');
    const entrar = async () => {
      const token = campo.value.trim();
      if (!token) { aviso('informe um token'); return; }
      bt.disabled = true;
      try { await entrarComPat(token); location.assign('/'); }
      catch (e) { aviso(e.message); bt.disabled = false; }
    };
    bt.addEventListener('click', entrar);
    campo.addEventListener('keydown', (e) => { if (e.key === 'Enter') entrar(); });
    const linha = el('div', 'login-linha');
    linha.append(campo, bt);
    cartao.appendChild(linha);
  }

  container.appendChild(cartao);
}

function mensagemErro(codigo) {
  if (codigo === 'github_indisponivel') return 'login por GitHub não está configurado';
  if (codigo === 'state_invalido') return 'sessão de login expirada — tente de novo';
  return 'não foi possível entrar — tente de novo';
}
