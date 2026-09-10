import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export class ArenaStore {
  constructor(filename) {
    if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS launch (id INTEGER PRIMARY KEY CHECK(id=1), token_json TEXT NOT NULL, activated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS challenges (nonce TEXT PRIMARY KEY, address TEXT NOT NULL, round_id INTEGER NOT NULL, payload TEXT NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS challenges_expiry ON challenges(expires_at);
      CREATE TABLE IF NOT EXISTS entries (round_id INTEGER NOT NULL, address TEXT NOT NULL, registered_at INTEGER NOT NULL, balance TEXT NOT NULL, balance_block TEXT NOT NULL, balance_block_hash TEXT NOT NULL, message TEXT NOT NULL, signature TEXT NOT NULL, PRIMARY KEY(round_id,address));
    `);
  }
  launch() {
    const row = this.db.prepare('SELECT token_json, activated_at FROM launch WHERE id=1').get();
    return row ? { token: JSON.parse(row.token_json), activatedAt: row.activated_at } : null;
  }
  activate(token, now) {
    return this.transaction(() => {
      const existing = this.launch();
      if (existing) {
        if (existing.token.address !== token.address || existing.token.chainId !== token.chainId) throw Error('A different token is already active. The running competition cannot be reset by replacing a CA.');
        return existing;
      }
      this.db.prepare('INSERT INTO launch VALUES(1,?,?)').run(JSON.stringify(token), now);
      return this.launch();
    });
  }
  transaction(action) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = action(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  entry(roundId, address) {
    return this.db.prepare('SELECT round_id AS roundId, address, registered_at AS registeredAt FROM entries WHERE round_id=? AND address=?').get(roundId, address) ?? null;
  }
  count(roundId) { return this.db.prepare('SELECT COUNT(*) AS n FROM entries WHERE round_id=?').get(roundId).n; }
  saveChallenge(entry) {
    this.db.prepare('DELETE FROM challenges WHERE expires_at<=?').run(entry.issuedAt);
    this.db.prepare('INSERT INTO challenges(nonce,address,round_id,payload,expires_at) VALUES(?,?,?,?,?)')
      .run(entry.nonce, entry.address, entry.roundId, JSON.stringify(entry), entry.expiresAt);
  }
  challenge(nonce) {
    const row = this.db.prepare('SELECT payload, used FROM challenges WHERE nonce=?').get(nonce);
    return row ? { ...JSON.parse(row.payload), used: !!row.used } : null;
  }
  close() { this.db.close(); }
}
