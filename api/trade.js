// api/trade.js - logs trades to Google Sheets and blocks overbuying & day trades

const axios = require('axios');
const { google } = require('googleapis');

const ALPACA_API_KEY = process.env.ALPACA_API_KEY;
const ALPACA_SECRET_KEY = process.env.ALPACA_SECRET_KEY;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
const ALPACA_BASE_URL = 'https://paper-api.alpaca.markets';
const TRADE_PERCENT = 0.02;
const ALLOWED_TICKERS = ['IMNM','IMTX','DMAC'];
const MARKET_OPEN_HOUR = 8;
const MARKET_CLOSE_HOUR = 15;

function isMarketHours() {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcDay = now.getUTCDay();
  if (utcDay === 0 || utcDay === 6) return false;
  const ctHour = utcHour - 5;
  return ctHour >= MARKET_OPEN_HOUR && ctHour < MARKET_CLOSE_HOUR;
}

async function getAccount() {
  const res = await axios.get(`${ALPACA_BASE_URL}/v2/account`, {
    headers: {
      'APCA-API-KEY-ID': ALPACA_API_KEY,
      'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY,
    },
  });
  return res.data;
}

async function getPosition(ticker) {
  try {
    const res = await axios.get(`${ALPACA_BASE_URL}/v2/positions/${ticker}`, {
      headers: {
        'APCA-API-KEY-ID': ALPACA_API_KEY,
        'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY,
      },
    });
    return parseFloat(res.data.qty);
  } catch (err) {
    if (err.response && err.response.status === 404) return 0;
    throw err;
  }
}

async function hasOpenBuyOrder(ticker) {
  const res = await axios.get(`${ALPACA_BASE_URL}/v2/orders?status=open&symbols=${ticker}`, {
    headers: {
      'APCA-API-KEY-ID': ALPACA_API_KEY,
      'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY,
    },
  });

  const orders = res.data || [];
  return orders.some(order => order.symbol === ticker && order.side === 'buy');
}

async function didTradeToday(ticker, action) {
  const today = new Date().toISOString().split('T')[0];
  const res = await axios.get(`${ALPACA_BASE_URL}/v2/orders?status=closed&symbols=${ticker}`, {
    headers: {
      'APCA-API-KEY-ID': ALPACA_API_KEY,
      'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY,
    },
  });

  const orders = res.data || [];
  return orders.some(order =>
    order.symbol === ticker &&
    order.side.toUpperCase() !== action &&
    order.filled_at && order.filled_at.startsWith(today)
  );
}

async function placeOrder(symbol, side, qty) {
  return await axios.post(`${ALPACA_BASE_URL}/v2/orders`, {
    symbol,
    qty,
    side,
    type: 'market',
    time_in_force: 'gtc',
  }, {
    headers: {
      'APCA-API-KEY-ID': ALPACA_API_KEY,
      'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY,
    },
  });
}

async function logToGoogleSheet(ticker, action, qty, price, notes = '') {
  const auth = new google.auth.JWT(
    GOOGLE_SERVICE_ACCOUNT.client_email,
    null,
    GOOGLE_SERVICE_ACCOUNT.private_key,
    ['https://www.googleapis.com/auth/spreadsheets']
  );

  const sheets = google.sheets({ version: 'v4', auth });

  const row = [[
    new Date().toISOString(),
    ticker,
    action,
    qty,
    price,
    notes
  ]];

  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: 'Sheet1!A:F',
    valueInputOption: 'USER_ENTERED',
    resource: { values: row },
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { ticker, action, test } = req.body;
    if (!ALLOWED_TICKERS.includes(ticker)) return res.status(403).send('Ticker not allowed');
    if (!['BUY', 'SELL'].includes(action)) return res.status(400).send('Invalid action');
    if (!isMarketHours() && !test) return res.status(403).send('Outside market hours');

    if (!test) {
      const alreadyTradedToday = await didTradeToday(ticker, action);
      if (alreadyTradedToday) {
        return res.status(403).send(`Blocked to avoid day trade: already ${action === 'BUY' ? 'sold' : 'bought'} ${ticker} today.`);
      }
    }

    if (action === 'BUY') {
      const positionQty = await getPosition(ticker);
      const hasPending = test ? false : await hasOpenBuyOrder(ticker);
      if (positionQty > 0 || hasPending) return res.status(409).send('Already holding or pending buy order');
    }

    const account = await getAccount();
    const buyingPower = parseFloat(account.buying_power);
    const maxSpend = buyingPower * TRADE_PERCENT;

    const quoteResp = await axios.get(`https://data.alpaca.markets/v2/stocks/${ticker}/quotes/latest`, {
      headers: {
        'APCA-API-KEY-ID': ALPACA_API_KEY,
        'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY,
      },
    });

    const quote = quoteResp?.data?.quote || {};
    const price = quote.ap || quote.bp || quote.lp || null;
    if (!price || isNaN(price)) {
      console.error('Invalid quote data:', quote);
      return res.status(400).send('Invalid price data');
    }

    const qty = Math.floor(maxSpend / price);
    if (!qty || qty < 1) return res.status(400).send('Not enough buying power');

    await placeOrder(ticker, action.toLowerCase(), qty);
    await logToGoogleSheet(ticker, action, qty, price, test ? 'test mode' : 'live');

    res.status(200).send(`Order placed: ${action} ${qty} ${ticker}`);
  } catch (err) {
    console.error('ERROR:', err);
    res.status(500).send('Server error');
  }
};
