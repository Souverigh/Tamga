// public/admin/accounting/fileQueue.js — batch-состояние выбранных файлов,
// вынесено из accounting.js 15 сен 2026 (модуляризация по просьбе Ethan).
// Никакого DOM здесь — только преобразование File[] в состояние документов
// и base64-кодирование, чтобы это можно было переиспользовать (или
// протестировать) отдельно от рендеринга/сети.

// Один элемент на выбранный файл:
//   { file: File, status: 'pending'|'recognizing'|'done'|'error',
//     result: <ответ admin-recognize> | null, error: string | null }
export function createDocsFromFiles(fileList) {
  return Array.from(fileList).map(file => ({ file, status: 'pending', result: null, error: null }));
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
