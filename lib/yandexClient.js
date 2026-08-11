const fetch = require("node-fetch");

const BASE = process.env.YANDEX_API_BASE || "https://fleet-api.taxi.yandex.net";

function headers() {
  const { YANDEX_CLIENT_ID, YANDEX_API_KEY, YANDEX_PARK_ID } = process.env;
  if (!YANDEX_CLIENT_ID || !YANDEX_API_KEY || !YANDEX_PARK_ID) {
    throw new Error(
      "Не заданы YANDEX_CLIENT_ID / YANDEX_API_KEY / YANDEX_PARK_ID в .env"
    );
  }
  return {
    "Content-Type": "application/json",
    "X-Client-ID": YANDEX_CLIENT_ID,
    "X-API-Key": YANDEX_API_KEY,
    "X-Park-ID": YANDEX_PARK_ID,
  };
}

/**
 * Тянет ВСЕ профили водителей постранично.
 * Endpoint подтверждён официальной документацией:
 * POST /v1/parks/driver-profiles/list
 *
 * "fields" ниже запрашивает основные блоки. Если в вашем ответе
 * нужны доп. поля (например по документам/правам), добавьте их сюда —
 * список полей смотрите в личном кабинете fleet.yandex.kz в разделе
 * документации API вашего парка, он привязан к вашему тарифу/региону.
 */
async function fetchAllDriverProfiles({ onPage } = {}) {
  const limit = 200;
  let offset = 0;
  let all = [];

  while (true) {
    const res = await fetch(`${BASE}/v1/parks/driver-profiles/list`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        limit,
        offset,
        fields: {
          account: ["balance"],
          car: ["id", "model", "number", "color"],
          current_status: ["status"],
          driver_profile: [
            "first_name",
            "last_name",
            "middle_name",
            "phones",
            "work_status",
            "work_rule_id",
            "created_date",
            "hire_date",
            "driver_license",
            "comment",
          ],
          park: ["name"],
        },
        query: { park: { id: process.env.YANDEX_PARK_ID } },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Yandex Fleet API driver-profiles/list ${res.status}: ${body}`
      );
    }

    const data = await res.json();
    const items = data.driver_profiles || [];
    all = all.concat(items);
    if (onPage) onPage(items.length, offset);

    if (items.length < limit) break;
    offset += limit;
    // Yandex требует минимум ~0.5с между запросами на один park_id
    await new Promise((r) => setTimeout(r, 600));
  }

  return all;
}

/**
 * POST /v1/parks/cars/list — подтверждено в open-source обёртках
 * над этим API, структура ответа аналогична driver-profiles/list.
 */
async function fetchAllCars() {
  const limit = 200;
  let offset = 0;
  let all = [];

  while (true) {
    const res = await fetch(`${BASE}/v1/parks/cars/list`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        limit,
        offset,
        query: { park: { id: process.env.YANDEX_PARK_ID } },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Yandex Fleet API cars/list ${res.status}: ${body}`);
    }

    const data = await res.json();
    const items = data.cars || [];
    all = all.concat(items);

    if (items.length < limit) break;
    offset += limit;
    await new Promise((r) => setTimeout(r, 600));
  }

  return all;
}

module.exports = { fetchAllDriverProfiles, fetchAllCars };
