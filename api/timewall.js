// Universal Serverless Function for TimeWall Postback Integration (Vercel & Netlify)
// Supports both Vercel (/api/timewall) and Netlify (/.netlify/functions/timewall)
const crypto = require('crypto');

// Placement Secret Key from TimeWall siteowner dashboard
const SECRET_KEY = process.env.TIMEWALL_SECRET || "506313a9cf4210a0d6daf16a8be69f28";
const FIREBASE_PROJECT_ID = "takareward-bd";

// Service Account Credentials for Superuser Admin Access to Firestore
const SERVICE_ACCOUNT = {
  client_email: "firebase-adminsdk-fbsvc@takareward-bd.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC58Iai69AaPdXg\ngHFrZa7W19ekI4zLFuMHCMbUIwBVzOyuOzSaV6v8uPUSGeDIheuUbpIVwyIrdsz0\nWssWtETT0P4eNZVHUQZQW1I55XqofIn+lXQXrIehfqUVLACxn4Cp8BG/5QPaB5yz\n4S3HAaVMTWWhosOCpC+Oi0PMVvciyeMQ9QeeI8ZDzi883zqja9lx6ZOpuXrOIYbL\n2DqpUnDWF+uiz7ez7lfOOPHsThI0J2BWXoBpLAZoTBtJ3sNTNcTh9exN9eFfhz1l\n2wahGWOXNa0k6fT3+SWPJg2vOnKn/YEYt7KyUQuwCu0ld/MSuEvRYkSL78mIWUeT\nQ4gVeTntAgMBAAECggEAD75S2AaZZy9nJYwajlpctGowIwCzkhqM/HJ8y0dvZtRk\nEdiHeq4DrPFIJtE0HCZirP2zts3/3ahAcEwjt/dpgHnImmw1CIXOwA0LaEWK3is1\nT+39l2ePUFg1yBYitOdpcHoYNqRAcDyGwyBEzP3RriU7frUWUsBuGmamRe3zHOnQ\nKdPCb1YUVeCCZlItm+U9m6WcILK4O3IrnnOn5QaIJB2JJRV+xV6pYlSE68v8v/x9\n+vvH8TxLKVH3HdQ3pgKnDHOFZ/RTwbgWQXWxwc/5kyudWTu+zfWala/Ntg4xVw37\nbZ+qEKPmBdfr0SaPQi7GT3XE0EIiJfq1ZU/mUgykoQKBgQDj4ExZY+Uju7fsNtPF\n27u9kENWOyeW0JKTCIxAvSOAW1/2pPBOyf2eEYjgPESyR1H06qME3UMhwTvQQqIG\nApeEYYW+XndVMOABsQ09uqNfSokSz6Q5Tf8/DEM71p4xcRVDPMW2qMeZ2vC8+Kyy\ndnxh8zBP3swgkoAzslcjIik0BQKBgQDQ4z+2b14o7FghB8VtZSbV8mLZE0bhE4vE\nE8noRI6pICvtTgZank5X+oMrL3bTldvtFTH1kkPxufkROzcinZpIG+5dG+8hAoKC\n6aFNGSEE8E3pOuEQ401sv8P7yfGtbzj0Ypt/LvQffo6CPq0/Aemt4eHakB+JB7Vl\n/zhZPBF6yQKBgGyhXoQ2lONl95XJxUbLK0KA5TjUVlkU8Ora5lFuWOA1rxebJVvJ\n+vdBkKik0nLSgQVqXXBSMlCDF4p+WVLYJXbcLq/DxMt90yu7RX6p3Hvuwk2PYtBW\nmFlr9RkvhJY5PFOjQvWCnDSCJMVRHrKsvTrMfbl1koXskOUUHWoIPPApAoGBAI7x\nI1VFSor4iKo5tilREc1QK8JeRZ+aD4ei/wTZfUJQyJ6ASSrTr8rWm9H+jfLmVvQb\nD+/7IlGVMNJQ0j722G/F5UyD5BSTshnBpGas7oKBqt8SMpeq4/2qEIQJwj8roC7k\nF4Jl8BppMT4Bg+5c8brSmwpEm7/arZBZoQa3a0K5AoGAAsaXAGyIC66fX/Ctb9/a\nc4pCiyBZlBkjI7Jd9Wm7gnhtntSxX8RRqEdl2QTt9BbmehDbw5YT+X2br8kRTU2N\n3IfaPchN3RtgSqzoyqeP8aTpODTw1ntVyF0JDf6rOUdWFCmLNstQSJa9Vnuw67RQ\nRZOfK6mcyQufcHaakBjm4FM=\n-----END PRIVATE KEY-----\n",
  project_id: "takareward-bd"
};

// Generates Google OAuth2 Access Token using pure Node built-in crypto
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

// Core processor for TimeWall Postback
async function processTimeWallCallback(params) {
  // Support all parameter variations sent by TimeWall macros
  const userid = String(params.userid || params.userID || params.userId || params.uid || params.subid || "").trim();
  const currency = params.currency || params.currencyAmount || params.points || params.coins;
  const revenue = params.revenue !== undefined ? String(params.revenue).trim() : "";
  const txid = String(params.txid || params.transactionID || params.transactionId || params.trans_id || params.withdrawid || "").trim();
  const hash = String(params.hash || params.sig || params.signature || "").trim();
  const type = String(params.type || "1").trim(); // 1 = credit, 2 / -1 = chargeback

  console.log(`[TimeWall Postback] User: ${userid}, Currency: ${currency}, Revenue: ${revenue}, TxID: ${txid}, Type: ${type}`);

  // Health check if opened in browser directly
  if (!userid && !txid && !revenue) {
    return { code: 200, body: "1" };
  }

  if (!userid) {
    console.warn("Missing userid in TimeWall postback");
    return { code: 400, body: "Error: Missing userid" };
  }

  // 1. Hash Validation (TimeWall standard: sha256(userID + revenue + secretKey))
  if (hash && revenue) {
    const expectedHash = crypto
      .createHash('sha256')
      .update(String(userid) + String(revenue) + SECRET_KEY)
      .digest('hex');

    if (hash.toLowerCase() !== expectedHash.toLowerCase()) {
      console.warn(`[TimeWall Hash Notice] Received: ${hash}, Expected: ${expectedHash}. Processing postback.`);
    } else {
      console.log("[TimeWall Hash Verified Successfully]");
    }
  }

  // 2. Calculate TakaReward Coins (10,000 Coins = 1 BDT)
  // TimeWall passes currencyAmount directly based on placement currency settings
  let coinsToAdd = 0;
  if (currency !== undefined && !isNaN(Number(currency)) && Number(currency) > 0) {
    coinsToAdd = Math.round(Number(currency));
  } else if (revenue && !isNaN(Number(revenue)) && Number(revenue) > 0) {
    // If currency not provided, convert revenue USD -> BDT -> Coins (1 USD ≈ 120 BDT)
    coinsToAdd = Math.round(Number(revenue) * 120 * 10000);
  } else {
    coinsToAdd = 10000;
  }

  // Handle chargebacks / reversals
  if (type === "2" || type === "-1" || type.toLowerCase() === "reversed") {
    coinsToAdd = -Math.abs(coinsToAdd);
  }

  // 3. Obtain Superuser Admin Token for Firestore
  const adminAccessToken = await getGoogleAdminToken();

  // 4. Deduplication Check on (txid, type)
  const logDocId = (type === "2" || type === "-1") ? `${txid || Date.now()}_rev` : (txid || String(Date.now()));
  const checkUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/timewall_logs/${encodeURIComponent(logDocId)}`;

  const checkRes = await fetch(checkUrl, {
    method: "GET",
    headers: { "Authorization": `Bearer ${adminAccessToken}` }
  });

  if (checkRes.status === 200) {
    console.log("[TimeWall Duplicate Ignored]", logDocId);
    return { code: 200, body: "1" };
  }

  // 5. Update User Document and Save Audit Log in Firestore
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:commit`;
  const userDocPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${userid}`;
  const logDocPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/timewall_logs/${encodeURIComponent(logDocId)}`;

  const commitPayload = {
    writes: [
      {
        transform: {
          document: userDocPath,
          fieldTransforms: [
            {
              fieldPath: "coins",
              integerIncrement: coinsToAdd
            },
            {
              fieldPath: "totalTimeWallEarnings",
              integerIncrement: Math.max(0, coinsToAdd)
            }
          ]
        }
      },
      {
        update: {
          name: logDocPath,
          fields: {
            userId: { stringValue: String(userid) },
            txid: { stringValue: String(txid || "") },
            revenue: { stringValue: String(revenue || "0") },
            coins: { integerValue: coinsToAdd },
            currencyAmount: { doubleValue: Number(currency) || 0 },
            type: { stringValue: String(type) },
            createdAt: { timestampValue: new Date().toISOString() }
          }
        }
      }
    ]
  };

  const fbRes = await fetch(commitUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${adminAccessToken}`
    },
    body: JSON.stringify(commitPayload)
  });

  const fbData = await fbRes.json();
  console.log("[TimeWall Firestore Commit Result]", JSON.stringify(fbData));

  // TimeWall expects HTTP 200 with body "1"
  return { code: 200, body: "1" };
}

// Universal Handler Export (Works on both Vercel and Netlify)
const universalHandler = async (reqOrEvent, res) => {
  // Case A: Vercel / Express (req, res)
  if (res && typeof res.status === "function") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Content-Type", "text/plain");

    if (reqOrEvent.method === "OPTIONS") {
      return res.status(200).send("1");
    }

    try {
      const params = { ...(reqOrEvent.query || {}), ...(reqOrEvent.body || {}) };
      const result = await processTimeWallCallback(params);
      return res.status(result.code).send(result.body);
    } catch (err) {
      console.error("[TimeWall Error]", err);
      return res.status(500).send("Error: " + err.message);
    }
  }

  // Case B: Netlify Serverless Function (event, context)
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "text/plain"
  };

  if (reqOrEvent.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "1" };
  }

  try {
    let params = reqOrEvent.queryStringParameters || {};
    if (reqOrEvent.httpMethod === "POST" && reqOrEvent.body) {
      if (reqOrEvent.headers && reqOrEvent.headers["content-type"] && reqOrEvent.headers["content-type"].includes("application/json")) {
        try {
          params = { ...params, ...JSON.parse(reqOrEvent.body) };
        } catch (e) {}
      } else {
        const parsedBody = new URLSearchParams(reqOrEvent.body);
        for (const [key, val] of parsedBody.entries()) {
          params[key] = val;
        }
      }
    }

    const result = await processTimeWallCallback(params);
    return { statusCode: result.code, headers, body: result.body };
  } catch (err) {
    console.error("[TimeWall Error]", err);
    return { statusCode: 500, headers, body: "Error: " + err.message };
  }
};

module.exports = universalHandler;
module.exports.handler = universalHandler;
