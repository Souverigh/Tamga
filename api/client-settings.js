const { getClientConfig, clearConfigCache } = require('../lib/customFieldsLookup');
const { requireClientSettingsAuth } = require('../lib/clientAuth');
const { validateFieldOverrides, validateCustomDocTypes, validateBusinessRules, validateBranding } = require('../lib/clientConfigValidation');

// GET/PATCH /api/client-settings?slug=acme — самообслуживание клиента (Ethan,
// 8 сен 2026: "чтобы клиенты сами меняли поля/добавляли типы документов/
// настраивали бизнес-правила"), в дополнение к /admin (там — Ethan, доступ
// ко ВСЕМ клиентам сразу; здесь — сам клиент, доступ ТОЛЬКО к своей строке,
// по client_slug из query, никогда по id).
//
// Заголовок x-client-token обязателен ВСЕГДА (см. lib/clientAuth.js:
// requireClientSettingsAuth) — сознательно строже, чем гейт самого инструмента
// распознавания (там отсутствие пароля означает "гейта нет вообще"). Здесь
// так нельзя: это запись в конфигурацию клиента, а не чтение — без пароля
// доступ к настройкам закрыт целиком, а не открыт по умолчанию.
//
// Что можно менять самому клиенту (согласовано с Ethan явно, 8 сен 2026):
// - field_overrides — свои названия полей для стандартных типов документов
// - custom_doc_types — свои типы документов целиком
// - formatting.businessRules — свои условия проверки (только percentage_match,
//   см. public/js/postprocess/businessRules.js)
// - display_name / logo_url / accent_color — свой брендинг
// Всё остальное (api_key, page_limit, pages_used, access_password_hash,
// formatting.webhookUrl/webhookSecret/maxConcurrency/dateFormat/decimalSeparator)
// остаётся доступно ТОЛЬКО через /admin — этот эндпоинт их не читает и не пишет.
//
// businessRules хранится ВНУТРИ formatting (общий JSONB с вебхуком/приоритетом,
// см. lib/customFieldsLookup.js) — чтобы не задеть чужие ключи при сохранении,
// делаем read-modify-write: берём АКТУАЛЬНУЮ (не из 60-секундного кэша —
// PATCH должен видеть свежее состояние, не то, что закэшировано с прошлого
// чтения) строку напрямую из Supabase, меняем только businessRules, остальные
// ключи formatting (вебхук и т.п., если Ethan их задал через /admin) остаются
// как были.

function supabaseHeaders(serviceKey, extra) {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', ...extra };
}

async function fetchRawRow(supabaseUrl, serviceKey, clientSlug) {
  const url = `${supabaseUrl}/rest/v1/tamga_api_key_fields?client_slug=eq.${encodeURIComponent(clientSlug)}&select=field_overrides,custom_doc_types,formatting,display_name,logo_url,accent_color,access_password_hash&limit=1`;
  const r = await fetch(url, { headers: supabaseHeaders(serviceKey) });
  const data = await r.json();
  if (!r.ok) throw new Error(typeof data === 'object' ? JSON.stringify(data) : String(data));
  return Array.isArray(data) && data.length ? data[0] : null;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'PATCH') {
    res.status(405).json({ error: 'Метод не поддерживается, используйте GET или PATCH' });
    return;
  }

  const clientSlug = (req.query && req.query.slug || '').trim();
  if (!clientSlug) {
    res.status(400).json({ error: 'Нужен ?slug=<client_slug>' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: 'Supabase не настроен на сервере' });
    return;
  }

  try {
    // passwordHash берём через getClientConfig (кэш допустим здесь — это
    // только проверка "пароль вообще задан?", не сама запись).
    const config = await getClientConfig({ clientSlug });
    const auth = requireClientSettingsAuth({
      clientSlug,
      passwordHash: config ? config.passwordHash : null,
      token: req.headers['x-client-token']
    });
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.message });
      return;
    }

    if (req.method === 'GET') {
      res.status(200).json({
        fieldOverrides: config.fieldOverrides || null,
        customDocTypes: config.customDocTypes || null,
        businessRules: config.businessRules || [],
        displayName: config.displayName || null,
        logoUrl: config.logoUrl || null,
        accentColor: config.accentColor || null
      });
      return;
    }

    // PATCH — сначала валидируем ВСЁ присланное, ничего не пишем, если
    // хоть одно поле не прошло проверку (частичная запись при ошибке была бы
    // хуже, чем явный отказ целиком).
    const body = req.body || {};
    const updates = {};

    if ('field_overrides' in body) {
      const { error, value } = validateFieldOverrides(body.field_overrides);
      if (error) { res.status(400).json({ error }); return; }
      updates.field_overrides = value;
    }
    if ('custom_doc_types' in body) {
      const { error, value } = validateCustomDocTypes(body.custom_doc_types);
      if (error) { res.status(400).json({ error }); return; }
      updates.custom_doc_types = value;
    }
    let newBusinessRules = null;
    if ('business_rules' in body) {
      const { error, value } = validateBusinessRules(body.business_rules);
      if (error) { res.status(400).json({ error }); return; }
      newBusinessRules = value; // [] допустимо (явно "правил больше нет")
    }
    const brandingKeys = ['display_name', 'logo_url', 'accent_color'].filter(k => k in body);
    let branding = {};
    if (brandingKeys.length) {
      const { error, value } = validateBranding({
        displayName: body.display_name,
        logoUrl: body.logo_url,
        accentColor: body.accent_color
      });
      if (error) { res.status(400).json({ error }); return; }
      if ('displayName' in value) branding.display_name = value.displayName;
      if ('logoUrl' in value) branding.logo_url = value.logoUrl;
      if ('accentColor' in value) branding.accent_color = value.accentColor;
    }

    // formatting.businessRules — read-modify-write НАПРЯМУЮ из Supabase (не из
    // кэша getClientConfig), см. комментарий в начале файла.
    if (newBusinessRules !== null) {
      const rawRow = await fetchRawRow(supabaseUrl, serviceKey, clientSlug);
      const currentFormatting = (rawRow && rawRow.formatting && typeof rawRow.formatting === 'object') ? { ...rawRow.formatting } : {};
      if (newBusinessRules.length) currentFormatting.businessRules = newBusinessRules;
      else delete currentFormatting.businessRules;
      updates.formatting = Object.keys(currentFormatting).length ? currentFormatting : null;
    }

    Object.assign(updates, branding);

    if (!Object.keys(updates).length) {
      res.status(400).json({ error: 'Нечего сохранять — не передано ни одно из полей' });
      return;
    }

    updates.updated_at = new Date().toISOString();
    const r = await fetch(`${supabaseUrl}/rest/v1/tamga_api_key_fields?client_slug=eq.${encodeURIComponent(clientSlug)}`, {
      method: 'PATCH',
      headers: supabaseHeaders(serviceKey, { Prefer: 'return=representation' }),
      body: JSON.stringify(updates)
    });
    const data = await r.json();
    if (!r.ok) throw new Error(typeof data === 'object' ? JSON.stringify(data) : String(data));
    if (!data.length) { res.status(404).json({ error: 'Клиент не найден' }); return; }

    clearConfigCache(); // следующее распознавание/чтение настроек должно увидеть новые значения сразу, не ждать TTL

    const saved = data[0];
    res.status(200).json({
      fieldOverrides: saved.field_overrides || null,
      customDocTypes: saved.custom_doc_types || null,
      businessRules: (saved.formatting && Array.isArray(saved.formatting.businessRules)) ? saved.formatting.businessRules : [],
      displayName: saved.display_name || null,
      logoUrl: saved.logo_url || null,
      accentColor: saved.accent_color || null
    });
  } catch (err) {
    console.error('client-settings error:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
};
