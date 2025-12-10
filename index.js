// 🎀🎗 index.js — Reddit OAuth Backend with Logging and Redirect
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import { google } from 'googleapis';
import fs from 'fs';

const app = express();
const PORT = process.env.PORT || 3000;

const CLIENT_ID = '70G0I__N4hh4F48tKem05A'; // Installed app
const CLIENT_SECRET = ''; // Blank for installed apps
const USER_AGENT = 'FancyKarmaVerifier/1.0';
const GOOGLE_SHEET_ID = '1McharAzo-zSkcmhJ7HhGrVBF63B8lMpiXryWvjXj8rM';
const GOOGLE_SHEET_NAME = 'karmaLog';
const PASS_REDIRECT = 'https://script.google.com/macros/s/AKfycbwQEQeAJJxf8vvd3SVxcnx3B13L1cCDUmSHzMxjT_Cx7QuBtkl5TjsJSzMY9otI34w01w/exec';

app.use(cors());
app.use(express.json());

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(fs.readFileSync('google-credentials.json', 'utf8')),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const logToSheet = async (status, username, karma, age, error = '') => {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });
  const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${GOOGLE_SHEET_NAME}!A:E`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[timestamp, status, username || 'unknown', karma || '', error]],
    },
  });
};

app.post('/auth', async (req, res) => {
  const { code, redirect_uri } = req.body;
  if (!code || !redirect_uri) {
    await logToSheet('FAIL', 'unknown', '', '', 'Missing required fields');
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const tokenResponse = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri
      })
    });

    const tokenData = await tokenResponse.json();
    if (!tokenData.access_token) {
      await logToSheet('FAIL', 'unknown', '', '', tokenData.error || 'No access token');
      return res.status(401).json({ error: 'Invalid authorization code' });
    }

    const meResponse = await fetch('https://oauth.reddit.com/api/v1/me', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'User-Agent': USER_AGENT
      }
    });

    const meData = await meResponse.json();
    const username = meData.name || 'unknown';
    const totalKarma = meData.total_karma || (meData.link_karma + meData.comment_karma);
    const accountAgeMonths = Math.floor((Date.now() / 1000 - meData.created_utc) / (30 * 24 * 60 * 60));
    const isSuspended = !!meData.is_suspended;
    const isBanned = !!meData.is_suspended || meData.subreddit?.banned;

    if (isSuspended || isBanned) {
      await logToSheet('FAIL', username, totalKarma, accountAgeMonths, 'Suspended/Banned');
      return res.json({ status: 'fail', reason: 'Account is suspended or banned' });
    }

    if (totalKarma >= 200 && accountAgeMonths >= 8) {
      await logToSheet('PASS', username, totalKarma, accountAgeMonths);
      return res.json({ status: 'pass', redirect: PASS_REDIRECT });
    } else {
      await logToSheet('FAIL', username, totalKarma, accountAgeMonths, 'Low karma or young account');
      return res.json({ status: 'fail', reason: "Oops, you don't have enough karma or account age is too young" });
    }

  } catch (error) {
    console.error('❌ Backend error:', error);
    await logToSheet('FAIL', 'unknown', '', '', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/', (req, res) => {
  res.send('FancyKarma Backend is Live ✅');
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
