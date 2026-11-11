// Netlify Function. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in Netlify
// Site configuration -> Environment variables. Never expose the bot token in HTML.
import { getStore } from "@netlify/blobs";

const MAX_TOTAL_BYTES = 48 * 1024 * 1024; // leave headroom below Telegram's upload ceiling
const MAX_VIDEO_BYTES = 18 * 1024 * 1024;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return response(405, { error: "Method not allowed" });
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return response(500, { error: "Telegram bot secrets are not configured on the server." });

  try {
    const contentType = event.headers["content-type"] || event.headers["Content-Type"] || "";
    if (!contentType.toLowerCase().includes("multipart/form-data")) return response(400, { error: "Expected multipart form data." });
    const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64") : Buffer.from(event.body || "", "utf8");
    if (raw.length > MAX_TOTAL_BYTES) return response(413, { error: "The combined video upload is too large. Record shorter answers or split the interview." });

    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!boundaryMatch) return response(400, { error: "Multipart boundary is missing." });
    const boundary = Buffer.from("--" + (boundaryMatch[1] || boundaryMatch[2]));
    const parts = splitMultipart(raw, boundary);
    let metadata = null;
    const videos = [];
    for (const part of parts) {
      const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
      if (headerEnd < 0) continue;
      const headers = part.subarray(0, headerEnd).toString("utf8");
      const body = part.subarray(headerEnd + 4);
      const name = (headers.match(/name="([^"]+)"/i) || [])[1];
      const filename = (headers.match(/filename="([^"]*)"/i) || [])[1];
      if (name === "metadata") metadata = JSON.parse(body.toString("utf8").replace(/\r\n$/, ""));
      if (name === "videos" && filename) {
        const clean = body.subarray(0, body.length >= 2 && body.subarray(-2).equals(Buffer.from("\r\n")) ? body.length - 2 : body.length);
        if (clean.length > MAX_VIDEO_BYTES) return response(413, { error: `Video ${filename} exceeds the 18 MB per-answer limit. Please record a shorter answer.` });
        videos.push({ filename, data: clean });
      }
    }
    if (!metadata || !metadata.interviewId || !metadata.candidate || videos.length === 0) {
      return response(400, { error: "Interview details or video answers are missing." });
    }

    // Reject duplicate / replayed submissions against the same ID.
    const store = getStore("interviews");
    const record = await store.get(metadata.interviewId, { type: "json" });
    if (record?.used) {
      return response(410, { error: "This interview has already been submitted." });
    }

    const summary = [
      "🎥 NEW VIDEO INTERVIEW SUBMISSION",
      `Company: ${safe(metadata.company)}`,
      `Company address: ${safe(metadata.address)}`,
      `Interviewer: ${safe(metadata.interviewer)}`,
      `Candidate: ${safe(metadata.candidate)}`,
      `Position: ${safe(metadata.position)}`,
      `Submitted: ${safe(metadata.submittedAt)}`,
      `Interview ID: ${safe(metadata.interviewId)}`,
      `Video answers: ${videos.length}`,
    ].join("\n");
    await telegram("sendMessage", { chat_id: chatId, text: summary });
    for (let i = 0; i < videos.length; i++) {
      const question = Array.isArray(metadata.questions) ? metadata.questions[i] : "";
      const caption = `Candidate: ${safe(metadata.candidate)}\nPosition: ${safe(metadata.position)}\nAnswer ${i + 1}: ${safe(question)}`.slice(0, 1024);
      const form = new FormData();
      form.append("chat_id", chatId);
      form.append("caption", caption);
      form.append("supports_streaming", "true");
      form.append("video", new Blob([videos[i].data], { type: "video/webm" }), videos[i].filename);
      await telegramMultipart("sendVideo", form);
    }

    // Mark used only after Telegram succeeded, so a failed upload can be retried.
    if (record) {
      await store.setJSON(metadata.interviewId, { ...record, used: true, submittedAt: metadata.submittedAt });
    }

    return response(200, { success: true, videosSent: videos.length });
  } catch (err) {
    console.error("Telegram interview submission error:", err);
    return response(500, { error: err.message || "Unexpected server error." });
  }

  function response(statusCode, obj) {
    return { statusCode, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify(obj) };
  }
  function safe(value) {
    return String(value ?? "").replace(/[<>]/g, "").slice(0, 500);
  }
  async function telegram(method, payload) {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const result = await res.json();
    if (!res.ok || !result.ok) throw new Error(result.description || `Telegram ${method} failed`);
    return result;
  }
  async function telegramMultipart(method, form) {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", body: form });
    const result = await res.json();
    if (!res.ok || !result.ok) throw new Error(result.description || `Telegram ${method} failed`);
    return result;
  }
};

function splitMultipart(buffer, boundary) {
  const parts = [];
  let start = buffer.indexOf(boundary);
  while (start !== -1) {
    start += boundary.length;
    if (buffer.subarray(start, start + 2).equals(Buffer.from("--"))) break;
    if (buffer.subarray(start, start + 2).equals(Buffer.from("\r\n"))) start += 2;
    const next = buffer.indexOf(boundary, start);
    if (next === -1) break;
    let end = next;
    if (buffer.subarray(end - 2, end).equals(Buffer.from("\r\n"))) end -= 2;
    parts.push(buffer.subarray(start, end));
    start = next;
  }
  return parts;
}
