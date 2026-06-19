// Searches eBay for active auctions similar to a given title
// Called after lookup to populate the Comps tab
const https = require("https");
const { getAppToken } = require("./ebay-auth");

function buildSearchQuery(title) {
  // Strip PSA grade info and common filler words to get a clean search
  return title
    .replace(/PSA\s*\d+/gi, "")
    .replace(/BGS\s*[\d.]+/gi, "")
    .replace(/\b(card|lot|pack|bundle|nm|mint|raw)\b/gi, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

async function searchAuctions(query, token) {
  const encoded = encodeURIComponent(query);
  const path = `/buy/browse/v1/item_summary/search?q=${encoded}&filter=buyingOptions:%7BAUCTION%7D,itemLocationCountry:US&sort=endingSoonest&limit=12`;

  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.ebay.com",
      path,
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        "Content-Type": "application/json",
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

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };

  try {
    const { title, excludeItemId } = JSON.parse(event.body || "{}");
    if (!title) return { statusCode: 400, headers, body: JSON.stringify({ error: "title required" }) };

    const token = await getAppToken();
    const query = buildSearchQuery(title);
    const { status, body } = await searchAuctions(query, token);

    if (status !== 200) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: body.errors?.[0]?.message || "eBay search error" }) };
    }

    const items = (body.itemSummaries || [])
      .filter(i => i.itemId !== excludeItemId)
      .slice(0, 10)
      .map(i => ({
        itemId: i.itemId,
        title: i.title,
        currentBid: parseFloat(i.currentBidPrice?.value || i.price?.value || 0),
        currency: i.currentBidPrice?.currency || "USD",
        endTime: i.itemEndDate,
        bidCount: i.bidCount || 0,
        condition: i.condition,
        url: i.itemWebUrl || `https://www.ebay.com/itm/${i.itemId}`,
        image: i.image?.imageUrl || null,
      }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ query, items }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
