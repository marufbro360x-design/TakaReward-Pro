// Universal Serverless Auto-Postback Handler for PubScale Offerwall (pubscale.com)
// File Location in GitHub Repo: api/pubscale-postback.js
// Live S2S Callback URL set in PubScale Dashboard (App ID: 73908721):
// https://www.takarewardpro.com/api/pubscale-postback?value={value}&user_id={user_id}&token={token}&signature={signature}

const crypto = require('crypto');

const FIREBASE_PROJECT_ID = "takareward-bd";
const PUBSCALE_APP_ID = process.env.PUBSCALE_APP_ID || "73908721";
const PUBSCALE_SECRET_KEY = process.env.PUBSCALE_SECRET_KEY || "1238c65d-8ff5-4513-a6c0-93ef3bfcf964";

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

async function processPubScalePostback(params) {
  // Official PubScale S2S Callback Parameters:
  // user_id, value, token, signature
  // Official Signature Formula (https://pubscale.gitbook.io/offerwall-sdk/1.0.9/server-to-server-s2s-callback-configuration):
  // md5(`${secret_key}.${user_id}.${Math.trunc(value)}.${token}`)
  const rawUserId = params.user_id !== undefined ? String(params.user_id) : String(params.userId || params.uid || "");
  const userId = rawUserId.trim();
  const rawValue = params.value !== undefined ? String(params.value).trim() : "";
  const token = String(params.token || "").trim();
  const providedSig = String(params.signature || "").trim().toLowerCase();

  if (!userId || userId.startsWith("{")) {
    return { status: 400, text: "ERROR: Missing user_id" };
  }

  if (!token || token.startsWith("{")) {
    return { status: 400, text: "ERROR: Missing token" };
  }

  const parsedValue = parseFloat(rawValue.replace(/,/g, ""));
  if (Number.isNaN(parsedValue)) {
    return { status: 400, text: "ERROR: Invalid value" };
  }

  // 1. Mandatory PubScale MD5 Signature Verification
  if (!providedSig || providedSig.startsWith("{")) {
    console.warn(`[PubScale Postback] Missing signature for user_id=${userId}, token=${token}`);
    return { status: 403, text: "invalid signature" };
  }

  const intValue = Math.trunc(parsedValue);
  const expectedSig = md5Hash(`${PUBSCALE_SECRET_KEY}.${userId}.${intValue}.${token}`);
  const expectedSigRaw = md5Hash(`${PUBSCALE_SECRET_KEY}.${rawUserId}.${rawValue}.${token}`);

  if (providedSig !== expectedSig && providedSig !== expectedSigRaw) {
    console.warn(`[PubScale Postback] Signature mismatch for user_id=${userId}, token=${token}. Provided=${providedSig}, Expected=${expectedSig}`);
    return { status: 403, text: "invalid signature" };
  }

  const coinsDelta = Math.round(parsedValue);
  if (coinsDelta === 0) {
    return { status: 200, text: "ok" };
  }

  const isReversed = coinsDelta < 0;
  const absCoins = Math.abs(coinsDelta);
  const takaAmount = parseFloat((absCoins / 10000).toFixed(2));

  const adminToken = await getGoogleAdminToken();

  // 2. Deduplication Check by unique token
  const docId = `ps_${token.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const existingLog = await getFirestoreDoc(adminToken, `pubscale_logs/${docId}`);
  if (existingLog) {
    console.log(`[PubScale Duplicate Ignored] Already processed token=${token}`);
    return { status: 200, text: "ok" };
  }

  // 3. Check if User Document exists (so dashboard Test Callback with dummy user_id still returns 200 ok)
  const userDoc = await getFirestoreDoc(adminToken, `users/${encodeURIComponent(userId)}`);
  const userExists = Boolean(userDoc);

  const nowIso = new Date().toISOString();
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:commit`;
  const userDocPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${userId}`;
  const logDocPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/pubscale_logs/${docId}`;
  const notifDocPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/notifications/${docId}_${isReversed ? "rev" : "n"}`;

  const writes = [];

  if (userExists) {
    writes.push({
      transform: {
        document: userDocPath,
        fieldTransforms: [
          {
            fieldPath: "coins",
            increment: { integerValue: String(coinsDelta) }
          },
          {
            fieldPath: "totalPubscaleEarnings",
            increment: { integerValue: String(coinsDelta) }
          },
          {
            fieldPath: "totalOfferwallEarnings",
            increment: { integerValue: String(coinsDelta) }
          }
        ]
      }
    });

    writes.push({
      update: {
        name: notifDocPath,
        fields: {
          userId: { stringValue: userId },
          title: { stringValue: isReversed ? "⚠️ PubScale অফার রিভার্সাল" : "🎉 PubScale অফার সম্পন্ন!" },
          message: {
            stringValue: isReversed
              ? `PubScale অফার রিভার্স হওয়ায় ${absCoins.toLocaleString()} কয়েন (৳${takaAmount}) সমন্বয় করা হয়েছে।`
              : `অভিনন্দন! PubScale অফার সম্পন্ন করে আপনি +${absCoins.toLocaleString()} কয়েন (৳${takaAmount}) পেয়েছেন!`
          },
          time: { stringValue: "Just now" },
          createdAt: { timestampValue: nowIso }
        }
      }
    });
  }

  writes.push({
    update: {
      name: logDocPath,
      fields: {
        userId: { stringValue: userId },
        token: { stringValue: token },
        appId: { stringValue: PUBSCALE_APP_ID },
        valueRaw: { stringValue: rawValue },
        coins: { integerValue: String(coinsDelta) },
        taka: { doubleValue: takaAmount },
        status: { stringValue: isReversed ? "reversed" : (userExists ? "credited" : "test_ok") },
        provider: { stringValue: "PubScale" },
        createdAt: { timestampValue: nowIso }
      }
    }
  });

  const commitRes = await fetch(commitUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${adminToken}`
    },
    body: JSON.stringify({ writes })
  });

  if (!commitRes.ok) {
    const errText = await commitRes.text();
    console.error("[PubScale Postback Commit Error]", errText);
    return { status: 500, text: "ERROR: Database commit failed" };
  }

  console.log(`[PubScale Postback OK] User=${userId}, Token=${token}, Coins=${coinsDelta}, UserExists=${userExists}`);
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

      if (!merged.user_id && !merged.userId && !merged.uid) {
        return res.status(200).send("ok");
      }

      const result = await processPubScalePostback(merged);
      return res.status(result.status).send(result.text);
    } catch (err) {
      console.error("[PubScale Postback Fatal]", err);
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

    if (!merged.user_id && !merged.userId && !merged.uid) {
      return { statusCode: 200, headers, body: "ok" };
    }

    const result = await processPubScalePostback(merged);
    return { statusCode: result.status, headers, body: result.text };
  } catch (err) {
    return { statusCode: 500, headers, body: "ERROR: " + err.message };
  }
};

module.exports = universalHandler;
module.exports.handler = universalHandler;
