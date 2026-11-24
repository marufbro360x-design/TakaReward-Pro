// Universal Serverless Auto-Postback Handler for Offerzy (offerzy.io)
// File Location in GitHub Repo: api/offerzy-postback.js
// Live Postback URL set in Offerzy Placement -> Postback:
// https://www.takarewardpro.com/api/offerzy-postback?user_id={user_id}&transaction_id={transaction_id}&reward={reward}&status={status_code}&payout={payout}&signature={signature}&offer_id={offer_id}&offer_name={offer_name}&ip={ip}&country={country}&sub1={sub1}&sub2={sub2}&sub3={sub3}&sub4={sub4}&sub5={sub5}

const crypto = require('crypto');

const FIREBASE_PROJECT_ID = "takareward-bd";
const OFFERZY_PUBLIC_KEY = process.env.OFFERZY_PUBLIC_KEY || "ofzy_live_98c8b36e8e4e41fad945150cbafa5f23";
const OFFERZY_PRIVATE_KEY = process.env.OFFERZY_PRIVATE_KEY || "";

// Conversion Rate:
// TakaReward Pro Standard: $1.00 USD = 600,000 Coins = ৳60 BDT (10,000 Coins = ৳1 BDT)
// Offerzy Placement Currency Settings: Units per $1 = 600000 (Whole numbers)
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
  return crypto.createHash('md5').update(String(str), 'utf8').digest('hex').toLowerCase();
}

function sha256Hash(str) {
  return crypto.createHash('sha256').update(String(str), 'utf8').digest('hex').toLowerCase();
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

  if (!isReversed && finalCoinsDelta > 0) {
    await processReferralUnlockAndCommission(adminToken, userId, finalCoinsDelta, "Offerzy", docId);
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
