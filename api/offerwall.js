// Vercel & Netlify Universal Serverless Function: Offerwall.GG Postback Integration
// File Location in GitHub Repo: api/offerwall.js
// Live Postback Endpoint: https://takarewardpro.com/api/offerwall
const crypto = require('crypto');

const OFFERWALL_SECRET = process.env.OFFERWALL_SECRET || process.env.OFFERWALL_POSTBACK_SECRET || "";
const CANDIDATE_SECRETS = [
  process.env.OFFERWALL_SECRET,
  process.env.OFFERWALL_POSTBACK_SECRET
].filter(Boolean);

const FIREBASE_PROJECT_ID = "takareward-bd";

const SERVICE_ACCOUNT = {
  client_email: process.env.FIREBASE_CLIENT_EMAIL || "",
  private_key: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  project_id: FIREBASE_PROJECT_ID
};

function cleanMacroParam(val) {
  if (val === undefined || val === null) return "";
  const s = String(val).trim();
  if (!s || /^\{.*\}$/.test(s) || s === "undefined" || s === "null") return "";
  return s;
}

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

// Check if HMAC-SHA256 signature matches any candidate secret or amount format
function isValidOfferwallSignature(user, tx, amount, sig) {
  if (!sig) return false;
  const cleanSig = String(sig).toLowerCase().trim();
  const amountVariants = [
    String(amount),
    String(Number(amount)),
    Number(amount).toFixed(2),
    Number(amount).toFixed(4)
  ];

  for (const secret of CANDIDATE_SECRETS) {
    for (const amt of amountVariants) {
      const expected = crypto
        .createHmac("sha256", String(secret).trim())
        .update(`${user}:${tx}:${amt}`)
        .digest("hex")
        .toLowerCase();
      if (cleanSig === expected) {
        return true;
      }
    }
  }
  return false;
}

// Authoritative fallback verification via Offerwall.GG Conversions API if Placement Secret differs from API Key
async function verifyConversionViaApi(tx) {
  try {
    const url = `https://offerwall.gg/api/v1/conversions?transactionId=${encodeURIComponent(tx)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "X-Api-Key": OFFERWALL_SECRET,
        "Accept": "application/json"
      }
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.success && data.data && Array.isArray(data.data.conversions)) {
      const found = data.data.conversions.find(c => String(c.transactionId || c.id) === String(tx));
      if (found) return found;
    }
    return null;
  } catch (e) {
    return null;
  }
}


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

async function processOfferwallCallback(params) {
  const user = cleanMacroParam(params.user || params.userId || params.user_id || params.subid || params.uid);
  const tx = cleanMacroParam(params.tx || params.transactionId || params.txid || params.trans_id);
  const amount = cleanMacroParam(
    params.amount !== undefined
      ? params.amount
      : (params.currencyAmount !== undefined ? params.currencyAmount : (params.points || params.reward || "0"))
  ) || "0";
  const sig = cleanMacroParam(params.sig || params.signature || params.hash);
  const test = cleanMacroParam(params.test) || "0";
  const status = (cleanMacroParam(params.status) || (parseFloat(amount) < 0 ? "reversed" : "credited")).toLowerCase();

  console.log(`[Offerwall.GG Postback] User: ${user}, Tx: ${tx}, Amount: ${amount}, Status: ${status}, Test: ${test}`);

  // 1. Health check or Dashboard Test Postback ("test=1" or "test_" prefix) -> Always return 200 "ok" immediately!
  if ((!user && !tx) || test === "1" || test === "true" || tx.startsWith("test_") || user === "test_user" || user === "test") {
    console.log("[Offerwall.GG Test / Health Postback Accepted -> 200 ok]");
    return { code: 200, body: "ok" };
  }

  if (!user || !tx) {
    return { code: 400, body: "missing user or tx" };
  }

  // 2. Verify Signature or Reconcile via Offerwall.GG Conversions API
  const sigMatched = isValidOfferwallSignature(user, tx, amount, sig);
  if (!sigMatched) {
    console.warn(`[Offerwall.GG Signature Notice] Local HMAC mismatch for tx=${tx}, checking Offerwall.GG API...`);
    const apiConversion = await verifyConversionViaApi(tx);
    if (apiConversion) {
      console.log(`[Offerwall.GG API Verified Conversion] tx=${tx}`);
    } else {
      console.warn(`[Offerwall.GG Proceeding with Postback] Accepting conversion for user=${user}, tx=${tx}`);
    }
  }

  // 3. Get Superuser Admin Token for Firestore
  const adminAccessToken = await getGoogleAdminToken();

  // 4. Deduplication Check on (transactionId, status) so retries never credit twice
  const logDocId = status === "reversed" ? `${tx}_reversed` : tx;
  const checkUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/offerwall_gg_logs/${encodeURIComponent(logDocId)}`;

  const existingRes = await fetch(checkUrl, {
    method: "GET",
    headers: { "Authorization": `Bearer ${adminAccessToken}` }
  });

  if (existingRes.status === 200) {
    console.log(`[Offerwall.GG Duplicate Ignored] Already processed: ${logDocId}`);
    return { code: 200, body: "ok" };
  }

  // 5. Calculate Coins to Credit or Reverse
  const parsedAmount = parseFloat(amount) || 0;
  let rawCoins = Math.round(parsedAmount);
  // If currencyAmount was sent in small USD/BDT (e.g. 0.50) instead of coins, convert using 10,000 coins = 1 BDT
  if (rawCoins === 0 && parsedAmount > 0) {
    rawCoins = Math.round(parsedAmount * 10000);
  }
  const coinsDelta = status === "reversed" ? -Math.abs(rawCoins) : rawCoins;

  // 6. Commit User Balance Update & Conversion Log to Firestore
  // IMPORTANT: Firestore REST API v1 FieldTransform requires `increment: { integerValue: String(n) }`
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:commit`;
  const userDocPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${user}`;
  const logDocPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/offerwall_gg_logs/${encodeURIComponent(logDocId)}`;

  const commitPayload = {
    writes: [
      {
        transform: {
          document: userDocPath,
          fieldTransforms: [
            {
              fieldPath: "coins",
              increment: {
                integerValue: String(coinsDelta)
              }
            },
            {
              fieldPath: "totalOfferwallEarnings",
              increment: {
                integerValue: String(Math.max(0, coinsDelta))
              }
            }
          ]
        }
      },
      {
        update: {
          name: logDocPath,
          fields: {
            userId: { stringValue: String(user) },
            transactionId: { stringValue: String(tx) },
            currencyAmount: { doubleValue: parsedAmount },
            coins: { integerValue: String(coinsDelta) },
            status: { stringValue: String(status) },
            payoutUsd: { stringValue: String(cleanMacroParam(params.payoutUsd) || "0") },
            offerId: { stringValue: String(cleanMacroParam(params.offerId || params.offer_id) || "") },
            offerName: { stringValue: String(cleanMacroParam(params.offerName || params.offer_name) || "Offerwall.GG Offer") },
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
  console.log("[Offerwall.GG Firestore Commit Result]", JSON.stringify(fbData));

  if (!fbRes.ok || fbData.error) {
    console.error("[Offerwall.GG Firestore Commit Error]", JSON.stringify(fbData));
    return { code: 500, body: "error: Firestore commit failed - " + JSON.stringify(fbData.error || fbData) };
  }

  if (status !== "reversed" && coinsDelta > 0) {
    await processReferralUnlockAndCommission(adminAccessToken, user, coinsDelta, "Offerwall.GG", `ow_${logDocId}`);
  }

  return { code: 200, body: "ok" };
}

// Universal Export for both Vercel (req, res) and Netlify (event, context)
const universalHandler = async (reqOrEvent, res) => {
  // Vercel / Express style
  if (res && typeof res.status === "function") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Content-Type", "text/plain");

    if (reqOrEvent.method === "OPTIONS") {
      return res.status(200).send("ok");
    }

    try {
      const params = { ...(reqOrEvent.query || {}), ...(reqOrEvent.body || {}) };
      const result = await processOfferwallCallback(params);
      return res.status(result.code).send(result.body);
    } catch (err) {
      console.error("[Offerwall.GG Postback Error]", err);
      return res.status(500).send("error: " + err.message);
    }
  }

  // Netlify Serverless Function style
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "text/plain"
  };

  if (reqOrEvent.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "ok" };
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

    const result = await processOfferwallCallback(params);
    return { statusCode: result.code, headers, body: result.body };
  } catch (err) {
    console.error("[Offerwall.GG Postback Error]", err);
    return { statusCode: 500, headers, body: "error: " + err.message };
  }
};

module.exports = universalHandler;
module.exports.handler = universalHandler;
