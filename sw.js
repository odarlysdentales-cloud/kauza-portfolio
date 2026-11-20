// Offline service worker: precaches every file in files.json, serves cache-first.
// Safari only plays cached video when Range requests get a 206 slice, so those are handled here.
const VERSION = "202611201132";
const CACHE = "kauza-portfolio-" + VERSION;
const BASE = new URL(self.registration.scope).pathname;

async function precache(report) {
  const files = await (await fetch("files.json", { cache: "no-store" })).json();
  const cache = await caches.open(CACHE);
  let done = 0;
  for (const f of files) {
    if (!(await cache.match(f))) {
      const r = await fetch(f, { cache: "no-store" });
      if (!r.ok) throw new Error("fetch failed: " + f);
      await cache.put(f, r);
    }
    done++;
    if (done % 10 === 0 || done === files.length) report(done, files.length);
  }
}

async function broadcast(msg) {
  for (const c of await self.clients.matchAll({ includeUncontrolled: true })) c.postMessage(msg);
}

self.addEventListener("install", (e) => {
  e.waitUntil(precache((d, t) => broadcast({ type: "progress", done: d, total: t })).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
    broadcast({ type: "ready" });
  })());
});

async function rangeResponse(req, res) {
  const buf = await res.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") || "");
  const start = m && m[1] ? +m[1] : 0;
  const end = m && m[2] ? Math.min(+m[2], buf.byteLength - 1) : buf.byteLength - 1;
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      "Content-Type": res.headers.get("Content-Type") || "video/mp4",
      "Content-Range": `bytes ${start}-${end}/${buf.byteLength}`,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
    },
  });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const url = new URL(req.url);
    const local = url.origin === location.origin;
    const hit = local
      ? await cache.match(decodeURIComponent(url.pathname.slice(BASE.length)) || "index.html")
      : await cache.match(req);
    if (hit) return req.headers.has("range") ? rangeResponse(req, hit) : hit;
    try {
      const res = await fetch(req);
      // Google Fonts: keep a copy so the font also works offline.
      if (!local && res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      return (await cache.match("index.html")) || Response.error();
    }
  })());
});
