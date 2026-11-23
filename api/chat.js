const SYSTEM_PROMPT = `Kamu adalah Asisten AI PathTeacher, pemandu karier khusus mahasiswa dan lulusan Pendidikan Guru Sekolah Dasar (PGSD) di Indonesia. Jawablah dengan ramah, jelas, terstruktur, dan praktis seputar jalur karier guru SD (CPNS, PPPK, PPG, guru sekolah swasta/internasional SPK), Kurikulum Merdeka, microteaching, serta tugas wali kelas SD.

Aturan Akurasi:
- Jangan pernah mengarang tanggal pasti pembukaan seleksi, jumlah kuota formasi daerah, atau perubahan regulasi terbaru.
- Jika pengguna menanyakan jadwal resmi tahun berjalan atau pengecekan status data pribadi (Info GTK, Dapodik, PDDIKTI), jelaskan pola umumnya saja lalu arahkan pengguna untuk mengecek langsung ke portal resmi (sscasn.bkn.go.id, info.gtk.kemdikbud.go.id, atau situs instansi terkait).`;

async function getActiveGroqModels(groqKey) {
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { 'Authorization': `Bearer ${groqKey}` }
    });
    if (!res.ok) return [];
    const data = await res.json();
    const list = Array.isArray(data.data) ? data.data : [];

    const excluded = ['whisper', 'tts', 'guard', 'embed', 'playai', 'orpheus', 'moderation'];
    const chatModels = list
      .filter((m) => m && m.id && m.active !== false)
      .map((m) => m.id)
      .filter((id) => !excluded.some((word) => id.toLowerCase().includes(word)));

    const preferredOrder = ['llama-4', 'llama-3', 'llama', 'qwen', 'gpt', 'gemma', 'deepseek', 'mistral'];
    chatModels.sort((a, b) => {
      const idxA = preferredOrder.findIndex((p) => a.toLowerCase().includes(p));
      const idxB = preferredOrder.findIndex((p) => b.toLowerCase().includes(p));
      const scoreA = idxA === -1 ? 99 : idxA;
      const scoreB = idxB === -1 ? 99 : idxB;
      return scoreA - scoreB;
    });

    return chatModels;
  } catch {
    return [];
  }
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

    const groqKey = (process.env.GROQ_API_KEY || '').trim().replace(/^["']|["']$/g, '');
    if (!groqKey) {
      return res.status(200).json({
        ok: true,
        text: '⚠️ Variabel `GROQ_API_KEY` belum terbaca di Vercel. Pastikan sudah tersimpan dan lakukan Redeploy.'
      });
    }

    const availableModels = await getActiveGroqModels(groqKey);
    if (availableModels.length === 0) {
      return res.status(200).json({
        ok: true,
        text: '⚠️ Kunci `GROQ_API_KEY` terhubung, tetapi daftar model aktif tidak ditemukan di akun Groq.'
      });
    }

    let lastError = '';
    for (const modelName of availableModels.slice(0, 5)) {
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
      lastError = `${modelName}: ${groqData?.error?.message || `HTTP ${groqRes.status}`}`;
    }

    return res.status(200).json({
      ok: true,
      text: `⚠️ Semua model Groq gagal merespons. Detail terakhir: ${lastError}`
    });
  } catch (error) {
    return res.status(200).json({
      ok: true,
      text: `⚠️ Error Server: ${error?.message || String(error)}`
    });
  }
}
