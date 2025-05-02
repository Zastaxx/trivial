// server.js
const fs         = require('fs');
const path       = require('path');
const express    = require('express');
const http       = require('http');
const sqlite3    = require('sqlite3').verbose();
const session    = require('express-session');
const SQLiteStore= require('connect-sqlite3')(session);
const { Server } = require('socket.io');

const routes     = require('./routes');
const sockets    = require('./sockets');

// --- Initialisation SQLite & dossier data/questions ---
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
const dbPath = path.join(dataDir, 'db.sqlite');
const db     = new sqlite3.Database(dbPath);
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT
    )
  `);
});

// --- Express + session ---
const app = express();
const sessionMiddleware = session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: dataDir }),
  secret: 'un-super-secret-123',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24*60*60*1000 }
});
app.use(sessionMiddleware);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// --- Routes HTTP & statics ---
routes(app, db);
app.use(express.static(path.join(__dirname, 'public')));

// --- HTTP + Socket.IO ---
const server = http.createServer(app);
const io     = new Server(server);
io.use((socket, next) => {
  sessionMiddleware(socket.request, socket.request.res || {}, next);
});
sockets(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`);
});
