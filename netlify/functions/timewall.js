// Netlify Serverless Function for TimeWall Postback Integration with Firebase Admin Superuser
// Endpoint: https://takarewardpro.com/.netlify/functions/timewall
const crypto = require('crypto');

const SECRET_KEY = "506313a9cf4210a0d6daf16a8be69f28";
const FIREBASE_PROJECT_ID = "takareward-bd";

// Service Account Credentials for Superuser Admin Access to Firestore
const SERVICE_ACCOUNT = {
  client_email: "firebase-adminsdk-fbsvc@takareward-bd.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC58Iai69AaPdXg\ngHFrZa7W19ekI4zLFuMHCMbUIwBVzOyuOzSaV6v8uPUSGeDIheuUbpIVwyIrdsz0\nWssWtETT0P4eNZVHUQZQW1I55XqofIn+lXQXrIehfqUVLACxn4Cp8BG/5QPaB5yz\n4S3HAaVMTWWhosOCpC+Oi0PMVvciyeMQ9QeeI8ZDzi883zqja9lx6ZOpuXrOIYbL\n2DqpUnDWF+uiz7ez7lfOOPHsThI0J2BWXoBpLAZoTBtJ3sNTNcTh9exN9eFfhz1l\n2wahGWOXNa0k6fT3+SWPJg2vOnKn/YEYt7KyUQuwCu0ld/MSuEvRYkSL78mIWUeT\nQ4gVeTntAgMBAAECggEAD75S2AaZZy9nJYwajlpctGowIwCzkhqM/HJ8y0dvZtRk\nEdiHeq4DrPFIJtE0HCZirP2zts3/3ahAcEwjt/dpgHnImmw1CIXOwA0LaEWK3is1\nT+39l2ePUFg1yBYitOdpcHoYNqRAcDyGwyBEzP3RriU7frUWUsBuGmamRe3zHOnQ\nKdPCb1YUVeCCZlItm+U9m6WcILK4O3IrnnOn5QaIJB2JJRV+xV6pYlSE68v8v/x9\n+vvH8TxLKVH3HdQ3pgKnDHOFZ/RTwbgWQXWxwc/5kyudWTu+zfWala/Ntg4xVw37\nbZ+qEKPmBdfr0SaPQi7GT3XE0EIiJfq1ZU/mUgykoQKBgQDj4ExZY+Uju7fsNtPF\n27u9kENWOyeW0JKTCIxAvSOAW1/2pPBOyf2eEYjgPESyR1H06qME3UMhwTvQQqIG\nApeEYYW+XndVMOABsQ09uqNfSokSz6Q5Tf8/DEM71p4xcRVDPMW2qMeZ2vC8+Kyy\ndnxh8zBP3swgkoAzslcjIik0BQKBgQDQ4z+2b14o7FghB8VtZSbV8mLZE0bhE4vE\nE8noRI6pICvtTgZank5X+oMrL3bTldvtFTH1kkPxufkROzcinZpIG+5dG+8hAoKC\n6aFNGSEE8E3pOuEQ401sv8P7yfGtbzj0Ypt/LvQffo6CPq0/Aemt4eHakB+JB7Vl\n/zhZPBF6yQKBgGyhXoQ2lONl95XJxUbLK0KA5TjUVlkU8Ora5lFuWOA1rxebJVvJ\n+vdBkKik0nLSgQVqXXBSMlCDF4p+WVLYJXbcLq/DxMt90yu7RX6p3Hvuwk2PYtBW\nmFlr9RkvhJY5PFOjQvWCnDSCJMVRHrKsvTrMfbl1koXskOUUHWoIPPApAoGBAI7x\nI1VFSor4iKo5tilREc1QK8JeRZ+aD4ei/wTZfUJQyJ6ASSrTr8rWm9H+jfLmVvQb\nD+/7IlGVMNJQ0j722G/F5UyD5BSTshnBpGas7oKBqt8SMpeq4/2qEIQJwj8roC7k\nF4Jl8BppMT4Bg+5c8brSmwpEm7/arZBZoQa3a0K5AoGAAsaXAGyIC66fX/Ctb9/a\nc4pCiyBZlBkjI7Jd9Wm7gnhtntSxX8RRqEdl2QTt9BbmehDbw5YT+X2br8kRTU2N\n3IfaPchN3RtgSqzoyqeP8aTpODTw1ntVyF0JDf6rOUdWFCmLNstQSJa9Vnuw67RQ\nRZOfK6mcyQufcHaakBjm4FM=\n-----END PRIVATE KEY-----\n",
  project_id: "takareward-bd"
};

// Generates Google OAuth2 Access Token using pure Node built-in crypto (Zero external dependencies)
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

exports.handler = async (event, context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "text/plain"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "OK" };
  }

  try {
    // 1. Extract Query / Body Parameters
    const params = event.queryStringParameters || {};
    let bodyParams = {};
    if (event.body) {
      try {
        bodyParams = JSON.parse(event.body);
      } catch (e) {
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

    console.log(`[TimeWall Postback] User: ${userid}, Revenue: ${revenue}, Currency: ${currency}, TxID: ${txid}`);

    if (!userid) {
      console.warn("Missing userid in TimeWall postback");
      return { statusCode: 400, headers, body: "Error: Missing userid" };
    }

    // 2. Security Hash Verification
    if (hash && revenue) {
      const expectedHash = crypto
        .createHash('sha256')
        .update(String(userid) + String(revenue) + SECRET_KEY)
        .digest('hex');

      if (hash.toLowerCase() !== expectedHash.toLowerCase()) {
        console.warn(`[Hash Mismatch] Received: ${hash}, Expected: ${expectedHash}`);
      } else {
        console.log("[Hash Verified Successfully]");
      }
    }

    // 3. Calculate TakaReward Coins
    let coinsToAdd = 0;
    if (currency && !isNaN(Number(currency))) {
      coinsToAdd = Math.round(Number(currency));
    } else if (revenue && !isNaN(Number(revenue))) {
      coinsToAdd = Math.round(Number(revenue) * 120 * 10000);
    } else {
      coinsToAdd = 10000;
    }

    // Chargeback handling
    if (String(type) === "2" || String(type) === "-1") {
      coinsToAdd = -Math.abs(coinsToAdd);
    }

    // 4. Obtain Superuser Admin Token
    const adminAccessToken = await getGoogleAdminToken();

    // 5. Update User Coins and Log in Firestore via Commit API
    const commitUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:commit`;
    const userDocPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${userid}`;
    const logDocPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/timewall_logs/${txid || Date.now()}`;

    const commitPayload = {
      writes: [
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
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${adminAccessToken}`
      },
      body: JSON.stringify(commitPayload)
    });

    const fbData = await fbRes.json();
    console.log("[Firestore Superuser Commit Result]", JSON.stringify(fbData));

    // Return 200 OK with '1' for TimeWall confirmation
    return {
      statusCode: 200,
      headers,
      body: "1"
    };

  } catch (err) {
    console.error("[TimeWall Postback Error]", err);
    return {
      statusCode: 500,
      headers,
      body: "Error: " + err.message
    };
  }
};
