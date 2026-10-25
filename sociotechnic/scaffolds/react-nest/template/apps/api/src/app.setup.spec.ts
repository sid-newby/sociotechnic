import { DEFAULT_PORT, resolvePort } from './app.setup.js';

describe('resolvePort', () => {
  it('defaults when PORT is unset or blank', () => {
    expect(resolvePort(undefined)).toBe(DEFAULT_PORT);
    expect(resolvePort('')).toBe(DEFAULT_PORT);
    expect(resolvePort('  ')).toBe(DEFAULT_PORT);
  });

  it('accepts a valid port', () => {
    expect(resolvePort('4000')).toBe(4000);
  });

  it.each(['0', '-1', '65536', '3000.5', 'abc'])('rejects %s', (raw) => {
    expect(() => resolvePort(raw)).toThrow(/Invalid PORT/);
  });
});
