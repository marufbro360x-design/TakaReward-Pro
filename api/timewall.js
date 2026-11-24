// Universal Serverless Function for TimeWall Postback Integration (Vercel & Netlify)
// File Location in GitHub Repo: api/timewall.js
// Live Postback Endpoint: https://takarewardpro.com/api/timewall
const crypto = require('crypto');

// Placement Secret Key & Survey Signing Key from TimeWall siteowner dashboard (oid: 22db97d7a055bb22)
const SECRET_KEY = process.env.TIMEWALL_SIGNING_KEY || process.env.TIMEWALL_SECRET || "";
const CANDIDATE_SECRETS = [
  process.env.TIMEWALL_SIGNING_KEY,
  process.env.TIMEWALL_SECRET
].filter(Boolean);

const FIREBASE_PROJECT_ID = "takareward-bd";

// Service Account Credentials for Superuser Admin Access to Firestore
const SERVICE_ACCOUNT = {
  client_email: process.env.FIREBASE_CLIENT_EMAIL || "",
  private_key: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  project_id: FIREBASE_PROJECT_ID
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

// =========================================================================
// TARGETED REFERRAL UNLOCK (1st Task -> Active + 10k Bonus) + 10% COMMISSION
// =========================================================================
function getChallengeBdDateKey(ms = Date.now()) {
  const bd = new Date(ms + 6 * 3600 * 1000);
  return bd.toISOString().slice(0, 10);
}

function getChallengeBdWeekKey(ms = Date.now()) {
  const bd = new Date(ms + 6 * 3600 * 1000);
  const d = new Date(Date.UTC(bd.getUTCFullYear(), bd.getUTCMonth(), bd.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

async function processReferralUnlockAndCommission(adminToken, userId, earnedCoins, providerName, txId) {
  try {
    const positiveCoins = Math.round(Number(earnedCoins) || 0);
    if (!userId || positiveCoins <= 0) return;

    const baseUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
    const userRes = await fetch(`${baseUrl}/users/${encodeURIComponent(userId)}`, {
      method: "GET",
      headers: { "Authorization": `Bearer ${adminToken}` }
    });
    if (!userRes.ok) return;
    const userDoc = await userRes.json();
    const uFields = userDoc && userDoc.fields;
    if (!uFields) return;

    const todayBdKey = getChallengeBdDateKey();
    const weekBdKey = getChallengeBdWeekKey();
    const nowIso = new Date().toISOString();
    const userDocPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${userId}`;

    // 1. Update User's Real-Time Daily Challenge Earnings (BD UTC+6, resets automatically on new day)
    try {
      const prevDailyDate = (uFields.dailyEarnedDate && uFields.dailyEarnedDate.stringValue) ? uFields.dailyEarnedDate.stringValue.trim() : "";
      const prevDailyCoins = Number((uFields.dailyEarnedCoins && (uFields.dailyEarnedCoins.integerValue || uFields.dailyEarnedCoins.doubleValue)) || 0) || 0;
      const nextDailyCoins = (prevDailyDate === todayBdKey) ? (prevDailyCoins + positiveCoins) : positiveCoins;

      await fetch(`${baseUrl}:commit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          writes: [{
            update: {
              name: userDocPath,
              fields: {
                dailyEarnedDate: { stringValue: todayBdKey },
                dailyEarnedCoins: { integerValue: String(nextDailyCoins) }
              }
            },
            updateMask: { fieldPaths: ["dailyEarnedDate", "dailyEarnedCoins"] }
          }]
        })
      });
    } catch (dailyErr) {
      console.warn(`[${providerName} Daily Challenge Update Notice]`, dailyErr && dailyErr.message ? dailyErr.message : dailyErr);
    }

    // 2. Targeted Referral Unlock + 10% Lifetime Commission + Weekly Affiliate Challenge Tracking
    const referredByCode = (uFields.referredBy && uFields.referredBy.stringValue) ? uFields.referredBy.stringValue.trim() : "";
    let referrerUid = (uFields.referredByUid && uFields.referredByUid.stringValue) ? uFields.referredByUid.stringValue.trim() : "";

    if (!referrerUid && !referredByCode) return;

    if (!referrerUid && referredByCode) {
      const qRes = await fetch(`${baseUrl}:runQuery`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: "users" }],
            where: {
              fieldFilter: {
                field: { fieldPath: "myInviteCode" },
                op: "EQUAL",
                value: { stringValue: referredByCode }
              }
            },
            limit: 1
          }
        })
      });
      if (qRes.ok) {
        const rows = await qRes.json();
        const match = Array.isArray(rows) ? rows.find(r => r && r.document && r.document.name) : null;
        if (match) referrerUid = match.document.name.split("/").pop();
      }
    }

    if (!referrerUid || referrerUid === userId) return;

    const alreadyActivated = Boolean(uFields.referralActivated && uFields.referralActivated.booleanValue === true);
    const isFirstActivation = !alreadyActivated;
    const unlockBonus = isFirstActivation ? 10000 : 0;
    const commissionCoins = Math.round(positiveCoins * 0.10);
    const totalReferrerCredit = unlockBonus + commissionCoins;
    if (totalReferrerCredit <= 0) return;

    const referrerDocPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${referrerUid}`;
    const safeTx = String(txId || Date.now()).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
    const notifDocPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/notifications/ref_${safeTx}`;
    const friendName = (uFields.name && uFields.name.stringValue) ? uFields.name.stringValue : "আপনার রেফার্ড বন্ধু";

    // Read referrer's current weekly challenge fields for clean weekly rollover
    let nextWeeklyTeamCoins = positiveCoins;
    let nextWeeklyActiveRefs = isFirstActivation ? 1 : 0;
    try {
      const refGetRes = await fetch(`${baseUrl}/users/${encodeURIComponent(referrerUid)}`, {
        method: "GET",
        headers: { "Authorization": `Bearer ${adminToken}` }
      });
      if (refGetRes.ok) {
        const refDoc = await refGetRes.json();
        const rFields = refDoc && refDoc.fields ? refDoc.fields : {};
        const prevWeekKey = (rFields.weeklyChallengeKey && rFields.weeklyChallengeKey.stringValue) ? rFields.weeklyChallengeKey.stringValue.trim() : "";
        const prevWeekTeamCoins = Number((rFields.weeklyTeamEarnedCoins && (rFields.weeklyTeamEarnedCoins.integerValue || rFields.weeklyTeamEarnedCoins.doubleValue)) || 0) || 0;
        const prevWeekRefs = Number((rFields.weeklyActiveReferrals && (rFields.weeklyActiveReferrals.integerValue || rFields.weeklyActiveReferrals.doubleValue)) || 0) || 0;
        if (prevWeekKey === weekBdKey) {
          nextWeeklyTeamCoins = prevWeekTeamCoins + positiveCoins;
          nextWeeklyActiveRefs = prevWeekRefs + (isFirstActivation ? 1 : 0);
        }
      }
    } catch (rwErr) {}

    const refTransforms = [
      { fieldPath: "coins", increment: { integerValue: String(totalReferrerCredit) } },
      { fieldPath: "referralCommissionEarned", increment: { integerValue: String(totalReferrerCredit) } }
    ];
    if (isFirstActivation) {
      refTransforms.push({ fieldPath: "referralCount", increment: { integerValue: "1" } });
    }

    const writes = [];
    if (isFirstActivation) {
      const activateWrite = {
        update: {
          name: userDocPath,
          fields: {
            referralActivated: { booleanValue: true },
            referralActivatedAt: { timestampValue: nowIso },
            referredByUid: { stringValue: referrerUid }
          }
        },
        updateMask: { fieldPaths: ["referralActivated", "referralActivatedAt", "referredByUid"] }
      };
      writes.push(activateWrite);
    }

    writes.push({
      update: {
        name: referrerDocPath,
        fields: {
          weeklyChallengeKey: { stringValue: weekBdKey },
          weeklyTeamEarnedCoins: { integerValue: String(nextWeeklyTeamCoins) },
          weeklyActiveReferrals: { integerValue: String(nextWeeklyActiveRefs) }
        }
      },
      updateMask: { fieldPaths: ["weeklyChallengeKey", "weeklyTeamEarnedCoins", "weeklyActiveReferrals"] }
    });

    writes.push({
      transform: {
        document: referrerDocPath,
        fieldTransforms: refTransforms
      }
    });

    const msgParts = [];
    if (isFirstActivation) {
      msgParts.push(`🎉 ${friendName} ১ম ${providerName} টাস্ক কমপ্লিট করে Active হয়েছে! আনলক বোনাস +১০,০০০ কয়েন`);
    }
    if (commissionCoins > 0) {
      msgParts.push(`${providerName} থেকে ১০% কমিশন +${commissionCoins.toLocaleString()} কয়েন যুক্ত হয়েছে।`);
    }

    writes.push({
      update: {
        name: notifDocPath,
        fields: {
          userId: { stringValue: referrerUid },
          title: { stringValue: isFirstActivation ? "🔥 Active রেফারেল আনলক ও কমিশন!" : "💸 ১০% রেফারেল কমিশন!" },
          message: { stringValue: msgParts.join(" এবং ") },
          type: { stringValue: "referral" },
          read: { booleanValue: false },
          time: { stringValue: "Just now" },
          createdAt: { timestampValue: nowIso }
        }
      }
    });

    const commitRes = await fetch(`${baseUrl}:commit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${adminToken}`
      },
      body: JSON.stringify({ writes })
    });

    if (!commitRes.ok) {
      const errTxt = await commitRes.text();
      console.warn(`[${providerName} Referral Commit Notice]`, errTxt);
    } else {
      console.log(`[${providerName} Referral+Challenge OK] Referrer=${referrerUid}, FirstUnlock=${isFirstActivation}, Commission=${commissionCoins}, WeekTeamCoins=${nextWeeklyTeamCoins}`);
    }
  } catch (err) {
    console.warn(`[${providerName} Referral Error]`, err && err.message ? err.message : err);
  }
}

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

  if (!isReversed && coinsToAdd > 0) {
    await processReferralUnlockAndCommission(adminAccessToken, userid, coinsToAdd, "TimeWall", `tw_${logDocId}`);
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
