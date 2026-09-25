const https = require('https');
const crypto = require('crypto');

const SECRET_KEY = "506313a9cf4210a0d6daf16a8be69f28";

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const { userid, currency, revenue, txid, hash, type } = params;

  if (!userid || !currency) {
    return { statusCode: 400, body: "Missing parameters" };
  }

  // 1. Verify Hash Security
  if (hash && revenue) {
    const expectedHash = crypto.createHash('sha256').update(userid + revenue + SECRET_KEY).digest('hex');
    if (hash.toLowerCase() !== expectedHash.toLowerCase()) {
      console.warn("Invalid hash received from TimeWall");
    }
  }

  const coinsToAdd = parseInt(currency, 10);
  if (isNaN(coinsToAdd) || coinsToAdd <= 0) {
    return { statusCode: 400, body: "Invalid coin amount" };
  }

  // 2. Direct Credit via Firebase REST API
  try {
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/takareward-bd/databases/(default)/documents/users/${userid}`;
    
    // Send 200 OK to TimeWall to confirm receipt
    return {
      statusCode: 200,
      headers: { "Content-Type": "text/plain" },
      body: "OK"
    };
  } catch (err) {
    console.error("Postback Error:", err);
    return { statusCode: 500, body: "Error" };
  }
};
