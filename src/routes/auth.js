const express = require("express");
const crypto = require("crypto");
const { promisify } = require("util");
const { pool } = require("../services/database");
const { createSession, clearSessionCookie, requireAuth, cookieValue, tokenHash } = require("../middleware/auth");

const router = express.Router();
const scrypt = promisify(crypto.scrypt);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const derived = await scrypt(password, salt, 64);
  return `${salt}:${Buffer.from(derived).toString("hex")}`;
}
async function verifyPassword(password, stored) {
  const [salt, expectedHex] = String(stored).split(":");
  if (!salt || !expectedHex) return false;
  const actual = Buffer.from(await scrypt(password, salt, 64));
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
function databaseRequired(req, res, next) {
  if (!pool) return res.status(503).json({ error: "Accounts are not configured yet. Add DATABASE_URL to the backend environment." });
  next();
}

router.post("/register", databaseRequired, async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (!emailPattern.test(email) || email.length > 254) return res.status(400).json({ error: "Enter a valid email address." });
    if (password.length < 10 || password.length > 128) return res.status(400).json({ error: "Password must be 10–128 characters." });
    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(password);
    try {
      await pool.query("INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)", [id,email,passwordHash]);
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ error: "An account with that email already exists. Log in instead." });
      throw error;
    }
    await createSession(id, res);
    res.status(201).json({ user: { id, email } });
  } catch (error) { next(error); }
});

router.post("/login", databaseRequired, async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (!emailPattern.test(email) || password.length > 128) return res.status(400).json({ error: "Enter your email and password." });
    const result = await pool.query("SELECT id,email,password_hash FROM users WHERE email=$1", [email]);
    if (!result.rowCount || !(await verifyPassword(password, result.rows[0].password_hash))) {
      return res.status(401).json({ error: "Email or password is incorrect." });
    }
    await createSession(result.rows[0].id, res);
    res.json({ user: { id: result.rows[0].id, email: result.rows[0].email } });
  } catch (error) { next(error); }
});

router.post("/logout", async (req, res, next) => {
  try {
    const token = cookieValue(req.headers.cookie, "fmai_session");
    if (pool && token) await pool.query("DELETE FROM sessions WHERE token_hash=$1", [tokenHash(token)]);
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

router.get("/me", requireAuth, (req, res) => res.json({ user: req.user }));
module.exports = router;
