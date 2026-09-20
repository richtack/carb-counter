/* ============================================================
   Nutrition-label parsing helpers

   This file deliberately contains no database or DOM code. OCR text is
   untrusted and often loses layout, so the parser only prefills values when a
   single US Nutrition Facts column can be associated unambiguously.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.NCCLabel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAX_SOURCE_LENGTH = 8000;
  const MAX_ENCODED_LENGTH = 60000;
  const DRAFT_PATTERN = /^[a-z0-9._:-]{1,100}$/i;
  const NUTRIENT_START = /\b(?:total\s+fat|saturated\s+fat|trans\s+fat|cholesterol|sodium|total\s+carbohydrate|dietary\s+fiber|total\s+sugars?|includes?\b|added\s+sugars?|sugar\s+alcohols?|protein|vitamin\s+d|calcium|iron|potassium)\b/i;

  function decodeFormComponent(value) {
    try {
      return { value: decodeURIComponent(String(value).replace(/\+/g, " ")), error: null };
    } catch (error) {
      return { value: "", error: "malformed" };
    }
  }

  function parseLaunchHash(hash) {
    const source = String(hash || "").replace(/^#/, "");
    if (!/(?:^|&)label=/.test(source)) return null;
    if (source.length > MAX_ENCODED_LENGTH) return { error: "too_long" };

    const pieces = source.split("&");
    const labelParts = pieces.filter((part) => part.startsWith("label="));
    const draftParts = pieces.filter((part) => part.startsWith("draft="));
    if (labelParts.length !== 1 || draftParts.length !== 1) return { error: "malformed" };

    const decodedLabel = decodeFormComponent(labelParts[0].slice(6));
    const decodedDraft = decodeFormComponent(draftParts[0].slice(6));
    if (decodedLabel.error || decodedDraft.error) return { error: "malformed" };

    const text = decodedLabel.value.trim();
    const draftId = decodedDraft.value.trim();
    if (!text) return { error: "empty" };
    if (text.length > MAX_SOURCE_LENGTH) return { error: "too_long" };
    if (!DRAFT_PATTERN.test(draftId)) return { error: "invalid_draft" };
    return { text, draftId, error: null };
  }

  function cleanLine(value) {
    return String(value || "")
      .normalize("NFKC")
      .replace(/[\u00a0\u2007\u202f]/g, " ")
      .replace(/[‐‑‒–—]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  }

  function linesFrom(source) {
    return String(source || "")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map(cleanLine)
      .filter(Boolean);
  }

  function emptyField() {
    return { value: null, raw: "", status: "missing" };
  }

  function finishCandidates(candidates) {
    if (!candidates.length) return emptyField();
    if (candidates.some((item) => item.status === "less_than")) {
      const first = candidates.find((item) => item.status === "less_than");
      return { value: null, raw: first.raw, status: "less_than" };
    }
    const values = [...new Set(candidates.map((item) => item.value))];
    if (values.length !== 1 || candidates.some((item) => item.status === "ambiguous")) {
      return { value: null, raw: candidates.map((item) => item.raw).filter(Boolean).join(" · "), status: "ambiguous" };
    }
    return { value: values[0], raw: candidates[0].raw, status: "found" };
  }

  function segmentAfterLabel(lines, index, match) {
    let tail = lines[index].slice(match.index + match[0].length).trim();
    const nextNutrient = tail.search(NUTRIENT_START);
    if (nextNutrient >= 0) tail = tail.slice(0, nextNutrient).trim();
    if (!tail && lines[index + 1] && !NUTRIENT_START.test(lines[index + 1])) {
      tail = lines[index + 1];
    }
    return tail;
  }

  function gramField(lines, labelPattern) {
    const candidates = [];
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(labelPattern);
      if (!match) continue;
      const tail = segmentAfterLabel(lines, i, match);
      const grams = [...tail.matchAll(/(?:\b(less\s+than)\s*|([<≤])\s*)?(\d+(?:[.,]\d+)?)\s*(?:g|grams?)\b/gi)];
      if (!grams.length) continue; // A nearby percentage is never a gram value.
      if (grams.length > 1) {
        candidates.push({ value: null, raw: tail, status: "ambiguous" });
        continue;
      }
      const amount = Number(grams[0][3].replace(",", "."));
      if (!Number.isFinite(amount)) continue;
      const inequality = grams[0][1] || grams[0][2];
      candidates.push({ value: inequality ? null : amount, raw: grams[0][0].trim(), status: inequality ? "less_than" : "found" });
    }
    return finishCandidates(candidates);
  }

  function caloriesField(lines) {
    const candidates = [];
    for (let i = 0; i < lines.length; i++) {
      if (/calories\s+from\s+fat/i.test(lines[i])) continue;
      const match = lines[i].match(/\bcalories\b/i);
      if (!match) continue;
      let tail = segmentAfterLabel(lines, i, match);
      const nextNutrient = tail.search(NUTRIENT_START);
      if (nextNutrient >= 0) tail = tail.slice(0, nextNutrient).trim();
      const numbers = [...tail.matchAll(/\d+(?:[.,]\d+)?/g)].map((item) => Number(item[0].replace(",", ".")));
      if (!numbers.length) continue;
      if (numbers.length > 1) candidates.push({ value: null, raw: tail, status: "ambiguous" });
      else candidates.push({ value: numbers[0], raw: tail, status: "found" });
    }
    return finishCandidates(candidates);
  }

  function servingField(lines) {
    const candidates = [];
    for (let i = 0; i < lines.length; i++) {
      if (/servings?\s+per\s+container/i.test(lines[i])) continue;
      const match = lines[i].match(/\bserving\s+size\b\s*:*/i);
      if (!match) continue;
      let tail = lines[i].slice(match.index + match[0].length).trim();
      if (!tail && lines[i + 1] && !/\b(?:amount\s+per\s+serving|calories|total\s+fat)\b/i.test(lines[i + 1])) {
        tail = lines[i + 1];
      }
      tail = cleanLine(tail).slice(0, 120);
      if (tail) candidates.push(tail);
    }
    const unique = [...new Set(candidates.map((value) => value.toLowerCase()))];
    if (!candidates.length) return emptyField();
    if (unique.length > 1) return { value: null, raw: candidates.join(" · "), status: "ambiguous" };
    return { value: candidates[0], raw: candidates[0], status: "found" };
  }

  function hasAmbiguousBasis(source) {
    const text = cleanLine(source)
      .replace(/servings?\s+per\s+container/gi, "")
      .toLowerCase();
    const bases = [
      /\bper\s+serving\b/.test(text),
      /\bper\s+container\b/.test(text),
      /\bper\s+100\s*(?:g|ml)\b/.test(text),
      /\bas\s+packaged\b/.test(text),
      /\bas\s+prepared\b/.test(text),
    ].filter(Boolean).length;
    return bases > 1 || (/\bas\s+packaged\b/.test(text) && /\bas\s+prepared\b/.test(text));
  }

  function ambiguousField(previous) {
    return { value: null, raw: previous.raw, status: "ambiguous" };
  }

  function parseNutritionLabel(source) {
    const text = String(source || "").trim();
    const lines = linesFrom(text);
    const fields = {
      serving: servingField(lines),
      calories: caloriesField(lines),
      totalCarbs: gramField(lines, /\btotal\s+carbohydrate\b\s*:*/i),
      fiber: gramField(lines, /\bdietary\s+fiber\b\s*:*/i),
      sugarAlcohols: gramField(lines, /\bsugar\s+alcohols?\b\s*:*/i),
    };
    const issues = [];
    const basisAmbiguous = hasAmbiguousBasis(text);
    if (basisAmbiguous) {
      fields.calories = ambiguousField(fields.calories);
      fields.totalCarbs = ambiguousField(fields.totalCarbs);
      fields.fiber = ambiguousField(fields.fiber);
      fields.sugarAlcohols = ambiguousField(fields.sugarAlcohols);
      issues.push("This appears to contain more than one nutrition column or serving basis. Enter the values for one serving manually.");
    }
    const unsupported = !/\bnutrition\s+facts\b/i.test(text);
    if (unsupported) {
      fields.calories = ambiguousField(fields.calories);
      fields.totalCarbs = ambiguousField(fields.totalCarbs);
      fields.fiber = ambiguousField(fields.fiber);
      fields.sugarAlcohols = ambiguousField(fields.sugarAlcohols);
      issues.push("The text was not clearly identified as a US Nutrition Facts panel. Enter the nutrition values manually.");
    }

    const labels = {
      serving: "Serving size",
      calories: "Calories",
      totalCarbs: "Total carbohydrate",
      fiber: "Dietary fiber",
      sugarAlcohols: "Sugar alcohols",
    };
    for (const [key, field] of Object.entries(fields)) {
      if (field.status === "missing") issues.push(`${labels[key]} was not found.`);
      else if (field.status === "less_than") issues.push(`${labels[key]} was shown as an inequality (${field.raw}); choose the value to use.`);
      else if (field.status === "ambiguous" && !basisAmbiguous && !unsupported) issues.push(`${labels[key]} was ambiguous; enter it manually.`);
    }
    return { source: text, fields, issues, basisAmbiguous, unsupported };
  }

  async function foodId(draftId) {
    if (!DRAFT_PATTERN.test(String(draftId || ""))) throw new Error("Invalid label draft ID");
    if (typeof crypto === "undefined" || !crypto.subtle) throw new Error("Secure hashing is unavailable");
    const input = new TextEncoder().encode(`ncc-label-v1\0${draftId}`);
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", input)).slice(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function calculateNet(totalCarbs, fiber, sugarAlcohols) {
    const values = [totalCarbs, fiber, sugarAlcohols];
    if (values.some((value) => value === "" || value == null)) return { value: null, error: "incomplete" };
    const numbers = values.map(Number);
    if (numbers.some((value) => !Number.isFinite(value) || value < 0)) return { value: null, error: "invalid" };
    if (numbers[1] + numbers[2] > numbers[0]) return { value: null, error: "deductions_exceed_total" };
    return { value: Math.round((numbers[0] - numbers[1] - numbers[2]) * 100) / 100, error: null };
  }

  return { MAX_SOURCE_LENGTH, parseLaunchHash, parseNutritionLabel, calculateNet, foodId };
});
