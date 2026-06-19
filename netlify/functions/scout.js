// Scout tab - grading ROI scorer using TheCardAPI sold price data
// Fetches raw, PSA 9, and PSA 10 sold prices and calculates multipliers

const https = require("https");

const GRADING_FEE = 80; // Regular tier

function cardApiRequest(query, extraParams) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      q: query,
      limit: "100",
      listing_type: "auction,fixed_price,best_offer",
      ...extraParams,
    });
    const options = {
      hostname: "thecardapi.com",
      port: 443,
      path: `/api/v1/market/sales?${params.toString()}`,
      method: "GET",
      headers: {
        "x-market-api-key": process.env.CARD_API_KEY,
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

function avg(prices) {
  if (!prices.length) return 0;
  return prices.reduce((a, b) => a + b, 0) / prices.length;
}

function median(prices) {
  if (!prices.length) return 0;
  const sorted = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };

  try {
    const { cardName } = JSON.parse(event.body || "{}");
    if (!cardName || cardName.length < 4) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Card name too short (min 4 chars)" }) };
    }

    if (!process.env.CARD_API_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: "CARD_API_KEY not configured — add it in Netlify env vars" }) };
    }

    // Run all three queries in parallel
    const [rawRes, psa10Res, psa9Res] = await Promise.all([
      // Raw: exclude graded listings
      cardApiRequest(`${cardName} -(psa,bgs,sgc,cgc)`, {}),
      // PSA 10
      cardApiRequest(`${cardName} psa 10`, {}),
      // PSA 9
      cardApiRequest(`${cardName} psa 9`, {}),
    ]);

    // Extract prices, filter outliers (remove top/bottom 10%)
    function extractPrices(res, gradeFilter) {
      if (res.status !== 200 || !res.body.data) return [];
      let sales = res.body.data;

      // If gradeFilter provided, verify grade field matches
      if (gradeFilter) {
        sales = sales.filter(s => s.grade === gradeFilter && s.grader === "PSA");
      }

      const prices = sales.map(s => s.price).filter(p => p > 0).sort((a, b) => a - b);
      if (prices.length <= 4) return prices;

      // Trim top/bottom 10%
      const trim = Math.max(1, Math.floor(prices.length * 0.1));
      return prices.slice(trim, prices.length - trim);
    }

    const rawPrices = extractPrices(rawRes, null);
    const psa10Prices = extractPrices(psa10Res, "10");
    const psa9Prices = extractPrices(psa9Res, "9");

    const rawAvg = median(rawPrices);
    const psa10Avg = median(psa10Prices);
    const psa9Avg = median(psa9Prices);

    // Gem rate proxy: PSA 10 count / (PSA 9 + PSA 10 count)
    const totalGraded = psa10Prices.length + psa9Prices.length;
    const gemRate = totalGraded > 0 ? (psa10Prices.length / totalGraded) : null;

    // Multipliers
    const costBasis = rawAvg + GRADING_FEE;
    const psa10Multiplier = costBasis > 0 && psa10Avg > 0 ? psa10Avg / costBasis : null;
    const psa9Multiplier = costBasis > 0 && psa9Avg > 0 ? psa9Avg / costBasis : null;

    // Score: weighted by gem rate
    // If gem rate is high, PSA 10 multiplier matters more
    // Score = (PSA10 mult * gemRate) + (PSA9 mult * (1 - gemRate))
    let score = null;
    if (psa10Multiplier && psa9Multiplier && gemRate !== null) {
      score = (psa10Multiplier * gemRate) + (psa9Multiplier * (1 - gemRate));
    } else if (psa10Multiplier) {
      score = psa10Multiplier;
    }

    // Grade the score
    function scoreGrade(s) {
      if (!s) return { label: "Insufficient data", color: "gray" };
      if (s >= 3.0) return { label: "🔥 Strong buy", color: "green" };
      if (s >= 2.0) return { label: "✓ Good candidate", color: "green" };
      if (s >= 1.5) return { label: "⚡ Marginal", color: "amber" };
      if (s >= 1.0) return { label: "⚠ Break even", color: "amber" };
      return { label: "✗ Not worth grading", color: "red" };
    }

    // Recent sales samples
    function sampleSales(res, gradeFilter, limit = 5) {
      if (res.status !== 200 || !res.body.data) return [];
      let sales = res.body.data;
      if (gradeFilter) sales = sales.filter(s => s.grade === gradeFilter && s.grader === "PSA");
      return sales.slice(0, limit).map(s => ({
        title: s.title,
        price: s.price,
        date: s.sale_date,
        url: s.listing_url,
        listingType: s.listing_type,
      }));
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        cardName,
        gradingFee: GRADING_FEE,
        raw: {
          count: rawPrices.length,
          avg: Math.round(rawAvg * 100) / 100,
          median: Math.round(median(rawPrices) * 100) / 100,
          samples: sampleSales(rawRes, null),
        },
        psa10: {
          count: psa10Prices.length,
          avg: Math.round(psa10Avg * 100) / 100,
          median: Math.round(median(psa10Prices) * 100) / 100,
          multiplier: psa10Multiplier ? Math.round(psa10Multiplier * 100) / 100 : null,
          samples: sampleSales(psa10Res, "10"),
        },
        psa9: {
          count: psa9Prices.length,
          avg: Math.round(psa9Avg * 100) / 100,
          median: Math.round(median(psa9Prices) * 100) / 100,
          multiplier: psa9Multiplier ? Math.round(psa9Multiplier * 100) / 100 : null,
          samples: sampleSales(psa9Res, "9"),
        },
        gemRate: gemRate !== null ? Math.round(gemRate * 1000) / 10 : null,
        costBasis: Math.round(costBasis * 100) / 100,
        score: score ? Math.round(score * 100) / 100 : null,
        scoreGrade: scoreGrade(score),
      }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
