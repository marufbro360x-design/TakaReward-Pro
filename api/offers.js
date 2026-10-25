// Vercel & Netlify Universal Serverless Function: Offerwall.GG + TimeWall Live Proxy
// File Location in GitHub Repo: api/offers.js
// Live Endpoint: https://takarewardpro.com/api/offers

const OFFERWALL_APP_ID = process.env.OFFERWALL_APP_ID || "7495f3f6d2e6b19774fc1b67a4eecfa6";
const OFFERWALL_SECRET = process.env.OFFERWALL_SECRET || "38420234f0f6e719f28054f43da7e5b0199a31f00d42a2790df1e0e4ed703ace";
const OFFERWALL_API_BASE = "https://offerwall.gg/api/v1";

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

// Normalize goal ladder / reward steps array from Offerwall.GG and sort in ascending order
function normalizeGoals(rawGoals) {
  if (!Array.isArray(rawGoals) || rawGoals.length === 0) return [];
  const mapped = rawGoals.map((g, idx) => {
    const rewardCoins = Math.round(Number(g.reward || g.points || g.coins || g.currencyAmount || 0));
    const rewardTaka = rewardCoins > 0 ? Number((rewardCoins / 10000).toFixed(2)) : 0;
    const desc = String(g.description || g.name || g.title || `Step ${idx + 1}`).trim();
    const isOptional = Boolean(g.optional || /purchase|deposit|buy|spend/i.test(desc));
    // Extract numeric stage/level if present for natural sorting
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

  // Sort ascending by stage number (if all have stage numbers) or ascending by rewardCoins
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

// Normalize an offer object for TakaReward Pro frontend
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

  // Fetch Android, iOS, Desktop offers, Offerwall.GG Surveys, TimeWall Surveys, and Traffic in parallel
  const [androidRes, iosRes, desktopRes, globalGamesRes, surveysRes, timewallSurveys, trafficRes] = await Promise.all([
    fetchOfferwallEndpoint("/offers", { appId: OFFERWALL_APP_ID, userId, country, device: "android", sort, limit: 150, search }),
    fetchOfferwallEndpoint("/offers", { appId: OFFERWALL_APP_ID, userId, country, device: "ios", sort, limit: 150, search }),
    fetchOfferwallEndpoint("/offers", { appId: OFFERWALL_APP_ID, userId, country, device: "desktop", sort, limit: 150, search }),
    fetchOfferwallEndpoint("/offers", { appId: OFFERWALL_APP_ID, userId, category: "games", sort: "payout", limit: 60 }),
    fetchOfferwallEndpoint("/surveys", { appId: OFFERWALL_APP_ID, userId, ip: rawIp, country, userAgent, limit: 50 }),
    fetchTimeWallSurveys({ userId, ip: rawIp, country, userAgent }),
    fetchOfferwallEndpoint("/traffic", { appId: OFFERWALL_APP_ID, userId, country, limit: 50 })
  ]);

  // Merge & deduplicate offers by ID, combining device tags
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

  let allOffers = Array.from(offersMap.values());

  // Sort by highest reward first
  allOffers.sort((a, b) => (b.rewardCoins || 0) - (a.rewardCoins || 0));

  // Filter by device if explicitly requested
  if (requestedDevice && ["android", "ios", "desktop"].includes(requestedDevice)) {
    allOffers = allOffers.filter(o => o.devices.includes(requestedDevice));
  }

  // Separate into Games, Non-Game Offers/Sign-ups, and Surveys
  const games = allOffers.filter(o => o.isGame && !o.isSurvey);
  const nonGameOffers = allOffers.filter(o => !o.isGame && !o.isSurvey);
  const signupsAndOffers = nonGameOffers.length > 0 ? [...nonGameOffers, ...games] : allOffers.filter(o => !o.isSurvey);
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
    timewallOid: TIMEWALL_PLACEMENT_OID,
    wallUrl: `https://offerwall.gg/wall/${OFFERWALL_APP_ID}?userId=${encodeURIComponent(userId)}`,
    targeting: { country, userId },
    data: {
      offers: filteredOffers,
      allOffers,
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
