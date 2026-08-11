require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { fetchAllDriverProfiles } = require("./lib/yandexClient");
const { analyzeDrivers, summarize } = require("./lib/problems");
const { answerQuestion } = require("./lib/chat");

const app = express();
app.use(cors());
app.use(express.json());

const CACHE_MS = (Number(process.env.CACHE_MINUTES) || 10) * 60 * 1000;
let cache = { data: null, fetchedAt: 0, error: null };

async function getAnalyzedDrivers({ force = false } = {}) {
  const fresh = cache.data && Date.now() - cache.fetchedAt < CACHE_MS;
  if (fresh && !force) return cache.data;

  const raw = await fetchAllDriverProfiles();
  const analyzed = analyzeDrivers(raw);
  cache = { data: analyzed, fetchedAt: Date.now(), error: null };
  return analyzed;
}

// Здоровье сервиса
app.get("/api/health", (req, res) => res.json({ ok: true }));

// Ручное обновление кэша из Yandex Fleet API
app.post("/api/drivers/refresh", async (req, res) => {
  try {
    const analyzed = await getAnalyzedDrivers({ force: true });
    res.json({ ok: true, count: analyzed.length, summary: summarize(analyzed) });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// Полный список + сводка
app.get("/api/drivers", async (req, res) => {
  try {
    const analyzed = await getAnalyzedDrivers();
    res.json({ drivers: analyzed, summary: summarize(analyzed) });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// Только проблемные
app.get("/api/drivers/problems", async (req, res) => {
  try {
    const analyzed = await getAnalyzedDrivers();
    res.json({
      drivers: analyzed.filter((d) => d.hasProblems),
      summary: summarize(analyzed),
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// Чат: диспетчер задаёт вопрос свободным текстом
app.post("/api/chat", async (req, res) => {
  const { question } = req.body || {};
  if (!question || typeof question !== "string") {
    return res.status(400).json({ ok: false, error: "Нужно поле 'question' (строка)" });
  }
  try {
    const analyzed = await getAnalyzedDrivers();
    const { label, results } = await answerQuestion(question, analyzed);
    res.json({ ok: true, label, count: results.length, drivers: results });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// Отладка: сырой ответ по одному водителю — используйте, чтобы найти
// точные названия полей документов для rules.config.js
app.get("/api/debug/raw-driver", async (req, res) => {
  try {
    const { fetchAllDriverProfiles: fetchRaw } = require("./lib/yandexClient");
    const raw = await fetchRaw();
    res.json(raw[0] || { note: "Список пуст" });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Fleet assistant backend запущен на порту ${PORT}`);
  console.log(`Проверка: http://localhost:${PORT}/api/health`);
});
