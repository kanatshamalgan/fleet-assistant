const rules = require("./rules.config");

function getByPath(obj, path) {
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function daysBetween(a, b) {
  return Math.round((a - b) / (1000 * 60 * 60 * 24));
}

/**
 * Принимает "сырые" объекты водителей из Yandex Fleet API и возвращает
 * структурированный список проблем по каждому.
 */
function analyzeDrivers(rawDrivers) {
  const now = Date.now();

  return rawDrivers.map((raw) => {
    const dp = raw.driver_profile || {};
    const name = [dp.last_name, dp.first_name, dp.middle_name].filter(Boolean).join(" ");
    const problems = [];

    // --- Неактивность ---
    const workStatus = dp.work_status; // ожидаемые значения: working / not_working / suspended (сверьте у себя)
    if (workStatus && workStatus !== "working") {
      problems.push({
        type: "inactive",
        severity: workStatus === "suspended" ? "high" : "medium",
        label:
          workStatus === "suspended"
            ? "Заблокирован/приостановлен"
            : "Не работает (не на линии)",
      });
    }

    // --- Баланс (если используете как индикатор) ---
    const balance = raw.account && raw.account.balance != null ? Number(raw.account.balance) : null;
    if (balance != null && balance < rules.LOW_BALANCE_THRESHOLD) {
      problems.push({
        type: "low_balance",
        severity: "low",
        label: `Низкий баланс (${balance})`,
      });
    }

    // --- Документы (только если настроены пути в rules.config.js) ---
    rules.DOCUMENT_FIELD_PATHS.forEach((docRule) => {
      const value = getByPath(raw, docRule.path);
      if (!value) {
        problems.push({
          type: "document_missing",
          severity: "high",
          label: `${docRule.label}: нет данных / не подписан`,
        });
        return;
      }
      if (docRule.warnDaysBefore != null) {
        const expiry = new Date(value).getTime();
        if (!Number.isNaN(expiry)) {
          const daysLeft = daysBetween(expiry, now);
          if (daysLeft < 0) {
            problems.push({
              type: "document_expired",
              severity: "high",
              label: `${docRule.label}: срок истёк ${-daysLeft} дн. назад`,
            });
          } else if (daysLeft <= docRule.warnDaysBefore) {
            problems.push({
              type: "document_expiring",
              severity: "medium",
              label: `${docRule.label}: истекает через ${daysLeft} дн.`,
            });
          }
        }
      }
    });

    return {
      id: dp.id || raw.driver_id || raw.id,
      name: name || "(без имени)",
      phone: (dp.phones && dp.phones[0]) || null,
      workStatus: workStatus || "unknown",
      car: raw.car ? `${raw.car.model || ""} ${raw.car.number || ""}`.trim() : null,
      balance,
      problems,
      hasProblems: problems.length > 0,
      documentsConfigured: rules.DOCUMENT_FIELD_PATHS.length > 0,
    };
  });
}

function summarize(analyzed) {
  const byType = {};
  analyzed.forEach((d) => {
    d.problems.forEach((p) => {
      byType[p.type] = (byType[p.type] || 0) + 1;
    });
  });
  return {
    total: analyzed.length,
    withProblems: analyzed.filter((d) => d.hasProblems).length,
    clean: analyzed.filter((d) => !d.hasProblems).length,
    byType,
    documentsConfigured: rules.DOCUMENT_FIELD_PATHS.length > 0,
  };
}

module.exports = { analyzeDrivers, summarize };
