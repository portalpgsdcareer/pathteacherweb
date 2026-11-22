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
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const userText = String(
      body.userText || body.message || body.text || body.prompt || body.question || ''
    ).trim();

    if (!userText) {
      return res.status(400).json({ ok: false, reason: 'empty_message' });
    }

    const history = Array.isArray(body.history)
      ? body.history
          .filter((item) => item && typeof item.text === 'string' && item.text.trim())
          .map((item) => ({
            role: item.role === 'model' ? 'assistant' : 'user',
            content: item.text.trim()
          }))
      : [];

    // 1. Gunakan GROQ_API_KEY (prioritas utama)
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
            ...history,
            { role: 'user', content: userText }
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
      return res.status(200).json({ ok: true, text: reply });
    }

    // 2. Cadangan jika hanya GEMINI_API_KEY yang terpasang
    const geminiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (!geminiKey) {
      return res.status(500).json({ ok: false, reason: 'missing_api_key' });
    }

    const geminiEndpoint = geminiKey.startsWith('AQ.')
      ? `https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`
      : `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`;

    const geminiContents = [
      ...history.map((item) => ({
        role: item.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: item.content }]
      })),
      { role: 'user', parts: [{ text: userText }] }
    ];

    const geminiRes = await fetch(geminiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: geminiContents,
        generationConfig: { temperature: 0.7 }
      })
    });

    const geminiData = await geminiRes.json();
    if (!geminiRes.ok) {
      return res.status(502).json({
        ok: false,
        reason: 'gemini_rejected',
        detail: geminiData?.error?.message || 'Gemini API error'
      });
    }

    const reply = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || 'Maaf, tidak ada respons.';
    return res.status(200).json({ ok: true, text: reply });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      reason: 'server_error',
      detail: error?.message || String(error)
    });
  }
}
