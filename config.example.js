// Copy this file to "config.js" and fill in your two Supabase values.
// Find them in your Supabase dashboard:  Project Settings → API
window.NCC_CONFIG = {
  // Looks like: https://abcdefghijklmnop.supabase.co
  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",

  // The "anon" / "public" key (a long string starting with eyJ...).
  // This is the publishable key — safe to ship in the app.
  SUPABASE_ANON_KEY: "YOUR-ANON-PUBLIC-KEY",

  // Multi-user: who is using THIS deployment. Each person shares the same
  // foods but has their own logs, settings, and favorites.
  //   PERSON       — a lowercase id stored in the database (e.g. "rich", "gen")
  //   DISPLAY_NAME — shown in the header as "<name>'s Carb Counter"
  // Deploy this same folder twice (one site each), changing only these two lines.
  PERSON: "rich",
  DISPLAY_NAME: "Rich",
};
