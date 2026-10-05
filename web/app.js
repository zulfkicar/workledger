import { api } from "./api.js";
import {
  escape as e,
  hours,
  initials,
  date,
  icon,
  pill,
  statusLabel,
  bars,
  columns,
  toast,
  dialog,
} from "./ui.js";

let state,
  report,
  opps,
  pilots,
  runs,
  view = "work",
  filter = "",
  query = "";
const root = document.querySelector("#app");
const categories = [
  "Reporting",
  "Invoice review",
  "Request triage",
  "Design",
  "Content review",
  "Access setup",
  "Data entry",
  "Other",
];
const nav = [
  ["work", "grid", "My work"],
  ["time", "clock", "Timesheet"],
  ["reports", "chart", "Team reports"],
  ["insights", "spark", "Opportunities"],
  ["settings", "settings", "Workspace"],
];

async function refresh() {
  state = await api("/state");
  if (state.user.role === "manager")
    [report, opps, pilots, runs] = await Promise.all([
      api("/reports"),
      api("/opportunities"),
      api("/pilots"),
      api("/runs"),
    ]);
  else {
    report = null;
    opps = [];
    pilots = [];
    runs = [];
    if (["reports", "insights"].includes(view)) view = "work";
  }
  render();
}

async function login() {
  const workspaceDemo = window.WORKLEDGER_DEMO || (await api("/health")).demo;
  root.innerHTML = `<main class="login"><div class="brand-mark">${icon("check")}</div><p class="eyebrow">WORKLEDGER</p><h1>A clear picture<br>of your team's work.</h1><p>Tasks, time, and the evidence behind your next improvement.</p><form id="login"><label>Email<input name="email" type="email" value="${workspaceDemo ? "ava@example.test" : ""}" autocomplete="username" required></label><label>Password<input name="password" type="password" value="${workspaceDemo ? "demo-workledger" : ""}" autocomplete="current-password" required></label><button class="primary" type="submit">Open workspace ${icon("arrow")}</button></form>${workspaceDemo ? '<div class="demo-note"><strong>Try the example workspace</strong><p>Manager: ava@example.test<br>Member: noah@example.test<br>Password: demo-workledger</p><small>All example records are synthetic.</small></div>' : ""}</main>`;
  document.querySelector("#login").onsubmit = async (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    try {
      await api("/login", { method: "POST", body: Object.fromEntries(data) });
      await refresh();
    } catch (error) {
      toast(error.message, true);
    }
  };
}

function render() {
  root.innerHTML = `<aside class="sidebar"><a class="brand" href="#" aria-label="Workledger home"><span>${icon("check")}</span>workledger<span class="version">/</span></a><div class="workspace"><div class="workspace-avatar">S</div><div><strong>Studio workspace</strong><small>${window.WORKLEDGER_DEMO ? "Browser demonstration" : state.demo ? "Example team" : "Your team"}</small></div></div><nav>${nav
    .filter(
      ([id]) =>
        state.user.role === "manager" || !["reports", "insights"].includes(id),
    )
    .map(
      ([id, glyph, label]) =>
        `<button data-nav="${id}" class="nav-item ${view === id ? "selected" : ""}">${icon(glyph)}${label}${id === "insights" && opps?.length ? `<span>${opps.length}</span>` : ""}</button>`,
    )
    .join(
      "",
    )}</nav><div class="sidebar-bottom"><div class="workspace-note"><span class="tiny-dot"></span> ${window.WORKLEDGER_DEMO ? "Local browser demo" : state.demo ? "Synthetic example data" : "Private local workspace"}<p>${window.WORKLEDGER_DEMO ? "Changes stay in this browser." : "Your records persist between sessions."}</p></div><button class="profile" id="logout"><span class="avatar">${initials(state.user.name)}</span><span><strong>${e(state.user.name)}</strong><small>${e(state.user.role)}</small></span>${icon("logout")}</button></div></aside><main class="main"><header class="topbar"><span>Workspace <span>/</span> ${e(nav.find((n) => n[0] === view)?.[2])}</span><span>${new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}<button class="mobile-account avatar small" id="logout-mobile" aria-label="Sign out of ${e(state.user.name)} account">${initials(state.user.name)}</button></span></header><div class="mobile-environment">${window.WORKLEDGER_DEMO ? "Browser demo · synthetic records · changes stay here" : state.demo ? "Synthetic example workspace" : "Private local workspace"}</div><div class="content">${{ work: work, time: timesheet, reports: reports, insights: insights, settings: settings }[view]()}</div></main>`;
  document.querySelectorAll("[data-nav]").forEach(
    (button) =>
      (button.onclick = () => {
        view = button.dataset.nav;
        render();
      }),
  );
  document.querySelector(".brand").onclick = (event) => {
    event.preventDefault();
    view = "work";
    render();
  };
  document.querySelectorAll("#logout, #logout-mobile").forEach((button) => {
    button.onclick = async () => {
      await api("/logout", { method: "POST" });
      login();
    };
  });
  bind();
}

function heading(kicker, title, description, action = "") {
  return `<div class="page-heading"><div><p class="eyebrow">${kicker}</p><h1>${title}</h1><p>${description}</p></div>${action}</div>`;
}
function work() {
  const mine = state.tasks.filter((t) => t.assignee_id === state.user.id),
    active = mine.filter((t) => !["done"].includes(t.status));
  const tasks = state.tasks.filter(
    (t) =>
      (!filter || t.status === filter) &&
      (!query || `${t.title} ${t.project_name}`.toLowerCase().includes(query)),
  );
  return (
    heading(
      "YOUR WORKSPACE",
      `Good ${new Date().getHours() < 12 ? "morning" : "afternoon"}, ${e(state.user.name.split(" ")[0])}.`,
      "Keep the work moving. Track the time that goes into it.",
      `<button class="primary" id="new-task">${icon("plus")} New task</button>`,
    ) +
    `<div class="stats"><article><span>YOUR OPEN TASKS</span><strong>${active.length}<small> tasks</small></strong><p>${mine.filter((t) => t.status === "blocked").length} waiting on a dependency</p></article><article><span>YOUR HOURS THIS WEEK</span><strong>${hours(state.entries.filter((r) => r.user_id === state.user.id && new Date(r.started_at) > new Date(Date.now() - 7 * 86400000)).reduce((sum, r) => sum + r.minutes, 0))}</strong><p>From recorded work sessions</p></article><article class="timer-card"><span>FOCUS SESSION</span>${state.timer ? `<strong id="timer-value">00:00</strong><p>${e(state.tasks.find((t) => t.id === state.timer.task_id)?.title)}</p><button class="timer-stop" id="stop-timer">${icon("stop")} Stop & save</button>` : `<strong>Ready when you are</strong><p>Start a timer from any task below</p>`}</article></div>
  <section class="panel"><div class="panel-top"><div><h2>Task list <span class="count">${state.tasks.length}</span></h2><p>Everything the team is working on</p></div><label class="search">${icon("search")}<input id="search" placeholder="Find a task…" value="${e(query)}" aria-label="Search tasks"></label></div><div class="tabs">${[
    ["", "All tasks"],
    ["todo", "To do"],
    ["in_progress", "In progress"],
    ["blocked", "Blocked"],
    ["done", "Done"],
  ]
    .map(
      ([id, label]) =>
        `<button data-filter="${id}" class="${filter === id ? "active" : ""}">${label}</button>`,
    )
    .join(
      "",
    )}</div><div class="table-wrap"><table><thead><tr><th>Task</th><th>Project</th><th>Status</th><th>Owner</th><th>Logged / estimate</th><th></th></tr></thead><tbody>${tasks.map((t) => `<tr><td><button class="task-title" data-task="${e(t.id)}"><span class="task-circle ${e(t.status)}">${t.status === "done" ? icon("check") : ""}</span><span>${e(t.title)}<small>${e(t.category)} · Due ${date(t.due_date + "T12:00:00Z")}</small></span></button></td><td><span class="project-dot" style="background:${e(t.color)}"></span>${e(t.project_name)}</td><td>${pill(t.status)}</td><td><span class="avatar small muted" title="${e(t.assignee_name)}">${initials(t.assignee_name)}</span></td><td class="numeric">${hours(t.logged_minutes)} <span class="muted-text">/ ${hours(t.estimate_minutes)}</span></td><td><button class="icon-button" data-track="${e(t.id)}" aria-label="Track time for ${e(t.title)}" ${state.timer ? "disabled" : ""}>${icon("play")}</button></td></tr>`).join("") || '<tr><td colspan="6" class="empty">No tasks match this view.</td></tr>'}</tbody></table></div></section><div class="footnote">A timer records elapsed time. It does not measure productivity.</div>`
  );
}
function timesheet() {
  const rows = state.entries;
  return (
    heading(
      "TIME TRACKING",
      "Time, accounted for.",
      "Review recorded sessions and add work you tracked elsewhere.",
      `<button class="primary" id="new-entry">${icon("plus")} Add time</button>`,
    ) +
    `<div class="time-layout"><section class="panel"><div class="panel-top"><div><h2>Recent sessions</h2><p>${state.user.role === "manager" ? "Team records" : "Your records"} · Times shown in your local timezone</p></div><strong>${hours(rows.reduce((sum, r) => sum + r.minutes, 0))}</strong></div><div class="session-list">${rows.map((r) => `<article class="session"><div class="session-date"><strong>${new Date(r.started_at).getDate()}</strong><small>${new Date(r.started_at).toLocaleDateString(undefined, { month: "short" })}</small></div><div><strong>${e(r.title)}</strong><p>${e(r.project_name)} · ${e(r.user_name)}</p><small>${e(r.note)}</small></div><b>${hours(r.minutes)}</b><button class="icon-button" data-delete-entry="${e(r.id)}" aria-label="Remove time entry for ${e(r.title)}">${icon("close")}</button></article>`).join("") || '<p class="empty">No time entries yet. Add your first session.</p>'}</div></section><aside class="panel compact"><p class="eyebrow">CURRENT SESSION</p><h2>${state.timer ? "A timer is running" : "Make the time visible"}</h2><p>${state.timer ? e(state.tasks.find((t) => t.id === state.timer.task_id)?.title) : "Start a timer on a task, or add a completed session manually."}</p>${state.timer ? `<strong class="large-number" id="timer-value">00:00</strong><button class="primary" id="stop-timer">${icon("stop")} Stop & save</button><button class="text-button" id="discard-timer">Discard this session</button>` : `<button class="secondary" id="back-work">Open task list ${icon("arrow")}</button>`}<div class="divider"></div><small>Timers survive refreshes. Sessions under one minute are rounded up to one minute.</small></aside></div>`
  );
}
function reports() {
  if (!report) return "";
  return (
    heading(
      "TEAM REPORTING",
      "See where the week went.",
      "A seven-day view of recorded time, projects, and work awaiting progress.",
      `<button class="secondary" id="generate-brief">${icon("brief")} Save weekly brief</button>`,
    ) +
    `<div class="stats"><article><span>RECORDED HOURS</span><strong>${hours(report.total_minutes)}</strong><p>${report.entry_count} work sessions</p></article><article><span>COMPLETED TASKS</span><strong>${report.completed}</strong><p>Current workspace total</p></article><article><span>BLOCKED TASKS</span><strong>${report.blocked.length}</strong><p>Review dependencies with the team</p></article></div><div class="report-grid"><section class="panel"><div class="panel-top"><div><h2>Time by project</h2><p>Recorded hours over the last seven days</p></div></div><div class="panel-body">${bars(report.projects)}</div></section><section class="panel"><div class="panel-top"><div><h2>Daily work sessions</h2><p>UTC reporting dates</p></div></div><div class="panel-body">${columns(report.daily)}</div></section><section class="panel"><div class="panel-top"><div><h2>Work distribution</h2><p>Hours are context, not a performance ranking</p></div></div><div class="panel-body">${bars(report.people)}</div></section><section class="panel"><div class="panel-top"><div><h2>Needs a conversation</h2><p>Tasks marked blocked by their owners</p></div></div><div class="panel-body">${report.blocked.map((t) => `<button class="blocked-item" data-task="${e(t.id)}"><span class="blocked-icon">${icon("clock")}</span><span><strong>${e(t.title)}</strong><small>${e(t.note || "No reason recorded yet")}</small></span>${icon("chevron")}</button>`).join("") || '<p class="empty">No blocked tasks.</p>'}</div></section></div>`
  );
}
function insights() {
  return (
    heading(
      "AUTOMATION OPPORTUNITIES",
      "Find the next useful improvement.",
      "Recurring work is a starting point. Validate the process, then measure the change.",
      `<button class="secondary" id="ai-explain">${icon("spark")} ${state.provider.configured ? "Ask for an AI explanation" : "Summarise recorded patterns"}</button>`,
    ) +
    `<div class="insight-banner"><span>${icon("spark")}</span><div><strong>Evidence first. Impact after a pilot.</strong><p>Estimates below assume 50% of recorded work can be automated, with 30 minutes of review per category per week. These are planning assumptions.</p></div></div><div id="explanation"></div><div class="opportunity-grid">${opps.map((o) => `<article class="opportunity"><div class="op-top"><span class="tag">${e(o.category)}</span><span class="small-label">CANDIDATE</span></div><h2>${e(o.title)}</h2><div class="op-metric"><strong>${hours(o.estimated_net_minutes)}</strong><span>estimated capacity recovered<br>per seven-day period</span></div><div class="op-evidence"><span>Recorded work <b>${hours(o.observed_minutes)}</b></span><span>Work sessions <b>${o.entry_count}</b></span><span>Review allowance <b>30 min</b></span></div><p>${e(o.limitation)}</p><details><summary>Inspect supporting tasks</summary>${o.task_ids.map((id) => `<button class="evidence-link" data-task="${e(id)}">${e(state.tasks.find((t) => t.id === id)?.title)} ${icon("arrow")}</button>`).join("")}</details><button class="secondary" data-pilot="${e(o.category)}">Record a pilot measurement ${icon("arrow")}</button></article>`).join("") || '<section class="panel empty">Log at least three sessions in a recurring work category to identify a candidate.</section>'}</div><section class="panel pilots"><div class="panel-top"><div><h2>Pilot measurements</h2><p>Observed changes recorded by your team. Not a causal estimate.</p></div></div><div class="panel-body">${pilots.map((p) => `<div class="pilot-row"><div><strong>${e(p.category)}</strong><p>${e(p.note)}</p></div><span>${p.before_minutes} → ${p.after_minutes} min / item</span><span>${p.sample_count} items</span><b>${p.before_minutes - p.after_minutes} min difference</b></div>`).join("") || '<p class="empty">No pilot results yet. Start with a small sample and include review time.</p>'}</div></section><p class="footnote">Recovered time is capacity. Cash savings require separate cost and staffing evidence.</p>`
  );
}
function settingsBase() {
  const schedule = state.schedule || {};
  return (
    heading(
      "WORKSPACE SETTINGS",
      "Keep the routine running.",
      "Configure reporting and review the execution history.",
    ) +
    `<div class="report-grid"><section class="panel"><div class="panel-top"><div><h2>Weekly briefing</h2><p>Creates an in-app report at the chosen UTC time</p></div></div><form id="schedule" class="panel-body"><label class="toggle"><input name="enabled" type="checkbox" ${schedule.enabled ? "checked" : ""}> Enable scheduled reports</label><div class="form-grid"><label>Day<select name="weekday">${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => `<option value="${i}" ${schedule.weekday === i ? "selected" : ""}>${d}</option>`).join("")}</select></label><label>Time (UTC)<input name="time" type="time" value="${String(schedule.hour || 0).padStart(2, "0")}:${String(schedule.minute || 0).padStart(2, "0")}"></label></div><button class="primary" type="submit" ${state.user.role !== "manager" ? "disabled" : ""}>Save schedule</button><p class="footnote">${window.WORKLEDGER_DEMO ? "Scheduled execution requires the self-hosted server. This demo saves configuration only." : "The server must be running. Missed slots are skipped. Reports appear in this workspace."}</p></form></section><section class="panel"><div class="panel-top"><div><h2>AI explanations</h2><p>Optional interpretation of the same recorded facts</p></div></div><div class="panel-body"><span class="tag">${state.provider.configured ? "Connected" : "Recorded-pattern mode"}</span><p>${state.provider.configured ? `${e(state.provider.provider)} · ${e(state.provider.model || "default model")}` : "The app works without an API key. Add a provider key and model in the server environment to enable AI explanations."}</p><p class="footnote">Explanations are generated only when requested. Time totals and estimates are calculated by the application.</p></div></section><section class="panel full-width"><div class="panel-top"><div><h2>Briefing run history</h2><p>Saved reports and unsuccessful attempts</p></div><button class="secondary" id="generate-brief">Run now</button></div><div class="panel-body">${runs.map((r) => `<div class="run-row"><span class="run-dot ${e(r.status)}"></span><div><strong>Weekly team brief</strong><small>${new Date(r.created_at).toLocaleString()}</small></div><span class="tag">${e(r.status)}</span><span>${e(r.error || "Saved in the workspace")}</span></div>`).join("") || '<p class="empty">No runs yet. Save a brief or enable the schedule.</p>'}</div></section></div>`
  );
}

function taskDialog(task = null) {
  if (
    task &&
    state.user.role !== "manager" &&
    task.assignee_id !== state.user.id
  ) {
    dialog(
      "Task details",
      `<p><strong>${e(task.title)}</strong></p><p>${e(task.project_name)} · ${e(task.assignee_name)}</p><p>${e(task.note || "No work notes yet.")}</p><p class="footnote">The owner or a manager can edit this task.</p>`,
    );
    return;
  }
  const t = task || {
    project_id: state.projects[0]?.id,
    title: "",
    category: "Other",
    assignee_id: state.user.id,
    status: "todo",
    estimate_minutes: 60,
    due_date: new Date().toISOString().slice(0, 10),
    note: "",
  };
  dialog(
    task ? "Task details" : "Create a task",
    `<form><label>Task title<input name="title" value="${e(t.title)}" required maxlength="180" autofocus></label><div class="form-grid"><label>Project<select name="project_id" ${task ? "disabled" : ""}>${state.projects.map((p) => `<option value="${e(p.id)}" ${t.project_id === p.id ? "selected" : ""}>${e(p.name)}</option>`).join("")}</select></label><label>Owner<select name="assignee_id">${state.users
      .filter((u) => state.user.role === "manager" || u.id === state.user.id)
      .map(
        (u) =>
          `<option value="${e(u.id)}" ${t.assignee_id === u.id ? "selected" : ""}>${e(u.name)}</option>`,
      )
      .join(
        "",
      )}</select></label><label>Status<select name="status">${["todo", "in_progress", "blocked", "done"].map((s) => `<option value="${s}" ${t.status === s ? "selected" : ""}>${statusLabel(s)}</option>`).join("")}</select></label><label>Category<select name="category">${categories.map((c) => `<option ${t.category === c ? "selected" : ""}>${c}</option>`).join("")}</select></label><label>Estimate (minutes)<input type="number" name="estimate_minutes" min="1" max="100000" value="${t.estimate_minutes}" required></label><label>Due date<input type="date" name="due_date" value="${e(t.due_date)}" required></label></div><label>Work notes<textarea name="note" rows="3" maxlength="3000" placeholder="Inputs, recurring steps, or what is blocking progress">${e(t.note)}</textarea></label><button type="submit" class="primary">${task ? "Save changes" : "Create task"}</button></form>`,
    async (data) => {
      await api(task ? `/tasks/${task.id}` : "/tasks", {
        method: task ? "PATCH" : "POST",
        body: {
          ...Object.fromEntries(data),
          project_id: task ? t.project_id : data.get("project_id"),
          estimate_minutes: Number(data.get("estimate_minutes")),
        },
      });
      toast("Task saved");
      await refresh();
    },
  );
}
function entryDialog() {
  dialog(
    "Add a work session",
    `<form><label>Task<select name="task_id">${state.tasks.map((t) => `<option value="${e(t.id)}">${e(t.title)}</option>`).join("")}</select></label><div class="form-grid"><label>Date<input name="date" type="date" value="${new Date().toISOString().slice(0, 10)}" required></label><label>Duration (minutes)<input name="minutes" type="number" min="1" max="1440" value="30" required></label></div><label>Note<textarea name="note" rows="3" maxlength="1000" placeholder="What did this session involve?"></textarea></label><button type="submit" class="primary">Save time entry</button></form>`,
    async (data) => {
      await api("/entries", {
        method: "POST",
        body: {
          task_id: data.get("task_id"),
          started_at: new Date(data.get("date") + "T00:00:00Z").toISOString(),
          minutes: Number(data.get("minutes")),
          note: data.get("note"),
        },
      });
      toast("Time entry saved");
      await refresh();
    },
  );
}
function bind() {
  document.querySelector("#new-project")?.addEventListener("click", () =>
    dialog(
      "Create a project",
      `<form><label>Project name<input name="name" required maxlength="180"></label><div class="form-grid"><label>Time budget (hours)<input name="hours" type="number" min="1" max="16000" value="40" required></label><label>Project colour<input name="color" type="color" value="#4263eb"></label></div><button class="primary" type="submit">Create project</button></form>`,
      async (data) => {
        await api("/projects", {
          method: "POST",
          body: {
            name: data.get("name"),
            color: data.get("color"),
            budget_minutes: Math.round(Number(data.get("hours")) * 60),
          },
        });
        toast("Project created");
        await refresh();
      },
    ),
  );
  document.querySelector("#new-member")?.addEventListener("click", () =>
    dialog(
      "Create a team account",
      `<form><label>Name<input name="name" required maxlength="180"></label><label>Email<input name="email" type="email" required></label><label>Initial password<input name="password" type="password" minlength="12" maxlength="200" autocomplete="new-password" required></label><label>Access<select name="role"><option value="member">Member</option><option value="manager">Manager</option></select></label><button class="primary" type="submit">Create account</button></form>`,
      async (data) => {
        await api("/users", { method: "POST", body: Object.fromEntries(data) });
        toast("Team account created");
        await refresh();
      },
    ),
  );
  document
    .querySelector("#new-task")
    ?.addEventListener("click", () => taskDialog());
  document.querySelector("#new-entry")?.addEventListener("click", entryDialog);
  document.querySelector("#back-work")?.addEventListener("click", () => {
    view = "work";
    render();
  });
  document
    .querySelectorAll("[data-task]")
    .forEach(
      (button) =>
        (button.onclick = () =>
          taskDialog(state.tasks.find((t) => t.id === button.dataset.task))),
    );
  document.querySelectorAll("[data-filter]").forEach(
    (button) =>
      (button.onclick = () => {
        filter = button.dataset.filter;
        render();
      }),
  );
  document.querySelector("#search")?.addEventListener("input", (event) => {
    query = event.target.value.toLowerCase();
    const position = event.target.selectionStart;
    render();
    const input = document.querySelector("#search");
    input.focus();
    input.setSelectionRange(position, position);
  });
  document.querySelectorAll("[data-track]").forEach(
    (button) =>
      (button.onclick = () =>
        perform(
          () =>
            api("/timer/start", {
              method: "POST",
              body: { task_id: button.dataset.track },
            }),
          "Timer started",
        )),
  );
  document
    .querySelector("#stop-timer")
    ?.addEventListener("click", () =>
      perform(() => api("/timer/stop", { method: "POST" }), "Session saved"),
    );
  document.querySelector("#discard-timer")?.addEventListener("click", () => {
    if (confirm("Discard this timer without saving time?"))
      perform(() => api("/timer", { method: "DELETE" }), "Timer discarded");
  });
  document.querySelectorAll("[data-delete-entry]").forEach(
    (button) =>
      (button.onclick = () => {
        if (confirm("Remove this recorded session?"))
          perform(
            () =>
              api(`/entries/${button.dataset.deleteEntry}`, {
                method: "DELETE",
              }),
            "Session removed",
          );
      }),
  );
  document
    .querySelectorAll("#generate-brief")
    .forEach(
      (button) =>
        (button.onclick = () =>
          perform(
            () => api("/brief", { method: "POST" }),
            "Weekly brief saved",
          )),
    );
  document.querySelector("#schedule")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.target),
      [hour, minute] = String(data.get("time")).split(":").map(Number);
    perform(
      () =>
        api("/schedule", {
          method: "PUT",
          body: {
            enabled: data.has("enabled"),
            weekday: Number(data.get("weekday")),
            hour,
            minute,
          },
        }),
      "Schedule saved",
    );
  });
  document
    .querySelector("#ai-explain")
    ?.addEventListener("click", async (event) => {
      event.currentTarget.disabled = true;
      try {
        const result = await api("/explain", { method: "POST" });
        document.querySelector("#explanation").innerHTML =
          `<section class="panel explanation"><span class="tag">${result.source === "ai_explanation" ? "AI-written interpretation" : "Recorded-pattern summary"}</span><p>${e(result.summary)}</p>${result.recommendations.map((r) => `<p><strong>${e(state.tasks.find((t) => t.id === r.task_id)?.title)}</strong> — ${e(r.explanation)}</p>`).join("")}</section>`;
      } catch (error) {
        toast(error.message, true);
      } finally {
        document.querySelector("#ai-explain").disabled = false;
      }
    });
  document.querySelectorAll("[data-pilot]").forEach(
    (button) =>
      (button.onclick = () =>
        dialog(
          "Record a pilot measurement",
          `<form><input type="hidden" name="category" value="${e(button.dataset.pilot)}"><p>Include preparation, review, and exception handling in both measurements.</p><div class="form-grid"><label>Before (minutes per item)<input name="before_minutes" type="number" min="1" required></label><label>After (minutes per item)<input name="after_minutes" type="number" min="0" required></label></div><label>Items measured<input name="sample_count" type="number" min="1" required></label><label>Method and observations<textarea name="note" rows="3" required maxlength="1000"></textarea></label><button class="primary" type="submit">Save measurement</button></form>`,
          async (data) => {
            await api("/pilots", {
              method: "POST",
              body: {
                ...Object.fromEntries(data),
                before_minutes: Number(data.get("before_minutes")),
                after_minutes: Number(data.get("after_minutes")),
                sample_count: Number(data.get("sample_count")),
              },
            });
            toast("Pilot measurement saved");
            await refresh();
          },
        )),
  );
  updateTimer();
}
async function perform(action, message) {
  try {
    await action();
    toast(message);
    await refresh();
  } catch (error) {
    toast(error.message, true);
  }
}
function settings() {
  return (
    settingsBase() +
    (state.user.role === "manager"
      ? `<div class="report-grid team-settings"><section class="panel"><div class="panel-top"><div><h2>Projects & budgets</h2><p>Current total time against each project budget</p></div><button class="secondary" id="new-project">Add project</button></div><div class="panel-body">${state.projects.map((p) => `<div class="run-row"><span class="project-dot" style="background:${e(p.color)}"></span><strong>${e(p.name)}</strong><span>${hours(state.tasks.filter((t) => t.project_id === p.id).reduce((sum, t) => sum + t.logged_minutes, 0))} / ${hours(p.budget_minutes)}</span></div>`).join("")}</div></section><section class="panel"><div class="panel-top"><div><h2>Team accounts</h2><p>Members manage their own records. Managers see team reports.</p></div><button class="secondary" id="new-member">Add member</button></div><div class="panel-body">${state.users.map((u) => `<div class="run-row"><span class="avatar small">${initials(u.name)}</span><strong>${e(u.name)}</strong><span class="tag">${e(u.role)}</span></div>`).join("")}</div></section></div>`
      : "")
  );
}
function updateTimer() {
  const label = document.querySelector("#timer-value");
  if (label && state?.timer) {
    const seconds = Math.max(
      0,
      Math.floor(
        (Date.now() - new Date(state.timer.started_at).getTime()) / 1000,
      ),
    );
    label.textContent = `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }
}
setInterval(updateTimer, 1000);
refresh().catch((error) => {
  if (error.status === 401) login();
  else {
    root.innerHTML = `<main class="login"><h1>Workspace unavailable</h1><p>${e(error.message)}</p><button class="primary" id="reload">Try again</button></main>`;
    document.querySelector("#reload").onclick = () => location.reload();
  }
});
