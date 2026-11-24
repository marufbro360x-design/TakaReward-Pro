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

  if (userExists && !isReversed && coinsDelta > 0) {
    await processReferralUnlockAndCommission(adminToken, userId, coinsDelta, "PubScale", docId);
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
