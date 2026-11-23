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
const MAX_DAILY_BROWSING_CLAIMS = 20;

function getBdDateKey(tsMs) {
  // Bangladesh Standard Time (UTC+6)
  const bd = new Date(tsMs + 6 * 60 * 60 * 1000);
  return bd.toISOString().slice(0, 10);
}

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
    if (res.status === 409 || /FAILED_PRECONDITION|ABORTED/i.test(errText)) {
      const conflictErr = new Error("আরেকটি রিকোয়েস্ট প্রসেস হচ্ছে, ১ সেকেন্ড পর আবার চেষ্টা করুন।");
      conflictErr.statusCode = 409;
      throw conflictErr;
    }
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

// =========================================================================
// STEP 2 ANTI-FRAUD: IP REPUTATION (VPN / PROXY / DATACENTER CHECK)
// =========================================================================
const ipReputationCache = new Map();
const IP_CACHE_TTL_MS = 10 * 60 * 1000;

function isPrivateOrLocalIp(ip) {
  if (!ip || ip === "Unknown" || ip === "::1" || ip === "127.0.0.1") return true;
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) return true;
  return false;
}

async function checkIpReputation(ip) {
  const cleanIp = String(ip || "").trim();
  if (isPrivateOrLocalIp(cleanIp)) {
    return { isVpn: false, country: "BD", isp: "", checked: false };
  }
  const cached = ipReputationCache.get(cleanIp);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(cleanIp)}?fields=status,countryCode,proxy,hosting,isp`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (!res.ok) return { isVpn: false, country: "", isp: "", checked: false };
    const data = await res.json();
    if (data && data.status === "success") {
      const result = {
        isVpn: Boolean(data.proxy || data.hosting),
        country: String(data.countryCode || ""),
        isp: String(data.isp || ""),
        checked: true
      };
      ipReputationCache.set(cleanIp, { data: result, expiresAt: Date.now() + IP_CACHE_TTL_MS });
      return result;
    }
  } catch (e) {
    // Fail-open on timeout so legitimate users are never blocked by upstream hiccups
  }
  return { isVpn: false, country: "", isp: "", checked: false };
}

// =========================================================================
// ACTION 0: SECURITY CHECK (VPN / Proxy + Multi-Account Device Check)
// =========================================================================
async function handleSecurityCheck(uid, body, adminToken, clientIp) {
  const userDoc = await getFirestoreDoc(adminToken, `users/${uid}`);
  if (!userDoc || !userDoc.fields) {
    return { status: 404, body: { success: false, error: "User profile not found" } };
  }
  const uFields = userDoc.fields;
  const isBlocked = getFieldBool(uFields, "isBlocked") || getFieldBool(uFields, "isSuspended");
  const deviceId = getFieldString(uFields, "deviceId", "") || String(body.deviceId || "").trim();

  const [ipRep, sameDeviceDocs] = await Promise.all([
    checkIpReputation(clientIp),
    deviceId ? queryFirestoreEq(adminToken, "users", "deviceId", deviceId, 5).catch(() => []) : Promise.resolve([])
  ]);

  const otherDeviceAccounts = sameDeviceDocs.filter(d => d.id !== uid).length;
  const multiAccountFlag = otherDeviceAccounts > 0;
  const nowIso = new Date().toISOString();

  // Persist telemetry safely on users/{uid} (Admin OAuth — no firestore.rules change needed)
  try {
    await commitWrites(adminToken, [
      {
        update: {
          name: docPath(`users/${uid}`),
          fields: {
            lastIP: { stringValue: clientIp || "Unknown" },
            lastCountry: { stringValue: ipRep.country || "" },
            vpnDetected: { booleanValue: Boolean(ipRep.isVpn) },
            multiAccountFlag: { booleanValue: multiAccountFlag },
            lastSeenAt: { timestampValue: nowIso }
          }
        },
        updateMask: {
          fieldPaths: ["lastIP", "lastCountry", "vpnDetected", "multiAccountFlag", "lastSeenAt"]
        }
      }
    ]);
  } catch (e) {
    console.warn("[Security Check] Telemetry save notice:", e.message);
  }

  return {
    status: 200,
    body: {
      success: true,
      vpnBlocked: Boolean(ipRep.isVpn),
      isBlocked,
      multiAccountFlag,
      ip: clientIp,
      country: ipRep.country || "",
      isp: ipRep.isp || ""
    }
  };
}


// =========================================================================
// ACTION 0B: HARD 1-DEVICE 1-ACCOUNT + ANTI-VPN + CROSS-BROWSER REGISTRATION
// =========================================================================
const MASTER_ADMIN_EMAIL = "marufbro360x@gmail.com";

function getIpSubnet(ip) {
  const s = String(ip || "").trim();
  if (!s || s === "Unknown") return "unknown";
  if (s.includes(".")) {
    const parts = s.split(".");
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}`;
  }
  if (s.includes(":")) {
    return s.split(":").slice(0, 4).join(":");
  }
  return s;
}

async function handleRegisterUser(uid, decodedEmail, body, adminToken, clientIp) {
  // If user already exists, allow login immediately
  const existingDoc = await getFirestoreDoc(adminToken, `users/${uid}`);
  if (existingDoc && existingDoc.fields) {
    const isBlocked = getFieldBool(existingDoc.fields, "isBlocked") || getFieldBool(existingDoc.fields, "isSuspended");
    if (isBlocked) {
      return { status: 403, body: { success: false, blocked: true, error: "🚫 আপনার অ্যাকাউন্টটি ব্যান/স্থগিত করা হয়েছে। সাপোর্টে যোগাযোগ করুন।" } };
    }
    return { status: 200, body: { success: true, alreadyExists: true } };
  }

  const email = String(decodedEmail || body.email || "").trim().toLowerCase();
  const isMasterAdmin = email === MASTER_ADMIN_EMAIL;
  const deviceId = String(body.deviceId || "").trim().slice(0, 80);
  const hwFp = String(body.hardwareFingerprint || "").trim().slice(0, 80);
  const ipSubnet = getIpSubnet(clientIp);
  const crossBrowserKey = hwFp ? `${hwFp}_${ipSubnet}` : "";

  if (!isMasterAdmin) {
    // Layer 1: Hard Anti-VPN / Proxy / Datacenter Block on Registration
    const ipRep = await checkIpReputation(clientIp);
    if (ipRep.isVpn) {
      return {
        status: 403,
        body: {
          success: false,
          blocked: true,
          reason: "VPN_BLOCKED",
          error: "🛡️ VPN বা Proxy চালু রেখে নতুন অ্যাকাউন্ট খোলা যাবে না! অনুগ্রহ করে VPN বন্ধ করে আসল ইন্টারনেট দিয়ে চেষ্টা করুন।"
        }
      };
    }

    // Layer 2, 3 & 4: Parallel Device Lock, Cross-Browser Fingerprint+Subnet Lock, and IP Lock
    const [sameDeviceDocs, sameCrossDocs, sameIpDocs] = await Promise.all([
      deviceId ? queryFirestoreEq(adminToken, "users", "deviceId", deviceId, 3).catch(() => []) : Promise.resolve([]),
      crossBrowserKey ? queryFirestoreEq(adminToken, "users", "crossBrowserKey", crossBrowserKey, 3).catch(() => []) : Promise.resolve([]),
      (!isPrivateOrLocalIp(clientIp)) ? queryFirestoreEq(adminToken, "users", "registerIP", clientIp, 3).catch(() => []) : Promise.resolve([])
    ]);

    if (sameDeviceDocs.some(d => d.id !== uid)) {
      return {
        status: 403,
        body: {
          success: false,
          blocked: true,
          reason: "DUPLICATE_DEVICE",
          error: "🚫 এই ডিভাইসে ইতিমধ্যে একটি অ্যাকাউন্ট খোলা আছে! ১টি ফোনে ১টির বেশি অ্যাকাউন্ট খোলা নিষিদ্ধ — অনুগ্রহ করে আপনার আগের ইমেইল দিয়ে লগইন করুন।"
        }
      };
    }

    if (sameCrossDocs.some(d => d.id !== uid)) {
      return {
        status: 403,
        body: {
          success: false,
          blocked: true,
          reason: "CROSS_BROWSER_DEVICE",
          error: "🚫 অন্য ব্রাউজার বা ইনকগনিটো ব্যবহার করেও এই ডিভাইসে নতুন অ্যাকাউন্ট খোলা যাবে না! অনুগ্রহ করে আপনার আগের অ্যাকাউন্টে লগইন করুন।"
        }
      };
    }

    if (sameIpDocs.filter(d => d.id !== uid).length >= 2) {
      return {
        status: 403,
        body: {
          success: false,
          blocked: true,
          reason: "IP_LIMIT",
          error: "🚫 এই ইন্টারনেট/IP থেকে সর্বোচ্চ অ্যাকাউন্ট লিমিট পূর্ণ হয়ে গেছে! নতুন অ্যাকাউন্ট খোলা সম্ভব নয়।"
        }
      };
    }
  }

  // Create new user document safely on server (always starts with coins: 0)
  const myCode = "TR" + Math.floor(10000 + Math.random() * 90000);
  const name = String(body.name || "User").trim().slice(0, 80);
  const photoURL = String(body.photoURL || "").trim().slice(0, 500);
  const nowIso = new Date().toISOString();

  await commitWrites(adminToken, [
    {
      update: {
        name: docPath(`users/${uid}`),
        fields: {
          uid: { stringValue: uid },
          name: { stringValue: name },
          email: { stringValue: email },
          photoURL: { stringValue: photoURL },
          deviceId: { stringValue: deviceId },
          hardwareFingerprint: { stringValue: hwFp },
          crossBrowserKey: { stringValue: crossBrowserKey },
          registerIP: { stringValue: clientIp || "Unknown" },
          lastIP: { stringValue: clientIp || "Unknown" },
          coins: { integerValue: "0" },
          myInviteCode: { stringValue: myCode },
          referredBy: { nullValue: null },
          referredByUid: { nullValue: null },
          referralActivated: { booleanValue: false },
          referralCount: { integerValue: "0" },
          referralCommissionEarned: { integerValue: "0" },
          completedApprovedTasks: { integerValue: "0" },
          lastDailyClaimTime: { integerValue: "0" },
          referralBonusAwarded: { booleanValue: false },
          createdAt: { timestampValue: nowIso }
        }
      },
      currentDocument: { exists: false }
    }
  ]);

  // Apply referral code if provided during signup
  let referralApplied = false;
  const rawInvite = String(body.inviteCode || "").trim();
  if (rawInvite) {
    try {
      const refRes = await handleApplyReferral(uid, { inviteCode: rawInvite, deviceId }, adminToken, clientIp);
      if (refRes && refRes.status === 200) referralApplied = true;
    } catch (e) {
      console.warn("[Register] Referral apply notice:", e.message);
    }
  }

  return {
    status: 200,
    body: {
      success: true,
      created: true,
      myInviteCode: myCode,
      referralApplied
    }
  };
}

// ACTION 1: DAILY SIGN-IN BONUS (+10,000 Coins, strict server 24h cooldown)
// =========================================================================
async function handleDailyClaim(uid, adminToken, clientIp) {
  const ipRep = await checkIpReputation(clientIp);
  if (ipRep.isVpn) {
    return { status: 403, body: { success: false, error: "🛡️ VPN বা Proxy চালু আছে! অনুগ্রহ করে VPN বন্ধ করে ডেইলি বোনাস ক্লেইম করুন।" } };
  }
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
  const userPrecondition = userDoc.updateTime ? { updateTime: userDoc.updateTime } : { exists: true };
  await commitWrites(adminToken, [
    {
      update: {
        name: docPath(`users/${uid}`),
        fields: {
          lastDailyClaimTime: { integerValue: String(now) }
        }
      },
      updateMask: { fieldPaths: ["lastDailyClaimTime"] },
      currentDocument: userPrecondition
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
  const ipRep = await checkIpReputation(clientIp);
  if (ipRep.isVpn) {
    return { status: 403, body: { success: false, error: "🛡️ VPN বা Proxy ব্যবহার করে ব্রাউজিং টাস্ক ক্লেইম করা যাবে না!" } };
  }
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

  // 1. Global 12-second anti-spam cooldown + strict daily browsing cap
  const now = Date.now();
  const lastSurf = getFieldNumber(uFields, "lastSurfClaimTime", 0);
  if (now - lastSurf < 12000) {
    return { status: 429, body: { success: false, error: "অনুগ্রহ করে কয়েক সেকেন্ড অপেক্ষা করে আবার চেষ্টা করুন।" } };
  }

  const todayKey = getBdDateKey(now);
  const storedDateKey = getFieldString(uFields, "browsingClaimDate", "");
  const countToday = storedDateKey === todayKey ? getFieldNumber(uFields, "browsingClaimCountToday", 0) : 0;
  if (countToday >= MAX_DAILY_BROWSING_CLAIMS) {
    return {
      status: 429,
      body: { success: false, error: `আপনি আজকের সর্বোচ্চ ${MAX_DAILY_BROWSING_CLAIMS}টি ব্রাউজিং টাস্ক সম্পন্ন করেছেন! আগামীকাল আবার চেষ্টা করুন।` }
    };
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

  // 3. Determine authoritative rewardCoins from server (never trust client reward or arbitrary fake IDs!)
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
    } else if (/^(ow_|trf_|traffic_|offerwall_|\d{3,12}$)/i.test(rawTaskId)) {
      // Allow valid live Offerwall.GG traffic IDs with strict 500 coin cap (protected by daily cap)
      rewardCoins = 500;
    } else {
      return { status: 400, body: { success: false, error: "অবৈধ ব্রাউজিং টাস্ক আইডি!" } };
    }
  }

  const rewardTaka = Number((rewardCoins / 10000).toFixed(4));
  const nowIso = new Date(now).toISOString();
  const subDocId = `br_${uid}_${safeTaskId}_${now}`;
  const userName = getFieldString(uFields, "name", "User");
  const userEmail = getFieldString(uFields, "email", "");
  const userPrecondition = userDoc.updateTime ? { updateTime: userDoc.updateTime } : { exists: true };
  const claimPrecondition = (prevClaim && prevClaim.updateTime)
    ? { updateTime: prevClaim.updateTime }
    : { exists: false };

  await commitWrites(adminToken, [
    {
      update: {
        name: docPath(`users/${uid}`),
        fields: {
          lastSurfClaimTime: { integerValue: String(now) },
          browsingClaimDate: { stringValue: todayKey },
          browsingClaimCountToday: { integerValue: String(countToday + 1) }
        }
      },
      updateMask: { fieldPaths: ["lastSurfClaimTime", "browsingClaimDate", "browsingClaimCountToday"] },
      currentDocument: userPrecondition
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
      },
      currentDocument: claimPrecondition
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
// ACTION 3: APPLY REFERRAL CODE (Pending until 1st Offerwall/Micro-Task -> Active + 10k & 10% Commission)
// =========================================================================
async function handleApplyReferral(uid, body, adminToken, clientIp) {
  const ipRep = await checkIpReputation(clientIp);
  if (ipRep.isVpn) {
    return { status: 403, body: { success: false, error: "🛡️ VPN বা Proxy বন্ধ করে আসল ইন্টারনেট দিয়ে রেফারেল কোড ব্যবহার করুন।" } };
  }
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

  // Targeted Referral Unlock: Referrer gets 0 coins & 0 active count on signup.
  // Referrer unlocks Active count (+1) + 10,000 coins + 10% lifetime task commission
  // only when this user completes at least 1 Offerwall or Micro-Task!
  const userPrecondition = userDoc.updateTime ? { updateTime: userDoc.updateTime } : { exists: true };
  await commitWrites(adminToken, [
    {
      update: {
        name: docPath(`users/${uid}`),
        fields: {
          referredBy: { stringValue: code },
          referredByUid: { stringValue: referrer.id },
          referralActivated: { booleanValue: false }
        }
      },
      updateMask: { fieldPaths: ["referredBy", "referredByUid", "referralActivated"] },
      currentDocument: userPrecondition
    },
    {
      transform: {
        document: docPath(`users/${uid}`),
        fieldTransforms: [
          { fieldPath: "coins", increment: { integerValue: "30000" } }
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
      referralActivated: false,
      message: "🎉 অভিনন্দন! রেফারেল কোড যুক্ত হয়েছে এবং আপনি ৩০,০০০ কয়েন ওয়েলকাম বোনাস পেয়েছেন। আপনার ১ম অফারওয়াল বা মাইক্রো-টাস্ক কমপ্লিট হলেই রেফারার Active বোনাস ও ১০% কমিশন পাবেন!"
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

  // Step 2 Fraud Intelligence: Check VPN, Duplicate bKash/Nagad Number, and Duplicate Device across other accounts
  const [ipRep, phoneMatches, deviceMatches] = await Promise.all([
    checkIpReputation(clientIp),
    queryFirestoreEq(adminToken, "withdrawals", "phone", phone, 10).catch(() => []),
    deviceId ? queryFirestoreEq(adminToken, "users", "deviceId", deviceId, 10).catch(() => []) : Promise.resolve([])
  ]);

  const otherPhoneUsers = Array.from(new Set(
    phoneMatches.map(d => getFieldString(d.fields, "userId", "")).filter(id => id && id !== uid)
  ));
  const otherDeviceUsers = deviceMatches.map(d => d.id).filter(id => id && id !== uid);

  const fraudFlags = [];
  const fraudReasons = [];
  if (otherPhoneUsers.length > 0) {
    fraudFlags.push("DUPLICATE_PHONE");
    fraudReasons.push(`একই ${method} নম্বর আগে আরও ${otherPhoneUsers.length}টি ভিন্ন অ্যাকাউন্টে ব্যবহৃত হয়েছে`);
  }
  if (otherDeviceUsers.length > 0) {
    fraudFlags.push("DUPLICATE_DEVICE");
    fraudReasons.push(`একই ডিভাইসে আরও ${otherDeviceUsers.length}টি অ্যাকাউন্ট পাওয়া গেছে`);
  }
  if (ipRep.isVpn) {
    fraudFlags.push("VPN_DETECTED");
    fraudReasons.push(`VPN/Proxy IP (${clientIp}) থেকে উইথড্রল রিকোয়েস্ট পাঠানো হয়েছে`);
  }

  const fraudRisk = (otherPhoneUsers.length > 0 || fraudFlags.length >= 2)
    ? "HIGH"
    : (fraudFlags.length === 1 ? "MEDIUM" : "LOW");
  const fraudSummary = fraudReasons.join(" • ");

  // Atomic commit with optimistic concurrency lock (prevents double-spend / negative balance on rapid double-clicks)
  const userPrecondition = userDoc.updateTime ? { updateTime: userDoc.updateTime } : { exists: true };
  await commitWrites(adminToken, [
    {
      transform: {
        document: docPath(`users/${uid}`),
        fieldTransforms: [
          { fieldPath: "coins", increment: { integerValue: String(-coinsToWithdraw) } }
        ]
      },
      currentDocument: userPrecondition
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
          fraudRisk: { stringValue: fraudRisk },
          fraudFlags: { stringValue: fraudFlags.join(",") },
          fraudSummary: { stringValue: fraudSummary },
          vpnFlagged: { booleanValue: Boolean(ipRep.isVpn) },
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
    if (action === "register_user") {
      result = await handleRegisterUser(uid, decoded.email, body, adminToken, clientIp);
    } else if (action === "security_check") {
      result = await handleSecurityCheck(uid, body, adminToken, clientIp);
    } else if (action === "daily_claim") {
      result = await handleDailyClaim(uid, adminToken, clientIp);
    } else if (action === "browsing_claim") {
      result = await handleBrowsingClaim(uid, body, adminToken, clientIp);
    } else if (action === "apply_referral") {
      result = await handleApplyReferral(uid, body, adminToken, clientIp);
    } else if (action === "request_withdraw") {
      result = await handleRequestWithdraw(uid, body, adminToken, clientIp);
    } else {
      return res.status(400).json({ success: false, error: "Unknown wallet action" });
    }

    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("[Wallet Action Error]", err);
    const msg = err && err.message ? err.message : "Internal server error";
    const status = (err && err.statusCode)
      ? err.statusCode
      : (/token|auth|expired|signature|audience|issuer/i.test(msg) ? 401 : 500);
    return res.status(status).json({ success: false, error: msg });
  }
};

module.exports = universalHandler;
module.exports.handler = universalHandler;
