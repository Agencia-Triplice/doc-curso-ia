import { el, aviso, confirmavel } from '../ui.js';
import { irPara } from '../router.js';
import { linkRun } from '../lib/run-link.js';
import { rotuloTemplate } from '../lib/template-label.js';
import { preencherElegibilidade } from '../lib/eleg-chip.js';
import * as api from '../api.js';

let selecionado = null; // guarda contra respostas fora de ordem

/** Origem do erro: de onde veio a curadoria. */
function blocoOrigem(sol) {
  const bloco = el('div', 'detalhe-bloco');
  bloco.appendChild(el('h3', null, 'Origem'));
  const meta = el('div', 'meta');
  meta.appendChild(el('span', 'tag template', rotuloTemplate(sol.template)));
  if (sol.servico) meta.appendChild(el('span', 'tag', sol.servico));
  if (sol.nivel) meta.appendChild(el('span', 'tag nivel-' + sol.nivel, sol.nivel));
  meta.appendChild(el('span', 'tag', sol.hits + ' hit(s)'));
  const run = linkRun(el, sol.run_url);
  if (run) meta.appendChild(run);
  bloco.appendChild(meta);
  bloco.appendChild(el('p', 'rodape',
    'ID ' + sol.fingerprint
    + (sol.criado_em ? ' · criada em ' + sol.criado_em : '')
    + (sol.atualizado_em ? ' · atualizada em ' + sol.atualizado_em : '')
    + (sol.aprovado_por ? ' · aprovada por ' + sol.aprovado_por : '')));
  return bloco;
}

/** Elegibilidade a PR: marcação manual (verde) OU match determinístico (âmbar). */
function blocoElegibilidade(sol) {
  const bloco = el('div', 'detalhe-bloco');
  bloco.appendChild(el('h3', null, 'Elegível a PR'));
  const corpo = el('div', 'eleg-corpo');
  bloco.appendChild(corpo);
  // preenche de forma assíncrona (consulta o match); o corpo já está no DOM
  preencherElegibilidade(el, corpo, sol, sol.fingerprint, () => selecionado === sol.fingerprint);
  return bloco;
}

export async function mount(container, params) {
  const fingerprint = params.fp;
  selecionado = fingerprint;
  const voltar = el('a', 'voltar btn-voltar', '← Cache');
  voltar.href = '#/cache';
  container.appendChild(voltar);

  let sol;
  try { sol = await api.solucao(fingerprint); }
  catch (e) {
    if (selecionado !== fingerprint) return;
    container.appendChild(el('p', 'vazio', 'solução indisponível: ' + e.message));
    return;
  }
  // o router reusa o mesmo #view: se a tela já mudou, nada desta montagem pode
  // entrar no DOM — senão os botões editar/excluir aparecem sobre outra tela
  if (selecionado !== fingerprint) return;

  container.appendChild(el('h2', null, sol.assinatura));
  container.appendChild(blocoOrigem(sol));
  container.appendChild(blocoElegibilidade(sol));

  // ------------------------------------------------------------- conteúdo
  const blocoTexto = el('div', 'detalhe-bloco');
  blocoTexto.appendChild(el('h3', null, 'Solução'));
  const texto = el('pre', 'conteudo-completo');
  texto.textContent = sol.solucao;
  blocoTexto.appendChild(texto);
  container.appendChild(blocoTexto);

  // --------------------------------------------------------------- ações
  const acoes = el('div', 'acoes');
  const btnEditar = el('button', 'primario', 'editar');
  const btnDevolver = el('button', 'perigo', 'devolver à fila');
  const btnExcluir = el('button', 'perigo', 'excluir definitivamente');
  acoes.append(btnEditar, btnDevolver, btnExcluir);
  container.appendChild(acoes);

  btnEditar.addEventListener('click', () => {
    const editor = el('textarea', 'editor');
    editor.value = sol.solucao;
    const salvar = el('button', 'primario', 'salvar');
    const cancelar = el('button', null, 'cancelar');
    const barra = el('div', 'acoes');
    barra.append(salvar, cancelar);
    blocoTexto.replaceChildren(el('h3', null, 'Solução'), editor, barra);
    acoes.style.display = 'none';

    cancelar.addEventListener('click', () => {
      blocoTexto.replaceChildren(el('h3', null, 'Solução'), texto);
      acoes.style.display = '';
    });
    salvar.addEventListener('click', async () => {
      salvar.disabled = true;
      try {
        const atualizada = await api.editarSolucao(fingerprint, { solucao: editor.value, autor: null });
        if (selecionado !== fingerprint) return; // saiu da tela durante o salvamento
        sol = atualizada;
        texto.textContent = atualizada.solucao;
        blocoTexto.replaceChildren(el('h3', null, 'Solução'), texto);
        acoes.style.display = '';
        aviso('solução atualizada', true);
      } catch (e) {
        aviso(e.message);
        salvar.disabled = false;
      }
    });
  });

  // dois cliques, sem confirm() nativo — e o texto nomeia a consequência exata
  confirmavel(btnDevolver, 'confirmar: volta para a fila', async () => {
    try {
      await api.excluirSolucao(fingerprint, true);
      if (selecionado !== fingerprint) return; // já está em outra tela: não a puxar de volta
      aviso('solução excluída — o erro voltou para a fila e a marcação de elegível a PR foi removida', true);
      irPara('#/cache');
    } catch (e) { aviso(e.message); }
  });

  confirmavel(btnExcluir, 'confirmar: apaga de vez', async () => {
    try {
      await api.excluirSolucao(fingerprint, false);
      if (selecionado !== fingerprint) return; // já está em outra tela: não a puxar de volta
      aviso('solução excluída definitivamente — o erro não voltou para a fila e a marcação de elegível a PR foi removida', true);
      irPara('#/cache');
    } catch (e) { aviso(e.message); }
  });
}
