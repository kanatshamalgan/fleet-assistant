require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { fetchAllDriverProfiles, createCar, createDriverProfile } = require("./lib/yandexClient");
const { analyzeDrivers, summarize } = require("./lib/problems");
const { answerQuestion } = require("./lib/chat");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(require("path").join(__dirname, "public")));

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

// Создание машины + профиля водителя в Yandex Fleet.
// Схема запроса подтверждена частично (см. комментарии в lib/yandexClient.js);
// если Yandex отклонит запрос как невалидный, точная причина возвращается
// диспетчеру текстом — по ней поля можно быстро поправить.
app.post("/api/drivers/create", async (req, res) => {
  const { driver, car } = req.body || {};
  if (!driver || !driver.lastName || !driver.firstName || !driver.phone || !driver.license || !driver.license.number) {
    return res.status(400).json({ ok: false, error: "Нужны фамилия, имя, телефон и серия/номер ВУ водителя" });
  }
  if (!car || !car.brand || !car.model || !car.number) {
    return res.status(400).json({ ok: false, error: "Нужны марка, модель и гос. номер автомобиля" });
  }

  try {
    const carResult = await createCar(car);
    const carId = carResult.id || carResult.car_id || (carResult.car && carResult.car.id);
    if (!carId) {
      return res.status(502).json({
        ok: false,
        error: "Машина создана, но Yandex не вернул её id — привязать к водителю не удалось.",
        raw: carResult,
      });
    }

    const driverResult = await createDriverProfile(driver, carId);
    cache = { data: null, fetchedAt: 0, error: null };
    res.json({ ok: true, car: carResult, driver: driverResult });
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

// Отладка: сырой ответ по одной машине — используем, чтобы сверить точные
// названия полей (марка/модель/цвет/год) перед подключением создания машин.
app.get("/api/debug/raw-car", async (req, res) => {
  try {
    const { fetchAllCars } = require("./lib/yandexClient");
    const cars = await fetchAllCars();
    res.json(cars[0] || { note: "Список пуст" });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Fleet assistant backend запущен на порту ${PORT}`);
  console.log(`Проверка: http://localhost:${PORT}/api/health`);
});
