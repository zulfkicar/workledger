import express from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  openDatabase,
  seed,
  audit,
  transaction,
  passwordHash,
} from "./database.js";
import { authenticate, session, digest } from "./auth.js";
import { buildReport, opportunities } from "./analytics.js";
import { explain, providerStatus } from "./ai.js";
import { runBrief } from "./jobs.js";

const text = z.string().trim().min(1).max(180);
const taskSchema = z.object({
  project_id: text,
  title: text,
  category: text,
  assignee_id: text,
  status: z.enum(["todo", "in_progress", "blocked", "done"]),
  estimate_minutes: z.number().int().min(1).max(100000),
  due_date: z.iso.date(),
  note: z.string().max(3000).default(""),
});
const entrySchema = z.object({
  task_id: text,
  started_at: z.iso.datetime(),
  minutes: z.number().int().min(1).max(1440),
  note: z.string().max(1000).default(""),
});
const settingsSchema = z.object({
  enabled: z.boolean(),
  weekday: z.number().int().min(0).max(6),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
});
const wrap = (fn) => (req, res, next) =>
  Promise.resolve()
    .then(() => fn(req, res))
    .catch(next);
const forbidden = (res) =>
  res.status(403).json({ error: "Manager access required" });
export function createApp({
  databasePath = ":memory:",
  demo = true,
  env = process.env,
} = {}) {
  const db = openDatabase(databasePath);
  if (demo) seed(db);
  if (!demo && !db.prepare("SELECT id FROM users LIMIT 1").get()) {
    const admin = z
      .object({
        name: text,
        email: z.email(),
        password: z.string().min(12).max(200),
      })
      .parse({
        name: env.ADMIN_NAME,
        email: env.ADMIN_EMAIL,
        password: env.ADMIN_PASSWORD,
      });
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
      randomUUID(),
      admin.name,
      admin.email.toLowerCase(),
      passwordHash(admin.password),
      "manager",
    );
    db.prepare("INSERT INTO projects VALUES(?,?,?,?)").run(
      "p-general",
      "General work",
      "#4263eb",
      2400,
    );
  }
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "128kb" }));
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "Content-Security-Policy":
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
    });
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin &&
      req.headers.origin !== `${req.protocol}://${req.headers.host}`
    )
      return res.status(403).json({ error: "Cross-origin write rejected" });
    next();
  });
  app.get("/api/health", (_, res) =>
    res.json({ ok: true, app: "workledger", demo }),
  );
  const attempts = new Map();
  app.post(
    "/api/login",
    wrap((req, res) => {
      const { email, password } = z
        .object({ email: z.email(), password: z.string().min(1).max(200) })
        .parse(req.body);
      const now = Date.now(),
        ip = req.ip;
      const recent = (attempts.get(ip) || []).filter((t) => t > now - 60000);
      if (recent.length >= 10)
        return res
          .status(429)
          .json({ error: "Too many sign-in attempts. Try again shortly." });
      recent.push(now);
      attempts.set(ip, recent);
      const result = authenticate(db, email, password);
      if (!result)
        return res
          .status(401)
          .json({ error: "Email or password is incorrect" });
      res.cookie("workledger", result.token, {
        httpOnly: true,
        sameSite: "strict",
        secure: env.COOKIE_SECURE === "1",
        maxAge: 8 * 3600000,
      });
      res.json(result.user);
    }),
  );
  app.use("/api", (req, res, next) => {
    req.user = session(db, req);
    if (!req.user)
      return res.status(401).json({ error: "Sign in to continue" });
    next();
  });
  app.post("/api/logout", (req, res) => {
    const cookie = String(req.headers.cookie || "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("workledger="));
    if (cookie)
      db.prepare("DELETE FROM sessions WHERE hash=?").run(
        digest(cookie.slice(11)),
      );
    res.clearCookie("workledger");
    res.json({ ok: true });
  });
  app.get("/api/state", (req, res) => {
    const user = req.user;
    const tasks = db
      .prepare(
        `SELECT t.*,u.name AS assignee_name,p.name AS project_name,p.color,COALESCE((SELECT SUM(minutes) FROM time_entries WHERE task_id=t.id),0) AS logged_minutes FROM tasks t JOIN users u ON t.assignee_id=u.id JOIN projects p ON t.project_id=p.id ORDER BY t.created_at DESC`,
      )
      .all();
    const entries = db
      .prepare(
        `SELECT e.*,t.title,p.name AS project_name,p.color,u.name AS user_name FROM time_entries e JOIN tasks t ON e.task_id=t.id JOIN projects p ON t.project_id=p.id JOIN users u ON e.user_id=u.id ${user.role === "manager" ? "" : "WHERE e.user_id=?"} ORDER BY e.started_at DESC LIMIT 250`,
      )
      .all(...(user.role === "manager" ? [] : [user.id]));
    res.json({
      user,
      demo,
      users: db.prepare("SELECT id,name,role FROM users").all(),
      projects: db.prepare("SELECT * FROM projects").all(),
      tasks,
      entries,
      timer:
        db.prepare("SELECT * FROM timers WHERE user_id=?").get(user.id) || null,
      provider: providerStatus(env),
      schedule:
        user.role === "manager"
          ? JSON.parse(
              db
                .prepare("SELECT value FROM settings WHERE key=?")
                .get("schedule")?.value || "{}",
            )
          : null,
    });
  });
  app.post(
    "/api/tasks",
    wrap((req, res) => {
      const data = taskSchema.parse(req.body);
      if (req.user.role !== "manager" && data.assignee_id !== req.user.id)
        return res
          .status(403)
          .json({ error: "You can create tasks assigned to yourself" });
      const id = randomUUID(),
        now = new Date().toISOString();
      db.prepare("INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(
        id,
        data.project_id,
        data.title,
        data.category,
        data.assignee_id,
        data.status,
        data.estimate_minutes,
        data.due_date,
        data.note,
        now,
        now,
      );
      audit(db, req.user.id, "task.created", id);
      res.status(201).json({ id });
    }),
  );
  app.post(
    "/api/projects",
    wrap((req, res) => {
      if (req.user.role !== "manager") return forbidden(res);
      const data = z
        .object({
          name: text,
          color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
          budget_minutes: z.number().int().min(1).max(1000000),
        })
        .parse(req.body);
      const id = randomUUID();
      db.prepare("INSERT INTO projects VALUES(?,?,?,?)").run(
        id,
        data.name,
        data.color,
        data.budget_minutes,
      );
      audit(db, req.user.id, "project.created", id);
      res.status(201).json({ id });
    }),
  );
  app.post(
    "/api/users",
    wrap((req, res) => {
      if (req.user.role !== "manager") return forbidden(res);
      const data = z
        .object({
          name: text,
          email: z.email(),
          password: z.string().min(12).max(200),
          role: z.enum(["member", "manager"]),
        })
        .parse(req.body);
      if (
        db
          .prepare("SELECT id FROM users WHERE email=?")
          .get(data.email.toLowerCase())
      )
        return res
          .status(409)
          .json({ error: "This email already has a workspace account" });
      const id = randomUUID();
      db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
        id,
        data.name,
        data.email.toLowerCase(),
        passwordHash(data.password),
        data.role,
      );
      audit(db, req.user.id, "member.created", id);
      res.status(201).json({ id });
    }),
  );
  app.patch(
    "/api/tasks/:id",
    wrap((req, res) => {
      const task = db
        .prepare("SELECT * FROM tasks WHERE id=?")
        .get(req.params.id);
      if (!task) return res.status(404).json({ error: "Task not found" });
      if (req.user.role !== "manager" && task.assignee_id !== req.user.id)
        return res
          .status(403)
          .json({ error: "This task belongs to another member" });
      const data = taskSchema.parse({ ...task, ...req.body });
      if (req.user.role !== "manager" && data.assignee_id !== req.user.id)
        return res
          .status(403)
          .json({ error: "Manager access required to reassign a task" });
      db.prepare(
        "UPDATE tasks SET title=?,category=?,assignee_id=?,status=?,estimate_minutes=?,due_date=?,note=?,status_changed_at=? WHERE id=?",
      ).run(
        data.title,
        data.category,
        data.assignee_id,
        data.status,
        data.estimate_minutes,
        data.due_date,
        data.note,
        data.status !== task.status
          ? new Date().toISOString()
          : task.status_changed_at,
        task.id,
      );
      audit(db, req.user.id, "task.updated", task.id);
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/entries",
    wrap((req, res) => {
      const data = entrySchema.parse(req.body),
        task = db.prepare("SELECT * FROM tasks WHERE id=?").get(data.task_id);
      if (!task) return res.status(404).json({ error: "Task not found" });
      if (new Date(data.started_at).getTime() > Date.now() + 60000)
        return res
          .status(400)
          .json({ error: "Time entries cannot start in the future" });
      const id = randomUUID();
      db.prepare("INSERT INTO time_entries VALUES(?,?,?,?,?,?)").run(
        id,
        data.task_id,
        req.user.id,
        data.started_at,
        data.minutes,
        data.note,
      );
      audit(db, req.user.id, "time.logged", id);
      res.status(201).json({ id });
    }),
  );
  app.delete(
    "/api/entries/:id",
    wrap((req, res) => {
      const entry = db
        .prepare("SELECT * FROM time_entries WHERE id=?")
        .get(req.params.id);
      if (!entry) return res.status(404).json({ error: "Entry not found" });
      if (entry.user_id !== req.user.id && req.user.role !== "manager")
        return res
          .status(403)
          .json({ error: "You can only correct your own time entries" });
      db.prepare("DELETE FROM time_entries WHERE id=?").run(entry.id);
      audit(db, req.user.id, "time.removed", entry.id);
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/timer/start",
    wrap((req, res) => {
      const { task_id } = z.object({ task_id: text }).parse(req.body);
      if (!db.prepare("SELECT id FROM tasks WHERE id=?").get(task_id))
        return res.status(404).json({ error: "Task not found" });
      if (
        db
          .prepare("SELECT user_id FROM timers WHERE user_id=?")
          .get(req.user.id)
      )
        return res.status(409).json({ error: "Stop your current timer first" });
      db.prepare("INSERT INTO timers VALUES(?,?,?)").run(
        req.user.id,
        task_id,
        new Date().toISOString(),
      );
      res.json({ ok: true });
    }),
  );
  app.delete("/api/timer", (req, res) => {
    db.prepare("DELETE FROM timers WHERE user_id=?").run(req.user.id);
    audit(db, req.user.id, "timer.discarded", req.user.id);
    res.json({ ok: true });
  });
  app.post(
    "/api/timer/stop",
    wrap((req, res) =>
      res.json(
        transaction(db, () => {
          const timer = db
            .prepare("SELECT * FROM timers WHERE user_id=?")
            .get(req.user.id);
          if (!timer) return { ok: true, already_stopped: true };
          const minutes = Math.max(
            1,
            Math.ceil(
              (Date.now() - new Date(timer.started_at).getTime()) / 60000,
            ),
          );
          if (minutes > 1440)
            throw new Error(
              "Timer exceeded 24 hours. Ask a manager to correct the record.",
            );
          const id = randomUUID();
          db.prepare("INSERT INTO time_entries VALUES(?,?,?,?,?,?)").run(
            id,
            timer.task_id,
            req.user.id,
            timer.started_at,
            minutes,
            "Tracked with timer",
          );
          db.prepare("DELETE FROM timers WHERE user_id=?").run(req.user.id);
          audit(db, req.user.id, "timer.stopped", id);
          return { ok: true, minutes };
        }),
      ),
    ),
  );
  app.get("/api/reports", (req, res) => {
    if (req.user.role !== "manager") return forbidden(res);
    const days = Number(req.query.days || 7);
    if (![7, 14, 28].includes(days))
      return res.status(400).json({ error: "Choose 7, 14, or 28 days" });
    res.json(buildReport(db, days));
  });
  app.get("/api/opportunities", (req, res) => {
    if (req.user.role !== "manager") return forbidden(res);
    res.json(opportunities(buildReport(db, 7)));
  });
  app.post(
    "/api/explain",
    wrap(async (req, res) => {
      if (req.user.role !== "manager") return forbidden(res);
      try {
        res.json(await explain(buildReport(db, 7), env));
      } catch {
        res.status(502).json({
          error:
            "The AI explanation is unavailable. Your recorded reports are still available.",
        });
      }
    }),
  );
  app.get("/api/runs", (req, res) => {
    if (req.user.role !== "manager") return forbidden(res);
    res.json(
      db.prepare("SELECT * FROM runs ORDER BY created_at DESC LIMIT 50").all(),
    );
  });
  app.post(
    "/api/brief",
    wrap((req, res) => {
      if (req.user.role !== "manager") return forbidden(res);
      res.json(runBrief(db));
    }),
  );
  app.get("/api/briefs", (req, res) => {
    if (req.user.role !== "manager") return forbidden(res);
    res.json(
      db
        .prepare(
          "SELECT id,created_at,period_start,period_end,source FROM reports ORDER BY created_at DESC LIMIT 20",
        )
        .all(),
    );
  });
  app.put(
    "/api/schedule",
    wrap((req, res) => {
      if (req.user.role !== "manager") return forbidden(res);
      const data = settingsSchema.parse(req.body);
      db.prepare(
        "INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ).run("schedule", JSON.stringify(data));
      res.json(data);
    }),
  );
  app.get("/api/pilots", (req, res) => {
    if (req.user.role !== "manager") return forbidden(res);
    res.json(db.prepare("SELECT * FROM pilots ORDER BY created_at DESC").all());
  });
  app.post(
    "/api/pilots",
    wrap((req, res) => {
      if (req.user.role !== "manager") return forbidden(res);
      const data = z
        .object({
          category: text,
          before_minutes: z.number().int().min(1).max(100000),
          after_minutes: z.number().int().min(0).max(100000),
          sample_count: z.number().int().min(1).max(10000),
          note: z.string().min(1).max(1000),
        })
        .parse(req.body);
      const id = randomUUID();
      db.prepare("INSERT INTO pilots VALUES(?,?,?,?,?,?,?)").run(
        id,
        data.category,
        data.before_minutes,
        data.after_minutes,
        data.sample_count,
        data.note,
        new Date().toISOString(),
      );
      res.status(201).json({ id });
    }),
  );
  app.use(express.static(fileURLToPath(new URL("../web", import.meta.url))));
  app.use((error, req, res, next) => {
    if (error instanceof z.ZodError)
      return res.status(400).json({
        error: "Check the highlighted fields",
        fields: error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    if (error.type === "entity.parse.failed")
      return res.status(400).json({ error: "Invalid JSON" });
    if (String(error.message).includes("FOREIGN KEY"))
      return res
        .status(400)
        .json({ error: "Select an existing project and team member" });
    if (String(error.message).startsWith("Timer exceeded"))
      return res.status(409).json({
        error:
          "This timer exceeded 24 hours. Discard it and add the correct sessions manually.",
      });
    res.status(500).json({
      error: "The operation could not be completed. Please try again.",
    });
  });
  return { app, db };
}
