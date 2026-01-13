// server.js (root-static + MET-only proxy)
const express = require("express");
const http = require("http");
const https = require("https");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.disable("x-powered-by");

// ---- Proxy allow-list (so it's not an open proxy) ----
const ALLOW_HOSTS = new Set([
  "collectionapi.metmuseum.org",
  "images.metmuseum.org",
  "www.metmuseum.org"
]);

function parseAllowedUrl(raw) {
  try {
    const u = new URL(raw);
    const okProto = u.protocol === "https:" || u.protocol === "http:";
    const okHost = ALLOW_HOSTS.has(u.hostname);
    if (!okProto || !okHost) return null;
    return u;
  } catch {
    return null;
  }
}

function requestUrl(urlObj, onResponse, onError) {
  const lib = urlObj.protocol === "https:" ? https : http;

  const req = lib.request(
    urlObj,
    {
      method: "GET",
      headers: {
        "User-Agent": "met-book-maker/1.0",
        "Accept": "*/*"
      }
    },
    onResponse
  );

  req.on("error", onError);
  req.end();
}

// ---- Health (proves you're hitting THIS server) ----
app.get("/health", (_req, res) => res.json({ ok: true, port: PORT }));

// ---- Proxy route ----
app.get("/proxy", (req, res) => {
  const targetRaw = req.query.url;
  if (!targetRaw || typeof targetRaw !== "string") {
    res.status(400).send("Missing url");
    return;
  }

  const urlObj = parseAllowedUrl(targetRaw);
  if (!urlObj) {
    res.status(403).send("Host not allowed");
    return;
  }

  const MAX_REDIRECTS = 6;

  const go = (u, redirectsLeft) => {
    requestUrl(
      u,
      (upstream) => {
        const status = upstream.statusCode || 502;

        // Follow redirects
        if (
          status >= 300 &&
          status < 400 &&
          upstream.headers.location &&
          redirectsLeft > 0
        ) {
          upstream.resume();
          const next = new URL(upstream.headers.location, u);
          const allowedNext = parseAllowedUrl(next.toString());
          if (!allowedNext) {
            res.status(403).send("Redirect host not allowed");
            return;
          }
          go(allowedNext, redirectsLeft - 1);
          return;
        }

        res.status(status);

        const ct = upstream.headers["content-type"];
        if (ct) res.setHeader("content-type", ct);

        const isImage = typeof ct === "string" && ct.startsWith("image/");
        res.setHeader(
          "cache-control",
          isImage ? "public, max-age=86400, immutable" : "public, max-age=300"
        );

        res.setHeader("access-control-allow-origin", "*");

        upstream.pipe(res);
      },
      () => {
        res.status(502).send("Proxy request failed");
      }
    );
  };

  go(urlObj, MAX_REDIRECTS);
});

// ---- Serve your current folder structure (index.html at root) ----
const ROOT = __dirname;

// serve static assets: /styles.css, /js/app.js, etc.
app.use(express.static(ROOT));

// make sure / returns index.html
app.get("/", (_req, res) => {
  res.sendFile(path.join(ROOT, "index.html"));
});

app.listen(PORT, () => {
  console.log(`MCB server running → http://localhost:${PORT}`);
  console.log(`Health check → http://localhost:${PORT}/health`);
});
