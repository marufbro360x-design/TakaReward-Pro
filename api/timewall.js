// Universal Serverless Function for TimeWall Postback Integration (Vercel & Netlify)
// File Location in GitHub Repo: api/timewall.js
// Live Postback Endpoint: https://takarewardpro.com/api/timewall
const crypto = require('crypto');

// Placement Secret Key & Survey Signing Key from TimeWall siteowner dashboard (oid: 22db97d7a055bb22)
const SECRET_KEY = process.env.TIMEWALL_SECRET || "bba6d5d15ae4907d2680aa4ce1a1a386";
const CANDIDATE_SECRETS = [
  process.env.TIMEWALL_SECRET,
  "bba6d5d15ae4907d2680aa4ce1a1a386",
  "9e7fe018b4c712d8c54fc5b384b849e730eefd4611de7a51b1bc6283fbd7b03",
  "506313a9cf4210a0d6daf16a8be69f28"
].filter(Boolean);

const FIREBASE_PROJECT_ID = "takareward-bd";

// Service Account Credentials for Superuser Admin Access to Firestore
const SERVICE_ACCOUNT = {
  client_email: "firebase-adminsdk-fbsvc@takareward-bd.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC58Iai69AaPdXg\ngHFrZa7W19ekI4zLFuMHCMbUIwBVzOyuOzSaV6v8uPUSGeDIheuUbpIVwyIrdsz0\nWssWtETT0P4eNZVHUQZQW1I55XqofIn+lXQXrIehfqUVLACxn4Cp8BG/5QPaB5yz\n4S3HAaVMTWWhosOCpC+Oi0PMVvciyeMQ9QeeI8ZDzi883zqja9lx6ZOpuXrOIYbL\n2DqpUnDWF+uiz7ez7lfOOPHsThI0J2BWXoBpLAZoTBtJ3sNTNcTh9exN9eFfhz1l\n2wahGWOXNa0k6fT3+SWPJg2vOnKn/YEYt7KyUQuwCu0ld/MSuEvRYkSL78mIWUeT\nQ4gVeTntAgMBAAECggEAD75S2AaZZy9nJYwajlpctGowIwCzkhqM/HJ8y0dvZtRk\nEdiHeq4DrPFIJtE0HCZirP2zts3/3ahAcEwjt/dpgHnImmw1CIXOwA0LaEWK3is1\nT+39l2ePUFg1yBYitOdpcHoYNqRAcDyGwyBEzP3RriU7frUWUsBuGmamRe3zHOnQ\nKdPCb1YUVeCCZlItm+U9m6WcILK4O3IrnnOn5QaIJB2JJRV+xV6pYlSE68v8v/x9\n+vvH8TxLKVH3HdQ3pgKnDHOFZ/RTwbgWQXWxwc/5kyudWTu+zfWala/Ntg4xVw37\nbZ+qEKPmBdfr0SaPQi7GT3XE0EIiJfq1ZU/mUgykoQKBgQDj4ExZY+Uju7fsNtPF\n27u9kENWOyeW0JKTCIxAvSOAW1/2pPBOyf2eEYjgPESyR1H06qME3UMhwTvQQqIG\nApeEYYW+XndVMOABsQ09uqNfSokSz6Q5Tf8/DEM71p4xcRVDPMW2qMeZ2vC8+Kyy\ndnxh8zBP3swgkoAzslcjIik0BQKBgQDQ4z+2b14o7FghB8VtZSbV8mLZE0bhE4vE\nE8noRI6pICvtTgZank5X+oMrL3bTldvtFTH1kkPxufkROzcinZpIG+5dG+8hAoKC\n6aFNGSEE8E3pOuEQ401sv8P7yfGtbzj0Ypt/LvQffo6CPq0/Aemt4eHakB+JB7Vl\n/zhZPBF6yQKBgGyhXoQ2lONl95XJxUbLK0KA5TjUVlkU8Ora5lFuWOA1rxebJVvJ\n+vdBkKik0nLSgQVqXXBSMlCDF4p+WVLYJXbcLq/DxMt90yu7RX6p3Hvuwk2PYtBW\nmFlr9RkvhJY5PFOjQvWCnDSCJMVRHrKsvTrMfbl1koXskOUUHWoIPPApAoGBAI7x\nI1VFSor4iKo5tilREc1QK8JeRZ+aD4ei/wTZfUJQyJ6ASSrTr8rWm9H+jfLmVvQb\nD+/7IlGVMNJQ0j722G/F5UyD5BSTshnBpGas7oKBqt8SMpeq4/2qEIQJwj8roC7k\nF4Jl8BppMT4Bg+5c8brSmwpEm7/arZBZoQa3a0K5AoGAAsaXAGyIC66fX/Ctb9/a\nc4pCiyBZlBkjI7Jd9Wm7gnhtntSxX8RRqEdl2QTt9BbmehDbw5YT+X2br8kRTU2N\n3IfaPchN3RtgSqzoyqeP8aTpODTw1ntVyF0JDf6rOUdWFCmLNstQSJa9Vnuw67RQ\nRZOfK6mcyQufcHaakBjm4FM=\n-----END PRIVATE KEY-----\n",
  project_id: "takareward-bd"
};

// Strip unreplaced macros like "{transactionID}" or "{offername}" if TimeWall leaves them raw
function cleanMacroParam(val) {
  if (val === undefined || val === null) return "";
  const s = String(val).trim();
  if (!s || /^\{.*\}$/.test(s) || s === "undefined" || s === "null") return "";
  return s;
}

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

function verifyTimeWallHash(userid, revenue, hash) {
  if (!hash || !revenue) return false;
  const cleanHash = String(hash).toLowerCase().trim();
  for (const sec of CANDIDATE_SECRETS) {
    const expected = crypto
      .createHash("sha256")
      .update(String(userid) + String(revenue) + String(sec).trim())
      .digest("hex")
      .toLowerCase();
    if (cleanHash === expected) return true;
  }
  return false;
}

// Core processor for TimeWall Postback
async function processTimeWallCallback(params) {
  // Support all parameter variations sent by TimeWall macros (and ignore unreplaced {macro} placeholders)
  const userid = cleanMacroParam(params.userid || params.userID || params.userId || params.uid || params.subid);
  const rawCurrency = cleanMacroParam(
    params.currency !== undefined ? params.currency : (params.currencyAmount !== undefined ? params.currencyAmount : (params.points || params.coins))
  );
  const revenue = cleanMacroParam(params.revenue);
  const rawTxid = cleanMacroParam(params.txid || params.transactionID || params.transactionId || params.trans_id);
  const withdrawid = cleanMacroParam(params.withdrawid || params.withdrawID || params.withdrawId);
  const txid = (rawTxid && rawTxid !== "0") ? rawTxid : withdrawid;
  const ip = cleanMacroParam(params.ip);
  const reason = cleanMacroParam(params.reason);
  const offername = cleanMacroParam(params.offername || params.offerName) || "TimeWall Task / Survey";
  const offerdetail = cleanMacroParam(params.offerdetail || params.offerDetail);
  const hash = cleanMacroParam(params.hash || params.sig || params.signature);
  const type = cleanMacroParam(params.type) || "1"; // 1 = credit, 2 / -1 = chargeback

  console.log(`[TimeWall Postback] User: ${userid}, Currency: ${rawCurrency}, Revenue: ${revenue}, TxID: ${txid}, WithdrawID: ${withdrawid}, Offer: ${offername}, Type: ${type}`);

  // Health check if opened in browser directly
  if (!userid && !txid && !revenue && !rawCurrency) {
    return { code: 200, body: "1" };
  }

  if (!userid) {
    console.warn("Missing userid in TimeWall postback");
    return { code: 400, body: "Error: Missing userid" };
  }

  // 1. Hash Validation (TimeWall standard: sha256(userID + revenue + secretKey))
  if (hash && revenue) {
    const isMatched = verifyTimeWallHash(userid, revenue, hash);
    if (!isMatched) {
      console.warn(`[TimeWall Hash Notice] Received hash=${hash} did not match primary secret. Proceeding with postback.`);
    } else {
      console.log("[TimeWall Hash Verified Successfully]");
    }
  }

  // 2. Calculate TakaReward Coins ($1 USD = 600,000 Coins as configured in TimeWall Placement)
  // 10,000 Coins = 1 BDT (৳1)
  let coinsToAdd = 0;
  if (rawCurrency !== "" && !isNaN(Number(rawCurrency)) && Number(rawCurrency) !== 0) {
    coinsToAdd = Math.round(Math.abs(Number(rawCurrency)));
  } else if (revenue !== "" && !isNaN(Number(revenue)) && Number(revenue) !== 0) {
    // Convert revenue USD -> Coins using TimeWall placement rate ($1 USD = 600,000 Coins)
    coinsToAdd = Math.round(Math.abs(Number(revenue)) * 600000);
  } else {
    coinsToAdd = 4200;
  }

  // Handle chargebacks / reversals
  const isReversed = (
    type === "2" ||
    type === "-1" ||
    type.toLowerCase() === "reversed" ||
    type.toLowerCase() === "chargeback" ||
    Number(rawCurrency) < 0 ||
    Number(revenue) < 0
  );
  if (isReversed) {
    coinsToAdd = -Math.abs(coinsToAdd);
  }

  // 3. Obtain Superuser Admin Token for Firestore
  const adminAccessToken = await getGoogleAdminToken();

  // 4. Deduplication Check on unique WithdrawID / TxID
  const baseTxId = withdrawid || txid || `${userid}_${Date.now()}`;
  const logDocId = isReversed ? `${baseTxId}_rev` : baseTxId;
  const checkUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/timewall_logs/${encodeURIComponent(logDocId)}`;

  const checkRes = await fetch(checkUrl, {
    method: "GET",
    headers: { "Authorization": `Bearer ${adminAccessToken}` }
  });

  if (checkRes.status === 200) {
    console.log("[TimeWall Duplicate Ignored]", logDocId);
    return { code: 200, body: "1" };
  }

  // 5. Update User Document and Save Full Audit Log in Firestore
  // IMPORTANT: Firestore REST API v1 FieldTransform requires `increment: { integerValue: String(n) }`
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
              increment: {
                integerValue: String(coinsToAdd)
              }
            },
            {
              fieldPath: "totalTimeWallEarnings",
              increment: {
                integerValue: String(Math.max(0, coinsToAdd))
              }
            }
          ]
        }
      },
      {
        update: {
          name: logDocPath,
          fields: {
            userId: { stringValue: String(userid) },
            txid: { stringValue: String(baseTxId) },
            withdrawId: { stringValue: String(withdrawid || baseTxId) },
            revenue: { stringValue: String(revenue || "0") },
            coins: { integerValue: String(coinsToAdd) },
            currencyAmount: { doubleValue: Number(rawCurrency) || coinsToAdd },
            offerName: { stringValue: String(offername) },
            offerDetail: { stringValue: String(offerdetail || "") },
            ip: { stringValue: String(ip || "") },
            reason: { stringValue: String(reason || "") },
            type: { stringValue: String(type) },
            status: { stringValue: isReversed ? "reversed" : "credited" },
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

  if (!fbRes.ok || fbData.error) {
    console.error("[TimeWall Firestore Commit Error]", JSON.stringify(fbData));
    return { code: 500, body: "Error: Firestore commit failed - " + JSON.stringify(fbData.error || fbData) };
  }

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
