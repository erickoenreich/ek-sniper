// Scheduled function: runs every minute via netlify.toml schedule
// Reads the snipe queue from Netlify Blobs (persistent storage),
// checks each auction's end time, and fires bids when within snipe window.

const https = require("https");

// --- Netlify Blobs helpers (built into Netlify runtime) ---
let blobStore;
async function getStore() {
  if (blobStore) return blobStore;
  const { getStore } = await import("@netlify/blobs");
  blobStore = getStore("snipe-queue");
  return blobStore;
}

async function getQueue() {
  try {
    const store = await getStore();
    const raw = await store.get("queue");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function saveQueue(queue) {
  const store = await getStore();
  await store.set("queue", JSON.stringify(queue));
}

// --- Place bid by calling our own ebay-bid function ---
async function triggerBid(itemId, maxBid, siteUrl) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ itemId, maxBid });
    const url = new URL(`${siteUrl}/api/ebay-bid`);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "X-Sniper-Secret": process.env.SNIPER_SECRET || "",
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ success: false, error: "parse error" }); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// --- Fetch current auction state from eBay Browse API ---
async function getCurrentPrice(itemId, appToken) {
  return new Promise((resolve) => {
    const options = {
      hostname: "api.ebay.com",
      path: `/buy/browse/v1/item/v1|${itemId}|0`,
      method: "GET",
      headers: {
        Authorization: `Bearer ${appToken}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          resolve({
            currentBid: parseFloat(json.currentBidPrice?.value || json.price?.value || 0),
            endTime: json.itemEndDate,
            ended: json.itemEndDate ? new Date(json.itemEndDate) < new Date() : false,
          });
        } catch {
          resolve({ currentBid: 0, endTime: null, ended: false });
        }
      });
    });
    req.on("error", () => resolve({ currentBid: 0, endTime: null, ended: false }));
    req.end();
  });
}

async function getAppToken() {
  const { getAppToken } = require("./ebay-auth");
  return getAppToken();
}

exports.handler = async (event) => {
  const siteUrl = process.env.URL || "https://your-site.netlify.app";
  const now = Date.now();

  let queue = await getQueue();
  if (queue.length === 0) return { statusCode: 200, body: "Queue empty" };

  let appToken;
  try { appToken = await getAppToken(); } catch { appToken = null; }

  const logs = [];
  const updatedQueue = [];

  for (const item of queue) {
    // Skip already completed items older than 24h
    if (item.status === "won" || item.status === "lost") {
      const completedAt = item.completedAt || 0;
      if (now - completedAt > 86400000) continue; // prune after 24h
      updatedQueue.push(item);
      continue;
    }

    // Refresh current price + end time from eBay if we have a token
    if (appToken && item.itemId) {
      const live = await getCurrentPrice(item.itemId, appToken);
      if (live.endTime) item.endTime = live.endTime;
      if (live.currentBid) item.currentBid = live.currentBid;
      if (live.ended && item.status !== "sniped") {
        item.status = "lost";
        item.completedAt = now;
        logs.push(`[${new Date().toISOString()}] EXPIRED (no snipe fired): ${item.title} (${item.itemId})`);
        updatedQueue.push(item);
        continue;
      }
    }

    const endMs = item.endTime ? new Date(item.endTime).getTime() : 0;
    const secondsLeft = (endMs - now) / 1000;

    // Fire the snipe if within the configured window
    if (secondsLeft > 0 && secondsLeft <= item.snipeSec && item.status === "watching") {
      item.status = "sniped";
      logs.push(`[${new Date().toISOString()}] SNIPING: ${item.title} (${item.itemId}) max $${item.maxBid} — ${secondsLeft.toFixed(1)}s left`);

      try {
        const result = await triggerBid(item.itemId, item.maxBid, siteUrl);
        item.bidResult = result;
        if (result.success) {
          item.status = "won";
          item.completedAt = now;
          item.finalPrice = result.currentPrice;
          logs.push(`  → BID SUCCESS: won at $${result.currentPrice}`);
        } else {
          item.status = "lost";
          item.completedAt = now;
          logs.push(`  → BID FAILED: ${result.error}`);
        }
      } catch (err) {
        item.status = "lost";
        item.completedAt = now;
        logs.push(`  → BID ERROR: ${err.message}`);
      }
    }

    updatedQueue.push(item);
  }

  await saveQueue(updatedQueue);
  console.log(logs.join("\n"));

  return {
    statusCode: 200,
    body: JSON.stringify({ processed: queue.length, logs }),
  };
};
