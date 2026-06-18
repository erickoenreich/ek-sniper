const https = require("https");
const { getAppToken } = require("./ebay-auth");

function extractItemId(input) {
  input = input.trim();
  const itm = input.match(/\/itm\/(\d+)/);
  if (itm) return itm[1];
  if (/^\d{10,13}$/.test(input)) return input;
  const hash = input.match(/#?(\d{10,13})/);
  if (hash) return hash[1];
  return null;
}

async function fetchItem(itemId, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.ebay.com",
      path: `/buy/browse/v1/item/v1|${itemId}|0`,
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers };
  }

  try {
    const { url } = JSON.parse(event.body || "{}");
    if (!url) return { statusCode: 400, headers, body: JSON.stringify({ error: "url required" }) };

    const itemId = extractItemId(url);
    if (!itemId) return { statusCode: 400, headers, body: JSON.stringify({ error: "Could not parse item ID from input" }) };

    const token = await getAppToken();
    const { status, body } = await fetchItem(itemId, token);

    if (status !== 200) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: body.errors?.[0]?.message || "eBay API error", raw: body }) };
    }

    const isAuction = body.buyingOptions?.includes("AUCTION");
    if (!isAuction) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "This listing is not an auction (Buy It Now only)" }) };
    }

    const result = {
      itemId,
      title: body.title,
      image: body.image?.imageUrl || null,
      currentBid: parseFloat(body.currentBidPrice?.value || body.price?.value || 0),
      currency: body.currentBidPrice?.currency || "USD",
      endTime: body.itemEndDate,
      seller: body.seller?.username,
      condition: body.condition,
      url: `https://www.ebay.com/itm/${itemId}`,
      bidCount: body.bidCount || 0,
    };

    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
