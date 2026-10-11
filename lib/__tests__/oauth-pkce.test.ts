import { describe, it, expect } from 'vitest';
import { generateCodeVerifier, generateCodeChallenge, generateState } from '../oauth/pkce';

describe('oauth/pkce', () => {
  describe('generateCodeVerifier', () => {
    it('returns a 43-character base64url string', () => {
      const verifier = generateCodeVerifier();
      expect(verifier).toHaveLength(43);
      expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('contains no base64 padding or unsafe characters', () => {
      for (let i = 0; i < 20; i++) {
        const verifier = generateCodeVerifier();
        expect(verifier).not.toMatch(/[+/=]/);
      }
    });

    it('generates unique values', () => {
      const a = generateCodeVerifier();
      const b = generateCodeVerifier();
      expect(a).not.toBe(b);
    });
  });

  describe('generateCodeChallenge', () => {
    it('returns a base64url string different from the verifier', async () => {
      const verifier = generateCodeVerifier();
      const challenge = await generateCodeChallenge(verifier);
      expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(challenge).not.toBe(verifier);
    });

    it('produces the RFC 7636 Appendix B test vector', async () => {
      const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      const challenge = await generateCodeChallenge(verifier);
      expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    });

    it('is deterministic for the same verifier', async () => {
      const verifier = generateCodeVerifier();
      const a = await generateCodeChallenge(verifier);
      const b = await generateCodeChallenge(verifier);
      expect(a).toBe(b);
    });
  });

  describe('generateState', () => {
    it('returns a 43-character base64url string', () => {
      const state = generateState();
      expect(state).toHaveLength(43);
      expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('generates unique values per call', () => {
      const a = generateState();
      const b = generateState();
      expect(a).not.toBe(b);
    });
  });
});
