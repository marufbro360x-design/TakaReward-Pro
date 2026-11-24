// Universal Serverless Auto-Postback Handler for Cointo Media (cointomedia.com)
// File Location in GitHub Repo: api/cointo-postback.js
// Live Postback URL to set in Cointo Dashboard: https://www.takarewardpro.com/api/cointo-postback
const crypto = require('crypto');

const FIREBASE_PROJECT_ID = "takareward-bd";
const COINTO_PUBLIC_KEY = "Dv0Ou9";
const COINTO_SECRET_KEY = process.env.COINTO_SECRET_KEY || "";

// Conversion Rate: $1.00 USD = 600,000 Coins = ৳60 BDT (10,000 Coins = ৳1 BDT)
const COINS_PER_USD = 600000;

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
  return crypto.createHash('md5').update(String(str)).digest('hex');
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

  // 1. Mandatory MD5 Signature Verification: md5(subId + transId + reward + SECRET_KEY)
  if (!COINTO_SECRET_KEY) {
    console.error("[Cointo Postback] COINTO_SECRET_KEY environment variable is not configured");
    return { status: 500, text: "Server configuration error" };
  }
  if (!providedSig || providedSig.startsWith("{") || providedSig.startsWith("[")) {
    console.warn(`[Cointo Postback] Missing signature for subId=${subId}, transId=${rawTransId}`);
    return { status: 403, text: "Missing signature" };
  }
  const expectedSig1 = md5Hash(`${subId}${rawTransId}${rewardRaw}${COINTO_SECRET_KEY}`).toLowerCase();
  const expectedSig2 = md5Hash(`${subId}${rawTransId}${payoutRaw}${COINTO_SECRET_KEY}`).toLowerCase();
  if (providedSig !== expectedSig1 && providedSig !== expectedSig2) {
    console.warn(`[Cointo Postback] Signature mismatch for subId=${subId}, transId=${rawTransId}. Provided=${providedSig}, Expected=${expectedSig1}`);
    return { status: 403, text: "Invalid signature" };
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

  if (!isChargeback && finalCoinsDelta > 0) {
    await processReferralUnlockAndCommission(adminToken, subId, finalCoinsDelta, "Cointo Media", docId);
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
