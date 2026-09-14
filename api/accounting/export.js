const { buildAccountingWorkbook } = require('../../lib/accounting/export');
const { checkAdminSecret } = require('../../lib/adminAuth');
const { readRequestBody } = require('../../lib/multipart');

// POST /api/accounting/export — тот же гейт (x-admin-secret), что у
// admin-recognize.js: этот endpoint дергается только с review-экрана
// (public/admin/accounting.html), не публичный API.
//
// Тело запроса — РОВНО та форма, что уже вернул /api/accounting/admin-recognize
// клиенту (см. комментарий в lib/accounting/export.js): { doc_type, header,
// items, overall_status, validation, file_name? }. Сервер по новой ничего не
// распознаёт и не лезет в Supabase — экспортирует то же самое, что бухгалтер
// уже видит на экране.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Метод не поддерживается, используйте POST' });
    return;
  }

  const auth = await checkAdminSecret(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.message });
    return;
  }

  try {
    const body = await readRequestBody(req);
    const { doc_type: docType, header, items, overall_status: overallStatus, validation, file_name: fileName } = body;

    if (!header || !Array.isArray(items)) {
      res.status(400).json({ error: 'Поля "header" и "items" обязательны' });
      return;
    }

    const workbook = buildAccountingWorkbook([{ docType, header, items, overallStatus, validation, fileName }]);
    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="accounting-export-${Date.now()}.xlsx"`);
    res.status(200).send(Buffer.from(buffer));
  } catch (error) {
    console.error('[accounting/export] unexpected error:', error);
    res.status(500).json({ error: 'Не удалось сформировать Excel-файл' });
  }
};
