import { describe, expect, it } from 'vitest';
import { requireAdminAuth } from '../middleware/adminAuth.js';

function mockRes() {
  const res = {
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
  return res;
}

describe('requireAdminAuth', () => {
  it('rejects remote flag mutation without a matching admin key', () => {
    const prev = process.env.ADMIN_API_KEY;
    process.env.ADMIN_API_KEY = 'test-admin-key';
    try {
      const req = { ip: '203.0.113.10', headers: {} };
      const res = mockRes();
      let nextCalled = false;
      requireAdminAuth(req, res, () => {
        nextCalled = true;
      });
      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(401);
    } finally {
      if (prev === undefined) delete process.env.ADMIN_API_KEY;
      else process.env.ADMIN_API_KEY = prev;
    }
  });

  it('default-denies remote callers when ADMIN_API_KEY is unset', () => {
    const prev = process.env.ADMIN_API_KEY;
    delete process.env.ADMIN_API_KEY;
    try {
      const req = { ip: '203.0.113.10', headers: {} };
      const res = mockRes();
      requireAdminAuth(req, res, () => {});
      expect(res.statusCode).toBe(503);
    } finally {
      if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
    }
  });
});
