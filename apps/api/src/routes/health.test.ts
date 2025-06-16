import { describe, it, expect } from 'vitest';
import { buildServer } from '../server.js';

describe('GET /health', () => {
  it('returns 200 with { ok: true, version, commit }', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.version).toBe('string');
    expect(typeof body.commit).toBe('string');
    await app.close();
  });
});
