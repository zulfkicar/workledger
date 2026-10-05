import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, seed } from "../server/database.js";
import { createApp } from "../server/app.js";
test("timer and report state survive reopening the database", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "workledger-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "state.sqlite");
  const db = openDatabase(path);
  seed(db);
  db.prepare("INSERT INTO timers VALUES(?,?,?)").run(
    "u-ava",
    "t-report",
    "2026-10-05T09:00:00Z",
  );
  db.close();
  const reopened = openDatabase(path);
  assert.equal(
    reopened.prepare("SELECT task_id FROM timers WHERE user_id=?").get("u-ava")
      .task_id,
    "t-report",
  );
  reopened.close();
});
test("a blank workspace has one configured manager and no fictional work records", () => {
  const { db } = createApp({
    demo: false,
    env: {
      ADMIN_NAME: "Owner",
      ADMIN_EMAIL: "owner@example.test",
      ADMIN_PASSWORD: "a-strong-test-secret",
    },
  });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users").get().n, 1);
  assert.equal(db.prepare("SELECT role FROM users").get().role, "manager");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM time_entries").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tasks").get().n, 0);
  db.close();
});
