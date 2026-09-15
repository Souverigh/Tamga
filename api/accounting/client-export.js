const { buildAccountingWorkbook } = require('../../lib/accounting/export');
const { requirePaidAccountingClient } = require('../../lib/accounting/clientAccess');
const { readRequestBody } = require('../../lib/multipart');

// POST /api/accounting/client-export — экспорт в Excel для клиентской
// веб-панели (public/js/accounting/panel.js), рядом с уже существующим
// /api/accounting/export (тот — под x-admin-secret, только для
// public/admin/accounting.html). Логика формирования файла ОДНА и та же
// (lib/accounting/export.js) — отдельный файл здесь только ради гейта
// (requirePaidAccountingClient вместо checkAdminSecret), тот же принцип
// "свой периметр — свой тонкий эндпоинт", что у admin-recognize.js/
// recognize.js.
//
// Тело — та же форма, что у /api/accounting/export: { documents: [...] }
// или один документ, ровно то, что вернул /api/accounting/client-recognize
// (плюс необязательный file_name). Ничего не распознаёт и не пишет в
// Supabase — только собирает .xlsx из уже показанных клиенту данных.
function normalizeDocument(raw) {
  const { doc_type: docType, header, items, overall_status: overallStatus, validation, file_name: fileName } = raw || {};
  return { docType, header, items, overallStatus, validation, fileName };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Метод не поддерживается, используйте POST' });
    return;
  }

  try {
    const body = await readRequestBody(req);
    await requirePaidAccountingClient(req, body.clientSlug);

    const documents = Array.isArray(body.documents) ? body.documents.map(normalizeDocument) : [normalizeDocument(body)];

    if (documents.length === 0) {
      res.status(400).json({ error: 'Нет ни одного документа для экспорта' });
      return;
    }
    for (const doc of documents) {
      if (!doc.header || !Array.isArray(doc.items)) {
        res.status(400).json({ error: 'У каждого документа обязательны поля "header" и "items"' });
        return;
      }
    }

    const workbook = buildAccountingWorkbook(documents);
    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="accounting-export-${Date.now()}.xlsx"`);
    res.status(200).send(Buffer.from(buffer));
  } catch (error) {
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
    if (status !== 500) {
      res.status(status).json({ error: error.message });
      return;
    }
    console.error('[accounting/client-export] unexpected error:', error);
    res.status(500).json({ error: 'Не удалось сформировать Excel-файл' });
  }
};
