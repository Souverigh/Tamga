const { getClientConfig } = require('./customFieldsLookup');
const { requireClientSettingsAuth } = require('./clientAuth');

async function requirePaidTranslationClient(req, slug) {
  if (!slug) throw Object.assign(new Error('Перевод и шаблоны доступны только платным клиентам после входа.'), {status:403});
  if (typeof slug !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(slug)) throw Object.assign(new Error('Некорректный клиент.'),{status:400});
  // Existing product model: a configured client owns a paid page package.
  // Never infer entitlement from a caller-supplied flag or from the slug alone.
  const config = await getClientConfig({clientSlug:slug,fresh:true});
  if (!config) throw Object.assign(new Error('Для перевода необходим платный клиентский пакет.'),{status:403});
  const gate = requireClientSettingsAuth({clientSlug:slug,passwordHash:config.passwordHash,token:req.headers?.['x-client-token']});
  if (!gate.ok) throw Object.assign(new Error(gate.message),{status:gate.status});
  return slug;
}
module.exports = {requirePaidTranslationClient};
