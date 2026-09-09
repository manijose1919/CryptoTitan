import { describe, expect, it, afterEach } from 'vitest';
import { resolveDatabasePath } from '../services/database.js';
import { join } from 'node:path';

describe('resolveDatabasePath', () => {
  const prevDataDir = process.env.DATA_DIR;
  const prevSqlite = process.env.SQLITE_PATH;

  afterEach(() => {
    if (prevDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prevDataDir;
    if (prevSqlite === undefined) delete process.env.SQLITE_PATH;
    else process.env.SQLITE_PATH = prevSqlite;
  });

  it('defaults to data/trading.db under the repo', () => {
    delete process.env.DATA_DIR;
    delete process.env.SQLITE_PATH;
    expect(resolveDatabasePath().endsWith(join('data', 'trading.db'))).toBe(true);
  });

  it('honors DATA_DIR for isolated paper instances', () => {
    delete process.env.SQLITE_PATH;
    process.env.DATA_DIR = '/tmp/cryptotitan-paper-isolated';
    expect(resolveDatabasePath()).toBe('/tmp/cryptotitan-paper-isolated/trading.db');
  });

  it('honors SQLITE_PATH over DATA_DIR', () => {
    process.env.DATA_DIR = '/tmp/ignored';
    process.env.SQLITE_PATH = '/tmp/custom/paper.db';
    expect(resolveDatabasePath()).toBe('/tmp/custom/paper.db');
  });
});
