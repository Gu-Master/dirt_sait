const DB_NAME = "multiverse-organizer";
const STORE = "images";
const META_KEY = "multiverse-meta";
const FAVORITES_KEY = "multiverse-favorites";
const REMOVED_KEY = "multiverse-removed";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const els = {
  ambientImage: $("#ambientImage"),
  currentIndex: $("#currentIndex"),
  totalCount: $("#totalCount"),
  cards: $("#cards"),
  filmView: $("#filmView"),
  gridView: $("#gridView"),
  searchInput: $("#searchInput"),
  filterSelect: $("#filterSelect"),
  sortSelect: $("#sortSelect"),
  titleInput: $("#titleInput"),
  imageWorld: $("#imageWorld"),
  imageMeta: $("#imageMeta"),
  favoriteBtn: $("#favoriteBtn"),
  shuffleBtn: $("#shuffleBtn"),
  fullscreenBtn: $("#fullscreenBtn"),
  downloadBtn: $("#downloadBtn"),
  deleteBtn: $("#deleteBtn"),
  prevBtn: $("#prevBtn"),
  nextBtn: $("#nextBtn"),
  fileInput: $("#fileInput"),
  folderInput: $("#folderInput"),
  pickFiles: $("#pickFiles"),
  pickFolder: $("#pickFolder"),
  pasteImage: $("#pasteImage"),
  cleanDuplicates: $("#cleanDuplicates"),
  portalStage: $("#portalStage"),
  dropLayer: $("#dropLayer"),
  lightbox: $("#lightbox"),
  lightboxImage: $("#lightboxImage"),
  closeLightbox: $("#closeLightbox"),
};

let db;
let allImages = [];
let visibleImages = [];
let objectUrls = new Map();
let activeId = null;
let view = "portal";
let saveTitleTimer = 0;
let portalZoom = 1;
let portalZoomTimer = 0;
let pinchStartDistance = 0;
let pinchStartZoom = 1;
let meta = loadJson(META_KEY, {});
let favorites = new Set(loadJson(FAVORITES_KEY, []));
let removedIds = new Set(loadJson(REMOVED_KEY, []));

init();

async function init() {
  db = await openDb();
  const seedImages = (window.SEED_IMAGES || []).map((item, index) => ({
    ...item,
    id: item.id || `seed-${index + 1}`,
    source: "seed",
    createdAt: item.modified || new Date().toISOString(),
    title: meta[item.id]?.title || prettyName(item.name || item.original || `Universe ${index + 1}`),
  }));

  const storedImages = await getStoredImages();
  allImages = [...seedImages.filter((image) => !removedIds.has(image.id)), ...storedImages];
  activeId = allImages[0]?.id || null;

  bindEvents();
  applyView();
  render();
}

function bindEvents() {
  els.prevBtn.addEventListener("click", () => step(-1));
  els.nextBtn.addEventListener("click", () => step(1));
  els.shuffleBtn.addEventListener("click", shuffle);
  els.favoriteBtn.addEventListener("click", toggleFavorite);
  els.deleteBtn.addEventListener("click", deleteActive);
  els.fullscreenBtn.addEventListener("click", openLightbox);
  els.closeLightbox.addEventListener("click", () => els.lightbox.close());

  els.pickFiles.addEventListener("click", () => els.fileInput.click());
  els.pickFolder.addEventListener("click", () => els.folderInput.click());
  els.fileInput.addEventListener("change", (event) => addFiles(event.target.files));
  els.folderInput.addEventListener("change", (event) => addFiles(event.target.files));
  els.pasteImage.addEventListener("click", pasteFromClipboard);
  els.cleanDuplicates.addEventListener("click", cleanDuplicates);
  els.portalStage.addEventListener("wheel", handlePortalWheel, { passive: false });
  els.portalStage.addEventListener("touchstart", (event) => {
    if (event.touches.length === 2) {
      pinchStartDistance = getTouchDistance(event.touches);
      pinchStartZoom = portalZoom;
    }
  });
  els.portalStage.addEventListener("touchmove", (event) => {
    if (event.touches.length !== 2 || !pinchStartDistance) return;
    event.preventDefault();
    const nextZoom = pinchStartZoom * (getTouchDistance(event.touches) / pinchStartDistance);
    setPortalZoom(nextZoom);
  });
  els.portalStage.addEventListener("touchend", (event) => {
    if (event.touches.length < 2) resetPortalZoom();
  });

  els.searchInput.addEventListener("input", render);
  els.filterSelect.addEventListener("change", render);
  els.sortSelect.addEventListener("change", render);

  els.titleInput.addEventListener("input", () => {
    clearTimeout(saveTitleTimer);
    saveTitleTimer = window.setTimeout(saveActiveTitle, 220);
  });

  $$(".view-tabs button").forEach((button) => {
    button.addEventListener("click", () => {
      view = button.dataset.view;
      applyView();
      render();
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.target.closest?.("input, select, textarea")) return;
    if (event.key === "ArrowLeft") step(-1);
    if (event.key === "ArrowRight") step(1);
    if (event.key.toLowerCase() === "f") toggleFavorite();
    if (event.key === "Escape" && els.lightbox.open) els.lightbox.close();
  });

  document.addEventListener("paste", (event) => {
    const files = [...(event.clipboardData?.files || [])].filter((file) => file.type.startsWith("image/"));
    if (files.length) addFiles(files);
  });

  window.addEventListener("dragenter", showDrop);
  window.addEventListener("dragover", (event) => {
    event.preventDefault();
    showDrop();
  });
  window.addEventListener("dragleave", (event) => {
    if (!event.relatedTarget) els.dropLayer.classList.remove("is-visible");
  });
  window.addEventListener("drop", (event) => {
    event.preventDefault();
    els.dropLayer.classList.remove("is-visible");
    const files = [...event.dataTransfer.files].filter((file) => file.type.startsWith("image/"));
    if (files.length) addFiles(files);
  });
}

function applyView() {
  $$(".view-tabs button").forEach((button) => button.classList.toggle("is-active", button.dataset.view === view));
  $$(".view").forEach((node) => node.classList.remove("is-active"));
  $(`#${view}View`).classList.add("is-active");
}

function render() {
  visibleImages = filterAndSort(allImages);
  if (!visibleImages.length) {
    activeId = null;
    renderEmpty();
    return;
  }

  if (!visibleImages.some((image) => image.id === activeId)) activeId = visibleImages[0].id;

  const activeIndex = getActiveIndex();
  const active = visibleImages[activeIndex];

  els.currentIndex.textContent = pad(activeIndex + 1);
  els.totalCount.textContent = pad(visibleImages.length);
  els.ambientImage.src = active.src;
  els.imageWorld.textContent = `Universe ${pad(activeIndex + 1)}`;
  els.titleInput.value = getTitle(active);
  els.imageMeta.textContent = getMeta(active);
  els.favoriteBtn.textContent = favorites.has(active.id) ? "♥" : "♡";
  els.deleteBtn.disabled = false;
  els.downloadBtn.href = active.src;
  els.downloadBtn.download = `${slugify(getTitle(active)) || "multiverse"}.${extensionFrom(active)}`;

  renderPortal(activeIndex);
  renderFilm();
  renderGrid();
}

function renderEmpty() {
  els.currentIndex.textContent = "00";
  els.totalCount.textContent = "00";
  els.cards.innerHTML = `<div class="empty-state">Коллекция ждёт новый мир</div>`;
  els.filmView.innerHTML = `<div class="empty-state">Коллекция ждёт новый мир</div>`;
  els.gridView.innerHTML = `<div class="empty-state">Коллекция ждёт новый мир</div>`;
  els.ambientImage.removeAttribute("src");
  els.titleInput.value = "";
  els.imageWorld.textContent = "Universe 000";
  els.imageMeta.textContent = "";
}

function renderPortal(activeIndex) {
  const offsets = [-3, -2, -1, 0, 1, 2, 3];
  const cards = offsets
    .map((offset) => {
      const index = wrap(activeIndex + offset, visibleImages.length);
      const image = visibleImages[index];
      const abs = Math.abs(offset);
      const x = offset * 118;
      const rotate = offset * -12;
      const z = -abs * 90;
      const y = abs * 12;
      const scale = 1 - abs * 0.075;
      return `
        <article
          class="card ${offset === 0 ? "is-active" : ""}"
          style="--t: translate3d(${x}px, ${y}px, ${z}px) rotateY(${rotate}deg) scale(${scale}); --o: ${1 - abs * 0.17}; --z: ${10 - abs}; --sat: ${1 - abs * 0.08}; --bright: ${1 - abs * 0.09}"
          data-id="${image.id}"
        >
          <img src="${image.src}" alt="${escapeHtml(getTitle(image))}" loading="${offset === 0 ? "eager" : "lazy"}" />
          <span class="badge">${escapeHtml(getTitle(image))}</span>
        </article>
      `;
    })
    .join("");

  els.cards.innerHTML = cards;
  $$(".card").forEach((card) =>
    card.addEventListener("click", () => {
      if (card.dataset.id === activeId) openLightbox();
      else setActive(card.dataset.id);
    }),
  );
}

function handlePortalWheel(event) {
  if (view !== "portal") return;
  event.preventDefault();
  const wheelPower = event.ctrlKey ? 0.0045 : 0.0018;
  const rawDelta = event.deltaY || event.deltaX;
  const delta = event.ctrlKey ? -rawDelta * wheelPower : Math.abs(rawDelta) * wheelPower;
  setPortalZoom(portalZoom + delta);
  schedulePortalZoomReset();
}

function setPortalZoom(value) {
  portalZoom = clamp(value, 0.82, 1.72);
  document.documentElement.style.setProperty("--portal-zoom", portalZoom.toFixed(3));
  els.portalStage.classList.add("is-zooming");
}

function schedulePortalZoomReset() {
  clearTimeout(portalZoomTimer);
  portalZoomTimer = window.setTimeout(resetPortalZoom, 620);
}

function resetPortalZoom() {
  clearTimeout(portalZoomTimer);
  portalZoomTimer = window.setTimeout(() => {
    portalZoom = 1;
    pinchStartDistance = 0;
    document.documentElement.style.setProperty("--portal-zoom", "1");
    els.portalStage.classList.remove("is-zooming");
  }, 80);
}

function getTouchDistance(touches) {
  const [a, b] = touches;
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function renderFilm() {
  els.filmView.innerHTML = `
    <div class="film-track">
      ${visibleImages
        .map(
          (image) => `
          <article class="film-item ${image.id === activeId ? "is-active" : ""}" data-id="${image.id}">
            <img src="${image.src}" alt="${escapeHtml(getTitle(image))}" loading="lazy" />
            <span class="badge">${escapeHtml(getTitle(image))}</span>
          </article>
        `,
        )
        .join("")}
    </div>
  `;
  $$(".film-item").forEach((item) => item.addEventListener("click", () => setActive(item.dataset.id)));
  $(".film-item.is-active")?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
}

function renderGrid() {
  els.gridView.innerHTML = visibleImages
    .map(
      (image) => `
      <article class="tile ${image.id === activeId ? "is-active" : ""}" data-id="${image.id}">
        <img src="${image.src}" alt="${escapeHtml(getTitle(image))}" loading="lazy" />
        <span class="badge">${escapeHtml(getTitle(image))}</span>
      </article>
    `,
    )
    .join("");
  $$(".tile").forEach((tile) => tile.addEventListener("click", () => setActive(tile.dataset.id)));
}

function filterAndSort(images) {
  const query = els.searchInput.value.trim().toLowerCase();
  const filter = els.filterSelect.value;
  const sorted = images.filter((image) => {
    const title = `${getTitle(image)} ${image.original || ""}`.toLowerCase();
    const matchesQuery = !query || title.includes(query);
    const matchesFilter =
      filter === "all" ||
      (filter === "favorites" && favorites.has(image.id)) ||
      (filter === "seed" && image.source === "seed") ||
      (filter === "custom" && image.source === "custom");
    return matchesQuery && matchesFilter;
  });

  sorted.sort((a, b) => {
    if (els.sortSelect.value === "name") return getTitle(a).localeCompare(getTitle(b), "ru");
    const timeA = new Date(a.createdAt || a.modified || 0).getTime();
    const timeB = new Date(b.createdAt || b.modified || 0).getTime();
    return els.sortSelect.value === "old" ? timeA - timeB : timeB - timeA;
  });

  return sorted;
}

function step(direction) {
  if (!visibleImages.length) return;
  const nextIndex = wrap(getActiveIndex() + direction, visibleImages.length);
  activeId = visibleImages[nextIndex].id;
  render();
}

function shuffle() {
  if (visibleImages.length < 2) return;
  let nextIndex = getActiveIndex();
  while (nextIndex === getActiveIndex()) {
    nextIndex = Math.floor(Math.random() * visibleImages.length);
  }
  activeId = visibleImages[nextIndex].id;
  render();
}

function setActive(id) {
  activeId = id;
  render();
}

function toggleFavorite() {
  if (!activeId) return;
  if (favorites.has(activeId)) favorites.delete(activeId);
  else favorites.add(activeId);
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
  render();
}

function saveActiveTitle() {
  if (!activeId) return;
  const title = els.titleInput.value.trim();
  meta[activeId] = { ...(meta[activeId] || {}), title };
  localStorage.setItem(META_KEY, JSON.stringify(meta));
  const image = allImages.find((item) => item.id === activeId);
  if (image) image.title = title || image.name;
  render();
}

async function deleteActive() {
  const active = visibleImages[getActiveIndex()];
  if (!active) return;
  const ok = window.confirm(`Удалить "${getTitle(active)}" из коллекции?`);
  if (!ok) return;
  await deleteImages([active.id]);
  render();
}

async function cleanDuplicates() {
  if (allImages.length < 2) return;

  const oldLabel = els.cleanDuplicates.textContent;
  els.cleanDuplicates.classList.add("is-busy");
  els.cleanDuplicates.textContent = "≋ Скан...";

  try {
    const groups = new Map();
    for (let index = 0; index < allImages.length; index += 1) {
      const image = allImages[index];
      els.cleanDuplicates.textContent = `≋ ${index + 1}/${allImages.length}`;
      const hash = await hashImage(image);
      if (!hash) continue;
      if (!groups.has(hash)) groups.set(hash, []);
      groups.get(hash).push(image);
    }

    const duplicateGroups = [...groups.values()].filter((group) => group.length > 1);
    const idsToDelete = duplicateGroups.flatMap((group) => {
      const keeper = chooseDuplicateKeeper(group);
      return group.filter((image) => image.id !== keeper.id).map((image) => image.id);
    });

    if (!idsToDelete.length) {
      window.alert("Точных дублей не нашёл.");
      return;
    }

    const ok = window.confirm(`Нашёл ${idsToDelete.length} дубл. Удалить лишние, оставив по одному экземпляру?`);
    if (!ok) return;

    await deleteImages(idsToDelete);
    render();
    window.alert(`Готово: убрал ${idsToDelete.length} дубл.`);
  } finally {
    els.cleanDuplicates.classList.remove("is-busy");
    els.cleanDuplicates.textContent = oldLabel;
  }
}

function chooseDuplicateKeeper(group) {
  return (
    group.find((image) => image.id === activeId) ||
    group.find((image) => favorites.has(image.id)) ||
    group.find((image) => image.source === "seed") ||
    group[0]
  );
}

async function deleteImages(ids) {
  const idSet = new Set(ids);
  const currentIndex = getActiveIndex();
  const deleted = allImages.filter((image) => idSet.has(image.id));

  for (const image of deleted) {
    if (image.source === "custom") {
      await deleteFromDb(image.id);
      if (objectUrls.has(image.id)) {
        URL.revokeObjectURL(objectUrls.get(image.id));
        objectUrls.delete(image.id);
      }
    } else {
      removedIds.add(image.id);
    }
    favorites.delete(image.id);
    delete meta[image.id];
  }

  allImages = allImages.filter((image) => !idSet.has(image.id));
  localStorage.setItem(REMOVED_KEY, JSON.stringify([...removedIds]));
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
  localStorage.setItem(META_KEY, JSON.stringify(meta));

  if (idSet.has(activeId)) {
    const remaining = filterAndSort(allImages);
    activeId = remaining[Math.min(currentIndex, Math.max(remaining.length - 1, 0))]?.id || allImages[0]?.id || null;
  }
}

async function addFiles(fileList) {
  const files = [...fileList].filter((file) => file.type.startsWith("image/"));
  if (!files.length) return;

  const added = [];
  for (const file of files) {
    const image = await makeImageRecord(file);
    await saveToDb(image, file);
    image.src = getObjectUrl(image.id, file);
    added.push(image);
  }

  allImages = [...added, ...allImages];
  activeId = added[0].id;
  render();
  els.fileInput.value = "";
  els.folderInput.value = "";
}

async function pasteFromClipboard() {
  if (!navigator.clipboard?.read) {
    document.body.focus();
    return;
  }
  try {
    const items = await navigator.clipboard.read();
    const files = [];
    for (const item of items) {
      for (const type of item.types) {
        if (type.startsWith("image/")) files.push(await item.getType(type));
      }
    }
    await addFiles(files);
  } catch {
    document.body.focus();
  }
}

function openLightbox() {
  const active = visibleImages[getActiveIndex()];
  if (!active) return;
  els.lightboxImage.src = active.src;
  els.lightboxImage.alt = getTitle(active);
  if (!els.lightbox.open) els.lightbox.showModal();
}

function showDrop() {
  els.dropLayer.classList.add("is-visible");
}

async function hashImage(image) {
  try {
    const response = await fetch(image.src);
    const buffer = await response.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return "";
  }
}

async function makeImageRecord(file) {
  const dimensions = await readDimensions(file);
  return {
    id: `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    source: "custom",
    name: prettyName(file.name.replace(/\.[^.]+$/, "")),
    original: file.name,
    title: prettyName(file.name.replace(/\.[^.]+$/, "")),
    width: dimensions.width,
    height: dimensions.height,
    size: file.size,
    type: file.type,
    createdAt: new Date().toISOString(),
  };
}

function readDimensions(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve({ width: 0, height: 0 });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transaction(mode = "readonly") {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function getStoredImages() {
  return new Promise((resolve) => {
    const request = transaction().getAll();
    request.onsuccess = () => {
      const images = request.result.map(({ blob, ...image }) => ({
        ...image,
        src: getObjectUrl(image.id, blob),
      }));
      resolve(images);
    };
    request.onerror = () => resolve([]);
  });
}

function saveToDb(image, blob) {
  return new Promise((resolve, reject) => {
    const request = transaction("readwrite").put({ ...image, blob });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function deleteFromDb(id) {
  return new Promise((resolve) => {
    const request = transaction("readwrite").delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
  });
}

function getObjectUrl(id, blob) {
  if (objectUrls.has(id)) return objectUrls.get(id);
  const url = URL.createObjectURL(blob);
  objectUrls.set(id, url);
  return url;
}

function getActiveIndex() {
  return Math.max(0, visibleImages.findIndex((image) => image.id === activeId));
}

function getTitle(image) {
  return meta[image.id]?.title || image.title || image.name || "Новый мир";
}

function getMeta(image) {
  const dimensions = image.width && image.height ? `${image.width}×${image.height}` : "размер неизвестен";
  const size = image.size ? formatBytes(image.size) : "";
  const source = image.source === "custom" ? "добавлено" : "telegram desktop";
  return [dimensions, size, source].filter(Boolean).join(" · ");
}

function prettyName(name) {
  return name
    .replace(/^file_0+/i, "Universe ")
    .replace(/^photo_/i, "Photo ")
    .replace(/ChatGPT Image/i, "Poster")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pad(number) {
  return String(number).padStart(2, "0");
}

function wrap(index, length) {
  return ((index % length) + length) % length;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatBytes(bytes) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

function extensionFrom(image) {
  const match = (image.original || image.src || "").match(/\.([a-z0-9]+)$/i);
  if (match) return match[1].toLowerCase();
  return image.type?.split("/")[1] || "jpg";
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return map[char];
  });
}

function loadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}
