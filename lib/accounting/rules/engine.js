// Движок правил — §10/§11 хендовера. НЕ переиспользует и не изменяет
// lib/postprocess/businessRules.js (тот остаётся как есть для не-бухгалтерских
// клиентов Tamga) — параллельная, отдельная реализация.
//
// Правило (rule definition):
//   {
//     id: 'INV-004',
//     category: 'MATHEMATICAL' | 'DOCUMENT_CONSISTENCY' | 'REGULATORY' | 'CROSS_DOCUMENT',
//     severity: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL',
//     source: { name, version, effectiveFrom, effectiveTo, lastVerifiedAt } | null,  // §3, только для REGULATORY
//     check(doc) => Array<{ status, message_key, params }> | { status, message_key, params }
//   }
// doc — нормализованный документ (сырые provenance-поля + normalized через
// normalization.js), собирается в extraction-слое перед вызовом runRules.
//
// В отличие от businessRules.js (только warnings, ничего не сообщает про
// пройденные проверки), runRules возвращает запись ПО КАЖДОМУ правилу —
// PASS тоже результат, не только нарушения (§11: "Missing data must not
// produce a false PASS" — поэтому check() обязан явно отдать
// INSUFFICIENT_DATA, а не PASS, когда данных не хватает).

const STATUSES = ['PASS', 'FAILED', 'WARNING', 'NOT_APPLICABLE', 'INSUFFICIENT_DATA'];
const SEVERITIES = ['INFO', 'WARNING', 'ERROR', 'CRITICAL'];

function runRules(ruleDefs, doc) {
  const results = [];
  for (const rule of ruleDefs) {
    let outcomes;
    try {
      outcomes = rule.check(doc);
    } catch (err) {
      // Правило не должно ронять весь прогон — фиксируем как INSUFFICIENT_DATA
      // с техническим сообщением, а не глотаем молча.
      outcomes = [{ status: 'INSUFFICIENT_DATA', message_key: 'accounting.invoice.insufficient_data', params: { rule: rule.id } }];
    }
    if (!outcomes) outcomes = [{ status: 'NOT_APPLICABLE', message_key: null, params: {} }];
    if (!Array.isArray(outcomes)) outcomes = [outcomes];

    for (const outcome of outcomes) {
      results.push({
        rule_id: rule.id,
        category: rule.category,
        severity: outcome.status === 'PASS' || outcome.status === 'NOT_APPLICABLE' ? null : rule.severity,
        status: outcome.status,
        message_key: outcome.message_key,
        params: outcome.params || {},
        source: rule.source || null
      });
    }
  }
  return results;
}

// Итоговый статус документа: самый строгий из непройденных проверок.
// PASS/NOT_APPLICABLE/INSUFFICIENT_DATA-only набор → PASS, если нет ни одной
// INSUFFICIENT_DATA (иначе документ в целом недопроверен — не PASS).
function overallStatus(results) {
  const statuses = results.map(r => r.status);
  if (statuses.includes('FAILED')) return 'FAILED';
  if (statuses.includes('INSUFFICIENT_DATA')) return 'INSUFFICIENT_DATA';
  if (statuses.includes('WARNING')) return 'WARNING';
  return 'PASS';
}

module.exports = { runRules, overallStatus, STATUSES, SEVERITIES };
