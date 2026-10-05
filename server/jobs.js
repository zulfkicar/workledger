import { randomUUID } from "node:crypto";
import { transaction } from "./database.js";
import { buildReport } from "./analytics.js";

export function runBrief(db, slot = null, now = new Date()) {
  return transaction(db, () => {
    if (slot) {
      const existing = db.prepare("SELECT * FROM runs WHERE slot=?").get(slot);
      if (existing) return existing;
    }
    const id = randomUUID(),
      created = now.toISOString();
    db.prepare(
      "INSERT INTO runs(id,kind,slot,status,created_at) VALUES(?,?,?,?,?)",
    ).run(id, "weekly_brief", slot, "running", created);
    try {
      const report = buildReport(db, 7, now),
        reportId = randomUUID();
      db.prepare("INSERT INTO reports VALUES(?,?,?,?,?,?)").run(
        reportId,
        created,
        report.period.start,
        report.period.end,
        JSON.stringify(report),
        "recorded_patterns",
      );
      db.prepare(
        "UPDATE runs SET status=?,finished_at=?,result=? WHERE id=?",
      ).run(
        "succeeded",
        created,
        JSON.stringify({
          report_id: reportId,
          total_minutes: report.total_minutes,
        }),
        id,
      );
    } catch (error) {
      db.prepare(
        "UPDATE runs SET status=?,finished_at=?,error=? WHERE id=?",
      ).run("failed", created, "Report generation failed", id);
    }
    return db.prepare("SELECT * FROM runs WHERE id=?").get(id);
  });
}

export function tick(db, now = new Date()) {
  const row = db
    .prepare("SELECT value FROM settings WHERE key=?")
    .get("schedule");
  if (!row) return null;
  const schedule = JSON.parse(row.value);
  if (
    !schedule.enabled ||
    now.getUTCDay() !== schedule.weekday ||
    now.getUTCHours() !== schedule.hour ||
    now.getUTCMinutes() !== schedule.minute
  )
    return null;
  return runBrief(db, `weekly:${now.toISOString().slice(0, 16)}`, now);
}
