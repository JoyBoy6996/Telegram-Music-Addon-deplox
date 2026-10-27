# Telegram Music Addon

A lightweight, self-hosted streaming server that turns your private Telegram channel into a personal, lossless music streaming cloud for **[BitChord](https://github.com/kushagrasinghx/BitChord)** and **WebDAV** clients.

Stream bit-perfect FLAC, Dolby Atmos, ALAC, and MP3 without dedicated storage servers, cloud hosting fees, or audio transcoding.

---

## ✨ Features

- **Direct Lossless Streaming**: Streams audio directly from Telegram using HTTP 206 partial content range requests. No transcoding, no quality loss.
- **Dolby Atmos Support**: Automatic detection and streaming of spatial audio (`E-AC-3 JOC` in `.m4a` or `.ec3`).
- **Bot Pool Concurrency**: Distribute stream downloads across up to 20 Telegram bots (`TELEGRAM_BOT_TOKENS`) to prevent single-account bottlenecks and Telegram `FLOOD_WAIT` rate limits.
- **Built-in WebDAV Server**: Mount your library or stream from VLC, Symfonium, Kodi, or Apple Infuse via `/dav`.
- **Fast In-Memory Cache**: Sub-second search indexing and smart 6 MB pre-buffering with strict LRU memory limits (~36 MB RAM footprint).
- **Web Setup Wizard**: Interactive setup at `http://localhost:3000/setup` with mobile QR-code pairing.
- **Smart Deduplication**: Automatically keeps the highest-bitrate copy of a song while preserving both Stereo and Dolby Atmos mixes.
- **Channel Auto-Cleaner**: Automatically cleans text chatter and spam from your music channel.

---

## 🚀 Quick Start

### 1. Web Setup Wizard (Recommended)

1. Clone and install dependencies:
   ```bash
   git clone https://github.com/Imnotshashwat/Telegram-Music-Addon.git
   cd Telegram-Music-Addon
   npm install
   npm start
   ```
2. Open **`http://localhost:3000/setup`** in your browser.
3. Follow the 4-step wizard:
   - **Step 1:** Enter your Telegram `API_ID` & `API_HASH` (get them from [my.telegram.org](https://my.telegram.org)).
   - **Step 2:** Enter the login code sent to your Telegram app (and 2FA password if enabled).
   - **Step 3:** Select your private Telegram music channel and configure optional tunnel/bot settings.
   - **Step 4:** Scan the QR code or copy your **Addon URL** into BitChord.

*(Windows users can also download and run `install.bat` from Releases for automatic setup.)*

---

### 2. Manual Configuration (`.env`)

For headless servers, Docker, or Linux VPS:

1. Log in to Telegram and generate your session:
   ```bash
   npm run login
   ```
2. Copy `.env.example` to `.env` and fill in:
   ```env
   TELEGRAM_API_ID=1234567
   TELEGRAM_API_HASH=abcdef0123456789
   TELEGRAM_SESSION_STRING=1ApW...
   TELEGRAM_CHANNEL=-1001234567890
   URL_SECRET=mysecretkey123
   ```
3. Start the server:
   ```bash
   npm start
   ```

---

## 📱 Connecting Your Player

### BitChord (Android)
1. In BitChord, go to **Settings > Sources > Add Custom Source**.
2. Paste your Addon Manifest URL:
   ```text
   https://<your-domain-or-ip>:<port>/<URL_SECRET>/manifest.json
   ```
3. BitChord will automatically match your search queries with your Telegram library and stream FLAC/Atmos with priority.

### WebDAV Players (Symfonium, VLC, Kodi, Infuse)
1. Connect via WebDAV to:
   ```text
   https://<your-domain-or-ip>:<port>/<URL_SECRET>/dav
   ```
2. If prompted for credentials, use username `admin` and password `<URL_SECRET>`.

---

## 🤖 Scaling with Bot Pool (Multi-User Streaming)

By default, downloads run through your single user account session. If multiple listeners stream simultaneously or skip tracks rapidly, Telegram may rate-limit the account with `FLOOD_WAIT`.

You can configure a pool of up to 20 Telegram bots to handle download traffic:

1. **Create bots**: Message [@BotFather](https://t.me/BotFather) on Telegram and create your bots (`/newbot`).
2. **Add as Channel Admins**: Add each bot as an **Administrator** to your private Telegram channel (required for bots to access media in private channels).
3. **Configure Tokens**: Add the bot tokens as comma-separated values in your `.env`:
   ```env
   TELEGRAM_BOT_TOKENS=123456:ABC-DEF...,789012:GHI-JKL...,...
   ```
4. **Restart**: The server automatically balances audio streams across the least-busy bots (up to 4 streams per bot), isolated with per-bot caches and automatic flood cooldowns, falling back to your user account if the pool is busy.

---

## 🧹 Channel & Library Management

- **Uploading Tracks**: Upload audio files (`.flac`, `.mp3`, `.m4a`, `.wav`, `.opus`, `.ec3`) as **Files/Documents** or **Audio** directly into your private channel.
- **Smart Deduplication**: If a higher quality version (e.g. 24-bit FLAC) is uploaded for an existing track (e.g. MP3), the lower quality file is queued for removal after a 6-hour grace period.
- **Preserving Duplicates (`/keep`)**:
  - Add `/keep` in the caption when uploading to retain different versions (remixes, live cuts).
  - Or reply `/keep` to any track or duplicate warning message within 6 hours.
- **Dolby Atmos**: Both Stereo and Dolby Atmos mixes of the same song are always kept side-by-side automatically.

---

## 🔒 Security & Remote Access

- **URL Secret (`URL_SECRET`)**: Protects your server against unauthorized scanning. All API routes require `/<URL_SECRET>/` prefix except public health check `/ping`.
- **Remote Access (HTTPS)**: Android ExoPlayer requires HTTPS for network streaming.
  - **Cloudflare Tunnel (Built-in)**: Enable `ENABLE_CLOUDFLARE_TUNNEL=true` in `.env` for an automatic public `https://*.trycloudflare.com` URL without port forwarding.
  - **Tailscale Funnel**: Run `tailscale funnel 3000` for a persistent custom domain.
  - **Reverse Proxy**: Point Nginx or Caddy with SSL to your local port.

---

## ❓ Frequently Asked Questions (FAQs)

### Does Telegram compress or alter my audio files?
**No.** Audio uploaded as files or audio messages is stored and streamed byte-for-byte in its original lossless format (`FLAC`, `ALAC`, `WAV`, `E-AC-3`). The server uses HTTP 206 range requests to stream raw bytes directly.

### Can I use a public Telegram channel?
**No, always use a Private channel.** Public channels get indexed and are susceptible to copyright takedown notices. Private channels are restricted to you and your authorized bots.

### Why do I need a Bot Pool (`TELEGRAM_BOT_TOKENS`)?
Telegram limits single user accounts when fetching multiple large files concurrently. If 2 or more listeners stream high-resolution FLAC files simultaneously, or seek back-and-forth, Telegram can return a `FLOOD_WAIT` rate limit. A pool of bots balances these downloads across multiple accounts.

### Why must the bots be administrators in my channel?
Telegram privacy rules prevent bots from reading messages or accessing media in private channels unless they are added as **channel administrators**. Standard member bots cannot download private channel files.

### Do I need a Telegram Premium subscription?
**No.** Regular free Telegram accounts support files up to 2 GB each, which is more than enough for entire multi-disc lossless albums or high-bitrate Hi-Res tracks.

### Can I stream outside of my home Wi-Fi?
**Yes.** Use the built-in Cloudflare tunnel (`ENABLE_CLOUDFLARE_TUNNEL=true` in `.env`), Tailscale Funnel, or deploy the addon to a remote VPS / cloud host (Render, Fly.io, Railway, VPS).

### How much RAM and CPU does the server need?
Very little. The server uses an optimized in-memory metadata index and capped LRU cache (~36 MB RAM total). It runs smoothly on a Raspberry Pi, low-tier free cloud VPS, or even directly on an Android device via Termux.

### How does BitChord decide between Telegram and YouTube Music?
BitChord queries your addon, YouTube Music, and JioSaavn simultaneously. If a track exists in your Telegram library, BitChord prioritizes your local lossless FLAC / Atmos stream; otherwise, it falls back to streaming platforms.

---

## 📄 License & Disclaimer

- **Disclaimer**: Telegram Music Addon is a personal streaming utility. It does not host, provide, or distribute copyrighted media. It only indexes and streams audio stored in your personal private Telegram channel.
- **License**: [MIT](LICENSE)
