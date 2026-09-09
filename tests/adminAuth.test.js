import { describe, expect, it, afterEach } from 'vitest';
import { requireAdminAuth } from '../middleware/adminAuth.js';

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe('requireAdminAuth', () => {
  const prevKey = process.env.ADMIN_API_KEY;

  afterEach(() => {
    if (prevKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = prevKey;
  });

  it('rejects non-localhost requests without a matching admin key', () => {
    process.env.ADMIN_API_KEY = 'test-admin-secret';
    const req = { ip: '203.0.113.10', headers: {} };
    const res = mockRes();
    let nextCalled = false;
    requireAdminAuth(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('allows non-localhost requests with the correct X-API-Key', () => {
    process.env.ADMIN_API_KEY = 'test-admin-secret';
    const req = { ip: '203.0.113.10', headers: { 'x-api-key': 'test-admin-secret' } };
    const res = mockRes();
    let nextCalled = false;
    requireAdminAuth(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it('default-denies when ADMIN_API_KEY is unset on non-localhost', () => {
    delete process.env.ADMIN_API_KEY;
    const req = { ip: '203.0.113.10', headers: {} };
    const res = mockRes();
    let nextCalled = false;
    requireAdminAuth(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(503);
  });

  it('does not treat nginx→node localhost as trusted when X-Real-IP is set', () => {
    process.env.ADMIN_API_KEY = 'test-admin-secret';
    const req = {
      ip: '127.0.0.1',
      headers: { 'x-real-ip': '203.0.113.10' },
    };
    const res = mockRes();
    let nextCalled = false;
    requireAdminAuth(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('does not treat proxied X-Forwarded-For clients as localhost-exempt', () => {
    process.env.ADMIN_API_KEY = 'test-admin-secret';
    const req = {
      ip: '::ffff:127.0.0.1',
      headers: { 'x-forwarded-for': '198.51.100.20, 127.0.0.1' },
    };
    const res = mockRes();
    let nextCalled = false;
    requireAdminAuth(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('still allows true same-machine localhost without a proxy header', () => {
    process.env.ADMIN_API_KEY = 'test-admin-secret';
    const req = { ip: '127.0.0.1', headers: {} };
    const res = mockRes();
    let nextCalled = false;
    requireAdminAuth(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });
});
