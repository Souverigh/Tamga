// public/admin/chipEditor.js — переиспользуемый редактор списка полей: чипы
// с крестиком + добавление своего значения + (опционально) кнопки-подсказки
// из стандартной схемы типа. Вынесено из admin.js 15 сен 2026 (Ethan: "не
// хранить всё в одном файле, разбить на модульные сегменты"). Полностью
// самодостаточный — не зависит ни от state, ни от других модулей админки,
// используется в трёх местах admin.js (переопределения полей, кастомные
// типы, устаревшее общее поле fields) без изменений.

export function createChipEditor(container, initialValues) {
  container.innerHTML = '';
  let values = [...(initialValues || [])];

  const selectedRow = document.createElement('div');
  selectedRow.className = 'admin-chip-editor-selected';
  const addRow = document.createElement('div');
  addRow.className = 'admin-chip-add-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'admin-input';
  input.placeholder = 'Своё поле — введите название и нажмите «Добавить»';
  const addBtn = document.createElement('button');
  addBtn.className = 'btn-secondary';
  addBtn.type = 'button';
  addBtn.textContent = 'Добавить';
  addRow.appendChild(input);
  addRow.appendChild(addBtn);
  const suggestionsRow = document.createElement('div');
  suggestionsRow.className = 'admin-chip-suggestions';

  container.appendChild(selectedRow);
  container.appendChild(addRow);
  container.appendChild(suggestionsRow);

  let suggestions = [];

  function renderSelected() {
    selectedRow.innerHTML = '';
    values.forEach(v => {
      const chip = document.createElement('span');
      chip.className = 'admin-chip';
      const text = document.createElement('span');
      text.textContent = v;
      chip.appendChild(text);
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = '×';
      removeBtn.title = 'Убрать поле';
      removeBtn.addEventListener('click', () => {
        values = values.filter(x => x !== v);
        renderSelected();
        renderSuggestions();
      });
      chip.appendChild(removeBtn);
      selectedRow.appendChild(chip);
    });
  }

  function renderSuggestions() {
    suggestionsRow.innerHTML = '';
    suggestions.filter(s => !values.includes(s)).forEach(s => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'admin-chip-suggestion';
      btn.textContent = '+ ' + s;
      btn.addEventListener('click', () => {
        values.push(s);
        renderSelected();
        renderSuggestions();
      });
      suggestionsRow.appendChild(btn);
    });
  }

  function addFromInput() {
    const v = input.value.trim();
    if (!v || values.includes(v)) { input.value = ''; return; }
    values.push(v);
    input.value = '';
    renderSelected();
    renderSuggestions();
  }
  addBtn.addEventListener('click', addFromInput);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addFromInput(); } });

  renderSelected();

  return {
    getValues: () => values,
    setSuggestions: (list) => { suggestions = list || []; renderSuggestions(); }
  };
}
