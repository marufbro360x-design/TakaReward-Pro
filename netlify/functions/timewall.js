// Netlify Serverless Function for TimeWall Postback Integration
// Endpoint: https://takarewardpro.com/.netlify/functions/timewall
const crypto = require('crypto');

const SECRET_KEY = "506313a9cf4210a0d6daf16a8be69f28";
const FIREBASE_PROJECT_ID = "takareward-bd";
const FIREBASE_API_KEY = "AIzaSyA8c2BN56WPt_-SITD5fcWXj_aVFBzVgD0";

exports.handler = async (event, context) => {
  // Allow CORS
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "text/plain"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "OK" };
  }

  try {
    // 1. Extract Query Parameters (TimeWall sends GET request with macros)
    const params = event.queryStringParameters || {};
    
    // Also support JSON body if sent via POST
    let bodyParams = {};
    if (event.body) {
      try {
        bodyParams = JSON.parse(event.body);
      } catch (e) {
        // Fallback for form-urlencoded
        const urlParams = new URLSearchParams(event.body);
        for (const [key, value] of urlParams.entries()) {
          bodyParams[key] = value;
        }
      }
    }

    const userid = params.userid || params.userID || params.userId || bodyParams.userid || bodyParams.userID;
    const currency = params.currency || params.currencyAmount || bodyParams.currency;
    const revenue = params.revenue || bodyParams.revenue;
    const txid = params.txid || params.transactionID || params.transactionId || bodyParams.txid;
    const hash = params.hash || bodyParams.hash;
    const type = params.type || bodyParams.type || "1";

    console.log(`[TimeWall Postback Received] User: ${userid}, Revenue: ${revenue}, Currency: ${currency}, TxID: ${txid}`);

    if (!userid) {
      console.warn("Missing userid in TimeWall postback");
      return { statusCode: 400, headers, body: "Error: Missing userid" };
    }

    // 2. Security Hash Verification
    // TimeWall macro: hash("sha256", userID . revenue . SecretKey)
    if (hash && revenue) {
      const expectedHash = crypto
        .createHash('sha256')
        .update(String(userid) + String(revenue) + SECRET_KEY)
        .digest('hex');

      if (hash.toLowerCase() !== expectedHash.toLowerCase()) {
        console.warn(`[Hash Mismatch] Received: ${hash}, Expected: ${expectedHash}`);
        // If hash verification fails, we still return 200 after logging if desired, or return 403
        // To be safe, verify if it matches
        if (process.env.STRICT_HASH === "true") {
          return { statusCode: 403, headers, body: "Invalid Hash" };
        }
      } else {
        console.log("[Hash Verified Successfully]");
      }
    }

    // 3. Calculate TakaReward Coins to Award
    // Currency from TimeWall or converted from revenue USD
    // TakaReward conversion: 10,000 coins = ৳1 BDT.
    // 1 USD ≈ ৳120 BDT => 1 USD = 1,200,000 TakaReward coins.
    // TimeWall placement setting: $1.00 = 500,000 TimeWall Coins.
    let coinsToAdd = 0;
    if (currency && !isNaN(Number(currency))) {
      // Award the currency coins specified in the TimeWall placement
      coinsToAdd = Math.round(Number(currency));
    } else if (revenue && !isNaN(Number(revenue))) {
      // Fallback: Calculate from USD revenue (Revenue in USD * 120 BDT * 10,000 coins)
      coinsToAdd = Math.round(Number(revenue) * 120 * 10000);
    } else {
      coinsToAdd = 10000; // minimum 10,000 coins fallback
    }

    // If type indicates chargeback / reversal (negative)
    if (String(type) === "2" || String(type) === "-1") {
      coinsToAdd = -Math.abs(coinsToAdd);
    }

    // 4. Update User Coins & Log Transaction in Firebase Firestore
    // Using Firestore REST API Commit Transform
    const commitUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:commit?key=${FIREBASE_API_KEY}`;
    
    const userDocPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${userid}`;
    const logDocPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/timewall_logs/${txid || Date.now()}`;

    const commitPayload = {
      writes: [
        // Atomically increment coins on user doc
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
        // Log transaction history
        {
          update: {
            name: logDocPath,
            fields: {
              userId: { stringValue: String(userid) },
              txid: { stringValue: String(txid || "") },
              revenue: { stringValue: String(revenue || "0") },
              coins: { integerValue: coinsToAdd },
              type: { stringValue: String(type) },
              createdAt: { timestampValue: new Date().toISOString() }
            }
          }
        }
      ]
    };

    const fbRes = await fetch(commitUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(commitPayload)
    });

    const fbData = await fbRes.json();
    console.log("[Firestore Commit Response]", JSON.stringify(fbData));

    // 5. Respond with HTTP 200 OK
    // TimeWall expects HTTP 200 with '1' or 'OK' to mark transaction as completed!
    return {
      statusCode: 200,
      headers,
      body: "1"
    };

  } catch (err) {
    console.error("[TimeWall Postback Error]", err);
    // Return 200 with error log to prevent indefinite blocking if preferred, or 500
    return {
      statusCode: 500,
      headers,
      body: "Internal Error: " + err.message
    };
  }
};

