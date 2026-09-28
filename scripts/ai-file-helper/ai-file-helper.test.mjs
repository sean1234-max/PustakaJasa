import { describe, it, expect } from 'vitest';
import { isAllowedRequest, sanitizeFolderName, PORT } from './ai-file-helper.mjs';

describe('isAllowedRequest', () => {
  const host = `127.0.0.1:${PORT}`;

  it('accepts the School Portal on loopback', () => {
    expect(isAllowedRequest({ host, origin: 'https://pustaka-jasa.vercel.app' })).toBe(true);
    expect(isAllowedRequest({ host: `localhost:${PORT}`, origin: 'http://localhost:5173' })).toBe(true);
  });

  it('refuses any other website', () => {
    expect(isAllowedRequest({ host, origin: 'https://evil.example' })).toBe(false);
  });

  it('refuses a request with no Origin (e.g. a DNS-rebound same-origin page)', () => {
    expect(isAllowedRequest({ host })).toBe(false);
  });

  it('refuses a request whose Host is not loopback (DNS rebinding)', () => {
    expect(isAllowedRequest({ host: `evil.example:${PORT}`, origin: 'https://pustaka-jasa.vercel.app' })).toBe(false);
  });
});

describe('sanitizeFolderName', () => {
  it('matches SEAN.jsx\'s own output-folder naming', () => {
    expect(sanitizeFolderName('(DWI-26090782) - SK TAMAN SERI PAGI')).toBe('(DWI-26090782) - SK TAMAN SERI PAGI');
    expect(sanitizeFolderName('a/b:c*')).toBe('a_b_c_');
    expect(sanitizeFolderName('..')).toBe('UNNAMED');
  });
});
