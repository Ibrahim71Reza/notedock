const STORAGE_KEY = "notedock_data_v12";
const DB_NAME = "NoteDockDB";
const DB_VERSION = 1;
const IMAGE_STORE = "images";

function getApi() {
return typeof browser !== "undefined" ? browser : chrome;
}
const api = getApi();

const state = {
notes: [],
activeNoteId: null,
search: "",
saveTimer: null,
lastRange: null,
isToolsOpen: false,
isDrawerOpen: false,
objectUrls: new Map(),
showTrash: false,
selectedImageEl: null
};

const $ = (id) => document.getElementById(id);

const newNoteBtn = $("newNoteBtn");
const duplicateNoteBtn = $("duplicateNoteBtn");
const favoriteBtn = $("favoriteBtn");
const toggleToolsBtn = $("toggleToolsBtn");
const toggleDrawerBtn = $("toggleDrawerBtn");
const collapseDrawerBtn = $("collapseDrawerBtn");
const showActiveBtn = $("showActiveBtn");
const showTrashBtn = $("showTrashBtn");

const toolsPanel = $("toolsPanel");
const notesDrawer = $("notesDrawer");
const notesList = $("notesList");

const noteTitle = $("noteTitle");
const tagsInput = $("tagsInput");
const editor = $("editor");
const imageInput = $("imageInput");
const deleteBtn = $("deleteBtn");
const restoreBtn = $("restoreBtn");
const deletePermanentBtn = $("deletePermanentBtn");
const saveStatus = $("saveStatus");
const searchInput = $("searchInput");

const exportNativeBtn = $("exportNativeBtn");
const exportTxtBtn = $("exportTxtBtn");
const exportHtmlBtn = $("exportHtmlBtn");
const exportMdBtn = $("exportMdBtn");
const exportPdfBtn = $("exportPdfBtn");
const backupAllBtn = $("backupAllBtn");
const importInput = $("importInput");
const restoreAllInput = $("restoreAllInput");

const linkBtn = $("linkBtn");
const quoteBtn = $("quoteBtn");
const codeBtn = $("codeBtn");
const hrBtn = $("hrBtn");
const tableBtn = $("tableBtn");
const tableRowBtn = $("tableRowBtn");
const tableColBtn = $("tableColBtn");
const tableDeleteRowBtn = $("tableDeleteRowBtn");
const tableDeleteColBtn = $("tableDeleteColBtn");
const imgSmallerBtn = $("imgSmallerBtn");
const imgLargerBtn = $("imgLargerBtn");
const clearFormattingBtn = $("clearFormattingBtn");

function uuid() {
return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function nowIso() {
return new Date().toISOString();
}

function formatTime(iso) {
try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
} catch {
    return "";
}
}

function setStatus(text) {
saveStatus.textContent = text;
}

function sanitizeFilename(name) {
return (name || "note").replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 90) || "note";
}

function escapeHtml(str) {
return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parseTags(value) {
return String(value || "")
    .split(",")
    .map(tag => tag.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function createEmptyNoteObject() {
return {
    id: uuid(),
    title: "Untitled note",
    contentHtml: "",
    favorite: false,
    trashed: false,
    tags: [],
    createdAt: nowIso(),
    updatedAt: nowIso()
};
}

function getActiveNote() {
return state.notes.find(n => n.id === state.activeNoteId) || null;
}

function stripHtmlToText(html) {
const div = document.createElement("div");
div.innerHTML = html || "";
return div.textContent || div.innerText || "";
}

function getPreviewFromHtml(html) {
return stripHtmlToText(html).replace(/\s+/g, " ").trim().slice(0, 120);
}

function countImagesInHtml(html) {
const div = document.createElement("div");
div.innerHTML = html || "";
return div.querySelectorAll("img").length;
}

function convertLegacyBodyToHtml(body) {
const escaped = escapeHtml(body || "");
return escaped.split(/\n{2,}/).map(block => `<p>${block.replace(/\n/g, "<br>")}</p>`).join("");
}

function openImageDb() {
return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(IMAGE_STORE)) {
        db.createObjectStore(IMAGE_STORE, { keyPath: "id" });
    }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
});
}

async function idbPutImage(record) {
const db = await openImageDb();
return new Promise((resolve, reject) => {
    const tx = db.transaction(IMAGE_STORE, "readwrite");
    tx.objectStore(IMAGE_STORE).put(record);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
});
}

async function idbGetImage(id) {
const db = await openImageDb();
return new Promise((resolve, reject) => {
    const tx = db.transaction(IMAGE_STORE, "readonly");
    const req = tx.objectStore(IMAGE_STORE).get(id);
    req.onsuccess = () => { db.close(); resolve(req.result || null); };
    req.onerror = () => { db.close(); reject(req.error); };
});
}

async function idbDeleteImage(id) {
const db = await openImageDb();
return new Promise((resolve, reject) => {
    const tx = db.transaction(IMAGE_STORE, "readwrite");
    tx.objectStore(IMAGE_STORE).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
});
}

async function idbGetMany(ids) {
const results = new Map();
for (const id of ids) {
    const record = await idbGetImage(id);
    if (record) results.set(id, record);
}
return results;
}

function revokeEditorObjectUrls() {
for (const url of state.objectUrls.values()) {
    try { URL.revokeObjectURL(url); } catch {}
}
state.objectUrls.clear();
}

function getImageIdsFromHtml(html) {
const div = document.createElement("div");
div.innerHTML = html || "";
return Array.from(div.querySelectorAll("img[data-note-image-id]"))
    .map(img => img.getAttribute("data-note-image-id"))
    .filter(Boolean);
}

function getAllReferencedImageIds() {
const set = new Set();
for (const note of state.notes) {
    for (const id of getImageIdsFromHtml(note.contentHtml)) set.add(id);
}
return set;
}

async function cleanupUnusedImages() {
const used = getAllReferencedImageIds();
const db = await openImageDb();
const existing = [];

await new Promise((resolve, reject) => {
    const tx = db.transaction(IMAGE_STORE, "readonly");
    const req = tx.objectStore(IMAGE_STORE).openCursor();
    req.onsuccess = (event) => {
    const cursor = event.target.result;
    if (cursor) {
        existing.push(cursor.key);
        cursor.continue();
    }
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
});

db.close();

for (const id of existing) {
    if (!used.has(id)) await idbDeleteImage(id);
}
}

async function persistState() {
await api.storage.local.set({
    [STORAGE_KEY]: {
    notes: state.notes,
    activeNoteId: state.activeNoteId,
    isToolsOpen: state.isToolsOpen,
    isDrawerOpen: state.isDrawerOpen,
    showTrash: state.showTrash
    }
});
}

// ==========================================
// PENDING CLIP HELPER (Prevents double-paste)
// ==========================================
let processedClipIds = new Set();

async function processPendingClip(payload) {
if (!payload || !payload.id) return;

// Prevent double-pasting!
if (processedClipIds.has(payload.id)) return;
processedClipIds.add(payload.id);

switch (payload.clipType) {
    case "selection":
    insertSelectionClip(payload.text || "", payload.pageUrl || "", payload.pageTitle || "");
    break;
    case "image":
    insertImageUrlAtCursor(payload.srcUrl || "");
    break;
    case "page":
    insertPageClip(payload.pageUrl || "", payload.pageTitle || "");
    break;
}

await api.storage.local.remove("pending_clip");
setStatus("Clipped successfully");
}

async function loadState() {
const result = await api.storage.local.get(STORAGE_KEY);
const saved = result[STORAGE_KEY];

if (saved?.notes?.length) {
    state.notes = saved.notes.map(note => ({
    id: note.id || uuid(),
    title: note.title || "Untitled note",
    contentHtml:
        typeof note.contentHtml === "string"
        ? note.contentHtml
        : convertLegacyBodyToHtml(note.body || ""),
    favorite: Boolean(note.favorite),
    trashed: Boolean(note.trashed),
    tags: Array.isArray(note.tags) ? note.tags : [],
    createdAt: note.createdAt || nowIso(),
    updatedAt: note.updatedAt || nowIso()
    }));

    sortNotes();

    state.activeNoteId = saved.activeNoteId || state.notes[0]?.id || null;
    state.isToolsOpen = Boolean(saved.isToolsOpen);
    state.isDrawerOpen = Boolean(saved.isDrawerOpen);
    state.showTrash = Boolean(saved.showTrash);
} else {
    const first = createEmptyNoteObject();
    state.notes = [first];
    state.activeNoteId = first.id;
    await persistState();
}

ensureValidActiveNote();
applyPanelsState();
await renderAll();
setStatus("Loaded");

// Process any clips that were created while the sidebar was closed
try {
    const clipData = await api.storage.local.get("pending_clip");
    if (clipData?.pending_clip) {
    await processPendingClip(clipData.pending_clip);
    }
} catch (error) {
    console.error("Failed to process pending clip:", error);
}
}

function ensureValidActiveNote() {
const active = getActiveNote();
if (!active) {
    const candidate = state.notes.find(n => n.trashed === state.showTrash) || state.notes[0] || null;
    state.activeNoteId = candidate?.id || null;
    return;
}

if (active.trashed !== state.showTrash) {
    const candidate = state.notes.find(n => n.trashed === state.showTrash) || active;
    state.activeNoteId = candidate?.id || null;
}
}

function applyPanelsState() {
toolsPanel.classList.toggle("open", state.isToolsOpen);
notesDrawer.classList.toggle("open", state.isDrawerOpen);

toolsPanel.style.maxHeight = state.isToolsOpen ? `${Math.min(Math.max(220, window.innerHeight * 0.42), 360)}px` : "0px";
notesDrawer.style.maxHeight = state.isDrawerOpen ? `${Math.min(Math.max(170, window.innerHeight * 0.30), 260)}px` : "0px";

showActiveBtn.classList.toggle("active", !state.showTrash);
showTrashBtn.classList.toggle("active", state.showTrash);
}

function toggleToolsPanel() {
state.isToolsOpen = !state.isToolsOpen;
applyPanelsState();
persistState();
}

function toggleDrawerPanel() {
state.isDrawerOpen = !state.isDrawerOpen;
applyPanelsState();
persistState();
}

function debounceSave() {
setStatus("Saving...");
clearTimeout(state.saveTimer);

state.saveTimer = setTimeout(async () => {
    const active = getActiveNote();
    if (active) active.updatedAt = nowIso();
    sortNotes();
    await persistState();
    renderNotesList();
    await cleanupUnusedImages();
    setStatus(`Autosaved • ${formatTime(nowIso())}`);
}, 450);
}

function sortNotes() {
state.notes.sort((a, b) => {
    if (a.trashed !== b.trashed) return a.trashed ? 1 : -1;
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
});
}

function updateFavoriteButton() {
const active = getActiveNote();
favoriteBtn.classList.toggle("favorite-active", Boolean(active?.favorite));
}

function updateTrashActionButtons() {
const active = getActiveNote();
const isTrashed = Boolean(active?.trashed);
deleteBtn.hidden = isTrashed;
restoreBtn.hidden = !isTrashed;
deletePermanentBtn.hidden = !isTrashed;
}

function renderNotesList() {
notesList.innerHTML = "";
const q = state.search.trim().toLowerCase();

const filtered = state.notes.filter(note => {
    if (note.trashed !== state.showTrash) return false;
    if (!q) return true;

    const preview = getPreviewFromHtml(note.contentHtml);
    const tagText = (note.tags || []).join(" ").toLowerCase();

    return (
    note.title.toLowerCase().includes(q) ||
    preview.toLowerCase().includes(q) ||
    tagText.includes(q)
    );
});

for (const note of filtered) {
    const item = document.createElement("div");
    item.className =
    "noteItem" +
    (note.id === state.activeNoteId ? " active" : "") +
    (note.favorite ? " favorite" : "") +
    (note.trashed ? " trashed" : "");

    if (note.trashed) {
    const trash = document.createElement("div");
    trash.className = "noteItemTrash";
    trash.textContent = "🗑";
    item.appendChild(trash);
    } else if (note.favorite) {
    const star = document.createElement("div");
    star.className = "noteItemStar";
    star.textContent = "★";
    item.appendChild(star);
    }

    const title = document.createElement("div");
    title.className = "noteItemTitle";
    title.textContent = note.title || "Untitled note";

    const meta = document.createElement("div");
    meta.className = "noteItemMeta";
    meta.textContent = `${new Date(note.updatedAt).toLocaleString()} • ${countImagesInHtml(note.contentHtml)} img`;

    const preview = document.createElement("div");
    preview.className = "noteItemPreview";
    preview.textContent = getPreviewFromHtml(note.contentHtml) || "No content yet";

    item.appendChild(title);
    item.appendChild(meta);
    item.appendChild(preview);

    if (note.tags?.length) {
    const tagsWrap = document.createElement("div");
    tagsWrap.className = "noteTags";
    for (const tag of note.tags.slice(0, 4)) {
        const badge = document.createElement("span");
        badge.className = "noteTag";
        badge.textContent = tag;
        tagsWrap.appendChild(badge);
    }
    item.appendChild(tagsWrap);
    }

    item.addEventListener("click", () => openNote(note.id));
    notesList.appendChild(item);
}
}

async function resolveHtmlForEditor(html) {
revokeEditorObjectUrls();

const div = document.createElement("div");
div.innerHTML = html || "";

const imgs = Array.from(div.querySelectorAll("img[data-note-image-id]"));
const ids = imgs.map(img => img.getAttribute("data-note-image-id")).filter(Boolean);
const imageMap = await idbGetMany(ids);

for (const img of imgs) {
    const id = img.getAttribute("data-note-image-id");
    const record = imageMap.get(id);
    if (!record?.blob) continue;

    const url = URL.createObjectURL(record.blob);
    state.objectUrls.set(id, url);
    img.src = url;
    img.classList.add("inline-note-image");
}

return div.innerHTML;
}

function clearSelectedImage() {
if (state.selectedImageEl) {
    state.selectedImageEl.classList.remove("selected-note-image");
}
state.selectedImageEl = null;
editor.classList.remove("image-select-mode");
}

function selectImageElement(img) {
clearSelectedImage();
state.selectedImageEl = img;
img.classList.add("selected-note-image");
editor.classList.add("image-select-mode");
const sel = window.getSelection();
if (sel) sel.removeAllRanges();
}

async function renderActiveNote() {
clearSelectedImage();
const active = getActiveNote();

if (!active) {
    noteTitle.value = "";
    tagsInput.value = "";
    editor.innerHTML = "";
    updateFavoriteButton();
    updateTrashActionButtons();
    return;
}

noteTitle.value = active.title || "";
tagsInput.value = (active.tags || []).join(", ");
editor.innerHTML = await resolveHtmlForEditor(active.contentHtml || "");
updateFavoriteButton();
updateTrashActionButtons();
}

async function renderAll() {
renderNotesList();
await renderActiveNote();
requestAnimationFrame(applyPanelsState);
}

function structuredCloneSafe(obj) {
return JSON.parse(JSON.stringify(obj));
}

function createNote() {
const note = createEmptyNoteObject();
state.notes.unshift(note);
sortNotes();
state.activeNoteId = note.id;
state.showTrash = false;
renderAll();
debounceSave();
}

async function duplicateActiveNote() {
syncEditorToNote();
const active = getActiveNote();
if (!active) return;

const duplicated = {
    ...structuredCloneSafe(active),
    id: uuid(),
    title: `${active.title || "Untitled note"} (Copy)`,
    favorite: false,
    trashed: false,
    createdAt: nowIso(),
    updatedAt: nowIso()
};

state.notes.unshift(duplicated);
sortNotes();
state.activeNoteId = duplicated.id;
state.showTrash = false;

await renderAll();
debounceSave();
}

async function openNote(noteId) {
syncEditorToNote();
state.activeNoteId = noteId;
await renderAll();
}

async function deleteImagesReferencedInHtml(html) {
const ids = getImageIdsFromHtml(html);
for (const id of ids) {
    await idbDeleteImage(id);
}
}

async function moveActiveNoteToTrash() {
const active = getActiveNote();
if (!active) return;

active.trashed = true;
active.favorite = false;
active.updatedAt = nowIso();

sortNotes();
ensureValidActiveNote();

await renderAll();
debounceSave();
}

async function restoreActiveNote() {
const active = getActiveNote();
if (!active) return;

active.trashed = false;
active.updatedAt = nowIso();
state.showTrash = false;

sortNotes();
ensureValidActiveNote();

await renderAll();
debounceSave();
}

async function permanentlyDeleteActiveNote() {
const active = getActiveNote();
if (!active) return;

const confirmed = confirm(`Permanently delete "${active.title}"? This cannot be undone.`);
if (!confirmed) return;

await deleteImagesReferencedInHtml(active.contentHtml);
state.notes = state.notes.filter(n => n.id !== active.id);
ensureValidActiveNote();

await renderAll();
await cleanupUnusedImages();
await persistState();
setStatus("Deleted permanently");
}

function normalizeEditorHtml(html) {
const div = document.createElement("div");
div.innerHTML = html || "";
autoLinkifyElement(div);
cleanEmptyNodes(div);
return div.innerHTML;
}

function cleanEmptyNodes(root) {
const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
const toRemove = [];

while (walker.nextNode()) {
    const el = walker.currentNode;
    if (
    ["P", "DIV"].includes(el.tagName) &&
    !el.querySelector("img, br, hr, pre, blockquote, ul, ol, li, table") &&
    !(el.textContent || "").trim()
    ) {
    toRemove.push(el);
    }
}

for (const el of toRemove) el.remove();
}

function autoLinkifyElement(root) {
const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
const textNodes = [];

while (walker.nextNode()) {
    const node = walker.currentNode;
    const parent = node.parentElement;
    if (!parent) continue;
    if (parent.closest("a, pre, code")) continue;
    textNodes.push(node);
}

const urlRegex = /((https?:\/\/|www\.)[^\s<]+)/gi;

for (const node of textNodes) {
    const text = node.nodeValue;
    if (!text || !urlRegex.test(text)) continue;

    urlRegex.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    let match;

    while ((match = urlRegex.exec(text)) !== null) {
    const urlText = match[0];
    const start = match.index;

    if (start > lastIndex) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, start)));
    }

    const a = document.createElement("a");
    const href = urlText.startsWith("www.") ? `https://${urlText}` : urlText;
    a.href = href;
    a.textContent = urlText;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    frag.appendChild(a);

    lastIndex = start + urlText.length;
    }

    if (lastIndex < text.length) {
    frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    node.parentNode.replaceChild(frag, node);
}
}

function syncEditorToNote() {
const active = getActiveNote();
if (!active) return;
active.title = noteTitle.value.trim() || "Untitled note";
active.tags = parseTags(tagsInput.value);
active.contentHtml = normalizeEditorHtml(editor.innerHTML);
}

function updateActiveNoteFromEditor() {
const active = getActiveNote();
if (!active) return;
active.title = noteTitle.value.trim() || "Untitled note";
active.tags = parseTags(tagsInput.value);
active.contentHtml = normalizeEditorHtml(editor.innerHTML);
debounceSave();
}

function saveSelection() {
if (state.selectedImageEl) return;
const selection = window.getSelection();
if (!selection || selection.rangeCount === 0) return;
state.lastRange = selection.getRangeAt(0).cloneRange();
}

function restoreSelection() {
if (state.selectedImageEl) clearSelectedImage();

const selection = window.getSelection();
editor.focus();

if (state.lastRange) {
    selection.removeAllRanges();
    selection.addRange(state.lastRange);
    return;
}

placeCaretAtEnd(editor);
}

function placeCaretAtEnd(el) {
el.focus();
const range = document.createRange();
range.selectNodeContents(el);
range.collapse(false);
const selection = window.getSelection();
selection.removeAllRanges();
selection.addRange(range);
}

function insertHtmlAtCursor(html) {
restoreSelection();
document.execCommand("insertHTML", false, html);
saveSelection();
}

function execCommand(cmd, value = null) {
clearSelectedImage();
restoreSelection();
document.execCommand(cmd, false, value);
editor.focus();
saveSelection();
updateActiveNoteFromEditor();
}

function insertQuoteBlock() {
insertHtmlAtCursor(`<blockquote>Quote</blockquote><p><br></p>`);
updateActiveNoteFromEditor();
}

function insertCodeBlock() {
insertHtmlAtCursor(`<pre class="note-code">code here</pre><p><br></p>`);
updateActiveNoteFromEditor();
}

function insertDivider() {
insertHtmlAtCursor(`<hr><p><br></p>`);
updateActiveNoteFromEditor();
}

function insertTable() {
const rowsInput = prompt("Number of rows?", "3");
if (!rowsInput) return;

const colsInput = prompt("Number of columns?", "3");
if (!colsInput) return;

const rows = Math.max(1, Math.min(20, parseInt(rowsInput, 10) || 0));
const cols = Math.max(1, Math.min(10, parseInt(colsInput, 10) || 0));

let thead = "<tr>";
for (let c = 0; c < cols; c++) thead += `<th>Header ${c + 1}</th>`;
thead += "</tr>";

let tbody = "";
for (let r = 0; r < rows; r++) {
    tbody += "<tr>";
    for (let c = 0; c < cols; c++) tbody += `<td>Cell ${r + 1}-${c + 1}</td>`;
    tbody += "</tr>";
}

insertHtmlAtCursor(`
    <table class="note-table">
    <thead>${thead}</thead>
    <tbody>${tbody}</tbody>
    </table>
    <p><br></p>
`);

updateActiveNoteFromEditor();
}

function getSelectedCell() {
const selection = window.getSelection();
if (!selection || !selection.anchorNode) return null;
const node = selection.anchorNode.nodeType === Node.ELEMENT_NODE
    ? selection.anchorNode
    : selection.anchorNode.parentElement;
return node?.closest("td, th") || null;
}

function getSelectedTable() {
return getSelectedCell()?.closest("table.note-table") || null;
}

function addTableRow() {
const table = getSelectedTable();
if (!table) {
    alert("Place the cursor inside a table first.");
    return;
}

const cols = table.querySelector("tr")?.children.length || 1;
const tr = document.createElement("tr");

for (let i = 0; i < cols; i++) {
    const td = document.createElement("td");
    td.textContent = "Cell";
    tr.appendChild(td);
}

let tbody = table.querySelector("tbody");
if (!tbody) {
    tbody = document.createElement("tbody");
    table.appendChild(tbody);
}
tbody.appendChild(tr);
updateActiveNoteFromEditor();
}

function addTableColumn() {
const table = getSelectedTable();
if (!table) {
    alert("Place the cursor inside a table first.");
    return;
}

table.querySelectorAll("tr").forEach((tr, index) => {
    const isHeaderRow = tr.parentElement.tagName === "THEAD" || index === 0;
    const cell = document.createElement(isHeaderRow ? "th" : "td");
    cell.textContent = isHeaderRow ? `Header ${tr.children.length + 1}` : "Cell";
    tr.appendChild(cell);
});

updateActiveNoteFromEditor();
}

function deleteTableRow() {
const cell = getSelectedCell();
if (!cell) {
    alert("Place the cursor inside the row you want to delete.");
    return;
}

const row = cell.closest("tr");
if (!row) return;
const section = row.parentElement;
row.remove();

if (section && !section.querySelector("tr")) section.remove();

const table = cell.closest("table.note-table");
if (table && !table.querySelector("tr")) table.remove();

updateActiveNoteFromEditor();
}

function deleteTableColumn() {
const cell = getSelectedCell();
if (!cell) {
    alert("Place the cursor inside the column you want to delete.");
    return;
}

const index = Array.from(cell.parentElement.children).indexOf(cell);
const table = cell.closest("table.note-table");
if (!table || index < 0) return;

table.querySelectorAll("tr").forEach(tr => {
    if (tr.children[index]) tr.children[index].remove();
});

table.querySelectorAll("tr").forEach(tr => {
    if (!tr.children.length) tr.remove();
});

if (!table.querySelector("tr")) table.remove();

updateActiveNoteFromEditor();
}

function clearFormatting() {
execCommand("removeFormat");
updateActiveNoteFromEditor();
}

function insertLink() {
const url = prompt("Enter URL:");
if (!url) return;

let fixed = url.trim();
if (!/^https?:\/\//i.test(fixed)) fixed = `https://${fixed}`;

restoreSelection();
const selection = window.getSelection();
const selectedText = selection && selection.toString().trim();

if (selectedText) {
    document.execCommand("createLink", false, fixed);
} else {
    insertHtmlAtCursor(
    `<a href="${escapeHtml(fixed)}" target="_blank" rel="noopener noreferrer">${escapeHtml(fixed)}</a>`
    );
}

updateActiveNoteFromEditor();
}

async function storeImageAndGetHtml(fileOrBlob, name = "image") {
const id = uuid();

await idbPutImage({
    id,
    name,
    type: fileOrBlob.type || "application/octet-stream",
    createdAt: nowIso(),
    blob: fileOrBlob
});

const objectUrl = URL.createObjectURL(fileOrBlob);
state.objectUrls.set(id, objectUrl);

return `<p><img class="inline-note-image" data-note-image-id="${id}" src="${objectUrl}" alt="${escapeHtml(name)}" style="width:auto;" contenteditable="false"></p><p><br></p>`;
}

function blobToDataUrl(blob) {
return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
});
}

async function insertImagesAtCursor(files) {
if (!files?.length) return;
clearSelectedImage();

for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    const html = await storeImageAndGetHtml(file, file.name || "image");
    insertHtmlAtCursor(html);
}

updateActiveNoteFromEditor();
}

function insertImageUrlAtCursor(url) {
if (!url) return;
clearSelectedImage();
insertHtmlAtCursor(`<p><img class="inline-note-image" src="${escapeHtml(url)}" alt="Clipped image" contenteditable="false"></p><p><br></p>`);
updateActiveNoteFromEditor();
}

function insertSelectionClip(text, pageUrl, pageTitle) {
const safeTitle = escapeHtml(pageTitle || "Source");
const safeUrl = escapeHtml(pageUrl || "");
const safeText = escapeHtml(text || "").replace(/\n/g, "<br>");

clearSelectedImage();
insertHtmlAtCursor(`
    <blockquote>${safeText}</blockquote>
    <p><a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeTitle || safeUrl}</a></p>
    <p><br></p>
`);

updateActiveNoteFromEditor();
}

function insertPageClip(pageUrl, pageTitle) {
const safeTitle = escapeHtml(pageTitle || pageUrl || "Page");
const safeUrl = escapeHtml(pageUrl || "");

clearSelectedImage();
insertHtmlAtCursor(`
    <p><a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeTitle}</a></p>
    <p><br></p>
`);

updateActiveNoteFromEditor();
}

function resizeSelectedImage(multiplier) {
const img = state.selectedImageEl;
if (!img) {
    alert("Click an image first.");
    return;
}

const current = parseFloat(img.style.width) || img.getBoundingClientRect().width;
const next = Math.max(80, Math.min(1600, Math.round(current * multiplier)));
img.style.width = `${next}px`;
img.style.height = "auto";
updateActiveNoteFromEditor();
}

function deleteSelectedImage() {
if (!state.selectedImageEl) return false;

const img = state.selectedImageEl;
const range = document.createRange();
range.selectNode(img);
const sel = window.getSelection();
sel.removeAllRanges();
sel.addRange(range);

document.execCommand("delete");
clearSelectedImage();
updateActiveNoteFromEditor();
return true;
}

function downloadBlob(blob, filename) {
const url = URL.createObjectURL(blob);
api.downloads.download({ url, filename, saveAs: true }, () => {
    setTimeout(() => URL.revokeObjectURL(url), 8000);
});
}

async function embedStoredImagesInHtml(html) {
const div = document.createElement("div");
div.innerHTML = html || "";

const imgs = Array.from(div.querySelectorAll("img[data-note-image-id]"));
for (const img of imgs) {
    const id = img.getAttribute("data-note-image-id");
    const record = await idbGetImage(id);
    if (!record?.blob) continue;
    img.src = await blobToDataUrl(record.blob);
}

return div.innerHTML;
}

async function exportNative() {
const active = getActiveNote();
if (!active) return;
syncEditorToNote();

const portableHtml = await embedStoredImagesInHtml(active.contentHtml);
const exportPayload = { ...active, contentHtml: portableHtml };

const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
downloadBlob(blob, `${sanitizeFilename(active.title)}.ndock`);
}

async function exportTxt() {
const active = getActiveNote();
if (!active) return;
syncEditorToNote();

let text = `Title: ${active.title}\n`;
text += `Created: ${active.createdAt}\n`;
text += `Updated: ${active.updatedAt}\n`;
text += `Tags: ${(active.tags || []).join(", ")}\n\n`;
text += `${stripHtmlToText(active.contentHtml)}\n`;

const blob = new Blob([text], { type: "text/plain" });
downloadBlob(blob, `${sanitizeFilename(active.title)}.txt`);
}

async function buildExportHtml(active) {
const portableHtml = await embedStoredImagesInHtml(active.contentHtml);
const tagsHtml = (active.tags || []).length
    ? `<p><strong>Tags:</strong> ${active.tags.map(escapeHtml).join(", ")}</p>`
    : "";

return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(active.title)}</title>
<style>
    body { font-family: Arial, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; line-height: 1.7; color: #111; }
    img { max-width: 100%; height: auto; border-radius: 8px; }
    pre { background: #f4f6f8; padding: 12px; border-radius: 8px; overflow: auto; }
    blockquote { border-left: 4px solid #4a7bdc; padding-left: 12px; color: #444; margin-left: 0; }
    table { border-collapse: collapse; min-width: 420px; margin: 12px 0; }
    th, td { border: 1px solid #bbb; padding: 8px 10px; text-align: left; }
    th { background: #eee; }
</style>
</head>
<body>
<h1>${escapeHtml(active.title)}</h1>
<p><strong>Created:</strong> ${escapeHtml(active.createdAt)}</p>
<p><strong>Updated:</strong> ${escapeHtml(active.updatedAt)}</p>
${tagsHtml}
<hr />
<div>${portableHtml}</div>
</body>
</html>`;
}

async function exportHtml() {
const active = getActiveNote();
if (!active) return;
syncEditorToNote();

const html = await buildExportHtml(active);
const blob = new Blob([html], { type: "text/html" });
downloadBlob(blob, `${sanitizeFilename(active.title)}.html`);
}

function htmlToMarkdown(html, title, createdAt, updatedAt, tags) {
const div = document.createElement("div");
div.innerHTML = html || "";

function nodeToMd(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const tag = node.tagName.toLowerCase();
    const inner = Array.from(node.childNodes).map(nodeToMd).join("");

    switch (tag) {
    case "p": return `${inner}\n\n`;
    case "br": return `  \n`;
    case "strong":
    case "b": return `**${inner}**`;
    case "em":
    case "i": return `*${inner}*`;
    case "blockquote":
        return inner.split("\n").map(line => line ? `> ${line}` : ">").join("\n") + "\n\n";
    case "pre":
        return `\n\`\`\`\n${node.textContent || ""}\n\`\`\`\n\n`;
    case "hr":
        return `\n---\n\n`;
    case "a": {
        const href = node.getAttribute("href") || "";
        return `[${inner || href}](${href})`;
    }
    case "ul":
        return Array.from(node.children).map(li => `- ${li.textContent || ""}`).join("\n") + "\n\n";
    case "ol":
        return Array.from(node.children).map((li, i) => `${i + 1}. ${li.textContent || ""}`).join("\n") + "\n\n";
    case "img": {
        const src = node.getAttribute("src") || "";
        const alt = node.getAttribute("alt") || "image";
        return `![${alt}](${src})\n\n`;
    }
    case "table": {
        const rows = Array.from(node.querySelectorAll("tr")).map(tr =>
        Array.from(tr.children).map(cell => (cell.textContent || "").trim())
        );
        if (!rows.length) return "\n";
        const header = rows[0];
        const divider = header.map(() => "---");
        const body = rows.slice(1);

        let md = `| ${header.join(" | ")} |\n`;
        md += `| ${divider.join(" | ")} |\n`;
        for (const row of body) md += `| ${row.join(" | ")} |\n`;
        return md + "\n";
    }
    default:
        return inner;
    }
}

let md = `# ${title}\n\n`;
md += `Created: ${createdAt}\n\n`;
md += `Updated: ${updatedAt}\n\n`;
if (tags?.length) md += `Tags: ${tags.join(", ")}\n\n`;
md += `---\n\n`;
md += Array.from(div.childNodes).map(nodeToMd).join("");
return md.replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

async function exportMarkdown() {
const active = getActiveNote();
if (!active) return;
syncEditorToNote();

const portableHtml = await embedStoredImagesInHtml(active.contentHtml);
const markdown = htmlToMarkdown(
    portableHtml,
    active.title,
    active.createdAt,
    active.updatedAt,
    active.tags || []
);

const blob = new Blob([markdown], { type: "text/markdown" });
downloadBlob(blob, `${sanitizeFilename(active.title)}.md`);
}

async function exportPdf() {
const active = getActiveNote();
if (!active) return;
syncEditorToNote();

const exportWindow = window.open("", "_blank");
if (!exportWindow) {
    alert("Popup blocked. Please allow popups for PDF export.");
    return;
}

const html = await buildExportHtml(active);
exportWindow.document.open();
exportWindow.document.write(html);
exportWindow.document.close();

exportWindow.onload = () => {
    exportWindow.focus();
    exportWindow.print();
};
}

async function buildWorkspaceBackup() {
const notes = [];
for (const note of state.notes) {
    const portableHtml = await embedStoredImagesInHtml(note.contentHtml);
    notes.push({ ...note, contentHtml: portableHtml });
}
return {
    app: "NoteDock",
    version: "1.2.0",
    exportedAt: nowIso(),
    notes
};
}

async function backupAllNotes() {
syncEditorToNote();
const payload = await buildWorkspaceBackup();
const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
downloadBlob(blob, `notedock-backup-${new Date().toISOString().slice(0, 10)}.ndbackup`);
}

async function importEmbeddedImagesIntoDb(html) {
const div = document.createElement("div");
div.innerHTML = html || "";

const imgs = Array.from(div.querySelectorAll("img"));
for (const img of imgs) {
    const src = img.getAttribute("src") || "";
    if (!src.startsWith("data:")) continue;

    const response = await fetch(src);
    const blob = await response.blob();
    const id = uuid();

    await idbPutImage({
    id,
    name: img.getAttribute("alt") || "image",
    type: blob.type || "image/png",
    createdAt: nowIso(),
    blob
    });

    img.setAttribute("data-note-image-id", id);
    img.removeAttribute("src");
}

return div.innerHTML;
}

async function importNativeFile(file) {
const text = await file.text();
const parsed = JSON.parse(text);

if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid note file");
}

const importedHtml = await importEmbeddedImagesIntoDb(
    typeof parsed.contentHtml === "string"
    ? parsed.contentHtml
    : convertLegacyBodyToHtml(parsed.body || "")
);

const imported = {
    id: uuid(),
    title: parsed.title || "Imported note",
    contentHtml: importedHtml,
    favorite: Boolean(parsed.favorite),
    trashed: Boolean(parsed.trashed),
    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    createdAt: parsed.createdAt || nowIso(),
    updatedAt: nowIso()
};

state.notes.unshift(imported);
sortNotes();
state.activeNoteId = imported.id;
state.showTrash = Boolean(imported.trashed);

await renderAll();
debounceSave();
}

async function restoreWorkspaceBackup(file) {
const text = await file.text();
const parsed = JSON.parse(text);

if (!parsed || !Array.isArray(parsed.notes)) {
    throw new Error("Invalid backup file");
}

for (const note of parsed.notes) {
    const importedHtml = await importEmbeddedImagesIntoDb(
    typeof note.contentHtml === "string"
        ? note.contentHtml
        : convertLegacyBodyToHtml(note.body || "")
    );

    state.notes.unshift({
    id: uuid(),
    title: note.title || "Imported note",
    contentHtml: importedHtml,
    favorite: Boolean(note.favorite),
    trashed: Boolean(note.trashed),
    tags: Array.isArray(note.tags) ? note.tags : [],
    createdAt: note.createdAt || nowIso(),
    updatedAt: nowIso()
    });
}

sortNotes();
ensureValidActiveNote();
await renderAll();
debounceSave();
}

function setupSelectionTracking() {
["keyup", "mouseup", "focus", "input"].forEach(eventName => {
    editor.addEventListener(eventName, saveSelection);
});
}

function handleEditorInput() {
autoLinkifyElement(editor);
saveSelection();
updateActiveNoteFromEditor();
}

async function openLinkInNewTab(url) {
try {
    if (api.tabs?.create) {
    await api.tabs.create({ url });
    return;
    }
} catch (err) {
    console.error("Failed to open tab:", err);
}

window.open(url, "_blank", "noopener,noreferrer");
}

function showActiveNotes() {
state.showTrash = false;
ensureValidActiveNote();
applyPanelsState();
renderAll();
persistState();
}

function showTrashNotes() {
state.showTrash = true;
ensureValidActiveNote();
applyPanelsState();
renderAll();
persistState();
}

newNoteBtn.addEventListener("click", createNote);
duplicateNoteBtn.addEventListener("click", duplicateActiveNote);

favoriteBtn.addEventListener("click", () => {
const active = getActiveNote();
if (!active || active.trashed) return;
active.favorite = !active.favorite;
sortNotes();
updateFavoriteButton();
renderNotesList();
debounceSave();
});

toggleToolsBtn.addEventListener("click", toggleToolsPanel);
toggleDrawerBtn.addEventListener("click", toggleDrawerPanel);
collapseDrawerBtn.addEventListener("click", toggleDrawerPanel);
showActiveBtn.addEventListener("click", showActiveNotes);
showTrashBtn.addEventListener("click", showTrashNotes);
deleteBtn.addEventListener("click", moveActiveNoteToTrash);
restoreBtn.addEventListener("click", restoreActiveNote);
deletePermanentBtn.addEventListener("click", permanentlyDeleteActiveNote);
backupAllBtn.addEventListener("click", backupAllNotes);

searchInput.addEventListener("input", (e) => {
state.search = e.target.value || "";
renderNotesList();
});

noteTitle.addEventListener("input", () => {
updateActiveNoteFromEditor();
renderNotesList();
});

tagsInput.addEventListener("input", () => {
updateActiveNoteFromEditor();
renderNotesList();
});

editor.addEventListener("input", handleEditorInput);

editor.addEventListener("paste", async (event) => {
const items = event.clipboardData?.items || [];
const imageFiles = [];

for (const item of items) {
    if (item.type.startsWith("image/")) {
    const file = item.getAsFile();
    if (file) imageFiles.push(file);
    }
}

if (imageFiles.length) {
    event.preventDefault();
    await insertImagesAtCursor(imageFiles);
}
});

editor.addEventListener("dragover", (event) => {
event.preventDefault();
editor.classList.add("drag-over");
});

editor.addEventListener("dragleave", () => {
editor.classList.remove("drag-over");
});

editor.addEventListener("drop", async (event) => {
event.preventDefault();
editor.classList.remove("drag-over");

const files = Array.from(event.dataTransfer?.files || []).filter(file => file.type.startsWith("image/"));
if (!files.length) return;

if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(event.clientX, event.clientY);
    if (range) {
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    state.lastRange = range.cloneRange();
    }
}

await insertImagesAtCursor(files);
});

editor.addEventListener("click", async (e) => {
const link = e.target.closest("a");
if (link) {
    e.preventDefault();
    e.stopPropagation();
    clearSelectedImage();
    await openLinkInNewTab(link.href);
    return;
}

const img = e.target.closest("img.inline-note-image");
if (img) {
    e.preventDefault();
    e.stopPropagation();
    selectImageElement(img);
    return;
}

clearSelectedImage();
});

imageInput.addEventListener("change", async (e) => {
const files = Array.from(e.target.files || []);
await insertImagesAtCursor(files);
e.target.value = "";
});

document.querySelectorAll("[data-cmd]").forEach((btn) => {
btn.addEventListener("click", () => {
    execCommand(btn.getAttribute("data-cmd"));
});
});

quoteBtn.addEventListener("click", insertQuoteBlock);
codeBtn.addEventListener("click", insertCodeBlock);
hrBtn.addEventListener("click", insertDivider);
tableBtn.addEventListener("click", insertTable);
tableRowBtn.addEventListener("click", addTableRow);
tableColBtn.addEventListener("click", addTableColumn);
tableDeleteRowBtn.addEventListener("click", deleteTableRow);
tableDeleteColBtn.addEventListener("click", deleteTableColumn);
imgSmallerBtn.addEventListener("click", () => resizeSelectedImage(0.85));
imgLargerBtn.addEventListener("click", () => resizeSelectedImage(1.15));
clearFormattingBtn.addEventListener("click", clearFormatting);
linkBtn.addEventListener("click", insertLink);

exportNativeBtn.addEventListener("click", exportNative);
exportTxtBtn.addEventListener("click", exportTxt);
exportHtmlBtn.addEventListener("click", exportHtml);
exportMdBtn.addEventListener("click", exportMarkdown);
exportPdfBtn.addEventListener("click", exportPdf);

importInput.addEventListener("change", async (e) => {
const file = e.target.files?.[0];
if (!file) return;

try {
    await importNativeFile(file);
    setStatus("Imported note successfully");
} catch (err) {
    console.error(err);
    setStatus("Import failed");
    alert("Failed to import note file.");
} finally {
    e.target.value = "";
}
});

restoreAllInput.addEventListener("change", async (e) => {
const file = e.target.files?.[0];
if (!file) return;

try {
    await restoreWorkspaceBackup(file);
    setStatus("Workspace restored");
} catch (err) {
    console.error(err);
    setStatus("Restore failed");
    alert("Failed to restore workspace backup.");
} finally {
    e.target.value = "";
}
});

window.addEventListener("resize", applyPanelsState);

window.addEventListener("beforeunload", () => {
syncEditorToNote();
revokeEditorObjectUrls();
});

document.addEventListener("keydown", async (event) => {
const isMod = event.ctrlKey || event.metaKey;
const key = event.key.toLowerCase();

if (state.selectedImageEl && (event.key === "Delete" || event.key === "Backspace")) {
    event.preventDefault();
    deleteSelectedImage();
    return;
}

if (isMod && key === "b") {
    event.preventDefault();
    execCommand("bold");
    return;
}

if (isMod && key === "i") {
    event.preventDefault();
    execCommand("italic");
    return;
}

if (isMod && key === "u") {
    event.preventDefault();
    execCommand("underline");
    return;
}

if (isMod && key === "k") {
    event.preventDefault();
    insertLink();
    return;
}

if (isMod && key === "d") {
    event.preventDefault();
    await duplicateActiveNote();
    return;
}

if (isMod && key === "s") {
    event.preventDefault();
    syncEditorToNote();
    const active = getActiveNote();
    if (active) active.updatedAt = nowIso();
    await persistState();
    setStatus(`Saved • ${formatTime(nowIso())}`);
    return;
}

if (isMod && (key === "z" || key === "y")) {
    clearSelectedImage();
}
});

// ==========================================
// PENDING CLIP LISTENER (Already Open Panel)
// ==========================================
api.storage.onChanged.addListener(async (changes, areaName) => {
// If the panel is already open and a new clip is added to storage
if (areaName === "local" && changes.pending_clip && changes.pending_clip.newValue) {
    await processPendingClip(changes.pending_clip.newValue);
}
});

setupSelectionTracking();

loadState().catch((err) => {
console.error("Initialization failed:", err);
setStatus("Initialization failed");
});