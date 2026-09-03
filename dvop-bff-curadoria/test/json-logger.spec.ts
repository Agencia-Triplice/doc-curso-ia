import { logJson } from '../src/common/json-logger';

describe('logJson', () => {
  it('emite logger "dvop-bff-curadoria" no JSON de saída', () => {
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      logJson('info', 'ping');
      const linha = String(writeSpy.mock.calls[0][0]);
      const payload = JSON.parse(linha);
      expect(payload.logger).toBe('dvop-bff-curadoria');
      expect(payload.level).toBe('INFO');
      expect(payload.message).toBe('ping');
    } finally {
      writeSpy.mockRestore();
    }
  });
});
