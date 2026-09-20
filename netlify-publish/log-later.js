/* ============================================================
   Log later — browser-side contract helpers
   Kept framework-free so the validation and date semantics can be tested in Node.
   ============================================================ */
"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NCCLogLater = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const NOTE_LIMIT = 500;
  const TOKEN_KEY_PREFIX = "ncc_log_later_manage_key:";

  function uuid() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    throw new Error("This browser cannot create a safe request ID");
  }

  function validUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || "");
  }

  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  }

  function validateNote(value) {
    const note = String(value == null ? "" : value).trim();
    if (!note) return { error: "empty", note: "" };
    if (note.length > NOTE_LIMIT) return { error: "too_long", note };
    return { note };
  }

  function localTimestampForDate(logDate, now = new Date()) {
    if (!validDate(logDate) || !(now instanceof Date) || Number.isNaN(now.getTime())) {
      throw new Error("Invalid local capture date");
    }
    const [year, month, day] = logDate.split("-").map(Number);
    const local = new Date(year, month - 1, day, now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    return local.toISOString();
  }

  function timezoneDescriptor(date = new Date()) {
    let zone = "";
    try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (error) {}
    const minutes = -date.getTimezoneOffset();
    const sign = minutes >= 0 ? "+" : "-";
    const absolute = Math.abs(minutes);
    const offset = `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
    return zone ? `${zone} (${offset})` : offset;
  }

  function capturePayload(note, logDate, requestId = uuid(), now = new Date()) {
    const checked = validateNote(note);
    if (checked.error) throw new Error(checked.error);
    if (!validUuid(requestId)) throw new Error("invalid_request_id");
    return {
      action: "capture",
      request_id: requestId,
      note: checked.note,
      captured_at: localTimestampForDate(logDate, now),
      log_date: logDate,
      local_time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`,
      timezone: timezoneDescriptor(now),
    };
  }

  function endpoint(supabaseUrl) {
    return String(supabaseUrl || "").replace(/\/$/, "") + "/functions/v1/log-later";
  }

  class ApiError extends Error {
    constructor(message, status, code, details) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.code = code || "request_failed";
      this.details = details;
    }
  }

  async function request(supabaseUrl, token, body, fetchImpl = globalThis.fetch) {
    if (!token || !String(token).trim()) throw new ApiError("Pending access key is required", 401, "missing_credential");
    const response = await fetchImpl(endpoint(supabaseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Log-Later-Token": String(token).trim(),
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    let payload = null;
    try { payload = await response.json(); } catch (error) {}
    if (!response.ok || !payload || payload.ok !== true) {
      throw new ApiError(
        payload && payload.message ? payload.message : "The server did not confirm this request",
        response.status,
        payload && payload.error,
        payload
      );
    }
    return payload;
  }

  function storageKey(person) { return TOKEN_KEY_PREFIX + person; }
  function getManageKey(person, storage = globalThis.localStorage) {
    try { return (storage.getItem(storageKey(person)) || "").trim(); } catch (error) { return ""; }
  }
  function setManageKey(person, value, storage = globalThis.localStorage) {
    const key = String(value || "").trim();
    try {
      if (key) storage.setItem(storageKey(person), key);
      else storage.removeItem(storageKey(person));
    } catch (error) {}
    return key;
  }

  function pendingForDate(items, logDate) {
    return (items || []).filter((item) => item.status === "pending" && item.log_date === logDate);
  }

  function pendingStatus(knownCarbs, dayCount, allCount) {
    return {
      day: dayCount ? `${knownCarbs} g logged · ${dayCount} meal${dayCount === 1 ? "" : "s"} pending` : `${knownCarbs} g logged`,
      all: allCount ? `${allCount} item${allCount === 1 ? "" : "s"} need logging` : "",
      incomplete: dayCount > 0,
    };
  }

  return {
    NOTE_LIMIT,
    ApiError,
    uuid,
    validUuid,
    validDate,
    validateNote,
    localTimestampForDate,
    timezoneDescriptor,
    capturePayload,
    endpoint,
    request,
    getManageKey,
    setManageKey,
    pendingForDate,
    pendingStatus,
  };
});
