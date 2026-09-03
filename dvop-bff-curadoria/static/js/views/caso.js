import { el, aviso, confirmavel, abrirModal } from '../ui.js';
import { irPara } from '../router.js';
import { rotuloTemplate } from '../lib/template-label.js';
import { linkRun } from '../lib/run-link.js';
import { chipBranch } from '../lib/branch-label.js';
import { naturezaFalha } from '../lib/step-natureza.js';
import { atualizarContadores } from '../app.js';
import * as api from '../api.js';

// Escapa um texto para casar como literal num regex JS (o assinatura_regex roda
// com new RegExp no bff/gate e no match). Evita a armadilha Java×JS: literal puro.
function escaparRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Deriva um id válido (^[a-z0-9][a-z0-9-]*$) a partir de um texto-semente.
function idSugerido(semente) {
  const base = String(semente || 'remediacao').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return /^[a-z0-9]/.test(base) ? base : 'r-' + base;
}

// Manifestos-candidato default p/ remediação agente (agnóstica de tecnologia);
// o worker sonda estes paths no repo-alvo e passa os existentes ao agente.
const MANIFESTOS_AGENTE = ['pom.xml', 'package.json', 'pyproject.toml', 'build.gradle',
  'build.gradle.kts', 'gradle.properties', 'Cargo.toml', 'setup.cfg', 'VERSION'];
// exemplo_diff é exigido pelo MS8 (min 1) mas não existe estaticamente p/ agente:
// o diff real é materializado por repositório na aplicação.
const EXEMPLO_DIFF_AGENTE = '(diff materializado por repositório na aplicação — gerado pelo agente)';

let selecionado = null; // guarda contra respostas fora de ordem

// Estado do modal de PR aberto (um por vez). O modal é TRANSACIONAL para a
// configuração do modelo: criar/editar/excluir remediação e o vínculo de
// elegibilidade ficam em RASCUNHO (memória) e só são gravados no backend ao
// clicar "Concluído" (ou no atalho "Salvar sem gerar PR"); Cancelar/✕/Esc/
// backdrop descartam. A metade de execução (AgentiX: gerar/aprovar/abrir PR)
// continua AO VIVO — produz diff e PR reais, não há como rascunhá-los.
// forma: {
//   setConcluir, fechar, fingerprint, getAutor,
//   proposta,            // proposta viva (metade de execução)
//   getRemSelecionada,   // () => remediação selecionada (staged ou committed) p/ gerar o PR
//   formAberto,          // um form de cadastro/edição está aberto
//   vinculoCommitted,    // vínculo atual no backend (objeto ou null)
//   vinculoStaged,       // undefined=sem mudança | null=remover | id=marcar
//   stagedById,          // Map id -> { estado:'novo'|'editado'|'excluido', corpo? }
//   prCriadoNestaSessao, // um PR foi ABERTO durante ESTA sessão do modal? Só
//                        // então um estado pr_* conta como o PR deste caso; um
//                        // PR herdado de outra ocorrência do mesmo erro (mesmo
//                        // fingerprint) é ignorado e o caso oferece abrir um novo.
// }
let modalPr = null;

/** A proposta virou PR ABERTO NESTA SESSÃO do modal? Só um PR realmente aberto
 * (estado pr_* que não seja pr_rejeitado) E aberto durante esta sessão libera o
 * "Concluído". Um PR herdado de OUTRA ocorrência do mesmo erro (mesmo fingerprint)
 * NÃO conta: o caso deve sempre abrir um PR novo, nunca herdar o de outra
 * ocorrência. Gerar a proposta (pronta), não-aplicável, vazio, gerando,
 * erro_geracao e PR rejeitado (tratado como sem PR, ver item "nunca mostrar PR
 * rejeitado") também NÃO contam. O atalho "Salvar sem gerar PR" fecha o modal por
 * conta própria, então não passa por aqui. */
function ehDesfechoProposta(p) {
  return Boolean(p) && String(p.estado || '').startsWith('pr_') && p.estado !== 'pr_rejeitado'
    && Boolean(modalPr && modalPr.prCriadoNestaSessao);
}

/** Há alteração de configuração ainda não gravada (catálogo ou vínculo)? */
function temRascunho() {
  return Boolean(modalPr) && (modalPr.vinculoStaged !== undefined || modalPr.stagedById.size > 0);
}

/** id da remediação vinculada CONSIDERANDO o rascunho (staged sobrepõe committed).
 * Pode devolver null (sem vínculo / remoção pendente). */
function vinculoEfetivoId() {
  if (!modalPr) return null;
  if (modalPr.vinculoStaged !== undefined) return modalPr.vinculoStaged; // pode ser null
  return modalPr.vinculoCommitted ? modalPr.vinculoCommitted.remediacao_id : null;
}

/** Remediação selecionada no dropdown da elegibilidade (staged ou committed).
 * É a fonte de {instrucao, paths} da geração de PR e do vínculo do "salvar sem
 * gerar PR". Fica em modalPr.getRemSelecionada (montado por montarElegibilidade). */
function remSelecionada() {
  return (modalPr && modalPr.getRemSelecionada) ? modalPr.getRemSelecionada() : null;
}

/** Recalcula se o "Concluído" pode habilitar. Regra: só libera DEPOIS que o PR
 * foi aberto ("Aprovar e abrir PR" → estado pr_*), e nunca com um formulário de
 * cadastro/edição aberto. Rascunho de config e vínculo pendentes NÃO liberam
 * sozinhos — são gravados no fechamento; o atalho "Salvar sem gerar PR" fecha o
 * modal por conta própria. */
function recomputarConcluir() {
  if (!modalPr) return;
  modalPr.setConcluir(!modalPr.formAberto && ehDesfechoProposta(modalPr.proposta));
}

/** Grava o rascunho no backend na ordem certa: catálogo (exclusões/recriações)
 * e depois o vínculo. 'editado' = excluir+recriar no mesmo id (MS8 sem update).
 * Lança se qualquer passo falhar (o chamador mantém o modal aberto). */
async function aplicarRascunho(m) {
  for (const [id, s] of m.stagedById) {
    if (s.estado === 'excluido') {
      await api.excluirRemediacao(id);
    } else if (s.estado === 'editado') {
      await api.excluirRemediacao(id);
      await api.criarRemediacao(s.corpo);
    } else if (s.estado === 'novo') {
      await api.criarRemediacao(s.corpo);
    }
  }
  if (m.vinculoStaged !== undefined) {
    if (m.vinculoStaged === null) await api.elegibilidadeDelete(m.fingerprint);
    else await api.elegibilidadePut(m.fingerprint,
      { remediacao_id: m.vinculoStaged, autor: m.getAutor(), preview_confirmado: true });
  }
  m.stagedById = new Map();
  m.vinculoStaged = undefined;
}

/** Aplica o rascunho e atualiza o contador do menu na hora. Devolve true se
 * gravou (ok fechar); false se falhou (mantém o modal aberto). onConcluir do OK. */
async function concluirModal() {
  if (!modalPr) return true;
  try { await aplicarRascunho(modalPr); }
  catch (e) { aviso('Não foi possível concluir: ' + e.message); return false; }
  atualizarContadores(); // reflete o catálogo "Modelos de PR" imediatamente
  return true;
}

/** Atalho "Salvar sem gerar PR": marca o vínculo para a remediação escolhida,
 * grava o rascunho e fecha — sem gerar proposta nem abrir PR. */
async function salvarSemGerarPr(remediacaoId) {
  if (!modalPr) return;
  if (!remediacaoId) { aviso('escolha uma remediação'); return; }
  modalPr.vinculoStaged = remediacaoId;
  recomputarConcluir();
  if (await concluirModal()) modalPr.fechar();
}

/** Registra no rascunho a criação/edição de uma remediação (não grava no MS8). */
function stageCadastro(remAntigo, corpo) {
  if (!modalPr) return;
  if (remAntigo) {
    // edição (id travado): se já era um staged-novo, segue 'novo'; senão 'editado'
    const s = modalPr.stagedById.get(remAntigo.id);
    const estado = (s && s.estado === 'novo') ? 'novo' : 'editado';
    modalPr.stagedById.set(corpo.id, { estado, corpo });
  } else {
    modalPr.stagedById.set(corpo.id, { estado: 'novo', corpo });
  }
  recomputarConcluir();
}

/** Registra no rascunho a exclusão de uma remediação. Cancelar uma criação
 * ainda não gravada apenas remove o rascunho. Limpa o vínculo se apontava a ela. */
function stageExcluir(id) {
  if (!modalPr) return;
  const s = modalPr.stagedById.get(id);
  if (s && s.estado === 'novo') modalPr.stagedById.delete(id); // criação não-gravada → só cancela
  else modalPr.stagedById.set(id, { estado: 'excluido' });
  if (vinculoEfetivoId() === id) modalPr.vinculoStaged = modalPr.vinculoCommitted ? null : undefined;
  recomputarConcluir();
}

function renderizarPreview(alvo, rem) {
  alvo.classList.remove('vazio');
  alvo.replaceChildren(
    el('p', null, 'tipo: ' + rem.tipo_pr + ' · versão ' + rem.versao),
    el('p', null, rem.descricao_acao),
    el('p', null, 'escopo: ' + rem.escopo.paths_permitidos.join(', ') +
      ' · máx ' + rem.escopo.max_arquivos + ' arquivo(s) · máx ' +
      rem.escopo.max_linhas_diff + ' linha(s) de diff'),
    el('p', null, 'pré-condições: ' + rem.pre_condicoes.join('; ')),
    el('pre', null, rem.exemplo_diff),
  );
}

/** Decide a área de PR: uma chamada ao endpoint de aplicáveis gateia AMBOS os
 * blocos (elegibilidade + gerador AgentiX). Vazio → some tudo, mostra aviso.
 * Erro de verificação → aviso neutro (não esconde por engano). */
/** Lista efetiva de ids (committed ∪ rascunho): committed menos os marcados para
 * exclusão, mais os criados/editados no rascunho (otimista — a remediação nova
 * nasce com a assinatura deste erro, então casa). Decide se há bloco de PR. */
function listaEfetiva(aplicaveis) {
  const ids = new Set(aplicaveis.map((r) => r.id));
  if (modalPr) {
    for (const [id, s] of modalPr.stagedById) {
      if (s.estado === 'excluido') ids.delete(id);
      else ids.add(id); // novo / editado
    }
  }
  return [...ids];
}

async function montarAreaPr(col, fingerprint, getAutor) {
  // re-render: proposta/form voltam ao neutro; o RASCUNHO (staged) é preservado.
  if (modalPr) { modalPr.proposta = null; modalPr.formAberto = false; recomputarConcluir(); }
  let resp;
  try {
    resp = await api.remediacoesAplicaveis(fingerprint);
  } catch (e) {
    if (selecionado !== fingerprint) return;
    col.appendChild(blocoPr(el('p', 'vazio', 'Não foi possível verificar remediações agora: ' + e.message)));
    return;
  }
  if (selecionado !== fingerprint) return;
  const aplicaveis = (resp && resp.aplicaveis) || [];
  // catálogo completo: ids_custom (o que é editável/excluível) + objetos cheios
  // (para pré-preencher a edição sem depender do payload de aplicáveis).
  let idsCustom = new Set();
  const mapaCompleto = {};
  try {
    const cat = await api.remediacoes();
    idsCustom = new Set((cat && cat.ids_custom) || []);
    for (const m of (cat && cat.remediacoes) || []) mapaCompleto[m.id] = m;
  } catch { /* segue sem custom → editar/excluir ficam ocultos */ }
  if (selecionado !== fingerprint) return;
  if (!listaEfetiva(aplicaveis).length) {
    const corpo = el('div');
    corpo.appendChild(el('p', 'vazio', 'Sem remediação de PR que casa com este erro.'));
    const btn = el('button', 'botao', 'Cadastrar remediação para este erro');
    btn.onclick = () => abrirFormRemediacao(col, fingerprint, getAutor, {});
    corpo.appendChild(btn);
    // pode ter chegado aqui por excluir (em rascunho) a única que casava
    if (temRascunho()) {
      const n = modalPr.stagedById.size + (modalPr.vinculoStaged !== undefined ? 1 : 0);
      corpo.appendChild(el('p', 'form-hint',
        '✎ ' + n + ' alteração(ões) pendente(s) — gravadas ao clicar Concluído; Cancelar descarta.'));
    }
    col.appendChild(blocoPr(corpo));
    return;
  }
  montarElegibilidade(col, fingerprint, getAutor, aplicaveis, idsCustom, mapaCompleto);
  // "Corrigir com PR (AgentiX)" opera sobre a remediação SELECIONADA no dropdown
  // (committed OU em rascunho): propostaGerar recebe {instrucao, paths} direto —
  // não exige a remediação gravada; o backend combina isso com os arquivos do repo.
  montarProposta(col, fingerprint);
}

/** Cartão de cabeçalho da área de PR reusado pelos estados vazio/erro. */
function blocoPr(corpo) {
  const bloco = el('div', 'proposta-pr');
  bloco.appendChild(el('h3', null, '🛠 Corrigir com PR'));
  bloco.appendChild(corpo);
  return bloco;
}

async function montarElegibilidade(col, fingerprint, getAutor, aplicaveis, idsCustom, mapaCompleto) {
  const bloco = el('div', 'elegibilidade');
  bloco.appendChild(el('h3', null, 'Elegível a PR automático'));
  const carregando = el('p', 'vazio', 'carregando…');
  bloco.appendChild(carregando);
  // Anexa AGORA, antes do 1º await: uma função async roda síncrono até o
  // 1º await, e fetch nunca resolve na mesma tick — então anexar aqui
  // garante que este bloco entre no DOM antes do de montarProposta
  // (chamado logo depois, também sem await, em mount()). A ordem de
  // anexação no DOM segue a ordem de CHAMADA, não a ordem em que as
  // promises resolvem.
  col.appendChild(bloco);

  let vinculo = null;
  try { vinculo = await api.elegibilidadeGet(fingerprint); }
  catch { /* 404 = sem vínculo */ }
  if (selecionado !== fingerprint) return;
  carregando.remove();
  if (modalPr) { modalPr.vinculoCommitted = vinculo; recomputarConcluir(); }

  // catálogo efetivo: committed (aplicáveis) sobreposto pelo RASCUNHO. Novos/
  // editados entram/sobrescrevem; excluídos saem. previewSource também cobre os
  // objetos completos (mapaCompleto) para a edição.
  const staged = (modalPr && modalPr.stagedById) || new Map();
  const catalogo = {};
  for (const rem of aplicaveis) catalogo[rem.id] = rem;
  const previewSource = Object.assign({}, mapaCompleto, catalogo);
  for (const [id, s] of staged) {
    if (s.estado === 'excluido') { delete catalogo[id]; }
    else { catalogo[id] = s.corpo; previewSource[id] = s.corpo; } // novo / editado
  }
  const cust = idsCustom || new Set();
  // custom = criada na tela (editável/excluível): committed-custom ou em rascunho
  const ehCustomId = (id) => {
    const s = staged.get(id);
    if (s) return s.estado === 'novo' || s.estado === 'editado';
    return cust.has(id);
  };

  const vinEfid = vinculoEfetivoId();
  bloco.appendChild(el('p', 'vazio',
    vinEfid
      ? 'vinculado a ' + vinEfid + (temRascunho() ? ' (pendente — grava ao concluir)' : '')
      : 'sem vínculo — escolha a remediação e confira o preview antes de confirmar'));

  const sel = document.createElement('select');
  const painel = el('div', 'preview-remediacao vazio', 'preview ainda não exibido');
  const btnPreview = el('button', null, '🔎 Preview da remediação');
  const btnVincular = el('button', 'ok', '🏷 Marcar elegível a PR');
  btnVincular.disabled = true; // sem preview renderizado, sem marcar

  for (const id of Object.keys(catalogo).sort()) {
    const opcao = document.createElement('option');
    opcao.value = id;
    opcao.textContent = id + (staged.get(id) ? ' • pendente' : '');
    sel.appendChild(opcao);
  }
  if (vinEfid && catalogo[vinEfid]) sel.value = vinEfid;

  // fonte da geração de PR (AgentiX): a remediação selecionada no dropdown,
  // já sobreposta pelo rascunho (novo/editado). Lida em runtime pelo bloco AgentiX.
  if (modalPr) modalPr.getRemSelecionada = () => previewSource[sel.value] || catalogo[sel.value] || null;

  const btnSalvarSemPr = el('button', null, '💾 Salvar sem gerar PR');
  btnSalvarSemPr.type = 'button';
  const btnEditar = el('button', null, '✏ Editar');
  btnEditar.type = 'button';
  const btnExcluir = el('button', 'perigo', '🗑 Excluir');
  btnExcluir.type = 'button';
  const btnNova = el('button', null, '➕ Nova remediação');
  btnNova.type = 'button';

  const sincronizarCustom = () => {
    const ehCustom = ehCustomId(sel.value);
    btnEditar.disabled = !ehCustom;
    btnExcluir.disabled = !ehCustom;
    btnEditar.title = ehCustom ? '' : 'remediação embarcada — não editável';
    btnExcluir.title = ehCustom ? '' : 'remediação embarcada — não removível';
  };

  sel.addEventListener('change', () => {
    btnVincular.disabled = true;
    painel.classList.add('vazio');
    painel.replaceChildren(el('p', null, 'preview ainda não exibido'));
    sincronizarCustom();
  });
  btnPreview.addEventListener('click', () => {
    try { renderizarPreview(painel, previewSource[sel.value] || catalogo[sel.value]); btnVincular.disabled = false; }
    catch (e) { aviso(e.message); }
  });
  // marcar elegível = RASCUNHO do vínculo (grava só no Concluído). Sem confirmavel:
  // é reversível até concluir.
  btnVincular.addEventListener('click', () => {
    if (btnVincular.disabled) return;
    modalPr.vinculoStaged = sel.value;
    aviso('remediação marcada — será gravada ao concluir', true);
    recarregarAreaPr(col, fingerprint, getAutor);
  });
  // salvar sem gerar PR: marca o vínculo, grava o rascunho e FECHA — sem PR.
  btnSalvarSemPr.addEventListener('click', () => salvarSemGerarPr(sel.value));
  btnEditar.addEventListener('click', () => {
    const rem = previewSource[sel.value] || catalogo[sel.value];
    if (rem) abrirFormRemediacao(col, fingerprint, getAutor, { rem });
  });
  // excluir = RASCUNHO (reversível até concluir); sem confirmavel.
  btnExcluir.addEventListener('click', () => {
    stageExcluir(sel.value);
    aviso('remediação marcada para exclusão — efetiva ao concluir', true);
    recarregarAreaPr(col, fingerprint, getAutor);
  });
  btnNova.addEventListener('click', () => abrirFormRemediacao(col, fingerprint, getAutor, {}));

  const acoes = el('div', 'acoes');
  acoes.append(sel, btnPreview, btnVincular, btnSalvarSemPr);
  if (vinEfid) {
    const btnRemover = el('button', 'perigo', '✖ Remover vínculo');
    btnRemover.type = 'button';
    btnRemover.addEventListener('click', () => {
      modalPr.vinculoStaged = modalPr.vinculoCommitted ? null : undefined; // remove ou cancela o staged
      aviso('vínculo será removido ao concluir', true);
      recarregarAreaPr(col, fingerprint, getAutor);
    });
    acoes.appendChild(btnRemover);
  }

  // segunda linha: gerência de modelos (editar/excluir a selecionada · criar nova)
  const gerir = el('div', 'acoes acoes-modelos');
  gerir.append(btnEditar, btnExcluir, btnNova);
  sincronizarCustom();

  if (selecionado !== fingerprint) return;
  bloco.append(acoes, painel, gerir);
  // aviso de rascunho pendente (nada foi gravado ainda)
  if (temRascunho()) {
    const n = staged.size + (modalPr.vinculoStaged !== undefined ? 1 : 0);
    bloco.appendChild(el('p', 'form-hint',
      '✎ ' + n + ' alteração(ões) pendente(s) — gravadas ao clicar Concluído; Cancelar descarta.'));
  }
}

export async function mount(container, params) {
  const fingerprint = params.fp;
  selecionado = fingerprint;
  let item;
  try { item = await api.caso(fingerprint); }
  catch (e) {
    aviso(e.message);
    irPara('#/fila'); // 404: órfão saiu da fila
    return;
  }
  if (selecionado !== fingerprint) return;

  container.append(voltar(), cabecalho(item));
  const cols = el('div', 'detalhe-cols');
  const colLer = el('div', 'coluna');
  const colAgir = el('div', 'coluna');
  colLer.appendChild(el('div', 'rot-col', 'Contexto'));
  colAgir.appendChild(el('div', 'rot-col', 'Agir'));
  cols.append(colLer, colAgir);
  container.appendChild(cols);

  montarLer(colLer, item);
  montarAgir(colAgir, item, fingerprint);
}

// chevron do botão "voltar" e ícone de alerta do card de incidente (SVG estáticos)
const ICONE_VOLTAR = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>';
const ICONE_INCIDENTE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--bex-red-btn)" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';

function voltar() {
  const b = el('button', 'btn-voltar');
  b.innerHTML = ICONE_VOLTAR; // SVG estático
  b.appendChild(el('span', null, 'Voltar para a Fila'));
  b.addEventListener('click', () => irPara('#/fila'));
  return b;
}

function cabecalho(item) {
  const card = el('div', 'card-incidente');
  const head = el('div', 'card-incidente-head');
  const titulo = el('span', 'incidente-titulo');
  titulo.innerHTML = ICONE_INCIDENTE; // SVG estático
  titulo.appendChild(el('span', null, 'Diagnóstico do Incidente de Esteira'));
  const meta = el('div', 'meta');
  meta.appendChild(el('span', 'tag template', 'template: ' + rotuloTemplate(item.template)));
  if (item.servico) meta.appendChild(el('span', 'tag', 'serviço: ' + item.servico));
  if (item.nivel) meta.appendChild(el('span', 'tag nivel-' + item.nivel, item.nivel));
  meta.appendChild(el('span', 'tag ocorrencias', item.ocorrencias + ' ocorrência(s)'));
  if (item.primeiro_visto) meta.appendChild(el('span', 'tag', 'desde ' + item.primeiro_visto));
  const run = linkRun(el, item.run_url);
  if (run) meta.appendChild(run);
  const branch = chipBranch(el, item.branch);
  if (branch) meta.appendChild(branch);
  head.append(titulo, meta);
  card.appendChild(head);

  const sigWrap = el('div');
  sigWrap.appendChild(el('div', 'incidente-sig-cap', 'Assinatura normalizada do erro · ID ' + item.fingerprint));
  sigWrap.appendChild(Object.assign(el('pre', 'incidente-sig-box'), { textContent: item.assinatura }));
  card.appendChild(sigWrap);
  return card;
}

/** Contexto do caso: etapa provável (inferida do erro) + esteira
 * (step/exit/workflow/job) + arquétipo + tail redigido colapsável. */
function blocoContexto(item) {
  const wrap = el('div', 'campo');
  const natureza = naturezaFalha(item);
  if (natureza) {
    const bloco = el('div', 'etapa-inferida');
    bloco.appendChild(el('div', 'etapa-titulo', '⚙ Etapa provável (inferida do erro)'));
    bloco.appendChild(el('div', 'etapa-nome', natureza.etapa));
    bloco.appendChild(el('div', 'etapa-desc', natureza.descricao));
    wrap.appendChild(bloco);
  }
  const linhas = [
    ['step', item.step_cmd],
    ['exit', item.exit_code != null ? String(item.exit_code) : null],
    ['workflow', item.workflow], ['job', item.job],
    ['arquétipo', item.template],
  ].filter(([, v]) => v);
  for (const [k, v] of linhas) wrap.appendChild(el('div', 'ctx-linha', k + ': ' + v));
  if (item.log_tail) {
    const det = el('details');
    det.appendChild(Object.assign(el('summary'), { textContent: 'Log (tail, redigido)' }));
    det.appendChild(Object.assign(el('pre', 'log-tail'), { textContent: item.log_tail }));
    wrap.appendChild(det);
  }
  if (!natureza && !linhas.length && !item.log_tail) return null;
  return wrap;
}

function montarLer(col, item) {
  const bc = blocoContexto(item);
  if (bc) col.appendChild(bc);
  else col.appendChild(el('p', 'vazio', 'sem contexto de esteira para este caso.'));
}

// espera do rascunho da IA: enquanto o órfão não tem rascunho (e a IA não
// desistiu), o painel Agir avisa que a resposta está a caminho e repergunta o
// caso em silêncio, preenchendo sozinho quando o rascunho chega — o worker do
// curador gera em ciclos (~60s), então antes o textarea vazio parecia "sem
// resposta". Teto ~3 min para não pollar indefinidamente se a IA estiver fora.
const ESPERA_RASCUNHO_INTERVALO_MS = 8000;
const ESPERA_RASCUNHO_MAX = 22;

function cabecalhoRascunho(template) {
  return el('div', 'rot-col', '✨ Rascunho do especialista — arquétipo ' + rotuloTemplate(template));
}

/** Monta solução + autor + ações. Devolve getAutor() para a Task 5 reusar. */
function montarAgir(col, item, fingerprint) {
  const temRascunho = !!item.rascunho;
  const iaFalhou = item.ia_estado === 'falhou';
  if (temRascunho) col.appendChild(cabecalhoRascunho(item.template));

  // aviso do estado da IA quando ainda não há rascunho no load
  const statusIa = el('div', 'ia-status');
  if (!temRascunho) {
    if (iaFalhou) {
      statusIa.classList.add('falhou');
      statusIa.textContent = '⚠ O AgentiX não conseguiu gerar um rascunho — escreva a solução manualmente.';
    } else {
      statusIa.textContent = '⏳ O AgentiX está gerando o rascunho — ele aparece aqui sozinho, sem recarregar.';
    }
    col.appendChild(statusIa);
  }

  const campoSol = el('div', 'campo');
  const labelSol = el('label', null, 'solução (passos numerados — o rascunho do AgentiX já vem preenchido; edite se precisar)');
  labelSol.htmlFor = 'solucao';
  const solucao = Object.assign(el('textarea', 'solucao-textarea'), { id: 'solucao', placeholder: '1. ...\n2. ...\n3. ...' });
  if (temRascunho) solucao.value = item.rascunho.solucao;
  campoSol.append(labelSol, solucao);

  const campoAutor = el('div', 'campo');
  const labelAutor = el('label', null, 'autor');
  labelAutor.htmlFor = 'autor';
  const autor = Object.assign(el('input'), { type: 'text', id: 'autor', placeholder: 'time-sre' });
  if (temRascunho && item.rascunho.autor) autor.value = item.rascunho.autor;
  campoAutor.append(labelAutor, autor);

  const getAutor = () => autor.value.trim() || null;

  const acoes = el('div', 'acoes');
  const btnRascunho = el('button', null, '💾 Salvar rascunho');
  btnRascunho.addEventListener('click', () => salvarRascunho(fingerprint, btnRascunho, solucao, autor));
  const btnAprovar = el('button', 'ok', '✅ Aprovar → grava no cache');
  confirmavel(btnAprovar, 'Confirmar aprovação?', () => aprovar(fingerprint, btnAprovar, solucao, autor));
  const btnDescartar = el('button', 'perigo', '🗑 Descartar órfão');
  confirmavel(btnDescartar, 'Confirmar descarte?', () => descartar(fingerprint, btnDescartar));
  // O fluxo de PR (elegibilidade + proposta AgentiX + cadastro sem-match) mora
  // num modal aberto por este botão; a tela só guarda o cartão-resumo abaixo.
  const btnPr = el('button', null, '🛠 Remediação com PR');
  btnPr.type = 'button';
  acoes.append(btnRascunho, btnAprovar, btnDescartar, btnPr);

  // Enquanto a IA está gerando o rascunho (dados ainda não carregaram), as ações
  // ficam TRAVADAS — não faz sentido salvar/aprovar/descartar antes do rascunho.
  // Liberam quando o rascunho chega (preencherRascunho) ou quando a IA desiste/
  // estoura o teto (aí o revisor age manualmente). Com rascunho no load ou IA já
  // falha, já nascem liberadas.
  const acoesBtns = [btnRascunho, btnAprovar, btnDescartar, btnPr];
  const habilitarAcoes = (on) => {
    for (const b of acoesBtns) {
      b.disabled = !on;
      b.title = on ? '' : 'aguarde o AgentiX carregar o rascunho';
    }
  };
  const aguardandoIa = !temRascunho && !iaFalhou;
  if (aguardandoIa) habilitarAcoes(false);

  col.append(campoSol, campoAutor, acoes);

  // cartão-resumo do estado de PR (abaixo das ações); o botão acima abre o modal
  const resumoPr = el('div', 'pr-resumo');
  col.appendChild(resumoPr);
  atualizarResumoPr(resumoPr, btnPr, fingerprint, getAutor);

  // transparência: ver (só leitura) o prompt que o AgentiX recebeu para gerar
  // este rascunho. Só faz sentido quando há rascunho da IA.
  if (temRascunho) col.appendChild(blocoPromptAgente(fingerprint));

  // sem rascunho e IA não desistiu: aguarda e preenche sozinho
  if (aguardandoIa) {
    aguardarRascunho(fingerprint, { col, statusIa, solucao, autor, template: item.template, habilitarAcoes });
  }
  return getAutor;
}

// --- Área de PR: botão + cartão-resumo na tela; fluxo completo no modal ---

/** (Re)consulta o estado de PR do caso e renderiza o cartão-resumo na coluna
 * Agir, ajustando o rótulo do botão e (re)ligando o clique que abre o modal.
 * Consulta aplicáveis (só para saber se há match) + elegibilidade + proposta. */
async function atualizarResumoPr(resumoEl, btnPr, fingerprint, getAutor) {
  resumoEl.replaceChildren(el('p', 'vazio', 'verificando remediação com PR…'));
  let temMatch = false, vinculo = null, proposta = null;
  try {
    const resp = await api.remediacoesAplicaveis(fingerprint);
    temMatch = Boolean(resp && resp.aplicaveis && resp.aplicaveis.length);
  } catch { /* silencioso: o modal mostra o erro detalhado ao abrir */ }
  if (selecionado !== fingerprint) return;
  try { vinculo = await api.elegibilidadeGet(fingerprint); } catch { vinculo = null; }
  if (selecionado !== fingerprint) return;
  try { proposta = await api.propostaGet(fingerprint); } catch { proposta = null; }
  if (selecionado !== fingerprint) return;

  const configurado = Boolean(vinculo || proposta);
  btnPr.textContent = configurado ? '📝 Editar remediação com PR' : '🛠 Remediação com PR';
  btnPr.onclick = () => abrirModalPr(resumoEl, btnPr, fingerprint, getAutor);

  renderResumoPr(resumoEl, { temMatch, vinculo, proposta });
}

/** Cartão-resumo compacto: chip da remediação vinculada + chip do estado da
 * proposta (gerando / pronta / não aplicável / etc). NUNCA mostra estado de PR
 * (aberto/link): um PR por fingerprint só poderia ser o de outra ocorrência do
 * mesmo erro, e o caso sempre oferece abrir um PR novo. Sem match e sem nada
 * configurado, mostra só a dica de que dá para configurar. */
function renderResumoPr(resumoEl, { temMatch, vinculo, proposta }) {
  const chips = el('div', 'meta');
  if (vinculo) {
    chips.appendChild(el('span', 'tag elegivel',
      'remediação: ' + vinculo.remediacao_id + ' v' + vinculo.remediacao_versao));
  }
  const est = proposta && proposta.estado;
  if (est === 'gerando') {
    chips.appendChild(el('span', 'tag', '⏳ gerando proposta'));
  } else if (est === 'erro_geracao') {
    chips.appendChild(el('span', 'tag nivel-ERROR', '⚠ falha ao gerar proposta'));
  } else if (est === 'nao_aplicavel') {
    chips.appendChild(el('span', 'tag', 'ⓘ proposta não aplicável'));
  } else if (est === 'pronta') {
    const n = proposta.n_arquivos ?? (proposta.arquivos || []).length;
    chips.appendChild(el('span', 'tag', 'proposta pronta · ' + n + ' arquivo(s)'));
  }
  // Estado pr_* NÃO vira chip aqui: o cartão-resumo vive FORA de qualquer sessão
  // do modal, então um PR por fingerprint só poderia ser o de OUTRA ocorrência do
  // mesmo erro. Nunca herdamos esse estado — o caso sempre oferece abrir um PR
  // novo (o botão acima abre o modal, que gera/aprova um PR próprio deste caso).

  resumoEl.replaceChildren();
  if (chips.children.length) {
    resumoEl.appendChild(chips);
  } else {
    resumoEl.appendChild(el('p', 'vazio', temMatch
      ? 'há remediação que casa com este erro — clique acima para configurar o PR.'
      : 'nenhuma remediação com PR configurada para este erro.'));
  }
}

/** Abre o modal grande e roda dentro dele o fluxo completo de PR (as mesmas
 * funções usadas antes inline). Ao fechar, re-consulta e re-renderiza o resumo. */
function abrirModalPr(resumoEl, btnPr, fingerprint, getAutor) {
  // onConcluir: o "Concluído" GRAVA o rascunho antes de fechar (o ui.js só fecha
  // se devolver true). Cancelar/✕/Esc/backdrop fecham sem gravar (descarta).
  const modal = abrirModal('Remediação com PR automático', { concluir: true, onConcluir: concluirModal });
  modalPr = {
    setConcluir: modal.setConcluir, fechar: modal.fechar,
    fingerprint, getAutor,
    proposta: null, getRemSelecionada: null, formAberto: false,
    vinculoCommitted: null, vinculoStaged: undefined,
    stagedById: new Map(),
    prCriadoNestaSessao: false, // vira true só quando ESTA sessão abrir um PR
  };
  montarAreaPr(modal.corpo, fingerprint, getAutor);
  modal.aoFechar(() => {
    modalPr = null;
    if (selecionado !== fingerprint) return; // navegou para outro caso
    atualizarResumoPr(resumoEl, btnPr, fingerprint, getAutor);
  });
}

/** Poll silencioso enquanto o rascunho não chega; para ao sair do caso, ao
 * chegar o rascunho, ao a IA desistir, ou ao estourar o teto de tentativas. */
function aguardarRascunho(fingerprint, ctx) {
  let tentativas = 0;
  const agendar = () => setTimeout(tick, ESPERA_RASCUNHO_INTERVALO_MS);
  async function tick() {
    if (selecionado !== fingerprint) return; // navegou para outro caso
    tentativas += 1;
    let novo;
    try {
      novo = await api.caso(fingerprint);
    } catch {
      if (selecionado === fingerprint && tentativas < ESPERA_RASCUNHO_MAX) agendar();
      return; // falha transitória: tenta de novo até o teto
    }
    if (selecionado !== fingerprint) return;
    if (novo.rascunho) { preencherRascunho(fingerprint, novo.rascunho, ctx); return; }
    if (novo.ia_estado === 'falhou') {
      ctx.statusIa.className = 'ia-status falhou';
      ctx.statusIa.textContent = '⚠ O AgentiX não conseguiu gerar um rascunho — escreva a solução manualmente.';
      if (ctx.habilitarAcoes) ctx.habilitarAcoes(true); // IA desistiu → libera para agir manual
      return;
    }
    if (tentativas < ESPERA_RASCUNHO_MAX) agendar();
    else {
      ctx.statusIa.textContent = '⏳ O rascunho está demorando mais que o normal — recarregue a página para conferir.';
      if (ctx.habilitarAcoes) ctx.habilitarAcoes(true); // teto estourou → não deixa travado
    }
  }
  agendar();
}

/** Rascunho chegou via poll: insere o cabeçalho, preenche o textarea (sem
 * sobrescrever texto que o revisor já tenha digitado) e abre o bloco do prompt. */
function preencherRascunho(fingerprint, rascunho, ctx) {
  if (ctx.habilitarAcoes) ctx.habilitarAcoes(true); // rascunho chegou → libera as ações
  ctx.col.insertBefore(cabecalhoRascunho(ctx.template), ctx.statusIa);
  ctx.statusIa.className = 'ia-status ok';
  if (!ctx.solucao.value.trim()) {
    ctx.solucao.value = rascunho.solucao;
    if (rascunho.autor && !ctx.autor.value.trim()) ctx.autor.value = rascunho.autor;
    ctx.statusIa.textContent = '✨ Rascunho do AgentiX carregado — revise e aprove.';
  } else {
    // o revisor já começou a escrever: não sobrescreve — oferece inserir
    ctx.statusIa.textContent = '✨ Rascunho do AgentiX disponível. ';
    const btn = el('button', 'ia-inserir', 'inserir rascunho');
    btn.addEventListener('click', () => {
      ctx.solucao.value = rascunho.solucao;
      if (rascunho.autor && !ctx.autor.value.trim()) ctx.autor.value = rascunho.autor;
      ctx.statusIa.textContent = '✨ Rascunho inserido — revise e aprove.';
    });
    ctx.statusIa.appendChild(btn);
  }
  ctx.col.appendChild(blocoPromptAgente(fingerprint));
}

/** <details> discreto: carrega o prompt sob demanda na 1ª abertura. Só leitura. */
function blocoPromptAgente(fingerprint) {
  const det = el('details', 'prompt-agente');
  det.appendChild(Object.assign(el('summary'), { textContent: '🔍 ver prompt enviado ao agente' }));
  const corpo = el('div', 'prompt-corpo vazio', 'carregando…');
  det.appendChild(corpo);
  let carregado = false;
  det.addEventListener('toggle', async () => {
    if (!det.open || carregado) return;
    carregado = true;
    try {
      const p = await api.promptAgente(fingerprint);
      if (selecionado !== fingerprint) return;
      renderPrompt(corpo, p);
    } catch (e) {
      carregado = false; // deixa tentar de novo numa próxima abertura
      corpo.classList.add('vazio');
      corpo.replaceChildren(el('p', null, 'não foi possível carregar: ' + e.message));
    }
  });
  return det;
}

function renderPrompt(corpo, p) {
  corpo.classList.remove('vazio');
  const origem = p.origem === 'registrado'
    ? 'registrado — prompt real enviado quando o rascunho foi gerado'
      + (p.registrado_em ? ' · ' + p.registrado_em : '')
    : 'reconstruído — rascunho anterior ao registro; remontado com os mesmos dados que o worker envia';
  const partes = [el('p', 'prompt-origem', origem)];
  if (p.entidade) {
    partes.push(el('p', 'prompt-entidade',
      'destino: ' + p.entidade.tipo + ' · ' + p.entidade.nome + ' v' + p.entidade.versao
      + ' · bundle ' + p.entidade.bundle));
  }
  partes.push(el('div', 'prompt-secao-titulo', 'constants enviados ao agente'));
  const tabela = el('div', 'prompt-constants');
  for (const c of (p.constants || [])) {
    const linha = el('div', 'prompt-par');
    linha.appendChild(el('div', 'prompt-key', c.key));
    linha.appendChild(Object.assign(el('pre', 'prompt-val'), { textContent: c.value || '(vazio)' }));
    tabela.appendChild(linha);
  }
  partes.push(tabela);
  if (p.nota) partes.push(el('p', 'prompt-nota', p.nota));
  corpo.replaceChildren(...partes);
}

async function salvarRascunho(fingerprint, botao, solucaoEl, autorEl) {
  const solucao = solucaoEl.value.trim();
  if (!solucao) { aviso('escreva a solução antes de salvar o rascunho'); return; }
  botao.disabled = true;
  try {
    await api.salvarRascunho(fingerprint, { solucao, autor: autorEl.value.trim() || null });
    aviso('rascunho salvo', true);
  } catch (e) { aviso(e.message); }
  botao.disabled = false;
}

async function aprovar(fingerprint, botao, solucaoEl, autorEl) {
  const solucao = solucaoEl.value.trim();
  if (!solucao) { aviso('escreva ou revise a solução antes de aprovar'); return; }
  botao.disabled = true;
  try {
    await api.aprovar(fingerprint, { solucao, autor: autorEl.value.trim() || null });
    aviso('solução gravada no cache — o MS 2 já foi avisado (reload)', true);
    irPara('#/fila');
  } catch (e) { aviso(e.message); botao.disabled = false; }
}

async function descartar(fingerprint, botao) {
  botao.disabled = true;
  try {
    await api.descartar(fingerprint);
    aviso('órfão descartado', true);
    irPara('#/fila');
  } catch (e) { aviso(e.message); botao.disabled = false; }
}

// --- Task D1: proposta de PR (AgentiX) — bloco "Corrigir com PR" ---
// Renderizado logo abaixo do painel de elegibilidade, dentro do modal de PR.
// Estados que o backend produz: sem proposta (404), gerando, erro_geracao
// (com motivo), pronta, pr_aberto, pr_rejeitado — e, defensivamente,
// qualquer outro "pr_*" é tratado como PR aberto (sem depender de pr_aceito
// existir de fato).
const PROPOSTA_LINHAS_ALERTA = 200; // acima disso, contador de linhas vira alerta

/** Monta o bloco "Corrigir com PR": carrega a proposta atual (se houver) e
 * renderiza o estado correspondente. */
async function montarProposta(col, fingerprint) {
  const bloco = el('div', 'proposta-pr');
  bloco.appendChild(el('h3', null, '🛠 Corrigir com PR (AgentiX)'));
  const corpo = el('div', 'proposta-corpo vazio', 'carregando…');
  bloco.appendChild(corpo);
  col.appendChild(bloco);

  let proposta = null;
  try { proposta = await api.propostaGet(fingerprint); }
  catch { proposta = null; } // 404 = ainda sem proposta para este caso
  if (selecionado !== fingerprint) return;
  renderEstadoProposta(corpo, fingerprint, proposta);
}

/** Roteia para o render do estado atual da proposta. */
function renderEstadoProposta(corpo, fingerprint, proposta) {
  corpo.classList.remove('vazio');
  // ao sair do estado "gerando", encerra o ticker do tempo decorrido e zera o
  // marco de início (o próximo "gerando" recomeça a contagem do zero).
  if (!proposta || proposta.estado !== 'gerando') {
    if (corpo._prTimer) { clearInterval(corpo._prTimer); corpo._prTimer = null; }
    delete corpo._prGerandoStart;
  }
  // mantém o gating do modal em dia: proposta com desfecho libera o "OK".
  if (modalPr) { modalPr.proposta = proposta || null; recomputarConcluir(); }
  if (!proposta) { renderPropostaAusente(corpo, fingerprint); return; }
  if (proposta.estado === 'gerando') { renderPropostaGerando(corpo); return; }
  if (proposta.estado === 'erro_geracao') { renderPropostaErro(corpo, fingerprint, proposta); return; }
  if (proposta.estado === 'nao_aplicavel') { renderPropostaNaoAplicavel(corpo, fingerprint, proposta); return; }
  if (proposta.estado === 'pronta') { renderPropostaPronta(corpo, fingerprint, proposta); return; }
  if (String(proposta.estado || '').startsWith('pr_') && proposta.estado !== 'pr_rejeitado'
      && modalPr && modalPr.prCriadoNestaSessao) {
    // Só mostramos "PR aberto" para um PR aberto NESTA sessão do modal. Um pr_*
    // vindo do backend sem que esta sessão o tenha aberto é de OUTRA ocorrência
    // do mesmo erro (mesmo fingerprint) — cai para "ausente" abaixo e o caso
    // oferece gerar/abrir um PR novo no repositório analisado.
    renderPropostaPr(corpo, fingerprint, proposta); return;
  }
  // pr_rejeitado (tratado como sem PR — nunca mostrar rejeição), PR herdado de
  // outra ocorrência, ou estado desconhecido: volta ao estado "ausente",
  // oferecendo gerar o PR de novo.
  renderPropostaAusente(corpo, fingerprint);
}

/** Sem proposta ainda: botão para pedir ao AgentiX que gere uma. Usa a remediação
 * SELECIONADA (staged ou committed): manda {instrucao, paths}; o backend junta com
 * os arquivos do repositório. */
function renderPropostaAusente(corpo, fingerprint) {
  corpo.replaceChildren();
  const rem = remSelecionada();
  if (!rem || !rem.instrucao) {
    corpo.appendChild(el('p', 'vazio',
      'selecione uma remediação com instrução acima para gerar o PR.'));
    return;
  }
  corpo.appendChild(el('p', 'form-hint',
    'gera a partir da remediação "' + rem.id + '" (sua instrução + os arquivos do repositório).'));
  const btn = el('button', null, '✨ Gerar proposta de PR (AgentiX)');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await api.propostaGerar(fingerprint, { instrucao: rem.instrucao, paths: rem.escopo.paths_permitidos });
      if (selecionado !== fingerprint) return;
      renderPropostaGerando(corpo);
      aguardarProposta(fingerprint, corpo);
    } catch (e) { aviso(e.message); btn.disabled = false; }
  });
  corpo.appendChild(btn);
}

// ícone central do spinner (git-branch/PR — o mesmo do cockpit do log-view)
const ICONE_PR_ORBIT = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/></svg>';

/** Tempo decorrido honesto (conta pra cima): "12.3s" até 1min, depois "m:ss". */
function formatarDecorrido(ms) {
  const s = ms / 1000;
  if (s < 60) return s.toFixed(1) + 's';
  return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
}

/** Cartão de etapa do stepper de PR (estado: 'active' | 'done' | ''). */
function stepCard(num, nome, estado) {
  const card = el('div', 'pr-step-card' + (estado ? ' ' + estado : ''));
  const ind = el('div', 'step-card-indicator');
  if (estado === 'active') ind.appendChild(el('span', 'spin-dot'));
  else if (estado === 'done') ind.textContent = '✓';
  else ind.textContent = String(num);
  const meta = el('div', 'step-card-meta');
  meta.append(el('span', 'step-card-num', 'ETAPA ' + num), el('span', 'step-card-name', nome));
  card.append(ind, meta);
  return card;
}

/** Estado "gerando": barra de status do PR no estilo do cockpit (spinner + barra
 * indeterminada + stepper das etapas reais do fluxo: Gerando → Proposta → PR
 * aberto). O tempo decorrido é REAL (conta pra cima); a barra é indeterminada —
 * não finge uma % de progresso que não existe. O ticker se auto-encerra quando o
 * badge sai do DOM (troca de estado / modal fecha), e renderEstadoProposta zera
 * o marco de início ao deixar o "gerando". */
function renderPropostaGerando(corpo) {
  if (corpo._prTimer) { clearInterval(corpo._prTimer); corpo._prTimer = null; }
  if (!corpo._prGerandoStart) corpo._prGerandoStart = Date.now();

  const box = el('div', 'pr-dispatch-loading-box');

  const hero = el('div', 'pr-load-hero');
  const orbit = el('div', 'pr-load-orbit');
  orbit.appendChild(el('div', 'pr-orbit-spinner'));
  const center = el('div', 'pr-orbit-center');
  center.innerHTML = ICONE_PR_ORBIT; // SVG estático
  orbit.appendChild(center);
  const info = el('div', 'pr-load-hero-info');
  const mainTitle = el('div', 'pr-load-main-title');
  const badge = el('span', 'pr-load-timer-badge', '0.0s');
  mainTitle.append(el('span', null, 'Gerando proposta de PR (AgentiX)'), badge);
  info.append(mainTitle, el('div', 'pr-load-stage-msg',
    'O agente está montando o diff no repositório — isso pode levar alguns minutos.'));
  hero.append(orbit, info);

  const wrap = el('div', 'pr-progress-wrapper');
  const labels = el('div', 'pr-progress-labels');
  const andamento = el('span', 'pr-andamento');
  andamento.append(el('span', 'spin-dot'), document.createTextNode('em andamento'));
  labels.append(el('span', 'pr-progress-state-text', 'Etapa 1 de 3 — síntese do patch pelo agente'), andamento);
  const track = el('div', 'pr-progress-bar-track indeterminada');
  const fill = el('div', 'pr-progress-bar-fill');
  fill.appendChild(el('div', 'pr-bar-shimmer-sweep'));
  track.appendChild(fill);
  wrap.append(labels, track);

  const stepper = el('div', 'pr-stepper-grid');
  stepper.append(
    stepCard(1, 'Gerando', 'active'),
    stepCard(2, 'Proposta', ''),
    stepCard(3, 'PR aberto', ''),
  );

  box.append(hero, wrap, stepper);
  corpo.replaceChildren(box);

  const tick = () => {
    if (!document.body.contains(badge)) { clearInterval(corpo._prTimer); corpo._prTimer = null; return; }
    badge.textContent = formatarDecorrido(Date.now() - corpo._prGerandoStart);
  };
  tick();
  corpo._prTimer = setInterval(tick, 100);
}

function renderPropostaErro(corpo, fingerprint, proposta) {
  corpo.replaceChildren();
  corpo.appendChild(el('div', 'ia-status falhou',
    '⚠ Falha ao gerar a proposta: ' + (proposta.motivo || 'motivo não informado')));
  const acoes = el('div', 'acoes');
  const btnRegenerar = el('button', 'ok', '🔁 Tentar novamente');
  confirmavel(btnRegenerar, 'Confirmar nova tentativa?', () => regenerarProposta(corpo, fingerprint, '', btnRegenerar));
  acoes.appendChild(btnRegenerar);
  corpo.appendChild(acoes);
}

/** Estado terminal: o agente decidiu que a remediação não cabe neste repo.
 * Mostra o motivo e permite descartar (para tentar outra remediação/edição). */
function renderPropostaNaoAplicavel(corpo, fingerprint, proposta) {
  corpo.replaceChildren();
  corpo.appendChild(el('div', 'ia-status',
    'ⓘ O agente considerou esta remediação inaplicável a este repositório: '
    + (proposta.motivo || 'motivo não informado') + '. Nenhum PR foi aberto.'));
  const acoes = el('div', 'acoes');
  const btnDescartar = el('button', 'perigo', '🗑 Descartar proposta');
  confirmavel(btnDescartar, 'Confirmar descarte da proposta?', () => descartarProposta(corpo, fingerprint, btnDescartar));
  acoes.appendChild(btnDescartar);
  corpo.appendChild(acoes);
}

/** Proposta pronta: resumo, diff por arquivo, contadores e ações. */
function renderPropostaPronta(corpo, fingerprint, proposta) {
  corpo.replaceChildren();
  corpo.appendChild(el('p', null, proposta.resumo || '(sem resumo)'));

  const arquivos = proposta.arquivos || [];
  const nArquivos = proposta.n_arquivos ?? arquivos.length;
  const nLinhas = proposta.n_linhas_diff ?? 0;
  const contadores = el('div', 'proposta-contadores');
  contadores.appendChild(el('span', 'tag', nArquivos + ' arquivo(s)'));
  contadores.appendChild(el('span', nLinhas > PROPOSTA_LINHAS_ALERTA ? 'tag nivel-ERROR' : 'tag', nLinhas + ' linha(s) de diff'));
  corpo.appendChild(contadores);

  if (arquivos.length) corpo.appendChild(el('h4', 'proposta-arquivos-titulo', 'Arquivos Alterados'));
  for (const arq of arquivos) corpo.appendChild(renderArquivoDiff(arq));

  const campoAjuste = el('div', 'campo');
  campoAjuste.hidden = true;
  const labelAjuste = el('label', null, 'instrução de ajuste para a regeneração (opcional)');
  labelAjuste.htmlFor = 'ajuste-proposta';
  const ajuste = Object.assign(el('textarea'), {
    id: 'ajuste-proposta', placeholder: 'ex.: use retry com backoff exponencial nesse arquivo',
  });
  campoAjuste.append(labelAjuste, ajuste);

  const acoes = el('div', 'acoes');
  const btnAprovar = el('button', 'ok', '✅ Aprovar e abrir PR');
  confirmavel(btnAprovar, 'Confirmar abertura do PR?', () => aprovarProposta(corpo, fingerprint, btnAprovar));
  const btnRegenerar = el('button', null, '🔁 Regenerar');
  const btnConfirmarRegenerar = el('button', 'ok', '🔁 Confirmar regeneração');
  btnConfirmarRegenerar.hidden = true;
  btnRegenerar.addEventListener('click', () => {
    campoAjuste.hidden = !campoAjuste.hidden;
    btnConfirmarRegenerar.hidden = campoAjuste.hidden;
  });
  btnConfirmarRegenerar.addEventListener('click', () =>
    regenerarProposta(corpo, fingerprint, ajuste.value.trim(), btnConfirmarRegenerar));
  // salvar sem gerar PR: vincula o caso à remediação selecionada e conclui,
  // sem aprovar/abrir o PR. Usa a remediação (staged ou committed) selecionada.
  const btnSalvarSemPr = el('button', null, '💾 Salvar sem gerar PR');
  btnSalvarSemPr.type = 'button';
  btnSalvarSemPr.addEventListener('click', () => {
    const rem = remSelecionada();
    salvarSemGerarPr(rem ? rem.id : null);
  });
  const btnDescartar = el('button', 'perigo', '🗑 Descartar proposta');
  confirmavel(btnDescartar, 'Confirmar descarte da proposta?', () => descartarProposta(corpo, fingerprint, btnDescartar));
  acoes.append(btnAprovar, btnRegenerar, btnConfirmarRegenerar, btnSalvarSemPr, btnDescartar);

  corpo.append(campoAjuste, acoes);
}

/** Chip de status do PR + link + fechar. Só recebe estados pr_* de PR ABERTO —
 * pr_rejeitado é roteado como "ausente" antes de chegar aqui (nunca mostrar a
 * rejeição). Qualquer outro pr_* é tratado como aberto (defensivo). */
function renderPropostaPr(corpo, fingerprint, proposta) {
  corpo.replaceChildren();
  const meta = el('div', 'meta');
  meta.appendChild(el('span', 'tag pr-aberto', '↗ PR aberto'));
  if (proposta.pr_numero != null) meta.appendChild(el('span', 'tag', '#' + proposta.pr_numero));
  if (proposta.pr_url) {
    meta.appendChild(Object.assign(el('a', 'link-modelo'), {
      href: proposta.pr_url, target: '_blank', rel: 'noopener noreferrer', textContent: 'ver PR ↗',
    }));
  }
  corpo.appendChild(meta);
  const acoes = el('div', 'acoes');
  const btnFechar = el('button', 'perigo', '✖ Fechar PR');
  confirmavel(btnFechar, 'Confirmar fechamento do PR?', () => fecharPr(corpo, fingerprint, btnFechar));
  acoes.appendChild(btnFechar);
  corpo.appendChild(acoes);
}

/** Diff de linhas simples (LCS) entre o conteúdo atual e o novo de um
 * arquivo. Devolve só as linhas alteradas (tipo '+' ou '-'); linhas iguais
 * (contexto) não entram no resultado. Acima do teto de custo, cai para um
 * diff bruto (tudo do atual como '-', tudo do novo como '+'). */
function diffLinhas(atual, novo) {
  const a = String(atual || '').split('\n');
  const b = String(novo || '').split('\n');
  const n = a.length, m = b.length;
  if (n * m > 200000) {
    return [...a.map((linha) => ({ tipo: '-', linha })), ...b.map((linha) => ({ tipo: '+', linha }))];
  }
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ tipo: '-', linha: a[i] }); i++; }
    else { out.push({ tipo: '+', linha: b[j] }); j++; }
  }
  while (i < n) { out.push({ tipo: '-', linha: a[i] }); i++; }
  while (j < m) { out.push({ tipo: '+', linha: b[j] }); j++; }
  return out;
}

// Rótulo/verbo por operação do arquivo na proposta. O verbo casa com o que o
// diff mostra: criar só tem linhas '+', excluir só tem '-', editar tem os dois.
const OP_ARQUIVO = {
  criar: { rotulo: 'Criar', verbo: 'adicionada' },
  editar: { rotulo: 'Editar', verbo: 'alterada' },
  excluir: { rotulo: 'Excluir', verbo: 'removida' },
};

/** Classifica a operação do arquivo para o rótulo: 'excluir' vem explícito do
 * agente; senão é 'criar' quando o arquivo ainda não existia (conteúdo atual
 * vazio) e 'editar' quando já existia. */
function classificarOperacaoArquivo(arq) {
  if (arq.operacao === 'excluir') return 'excluir';
  return String(arq.conteudo_atual || '').trim() === '' ? 'criar' : 'editar';
}

function renderArquivoDiff(arq) {
  const op = classificarOperacaoArquivo(arq);
  const meta = OP_ARQUIVO[op];
  const linhas = diffLinhas(arq.conteudo_atual, arq.conteudo_novo);
  const det = el('details', 'diff-arquivo op-' + op);
  const summary = el('summary');
  summary.appendChild(el('span', 'tag arq-op op-' + op, meta.rotulo));
  summary.appendChild(document.createTextNode(
    ' ' + arq.path + ' · ' + linhas.length + ' linha(s) ' + meta.verbo + '(s)'));
  det.appendChild(summary);
  const box = el('div', 'diff-linhas');
  if (linhas.length) {
    for (const l of linhas) {
      box.appendChild(el('div', 'diff-linha ' + (l.tipo === '+' ? 'diff-add' : 'diff-rem'), (l.tipo === '+' ? '+ ' : '- ') + l.linha));
    }
  } else {
    box.appendChild(el('div', 'diff-linha', '(sem alterações de linha detectadas)'));
  }
  det.appendChild(box);
  return det;
}

// Motivos de recusa da abertura de PR (código cru do MS8 → pt-BR acionável).
// O executor devolve um destes em vez de `pr_aberto`; sem tradução, o operador
// só via a sigla piscar no toast e some.
const MOTIVOS_APROVACAO = {
  credencial_ausente: 'O portão do GitHub está sem credencial (PAT). Arme o token na tela "Credencial" e aprove de novo.',
  erro_github: 'O portão do GitHub não concluiu a operação (indisponível, sem permissão, ou serviço/repositório de destino inexistente). Confira o serviço do caso e a credencial, e tente de novo.',
  erro_branch_orfa: 'Havia uma branch de uma tentativa anterior (órfã) que o portão apagou, mas o GitHub ainda não propagou a remoção a tempo de recriá-la. Costuma se resolver sozinho — aprove de novo em alguns segundos.',
  base_inexistente: 'A branch da run não existe mais no repositório. Escolha uma branch base para abrir o PR.',
  escopo_excedido: 'O diff excede o teto de segurança (arquivos ou linhas). Regenere com um escopo menor.',
  rate_limit: 'Limite de PRs por hora atingido no portão. Aguarde alguns minutos e tente de novo.',
  desligado: 'A abertura de PR está desligada (kill-switch/ENABLED). Habilite o executor de PR para abrir.',
};

/** Banner persistente com o motivo real da recusa, fixado no topo do corpo da
 * proposta (o toast some em 6s e o operador não vê por que "nada aconteceu"). */
function mostrarErroAprovacao(corpo, detail) {
  const chave = String(detail || '').trim();
  const msg = MOTIVOS_APROVACAO[chave] || ('Não foi possível abrir o PR: ' + (chave || 'erro desconhecido') + '.');
  let banner = corpo.querySelector('.aprovacao-erro');
  if (!banner) {
    banner = el('div', 'ia-status aprovacao-erro');
    corpo.insertBefore(banner, corpo.firstChild);
  }
  banner.textContent = '⚠ ' + msg;
  aviso(msg);
}

/** Coloca um botão em estado "carregando" (spinner + texto) e devolve uma
 * função que restaura o rótulo original. */
function mostrarCarregando(botao, texto) {
  const original = botao.textContent;
  botao.classList.add('carregando');
  botao.textContent = texto;
  return () => { botao.classList.remove('carregando'); botao.textContent = original; };
}

async function aprovarProposta(corpo, fingerprint, botao, base) {
  // trava TODAS as ações do corpo (a barra de baixo + o botão do seletor de
  // base) enquanto o PR abre — senão dá para disparar uma segunda aprovação
  // com o "Aprovar e abrir PR" ainda habilitado. Restaura só se falhar.
  const botoes = Array.from(corpo.querySelectorAll('button'));
  const reabilitar = botoes.filter((b) => !b.disabled);
  botoes.forEach((b) => { b.disabled = true; });
  const restaurarLabel = mostrarCarregando(botao, 'Abrindo o PR…');
  // no seletor de base (reaprovação) o card fica visível com o loading; na 1ª
  // tentativa limpa a recusa anterior.
  const banner = corpo.querySelector('.aprovacao-erro');
  if (banner && !base) banner.remove();
  try {
    await api.propostaAprovar(fingerprint, base);
    aviso('proposta aprovada — abrindo o PR', true);
    // este é o ÚNICO ponto onde um pr_* nasce nesta sessão: marca o PR como
    // aberto por ESTA sessão, para que renderEstadoProposta/ehDesfechoProposta o
    // reconheçam como o PR deste caso (e não o confundam com um herdado).
    if (modalPr) modalPr.prCriadoNestaSessao = true;
    const proposta = await api.propostaGet(fingerprint);
    if (selecionado !== fingerprint) return;
    renderEstadoProposta(corpo, fingerprint, proposta); // recria o corpo → botões novos
  } catch (e) {
    restaurarLabel();
    reabilitar.forEach((b) => { b.disabled = false; });
    // base sumida: em vez do banner genérico, oferece o seletor de branch base.
    if (String(e.message) === 'base_inexistente') { mostrarSeletorBase(corpo, fingerprint); return; }
    mostrarErroAprovacao(corpo, e.message);
  }
}

/** Card de recuperação quando a branch base do PR não existe mais: lista as
 * branches do repo e deixa o operador escolher contra qual abrir. Ao confirmar,
 * reaprova passando a base escolhida (override que tem precedência no BFF). */
async function mostrarSeletorBase(corpo, fingerprint) {
  let box = corpo.querySelector('.aprovacao-erro');
  if (!box) {
    box = el('div', 'ia-status aprovacao-erro');
    corpo.insertBefore(box, corpo.firstChild);
  }
  box.replaceChildren(el('div', 'seletor-base-titulo',
    '⚠ A branch da run não existe mais no repositório. Escolha a branch base do PR:'));
  let lista;
  try {
    lista = await api.propostaBranches(fingerprint);
  } catch (e) {
    box.appendChild(el('div', null, 'Não foi possível listar as branches: ' + e.message));
    return;
  }
  if (selecionado !== fingerprint) return;
  const branches = Array.isArray(lista && lista.branches) ? lista.branches : [];
  if (!branches.length) {
    box.appendChild(el('div', null, 'Nenhuma branch encontrada no repositório.'));
    return;
  }
  const grupo = el('label', 'sel-base-grupo');
  grupo.appendChild(el('span', 'sel-base-cap', 'branch base'));
  const sel = el('select', 'sel-base');
  for (const b of branches) sel.appendChild(el('option', null, b));
  grupo.appendChild(sel);
  const btn = el('button', 'ok', '↗ Abrir PR contra a selecionada');
  btn.type = 'button';
  btn.addEventListener('click', () => aprovarProposta(corpo, fingerprint, btn, sel.value));
  const linha = el('div', 'seletor-base');
  linha.append(grupo, btn);
  box.appendChild(linha);
}

async function regenerarProposta(corpo, fingerprint, instrucao, botao) {
  botao.disabled = true;
  try {
    await api.propostaRegenerar(fingerprint, instrucao ? { instrucao } : {});
    aviso('regeneração solicitada', true);
    renderPropostaGerando(corpo);
    aguardarProposta(fingerprint, corpo);
  } catch (e) { aviso(e.message); botao.disabled = false; }
}

async function descartarProposta(corpo, fingerprint, botao) {
  botao.disabled = true;
  try {
    await api.propostaExcluir(fingerprint);
    aviso('proposta descartada', true);
    renderPropostaAusente(corpo, fingerprint);
  } catch (e) { aviso(e.message); botao.disabled = false; }
}

async function fecharPr(corpo, fingerprint, botao) {
  botao.disabled = true;
  try {
    await api.propostaFecharPr(fingerprint);
    aviso('PR fechado', true);
    const proposta = await api.propostaGet(fingerprint);
    if (selecionado !== fingerprint) return;
    renderEstadoProposta(corpo, fingerprint, proposta);
  } catch (e) { aviso(e.message); botao.disabled = false; }
}

/** Poll silencioso enquanto a proposta está em 'gerando' — reusa o mesmo
 * intervalo/teto de aguardarRascunho (ver ali) para não inventar outro
 * ritmo de polling. Para ao sair do caso ou ao sair do estado 'gerando'. */
function aguardarProposta(fingerprint, corpo) {
  let tentativas = 0;
  const agendar = () => setTimeout(tick, ESPERA_RASCUNHO_INTERVALO_MS);
  async function tick() {
    if (selecionado !== fingerprint) return;
    tentativas += 1;
    let proposta;
    try { proposta = await api.propostaGet(fingerprint); }
    catch { proposta = null; } // falha transitória: tenta de novo até o teto
    if (selecionado !== fingerprint) return;
    if (!proposta || proposta.estado === 'gerando') {
      if (tentativas < ESPERA_RASCUNHO_MAX) agendar();
      else corpo.replaceChildren(el('div', 'ia-status',
        '⏳ A proposta está demorando mais que o normal — recarregue a página para conferir.'));
      return;
    }
    renderEstadoProposta(corpo, fingerprint, proposta);
  }
  agendar();
}

// --- Task 6: form guiado de cadastro de remediação no caso sem match ---

/** Cria uma seção rotulada e a anexa ao form; devolve o container da seção. */
function secao(form, titulo) {
  const s = el('div', 'form-secao');
  s.appendChild(el('h4', 'form-secao-titulo', titulo));
  form.appendChild(s);
  return s;
}

/** Linha de input de texto rotulada; devolve o <input>. */
function campoTexto(area, rotulo, valor) {
  const linha = el('label', 'form-linha');
  linha.appendChild(el('span', null, rotulo));
  const input = document.createElement('input');
  input.type = 'text';
  input.value = valor || '';
  linha.appendChild(input);
  area.appendChild(linha);
  return input;
}

/** Textarea rotulada (destaque); devolve o <textarea>. */
function campoTextarea(area, rotulo, placeholder) {
  const linha = el('label', 'form-linha form-hero');
  linha.appendChild(el('span', null, rotulo));
  const ta = document.createElement('textarea');
  ta.placeholder = placeholder || '';
  linha.appendChild(ta);
  area.appendChild(linha);
  return ta;
}

/** Título de PR sugerido a partir do nome. */
function tituloSugerido(nome) {
  const n = (nome || '').trim();
  return n ? 'chore: ' + n.charAt(0).toLowerCase() + n.slice(1) : 'chore: correção agentix';
}

/** Encurta a assinatura para a linha "Erro parecido com". */
function resumoAssinatura(assinatura) {
  const s = String(assinatura || '').replace(/\s+/g, ' ').trim();
  return s.length > 140 ? s.slice(0, 139) + '…' : (s || '(sem assinatura)');
}

/** <details> "💡 exemplos" que injeta um texto de exemplo na instrução. */
function exemplosInstrucao(areaInstr) {
  const d = document.createElement('details');
  d.className = 'form-exemplos';
  d.appendChild(el('summary', null, '💡 exemplos'));
  const ex = 'Incremente o último número da versão (patch) do manifesto do projeto — nunca a do parent nem de dependências.';
  const btn = el('button', 'link-exemplo', ex);
  btn.type = 'button';
  btn.onclick = () => { areaInstr.value = ex; };
  d.appendChild(btn);
  return d;
}

/** Escopo atual de uma remediação existente → 'este' | 'arquetipo' | 'qualquer'. */
function escopoDeRem(rem) {
  const ap = rem && rem.aplicabilidade;
  if (ap && ap.servicos && ap.servicos.length) return 'este';
  if (ap && ap.arquetipos && ap.arquetipos.length) return 'arquetipo';
  return 'qualquer';
}

/** Seletor de escopo (radios). "Qualquer serviço" vem marcado por padrão e é a
 * única opção visível de início; as duas mais restritivas (este serviço / este
 * arquétipo) só aparecem ao clicar "ver mais". marcadoInicial (opcional) força a
 * opção marcada ao editar — se for uma das restritivas, o bloco já nasce aberto.
 * Devolve { servicos(), arquetipos() }. */
function seletorEscopo(area, erro, marcadoInicial) {
  const grupo = el('div', 'form-escopo');
  const temServico = Boolean(erro.servico);
  const temTemplate = Boolean(erro.template);
  // "qualquer" primeiro (visível); as restritivas ficam ocultas até "ver mais".
  const opcoes = [
    ['qualquer', 'Qualquer serviço', true],
    ['este', 'Só este serviço' + (temServico ? ' (' + erro.servico + ')' : ''), temServico],
    ['arquetipo', 'Este arquétipo' + (erro.template ? ' (' + erro.template + ')' : ''), temTemplate],
  ];
  const radios = {};
  for (const [val, txt, disponivel] of opcoes) {
    const lab = el('label', 'form-radio');
    const r = document.createElement('input');
    r.type = 'radio'; r.name = 'escopo-rem'; r.value = val;
    r.disabled = !disponivel;
    lab.append(r, el('span', null, txt + (disponivel ? '' : ' (indisponível)')));
    if (val !== 'qualquer') { lab.classList.add('escopo-extra'); lab.hidden = true; } // revelado no "ver mais"
    grupo.appendChild(lab);
    radios[val] = r;
  }
  // seleção inicial: default = "qualquer"; ao editar, respeita o escopo salvo se
  // disponível (nunca marca um radio desabilitado).
  const inicial = (marcadoInicial && radios[marcadoInicial] && !radios[marcadoInicial].disabled)
    ? marcadoInicial : 'qualquer';
  radios[inicial].checked = true;

  // toggle "ver mais": revela/oculta as opções restritivas. Nasce aberto quando a
  // seleção inicial (edição) é uma delas — senão o usuário não veria o escopo atual.
  const verMais = el('button', 'form-vermais');
  verMais.type = 'button';
  let aberto = false;
  const setAberto = (on) => {
    aberto = on;
    grupo.querySelectorAll('.escopo-extra').forEach((n) => { n.hidden = !on; });
    verMais.textContent = on ? '▴ ver menos' : '▾ ver mais opções de escopo';
  };
  verMais.addEventListener('click', () => setAberto(!aberto));
  setAberto(inicial !== 'qualquer');

  area.append(grupo, verMais);
  const escolhido = () => (grupo.querySelector('input[name="escopo-rem"]:checked') || {}).value;
  return {
    servicos: () => (escolhido() === 'este' && erro.servico ? [erro.servico] : null),
    arquetipos: () => (escolhido() === 'arquetipo' && erro.template ? [erro.template] : null),
  };
}

/** Bloco <details> "Opções avançadas". rem (opcional) pré-preenche os campos ao
 * editar e trava o id (o vínculo de elegibilidade referencia id+versão; sem
 * update no MS8, editar é DELETE+POST no mesmo id). Devolve os inputs. */
function opcoesAvancadas(form, erro, assinatura, campoNome, rem) {
  const d = document.createElement('details');
  d.className = 'form-avancado';
  d.appendChild(el('summary', null, 'Opções avançadas (regex cru · manifestos · teto · id)'));
  const campoId = campoTexto(d, 'id (slug)',
    rem ? rem.id : idSugerido(erro.template || erro.servico || 'remediacao'));
  const campoAssin = campoTexto(d, 'assinatura (regex JS cru)',
    rem ? (rem.aplicabilidade && rem.aplicabilidade.assinatura_regex || '') : '(?i)' + escaparRegex(assinatura));
  const campoPaths = campoTexto(d, 'manifestos-candidato (vírgula)',
    rem ? (rem.escopo.paths_permitidos || []).join(', ') : MANIFESTOS_AGENTE.join(', '));
  const campoMaxArq = campoTexto(d, 'máx. arquivos', rem ? String(rem.escopo.max_arquivos) : '3');
  const campoMaxLinhas = campoTexto(d, 'máx. linhas de diff', rem ? String(rem.escopo.max_linhas_diff) : '40');
  const campoPre = campoTexto(d, 'pré-condições (; )', rem ? (rem.pre_condicoes || []).join('; ') : '');
  if (rem) {
    // id travado: preserva o vínculo (id+versão). Abre o avançado para o
    // curador ver o regex/manifestos que está editando.
    campoId.readOnly = true;
    campoId.dataset.tocado = '1';
    d.open = true;
  } else {
    // o id do avançado acompanha o nome enquanto o usuário não o edita à mão
    campoNome.addEventListener('input', () => {
      if (!campoId.dataset.tocado) campoId.value = idSugerido(campoNome.value || 'remediacao');
    });
    campoId.addEventListener('input', () => { campoId.dataset.tocado = '1'; });
  }
  form.appendChild(d);
  return { campoId, campoAssin, campoPaths, campoMaxArq, campoMaxLinhas, campoPre };
}

/** Form guiado (tela única): ① O que fazer · ② Quando aplicar · ③ Como aparece no PR.
 * opts.rem (opcional) = remediação existente → modo edição. Como o MS8 não tem
 * update e rejeita id duplicado (409), editar é DELETE+POST no mesmo id — o id
 * fica travado para preservar o vínculo de elegibilidade. Sem opts.rem, cadastra
 * uma nova remediação. O form assume o corpo do modal enquanto está aberto. */
async function abrirFormRemediacao(col, fingerprint, getAutor, opts = {}) {
  const rem = (opts && opts.rem) || null;
  const editando = Boolean(rem);
  // enquanto o form está aberto, o "OK, concluído" fica travado
  if (modalPr) { modalPr.formAberto = true; recomputarConcluir(); }

  let erro = {};
  try { erro = await api.caso(fingerprint); } catch { /* usa defaults vazios */ }
  if (selecionado !== fingerprint) return;

  // o form toma conta do corpo do modal: esconde elegibilidade + proposta
  col.querySelectorAll('.proposta-pr, .elegibilidade').forEach((n) => n.remove());

  const assinatura = erro.assinatura || '';
  const host = el('div', 'proposta-pr form-host');
  host.appendChild(el('h3', null, editando ? '✏ Editar remediação' : '➕ Nova remediação'));
  const form = el('div', 'form-remediacao');
  host.appendChild(form);

  // ① O que fazer
  const sec1 = secao(form, '① O que fazer');
  // ao editar, o "Nome" nasce do id da remediação (é dele que o id foi gerado) —
  // sem isso o campo aparece vazio e a edição parece não ter carregado nada.
  const campoNome = campoTexto(sec1, 'Nome', editando ? rem.id : '');
  const idHint = el('p', 'form-hint', editando ? 'id: ' + rem.id + ' (travado ao editar)' : 'id: ' + idSugerido('remediacao'));
  sec1.appendChild(idHint);
  const areaInstr = campoTextarea(sec1, 'O que o agente deve fazer (obrigatório)',
    'ex.: incremente o último número da versão (patch) do manifesto do projeto — nunca a do parent/dependências');
  areaInstr.maxLength = 2000; // casa ProporIn.instrucao @MaxLength(2000)
  if (editando) areaInstr.value = rem.instrucao || '';
  sec1.appendChild(exemplosInstrucao(areaInstr));

  // ② Quando aplicar
  const sec2 = secao(form, '② Quando aplicar');
  sec2.appendChild(el('p', 'form-hint', 'Erro parecido com: "' + resumoAssinatura(assinatura) + '"'));
  const escopo = seletorEscopo(sec2, erro, editando ? escopoDeRem(rem) : null);

  // ③ Como aparece no PR
  const sec3 = secao(form, '③ Como aparece no PR');
  const campoTitulo = campoTexto(sec3, 'Título', editando ? (rem.titulo_pr_template || tituloSugerido('')) : tituloSugerido(''));
  const campoDesc = campoTexto(sec3, 'Descrição (opcional)', editando ? (rem.descricao_acao || '') : '');
  if (editando) campoTitulo.dataset.tocado = '1'; // não deixa o Nome reescrever

  // avançado
  const { campoId, campoAssin, campoPaths, campoMaxArq, campoMaxLinhas, campoPre } =
    opcoesAvancadas(form, erro, assinatura, campoNome, rem);

  // nome dirige id (hint) e título sugerido, até o usuário editar cada um à mão.
  // Ao editar, o id é travado — o Nome só sugere o título se ainda não foi tocado.
  campoNome.addEventListener('input', () => {
    if (!editando) idHint.textContent = 'id: ' + idSugerido(campoNome.value || 'remediacao');
    if (!campoTitulo.dataset.tocado) campoTitulo.value = tituloSugerido(campoNome.value);
  });
  campoTitulo.addEventListener('input', () => { campoTitulo.dataset.tocado = '1'; });

  const erroBox = el('p', 'vazio');
  const salvar = el('button', 'botao', editando ? 'Salvar alterações' : 'Salvar');
  const cancelar = el('button', 'botao-secundario', 'Cancelar');
  cancelar.type = 'button';
  cancelar.onclick = () => recarregarAreaPr(col, fingerprint, getAutor);
  salvar.onclick = () => {
    erroBox.textContent = '';
    if (!areaInstr.value.trim()) {
      erroBox.textContent = 'Descreva o que o agente deve fazer — esse campo é obrigatório.';
      areaInstr.focus();
      return;
    }
    const paths = campoPaths.value.split(',').map((s) => s.trim()).filter(Boolean);
    const pre = campoPre.value.split(';').map((s) => s.trim()).filter(Boolean);
    const corpoReq = {
      id: (campoId.value.trim() || idSugerido(campoNome.value || 'remediacao')),
      versao: editando ? (rem.versao || '1') : '1',
      tipo_pr: 'agente',
      titulo_pr_template: campoTitulo.value.trim() || tituloSugerido(campoNome.value),
      // descricao_acao é @NotNull @Size(min=1) no MS8: nunca manda vazio — cai
      // para a instrução (sempre preenchida, valida antes do submit).
      descricao_acao: campoDesc.value.trim() || areaInstr.value.trim(),
      instrucao: areaInstr.value.trim(),
      escopo: {
        paths_permitidos: paths.length ? paths : MANIFESTOS_AGENTE.slice(),
        max_arquivos: Number(campoMaxArq.value) || 3,
        max_linhas_diff: Number(campoMaxLinhas.value) || 40,
      },
      // pre_condicoes também é @NotNull @Size(min=1) no MS8: sem entrada do
      // curador, cai para um default não-vazio em vez de [].
      pre_condicoes: pre.length ? pre : ['arquivo-alvo presente no repositório'],
      parametros_requeridos: [],
      exemplo_diff: EXEMPLO_DIFF_AGENTE,
      aplicabilidade: {
        assinatura_regex: campoAssin.value.trim(),
        arquetipos: escopo.arquetipos(),
        servicos: escopo.servicos(),
      },
    };
    // RASCUNHO: não grava no MS8 agora. Registra a criação/edição no rascunho e
    // volta à elegibilidade; a gravação (editar = DELETE+POST no mesmo id) só
    // acontece no Concluído. Erros de validação do MS8 aparecem lá.
    stageCadastro(editando ? rem : null, corpoReq);
    recarregarAreaPr(col, fingerprint, getAutor); // re-render: agora aparece na lista
  };
  const acoes = el('div', 'form-acoes');
  acoes.append(cancelar, salvar);
  form.append(acoes, erroBox);
  col.appendChild(host);
}

/** Remove os blocos da área de PR e re-monta (após cadastrar uma remediação). */
function recarregarAreaPr(col, fingerprint, getAutor) {
  col.querySelectorAll('.proposta-pr, .elegibilidade').forEach((n) => n.remove());
  montarAreaPr(col, fingerprint, getAutor);
}
