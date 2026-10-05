import {
  randomBytes,
  createHash,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export function authenticate(db, email, password) {
  const user = db
    .prepare("SELECT * FROM users WHERE email=?")
    .get(email.toLowerCase());
  if (!user) return null;
  const [salt, hex] = user.password.split(":");
  const received = scryptSync(password, salt, 32),
    expected = Buffer.from(hex, "hex");
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  )
    return null;
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    digest(token),
    user.id,
    new Date(Date.now() + 8 * 3600000).toISOString(),
  );
  return {
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  };
}
export function session(db, req) {
  const cookie = String(req.headers.cookie || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("workledger="));
  if (!cookie) return null;
  const token = cookie.slice("workledger=".length);
  return (
    db
      .prepare(
        "SELECT u.id,u.name,u.email,u.role FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.hash=? AND s.expires_at>?",
      )
      .get(digest(token), new Date().toISOString()) || null
  );
}
