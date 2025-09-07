// index.js - Deploy to Vercel as an API route

const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const app = express();

app.use(bodyParser.json());

// === CONFIGURATION ===
const ALPACA_API_KEY = process.env.ALPACA_API_KEY;
const ALPACA_SECRET_KEY = process.env.ALPACA_SECRET_KEY;
const ALPACA_BASE_URL = 'https://paper-api.alpaca.markets';
const TRADE_PERCENT = 0.02; // 2% of account
const ALLOWED_TICKERS = ['IMNM'];
const MARKET_OPEN_HOUR = 8;  // Central Time
const MARKET_CLOSE_HOUR = 15; // Central Time

// === HELPER FUNCTIONS ===
function isMarketHours() {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcDay = now.getUTCDay();
  if (utcDay === 0 || utcDay === 6) return false; // Sunday or Saturday
  const ctHour = utcHour - 5; // Convert UTC to Central
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

// === MAIN ROUTE ===
app.post('/api/trade', async (req, res) => {
  try {
    const { ticker, action } = req.body;
    if (!ALLOWED_TICKERS.includes(ticker)) return res.status(403).send('Ticker not allowed');
    if (!['BUY', 'SELL'].includes(action)) return res.status(400).send('Invalid action');
    if (!isMarketHours()) return res.status(403).send('Outside market hours');

    const account = await getAccount();
    const buyingPower = parseFloat(account.buying_power);
    const maxSpend = buyingPower * TRADE_PERCENT;

    const quote = await axios.get(`https://data.alpaca.markets/v2/stocks/${ticker}/quotes/latest`, {
      headers: {
        'APCA-API-KEY-ID': ALPACA_API_KEY,
        'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY,
      },
    });
    const price = quote.data.quote.ap;
    const qty = Math.floor(maxSpend / price);
    if (qty < 1) return res.status(400).send('Not enough buying power');

    await placeOrder(ticker, action.toLowerCase(), qty);
    res.status(200).send(`Order placed: ${action} ${qty} ${ticker}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

module.exports = app;
