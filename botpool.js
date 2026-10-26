'use strict';

const { TelegramClient, utils } = require('telegram');
const { Logger } = require('telegram/extensions');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram/tl');

// ── Lightweight Capped LRU Cache for per-bot media objects ─────────────────
class BotLRU {
  constructor(maxSize = 500) {
    this.maxSize = maxSize;
    this.map = new Map();
  }

  get(key) {
    const k = String(key);
    if (!this.map.has(k)) return undefined;
    const val = this.map.get(k);
    this.map.delete(k);
    this.map.set(k, val);
    return val;
  }

  set(key, val) {
    const k = String(key);
    if (this.map.has(k)) {
      this.map.delete(k);
    } else if (this.map.size >= this.maxSize) {
      const oldestKey = this.map.keys().next().value;
      this.map.delete(oldestKey);
    }
    this.map.set(k, val);
  }

  has(key) {
    return this.map.has(String(key));
  }

  delete(key) {
    return this.map.delete(String(key));
  }

  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}

// ── Multi-strategy bot channel entity resolver ──────────────────────────────
/**
 * Resolves a channel entity specifically for a bot client.
 * Bots cannot call messages.getDialogs or use a user's accessHash.
 *
 * Strategies:
 * 1. Username lookup via contacts.ResolveUsername (public channels).
 * 2. Session entity cache check.
 * 3. updates.GetDifference to extract administered channels with bot accessHash.
 * 4. updates.GetState + updates.GetDifference pts offset.
 * 5. Fallback to channelRef entity object.
 */
async function resolveChannelForBot(client, channelRef) {
  if (!channelRef) return null;

  // 1. If channel has a username, resolve via username
  const username = typeof channelRef === 'string'
    ? (channelRef.startsWith('@') ? channelRef.slice(1) : (/^[a-zA-Z][a-zA-Z0-9_]{3,}$/.test(channelRef) ? channelRef : null))
    : (channelRef.username || null);

  if (username) {
    try {
      const entity = await client.getEntity(username);
      if (entity) return entity;
    } catch (_) {}
  }

  const rawId = typeof channelRef === 'object' && channelRef.id ? channelRef.id : channelRef;
  const normalizedId = String(rawId).replace(/^-100/, '').trim();

  // 2. Direct getEntity if already known in session
  try {
    const entity = await client.getEntity(channelRef);
    if (entity) return entity;
  } catch (_) {}

  // 3. For private channels: fetch bot update difference where bot was added as admin
  try {
    const diff = await client.invoke(new Api.updates.GetDifference({
      pts: 1,
      date: 0,
      qts: 0,
    }));
    const chats = diff?.chats || [];
    const matched = chats.find(c => String(c.id) === normalizedId || `-100${c.id}` === normalizedId);
    if (matched) return matched;
  } catch (_) {}

  // 4. Try getting current update state first, then getDifference with pts offset
  try {
    const state = await client.invoke(new Api.updates.GetState());
    if (state) {
      const diff = await client.invoke(new Api.updates.GetDifference({
        pts: Math.max(1, (state.pts || 1) - 1000),
        date: Math.max(0, (state.date || 0) - 86400 * 30),
        qts: 0,
      }));
      const chats = diff?.chats || [];
      const matched = chats.find(c => String(c.id) === normalizedId || `-100${c.id}` === normalizedId);
      if (matched) return matched;
    }
  } catch (_) {}

  // 5. Try getEntity once more after update entities are saved into session
  try {
    const entity = await client.getEntity(normalizedId);
    if (entity) return entity;
  } catch (_) {}

  try {
    const entity = await client.getEntity(`-100${normalizedId}`);
    if (entity) return entity;
  } catch (_) {}

  // 6. Direct fallback if channelRef is an entity object
  if (typeof channelRef === 'object' && channelRef) {
    return channelRef;
  }

  return null;
}

function parseTokens(input) {
  if (Array.isArray(input)) {
    return input.map(t => String(t).trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  }
  if (typeof input === 'string') {
    return input
      .split(',')
      .map(t => t.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }
  return [];
}

class BotPool {
  constructor(options = {}) {
    this.apiId = options.apiId || null;
    this.apiHash = options.apiHash || null;
    this.tokens = options.tokens || [];
    this.bots = [];
    this.channelRef = null;
  }

  /**
   * Initializes the pool of Telegram bot clients (up to 20).
   * For each token, starts a TelegramClient and resolves the channel entity.
   * If a bot fails to start or resolve the channel, logs a warning and skips it.
   */
  async init(channelRef) {
    this.channelRef = channelRef;

    // Disconnect any previously active bots on re-initialization
    for (const b of this.bots) {
      try {
        await b.client.disconnect();
      } catch (_) {}
    }
    this.bots = [];

    const rawTokens = this.tokens.length > 0
      ? this.tokens
      : (process.env.TELEGRAM_BOT_TOKENS || '');
    const tokens = parseTokens(rawTokens).slice(0, 20);

    if (tokens.length === 0) {
      return;
    }

    const apiId = this.apiId || parseInt(process.env.TELEGRAM_API_ID, 10);
    const apiHash = this.apiHash || process.env.TELEGRAM_API_HASH;

    if (!apiId || !apiHash) {
      console.warn('[BotPool] Cannot initialize: missing TELEGRAM_API_ID or TELEGRAM_API_HASH.');
      return;
    }

    console.log(`[BotPool] Initializing pool with ${tokens.length} bot token(s)...`);

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const botId = `bot${i + 1}`;
      try {
        const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
          connectionRetries: 5,
          autoReconnect: true,
          useWSS: process.env.USE_WSS !== 'false',
          baseLogger: new Logger('none'),
        });
        client.setLogLevel('none');

        await client.start({ botAuthToken: token });

        const channel = await resolveChannelForBot(client, channelRef);
        if (!channel) {
          throw new Error(`Failed to resolve channel for ${botId}`);
        }

        this.bots.push({
          id: botId,
          index: i + 1,
          token,
          client,
          channel,
          activeStreams: 0,
          cooldownUntil: 0,
          mediaCache: new BotLRU(500),
        });

        console.log(`[BotPool] ${botId} initialized and channel resolved.`);
      } catch (err) {
        console.warn(`[BotPool] Failed to initialize ${botId}: ${err.message}`);
      }
    }

    console.log(`[BotPool] Pool ready with ${this.bots.length}/${tokens.length} active bot(s).`);
  }

  /**
   * Returns the least-busy bot (max 4 concurrent streams each, skipping bots on cooldown)
   * as { bot, release }, or null if none are free.
   */
  acquire() {
    if (!this.bots || this.bots.length === 0) {
      return null;
    }

    const now = Date.now();
    let candidate = null;

    for (const bot of this.bots) {
      // Skip bots currently on flood cooldown
      if (bot.cooldownUntil && bot.cooldownUntil > now) {
        continue;
      }
      // Maximum 4 concurrent streams per bot
      if (bot.activeStreams >= 4) {
        continue;
      }

      if (!candidate || bot.activeStreams < candidate.activeStreams) {
        candidate = bot;
        if (candidate.activeStreams === 0) {
          break;
        }
      }
    }

    if (!candidate) {
      return null;
    }

    candidate.activeStreams++;
    let released = false;

    return {
      bot: candidate,
      release: () => {
        if (!released) {
          released = true;
          candidate.activeStreams = Math.max(0, candidate.activeStreams - 1);
        }
      },
    };
  }

  /**
   * Fetches msg.media for the given track using the specified bot.
   * Media objects are account-specific and cached in the bot's own LRU cache (~500 items).
   */
  async getMedia(bot, trackId, forceRefresh = false) {
    if (!bot || !bot.client || !trackId) return null;
    const key = String(trackId);
    const numId = parseInt(trackId, 10);
    if (isNaN(numId)) return null;

    if (!forceRefresh && bot.mediaCache.has(key)) {
      return bot.mediaCache.get(key);
    }

    try {
      const messages = await bot.client.getMessages(bot.channel, { ids: [numId] });
      const targetMsg = messages && messages.find(m => m && String(m.id) === key);
      if (targetMsg && targetMsg.media) {
        bot.mediaCache.set(key, targetMsg.media);
        return targetMsg.media;
      }
    } catch (err) {
      console.error(`[BotPool] ${bot.id} failed to get media for track ${trackId}:`, err.message);
      this.reportError(bot, err);
    }

    return null;
  }

  /**
   * Reports an error encountered by a bot. If FLOOD_WAIT_X is detected,
   * puts the bot on cooldown for X seconds.
   */
  reportError(bot, err) {
    if (!bot || !err) return;
    const msg = String(err.errorMessage || err.message || err);
    let seconds = 0;
    if (typeof err.seconds === 'number' && err.seconds > 0) {
      seconds = err.seconds;
    } else {
      const match = msg.match(/FLOOD_WAIT_(\d+)/i) || msg.match(/wait of (\d+)\s*seconds/i);
      if (match) {
        seconds = parseInt(match[1], 10);
      }
    }
    if (seconds > 0) {
      bot.cooldownUntil = Date.now() + (seconds * 1000);
      console.warn(`[BotPool] ${bot.id} hit FLOOD_WAIT_${seconds}. Put on cooldown for ${seconds}s.`);
    }
  }

  get size() {
    return this.bots.length;
  }
}

module.exports = { BotPool };
BotPool.BotPool = BotPool;
