import { el, aviso, confirmavel } from '../ui.js';
import { irPara } from '../router.js';
import { linkRun } from '../lib/run-link.js';
import { preencherElegibilidade } from '../lib/eleg-chip.js';
import * as api from '../api.js';

let selecionado = null; // guarda contra respostas fora de ordem

/** Origem do documento: de onde veio (pode ser anterior à coluna de origem). */
function blocoOrigem(doc) {
  const bloco = el('div', 'detalhe-bloco');
  bloco.appendChild(el('h3', null, 'Origem'));
  const meta = el('div', 'meta');
  if (doc.servico) meta.appendChild(el('span', 'tag', doc.servico));
  if (doc.nivel) meta.appendChild(el('span', 'tag nivel-' + doc.nivel, doc.nivel));
  for (const tag of doc.tags || []) meta.appendChild(el('span', 'tag', tag));
  const run = linkRun(el, doc.origem_run_url);
  if (run) meta.appendChild(run);
  bloco.appendChild(meta);
  // documento anterior à coluna de origem: "—", sem fingerprint clicável
  bloco.appendChild(el('p', 'rodape',
    'ID doc-' + doc.id
    + ' · erro de origem: ' + (doc.origem_fingerprint || '—')
    + (doc.criado_em ? ' · criado em ' + doc.criado_em : '')
    + (doc.aprovado_por ? ' · aprovado por ' + doc.aprovado_por : '')));
  return bloco;
}

/** Elegibilidade a PR do erro de origem: marcação manual (verde) OU match
 * determinístico (âmbar). Sem erro de origem, não há vínculo possível. */
function blocoElegibilidade(doc, estaVivo) {
  const bloco = el('div', 'detalhe-bloco');
  bloco.appendChild(el('h3', null, 'Elegível a PR'));
  const corpo = el('div', 'eleg-corpo');
  bloco.appendChild(corpo);
  preencherElegibilidade(el, corpo, doc, doc.origem_fingerprint, estaVivo, !doc.origem_fingerprint);
  return bloco;
}

export async function mount(container, params) {
  const id = params.id;
  selecionado = id;
  const voltar = el('a', 'voltar btn-voltar', '← Base');
  voltar.href = '#/base';
  container.appendChild(voltar);

  let doc;
  try { doc = await api.documento(id); }
  catch (e) {
    if (selecionado !== id) return;
    container.appendChild(el('p', 'vazio', 'documento indisponível: ' + e.message));
    return;
  }
  // o router reusa o mesmo #view: se a tela já mudou, nada desta montagem pode
  // entrar no DOM — senão os botões editar/excluir aparecem sobre outra tela
  if (selecionado !== id) return;

  const titulo = el('h2', null, doc.titulo);
  container.appendChild(titulo);
  const estaVivo = () => selecionado === id;
  let origem = blocoOrigem(doc);
  let elegibilidade = blocoElegibilidade(doc, estaVivo);
  container.append(origem, elegibilidade);

  const blocoTexto = el('div', 'detalhe-bloco');
  blocoTexto.appendChild(el('h3', null, 'Conteúdo'));
  const texto = el('pre', 'conteudo-completo');
  texto.textContent = doc.conteudo;
  blocoTexto.appendChild(texto);
  container.appendChild(blocoTexto);

  const acoes = el('div', 'acoes');
  const btnEditar = el('button', 'primario', 'editar');
  const btnExcluir = el('button', 'perigo', 'excluir');
  acoes.append(btnEditar, btnExcluir);
  container.appendChild(acoes);

  btnEditar.addEventListener('click', () => {
    const campoTitulo = Object.assign(el('input', 'campo'), { type: 'text', value: doc.titulo, placeholder: 'título' });
    const campoServico = Object.assign(el('input', 'campo'), { type: 'text', value: doc.servico || '', placeholder: 'serviço' });
    const campoNivel = Object.assign(el('input', 'campo'), { type: 'text', value: doc.nivel || '', placeholder: 'nível' });
    const campoTags = Object.assign(el('input', 'campo'), { type: 'text', value: (doc.tags || []).join(', '), placeholder: 'tags separadas por vírgula' });
    const editor = el('textarea', 'editor');
    editor.value = doc.conteudo;
    const salvar = el('button', 'primario', 'salvar');
    const cancelar = el('button', null, 'cancelar');
    const barra = el('div', 'acoes');
    barra.append(salvar, cancelar);
    blocoTexto.replaceChildren(el('h3', null, 'Conteúdo'),
      campoTitulo, campoServico, campoNivel, campoTags, editor, barra);
    acoes.style.display = 'none';

    const restaurar = () => {
      blocoTexto.replaceChildren(el('h3', null, 'Conteúdo'), texto);
      acoes.style.display = '';
    };
    cancelar.addEventListener('click', restaurar);
    salvar.addEventListener('click', async () => {
      salvar.disabled = true;
      try {
        const atualizado = await api.editarDocumento(id, {
          titulo: campoTitulo.value,
          conteudo: editor.value,
          servico: campoServico.value || null,
          nivel: campoNivel.value || null,
          tags: campoTags.value.split(',').map((t) => t.trim()).filter(Boolean),
        });
        if (selecionado !== id) return; // saiu da tela durante o salvamento
        doc = atualizado;
        titulo.textContent = doc.titulo;
        texto.textContent = doc.conteudo;
        const novaOrigem = blocoOrigem(doc);
        origem.replaceWith(novaOrigem);
        origem = novaOrigem;
        const novaElegibilidade = blocoElegibilidade(doc, estaVivo);
        elegibilidade.replaceWith(novaElegibilidade);
        elegibilidade = novaElegibilidade;
        restaurar();
        aviso('documento atualizado', true);
      } catch (e) {
        aviso(e.message);
        salvar.disabled = false;
      }
    });
  });

  // a base é complementar ao cache: excluir daqui não devolve erro à fila
  // nem mexe na elegibilidade — o erro segue curado
  confirmavel(btnExcluir, 'confirmar: sai da base', async () => {
    try {
      await api.excluirDocumento(id);
      if (selecionado !== id) return; // já está em outra tela: não a puxar de volta
      aviso('documento excluído da base de conhecimento', true);
      irPara('#/base');
    } catch (e) { aviso(e.message); }
  });
}
