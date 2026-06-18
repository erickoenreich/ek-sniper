# EK Sniper

eBay auction sniper for EK Cards. Monitors auctions and auto-bids in the final seconds.

## How it works

1. Paste an eBay listing URL into the dashboard
2. Set your max bid and how many seconds before end to fire
3. The backend scheduler runs every minute, detects auctions ending soon, and fires your bid via eBay's Trading API
4. Win more cards at the last possible second

## Deploy to Netlify

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "EK Sniper init"
git remote add origin https://github.com/YOUR_USERNAME/ek-sniper.git
git push -u origin main
```

### 2. Connect to Netlify

- Go to netlify.com → Add new site → Import from Git
- Select your repo
- Build settings are auto-detected from netlify.toml

### 3. Set environment variables

In Netlify → Site settings → Environment variables, add:

| Variable | Value |
|---|---|
| `EBAY_APP_ID` | Your eBay developer App ID (Client ID) |
| `EBAY_CERT_ID` | Your eBay developer Cert ID (Client Secret) |
| `EBAY_DEV_ID` | Your eBay developer Dev ID |
| `EBAY_USER_TOKEN` | Your eBay user auth token |

### 4. Get your eBay credentials

1. Go to [developer.ebay.com](https://developer.ebay.com)
2. Sign in with your eBay account
3. Create an app → copy App ID, Cert ID, Dev ID
4. Go to **User Tokens** → **Get a Token from eBay via Your Application**
5. Complete the OAuth flow → copy the token

> Your user token expires after 18 months. The app uses it to place bids on your behalf.

## Architecture

```
public/index.html           Dashboard UI
netlify/functions/
  ebay-auth.js              eBay OAuth app token (auto-refreshes)
  ebay-lookup.js            Fetch auction details by URL/item ID
  ebay-bid.js               Place a bid via eBay Trading API
  ebay-snipe-scheduler.js   Scheduled: runs every minute, fires bids
  queue.js                  Read/write snipe queue (Netlify Blobs)
netlify.toml                Routing + scheduled function config
```

## Notes

- The scheduler fires every 60 seconds — auctions ending in less than 60s when added may be missed. Add auctions at least 2 minutes before they end.
- Netlify Blobs persists the queue between function invocations (no database needed).
- The app uses eBay's **PlaceOffer** Trading API call, which is the same call professional snipers use.
- eBay's ToS permits automated bidding; auction sniping is legal and widely used.
