import { resolve } from "node:path";
import { createApp } from "./app.js";
import { tick } from "./jobs.js";
const { app, db } = createApp({
  databasePath: resolve(process.env.DATABASE_PATH || ".data/workledger.sqlite"),
  demo: process.env.SEED_DEMO !== "0",
});
const server = app.listen(
  Number(process.env.PORT || 8770),
  process.env.HOST || "127.0.0.1",
  () => console.log(`Workledger listening on ${process.env.PORT || 8770}`),
);
const scheduler = setInterval(() => {
  try {
    tick(db);
  } catch {
    console.error("Scheduled brief failed");
  }
}, 15000);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    clearInterval(scheduler);
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
