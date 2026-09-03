// Helpers de DOM. el/aviso/confirmavel/detalheConteudo são porte verbatim do
// index.html atual (linhas 161-166, 168-177, 302-322, 531-538). filtrarLista é
// puro (testável sob Node). montarFiltro monta a caixa de busca das listas.

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

let avisoTimer = null;
export function aviso(msg, ok) {
  const box = document.getElementById('aviso');
  box.textContent = msg;
  box.className = ok ? 'ok' : '';
  box.style.display = msg ? 'block' : 'none';
  clearTimeout(avisoTimer);
  if (msg) avisoTimer = setTimeout(() => { box.style.display = 'none'; }, 6000);
}

// aprovação/descarte em dois cliques — sem confirm() nativo
export function confirmavel(botao, textoConfirma, acao) {
  const original = botao.textContent;
  let armado = false;
  botao.addEventListener('click', () => {
    if (!armado) {
      armado = true;
      botao.textContent = textoConfirma;
      botao.classList.add('confirmando');
      setTimeout(() => { armado = false; botao.textContent = original; botao.classList.remove('confirmando'); }, 4000);
      return;
    }
    armado = false;
    botao.textContent = original;
    botao.classList.remove('confirmando');
    acao();
  });
}

export function detalheConteudo(rotulo, texto) {
  const box = el('details', 'conteudo');
  box.appendChild(el('summary', null, rotulo));
  const pre = el('pre');
  pre.textContent = texto;
  box.appendChild(pre);
  return box;
}

/** Abre um modal grande centrado. Devolve { corpo, fechar, aoFechar, setConcluir }.
 * - corpo: <div> vazio para o chamador preencher.
 * - fechar(): remove o modal, restaura o scroll do body e dispara os aoFechar.
 * - aoFechar(cb): registra callback disparado uma única vez ao fechar
 *   (por OK, Cancelar, ✕, clique no backdrop ou Esc).
 * - setConcluir(bool): só quando opts.concluir=true — habilita/desabilita o OK.
 *
 * opts.concluir=true monta um footer com Cancelar + "Concluído" e começa
 * com o Concluído DESABILITADO (o chamador libera via setConcluir quando o
 * fluxo tem um desfecho). Sem a opção, o footer traz só o botão sempre
 * habilitado. Em ambos os casos cada ação do fluxo tem o próprio botão no corpo.
 * opts.onConcluir (async ()=>bool): se presente, roda ao clicar Concluído ANTES
 * de fechar; só fecha se devolver true (permite gravar um rascunho e abortar o
 * fechamento em caso de erro). Cancelar/✕/Esc/backdrop fecham sem chamá-lo. */
export function abrirModal(titulo, opts = {}) {
  const comGate = opts.concluir === true;
  const overlay = el('div', 'modal-overlay');
  const painel = el('div', 'modal-painel');
  const header = el('div', 'modal-header');
  header.appendChild(el('h3', 'modal-titulo', titulo));
  const btnX = el('button', 'modal-fechar', '✕');
  btnX.type = 'button';
  header.appendChild(btnX);
  const corpo = el('div', 'modal-corpo');
  const footer = el('div', 'modal-footer');
  if (comGate) {
    const btnCancelar = el('button', null, 'Cancelar');
    btnCancelar.type = 'button';
    btnCancelar.addEventListener('click', () => fechar());
    footer.appendChild(btnCancelar);
  }
  const btnOk = el('button', 'ok', 'Concluído');
  btnOk.type = 'button';
  if (comGate) btnOk.disabled = true;
  footer.appendChild(btnOk);
  painel.append(header, corpo, footer);
  overlay.appendChild(painel);
  document.body.appendChild(overlay);

  const scrollAntigo = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  let fechado = false;
  const callbacks = [];
  function fechar() {
    if (fechado) return;
    fechado = true;
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = scrollAntigo;
    overlay.remove();
    for (const cb of callbacks) { try { cb(); } catch { /* isola um cb do outro */ } }
  }
  function onKey(e) { if (e.key === 'Escape') fechar(); }
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) fechar(); });
  btnX.addEventListener('click', () => fechar());
  // OK só age quando habilitado. Se opts.onConcluir existe, ele é chamado ANTES
  // de fechar (grava o rascunho): só fecha se devolver true — em falha, mantém
  // o modal aberto para o usuário corrigir/tentar de novo.
  btnOk.addEventListener('click', async () => {
    if (btnOk.disabled) return;
    if (opts.onConcluir) {
      btnOk.disabled = true;
      let ok = false;
      try { ok = await opts.onConcluir(); } catch { ok = false; }
      if (!ok) { btnOk.disabled = false; return; }
    }
    fechar();
  });
  return {
    corpo,
    fechar,
    aoFechar: (cb) => callbacks.push(cb),
    setConcluir: (habil) => { if (comGate) btnOk.disabled = !habil; },
  };
}

/** Puro: filtra `itens` cujos campos (via `campos(item)` -> string[]) contêm o
 * termo (case-insensitive). Termo vazio devolve tudo. */
export function filtrarLista(termo, itens, campos) {
  const t = String(termo || '').trim().toLowerCase();
  if (!t) return itens.slice();
  return itens.filter((item) => campos(item).some((c) => String(c ?? '').toLowerCase().includes(t)));
}

/** Faixa de título BEX (ícone opcional + título + subtítulo). `iconeSvg` é uma
 * string SVG estática (nunca conteúdo do usuário). */
export function pageHeader(iconeSvg, titulo, sub) {
  const header = el('div', 'page-header');
  const wrap = el('div', 'page-title-wrap');
  const h1 = el('h1', 'page-title');
  if (iconeSvg) { const s = el('span', 'tab-icon'); s.innerHTML = iconeSvg; h1.appendChild(s); }
  h1.appendChild(el('span', null, titulo));
  wrap.appendChild(h1);
  if (sub) wrap.appendChild(el('span', 'page-sub', sub));
  header.appendChild(wrap);
  return header;
}

/** Caixa de busca BEX (ícone + input); chama onInput(valor) a cada tecla.
 * Mantém um <input> real dentro (chamadores fazem querySelector('input')). */
export function montarFiltro(placeholder, onInput) {
  const wrap = el('div', 'filtro filtro-box');
  const icon = el('span', 'filtro-icon');
  icon.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
  const input = Object.assign(el('input'), { type: 'text', placeholder, className: 'filtro-input' });
  input.addEventListener('input', () => onInput(input.value));
  wrap.append(icon, input);
  return wrap;
}
