// Universal Serverless Auto-Postback Handler for PubScale Offerwall (pubscale.com)
// File Location in GitHub Repo: api/pubscale-postback.js
// Live S2S Callback URL set in PubScale Dashboard (App ID: 73908721):
// https://www.takarewardpro.com/api/pubscale-postback?value={value}&user_id={user_id}&token={token}&signature={signature}

const crypto = require('crypto');

const FIREBASE_PROJECT_ID = "takareward-bd";
const PUBSCALE_APP_ID = process.env.PUBSCALE_APP_ID || "73908721";
const PUBSCALE_SECRET_KEY = process.env.PUBSCALE_SECRET_KEY || "";

// Service Account Credentials for Superuser Admin Access to Firestore
const SERVICE_ACCOUNT = {
  client_email: process.env.FIREBASE_CLIENT_EMAIL || "",
  private_key: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  project_id: FIREBASE_PROJECT_ID
};

async function getGoogleAdminToken() {
  if (!SERVICE_ACCOUNT.client_email || !SERVICE_ACCOUNT.private_key) {
    throw new Error("Missing FIREBASE_CLIENT_EMAIL or FIREBASE_PRIVATE_KEY environment variables");
  }
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
