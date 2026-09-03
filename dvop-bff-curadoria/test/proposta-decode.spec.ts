import {
  decodificarProposta,
  contarLinhasDiff,
  dentroDoTeto,
  selecionarCandidatos,
  referenciasDeArquivo,
} from '../src/propostas/proposta-decode';

describe('selecionarCandidatos', () => {
  it('usa paths manuais quando dados', () => {
    expect(selecionarCandidatos('erro qualquer', undefined, ['src/x.ts'])).toEqual(['src/x.ts']);
  });

  it('cai nos manifestos quando sem paths', () => {
    expect(selecionarCandidatos('npm error 400').includes('package.json')).toBe(true);
  });

  it('dedup paths manuais repetidos', () => {
    expect(selecionarCandidatos('x', undefined, ['src/x.ts', 'src/x.ts'])).toEqual(['src/x.ts']);
  });

  it('une os arquivos citados na instrução aos manifestos', () => {
    const c = selecionarCandidatos('npm error 400', 'adicionar data no readme e dep no pom');
    expect(c).toContain('README.md');
    expect(c).toContain('pom.xml');
    expect(c).toContain('package.json'); // manifesto comum continua presente
  });

  it('une os arquivos da instrução mesmo com paths manuais (escopo cadastrado)', () => {
    const c = selecionarCandidatos(
      'erro',
      'atualizar o readme com a data de hoje',
      ['pom.xml', 'package.json'],
    );
    expect(c).toContain('README.md');
    expect(c).toContain('pom.xml');
    expect(c).toContain('package.json');
  });

  it('dedup entre path manual e apelido da instrução', () => {
    const c = selecionarCandidatos('erro', 'mexe no pom', ['pom.xml']);
    expect(c.filter((p) => p === 'pom.xml')).toHaveLength(1);
  });
});

describe('referenciasDeArquivo', () => {
  it('vazio para instrução ausente ou em branco', () => {
    expect(referenciasDeArquivo(undefined)).toEqual([]);
    expect(referenciasDeArquivo('   ')).toEqual([]);
  });

  it('extrai caminho literal com extensão', () => {
    expect(referenciasDeArquivo('edite o src/App.java e o config.yaml')).toEqual(
      expect.arrayContaining(['src/App.java', 'config.yaml']),
    );
  });

  it('resolve apelidos comuns sem extensão', () => {
    expect(referenciasDeArquivo('atualizar readme e o dockerfile')).toEqual(
      expect.arrayContaining(['README.md', 'Dockerfile']),
    );
  });

  it('apelido só casa palavra inteira (não dentro de outra)', () => {
    // "compomos" não deve virar pom.xml
    expect(referenciasDeArquivo('nós compomos a release')).not.toContain('pom.xml');
  });

  it('dedup entre literal e apelido do mesmo arquivo', () => {
    const refs = referenciasDeArquivo('mexe no pom.xml, isto é, no pom');
    expect(refs.filter((p) => p === 'pom.xml')).toHaveLength(1);
  });
});

describe('decodificarProposta', () => {
  it('decodifica JSON em cerca markdown', () => {
    const bruto =
      '```json\n{"resumo":"r","titulo":"t","corpo":"c","arquivos":[{"path":"p","conteudo_novo":"x"}]}\n```';
    const d = decodificarProposta(bruto)!;
    expect(d.titulo).toBe('t');
    expect(d.arquivos[0].path).toBe('p');
  });

  it('rejeita sem titulo', () => {
    expect(decodificarProposta('{"corpo":"c","arquivos":[]}')).toBeNull();
  });

  it('decodifica proposta via base64', () => {
    const payload = {
      resumo: 'r2',
      titulo: 't2',
      corpo: 'c2',
      arquivos: [{ path: 'a/b.ts', conteudo_novo: 'y' }],
    };
    const bruto = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64');
    const d = decodificarProposta(bruto)!;
    expect(d.titulo).toBe('t2');
    expect(d.arquivos[0].path).toBe('a/b.ts');
  });

  it('rejeita entrada não-string', () => {
    expect(decodificarProposta(undefined)).toBeNull();
    expect(decodificarProposta(null)).toBeNull();
  });

  it('rejeita quando arquivos não é array', () => {
    expect(
      decodificarProposta('{"titulo":"t","corpo":"c","arquivos":"nope"}'),
    ).toBeNull();
  });

  it('rejeita quando item de arquivos tem shape inválido', () => {
    expect(
      decodificarProposta('{"titulo":"t","corpo":"c","arquivos":[{"path":"p"}]}'),
    ).toBeNull();
  });

  it('rejeita proposta com arquivos vazio (zero arquivos não é proposta válida)', () => {
    expect(
      decodificarProposta('{"titulo":"t","corpo":"c","arquivos":[]}'),
    ).toBeNull();
  });

  it('aplica ausente vira true (compat legado)', () => {
    const bruto = JSON.stringify({
      titulo: 't', corpo: 'c', arquivos: [{ path: 'pom.xml', conteudo_novo: 'x' }],
    });
    const dec = decodificarProposta(bruto);
    expect(dec?.aplica).toBe(true);
  });

  it('aplica:false é preservado', () => {
    const bruto = JSON.stringify({
      aplica: false, titulo: 't', corpo: 'c',
      arquivos: [{ path: 'pom.xml', conteudo_novo: 'x' }],
    });
    const dec = decodificarProposta(bruto);
    expect(dec?.aplica).toBe(false);
  });

  it('aplica:false com arquivos:[] e titulo/corpo "n/a" (shape real do agente) decodifica válido', () => {
    const bruto = JSON.stringify({
      aplica: false,
      resumo: 'sem <version> próprio (herdado do parent)',
      titulo: 'n/a',
      corpo: 'n/a',
      arquivos: [],
    });
    const dec = decodificarProposta(bruto);
    expect(dec).not.toBeNull();
    expect(dec?.aplica).toBe(false);
    expect(dec?.arquivos).toHaveLength(0);
    expect(dec?.resumo).toBe('sem <version> próprio (herdado do parent)');
  });

  it('operacao ausente vira "editar" e conteudo_novo é preservado', () => {
    const bruto = JSON.stringify({
      titulo: 't', corpo: 'c', arquivos: [{ path: 'pom.xml', conteudo_novo: 'x' }],
    });
    const dec = decodificarProposta(bruto)!;
    expect(dec.arquivos[0].operacao).toBe('editar');
    expect(dec.arquivos[0].conteudo_novo).toBe('x');
  });

  it('operacao:excluir é válida SEM conteudo_novo (o arquivo será removido)', () => {
    const bruto = JSON.stringify({
      titulo: 't', corpo: 'c', arquivos: [{ path: 'velho.txt', operacao: 'excluir' }],
    });
    const dec = decodificarProposta(bruto)!;
    expect(dec.arquivos[0].operacao).toBe('excluir');
    expect(dec.arquivos[0].conteudo_novo).toBe('');
  });

  it('operacao:excluir preserva o path e ignora conteudo eventual', () => {
    const bruto = JSON.stringify({
      titulo: 't', corpo: 'c',
      arquivos: [{ path: 'a.txt', operacao: 'excluir', conteudo_novo: 'lixo' }],
    });
    const dec = decodificarProposta(bruto)!;
    expect(dec.arquivos[0].operacao).toBe('excluir');
  });

  it('rejeita path vazio', () => {
    const bruto = JSON.stringify({
      titulo: 't', corpo: 'c', arquivos: [{ path: '  ', conteudo_novo: 'x' }],
    });
    expect(decodificarProposta(bruto)).toBeNull();
  });

  it('rejeita operacao desconhecida', () => {
    const bruto = JSON.stringify({
      titulo: 't', corpo: 'c',
      arquivos: [{ path: 'a.txt', operacao: 'renomear', conteudo_novo: 'x' }],
    });
    expect(decodificarProposta(bruto)).toBeNull();
  });

  it('criar = editar com conteudo (o executor cria quando o arquivo não existe)', () => {
    const bruto = JSON.stringify({
      titulo: 't', corpo: 'c',
      arquivos: [{ path: 'teste.properties', conteudo_novo: 'teste', operacao: 'editar' }],
    });
    const dec = decodificarProposta(bruto)!;
    expect(dec.arquivos[0].operacao).toBe('editar');
    expect(dec.arquivos[0].conteudo_novo).toBe('teste');
  });
});

describe('contarLinhasDiff', () => {
  it('conta add+rem', () => {
    expect(contarLinhasDiff('a\nb', 'a\nc')).toBe(2); // -b +c
  });
});

describe('dentroDoTeto', () => {
  it('sinaliza estouro', () => {
    const r = dentroDoTeto(
      [{ path: 'p', conteudo_atual: 'a', conteudo_novo: 'a\nb\nc\nd', operacao: 'editar' }],
      3,
      2,
    );
    expect(r.ok).toBe(false);
  });

  it('ok quando dentro do teto', () => {
    const r = dentroDoTeto(
      [{ path: 'p', conteudo_atual: 'a', conteudo_novo: 'a\nb', operacao: 'editar' }],
      5,
      10,
    );
    expect(r.ok).toBe(true);
    expect(r.nArquivos).toBe(1);
  });

  it('exclusão (conteudo_novo vazio) conta como remoção total do arquivo', () => {
    const r = dentroDoTeto(
      [{ path: 'p', conteudo_atual: 'l1\nl2\nl3', conteudo_novo: '', operacao: 'excluir' }],
      5,
      10,
    );
    expect(r.ok).toBe(true);
    // 3 removidas + 1 (o '' vira uma linha vazia) — mesma semântica do
    // linhasDiff do MS8, então BFF e MS8 contam igual.
    expect(r.nLinhas).toBe(4);
  });
});
