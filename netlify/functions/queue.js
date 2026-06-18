// Queue stored in JSONBin.io (free, no config needed beyond API key)
// Set JSONBIN_BIN_ID and JSONBIN_API_KEY in Netlify env vars
// OR falls back to in-memory (resets on each function cold start — fine for testing)

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

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };

  try {
    if (event.httpMethod === "GET") {
      const queue = await getQueue();
      return { statusCode: 200, headers, body: JSON.stringify(queue) };
    }

    if (event.httpMethod === "POST") {
      const item = JSON.parse(event.body || "{}");
      if (!item.itemId || !item.maxBid) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "itemId and maxBid required" }) };
      }
      const queue = await getQueue();
      if (queue.find((q) => q.itemId === item.itemId)) {
        return { statusCode: 409, headers, body: JSON.stringify({ error: "Item already in queue" }) };
      }
      item.status = "watching";
      item.addedAt = Date.now();
      item.snipeSec = item.snipeSec || 8;
      queue.push(item);
      await saveQueue(queue);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, queue }) };
    }

    if (event.httpMethod === "DELETE") {
      const { itemId } = JSON.parse(event.body || "{}");
      let queue = await getQueue();
      queue = queue.filter((q) => q.itemId !== itemId);
      await saveQueue(queue);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, queue }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
