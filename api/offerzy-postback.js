// Universal Serverless Auto-Postback Handler for Offerzy (offerzy.io)
// File Location in GitHub Repo: api/offerzy-postback.js
// Live Postback URL set in Offerzy Placement -> Postback:
// https://www.takarewardpro.com/api/offerzy-postback?user_id={user_id}&transaction_id={transaction_id}&reward={reward}&status={status_code}&payout={payout}&signature={signature}&offer_id={offer_id}&offer_name={offer_name}&ip={ip}&country={country}&sub1={sub1}&sub2={sub2}&sub3={sub3}&sub4={sub4}&sub5={sub5}

const crypto = require('crypto');

const FIREBASE_PROJECT_ID = "takareward-bd";
const OFFERZY_PUBLIC_KEY = process.env.OFFERZY_PUBLIC_KEY || "ofzy_live_98c8b36e8e4e41fad945150cbafa5f23";
const OFFERZY_PRIVATE_KEY = process.env.OFFERZY_PRIVATE_KEY || "ofzy_sk_e2192dd7edae93b555cc0f7965ca9b46";

// Conversion Rate:
// TakaReward Pro Standard: $1.00 USD = 600,000 Coins = ৳60 BDT (10,000 Coins = ৳1 BDT)
// Offerzy Placement Currency Settings: Units per $1 = 600000 (Whole numbers)
const COINS_PER_USD = 600000;

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

function md5Hash(str) {
  return crypto.createHash('md5').update(String(str), 'utf8').digest('hex').toLowerCase();
}

function sha256Hash(str) {
  return crypto.createHash('sha256').update(String(str), 'utf8').digest('hex').toLowerCase();
}

async function processOfferzyPostback(params) {
  // Official Offerzy Postback Parameters (https://documentation.offerzy.io/postbacks/overview):
  // user_id, status (1 = credit, 2 = reversal), reward, payout, transaction_id, offer_id, offer_name, ip, country, sub1..sub5, signature
  const rawUserId = params.user_id !== undefined ? String(params.user_id) : String(params.userId || params.uid || params.sub1 || "");
  const userId = rawUserId.trim();

  const rawRewardForSig = params.reward !== undefined ? String(params.reward) : String(params.amount || params.coins || "");
  const rawOfferIdForSig = params.offer_id !== undefined && !String(params.offer_id).startsWith("{")
    ? String(params.offer_id)
    : String(params.offerId || "");

  const offerId = rawOfferIdForSig.trim() || "offerzy_offer";
  const offerName = String(params.offer_name || params.offerName || "Offerzy Offer").trim();
  const rawTransId = String(params.transaction_id || params.transactionId || params.transId || params.txid || "").trim();
  const payoutRaw = String(params.payout !== undefined ? params.payout : "0").trim();
  const statusRaw = String(params.status !== undefined ? params.status : (params.status_code !== undefined ? params.status_code : "1")).trim().toLowerCase();
  const userIp = String(params.ip || params.userIp || "").trim();
  const country = String(params.country || "").trim();
  const providedSig = String(params.signature || params.sig || params.hash || "").trim().toLowerCase();

  if (!userId || userId.startsWith("{")) {
    return { status: 400, text: "ERROR: Missing user_id" };
  }

  const transId = rawTransId || `ofzy_${userId}_${Date.now()}`;

  // 1. Strictly Verify Offerzy Signature (Mandatory Security Check):
  // Official Formula: md5(user_id + reward + offer_id + PRIVATE_KEY) == signature
  if (!providedSig || providedSig.startsWith("{") || providedSig.startsWith("[")) {
    console.warn(`[Offerzy Postback] Missing signature for user_id=${userId}, tx=${transId}`);
    return { status: 403, text: "invalid signature" };
  }

  const cleanRewardNoCommas = rawRewardForSig.trim().replace(/,/g, "");
  const validSignatures = [
    md5Hash(`${rawUserId}${rawRewardForSig}${rawOfferIdForSig}${OFFERZY_PRIVATE_KEY}`),
    md5Hash(`${userId}${rawRewardForSig.trim()}${rawOfferIdForSig.trim()}${OFFERZY_PRIVATE_KEY}`),
    md5Hash(`${userId}${cleanRewardNoCommas}${rawOfferIdForSig.trim()}${OFFERZY_PRIVATE_KEY}`),
    md5Hash(`${userId}${rawRewardForSig.trim()}${offerId}${OFFERZY_PRIVATE_KEY}`),
    md5Hash(`${userId}${rawRewardForSig.trim()}${""}${OFFERZY_PRIVATE_KEY}`),
    sha256Hash(`${rawUserId}${rawRewardForSig}${rawOfferIdForSig}${OFFERZY_PRIVATE_KEY}`)
  ];
  if (!validSignatures.includes(providedSig)) {
    console.warn(`[Offerzy Postback] Signature mismatch for user_id=${userId}, tx=${transId}. Provided=${providedSig}, Expected=${validSignatures[0]}`);
    return { status: 403, text: "invalid signature" };
  }

  // 2. Calculate TakaReward Pro Coins ($1.00 USD = 600,000 Coins = ৳60 BDT)
  // Since Offerzy Placement Currency is set to Units per $1 = 600000, `reward` is already in TakaReward Pro Coins!
  const payoutUsd = parseFloat(payoutRaw.replace(/,/g, "")) || 0;
  const rewardNum = parseFloat(cleanRewardNoCommas) || 0;

  const coinsFromPayout = Math.abs(payoutUsd) > 0
    ? Math.round(Math.abs(payoutUsd) * COINS_PER_USD)
    : 0;

  const coinsFromReward = Math.abs(rewardNum) > 0
    ? Math.round(Math.abs(rewardNum))
    : 0;

  // Use rewardNum directly when >= coinsFromPayout (supports Offerzy 2x promo multipliers), or fallback to coinsFromPayout
  let baseCoins = Math.max(coinsFromReward, coinsFromPayout);
  if (baseCoins <= 0) {
    baseCoins = 6000; // Minimum fallback (৳0.60) for zero-value test postbacks
  }

  const isReversed =
    statusRaw === "2" ||
    statusRaw === "reversed" ||
    statusRaw === "reversal" ||
    statusRaw === "chargeback" ||
    statusRaw === "rejected" ||
    rewardNum < 0 ||
    payoutUsd < 0;

  const finalCoinsDelta = isReversed ? -Math.abs(baseCoins) : Math.abs(baseCoins);
  const takaAmount = parseFloat((Math.abs(baseCoins) / 10000).toFixed(2));

  const adminToken = await getGoogleAdminToken();

  // 3. Deduplication Check by transaction_id & status
  const docId = `ofzy_${transId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const existingLog = await getFirestoreDoc(adminToken, `offerzy_logs/${docId}`);
  if (existingLog) {
    const existingStatus = existingLog.fields?.status?.stringValue || "credited";
    if ((!isReversed && existingStatus === "credited") || (isReversed && existingStatus === "reversed")) {
      return { status: 200, text: "ok" };
    }
  }

  // 4. Commit Credit/Debit to User & Write Log + In-App Notification
  const nowIso = new Date().toISOString();
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:commit`;
  const userDocPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${userId}`;
  const logDocPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/offerzy_logs/${docId}`;
  const notifDocPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/notifications/${docId}_${isReversed ? "rev" : "n"}`;

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
              fieldPath: "totalOfferzyEarnings",
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
            offerId: { stringValue: offerId },
            offerName: { stringValue: offerName },
            payoutUsd: { doubleValue: Math.abs(payoutUsd) },
            rewardRaw: { stringValue: String(rawRewardForSig) },
            coins: { integerValue: String(finalCoinsDelta) },
            currencyAmount: { integerValue: String(finalCoinsDelta) },
            taka: { doubleValue: takaAmount },
            status: { stringValue: isReversed ? "reversed" : "credited" },
            type: { stringValue: isReversed ? "2" : "1" },
            userIp: { stringValue: userIp },
            country: { stringValue: country },
            provider: { stringValue: "Offerzy" },
            createdAt: { timestampValue: nowIso }
          }
        }
      },
      {
        update: {
          name: notifDocPath,
          fields: {
            userId: { stringValue: userId },
            title: { stringValue: isReversed ? "⚠️ Offerzy অফার রিভার্সাল" : "🎉 Offerzy অফার সম্পন্ন!" },
            message: {
              stringValue: isReversed
                ? `Offerzy অফার (${offerName}) রিভার্স হওয়ায় ${Math.abs(baseCoins).toLocaleString()} কয়েন (৳${takaAmount}) সমন্বয় করা হয়েছে।`
                : `অভিনন্দন! Offerzy অফার (${offerName}) সম্পন্ন করে আপনি +${Math.abs(baseCoins).toLocaleString()} কয়েন (৳${takaAmount}) পেয়েছেন!`
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
    console.error("[Offerzy Postback Commit Error]", errText);
    return { status: 500, text: "ERROR: Database commit failed" };
  }

  console.log(`[Offerzy Postback OK] User=${userId}, Trans=${transId}, Coins=${finalCoinsDelta}, Offer=${offerName}`);
  return { status: 200, text: "ok" };
}

const universalHandler = async (reqOrEvent, res) => {
  // Vercel / Express style
  if (res && typeof res.status === "function") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Content-Type", "text/plain");

    if (reqOrEvent.method === "OPTIONS") {
      return res.status(200).send("ok");
    }

    try {
      const queryParams = reqOrEvent.query || {};
      const bodyParams = (reqOrEvent.body && typeof reqOrEvent.body === "object") ? reqOrEvent.body : {};
      const merged = { ...queryParams, ...bodyParams };

      if (!merged.user_id && !merged.userId && !merged.uid && !merged.sub1) {
        return res.status(200).send("ok");
      }

      const result = await processOfferzyPostback(merged);
      return res.status(result.status).send(result.text);
    } catch (err) {
      console.error("[Offerzy Postback Fatal]", err);
      return res.status(500).send("ERROR: " + (err.message || "Internal error"));
    }
  }

  // Netlify Function fallback
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "text/plain"
  };

  try {
    const queryParams = reqOrEvent.queryStringParameters || {};
    const bodyParams = reqOrEvent.body ? JSON.parse(reqOrEvent.body) : {};
    const merged = { ...queryParams, ...bodyParams };

    if (!merged.user_id && !merged.userId && !merged.uid && !merged.sub1) {
      return { statusCode: 200, headers, body: "ok" };
    }

    const result = await processOfferzyPostback(merged);
    return { statusCode: result.status, headers, body: result.text };
  } catch (err) {
    return { statusCode: 500, headers, body: "ERROR: " + err.message };
  }
};

module.exports = universalHandler;
module.exports.handler = universalHandler;
