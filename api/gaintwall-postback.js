// Universal Serverless Auto-Postback Handler for Gaintwall (gaintwall.com)
// File Location in GitHub Repo: api/gaintwall-postback.js
// Live Postback URL to set in Gaintwall Edit Placement:
// https://takarewardpro.com/api/gaintwall-postback?userId={user_id}&offerId={offer_id}&offerName={offer_name}&payout={payout}&reward={reward}&transactionId={transaction_id}&status={status}&ip={ip}&country={country}&sub1={aff_sub}&sub2={aff_sub2}&hash={hash}

const crypto = require('crypto');

const FIREBASE_PROJECT_ID = "takareward-bd";
const GAINTWALL_API_KEY = process.env.GAINTWALL_API_KEY || "VaWkdoWdrn57UEbbm0Fdt2oCAJYXUbRn";
const GAINTWALL_POSTBACK_SECRET = process.env.GAINTWALL_POSTBACK_SECRET || "kBrbjlXlnYfXvzmSwua1J0rr2RfIxcIe";

// Conversion Rate:
// TakaReward Pro Standard: $1.00 USD = 600,000 Coins = ৳60 BDT (10,000 Coins = ৳1 BDT)
// Gaintwall Placement Exchange Rate: $1.00 USD = 6,000 Gaintwall Coins (so 1 Gaintwall Coin = 100 TakaReward Coins)
const COINS_PER_USD = 600000;
const GAINTWALL_REWARD_MULTIPLIER = 100;

// Service Account Credentials for Superuser Admin Access to Firestore
const SERVICE_ACCOUNT = {
  client_email: "firebase-adminsdk-fbsvc@takareward-bd.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC58Iai69AaPdXg\ngHFrZa7W19ekI4zLFuMHCMbUIwBVzOyuOzSaV6v8uPUSGeDIheuUbpIVwyIrdsz0\nWssWtETT0P4eNZVHUQZQW1I55XqofIn+lXQXrIehfqUVLACxn4Cp8BG/5QPaB5yz\n4S3HAaVMTWWhosOCpC+Oi0PMVvciyeMQ9QeeI8ZDzi883zqja9lx6ZOpuXrOIYbL\n2DqpUnDWF+uiz7ez7lfOOPHsThI0J2BWXoBpLAZoTBtJ3sNTNcTh9exN9eFfhz1l\n2wahGWOXNa0k6fT3+SWPJg2vOnKn/YEYt7KyUQuwCu0ld/MSuEvRYkSL78mIWUeT\nQ4gVeTntAgMBAAECggEAD75S2AaZZy9nJYwajlpctGowIwCzkhqM/HJ8y0dvZtRk\nEdiHeq4DrPFIJtE0HCZirP2zts3/3ahAcEwjt/dpgHnImmw1CIXOwA0LaEWK3is1\nT+39l2ePUFg1yBYitOdpcHoYNqRAcDyGwyBEzP3RriU7frUWUsBuGmamRe3zHOnQ\nKdPCb1YUVeCCZlItm+U9m6WcILK4O3IrnnOn5QaIJB2JJRV+xV6pYlSE68v8v/x9\n+vvH8TxLKVH3HdQ3pgKnDHOFZ/RTwbgWQXWxwc/5kyudWTu+zfWala/Ntg4xVw37\nbZ+qEKPmBdfr0SaPQi7GT3XE0EIiJfq1ZU/mUgykoQKBgQDj4ExZY+Uju7fsNtPF\n27u9kENWOyeW0JKTCIxAvSOAW1/2pPBOyf2eEYjgPESyR1H06qME3UMhwTvQQqIG\nApeEYYW+XndVMOABsQ09uqNfSokSz6Q5Tf8/DEM71p4xcRVDPMW2qMeZ2vC8+Kyy\ndnxh8zBP3swgkoAzslcjIik0BQKBgQDQ4z+2b14o7FghB8VtZSbV8mLZE0bhE4vE\nE8noRI6pICvtTgZank5X+oMrL3bTldvtFTH1kkPxufkROzcinZpIG+5dG+8hAoKC\n6aFNGSEE8E3pOuEQ401sv8P7yfGtbzj0Ypt/LvQffo6CPq0/Aemt4eHakB+JB7Vl\n/zhZPBF6yQKBgGyhXoQ2lONl95XJxUbLK0KA5TjUVlkU8Ora5lFuWOA1rxebJVvJ\n+vdBkKik0nLSgQVqXXBSMlCDF4p+WVLYJXbcLq/DxMt90yu7RX6p3Hvuwk2PYtBW\nmFlr9RkvhJY5PFOjQvWCnDSCJMVRHrKsvTrMfbl1koXskOUUHWoIPPApAoGBAI7x\nI1VFSor4iKo5tilREc1QK8JeRZ+aD4ei/wTZfUJQyJ6ASSrTr8rWm9H+jfLmVvQb\nD+/7IlGVMNJQ0j722G/F5UyD5BSTshnBpGas7oKBqt8SMpeq4/2qEIQJwj8roC7k\nF4Jl8BppMT4Bg+5c8brSmwpEm7/arZBZoQa3a0K5AoGAAsaXAGyIC66fX/Ctb9/a\nc4pCiyBZlBkjI7Jd9Wm7gnhtntSxX8RRqEdl2QTt9BbmehDbw5YT+X2br8kRTU2N\n3IfaPchN3RtgSqzoyqeP8aTpODTw1ntVyF0JDf6rOUdWFCmLNstQSJa9Vnuw67RQ\nRZOfK6mcyQufcHaakBjm4FM=\n-----END PRIVATE KEY-----\n",
  project_id: "takareward-bd"
};

async function getGoogleAdminToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: SERVICE_ACCOUNT.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedClaimSet = Buffer.from(JSON.stringify(claimSet)).toString("base64url");
  const signInput = `${encodedHeader}.${encodedClaimSet}`;

  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signInput);
  const signature = sign.sign(SERVICE_ACCOUNT.private_key, "base64url");
  const jwt = `${signInput}.${signature}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    })
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error("Failed to get Google Admin Token: " + JSON.stringify(tokenData));
  }
  return tokenData.access_token;
}

async function getFirestoreDoc(token, path) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { "Authorization": `Bearer ${token}` }
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Firestore GET ${path} failed with status ${res.status}`);
  }
  return await res.json();
}

function sha256Hash(str) {
  return crypto.createHash('sha256').update(String(str)).digest('hex');
}

async function processGaintwallPostback(params) {
  // Gaintwall Official Macros:
  // userId={user_id}&offerId={offer_id}&offerName={offer_name}&payout={payout}&reward={reward}&transactionId={transaction_id}&status={status}&ip={ip}&country={country}&sub1={aff_sub}&sub2={aff_sub2}&hash={hash}
  const userId = String(params.userId || params.user_id || params.uid || params.subId || params.sub1 || "").trim();
  const rawOfferId = String(params.offerId || params.offer_id || "gaintwall_offer").trim();
  const offerName = String(params.offerName || params.offer_name || "Gaintwall Offer").trim();
  const rawTransId = String(params.transactionId || params.transaction_id || params.transId || params.txid || "").trim();
  const payoutRaw = params.payout !== undefined ? String(params.payout).trim() : "0";
  const rewardRaw = params.reward !== undefined ? String(params.reward).trim() : "0";
  const statusRaw = String(params.status || "approved").trim().toLowerCase();
  const userIp = String(params.ip || params.userIp || "").trim();
  const country = String(params.country || "").trim();
  const providedHash = String(params.hash || params.signature || params.sig || "").trim().toLowerCase();

  if (!userId) {
    return { status: 400, text: "ERROR: Missing userId" };
  }

  const transId = rawTransId || `gw_${userId}_${Date.now()}`;

  // 1. Verify SHA256 Hash: SHA256(user_id + offer_id + transaction_id + secret)
  if (providedHash && !providedHash.startsWith("{") && !providedHash.startsWith("[")) {
    const expectedHash = sha256Hash(`${userId}${rawOfferId}${rawTransId}${GAINTWALL_POSTBACK_SECRET}`).toLowerCase();
    if (providedHash !== expectedHash) {
      console.warn(`[Gaintwall Postback] Hash mismatch for userId=${userId}, transId=${rawTransId}. Provided=${providedHash}, Expected=${expectedHash}`);
      return { status: 403, text: "Invalid hash signature" };
    }
  }

  // 2. Calculate TakaReward Pro Coins ($1.00 USD = 600,000 Coins = ৳60 BDT)
  // On Gaintwall placement, exchange rate is 6000 per $1 USD, so reward * 100 = 600,000 Coins per $1 USD
  const payoutUsd = parseFloat(payoutRaw) || 0;
  const rewardNum = parseFloat(rewardRaw) || 0;

  let baseCoins = 0;
  if (Math.abs(payoutUsd) > 0) {
    baseCoins = Math.round(Math.abs(payoutUsd) * COINS_PER_USD);
  } else if (Math.abs(rewardNum) > 0) {
    // If Gaintwall sent 6000-rate reward, multiply by 100 to match 600,000 Coins standard
    baseCoins = Math.abs(rewardNum) < 50000
      ? Math.round(Math.abs(rewardNum) * GAINTWALL_REWARD_MULTIPLIER)
      : Math.round(Math.abs(rewardNum));
  }

  if (baseCoins <= 0) {
    baseCoins = 6000; // Minimum fallback (৳0.60) for test postbacks
  }

  const isReversed = statusRaw === "rejected" || statusRaw === "reversed" || statusRaw === "chargeback" || statusRaw === "2" || payoutUsd < 0 || rewardNum < 0;
  const finalCoinsDelta = isReversed ? -Math.abs(baseCoins) : Math.abs(baseCoins);
  const takaAmount = parseFloat((Math.abs(baseCoins) / 10000).toFixed(2));

  const adminToken = await getGoogleAdminToken();

  // 3. Deduplication Check
  const docId = `gw_${transId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const existingLog = await getFirestoreDoc(adminToken, `gaintwall_logs/${docId}`);
  if (existingLog) {
    const existingStatus = existingLog.fields?.status?.stringValue || "credited";
    if (!isReversed || existingStatus === "reversed") {
      return { status: 200, text: "OK" };
    }
  }

  // 4. Commit Credit/Debit to User & Write Log + Notification
  const nowIso = new Date().toISOString();
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:commit`;
  const userDocPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${userId}`;
  const logDocPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/gaintwall_logs/${docId}`;
  const notifDocPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/notifications/${docId}_n`;

  const commitPayload = {
    writes: [
      {
        transform: {
          document: userDocPath,
          fieldTransforms: [
            {
              fieldPath: "coins",
              increment: { integerValue: String(finalCoinsDelta) }
            },
            {
              fieldPath: "totalGaintwallEarnings",
              increment: { integerValue: String(finalCoinsDelta) }
            },
            {
              fieldPath: "totalOfferwallEarnings",
              increment: { integerValue: String(finalCoinsDelta) }
            }
          ]
        }
      },
      {
        update: {
          name: logDocPath,
          fields: {
            userId: { stringValue: userId },
            transId: { stringValue: transId },
            offerId: { stringValue: rawOfferId },
            offerName: { stringValue: offerName },
            payoutUsd: { doubleValue: Math.abs(payoutUsd) },
            rewardRaw: { stringValue: rewardRaw },
            coins: { integerValue: String(finalCoinsDelta) },
            currencyAmount: { integerValue: String(finalCoinsDelta) },
            taka: { doubleValue: takaAmount },
            status: { stringValue: isReversed ? "reversed" : "credited" },
            type: { stringValue: isReversed ? "2" : "1" },
            userIp: { stringValue: userIp },
            country: { stringValue: country },
            provider: { stringValue: "Gaintwall" },
            createdAt: { timestampValue: nowIso }
          }
        }
      },
      {
        update: {
          name: notifDocPath,
          fields: {
            userId: { stringValue: userId },
            title: { stringValue: isReversed ? "⚠️ Gaintwall অফার রিভার্সাল" : "🎉 Gaintwall অফার সম্পন্ন!" },
            message: {
              stringValue: isReversed
                ? `Gaintwall অফার (${offerName}) রিভার্স হওয়ায় ${Math.abs(baseCoins).toLocaleString()} কয়েন (৳${takaAmount}) সমন্বয় করা হয়েছে।`
                : `অভিনন্দন! Gaintwall অফার (${offerName}) সম্পন্ন করে আপনি +${Math.abs(baseCoins).toLocaleString()} কয়েন (৳${takaAmount}) পেয়েছেন!`
            },
            time: { stringValue: "Just now" },
            createdAt: { timestampValue: nowIso }
          }
        }
      }
    ]
  };

  const commitRes = await fetch(commitUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${adminToken}`
    },
    body: JSON.stringify(commitPayload)
  });

  if (!commitRes.ok) {
    const errText = await commitRes.text();
    console.error("[Gaintwall Postback Commit Error]", errText);
    return { status: 500, text: "ERROR: Database commit failed" };
  }

  console.log(`[Gaintwall Postback OK] User=${userId}, Trans=${transId}, Coins=${finalCoinsDelta}, Offer=${offerName}`);
  return { status: 200, text: "OK" };
}

const universalHandler = async (reqOrEvent, res) => {
  // Vercel / Express style
  if (res && typeof res.status === "function") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

    if (reqOrEvent.method === "OPTIONS") {
      return res.status(200).send("OK");
    }

    try {
      const queryParams = reqOrEvent.query || {};
      const bodyParams = (reqOrEvent.body && typeof reqOrEvent.body === "object") ? reqOrEvent.body : {};
      const merged = { ...queryParams, ...bodyParams };

      if (!merged.userId && !merged.user_id && !merged.uid && !merged.subId && !merged.sub1) {
        return res.status(200).send("OK - TakaReward Pro Gaintwall S2S Postback Endpoint Active");
      }

      const result = await processGaintwallPostback(merged);
      return res.status(result.status).send(result.text);
    } catch (err) {
      console.error("[Gaintwall Postback Fatal]", err);
      return res.status(500).send("ERROR: " + (err.message || "Internal error"));
    }
  }

  // Netlify Function fallback
  try {
    const queryParams = reqOrEvent.queryStringParameters || {};
    const bodyParams = reqOrEvent.body ? JSON.parse(reqOrEvent.body) : {};
    const merged = { ...queryParams, ...bodyParams };

    if (!merged.userId && !merged.user_id && !merged.uid && !merged.subId && !merged.sub1) {
      return { statusCode: 200, body: "OK - TakaReward Pro Gaintwall S2S Postback Endpoint Active" };
    }

    const result = await processGaintwallPostback(merged);
    return { statusCode: result.status, body: result.text };
  } catch (err) {
    return { statusCode: 500, body: "ERROR: " + err.message };
  }
};

module.exports = universalHandler;
module.exports.handler = universalHandler;
