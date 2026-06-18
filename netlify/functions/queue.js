// GET  /api/queue       → returns current queue
// POST /api/queue       → adds item to queue (body: { itemId, title, maxBid, snipeSec, endTime, currentBid })
// DELETE /api/queue     → removes item (body: { itemId })

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
      // Prevent duplicates
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
