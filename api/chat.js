import { GoogleGenAI } from '@google/genai';

const SYSTEM_PROMPT = `Kamu adalah Asisten AI PathTeacher, pemandu karier khusus mahasiswa dan lulusan Pendidikan Guru Sekolah Dasar (PGSD) di Indonesia. Jawablah dengan ramah, jelas, terstruktur, dan praktis seputar jalur karier guru SD (CPNS, PPPK, PPG, guru sekolah swasta/internasional SPK), Kurikulum Merdeka, microteaching, serta tugas wali kelas SD.`;

function extractUserMessage(body) {
  if (!body) return '';
  if (typeof body === 'string') {
    const trimmed = body.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return extractUserMessage(JSON.parse(trimmed));
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  if (Array.isArray(body)) {
    for (let i = body.length - 1; i >= 0; i--) {
      const item = body[i];
      if (item && typeof item === 'object' && item.role === 'system') continue;
      const found = extractUserMessage(item);
      if (found) return found;
    }
    return '';
  }
  if (typeof body === 'object') {
    const priorityKeys = [
      'message', 'text', 'prompt', 'question', 'query', 'input',
      'pertanyaan', 'pesan', 'userMessage', 'msg', 'chat', 'content'
    ];
    for (const key of priorityKeys) {
      if (typeof body[key] === 'string' && body[key].trim()) {
        return body[key].trim();
      }
    }
    if (Array.isArray(body.messages)) {
      const found = extractUserMessage(body.messages);
      if (found) return found;
    }
    if (Array.isArray(body.contents)) {
      const found = extractUserMessage(body.contents);
      if (found) return found;
    }
    if (Array.isArray(body.parts)) {
      const found = extractUserMessage(body.parts);
      if (found) return found;
    }
    const ignoredKeys = new Set(['role', 'model', 'type', 'id', 'sessionId', 'history']);
    for (const [key, val] of Object.entries(body)) {
      if (ignoredKeys.has(key)) continue;
      const found = extractUserMessage(val);
      if (found) return found;
    }
  }
  return '';
}

function sendSuccess(res, reply) {
  return res.status(200).json({
    ok: true,
    reply,
    text: reply,
    answer: reply,
    response: reply,
    message: reply,
    output: reply,
    result: reply,
    content: reply,
    choices: [{ message: { role: 'assistant', content: reply } }],
    candidates: [{ content: { parts: [{ text: reply }] } }]
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  try {
    const userMessage = extractUserMessage(req.body);

    if (!userMessage) {
      return res.status(400).json({ ok: false, reason: 'empty_message' });
    }

    // 1. Prioritaskan GROQ_API_KEY jika terpasang di Vercel
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
      return sendSuccess(res, reply);
    }

    // 2. Cadangan menggunakan GEMINI_API_KEY
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
        return sendSuccess(res, reply);
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
