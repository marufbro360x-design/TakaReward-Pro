// Universal Serverless Function for Takareward Pro P2P Balance Transfer System
// File Location in GitHub Repo: api/p2p-transfer.js
// Live Endpoint: https://www.takarewardpro.com/api/p2p-transfer
const crypto = require('crypto');

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

// Fetch a single document from Firestore REST API
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

// Query Firestore collection using structured query
async function queryFirestore(token, structuredQuery) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify({ structuredQuery })
  });
  if (!res.ok) {
    throw new Error(`Firestore query failed with status ${res.status}`);
  }
  const results = await res.json();
  return (Array.isArray(results) ? results : [])
    .filter(r => r.document)
    .map(r => ({
      id: r.document.name.split("/").pop(),
      data: parseFirestoreFields(r.document.fields || {})
    }));
}

// Helper to convert Firestore typed fields to normal JS object
function parseFirestoreFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v.stringValue !== undefined) out[k] = v.stringValue;
    else if (v.integerValue !== undefined) out[k] = parseInt(v.integerValue, 10);
    else if (v.doubleValue !== undefined) out[k] = parseFloat(v.doubleValue);
    else if (v.booleanValue !== undefined) out[k] = v.booleanValue;
    else if (v.timestampValue !== undefined) out[k] = v.timestampValue;
    else if (v.mapValue !== undefined) out[k] = parseFirestoreFields(v.mapValue.fields || {});
    else if (v.arrayValue !== undefined) {
      out[k] = (v.arrayValue.values || []).map(val => {
        if (val.stringValue !== undefined) return val.stringValue;
        if (val.integerValue !== undefined) return parseInt(val.integerValue, 10);
        return val;
      });
    } else out[k] = null;
  }
  return out;
}

// Hash Security PIN with SHA-256
function hashPin(pin) {
  return crypto.createHash('sha256').update(String(pin).trim()).digest('hex');
}

// Core P2P Transfer Processor
async function processTransfer(body) {
  const senderId = String(body.senderId || "").trim();
  const receiverInput = String(body.receiverInput || body.receiver || "").trim();
  const rawAmountTaka = parseFloat(body.amountTaka || body.amount || 0);
  const rawPin = String(body.securityPin || body.pin || "").trim();
  const idempotencyKey = String(body.txid || body.idempotencyKey || `TX-P2P-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`).trim();

  if (!senderId) {
    return { status: 400, data: { success: false, error: "Sender ID is required" } };
  }
  if (!receiverInput) {
    return { status: 400, data: { success: false, error: "Receiver username or ID is required" } };
  }
  if (isNaN(rawAmountTaka) || rawAmountTaka <= 0) {
    return { status: 400, data: { success: false, error: "Invalid transfer amount" } };
  }
  if (!rawPin || rawPin.length < 4) {
    return { status: 400, data: { success: false, error: "4-Digit Security PIN is required" } };
  }

  const adminToken = await getGoogleAdminToken();

  // 1. Idempotency Check: reject duplicate request
  const existingTx = await getFirestoreDoc(adminToken, `balance_transfers/${encodeURIComponent(idempotencyKey)}`);
  if (existingTx) {
    return {
      status: 200,
      data: {
        success: true,
        alreadyProcessed: true,
        txid: idempotencyKey,
        message: "Transaction already processed"
      }
    };
  }

  // 2. Fetch System Settings from transfer_settings/config
  const settingsDoc = await getFirestoreDoc(adminToken, "transfer_settings/config");
  const settings = settingsDoc ? parseFirestoreFields(settingsDoc.fields || {}) : {};
  if (settings.enabled === false) {
    return { status: 403, data: { success: false, error: "P2P Balance Transfer system is temporarily disabled by admin." } };
  }

  const minTransferTaka = parseFloat(settings.minTransferTaka || 20);
  const maxTransferTaka = parseFloat(settings.maxTransferTaka || 5000);
  const feePercent = parseFloat(settings.feePercent || 2.0);
  const minFeeTaka = parseFloat(settings.minFeeTaka || 2.0);

  if (rawAmountTaka < minTransferTaka) {
    return { status: 400, data: { success: false, error: `Minimum transfer amount is ৳${minTransferTaka}` } };
  }
  if (rawAmountTaka > maxTransferTaka) {
    return { status: 400, data: { success: false, error: `Maximum transfer amount is ৳${maxTransferTaka}` } };
  }

  // 3. Fetch Sender
  const senderDoc = await getFirestoreDoc(adminToken, `users/${senderId}`);
  if (!senderDoc) {
    return { status: 404, data: { success: false, error: "Sender account not found" } };
  }
  const senderData = parseFirestoreFields(senderDoc.fields || {});
  if (senderData.isBlocked || senderData.isSuspended) {
    return { status: 403, data: { success: false, error: "Sender account is suspended from making transfers." } };
  }

  // Security PIN Verification
  const storedPinHash = senderData.securityPinHash || "";
  const providedPinHash = hashPin(rawPin);
  if (!storedPinHash) {
    return { status: 400, data: { success: false, error: "Security PIN is not set yet. Please set your 4-digit PIN first." } };
  }
  if (storedPinHash !== providedPinHash) {
    return { status: 401, data: { success: false, error: "Incorrect Security PIN. Please try again." } };
  }

  // 4. Fetch Receiver
  let receiverData = null;
  let receiverId = null;

  // Direct UID match?
  const directReceiverDoc = await getFirestoreDoc(adminToken, `users/${receiverInput}`);
  if (directReceiverDoc) {
    receiverId = receiverInput;
    receiverData = parseFirestoreFields(directReceiverDoc.fields || {});
  } else {
    // Match by invite code or email
    const cleanInvite = receiverInput.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const queryInvite = {
      from: [{ collectionId: "users" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "myInviteCode" },
          op: "EQUAL",
          value: { stringValue: cleanInvite }
        }
      },
      limit: 1
    };
    const inviteResults = await queryFirestore(adminToken, queryInvite);
    if (inviteResults.length > 0) {
      receiverId = inviteResults[0].id;
      receiverData = inviteResults[0].data;
    } else {
      // Try email
      const queryEmail = {
        from: [{ collectionId: "users" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "email" },
            op: "EQUAL",
            value: { stringValue: receiverInput.toLowerCase() }
          }
        },
        limit: 1
      };
      const emailResults = await queryFirestore(adminToken, queryEmail);
      if (emailResults.length > 0) {
        receiverId = emailResults[0].id;
        receiverData = emailResults[0].data;
      }
    }
  }

  if (!receiverData || !receiverId) {
    return { status: 404, data: { success: false, error: "Receiver not found. Check User ID or Referral Code." } };
  }

  // Prevent self-transfer
  if (receiverId === senderId) {
    return { status: 400, data: { success: false, error: "Self-transfer is not permitted. You cannot transfer balance to yourself." } };
  }
  if (receiverData.isBlocked || receiverData.isSuspended) {
    return { status: 403, data: { success: false, error: "Receiver account cannot receive transfers at this time." } };
  }

  // 5. Source-Aware Transferable Balance Calculation (Hard Rules)
  // Eligible Transferable Sources: Task Earnings, Browsing Earnings, Offerwall Earnings (timewall, offerwall.gg, upwall)
  // Non-Transferable: Signup Bonus (30,000), Referral Rewards (10,000 / 100,000), Received Transfers
  // Note: Single-field filter avoids requiring a manual composite index in Firestore!
  const userTasksQuery = {
    from: [{ collectionId: "submissions" }],
    where: {
      fieldFilter: { field: { fieldPath: "userId" }, op: "EQUAL", value: { stringValue: senderId } }
    }
  };
  const userTasks = await queryFirestore(adminToken, userTasksQuery);
  let taskEarnedCoins = 0;
  userTasks.forEach(t => {
    if (t.data.status === "Approved") {
      taskEarnedCoins += (parseInt(t.data.rewardCoins, 10) || (parseFloat(t.data.rewardTaka || 0) * 10000));
    }
  });

  const surfEarnedCoins = parseInt(senderData.totalSurfEarnings, 10) || 0;
  const offerwallEarningsCoins = (parseInt(senderData.totalTimeWallEarnings, 10) || 0) +
                                 (parseInt(senderData.totalOfferwallEarnings, 10) || 0) +
                                 (parseInt(senderData.totalUpwallEarnings, 10) || 0);

  const totalEligibleEarnedCoins = taskEarnedCoins + surfEarnedCoins + offerwallEarningsCoins;

  // Subtract Prior Sent Transfers (Principal + Fees)
  const priorTransfersQuery = {
    from: [{ collectionId: "balance_transfers" }],
    where: {
      fieldFilter: { field: { fieldPath: "senderId" }, op: "EQUAL", value: { stringValue: senderId } }
    }
  };
  const priorTransfers = await queryFirestore(adminToken, priorTransfersQuery);
  let priorDeductedCoins = 0;
  priorTransfers.forEach(tx => {
    if (tx.data.status === "Success") {
      priorDeductedCoins += (parseInt(tx.data.totalDeductionCoins, 10) || 0);
    }
  });

  // Calculate strict transferable balance
  let availableTransferableCoins = Math.max(0, totalEligibleEarnedCoins - priorDeductedCoins);

  // Fallback safety cap: cannot exceed sender's actual Main Balance (coins)
  const currentSenderCoins = parseInt(senderData.coins, 10) || 0;
  availableTransferableCoins = Math.min(availableTransferableCoins, currentSenderCoins);

  // Non-transferable deduction floor = (Signup bonus 30,000 if referredBy present) + (Referrals * 10,000) + (Received P2P)
  const signupBonusCoins = senderData.referredBy ? 30000 : 0;
  const nonTransferableFloor = signupBonusCoins +
                               (parseInt(senderData.totalP2PReceived, 10) || 0) +
                               (parseInt(senderData.referralCount, 10) || 0) * 10000;
  const maxSafeTransferableByFloor = Math.max(0, currentSenderCoins - nonTransferableFloor);
  availableTransferableCoins = Math.min(availableTransferableCoins, maxSafeTransferableByFloor);

  // 6. Fee Calculation & Deductions
  const amountCoins = Math.round(rawAmountTaka * 10000);
  const calculatedFeeTaka = Math.max(minFeeTaka, (rawAmountTaka * feePercent) / 100);
  const feeTaka = parseFloat(calculatedFeeTaka.toFixed(2));
  const feeCoins = Math.round(feeTaka * 10000);
  const totalDeductionCoins = amountCoins + feeCoins;
  const totalDeductionTaka = parseFloat((rawAmountTaka + feeTaka).toFixed(2));

  if (totalDeductionCoins > availableTransferableCoins) {
    const availTaka = (availableTransferableCoins / 10000).toFixed(2);
    return {
      status: 400,
      data: {
        success: false,
        error: `Insufficient transferable balance! You have ৳${availTaka} transferable (Offerwalls & Tasks only). Total required with fee: ৳${totalDeductionTaka}.`
      }
    };
  }

  // 7. Atomic Commit via Firestore REST API (Reversal Protection)
  const nowIso = new Date().toISOString();
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:commit`;
  const senderDocPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${senderId}`;
  const receiverDocPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${receiverId}`;
  const transferDocPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/balance_transfers/${encodeURIComponent(idempotencyKey)}`;
  const senderLedgerPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/wallet_transactions/${encodeURIComponent(idempotencyKey)}_debit`;
  const receiverLedgerPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/wallet_transactions/${encodeURIComponent(idempotencyKey)}_credit`;
  const senderNotifPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/notifications/${encodeURIComponent(idempotencyKey)}_s`;
  const receiverNotifPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/notifications/${encodeURIComponent(idempotencyKey)}_r`;

  const commitPayload = {
    writes: [
      // 1. Debit Sender
      {
        transform: {
          document: senderDocPath,
          fieldTransforms: [
            {
              fieldPath: "coins",
              increment: { integerValue: String(-totalDeductionCoins) }
            },
            {
              fieldPath: "totalP2PSent",
              increment: { integerValue: String(totalDeductionCoins) }
            }
          ]
        }
      },
      // 2. Credit Receiver (Tagged with totalP2PReceived to lock re-transfer)
      {
        transform: {
          document: receiverDocPath,
          fieldTransforms: [
            {
              fieldPath: "coins",
              increment: { integerValue: String(amountCoins) }
            },
            {
              fieldPath: "totalP2PReceived",
              increment: { integerValue: String(amountCoins) }
            }
          ]
        }
      },
      // 3. Write Transfer Ledger Record
      {
        update: {
          name: transferDocPath,
          fields: {
            txid: { stringValue: idempotencyKey },
            senderId: { stringValue: senderId },
            senderName: { stringValue: senderData.name || "Sender" },
            senderEmail: { stringValue: senderData.email || "" },
            receiverId: { stringValue: receiverId },
            receiverName: { stringValue: receiverData.name || "Receiver" },
            receiverEmail: { stringValue: receiverData.email || "" },
            amountTaka: { doubleValue: rawAmountTaka },
            amountCoins: { integerValue: String(amountCoins) },
            feeTaka: { doubleValue: feeTaka },
            feeCoins: { integerValue: String(feeCoins) },
            totalDeductionCoins: { integerValue: String(totalDeductionCoins) },
            totalDeductionTaka: { doubleValue: totalDeductionTaka },
            status: { stringValue: "Success" },
            sourceType: { stringValue: "p2p_transfer" },
            receiverTransferable: { booleanValue: false }, // Received funds are NOT transferable
            createdAt: { timestampValue: nowIso }
          }
        }
      },
      // 4a. Sender Wallet Transaction Ledger Entry (Debit)
      {
        update: {
          name: senderLedgerPath,
          fields: {
            txid: { stringValue: idempotencyKey },
            userId: { stringValue: senderId },
            type: { stringValue: "debit" },
            source_type: { stringValue: "p2p_sent" },
            amountTaka: { doubleValue: totalDeductionTaka },
            amountCoins: { integerValue: String(totalDeductionCoins) },
            feeTaka: { doubleValue: feeTaka },
            feeCoins: { integerValue: String(feeCoins) },
            withdrawable: { booleanValue: false },
            transferable: { booleanValue: false },
            status: { stringValue: "Success" },
            referenceUserId: { stringValue: receiverId },
            createdAt: { timestampValue: nowIso }
          }
        }
      },
      // 4b. Receiver Wallet Transaction Ledger Entry (Credit - Withdraw YES, Transfer NO)
      {
        update: {
          name: receiverLedgerPath,
          fields: {
            txid: { stringValue: idempotencyKey },
            userId: { stringValue: receiverId },
            type: { stringValue: "credit" },
            source_type: { stringValue: "received_transfer" },
            amountTaka: { doubleValue: rawAmountTaka },
            amountCoins: { integerValue: String(amountCoins) },
            remaining_amount: { integerValue: String(amountCoins) },
            withdrawable: { booleanValue: true },
            transferable: { booleanValue: false },
            status: { stringValue: "Success" },
            referenceUserId: { stringValue: senderId },
            createdAt: { timestampValue: nowIso }
          }
        }
      },
      // 4. Sender Notification
      {
        update: {
          name: senderNotifPath,
          fields: {
            userId: { stringValue: senderId },
            title: { stringValue: "💸 P2P ট্রান্সফার সফল!" },
            message: { stringValue: `৳${rawAmountTaka} has been successfully transferred to @${receiverData.name || "User"}. Fee: ৳${feeTaka}. (TxID: ${idempotencyKey})` },
            time: { stringValue: "Just now" },
            createdAt: { timestampValue: nowIso }
          }
        }
      },
      // 5. Receiver Notification
      {
        update: {
          name: receiverNotifPath,
          fields: {
            userId: { stringValue: receiverId },
            title: { stringValue: "💰 P2P ব্যালেন্স গ্রহণ!" },
            message: { stringValue: `You have received ৳${rawAmountTaka} from @${senderData.name || "User"}. (TxID: ${idempotencyKey})` },
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

  const commitData = await commitRes.json();
  if (!commitRes.ok || commitData.error) {
    console.error("[P2P Transfer Commit Failed - Rollback Enforced]", JSON.stringify(commitData));
    return {
      status: 500,
      data: {
        success: false,
        error: "Transfer processing failed. Automatic reversal enforced: no balance was deducted."
      }
    };
  }

  console.log(`[P2P Transfer Committed Successfully] Tx: ${idempotencyKey}, From: ${senderId} -> To: ${receiverId}, Amount: ৳${rawAmountTaka}, Fee: ৳${feeTaka}`);

  return {
    status: 200,
    data: {
      success: true,
      txid: idempotencyKey,
      senderName: senderData.name || "User",
      receiverName: receiverData.name || "User",
      receiverId: receiverId,
      amountTaka: rawAmountTaka,
      amountCoins: amountCoins,
      feeTaka: feeTaka,
      feeCoins: feeCoins,
      totalDeductionTaka: totalDeductionTaka,
      totalDeductionCoins: totalDeductionCoins,
      message: `৳${rawAmountTaka} has been successfully transferred to @${receiverData.name || "User"}.`
    }
  };
}

// Universal Handler Export (Works on both Vercel and Netlify)
const universalHandler = async (reqOrEvent, res) => {
  if (res && typeof res.status === "function") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Content-Type", "application/json");

    if (reqOrEvent.method === "OPTIONS") {
      return res.status(200).json({ success: true });
    }

    // Health check
    if (reqOrEvent.method === "GET") {
      return res.status(200).json({ success: true, service: "Takareward Pro P2P Transfer API", status: "Active" });
    }

    try {
      const body = reqOrEvent.body && typeof reqOrEvent.body === "object" ? reqOrEvent.body : JSON.parse(reqOrEvent.body || "{}");
      const result = await processTransfer(body);
      return res.status(result.status).json(result.data);
    } catch (err) {
      console.error("[P2P API Error]", err);
      return res.status(500).json({ success: false, error: err.message || "Internal server error" });
    }
  }

  // Netlify fallback
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json"
  };

  if (reqOrEvent.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true }) };
  }

  try {
    const body = reqOrEvent.body ? JSON.parse(reqOrEvent.body) : {};
    const result = await processTransfer(body);
    return { statusCode: result.status, headers: corsHeaders, body: JSON.stringify(result.data) };
  } catch (err) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ success: false, error: err.message }) };
  }
};

module.exports = universalHandler;
module.exports.handler = universalHandler;
