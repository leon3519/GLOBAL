// Netlify Function. Returns the interview setup by ID so the candidate page
// can load it. Rejects links that have already been submitted (single use).
import { getStore } from "@netlify/blobs";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export default async (req) => {
  if (req.method === "OPTIONS") return json(204, null);
  if (req.method !== "GET") return json(405, { error: "Method not allowed" });

  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return json(400, { error: "Missing interview id." });

    const store = getStore("interviews");
    const record = await store.get(id, { type: "json" });
    if (!record) return json(404, { error: "Interview not found." });

    // Single-use: once submitted, the link stops working.
    if (record.used) {
      return json(410, { error: "This interview has already been submitted." });
    }

    return json(200, record);
  } catch (err) {
    console.error("interview-get error:", err);
    return json(500, { error: err.message || "Could not load interview." });
  }

  function json(statusCode, obj) {
    return {
      statusCode,
      headers: { ...cors, "Content-Type": "application/json" },
      body: obj === null ? "" : JSON.stringify(obj),
    };
  }
};
