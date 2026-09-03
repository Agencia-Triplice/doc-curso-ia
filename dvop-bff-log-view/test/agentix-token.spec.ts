import { AgentixTokenProvider } from '../src/agentix/agentix-token.provider';

const form = (b: unknown, status = 200) => ({ status, ok: status < 400, json: async () => b } as unknown as Response);

describe('AgentixTokenProvider', () => {
  afterEach(() => (global.fetch as jest.Mock)?.mockReset?.());

  it('faz login e devolve api_key', async () => {
    global.fetch = jest.fn().mockResolvedValue(form({ api_key: 'k1', expires_in: 3600 }));
    const p = new AgentixTokenProvider({ loginUrl: 'http://sim/v2/api/auth/login', username: 'u', password: 's', timeoutMs: 1000 });
    expect(await p.token()).toBe('k1');
    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('http://sim/v2/api/auth/login');
    expect(opts.headers['content-type']).toBe('application/json');
    expect(JSON.parse(opts.body)).toEqual({ username: 'u', password: 's' });
  });

  it('login com cache até expirar', async () => {
    let t = 1000;
    global.fetch = jest.fn().mockResolvedValue(form({ api_key: 'A', expires_in: 300 }));
    const p = new AgentixTokenProvider({ loginUrl: 'http://sim/auth/login', username: 'u', password: 's', timeoutMs: 1000, now: () => t });
    expect(await p.token()).toBe('A');
    expect(await p.token()).toBe('A');                    // cache
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);
    t += 300;                                             // passou da validade
    global.fetch = jest.fn().mockResolvedValue(form({ api_key: 'B', expires_in: 300 }));
    expect(await p.token()).toBe('B');
  });

  it('renovação única sob concorrência', async () => {
    global.fetch = jest.fn().mockResolvedValue(form({ api_key: 'A', expires_in: 300 }));
    const p = new AgentixTokenProvider({ loginUrl: 'http://sim/auth/login', username: 'u', password: 's', timeoutMs: 1000 });
    await Promise.all([p.token(), p.token(), p.token()]);
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);
  });

  it('configurado é false quando faltam username/password', () => {
    expect(new AgentixTokenProvider({ loginUrl: 'http://sim/auth/login', username: '', password: '', timeoutMs: 1000 }).configurado).toBe(false);
    expect(new AgentixTokenProvider({ loginUrl: 'http://sim/auth/login', username: 'u', password: '', timeoutMs: 1000 }).configurado).toBe(false);
    expect(new AgentixTokenProvider({ loginUrl: 'http://sim/auth/login', username: '', password: 's', timeoutMs: 1000 }).configurado).toBe(false);
  });

  it('configurado é true quando username e password estão preenchidos', () => {
    const p = new AgentixTokenProvider({ loginUrl: 'http://sim/auth/login', username: 'u', password: 's', timeoutMs: 1000 });
    expect(p.configurado).toBe(true);
  });

  it('lança 502 quando o emissor recusa (HTTP >= 400), descartando o corpo, e a senha não vaza no erro', async () => {
    const jsonSpy = jest.fn(async () => ({ error: 'invalid_credentials', detail: 'segredo-super-secreto' }));
    global.fetch = jest.fn().mockResolvedValue({ status: 401, ok: false, json: jsonSpy } as unknown as Response);
    const p = new AgentixTokenProvider({ loginUrl: 'http://sim/auth/login', username: 'u', password: 'segredo-super-secreto', timeoutMs: 1000 });
    await expect(p.token()).rejects.toMatchObject({ statusCode: 502 });
    expect(jsonSpy).not.toHaveBeenCalled();
    try {
      await p.token();
    } catch (e) {
      expect((e as Error).message).not.toContain('segredo-super-secreto');
    }
  });

  it('lança 502 quando a resposta não é JSON válido', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => { throw new Error('corpo inválido'); },
    } as unknown as Response);
    const p = new AgentixTokenProvider({ loginUrl: 'http://sim/auth/login', username: 'u', password: 's', timeoutMs: 1000 });
    await expect(p.token()).rejects.toMatchObject({ statusCode: 502 });
  });

  it('lança 502 quando a resposta não tem api_key, e a senha não vaza na mensagem', async () => {
    global.fetch = jest.fn().mockResolvedValue(form({ expires_in: 300 }));
    const p = new AgentixTokenProvider({ loginUrl: 'http://sim/auth/login', username: 'u', password: 'minha-senha', timeoutMs: 1000 });
    await expect(p.token()).rejects.toMatchObject({ statusCode: 502 });
    global.fetch = jest.fn().mockResolvedValue(form({ expires_in: 300 }));
    try {
      await p.token();
    } catch (e) {
      expect((e as Error).message).not.toContain('minha-senha');
    }
  });

  it('lança 504 em timeout (AbortError)', async () => {
    global.fetch = jest.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const p = new AgentixTokenProvider({ loginUrl: 'http://sim/auth/login', username: 'u', password: 's', timeoutMs: 1000 });
    await expect(p.token()).rejects.toMatchObject({ statusCode: 504 });
  });

  it('lança 502 em falha de transporte (não-abort)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
    const p = new AgentixTokenProvider({ loginUrl: 'http://sim/auth/login', username: 'u', password: 's', timeoutMs: 1000 });
    await expect(p.token()).rejects.toMatchObject({ statusCode: 502 });
  });

  it('usa VALIDADE_PADRAO quando expires_in não é informado e renova depois de expirar', async () => {
    let t = 2000;
    global.fetch = jest.fn().mockResolvedValue(form({ api_key: 'X' }));
    const p = new AgentixTokenProvider({ loginUrl: 'http://sim/auth/login', username: 'u', password: 's', timeoutMs: 1000, now: () => t });
    expect(await p.token()).toBe('X');
    t += 31; // VALIDADE_PADRAO(60) - MARGEM(30) = 30s de cache; após 31s deve expirar
    global.fetch = jest.fn().mockResolvedValue(form({ api_key: 'Y', expires_in: 300 }));
    expect(await p.token()).toBe('Y');
  });

  it('renovar() faz double-check e reaproveita cache válido sem nova chamada de rede', async () => {
    const t = 1000;
    global.fetch = jest.fn().mockResolvedValue(form({ api_key: 'A', expires_in: 300 }));
    const p = new AgentixTokenProvider({ loginUrl: 'http://sim/auth/login', username: 'u', password: 's', timeoutMs: 1000, now: () => t });
    expect(await p.token()).toBe('A');
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);
    // chama o método privado diretamente com o cache ainda válido (mesmo "t"):
    // exercita o double-check dentro de renovar() sem nova requisição de rede.
    expect(await (p as unknown as { renovar(): Promise<string> }).renovar()).toBe('A');
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);
  });

  it('aciona o AbortController quando o timeout configurado é atingido', async () => {
    jest.useFakeTimers();
    try {
      global.fetch = jest.fn().mockImplementation(
        (_url: unknown, opts: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            opts.signal.addEventListener('abort', () => {
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            });
          }),
      );
      const p = new AgentixTokenProvider({ loginUrl: 'http://sim/auth/login', username: 'u', password: 's', timeoutMs: 50 });
      const pendente = expect(p.token()).rejects.toMatchObject({ statusCode: 504 });
      await jest.advanceTimersByTimeAsync(50);
      await pendente;
    } finally {
      jest.useRealTimers();
    }
  });
});
