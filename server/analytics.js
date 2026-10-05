export function period(days = 7, now = new Date()) {
  const end = new Date(now);
  end.setUTCHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);
  start.setUTCHours(0, 0, 0, 0);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function buildReport(db, days = 7, now = new Date()) {
  const range = period(days, now);
  const entries = db
    .prepare(
      `SELECT e.*,t.title,t.category,t.project_id,p.name AS project_name,p.color,u.name AS user_name
    FROM time_entries e JOIN tasks t ON e.task_id=t.id JOIN projects p ON t.project_id=p.id JOIN users u ON e.user_id=u.id
    WHERE e.started_at>=? AND e.started_at<=? ORDER BY e.started_at DESC`,
    )
    .all(range.start, range.end);
  const tasks = db
    .prepare(
      `SELECT t.*,p.name AS project_name,u.name AS assignee_name,
    COALESCE((SELECT SUM(minutes) FROM time_entries WHERE task_id=t.id),0) AS logged_minutes
    FROM tasks t JOIN projects p ON t.project_id=p.id JOIN users u ON t.assignee_id=u.id`,
    )
    .all();
  const group = (key, label) =>
    Object.values(
      entries.reduce((all, e) => {
        const id = e[key];
        all[id] ??= {
          id,
          name: e[label],
          minutes: 0,
          entries: 0,
          task_ids: [],
          color: e.color,
        };
        all[id].minutes += e.minutes;
        all[id].entries++;
        if (!all[id].task_ids.includes(e.task_id))
          all[id].task_ids.push(e.task_id);
        return all;
      }, {}),
    ).sort((a, b) => b.minutes - a.minutes);
  const daily = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(range.start);
    day.setUTCDate(day.getUTCDate() + i);
    const key = day.toISOString().slice(0, 10);
    daily.push({
      date: key,
      minutes: entries
        .filter((e) => e.started_at.startsWith(key))
        .reduce((s, e) => s + e.minutes, 0),
    });
  }
  return {
    period: range,
    total_minutes: entries.reduce((s, e) => s + e.minutes, 0),
    entry_count: entries.length,
    projects: group("project_id", "project_name"),
    people: group("user_id", "user_name"),
    categories: group("category", "category"),
    daily,
    completed: tasks.filter((t) => t.status === "done").length,
    blocked: tasks.filter((t) => t.status === "blocked"),
    tasks,
    entries,
  };
}

export function opportunities(
  report,
  automationFraction = 0.5,
  reviewMinutes = 30,
) {
  const repeatable = new Set([
    "Reporting",
    "Invoice review",
    "Request triage",
    "Data entry",
  ]);
  return report.categories
    .filter((c) => repeatable.has(c.name) && c.entries >= 3)
    .map((c) => ({
      category: c.name,
      observed_minutes: c.minutes,
      entry_count: c.entries,
      task_ids: c.task_ids,
      automation_fraction: automationFraction,
      review_minutes: reviewMinutes,
      estimated_net_minutes: Math.max(
        0,
        Math.round(c.minutes * automationFraction - reviewMinutes),
      ),
      title: {
        Reporting: "Generate recurring reports from structured records",
        "Invoice review": "Pre-check invoices against agreed billing rules",
        "Request triage": "Suggest categories for incoming requests",
        "Data entry": "Extract fields and validate before saving",
      }[c.name],
      next_step: "Inspect three completed examples and measure a small pilot.",
      limitation:
        "Repeated entries identify a candidate. Task procedures and exceptions still need review.",
    }));
}
