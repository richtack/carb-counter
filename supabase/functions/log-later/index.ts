import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const NOTE_LIMIT = 500;
const MAX_BODY_BYTES = 16_384;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const allowedOrigins = new Set(
  (Deno.env.get("LOG_LATER_ALLOWED_ORIGINS") || "")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean),
);

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin") || "";
  return origin && allowedOrigins.has(origin.replace(/\/$/, ""))
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "content-type, x-log-later-token",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Vary": "Origin",
      }
    : {};
}

function json(req: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders(req) },
  });
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && ISO_RE.test(value) && !Number.isNaN(Date.parse(value));
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function authenticate(req: Request, action: string) {
  const token = (req.headers.get("x-log-later-token") || "").trim();
  if (token.length < 32 || token.length > 200) return null;
  const tokenHash = await sha256(token);
  const { data, error } = await admin
    .from("log_later_credentials")
    .select("id, owner, scope, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error || !data || data.revoked_at) return null;
  const needsManage = action !== "capture";
  if (needsManage && data.scope !== "manage") return null;
  if (!needsManage && data.scope !== "capture" && data.scope !== "manage") return null;
  await admin.from("log_later_credentials").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return data as { id: string; owner: string; scope: "capture" | "manage" };
}

function databaseError(req: Request, error: { message?: string } | null) {
  const code = error?.message || "database_error";
  const known: Record<string, [number, string]> = {
    invalid_capture: [400, "The capture details are invalid."],
    invalid_note: [400, "Enter a note between 1 and 500 characters."],
    invalid_resolution: [400, "The replacement meal is invalid."],
    invalid_resolution_item: [400, "Choose valid foods and portions."],
    food_not_found: [409, "A selected saved food no longer exists."],
    request_id_conflict: [409, "That request ID was already used for different capture details."],
    pending_conflict: [409, "This pending note changed on another device. Refresh and try again."],
    not_found: [404, "That pending note was not found."],
    rate_limited: [429, "Too many captures were received. Wait 15 minutes and try again."],
  };
  const match = Object.entries(known).find(([key]) => code.includes(key));
  return match
    ? json(req, match[1][0], { ok: false, error: match[0], message: match[1][1] })
    : json(req, 500, { ok: false, error: "database_error", message: "The server could not complete the request." });
}

Deno.serve(async (req) => {
  const origin = (req.headers.get("origin") || "").replace(/\/$/, "");
  if (origin && !allowedOrigins.has(origin)) {
    return json(req, 403, { ok: false, error: "origin_not_allowed", message: "This website is not allowed to use Log later." });
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { ok: false, error: "method_not_allowed", message: "Use POST." });
  const declaredLength = Number(req.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) return json(req, 413, { ok: false, error: "payload_too_large", message: "The request is too large." });

  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) throw new Error("too_large");
    body = JSON.parse(raw);
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "too_large";
    return json(req, tooLarge ? 413 : 400, {
      ok: false,
      error: tooLarge ? "payload_too_large" : "invalid_json",
      message: tooLarge ? "The request is too large." : "Send a valid JSON object.",
    });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json(req, 400, { ok: false, error: "invalid_json", message: "Send a valid JSON object." });
  }

  const action = typeof body.action === "string" ? body.action : "";
  if (!new Set(["capture", "list", "edit", "discard", "resolve"]).has(action)) {
    return json(req, 400, { ok: false, error: "invalid_action", message: "The requested action is not supported." });
  }
  const credential = await authenticate(req, action);
  if (!credential) return json(req, 401, { ok: false, error: "invalid_credential", message: "The Log later access key is invalid or revoked." });

  if (action === "capture") {
    const note = typeof body.note === "string" ? body.note.trim() : "";
    const timezone = typeof body.timezone === "string" ? body.timezone.trim() : "";
    if (!UUID_RE.test(String(body.request_id || "")) || !note || note.length > NOTE_LIMIT ||
        !validTimestamp(body.captured_at) || !validDate(body.log_date) || !TIME_RE.test(String(body.local_time || "")) ||
        !timezone || timezone.length > 100) {
      return json(req, 400, { ok: false, error: "invalid_capture", message: "Check the note, request ID, date, time, and timezone." });
    }
    const { data, error } = await admin.rpc("capture_pending_food", {
      p_owner: credential.owner,
      p_credential_id: credential.id,
      p_request_id: body.request_id,
      p_note: note,
      p_captured_at: body.captured_at,
      p_log_date: body.log_date,
      p_local_time: body.local_time,
      p_timezone: timezone,
    });
    if (error) return databaseError(req, error);
    const saved = Array.isArray(data) ? data[0] : data;
    return json(req, 200, { ok: true, id: saved.id, request_id: saved.request_id, item: saved });
  }

  if (action === "list") {
    const { data, error } = await admin
      .from("pending_food_items")
      .select("id, request_id, note, captured_at, log_date, local_time, timezone, status, version, updated_at")
      .eq("owner", credential.owner)
      .eq("status", "pending")
      .order("log_date", { ascending: true })
      .order("captured_at", { ascending: true });
    if (error) return databaseError(req, error);
    return json(req, 200, { ok: true, items: data || [] });
  }

  if (!UUID_RE.test(String(body.id || "")) || !Number.isInteger(body.version) || Number(body.version) < 1) {
    return json(req, 400, { ok: false, error: "invalid_pending_item", message: "The pending note identity is invalid." });
  }

  if (action === "edit") {
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (!note || note.length > NOTE_LIMIT) return json(req, 400, { ok: false, error: "invalid_note", message: "Enter a note between 1 and 500 characters." });
    const { data, error } = await admin.rpc("edit_pending_food", {
      p_owner: credential.owner, p_item_id: body.id, p_version: body.version, p_note: note,
    });
    if (error) return databaseError(req, error);
    return json(req, 200, { ok: true, item: Array.isArray(data) ? data[0] : data });
  }

  if (action === "discard") {
    const { data, error } = await admin.rpc("discard_pending_food", {
      p_owner: credential.owner, p_item_id: body.id, p_version: body.version,
    });
    if (error) return databaseError(req, error);
    return json(req, 200, { ok: true, item: Array.isArray(data) ? data[0] : data });
  }

  const items = Array.isArray(body.items) ? body.items : [];
  const itemsValid = items.length >= 1 && items.length <= 50 && items.every((item) =>
    item && typeof item === "object" && UUID_RE.test(String((item as Record<string, unknown>).food_id || "")) &&
    Number.isFinite(Number((item as Record<string, unknown>).qty)) &&
    Number((item as Record<string, unknown>).qty) > 0 && Number((item as Record<string, unknown>).qty) <= 100
  );
  if (!UUID_RE.test(String(body.resolution_request_id || "")) || !validDate(body.log_date) ||
      !validTimestamp(body.created_at) || !TIME_RE.test(String(body.local_time || "")) ||
      typeof body.timezone !== "string" || !body.timezone || body.timezone.length > 100 || !itemsValid) {
    return json(req, 400, { ok: false, error: "invalid_resolution", message: "Choose at least one saved food, valid portions, and a valid date and time." });
  }
  const { data, error } = await admin.rpc("resolve_pending_food", {
    p_owner: credential.owner,
    p_item_id: body.id,
    p_version: body.version,
    p_resolution_request_id: body.resolution_request_id,
    p_log_date: body.log_date,
    p_created_at: body.created_at,
    p_local_time: body.local_time,
    p_timezone: body.timezone,
    p_items: items,
  });
  if (error) return databaseError(req, error);
  const result = Array.isArray(data) ? data[0] : data;
  return json(req, 200, { ok: true, ...result });
});
