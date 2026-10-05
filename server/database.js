import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID, scryptSync } from "node:crypto";

export function openDatabase(path = ":memory:") {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, { timeout: 5000 });
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('member','manager')));
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,color TEXT NOT NULL,budget_minutes INTEGER NOT NULL CHECK(budget_minutes>0));
    CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),title TEXT NOT NULL,category TEXT NOT NULL,assignee_id TEXT NOT NULL REFERENCES users(id),status TEXT NOT NULL CHECK(status IN ('todo','in_progress','blocked','done')),estimate_minutes INTEGER NOT NULL CHECK(estimate_minutes>0),due_date TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',status_changed_at TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS time_entries(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),user_id TEXT NOT NULL REFERENCES users(id),started_at TEXT NOT NULL,minutes INTEGER NOT NULL CHECK(minutes>0 AND minutes<=1440),note TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS timers(user_id TEXT PRIMARY KEY REFERENCES users(id),task_id TEXT NOT NULL REFERENCES tasks(id),started_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,period_start TEXT NOT NULL,period_end TEXT NOT NULL,payload TEXT NOT NULL,source TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,slot TEXT UNIQUE,status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed')),created_at TEXT NOT NULL,finished_at TEXT,error TEXT NOT NULL DEFAULT '',result TEXT NOT NULL DEFAULT '{}');
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pilots(id TEXT PRIMARY KEY,category TEXT NOT NULL,before_minutes INTEGER NOT NULL CHECK(before_minutes>0),after_minutes INTEGER NOT NULL CHECK(after_minutes>=0),sample_count INTEGER NOT NULL CHECK(sample_count>0),note TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,actor_id TEXT,action TEXT NOT NULL,entity_id TEXT NOT NULL,created_at TEXT NOT NULL);
  `);
  return db;
}

export function transaction(db, operation) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = operation();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function audit(db, actor, action, entity) {
  db.prepare("INSERT INTO audit VALUES(?,?,?,?,?)").run(
    randomUUID(),
    actor,
    action,
    entity,
    new Date().toISOString(),
  );
}

export function passwordHash(password, salt = randomUUID()) {
  return `${salt}:${scryptSync(password, salt, 32).toString("hex")}`;
}

export function seed(db) {
  if (db.prepare("SELECT COUNT(*) AS count FROM users").get().count) return;
  transaction(db, () => {
    const users = [
      ["u-ava", "Ava Morgan", "ava@example.test", "manager"],
      ["u-noah", "Noah Park", "noah@example.test", "member"],
      ["u-mia", "Mia Chen", "mia@example.test", "member"],
    ];
    for (const [id, name, email, role] of users)
      db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
        id,
        name,
        email,
        passwordHash("demo-workledger"),
        role,
      );
    for (const p of [
      ["p-studio", "Studio operations", "#4263eb", 2400],
      ["p-atlas", "Atlas website", "#b06b3d", 3600],
      ["p-customer", "Customer experience", "#4d8a70", 1800],
    ])
      db.prepare("INSERT INTO projects VALUES(?,?,?,?)").run(...p);
    const now = new Date(),
      today = now.toISOString().slice(0, 10);
    const tasks = [
      [
        "t-report",
        "p-studio",
        "Prepare the weekly client report",
        "Reporting",
        "u-ava",
        "in_progress",
        900,
      ],
      [
        "t-content",
        "p-atlas",
        "Review landing page content",
        "Content review",
        "u-noah",
        "todo",
        120,
      ],
      [
        "t-invoices",
        "p-studio",
        "Match supplier invoices",
        "Invoice review",
        "u-mia",
        "in_progress",
        900,
      ],
      [
        "t-access",
        "p-atlas",
        "Confirm access to the staging site",
        "Access setup",
        "u-ava",
        "blocked",
        30,
      ],
      [
        "t-triage",
        "p-customer",
        "Categorise incoming support requests",
        "Request triage",
        "u-noah",
        "in_progress",
        600,
      ],
      [
        "t-design",
        "p-atlas",
        "Finish the navigation prototype",
        "Design",
        "u-mia",
        "done",
        1200,
      ],
      [
        "t-release",
        "p-atlas",
        "Prepare the client release notes",
        "Reporting",
        "u-ava",
        "todo",
        75,
      ],
    ];
    for (const t of tasks) {
      const changed = new Date(
        now.getTime() - (t[0] === "t-access" ? 4 : 1) * 86400000,
      ).toISOString();
      db.prepare("INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(
        ...t,
        today,
        t[0] === "t-access"
          ? "Waiting for the client to send a staging invitation."
          : "",
        changed,
        changed,
      );
    }
    const add = db.prepare("INSERT INTO time_entries VALUES(?,?,?,?,?,?)");
    for (let day = 0; day < 28; day++) {
      const date = new Date(now.getTime() - day * 86400000);
      date.setUTCHours(10, 0, 0, 0);
      if ([0, 6].includes(date.getUTCDay())) continue;
      for (const [task, user, minutes] of [
        ["t-report", "u-ava", day < 7 ? 70 : 35],
        ["t-invoices", "u-mia", 45],
        ["t-triage", "u-noah", 30],
        ["t-design", "u-mia", 60],
      ])
        add.run(
          randomUUID(),
          task,
          user,
          date.toISOString(),
          minutes,
          "Synthetic example work session",
        );
    }
    db.prepare("INSERT INTO settings VALUES(?,?)").run(
      "schedule",
      JSON.stringify({ enabled: false, weekday: 1, hour: 9, minute: 0 }),
    );
  });
}
