import { GoogleGenAI } from '@google/genai';

const SYSTEM_PROMPT = `Kamu adalah Asisten AI PathTeacher, pemandu karier khusus mahasiswa dan lulusan Pendidikan Guru Sekolah Dasar (PGSD) di Indonesia. Jawablah dengan ramah, jelas, terstruktur, dan praktis seputar jalur karier guru SD (CPNS, PPPK, PPG, guru sekolah swasta/internasional SPK), Kurikulum Merdeka, microteaching, serta tugas wali kelas SD.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const userMessage = (
      body.message ||
      body.prompt ||
      body.question ||
      (Array.isArray(body.messages) ? body.messages[body.messages.length - 1]?.content : '') ||
      ''
    ).trim();

    if (!userMessage) {
      return res.status(400).json({ ok: false, reason: 'empty_message' });
    }

    // 1. Jika GROQ_API_KEY terpasang di Vercel, gunakan Groq (gratis & tanpa kartu kredit)
    const groqKey = (process.env.GROQ_API_KEY || '').trim();
    if (groqKey) {
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${groqKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userMessage }
          ],
          temperature: 0.7
        })
      });

      const groqData = await groqRes.json();
      if (!groqRes.ok) {
        return res.status(502).json({
          ok: false,
          reason: 'groq_error',
          detail: groqData?.error?.message || 'Groq API error'
        });
      }

      const reply = groqData.choices?.[0]?.message?.content || 'Maaf, tidak ada jawaban.';
      return res.status(200).json({ ok: true, reply, text: reply, answer: reply });
    }

    // 2. Jika memakai GEMINI_API_KEY (mendukung kunci AQ. Vertex Express & AIzaSy)
    const geminiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (!geminiKey) {
      return res.status(500).json({ ok: false, reason: 'missing_api_key' });
    }

    const ai = geminiKey.startsWith('AQ.')
      ? new GoogleGenAI({ vertexai: true, apiKey: geminiKey })
      : new GoogleGenAI({ apiKey: geminiKey });

    let lastError = null;
    for (const modelName of ['gemini-2.5-flash', 'gemini-2.0-flash']) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: userMessage,
          config: {
            systemInstruction: SYSTEM_PROMPT,
            temperature: 0.7
          }
        });

        const reply = response.text || 'Maaf, tidak ada respons dari AI.';
        return res.status(200).json({ ok: true, reply, text: reply, answer: reply });
      } catch (err) {
        lastError = err;
      }
    }

    return res.status(502).json({
      ok: false,
      reason: 'gemini_rejected',
      detail: lastError?.message || String(lastError)
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      reason: 'server_error',
      detail: error?.message || String(error)
    });
  }
}
