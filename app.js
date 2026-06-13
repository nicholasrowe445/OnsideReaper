
window.addEventListener("error", event => {
  const box = document.querySelector("#status");
  if (box) box.textContent = "App error: " + (event.message || "unknown error");
});
window.addEventListener("unhandledrejection", event => {
  const box = document.querySelector("#status");
  if (box) box.textContent = "App error: " + ((event.reason && event.reason.message) || event.reason || "unknown error");
});
const API = "https://runescape.wiki/api.php";
const WIKI_BASE = "https://runescape.wiki/w/";
const MAP_GUIDE_TITLE = "Treasure Trails/Guide/Maps";

const clueText = document.querySelector("#clueText");
const searchBtn = document.querySelector("#searchBtn");
const autoBtn = document.querySelector("#autoBtn");
const clearBtn = document.querySelector("#clearBtn");
const scanBtn = document.querySelector("#scanBtn");
const mapBtn = document.querySelector("#mapBtn");
const imageInput = document.querySelector("#imageInput");
const cameraInput = document.querySelector("#cameraInput");
const statusBox = document.querySelector("#status");
const results = document.querySelector("#results");
const pasteZone = document.querySelector("#pasteZone");
const preview = document.querySelector("#preview");
const tierSelect = document.querySelector("#tierSelect");

let currentImage = null;
let mapImageCache = {};
let lastMapUserHash = null;
const LEARNED_MAP_KEY = "rs3ClueLearnedMapMatches.v1";
const REJECTED_MAP_KEY = "rs3ClueRejectedMapMatches.v1";
const TIER_LABELS = { all: "All difficulties", easy: "Easy", medium: "Medium", hard: "Hard", elite: "Elite", master: "Master" };
const TIER_CATEGORIES = {
  easy: ["Category:Easy clue scroll maps", "Category:Easy Treasure Trail maps", "Category:Easy map clues"],
  medium: ["Category:Medium clue scroll maps", "Category:Medium Treasure Trail maps", "Category:Medium map clues"],
  hard: ["Category:Hard clue scroll maps", "Category:Hard Treasure Trail maps", "Category:Hard map clues"],
  elite: ["Category:Elite clue scroll maps", "Category:Elite Treasure Trail maps", "Category:Elite map clues"],
  master: ["Category:Master clue scroll maps", "Category:Master Treasure Trail maps", "Category:Master map clues"]
};

function selectedTier() {
  return tierSelect?.value || "all";
}

function loadLearnedMapMatches() {
  try {
    const raw = localStorage.getItem(LEARNED_MAP_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLearnedMapMatches(items) {
  localStorage.setItem(LEARNED_MAP_KEY, JSON.stringify(items.slice(-300)));
}

function learnMapMatch(item, userHash) {
  if (!userHash || !item?.title) return;
  const learned = loadLearnedMapMatches();
  const entry = {
    title: item.title,
    thumb: item.thumb,
    url: item.url,
    hash: item.hash,
    userHash,
    tier: selectedTier(),
    learnedAt: new Date().toISOString()
  };
  const filtered = learned.filter(x => !(x.title === entry.title && x.userHash === entry.userHash));
  filtered.push(entry);
  saveLearnedMapMatches(filtered);
  setStatus(`Learned this map match. Next time, it will be boosted to the top.`);
}

function getLearnedCandidates(userHash, tier = selectedTier()) {
  if (!userHash) return [];
  return loadLearnedMapMatches()
    .filter(x => x.userHash && x.title)
    .filter(x => tier === "all" || !x.tier || x.tier === "all" || x.tier === tier)
    .map(x => ({ ...x, learned: true, learnedDistance: hamming(userHash, x.userHash), distance: hamming(userHash, x.userHash) }))
    .filter(x => x.learnedDistance <= 80)
    .sort((a, b) => a.learnedDistance - b.learnedDistance)
    .slice(0, 3);
}

function loadRejectedMapMatches() {
  try {
    const raw = localStorage.getItem(REJECTED_MAP_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRejectedMapMatches(items) {
  localStorage.setItem(REJECTED_MAP_KEY, JSON.stringify(items.slice(-600)));
}

function rejectMapMatch(item, userHash) {
  if (!userHash || !item?.title) return;
  const rejected = loadRejectedMapMatches();
  const entry = {
    title: item.title,
    userHash,
    tier: selectedTier(),
    rejectedAt: new Date().toISOString()
  };
  const filtered = rejected.filter(x => !(x.title === entry.title && x.userHash === entry.userHash));
  filtered.push(entry);
  saveRejectedMapMatches(filtered);
  setStatus(`Removed that option. The app will hide it for similar screenshots going forward.`);
}

function getRejectedTitles(userHash, tier = selectedTier()) {
  if (!userHash) return new Set();
  return new Set(loadRejectedMapMatches()
    .filter(x => x.userHash && x.title)
    .filter(x => tier === "all" || !x.tier || x.tier === "all" || x.tier === tier)
    .filter(x => hamming(userHash, x.userHash) <= 80)
    .map(x => x.title));
}

function clearLearnedMapMatches() {
  localStorage.removeItem(LEARNED_MAP_KEY);
  localStorage.removeItem(REJECTED_MAP_KEY);
  setStatus("Cleared learned and rejected map matches.");
}

function setStatus(message) {
  statusBox.style.display = message ? "block" : "none";
  statusBox.textContent = message || "";
}

function escapeHtml(str) {
  return String(str).replace(/[&<>'"]/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;"
  }[char]));
}

function selectedMode() {
  return document.querySelector('input[name="mode"]:checked')?.value || "auto";
}

function normaliseClue(text) {
  return text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\b(east)\s+Ardougne\b/ig, "East Ardougne")
    .replace(/\s+/g, " ")
    .trim();
}

function getBestClueLine(text) {
  const cleaned = normaliseClue(text);
  const equipIndex = cleaned.toLowerCase().indexOf(" equip ");
  if (equipIndex > 10) return cleaned.slice(0, equipIndex).trim();
  return cleaned.split(/(?<=\.)\s+/)[0]?.trim() || cleaned;
}

function looksLikeMapText(text) {
  const letters = (text.match(/[a-z]/gi) || []).length;
  const words = (text.match(/[a-z]{3,}/gi) || []).length;
  return letters < 14 || words < 3;
}

function makeImageFile(blob) {
  currentImage = blob;
  preview.src = URL.createObjectURL(blob);
  preview.hidden = false;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    setStatus("Copied. On the RS Wiki page, press Ctrl+F then Ctrl+V.");
    return true;
  } catch {
    setStatus("Could not auto-copy. Copy the matched clue text manually.");
    return false;
  }
}

async function openWikiAndCopy(url, clueLine) {
  if (clueLine) await copyText(clueLine);
  window.open(url, "_blank", "noopener,noreferrer");
}

async function runOcr({ quiet = false } = {}) {
  if (!currentImage && imageInput.files?.[0]) currentImage = imageInput.files[0];
  if (!currentImage) throw new Error("Paste, drop, or choose a screenshot first.");

  if (!quiet) setStatus("Reading screenshot text...");
  const worker = await Tesseract.createWorker("eng");
  const { data } = await worker.recognize(currentImage);
  await worker.terminate();
  clueText.value = normaliseClue(data.text);
  if (!quiet) setStatus("Text scanned. Matching to RS Wiki...");
  return clueText.value;
}

async function wikiSearch(query) {
  const fullClue = normaliseClue(query);
  const clueLine = getBestClueLine(fullClue);
  if (!clueLine) throw new Error("Enter or scan a clue first.");

  const searches = [
    `\"${clueLine}\"`,
    `\"${clueLine}\" \"Treasure Trails/Guide/Emote clues\"`,
    `${clueLine} Treasure Trails emote clues`,
    `${fullClue} clue scroll`
  ];

  const seen = new Set();
  const combined = [];

  for (const srsearch of searches) {
    const params = new URLSearchParams({
      action: "query",
      list: "search",
      srsearch,
      srlimit: "8",
      format: "json",
      origin: "*"
    });
    const response = await fetch(`${API}?${params}`);
    const data = await response.json();
    for (const item of data?.query?.search || []) {
      if (!seen.has(item.title)) {
        seen.add(item.title);
        item._matchedClueLine = clueLine;
        combined.push(item);
      }
    }
    if (combined.length && srsearch.startsWith("\"")) break;
  }

  return combined.sort((a, b) => (b.score || 0) - (a.score || 0));
}

function wikiUrl(title, clueLine = "") {
  const pageUrl = WIKI_BASE + encodeURIComponent(title.replaceAll(" ", "_"));
  if (clueLine) return pageUrl + "#:~:text=" + encodeURIComponent(clueLine);
  return pageUrl;
}

function guideMapUrl(fileName = "") {
  let url = wikiUrl(MAP_GUIDE_TITLE);
  if (fileName) url += "#:~:text=" + encodeURIComponent(fileName.replace(/^File:/, "").replace(/\.[a-z]+$/i, ""));
  return url;
}

function renderTextResults(items) {
  results.innerHTML = "";
  if (!items.length) {
    results.innerHTML = `<article class="result"><h2>No text match found</h2><p>Try cropping closer to the clue text. If this is a map clue, use <strong>Match map screenshot</strong>.</p></article>`;
    return;
  }

  items.forEach((item, index) => {
    const title = item.title;
    const url = wikiUrl(title, item._matchedClueLine);
    const article = document.createElement("article");
    article.className = "result";
    article.innerHTML = `
      <h2>${index === 0 ? "Best match: " : ""}${escapeHtml(title)}</h2>
      ${index === 0 ? `<p class="match">Matched clue line: ${escapeHtml(item._matchedClueLine)}</p>` : ""}
      <p class="snippet">${item.snippet || "Open this RS Wiki result for the full guide."}</p>
      <p class="meta">Result score: ${Math.round(item.score || 0)}</p>
      <div class="result-actions">
        <button class="open-copy" type="button">Open Wiki + copy clue text</button>
        <button class="copy-only secondary" type="button">Copy clue text only</button>
      </div>
      <p class="hint small">After the wiki opens, press <strong>Ctrl+F</strong> then <strong>Ctrl+V</strong>.</p>
    `;

    article.querySelector(".open-copy").addEventListener("click", () => openWikiAndCopy(url, item._matchedClueLine));
    article.querySelector(".copy-only").addEventListener("click", () => copyText(item._matchedClueLine));
    results.appendChild(article);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function drawToHash(source, size = 16) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  canvas.width = size;
  canvas.height = size;
  ctx.drawImage(source, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  const grey = [];
  for (let i = 0; i < data.length; i += 4) {
    grey.push((data[i] * 0.299) + (data[i + 1] * 0.587) + (data[i + 2] * 0.114));
  }
  const avg = grey.reduce((a, b) => a + b, 0) / grey.length;
  return grey.map(v => v > avg ? 1 : 0).join("");
}

function hamming(a, b) {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) d++;
  return d + Math.abs(a.length - b.length);
}

async function hashBlob(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    return drawToHash(img);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function fetchPageMapImageTitles() {
  const imagesParams = new URLSearchParams({
    action: "query",
    prop: "images",
    titles: MAP_GUIDE_TITLE,
    imlimit: "500",
    format: "json",
    origin: "*"
  });
  const imgResponse = await fetch(`${API}?${imagesParams}`);
  const imgData = await imgResponse.json();
  const page = Object.values(imgData?.query?.pages || {})[0];
  return (page?.images || [])
    .map(i => i.title)
    .filter(title => /map|clue|treasure/i.test(title));
}

async function fetchCategoryImageTitles(tier) {
  const categories = TIER_CATEGORIES[tier] || [];
  const titles = new Set();

  for (const category of categories) {
    let cmcontinue = "";
    do {
      const params = new URLSearchParams({
        action: "query",
        list: "categorymembers",
        cmtitle: category,
        cmtype: "file",
        cmlimit: "500",
        format: "json",
        origin: "*"
      });
      if (cmcontinue) params.set("cmcontinue", cmcontinue);
      try {
        const response = await fetch(`${API}?${params}`);
        const data = await response.json();
        for (const member of data?.query?.categorymembers || []) titles.add(member.title);
        cmcontinue = data?.continue?.cmcontinue || "";
      } catch {
        cmcontinue = "";
      }
    } while (cmcontinue);
  }

  return [...titles].filter(title => /map|clue|treasure/i.test(title));
}

async function fetchWikiMapImages(tier = selectedTier()) {
  const cacheKey = tier || "all";
  if (mapImageCache[cacheKey]) return mapImageCache[cacheKey];
  setStatus(`Loading RS Wiki map clue images${tier !== "all" ? ` for ${TIER_LABELS[tier]}` : ""}...`);

  let imageTitles = tier !== "all" ? await fetchCategoryImageTitles(tier) : [];
  let usedTierFilter = imageTitles.length > 0;

  if (!imageTitles.length) {
    imageTitles = await fetchPageMapImageTitles();
  }

  imageTitles = imageTitles.slice(0, tier === "all" ? 160 : 120);

  const found = [];
  for (let i = 0; i < imageTitles.length; i += 40) {
    const batch = imageTitles.slice(i, i + 40);
    const infoParams = new URLSearchParams({
      action: "query",
      prop: "imageinfo",
      iiprop: "url|mime",
      iiurlwidth: "220",
      titles: batch.join("|"),
      format: "json",
      origin: "*"
    });
    const response = await fetch(`${API}?${infoParams}`);
    const data = await response.json();
    for (const p of Object.values(data?.query?.pages || {})) {
      const info = p.imageinfo?.[0];
      if (!info?.thumburl || !info.mime?.startsWith("image/")) continue;
      found.push({ title: p.title, thumb: info.thumburl, url: info.descriptionurl || wikiUrl(p.title) });
    }
  }

  const hashed = [];
  for (const item of found) {
    try {
      const img = await loadImage(item.thumb);
      hashed.push({ ...item, tier: usedTierFilter ? tier : "all", hash: drawToHash(img) });
    } catch {
      // Skip images that cannot be loaded due to browser/CORS/network limits.
    }
  }

  mapImageCache[cacheKey] = hashed;
  return mapImageCache[cacheKey];
}

async function matchMapNow() {
  if (!currentImage && imageInput.files?.[0]) currentImage = imageInput.files[0];
  if (!currentImage) throw new Error("Paste, drop, or choose a map clue screenshot first.");

  const tier = selectedTier();
  setStatus(`Comparing your screenshot with ${TIER_LABELS[tier].toLowerCase()} RS Wiki map clues...`);
  const userHash = await hashBlob(currentImage);
  lastMapUserHash = userHash;
  const wikiImages = await fetchWikiMapImages(tier);

  if (!wikiImages.length) {
    renderMapFallback("The browser could not load RS Wiki images for comparison.");
    setStatus("");
    return;
  }

  const rejectedTitles = getRejectedTitles(userHash, tier);

  const liveMatches = wikiImages
    .map(item => ({ ...item, distance: hamming(userHash, item.hash), learned: false }))
    .filter(item => !rejectedTitles.has(item.title))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 6);

  const learnedMatches = getLearnedCandidates(userHash, tier).filter(item => !rejectedTitles.has(item.title));
  const combined = [];
  const seen = new Set();
  for (const item of [...learnedMatches, ...liveMatches]) {
    if (seen.has(item.title)) continue;
    seen.add(item.title);
    combined.push(item);
  }

  renderMapResults(combined.slice(0, 6), tier);
  setStatus("");
}

function confidenceFromDistance(distance, bits = 256) {
  return Math.max(0, Math.round((1 - distance / bits) * 100));
}

function renderMapResults(matches, tier = selectedTier()) {
  results.innerHTML = "";
  if (!matches.length) {
    renderMapFallback("No close image match found.");
    return;
  }

  const guideUrl = wikiUrl(MAP_GUIDE_TITLE);
  const learnedCount = loadLearnedMapMatches().length;
  const rejectedCount = loadRejectedMapMatches().length;
  const tools = document.createElement("article");
  tools.className = "result learned-tools";
  tools.innerHTML = `<h2>Map learning</h2><p class="hint">Difficulty filter: <strong>${TIER_LABELS[tier]}</strong><br>Saved correct picks: <strong>${learnedCount}</strong><br>Saved rejected options: <strong>${rejectedCount}</strong></p><button class="secondary clear-learned" type="button">Clear learned map matches</button>`;
  tools.querySelector(".clear-learned").addEventListener("click", () => { clearLearnedMapMatches(); tools.querySelector("p").innerHTML = `Saved correct picks: <strong>0</strong><br>Saved rejected options: <strong>0</strong>`; });
  results.appendChild(tools);

  matches.forEach((item, index) => {
    const conf = confidenceFromDistance(item.distance);
    const article = document.createElement("article");
    article.className = "result map-result";
    article.innerHTML = `
      <h2>${index === 0 ? "Best map match: " : "Possible map match: "}${escapeHtml(item.title.replace(/^File:/, ""))}</h2>
      <img class="map-thumb" src="${escapeHtml(item.thumb)}" alt="${escapeHtml(item.title)}">
      <p class="meta">${item.learned ? "Remembered match" : "Visual confidence"}: ${item.learned ? `${Math.max(0, 100 - item.learnedDistance)}% from your ${TIER_LABELS[item.tier || "all"]} corrections` : `${conf}%`}</p>
      <div class="result-actions">
        <button class="open-guide" type="button">Open RS Wiki map guide</button>
        <button class="correct-map" type="button">✓ This is correct</button>
        <button class="wrong-map secondary" type="button">✕ This is not correct</button>
        <a class="button-link secondary-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">Open image page</a>
      </div>
      <p class="hint small">Tick <strong>This is correct</strong> to boost it next time, or <strong>This is not correct</strong> to hide it for similar screenshots.</p>
    `;
    article.querySelector(".open-guide").addEventListener("click", () => window.open(guideUrl, "_blank", "noopener,noreferrer"));
    article.querySelector(".correct-map").addEventListener("click", () => {
      learnMapMatch(item, lastMapUserHash);
      article.classList.add("learned-selected");
    });
    article.querySelector(".wrong-map").addEventListener("click", () => {
      rejectMapMatch(item, lastMapUserHash);
      article.remove();
      const remaining = results.querySelectorAll(".map-result").length;
      if (!remaining) renderMapFallback("All shown options were marked as not correct. Try changing the difficulty or open the RS Wiki map guide.");
    });
    results.appendChild(article);
  });
}

function renderMapFallback(reason) {
  const guideUrl = wikiUrl(MAP_GUIDE_TITLE);
  results.innerHTML = `
    <article class="result">
      <h2>Map matching fallback</h2>
      <p>${escapeHtml(reason)}</p>
      <p>Open the RS Wiki map guide and compare the picture manually.</p>
      <a class="button-link" href="${guideUrl}" target="_blank" rel="noopener noreferrer">Open RS Wiki map guide</a>
    </article>
  `;
}

async function matchTextNow() {
  setStatus("Searching the RS Wiki...");
  const items = await wikiSearch(clueText.value);
  renderTextResults(items);
  setStatus("");
}

async function autoMatchNow() {
  const mode = selectedMode();
  if (mode === "map") return matchMapNow();
  if (mode === "text") {
    await runOcr();
    return matchTextNow();
  }

  const text = await runOcr({ quiet: false });
  if (looksLikeMapText(text)) {
    clueText.value = "";
    setStatus("This looks like a map clue, switching to image matching...");
    return matchMapNow();
  }
  return matchTextNow();
}

pasteZone.addEventListener("click", () => pasteZone.focus());

window.addEventListener("paste", async event => {
  const item = [...(event.clipboardData?.items || [])].find(i => i.type.startsWith("image/"));
  if (!item) return;
  event.preventDefault();
  makeImageFile(item.getAsFile());
  try { await autoMatchNow(); }
  catch (error) { setStatus(error.message || "Could not read that screenshot."); }
});

pasteZone.addEventListener("dragover", event => {
  event.preventDefault();
  pasteZone.classList.add("active");
});

pasteZone.addEventListener("dragleave", () => pasteZone.classList.remove("active"));

pasteZone.addEventListener("drop", async event => {
  event.preventDefault();
  pasteZone.classList.remove("active");
  const file = [...event.dataTransfer.files].find(f => f.type.startsWith("image/"));
  if (!file) return;
  makeImageFile(file);
  try { await autoMatchNow(); }
  catch (error) { setStatus(error.message || "Could not read that screenshot."); }
});

imageInput.addEventListener("change", () => {
  if (imageInput.files?.[0]) makeImageFile(imageInput.files[0]);
});

cameraInput?.addEventListener("change", () => {
  if (cameraInput.files?.[0]) makeImageFile(cameraInput.files[0]);
});

scanBtn.addEventListener("click", async () => {
  try { await runOcr(); setStatus("Text scanned. Check it, then match."); }
  catch (error) { setStatus(error.message || "Could not read that screenshot."); }
});

mapBtn.addEventListener("click", async () => {
  try { await matchMapNow(); }
  catch (error) { setStatus(error.message || "Could not match that map screenshot."); }
});

searchBtn.addEventListener("click", async () => {
  try { await matchTextNow(); }
  catch (error) { setStatus(error.message); }
});

autoBtn.addEventListener("click", async () => {
  try { await autoMatchNow(); }
  catch (error) { setStatus(error.message || "Could not read that screenshot."); }
});

tierSelect?.addEventListener("change", () => {
  if (currentImage && selectedMode() === "map") {
    setStatus("Difficulty changed. Click Match map screenshot to rescan with the new filter.");
  }
});

clearBtn.addEventListener("click", () => {
  clueText.value = "";
  imageInput.value = "";
  if (cameraInput) cameraInput.value = "";
  currentImage = null;
  preview.hidden = true;
  preview.removeAttribute("src");
  results.innerHTML = "";
  setStatus("");
});
