const fetch = require("node-fetch");

/**
 * Ищет водителей по имени/фамилии/отчеству, упомянутым в вопросе.
 * Сопоставление идёт по токенам (частям ФИО), а не по произвольной
 * подстроке, чтобы обычные слова вопроса не давали случайных совпадений.
 */
function searchByName(question, analyzed) {
  const qWords = question
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3);

  if (!qWords.length) return [];

  return analyzed.filter((d) => {
    const nameParts = d.name.toLowerCase().split(/\s+/).filter(Boolean);
    return qWords.some((w) =>
      nameParts.some((part) => part.startsWith(w) || w.startsWith(part))
    );
  });
}

/**
 * Простой rule-based разбор вопроса диспетчера — работает без каких-либо
 * доп. ключей. Если задан ANTHROPIC_API_KEY, используем Claude, чтобы
 * понимать вопросы сформулированные свободно, а не только по ключевым словам.
 */
function ruleBasedFilter(question, analyzed) {
  const q = question.toLowerCase();
  let results = analyzed;
  let label = "Все водители";
  let matched = true;

  if (/докум|подпис|прав[а-я]{0,3}\b/.test(q)) {
    results = analyzed.filter((d) =>
      d.problems.some((p) => p.type.startsWith("document"))
    );
    label = "Проблемы с документами";
  } else if (/не (работа|выход|актив)|неактив|офлайн|заблокир|приостановл/.test(q)) {
    results = analyzed.filter((d) => d.problems.some((p) => p.type === "inactive"));
    label = "Неактивные водители";
  } else if (/актив|на линии|работа(ющ)?|онлайн/.test(q)) {
    results = analyzed.filter((d) => d.workStatus === "working");
    label = "Активные водители (на линии)";
  } else if (/баланс|долг|минус/.test(q)) {
    results = analyzed.filter((d) => d.problems.some((p) => p.type === "low_balance"));
    label = "Низкий баланс";
  } else if (/проблем/.test(q)) {
    results = analyzed.filter((d) => d.hasProblems);
    label = "Все водители с проблемами";
  } else if (/без проблем|чист|ок\b|все хорошо/.test(q)) {
    results = analyzed.filter((d) => !d.hasProblems);
    label = "Без проблем";
  } else {
    matched = false;
  }

  // Если вопрос не попал ни в одну из категорий выше (или даже если попал,
  // но явно похож на поиск конкретного человека), пробуем найти по имени.
  if (!matched) {
    const nameMatches = searchByName(question, analyzed);
    if (nameMatches.length) {
      results = nameMatches;
      label = `Поиск по имени: "${question.trim()}"`;
    }
  }

  return { label, results };
}

async function claudeFilter(question, analyzed) {
  const compact = analyzed.map((d) => ({
    id: d.id,
    name: d.name,
    workStatus: d.workStatus,
    balance: d.balance,
    problemTypes: d.problems.map((p) => p.type),
  }));

  const system = `Ты — помощник диспетчера таксопарка. Тебе дан список водителей в JSON
и вопрос диспетчера на русском/казахском. Верни ТОЛЬКО JSON вида:
{"label": "краткое название выборки", "ids": ["id1","id2", ...]}
ids — это id водителей из списка, которые отвечают на вопрос диспетчера.
Если в вопросе упомянуто имя, фамилия или отчество (например "найди Иванова"
или просто "Иванов"), ищи совпадения по полю name (учитывай возможные
неточности и падежи). Ничего кроме JSON не пиши.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system,
      messages: [
        {
          role: "user",
          content: `Водители: ${JSON.stringify(compact)}\n\nВопрос: ${question}`,
        },
      ],
    }),
  });

  if (!res.ok) throw new Error(`Claude API error ${res.status}`);
  const data = await res.json();
  const text = data.content.map((b) => b.text || "").join("");
  const clean = text.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(clean);
  const idSet = new Set(parsed.ids || []);
  return {
    label: parsed.label || "Результат",
    results: analyzed.filter((d) => idSet.has(d.id)),
  };
}

async function answerQuestion(question, analyzed) {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await claudeFilter(question, analyzed);
    } catch (e) {
      console.error("Claude NLU failed, falling back to rules:", e.message);
    }
  }
  return ruleBasedFilter(question, analyzed);
}

module.exports = { answerQuestion, ruleBasedFilter, searchByName };
