const MET_API = "https://collectionapi.metmuseum.org/public/collection/v1";

// ---- Image proxy stays (only for images) ----
export function proxyUrl(rawUrl) {
  if (!rawUrl) return "";
  return `/proxy?url=${encodeURIComponent(rawUrl)}`;
}

// ---- Polite request scheduler ----
const MAX_CONCURRENCY = 2;       // keep low to avoid looking like a bot
const MIN_GAP_MS = 220;          // minimum delay between request starts
const MAX_RETRIES = 4;

let active = 0;
let lastStart = 0;
const queue = [];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function schedule(task) {
  return new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    pump();
  });
}

async function pump() {
  if (active >= MAX_CONCURRENCY) return;
  const item = queue.shift();
  if (!item) return;

  active++;

  const now = Date.now();
  const wait = Math.max(0, MIN_GAP_MS - (now - lastStart));
  if (wait) await sleep(wait);
  lastStart = Date.now();

  try {
    const out = await item.task();
    item.resolve(out);
  } catch (e) {
    item.reject(e);
  } finally {
    active--;
    pump();
  }
}

// ---- Cache (memory + optional localStorage) ----
const memCache = new Map();
const LS_KEY = "mcb_met_object_cache_v1";
let lsCache = null;

function loadLsCache() {
  if (lsCache) return lsCache;
  try {
    const raw = localStorage.getItem(LS_KEY);
    lsCache = raw ? JSON.parse(raw) : {};
  } catch {
    lsCache = {};
  }
  return lsCache;
}

function saveLsCacheDebounced() {
  // tiny debounce so we don’t spam localStorage
  clearTimeout(saveLsCacheDebounced._t);
  saveLsCacheDebounced._t = setTimeout(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(loadLsCache()));
    } catch {}
  }, 600);
}

// ---- Fetch helpers ----
async function fetchJsonDirect(url, { timeoutMs = 12000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  const r = await fetch(url, {
    signal: ctrl.signal,
    headers: {
      // make it look like a normal browser request, not a script
      "Accept": "application/json,text/plain,*/*"
    }
  });

  clearTimeout(t);

  // If MET returns HTML/blocked pages, this will usually be non-JSON.
  // We treat non-OK as a controlled failure and retry politely.
  if (!r.ok) {
    const err = new Error(`HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }

  return r.json();
}

async function fetchJson(url) {
  return schedule(async () => {
    let attempt = 0;
    let backoff = 500;

    while (true) {
      try {
        return await fetchJsonDirect(url);
      } catch (e) {
        attempt++;

        const status = e.status || 0;

        // Retry only on “likely temporary / protection” codes
        const retryable =
          status === 403 || status === 429 || (status >= 500 && status <= 599);

        if (!retryable || attempt > MAX_RETRIES) throw e;

        // Exponential backoff with a little jitter
        const jitter = Math.floor(Math.random() * 250);
        await sleep(backoff + jitter);
        backoff *= 2;
      }
    }
  });
}

// ---- Public API ----
export async function searchObjectIDs(query, { hasImages = true } = {}) {
  const q = String(query || "").trim();
  if (!q) return [];

  const url =
    `${MET_API}/search?` +
    new URLSearchParams({
      q,
      hasImages: hasImages ? "true" : "false"
    }).toString();

  const data = await fetchJson(url);
  if (!data || !Array.isArray(data.objectIDs)) return [];
  return data.objectIDs;
}

export async function fetchObject(objectID) {
  const id = Number(objectID);
  if (!Number.isFinite(id)) return null;

  // Memory cache
  if (memCache.has(id)) return memCache.get(id);

  // localStorage cache
  const store = loadLsCache();
  if (store[id]) {
    memCache.set(id, store[id]);
    return store[id];
  }

  const url = `${MET_API}/objects/${id}`;

  let obj;
  try {
    obj = await fetchJson(url);
  } catch (e) {
    // Controlled failure: don’t explode UI, just return null.
    return null;
  }

  if (!obj) return null;

  const img = obj.primaryImageSmall || obj.primaryImage || "";
  if (!img) return null;

  const out = {
    objectID: obj.objectID,
    title: obj.title || "Untitled",
    artist: obj.artistDisplayName || obj.culture || "",
    date: obj.objectDate || "",
    department: obj.department || "",
    medium: obj.medium || "",
    image: proxyUrl(img),
    rawImage: img,
    objectURL: obj.objectURL || ""
  };

  memCache.set(id, out);
  store[id] = out;
  saveLsCacheDebounced();

  return out;
}

export async function mapPool(items, limit, worker) {
  // Keep app-level pools modest too; the scheduler enforces global limits.
  const results = new Array(items.length);
  let idx = 0;

  async function run() {
    while (true) {
      const i = idx++;
      if (i >= items.length) break;
      results[i] = await worker(items[i], i);
    }
  }

  const n = Math.max(1, Math.min(limit || 3, items.length || 1));
  await Promise.all(Array.from({ length: n }, run));
  return results;
}

export async function pickObjectsForKeywords({
  keywords = [],
  perKeyword = 1,
  maxCandidatesPerKeyword = 28,
  pool = 3
} = {}) {
  const packs = await mapPool(keywords, pool, async (kw) => {
    const ids = await searchObjectIDs(kw, { hasImages: true });

    // Don’t sample too deep; we want fewer object calls.
    const trimmed = ids.slice(0, maxCandidatesPerKeyword);

    const objs = await mapPool(trimmed, pool, async (id) => fetchObject(id));
    const good = objs.filter(Boolean);

    return { keyword: kw, candidates: good };
  });

  const selections = [];
  const used = new Set();

  for (const pack of packs) {
    let picked = 0;
    for (const c of pack.candidates) {
      if (picked >= perKeyword) break;
      if (used.has(c.objectID)) continue;
      used.add(c.objectID);
      selections.push({ keyword: pack.keyword, object: c });
      picked++;
    }
  }

  return { selections, usedObjectIDs: used };
}

//flower, cheese, cat, dog, oil, plaster, moon