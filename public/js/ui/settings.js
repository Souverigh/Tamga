// Настройки распознавания: переключение видимости выбора языка —
// Gemini сам разбирает язык, ручной выбор ему не нужен.

const modeSelect = document.getElementById('modeSelect');
const langSelect = document.getElementById('langSelect');

export function initSettings() {
  modeSelect.querySelectorAll('input[name="mode"]').forEach(el => {
    el.addEventListener('change', () => {
      const isGemini = document.querySelector('input[name="mode"]:checked').value === 'gemini';
      langSelect.style.display = isGemini ? 'none' : 'block';
    });
  });
}

export function getSelectedMode() {
  return document.querySelector('input[name="mode"]:checked').value;
}

export function getSelectedLang() {
  return document.querySelector('input[name="lang"]:checked').value;
}
