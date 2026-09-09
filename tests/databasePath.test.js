import { describe, expect, it } from 'vitest';
import { resolveDatabasePath } from '../services/database.js';

describe('SQLite path isolation', () => {
  it('uses DATA_DIR when set so paper soaks do not reuse the default trading.db', () => {
    const { dataDir, dbPath } = resolveDatabasePath({ DATA_DIR: '/tmp/cryptotitan-paper' });
    expect(dataDir).toBe('/tmp/cryptotitan-paper');
    expect(dbPath).toBe('/tmp/cryptotitan-paper/trading.db');
  });
});
