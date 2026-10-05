import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";
import { buildReport, opportunities } from "../server/analytics.js";
import { runBrief, tick } from "../server/jobs.js";
import { explain } from "../server/ai.js";

async function harness(t) {
  const { app, db } = createApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(
    () =>
      new Promise((resolve) =>
        server.close(() => {
          db.close();
          resolve();
        }),
      ),
  );
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = async (
    path,
    { user = "manager", method = "GET", body, headers = {} } = {},
  ) => {
    let cookie = "";
    if (user) {
      const login = await fetch(`${base}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: user === "manager" ? "ava@example.test" : "noah@example.test",
          password: "demo-workledger",
        }),
      });
      assert.equal(login.status, 200);
      cookie = login.headers.get("set-cookie").split(";")[0];
    }
    const response = await fetch(base + path, {
      method,
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, data: await response.json(), cookie };
  };
  return { db, request, base };
}

test("sessions enforce member/manager reporting permissions", async (t) => {
  const { request } = await harness(t);
  assert.equal((await request("/state", { user: null })).status, 401);
  assert.equal((await request("/reports", { user: "member" })).status, 403);
  const member = await request("/state", { user: "member" });
  assert.ok(member.data.entries.every((e) => e.user_id === "u-noah"));
  assert.equal((await request("/reports")).status, 200);
});
test("a member cannot edit or reassign another person’s task", async (t) => {
  const { request } = await harness(t);
  assert.equal(
    (
      await request("/tasks/t-report", {
        user: "member",
        method: "PATCH",
        body: { title: "Changed" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/tasks/t-triage", {
        user: "member",
        method: "PATCH",
        body: { assignee_id: "u-ava" },
      })
    ).status,
    403,
  );
});
test("timers are exclusive and stopping twice does not duplicate a session", async (t) => {
  const { request, db } = await harness(t);
  const before = db.prepare("SELECT COUNT(*) AS n FROM time_entries").get().n;
  assert.equal(
    (
      await request("/timer/start", {
        method: "POST",
        body: { task_id: "t-report" },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("/timer/start", {
        method: "POST",
        body: { task_id: "t-report" },
      })
    ).status,
    409,
  );
  await request("/timer/stop", { method: "POST" });
  await request("/timer/stop", { method: "POST" });
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM time_entries").get().n,
    before + 1,
  );
});
test("invalid time and cross-origin writes are rejected", async (t) => {
  const { request } = await harness(t);
  assert.equal(
    (
      await request("/entries", {
        method: "POST",
        body: {
          task_id: "t-report",
          minutes: -10,
          started_at: new Date().toISOString(),
        },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/timer/start", {
        method: "POST",
        body: { task_id: "t-report" },
        headers: { Origin: "https://another.example" },
      })
    ).status,
    403,
  );
});
test("weekly totals come from records, with bounded assumption-based estimates", async (t) => {
  const { db } = await harness(t);
  db.exec("DELETE FROM time_entries");
  const now = new Date();
  const add = db.prepare("INSERT INTO time_entries VALUES(?,?,?,?,?,?)");
  for (let i = 0; i < 3; i++)
    add.run(`e-${i}`, "t-report", "u-ava", now.toISOString(), 60, "Work");
  const report = buildReport(db, 7, now);
  assert.equal(report.total_minutes, 180);
  assert.equal(report.entry_count, 3);
  assert.equal(opportunities(report)[0].estimated_net_minutes, 60);
  assert.equal(opportunities(report, 0, 30)[0].estimated_net_minutes, 0);
});
test("scheduled slots generate one report even after repeated ticks", async (t) => {
  const { db } = await harness(t);
  const now = new Date("2026-10-05T09:00:05Z");
  db.prepare("UPDATE settings SET value=? WHERE key=?").run(
    JSON.stringify({ enabled: true, weekday: 1, hour: 9, minute: 0 }),
    "schedule",
  );
  tick(db, now);
  tick(db, now);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM reports").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM runs").get().n, 1);
  assert.equal(runBrief(db).status, "succeeded");
});
test("AI output cannot reference invented tasks", async () => {
  const report = {
    tasks: [{ id: "real", title: "A task" }],
    categories: [],
    total_minutes: 60,
    entry_count: 1,
  };
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: "Review this",
              recommendations: [{ task_id: "invented", explanation: "Wrong" }],
            }),
          },
        },
      ],
    }),
  });
  await assert.rejects(
    () =>
      explain(
        report,
        { AI_PROVIDER: "deepseek", AI_API_KEY: "test", AI_MODEL: "test" },
        fakeFetch,
      ),
    /unknown task/,
  );
});
test("recorded-pattern mode performs no provider request", async () => {
  let called = false;
  const result = await explain(
    { tasks: [], categories: [], total_minutes: 60, entry_count: 1 },
    {},
    () => {
      called = true;
    },
  );
  assert.equal(result.source, "recorded_patterns");
  assert.equal(called, false);
});
