import { writeFileSync } from "node:fs";
import { createApp } from "../server/app.js";
const { db } = createApp({ env: {} });
const users = db.prepare("SELECT id,name,role FROM users").all();
const projects = db.prepare("SELECT * FROM projects").all();
const tasks = db.prepare("SELECT * FROM tasks").all();
const entries = db.prepare("SELECT * FROM time_entries").all();
writeFileSync(
  new URL("../web/demo-data.json", import.meta.url),
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      users,
      projects,
      tasks,
      entries,
      runs: [],
      pilots: [],
      reports: [],
      timer: null,
      schedule: { enabled: false, weekday: 1, hour: 9, minute: 0 },
    },
    null,
    2,
  ),
);
db.close();
