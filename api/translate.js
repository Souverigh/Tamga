const { validateTranslationRequest, translateSegments } = require('../lib/translation');
const { consumeTranslationQuota } = require('../lib/translationQuota');
const { requirePaidTranslationClient } = require('../lib/translationAccess');

module.exports = async (req,res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.method !== 'POST') return res.status(405).json({error:'Используйте POST.'});
  try {
    if (!req.body || typeof req.body !== 'object' || JSON.stringify(req.body).length > 20000) return res.status(413).json({error:'Слишком большой запрос.'});
    const request = validateTranslationRequest(req.body);
    const slug = await requirePaidTranslationClient(req,req.body.clientSlug);
    await consumeTranslationQuota({identity:`client:${slug}`,authenticated:true});
    const result = await translateSegments(request);
    return res.status(200).json(result);
  } catch (error) {
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 503;
    return res.status(status).json({error:error.status ? error.message : 'Перевод временно недоступен. Попробуйте позже.'});
  }
};
