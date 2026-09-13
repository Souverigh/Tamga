const { validateTranslationRequest, translateSegments } = require('../lib/translation');
const { consumeTranslationQuota } = require('../lib/translationQuota');
const { getClientConfig } = require('../lib/customFieldsLookup');
const { requireClientSettingsAuth } = require('../lib/clientAuth');
const { extractClientIp } = require('../lib/anonymousUsage');

module.exports = async (req,res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.method !== 'POST') return res.status(405).json({error:'Используйте POST.'});
  try {
    if (!req.body || typeof req.body !== 'object' || JSON.stringify(req.body).length > 20000) return res.status(413).json({error:'Слишком большой запрос.'});
    const request = validateTranslationRequest(req.body);
    const slug = req.body.clientSlug;
    let authenticated = false;
    if (slug !== undefined && slug !== null && (typeof slug !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(slug))) return res.status(400).json({error:'Некорректный клиент.'});
    if (slug) {
      const config = await getClientConfig({clientSlug:slug,fresh:true});
      if (config?.passwordHash) {
        const gate = requireClientSettingsAuth({clientSlug:slug,passwordHash:config.passwordHash,token:req.headers['x-client-token']});
        if (!gate.ok) return res.status(gate.status).json({error:gate.message});
        authenticated = true;
      }
    }
    await consumeTranslationQuota({identity:authenticated?`client:${slug}`:`ip:${extractClientIp(req)}`,authenticated});
    const result = await translateSegments(request);
    return res.status(200).json(result);
  } catch (error) {
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 503;
    return res.status(status).json({error:error.status ? error.message : 'Перевод временно недоступен. Попробуйте позже.'});
  }
};
