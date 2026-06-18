const https = require("https");

const BIN_ID = process.env.JSONBIN_BIN_ID;
const API_KEY = process.env.JSONBIN_API_KEY;

function jsonbinRequest(method, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: "api.jsonbin.io",
      path: `/v3/b/${BIN_ID}`,
      method,
      headers: {
        "X-Master-Key": API_KEY,
        "Content-Type": "application/json",
        "X-Bin-Versioning": "false",
        ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function getQueue() {
  if (!BIN_ID || !API_KEY) return [];
  try {
    const r = await jsonbinRequest("GET");
    return r.body?.record?.queue || [];
  } catch { return []; }
}

async function saveQueue(queue) {
  if (!BIN_ID || !API_KEY) return;
  await jsonbinRequest("PUT", { queue });
}

async function placeBid(itemId, maxBid, siteUrl) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ itemId, maxBid });
    const url = new URL(`${siteUrl}/api/ebay-bid`);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        try { resolve(JSON.parse(d)); }
        catch { resolve({ success: false, error: "parse error" }); }
      });
    });
    req.on("error", () => resolve({ success: false, error: "network error" }));
    req.write(body);
    req.end();
  });
}

exports.handler = async () => {
  const siteUrl = process.env.URL || "";
  const now = Date.now();

  let queue = await getQueue();
  if (queue.length === 0) return { statusCode: 200, body: "Queue empty" };

  const logs = [];
  let changed = false;

  for (const item of queue) {
    if (item.status === "won" || item.status === "lost") continue;

    const endMs = item.endTime ? new Date(item.endTime).getTime() : 0;
    const secondsLeft = (endMs - now) / 1000;

    if (secondsLeft > 0 && secondsLeft <= item.snipeSec && item.status === "watching") {
      item.status = "sniped";
      changed = true;
      logs.push(`SNIPING: ${item.itemId} — ${secondsLeft.toFixed(1)}s left, max $${item.maxBid}`);

      try {
        const result = await placeBid(item.itemId, item.maxBid, siteUrl);
        if (result.success) {
          item.status = "won";
          item.finalPrice = result.currentPrice;
          item.completedAt = now;
          logs.push(`  → WON at $${result.currentPrice}`);
        } else {
          item.status = "lost";
          item.completedAt = now;
          logs.push(`  → LOST: ${result.error}`);
        }
      } catch (err) {
        item.status = "lost";
        item.completedAt = now;
        logs.push(`  → ERROR: ${err.message}`);
      }
    }

    // Clean up old completed items after 24h
    if ((item.status === "won" || item.status === "lost") && item.completedAt) {
      if (now - item.completedAt > 86400000) {
        item._prune = true;
        changed = true;
      }
    }
  }

  if (changed) {
    queue = queue.filter(i => !i._prune);
    await saveQueue(queue);
  }

  console.log(logs.join("\n"));
  return { statusCode: 200, body: JSON.stringify({ logs }) };
};
