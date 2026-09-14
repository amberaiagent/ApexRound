import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { normalizeAddress } from '../scripts/lib/token-inspection.mjs';

export class ArenaStore {
  constructor(filename) {
    if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filename);
    this.inTransaction = false;
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      PRAGMA busy_timeout=5000;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS launch (id INTEGER PRIMARY KEY CHECK(id=1), token_json TEXT NOT NULL, activated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS challenges (nonce TEXT PRIMARY KEY, address TEXT NOT NULL, round_id INTEGER NOT NULL, payload TEXT NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS challenges_expiry ON challenges(expires_at);
      CREATE TABLE IF NOT EXISTS entries (round_id INTEGER NOT NULL, address TEXT NOT NULL, registered_at INTEGER NOT NULL, balance TEXT NOT NULL, balance_block TEXT NOT NULL, balance_block_hash TEXT NOT NULL, message TEXT NOT NULL, signature TEXT NOT NULL, PRIMARY KEY(round_id,address));
      CREATE TABLE IF NOT EXISTS retired_launches (id INTEGER PRIMARY KEY, token_address TEXT NOT NULL COLLATE NOCASE, chain_id INTEGER NOT NULL, token_json TEXT NOT NULL, activated_at INTEGER NOT NULL, retired_at INTEGER NOT NULL, UNIQUE(chain_id,token_address));
      CREATE TABLE IF NOT EXISTS retired_entries (archive_id INTEGER NOT NULL, round_id INTEGER NOT NULL, address TEXT NOT NULL, registered_at INTEGER NOT NULL, balance TEXT NOT NULL, balance_block TEXT NOT NULL, balance_block_hash TEXT NOT NULL, message TEXT NOT NULL, signature TEXT NOT NULL, PRIMARY KEY(archive_id,round_id,address), FOREIGN KEY(archive_id) REFERENCES retired_launches(id));
      CREATE TABLE IF NOT EXISTS retired_challenges (archive_id INTEGER NOT NULL, nonce TEXT NOT NULL, address TEXT NOT NULL, round_id INTEGER NOT NULL, payload TEXT NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL, PRIMARY KEY(archive_id,nonce), FOREIGN KEY(archive_id) REFERENCES retired_launches(id));
    `);
  }
  launch() {
    const row = this.db.prepare('SELECT token_json, activated_at FROM launch WHERE id=1').get();
    return row ? { token: JSON.parse(row.token_json), activatedAt: row.activated_at } : null;
  }
  activate(token, now) {
    return this.transaction(() => {
      if (this.isRetired(token.address, token.chainId)) throw Error('This token was retired and cannot be activated again. Supply a new final contract address.');
      const existing = this.launch();
      if (existing) {
        if (existing.token.address !== token.address || existing.token.chainId !== token.chainId) throw Error('A different token is already active. The running competition cannot be reset by replacing a CA.');
        return existing;
      }
      if (this.db.prepare('SELECT EXISTS(SELECT 1 FROM entries) OR EXISTS(SELECT 1 FROM challenges) AS present').get().present) {
        throw Error('Active registration data exists without a launch. Refusing to carry it into a new token.');
      }
      this.db.prepare('INSERT INTO launch VALUES(1,?,?)').run(JSON.stringify(token), now);
      return this.launch();
    });
  }
  isRetired(address, chainId) {
    return !!this.db.prepare('SELECT 1 FROM retired_launches WHERE token_address=? AND chain_id=?').get(normalizeAddress(address), chainId);
  }
  retirement(row, alreadyRetired) {
    return {
      archiveId: row.id, token: JSON.parse(row.token_json), activatedAt: row.activated_at,
      retiredAt: row.retired_at, alreadyRetired,
      entriesArchived: this.db.prepare('SELECT COUNT(*) AS n FROM retired_entries WHERE archive_id=?').get(row.id).n,
      challengesArchived: this.db.prepare('SELECT COUNT(*) AS n FROM retired_challenges WHERE archive_id=?').get(row.id).n,
    };
  }
  retire(expectedAddress, now = Date.now()) {
    const address = normalizeAddress(expectedAddress);
    if (!Number.isSafeInteger(now) || now < 0) throw Error('Invalid retirement timestamp.');
    return this.transaction(() => {
      const row = this.db.prepare('SELECT token_json, activated_at FROM launch WHERE id=1').get();
      if (!row) {
        const retired = this.db.prepare('SELECT * FROM retired_launches WHERE token_address=? ORDER BY retired_at DESC, id DESC LIMIT 1').get(address);
        if (!retired) throw Error('There is no active launch matching this contract address.');
        return this.retirement(retired, true);
      }
      const token = JSON.parse(row.token_json);
      if (normalizeAddress(token.address) !== address) throw Error('The active token does not match the expected contract address. Nothing was retired.');
      if (now < row.activated_at) throw Error('Retirement cannot precede activation.');
      const archiveId = this.db.prepare('INSERT INTO retired_launches(token_address,chain_id,token_json,activated_at,retired_at) VALUES(?,?,?,?,?)')
        .run(address, token.chainId, row.token_json, row.activated_at, now).lastInsertRowid;
      // Preserve signed bytes and raw challenge payloads before clearing active data.
      this.db.prepare('INSERT INTO retired_entries SELECT ?,round_id,address,registered_at,balance,balance_block,balance_block_hash,message,signature FROM entries').run(archiveId);
      this.db.prepare('INSERT INTO retired_challenges SELECT ?,nonce,address,round_id,payload,expires_at,used FROM challenges').run(archiveId);
      this.db.exec('DELETE FROM challenges; DELETE FROM entries; DELETE FROM launch;');
      return this.retirement(this.db.prepare('SELECT * FROM retired_launches WHERE id=?').get(archiveId), false);
    });
  }
  transaction(action) {
    return this.runTransaction(action, 'BEGIN IMMEDIATE');
  }
  snapshot(action) {
    // An API response must not mix two launches when a separate operator process retires one.
    return this.inTransaction ? action() : this.runTransaction(action, 'BEGIN');
  }
  runTransaction(action, begin) {
    if (this.inTransaction) throw Error('Nested write transaction is not supported.');
    this.db.exec(begin);
    this.inTransaction = true;
    try { const result = action(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
    finally { this.inTransaction = false; }
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
