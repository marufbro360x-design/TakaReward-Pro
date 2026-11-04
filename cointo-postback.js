// Universal Serverless Auto-Postback Handler for Cointo Media (cointomedia.com)
// File Location in GitHub Repo: api/cointo-postback.js
// Live Postback URL to set in Cointo Dashboard: https://www.takarewardpro.com/api/cointo-postback
const crypto = require('crypto');

const FIREBASE_PROJECT_ID = "takareward-bd";
const COINTO_PUBLIC_KEY = "Dv0Ou9";
const COINTO_SECRET_KEY = process.env.COINTO_SECRET_KEY || "Nd8Ds2Jo9Aq2Hc7";

// Conversion Rate: $1.00 USD = 600,000 Coins = ৳60 BDT (10,000 Coins = ৳1 BDT)
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
  return crypto.createHash('md5').update(String(str)).digest('hex');
}

async function processCointoPostback(params) {
  // Cointo Official Parameters:
  // subId, transId, reward, payout, signature, status (1 = credit, 2 = chargeback),
  // company_id, offer_name, round_reward, userIp, country, uuid, event_id, event_name
  const subId = String(params.subId || params.sub_id || params.uid || params.user_id || params.userId || "").trim();
  const rawTransId = String(params.transId || params.trans_id || params.txid || params.transaction_id || "").trim();
  const rewardRaw = params.reward !== undefined ? String(params.reward).trim() : "";
  const payoutRaw = params.payout !== undefined ? String(params.payout).trim() : "0";
  const providedSig = String(params.signature || params.sig || params.hash || "").trim().toLowerCase();
  const statusRaw = String(params.status || params.type || "1").trim().toLowerCase();
  const offerId = String(params.company_id || params.offer_id || params.offerId || "cointo_offer").trim();
  const offerName = String(params.offer_name || params.offerName || params.event_name || "Cointo Offer").trim();
  const userIp = String(params.userIp || params.ip || "").trim();
  const country = String(params.country || "").trim();

  if (!subId) {
    return { status: 400, text: "ERROR: Missing subId" };
  }

  const transId = rawTransId || `cointo_${subId}_${Date.now()}`;

  // 1. Verify MD5 Signature if provided: md5(subId + transId + reward + SECRET_KEY)
  if (providedSig && !providedSig.startsWith("{") && !providedSig.startsWith("[")) {
    const expectedSig1 = md5Hash(`${subId}${rawTransId}${rewardRaw}${COINTO_SECRET_KEY}`).toLowerCase();
    const expectedSig2 = md5Hash(`${subId}${rawTransId}${payoutRaw}${COINTO_SECRET_KEY}`).toLowerCase();
    if (providedSig !== expectedSig1 && providedSig !== expectedSig2) {
      console.warn(`[Cointo Postback] Signature mismatch for subId=${subId}, transId=${rawTransId}. Provided=${providedSig}, Expected=${expectedSig1}`);
      return { status: 403, text: "Invalid signature" };
    }
  }

  // 2. Calculate Coins & USD Payout
  const payoutUsd = parseFloat(payoutRaw) || 0;
  const rewardNum = parseFloat(rewardRaw) || 0;

  let baseCoins = 0;
  if (payoutUsd > 0 && (rewardNum === 0 || rewardNum < payoutUsd * 10000)) {
    // If Cointo sent USD payout or low default currency multiplier (e.g. 100 or 1000 per $1), convert using $1 = 600,000 Coins
    baseCoins = Math.round(payoutUsd * COINS_PER_USD);
  } else if (rewardNum > 0) {
    baseCoins = Math.round(rewardNum);
  }

  if (baseCoins <= 0) {
    baseCoins = 6000; // Minimum fallback (৳0.60) for 0-amount test pings
  }

  const isChargeback = statusRaw === "2" || statusRaw === "chargeback" || statusRaw === "reversed" || rewardNum < 0 || payoutUsd < 0;
  const finalCoinsDelta = isChargeback ? -Math.abs(baseCoins) : Math.abs(baseCoins);
  const takaAmount = parseFloat((Math.abs(baseCoins) / 10000).toFixed(2));

  const adminToken = await getGoogleAdminToken();

  // 3. Deduplication Check
  const docId = `cointo_${transId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const existingLog = await getFirestoreDoc(adminToken, `cointo_logs/${docId}`);
  if (existingLog) {
    const existingStatus = existingLog.fields?.status?.stringValue || " credited";
    if (!isChargeback || existingStatus === "reversed") {
      return { status: 200, text: "OK" };
    }
  }

  // 4. Commit Credit/Debit to User & Write Log + Notification
  const nowIso = new Date().toISOString();
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:commit`;
  const userDocPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${subId}`;
  const logDocPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/cointo_logs/${docId}`;
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
              fieldPath: "totalCointoEarnings",
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
            userId: { stringValue: subId },
            transId: { stringValue: transId },
            offerId: { stringValue: offerId },
            offerName: { stringValue: offerName },
            payoutUsd: { doubleValue: Math.abs(payoutUsd) },
            rewardRaw: { stringValue: rewardRaw },
            coins: { integerValue: String(finalCoinsDelta) },
            currencyAmount: { integerValue: String(finalCoinsDelta) },
            taka: { doubleValue: takaAmount },
            status: { stringValue: isChargeback ? "reversed" : "credited" },
            type: { stringValue: isChargeback ? "2" : "1" },
            userIp: { stringValue: userIp },
            country: { stringValue: country },
            provider: { stringValue: "Cointo" },
            createdAt: { timestampValue: nowIso }
          }
        }
      },
      {
        update: {
          name: notifDocPath,
          fields: {
            userId: { stringValue: subId },
            title: { stringValue: isChargeback ? "⚠️ Cointo অফার চার্জব্যাক" : "🎉 Cointo অফার সম্পন্ন!" },
            message: {
              stringValue: isChargeback
                ? `Cointo অফার (${offerName}) চার্জব্যাক হওয়ায় ${Math.abs(baseCoins).toLocaleString()} কয়েন (৳${takaAmount}) সমন্বয় করা হয়েছে।`
                : `অভিনন্দন! Cointo অফার (${offerName}) সম্পন্ন করে আপনি +${Math.abs(baseCoins).toLocaleString()} কয়েন (৳${takaAmount}) পেয়েছেন!`
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
    console.error("[Cointo Postback Commit Error]", errText);
    return { status: 500, text: "ERROR: Database commit failed" };
  }

  console.log(`[Cointo Postback OK] User=${subId}, Trans=${transId}, Coins=${finalCoinsDelta}, Offer=${offerName}`);
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

      // Health check when opened in browser without subId
      if (!merged.subId && !merged.sub_id && !merged.uid && !merged.user_id && !merged.userId) {
        return res.status(200).send("OK - TakaReward Pro Cointo S2S Postback Endpoint Active");
      }

      const result = await processCointoPostback(merged);
      return res.status(result.status).send(result.text);
    } catch (err) {
      console.error("[Cointo Postback Fatal]", err);
      return res.status(500).send("ERROR: " + (err.message || "Internal error"));
    }
  }

  // Netlify Function fallback
  try {
    const queryParams = reqOrEvent.queryStringParameters || {};
    const bodyParams = reqOrEvent.body ? JSON.parse(reqOrEvent.body) : {};
    const merged = { ...queryParams, ...bodyParams };

    if (!merged.subId && !merged.sub_id && !merged.uid && !merged.user_id && !merged.userId) {
      return { statusCode: 200, body: "OK - TakaReward Pro Cointo S2S Postback Endpoint Active" };
    }

    const result = await processCointoPostback(merged);
    return { statusCode: result.status, body: result.text };
  } catch (err) {
    return { statusCode: 500, body: "ERROR: " + err.message };
  }
};

module.exports = universalHandler;
module.exports.handler = universalHandler;
