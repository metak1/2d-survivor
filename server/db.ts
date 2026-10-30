// The server's database: one SQLite file (DB_FILE; default data/nightfall.db) holding accounts,
// sign-in sessions, saved runs and the leaderboards. Uses Node's built-in node:sqlite (Node 22.13+).
//
// On first start it imports what older versions kept in JSON files (data/accounts.json,
// data/leaderboard.json, data/saves/*.json) and renames those to *.imported.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const FILE = resolve(process.env.DB_FILE || 'data/nightfall.db');

/** Each entry upgrades the schema by one version; never edit one that has shipped, add another. */
const MIGRATIONS: string[] = [
  `CREATE TABLE accounts (
     id TEXT PRIMARY KEY,
     username TEXT NOT NULL UNIQUE COLLATE NOCASE,
     salt TEXT NOT NULL,
     hash TEXT NOT NULL,
     created INTEGER NOT NULL,
     progress TEXT NOT NULL,          -- JSON: heirloom unlocks and the best run
     settings TEXT NOT NULL           -- JSON: display name, ...
   );
   CREATE TABLE sessions (
     token TEXT PRIMARY KEY,
     account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
     used INTEGER NOT NULL
   );
   CREATE INDEX sessions_account ON sessions(account);
   CREATE TABLE saves (
     id TEXT PRIMARY KEY,
     data TEXT NOT NULL,              -- JSON: the whole run (sim/save.ts)
     meta TEXT NOT NULL,              -- JSON: what lists of saves show
     updated INTEGER NOT NULL
   );
   CREATE TABLE account_saves (       -- which saved runs an account can resume
     account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
     save TEXT NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
     kind TEXT NOT NULL CHECK (kind IN ('solo', 'online')),
     added INTEGER NOT NULL,
     PRIMARY KEY (account, save)
   );
   CREATE INDEX account_saves_save ON account_saves(save);
   CREATE TABLE scores (
     id TEXT PRIMARY KEY,
     key TEXT NOT NULL,               -- lets whoever submitted an entry update it
     size INTEGER NOT NULL,
     players TEXT NOT NULL,           -- JSON: [{ name, cls, account? }]
     nights INTEGER NOT NULL,
     won INTEGER NOT NULL,
     progress REAL NOT NULL,
     kills INTEGER NOT NULL,
     time INTEGER NOT NULL,
     online INTEGER NOT NULL,
     date INTEGER NOT NULL
   );
   CREATE INDEX scores_rank ON scores(size, nights DESC, won DESC, progress DESC, kills DESC, time ASC);`,
];

function open(): DatabaseSync {
  mkdirSync(dirname(FILE), { recursive: true });
  const db = new DatabaseSync(FILE);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 2000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema').get() as { version: number } | undefined;
  let version = row?.version ?? 0;
  if (!row) db.prepare('INSERT INTO schema (version) VALUES (0)').run();
  for (; version < MIGRATIONS.length; version++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[version]);
      db.prepare('UPDATE schema SET version = ?').run(version + 1);
    });
  }
  importJson(db);
  return db;
}

/** Runs `fn` in a transaction (all of it, or none of it). */
export function transaction<T>(d: DatabaseSync, fn: () => T): T {
  d.exec('BEGIN');
  try {
    const out = fn();
    d.exec('COMMIT');
    return out;
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
}

// ----------------------------------------------------------------- importing old JSON files

function importJson(d: DatabaseSync): void {
  const dataDir = dirname(FILE);
  const read = (f: string) => JSON.parse(readFileSync(f, 'utf8'));
  const done = (f: string) => renameSync(f, f + '.imported');

  const saveDir = resolve(process.env.SAVE_DIR || join(dataDir, 'saves'));
  if (existsSync(saveDir)) {
    let n = 0;
    for (const f of readdirSync(saveDir).filter(x => /^[a-f0-9]{12,32}\.json$/.test(x))) {
      try {
        const s = read(join(saveDir, f));
        d.prepare('INSERT OR IGNORE INTO saves (id, data, meta, updated) VALUES (?, ?, ?, ?)')
          .run(f.slice(0, -5), JSON.stringify(s), JSON.stringify(s.meta ?? {}), s.meta?.savedAt ?? Date.now());
        done(join(saveDir, f));
        n++;
      } catch (err) { console.error(`db: couldn't import save ${f}:`, err); }
    }
    if (n) console.log(`db: imported ${n} saved run(s) from ${saveDir}`);
  }

  const accFile = resolve(process.env.ACCOUNTS_FILE || join(dataDir, 'accounts.json'));
  if (existsSync(accFile)) {
    try {
      const store = read(accFile) as {
        accounts: { id: string; username: string; salt: string; hash: string; created: number; progress: unknown; settings: unknown; saves: { id: string; kind: string }[] }[];
        sessions: { token: string; account: string; used: number }[];
      };
      transaction(d, () => {
        for (const a of store.accounts ?? []) {
          d.prepare('INSERT OR IGNORE INTO accounts (id, username, salt, hash, created, progress, settings) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(a.id, a.username, a.salt, a.hash, a.created, JSON.stringify(a.progress), JSON.stringify(a.settings));
          for (const s of a.saves ?? []) {
            d.prepare('INSERT OR IGNORE INTO account_saves (account, save, kind, added) SELECT ?, id, ?, ? FROM saves WHERE id = ?')
              .run(a.id, s.kind, Date.now(), s.id);
          }
        }
        for (const s of store.sessions ?? []) {
          d.prepare('INSERT OR IGNORE INTO sessions (token, account, used) SELECT ?, id, ? FROM accounts WHERE id = ?').run(s.token, s.used, s.account);
        }
      });
      done(accFile);
      console.log(`db: imported ${store.accounts?.length ?? 0} account(s) from ${accFile}`);
    } catch (err) { console.error(`db: couldn't import ${accFile}:`, err); }
  }

  const lbFile = resolve(process.env.LEADERBOARD_FILE || join(dataDir, 'leaderboard.json'));
  if (existsSync(lbFile)) {
    try {
      const entries = read(lbFile) as Record<string, unknown>[];
      transaction(d, () => {
        for (const e of entries) {
          d.prepare(`INSERT OR IGNORE INTO scores (id, key, size, players, nights, won, progress, kills, time, online, date)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(String(e.id), String(e.key), Number(e.size), JSON.stringify(e.players), Number(e.nights), e.won ? 1 : 0,
              Number(e.progress ?? 0), Number(e.kills), Number(e.time), e.online ? 1 : 0, Number(e.date));
        }
      });
      done(lbFile);
      console.log(`db: imported ${entries.length} leaderboard entr${entries.length === 1 ? 'y' : 'ies'} from ${lbFile}`);
    } catch (err) { console.error(`db: couldn't import ${lbFile}:`, err); }
  }
}

export const db = open();
