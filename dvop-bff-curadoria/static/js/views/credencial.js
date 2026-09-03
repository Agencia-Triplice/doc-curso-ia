import { el, aviso, confirmavel, pageHeader } from '../ui.js';
import * as api from '../api.js';

const ICONE_CRED = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--bex-red-btn)" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

// Credencial de escrita do executor de PR (MS 8), armada por aqui em vez de
// vir de cofre. O MS 8 guarda o PAT só em memória: some a cada restart do pod,
// e esta tela é onde isso fica visível — sem ela o sintoma seria um PR que
// simplesmente não abre.

const ORIGENS = {
  operador: { rotulo: 'armada nesta tela', classe: 'tag ok' },
  ambiente: { rotulo: 'vinda do ambiente', classe: 'tag' },
  ausente: { rotulo: 'ausente — nenhum PR será aberto', classe: 'tag perigo' },
};

function blocoEstado(estado) {
  const bloco = el('div', 'detalhe-bloco');
  bloco.appendChild(el('h3', null, 'Estado'));

  const origem = ORIGENS[estado.origem] || ORIGENS.ausente;
  const meta = el('div', 'meta');
  meta.appendChild(el('span', origem.classe, origem.rotulo));
  if (estado.login) meta.appendChild(el('span', 'tag', '@' + estado.login));
  bloco.appendChild(meta);

  if (estado.definido_em) {
    bloco.appendChild(el('p', 'rodape', 'armada em ' + estado.definido_em));
  }
  if (estado.origem === 'ambiente') {
    bloco.appendChild(el('p', 'rodape',
      'o executor está usando REMEDIATION_GITHUB_TOKEN. Armar um PAT aqui tem '
      + 'precedência sobre ele.'));
  }
  return bloco;
}

export async function mount(container) {
  container.appendChild(pageHeader(ICONE_CRED, 'Credencial do GitHub',
    'PAT de escrita do executor de PR (MS8) — armado em memória, não em cofre'));
  container.appendChild(el('p', 'page-intro',
    'PAT que o executor de PR usa para abrir os pull requests. Fica só na '
    + 'memória do serviço: não é gravado em disco e some a cada reinício do '
    + 'pod — quando isso acontecer, o estado volta para "ausente" e é preciso '
    + 'armar de novo.'));

  const area = el('div');
  container.appendChild(area);

  async function render() {
    let estado;
    try {
      estado = await api.credencial();
    } catch (e) {
      area.replaceChildren(el('p', 'vazio', 'estado da credencial indisponível: ' + e.message));
      return;
    }

    const frag = document.createDocumentFragment();
    frag.appendChild(blocoEstado(estado));

    const form = el('div', 'detalhe-bloco');
    form.appendChild(el('h3', null, estado.origem === 'operador' ? 'Substituir' : 'Armar'));
    const campo = el('div', 'campo');
    const input = Object.assign(el('input', 'cred-input'), {
      type: 'password',
      placeholder: 'ghp_…',
      autocomplete: 'off',
      // o valor nunca é lido de volta nem ecoado: só viaja no PUT
      ariaLabel: 'PAT do GitHub',
    });
    campo.appendChild(input);
    form.appendChild(campo);
    form.appendChild(el('p', 'rodape',
      'o token é validado no GitHub antes de ser aceito; um PAT morto é '
      + 'recusado aqui e não vira um PR que falha depois.'));

    const acoes = el('div', 'acoes');
    const btnArmar = el('button', 'primario', 'armar');
    acoes.appendChild(btnArmar);

    btnArmar.addEventListener('click', async () => {
      const token = input.value.trim();
      if (!token) { aviso('informe o PAT'); return; }
      btnArmar.disabled = true;
      try {
        const novo = await api.armarCredencial(token);
        input.value = '';
        aviso('credencial armada' + (novo.login ? ' para @' + novo.login : ''), true);
        await render();
      } catch (e) {
        aviso(e.message);
        btnArmar.disabled = false;
      }
    });

    if (estado.origem === 'operador') {
      const btnDesarmar = el('button', 'perigo', 'desarmar');
      acoes.appendChild(btnDesarmar);
      confirmavel(btnDesarmar, 'confirmar: o executor para de abrir PR', async () => {
        try {
          await api.desarmarCredencial();
          aviso('credencial desarmada', true);
          await render();
        } catch (e) { aviso(e.message); }
      });
    }

    form.appendChild(acoes);
    frag.appendChild(form);
    area.replaceChildren(frag);
  }

  await render();
}
