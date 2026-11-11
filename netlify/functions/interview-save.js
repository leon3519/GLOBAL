// Netlify Function. Stores the interview setup server-side so the candidate
// link only needs to carry the interview ID. Uses Netlify Blobs (built in).
// Requires no extra environment variables beyond the Telegram ones used elsewhere.
import { getStore } from "@netlify/blobs";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export default async (req) => {
  if (req.method === "OPTIONS") return json(204, null);
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const record = JSON.parse((await req.text()) || "{}");
    if (!record.id || !record.company || !record.position || !record.candidate) {
      return json(400, { error: "Incomplete interview record." });
    }
    if (!Array.isArray(record.questions) || record.questions.length === 0) {
      return json(400, { error: "At least one question is required." });
    }
    if (!record.logo?.data) {
      return json(400, { error: "Company logo is required." });
    }
    // Rough size check on the base64 logo (4/3 overhead).
    const logoBytes = Math.ceil((record.logo.data.length * 3) / 4);
    if (logoBytes > MAX_LOGO_BYTES) {
      return json(413, { error: "Logo exceeds the 2 MB limit." });
    }

    const store = getStore("interviews");
    await store.setJSON(record.id, {
      ...record,
      used: false,
      createdAt: record.createdAt || new Date().toISOString(),
    });

    return json(200, { success: true, id: record.id });
  } catch (err) {
    console.error("interview-save error:", err);
    return json(500, { error: err.message || "Could not save interview." });
  }

  function json(statusCode, obj) {
    return {
      statusCode,
      headers: { ...cors, "Content-Type": "application/json" },
      body: obj === null ? "" : JSON.stringify(obj),
    };
  }
};
