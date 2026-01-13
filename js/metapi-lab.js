import { getCatalogueItemsForKeyword } from "./metapi.js";

const el = {
  form: document.getElementById("labForm"),
  input: document.getElementById("labInput"),
  grid: document.getElementById("labGrid"),
  status: document.getElementById("labStatus"),
  clear: document.getElementById("labClearBtn"),
  tpl: document.getElementById("labCardTpl"),
  debugToggle: document.getElementById("debugToggle")
};

let controller = null;

function setStatus(msg) {
  el.status.textContent = msg || "";
}

function setDebugMode(on) {
  document.body.classList.toggle("lab-debug", Boolean(on));
}

setDebugMode(el.debugToggle.checked);

el.debugToggle.addEventListener("change", () => {
  setDebugMode(el.debugToggle.checked);
});

el.clear.addEventListener("click", () => {
  if (controller) controller.abort();
  el.grid.innerHTML = "";
  setStatus("");
  el.input.value = "";
  el.input.focus();
});

function renderItems(items, keyword) {
  el.grid.innerHTML = "";

  for (const item of items) {
    const node = el.tpl.content.firstElementChild.cloneNode(true);

    const img = node.querySelector(".artimg");
    const title = node.querySelector(".title");
    const sub = node.querySelector(".sub");
    const chip = node.querySelector(".chip");

    const dbg = node.querySelector(".dbg");
    const dbgtag = node.querySelector(".dbgtag");

    const rawpre = node.querySelector(".rawpre");

    img.src = item.imageUrl;
    img.alt = item.title || "Artwork";

    title.textContent = item.title || "Untitled";
    sub.textContent = [
      item.artist || "Unknown artist",
      item.date || "Undated",
      item.department || "",
      item.culture || ""
    ].filter(Boolean).join(" • ");

    chip.textContent = keyword;

    // Debug overlay (lab only)
    dbgtag.textContent = `kw: ${keyword}  •  id: ${item.objectID}`;
    dbg.setAttribute("aria-hidden", "true");

    rawpre.textContent = JSON.stringify(item, null, 2);

    el.grid.appendChild(node);
  }
}

el.form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const keyword = String(el.input.value || "").trim();
  if (!keyword) {
    setStatus("Type a keyword first.");
    return;
  }

  if (controller) controller.abort();
  controller = new AbortController();

  setStatus(`Fetching results for “${keyword}”…`);
  el.grid.innerHTML = "";

  try {
    // Lab defaults: more results, slightly gentler concurrency.
    const items = await getCatalogueItemsForKeyword(keyword, {
      need: 12,
      overscan: 120,
      concurrency: 3,
      shuffle: true,
      signal: controller.signal
    });

    if (!items.length) {
      setStatus(`No usable images found for “${keyword}”. Try a different word.`);
      return;
    }

    renderItems(items, keyword);
    setStatus("");
  } catch (err) {
    if (controller?.signal?.aborted) return;
    setStatus(`Error: ${err?.message || "Unknown error"}`);
  }
});
