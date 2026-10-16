#!/usr/bin/env node
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;

/* minimal .env loader (KEY=value per line). Windows Notepad likes to save
   ".env" as ".env.txt" with the extension hidden, so accept that too. */
const envFile = [".env", ".env.txt"].map((f) => path.join(ROOT, f)).find((f) => fs.existsSync(f));
if (envFile) {
  fs.readFileSync(envFile, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  });
  console.log("Loaded settings from " + path.basename(envFile));
} else {
  console.log("No .env file found next to server.js; using environment variables only.");
}

const PORT = Number(process.env.PORT) || 4317;
const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || "data");
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, "");
const PROD = process.env.NODE_ENV === "production";
const SEED_DEMO = process.env.SEED_DEMO ? process.env.SEED_DEMO === "1" : !PROD;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".aac": "audio/aac",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".weba": "audio/webm",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".woff2": "font/woff2"
};

const db = require("./server/db")(DATA_DIR);
const defaults = require("./assets/js/defaults.js");
const api = require("./server/api")({ db, dataDir: DATA_DIR, secure: PUBLIC_URL.startsWith("https://"), trustProxy: process.env.TRUST_PROXY === "1" });
const discord = require("./server/discord")({ dataDir: DATA_DIR, port: PORT, publicUrl: PUBLIC_URL, api });

if (SEED_DEMO && !db.q.byName.get("demo")) {
  db.create({ username: "demo", email: "demo@khaleej.bio", password: "khaleej123", profile: defaults.demoProfile() });
  console.log("Seeded the demo account (demo / khaleej123). Set SEED_DEMO=0 to skip.");
}

const PAGES = new Set(["index.html", "login.html", "signup.html", "dashboard.html", "discord.html", "u.html"]);
const RESERVED = new Set(defaults.RESERVED);

function security(extra) {
  return Object.assign({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "SAMEORIGIN"
  }, extra || {});
}

/* the signed-in user (and the profile being viewed) go straight into the page,
   so the front end can read them synchronously like it always has */
function sendPage(req, res, name, extra) {
  fs.readFile(path.join(ROOT, name), "utf8", (err, html) => {
    if (err) {
      res.writeHead(404, security({ "Content-Type": "text/plain" }));
      return res.end("Not found");
    }
    const row = api.currentRow(req);
    const boot = Object.assign({
      me: row ? db.full(row) : null,
      site: { demo: !!db.q.byName.get("demo"), discord: discord.mode }
    }, extra || {});
    const tag = `<script>window.KG_BOOT=${JSON.stringify(boot)
      .replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029")};</script>`;
    const at = html.indexOf("<script");
    const out = at >= 0 ? html.slice(0, at) + tag + "\n" + html.slice(at) : html.replace("</head>", tag + "</head>");
    res.writeHead(extra && extra.status ? extra.status : 200, security({ "Content-Type": TYPES[".html"], "Cache-Control": "no-store" }));
    res.end(out);
  });
}

function sendProfile(req, res, username) {
  const row = username ? db.q.byName.get(username) : null;
  if (!row) return sendPage(req, res, "u.html", { profile: null, status: 404 });
  const prefetch = /prefetch|prerender/i.test(String(req.headers["sec-purpose"] || req.headers.purpose || ""));
  if (req.method === "GET" && !prefetch) db.countView(row.id);
  sendPage(req, res, "u.html", { profile: db.pub(db.q.byId.get(row.id)) });
}

/* static files with Range support, so audio and video can seek */
function sendFile(req, res, file, headers) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, security({ "Content-Type": "text/plain" }));
      return res.end("Not found");
    }
    const type = TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
    const base = security(Object.assign({ "Content-Type": type, "Accept-Ranges": "bytes" }, headers));
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
    if (range) {
      let start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : st.size - 1;
      if (!range[1]) end = st.size - 1;
      if (start < 0) start = 0;
      if (start >= st.size || end < start) {
        res.writeHead(416, Object.assign(base, { "Content-Range": `bytes */${st.size}` }));
        return res.end();
      }
      end = Math.min(end, st.size - 1);
      res.writeHead(206, Object.assign(base, { "Content-Range": `bytes ${start}-${end}/${st.size}`, "Content-Length": end - start + 1 }));
      if (req.method === "HEAD") return res.end();
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, Object.assign(base, { "Content-Length": st.size }));
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

http
  .createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, "http://x");
      decodeURIComponent(url.pathname);
    } catch (e) {
      res.writeHead(400);
      return res.end("Bad request");
    }
    const p = decodeURIComponent(url.pathname);

    if (/^\/(api|auth)\//.test(p)) {
      try {
        if ((await discord.handle(req, res)) !== false) return;
        if ((await api.handle(req, res)) !== false) return;
      } catch (e) {
        if (res.headersSent) return res.end();
        const code = e.status || 500;
        if (code === 500) console.error(e);
        res.writeHead(code, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: false, errors: { form: code === 413 ? "That file is too large." : "Something went wrong on our side." } }));
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, errors: { form: "Not found." } }));
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" });
      return res.end();
    }

    if (p === "/" || p === "/index.html") return sendPage(req, res, "index.html");
    if (p === "/u.html") return sendProfile(req, res, (url.searchParams.get("u") || url.searchParams.get("user") || "").trim());
    const page = p.slice(1);
    if (PAGES.has(page)) return sendPage(req, res, page);

    const media = p.match(/^\/media\/(\d+)\/([\w.-]+)$/);
    if (media && !media[2].endsWith(".part")) {
      return sendFile(req, res, path.join(DATA_DIR, "uploads", media[1], media[2]), {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox"
      });
    }

    if (p.startsWith("/assets/")) {
      const file = path.normalize(path.join(ROOT, p));
      if (!file.startsWith(path.join(ROOT, "assets") + path.sep)) {
        res.writeHead(403);
        return res.end("Forbidden");
      }
      return sendFile(req, res, file, { "Cache-Control": PROD ? "public, max-age=3600" : "no-store" });
    }
    if (p === "/favicon.ico") return sendFile(req, res, path.join(ROOT, "assets/img/logo-glyph.svg"), { "Content-Type": "image/svg+xml" });

    /* khaleej.bio/<name> */
    const name = p.match(/^\/([A-Za-z0-9_.]{1,20})(\/?)$/);
    if (name && !RESERVED.has(name[1].toLowerCase())) {
      if (name[2]) {
        res.writeHead(301, { Location: "/" + name[1] + url.search });
        return res.end();
      }
      return sendProfile(req, res, name[1]);
    }

    res.writeHead(404, security({ "Content-Type": "text/plain" }));
    res.end("Not found");
  })
  .listen(PORT, HOST, () => {
    console.log(`khaleej.bio running at http://127.0.0.1:${PORT}`);
  });
