// Vercel & Netlify Universal Serverless Function: Gaintwall S2S Postback Handler
// File Location in GitHub Repo: api/gaintwall-postback.js
// Live Postback Endpoint: https://takarewardpro.com/api/gaintwall-postback
// Recommended Gaintwall Dashboard Postback URL:
// https://takarewardpro.com/api/gaintwall-postback?user_id={user_id}&offer_id={offer_id}&transaction_id={transaction_id}&payout={payout}&reward={reward}&currency={currency}&status={status}&offer_name={offer_name}&hash={hash}

const crypto = require("crypto");
const admin = require("firebase-admin");

// Gaintwall Placement Credentials (TakaReward Pro)
const GAINTWALL_API_KEY = process.env.GAINTWALL_API_KEY || "VaWkdoWdrn57UEbbm0Fdt2oCAJYXUbRn";
const GAINTWALL_POSTBACK_SECRET = process.env.GAINTWALL_POSTBACK_SECRET || "kBrbjlXlnYfXvzmSwua1J0rr2RfIxcIe";

// Conversion Math:
// TakaReward Pro Master Rate: $1.00 USD = 600,000 Coins = ৳60.00 BDT (10,000 Coins = ৳1.00 BDT)
// Gaintwall Dashboard Exchange Rate: $1.00 USD = 6,000 Coins (due to Gaintwall 4-digit MySQL column limit)
// Therefore:
//   - If USD payout is sent: rewardCoins = Math.round(payoutUsd * 600000)
//   - If Gaintwall currency/reward points (at 6,000/$1) are sent: rewardCoins = Math.round(gaintwallPoints * 100)
const TAKAREWARD_COINS_PER_USD = 600000;
const GAINTWALL_POINT_MULTIPLIER = 100;

// Initialize Firebase Admin SDK safely
function getFirestoreDb() {
  if (!admin.apps.length) {
    const rawServiceAccount =
      process.env.FIREBASE_SERVICE_ACCOUNT ||
      process.env.FIREBASE_SERVICE_ACCOUNT_KEY ||
      process.env.GOOGLE_SERVICE_ACCOUNT ||
      "";

    if (rawServiceAccount) {
      let serviceAccountObj;
      try {
        serviceAccountObj = JSON.parse(rawServiceAccount);
      } catch (err) {
        serviceAccountObj = JSON.parse(Buffer.from(rawServiceAccount, "base64").toString("utf8"));
      }
      if (serviceAccountObj.private_key) {
        serviceAccountObj.private_key = serviceAccountObj.private_key.replace(/\\n/g, "\n");
      }
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccountObj),
        projectId: serviceAccountObj.project_id || "takareward-bd"
      });
    } else if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID || "takareward-bd",
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
        }),
        projectId: process.env.FIREBASE_PROJECT_ID || "takareward-bd"
      });
    } else {
      admin.initializeApp({
        projectId: "takareward-bd"
      });
    }
  }
  return admin.firestore();
}

// Helper: Strip unreplaced macro placeholders like {user_id} or [payout]
function cleanParam(val) {
  if (val === undefined || val === null) return "";
  const str = String(val).trim();
  if (/^\{[^}]+\}$/.test(str) || /^\[[^\]]+\]$/.test(str) || /^%[a-zA-Z0-9_]+%$/.test(str)) {
    return "";
  }
  return str;
}

// Helper: Compute SHA256 hex digest
function sha256Hex(input) {
  return crypto.createHash("sha256").update(String(input), "utf8").digest("hex").toLowerCase();
}

// Helper: Compute HMAC-SHA256 hex digest
function hmacSha256Hex(input, secret) {
  return crypto.createHmac("sha256", String(secret)).update(String(input), "utf8").digest("hex").toLowerCase();
}

// Verify Gaintwall {hash} signature:
// Official Gaintwall Formula: SHA256(user_id + offer_id + transaction_id + secret)
function verifyGaintwallSignature({ userId, offerId, transactionId, providedHash, secret }) {
  if (!providedHash) return false;
  const cleanHash = String(providedHash).trim().toLowerCase();

  // 1. Direct secret match (in case a test postback sends the secret directly)
  if (cleanHash === String(secret).trim().toLowerCase()) {
    return true;
  }

  // 2. Official Gaintwall Formula: SHA256(user_id + offer_id + transaction_id + secret)
  const expectedPrimary = sha256Hex(`${userId}${offerId}${transactionId}${secret}`);
  if (cleanHash === expectedPrimary) {
    return true;
  }

  // 3. Fallback variations (e.g., if offer_id is omitted in a dashboard test ping or HMAC is used)
  const candidates = [
    sha256Hex(`${userId}${transactionId}${secret}`),
    sha256Hex(`${transactionId}${userId}${secret}`),
    hmacSha256Hex(`${userId}${offerId}${transactionId}`, secret),
    hmacSha256Hex(`${userId}:${offerId}:${transactionId}`, secret)
  ];

  return candidates.includes(cleanHash);
}

async function processGaintwallPostback(params = {}, headers = {}) {
  const userId = cleanParam(
    params.user_id || params.userId || params.uid || params.sub_id || params.subId || params.userid
  );
  const offerId = cleanParam(
    params.offer_id || params.offerId || params.campaign_id || params.campaignId || "0"
  );
  const offerName = cleanParam(
    params.offer_name || params.offerName || params.offer_title || params.title || "Gaintwall Offer"
  ) || "Gaintwall Offer";
  const transactionId = cleanParam(
    params.transaction_id || params.transactionId || params.tx_id || params.txId || params.trans_id || params.conversion_id
  );
  const statusRaw = cleanParam(
    params.status || params.type || params.event || "1"
  ).toLowerCase();

  // Extract signature / hash from query, body, or headers
  const providedHash = cleanParam(
    params.hash ||
    params.sig ||
    params.signature ||
    params.security_hash ||
    headers["x-gaintwall-signature"] ||
    headers["x-signature"] ||
    ""
  );

  // Extract USD payout & Gaintwall virtual currency points
  const rawPayoutStr = cleanParam(params.payout || params.usd || params.payout_usd || params.revenue || "");
  const rawRewardStr = cleanParam(
    params.reward || params.currency || params.amount || params.points || params.coins || params.currency_amount || ""
  );

  const payoutUsd = rawPayoutStr !== "" ? Number(rawPayoutStr) : 0;
  const gaintwallPoints = rawRewardStr !== "" ? Number(rawRewardStr) : 0;

  if (!userId) {
    return { statusCode: 400, body: { status: "error", message: "Missing user_id parameter" } };
  }

  if (!transactionId) {
    return { statusCode: 400, body: { status: "error", message: "Missing transaction_id parameter" } };
  }

  // Verify SHA256(user_id + offer_id + transaction_id + secret)
  const isSignatureValid = verifyGaintwallSignature({
    userId,
    offerId,
    transactionId,
    providedHash,
    secret: GAINTWALL_POSTBACK_SECRET
  });

  if (!isSignatureValid) {
    console.warn("[Gaintwall Postback] Invalid signature:", {
      userId,
      offerId,
      transactionId,
      providedHash
    });
    return { statusCode: 403, body: { status: "error", message: "Invalid hash signature" } };
  }

  // Determine whether this is a chargeback / reversal
  const isReversal =
    statusRaw === "2" ||
    statusRaw === "-1" ||
    statusRaw === "reversed" ||
    statusRaw === "reversal" ||
    statusRaw === "chargeback" ||
    statusRaw === "rejected" ||
    statusRaw === "cancel" ||
    payoutUsd < 0 ||
    gaintwallPoints < 0;

  // Calculate TakaReward Pro Coins ($1 USD = 600,000 Coins OR Gaintwall Points * 100)
  const absPayoutUsd = Math.abs(payoutUsd);
  const absGaintwallPoints = Math.abs(gaintwallPoints);

  let baseCoins = 0;
  if (absPayoutUsd > 0) {
    baseCoins = Math.round(absPayoutUsd * TAKAREWARD_COINS_PER_USD);
  } else if (absGaintwallPoints > 0) {
    // If Gaintwall already sent points scaled by 6,000 ($1 = 6,000), multiply by 100 to get 600,000 Coins/$1
    baseCoins = Math.round(absGaintwallPoints * GAINTWALL_POINT_MULTIPLIER);
  }

  if (baseCoins <= 0) {
    return {
      statusCode: 200,
      body: { status: "ok", message: "Zero reward ping acknowledged", transactionId }
    };
  }

  const coinsDelta = isReversal ? -baseCoins : baseCoins;
  const takaAmount = Number((baseCoins / 10000).toFixed(2));
  const safeDocId = `gw_${String(transactionId).replace(/[^a-zA-Z0-9_-]/g, "_")}`;

  const db = getFirestoreDb();
  const logRef = db.collection("gaintwall_logs").doc(safeDocId);
  const userRef = db.collection("users").doc(userId);

  let outcome = "credited";

  await db.runTransaction(async (t) => {
    const existingLogSnap = await t.get(logRef);
    if (existingLogSnap.exists) {
      const prevData = existingLogSnap.data() || {};
      const prevStatus = String(prevData.status || "approved").toLowerCase();
      const targetStatus = isReversal ? "reversed" : "approved";
      if (prevStatus === targetStatus) {
        outcome = "duplicate";
        return;
      }
    }

    const userSnap = await t.get(userRef);
    const nowIso = new Date().toISOString();

    if (userSnap.exists) {
      t.update(userRef, {
        coins: admin.firestore.FieldValue.increment(coinsDelta),
        totalGaintwallEarnings: admin.firestore.FieldValue.increment(coinsDelta),
        totalOfferwallEarnings: admin.firestore.FieldValue.increment(coinsDelta),
        updatedAt: nowIso
      });
    } else {
      t.set(
        userRef,
        {
          uid: userId,
          coins: Math.max(0, coinsDelta),
          totalGaintwallEarnings: Math.max(0, coinsDelta),
          totalOfferwallEarnings: Math.max(0, coinsDelta),
          createdAt: nowIso,
          updatedAt: nowIso
        },
        { merge: true }
      );
    }

    t.set(
      logRef,
      {
        provider: "gaintwall",
        userId,
        offerId: String(offerId || "0"),
        offerName,
        transactionId: String(transactionId),
        payoutUsd: absPayoutUsd,
        gaintwallPoints: absGaintwallPoints,
        coins: coinsDelta,
        currencyAmount: coinsDelta,
        takaAmount,
        status: isReversal ? "reversed" : "approved",
        createdAt: nowIso
      },
      { merge: true }
    );

    const notifRef = db.collection("notifications").doc();
    t.set(notifRef, {
      userId,
      title: isReversal ? "⚠️ Gaintwall Reversal" : "🎉 Gaintwall Reward Credited!",
      message: isReversal
        ? `Gaintwall অফার (${offerName}) রিভার্স হওয়ায় ${baseCoins.toLocaleString()} Coins (৳${takaAmount}) সমন্বয় করা হয়েছে।`
        : `অভিনন্দন! Gaintwall অফার (${offerName}) সম্পন্ন করায় আপনার ওয়ালেটে +${baseCoins.toLocaleString()} Coins (৳${takaAmount}) যোগ হয়েছে!`,
      createdAt: nowIso
    });
  });

  if (outcome === "duplicate") {
    return {
      statusCode: 200,
      body: {
        status: "ok",
        message: "Duplicate transaction_id already processed",
        transactionId
      }
    };
  }

  return {
    statusCode: 200,
    body: {
      status: "ok",
      provider: "gaintwall",
      userId,
      offerId,
      transactionId,
      coinsCredited: coinsDelta,
      takaCredited: isReversal ? -takaAmount : takaAmount
    }
  };
}

// Universal Export for Vercel (req, res) and Netlify (event, context)
const universalHandler = async (reqOrEvent, res) => {
  // Vercel / Express style
  if (res && typeof res.status === "function") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Gaintwall-Signature, X-Signature");

    if (reqOrEvent.method === "OPTIONS") {
      return res.status(200).send("OK");
    }

    try {
      const bodyParams =
        typeof reqOrEvent.body === "string" && reqOrEvent.body.trim().startsWith("{")
          ? JSON.parse(reqOrEvent.body)
          : (reqOrEvent.body || {});
      const params = { ...(reqOrEvent.query || {}), ...bodyParams };
      const result = await processGaintwallPostback(params, reqOrEvent.headers || {});
      return res.status(result.statusCode).json(result.body);
    } catch (err) {
      console.error("[Gaintwall Postback Error]", err);
      return res.status(500).json({ status: "error", message: err.message });
    }
  }

  // Netlify Serverless Function style
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Gaintwall-Signature, X-Signature",
    "Content-Type": "application/json"
  };

  if (reqOrEvent.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "OK" };
  }

  try {
    let bodyParams = {};
    if (reqOrEvent.body) {
      try {
        bodyParams = JSON.parse(reqOrEvent.body);
      } catch (e) {
        const searchParams = new URLSearchParams(reqOrEvent.body);
        searchParams.forEach((v, k) => {
          bodyParams[k] = v;
        });
      }
    }
    const params = { ...(reqOrEvent.queryStringParameters || {}), ...bodyParams };
    const result = await processGaintwallPostback(params, reqOrEvent.headers || {});
    return {
      statusCode: result.statusCode,
      headers: corsHeaders,
      body: JSON.stringify(result.body)
    };
  } catch (err) {
    console.error("[Gaintwall Postback Error]", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ status: "error", message: err.message })
    };
  }
};

module.exports = universalHandler;
module.exports.handler = universalHandler;
