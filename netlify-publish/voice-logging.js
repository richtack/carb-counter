/* ============================================================
   Voice meal parsing helpers

   This file deliberately contains no database or DOM code. The Shortcut sends
   ordinary dictated text; these helpers only match it against foods already
   saved in the app and convert compatible serving units. Anything uncertain is
   left for the review screen instead of being guessed.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.NCCVoice = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const NUMBER_WORDS = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
    a: 1, an: 1, half: 0.5, quarter: 0.25,
  };

  const UNIT_ALIASES = {
    serving: "serving", servings: "serving", portion: "serving", portions: "serving",
    egg: "egg", eggs: "egg",
    slice: "slice", slices: "slice",
    piece: "piece", pieces: "piece",
    bar: "bar", bars: "bar",
    scoop: "scoop", scoops: "scoop",
    packet: "packet", packets: "packet", pack: "packet", packs: "packet",
    bottle: "bottle", bottles: "bottle",
    can: "can", cans: "can",
    cup: "cup", cups: "cup",
    tbsp: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp",
    tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp",
    g: "g", gram: "g", grams: "g",
    kg: "kg", kilogram: "kg", kilograms: "kg",
    oz: "oz", ounce: "oz", ounces: "oz",
    ml: "ml", milliliter: "ml", milliliters: "ml", millilitre: "ml", millilitres: "ml",
  };

  const MATCH_STOP_WORDS = new Set([
    "i", "had", "ate", "have", "consumed", "log", "add", "please", "my", "some",
    "of", "the", "a", "an", "for", "breakfast", "lunch", "dinner", "snack",
    "serving", "portion", "and", "then",
    ...Object.keys(NUMBER_WORDS),
  ]);
  const MATCH_UNIT_STOP_WORDS = new Set([
    "serving", "portion", "slice", "piece", "scoop", "packet", "bottle", "can",
    "cup", "tbsp", "tsp", "g", "kg", "oz", "ml",
  ]);

  function singular(word) {
    if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y";
    if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
    return word;
  }

  function words(value) {
    return String(value || "")
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[’']/g, "")
      .replace(/(\d)\.(\d)/g, "$1decimalpoint$2")
      .replace(/[^a-z0-9/]+/g, " ")
      .replace(/decimalpoint/g, ".")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(singular);
  }

  function amountAt(tokens, i) {
    const raw = tokens[i];
    if (raw == null) return null;
    if (/^\d+(?:\.\d+)?$/.test(raw)) return { value: Number(raw), used: 1 };
    const fraction = raw.match(/^(\d+)\/(\d+)$/);
    if (fraction && Number(fraction[2])) return { value: Number(fraction[1]) / Number(fraction[2]), used: 1 };
    if (raw in NUMBER_WORDS) return { value: NUMBER_WORDS[raw], used: 1 };
    return null;
  }

  function findAmountAndUnit(value) {
    const tokens = words(cleanTranscript(value));
    for (let i = 0; i < tokens.length; i++) {
      const amount = amountAt(tokens, i);
      if (!amount) continue;
      for (let j = i + amount.used; j < Math.min(tokens.length, i + amount.used + 5); j++) {
        const unit = UNIT_ALIASES[tokens[j]];
        if (unit) return { amount: amount.value, unit };
      }
      return { amount: amount.value, unit: null };
    }
    // Free-text serving definitions often omit the number, e.g. "large egg".
    for (const token of tokens) {
      const unit = UNIT_ALIASES[token];
      if (unit) return { amount: 1, unit };
    }
    return null;
  }

  function unitBase(amount, unit) {
    const factors = {
      g: ["weight", 1], kg: ["weight", 1000], oz: ["weight", 28.3495],
      ml: ["volume", 1], tsp: ["volume", 4.92892], tbsp: ["volume", 14.7868], cup: ["volume", 236.588],
    };
    if (!factors[unit]) return null;
    return { family: factors[unit][0], amount: amount * factors[unit][1] };
  }

  function resolveQuantity(source, serving) {
    const requested = findAmountAndUnit(source);
    if (!requested) return { qty: 1, reason: "No portion stated; using one saved serving." };
    if (!(requested.amount > 0)) return { qty: null, reason: "The portion must be greater than zero." };
    if (requested.unit === "serving") return { qty: requested.amount, reason: "Portion stated in servings." };

    const saved = findAmountAndUnit(serving);
    if (!saved || !requested.unit) {
      return { qty: null, reason: `Check the amount against the saved serving “${serving || "not specified"}”.` };
    }
    if (saved.unit === requested.unit) {
      return { qty: requested.amount / saved.amount, reason: "Converted from the saved serving size." };
    }

    const reqBase = unitBase(requested.amount, requested.unit);
    const savedBase = unitBase(saved.amount, saved.unit);
    if (reqBase && savedBase && reqBase.family === savedBase.family) {
      return { qty: reqBase.amount / savedBase.amount, reason: "Converted between compatible units." };
    }
    return { qty: null, reason: `“${requested.unit}” does not clearly match the saved serving “${serving || "not specified"}”.` };
  }

  function contentTokens(value) {
    return words(value).filter((token) =>
      !MATCH_STOP_WORDS.has(token) && !MATCH_UNIT_STOP_WORDS.has(token) &&
      !/^\d+(?:\.\d+)?$/.test(token) && !/^\d+\/\d+$/.test(token));
  }

  function foodScore(source, foodName) {
    const sourcePhrase = ` ${words(source).join(" ")} `;
    const foodPhrase = words(foodName).join(" ");
    if (foodPhrase && sourcePhrase.includes(` ${foodPhrase} `)) return 1;
    const sourceTokens = contentTokens(source);
    const foodTokens = contentTokens(foodName);
    if (!sourceTokens.length || !foodTokens.length) return 0;
    const sourceSet = new Set(sourceTokens);
    const foodSet = new Set(foodTokens);
    const overlap = [...sourceSet].filter((token) => foodSet.has(token)).length;
    if (!overlap) return 0;
    if (foodTokens.every((token) => sourceSet.has(token))) return 1;
    if (sourceTokens.every((token) => foodSet.has(token))) return 0.72 + Math.min(0.18, overlap * 0.04);
    return (2 * overlap) / (sourceSet.size + foodSet.size) * 0.68;
  }

  function cleanTranscript(value) {
    return String(value || "")
      .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+and\s+a\s+half\b/gi,
        (_, n) => String(NUMBER_WORDS[n.toLowerCase()] + 0.5))
      .replace(/\b(\d+)\s+and\s+a\s+half\b/gi, (_, n) => String(Number(n) + 0.5))
      .replace(/\bone\s+and\s+one\s+half\b/gi, "1.5")
      .replace(/\bone\s+half\b/gi, "0.5")
      .replace(/\bone\s+quarter\b/gi, "0.25")
      .replace(/^\s*(?:please\s+)?(?:i\s+)?(?:had|ate|have|consumed|want\s+to\s+log|need\s+to\s+log|log|add)\s+/i, "")
      .trim();
  }

  function bestFoodScore(value, foods) {
    return (foods || []).reduce((best, food) => Math.max(best, foodScore(value, food.name)), 0);
  }

  function splitImplicitPortions(value, foods) {
    const amountPattern = /\b(?:\d+(?:\.\d+)?|\d+\/\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|half|quarter|a|an)\b/gi;
    const starts = [];
    for (const match of value.matchAll(amountPattern)) {
      const token = match[0].toLowerCase();
      const before = value.slice(0, match.index);
      // “a” belongs to the preceding amount in “half a serving” or “half of a cup.”
      if ((token === "a" || token === "an") &&
          /(?:half|quarter|\d+(?:\.\d+)?|\d+\/\d+)\s+(?:of\s+)?$/i.test(before)) continue;
      // A number joined to the next word usually describes one item: “one 6-ounce steak.”
      if (/^\s*-/.test(value.slice(match.index + match[0].length))) continue;
      starts.push(match.index);
    }
    if (!starts.length) return [value];

    const boundaries = [0];
    let previousAmount = starts[0];
    // If text before the first amount is itself a saved food (“coffee one egg”),
    // the amount starts a second item. Otherwise it belongs to the first item.
    if (starts[0] > 0 && bestFoodScore(value.slice(0, starts[0]), foods) >= 0.7) {
      boundaries.push(starts[0]);
    }
    for (let i = 1; i < starts.length; i++) {
      const lastBoundary = boundaries[boundaries.length - 1];
      const candidate = value.slice(lastBoundary, starts[i]).trim();
      if (starts[i] > previousAmount && bestFoodScore(candidate, foods) >= 0.42) {
        boundaries.push(starts[i]);
      }
      previousAmount = starts[i];
    }
    if (boundaries.length === 1) return [value];
    return boundaries.map((start, i) => value.slice(start, boundaries[i + 1] ?? value.length).trim()).filter(Boolean);
  }

  function splitTranscript(transcript, foods) {
    let cleaned = cleanTranscript(transcript);
    // Protect saved food names such as “Half and Half” before treating “and”
    // as a separator between dictated foods.
    for (const food of foods || []) {
      if (!/\band\b/i.test(food.name || "")) continue;
      const pattern = String(food.name).trim().split(/\s+/)
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("\\s+");
      cleaned = cleaned.replace(new RegExp(`\\b${pattern}\\b`, "gi"),
        (match) => match.replace(/\band\b/gi, "nccconjunction"));
    }
    // Keep decimal points intact while sentence punctuation acts as a separator.
    cleaned = cleaned.replace(/(\d)\.(\d)/g, "$1nccdecimalpoint$2");
    return cleaned
      .split(/\s*(?:[,.!?;]|\n|\b(?:and then|then|and|also|plus|next)\b)\s*/i)
      .map((part) => part
        .replace(/nccdecimalpoint/gi, ".")
        .replace(/nccconjunction/gi, "and")
        .replace(/^\s*(?:(?:and|also|plus|next)\s+)?/i, "")
        .trim())
      .filter(Boolean)
      .flatMap((part) => splitImplicitPortions(part, foods));
  }

  function matchClause(source, foods) {
    const ranked = (foods || [])
      .map((food) => ({ food, score: foodScore(source, food.name) }))
      .filter((candidate) => candidate.score >= 0.42)
      .sort((a, b) => b.score - a.score || String(a.food.name).localeCompare(String(b.food.name)));

    if (!ranked.length) {
      return { source, status: "unmatched", foodId: null, qty: null, alternatives: [], reason: "No saved food matched." };
    }

    const top = ranked[0];
    const close = ranked.filter((candidate) => top.score - candidate.score < 0.12);
    if (close.length > 1) {
      return {
        source, status: "ambiguous", foodId: null, qty: null,
        alternatives: close.slice(0, 3).map((candidate) => candidate.food.id),
        reason: "More than one saved food could match.",
      };
    }

    const portion = resolveQuantity(source, top.food.serving);
    return {
      source,
      status: portion.qty == null ? "ambiguous" : "matched",
      foodId: portion.qty == null ? null : top.food.id,
      suggestedFoodId: top.food.id,
      qty: portion.qty,
      alternatives: portion.qty == null ? [top.food.id] : [],
      reason: portion.reason,
    };
  }

  function parseTranscript(transcript, foods) {
    const source = String(transcript || "").trim();
    return {
      transcript: source,
      items: splitTranscript(source, foods).map((clause) => matchClause(clause, foods)),
    };
  }

  async function entryId(person, draftId, itemIndex) {
    if (typeof crypto === "undefined" || !crypto.subtle) throw new Error("Secure hashing is unavailable");
    const input = new TextEncoder().encode(`ncc-voice-v1\0${person}\0${draftId}\0${itemIndex}`);
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", input)).slice(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x50; // UUID version 5 shape
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return { parseTranscript, resolveQuantity, splitTranscript, foodScore, entryId };
});
