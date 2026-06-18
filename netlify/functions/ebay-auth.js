const https = require("https");

let cachedToken = null;
let tokenExpiry = 0;

async function getAppToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const credentials = Buffer.from(
    `${process.env.EBAY_APP_ID}:${process.env.EBAY_CERT_ID}`
  ).toString("base64");

  return new Promise((resolve, reject) => {
    const body = "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope";
    const options = {
      hostname: "api.ebay.com",
      path: "/identity/v1/oauth2/token",
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.access_token) {
            cachedToken = json.access_token;
            tokenExpiry = Date.now() + (json.expires_in - 60) * 1000;
            resolve(cachedToken);
          } else {
            reject(new Error(JSON.stringify(json)));
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

module.exports = { getAppToken };
