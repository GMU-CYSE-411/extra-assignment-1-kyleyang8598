const fs = require("fs");
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const { DEFAULT_DB_FILE, openDatabase } = require("../db");

function sendPublicFile(response, fileName) {
  response.sendFile(path.join(__dirname, "..", "public", fileName));
}

function createSessionId() {
  return crypto.randomBytes(32).toString("hex");
}

function createCsrfToken() {
  return crypto.randomBytes(24).toString("hex");
}

async function createApp() {
  if (!fs.existsSync(DEFAULT_DB_FILE)) {
    throw new Error(
      `Database file not found at ${DEFAULT_DB_FILE}. Run "npm run init-db" first.`
    );
  }

  const db = openDatabase(DEFAULT_DB_FILE);
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  app.use("/css", express.static(path.join(__dirname, "..", "public", "css")));
  app.use("/js", express.static(path.join(__dirname, "..", "public", "js")));

  app.use(async (request, response, next) => {
    const sessionId = request.cookies.sid;

    if (!sessionId) {
      request.currentUser = null;
      request.csrfToken = null;
      return next();
    }

    const row = await db.get(
      `
        SELECT
          sessions.id AS session_id,
          sessions.csrf_token AS csrf_token,
          users.id AS id,
          users.username AS username,
          users.role AS role,
          users.display_name AS display_name
        FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.id = ?
      `,
      [sessionId]
    );

    if (!row) {
      request.currentUser = null;
      request.csrfToken = null;
      return next();
    }

    request.currentUser = {
          sessionId: row.session_id,
          id: row.id,
          username: row.username,
          role: row.role,
          displayName: row.display_name
        };

    request.csrfToken = row.csrf_token;

    next();
  });

  function requireAuth(request, response, next) {
    if (!request.currentUser) {
      return response.status(401).json({ error: "Authentication required." });
    }

    next();
  }

  function requireAdmin(request, response, next) {
    if (!request.currentUser || request.currentUser.role !== "admin") {
      return response.status(403).json({ error: "Forbidden" });
    }
    next();
  }

  function verifyCsrf(request, response, next) {
    const token = request.body.csrfToken;
    if (!token || token !== request.csrfToken) {
      return response.status(403).json({ error: "Invalid CSRF token" });
    }
    next();
  }

  app.get("/", (_request, response) => sendPublicFile(response, "index.html"));
  app.get("/login", (_request, response) => sendPublicFile(response, "login.html"));
  app.get("/notes", (_request, response) => sendPublicFile(response, "notes.html"));
  app.get("/settings", (_request, response) => sendPublicFile(response, "settings.html"));
  app.get("/admin", (_request, response) => sendPublicFile(response, "admin.html"));

  app.get("/api/me", (request, response) => {
    response.json({ user: request.currentUser, csrfToken: request.csrfToken });
  });

  app.post("/api/login", async (request, response) => {
    const username = String(request.body.username || "");
    const password = String(request.body.password || "");

    const user = await db.get(
      `SELECT id, username, role, display_name
      FROM users
      WHERE username = ? AND password = ?`,
      [username, password]
    );

    if (!user) {
      return response.status(401).json({ error: "Invalid username or password." });
    }

    const sessionId = createSessionId();
    const csrfToken = createCsrfToken();

    await db.run("DELETE FROM sessions WHERE id = ?", [sessionId]);
    await db.run(
      "INSERT INTO sessions (id, user_id, csrf_token, created_at) VALUES (?, ?, ?, ?)",
      [sessionId, user.id, csrfToken, new Date().toISOString()]
    );

    response.cookie("sid", sessionId, {
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
      path: "/"
    });

    response.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        displayName: user.display_name
      },
      csrfToken
    });
  });

  app.post("/api/logout", requireAuth, verifyCsrf, async (request, response) => {
    await db.run("DELETE FROM sessions WHERE id = ?", [request.currentUser.sessionId]);
    response.clearCookie("sid");
    response.json({ ok: true });
  });

  app.get("/api/notes", requireAuth, async (request, response) => {
    const ownerId = request.query.ownerId || request.currentUser.id;
    const search = request.query.search || "";

    const notes = await db.all(
      `
      SELECT
        notes.id,
        notes.owner_id AS ownerId,
        users.username AS ownerUsername,
        notes.title,
        notes.body,
        notes.pinned,
        notes.created_at AS createdAt
      FROM notes
      JOIN users ON users.id = notes.owner_id
      WHERE notes.owner_id = ?
      AND (notes.title LIKE ? OR notes.body LIKE ?)
      ORDER BY notes.pinned DESC, notes.id DESC
      `,
      [request.currentUser.id, `%${search}%`, `%${search}%`]
    );

    response.json({ notes });
  });

  app.post("/api/notes", requireAuth, verifyCsrf, async (request, response) => {
    const title = String(request.body.title || "");
    const body = String(request.body.body || "");
    const pinned = request.body.pinned ? 1 : 0;

    const result = await db.run(
      "INSERT INTO notes (owner_id, title, body, pinned, created_at) VALUES (?, ?, ?, ?, ?)",
      [request.currentUser.id, title, body, pinned, new Date().toISOString()]
    );

    response.status(201).json({
      ok: true,
      noteId: result.lastID
    });
  });

  app.get("/api/settings", requireAuth, async (request, response) => {
    const settings = await db.get(
      `
        SELECT
          users.id AS userId,
          users.username,
          users.role,
          users.display_name AS displayName,
          settings.status_message AS statusMessage,
          settings.theme,
          settings.email_opt_in AS emailOptIn
        FROM settings
        JOIN users ON users.id = settings.user_id
        WHERE settings.user_id = ?
      `,
      [request.currentUser.id]
    );

    response.json({ settings });
  });

  app.post("/api/settings", requireAuth, verifyCsrf, async (request, response) => {
    const displayName = String(request.body.displayName || "");
    const statusMessage = String(request.body.statusMessage || "");
    const theme = String(request.body.theme || "classic");
    const emailOptIn = request.body.emailOptIn ? 1 : 0;

    await db.run("UPDATE users SET display_name = ? WHERE id = ?", [displayName, request.currentUser.id]);
    await db.run(
      "UPDATE settings SET status_message = ?, theme = ?, email_opt_in = ? WHERE user_id = ?",
      [statusMessage, theme, emailOptIn, request.currentUser.id]
    );

    response.json({ ok: true });
  });

  app.post("/api/settings/toggle-email", requireAuth, verifyCsrf, async (request, response) => {
    const enabled = request.body.enabled ? 1 : 0;

    await db.run("UPDATE settings SET email_opt_in = ? WHERE user_id = ?", [
      enabled,
      request.currentUser.id
    ]);

    response.json({
      ok: true,
      userId: request.currentUser.id,
      emailOptIn: enabled
    });
  });

  app.get("/api/admin/users", requireAuth, async (_request, response) => {
    const users = await db.all(`
      SELECT
        users.id,
        users.username,
        users.role,
        users.display_name AS displayName,
        COUNT(notes.id) AS noteCount
      FROM users
      LEFT JOIN notes ON notes.owner_id = users.id
      GROUP BY users.id
      ORDER BY users.id
    `);

    response.json({ users });
  });

  return app;
}

module.exports = {
  createApp
};
