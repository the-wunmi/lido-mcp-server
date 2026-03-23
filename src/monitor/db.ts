import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { monitorConfig, normalizeAddress } from "./config.js";
import type { VaultWatch, VaultSnapshot, VaultAlert, AlertRule, AlertContext, VaultType, ProtocolAllocation } from "./types.js";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) throw new Error("Database not open. Call openDb() first.");
  return db;
}

export function openDb(pathOverride?: string): void {
  if (db) return;

  let dbPath: string;
  if (pathOverride) {
    dbPath = pathOverride;
  } else {
    const dir = resolve(monitorConfig.dataDir);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    dbPath = join(dir, "monitor.db");
  }

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS watches (
      address   TEXT PRIMARY KEY,
      name      TEXT NOT NULL,
      added_at  INTEGER NOT NULL,
      recipient TEXT,
      vault_type TEXT NOT NULL DEFAULT 'erc4626'
    );

    CREATE TABLE IF NOT EXISTS rules (
      id          TEXT PRIMARY KEY,
      watch_addr  TEXT NOT NULL REFERENCES watches(address) ON DELETE CASCADE,
      expression  TEXT NOT NULL,
      severity    TEXT NOT NULL,
      message     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      address          TEXT PRIMARY KEY REFERENCES watches(address) ON DELETE CASCADE,
      name             TEXT NOT NULL,
      apr              REAL,
      tvl              TEXT NOT NULL,
      tvl_raw          TEXT NOT NULL,
      share_price      TEXT NOT NULL,
      timestamp        INTEGER NOT NULL,
      asset_decimals   INTEGER NOT NULL,
      asset_symbol     TEXT NOT NULL,
      allocations_json TEXT
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id       TEXT NOT NULL,
      severity      TEXT NOT NULL,
      vault_address TEXT NOT NULL,
      vault_name    TEXT NOT NULL,
      message       TEXT NOT NULL,
      context_json  TEXT NOT NULL,
      timestamp     INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dedup (
      key       TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL
    );
  `);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function insertWatch(watch: VaultWatch): void {
  const d = getDb();
  const insertW = d.prepare(
    "INSERT INTO watches (address, name, added_at, recipient, vault_type) VALUES (?, ?, ?, ?, ?)"
  );
  const insertR = d.prepare(
    "INSERT INTO rules (id, watch_addr, expression, severity, message) VALUES (?, ?, ?, ?, ?)"
  );

  d.transaction(() => {
    insertW.run(normalizeAddress(watch.address), watch.name, watch.addedAt, watch.recipient ?? null, watch.vaultType ?? "erc4626");
    for (const rule of watch.rules) {
      insertR.run(rule.id, normalizeAddress(watch.address), rule.expression, rule.severity, rule.message);
    }
  })();
}

export function deleteWatch(address: string): void {
  getDb().prepare("DELETE FROM watches WHERE address = ?").run(normalizeAddress(address));
}

export function updateRecipient(address: string, recipient: string): void {
  getDb()
    .prepare("UPDATE watches SET recipient = ? WHERE address = ?")
    .run(recipient, normalizeAddress(address));
}

export function loadWatch(address: string): VaultWatch | undefined {
  const d = getDb();
  const normalAddr = normalizeAddress(address);

  const row = d.prepare("SELECT address, name, added_at, recipient, vault_type FROM watches WHERE address = ?").get(normalAddr) as {
    address: string;
    name: string;
    added_at: number;
    recipient: string | null;
    vault_type: string | null;
  } | undefined;

  if (!row) return undefined;

  const ruleRows = d.prepare("SELECT id, expression, severity, message FROM rules WHERE watch_addr = ?").all(normalAddr) as Array<{
    id: string;
    expression: string;
    severity: string;
    message: string;
  }>;

  return {
    address: row.address as `0x${string}`,
    name: row.name,
    rules: ruleRows.map((r) => ({
      id: r.id,
      expression: r.expression,
      severity: r.severity as AlertRule["severity"],
      message: r.message,
    })),
    addedAt: row.added_at,
    recipient: row.recipient,
    vaultType: row.vault_type as VaultType | null,
  };
}

export function loadAllWatches(): VaultWatch[] {
  const d = getDb();
  const rows = d.prepare("SELECT address, name, added_at, recipient, vault_type FROM watches").all() as Array<{
    address: string;
    name: string;
    added_at: number;
    recipient: string | null;
    vault_type: string | null;
  }>;

  const ruleRows = d.prepare("SELECT id, watch_addr, expression, severity, message FROM rules").all() as Array<{
    id: string;
    watch_addr: string;
    expression: string;
    severity: string;
    message: string;
  }>;

  const rulesByAddr = new Map<string, AlertRule[]>();
  for (const r of ruleRows) {
    const key = r.watch_addr;
    if (!rulesByAddr.has(key)) rulesByAddr.set(key, []);
    rulesByAddr.get(key)!.push({
      id: r.id,
      expression: r.expression,
      severity: r.severity as AlertRule["severity"],
      message: r.message,
    });
  }

  return rows.map((row) => {
    return {
      address: row.address as `0x${string}`,
      name: row.name,
      rules: rulesByAddr.get(row.address) ?? [],
      addedAt: row.added_at,
      recipient: row.recipient,
      vaultType: row.vault_type as VaultType | null,
    };
  });
}

export function watchCount(): number {
  const row = getDb().prepare("SELECT COUNT(*) as count FROM watches").get() as { count: number };
  return row.count;
}

export function watchExists(address: string): boolean {
  return getDb().prepare("SELECT 1 FROM watches WHERE address = ? LIMIT 1").get(normalizeAddress(address)) !== undefined;
}

export function insertRule(address: string, rule: AlertRule): void {
  getDb()
    .prepare("INSERT INTO rules (id, watch_addr, expression, severity, message) VALUES (?, ?, ?, ?, ?)")
    .run(rule.id, normalizeAddress(address), rule.expression, rule.severity, rule.message);
}

export function deleteRule(ruleId: string): void {
  getDb().prepare("DELETE FROM rules WHERE id = ?").run(ruleId);
}

export function upsertSnapshot(snapshot: VaultSnapshot): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO snapshots
        (address, name, apr, tvl, tvl_raw, share_price, timestamp, asset_decimals, asset_symbol, allocations_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      normalizeAddress(snapshot.address),
      snapshot.name,
      snapshot.apr,
      snapshot.tvl,
      snapshot.tvlRaw.toString(),
      snapshot.sharePrice.toString(),
      snapshot.timestamp,
      snapshot.assetDecimals,
      snapshot.assetSymbol,
      snapshot.allocations ? JSON.stringify(snapshot.allocations) : null
    );
}

export function deleteSnapshot(address: string): void {
  getDb().prepare("DELETE FROM snapshots WHERE address = ?").run(normalizeAddress(address));
}

export function loadSnapshot(address: string): VaultSnapshot | undefined {
  const row = getDb()
    .prepare("SELECT address, name, apr, tvl, tvl_raw, share_price, timestamp, asset_decimals, asset_symbol, allocations_json FROM snapshots WHERE address = ?")
    .get(normalizeAddress(address)) as {
    address: string;
    name: string;
    apr: number | null;
    tvl: string;
    tvl_raw: string;
    share_price: string;
    timestamp: number;
    asset_decimals: number;
    asset_symbol: string;
    allocations_json: string | null;
  } | undefined;

  if (!row) return undefined;

  let allocations: ProtocolAllocation[] | undefined;
  if (row.allocations_json) {
    try {
      allocations = JSON.parse(row.allocations_json) as ProtocolAllocation[];
    } catch {}
  }

  return {
    address: row.address,
    name: row.name,
    apr: row.apr,
    tvl: row.tvl,
    tvlRaw: BigInt(row.tvl_raw),
    sharePrice: BigInt(row.share_price),
    timestamp: row.timestamp,
    assetDecimals: row.asset_decimals,
    assetSymbol: row.asset_symbol,
    allocations,
  };
}

export function loadAllSnapshots(): Map<string, VaultSnapshot> {
  const rows = getDb()
    .prepare("SELECT address, name, apr, tvl, tvl_raw, share_price, timestamp, asset_decimals, asset_symbol, allocations_json FROM snapshots")
    .all() as Array<{
    address: string;
    name: string;
    apr: number | null;
    tvl: string;
    tvl_raw: string;
    share_price: string;
    timestamp: number;
    asset_decimals: number;
    asset_symbol: string;
    allocations_json: string | null;
  }>;

  const map = new Map<string, VaultSnapshot>();
  for (const row of rows) {
    let allocations: ProtocolAllocation[] | undefined;
    if (row.allocations_json) {
      try {
        allocations = JSON.parse(row.allocations_json) as ProtocolAllocation[];
      } catch {}
    }
    map.set(row.address, {
      address: row.address,
      name: row.name,
      apr: row.apr,
      tvl: row.tvl,
      tvlRaw: BigInt(row.tvl_raw),
      sharePrice: BigInt(row.share_price),
      timestamp: row.timestamp,
      assetDecimals: row.asset_decimals,
      assetSymbol: row.asset_symbol,
      allocations,
    });
  }
  return map;
}

export function appendAlerts(alerts: VaultAlert[]): void {
  const stmt = getDb().prepare(
    `INSERT INTO alerts (rule_id, severity, vault_address, vault_name, message, context_json, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const insertAll = getDb().transaction(() => {
    for (const a of alerts) {
      stmt.run(
        a.ruleId,
        a.severity,
        normalizeAddress(a.vaultAddress),
        a.vaultName,
        a.message,
        JSON.stringify(a.context),
        a.timestamp
      );
    }
  });

  insertAll();
}

export function loadAlertHistory(limit: number): VaultAlert[] {
  const rows = getDb()
    .prepare(
      "SELECT rule_id, severity, vault_address, vault_name, message, context_json, timestamp FROM alerts ORDER BY id DESC LIMIT ?"
    )
    .all(limit) as Array<{
    rule_id: string;
    severity: string;
    vault_address: string;
    vault_name: string;
    message: string;
    context_json: string;
    timestamp: number;
  }>;

  return rows
    .reverse() // Oldest first
    .map((row) => ({
      ruleId: row.rule_id,
      severity: row.severity as VaultAlert["severity"],
      vaultAddress: row.vault_address,
      vaultName: row.vault_name,
      message: row.message,
      context: JSON.parse(row.context_json) as AlertContext,
      timestamp: row.timestamp,
    }));
}

export function loadAlertsByVault(address: string, limit: number): VaultAlert[] {
  const rows = getDb()
    .prepare(
      "SELECT rule_id, severity, vault_address, vault_name, message, context_json, timestamp FROM alerts WHERE vault_address = ? ORDER BY id DESC LIMIT ?"
    )
    .all(normalizeAddress(address), limit) as Array<{
    rule_id: string;
    severity: string;
    vault_address: string;
    vault_name: string;
    message: string;
    context_json: string;
    timestamp: number;
  }>;

  return rows
    .reverse()
    .map((row) => ({
      ruleId: row.rule_id,
      severity: row.severity as VaultAlert["severity"],
      vaultAddress: row.vault_address,
      vaultName: row.vault_name,
      message: row.message,
      context: JSON.parse(row.context_json) as AlertContext,
      timestamp: row.timestamp,
    }));
}

export function trimAlertHistory(maxKeep: number): void {
  getDb().prepare(
    "DELETE FROM alerts WHERE id NOT IN (SELECT id FROM alerts ORDER BY id DESC LIMIT ?)"
  ).run(maxKeep);
}

export function loadDedupTimestamps(): Record<string, number> {
  const rows = getDb()
    .prepare("SELECT key, timestamp FROM dedup")
    .all() as Array<{ key: string; timestamp: number }>;

  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.key] = row.timestamp;
  }
  return result;
}

export function saveDedupTimestamps(timestamps: Record<string, number>): void {
  const d = getDb();
  d.transaction(() => {
    d.prepare("DELETE FROM dedup").run();
    const stmt = d.prepare("INSERT INTO dedup (key, timestamp) VALUES (?, ?)");
    for (const [key, ts] of Object.entries(timestamps)) {
      stmt.run(key, ts);
    }
  })();
}
