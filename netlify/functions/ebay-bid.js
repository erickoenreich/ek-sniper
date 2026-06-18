const https = require("https");

// Places a bid using eBay Trading API (SOAP) with user token
// Requires EBAY_USER_TOKEN env var (user auth token, not app token)

function buildPlaceBidXml(itemId, maxBid, devId, appId, certId, userToken) {
  return `<?xml version="1.0" encoding="utf-8"?>
<PlaceOfferRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${userToken}</eBayAuthToken>
  </RequesterCredentials>
  <ItemID>${itemId}</ItemID>
  <Offer>
    <Action>Bid</Action>
    <MaxBid currencyID="USD">${maxBid.toFixed(2)}</MaxBid>
    <Quantity>1</Quantity>
  </Offer>
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
</PlaceOfferRequest>`;
}

async function placeBid(itemId, maxBid) {
  const { EBAY_DEV_ID, EBAY_APP_ID, EBAY_CERT_ID, EBAY_USER_TOKEN } = process.env;

  if (!EBAY_USER_TOKEN) throw new Error("EBAY_USER_TOKEN not configured");

  const xml = buildPlaceBidXml(itemId, maxBid, EBAY_DEV_ID, EBAY_APP_ID, EBAY_CERT_ID, EBAY_USER_TOKEN);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.ebay.com",
      path: "/ws/api.dll",
      method: "POST",
      headers: {
        "Content-Type": "text/xml",
        "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
        "X-EBAY-API-DEV-NAME": EBAY_DEV_ID,
        "X-EBAY-API-APP-NAME": EBAY_APP_ID,
        "X-EBAY-API-CERT-NAME": EBAY_CERT_ID,
        "X-EBAY-API-CALL-NAME": "PlaceOffer",
        "X-EBAY-API-SITEID": "0",
        "Content-Length": Buffer.byteLength(xml),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, xml: data }));
    });
    req.on("error", reject);
    req.write(xml);
    req.end();
  });
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };

  try {
    const { itemId, maxBid } = JSON.parse(event.body || "{}");
    if (!itemId || !maxBid) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "itemId and maxBid required" }) };
    }

    const result = await placeBid(itemId, parseFloat(maxBid));

    // Parse result for success/failure
    const success = result.xml.includes("<Ack>Success</Ack>") || result.xml.includes("<Ack>Warning</Ack>");
    const errorMatch = result.xml.match(/<LongMessage>(.*?)<\/LongMessage>/);
    const errorMsg = errorMatch ? errorMatch[1] : null;
    const sellingStatusMatch = result.xml.match(/<SellingStatus>[\s\S]*?<CurrentPrice[^>]*>([\d.]+)<\/CurrentPrice>/);
    const currentPrice = sellingStatusMatch ? parseFloat(sellingStatusMatch[1]) : null;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success,
        itemId,
        maxBid,
        currentPrice,
        error: success ? null : errorMsg,
        raw: result.xml,
      }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
