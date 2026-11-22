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

    // Otomatis mengenali penulisan GROQ_API_KEY maupun GROC_API_KEY
    const groqKey = (
      process.env.GROQ_API_KEY ||
      process.env.GROC_API_KEY ||
      process.env.GROQ_KEY ||
      ''
    ).trim().replace(/^["']|["']$/g, '');

    let groqErrorMsg = '';

    if (groqKey) {
      const groqModels = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
      for (const modelName of groqModels) {
        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${groqKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: modelName,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              ...history,
              { role: 'user', content: userText }
            ],
            temperature: 0.7
          })
        });

        const groqData = await groqRes.json();
        if (groqRes.ok) {
          const reply = groqData.choices?.[0]?.message?.content || 'Maaf, tidak ada jawaban.';
          return res.status(200).json({ ok: true, text: reply });
        }
        groqErrorMsg = groqData?.error?.message || `HTTP ${groqRes.status}`;
      }
    } else {
      groqErrorMsg = 'Variabel GROQ_API_KEY belum terbaca di Vercel (perlu Redeploy atau cek nama variabel).';
    }

    // Cadangan ke GEMINI_API_KEY jika Groq gagal
    const geminiKey = (process.env.GEMINI_API_KEY || '').trim().replace(/^["']|["']$/g, '');
    let geminiErrorMsg = '';

    if (geminiKey) {
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
      if (geminiRes.ok) {
        const reply = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || 'Maaf, tidak ada respons.';
        return res.status(200).json({ ok: true, text: reply });
      }
      geminiErrorMsg = geminiData?.error?.message || `HTTP ${geminiRes.status}`;
    } else {
      geminiErrorMsg = 'Variabel GEMINI_API_KEY kosong.';
    }

    // Tampilkan penyebab pasti langsung di kolom chat agar tidak perlu cek Logs
    return res.status(200).json({
      ok: true,
      text: `⚠️ **Info Diagnosa Server:**\n- **Status Groq:** ${groqErrorMsg}\n- **Status Gemini:** ${geminiErrorMsg}`
    });
  } catch (error) {
    return res.status(200).json({
      ok: true,
      text: `⚠️ **Error Server:** ${error?.message || String(error)}`
    });
  }
}
