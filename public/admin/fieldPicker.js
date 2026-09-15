// public/admin/fieldPicker.js — пикер полей для конструктора бизнес-правил
// (Ethan, 9 сен 2026: "могу добавить такой же пикер в админку?" —
// портировано из public/settings/settings.js один в один, оба места
// используют одинаковые id элементов формы правил). Вынесено в отдельный
// модуль 15 сен 2026 (модуляризация по просьбе Ethan) — ruleFieldCatalog
// принимает данные параметрами (docTypes/docFields/customDocTypes/
// fieldOverrides), а не читает их из module-scope state, поэтому не
// завязан на конкретную страницу.

// Табличные типы (Ethan, 9 сен 2026, живой тест на /settings — тот же баг,
// портированный сюда бы, если бы не был исправлен здесь заранее): checkBusinessRules
// проверяет ТОЛЬКО fields, никогда items (построчную таблицу) — для табличных
// типов единственные fields это totals (см. docSchema.js), не columns.
export function ruleFieldCatalog({ docTypes, docFields, customDocTypes, fieldOverrides }) {
  const catalog = new Map();
  const types = new Set([...docTypes, ...Object.keys(customDocTypes)]);
  for (const type of types) {
    const docFieldsEntry = docFields[type];
    const isTable = docFieldsEntry && !Array.isArray(docFieldsEntry) && docFieldsEntry.mode === 'table';
    let fields;
    if (isTable) {
      fields = docFieldsEntry.totals || [];
    } else {
      const schema = fieldOverrides[type] || customDocTypes[type]?.fields || docFieldsEntry || [];
      fields = Array.isArray(schema) ? schema : [];
    }
    for (const field of fields) {
      if (!catalog.has(field)) catalog.set(field, []);
      catalog.get(field).push(type);
    }
  }
  return catalog;
}

export function makeSearchablePicker(picker, placeholder) {
  const labels = Array.from(picker.querySelectorAll('label'));
  const details = document.createElement('details');
  details.className = 'admin-picker-dropdown';
  details.open = picker.dataset.open === 'true';
  const summary = document.createElement('summary');
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'admin-input';
  search.placeholder = placeholder;
  search.setAttribute('aria-label', placeholder);
  search.value = picker.dataset.search || '';
  const list = document.createElement('div');
  list.className = 'admin-picker-options';
  labels.forEach(label => list.appendChild(label));
  const empty = document.createElement('p');
  empty.className = 'admin-note';
  empty.textContent = 'Ничего не найдено. Попробуйте другое название.';
  empty.setAttribute('role', 'status');
  const normalize = value => value.toLocaleLowerCase('ru').replace(/ё/g, 'е').trim();
  const filter = () => {
    const terms = normalize(search.value).split(/\s+/).filter(Boolean);
    picker.dataset.search = search.value;
    labels.forEach(label => {
      label.hidden = !terms.every(term => normalize(label.textContent).includes(term));
    });
    empty.hidden = labels.some(label => !label.hidden);
  };
  const updateSummary = () => {
    const selected = labels.filter(label => label.querySelector('input').checked);
    summary.textContent = selected.length
      ? selected.map(label => label.querySelector('span').firstChild.textContent).join(', ')
      : 'Выберите из списка';
  };
  search.addEventListener('input', filter);
  list.addEventListener('change', updateSummary);
  details.addEventListener('toggle', () => { picker.dataset.open = String(details.open); });
  details.addEventListener('keydown', event => {
    if (event.key === 'Escape') { details.open = false; summary.focus(); }
  });
  details.append(summary, search, list, empty);
  picker.appendChild(details);
  filter();
  updateSummary();
}

// inputEls — массив полей формы правил (ruleBaseField, ruleValueField, ...);
// multipleInput — который из них допускает несколько значений (ruleSumFields,
// сравнение по ссылке — тот же приём, что был инлайн в admin.js: `input ===
// ruleSumFields`, здесь просто параметризован); catalog — результат
// ruleFieldCatalog(); splitFields — из format.js (чтобы не плодить ещё один
// импорт цепочкой, передаётся параметром).
export function refreshRuleFieldPickers(inputEls, multipleInput, catalog, splitFields) {
  for (const input of inputEls) {
    const multiple = input === multipleInput;
    const selected = multiple ? splitFields(input.value) : input.value ? [input.value] : [];
    input.type = 'hidden';
    let picker = document.getElementById(input.id + 'Picker');
    if (!picker) {
      picker = document.createElement('fieldset');
      picker.id = input.id + 'Picker';
      picker.className = 'admin-field-picker';
      input.after(picker);
    }
    picker.replaceChildren();
    const legend = document.createElement('legend');
    legend.textContent = multiple ? 'Выберите одно или несколько полей' : 'Выберите одно поле';
    picker.appendChild(legend);
    const options = new Map(catalog);
    selected.forEach(field => { if (!options.has(field)) options.set(field, []); });
    for (const [field, types] of options) {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = field;
      checkbox.checked = selected.includes(field);
      const text = document.createElement('span');
      text.textContent = field;
      const source = document.createElement('small');
      source.textContent = types.length ? types.join(', ') : 'Поле удалено из списка документов — проверьте правило';
      text.appendChild(source);
      label.append(checkbox, text);
      picker.appendChild(label);
      checkbox.addEventListener('change', () => {
        if (!multiple && checkbox.checked) {
          picker.querySelectorAll('input').forEach(other => { if (other !== checkbox) other.checked = false; });
        }
        input.value = Array.from(picker.querySelectorAll('input:checked'), el => el.value).join(', ');
      });
    }
    makeSearchablePicker(picker, 'Поиск по названию поля или типу документа');
  }
}
