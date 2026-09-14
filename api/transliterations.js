const { requirePaidTranslationClient } = require('../lib/translationAccess');
const { lookupTransliterations, recordTransliteration } = require('../lib/verifiedTransliterations');

// Тот же доступ, что и /api/translate — только платные клиенты после входа
// (см. lib/translationAccess.js). Словарь транслитераций — часть той же
// платной функции "перевод документа", отдельного тарифа/квоты для него нет.
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Используйте POST.' });
  try {
    if (!req.body || typeof req.body !== 'object' || JSON.stringify(req.body).length > 20000) {
      return res.status(413).json({ error: 'Слишком большой запрос.' });
    }
    await requirePaidTranslationClient(req, req.body.clientSlug);

    if (req.body.action === 'lookup') {
      const originals = req.body.originals;
      if (!Array.isArray(originals) || !originals.length || originals.length > 50 || originals.some(o => typeof o !== 'string')) {
        return res.status(400).json({ error: 'Некорректный список значений (до 50 строк).' });
      }
      const values = await lookupTransliterations(originals);
      return res.status(200).json({ values });
    }

    if (req.body.action === 'confirm') {
      const entries = req.body.entries;
      if (!Array.isArray(entries) || !entries.length || entries.length > 50) {
        return res.status(400).json({ error: 'Некорректный список подтверждений (до 50 штук).' });
      }
      for (const entry of entries) {
        if (!entry || typeof entry.original !== 'string' || typeof entry.verifiedValue !== 'string') {
          return res.status(400).json({ error: 'Каждая запись — {original, verifiedValue}.' });
        }
      }
      // Не критично для ответа клиенту — сбой записи в словарь не должен
      // мешать скачиванию уже готового перевода (см. panel.js:ready — это
      // отдельный fire-and-forget вызов, ответ на него никто не ждёт).
      await Promise.all(entries.map(e => recordTransliteration(e.original, e.verifiedValue)));
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Укажите action: lookup или confirm.' });
  } catch (error) {
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 503;
    return res.status(status).json({ error: error.status ? error.message : 'Словарь транслитераций временно недоступен.' });
  }
};
