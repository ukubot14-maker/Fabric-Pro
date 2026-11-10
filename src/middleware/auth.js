const crypto = require("crypto");
const { pool, isReady } = require("../services/database");

function cookieValue(header, name) {
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return "";
}
function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}
function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `fmai_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=None${secure}; Max-Age=2592000`);
}
function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `fmai_session=; HttpOnly; Path=/; SameSite=None${secure}; Max-Age=0`);
}
async function createSession(userId, res) {
  if (!pool) throw new Error("Account database is not configured.");
  const token = crypto.randomBytes(32).toString("base64url");
  await pool.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '30 days')",
    [tokenHash(token), userId]
  );
  setSessionCookie(res, token);
}
async function requireAuth(req, res, next) {
  try {
    if (!isReady()) return res.status(503).json({ error: "Accounts are not ready yet. The server needs its DATABASE_URL configured." });
    const token = cookieValue(req.headers.cookie, "fmai_session");
    if (!token || token.length > 128) return res.status(401).json({ error: "Please log in to continue." });
    const result = await pool.query(
      "SELECT u.id,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW()",
      [tokenHash(token)]
    );
    if (!result.rowCount) {
      clearSessionCookie(res);
      return res.status(401).json({ error: "Your session expired. Please log in again." });
    }
    req.user = result.rows[0];
    next();
  } catch (error) {
    next(error);
  }
}
module.exports = { pool, createSession, requireAuth, clearSessionCookie, cookieValue, tokenHash };
