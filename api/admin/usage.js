const { checkAdminSecret } = require('../../lib/adminAuth');
const { getUsageSummary } = require('../../lib/usageAnalytics');

// Аналитика использования по клиенту — только для админки (Ethan, 7 сен 2026,
// "В /admin — только вы, когда открываете карточку клиента"). Отдельный
// read-only эндпоинт, а не поле в ответе api/admin/clients.js — тот отдаёт
// список всех клиентов сразу (список сводок на каждый рендер таблицы был бы
// N лишних RPC-вызовов), тогда как сводка нужна только когда карточка ОДНОГО
// клиента открыта (см. admin.js:openForm).
//
// GET /api/admin/usage?id=<uuid клиента из tamga_api_key_fields>&days=30
// Заголовок x-admin-secret обязателен (см. lib/adminAuth.js).
//
// Ответ: { summary: {...} | null } — null значит "нет данных за период"
// (включая случай, когда Supabase недоступен — см. lib/usageAnalytics.js,
// это read-side тоже fail-safe, не 500).
module.exports = async (req, res) => {
  const auth = checkAdminSecret(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.message });
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Метод не поддерживается' });
    return;
  }

  const id = req.query && req.query.id;
  if (!id) {
    res.status(400).json({ error: 'Нужен ?id=<uuid клиента>' });
    return;
  }
  const days = Math.max(1, Math.min(90, Number(req.query.days) || 30));

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: 'Supabase не настроен на сервере (нет SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY)' });
    return;
  }

  try {
    // Строка клиента может иметь И api_key, И client_slug — оба канала нужны,
    // чтобы посчитать полную картину (см. lib/usageAnalytics.js:getUsageSummary).
    const r = await fetch(`${supabaseUrl}/rest/v1/tamga_api_key_fields?id=eq.${encodeURIComponent(id)}&select=api_key,client_slug`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    });
    const rows = await r.json();
    if (!r.ok) throw new Error(typeof rows === 'object' ? JSON.stringify(rows) : String(rows));
    if (!rows.length) {
      res.status(404).json({ error: 'Клиент с таким id не найден' });
      return;
    }
    const { api_key: apiKey, client_slug: clientSlug } = rows[0];
    const summary = await getUsageSummary({ apiKey, clientSlug, days });
    res.status(200).json({ summary, days });
  } catch (err) {
    console.error('admin/usage error:', err);
    res.status(500).json({ error: 'Ошибка Supabase: ' + err.message });
  }
};
