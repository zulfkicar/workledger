let data;
const storageKey = "workledger-demo-v1";
async function load() {
  if (data) return;
  try {
    data = JSON.parse(localStorage.getItem(storageKey) || "null");
  } catch {}
  if (!data) {
    const response = await fetch("./demo-data.json");
    data = await response.json();
    const old = new Date(data.generated_at);
    const shift =
      new Date().setUTCHours(0, 0, 0, 0) -
      new Date(old).setUTCHours(0, 0, 0, 0);
    for (const entry of data.entries)
      entry.started_at = new Date(
        new Date(entry.started_at).getTime() + shift,
      ).toISOString();
    for (const task of data.tasks)
      task.due_date = new Date().toISOString().slice(0, 10);
    data.user = data.users[0];
    save();
  }
}
function save() {
  localStorage.setItem(storageKey, JSON.stringify(data));
}
function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
function enrichedTasks() {
  return data.tasks.map((t) => ({
    ...t,
    assignee_name: data.users.find((u) => u.id === t.assignee_id)?.name,
    project_name: data.projects.find((p) => p.id === t.project_id)?.name,
    color: data.projects.find((p) => p.id === t.project_id)?.color,
    logged_minutes: data.entries
      .filter((r) => r.task_id === t.id)
      .reduce((s, r) => s + r.minutes, 0),
  }));
}
function report() {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 6);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date();
  end.setUTCHours(23, 59, 59, 999);
  const tasks = enrichedTasks();
  const entries = data.entries
    .filter(
      (r) => new Date(r.started_at) >= start && new Date(r.started_at) <= end,
    )
    .map((r) => ({
      ...r,
      ...(() => {
        const t = tasks.find((t) => t.id === r.task_id);
        return {
          title: t.title,
          category: t.category,
          project_id: t.project_id,
          project_name: t.project_name,
          color: t.color,
          user_name: data.users.find((u) => u.id === r.user_id)?.name,
        };
      })(),
    }));
  const group = (key, label) =>
    Object.values(
      entries.reduce((all, r) => {
        const id = r[key];
        all[id] ??= {
          id,
          name: r[label],
          minutes: 0,
          entries: 0,
          task_ids: [],
          color: r.color,
        };
        all[id].minutes += r.minutes;
        all[id].entries++;
        if (!all[id].task_ids.includes(r.task_id))
          all[id].task_ids.push(r.task_id);
        return all;
      }, {}),
    ).sort((a, b) => b.minutes - a.minutes);
  const daily = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(start);
    day.setUTCDate(day.getUTCDate() + i);
    const date = day.toISOString().slice(0, 10);
    return {
      date,
      minutes: entries
        .filter((e) => e.started_at.startsWith(date))
        .reduce((s, r) => s + r.minutes, 0),
    };
  });
  return {
    period: { start: start.toISOString(), end: end.toISOString() },
    total_minutes: entries.reduce((s, r) => s + r.minutes, 0),
    entry_count: entries.length,
    projects: group("project_id", "project_name"),
    people: group("user_id", "user_name"),
    categories: group("category", "category"),
    daily,
    tasks,
    entries,
    completed: tasks.filter((t) => t.status === "done").length,
    blocked: tasks.filter((t) => t.status === "blocked"),
  };
}
export async function demoApi(path, { method = "GET", body = {} } = {}) {
  await load();
  let result;
  if (path === "/health") return { ok: true, demo: true };
  if (path === "/login") {
    data.user = data.users.find(
      (u) => u.id === (body.email === "noah@example.test" ? "u-noah" : "u-ava"),
    );
    result = data.user;
  } else if (path === "/logout") {
    data.user = null;
    result = { ok: true };
  } else {
    if (!data.user) fail("Sign in to continue", 401);
    const tasks = enrichedTasks();
    const manager = data.user.role === "manager";
    if (
      [
        "/reports",
        "/opportunities",
        "/pilots",
        "/runs",
        "/brief",
        "/schedule",
        "/explain",
      ].includes(path) &&
      !manager
    )
      fail("Manager access required", 403);
    if (path === "/state")
      result = {
        ...data,
        user: data.user,
        tasks,
        entries: data.entries
          .filter((r) => manager || r.user_id === data.user.id)
          .map((r) => ({
            ...r,
            title: tasks.find((t) => t.id === r.task_id)?.title,
            project_name: tasks.find((t) => t.id === r.task_id)?.project_name,
            user_name: data.users.find((u) => u.id === r.user_id)?.name,
          })),
        provider: { provider: "none", configured: false },
        timer: data.timer?.user_id === data.user.id ? data.timer : null,
      };
    else if (path === "/reports") result = report();
    else if (path === "/opportunities") {
      const titles = {
        Reporting: "Generate recurring reports from structured records",
        "Invoice review": "Pre-check invoices against agreed billing rules",
        "Request triage": "Suggest categories for incoming requests",
        "Data entry": "Extract fields and validate before saving",
      };
      result = report()
        .categories.filter((c) => titles[c.name] && c.entries >= 3)
        .map((c) => ({
          category: c.name,
          observed_minutes: c.minutes,
          entry_count: c.entries,
          task_ids: c.task_ids,
          estimated_net_minutes: Math.max(0, Math.round(c.minutes * 0.5 - 30)),
          title: titles[c.name],
          limitation:
            "Repeated entries identify a candidate. Task procedures and exceptions still need review.",
        }));
    } else if (path === "/tasks" && method === "POST") {
      if (!body.title) fail("Enter a task title");
      if (!manager && body.assignee_id !== data.user.id)
        fail("Manager access required", 403);
      const id = crypto.randomUUID();
      data.tasks.push({
        ...body,
        id,
        status_changed_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      });
      result = { id };
    } else if (path === "/projects" && method === "POST") {
      if (!manager) fail("Manager access required", 403);
      const id = crypto.randomUUID();
      data.projects.push({ ...body, id });
      result = { id };
    } else if (path === "/users" && method === "POST") {
      if (!manager) fail("Manager access required", 403);
      const id = crypto.randomUUID();
      data.users.push({ id, name: body.name, role: body.role });
      result = { id };
    } else if (path.startsWith("/tasks/") && method === "PATCH") {
      const task = data.tasks.find((t) => t.id === path.split("/")[2]);
      if (!manager && task.assignee_id !== data.user.id)
        fail("This task belongs to another member", 403);
      Object.assign(task, body);
      result = { ok: true };
    } else if (path === "/entries" && method === "POST") {
      if (body.minutes <= 0 || body.minutes > 1440)
        fail("Enter a duration between 1 and 1440 minutes");
      if (new Date(body.started_at) > new Date())
        fail("Time entries cannot start in the future");
      const id = crypto.randomUUID();
      data.entries.push({ ...body, id, user_id: data.user.id });
      result = { id };
    } else if (path.startsWith("/entries/") && method === "DELETE") {
      const id = path.split("/")[2],
        entry = data.entries.find((r) => r.id === id);
      if (!manager && entry.user_id !== data.user.id)
        fail("You can only remove your own entries", 403);
      data.entries = data.entries.filter((r) => r.id !== id);
      result = { ok: true };
    } else if (path === "/timer/start") {
      if (data.timer) fail("Stop your current timer first", 409);
      data.timer = {
        ...body,
        user_id: data.user.id,
        started_at: new Date().toISOString(),
      };
      result = { ok: true };
    } else if (path === "/timer/stop") {
      if (data.timer) {
        const minutes = Math.max(
          1,
          Math.min(
            1440,
            Math.ceil(
              (Date.now() - new Date(data.timer.started_at).getTime()) / 60000,
            ),
          ),
        );
        data.entries.push({
          id: crypto.randomUUID(),
          task_id: data.timer.task_id,
          user_id: data.user.id,
          started_at: data.timer.started_at,
          minutes,
          note: "Tracked in browser demo",
        });
        data.timer = null;
      }
      result = { ok: true };
    } else if (path === "/timer" && method === "DELETE") {
      data.timer = null;
      result = { ok: true };
    } else if (path === "/pilots" && method === "POST") {
      const id = crypto.randomUUID();
      data.pilots.push({ ...body, id, created_at: new Date().toISOString() });
      result = { id };
    } else if (path === "/pilots") result = data.pilots;
    else if (path === "/runs") result = data.runs;
    else if (path === "/brief") {
      const payload = report(),
        id = crypto.randomUUID();
      data.runs.unshift({
        id,
        kind: "weekly_brief",
        status: "succeeded",
        created_at: new Date().toISOString(),
        error: "",
      });
      data.reports.push({ id, payload });
      result = { id, status: "succeeded" };
    } else if (path === "/schedule") {
      data.schedule = body;
      result = body;
    } else if (path === "/explain") {
      const r = report();
      result = {
        source: "recorded_patterns",
        summary: `${r.entry_count} recorded sessions account for ${(r.total_minutes / 60).toFixed(1)} hours in this period. Review the supporting tasks before choosing a process to automate.`,
        recommendations: [],
      };
    } else fail("This operation is not available in the browser demonstration");
  }
  save();
  return structuredClone(result);
}
