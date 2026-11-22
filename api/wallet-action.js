// Universal Serverless Secure Wallet Action Handler for TakaReward Pro
// File Location in GitHub Repo: api/wallet-action.js
// Live Endpoint: https://www.takarewardpro.com/api/wallet-action
// Handles: daily_claim, browsing_claim, apply_referral, request_withdraw
// Security: Verifies Firebase Auth ID Token (RS256 against Google official X509 certs)
// Zero hardcoded secrets — uses Vercel Environment Variables (FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY)

const crypto = require('crypto');

const FIREBASE_PROJECT_ID = "takareward-bd";
const GOOGLE_CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

const SERVICE_ACCOUNT = {
  client_email: process.env.FIREBASE_CLIENT_EMAIL || "",
  private_key: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  project_id: FIREBASE_PROJECT_ID
};

// Built-in default browsing tasks reward cap (prevents fake high coin claims)
const DEFAULT_BROWSING_REWARDS = {
  ow_br_1: 500,
  ow_br_2: 500,
  mt_br_1: 500,
  mt_br_2: 500,
  mt_br_3: 500
};

let cachedCerts = null;
let cachedCertsExpiry = 0;

async function getGooglePublicCerts() {
  const now = Date.now();
  if (cachedCerts && now < cachedCertsExpiry) {
    return cachedCerts;
  }
  const res = await fetch(GOOGLE_CERTS_URL);
  if (!res.ok) {
    throw new Error("Failed to fetch Google Firebase public certificates");
  }
  const cacheControl = res.headers.get("cache-control") || "";
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSec = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 3600;
  cachedCerts = await res.json();
  cachedCertsExpiry = now + Math.max(300, maxAgeSec - 60) * 1000;
  return cachedCerts;
}

// Cryptographically verify Firebase Auth ID Token (RS256)
async function verifyFirebaseIdToken(idToken) {
  if (!idToken || typeof idToken !== "string") {
    throw new Error("Missing authentication token");
  }
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid token format");
  }
  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
  const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));

  if (header.alg !== "RS256" || !header.kid) {
    throw new Error("Unsupported token algorithm");
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.aud !== FIREBASE_PROJECT_ID) {
    throw new Error("Invalid token audience");
  }
  if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) {
    throw new Error("Invalid token issuer");
  }
  if (!payload.sub || typeof payload.sub !== "string") {
    throw new Error("Missing token subject");
  }
  if (!payload.exp || payload.exp <= nowSec) {
    throw new Error("Session token expired — please reload and try again");
  }
  if (payload.iat && payload.iat > nowSec + 300) {
    throw new Error("Invalid token issue time");
  }

  const certs = await getGooglePublicCerts();
  const cert = certs[header.kid];
  if (!cert) {
    throw new Error("Unknown signing key — please reload and try again");
  }

  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(`${headerB64}.${payloadB64}`);
  const sigBuf = Buffer.from(sigB64, "base64url");
  const isValid = verifier.verify(cert, sigBuf);
  if (!isValid) {
    throw new Error("Invalid token signature");
  }

  return {
    uid: payload.sub,
    email: payload.email || ""
  };
}

// Generate Google Admin OAuth2 Access Token for Firestore REST API
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
    throw new Error("Failed to get Google Admin Token");
  }
  return tokenData.access_token;
}

function fsBase() {
  return `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
}

function docPath(relPath) {
  return `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${relPath}`;
}

function getFieldNumber(fields, key, fallback = 0) {
  const f = fields && fields[key];
  if (!f) return fallback;
  if (f.integerValue !== undefined) return Number(f.integerValue) || fallback;
  if (f.doubleValue !== undefined) return Number(f.doubleValue) || fallback;
  return fallback;
}

function getFieldString(fields, key, fallback = "") {
  const f = fields && fields[key];
  if (!f) return fallback;
  if (f.stringValue !== undefined) return String(f.stringValue);
  return fallback;
}

function getFieldBool(fields, key, fallback = false) {
  const f = fields && fields[key];
  if (!f) return fallback;
  if (f.booleanValue !== undefined) return Boolean(f.booleanValue);
  return fallback;
}

async function getFirestoreDoc(token, relPath) {
  const res = await fetch(`${fsBase()}/${relPath}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` }
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Firestore GET ${relPath} failed (${res.status})`);
  }
  return await res.json();
}

async function queryFirestoreEq(token, collectionId, fieldPath, stringVal, limitCount = 5) {
  const res = await fetch(`${fsBase()}:runQuery`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where: {
          fieldFilter: {
            field: { fieldPath },
            op: "EQUAL",
            value: { stringValue: String(stringVal) }
          }
        },
        limit: limitCount
      }
    })
  });
  if (!res.ok) {
    throw new Error(`Firestore query failed (${res.status})`);
  }
  const rows = await res.json();
  return rows.filter(r => r && r.document).map(r => {
    const fullName = r.document.name || "";
    const id = fullName.split("/").pop();
    return { id, fields: r.document.fields || {} };
  });
}

async function commitWrites(token, writes) {
  const res = await fetch(`${fsBase()}:commit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ writes })
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Firestore commit failed (${res.status}): ${errText}`);
  }
  return await res.json();
}

function getClientIp(req) {
  const fwd = req.headers && (req.headers["x-forwarded-for"] || req.headers["x-real-ip"]);
  if (fwd) return String(fwd).split(",")[0].trim();
  return "Unknown";
}

// =========================================================================
// ACTION 1: DAILY SIGN-IN BONUS (+10,000 Coins, strict server 24h cooldown)
// =========================================================================
async function handleDailyClaim(uid, adminToken) {
  const userDoc = await getFirestoreDoc(adminToken, `users/${uid}`);
  if (!userDoc || !userDoc.fields) {
    return { status: 404, body: { success: false, error: "User profile not found" } };
  }
  const fields = userDoc.fields;
  if (getFieldBool(fields, "isBlocked") || getFieldBool(fields, "isSuspended")) {
    return { status: 403, body: { success: false, error: "Account is suspended" } };
  }

  const now = Date.now();
  const lastClaim = getFieldNumber(fields, "lastDailyClaimTime", 0);
  const cooldownMs = 24 * 60 * 60 * 1000;

  if (now - lastClaim < cooldownMs) {
    const remHours = Math.ceil((cooldownMs - (now - lastClaim)) / (60 * 60 * 1000));
    return {
      status: 429,
      body: {
        success: false,
        error: `আপনি ইতিমধ্যে আজকের বোনাস নিয়েছেন! ${remHours} ঘণ্টা পর আবার ক্লেইম করতে পারবেন।`,
        remainingHours: remHours
      }
    };
  }

  const DAILY_COINS = 10000;
  await commitWrites(adminToken, [
    {
      update: {
        name: docPath(`users/${uid}`),
        fields: {
          lastDailyClaimTime: { integerValue: String(now) }
        }
      },
      updateMask: { fieldPaths: ["lastDailyClaimTime"] }
    },
    {
      transform: {
        document: docPath(`users/${uid}`),
        fieldTransforms: [
          { fieldPath: "coins", increment: { integerValue: String(DAILY_COINS) } }
        ]
      }
    }
  ]);

  return {
    status: 200,
    body: {
      success: true,
      coinsAdded: DAILY_COINS,
      lastDailyClaimTime: now,
      message: "🎉 অভিনন্দন! ১.০০ টাকা (১০,০০০ কয়েন) ডেইলি বোনাস আপনার একাউন্টে যোগ হয়েছে!"
    }
  };
}

// =========================================================================
// ACTION 2: BROWSING / SURF AD CLAIM (server-verified reward + 24h per-task cooldown)
// =========================================================================
async function handleBrowsingClaim(uid, body, adminToken, clientIp) {
  const rawTaskId = String(body.taskId || "").trim();
  if (!rawTaskId || rawTaskId.length > 80) {
    return { status: 400, body: { success: false, error: "Invalid browsing task ID" } };
  }
  const safeTaskId = rawTaskId.replace(/[^a-zA-Z0-9_-]/g, "_");

  const userDoc = await getFirestoreDoc(adminToken, `users/${uid}`);
  if (!userDoc || !userDoc.fields) {
    return { status: 404, body: { success: false, error: "User profile not found" } };
  }
  const uFields = userDoc.fields;
  if (getFieldBool(uFields, "isBlocked") || getFieldBool(uFields, "isSuspended")) {
    return { status: 403, body: { success: false, error: "Account is suspended" } };
  }

  // 1. Global 12-second anti-spam cooldown between browsing claims
  const now = Date.now();
  const lastSurf = getFieldNumber(uFields, "lastSurfClaimTime", 0);
  if (now - lastSurf < 12000) {
    return { status: 429, body: { success: false, error: "অনুগ্রহ করে কয়েক সেকেন্ড অপেক্ষা করে আবার চেষ্টা করুন।" } };
  }

  // 2. Per-task 24-hour server cooldown check
  const claimDocId = `br_${uid}_${safeTaskId}`;
  const prevClaim = await getFirestoreDoc(adminToken, `browsing_claims/${claimDocId}`);
  const dayMs = 24 * 60 * 60 * 1000;
  if (prevClaim && prevClaim.fields) {
    const prevTs = getFieldNumber(prevClaim.fields, "lastClaimedAt", 0);
    if (now - prevTs < dayMs) {
      return {
        status: 429,
        body: { success: false, error: "আপনি আজ ইতিমধ্যে এই ব্রাউজিং টাস্কটি সম্পন্ন করেছেন! ২৪ ঘণ্টা পর আবার চেষ্টা করুন।" }
      };
    }
  }

  // 3. Determine authoritative rewardCoins from server (never trust client reward amount!)
  let rewardCoins = DEFAULT_BROWSING_REWARDS[rawTaskId] || 0;
  let taskTitle = String(body.taskTitle || "Browsing Task").slice(0, 120);

  if (!rewardCoins) {
    const taskDoc = await getFirestoreDoc(adminToken, `tasks/${rawTaskId}`);
    if (taskDoc && taskDoc.fields && getFieldString(taskDoc.fields, "taskType") === "browsing") {
      if (taskDoc.fields.isActive && taskDoc.fields.isActive.booleanValue === false) {
        return { status: 400, body: { success: false, error: "এই ব্রাউজিং টাস্কটি বর্তমানে বন্ধ আছে।" } };
      }
      rewardCoins = Math.min(5000, Math.max(100, getFieldNumber(taskDoc.fields, "rewardCoins", 500)));
      taskTitle = getFieldString(taskDoc.fields, "title", taskTitle);
    } else {
      // Allow live Offerwall.GG traffic IDs with strict 500 coin cap
      rewardCoins = 500;
    }
  }

  const rewardTaka = Number((rewardCoins / 10000).toFixed(4));
  const nowIso = new Date(now).toISOString();
  const subDocId = `br_${uid}_${safeTaskId}_${now}`;
  const userName = getFieldString(uFields, "name", "User");
  const userEmail = getFieldString(uFields, "email", "");

  await commitWrites(adminToken, [
    {
      update: {
        name: docPath(`users/${uid}`),
        fields: {
          lastSurfClaimTime: { integerValue: String(now) }
        }
      },
      updateMask: { fieldPaths: ["lastSurfClaimTime"] }
    },
    {
      transform: {
        document: docPath(`users/${uid}`),
        fieldTransforms: [
          { fieldPath: "coins", increment: { integerValue: String(rewardCoins) } },
          { fieldPath: "totalSurfEarnings", increment: { integerValue: String(rewardCoins) } }
        ]
      }
    },
    {
      update: {
        name: docPath(`browsing_claims/${claimDocId}`),
        fields: {
          userId: { stringValue: uid },
          taskId: { stringValue: rawTaskId },
          lastClaimedAt: { integerValue: String(now) },
          updatedAt: { timestampValue: nowIso }
        }
      }
    },
    {
      update: {
        name: docPath(`submissions/${subDocId}`),
        fields: {
          taskId: { stringValue: rawTaskId },
          taskTitle: { stringValue: taskTitle },
          userId: { stringValue: uid },
          userName: { stringValue: userName },
          userEmail: { stringValue: userEmail },
          rewardCoins: { integerValue: String(rewardCoins) },
          rewardTaka: { doubleValue: rewardTaka },
          status: { stringValue: "Approved" },
          submissionType: { stringValue: "browsing" },
          userIP: { stringValue: clientIp },
          submittedTime: { stringValue: new Date(now).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) },
          createdAt: { timestampValue: nowIso }
        }
      }
    }
  ]);

  return {
    status: 200,
    body: {
      success: true,
      coinsAdded: rewardCoins,
      lastSurfClaimTime: now
    }
  };
}

// =========================================================================
// ACTION 3: APPLY REFERRAL CODE (+30,000 to user, +10,000 to referrer, once ever)
// =========================================================================
async function handleApplyReferral(uid, body, adminToken) {
  let code = String(body.inviteCode || "").trim().replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (/^\d{5}$/.test(code)) code = "TR" + code;
  if (!code || code.length < 4 || code.length > 20) {
    return { status: 400, body: { success: false, error: "অনুগ্রহ করে একটি সঠিক রেফারেল কোড দিন!" } };
  }

  const userDoc = await getFirestoreDoc(adminToken, `users/${uid}`);
  if (!userDoc || !userDoc.fields) {
    return { status: 404, body: { success: false, error: "User profile not found" } };
  }
  const uFields = userDoc.fields;
  if (getFieldString(uFields, "referredBy", "")) {
    return { status: 400, body: { success: false, error: "আপনি ইতিমধ্যে একটি রেফারেল কোড ব্যবহার করেছেন!" } };
  }
  if (getFieldString(uFields, "myInviteCode", "").toUpperCase() === code) {
    return { status: 400, body: { success: false, error: "আপনি নিজের রেফারেল কোড নিজে ব্যবহার করতে পারবেন না!" } };
  }

  const matches = await queryFirestoreEq(adminToken, "users", "myInviteCode", code, 1);
  if (!matches.length) {
    return { status: 404, body: { success: false, error: "এই রেফারেল কোডটি পাওয়া যায়নি! সঠিক কোড দিন।" } };
  }
  const referrer = matches[0];
  if (referrer.id === uid) {
    return { status: 400, body: { success: false, error: "আপনি নিজের রেফারেল কোড নিজে ব্যবহার করতে পারবেন না!" } };
  }

  // Anti-self-referral device check: block if same deviceId already claimed a referral bonus
  const userDeviceId = getFieldString(uFields, "deviceId", "") || String(body.deviceId || "").trim();
  const refDeviceId = getFieldString(referrer.fields, "deviceId", "");
  if (userDeviceId && refDeviceId && userDeviceId === refDeviceId) {
    return { status: 403, body: { success: false, error: "একই ডিভাইস থেকে নিজের রেফারেল কোড ব্যবহার করা যাবে না!" } };
  }

  await commitWrites(adminToken, [
    {
      update: {
        name: docPath(`users/${uid}`),
        fields: {
          referredBy: { stringValue: code },
          referredByUid: { stringValue: referrer.id }
        }
      },
      updateMask: { fieldPaths: ["referredBy", "referredByUid"] }
    },
    {
      transform: {
        document: docPath(`users/${uid}`),
        fieldTransforms: [
          { fieldPath: "coins", increment: { integerValue: "30000" } }
        ]
      }
    },
    {
      transform: {
        document: docPath(`users/${referrer.id}`),
        fieldTransforms: [
          { fieldPath: "coins", increment: { integerValue: "10000" } },
          { fieldPath: "referralCount", increment: { integerValue: "1" } }
        ]
      }
    }
  ]);

  return {
    status: 200,
    body: {
      success: true,
      coinsAdded: 30000,
      referredBy: code,
      message: "🎉 অভিনন্দন! আপনার একাউন্টে ৩০,০০০ কয়েন যুক্ত হয়েছে এবং আপনার রেফারার ১০,০০০ কয়েন পেয়েছেন!"
    }
  };
}

// =========================================================================
// ACTION 4: SECURE WITHDRAWAL REQUEST (atomic server coin deduction + withdrawal record)
// =========================================================================
async function handleRequestWithdraw(uid, body, adminToken, clientIp) {
  const method = String(body.method || "bKash").trim();
  const phone = String(body.phone || "").trim();
  const contactPhone = String(body.contactPhone || phone).trim();
  const coinsToWithdraw = parseInt(body.coins, 10) || 0;
  const source = String(body.source || "web").trim();

  if (!["bKash", "Nagad"].includes(method)) {
    return { status: 400, body: { success: false, error: "এটি এখন বন্ধ আছে, অনুগ্রহ করে বিকাশ (bKash) ব্যবহার করুন।" } };
  }
  if (!/^01[3-9]\d{8}$/.test(phone)) {
    return { status: 400, body: { success: false, error: "সঠিক ১১ ডিজিটের পার্সোনাল মোবাইল নম্বর দিন (013-019 দিয়ে শুরু)।" } };
  }

  const minCoins = source === "mobile" ? 1050000 : 2000000;
  const minTaka = source === "mobile" ? 105 : 200;
  if (coinsToWithdraw < minCoins || coinsToWithdraw > 500000000) {
    return { status: 400, body: { success: false, error: `সর্বনিম্ন উইথড্র ${minTaka} টাকা (${minCoins.toLocaleString()} coins)!` } };
  }

  const userDoc = await getFirestoreDoc(adminToken, `users/${uid}`);
  if (!userDoc || !userDoc.fields) {
    return { status: 404, body: { success: false, error: "User profile not found" } };
  }
  const uFields = userDoc.fields;
  if (getFieldBool(uFields, "isBlocked") || getFieldBool(uFields, "isSuspended")) {
    return { status: 403, body: { success: false, error: "আপনার অ্যাকাউন্টটি সাময়িকভাবে স্থগিত রয়েছে। সাপোর্টে যোগাযোগ করুন।" } };
  }

  const currentCoins = getFieldNumber(uFields, "coins", 0);
  if (currentCoins < coinsToWithdraw) {
    return {
      status: 400,
      body: {
        success: false,
        error: `পর্যাপ্ত কয়েন নেই! আপনার কাছে ${currentCoins.toLocaleString()} কয়েন আছে।`
      }
    };
  }

  const takaAmount = Number((coinsToWithdraw / 10000).toFixed(2));
  const holderName = String(body.holderName || getFieldString(uFields, "walletHolderName", "") || getFieldString(uFields, "name", "User")).trim();
  const userEmail = getFieldString(uFields, "email", "");
  const deviceId = getFieldString(uFields, "deviceId", "") || String(body.deviceId || "").trim();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const wDocId = `wd_${uid.slice(0, 8)}_${now}_${Math.floor(100 + Math.random() * 900)}`;

  // Atomic commit: deduct coins + create Pending withdrawal in a single transaction
  await commitWrites(adminToken, [
    {
      transform: {
        document: docPath(`users/${uid}`),
        fieldTransforms: [
          { fieldPath: "coins", increment: { integerValue: String(-coinsToWithdraw) } }
        ]
      }
    },
    {
      update: {
        name: docPath(`withdrawals/${wDocId}`),
        fields: {
          userId: { stringValue: uid },
          userName: { stringValue: holderName },
          email: { stringValue: userEmail },
          method: { stringValue: method },
          taka: { doubleValue: takaAmount },
          coins: { integerValue: String(coinsToWithdraw) },
          phone: { stringValue: phone },
          contactPhone: { stringValue: contactPhone },
          userIP: { stringValue: clientIp },
          deviceId: { stringValue: deviceId },
          verifiedByServer: { booleanValue: true },
          status: { stringValue: "Pending" },
          createdAt: { timestampValue: nowIso }
        }
      }
    }
  ]);

  return {
    status: 200,
    body: {
      success: true,
      withdrawalId: wDocId,
      taka: takaAmount,
      coinsDeducted: coinsToWithdraw,
      message: `✅ উইথড্রল রিকোয়েস্ট সফল হয়েছে! সর্বোচ্চ ২৪ ঘণ্টার মধ্যে ৳${takaAmount} আপনার ${method} একাউন্টে (${phone}) পাঠানো হবে।`
    }
  };
}

// =========================================================================
// MAIN SERVERLESS HANDLER (Vercel & Netlify Compatible)
// =========================================================================
const universalHandler = async (req, res) => {
  if (res && typeof res.setHeader === "function") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }

  if (req.method === "OPTIONS") {
    return res.status(200).json({ ok: true });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const authHeader = (req.headers && (req.headers.authorization || req.headers.Authorization)) || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const decoded = await verifyFirebaseIdToken(idToken);
    const uid = decoded.uid;

    const body = (req.body && typeof req.body === "object")
      ? req.body
      : (typeof req.body === "string" && req.body ? JSON.parse(req.body) : {});

    const action = String(body.action || "").trim();
    const adminToken = await getGoogleAdminToken();
    const clientIp = getClientIp(req);

    let result;
    if (action === "daily_claim") {
      result = await handleDailyClaim(uid, adminToken);
    } else if (action === "browsing_claim") {
      result = await handleBrowsingClaim(uid, body, adminToken, clientIp);
    } else if (action === "apply_referral") {
      result = await handleApplyReferral(uid, body, adminToken);
    } else if (action === "request_withdraw") {
      result = await handleRequestWithdraw(uid, body, adminToken, clientIp);
    } else {
      return res.status(400).json({ success: false, error: "Unknown wallet action" });
    }

    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("[Wallet Action Error]", err);
    const msg = err && err.message ? err.message : "Internal server error";
    const status = /token|auth|expired|signature|audience|issuer/i.test(msg) ? 401 : 500;
    return res.status(status).json({ success: false, error: msg });
  }
};

module.exports = universalHandler;
module.exports.handler = universalHandler;
