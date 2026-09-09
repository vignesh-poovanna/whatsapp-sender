// Free, self-hosted WhatsApp sender using whatsapp-web.js (unofficial — automates
// a real WhatsApp account, no Meta Business API, no per-message cost).
//
// SETUP:
//   1. Make sure you're on Node.js 20 LTS (not 24 — see troubleshooting notes below).
//   2. npm install
//   3. npm start
//   4. Scan the QR code that prints in the terminal with a DEDICATED WhatsApp
//      number (a spare SIM / WhatsApp Business app) — not the clinic's main line.
//   5. Deploy this wherever it can stay running 24/7 (see implementation guide).
//
// SECURITY: set SENDER_SECRET below to a random string and keep it private —
// this endpoint can send WhatsApp messages to anyone, from your number.
//
// TROUBLESHOOTING "Execution context was destroyed" / ProtocolError on startup:
//   - Use Node.js 20 LTS, not a newer/Current release — Puppeteer compatibility
//     lags behind brand-new Node versions.
//   - Delete node_modules + package-lock.json and run npm install fresh.
//   - Delete the .wwebjs_auth and .wwebjs_cache folders in this project and retry.
//   - Move this project OUT of any OneDrive/Dropbox/Google Drive synced folder —
//     live syncing can lock files mid-write and crash Puppeteer's Chromium profile.
//   - Temporarily disable antivirus/Defender real-time protection to rule it out.

const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');

const SENDER_SECRET = process.env.SENDER_SECRET || 'Vignesh@Snehal';
const PORT = process.env.PORT || 3000;

// Find the Chrome binary that the "postinstall" step downloaded (npx puppeteer
// browsers install chrome). The "puppeteer" package (a devDependency here just
// for this) knows exactly where it put it — far more reliable than guessing.
function findChromeExecutable() {
    try {
        return require('puppeteer').executablePath();
    } catch (e) {
        console.log('Could not resolve Chrome path via puppeteer package:', e.message);
        return undefined;
    }
}

const chromeExecutablePath = process.env.PUPPETEER_EXECUTABLE_PATH || findChromeExecutable();
if (chromeExecutablePath) {
    console.log('Using Chrome at:', chromeExecutablePath);
} else {
    console.log('No explicit Chrome path found — letting Puppeteer resolve its own default.');
}

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: chromeExecutablePath,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    },
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1027246807-alpha.html'
    }
});

let latestQr = null;
let clientReady = false;

client.on('qr', (qr) => {
    latestQr = qr;
    console.log('New QR code received. Visit /qr on this service\'s URL in a browser to scan a real, properly-scaled image instead of the ASCII art below.');
    qrcode.generate(qr, { small: true }); // kept as a fallback / sanity check in the logs
});

client.on('loading_screen', (percent, message) => {
    console.log('Loading WhatsApp Web: ' + percent + '% - ' + message);
});

client.on('authenticated', () => {
    console.log('Authenticated. Waiting for client to be ready...');
});

client.on('auth_failure', (msg) => {
    console.error('Authentication failed:', msg);
    console.error('Delete the .wwebjs_auth folder and restart to get a fresh QR code.');
});

client.on('ready', () => {
    clientReady = true;
    latestQr = null;
    console.log('WhatsApp sender is ready.');
});

client.on('disconnected', (reason) => {
    console.error('WhatsApp client disconnected:', reason);
    console.error('Restart the server and rescan the QR code if this persists.');
});

client.initialize();

const app = express();
app.use(express.json());

// Simple health check so you (or an uptime pinger) can confirm the service is alive.
app.get('/', (req, res) => {
    res.json({ ok: true, service: 'aurora-dental-whatsapp-sender', whatsappReady: clientReady });
});

// Visit this in a browser (on the phone you're linking, or on any device —
// zoom into the image and scan it with the WhatsApp app's camera) to get a
// real, properly-scaled QR code instead of distorted ASCII art in the logs.
app.get('/qr', async (req, res) => {
    if (clientReady) {
        return res.send('<h2>Already linked and ready — no QR code needed.</h2>');
    }
    if (!latestQr) {
        return res.send('<h2>No QR code yet — still starting up. Refresh this page in a few seconds.</h2>');
    }
    try {
        const dataUrl = await QRCode.toDataURL(latestQr, { width: 400, margin: 2 });
        res.send(`
      <html>
        <head><title>Scan to link WhatsApp</title></head>
        <body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#111;color:#eee;">
          <h2>Scan with WhatsApp &rarr; Linked Devices &rarr; Link a Device</h2>
          <img src="${dataUrl}" alt="WhatsApp QR code" style="background:#fff;padding:16px;border-radius:8px;" />
          <p>This page auto-refreshes every 20 seconds until it's linked.</p>
          <script>setTimeout(() => location.reload(), 20000);</script>
        </body>
      </html>
    `);
    } catch (err) {
        res.status(500).send('Error generating QR image: ' + err);
    }
});

app.post('/send', async (req, res) => {
    if (req.headers['x-sender-secret'] !== SENDER_SECRET) {
        return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    const { phone, message } = req.body || {};
    if (!phone || !message) {
        return res.status(400).json({ ok: false, error: 'phone and message are required' });
    }
    try {
        // Normalize to WhatsApp's chat-id format: <countrycode+number>@c.us
        const digitsOnly = String(phone).replace(/[^\d]/g, '');
        const chatId = digitsOnly + '@c.us';
        await client.sendMessage(chatId, message);
        res.json({ ok: true });
    } catch (err) {
        console.error('Send failed:', err);
        res.status(500).json({ ok: false, error: String(err) });
    }
});

app.listen(PORT, () => console.log('Sender listening on port ' + PORT));