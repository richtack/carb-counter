/* ============================================================
   Net Carb Counter — app logic
   ============================================================ */
"use strict";

/* ---------- tiny helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (n) => { const r = Math.round(Number(n) * 100) / 100; return (Object.is(r, -0) ? 0 : r).toString(); };
const fmtCal = (n) => Math.round(Number(n) || 0).toString();
const isFav = (f) => f != null && state.favorites.includes(f.id);  // personal favorite?
// Keep legacy saved categories compatible with the current names.
function categoryName(value) {
  const name = (value || "").trim();
  return /^drinks?$/i.test(name) || /^beverages$/i.test(name) ? "Beverages" : /^cheese$/i.test(name) ? "Cheese" : name;
}

/* local-date (not UTC) helpers */
function dateToStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function strToDate(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function todayStr() { return dateToStr(new Date()); }
function fmtTime(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (isNaN(d)) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function fmtLocalTime(value) {
  const match = /^(\d{2}):(\d{2})/.exec(value || "");
  if (!match) return "";
  const d = new Date(2000, 0, 1, Number(match[1]), Number(match[2]));
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function fmtEntryTime(entry) {
  return entry && entry.logged_local_time ? fmtLocalTime(entry.logged_local_time) : fmtTime(entry && entry.created_at);
}
function localTimelineMillis(logDate, localTime, fallbackIso) {
  const dateParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(logDate || "");
  const timeParts = /^(\d{2}):(\d{2})(?::(\d{2}))?/.exec(localTime || "");
  if (dateParts && timeParts) {
    return new Date(Number(dateParts[1]), Number(dateParts[2]) - 1, Number(dateParts[3]),
      Number(timeParts[1]), Number(timeParts[2]), Number(timeParts[3] || 0)).getTime();
  }
  return new Date(fallbackIso).getTime();
}
function fmtDateLabel(s) {
  if (s === todayStr()) return "Today";
  const d = strToDate(s), t = strToDate(todayStr());
  const diff = Math.round((d - t) / 86400000);
  if (diff === -1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/* ---------- app state ---------- */
let db = null;
const state = {
  person: "rich",         // who this deployment belongs to (from config); set in boot
  foods: [],
  meals: [],              // this person's reusable food combinations
  mealsReady: false,      // false until the saved_meals migration is available
  entries: [],            // entries for state.date (this person's only)
  dayStatus: null,        // saved completeness flag for one person/date
  dayStatusSaving: false,
  favorites: [],          // this person's favorite food ids (personal, not shared)
  usual: null,            // local experiment preferences + frozen membership, never daily entries
  target: 20,
  categoryOrder: [],      // user-defined category display order
  trackCalories: false,   // calorie tracking on/off (synced)
  calorieTarget: 2000,    // daily calorie goal
  calReady: false,        // whether the DB has the calorie columns yet
  date: todayStr(),
  search: "",
  searchSelectionId: null,
  editorSearch: "",
  tab: "log",
  logView: localStorage.getItem("ncc_logView") || "time",            // "time" | "summary"
  summaryGroup: localStorage.getItem("ncc_summaryGroup") || "category", // "category" | "flat"
  openCat: categoryName(localStorage.getItem("ncc_openCat")) || null, // single expanded category (auto-close others)
  foodView: localStorage.getItem("ncc_foodView") || "cats", // "cats" | "az"
  voiceDraft: null,        // current Shortcut review; never saved until explicit confirmation
  labelDraft: null,        // current nutrition-label review; never saved until explicit confirmation
  pendingItems: [],        // unresolved Log later notes across every date
  pendingReady: false,     // true after the private endpoint has acknowledged the management key
  pendingAuthError: false,
};

let modalOpen = false; // hide bottom floating pills while a modal/pop-up is open
let modalReturnFocus = null;
let voiceLaunchInProgress = false;
let labelLaunchInProgress = false;
let returnRefreshInProgress = false;

/* ============================================================
   Boot
   ============================================================ */
function configReady() {
  const c = window.NCC_CONFIG || {};
  return c.SUPABASE_URL && c.SUPABASE_ANON_KEY &&
    !c.SUPABASE_URL.includes("YOUR-PROJECT") && !c.SUPABASE_ANON_KEY.includes("YOUR-ANON");
}

async function boot() {
  if (!configReady()) { $("#setup").classList.remove("hidden"); return; }

  // Identity + header come from config (this deployment is one specific person).
  state.person = window.NCC_CONFIG.PERSON || "rich";
  usualSession();
  applyDisplayName(window.NCC_CONFIG.DISPLAY_NAME);

  try {
    db = window.supabase.createClient(window.NCC_CONFIG.SUPABASE_URL, window.NCC_CONFIG.SUPABASE_ANON_KEY);
  } catch (e) {
    return showSetupError("Could not start Supabase client: " + e.message);
  }

  $("#app").classList.remove("hidden");
  $("#appbar").classList.remove("hidden");
  wireUI();

  try {
    // Foods first (shared), then settings — so we can seed this person's
    // favorites from the shared food list if their settings row is brand new.
    await loadFoods();
    await loadSettings();
    await loadMeals();
    await loadEntries();
    await loadDayStatus();
    await loadPendingItems({ quiet: true });
  } catch (e) {
    showSetupError("Connected, but couldn't read your tables. Did you run supabase-setup.sql? (" + e.message + ")");
    $("#setup").classList.remove("hidden");
    $("#app").classList.add("hidden");
    $("#appbar").classList.add("hidden");
    return;
  }

  renderAll();
  refreshUsualFoods(); // Background read: must not delay daily logging or Shortcut review.
  await handleVoiceLaunch();
  await handleLabelLaunch();
  setupReturnRefresh();
  registerSW();
}

function showSetupError(msg) {
  $("#setup").classList.remove("hidden");
  $("#setup-detail").textContent = msg;
}

// Set the header + page title from the configured name, e.g. "Rich's Carb Counter".
function applyDisplayName(name) {
  const title = (name ? `${name}'s` : "My") + " Carb Counter";
  document.title = title;
  const t = $("#appTitle");
  if (t) t.textContent = title;
}

/* ============================================================
   Data access
   ============================================================ */
async function loadFoods() {
  const { data, error } = await db.from("foods").select("*").order("name");
  if (error) throw error;
  state.foods = (data || []).map((food) => ({ ...food, category: categoryName(food.category) }));
}
async function loadMeals() {
  const person = state.person;
  try {
    const { data, error } = await db.from("saved_meals").select("*").eq("person", person).order("name");
    if (error) throw error;
    if (state.person === person) {
      state.meals = data || [];
      state.mealsReady = true;
    }
  } catch (_) {
    if (state.person === person) {
      if (!state.mealsReady) state.meals = [];
    }
  }
}
async function loadSettings() {
  let { data, error } = await db.from("settings").select("*").eq("person", state.person).maybeSingle();
  if (error) throw error;
  // First time this person opens the app → create their settings row,
  // seeding favorites from whatever foods are currently starred (shared flag).
  if (!data) {
    const seed = state.foods.filter((f) => f.favorite).map((f) => f.id);
    const insert = { person: state.person, daily_target: 20, category_order: [], favorites: seed };
    const res = await db.from("settings").insert(insert).select().single();
    if (res.error) throw res.error;
    data = res.data;
  }
  state.target = Number(data.daily_target);
  if (Array.isArray(data.category_order)) state.categoryOrder = [...new Set(data.category_order.map(categoryName))];
  state.favorites = Array.isArray(data.favorites) ? data.favorites.slice() : [];
  state.calReady = ("track_calories" in data); // calorie columns present?
  state.trackCalories = !!(state.calReady && data.track_calories);
  if (data.calorie_target != null) state.calorieTarget = Number(data.calorie_target);
}
async function loadEntries() {
  const person = state.person, date = state.date;
  const { data, error } = await db.from("entries")
    .select("*").eq("person", person).eq("log_date", date).order("created_at");
  if (error) throw error;
  if (state.person === person && state.date === date) state.entries = data || [];
}

let dayStatusRequest = 0;
function currentDayStatus() {
  const status = state.dayStatus;
  return status?.person === state.person && status?.date === state.date ? status : null;
}
function dayIsIncomplete() { return currentDayStatus()?.incomplete === true; }

async function loadDayStatus() {
  if (state.dayStatusSaving) return;
  const person = state.person, date = state.date, request = ++dayStatusRequest;
  state.dayStatus = { person, date, loading: true };
  renderDayStatus();
  try {
    const { data, error } = await db.from("day_log_status").select("incomplete")
      .eq("person", person).eq("log_date", date).maybeSingle();
    if (error) throw error;
    if (request !== dayStatusRequest || person !== state.person || date !== state.date) return;
    state.dayStatus = { person, date, incomplete: data?.incomplete === true };
  } catch (_) {
    if (request !== dayStatusRequest || person !== state.person || date !== state.date) return;
    state.dayStatus = { person, date, error: true };
  }
  renderProgress();
}

async function toggleDayIncomplete() {
  if (state.dayStatusSaving || state.date > todayStr()) return;
  const status = currentDayStatus();
  if (!status || status.error) return loadDayStatus();
  if (status.loading) return;
  const person = state.person, date = state.date, incomplete = !status.incomplete;
  state.dayStatusSaving = true;
  ++dayStatusRequest; // A read started before this write cannot overwrite it.
  renderDayStatus();
  try {
    const { data, error } = await db.from("day_log_status").upsert({
      person, log_date: date, incomplete, updated_at: new Date().toISOString(),
    }, { onConflict: "person,log_date" }).select("incomplete").single();
    if (error || data?.incomplete !== incomplete) throw error || new Error("Flag not saved");
    if (person === state.person && date === state.date) state.dayStatus = { person, date, incomplete };
    toast(incomplete ? "Day marked as incomplete" : "Incomplete flag removed");
  } catch (_) {
    toast("Couldn’t save the day flag. Please try again.");
  } finally {
    state.dayStatusSaving = false;
    renderProgress();
    if (person !== state.person || date !== state.date) await loadDayStatus();
  }
}

function usualSession() {
  if (!state.usual || state.usual.person !== state.person) {
    state.usual?.controller?.abort();
    state.usual = { person: state.person, ...window.NCCUsualFoods.readPreferences(localStorage, state.person),
      status: "idle", ids: [], request: 0, controller: null };
  }
  return state.usual;
}

async function refreshUsualFoods({ freshSession = false } = {}) {
  const session = usualSession();
  if (freshSession) {
    session.controller?.abort();
    session.request++;
    session.status = "idle";
    session.ids = [];
  }
  if (!session.enabled || session.status !== "idle") return;
  const request = ++session.request;
  const controller = new AbortController();
  session.controller = controller;
  session.status = "loading";
  renderFoodGrid();
  const timer = setTimeout(() => controller.abort(), 15000);
  const current = () => state.person === session.person && state.usual === session && session.request === request;
  try {
    const window = globalThis.NCCUsualFoods.windowFor();
    const history = await globalThis.NCCUsualFoods.loadHistory(db, session.person, window, { signal: controller.signal });
    if (!current()) return;
    session.ids = globalThis.NCCUsualFoods.rank(state.foods, history, session.person, window);
    session.status = "ready";
  } catch (_) {
    if (!current()) return;
    session.ids = [];
    session.status = "error";
  } finally {
    clearTimeout(timer);
    if (current()) { session.controller = null; renderFoodGrid(); }
  }
}

function setUsualPreference(changes) {
  const session = usualSession();
  Object.assign(session, changes);
  if (!window.NCCUsualFoods.writePreferences(localStorage, state.person, session)) {
    toast("Layout changed for now; this browser couldn’t remember it");
  }
  renderFoodGrid();
  refreshUsualFoods();
}

function pendingManageKey() {
  return window.NCCLogLater ? window.NCCLogLater.getManageKey(state.person) : "";
}

async function pendingRequest(body, key = pendingManageKey()) {
  return window.NCCLogLater.request(window.NCC_CONFIG.SUPABASE_URL, key, body);
}

async function loadPendingItems({ quiet = false } = {}) {
  if (!window.NCCLogLater || !pendingManageKey()) {
    state.pendingItems = [];
    state.pendingReady = false;
    state.pendingAuthError = false;
    return;
  }
  try {
    const result = await pendingRequest({ action: "list" });
    state.pendingItems = result.items || [];
    state.pendingReady = true;
    state.pendingAuthError = false;
  } catch (error) {
    state.pendingReady = false;
    state.pendingAuthError = error && error.status === 401;
    if (!quiet && !state.pendingAuthError) toast("Couldn’t refresh Log later notes");
  }
}

function dayPending() {
  return window.NCCLogLater ? window.NCCLogLater.pendingForDate(state.pendingItems, state.date) : [];
}

/* ============================================================
   Shortcut voice handoff

   Expected fragment (kept out of server logs):
   #voice=<URL-encoded dictation>&date=YYYY-MM-DD&draft=<unique id>
   ============================================================ */
function validDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  return dateToStr(strToDate(value)) === value;
}

function voiceSavedKey(draftId) {
  return `ncc_voice_saved:${state.person}:${draftId}`;
}

function wasVoiceDraftSaved(draftId) {
  if (!draftId) return false;
  try { return !!localStorage.getItem(voiceSavedKey(draftId)); } catch (e) { return false; }
}

function markVoiceDraftSaved(draftId) {
  if (!draftId) return;
  try { localStorage.setItem(voiceSavedKey(draftId), new Date().toISOString()); } catch (e) {}
}

function readVoiceLaunch() {
  if (!location.hash || !location.hash.includes("voice=")) return null;
  const params = new URLSearchParams(location.hash.slice(1));
  const transcript = (params.get("voice") || "").trim();
  const requestedDate = params.get("date") || "";
  const rawDraft = (params.get("draft") || "").trim();
  return {
    transcript,
    date: validDateString(requestedDate) ? requestedDate : todayStr(),
    // Shortcut supplies this. The fallback keeps hand-built test links usable.
    draftId: /^[a-z0-9._:-]{1,100}$/i.test(rawDraft) ? rawDraft : `manual-${Date.now()}`,
  };
}

function clearVoiceFragment() {
  // Dictated text should not linger in browser history or the address bar.
  history.replaceState(null, "", location.pathname + location.search);
}

async function handleVoiceLaunch() {
  if (voiceLaunchInProgress || !db || !window.NCCVoice) return;
  const launch = readVoiceLaunch();
  if (!launch) return;
  clearVoiceFragment();
  if (!launch.transcript || launch.transcript.length > 1200) {
    return toast(launch.transcript ? "That dictation is too long to review" : "No dictated food was received");
  }
  if (wasVoiceDraftSaved(launch.draftId)) return toast("This voice meal was already saved");
  if (modalOpen) {
    if (!confirm("Discard the review that is already open and review this voice meal instead?")) {
      return toast("Kept the current review");
    }
    state.voiceDraft = null;
    state.labelDraft = null;
    closeModal();
  }

  voiceLaunchInProgress = true;
  try {
    if (state.date !== launch.date) {
      state.date = launch.date;
      await loadEntries();
      renderDate(); renderEntries(); renderProgress();
    }
    const parsed = window.NCCVoice.parseTranscript(launch.transcript, state.foods);
    if (!parsed.items.length) return toast("I couldn’t find any food in that dictation");
    state.voiceDraft = { ...launch, ...parsed };
    openVoiceReview(state.voiceDraft);
  } catch (e) {
    toast("Couldn’t prepare the voice review");
  } finally {
    voiceLaunchInProgress = false;
  }
}

/* ============================================================
   Shortcut nutrition-label handoff

   Expected fragment (kept out of server logs):
   #label=<URL-encoded OCR text>&draft=<unique id>
   ============================================================ */
function labelSavedKey(draftId) {
  return `ncc_label_saved:${draftId}`;
}

function wasLabelDraftSaved(draftId) {
  if (!draftId) return false;
  try { return !!localStorage.getItem(labelSavedKey(draftId)); } catch (e) { return false; }
}

function markLabelDraftSaved(draftId) {
  if (!draftId) return;
  try { localStorage.setItem(labelSavedKey(draftId), new Date().toISOString()); } catch (e) {}
}

function labelLaunchError(error) {
  const messages = {
    empty: "No nutrition-label text was received",
    too_long: "That label contains too much text to review safely",
    malformed: "The nutrition-label link was malformed",
    invalid_draft: "The nutrition-label link is missing its one-time draft ID",
  };
  return messages[error] || "Couldn’t read the nutrition-label link";
}

async function handleLabelLaunch() {
  if (labelLaunchInProgress || !db || !window.NCCLabel) return;
  const launch = window.NCCLabel.parseLaunchHash(location.hash);
  if (!launch) return;
  clearVoiceFragment(); // clears either Shortcut fragment without retaining OCR text in history
  if (launch.error) return toast(labelLaunchError(launch.error));
  if (wasLabelDraftSaved(launch.draftId)) return toast("This scanned food was already saved");

  if (modalOpen) {
    if (!confirm("Discard the review that is already open and review this scanned label instead?")) {
      return toast("Kept the current review");
    }
    state.voiceDraft = null;
    state.labelDraft = null;
    closeModal();
  }

  labelLaunchInProgress = true;
  try {
    const foodId = await window.NCCLabel.foodId(launch.draftId);
    // localStorage is origin-specific. The stable database ID also catches a
    // reopened link on the other household deployment or after browser data is cleared.
    const existing = await db.from("foods").select("id").eq("id", foodId).maybeSingle();
    if (!existing.error && existing.data) {
      markLabelDraftSaved(launch.draftId);
      return toast("This scanned food was already saved");
    }
    const parsed = window.NCCLabel.parseNutritionLabel(launch.text);
    state.labelDraft = { ...launch, ...parsed, foodId };
    openLabelReview(state.labelDraft);
  } catch (e) {
    toast("Couldn’t prepare the nutrition-label review");
  } finally {
    labelLaunchInProgress = false;
  }
}

async function refreshAfterReturn() {
  if (!db || modalOpen || returnRefreshInProgress || document.visibilityState === "hidden") return;
  returnRefreshInProgress = true;
  try {
    await Promise.all([loadFoods(), loadMeals(), loadSettings(), loadEntries(), loadDayStatus(), loadPendingItems({ quiet: true })]);
    renderAll();
  } catch (e) {
    // Keep the currently displayed data; a brief connection loss should not blank the app.
  } finally {
    returnRefreshInProgress = false;
  }
}

function setupReturnRefresh() {
  let awayAt = document.visibilityState === "hidden" ? Date.now() : null;
  const onReturn = () => {
    if (document.visibilityState === "hidden") return;
    if (awayAt !== null && Date.now() - awayAt >= 15 * 60 * 1000) {
      refreshUsualFoods({ freshSession: true });
    }
    awayAt = null;
    refreshAfterReturn();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { if (awayAt === null) awayAt = Date.now(); }
    else onReturn();
  });
  window.addEventListener("pagehide", () => { if (awayAt === null) awayAt = Date.now(); });
  window.addEventListener("pageshow", (e) => { if (e.persisted) onReturn(); });
}

/* ============================================================
   Actions
   ============================================================ */
async function logFood(food, qty = 1) {
  const cal = (food.calories == null || food.calories === "") ? null : Number(food.calories);
  const temp = {
    id: "tmp-" + Math.round(performance.now()) + "-" + state.entries.length,
    food_id: food.id, name: food.name, net_carbs: Number(food.net_carbs),
    qty, log_date: state.date, _pending: true,
  };
  if (state.calReady) temp.calories = cal;
  state.entries.push(temp);
  renderEntries(); renderProgress();

  const row = { food_id: food.id, name: food.name, net_carbs: Number(food.net_carbs), qty, log_date: state.date, person: state.person };
  if (state.calReady) row.calories = cal;
  const { data, error } = await db.from("entries").insert(row).select().single();

  if (error) {
    state.entries = state.entries.filter((e) => e.id !== temp.id);
    renderEntries(); renderProgress();
    return toast("Couldn’t save — check your connection");
  }
  Object.assign(temp, data, { _pending: false });
  renderEntries();
}

async function setQty(entry, qty) {
  if (qty < 0.5) return removeEntry(entry);
  const prev = entry.qty;
  entry.qty = qty;
  renderEntries(); renderProgress();
  const { error } = await db.from("entries").update({ qty }).eq("id", entry.id);
  if (error) { entry.qty = prev; renderEntries(); renderProgress(); toast("Couldn’t update"); }
}

async function removeEntry(entry, withUndo = true) {
  state.entries = state.entries.filter((e) => e.id !== entry.id);
  renderEntries(); renderProgress();
  const { error } = await db.from("entries").delete().eq("id", entry.id);
  if (error) { state.entries.push(entry); renderEntries(); renderProgress(); return toast("Couldn’t delete"); }
  if (withUndo) toast(`Removed ${entry.name}`, "Undo", () => logFood(
    { id: entry.food_id, name: entry.name, net_carbs: entry.net_carbs }, entry.qty));
}

async function setEntryTime(entry, iso, loggedLocalTime) {
  const prev = entry.created_at;
  const prevLocal = entry.logged_local_time;
  entry.created_at = iso;
  if (loggedLocalTime) entry.logged_local_time = loggedLocalTime;
  state.entries.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  closeModal(); renderEntries();
  const changes = { created_at: iso };
  if (loggedLocalTime) changes.logged_local_time = loggedLocalTime;
  const { error } = await db.from("entries").update(changes).eq("id", entry.id);
  if (error) {
    entry.created_at = prev;
    entry.logged_local_time = prevLocal;
    state.entries.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    renderEntries(); toast("Couldn’t update time");
  }
}

async function setEntryCarbs(entry, nc) {
  const prev = entry.net_carbs;
  entry.net_carbs = nc;
  renderEntries(); renderProgress();
  const { error } = await db.from("entries").update({ net_carbs: nc }).eq("id", entry.id);
  if (error) { entry.net_carbs = prev; renderEntries(); renderProgress(); toast("Couldn’t update carbs"); }
}

async function setEntryCal(entry, cal) {
  const prev = entry.calories;
  entry.calories = cal; // null = unknown
  renderEntries(); renderProgress();
  const { error } = await db.from("entries").update({ calories: cal }).eq("id", entry.id);
  if (error) { entry.calories = prev; renderEntries(); renderProgress(); toast("Couldn’t update calories"); }
}

function foodRow(values) {
  // The food itself is shared (no favorite here — favorites are personal).
  const row = {
    name: values.name.trim(),
    serving: values.serving.trim(),
    net_carbs: Number(values.net_carbs) || 0,
    category: categoryName(values.category),
  };
  if (state.calReady && values.calories !== undefined) {
    const c = String(values.calories).trim();
    row.calories = c === "" ? null : Math.max(0, Number(c) || 0); // blank = unknown
  }
  return row;
}

async function saveFood(values, existing, onSaved) {
  const row = foodRow(values);
  if (!row.name) return toast("Give the food a name");
  let foodId, savedFood;
  if (existing) {
    const { error } = await db.from("foods").update(row).eq("id", existing.id);
    if (error) return toast("Couldn’t save food");
    Object.assign(existing, row);
    foodId = existing.id;
    savedFood = existing;
  } else {
    const { data, error } = await db.from("foods").insert(row).select().single();
    if (error) return toast("Couldn’t add food");
    state.foods.push(data);
    foodId = data.id;
    savedFood = data;
  }
  state.foods.sort((a, b) => a.name.localeCompare(b.name));
  await setFavorite(foodId, !!values.favorite);   // personal: persists to this person's settings
  closeModal(); renderFoodGrid(); renderEditor(); renderMealCards(); renderMeals();
  if (onSaved) onSaved(savedFood);
}

async function saveLabelFood(values, draft) {
  const row = { ...foodRow(values), id: draft.foodId };
  let { data, error } = await db.from("foods")
    .upsert(row, { onConflict: "id", ignoreDuplicates: true }).select("*");
  // A retry after an uncertain response deliberately keeps the first committed
  // version. Read it back so the UI can finish without creating another food.
  if (!error && !(data || []).length) {
    const existing = await db.from("foods").select("*").eq("id", draft.foodId).maybeSingle();
    data = existing.data ? [existing.data] : [];
    error = existing.error || (!existing.data ? new Error("Incomplete label save") : null);
  }
  if (error) return false;

  const saved = { ...data[0], category: categoryName(data[0].category) };
  const current = state.foods.find((food) => food.id === saved.id);
  if (current) Object.assign(current, saved);
  else state.foods.push(saved);
  state.foods.sort((a, b) => a.name.localeCompare(b.name));
  await setFavorite(saved.id, !!values.favorite);
  markLabelDraftSaved(draft.draftId);
  state.labelDraft = null;
  closeModal();
  renderFoodGrid(); renderEditor(); renderMealCards(); renderMeals();
  toast(`Saved ${saved.name} to My Foods`);
  return true;
}

// Add/remove a food from THIS person's favorites (stored in their settings row).
async function setFavorite(foodId, on) {
  const has = state.favorites.includes(foodId);
  if (on === has) return; // no change
  const prev = state.favorites;
  state.favorites = on ? [...prev, foodId] : prev.filter((id) => id !== foodId);
  renderFoodGrid(); renderEditor();
  const { error } = await db.from("settings").update({ favorites: state.favorites }).eq("person", state.person);
  if (error) { state.favorites = prev; renderFoodGrid(); renderEditor(); toast("Couldn’t save favorite"); }
}

async function deleteFood(food) {
  state.foods = state.foods.filter((f) => f.id !== food.id);
  closeModal(); renderFoodGrid(); renderEditor(); renderMealCards(); renderMeals();
  if (state.favorites.includes(food.id)) setFavorite(food.id, false); // tidy up this person's favorites
  const { error } = await db.from("foods").delete().eq("id", food.id);
  if (error) { state.foods.push(food); state.foods.sort((a, b) => a.name.localeCompare(b.name)); renderFoodGrid(); renderEditor(); renderMealCards(); renderMeals(); toast("Couldn’t delete food"); }
  else { renderMealCards(); renderMeals(); }
}

function validMealRows(rows) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 30) return false;
  const ids = new Set();
  return rows.every((row) => {
    if (!state.foods.some((food) => food.id === row.food_id) || ids.has(row.food_id) ||
        !Number.isFinite(row.qty) || row.qty < 0.01 || row.qty > 100) return false;
    ids.add(row.food_id);
    return true;
  });
}

async function saveMeal(name, rows, existing) {
  if (!state.mealsReady || !name.trim() || name.trim().length > 120 || !validMealRows(rows)) return false;
  const values = { name: name.trim(), items: rows.map((row) => ({ food_id: row.food_id, qty: row.qty })),
    updated_at: new Date().toISOString() };
  let result;
  if (existing) result = await db.from("saved_meals").update(values).eq("id", existing.id).eq("person", state.person).select().single();
  else result = await db.from("saved_meals").insert({ ...values, person: state.person }).select().single();
  if (result.error || !result.data) {
    toast(result.error?.code === "23505" ? "A meal with that name already exists" : "Couldn’t save the meal");
    return false;
  }
  if (existing) Object.assign(existing, result.data);
  else state.meals.push(result.data);
  state.meals.sort((a, b) => a.name.localeCompare(b.name));
  renderMealCards(); renderMeals();
  return true;
}

async function deleteMeal(meal) {
  const { error } = await db.from("saved_meals").delete().eq("id", meal.id).eq("person", state.person);
  if (error) return toast("Couldn’t delete the meal");
  state.meals = state.meals.filter((item) => item.id !== meal.id);
  closeModal(); renderMealCards(); renderMeals();
  toast(`Deleted ${meal.name}. Past food entries are kept.`);
}

function mealEntryRows(rows, date, person) {
  if (!validMealRows(rows)) throw new Error("invalid_meal_rows");
  return rows.map((item) => {
    const food = state.foods.find((candidate) => candidate.id === item.food_id);
    const row = { id: window.NCCLogLater.uuid(), food_id: food.id, name: food.name,
      net_carbs: Number(food.net_carbs), qty: item.qty, log_date: date, person };
    if (state.calReady) row.calories = food.calories == null ? null : Number(food.calories);
    return row;
  });
}

async function saveMealEntries(rows) {
  const ids = rows.map((row) => row.id);
  let result;
  try { result = await db.from("entries").upsert(rows, { onConflict: "id", ignoreDuplicates: true }).select("*"); }
  catch (_) { result = { error: true, data: null }; }
  let saved = result.data || [];
  if (result.error || saved.length !== rows.length) {
    let read;
    try { read = await db.from("entries").select("*").in("id", ids); }
    catch (_) { return false; }
    if (read.error || (read.data || []).length !== rows.length ||
        !(read.data || []).every((entry) => ids.includes(entry.id))) return false;
    saved = read.data;
  }
  if (state.person === rows[0].person && state.date === rows[0].log_date) {
    const shown = new Set(state.entries.map((entry) => entry.id));
    state.entries.push(...saved.filter((entry) => !shown.has(entry.id)));
    state.entries.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    renderEntries(); renderProgress();
  }
  return true;
}

async function setTarget(t) {
  const v = Number(t);
  if (!(v > 0)) return;
  state.target = v;
  renderProgress();
  await db.from("settings").update({ daily_target: v }).eq("person", state.person);
}

async function setCategoryOrder(arr) {
  state.categoryOrder = arr.slice();
  renderFoodGrid();
  const { error } = await db.from("settings").update({ category_order: arr }).eq("person", state.person);
  if (error) toast("Order set for now — run the category_order migration to save it");
}

/* ---- CSV export ---- */
function downloadFile(name, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
const csvCell = (v) => { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
const toCSV = (rows) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n");

function exportFoods() {
  const cal = state.trackCalories;
  const rows = [["name", "serving", "net_carbs", "category", "favorite", ...(cal ? ["calories"] : [])],
    ...state.foods.map((f) => [f.name, f.serving, f.net_carbs, f.category, isFav(f) ? "fav" : "",
      ...(cal ? [f.calories == null ? "" : f.calories] : [])])];
  downloadFile("my-foods.csv", toCSV(rows), "text/csv");
  toast(`Exported ${state.foods.length} foods`);
}
async function loadExportRows(table, person) {
  const rows = [];
  // Continue until an empty page, even when the server's cap is below 500.
  for (;;) {
    let query = db.from(table).select("*").eq("person", person).order("log_date");
    if (table === "entries") query = query.order("created_at").order("id");
    const { data, error } = await query.range(rows.length, rows.length + 499);
    if (error) throw error;
    if (!data?.length) return rows;
    rows.push(...data);
  }
}

async function exportLog() {
  const person = state.person, cal = state.trackCalories;
  try {
    const [entries, statuses] = await Promise.all([
      loadExportRows("entries", person), loadExportRows("day_log_status", person),
    ]);
    const incompleteDates = new Set(statuses.filter((s) => s.incomplete).map((s) => s.log_date));
    const entryDates = new Set(entries.map((e) => e.log_date));
    const dataRows = entries.map((e) => [e.log_date, e.name, e.net_carbs, e.qty,
      Math.round(e.net_carbs * e.qty * 100) / 100,
      ...(cal ? [e.calories == null ? "" : Math.round(e.calories * e.qty)] : []),
      incompleteDates.has(e.log_date), "food"]);
    for (const date of incompleteDates) {
      if (!entryDates.has(date)) dataRows.push([date, "", "", "", "", ...(cal ? [""] : []), true, "day_status"]);
    }
    dataRows.sort((a, b) => a[0].localeCompare(b[0]));
    const rows = [["date", "food", "net_carbs_per_serving", "qty", "net_carbs_total",
      ...(cal ? ["calories_total"] : []), "day_log_incomplete", "row_type"], ...dataRows];
    downloadFile("net-carb-log.csv", toCSV(rows), "text/csv");
    toast(`Exported ${entries.length} log entries and ${incompleteDates.size} incomplete day flags`);
  } catch (_) {
    toast("Couldn’t export the full log and day flags. Please try again.");
  }
}

/* ============================================================
   Rendering
   ============================================================ */
function dayTotal() { return state.entries.reduce((s, e) => s + e.net_carbs * e.qty, 0); }
function dayCalories() {
  let total = 0, unknown = 0;
  for (const e of state.entries) {
    if (e.calories == null) unknown++;
    else total += Number(e.calories) * e.qty;
  }
  return { total, unknown };
}

function sortCats(arr) {
  const order = state.categoryOrder || [];
  return arr.slice().sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    if (a === "Other") return 1;
    if (b === "Other") return -1;
    return a.localeCompare(b);
  });
}
function categoriesInUse() {
  const set = new Set(); let other = false;
  for (const f of state.foods) { if (f.category) set.add(f.category); else other = true; }
  const arr = [...set]; if (other) arr.push("Other");
  return sortCats(arr);
}
function categoryChoices() {
  return sortCats([...new Set(["Beverages", "Cheese", ...state.foods.map((f) => categoryName(f.category)).filter(Boolean)])]);
}
function searchFoods(query) {
  const q = query.trim().toLowerCase();
  return state.foods.filter((f) => [f.name, f.serving, f.category].some((value) => (value || "").toLowerCase().includes(q)));
}

function logSearchResults() {
  const q = state.search.trim().toLowerCase();
  if (!q) return [];
  const rank = (food) => {
    const name = food.name.toLowerCase();
    if (name === q) return 0;
    if (name.startsWith(q)) return 1;
    if (name.includes(q)) return 2;
    if ((food.serving || "").toLowerCase().includes(q)) return 3;
    return 4; // category match
  };
  return searchFoods(q).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

function clearLogSearch({ focus = false } = {}) {
  const input = $("#foodSearch");
  input.value = "";
  state.search = "";
  state.searchSelectionId = null;
  $("#clearFoodSearch").classList.add("hidden");
  renderFoodGrid();
  if (focus) input.focus({ preventScroll: true });
}

function selectedSearchFood() {
  return logSearchResults().find((food) => food.id === state.searchSelectionId) || null;
}

function moveSearchSelection(delta) {
  const hits = logSearchResults();
  if (!hits.length) return;
  const index = hits.findIndex((food) => food.id === state.searchSelectionId);
  state.searchSelectionId = hits[(index + delta + hits.length) % hits.length].id;
  renderFoodGrid();
  $("#foodGrid .keyboard-selected")?.scrollIntoView({ block: "nearest" });
}

function logSelectedFood(food) {
  confirmPulse($("#foodGrid .keyboard-selected"), Number(food.net_carbs));
  logFood(food, 1);
  clearLogSearch({ focus: true });
}

function renderAll() { renderDate(); renderProgress(); renderFoodGrid(); renderEntries(); renderEditor(); renderMealCards(); renderMeals(); }

function renderDate() {
  const lbl = $("#dateLabel");
  lbl.textContent = fmtDateLabel(state.date);
  lbl.classList.toggle("is-today", state.date === todayStr());
}

function renderProgress() {
  const total = dayTotal();
  const pendingToday = dayPending().length;
  const incomplete = dayIsIncomplete() || pendingToday > 0;
  renderDayStatus();
  const pendingAll = state.pendingItems.length;
  $("#dayTotal").textContent = fmt(total);
  $("#targetLabel").textContent = fmt(state.target);
  const pct = Math.min(100, (total / state.target) * 100);
  const fill = $("#barFill");
  fill.style.width = pct + "%";
  const over = total > state.target;
  fill.classList.toggle("over", over);
  const rem = $("#remainingLabel");
  if (over) { rem.textContent = `${fmt(total - state.target)} g over${incomplete ? " (known)" : ""}`; rem.classList.add("over"); }
  else { rem.textContent = `${fmt(state.target - total)} g left${incomplete ? " (known)" : ""}`; rem.classList.remove("over"); }

  const calLine = $("#calLine");
  if (calLine) {
    if (!state.trackCalories) { calLine.classList.add("hidden"); }
    else {
      calLine.classList.remove("hidden");
      const { total: cal, unknown } = dayCalories();
      let html = `${unknown ? "≈ " : ""}<b>${fmtCal(cal)}</b> / ${fmtCal(state.calorieTarget)} cal`;
      if (unknown) html += ` <span class="cal-unknown">· ${unknown} unknown</span>`;
      if (incomplete) html += ` <span class="cal-unknown">· incomplete</span>`;
      calLine.innerHTML = html;
    }
  }
  const dayLine = $("#pendingDayLine");
  dayLine.classList.toggle("hidden", !pendingToday);
  dayLine.textContent = pendingToday ? `${fmt(total)} g logged · ${pendingToday} meal${pendingToday === 1 ? "" : "s"} pending` : "";
  const allButton = $("#pendingAllBtn");
  allButton.classList.toggle("hidden", !pendingAll);
  allButton.textContent = pendingAll ? `⚑ ${pendingAll} item${pendingAll === 1 ? "" : "s"} need logging` : "";
  renderMiniTally();
}

function renderDayStatus() {
  const button = $("#dayIncompleteBtn"), note = $("#dayIncompleteNote");
  if (!button || !note) return;
  const status = currentDayStatus(), incomplete = dayIsIncomplete();
  button.disabled = state.dayStatusSaving || !!status?.loading || state.date > todayStr();
  button.setAttribute("aria-pressed", String(incomplete));
  button.textContent = state.dayStatusSaving ? "Saving day flag…" : status?.loading ? "Loading day flag…"
    : status?.error ? "Retry day flag" : incomplete ? "⚑ Day log incomplete" : "Flag day as incomplete";
  note.textContent = status?.error ? "Couldn’t load this day’s flag. Tap to retry."
    : incomplete ? "Some food wasn’t logged. Tap again to remove the flag."
    : "Use when the day ended with food missing from the log.";
}

function foodCardHTML(f, selected = false) {
  const fav = isFav(f);
  return `<button class="food-btn ${fav ? "fav" : ""}${selected ? " keyboard-selected" : ""}" data-food="${f.id}">
    ${fav ? '<span class="fav-star">★</span>' : ""}
    <span class="fname">${esc(f.name)}</span>
    <span class="frow">
      <span class="fserv">${esc(f.serving || "")}</span>
      <span class="fcarb">${fmt(f.net_carbs)}<small> g net</small></span>
    </span>
  </button>`;
}

function updateFoodViewSeg() {
  $$("#foodViewSeg button").forEach((b) => b.classList.toggle("active", b.dataset.fview === state.foodView));
}

function usualFoodsHTML() {
  const session = usualSession();
  const foods = session.mode === "favorites" ? state.foods.filter(isFav) :
    session.ids.map((id) => state.foods.find((food) => food.id === id)).filter(Boolean).sort(window.NCCUsualFoods.byName);
  let content;
  if (session.mode === "favorites") {
    content = foods.length ? foods.map(foodCardHTML).join("") : '<p class="usual-note">No favorites yet. Add stars in My Foods.</p>';
  } else if (session.status === "error") {
    content = '<p class="usual-note" role="status">Most used is unavailable right now</p><button class="wide-btn usual-fallback" data-usual-mode="favorites">Show Favorites</button>';
  } else if (session.status !== "ready") {
    content = '<p class="usual-note" role="status">Loading Most used…</p><button class="wide-btn usual-fallback" data-usual-mode="favorites">Show Favorites</button>';
  } else {
    content = foods.length ? foods.map(foodCardHTML).join("") : '<p class="usual-note">Your usual foods will appear as you log meals</p><button class="wide-btn usual-fallback" data-usual-mode="favorites">Show Favorites</button>';
  }
  return `<section class="usual-foods" aria-labelledby="usual-heading">
    <div class="cat-head" id="usual-heading">Usual foods</div>
    <div class="seg usual-modes" aria-label="Usual foods selection">
      <button type="button" data-usual-mode="most" aria-pressed="${session.mode === "most"}" class="${session.mode === "most" ? "active" : ""}">Most used</button>
      <button type="button" data-usual-mode="favorites" aria-pressed="${session.mode === "favorites"}" class="${session.mode === "favorites" ? "active" : ""}">Favorites</button>
    </div>
    <div class="usual-grid">${content}</div>
  </section>`;
}

function renderFoodGrid() {
  const grid = $("#foodGrid");
  $("#savedMealsSection")?.classList.toggle("hidden", !!state.search.trim());
  if (!state.foods.length) {
    if ($("#foodSearchStatus")) $("#foodSearchStatus").textContent = "";
    grid.innerHTML = `<p class="empty-note">No foods yet. Go to <b>My Foods</b> and add your first one →</p>`;
    renderJump(); renderMiniTally();
    return;
  }
  updateFoodViewSeg();
  const q = state.search.trim();
  // While searching, show a flat list of matches across ALL foods (ignore collapse).
  if (q) {
    const hits = logSearchResults();
    if (!hits.some((food) => food.id === state.searchSelectionId)) state.searchSelectionId = hits[0]?.id || null;
    grid.innerHTML = hits.length ? hits.map((food) => foodCardHTML(food, food.id === state.searchSelectionId)).join("") : `<p class="empty-note">No matches for “${esc(state.search)}”.</p>`;
    const selected = selectedSearchFood();
    const status = $("#foodSearchStatus");
    if (status) status.textContent = selected ? `${hits.length} match${hits.length === 1 ? "" : "es"}. Selected: ${selected.name}${selected.serving ? `, ${selected.serving}` : ""}. Enter to log; Shift+Enter for portions.` : "No matching foods.";
    renderJump(); renderMiniTally();
    return;
  }
  state.searchSelectionId = null;
  if ($("#foodSearchStatus")) $("#foodSearchStatus").textContent = "";
  // A–Z view: every food, flat, alphabetical
  if (state.foodView === "az") {
    grid.innerHTML = [...state.foods].sort((a, b) => a.name.localeCompare(b.name)).map(foodCardHTML).join("");
    renderJump(); renderMiniTally();
    return;
  }
  let html = "";
  const favs = state.foods.filter(isFav);
  if (usualSession().enabled) html += usualFoodsHTML();
  else if (favs.length) html += `<div class="cat-head">★ Favorites</div>` + favs.map(foodCardHTML).join("");

  // group ALL foods by category (favorites appear here too, in addition to the top section)
  const cats = {};
  for (const f of state.foods) (cats[f.category || "Other"] ||= []).push(f);
  const catKeys = sortCats(Object.keys(cats));
  if (catKeys.length) {
    html += `<div class="cat-head" id="catTop">Categories</div>`;
    for (const cat of catKeys) {
      const active = state.openCat === cat;
      html += `<button class="cat-tile ${active ? "active" : ""}" data-cat="${esc(cat)}">
          <span class="ct-name">${esc(cat)}</span>
          <span class="ct-count">${cats[cat].length}</span>
        </button>`;
    }
    // selected category's foods, shown below the tile grid
    if (state.openCat && cats[state.openCat]) {
      html += `<div class="cat-head open-cat">${esc(state.openCat)} <span class="pill">${cats[state.openCat].length}</span></div>`;
      html += cats[state.openCat].map(foodCardHTML).join("");
    }
  }
  grid.innerHTML = html;
  renderJump(); renderMiniTally();
}

function toggleCat(cat) {
  state.openCat = state.openCat === cat ? null : cat;
  if (state.openCat) localStorage.setItem("ncc_openCat", state.openCat);
  else localStorage.removeItem("ncc_openCat");
  renderFoodGrid();
  // bring the top of the categories section into view (keeps all tiles visible)
  if (state.openCat) {
    const hdr = $("#catTop");
    if (hdr) {
      const appbarH = ($("#appbar")?.offsetHeight) || 0;
      const top = window.scrollY + hdr.getBoundingClientRect().top - appbarH - 10;
      window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    }
  }
}

function updateLogSegs() {
  $$("#logViewSeg button").forEach((b) => b.classList.toggle("active", b.dataset.view === state.logView));
  $$("#summaryGroupSeg button").forEach((b) => b.classList.toggle("active", b.dataset.group === state.summaryGroup));
  $("#summaryGroupSeg").classList.toggle("hidden", state.logView !== "summary");
}

function renderEntries() {
  const list = $("#entriesList");
  const pending = dayPending();
  $("#entriesCount").textContent = (state.entries.length + pending.length) || "";
  updateLogSegs();
  if (!state.entries.length && !pending.length) {
    list.innerHTML = `<p class="empty-note">Nothing logged ${state.date === todayStr() ? "today" : "this day"} yet.</p>`;
    renderJump();
    return;
  }
  list.innerHTML = state.logView === "summary" ? summaryHTML() : timeListHTML();
  renderJump();
}

/* --- Time view: every occasion, timestamped, editable --- */
function timeListHTML() {
  const items = [
    ...state.entries.map((entry) => ({ type: "entry", at: localTimelineMillis(entry.log_date, entry.logged_local_time, entry.created_at), entry })),
    ...dayPending().map((pending) => ({ type: "pending", at: localTimelineMillis(pending.log_date, pending.local_time, pending.captured_at), pending })),
  ].sort((a, b) => a.at - b.at);
  return items.map((item, i) => {
    let gap = "";
    if (i > 0) {
      const mins = (item.at - items[i - 1].at) / 60000;
      if (mins > 60) gap = " time-gap";
    }
    if (item.type === "pending") {
      const pending = item.pending;
      return `<button type="button" class="entry pending-entry${gap}" data-pending="${pending.id}">
        <span class="pending-icon" aria-hidden="true">⚑</span>
        <span class="pending-main">
          <span class="ename">${esc(pending.note)}</span>
          <span class="emeta"><b>Needs logging</b> · ${fmtLocalTime(pending.local_time)}</span>
        </span>
        <span class="pending-open" aria-hidden="true">›</span>
      </button>`;
    }
    const e = item.entry;
    return `
    <div class="entry${gap}" data-entry="${e.id}" ${e._pending ? 'style="opacity:.55"' : ""}>
      <div>
        <div class="ename">${esc(e.name)}</div>
        <div class="emeta"><span class="etime" data-act="time" title="Tap to edit time">${fmtEntryTime(e)}</span> · ${fmt(e.net_carbs)} g${e.qty !== 1 ? ` × ${fmt(e.qty)}` : ""}${state.trackCalories ? ` · <span class="ecal ${e.calories == null ? "unknown" : ""}" data-act="cal" title="Tap to set calories">${e.calories == null ? "? cal" : fmtCal(e.calories * e.qty) + " cal"}</span>` : ""}</div>
      </div>
      <div class="qty-ctrl">
        <button data-act="dec" aria-label="less">−</button>
        <span class="qval">${fmt(e.qty)}×</span>
        <button data-act="inc" aria-label="more">+</button>
      </div>
      <span class="ecarb" data-act="carbs" title="Tap to adjust carbs">${fmt(e.net_carbs * e.qty)} g</span>
      <button class="del" data-act="del" aria-label="delete">✕</button>
    </div>`;
  }).join("");
}

/* --- Summary view: duplicates merged into one line each --- */
function foodCategory(e) {
  let f = e.food_id ? state.foods.find((x) => x.id === e.food_id) : null;
  if (!f) f = state.foods.find((x) => x.name === e.name);
  return f && f.category ? f.category : "Other";
}
function mergedEntries() {
  const map = new Map();
  for (const e of state.entries) {
    const key = (e.food_id || "") + "|" + e.name;
    let m = map.get(key);
    if (!m) { m = { name: e.name, qty: 0, carbs: 0, count: 0, category: foodCategory(e) }; map.set(key, m); }
    m.qty += Number(e.qty);
    m.carbs += e.net_carbs * e.qty;
    m.count += 1;
  }
  return [...map.values()];
}
function sumRowHTML(it) {
  const sub = [];
  if (it.qty !== 1 || it.count > 1) sub.push("×" + fmt(it.qty));
  if (it.count > 1) sub.push(it.count + " times");
  return `<div class="sum-row">
    <div>
      <div class="sr-name">${esc(it.name)}</div>
      ${sub.length ? `<div class="sr-qty">${sub.join(" · ")}</div>` : ""}
    </div>
    <span class="sr-carb">${fmt(it.carbs)} g</span>
  </div>`;
}
function summaryHTML() {
  const items = mergedEntries();
  const byCarb = (a, b) => b.carbs - a.carbs || a.name.localeCompare(b.name);
  const pending = dayPending();
  const pendingHtml = pending.length ? `<div class="sum-cat-head pending-summary-head"><span class="sch-name">⚑ Needs logging</span><span class="sch-total">${pending.length} pending</span></div>` +
    pending.map((item) => `<button type="button" class="sum-row pending-summary-row" data-pending="${item.id}"><span class="sr-name">${esc(item.note)}</span><span class="sr-carb">${fmtLocalTime(item.local_time)} · ?</span></button>`).join("") : "";
  if (state.summaryGroup === "flat") {
    return items.sort(byCarb).map(sumRowHTML).join("") + pendingHtml;
  }
  const byCat = {};
  for (const it of items) (byCat[it.category] ||= []).push(it);
  let html = "";
  for (const cat of sortCats(Object.keys(byCat))) {
    const rows = byCat[cat].sort(byCarb);
    const sub = rows.reduce((s, r) => s + r.carbs, 0);
    html += `<div class="sum-cat-head"><span class="sch-name">${esc(cat)}</span><span class="sch-total">${fmt(sub)} g</span></div>`;
    html += rows.map(sumRowHTML).join("");
  }
  return html + pendingHtml;
}

const FOOD_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#";
function foodIndexLetter(name) {
  const first = name.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").charAt(0).toUpperCase();
  return /^[A-Z]$/.test(first) ? first : "#";
}

function renderEditor() {
  const list = $("#foodEditorList");
  const foods = searchFoods(state.editorSearch).sort((a, b) =>
    FOOD_ALPHABET.indexOf(foodIndexLetter(a.name)) - FOOD_ALPHABET.indexOf(foodIndexLetter(b.name)) || a.name.localeCompare(b.name));
  const letters = new Set(foods.map((f) => foodIndexLetter(f.name)));
  const alphabet = $("#foodAlphabet");
  alphabet.classList.toggle("hidden", letters.size < 2);
  alphabet.innerHTML = [...FOOD_ALPHABET].map((letter) => `<button type="button" data-letter="${letter}" aria-label="Jump to ${letter === "#" ? "numbers and symbols" : letter}" ${letters.has(letter) ? `aria-controls="food-letter-${letter === "#" ? "other" : letter}"` : "disabled"}>${letter}</button>`).join("");
  let previousLetter = null;
  $("#foodEditorCount").textContent = state.editorSearch.trim() ? `${foods.length} of ${state.foods.length} foods` : `${foods.length} foods`;
  if (!state.foods.length) list.innerHTML = `<p class="empty-note">Your food list is empty. Tap “Add a food” above.</p>`;
  else if (!foods.length) list.innerHTML = `<p class="empty-note">No matches for “${esc(state.editorSearch.trim())}”. Try a name, serving, or category.</p>`;
  else list.innerHTML = foods.map((f) => {
    const letter = foodIndexLetter(f.name);
    const heading = letter !== previousLetter ? `<h2 class="editor-letter" id="food-letter-${letter === "#" ? "other" : letter}" tabindex="-1">${letter}</h2>` : "";
    previousLetter = letter;
    return `${heading}
    <div class="editor-row" data-edit="${f.id}">
      <div class="er-main">
        <div class="er-name">${isFav(f) ? "★ " : ""}${esc(f.name)}</div>
        <div class="er-sub">${f.serving ? esc(f.serving) + " · " : ""}${f.category ? esc(f.category) : "uncategorized"}${state.trackCalories ? ` · ${f.calories == null ? "? cal" : fmtCal(f.calories) + " cal"}` : ""}</div>
      </div>
      <span class="er-carb">${fmt(f.net_carbs)} g</span>
      <button class="er-edit" aria-label="edit">✎</button>
    </div>`;
  }).join("");
  renderJump();
}

function mealRows(meal) {
  return Array.isArray(meal.items) ? meal.items.map((item) => ({
    food_id: String(item.food_id || ""), qty: Number(item.qty),
  })) : [];
}

function mealTotals(rows) {
  let carbs = 0, calories = 0, unknown = 0, missing = 0;
  for (const row of rows) {
    const food = state.foods.find((item) => item.id === row.food_id);
    if (!food) { missing++; continue; }
    carbs += Number(food.net_carbs) * row.qty;
    if (food.calories == null) unknown++;
    else calories += Number(food.calories) * row.qty;
  }
  return { carbs, calories, unknown, missing };
}

function mealDescription(meal) {
  return mealRows(meal).map((row) => {
    const food = state.foods.find((item) => item.id === row.food_id);
    return `${food ? food.name : "Missing food"} ${fmt(row.qty)}×`;
  }).join(" · ");
}

function renderMealCards() {
  const list = $("#mealQuickList");
  if (!list) return;
  if (!state.mealsReady) {
    list.innerHTML = '<p class="meal-note">Saved meals need the database update before they can be used.</p>';
    return;
  }
  if (!state.meals.length) {
    list.innerHTML = '<p class="meal-note">No saved meals yet. Save a combination in My Meals.</p>';
    return;
  }
  list.innerHTML = state.meals.map((meal) => {
    const rows = mealRows(meal), totals = mealTotals(rows), ready = validMealRows(rows);
    return `<button type="button" class="meal-quick-card" data-meal-log="${esc(meal.id)}" ${ready ? "" : "disabled"}>
      <span class="meal-card-name">${esc(meal.name)}</span>
      <span class="meal-card-meta">${ready ? `${fmt(totals.carbs)} g net · ${rows.length} foods` : "Needs an updated food or serving"}</span>
    </button>`;
  }).join("");
}

function renderMeals() {
  const list = $("#mealEditorList");
  if (!list) return;
  const add = $("#addMealBtn");
  if (add) add.disabled = !state.mealsReady || !state.foods.length;
  if (!state.mealsReady) {
    list.innerHTML = '<p class="empty-note">Saved meals need the database update. Run the saved_meals migration, then reload.</p>';
    return;
  }
  if (!state.foods.length) {
    list.innerHTML = '<p class="empty-note">Add foods in My Foods before creating a meal.</p>';
    return;
  }
  if (!state.meals.length) {
    list.innerHTML = '<p class="empty-note">No saved meals yet. Add your first combination above.</p>';
    return;
  }
  list.innerHTML = state.meals.map((meal) => {
    const rows = mealRows(meal), totals = mealTotals(rows), ready = validMealRows(rows);
    return `<div class="meal-editor-card">
      <div class="meal-editor-content"><b>${esc(meal.name)}</b>
        <span>${esc(mealDescription(meal))}</span>
        <small>${ready ? `${fmt(totals.carbs)} g net${state.trackCalories ? ` · ${totals.unknown ? "some calories unknown" : `${fmtCal(totals.calories)} cal`}` : ""}` : "Needs an updated food or serving · edit to repair"}</small>
      </div>
      <div class="meal-editor-actions">
        <button type="button" data-meal-edit="${esc(meal.id)}">Edit</button>
        <button type="button" class="meal-log-btn" data-meal-log="${esc(meal.id)}" ${ready ? "" : "disabled"}>Log</button>
      </div>
    </div>`;
  }).join("");
}

/* ============================================================
   Modals
   ============================================================ */
function openModal(node) {
  const root = $("#modalRoot");
  if (!modalOpen) modalReturnFocus = document.activeElement;
  root.innerHTML = "";
  root.appendChild(node);
  root.classList.remove("hidden");
  root.onclick = (e) => {
    if (e.target !== root) return;
    if (typeof node._onBackdrop === "function") node._onBackdrop();
    else closeModal();
  };
  modalOpen = true; renderJump(); renderMiniTally();
  // Record the initial form after the caller has finished populating dynamic rows.
  queueMicrotask(() => { if (root.firstElementChild === node) node._initialFields = modalFieldValues(node); });
}
function closeModal() {
  $("#modalRoot").classList.add("hidden"); $("#modalRoot").innerHTML = "";
  modalOpen = false; renderJump(); renderMiniTally();
  if (modalReturnFocus?.isConnected) modalReturnFocus.focus({ preventScroll: true });
  modalReturnFocus = null;
}

function modalFieldValues(node) {
  return JSON.stringify([...node.querySelectorAll("input, textarea, select")].map((field) =>
    [field.type, field.type === "checkbox" ? field.checked : field.value]));
}

function escapeModal() {
  const node = $("#modalRoot").firstElementChild;
  if (!node) return;
  const saving = [...node.querySelectorAll("button")].some((button) => /^(Saving|Logging)…/.test(button.textContent));
  if (saving) return;
  if (node._onEscape) return node._onEscape();
  const dirty = node._initialFields != null && node._initialFields !== modalFieldValues(node);
  if (dirty && !confirm("Discard your unsaved changes?")) return;
  const cancel = node.querySelector("[data-close]");
  if (cancel) cancel.click();
  else closeModal();
}

function openKeyboardHelp() {
  const m = el(`<div class="modal shortcut-modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
    <h2>Keyboard shortcuts</h2>
    <dl class="shortcut-list">
      <dt>/</dt><dd>Search foods to log</dd>
      <dt>↑ ↓</dt><dd>Choose a search result</dd>
      <dt>Enter</dt><dd>Log the selected food</dd>
      <dt>Shift+Enter</dt><dd>Choose a portion</dd>
      <dt>Esc</dt><dd>Clear search, then leave it</dd>
      <dt>[ &nbsp; ]</dt><dd>Previous / next day</dd>
      <dt>T</dt><dd>Today</dd>
      <dt>L &nbsp; F &nbsp; M</dt><dd>Log / My Foods / My Meals</dd>
      <dt>O &nbsp; N &nbsp; P</dt><dd>One-off / New food / Pending items</dd>
      <dt>?</dt><dd>Show this list</dd>
    </dl>
    <div class="modal-actions"><button class="btn-green" data-close>Close</button></div>
  </div>`);
  m.querySelector("[data-close]").onclick = closeModal;
  openModal(m);
  m.querySelector("[data-close]").focus();
}

/* ---------- Log later ---------- */
async function refreshPendingDisplay() {
  await loadPendingItems({ quiet: true });
  renderProgress();
  renderEntries();
}

function pendingFailure(error, fallback) {
  if (error && error.code === "pending_conflict") {
    closeModal();
    refreshPendingDisplay();
    return toast("That note changed on another device. It has been refreshed.");
  }
  if (error && error.status === 401) {
    state.pendingAuthError = true;
    return toast("The Log later access key is invalid or revoked");
  }
  toast((error && error.message) || fallback);
}

function openPendingAccessSetup(afterSave) {
  const m = el(`<div class="modal">
    <h2>Connect Log later</h2>
    <p class="muted" style="margin-top:-6px">Paste ${esc(window.NCC_CONFIG.DISPLAY_NAME || state.person)}’s app management key. It is different from the Siri capture key.</p>
    <div class="field"><label>App management key</label>
      <input type="password" id="pending-key" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(pendingManageKey())}" /></div>
    <p class="field-help">This bearer secret is stored in this browser’s local storage. It is not a hardware-secured credential store.</p>
    <div class="modal-actions">
      ${pendingManageKey() ? '<button class="btn-danger" id="pending-key-clear">Remove</button>' : ""}
      <button class="btn-ghost" data-close>Cancel</button>
      <button class="btn-green" id="pending-key-save">Connect</button>
    </div>
  </div>`);
  m.querySelector("[data-close]").onclick = closeModal;
  m.querySelector("#pending-key-clear")?.addEventListener("click", () => {
    window.NCCLogLater.setManageKey(state.person, "");
    state.pendingItems = []; state.pendingReady = false; state.pendingAuthError = false;
    closeModal(); renderProgress(); renderEntries(); toast("Log later key removed from this browser");
  });
  m.querySelector("#pending-key-save").onclick = async () => {
    const button = m.querySelector("#pending-key-save");
    const key = m.querySelector("#pending-key").value.trim();
    if (!key) return toast("Paste the app management key");
    button.disabled = true; button.textContent = "Checking…";
    try {
      const result = await pendingRequest({ action: "list" }, key);
      window.NCCLogLater.setManageKey(state.person, key);
      state.pendingItems = result.items || [];
      state.pendingReady = true; state.pendingAuthError = false;
      closeModal(); renderProgress(); renderEntries();
      toast("Log later connected");
      if (afterSave) afterSave();
    } catch (error) {
      button.disabled = false; button.textContent = "Connect";
      pendingFailure(error, "Couldn’t connect Log later");
    }
  };
  openModal(m);
}

function requirePendingAccess(next) {
  if (pendingManageKey() && state.pendingReady) return next();
  openPendingAccessSetup(next);
}

function openLogLaterCapture() {
  if (!pendingManageKey() || !state.pendingReady) return openPendingAccessSetup(openLogLaterCapture);
  const requestId = window.NCCLogLater.uuid();
  const now = new Date();
  const m = el(`<div class="modal">
    <h2>Log later</h2>
    <p class="muted pending-context">${esc(fmtDateLabel(state.date))} · ${esc(fmtTime(now.toISOString()))}${state.date === todayStr() ? "" : " · selected date"}</p>
    <div class="field"><label>What did you eat?</label>
      <textarea id="pending-note" maxlength="${window.NCCLogLater.NOTE_LIMIT}" rows="3" placeholder="e.g. Lunch salad at Panera"></textarea>
      <p class="field-help"><span id="pending-note-count">0</span> / ${window.NCCLogLater.NOTE_LIMIT}</p>
    </div>
    <p class="pending-save-status" id="pending-save-status">This saves a reminder, not a zero-carb meal.</p>
    <div class="modal-actions">
      <button class="btn-ghost" data-close>Cancel</button>
      <button class="btn-green" id="pending-capture-save">Save</button>
    </div>
  </div>`);
  const note = m.querySelector("#pending-note");
  note.addEventListener("input", () => { m.querySelector("#pending-note-count").textContent = note.value.length; });
  m.querySelector("[data-close]").onclick = closeModal;
  m.querySelector("#pending-capture-save").onclick = async () => {
    const button = m.querySelector("#pending-capture-save");
    const checked = window.NCCLogLater.validateNote(note.value);
    if (checked.error === "empty") return toast("Add a short note first");
    if (checked.error) return toast("Keep the note to 500 characters");
    button.disabled = true; button.textContent = "Saving…";
    m.querySelector("#pending-save-status").textContent = "Waiting for durable server confirmation…";
    try {
      const payload = window.NCCLogLater.capturePayload(checked.note, state.date, requestId, now);
      await pendingRequest(payload);
      await refreshPendingDisplay();
      closeModal();
      toast("Saved for later");
    } catch (error) {
      button.disabled = false; button.textContent = "Try again";
      m.querySelector("#pending-save-status").textContent = "Saving could not be confirmed. Try again safely with the same request ID.";
      pendingFailure(error, "Saving could not be confirmed");
    }
  };
  openModal(m);
  setTimeout(() => note.focus(), 50);
}

function openPendingList() {
  if (!pendingManageKey() || !state.pendingReady) return openPendingAccessSetup(openPendingList);
  const sorted = [...state.pendingItems].sort((a, b) => a.log_date.localeCompare(b.log_date) || a.local_time.localeCompare(b.local_time));
  let lastDate = "";
  const rows = sorted.map((item) => {
    const heading = item.log_date !== lastDate ? `<h3 class="pending-group-date">${esc(fmtDateLabel(item.log_date))}</h3>` : "";
    lastDate = item.log_date;
    return `${heading}<button type="button" class="pending-list-row" data-pending="${item.id}">
      <span><b>${esc(item.note)}</b><small>⚑ Needs logging · ${esc(fmtLocalTime(item.local_time))}</small></span><span aria-hidden="true">›</span>
    </button>`;
  }).join("");
  const m = el(`<div class="modal pending-list-modal">
    <h2>Needs logging</h2>
    <p class="muted" style="margin-top:-6px">Oldest first · ${sorted.length} item${sorted.length === 1 ? "" : "s"}</p>
    <div class="pending-list-scroll">${rows || '<p class="empty-note">Nothing needs logging.</p>'}</div>
    <div class="modal-actions"><button class="btn-ghost" data-close>Close</button></div>
  </div>`);
  m.querySelector("[data-close]").onclick = closeModal;
  m.addEventListener("click", (event) => {
    const row = event.target.closest("[data-pending]");
    if (!row) return;
    const item = state.pendingItems.find((candidate) => candidate.id === row.dataset.pending);
    if (item) openPendingDetail(item);
  });
  openModal(m);
}

function openPendingDetail(item) {
  const m = el(`<div class="modal">
    <h2>Needs logging</h2>
    <p class="muted pending-context">${esc(fmtDateLabel(item.log_date))} · ${esc(fmtLocalTime(item.local_time))} · ${esc(item.timezone)}</p>
    <blockquote class="pending-quote">${esc(item.note)}</blockquote>
    <div class="modal-actions pending-detail-actions">
      <button class="btn-danger" id="pending-discard">Discard</button>
      <button class="btn-ghost" id="pending-edit">Edit note</button>
      <button class="btn-green" id="pending-finish">Finish logging</button>
    </div>
    <div class="modal-actions"><button class="btn-ghost" data-close>Cancel</button></div>
  </div>`);
  m.querySelector("[data-close]").onclick = closeModal;
  m.querySelector("#pending-edit").onclick = () => openPendingEdit(item);
  m.querySelector("#pending-finish").onclick = () => openFinishPending(item);
  m.querySelector("#pending-discard").onclick = async () => {
    if (!confirm("Discard this reminder? No food entry will be created.")) return;
    try {
      await pendingRequest({ action: "discard", id: item.id, version: item.version });
      closeModal(); await refreshPendingDisplay(); toast("Reminder discarded");
    } catch (error) { pendingFailure(error, "Couldn’t discard the reminder"); }
  };
  openModal(m);
}

function openPendingEdit(item) {
  const m = el(`<div class="modal">
    <h2>Edit note</h2>
    <p class="muted pending-context">${esc(fmtDateLabel(item.log_date))} · ${esc(fmtLocalTime(item.local_time))}</p>
    <div class="field"><label>What did you eat?</label>
      <textarea id="pending-edit-note" maxlength="${window.NCCLogLater.NOTE_LIMIT}" rows="3">${esc(item.note)}</textarea></div>
    <div class="modal-actions"><button class="btn-ghost" data-close>Cancel</button><button class="btn-green" id="pending-edit-save">Save</button></div>
  </div>`);
  m.querySelector("[data-close]").onclick = () => openPendingDetail(item);
  m.querySelector("#pending-edit-save").onclick = async () => {
    const note = m.querySelector("#pending-edit-note").value;
    const checked = window.NCCLogLater.validateNote(note);
    if (checked.error) return toast(checked.error === "empty" ? "The note can’t be blank" : "Keep the note to 500 characters");
    try {
      const result = await pendingRequest({ action: "edit", id: item.id, version: item.version, note: checked.note });
      Object.assign(item, result.item); await refreshPendingDisplay(); openPendingDetail(item); toast("Note updated");
    } catch (error) { pendingFailure(error, "Couldn’t edit the note"); }
  };
  openModal(m);
}

function pendingResolutionDraft(item, existing) {
  return existing || {
    resolutionId: window.NCCLogLater.uuid(),
    logDate: item.log_date,
    localTime: String(item.local_time || "12:00").slice(0, 5),
    timezone: item.timezone,
    rows: [{ foodId: "", qty: 1 }],
  };
}

function resolutionTimestamp(draft) {
  const offsetMatch = /([+-]\d{2}:\d{2})\)?$/.exec(draft.timezone || "");
  const offset = offsetMatch ? offsetMatch[1] : "Z";
  const value = `${draft.logDate}T${draft.localTime}:00${offset}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("invalid_resolution_time");
  return date.toISOString();
}

function openFinishPending(item, suppliedDraft) {
  const draft = pendingResolutionDraft(item, suppliedDraft);
  const m = el(`<div class="modal finish-pending-modal">
    <h2>Finish logging</h2>
    <blockquote class="pending-quote">${esc(item.note)}</blockquote>
    <p class="muted pending-context">Captured ${esc(fmtDateLabel(item.log_date))} at ${esc(fmtLocalTime(item.local_time))} · ${esc(item.timezone)}</p>
    <div class="field-row">
      <div class="field"><label>Log date</label><input type="date" id="resolve-date" value="${esc(draft.logDate)}" /></div>
      <div class="field"><label>Log time</label><input type="time" id="resolve-time" value="${esc(draft.localTime)}" /></div>
    </div>
    <div class="pending-foods" id="pending-foods"></div>
    <div class="pending-add-actions">
      <button type="button" class="btn-ghost" id="resolve-add-row">+ Another food</button>
      <button type="button" class="btn-ghost" id="resolve-add-food">+ Add missing food</button>
    </div>
    <p class="pending-save-status" id="resolve-status">Nothing changes until you tap Save meal.</p>
    <div class="modal-actions voice-actions">
      <button class="btn-ghost" data-close>Cancel</button>
      <button class="btn-green" id="resolve-save">Save meal</button>
    </div>
  </div>`);
  const body = m.querySelector("#pending-foods");
  const save = m.querySelector("#resolve-save");

  const readDraft = () => {
    draft.logDate = m.querySelector("#resolve-date").value;
    draft.localTime = m.querySelector("#resolve-time").value;
    draft.rows = [...m.querySelectorAll("[data-resolve-row]")].map((row) => ({
      foodId: row.querySelector("[data-resolve-food]").value,
      qty: Number(row.querySelector("[data-resolve-qty]").value),
    }));
    return draft;
  };
  const rowValid = (row) => !!state.foods.find((food) => food.id === row.foodId) && row.qty > 0 && row.qty <= 100;
  const sync = () => {
    const current = readDraft();
    save.disabled = !window.NCCLogLater.validDate(current.logDate) || !/^\d{2}:\d{2}$/.test(current.localTime) ||
      !current.rows.length || current.rows.some((row) => !rowValid(row));
  };
  const drawRows = () => {
    body.innerHTML = draft.rows.map((row, index) => {
      const food = state.foods.find((candidate) => candidate.id === row.foodId);
      return `<div class="pending-food-row" data-resolve-row="${index}">
        <div class="field"><label>Saved food</label><select data-resolve-food>${voiceFoodOptions(row.foodId)}</select></div>
        <div class="field pending-qty"><label>Servings</label><input type="number" min="0.01" max="100" step="0.01" inputmode="decimal" data-resolve-qty value="${esc(fmt(row.qty))}" /></div>
        ${draft.rows.length > 1 ? `<button type="button" class="pending-remove-food" data-remove-row="${index}" aria-label="Remove food">✕</button>` : ""}
        <p class="voice-food-meta">${esc(voiceFoodMeta(food))}</p>
      </div>`;
    }).join("");
    body.querySelectorAll("select,input").forEach((input) => input.addEventListener("input", () => {
      const parent = input.closest("[data-resolve-row]");
      if (input.matches("select")) {
        const food = state.foods.find((candidate) => candidate.id === input.value);
        parent.querySelector(".voice-food-meta").textContent = voiceFoodMeta(food);
      }
      sync();
    }));
    body.querySelectorAll("[data-remove-row]").forEach((button) => button.onclick = () => {
      readDraft(); draft.rows.splice(Number(button.dataset.removeRow), 1); drawRows();
    });
    sync();
  };

  m.querySelector("#resolve-date").addEventListener("input", sync);
  m.querySelector("#resolve-time").addEventListener("input", sync);
  m.querySelector("#resolve-add-row").onclick = () => { readDraft(); draft.rows.push({ foodId: "", qty: 1 }); drawRows(); };
  m.querySelector("#resolve-add-food").onclick = () => {
    readDraft(); closeModal();
    openFoodEditor(null, {
      onCancel: () => openFinishPending(item, draft),
      onSaved: (food) => {
        const blank = draft.rows.find((row) => !row.foodId);
        if (blank) blank.foodId = food.id;
        else draft.rows.push({ foodId: food.id, qty: 1 });
        openFinishPending(item, draft);
      },
    });
  };
  m.querySelector("[data-close]").onclick = closeModal;
  save.onclick = async () => {
    sync(); if (save.disabled) return;
    save.disabled = true; save.textContent = "Saving…";
    m.querySelector("#resolve-status").textContent = "Saving the replacement foods and reminder together…";
    try {
      const current = readDraft();
      await pendingRequest({
        action: "resolve", id: item.id, version: item.version,
        resolution_request_id: current.resolutionId,
        log_date: current.logDate,
        local_time: current.localTime + ":00",
        timezone: current.timezone,
        created_at: resolutionTimestamp(current),
        items: current.rows.map((row) => ({ food_id: row.foodId, qty: row.qty })),
      });
      closeModal();
      await Promise.all([loadEntries(), loadPendingItems({ quiet: true })]);
      renderProgress(); renderEntries();
      toast(`Logged ${current.rows.length} item${current.rows.length === 1 ? "" : "s"}`);
    } catch (error) {
      save.disabled = false; save.textContent = "Try again";
      m.querySelector("#resolve-status").textContent = "The save was not confirmed. The reminder is still pending unless the server reports it already finished.";
      pendingFailure(error, "Couldn’t finish logging");
    }
  };
  openModal(m); drawRows();
}

function openMealDialog(meal, mode = "edit") {
  if (!state.mealsReady || !state.foods.length) return;
  const logging = mode === "log";
  const date = state.date, person = state.person;
  let rows = meal ? mealRows(meal) : [{ food_id: "", qty: 1 }];
  let entryRows = null; // Stable IDs and values make an uncertain save safe to retry.
  const m = el(`<div class="modal meal-modal" role="dialog" aria-modal="true" aria-label="${logging ? "Log meal" : meal ? "Edit meal" : "Add meal"}">
    <h2>${logging ? `Log ${esc(meal.name)}` : meal ? "Edit meal" : "Add a meal"}</h2>
    <p class="muted meal-dialog-intro">${logging ? `For ${esc(fmtDateLabel(date))}. Adjust foods or servings for this occasion; the saved meal stays the same.` : "Choose the foods and usual servings. Nutrition uses their current saved values when logged."}</p>
    ${logging ? "" : `<div class="field"><label for="meal-name">Meal name</label><input type="text" id="meal-name" maxlength="120" value="${esc(meal?.name || "")}" placeholder="e.g. Usual breakfast" /></div>`}
    <div id="meal-dialog-rows" class="meal-dialog-rows"></div>
    <button type="button" class="btn-ghost meal-add-row" id="meal-add-row">+ Another food</button>
    <p id="meal-dialog-total" class="meal-dialog-total"></p>
    <p id="meal-dialog-status" class="field-help" role="status"></p>
    <div class="modal-actions">
      ${!logging && meal ? '<button type="button" class="btn-danger" id="meal-delete">Delete</button>' : ""}
      <button type="button" class="btn-ghost" data-close>Cancel</button>
      <button type="button" class="btn-green" id="meal-submit" disabled>${logging ? "Log meal" : "Save meal"}</button>
    </div>
  </div>`);
  const body = m.querySelector("#meal-dialog-rows");
  const submit = m.querySelector("#meal-submit");
  const status = m.querySelector("#meal-dialog-status");
  const nameInput = m.querySelector("#meal-name");
  const readRows = () => {
    rows = [...body.querySelectorAll("[data-meal-row]")].map((row) => ({
      food_id: row.querySelector("[data-meal-food]").value,
      qty: Number(row.querySelector("[data-meal-qty]").value),
    }));
    return rows;
  };
  const sync = () => {
    readRows();
    const valid = validMealRows(rows);
    const nameValid = logging || !!nameInput.value.trim();
    submit.disabled = !valid || !nameValid;
    if (!nameValid) status.textContent = "Give this meal a name.";
    else if (!valid) status.textContent = "Choose distinct saved foods and a serving amount from 0.01 to 100 for each.";
    else status.textContent = logging ? "Nothing is logged until you choose Log meal." : "Ready to save this meal.";
    const totals = valid ? mealTotals(rows) : null;
    m.querySelector("#meal-dialog-total").textContent = totals
      ? `${fmt(totals.carbs)} g net${state.trackCalories ? ` · ${totals.unknown ? "some calories unknown" : `${fmtCal(totals.calories)} cal`}` : ""}` : "";
  };
  const drawRows = () => {
    body.innerHTML = rows.map((row, index) => {
      const missing = row.food_id && !state.foods.some((food) => food.id === row.food_id);
      const options = missing ? `<option value="${esc(row.food_id)}" selected>Missing saved food — choose another</option>` : "";
      return `<div class="meal-dialog-row" data-meal-row="${index}">
        <div class="field"><label>Saved food</label><select data-meal-food>${options}${voiceFoodOptions(row.food_id)}</select></div>
        <div class="field meal-row-qty"><label>Servings</label><input type="number" data-meal-qty inputmode="decimal" min="0.01" max="100" step="0.01" value="${Number.isFinite(row.qty) ? esc(fmt(row.qty)) : ""}" /></div>
        ${rows.length > 1 ? `<button type="button" class="meal-remove-row" data-meal-remove="${index}" aria-label="Remove food">×</button>` : ""}
      </div>`;
    }).join("");
    body.querySelectorAll("select,input").forEach((input) => input.addEventListener("input", sync));
    body.querySelectorAll("[data-meal-remove]").forEach((button) => button.onclick = () => {
      readRows(); rows.splice(Number(button.dataset.mealRemove), 1); drawRows();
    });
    sync();
  };
  nameInput?.addEventListener("input", sync);
  m.querySelector("#meal-add-row").onclick = () => {
    readRows(); rows.push({ food_id: "", qty: 1 }); drawRows();
    body.querySelector("[data-meal-row]:last-child select")?.focus();
  };
  m.querySelector("[data-close]").onclick = closeModal;
  m.querySelector("#meal-delete")?.addEventListener("click", () => {
    if (confirm(`Delete “${meal.name}”? Past logged foods will stay in your history.`)) deleteMeal(meal);
  });
  submit.onclick = async () => {
    sync(); if (submit.disabled) return;
    submit.disabled = true;
    if (logging) {
      if (!entryRows) {
        try { entryRows = mealEntryRows(rows, date, person); }
        catch (_) { submit.disabled = false; return toast("Couldn’t prepare this meal"); }
        m.querySelectorAll("input,select,#meal-add-row,.meal-remove-row").forEach((control) => control.disabled = true);
      }
      submit.textContent = "Saving…";
      const saved = await saveMealEntries(entryRows);
      if (saved) { closeModal(); toast(`Logged ${meal.name} (${entryRows.length} foods)`); }
      else {
        submit.disabled = false; submit.textContent = "Try again";
        status.textContent = "Save not confirmed. Retry uses the same entries, so it cannot log this meal twice.";
      }
    } else {
      submit.textContent = "Saving…";
      let saved = false;
      try { saved = await saveMeal(nameInput.value, rows, meal); }
      catch (_) { toast("Couldn’t save the meal — check your connection"); }
      if (saved) { closeModal(); toast(`Saved ${nameInput.value.trim()}`); }
      else { submit.disabled = false; submit.textContent = "Try again"; }
    }
  };
  openModal(m);
  drawRows();
  if (!logging) setTimeout(() => nameInput.focus(), 50);
}

function openPortionSheet(food, onLogged) {
  const m = el(`<div class="modal">
    <h2>${esc(food.name)}</h2>
    <p class="muted" style="margin-top:-6px">${food.serving ? esc(food.serving) + " · " : ""}${fmt(food.net_carbs)} g net per serving</p>
    <div class="portion-quick">
      ${[0.25, 0.5, 1, 1.5, 2, 3, 4].map((q) => `<button data-q="${q}">${q}×</button>`).join("")}
    </div>
    <div class="field"><label>Custom amount (servings)</label>
      <input type="number" id="customQty" inputmode="decimal" step="0.25" min="0" value="1" /></div>
    <div class="modal-actions">
      <button class="btn-ghost" data-close>Cancel</button>
      <button class="btn-green" id="addCustom">Add</button>
    </div>
  </div>`);
  m.querySelectorAll("[data-q]").forEach((b) => b.onclick = () => {
    const q = Number(b.dataset.q);
    logFood(food, q); closeModal(); pulseFood(food.id, food.net_carbs * q);
    if (onLogged) onLogged();
  });
  m.querySelector("[data-close]").onclick = closeModal;
  m.querySelector("#addCustom").onclick = () => {
    const q = Number($("#customQty").value);
    if (q > 0) { logFood(food, q); closeModal(); pulseFood(food.id, food.net_carbs * q); if (onLogged) onLogged(); }
  };
  openModal(m);
}

function voiceFoodOptions(selectedId) {
  return `<option value="">Choose a saved food…</option>` + state.foods.map((food) =>
    `<option value="${esc(food.id)}" ${food.id === selectedId ? "selected" : ""}>${esc(food.name)}</option>`
  ).join("");
}

function voiceFoodMeta(food) {
  if (!food) return "Choose the matching food and confirm the servings.";
  const cal = state.trackCalories ? ` · ${food.calories == null ? "? cal" : fmtCal(food.calories) + " cal"}` : "";
  return `${food.serving || "serving not specified"} · ${fmt(food.net_carbs)} g net${cal}`;
}

function openVoiceReview(draft) {
  const unresolved = draft.items.filter((item) => item.status !== "matched").length;
  const m = el(`<div class="modal voice-modal">
    <h2>Review voice meal</h2>
    <p class="muted voice-date">${esc(fmtDateLabel(draft.date))} · Nothing is saved yet</p>
    <blockquote class="voice-quote">“${esc(draft.transcript)}”</blockquote>
    <div class="voice-review-note ${unresolved ? "needs-review" : ""}" id="voiceReviewNote">
      ${unresolved ? `${unresolved} item${unresolved === 1 ? " needs" : "s need"} your help.` : "Everything matched. Check the portions before saving."}
    </div>
    <div class="voice-items">
      ${draft.items.map((item, index) => {
        const selectedId = item.status === "matched" ? item.foodId : "";
        const food = state.foods.find((candidate) => candidate.id === selectedId);
        const possibilities = item.alternatives.map((id) => state.foods.find((candidate) => candidate.id === id)?.name).filter(Boolean);
        return `<div class="voice-item ${item.status === "matched" ? "" : "unresolved"}" data-voice-item="${index}">
          <div class="voice-source">
            <span>“${esc(item.source)}”</span>
            <button type="button" data-voice-remove aria-label="Skip this item">Skip</button>
          </div>
          <div class="field voice-food-field">
            <label>Saved food</label>
            <select data-voice-food>${voiceFoodOptions(selectedId)}</select>
          </div>
          <div class="field voice-qty-field">
            <label>Servings</label>
            <input type="number" inputmode="decimal" min="0.01" max="100" step="0.01" data-voice-qty value="${item.qty == null ? "" : esc(fmt(item.qty))}" placeholder="Required" />
          </div>
          <p class="voice-food-meta" data-voice-meta>${esc(voiceFoodMeta(food))}</p>
          ${possibilities.length ? `<p class="voice-suggestion">Possible match: ${esc(possibilities.join(" or "))}</p>` : ""}
        </div>`;
      }).join("")}
    </div>
    <div class="modal-actions voice-actions">
      <button class="btn-ghost" data-close>Cancel</button>
      <button class="btn-green" id="voiceSave" disabled>Save meal</button>
    </div>
  </div>`);

  const saveBtn = m.querySelector("#voiceSave");
  const note = m.querySelector("#voiceReviewNote");
  const activeRows = () => [...m.querySelectorAll("[data-voice-item]:not(.voice-removed)")];
  const rowIsValid = (row) => {
    const foodId = row.querySelector("[data-voice-food]").value;
    const qty = Number(row.querySelector("[data-voice-qty]").value);
    return !!state.foods.find((food) => food.id === foodId) && qty > 0 && qty <= 100;
  };
  const sync = () => {
    const rows = activeRows();
    rows.forEach((row) => row.classList.toggle("unresolved", !rowIsValid(row)));
    const needs = rows.filter((row) => !rowIsValid(row)).length;
    saveBtn.disabled = !rows.length || needs > 0;
    note.classList.toggle("needs-review", needs > 0);
    note.textContent = !rows.length
      ? "Keep at least one item to save."
      : needs
        ? `${needs} item${needs === 1 ? " needs" : "s need"} your help.`
        : "Ready to save. Check the portions one last time.";
  };

  m.querySelectorAll("[data-voice-item]").forEach((row) => {
    const index = Number(row.dataset.voiceItem);
    const item = draft.items[index];
    const select = row.querySelector("[data-voice-food]");
    const qtyInput = row.querySelector("[data-voice-qty]");
    select.addEventListener("change", () => {
      const food = state.foods.find((candidate) => candidate.id === select.value);
      row.querySelector("[data-voice-meta]").textContent = voiceFoodMeta(food);
      if (food) {
        const portion = window.NCCVoice.resolveQuantity(item.source, food.serving);
        qtyInput.value = portion.qty == null ? "" : fmt(portion.qty);
      } else {
        qtyInput.value = "";
      }
      sync();
    });
    qtyInput.addEventListener("input", sync);
    row.querySelector("[data-voice-remove]").onclick = () => {
      row.classList.add("voice-removed");
      sync();
    };
  });

  m.querySelector("[data-close]").onclick = () => { state.voiceDraft = null; closeModal(); };
  m._onEscape = () => { if (confirm("Discard this unsaved voice meal?")) m.querySelector("[data-close]").click(); };
  saveBtn.onclick = async () => {
    if (saveBtn.disabled) return;
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    let rows;
    try {
      rows = await Promise.all(activeRows().map(async (row) => {
        const itemIndex = Number(row.dataset.voiceItem);
        const food = state.foods.find((candidate) => candidate.id === row.querySelector("[data-voice-food]").value);
        const qty = Number(row.querySelector("[data-voice-qty]").value);
        const entry = {
          // Stable IDs make a retry safe even if Supabase committed the first
          // request but its response never made it back to the phone.
          id: await window.NCCVoice.entryId(state.person, draft.draftId, itemIndex),
          food_id: food.id, name: food.name, net_carbs: Number(food.net_carbs),
          qty, log_date: draft.date, person: state.person,
        };
        if (state.calReady) entry.calories = food.calories == null || food.calories === "" ? null : Number(food.calories);
        return entry;
      }));
    } catch (e) {
      saveBtn.textContent = "Try again";
      saveBtn.disabled = false;
      return toast("This browser can’t safely identify the voice meal");
    }

    let { data, error } = await db.from("entries")
      .upsert(rows, { onConflict: "id", ignoreDuplicates: true }).select("*");
    // On a retry, ignored rows are not returned by upsert. Read them back so the
    // UI can confirm the complete meal without creating a second copy.
    if (!error && (data || []).length !== rows.length) {
      const existing = await db.from("entries").select("*").in("id", rows.map((row) => row.id));
      data = existing.data;
      error = existing.error || ((data || []).length !== rows.length ? new Error("Incomplete voice meal") : null);
    }
    if (error) {
      saveBtn.textContent = "Try again";
      saveBtn.disabled = false;
      return toast("Couldn’t save the meal — check your connection");
    }

    markVoiceDraftSaved(draft.draftId);
    state.voiceDraft = null;
    const shownIds = new Set(state.entries.map((entry) => entry.id));
    state.entries.push(...(data || []).filter((entry) => !shownIds.has(entry.id)));
    state.entries.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    closeModal();
    renderEntries(); renderProgress();
    toast(`Saved ${rows.length} item${rows.length === 1 ? "" : "s"}`);
  };

  openModal(m);
  sync();
}

function labelPrefill(field) {
  return field && field.status === "found" && field.value != null ? field.value : "";
}

function labelScanStatus(field) {
  if (!field || field.status === "missing") return "Not found — check the label";
  if (field.status === "less_than") return `Scanned as ${field.raw} — choose a value`;
  if (field.status === "ambiguous") return "Unclear in scan — enter manually";
  return "Scanned — please verify";
}

function openLabelReview(draft) {
  const fields = draft.fields;
  const initialNet = window.NCCLabel.calculateNet(
    labelPrefill(fields.totalCarbs), labelPrefill(fields.fiber), labelPrefill(fields.sugarAlcohols)
  );
  const cats = categoryChoices();
  const m = el(`<div class="modal label-modal">
    <h2>Review scanned label</h2>
    <p class="muted label-subtitle">Nothing is saved yet · Add the food name and check each value</p>
    <div class="label-scroll">
      ${draft.basisAmbiguous ? '<div class="label-alert">More than one nutrition column or serving basis was detected. Values were left blank so you can enter one serving consistently.</div>' : ""}
      ${draft.unsupported ? '<div class="label-alert">This was not clearly recognized as a US Nutrition Facts panel. Nutrition values were left blank for manual review.</div>' : ""}
      <div class="field"><label>Name <span class="label-required">Required</span></label>
        <input type="text" id="lf-name" maxlength="200" placeholder="Type the food name" /></div>
      <div class="field"><label>Serving size <span class="label-scan-status" data-label-status="serving">${esc(labelScanStatus(fields.serving))}</span></label>
        <input type="text" id="lf-serving" maxlength="120" value="${esc(labelPrefill(fields.serving))}" placeholder="e.g. 2/3 cup (55 g)" /></div>
      <div class="field"><label>Calories per serving <span class="label-scan-status" data-label-status="calories">${esc(labelScanStatus(fields.calories))}</span></label>
        <input type="number" id="lf-cal" inputmode="decimal" min="0" max="100000" step="1" value="${esc(labelPrefill(fields.calories))}" placeholder="Unknown" />
        ${state.calReady ? '<p class="field-help">Blank stays unknown. This is saved even when calorie display is turned off.</p>' : '<p class="field-help label-warning">Your database does not have calorie storage yet, so this value cannot be saved until the existing calorie migration is applied.</p>'}
      </div>
      <div class="label-nutrients">
        <div class="field"><label>Total carbohydrate (g) <span class="label-scan-status" data-label-status="totalCarbs">${esc(labelScanStatus(fields.totalCarbs))}</span></label>
          <input type="number" id="lf-total" data-label-nutrient="totalCarbs" inputmode="decimal" min="0" max="10000" step="0.1" value="${esc(labelPrefill(fields.totalCarbs))}" placeholder="Missing" /></div>
        <div class="field"><label>Dietary fiber (g) <span class="label-scan-status" data-label-status="fiber">${esc(labelScanStatus(fields.fiber))}</span></label>
          <input type="number" id="lf-fiber" data-label-nutrient="fiber" inputmode="decimal" min="0" max="10000" step="0.1" value="${esc(labelPrefill(fields.fiber))}" placeholder="Missing" /></div>
        <div class="field"><label>Sugar alcohols (g) <span class="label-scan-status" data-label-status="sugarAlcohols">${esc(labelScanStatus(fields.sugarAlcohols))}</span></label>
          <input type="number" id="lf-sa" data-label-nutrient="sugarAlcohols" inputmode="decimal" min="0" max="10000" step="0.1" value="${esc(labelPrefill(fields.sugarAlcohols))}" placeholder="Missing" /></div>
      </div>
      <div class="field label-net-field"><label>Net carbs per serving (g) <span class="label-required">Required</span></label>
        <input type="number" id="lf-net" inputmode="decimal" min="0" max="10000" step="0.05" value="${initialNet.value == null ? "" : esc(initialNet.value)}" placeholder="Enter net carbs" />
        <p class="field-help" id="lf-net-help">Total carbohydrate − dietary fiber − sugar alcohols. Fill missing deductions with 0, or enter net carbs manually.</p>
      </div>
      <div class="field">
        <label>Category (optional)</label>
        <input type="text" id="lf-cat" maxlength="120" placeholder="Type a new one, or pick below" />
        ${cats.length ? `<div class="cat-chips">${cats.map((cat) => `<button type="button" class="cat-chip" data-cat="${esc(cat)}">${esc(cat)}</button>`).join("")}</div>` : ""}
      </div>
      <div class="field"><label class="check"><input type="checkbox" id="lf-fav" /> Favorite (pin to top)</label></div>
      <details class="label-source">
        <summary>Recognized text from the photo</summary>
        <p class="field-help">The photo itself is not transferred to the app.</p>
        <pre>${esc(draft.source)}</pre>
      </details>
    </div>
    <div class="label-save-note" id="lf-note"></div>
    <div class="modal-actions label-actions">
      <button class="btn-ghost" data-close>Cancel</button>
      <button class="btn-green" id="lf-save" disabled>Save food</button>
    </div>
  </div>`);

  const nameInput = m.querySelector("#lf-name");
  const servingInput = m.querySelector("#lf-serving");
  const calorieInput = m.querySelector("#lf-cal");
  const totalInput = m.querySelector("#lf-total");
  const fiberInput = m.querySelector("#lf-fiber");
  const alcoholInput = m.querySelector("#lf-sa");
  const netInput = m.querySelector("#lf-net");
  const netHelp = m.querySelector("#lf-net-help");
  const note = m.querySelector("#lf-note");
  const saveBtn = m.querySelector("#lf-save");
  let manualNet = initialNet.value == null;

  const validOptionalNumber = (input, max) => {
    if (input.value.trim() === "") return true;
    const value = Number(input.value);
    return Number.isFinite(value) && value >= 0 && value <= max;
  };
  const validRequiredNumber = (input, max) => input.value.trim() !== "" && validOptionalNumber(input, max);

  const updateScanStatus = (key, input) => {
    const status = m.querySelector(`[data-label-status="${key}"]`);
    if (!status) return;
    status.textContent = input.value.trim() === "" ? labelScanStatus(fields[key]) : (input.value === String(labelPrefill(fields[key])) ? "Scanned — please verify" : "Entered manually");
  };

  const sync = (nutritionChanged = false) => {
    if (nutritionChanged) {
      const result = window.NCCLabel.calculateNet(totalInput.value, fiberInput.value, alcoholInput.value);
      if (!result.error) {
        netInput.value = fmt(result.value);
        manualNet = false;
      } else if (result.error === "deductions_exceed_total") {
        netInput.value = "";
        manualNet = false;
      }
    }
    updateScanStatus("serving", servingInput);
    updateScanStatus("calories", calorieInput);
    updateScanStatus("totalCarbs", totalInput);
    updateScanStatus("fiber", fiberInput);
    updateScanStatus("sugarAlcohols", alcoholInput);

    const calculated = window.NCCLabel.calculateNet(totalInput.value, fiberInput.value, alcoholInput.value);
    const nutrientsValid = [totalInput, fiberInput, alcoholInput].every((input) => validOptionalNumber(input, 10000));
    const deductionsValid = calculated.error !== "deductions_exceed_total";
    [totalInput, fiberInput, alcoholInput].forEach((input) => input.classList.toggle("invalid", !validOptionalNumber(input, 10000)));
    calorieInput.classList.toggle("invalid", !validOptionalNumber(calorieInput, 100000));
    netInput.classList.toggle("invalid", !validRequiredNumber(netInput, 10000) || !deductionsValid);
    const ready = !!nameInput.value.trim() && nameInput.value.trim().length <= 200 &&
      servingInput.value.length <= 120 && validOptionalNumber(calorieInput, 100000) &&
      nutrientsValid && deductionsValid && validRequiredNumber(netInput, 10000);
    saveBtn.disabled = !ready;

    if (calculated.error === "deductions_exceed_total") {
      note.textContent = "Fiber plus sugar alcohols cannot be greater than total carbohydrate.";
      note.classList.add("needs-review");
      netHelp.textContent = "Correct the nutrition inputs before saving.";
    } else if (!nameInput.value.trim()) {
      note.textContent = "Add the food name before saving.";
      note.classList.add("needs-review");
    } else if (!validRequiredNumber(netInput, 10000)) {
      note.textContent = "Enter valid net carbs before saving.";
      note.classList.add("needs-review");
    } else if (!ready) {
      note.textContent = "Correct the highlighted numeric value before saving.";
      note.classList.add("needs-review");
    } else {
      note.textContent = "Ready to save to the shared My Foods list. This will not log a meal.";
      note.classList.remove("needs-review");
      netHelp.textContent = manualNet
        ? "Using the net carbs you entered because one or more deduction inputs are blank."
        : "Calculated as total carbohydrate − dietary fiber − sugar alcohols.";
    }
  };

  [nameInput, servingInput, calorieInput].forEach((input) => input.addEventListener("input", () => sync(false)));
  [totalInput, fiberInput, alcoholInput].forEach((input) => input.addEventListener("input", () => sync(true)));
  netInput.addEventListener("input", () => { manualNet = true; sync(false); });

  const catInput = m.querySelector("#lf-cat");
  const chips = [...m.querySelectorAll(".cat-chip")];
  const syncChips = () => chips.forEach((chip) =>
    chip.classList.toggle("active", chip.dataset.cat.toLowerCase() === catInput.value.trim().toLowerCase()));
  chips.forEach((chip) => chip.onclick = () => {
    catInput.value = chip.dataset.cat.toLowerCase() === catInput.value.trim().toLowerCase() ? "" : chip.dataset.cat;
    syncChips();
  });
  catInput.addEventListener("input", syncChips);

  m.querySelector("[data-close]").onclick = () => { state.labelDraft = null; closeModal(); };
  m._onEscape = () => { if (confirm("Discard this unsaved scanned food?")) m.querySelector("[data-close]").click(); };
  saveBtn.onclick = async () => {
    sync(false);
    if (saveBtn.disabled) return;
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    const saved = await saveLabelFood({
      name: nameInput.value,
      serving: servingInput.value,
      net_carbs: netInput.value,
      category: catInput.value,
      favorite: m.querySelector("#lf-fav").checked,
      calories: state.calReady ? calorieInput.value : undefined,
    }, draft);
    if (!saved) {
      saveBtn.textContent = "Try again";
      sync(false);
      toast("Couldn’t save the food — check your connection");
    }
  };

  openModal(m);
  sync(false);
  setTimeout(() => nameInput.focus(), 50);
}

function openTimeEditor(entry) {
  if (String(entry.id).startsWith("tmp")) return; // not yet saved
  const d = entry.created_at ? new Date(entry.created_at) : new Date();
  const localMatch = /^(\d{2}):(\d{2})/.exec(entry.logged_local_time || "");
  const hh = localMatch ? localMatch[1] : String(d.getHours()).padStart(2, "0");
  const mm = localMatch ? localMatch[2] : String(d.getMinutes()).padStart(2, "0");
  const m = el(`<div class="modal">
    <h2>Edit time</h2>
    <p class="muted" style="margin-top:-6px">${esc(entry.name)} · ${fmtDateLabel(entry.log_date)}</p>
    <div class="field"><label>Time logged</label>
      <input type="time" id="te-time" value="${hh}:${mm}" /></div>
    <div class="modal-actions">
      <button class="btn-ghost" data-close>Cancel</button>
      <button class="btn-green" id="te-save">Save</button>
    </div>
  </div>`);
  m.querySelector("[data-close]").onclick = closeModal;
  m.querySelector("#te-save").onclick = () => {
    const v = $("#te-time").value;
    if (!v) return closeModal();
    const [H, M] = v.split(":").map(Number);
    const [y, mo, da] = entry.log_date.split("-").map(Number);
    if (entry.logged_timezone) {
      const offsetMatch = /([+-]\d{2}:\d{2})\)?$/.exec(entry.logged_timezone);
      const withOffset = `${entry.log_date}T${v}:00${offsetMatch ? offsetMatch[1] : "Z"}`;
      setEntryTime(entry, new Date(withOffset).toISOString(), `${v}:00`);
    } else {
      setEntryTime(entry, new Date(y, mo - 1, da, H, M, 0, 0).toISOString());
    }
  };
  openModal(m);
}

function openCarbEditor(entry) {
  if (String(entry.id).startsWith("tmp")) return; // not yet saved
  const m = el(`<div class="modal">
    <h2>Adjust carbs</h2>
    <p class="muted" style="margin-top:-6px">${esc(entry.name)}${entry.qty !== 1 ? ` · ${fmt(entry.qty)}× servings` : ""}</p>
    <div class="field">
      <label>Net carbs per serving (g)</label>
      <div class="stepper-row">
        <button type="button" class="step-btn" id="ce-minus" aria-label="minus 1">−</button>
        <input type="number" id="ce-carbs" inputmode="decimal" step="0.25" value="${entry.net_carbs}" />
        <button type="button" class="step-btn" id="ce-plus" aria-label="plus 1">+</button>
      </div>
      <p class="muted" id="ce-total" style="font-size:13px; margin-top:9px"></p>
    </div>
    <div class="modal-actions">
      <button class="btn-ghost" data-close>Cancel</button>
      <button class="btn-green" id="ce-save">Save</button>
    </div>
  </div>`);
  const input = m.querySelector("#ce-carbs");
  const totalLine = m.querySelector("#ce-total");
  const updTotal = () => { totalLine.textContent = `Total for this entry: ${fmt((Number(input.value) || 0) * entry.qty)} g`; };
  m.querySelector("#ce-minus").onclick = () => { input.value = Math.max(0, (Number(input.value) || 0) - 1); updTotal(); };
  m.querySelector("#ce-plus").onclick = () => { input.value = (Number(input.value) || 0) + 1; updTotal(); };
  input.addEventListener("input", updTotal);
  m.querySelector("[data-close]").onclick = closeModal;
  m.querySelector("#ce-save").onclick = () => { closeModal(); setEntryCarbs(entry, Math.max(0, Number(input.value) || 0)); };
  updTotal();
  openModal(m);
}

function openCalEditor(entry) {
  if (String(entry.id).startsWith("tmp")) return;
  const known = entry.calories != null;
  const m = el(`<div class="modal">
    <h2>Calories</h2>
    <p class="muted" style="margin-top:-6px">${esc(entry.name)}${entry.qty !== 1 ? ` · ${fmt(entry.qty)}× servings` : ""}</p>
    <div class="field">
      <label>Calories per serving <span class="muted" style="font-weight:400">— blank = unknown</span></label>
      <input type="number" id="cal-val" inputmode="numeric" step="5" placeholder="Unknown" value="${known ? entry.calories : ""}" />
      <p class="muted" id="cal-total" style="font-size:13px; margin-top:9px"></p>
    </div>
    <div class="modal-actions">
      ${known ? '<button class="btn-danger" id="cal-clear">Unknown</button>' : ""}
      <button class="btn-ghost" data-close>Cancel</button>
      <button class="btn-green" id="cal-save">Save</button>
    </div>
  </div>`);
  const input = m.querySelector("#cal-val");
  const totalLine = m.querySelector("#cal-total");
  const upd = () => {
    const v = input.value.trim();
    totalLine.textContent = v === "" ? "Will be marked “unknown”." : `Total for this entry: ${fmtCal((Number(v) || 0) * entry.qty)} cal`;
  };
  input.addEventListener("input", upd);
  m.querySelector("[data-close]").onclick = closeModal;
  if (known) m.querySelector("#cal-clear").onclick = () => { closeModal(); setEntryCal(entry, null); };
  m.querySelector("#cal-save").onclick = () => {
    const v = input.value.trim();
    closeModal(); setEntryCal(entry, v === "" ? null : Math.max(0, Number(v) || 0));
  };
  upd();
  openModal(m);
}

function openOneOff() {
  const m = el(`<div class="modal">
    <h2>One-off item</h2>
    <p class="muted" style="margin-top:-6px">Logs for ${state.date === todayStr() ? "today" : fmtDateLabel(state.date)} only — not saved to My Foods.</p>
    <div class="field"><label>Name</label>
      <input type="text" id="oo-name" placeholder="e.g. Restaurant salad" /></div>
    <div class="field-row">
      <div class="field"><label>Net carbs (g)</label>
        <input type="number" id="oo-carbs" inputmode="decimal" step="0.05" placeholder="0" /></div>
      <div class="field"><label>Servings</label>
        <input type="number" id="oo-qty" inputmode="decimal" step="0.25" value="1" /></div>
    </div>
    ${state.trackCalories ? `<div class="field"><label>Calories <span class="muted" style="font-weight:400">— blank = unknown</span></label>
      <input type="number" id="oo-cal" inputmode="numeric" step="5" placeholder="Unknown" /></div>` : ""}
    <div class="modal-actions">
      <button class="btn-ghost" data-close>Cancel</button>
      <button class="btn-green" id="oo-log">Log it</button>
    </div>
  </div>`);
  m.querySelector("[data-close]").onclick = closeModal;
  m.querySelector("#oo-log").onclick = () => {
    const name = $("#oo-name").value.trim();
    if (!name) return toast("Give it a name");
    const nc = Number($("#oo-carbs").value) || 0;
    const qty = Number($("#oo-qty").value) || 1;
    const calRaw = state.trackCalories ? $("#oo-cal").value.trim() : "";
    const calories = calRaw === "" ? null : Math.max(0, Number(calRaw) || 0);
    closeModal();
    logFood({ id: null, name, net_carbs: nc, calories }, qty); // food_id stays null → not in My Foods
    toast(`Logged ${name}`);
  };
  openModal(m);
  setTimeout(() => $("#oo-name").focus(), 50);
}

/* tap-confirmation feedback */
function confirmPulse(btn, grams) {
  if (!btn) return;
  if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) {} }
  btn.classList.remove("flash"); void btn.offsetWidth; btn.classList.add("flash");
  const badge = document.createElement("span");
  badge.className = "float-badge";
  badge.textContent = "✓ +" + fmt(grams) + "g";
  btn.appendChild(badge);
  setTimeout(() => badge.remove(), 760);
}
function pulseFood(foodId, grams) {
  confirmPulse(document.querySelector(`.food-btn[data-food="${foodId}"]`), grams);
}

function openCategoryReorder() {
  let ord = categoriesInUse();
  const m = el(`<div class="modal">
    <h2>Reorder categories</h2>
    <p class="muted" style="margin-top:-6px">★ Favorites always stay on top. Drag order with the arrows.</p>
    <div id="reorderBody"></div>
    <div class="modal-actions">
      <button class="btn-ghost" data-close>Cancel</button>
      <button class="btn-green" id="ro-save">Save order</button>
    </div>
  </div>`);
  const body = m.querySelector("#reorderBody");
  const draw = () => {
    body.innerHTML = ord.length ? ord.map((c, i) => `
      <div class="reorder-row">
        <span class="rr-name">${esc(c)}</span>
        <span class="rr-btns">
          <button data-up="${i}" ${i === 0 ? "disabled" : ""} aria-label="move up">↑</button>
          <button data-down="${i}" ${i === ord.length - 1 ? "disabled" : ""} aria-label="move down">↓</button>
        </span>
      </div>`).join("") : `<p class="empty-note">No categories yet.</p>`;
  };
  body.addEventListener("click", (e) => {
    const up = e.target.closest("[data-up]"), down = e.target.closest("[data-down]");
    if (up) { const i = +up.dataset.up; [ord[i - 1], ord[i]] = [ord[i], ord[i - 1]]; draw(); }
    else if (down) { const i = +down.dataset.down; [ord[i + 1], ord[i]] = [ord[i], ord[i + 1]]; draw(); }
  });
  draw();
  m.querySelector("[data-close]").onclick = closeModal;
  m.querySelector("#ro-save").onclick = () => { setCategoryOrder(ord); closeModal(); };
  openModal(m);
}

function openFoodEditor(existing, returnTo) {
  const f = existing || { name: "", serving: "", net_carbs: "", category: "", favorite: false };
  const cats = categoryChoices();
  const m = el(`<div class="modal">
    <h2>${existing ? "Edit food" : "Add a food"}</h2>
    <div class="field"><label>Name</label>
      <input type="text" id="f-name" value="${esc(f.name)}" placeholder="e.g. Greek yogurt" /></div>
    <div class="field-row">
      <div class="field"><label>Serving size</label>
        <input type="text" id="f-serving" value="${esc(f.serving)}" placeholder="1 cup, 100 g…" /></div>
      <div class="field"><label>Net carbs (g)</label>
        <input type="number" id="f-carbs" inputmode="decimal" step="0.05" value="${f.net_carbs}" placeholder="0" /></div>
    </div>
    ${state.trackCalories ? `<div class="field"><label>Calories per serving <span class="muted" style="font-weight:400">— blank = unknown</span></label>
      <input type="number" id="f-cal" inputmode="numeric" step="5" placeholder="Unknown" value="${f.calories == null ? "" : f.calories}" /></div>` : ""}
    <details class="helper">
      <summary>Calculate from total carbs − fiber</summary>
      <div class="field-row">
        <div class="field"><label>Total carbs</label><input type="number" id="h-carbs" inputmode="decimal" step="0.1" /></div>
        <div class="field"><label>Fiber</label><input type="number" id="h-fiber" inputmode="decimal" step="0.1" /></div>
        <div class="field"><label>Sugar alcohols</label><input type="number" id="h-sa" inputmode="decimal" step="0.1" /></div>
      </div>
      <button class="btn-ghost" id="h-apply" style="width:100%;padding:10px;border-radius:11px">Use this</button>
    </details>
    <div class="field">
      <label>Category (optional)</label>
      <input type="text" id="f-cat" value="${esc(f.category)}" placeholder="Type a new one, or pick below" />
      ${cats.length ? `<div class="cat-chips">${cats.map((c) => `<button type="button" class="cat-chip" data-cat="${esc(c)}">${esc(c)}</button>`).join("")}</div>` : ""}
    </div>
    <div class="field">
      <label class="check"><input type="checkbox" id="f-fav" ${(existing && isFav(existing)) ? "checked" : ""} /> Favorite (pin to top)</label>
    </div>
    <div class="modal-actions">
      ${existing ? '<button class="btn-danger" id="f-del">Delete</button>' : ""}
      <button class="btn-ghost" data-close>Cancel</button>
      <button class="btn-green" id="f-save">Save</button>
    </div>
  </div>`);

  m.querySelector("#h-apply").onclick = () => {
    const c = Number($("#h-carbs").value) || 0, fi = Number($("#h-fiber").value) || 0, sa = Number($("#h-sa").value) || 0;
    $("#f-carbs").value = Math.max(0, Math.round((c - fi - sa) * 100) / 100);
  };
  m.querySelector("[data-close]").onclick = () => {
    closeModal();
    if (returnTo && returnTo.onCancel) returnTo.onCancel();
  };
  if (returnTo && returnTo.onCancel) {
    m._onBackdrop = () => { closeModal(); returnTo.onCancel(); };
  }
  m.querySelector("#f-save").onclick = () => saveFood({
    name: $("#f-name").value, serving: $("#f-serving").value, net_carbs: $("#f-carbs").value,
    category: $("#f-cat").value, favorite: $("#f-fav").checked,
    calories: state.trackCalories ? $("#f-cal").value : undefined,
  }, existing, returnTo && returnTo.onSaved);
  if (existing) m.querySelector("#f-del").onclick = () => {
    if (confirm(`Delete “${existing.name}” from your foods? (Past logs are kept.)`)) deleteFood(existing);
  };

  // category chips (work on mobile, unlike <datalist>): tap to set, tap again to clear
  const catInput = m.querySelector("#f-cat");
  const chips = [...m.querySelectorAll(".cat-chip")];
  const syncChips = () => chips.forEach((ch) =>
    ch.classList.toggle("active", ch.dataset.cat.toLowerCase() === catInput.value.trim().toLowerCase()));
  chips.forEach((ch) => ch.onclick = () => {
    catInput.value = ch.dataset.cat.toLowerCase() === catInput.value.trim().toLowerCase() ? "" : ch.dataset.cat;
    syncChips();
  });
  catInput.addEventListener("input", syncChips);
  syncChips();

  openModal(m);
  setTimeout(() => $("#f-name").focus(), 50);
}

function openSettings() {
  const m = el(`<div class="modal">
    <h2>Settings</h2>
    <div class="field"><label>Daily net-carb target (g)</label>
      <input type="number" id="s-target" inputmode="decimal" step="1" value="${fmt(state.target)}" /></div>

    ${state.calReady ? `
    <div class="settings-section">
      <h3>Calories</h3>
      <label class="check" style="margin-bottom:10px"><input type="checkbox" id="s-trackcal" ${state.trackCalories ? "checked" : ""} /> Track calories</label>
      <div class="field" id="s-calgoal-wrap" ${state.trackCalories ? "" : 'style="display:none"'}>
        <label>Daily calorie goal</label>
        <input type="number" id="s-calgoal" inputmode="numeric" step="10" value="${fmtCal(state.calorieTarget)}" />
      </div>
    </div>` : ""}

    <div class="settings-section">
      <h3>Layout</h3>
      <label class="check"><input type="checkbox" id="s-usual" ${usualSession().enabled ? "checked" : ""} /> Try Usual foods</label>
      <p class="field-help">For ${esc(window.NCC_CONFIG.DISPLAY_NAME || state.person)} on this device. Turn off to restore the original Favorites layout.</p>
      <div class="stack-btns">
        <button class="wide-btn" id="s-reorder">↕&#xFE0E; Reorder categories</button>
      </div>
    </div>

    <div class="settings-section">
      <h3>Log later</h3>
      <div class="stack-btns">
        <button class="wide-btn" id="s-pending-key">${pendingManageKey() ? "✓ Change app management key" : "Connect pending reminders"}</button>
      </div>
      <p class="field-help">Siri uses a separate capture-only key.</p>
    </div>

    <div class="settings-section">
      <h3>Export</h3>
      <div class="stack-btns">
        <button class="wide-btn" id="s-exp-foods">⬇&#xFE0E; Export my foods (CSV)</button>
        <button class="wide-btn" id="s-exp-log">⬇&#xFE0E; Export full log history (CSV)</button>
      </div>
    </div>

    <p class="muted" style="font-size:13px; margin-top:16px">${esc((window.NCC_CONFIG.SUPABASE_URL || "").replace("https://", ""))} · ${state.foods.length} foods</p>
    <div class="modal-actions">
      <button class="btn-ghost" data-close>Close</button>
      <button class="btn-green" id="s-save">Save target</button>
    </div>
  </div>`);
  m.querySelector("[data-close]").onclick = closeModal;
  m.querySelector("#s-usual").onchange = (e) => setUsualPreference({ enabled: e.target.checked });
  m.querySelector("#s-save").onclick = () => {
    setTarget($("#s-target").value);
    if (state.calReady) setCalorieSettings($("#s-trackcal").checked, Number($("#s-calgoal").value) || state.calorieTarget);
    closeModal();
  };
  m.querySelector("#s-reorder").onclick = () => { closeModal(); openCategoryReorder(); };
  m.querySelector("#s-pending-key").onclick = () => { closeModal(); openPendingAccessSetup(); };
  m.querySelector("#s-exp-foods").onclick = exportFoods;
  m.querySelector("#s-exp-log").onclick = exportLog;
  m.querySelector("#s-trackcal")?.addEventListener("change", (e) => {
    m.querySelector("#s-calgoal-wrap").style.display = e.target.checked ? "" : "none";
  });
  openModal(m);
}

async function setCalorieSettings(track, goal) {
  state.trackCalories = track;
  state.calorieTarget = goal;
  renderAll();
  const { error } = await db.from("settings").update({ track_calories: track, calorie_target: goal }).eq("person", state.person);
  if (error) toast("Couldn’t save calorie settings");
}

/* ============================================================
   UI wiring
   ============================================================ */
function handleKeyboardShortcuts(event) {
  if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target;
  const typing = target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
  if (modalOpen) {
    if (event.key === "Escape") { event.preventDefault(); escapeModal(); }
    return;
  }

  if (target === $("#foodSearch")) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (state.search) clearLogSearch({ focus: true });
      else target.blur();
    } else if (state.search.trim() && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault(); moveSearchSelection(event.key === "ArrowDown" ? 1 : -1);
    } else if (state.search.trim() && event.key === "Enter") {
      event.preventDefault();
      const food = selectedSearchFood();
      if (!food) return;
      if (event.shiftKey) openPortionSheet(food, () => clearLogSearch({ focus: true }));
      else logSelectedFood(food);
    }
    return;
  }

  if (target === $("#foodEditorSearch") && event.key === "Escape") {
    event.preventDefault();
    if (state.editorSearch) { target.value = ""; target.dispatchEvent(new Event("input")); }
    else target.blur();
    return;
  }
  if (typing) return;

  const foodButton = target.closest?.(".food-btn");
  if (foodButton && event.key === "Enter" && event.shiftKey) {
    const food = state.foods.find((item) => item.id === foodButton.dataset.food);
    if (food) { event.preventDefault(); openPortionSheet(food); }
    return;
  }

  const key = event.key.toLowerCase();
  if (key === "/") {
    event.preventDefault(); activateTab("log"); $("#foodSearch").focus();
  } else if (key === "?") {
    event.preventDefault(); openKeyboardHelp();
  } else if (key === "[" || key === "]") {
    event.preventDefault(); shiftDay(key === "[" ? -1 : 1);
  } else if (key === "t") {
    event.preventDefault();
    if (state.date !== todayStr()) { state.date = todayStr(); reloadDay(); }
  } else if (key === "l" || key === "f" || key === "m") {
    event.preventDefault(); activateTab({ l: "log", f: "foods", m: "meals" }[key]);
  } else if (key === "o" || key === "n" || key === "p") {
    event.preventDefault();
    if (key === "o") openOneOff();
    else if (key === "n") openFoodEditor(null);
    else openPendingList();
  }
}

function wireUI() {
  document.addEventListener("keydown", handleKeyboardShortcuts);
  // A Shortcut can open a new voice draft while the installed PWA is already running.
  window.addEventListener("hashchange", handleVoiceLaunch);
  window.addEventListener("hashchange", handleLabelLaunch);

  // tabs
  $$(".tab").forEach((t) => t.onclick = () => activateTab(t.dataset.tab));

  // tap the daily total → jump into the Summary view
  const jumpToSummary = () => {
    activateTab("log");
    state.logView = "summary"; localStorage.setItem("ncc_logView", "summary");
    renderEntries();
    $(".log-head").scrollIntoView({ behavior: "smooth", block: "start" });
  };
  $("#progressWrap").addEventListener("click", jumpToSummary);
  $("#progressWrap").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); jumpToSummary(); }
  });

  // date nav
  $("#prevDay").onclick = () => shiftDay(-1);
  $("#nextDay").onclick = () => shiftDay(1);
  $("#dateLabel").onclick = () => { if (state.date !== todayStr()) { state.date = todayStr(); reloadDay(); } };
  $("#dayIncompleteBtn").onclick = toggleDayIncomplete;

  // settings
  $("#gearBtn").onclick = openSettings;

  // Search with an explicit, touch-sized clear button on both tabs.
  for (const [inputId, clearId, key, render] of [
    ["#foodSearch", "#clearFoodSearch", "search", renderFoodGrid],
    ["#foodEditorSearch", "#clearFoodEditorSearch", "editorSearch", renderEditor],
  ]) {
    const input = $(inputId), clear = $(clearId);
    const update = () => {
      state[key] = input.value;
      clear.classList.toggle("hidden", !input.value);
      render();
    };
    input.addEventListener("input", update);
    if (inputId === "#foodSearch") input.addEventListener("search", update);
    clear.onclick = () => {
      input.value = "";
      update();
      input.focus({ preventScroll: true });
    };
  }

  // add food
  $("#addFoodBtn").onclick = () => openFoodEditor(null);
  $("#addMealBtn").onclick = () => openMealDialog(null);
  $("#manageMealsBtn").onclick = () => activateTab("meals");
  const onMealClick = (event) => {
    const edit = event.target.closest("[data-meal-edit]");
    const log = event.target.closest("[data-meal-log]");
    const id = edit?.dataset.mealEdit || log?.dataset.mealLog;
    const meal = state.meals.find((item) => item.id === id);
    if (!meal) return;
    if (edit) openMealDialog(meal);
    else if (!log.disabled) openMealDialog(meal, "log");
  };
  $("#mealQuickList").addEventListener("click", onMealClick);
  $("#mealEditorList").addEventListener("click", onMealClick);
  $("#foodAlphabet").addEventListener("click", (event) => {
    const button = event.target.closest("[data-letter]");
    if (!button || button.disabled) return;
    const heading = document.getElementById(button.getAttribute("aria-controls"));
    if (!heading) return;
    // Dismiss the phone keyboard before jumping through filtered results.
    $("#foodEditorSearch").blur();
    heading.scrollIntoView({ block: "start", behavior: "instant" });
    heading.focus({ preventScroll: true });
  });

  // food grid: tap = log 1, long-press = portion sheet
  wireFoodGridGestures();

  // category tiles: tap to open (auto-closes the previously open one)
  $("#foodGrid").addEventListener("click", (e) => {
    // Pointer logging happens on pointerup; native keyboard/assistive clicks have detail 0.
    const keyboardFood = e.target.closest(".food-btn");
    if (keyboardFood && e.detail === 0) {
      const food = state.foods.find((item) => item.id === keyboardFood.dataset.food);
      if (food) {
        confirmPulse(keyboardFood, Number(food.net_carbs));
        logFood(food, 1);
        if (state.search.trim()) clearLogSearch({ focus: true });
      }
      return;
    }
    const mode = e.target.closest("[data-usual-mode]");
    if (mode) {
      setUsualPreference({ mode: mode.dataset.usualMode });
      $(`.usual-modes [data-usual-mode="${mode.dataset.usualMode}"]`)?.focus();
      return;
    }
    const cb = e.target.closest(".cat-tile");
    if (cb) toggleCat(cb.dataset.cat);
  });

  // one-off (log a manual item without saving it to My Foods)
  $("#oneOffBtn").onclick = openOneOff;
  $("#logLaterBtn").onclick = openLogLaterCapture;
  $("#pendingAllBtn").onclick = (event) => { event.stopPropagation(); openPendingList(); };
  $("#pendingAllBtn").onkeydown = (event) => event.stopPropagation();

  // food view toggle: Categories (accordion) vs A–Z (flat alphabetical)
  $("#foodViewSeg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-fview]"); if (!b) return;
    state.foodView = b.dataset.fview;
    localStorage.setItem("ncc_foodView", state.foodView);
    renderFoodGrid();
  });

  // floating jump-to-log button
  setupJump();

  // log view toggles (Time / Summary, and Summary grouping)
  $("#logViewSeg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-view]"); if (!b) return;
    state.logView = b.dataset.view; localStorage.setItem("ncc_logView", state.logView);
    renderEntries();
  });
  $("#summaryGroupSeg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-group]"); if (!b) return;
    state.summaryGroup = b.dataset.group; localStorage.setItem("ncc_summaryGroup", state.summaryGroup);
    renderEntries();
  });

  // entries list (event delegation)
  $("#entriesList").addEventListener("click", (e) => {
    const pendingRow = e.target.closest("[data-pending]");
    if (pendingRow) {
      const item = state.pendingItems.find((candidate) => candidate.id === pendingRow.dataset.pending);
      if (item) openPendingDetail(item);
      return;
    }
    const row = e.target.closest(".entry"); if (!row) return;
    const entry = state.entries.find((x) => String(x.id) === row.dataset.entry); if (!entry) return;
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "inc") setQty(entry, entry.qty < 1 ? entry.qty + 0.5 : entry.qty + 1);
    else if (act === "dec") setQty(entry, entry.qty > 1 ? entry.qty - 1 : entry.qty - 0.5);
    else if (act === "del") removeEntry(entry);
    else if (act === "time") openTimeEditor(entry);
    else if (act === "carbs") openCarbEditor(entry);
    else if (act === "cal") openCalEditor(entry);
  });

  // editor list
  $("#foodEditorList").addEventListener("click", (e) => {
    const row = e.target.closest(".editor-row"); if (!row) return;
    const food = state.foods.find((f) => f.id === row.dataset.edit);
    if (food) openFoodEditor(food);
  });
}

function wireFoodGridGestures() {
  const grid = $("#foodGrid");
  let timer = null, longFired = false, startY = 0;
  const findFood = (t) => { const b = t.closest(".food-btn"); return b ? state.foods.find((f) => f.id === b.dataset.food) : null; };

  grid.addEventListener("pointerdown", (e) => {
    const food = findFood(e.target); if (!food) return;
    longFired = false; startY = e.clientY;
    timer = setTimeout(() => { longFired = true; if (navigator.vibrate) navigator.vibrate(8); openPortionSheet(food); }, 420);
  });
  const cancel = () => { clearTimeout(timer); timer = null; };
  grid.addEventListener("pointermove", (e) => { if (timer && Math.abs(e.clientY - startY) > 8) cancel(); });
  grid.addEventListener("pointerup", (e) => {
    if (!timer && longFired) { longFired = false; return; }
    cancel();
    const food = findFood(e.target); if (!food || longFired) return;
    const btn = e.target.closest(".food-btn");
    confirmPulse(btn, Number(food.net_carbs));
    logFood(food, 1);
  });
  grid.addEventListener("pointercancel", cancel);
  grid.addEventListener("pointerleave", cancel);
}

function shiftDay(delta) {
  const d = strToDate(state.date); d.setDate(d.getDate() + delta);
  state.date = dateToStr(d); reloadDay();
}
async function reloadDay() {
  renderDate();
  state.entries = [];
  renderEntries(); renderProgress();
  try { await Promise.all([loadEntries(), loadDayStatus()]); } catch (e) { return toast("Couldn’t load that day"); }
  renderEntries(); renderProgress();
}

/* ---------- tab activation ---------- */
function activateTab(name) {
  state.tab = name;
  $$(".tab").forEach((x) => x.classList.toggle("active", x.dataset.tab === name));
  $("#tab-log").classList.toggle("active", name === "log");
  $("#tab-foods").classList.toggle("active", name === "foods");
  $("#tab-meals").classList.toggle("active", name === "meals");
  renderJump();
  renderMiniTally();
}

/* ---------- floating jump-to-log button + mini tally ---------- */
let progVisible = true;
// "at the bottom" = within ~90px of the very end of the page (not just the log peeking in)
function isAtBottom() {
  const doc = document.documentElement;
  return (window.scrollY + window.innerHeight) >= (doc.scrollHeight - 90);
}
function setupJump() {
  const btn = $("#jumpBtn");
  btn.onclick = () => {
    if (state.tab === "foods" || isAtBottom()) {
      window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      if (state.tab === "foods") $('.tab[data-tab="foods"]').focus({ preventScroll: true });
    } else {
      // align the top of the log just below the sticky header (not hidden under it)
      const appbarH = ($("#appbar")?.offsetHeight) || 0;
      const lh = $(".log-head");
      const target = window.scrollY + lh.getBoundingClientRect().top - appbarH - 10;
      window.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
    }
  };
  const onScroll = () => { renderJump(); renderMiniTally(); };
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((ents) => { progVisible = ents[0].isIntersecting; renderMiniTally(); }, { threshold: 0 }).observe($("#progressWrap"));
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
}

function renderMiniTally() {
  const el = $("#miniTally");
  if (!el) return;
  const show = !modalOpen && state.tab === "log" && !progVisible && !usualCardsAtBottom();
  el.classList.toggle("hidden", !show);
  if (!show) return;
  const total = dayTotal();
  const over = total > state.target;
  const pending = dayPending().length;
  const { total: calories, unknown } = dayCalories();
  const calText = unknown === state.entries.length && unknown > 0 ? "? cal" : `${fmtCal(calories)} cal${unknown ? " + ?" : ""}`;
  el.innerHTML = `<span><span class="mt-num ${over ? "over" : ""}">${fmt(total)}</span><span class="mt-of"> g carbs</span></span>
    <span class="mt-of">${calText}</span>${pending || dayIsIncomplete() ? `<span class="mt-status">${[pending ? `⚑ ${pending} pending` : "", dayIsIncomplete() ? "incomplete" : ""].filter(Boolean).join(" · ")}</span>` : ""}`;
  el.title = `${fmt(total)} g net carbs eaten · ${fmtCal(calories)} known calories eaten${unknown ? ` · ${unknown} entries with unknown calories` : ""} · ${fmtDateLabel(state.date)}`;
}
function renderJump() {
  const btn = $("#jumpBtn");
  if (!btn) return;
  const scrollable = document.documentElement.scrollHeight > window.innerHeight + 40;
  const count = state.entries.length + dayPending().length;
  const foodsTop = state.tab === "foods" && window.scrollY > 180;
  const show = !modalOpen && scrollable && (foodsTop || (state.tab === "log" && count > 0 && !usualCardsAtBottom()));
  btn.classList.toggle("hidden", !show);
  if (!show) return;
  const top = foodsTop || isAtBottom();
  btn.innerHTML = top ? "↑ Top" : `↓ Logged <span class="jb-count">${count}</span>`;
  btn.setAttribute("aria-label", top ? "Back to top" : "Jump to log");
}

// Keep the floating pills from covering the experiment's card names or tap targets.
function usualCardsAtBottom() {
  const grid = $(".usual-grid");
  if (!grid) return false;
  const rect = grid.getBoundingClientRect();
  const safeBottom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--safe-bottom")) || 0;
  return rect.top < window.innerHeight && rect.bottom > window.innerHeight - safeBottom - 96;
}

/* ---------- toast / undo ---------- */
let toastTimer = null;
function toast(msg, actionLabel, action) {
  const t = $("#toast"), btn = $("#toastAction");
  $("#toastMsg").textContent = msg;
  if (actionLabel && action) {
    btn.textContent = actionLabel; btn.classList.remove("hidden");
    btn.onclick = () => { hideToast(); action(); };
  } else { btn.classList.add("hidden"); btn.onclick = null; }
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 4000);
}
function hideToast() { $("#toast").classList.add("hidden"); }

/* ---------- service worker ---------- */
function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol === "file:") return; // SW needs http(s)
  navigator.serviceWorker.register("service-worker.js").catch(() => {});
}

document.addEventListener("DOMContentLoaded", boot);
