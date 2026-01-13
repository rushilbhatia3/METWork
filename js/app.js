import {
  fetchObject,
  mapPool,
  pickObjectsForKeywords,
  searchObjectIDs
} from "./metapi.js";



const el = {
  form: document.getElementById("searchForm"),
  input: document.getElementById("keywordsInput"),
  grid: document.getElementById("grid"),
  status: document.getElementById("status"),
  printBtn: document.getElementById("printBtn"),
  tpl: document.getElementById("cardTpl")
};

const PREFETCH_IDS = [
  436121, 436535, 437853, 435882, 437329, 459055, 438815, 437133, 438011,
  436105, 436454, 438722, 437980, 437658, 437430, 438023, 436839, 436532,
  39799, 54424, 248706, 20534, 459098, 437432, 436837, 436107, 437658
];

// State
let state = {
  mode: "prefetch", // "prefetch" | "search"
  artistBias: [],
  cards: [], // { keyword, object, candidates, cursor }
  used: new Set()
};

const IMG_MAX_CONCURRENCY = 4;
const IMG_ROOT_MARGIN = "900px 0px"; // start loading before it enters view

let imgQueue = [];
let imgActive = 0;
let io = null;

function pumpImageQueue() {
  while (imgActive < IMG_MAX_CONCURRENCY && imgQueue.length) {
    const img = imgQueue.shift();
    if (!img || img.dataset.loaded === "1") continue;

    imgActive++;
    img.dataset.loaded = "1";

    const src = img.dataset.src;
    if (!src) {
      imgActive--;
      continue;
    }

    img.onload = () => {
      imgActive--;
      pumpImageQueue();
    };

    img.onerror = () => {
      // allow retry later if needed
      imgActive--;
      img.dataset.loaded = "0";
      pumpImageQueue();
    };

    img.src = src;
  }
}

function observeImages(container) {
  if (io) io.disconnect();

  io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;

        const img = e.target;
        io.unobserve(img);

        // enqueue instead of loading instantly
        imgQueue.push(img);
        pumpImageQueue();
      }
    },
    { root: null, rootMargin: IMG_ROOT_MARGIN, threshold: 0.01 }
  );

  container.querySelectorAll("img.artimg[data-src]").forEach((img) => {
    if (img.dataset.loaded !== "1") io.observe(img);
  });
}

function deriveKeyword(obj) {
  const pickFrom = (str, words) => {
    if (!str) return null;
    const s = str.toLowerCase();
    return words.find((w) => s.includes(w)) || null;
  };

  // Gentle vocabulary we allow ourselves
  const TITLE_WORDS = [
    "portrait",
    "landscape",
    "still life",
    "self-portrait",
    "study",
    "view",
    "interior",
    "figure",
    "scene"
  ];

  const MEDIUM_WORDS = [
    "oil",
    "watercolor",
    "drawing",
    "etching",
    "woodblock",
    "print",
    "ink",
    "bronze"
  ];

  return (
    pickFrom(obj.title, TITLE_WORDS) ||
    pickFrom(obj.medium, MEDIUM_WORDS) ||
    (obj.culture && obj.culture.split(" ")[0].toLowerCase()) ||
    (obj.department && obj.department.split(" ")[0].toLowerCase()) ||
    "archive"
  );
}

async function getAlternativesForKeyword(keyword, { want = 10 } = {}) {
  const ids = await searchObjectIDs(keyword, { hasImages: true });
  if (!ids.length) return [];

  // Take a modest slice; the metapi scheduler already rate-limits
  const slice = ids.slice(0, 40);

  const objs = await mapPool(slice, 3, async (id) => fetchObject(id));
  const good = objs.filter(Boolean);

  // Keep only unique and return a small list
  const seen = new Set();
  const uniq = [];
  for (const o of good) {
    if (seen.has(o.objectID)) continue;
    seen.add(o.objectID);
    uniq.push(o);
    if (uniq.length >= want) break;
  }

  return uniq;
}


function setStatus(msg) {
  el.status.textContent = msg || "";
}

function safeText(s) {
  return String(s || "").trim();
}

function parseKeywordsAndArtists(str) {
  const raw = safeText(str);
  if (!raw) return { keywords: [], artists: [] };

  const [kwPartRaw, artistPartRaw] = raw.split("|").map((s) => safeText(s));
  const keywords = kwPartRaw
    ? kwPartRaw.split(/[,\n;]+/).map((s) => safeText(s)).filter(Boolean)
    : [];

  const artists = artistPartRaw
    ? artistPartRaw.split(/[,\n;]+/).map((s) => safeText(s)).filter(Boolean)
    : [];

  return { keywords, artists };
}

function clearGrid() {
  el.grid.innerHTML = "";
}

function makeCardNode(card, index) {
  const node = el.tpl.content.firstElementChild.cloneNode(true);

  node.dataset.index = String(index);
  node.dataset.keyword = card.keyword;
  node.dataset.objectId = String(card.object.objectID);

  const img = node.querySelector(".artimg");
  const title = node.querySelector(".title");
  const sub = node.querySelector(".sub");
  const chip = node.querySelector(".chip");
  const swapBtn = node.querySelector(".swapBtn");
  const removeBtn = node.querySelector(".removeBtn");

  img.dataset.src = card.object.image;
  img.src = ""; // keep empty until we decide to load it
  img.loading = "lazy";
  img.alt = card.object.title || "Artwork";

  title.textContent = card.object.title || "Untitled";
  sub.textContent = [
    card.object.artist,
    card.object.date,
    card.object.department
  ].filter(Boolean).join(" · ");

  const label = card.keyword || deriveKeyword(card.object);
  chip.textContent = label;

  // Actions
  swapBtn?.addEventListener("click", () => swapCard(index));
  removeBtn?.addEventListener("click", () => removeCard(index));

  // Drag reorder
  node.addEventListener("dragstart", (e) => {
    node.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  });

  node.addEventListener("dragend", () => {
    node.classList.remove("dragging");
    el.grid.querySelectorAll(".drop-target").forEach((n) => n.classList.remove("drop-target"));
  });

  node.addEventListener("dragover", (e) => {
    e.preventDefault();
    node.classList.add("drop-target");
  });

  node.addEventListener("dragleave", () => {
    node.classList.remove("drop-target");
  });

  node.addEventListener("drop", (e) => {
    e.preventDefault();
    const from = Number(e.dataTransfer.getData("text/plain"));
    const to = index;
    if (!Number.isFinite(from) || from === to) return;
    reorder(from, to);
  });

  return node;
}

function render() {
  clearGrid();

  const frag = document.createDocumentFragment();
  state.cards.forEach((card, i) => frag.appendChild(makeCardNode(card, i)));
  el.grid.appendChild(frag);
  observeImages(el.grid);
}

function reorder(from, to) {
  const next = state.cards.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  state.cards = next;
  render();
}

function removeCard(index) {
  const card = state.cards[index];
  if (!card) return;

  state.used.delete(card.object.objectID);
  state.cards.splice(index, 1);
  render();
}

async function swapCard(index) {
  const card = state.cards[index];
  if (!card) return;

  // Prefetch mode: still uses PREFETCH_IDS logic you already have
  if (state.mode === "prefetch") {
    setStatus("Swapping…");
    const candidates = PREFETCH_IDS.filter((id) => !state.used.has(id));
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    if (!pick) {
      setStatus("No more prefetched IDs available.");
      return;
    }
    const obj = await fetchObject(pick);
    if (!obj) {
      setStatus("That ID had no usable image. Try again.");
      return;
    }
    state.used.add(obj.objectID);
    state.cards[index] = { keyword: "", object: obj, candidates: [], cursor: 0 };
    render();
    setStatus("");
    return;
  }

  // Search mode: fetch alternatives ONLY when user asks
  const kw = card.keyword || card.object?.title || "";
  if (!kw) {
    setStatus("No keyword to swap from.");
    return;
  }

  setStatus("Finding alternatives…");

  // If we already fetched candidates once, try cycling first
  const existing = Array.isArray(card.candidates) ? card.candidates : [];
  let cursor = Number.isFinite(card.cursor) ? card.cursor : 0;

  // try next candidate from existing cache
  for (let i = cursor + 1; i < existing.length; i++) {
    const cand = existing[i];
    if (!cand) continue;
    if (state.used.has(cand.objectID)) continue;

    state.used.delete(card.object.objectID);
    state.used.add(cand.objectID);

    state.cards[index] = { ...card, object: cand, cursor: i };
    render();
    setStatus("");
    return;
  }

  // Otherwise fetch a fresh batch of alternatives
  const alts = await getAlternativesForKeyword(kw, { want: 12 });

  // Merge (keep current + new), unique by objectID
  const merged = [];
  const seen = new Set();
  for (const o of [...existing, ...alts]) {
    if (!o) continue;
    if (seen.has(o.objectID)) continue;
    seen.add(o.objectID);
    merged.push(o);
  }

  // Pick first unused that isn't the current object
  const next = merged.find((o) => !state.used.has(o.objectID) && o.objectID !== card.object.objectID);

  if (!next) {
    // last resort: broaden the slice (still polite, still capped)
    const broader = await getAlternativesForKeyword(kw, { want: 20 });
    const broaderNext = broader.find((o) => !state.used.has(o.objectID) && o.objectID !== card.object.objectID);
    if (!broaderNext) {
      setStatus("No more alternatives for that keyword right now.");
      return;
    }
    merged.push(...broader);
    // fall through with broaderNext
    state.used.delete(card.object.objectID);
    state.used.add(broaderNext.objectID);
    state.cards[index] = { ...card, object: broaderNext, candidates: merged, cursor: merged.findIndex(x => x.objectID === broaderNext.objectID) };
    render();
    setStatus("");
    return;
  }

  // Swap to chosen alt
  state.used.delete(card.object.objectID);
  state.used.add(next.objectID);

  state.cards[index] = {
    ...card,
    object: next,
    candidates: merged,
    cursor: merged.findIndex((x) => x.objectID === next.objectID)
  };

  render();
  setStatus("");
}


async function loadPrefetchWall() {
  state.mode = "prefetch";
  state.cards = [];
  state.used = new Set();
  state.artistBias = [];

  setStatus("Loading wall…");

  // Load a balanced number; enough to feel rich, not heavy.
  const want = Math.min(26, PREFETCH_IDS.length);
  const ids = PREFETCH_IDS.slice(0, want);

  const objs = await mapPool(ids, 6, async (id) => fetchObject(id));
  const good = objs.filter(Boolean);

  state.cards = good.map((o) => ({
    keyword: "",
    object: o,
    candidates: [],
    cursor: 0
  }));

  good.forEach((o) => state.used.add(o.objectID));

  render();
  setStatus("");
}

async function runSearch(inputStr) {
  const { keywords } = parseKeywordsAndArtists(inputStr);

  if (!keywords.length) {
    await loadPrefetchWall();
    return;
  }

  state.mode = "search";
  state.cards = [];
  state.used = new Set();

  setStatus("Searching the collection…");
  render();

  // Calm settings: fewer candidates, lower app-level pool.
  const { selections } = await pickObjectsForKeywords({
    keywords,
    perKeyword: 1,
    maxCandidatesPerKeyword: 20,
    pool: 3
  });

  if (!selections.length) {
    state.cards = [];
    render();
    setStatus("No results with images. Try different keywords.");
    return;
  }

  // Build cards from selections (search replaces entire wall)
  const used = new Set();
  state.cards = selections
    .map((s) => s.object)
    .filter(Boolean)
    .filter((o) => {
      if (used.has(o.objectID)) return false;
      used.add(o.objectID);
      return true;
    })
    .map((o, i) => ({
      keyword: keywords[Math.min(i, keywords.length - 1)] || "", // keeps chip meaningful
      object: o,
      candidates: [o], // swap logic can be reintroduced later safely
      cursor: 0
    }));

  state.used = used;

  render();
  setStatus("");
}


function wireUI() {
  el.form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const val = el.input?.value || "";
    try {
      await runSearch(val);
    } catch (err) {
      console.error(err);
      setStatus("Search hit a network block. Try again in a few seconds.");
    }
  });

  el.printBtn?.addEventListener("click", () => {
    window.print();
  });
}

// Boot
(async function init() {
  wireUI();
  await loadPrefetchWall();
})();
