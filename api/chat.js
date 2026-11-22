import { GoogleGenAI } from "@google/genai";

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_FALLBACK_MODELS = ["gemini-2.5-flash-lite"];

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

async function callGeminiOnce(model, userText, history, useSearch) {
  const hariIni = new Date().toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const systemPrompt =
    "Kamu adalah 'Asisten PathTeacher', konsultan karier AI yang informatif dan profesional khusus membantu mahasiswa & lulusan S1 PGSD di Indonesia. Jawabanmu mencakup informasi tentang CPNS, PPPK, Info GTK, PPG, dan sekolah internasional. Gunakan Bahasa Indonesia yang formal namun tetap mudah dipahami dan ramah. " +
    "Hari ini tanggal " + hariIni + ". Gunakan pencarian web untuk informasi terbaru, dan utamakan sumber resmi seperti bkn.go.id, sscasn.bkn.go.id, dan situs resmi Kemendikdasmen/Kemdikbud. " +
    "Jika informasi belum diumumkan secara resmi atau hanya berasal dari sumber tidak resmi, sampaikan hal itu dengan jelas. Jika tidak yakin, katakan terus terang dan jangan mengarang. " +
    "Jawab ringkas, maksimal sekitar 200 kata, dan gunakan poin-poin bila membantu. Jika pertanyaan di luar topik karier guru, arahkan kembali dengan sopan ke topik karier guru.";

  const past = Array.isArray(history)
    ? history.slice(-8).map((m) => ({
        role: m.role === "model" ? "model" : "user",
        parts: [{ text: String(m.text || "") }],
      }))
    : [];

  const contents = [...past, { role: "user", parts: [{ text: userText }] }];

  const config = {
    systemInstruction: systemPrompt,
  };
  if (useSearch) {
    config.tools = [{ googleSearch: {} }];
  }

  try {
    const response = await ai.models.generateContent({
      model,
      contents,
      config,
    });

    const text = (response.text || "").trim();
    if (!text) return { ok: false, reason: "empty" };

    const seen = new Set();
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const sumber = chunks
      .filter((c) => c.web?.uri && !seen.has(c.web.uri) && seen.add(c.web.uri))
      .slice(0, 5)
      .map((c) => `- [${(c.web.title || c.web.uri).replace(/[\[\]]/g, "")}](${c.web.uri})`)
      .join("\n");

    return { ok: true, text, sumber };
  } catch (err) {
    const status = err?.status || err?.code;
    return {
      ok: false,
      reason: status ? `http_${status}` : "network",
    };
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, reason: "method_not_allowed" });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ ok: false, reason: "http_401" });
  }

  const { userText, history } = req.body || {};
  const cleanText = String(userText || "").trim().slice(0, 500);

  if (!cleanText) {
    return res.status(400).json({ ok: false, reason: "empty" });
  }

  const attempts = [{ model: GEMINI_MODEL, search: true }];
  if (GEMINI_FALLBACK_MODELS[0]) {
    attempts.push({ model: GEMINI_FALLBACK_MODELS[0], search: true });
  }
  attempts.push({ model: GEMINI_MODEL, search: false });

  let firstFailure = null;
  for (const attempt of attempts) {
    const result = await callGeminiOnce(attempt.model, cleanText, history, attempt.search);
    if (result.ok) {
      result.noSearch = !attempt.search;
      return res.status(200).json(result);
    }
    if (!firstFailure) firstFailure = result;
  }

  return res.status(200).json(firstFailure || { ok: false, reason: "network" });
}