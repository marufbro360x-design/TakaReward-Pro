// Vercel & Netlify Universal Serverless Function: Offerwall.GG + Cointo Media + TimeWall Live Proxy
// File Location in GitHub Repo: api/offers.js
// Live Endpoint: https://takarewardpro.com/api/offers

const OFFERWALL_APP_ID = process.env.OFFERWALL_APP_ID || "7495f3f6d2e6b19774fc1b67a4eecfa6";
const OFFERWALL_SECRET = process.env.OFFERWALL_SECRET || "38420234f0f6e719f28054f43da7e5b0199a31f00d42a2790df1e0e4ed703ace";
const OFFERWALL_API_BASE = "https://offerwall.gg/api/v1";

// Cointo Media Integration Credentials ($1.00 USD = 600,000 Coins, 10,000 Coins = ৳1.00 BDT)
const COINTO_PUBLIC_KEY = process.env.COINTO_PUBLIC_KEY || "Dv0Ou9";
const COINTO_SECRET_KEY = process.env.COINTO_SECRET_KEY || "Nd8Ds2Jo9Aq2Hc7";
const COINTO_API_BASE = "https://cointomedia.com/api/v1/offers";
const COINTO_COINS_PER_USD = 600000;

// Gaintwall Integration Credentials ($1.00 USD = 600,000 Coins, Placement Rate = 6,000)
const GAINTWALL_API_KEY = process.env.GAINTWALL_API_KEY || "VaWkdoWdrn57UEbbm0Fdt2oCAJYXUbRn";
const GAINTWALL_API_SECRET = process.env.GAINTWALL_API_SECRET || "kBrbjlXlnYfXvzmSwua1J0rr2RfIxcIe";
const GAINTWALL_API_BASE = "https://gaintwall.com/api/v1/offers";
const GAINTWALL_COINS_PER_USD = 600000;

// TimeWall Configuration (Bearer Token, Signing Key & Placement OID from TimeWall Siteowner Dashboard)
const TIMEWALL_SURVEY_API_KEY = process.env.TIMEWALL_SURVEY_API_KEY || "tw_e8c7a7d151ffaa0d9215127d48e95590df925ced577a949f9ea850deb4b1934f";
const TIMEWALL_SIGNING_KEY = process.env.TIMEWALL_SIGNING_KEY || "9e7fe018b4c712d8c54fc5b384b849e730eefd4611de7a51b1bc6283fbd7b03";
const TIMEWALL_PLACEMENT_OID = process.env.TIMEWALL_PLACEMENT_OID || "22db97d7a055bb22";

// Helper to fetch an Offerwall.GG endpoint safely with timeout
async function fetchOfferwallEndpoint(path, queryParams = {}) {
  const url = new URL(`${OFFERWALL_API_BASE}${path}`);
  Object.entries(queryParams).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") {
      url.searchParams.set(k, String(v));
    }
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "X-Api-Key": OFFERWALL_SECRET,
        "Accept": "application/json",
        "User-Agent": "TakaRewardPro-Server/1.0"
      },
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { success: false, status: res.status };
    }
    return await res.json();
  } catch (err) {
    clearTimeout(timer);
    return { success: false, error: err.message };
  }
}

// Helper to build a Cointo click URL with the user's UID (&sub_id=${uid})
function buildCointoClickUrl(rawClickUrl, offerId, userId) {
  const uid = encodeURIComponent(userId || "guest");
  if (rawClickUrl && typeof rawClickUrl === "string") {
    let urlStr = rawClickUrl.trim().replace(/\[USER_ID\]|\{USER_ID\}|\{subId\}|\{sub_id\}/gi, uid);
    if (/[?&]sub_id=/i.test(urlStr)) {
      urlStr = urlStr.replace(/([?&]sub_id=)[^&]*/i, `$1${uid}`);
    } else if (/[?&]subId=/i.test(urlStr)) {
      urlStr = urlStr.replace(/([?&]subId=)[^&]*/i, `$1${uid}`);
    } else {
      urlStr += (urlStr.includes("?") ? "&" : "?") + `sub_id=${uid}`;
    }
    return urlStr;
  }
  return `https://cointomedia.com/offer/${COINTO_PUBLIC_KEY}/${uid}`;
}

// Normalize a single Cointo offer to TakaReward Pro standard format
function normalizeCointoOffer(offer, userId, idx = 0) {
  const rawId = offer.offer_id || offer.id || offer.company_id || (idx + 1);
  const payoutUsd = Number(offer.payout || offer.cpi || offer.revenue || 0);
  const rawReward = Number(offer.reward || offer.points || offer.coins || 0);

  // Currency Rate: $1.00 USD = 600,000 Coins (10,000 Coins = ৳1.00 BDT)
  const rewardCoins = payoutUsd > 0
    ? Math.round(payoutUsd * COINTO_COINS_PER_USD)
    : (rawReward > 0 ? Math.round(rawReward) : 60000);
  const rewardTaka = Number((rewardCoins / 10000).toFixed(2));

  // Normalize device array: devices: [offer.device]
  let devices = ["android", "ios", "desktop"];
  if (Array.isArray(offer.devices) && offer.devices.length > 0) {
    devices = offer.devices.map(d => String(d).toLowerCase());
  } else if (offer.device) {
    const devStr = String(offer.device).toLowerCase().trim();
    if (devStr === "all" || devStr === "any" || devStr === "mobile") {
      devices = devStr === "mobile" ? ["android", "ios"] : ["android", "ios", "desktop"];
    } else {
      devices = devStr.split(/[,|/+\s]+/).map(d => d.trim()).filter(Boolean);
    }
  }

  const countries = Array.isArray(offer.country)
    ? offer.country
    : (Array.isArray(offer.countries) ? offer.countries : (offer.country ? [String(offer.country).toUpperCase()] : ["*"]));

  const name = String(offer.name || offer.title || offer.offer_name || "Cointo Special Offer").trim();
  const description = String(
    offer.description ||
    offer.instructions ||
    `Complete "${name}" via Cointo Media and earn ${rewardCoins.toLocaleString()} Coins (৳${rewardTaka}) automatically!`
  ).trim();
  const requirements = String(
    offer.requirements ||
    offer.conversion_flow ||
    offer.description ||
    "Click Start Offer, complete the required registration or milestone steps on Cointo Media, and your reward will be credited automatically."
  ).trim();

  const rawEvents = offer.events || offer.goals || offer.steps || [];
  const goals = Array.isArray(rawEvents) && rawEvents.length > 0
    ? normalizeGoals(rawEvents.map((ev, i) => {
        const evPayout = Number(ev.payout || ev.revenue || 0);
        const evCoins = evPayout > 0
          ? Math.round(evPayout * COINTO_COINS_PER_USD)
          : Math.round(Number(ev.reward || ev.points || ev.coins || 0));
        return {
          goalId: String(ev.event_id || ev.id || i + 1),
          description: String(ev.event_name || ev.name || ev.description || `Step ${i + 1}`),
          reward: evCoins,
          optional: Boolean(ev.optional)
        };
      }))
    : [
        {
          stepNumber: 1,
          goalId: "1",
          description: requirements,
          rewardCoins,
          rewardTaka,
          rewardFormatted: `${rewardCoins.toLocaleString()} Coins`,
          optional: false
        }
      ];

  const isMultiStep = String(offer.type || "").toLowerCase() === "multireward" || goals.length > 1;
  const clickUrl = buildCointoClickUrl(offer.click_url || offer.clickUrl || offer.tracking_url || offer.url, rawId, userId);

  const normalizedObj = {
    id: `cointo_${rawId}`,
    externalId: String(rawId),
    provider: "cointo",
    name,
    title: name,
    description,
    requirements,
    image: String(offer.preview || offer.image || offer.icon || offer.thumbnail || ""),
    type: isMultiStep ? "multistep" : "singlestep",
    multipleConversions: isMultiStep,
    categories: ["offers", "signups"],
    devices,
    countries,
    payoutUsd,
    rewardCoins,
    rewardTaka,
    rewardFormatted: `${rewardCoins.toLocaleString()} Coins`,
    rewardIsVariable: false,
    featured: true,
    isGame: false,
    isSurvey: false,
    clickUrl,
    goals
  };

  if (isGameOffer(normalizedObj)) {
    normalizedObj.categories.push("games");
  }

  return normalizedObj;
}

// Fetch live offers from Cointo Offers API (GET https://cointomedia.com/api/v1/offers)
async function fetchCointoOffers(userId, country) {
  const fetchFromCointoUrl = async (queryObj) => {
    const url = new URL(COINTO_API_BASE);
    url.searchParams.set("site_key", COINTO_PUBLIC_KEY);
    url.searchParams.set("site_secret", COINTO_SECRET_KEY);
    url.searchParams.set("limit", "150");
    Object.entries(queryObj).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "User-Agent": "TakaRewardPro-Server/1.0"
        },
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!res.ok) return [];
      const data = await res.json();
      const rawOffers = Array.isArray(data?.offers)
        ? data.offers
        : (Array.isArray(data?.data?.offers)
            ? data.data.offers
            : (Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : [])));
      return rawOffers;
    } catch (err) {
      clearTimeout(timer);
      return [];
    }
  };

  try {
    // Fetch country-matched offers first; if few or empty, also merge global offers so catalogue stays full
    const [countryList, globalList] = await Promise.all([
      country ? fetchFromCointoUrl({ country }) : Promise.resolve([]),
      fetchFromCointoUrl({})
    ]);

    const combinedRaw = [...countryList, ...globalList];
    const seenIds = new Set();
    const normalizedList = [];

    combinedRaw.forEach((rawOffer, idx) => {
      if (!rawOffer) return;
      const key = String(rawOffer.offer_id || rawOffer.id || rawOffer.name || idx);
      if (seenIds.has(key)) return;
      seenIds.add(key);
      normalizedList.push(normalizeCointoOffer(rawOffer, userId, idx));
    });

    // Sort by highest reward first
    normalizedList.sort((a, b) => (b.rewardCoins || 0) - (a.rewardCoins || 0));
    return normalizedList;
  } catch (err) {
    console.warn("[Cointo Offers Fetch Notice]", err.message);
    return [];
  }
}

// Fetch live offers from Gaintwall API (GET https://gaintwall.com/api/v1/offers)
function normalizeGaintwallOffer(offer, userId, idx = 0) {
  const uid = encodeURIComponent(userId || "guest");
  const rawId = offer.offer_id || offer.id || (idx + 1);
  const payoutUsd = Number(offer.payout || 0);
  const payoutLocal = Number(offer.payout_local || offer.reward || 0);

  // Convert to TakaReward Pro standard: $1.00 USD = 600,000 Coins = ৳60 BDT
  // (Gaintwall placement rate is 6000 per $1, so payout_local * 100 = 600,000 Coins)
  const rewardCoins = payoutUsd > 0
    ? Math.round(payoutUsd * GAINTWALL_COINS_PER_USD)
    : (payoutLocal > 0 ? Math.round(payoutLocal * 100) : 60000);
  const rewardTaka = Number((rewardCoins / 10000).toFixed(2));

  let devices = ["android", "ios", "desktop"];
  if (Array.isArray(offer.platforms) && offer.platforms.length > 0) {
    devices = offer.platforms.map(p => {
      const pl = String(p).toLowerCase().trim();
      return pl === "web" ? "desktop" : pl;
    });
  }

  const countries = Array.isArray(offer.countries) && offer.countries.length > 0
    ? offer.countries.map(c => String(c).toUpperCase())
    : ["*"];

  const name = String(offer.name || offer.title || "Gaintwall Offer").trim();
  const description = String(
    offer.description ||
    `Complete "${name}" via Gaintwall and earn ${rewardCoins.toLocaleString()} Coins (৳${rewardTaka}) automatically!`
  ).trim();

  const rawSteps = Array.isArray(offer.steps) ? offer.steps : [];
  const goals = rawSteps.length > 0
    ? rawSteps.map((st, i) => {
        if (typeof st === "string") {
          const stepCoins = i === rawSteps.length - 1 ? rewardCoins : 0;
          return {
            stepNumber: i + 1,
            goalId: String(i + 1),
            description: st,
            rewardCoins: stepCoins,
            rewardTaka: Number((stepCoins / 10000).toFixed(2)),
            rewardFormatted: stepCoins > 0 ? `${stepCoins.toLocaleString()} Coins` : "Step",
            optional: false
          };
        }
        const stPayout = Number(st.payout || 0);
        const stCoins = stPayout > 0 ? Math.round(stPayout * GAINTWALL_COINS_PER_USD) : Math.round(Number(st.reward || 0) * 100);
        return {
          stepNumber: i + 1,
          goalId: String(st.id || i + 1),
          description: String(st.description || st.name || `Step ${i + 1}`),
          rewardCoins: stCoins,
          rewardTaka: Number((stCoins / 10000).toFixed(2)),
          rewardFormatted: stCoins > 0 ? `${stCoins.toLocaleString()} Coins` : "Bonus",
          optional: false
        };
      })
    : [
        {
          stepNumber: 1,
          goalId: "1",
          description,
          rewardCoins,
          rewardTaka,
          rewardFormatted: `${rewardCoins.toLocaleString()} Coins`,
          optional: false
        }
      ];

  let clickUrl = `https://gaintwall.com/api/track?offerId=${encodeURIComponent(rawId)}&apiKey=${encodeURIComponent(GAINTWALL_API_KEY)}&userId=${uid}`;
  if (offer.link && typeof offer.link === "string") {
    clickUrl = offer.link
      .replace(/YOUR_API_KEY|\{API_KEY\}/gi, encodeURIComponent(GAINTWALL_API_KEY))
      .replace(/USER_ID|\{USER_ID\}/gi, uid);
    if (/[?&]userId=/i.test(clickUrl)) {
      clickUrl = clickUrl.replace(/([?&]userId=)[^&]*/i, `$1${uid}`);
    } else {
      clickUrl += (clickUrl.includes("?") ? "&" : "?") + `userId=${uid}`;
    }
  }

  const catRaw = String(offer.category || "offers").toLowerCase();
  const categories = ["offers", "signups"];
  if (catRaw.includes("game") || catRaw.includes("gaming")) categories.push("games");
  if (catRaw.includes("survey")) categories.push("surveys");

  const normalizedObj = {
    id: `gw_${rawId}`,
    externalId: String(rawId),
    provider: "gaintwall",
    name,
    title: name,
    description,
    requirements: rawSteps.filter(s => typeof s === "string").join(" • ") || description,
    image: String(offer.image_url || offer.image || offer.icon || ""),
    type: goals.length > 1 ? "multistep" : "singlestep",
    multipleConversions: goals.length > 1,
    categories,
    devices,
    countries,
    payoutUsd,
    rewardCoins,
    rewardTaka,
    rewardFormatted: `${rewardCoins.toLocaleString()} Coins`,
    rewardIsVariable: false,
    featured: true,
    isGame: categories.includes("games"),
    isSurvey: categories.includes("surveys"),
    clickUrl,
    goals
  };

  if (isGameOffer(normalizedObj) && !normalizedObj.categories.includes("games")) {
    normalizedObj.categories.push("games");
    normalizedObj.isGame = true;
  }

  return normalizedObj;
}

async function fetchGaintwallOffers(userId, country) {
  const fetchFromGwUrl = async (queryObj) => {
    const url = new URL(GAINTWALL_API_BASE);
    url.searchParams.set("apiKey", GAINTWALL_API_KEY);
    url.searchParams.set("apiSecret", GAINTWALL_API_SECRET);
    url.searchParams.set("userId", userId || "guest");
    url.searchParams.set("limit", "100");
    Object.entries(queryObj).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "User-Agent": "TakaRewardPro-Server/1.0"
        },
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data?.data) ? data.data : (Array.isArray(data?.offers) ? data.offers : []);
    } catch (err) {
      clearTimeout(timer);
      return [];
    }
  };

  try {
    const [countryList, globalList] = await Promise.all([
      country ? fetchFromGwUrl({ country }) : Promise.resolve([]),
      fetchFromGwUrl({})
    ]);
    const combinedRaw = [...countryList, ...globalList];
    const seenIds = new Set();
    const normalizedList = [];
    combinedRaw.forEach((rawOffer, idx) => {
      if (!rawOffer) return;
      const key = String(rawOffer.offer_id || rawOffer.id || rawOffer.name || idx);
      if (seenIds.has(key)) return;
      seenIds.add(key);
      normalizedList.push(normalizeGaintwallOffer(rawOffer, userId, idx));
    });
    normalizedList.sort((a, b) => (b.rewardCoins || 0) - (a.rewardCoins || 0));
    return normalizedList;
  } catch (err) {
    console.warn("[Gaintwall Offers Fetch Notice]", err.message);
    return [];
  }
}

// Helper to fetch live surveys from TimeWall Survey API using Authorization: Bearer header
async function fetchTimeWallSurveys(queryParams = {}) {
  const uid = encodeURIComponent(queryParams.userId || "guest");
  const candidateUrls = [
    `https://timewall.io/api/v1/surveys?oid=${TIMEWALL_PLACEMENT_OID}&uid=${uid}&ip=${encodeURIComponent(queryParams.ip || "")}&country=${encodeURIComponent(queryParams.country || "BD")}`,
    `https://timewall.io/api/surveys?oid=${TIMEWALL_PLACEMENT_OID}&uid=${uid}&ip=${encodeURIComponent(queryParams.ip || "")}&country=${encodeURIComponent(queryParams.country || "BD")}`
  ];

  for (const endpoint of candidateUrls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(endpoint, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${TIMEWALL_SURVEY_API_KEY}`,
          "Accept": "application/json",
          "User-Agent": queryParams.userAgent || "TakaRewardPro-Server/1.0"
        },
        signal: controller.signal
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        const rawList = Array.isArray(data)
          ? data
          : (Array.isArray(data?.surveys)
              ? data.surveys
              : (Array.isArray(data?.data?.surveys) ? data.data.surveys : (Array.isArray(data?.data) ? data.data : [])));
        if (rawList.length > 0) {
          return rawList.map((s, idx) => {
            const rawCurrency = Number(s.currencyAmount || s.points || s.coins || s.reward || 0);
            const rawRevenueUsd = Number(s.revenue || s.payout || s.cpi || 0);
            // TimeWall Placement Rate: $1 USD = 600,000 Coins
            const rewardCoins = rawCurrency > 0
              ? Math.round(rawCurrency)
              : (rawRevenueUsd > 0 ? Math.round(rawRevenueUsd * 600000) : 600000);
            const rewardTaka = Number((rewardCoins / 10000).toFixed(1));
            const mins = Number(s.loi || s.length || s.lengthMinutes || s.duration || 5);
            return {
              id: `tw_srv_${s.id || s.survey_id || idx}`,
              provider: "TimeWall",
              name: String(s.name || s.title || `TimeWall Survey · ${mins} Min`),
              description: String(s.description || `Complete this ${mins} minute TimeWall survey to earn instant coins.`),
              lengthMinutes: mins,
              rating: Number(s.rating || 4.8),
              rewardCoins,
              rewardTaka,
              rewardFormatted: `${rewardCoins.toLocaleString()} Coins`,
              rewardIsVariable: false,
              clickUrl: s.link || s.url || s.clickUrl || `https://timewall.io/users/login?oid=${TIMEWALL_PLACEMENT_OID}&uid=${uid}&tab=surveys`
            };
          });
        }
      }
    } catch (e) {
      clearTimeout(timer);
    }
  }
  return [];
}

// Classify whether an offer is a Game
function isGameOffer(offer) {
  const cats = Array.isArray(offer.categories)
    ? offer.categories.map(c => String(c).toLowerCase())
    : [];
  if (cats.some(c => c.includes("game") || c.includes("gaming") || c.includes("casino") || c.includes("puzzle") || c.includes("arcade"))) {
    return true;
  }
  const text = `${offer.name || ""} ${offer.description || ""} ${offer.requirements || ""}`.toLowerCase();
  const gameKeywords = [
    "game", "play", "level", "puzzle", "solitaire", "casino", "slots", "whale.io",
    "originals", "battle", "rpg", "clash", "kingdom", "tycoon", "merge", "dice",
    "bingo", "poker", "fish", "shooter", "racing", "farm", "zombie", "dragon",
    "bubble", "sort", "rocket", "legends", "adventure", "heroes", "mafia", "monopoly",
    "tile", "match", "crazy aim", "roller", "pool", "abyss", "slime", "mochi", "unblock"
  ];
  return gameKeywords.some(kw => text.includes(kw));
}

// Classify whether an offer is a Survey
function isSurveyOffer(offer) {
  const cats = Array.isArray(offer.categories)
    ? offer.categories.map(c => String(c).toLowerCase())
    : [];
  if (cats.some(c => c.includes("survey") || c.includes("poll") || c.includes("research"))) {
    return true;
  }
  const text = `${offer.name || ""} ${offer.description || ""}`.toLowerCase();
  return text.includes("survey") || text.includes("theoremreach") || text.includes("bitlabs") || text.includes("sayorbit") || text.includes("cpx");
}

// Normalize goal ladder / reward steps array and sort in ascending order
function normalizeGoals(rawGoals) {
  if (!Array.isArray(rawGoals) || rawGoals.length === 0) return [];
  const mapped = rawGoals.map((g, idx) => {
    const rewardCoins = Math.round(Number(g.reward || g.points || g.coins || g.currencyAmount || 0));
    const rewardTaka = rewardCoins > 0 ? Number((rewardCoins / 10000).toFixed(2)) : 0;
    const desc = String(g.description || g.name || g.title || `Step ${idx + 1}`).trim();
    const isOptional = Boolean(g.optional || /purchase|deposit|buy|spend/i.test(desc));
    const stageMatch = desc.match(/(?:stage|level|step|milestone|kingdom|day)\s*(\d+)/i);
    const stageOrder = stageMatch ? parseInt(stageMatch[1], 10) : null;
    return {
      origIndex: idx,
      stageOrder,
      goalId: String(g.goalId || g.id || idx + 1),
      description: desc,
      rewardCoins,
      rewardTaka,
      rewardFormatted: g.rewardFormatted || (rewardCoins > 0 ? `${rewardCoins.toLocaleString()} Coins` : "Bonus"),
      optional: isOptional
    };
  });

  mapped.sort((a, b) => {
    if (a.stageOrder !== null && b.stageOrder !== null && a.stageOrder !== b.stageOrder) {
      return a.stageOrder - b.stageOrder;
    }
    if (a.rewardCoins !== b.rewardCoins) {
      return a.rewardCoins - b.rewardCoins;
    }
    return a.origIndex - b.origIndex;
  });

  return mapped.map((g, i) => ({
    stepNumber: i + 1,
    goalId: g.goalId,
    description: g.description,
    rewardCoins: g.rewardCoins,
    rewardTaka: g.rewardTaka,
    rewardFormatted: g.rewardFormatted,
    optional: g.optional
  }));
}

// Normalize an Offerwall.GG offer object for TakaReward Pro frontend
function normalizeOffer(raw, userId) {
  const uid = encodeURIComponent(userId || "guest");
  const id = raw.id || raw.externalId || Math.floor(Math.random() * 1000000);
  const rewardCoins = Number(raw.reward) || 0;
  // In TakaReward Pro, 10,000 Coins = 1 BDT (৳1)
  const rewardTaka = rewardCoins > 0 ? Number((rewardCoins / 10000).toFixed(2)) : 0;

  const clickUrl = raw.clickUrl
    ? raw.clickUrl.replace(/userId=[^&]*/i, `userId=${uid}`)
    : `https://offerwall.gg/wall/${OFFERWALL_APP_ID}/click/${id}?userId=${uid}`;

  const devices = Array.isArray(raw.devices) && raw.devices.length > 0
    ? raw.devices.map(d => String(d).toLowerCase())
    : ["android", "ios", "desktop"];

  const categories = Array.isArray(raw.categories) && raw.categories.length > 0
    ? raw.categories.map(c => String(c).toLowerCase())
    : ["offers"];

  const goals = normalizeGoals(raw.goals || raw.steps || raw.events);
  const isMultiStep = String(raw.type || "").toLowerCase() === "multistep" || Boolean(raw.multipleConversions) || goals.length > 1;

  return {
    id: String(id),
    externalId: String(raw.externalId || id),
    provider: String(raw.provider || "offerwall.gg"),
    name: String(raw.name || raw.title || "Special Offer"),
    title: String(raw.name || raw.title || "Special Offer"),
    description: String(raw.description || "Complete this offer to earn instant rewards."),
    requirements: String(
      raw.requirements ||
      (isMultiStep ? "Complete all steps listed. Earn rewards along the way." : (raw.description || "Follow the instructions on the offer page and complete the required steps."))
    ),
    image: String(raw.image || ""),
    type: isMultiStep ? "multistep" : String(raw.type || "singlestep"),
    multipleConversions: Boolean(raw.multipleConversions || isMultiStep),
    categories,
    devices,
    countries: Array.isArray(raw.countries) ? raw.countries : ["*"],
    rewardCoins,
    rewardTaka,
    rewardFormatted: raw.rewardFormatted || (rewardCoins > 0 ? `${rewardCoins.toLocaleString()} Coins` : "Variable"),
    rewardIsVariable: Boolean(raw.rewardIsVariable || rewardCoins === 0),
    featured: Boolean(raw.featured),
    isGame: isGameOffer(raw),
    isSurvey: isSurveyOffer(raw),
    clickUrl,
    goals
  };
}

async function handleOffersRequest(params, headers = {}) {
  const userId = String(params.userId || params.uid || params.user || "guest").trim();
  const singleOfferId = String(params.offerId || params.offer || params.id || "").trim();

  // Case 1: Single Offer Detail + Goal Ladder Request (?offerId=4021)
  if (singleOfferId && /^\d+$/.test(singleOfferId)) {
    const detailRes = await fetchOfferwallEndpoint(`/offers/${encodeURIComponent(singleOfferId)}`, {
      appId: OFFERWALL_APP_ID,
      userId
    });
    const rawOffer = detailRes?.data?.offer || detailRes?.offer || null;
    if (rawOffer) {
      const normalized = normalizeOffer(rawOffer, userId);
      return {
        success: true,
        appId: OFFERWALL_APP_ID,
        data: {
          offer: normalized,
          goals: normalized.goals
        }
      };
    }
    return {
      success: false,
      error: "Offer details not found",
      data: { offer: null, goals: [] }
    };
  }

  // Case 2: Full Catalogue Request
  const requestedCategory = String(params.category || "").toLowerCase().trim();
  const requestedDevice = String(params.device || "").toLowerCase().trim();
  const search = String(params.search || "").trim();
  const sort = String(params.sort || "payout").trim();

  // Detect country from query or Vercel/Cloudflare headers
  const rawCountry = String(
    params.country ||
    headers["x-vercel-ip-country"] ||
    headers["cf-ipcountry"] ||
    ""
  ).toUpperCase().trim();
  const country = /^[A-Z]{2}$/.test(rawCountry) ? rawCountry : "BD";

  // Detect client IP for Survey matching
  const rawIp = String(
    params.ip ||
    (headers["x-forwarded-for"] ? headers["x-forwarded-for"].split(",")[0] : "") ||
    headers["x-real-ip"] ||
    "103.152.100.1"
  ).trim();

  const userAgent = String(
    params.userAgent ||
    headers["user-agent"] ||
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36"
  ).slice(0, 500);

  // Fetch Offerwall.GG Offers, Cointo Live Offers, Surveys, TimeWall Surveys, and Traffic in parallel
  const [androidRes, iosRes, desktopRes, globalGamesRes, cointoOffers, gaintwallOffers, surveysRes, timewallSurveys, trafficRes] = await Promise.all([
    fetchOfferwallEndpoint("/offers", { appId: OFFERWALL_APP_ID, userId, country, device: "android", sort, limit: 150, search }),
    fetchOfferwallEndpoint("/offers", { appId: OFFERWALL_APP_ID, userId, country, device: "ios", sort, limit: 150, search }),
    fetchOfferwallEndpoint("/offers", { appId: OFFERWALL_APP_ID, userId, country, device: "desktop", sort, limit: 150, search }),
    fetchOfferwallEndpoint("/offers", { appId: OFFERWALL_APP_ID, userId, category: "games", sort: "payout", limit: 60 }),
    fetchCointoOffers(userId, country),
    fetchGaintwallOffers(userId, country),
    fetchOfferwallEndpoint("/surveys", { appId: OFFERWALL_APP_ID, userId, ip: rawIp, country, userAgent, limit: 50 }),
    fetchTimeWallSurveys({ userId, ip: rawIp, country, userAgent }),
    fetchOfferwallEndpoint("/traffic", { appId: OFFERWALL_APP_ID, userId, country, limit: 50 })
  ]);

  // Merge & deduplicate Offerwall.GG offers by ID, combining device tags
  const offersMap = new Map();

  function mergeOfferList(resObj, defaultDeviceTag) {
    const list = resObj && resObj.success && resObj.data && Array.isArray(resObj.data.offers)
      ? resObj.data.offers
      : [];
    for (const item of list) {
      const key = String(item.id || item.externalId || item.name);
      if (!offersMap.has(key)) {
        const norm = normalizeOffer(item, userId);
        if (defaultDeviceTag && !norm.devices.includes(defaultDeviceTag)) {
          norm.devices.push(defaultDeviceTag);
        }
        offersMap.set(key, norm);
      } else {
        const existing = offersMap.get(key);
        if (defaultDeviceTag && !existing.devices.includes(defaultDeviceTag)) {
          existing.devices.push(defaultDeviceTag);
        }
        if (Array.isArray(item.devices)) {
          item.devices.forEach(d => {
            const dl = String(d).toLowerCase();
            if (!existing.devices.includes(dl)) existing.devices.push(dl);
          });
        }
      }
    }
  }

  mergeOfferList(androidRes, "android");
  mergeOfferList(iosRes, "ios");
  mergeOfferList(desktopRes, "desktop");
  mergeOfferList(globalGamesRes, null);

  const offerwallGGOffers = Array.from(offersMap.values());

  // Merge Cointo & Gaintwall Live Offers into allOffers and signups
  let allOffers = [...cointoOffers, ...gaintwallOffers, ...offerwallGGOffers];

  // Sort by highest reward first
  allOffers.sort((a, b) => (b.rewardCoins || 0) - (a.rewardCoins || 0));

  // Filter by device if explicitly requested
  let activeCointoOffers = cointoOffers;
  let activeGaintwallOffers = gaintwallOffers;
  if (requestedDevice && ["android", "ios", "desktop"].includes(requestedDevice)) {
    allOffers = allOffers.filter(o => o.devices.includes(requestedDevice));
    activeCointoOffers = cointoOffers.filter(o => o.devices.includes(requestedDevice));
    activeGaintwallOffers = gaintwallOffers.filter(o => o.devices.includes(requestedDevice));
  }

  // Separate into Games, Sign-ups/Offers (with Cointo & Gaintwall Offers included), and Surveys
  const gwGames = activeGaintwallOffers.filter(o => o.isGame && !o.isSurvey);
  const games = [...gwGames, ...offerwallGGOffers.filter(o => o.isGame && !o.isSurvey)];
  const nonGameOfferwallGG = offerwallGGOffers.filter(o => !o.isGame && !o.isSurvey);
  const signupsAndOffers = [
    ...activeCointoOffers,
    ...activeGaintwallOffers,
    ...(nonGameOfferwallGG.length > 0 ? [...nonGameOfferwallGG, ...games] : offerwallGGOffers.filter(o => !o.isSurvey))
  ];
  const surveyOffers = allOffers.filter(o => o.isSurvey);

  // Normalize dedicated surveys from /api/v1/surveys
  const rawSurveys = (surveysRes && surveysRes.success && surveysRes.data && Array.isArray(surveysRes.data.surveys))
    ? surveysRes.data.surveys
    : (surveysRes && Array.isArray(surveysRes.surveys) ? surveysRes.surveys : []);

  const dedicatedSurveys = rawSurveys.map(s => {
    const rewardCoins = Number(s.reward) || 0;
    const rewardTaka = rewardCoins > 0 ? Number((rewardCoins / 10000).toFixed(2)) : 0;
    const uid = encodeURIComponent(userId || "guest");
    return {
      id: String(s.id || Math.floor(Math.random() * 100000)),
      provider: "Offerwall.GG",
      name: String(s.title || `Survey · ${s.lengthMinutes || 5} min`),
      description: String(s.description || `Complete this ${s.lengthMinutes || 5} minute survey to earn instant rewards.`),
      lengthMinutes: Number(s.lengthMinutes) || 5,
      rating: Number(s.rating) || 4.5,
      rewardCoins,
      rewardTaka,
      rewardFormatted: s.rewardFormatted || (rewardCoins > 0 ? `${rewardCoins.toLocaleString()} Coins` : "Variable"),
      rewardIsVariable: Boolean(s.rewardIsVariable || rewardCoins === 0),
      clickUrl: s.clickUrl || `https://offerwall.gg/wall/${OFFERWALL_APP_ID}?userId=${uid}`
    };
  });

  // Normalize traffic tasks from /api/v1/traffic
  const rawTraffic = (trafficRes && trafficRes.success && trafficRes.data && Array.isArray(trafficRes.data.tasks))
    ? trafficRes.data.tasks
    : (trafficRes && Array.isArray(trafficRes.tasks) ? trafficRes.tasks : []);

  const trafficTasks = rawTraffic.map(t => {
    const rewardCoins = Number(t.reward) || 500;
    const rewardTaka = Number((rewardCoins / 10000).toFixed(2));
    const uid = encodeURIComponent(userId || "guest");
    return {
      id: String(t.id || Math.floor(Math.random() * 100000)),
      provider: "Offerwall.GG",
      title: String(t.title || "Visit Sponsored Site"),
      description: String(t.description || "Keep the page open until the timer completes."),
      site: String(t.site || ""),
      image: String(t.image || ""),
      durationSeconds: Number(t.durationSeconds) || 15,
      rewardCoins,
      rewardTaka,
      clickUrl: t.startUrl || `https://offerwall.gg/wall/${OFFERWALL_APP_ID}?userId=${uid}`
    };
  });

  // If caller asked for a specific category filter
  let filteredOffers = allOffers;
  if (requestedCategory === "games") {
    filteredOffers = games.length > 0 ? games : signupsAndOffers;
  } else if (requestedCategory === "surveys") {
    filteredOffers = surveyOffers;
  } else if (requestedCategory && requestedCategory !== "all") {
    filteredOffers = allOffers.filter(o => o.categories.includes(requestedCategory));
  }

  return {
    success: true,
    appId: OFFERWALL_APP_ID,
    cointoKey: COINTO_PUBLIC_KEY,
    gaintwallKey: GAINTWALL_API_KEY,
    timewallOid: TIMEWALL_PLACEMENT_OID,
    wallUrl: `https://offerwall.gg/wall/${OFFERWALL_APP_ID}?userId=${encodeURIComponent(userId)}`,
    cointoWallUrl: `https://cointomedia.com/offer/${COINTO_PUBLIC_KEY}/${encodeURIComponent(userId)}`,
    gaintwallUrl: `https://gaintwall.com/offerwall?apiKey=${GAINTWALL_API_KEY}&userId=${encodeURIComponent(userId)}`,
    targeting: { country, userId },
    data: {
      offers: filteredOffers,
      allOffers,
      cointoOffers: activeCointoOffers,
      gaintwallOffers: activeGaintwallOffers,
      games: games.length > 0 ? games : signupsAndOffers,
      signups: signupsAndOffers,
      surveys: [...timewallSurveys, ...dedicatedSurveys, ...surveyOffers],
      traffic: trafficTasks
    }
  };
}

// Universal Export for both Vercel (req, res) and Netlify (event, context)
const universalHandler = async (reqOrEvent, res) => {
  // Vercel / Express style
  if (res && typeof res.status === "function") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");

    if (reqOrEvent.method === "OPTIONS") {
      return res.status(200).json({ success: true });
    }

    try {
      const params = { ...(reqOrEvent.query || {}), ...(reqOrEvent.body || {}) };
      const payload = await handleOffersRequest(params, reqOrEvent.headers || {});
      return res.status(200).json(payload);
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // Netlify Serverless Function style
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  if (reqOrEvent.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true }) };
  }

  try {
    const params = reqOrEvent.queryStringParameters || {};
    const payload = await handleOffersRequest(params, reqOrEvent.headers || {});
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(payload) };
  } catch (err) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ success: false, error: err.message }) };
  }
};

module.exports = universalHandler;
module.exports.handler = universalHandler;
