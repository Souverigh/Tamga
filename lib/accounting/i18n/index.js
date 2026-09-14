// Рендер message_key → текст. §0 хендовера: правила отдают структурированные
// {message_key, params}, эта функция — единственное место, которое знает про
// язык. Сегодня только ru.json; ky.json/en.json добавляются как файлы рядом,
// без изменений в rules/* (те работают только с ключами, никогда со строками).

const DICTIONARIES = { ru: require('./ru.json') };
const DEFAULT_LANG = 'ru';

function render(messageKey, params = {}, lang = DEFAULT_LANG) {
  const dict = DICTIONARIES[lang] || DICTIONARIES[DEFAULT_LANG];
  const template = dict[messageKey];
  if (!template) return messageKey; // ключ без перевода — лучше видимый пробел, чем падение
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in params ? String(params[key]) : match));
}

function availableLanguages() {
  return Object.keys(DICTIONARIES);
}

module.exports = { render, availableLanguages, DEFAULT_LANG };
