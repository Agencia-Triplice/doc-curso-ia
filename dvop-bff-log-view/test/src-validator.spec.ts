import { validarSrc } from '../src/common/src-validator';

describe('validarSrc', () => {
  it('reconstrói só o essencial (descarta path/query/userinfo)', () => {
    expect(validarSrc('http://ms1:8000/v1/logs?x=1', '')).toBe('http://ms1:8000');
  });
  it('descarta userinfo (SSRF: credenciais/host embutidos pelo cliente não sobrevivem)', () => {
    expect(validarSrc('http://user:pass@ms1:8000/v1/logs', '')).toBe('http://ms1:8000');
  });
  it('rejeita esquema inválido → 422', () => {
    expect(() => validarSrc('ftp://x', '')).toThrow(/422|inválido/i);
  });
  it('allowlist por host', () => {
    expect(validarSrc('http://ms1:8000', 'ms1')).toBe('http://ms1:8000');
    expect(() => validarSrc('http://mau:8000', 'ms1')).toThrow();
  });
  it('allowlist por host:porta', () => {
    expect(validarSrc('http://ms1:8000', 'ms1:8000')).toBe('http://ms1:8000');
    expect(() => validarSrc('http://ms1:9999', 'ms1:8000')).toThrow();
  });
});
