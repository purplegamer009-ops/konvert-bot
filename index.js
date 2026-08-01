// =============================================================================
// Konvert Swap — NEAR Intents 1Click edition, chat-driven flow
//
// Input model: the conversation IS the form. Users type coins, amounts and
// addresses as normal chat messages inside their private ticket (dropdowns
// also work for coin picks). There are no popup forms, so nothing can be
// dismissed and no step is ever lost — all progress lives in the DB session
// and any message continues exactly where they left off.
//
// REQUIRES the "Message Content Intent" toggle in the Discord Developer
// Portal (Bot tab). Without it the bot cannot read ticket messages and
// login fails with "Used disallowed intents".
// =============================================================================

require('dotenv').config();

const {
  Client, GatewayIntentBits, Events, SlashCommandBuilder, EmbedBuilder,
  StringSelectMenuBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ChannelType, PermissionFlagsBits, MessageFlags, AttachmentBuilder,
} = require('discord.js');
const { Pool } = require('pg');
const crypto = require('crypto');
const QRCode = require('qrcode');

// ---------------------------------------------------------------- Environment

const REQUIRED_ENV = ['DISCORD_TOKEN', 'DATABASE_URL', 'OWNER_IDS'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key] || !process.env[key].trim()) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

function clampInt(raw, fallback, min, max) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const OWNER_IDS = new Set(process.env.OWNER_IDS.split(',').map((s) => s.trim()).filter(Boolean));

const ONECLICK_API_URL = (process.env.ONECLICK_API_URL || 'https://1click.chaindefuser.com').replace(/\/+$/, '');
const ONECLICK_JWT = (process.env.ONECLICK_JWT || '').trim();
const ONECLICK_FEE_RECIPIENT = (process.env.ONECLICK_FEE_RECIPIENT || '').trim();
const ONECLICK_FEE_BPS = clampInt(process.env.ONECLICK_FEE_BPS, 100, 0, 1000);
// Tiered pricing: swaps at/above the threshold get the lower bps. Set
// ONECLICK_FEE_BPS_HIGH_TIER equal to ONECLICK_FEE_BPS to disable tiering
// and go back to one flat rate.
const ONECLICK_FEE_TIER_THRESHOLD_USD = clampInt(process.env.ONECLICK_FEE_TIER_THRESHOLD_USD, 1000, 0, 10000000);
const ONECLICK_FEE_BPS_HIGH_TIER = clampInt(process.env.ONECLICK_FEE_BPS_HIGH_TIER, 50, 0, 1000);
const ONECLICK_SLIPPAGE_BPS = clampInt(process.env.ONECLICK_SLIPPAGE_BPS, 100, 10, 1000);
const ONECLICK_DEADLINE_MINUTES = clampInt(process.env.ONECLICK_DEADLINE_MINUTES, 60, 10, 180);
const FEE_CONFIGURED = Boolean(ONECLICK_FEE_RECIPIENT) && ONECLICK_FEE_BPS > 0;

// Hardcoded default so this works without any Railway configuration;
// still overridable via the env var if the log destination ever changes.
const AUDIT_LOG_CHANNEL_ID = (process.env.AUDIT_LOG_CHANNEL_ID || '').trim() || '1477233017029267466';
const TICKET_CATEGORY_NAME = process.env.TICKET_CATEGORY_NAME || 'Konvert Swap';
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID || null;

const POLL_INTERVAL_MS = 15_000;
const ORDER_EXPIRY_MS = 24 * 60 * 60 * 1000;
const EXPIRY_GRACE_MS = 10 * 60 * 1000;
const SESSION_STALE_MS = 30 * 60 * 1000;
const TICKET_CLOSE_GRACE_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
const TOKENS_CACHE_TTL_MS = 10 * 60 * 1000;

// The all-in Konvert-side fee percentage users pay (our fee + 1Click's 0.2%
// unauthenticated surcharge when no JWT is set). Used for the transparency
// line and savings math. Typical in-wallet swap cost used for comparison.
const OUR_FEE_PCT = (ONECLICK_FEE_BPS + (ONECLICK_JWT ? 0 : 20)) / 100;
const WALLET_SWAP_PCT = 3.5;

const EMBED_COLOR = 0x7c4dff;
const ERROR_COLOR = 0xe53e3e;
const OK_COLOR = 0x2ecc71;

if (!ONECLICK_JWT) console.warn('ONECLICK_JWT not set — 1Click adds its 0.2% unauthenticated fee per swap. Free key: partners.near-intents.org');
if (!FEE_CONFIGURED) console.warn('ONECLICK_FEE_RECIPIENT not set — swaps run at 0% Konvert fee until you set a NEAR account.');

// ------------------------------------------------------------- Curated coins

const CURATED_COINS = [
  // Dropdowns show the first 25; typing in chat reaches every coin that
  // 1Click actually lists (this table is filtered live against /v0/tokens).
  { label: 'Bitcoin (BTC)', blockchain: 'btc', symbols: ['BTC'] },
  { label: 'Ethereum (ETH)', blockchain: 'eth', symbols: ['ETH'] },
  { label: 'Solana (SOL)', blockchain: 'sol', symbols: ['SOL'] },
  { label: 'Litecoin (LTC)', blockchain: 'ltc', symbols: ['LTC'] },
  { label: 'USDT (Ethereum)', blockchain: 'eth', symbols: ['USDT'] },
  { label: 'USDC (Ethereum)', blockchain: 'eth', symbols: ['USDC'] },
  { label: 'USDT (BNB Chain)', blockchain: 'bsc', symbols: ['USDT'] },
  { label: 'USDC (Solana)', blockchain: 'sol', symbols: ['USDC'] },
  { label: 'USDT (Solana)', blockchain: 'sol', symbols: ['USDT'] },
  { label: 'USDT (Tron)', blockchain: 'tron', symbols: ['USDT'] },
  { label: 'Dogecoin (DOGE)', blockchain: 'doge', symbols: ['DOGE'] },
  { label: 'XRP (XRP)', blockchain: 'xrp', symbols: ['XRP'] },
  { label: 'BNB (BNB Chain)', blockchain: 'bsc', symbols: ['BNB'] },
  { label: 'TRX (Tron)', blockchain: 'tron', symbols: ['TRX'] },
  { label: 'TON (TON)', blockchain: 'ton', symbols: ['TON'] },
  { label: 'Cardano (ADA)', blockchain: 'cardano', symbols: ['ADA'] },
  { label: 'Avalanche (AVAX)', blockchain: 'avax', symbols: ['AVAX'] },
  { label: 'Polygon (POL)', blockchain: 'pol', symbols: ['POL', 'MATIC'] },
  { label: 'NEAR (NEAR)', blockchain: 'near', symbols: ['NEAR', 'wNEAR'] },
  { label: 'ETH (Base)', blockchain: 'base', symbols: ['ETH'] },
  { label: 'ETH (Arbitrum)', blockchain: 'arb', symbols: ['ETH'] },
  { label: 'Zcash (ZEC)', blockchain: 'zec', symbols: ['ZEC'] },
  { label: 'Stellar (XLM)', blockchain: 'stellar', symbols: ['XLM'] },
  { label: 'Sui (SUI)', blockchain: 'sui', symbols: ['SUI'] },
  { label: 'Aptos (APT)', blockchain: 'aptos', symbols: ['APT'] },
  { label: 'USDC (Base)', blockchain: 'base', symbols: ['USDC'] },
  { label: 'USDC (Arbitrum)', blockchain: 'arb', symbols: ['USDC'] },
  { label: 'DAI (Ethereum)', blockchain: 'eth', symbols: ['DAI'] },
  { label: 'LINK (Ethereum)', blockchain: 'eth', symbols: ['LINK'] },
  { label: 'UNI (Ethereum)', blockchain: 'eth', symbols: ['UNI'] },
  { label: 'AAVE (Ethereum)', blockchain: 'eth', symbols: ['AAVE'] },
  { label: 'SHIB (Ethereum)', blockchain: 'eth', symbols: ['SHIB'] },
  { label: 'PEPE (Ethereum)', blockchain: 'eth', symbols: ['PEPE'] },
  { label: 'Bitcoin Cash (BCH)', blockchain: 'bch', symbols: ['BCH'] },
  { label: 'ETH (Optimism)', blockchain: 'op', symbols: ['ETH'] },
  { label: 'Dash (DASH)', blockchain: 'dash', symbols: ['DASH'] },
  { label: 'Algorand (ALGO)', blockchain: 'algorand', symbols: ['ALGO'] },
  { label: 'Fantom (FTM)', blockchain: 'fantom', symbols: ['FTM'] },
  { label: 'Cronos (CRO)', blockchain: 'cronos', symbols: ['CRO'] },
  { label: 'Filecoin (FIL)', blockchain: 'filecoin', symbols: ['FIL'] },
  { label: 'Injective (INJ)', blockchain: 'injective', symbols: ['INJ'] },
  { label: 'Render (RENDER)', blockchain: 'sol', symbols: ['RENDER'] },
  { label: 'Jupiter (JUP)', blockchain: 'sol', symbols: ['JUP'] },
  { label: 'Wrapped BTC (Ethereum)', blockchain: 'eth', symbols: ['WBTC'] },
  { label: 'wstETH (Ethereum)', blockchain: 'eth', symbols: ['wstETH'] },
  { label: 'GMX (Arbitrum)', blockchain: 'arb', symbols: ['GMX'] },
  { label: 'USDT (Arbitrum)', blockchain: 'arb', symbols: ['USDT'] },
  { label: 'USDT (Avalanche)', blockchain: 'avax', symbols: ['USDT'] },
  { label: 'USDC (Avalanche)', blockchain: 'avax', symbols: ['USDC'] },
  { label: 'USDT (Polygon)', blockchain: 'pol', symbols: ['USDT'] },
  { label: 'USDC (Polygon)', blockchain: 'pol', symbols: ['USDC'] },
  { label: 'DAI (Base)', blockchain: 'base', symbols: ['DAI'] },
  { label: 'USDT (Base)', blockchain: 'base', symbols: ['USDT'] },
  { label: 'LINK (Arbitrum)', blockchain: 'arb', symbols: ['LINK'] },
  { label: 'UNI (Arbitrum)', blockchain: 'arb', symbols: ['UNI'] },
  { label: 'Wrapped ETH (Ethereum)', blockchain: 'eth', symbols: ['WETH'] },
  { label: 'Gnosis (GNO)', blockchain: 'gnosis', symbols: ['GNO'] },
  { label: 'USDC (Gnosis)', blockchain: 'gnosis', symbols: ['USDC'] },
  { label: 'ARB (Arbitrum)', blockchain: 'arb', symbols: ['ARB'] },
  { label: 'OP (Optimism)', blockchain: 'op', symbols: ['OP'] },
  { label: 'ONDO (Ethereum)', blockchain: 'eth', symbols: ['ONDO'] },
  { label: 'ENA (Ethereum)', blockchain: 'eth', symbols: ['ENA'] },
  { label: 'PYTH (Solana)', blockchain: 'sol', symbols: ['PYTH'] },
  { label: 'BONK (Solana)', blockchain: 'sol', symbols: ['BONK'] },
  { label: 'WIF (Solana)', blockchain: 'sol', symbols: ['WIF'] },
];

const EVM_BLOCKCHAINS = new Set(['eth', 'base', 'arb', 'bsc', 'gnosis', 'avax', 'op', 'pol']);

// One small visual icon per coin symbol in the picker dropdowns, so the
// list is scannable at a glance instead of a wall of text. These are
// standard Unicode emoji (Discord select menus render them natively) --
// not each coin's actual brand logo, which would need real image assets
// uploaded as custom server emojis. Unmapped symbols fall back to a plain
// coin icon rather than showing nothing.
const COIN_EMOJI = {
  BTC: '🟠', WBTC: '🟧', ETH: '💠', WETH: '💠', wstETH: '🔶',
  USDT: '🟢', USDC: '🔵', DAI: '🟨',
  SOL: '🟣', BONK: '🟣', WIF: '🟣', JUP: '🪐', RENDER: '🎨', PYTH: '🔮',
  LTC: '⚪', DOGE: '🐕', SHIB: '🦴', PEPE: '🐸',
  XRP: '💧', ZEC: '⬛', BNB: '🟡', TRX: '🔴',
  TON: '🔷', ADA: '🔹', AVAX: '🔺', POL: '🟪', MATIC: '🟪',
  ARB: '🌀', OP: '🟥', BASE: '🟦', GNO: '🦉',
  SUI: '🌊', APT: '🅰️', XLM: '⭐', BCH: '🟩', DASH: '➖',
  ALGO: '🔻', FTM: '👻', CRO: '⛓️', FIL: '📁', INJ: '⚡',
  GMX: '⚙️', LINK: '🔗', UNI: '🦄', AAVE: '🔮', ONDO: '🏦', ENA: '🌐',
  NEAR: '◼️',
};
const DEFAULT_COIN_EMOJI = '🪙';
function coinEmoji(symbol) {
  return COIN_EMOJI[symbol] || DEFAULT_COIN_EMOJI;
}

const CHAIN_NAMES = {
  btc: 'Bitcoin', eth: 'Ethereum', sol: 'Solana', ltc: 'Litecoin', doge: 'Dogecoin',
  xrp: 'XRP Ledger', zec: 'Zcash', bsc: 'BNB Chain', near: 'NEAR', base: 'Base',
  arb: 'Arbitrum', gnosis: 'Gnosis', op: 'Optimism', pol: 'Polygon', avax: 'Avalanche',
  tron: 'Tron', ton: 'TON', stellar: 'Stellar', cardano: 'Cardano', sui: 'Sui',
  aptos: 'Aptos', bch: 'Bitcoin Cash', dash: 'Dash', algorand: 'Algorand',
  fantom: 'Fantom', cronos: 'Cronos', filecoin: 'Filecoin', injective: 'Injective',
};

const CHAIN_ALIASES = {
  eth: ['eth', 'ethereum', 'erc20', 'erc-20'], bsc: ['bsc', 'bnb', 'bep20', 'bep-20', 'binance'],
  base: ['base'], sol: ['sol', 'solana'], btc: ['btc', 'bitcoin'], ltc: ['ltc', 'litecoin'],
  doge: ['doge', 'dogecoin'], xrp: ['xrp', 'ripple'], zec: ['zec', 'zcash'], near: ['near'],
  tron: ['tron', 'trx', 'trc20', 'trc-20'], ton: ['ton'], stellar: ['stellar', 'xlm'],
  cardano: ['cardano', 'ada'], avax: ['avax', 'avalanche'], pol: ['pol', 'polygon', 'matic'],
  arb: ['arb', 'arbitrum'], op: ['op', 'optimism'], sui: ['sui'], aptos: ['aptos', 'apt'],
  bch: ['bch', 'bitcoincash'], dash: ['dash'], algorand: ['algorand', 'algo'],
  fantom: ['fantom', 'ftm'], cronos: ['cronos', 'cro'], filecoin: ['filecoin', 'fil'],
  injective: ['injective', 'inj'], gnosis: ['gnosis', 'gno', 'xdai'],
};

// Native gas coin per chain — for the "you need X for the network fee" line
// when someone sends a TOKEN (USDC/USDT) rather than the chain's native coin.
const NATIVE_GAS = { eth: 'ETH', bsc: 'BNB', base: 'ETH', arb: 'ETH', op: 'ETH', sol: 'SOL', near: 'NEAR', tron: 'TRX', ton: 'TON', pol: 'POL', avax: 'AVAX', stellar: 'XLM', cardano: 'ADA', sui: 'SUI', aptos: 'APT', fantom: 'FTM', cronos: 'CRO', injective: 'INJ', gnosis: 'GNO' };

const EXPLORER_TX = {
  btc: 'https://mempool.space/tx/', ltc: 'https://litecoinspace.org/tx/',
  doge: 'https://blockchair.com/dogecoin/transaction/', eth: 'https://etherscan.io/tx/',
  base: 'https://basescan.org/tx/', bsc: 'https://bscscan.com/tx/',
  arb: 'https://arbiscan.io/tx/', sol: 'https://solscan.io/tx/',
  near: 'https://nearblocks.io/txns/', xrp: 'https://xrpscan.com/tx/',
  zec: 'https://blockchair.com/zcash/transaction/', gnosis: 'https://gnosisscan.io/tx/',
  tron: 'https://tronscan.org/#/transaction/', ton: 'https://tonviewer.com/transaction/',
  stellar: 'https://stellar.expert/explorer/public/tx/', cardano: 'https://cardanoscan.io/transaction/',
  avax: 'https://snowtrace.io/tx/', pol: 'https://polygonscan.com/tx/', op: 'https://optimistic.etherscan.io/tx/',
  sui: 'https://suiscan.xyz/mainnet/tx/', aptos: 'https://explorer.aptoslabs.com/txn/',
  dash: 'https://blockchair.com/dash/transaction/', algorand: 'https://allo.info/tx/',
  fantom: 'https://ftmscan.com/tx/', cronos: 'https://cronoscan.com/tx/',
  filecoin: 'https://filfox.info/en/message/', injective: 'https://explorer.injective.network/transaction/',
  bch: 'https://blockchair.com/bitcoin-cash/transaction/',
};

function explorerLink(blockchain, hash) {
  if (!hash) return null;
  const base = EXPLORER_TX[blockchain];
  const short = hash.length > 16 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash;
  return base ? `[\`${short}\`](${base}${hash})` : `\`${hash}\``;
}

// ------------------------------------------------------------ Token registry

let tokenCache = { list: [], byAssetId: new Map(), fetchedAt: 0 };

async function fetchOneClickTokens(force = false) {
  if (!force && Date.now() - tokenCache.fetchedAt < TOKENS_CACHE_TTL_MS && tokenCache.list.length > 0) return tokenCache;
  const list = await apiRequest('GET', '/v0/tokens');
  if (Array.isArray(list) && list.length > 0) {
    tokenCache = { list, byAssetId: new Map(list.map((t) => [t.assetId, t])), fetchedAt: Date.now() };
  }
  return tokenCache;
}

function tokenInfo(assetId) {
  return tokenCache.byAssetId.get(assetId) || null;
}

function buildMenuCoins() {
  const out = [];
  for (const c of CURATED_COINS) {
    const match = tokenCache.list.find((t) => t.blockchain === c.blockchain && c.symbols.includes(t.symbol));
    if (match) out.push({ label: c.label, assetId: match.assetId, decimals: match.decimals, blockchain: match.blockchain, symbol: match.symbol, price: match.price });
  }
  return out;
}

function assetDisplayName(assetId) {
  const m = buildMenuCoins().find((x) => x.assetId === assetId);
  if (m) return m.label;
  const t = tokenInfo(assetId);
  return t ? `${t.symbol} (${CHAIN_NAMES[t.blockchain] || t.blockchain})` : assetId;
}

function assetShort(assetId) {
  const t = tokenInfo(assetId);
  return t ? t.symbol : assetId;
}

// Match free text like "ltc", "usdt eth", "usdt on bnb chain", "eth base"
// against the curated menu. Returns { coin } | { options: [...] } | null.
function matchCoinText(input, menuCoins) {
  const words = String(input).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && w !== 'on' && w !== 'chain' && w !== 'network');
  if (words.length === 0 || words.length > 3) return null;
  const symbolWord = words[0];
  const candidates = menuCoins.filter((c) => c.symbol.toLowerCase() === symbolWord || (symbolWord === 'near' && c.blockchain === 'near'));
  if (candidates.length === 0) return null;
  if (candidates.length === 1 && words.length === 1) return { coin: candidates[0] };
  if (words.length >= 2) {
    const chainWord = words.slice(1).join('');
    const filtered = candidates.filter((c) => (CHAIN_ALIASES[c.blockchain] || [c.blockchain]).some((a) => a.replace(/[^a-z0-9]/g, '') === chainWord));
    if (filtered.length === 1) return { coin: filtered[0] };
  }
  if (candidates.length === 1) return { coin: candidates[0] };
  return { options: candidates };
}

// -------------------------------------------------------- Amount conversions

class InputError extends Error {}

function toBaseUnits(rawAmount, decimals) {
  const str = String(rawAmount).trim();
  if (!/^\d+(\.\d+)?$/.test(str)) throw new InputError(`"${rawAmount}" isn't a valid positive amount.`);
  const [whole, frac = ''] = str.split('.');
  const paddedFrac = (frac + '0'.repeat(decimals)).slice(0, decimals);
  const combined = `${whole}${paddedFrac}`.replace(/^0+(?=\d)/, '');
  const value = BigInt(combined || '0');
  if (value <= 0n) throw new InputError('Amount must be greater than zero.');
  return value;
}

// Display-only formatter: 1.39 not 1.399319391919. Never used for the
// copyable send amount — that stays full precision to avoid underpays.
function fmt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (n === 0) return '0';
  const abs = Math.abs(n);
  let s;
  if (abs >= 1000) s = n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  else if (abs >= 1) {
    // Truncate, never round up: 1.399 shows as 1.39 (matches what they'd
    // actually receive; rounding up would overstate).
    const t = n.toFixed(4);
    s = t.slice(0, t.indexOf('.') + 3);
  } else s = n.toPrecision(4);
  if (s.includes('e')) s = n.toFixed(10);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s || '0';
}

function fromBaseUnits(value, decimals) {
  const v = BigInt(value);
  const str = v.toString().padStart(decimals + 1, '0');
  const whole = str.slice(0, -decimals).replace(/^0+(?=\d)/, '') || '0';
  const frac = decimals > 0 ? str.slice(-decimals).replace(/0+$/, '') : '';
  return frac ? `${whole}.${frac}` : whole;
}

// Accepts "0.05", "$50", "50$", "50 usd", "1,250.50", "50usd".
// USD inputs are converted using the token's live price from /v0/tokens.
// Returns { amountBase, display, usdEstimate } or throws InputError.
// USD-only input: every plain number typed here is dollars, never a coin
// amount ("5" means $5, not 5 of the coin) -- this removes the older dual
// coin-or-dollar mode entirely, per an explicit product decision to keep
// the amount step to one unambiguous unit.
function parseAmountInput(raw, token) {
  let s = String(raw).trim().toLowerCase().replace(/,/g, '');
  if (s.startsWith('$')) s = s.slice(1);
  if (s.endsWith('$')) s = s.slice(0, -1);
  if (s.endsWith('usd')) s = s.slice(0, -3);
  s = s.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new InputError('Type a dollar amount, like `50` or `$50`.');
  }
  const usdEstimate = parseFloat(s);
  if (!(usdEstimate > 0)) throw new InputError('Amount must be greater than zero.');
  if (usdEstimate > 1_000_000_000) throw new InputError('That amount looks too large — double-check it.');
  if (usdEstimate < 1) throw new InputError('That is under $1 — network fees would eat most of it. Try at least a few dollars.');

  const price = Number(token.price);
  if (!Number.isFinite(price) || price <= 0) {
    throw new InputError(`No live price available for ${token.symbol} right now — please try again in a moment.`);
  }
  // Pad by 1%: prices drift between typing and sending, and a hair under
  // the quote stalls the swap. With FLEX_INPUT the small extra simply
  // swaps too, so the client loses nothing and skips the top-up wait.
  const USD_PAD = 1.01;
  const coinAmount = (usdEstimate / price) * USD_PAD;
  const coinAmountStr = coinAmount.toFixed(Math.min(8, token.decimals)).replace(/0+$/, '').replace(/\.$/, '');
  if (!/^\d+(\.\d+)?$/.test(coinAmountStr) || parseFloat(coinAmountStr) <= 0) {
    throw new InputError('That dollar amount is too small for this coin.');
  }
  const amountBase = toBaseUnits(coinAmountStr, token.decimals);
  return { amountBase, display: fromBaseUnits(amountBase, token.decimals), usdEstimate };
}

// ---------------------------------------------------- Per-chain address check

const ADDRESS_PATTERNS = {
  sol: { re: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, hint: 'Solana addresses are 32-44 letters/numbers with no 0, O, I or l.' },
  btc: { re: /^(bc1[a-z0-9]{20,80}|[13][a-km-zA-HJ-NP-Z1-9]{25,39})$/, hint: 'Bitcoin addresses start with bc1, 1 or 3.' },
  ltc: { re: /^(ltc1[a-z0-9]{20,80}|[LM3][a-km-zA-HJ-NP-Z1-9]{25,39})$/, hint: 'Litecoin addresses start with ltc1, L or M.' },
  doge: { re: /^D[a-km-zA-HJ-NP-Z1-9]{25,39}$/, hint: 'Dogecoin addresses start with D.' },
  xrp: { re: /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/, hint: 'XRP addresses start with r.' },
  near: { re: /^([a-z0-9][a-z0-9_-]{1,63}\.near|[a-f0-9]{64})$/, hint: 'NEAR addresses look like name.near or 64 hex characters.' },
  zec: { re: /^t[13][a-km-zA-HJ-NP-Z1-9]{25,39}$/, hint: 'Use a transparent Zcash address (starts with t1 or t3) — shielded addresses are not supported.' },
  tron: { re: /^T[1-9A-HJ-NP-Za-km-z]{33}$/, hint: 'Tron addresses start with T and are 34 characters.' },
  stellar: { re: /^G[A-Z2-7]{55}$/, hint: 'Stellar addresses start with G and are 56 characters.' },
  cardano: { re: /^addr1[a-z0-9]{50,110}$/, hint: 'Cardano addresses start with addr1.' },
  sui: { re: /^0x[a-fA-F0-9]{64}$/, hint: 'Sui addresses are 0x followed by 64 characters.' },
  aptos: { re: /^0x[a-fA-F0-9]{1,64}$/, hint: 'Aptos addresses are 0x followed by up to 64 characters.' },
  bch: { re: /^((bitcoincash:)?[qp][a-z0-9]{41}|[13][a-km-zA-HJ-NP-Z1-9]{25,39})$/, hint: 'Bitcoin Cash addresses start with q, p, or bitcoincash:.' },
};

// Well-known, genuinely valid-shaped addresses per chain, used ONLY to
// probe 1Click for a route's real live minimum before anyone has entered
// their own address yet. Never used for an actual swap.
// A per-user override (set via /swapfee) always wins over the standard
// tiered pricing -- checked first, before anything else. 0 is a fully
// valid, fully achievable override (1Click simply omits appFees entirely
// when the rate is 0, so a genuine 0% fee needs no special protocol
// support -- it's just "don't attach a fee").
// Priority: a specific person's own override (set via /swapfee) always
// wins first -- a VIP rate shouldn't get clobbered by a broad promo. Next,
// a global override (set via /swapfeeall, e.g. "free for the weekend")
// applies to everyone who doesn't have their own personal rate. Only then
// does normal tiered pricing apply.
async function pickFeeBps(originAssetId, amountBase, discordUserId) {
  if (discordUserId) {
    const override = await getFeeOverride(discordUserId);
    if (override !== null) return override;
  }
  const globalOverrideRaw = await getSetting('global_fee_override_bps');
  if (globalOverrideRaw !== null) {
    // Checked here too (not just by the periodic cleanup) so an expired
    // timed promo stops applying at the exact moment it lapses, not
    // whenever the next cleanup cycle happens to run.
    const expiresAtRaw = await getSetting('global_fee_override_expires_at');
    if (!expiresAtRaw || Date.now() < parseInt(expiresAtRaw, 10)) {
      return parseInt(globalOverrideRaw, 10);
    }
  }
  if (!FEE_CONFIGURED) return 0;
  const token = tokenInfo(originAssetId);
  const price = token ? Number(token.price) : NaN;
  if (!token || !Number.isFinite(price)) return ONECLICK_FEE_BPS;
  const estUsd = price * Number(fromBaseUnits(amountBase, token.decimals));
  return estUsd >= ONECLICK_FEE_TIER_THRESHOLD_USD ? ONECLICK_FEE_BPS_HIGH_TIER : ONECLICK_FEE_BPS;
}

// Belt-and-suspenders cleanup: tidies the settings table once a timed
// override lapses, so /swapstats and similar don't show a stale "active"
// promo. pickFeeBps above is what actually enforces the cutoff in real
// time; this just keeps the stored state honest.
async function maybeExpireGlobalFeeOverride() {
  const expiresAtRaw = await getSetting('global_fee_override_expires_at');
  if (!expiresAtRaw) return;
  if (Date.now() >= parseInt(expiresAtRaw, 10)) {
    await pool.query(`DELETE FROM konvert_swap_settings WHERE key IN ('global_fee_override_bps', 'global_fee_override_expires_at')`);
  }
}

// Per-order equivalent of OUR_FEE_PCT, for accurate savings messaging on a
// specific already-priced order (order.affiliate_fee_bps is the real rate
// that was actually charged, not the global default).
function orderFeePct(order) {
  const bps = Number(order.affiliate_fee_bps) || 0;
  return (bps + (ONECLICK_JWT ? 0 : 20)) / 100;
}

function validateAddressForChain(blockchain, address) {
  const a = String(address).trim();
  if (!a || /\s/.test(a) || a.length > 128) {
    return { ok: false, hint: 'That does not look like a wallet address.' };
  }
  if (EVM_BLOCKCHAINS.has(blockchain)) {
    return /^0x[a-fA-F0-9]{40}$/.test(a)
      ? { ok: true }
      : { ok: false, hint: `Addresses on ${CHAIN_NAMES[blockchain] || blockchain} start with 0x followed by 40 characters.` };
  }
  const p = ADDRESS_PATTERNS[blockchain];
  // Chain-specific patterns own their own length rules (NEAR names can be
  // as short as "ab.near"); the generic floor applies only to chains we
  // have no pattern for.
  if (p) return p.re.test(a) ? { ok: true } : { ok: false, hint: p.hint };
  if (a.length < 15) return { ok: false, hint: 'That does not look like a wallet address.' };
  return { ok: true };
}

// --------------------------------------------------------------- Fee savings

function computeSavingsUsd(amountUsd, feePct = OUR_FEE_PCT) {
  const usd = Number(amountUsd);
  if (!Number.isFinite(usd) || usd <= 0) return null;
  const savings = (usd * (WALLET_SWAP_PCT - feePct)) / 100;
  return savings > 0.005 ? savings : null;
}

function savingsLine(amountUsd, feePct = OUR_FEE_PCT) {
  const s = computeSavingsUsd(amountUsd, feePct);
  return s ? `≈ $${s.toFixed(2)} saved vs typical wallet swap fees` : null;
}

// Splits the visible USD gap between our fee and market spread so nothing
// looks hidden. On tiny swaps, fixed costs weigh more — say so.
function costBreakdown(amountInUsd, amountOutUsd, realFeePct = OUR_FEE_PCT) {
  const inU = Number(amountInUsd), outU = Number(amountOutUsd);
  if (!Number.isFinite(inU) || !Number.isFinite(outU) || inU <= 0 || outU <= 0) return null;
  const totalPct = Math.max(0, (1 - outU / inU) * 100);
  const feePct = Math.min(realFeePct, totalPct);
  const spreadPct = Math.max(0, totalPct - feePct);
  return {
    feePct: feePct.toFixed(2).replace(/\.?0+$/, ''),
    spreadPct: spreadPct.toFixed(2).replace(/\.?0+$/, ''),
    tinyNote: inU < 20 ? '_Small swaps feel spread more — fixed market costs are a bigger slice of tiny amounts._' : null,
  };
}

// ------------------------------------------------------------- 1Click client

class OneClickApiError extends Error {
  constructor(message, body) { super(message); this.name = 'OneClickApiError'; this.body = body; }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function apiRequest(method, path, { params = {}, body = null } = {}) {
  const url = new URL(ONECLICK_API_URL + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  const headers = { 'Content-Type': 'application/json' };
  if (ONECLICK_JWT) headers['Authorization'] = `Bearer ${ONECLICK_JWT}`;

  const maxAttempts = 3;
  let timeoutStrikes = 0;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res;
    try {
      res = await fetch(url.toString(), {
        method, headers, body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (networkErr) {
      lastErr = networkErr;
      if (networkErr && networkErr.name === 'TimeoutError') {
        timeoutStrikes++;
        if (timeoutStrikes >= 2) break;
        continue;
      }
      await sleep(300 * attempt);
      continue;
    }
    if (res.status === 429 || res.status === 503) {
      lastErr = new Error(`1Click API returned ${res.status}`);
      await sleep(500 * attempt * attempt);
      continue;
    }
    const text = await res.text();
    let parsed;
    try { parsed = text ? JSON.parse(text) : {}; }
    catch { throw new Error(`1Click API returned non-JSON (status ${res.status}): ${text.slice(0, 200)}`); }
    if (!res.ok) {
      const message = parsed?.message || parsed?.error || `1Click API error (status ${res.status})`;
      throw new OneClickApiError(Array.isArray(message) ? message.join('; ') : String(message), parsed);
    }
    return parsed;
  }
  throw lastErr || new Error('1Click API request failed after retries');
}

async function getOneClickQuote({ dry, originAssetId, destinationAssetId, amountBase, recipient, refundTo, discordUserId }) {
  const body = {
    // FLEX_INPUT: whatever actually arrives gets swapped — overpays are
    // converted too (more out), small underpays within slippage still
    // process, and big underpays refund by deadline. EXACT_INPUT would
    // instead swap only the quoted amount and refund any excess.
    dry: Boolean(dry), swapType: 'FLEX_INPUT', slippageTolerance: ONECLICK_SLIPPAGE_BPS,
    originAsset: originAssetId, depositType: 'ORIGIN_CHAIN', destinationAsset: destinationAssetId,
    amount: amountBase.toString(), recipient, recipientType: 'DESTINATION_CHAIN',
    refundTo, refundType: 'ORIGIN_CHAIN',
    deadline: new Date(Date.now() + ONECLICK_DEADLINE_MINUTES * 60 * 1000).toISOString(),
    quoteWaitingTimeMs: 3000,
  };
  const effectiveFeeBps = await pickFeeBps(originAssetId, amountBase, discordUserId);
  if (FEE_CONFIGURED && effectiveFeeBps > 0) body.appFees = [{ recipient: ONECLICK_FEE_RECIPIENT, fee: effectiveFeeBps }];
  const res = await apiRequest('POST', '/v0/quote', { body });
  const quote = res && res.quote ? res.quote : res;
  if (!quote || (!dry && !quote.depositAddress)) throw new OneClickApiError('1Click returned an incomplete quote.', res);
  return { ...quote, appliedFeeBps: effectiveFeeBps };
}

async function getSwapStatus(depositAddress, depositMemo) {
  const params = { depositAddress };
  if (depositMemo) params.depositMemo = depositMemo;
  return apiRequest('GET', '/v0/status', { params });
}

const ONECLICK_STATUSES = new Set(['PENDING_DEPOSIT', 'KNOWN_DEPOSIT_TX', 'PROCESSING', 'SUCCESS', 'INCOMPLETE_DEPOSIT', 'REFUNDED', 'FAILED']);
function mapOneClickStatus(current, apiStatus) { return ONECLICK_STATUSES.has(apiStatus) ? apiStatus : current; }

// 1Click may grant a longer deposit window (days) than we want; enforce
// the shorter of theirs and ours so orders resolve fast.
function effectiveDeadline(apiDeadlineIso, minutes) {
  const ours = new Date(Date.now() + minutes * 60 * 1000);
  if (!apiDeadlineIso) return ours;
  const theirs = new Date(apiDeadlineIso);
  return Number.isFinite(theirs.getTime()) && theirs < ours ? theirs : ours;
}

function firstHash(value) {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    if (typeof item === 'string' && item) return item;
    if (item && typeof item === 'object' && typeof item.hash === 'string' && item.hash) return item.hash;
  }
  return null;
}

// Never relay 1Click's raw error text for an amount-too-low error: the
// server-side message can embed a base-unit number (e.g. satoshis for BTC),
// and showing that unconverted produces nonsense like "minimum is 292929
// BTC". Convert it correctly when we have real data; otherwise give a safe,
// number-free message rather than risk showing a wrong figure.
function describeError(err, originToken) {
  if (err instanceof InputError) return err.message;
  if (err instanceof OneClickApiError) {
    const looksLikeAmountTooLow = /minimum|min amount|too low|too small|below.*required|minAmountIn/i.test(err.message);
    if (looksLikeAmountTooLow) {
      const rawMin = err.body?.minAmountIn ?? err.body?.quote?.minAmountIn;
      if (originToken && rawMin != null && Number.isFinite(Number(rawMin))) {
        try {
          const minCoin = fromBaseUnits(rawMin, originToken.decimals);
          const minDisplay = fmt(minCoin);
          const price = Number(originToken.price);
          const usdNote = Number.isFinite(price) ? ` (about $${(parseFloat(minCoin) * price).toFixed(2)})` : '';
          return `That's below ${originToken.symbol}'s minimum right now — try at least ${minDisplay} ${originToken.symbol}${usdNote}.`;
        } catch { /* fall through to the safe generic message below */ }
      }
      return `That amount is too small for this coin right now — try sending a bit more.`;
    }
    return `The swap service said: ${err.message}`;
  }
  console.error(err);
  return "Couldn't reach the swap service just now — that's usually temporary. Try again in a moment.";
}

function formatBps(bps) {
  const n = Number(bps);
  return Number.isFinite(n) ? `${(n / 100).toFixed(2).replace(/\.?0+$/, '')}%` : 'unavailable';
}

// ------------------------------------------------------------------ Database

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
});
pool.on('error', (err) => console.error('Postgres pool background error (recovered automatically):', err.message));

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS konvert_swap_orders (
      order_id UUID PRIMARY KEY,
      discord_user_id TEXT NOT NULL,
      channel_id TEXT,
      send_asset TEXT NOT NULL,
      receive_asset TEXT NOT NULL,
      send_amount NUMERIC NOT NULL,
      expected_receive_amount NUMERIC NOT NULL,
      actual_receive_amount NUMERIC,
      amount_in_usd NUMERIC,
      deposit_address TEXT NOT NULL,
      memo TEXT,
      destination_address TEXT NOT NULL,
      affiliate_fee_bps INTEGER NOT NULL,
      fee_applied BOOLEAN NOT NULL DEFAULT true,
      refund_address TEXT,
      refund_requested BOOLEAN NOT NULL DEFAULT false,
      status TEXT NOT NULL DEFAULT 'PENDING_DEPOSIT',
      quote_expires_at TIMESTAMPTZ NOT NULL,
      inbound_txid TEXT,
      outbound_txid TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at TIMESTAMPTZ,
      last_polled_at TIMESTAMPTZ,
      last_notified_status TEXT,
      ticket_closed BOOLEAN NOT NULL DEFAULT false,
      status_message_id TEXT
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_konvert_swap_status ON konvert_swap_orders (status);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_konvert_swap_user ON konvert_swap_orders (discord_user_id);`);
  await pool.query(`ALTER TABLE konvert_swap_orders ADD COLUMN IF NOT EXISTS channel_id TEXT;`);
  await pool.query(`ALTER TABLE konvert_swap_orders ADD COLUMN IF NOT EXISTS ticket_closed BOOLEAN NOT NULL DEFAULT false;`);
  await pool.query(`ALTER TABLE konvert_swap_orders ADD COLUMN IF NOT EXISTS fee_applied BOOLEAN NOT NULL DEFAULT true;`);
  await pool.query(`ALTER TABLE konvert_swap_orders ADD COLUMN IF NOT EXISTS refund_address TEXT;`);
  await pool.query(`ALTER TABLE konvert_swap_orders ADD COLUMN IF NOT EXISTS amount_in_usd NUMERIC;`);
  await pool.query(`ALTER TABLE konvert_swap_orders ADD COLUMN IF NOT EXISTS refund_requested BOOLEAN NOT NULL DEFAULT false;`);
  await pool.query(`ALTER TABLE konvert_swap_orders ADD COLUMN IF NOT EXISTS status_message_id TEXT;`);
  await pool.query(`ALTER TABLE konvert_swap_orders ALTER COLUMN memo DROP NOT NULL;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS konvert_swap_sessions (
      channel_id TEXT PRIMARY KEY,
      discord_user_id TEXT NOT NULL,
      step TEXT NOT NULL DEFAULT 'AWAITING_SEND_COIN',
      send_asset TEXT,
      receive_asset TEXT,
      amount_display TEXT,
      amount_1e8 NUMERIC,
      destination_address TEXT,
      refund_address TEXT,
      fee_message_id TEXT,
      quote_snapshot JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`ALTER TABLE konvert_swap_sessions ADD COLUMN IF NOT EXISTS fee_message_id TEXT;`);

  await pool.query(`CREATE TABLE IF NOT EXISTS konvert_swap_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  await pool.query(`INSERT INTO konvert_swap_settings (key, value) VALUES ('enabled', 'true') ON CONFLICT (key) DO NOTHING;`);

  // One saved address per user per blockchain -- saving a new one for a
  // chain replaces the old one, keeping this simple (their "usual" address
  // per chain, not a full address book to manage).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS konvert_swap_fee_overrides (
      discord_user_id TEXT PRIMARY KEY,
      fee_bps          INTEGER NOT NULL,
      set_by            TEXT NOT NULL,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS konvert_swap_user_prefs (
      discord_user_id      TEXT PRIMARY KEY,
      auto_save_addresses  BOOLEAN NOT NULL DEFAULT true
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS konvert_swap_saved_addresses (
      discord_user_id TEXT NOT NULL,
      blockchain       TEXT NOT NULL,
      address           TEXT NOT NULL,
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (discord_user_id, blockchain)
    );
  `);
}

// (amount_1e8 stores base units in the origin token's own decimals.)

async function insertOrder(o) {
  const result = await pool.query(
    `INSERT INTO konvert_swap_orders (
       order_id, discord_user_id, channel_id, send_asset, receive_asset, send_amount,
       expected_receive_amount, amount_in_usd, deposit_address, memo, destination_address,
       affiliate_fee_bps, fee_applied, refund_address, status, quote_expires_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'PENDING_DEPOSIT',$15)
     RETURNING *`,
    [
      o.orderId, o.discordUserId, o.channelId, o.sendAsset, o.receiveAsset, o.sendAmount,
      o.expectedReceiveAmount, o.amountInUsd || null, o.depositAddress, o.memo || null, o.destinationAddress,
      o.affiliateFeeBps, o.feeApplied !== false, o.refundAddress || null, o.quoteExpiresAt,
    ]
  );
  return result.rows[0];
}

async function getOrderById(orderId) {
  const r = await pool.query(`SELECT * FROM konvert_swap_orders WHERE order_id = $1`, [orderId]);
  return r.rows[0] || null;
}

async function getOrderByDepositAddress(depositAddress) {
  const r = await pool.query(`SELECT * FROM konvert_swap_orders WHERE deposit_address = $1 ORDER BY created_at DESC LIMIT 1`, [depositAddress]);
  return r.rows[0] || null;
}

async function getUserHistory(discordUserId, limit = 5) {
  const r = await pool.query(`SELECT * FROM konvert_swap_orders WHERE discord_user_id = $1 ORDER BY created_at DESC LIMIT $2`, [discordUserId, limit]);
  return r.rows;
}

const ACTIVE_STATUSES = `('PENDING_DEPOSIT', 'KNOWN_DEPOSIT_TX', 'PROCESSING', 'INCOMPLETE_DEPOSIT')`;

async function getActiveOrders() {
  // EXPIRED stays in the polling set (until the 24h cap): our window is
  // shorter than the escrow's, so a late deposit can still complete — the
  // poll flips EXPIRED to the real status and the user gets notified.
  const r = await pool.query(`SELECT * FROM konvert_swap_orders WHERE status IN ('PENDING_DEPOSIT', 'KNOWN_DEPOSIT_TX', 'PROCESSING', 'INCOMPLETE_DEPOSIT', 'EXPIRED')`);
  return r.rows;
}

async function getOpenOrderChannelForUser(discordUserId) {
  const r = await pool.query(
    `SELECT channel_id FROM konvert_swap_orders
     WHERE discord_user_id = $1 AND ticket_closed = false AND channel_id IS NOT NULL AND status IN ${ACTIVE_STATUSES}
     ORDER BY created_at DESC LIMIT 1`, [discordUserId]);
  return r.rows[0]?.channel_id || null;
}

async function getLiveOrderForChannel(channelId) {
  const r = await pool.query(`SELECT * FROM konvert_swap_orders WHERE channel_id = $1 AND status IN ${ACTIVE_STATUSES} LIMIT 1`, [channelId]);
  return r.rows[0] || null;
}

// SET clauses built from hardcoded keys only — never user-supplied names.
async function updateOrderStatus(orderId, fields) {
  const setClauses = []; const values = []; let i = 1;
  for (const [key, value] of Object.entries(fields)) { setClauses.push(`${key} = $${i}`); values.push(value); i++; }
  values.push(orderId);
  const r = await pool.query(`UPDATE konvert_swap_orders SET ${setClauses.join(', ')} WHERE order_id = $${i} RETURNING *`, values);
  return r.rows[0];
}

async function markTicketClosed(orderId) {
  await pool.query(`UPDATE konvert_swap_orders SET ticket_closed = true WHERE order_id = $1`, [orderId]);
}

async function getBiggestSwap() {
  const r = await pool.query(
    `SELECT * FROM konvert_swap_orders WHERE status = 'SUCCESS' AND amount_in_usd IS NOT NULL
     ORDER BY amount_in_usd DESC LIMIT 1`
  );
  return r.rows[0] || null;
}

async function isNewRecord(order) {
  if (!Number.isFinite(Number(order.amount_in_usd))) return false;
  const r = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE order_id <> $1) AS other_count,
       COUNT(*) FILTER (WHERE order_id <> $1 AND amount_in_usd >= $2) AS higher_count
     FROM konvert_swap_orders WHERE status = 'SUCCESS'`,
    [order.order_id, order.amount_in_usd]
  );
  const row = r.rows[0];
  if (parseInt(row.other_count, 10) === 0) return false; // first-ever swap: no fanfare, just the baseline
  return parseInt(row.higher_count, 10) === 0;
}

function buildRecordEmbed(order) {
  const lines = [
    `**${fmt(order.send_amount)} ${assetShort(order.send_asset)} → ${fmt(order.actual_receive_amount || order.expected_receive_amount)} ${assetShort(order.receive_asset)}**`,
    `$${Number(order.amount_in_usd).toFixed(2)}`,
  ];
  return brand(new EmbedBuilder().setColor(EMBED_COLOR).setTitle('🏆 Biggest Swap Ever').setDescription(lines.join('\n'))
    .addFields(
      { name: 'Client', value: `<@${order.discord_user_id}>`, inline: true },
      { name: 'Date', value: order.completed_at ? `<t:${Math.floor(new Date(order.completed_at).getTime() / 1000)}:D>` : '—', inline: true },
    ).setTimestamp());
}

async function announceNewRecord(order) {
  const feedChannelId = await getSetting('feed_channel_id');
  if (!feedChannelId) return;
  const channel = await discordClient.channels.fetch(feedChannelId).catch(() => null);
  if (!channel) return;
  const embed = brand(new EmbedBuilder().setColor(EMBED_COLOR).setTitle('🏆 New Biggest Swap!')
    .setDescription(`<@${order.discord_user_id}> just set a new record — **$${Number(order.amount_in_usd).toFixed(2)}**\n${fmt(order.send_amount)} ${assetShort(order.send_asset)} → ${fmt(order.actual_receive_amount || order.expected_receive_amount)} ${assetShort(order.receive_asset)}`)
    .setTimestamp());
  await channel.send({ embeds: [embed] }).catch(() => {});
}

async function checkAndAnnounceRecord(order) {
  if (await isNewRecord(order)) await announceNewRecord(order);
}

// Matches the existing "Total Exchanged: $254K" style exactly: whole
// numbers, K for thousands, M (one decimal) once past a million.
function formatVolumeShort(usd) {
  const n = Number(usd) || 0;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `$${Math.round(n / 1000)}K`;
  return `$${Math.round(n)}`;
}

// Discord hard-limits channel renames to 2 per 10 minutes, platform-wide,
// specifically to stop this exact "channel name as a live stat" pattern
// from being spammed. This throttle keeps updates to once per 10 minutes
// -- comfortably under that cap -- rather than firing on every swap, which
// would get rejected outright once volume changed twice in a row.
const STATS_CHANNEL_UPDATE_INTERVAL_MS = 10 * 60 * 1000;

async function maybeUpdateStatsChannel(force) {
  const channelId = await getSetting('stats_channel_id');
  if (!channelId) return;
  if (!force) {
    const last = await getSetting('stats_channel_last_update');
    if (last && Date.now() - parseInt(last, 10) < STATS_CHANNEL_UPDATE_INTERVAL_MS) return;
  }
  try {
    const stats = await getStats();
    const label = `Total Swapped: ${formatVolumeShort(Number(stats.usdVolume))}`;
    const channel = await discordClient.channels.fetch(channelId);
    if (channel && channel.name !== label) await channel.setName(label);
    await setSetting('stats_channel_last_update', String(Date.now()));
  } catch (err) {
    console.error('Stats channel update failed:', err.message);
  }
}

async function getStats() {
  const totals = await pool.query(`
    SELECT COUNT(*) FILTER (WHERE status = 'SUCCESS') AS completed_swaps,
           COUNT(*) FILTER (WHERE status = 'SUCCESS' AND fee_applied = false) AS zero_fee_swaps,
           COALESCE(SUM(amount_in_usd) FILTER (WHERE status = 'SUCCESS'), 0) AS usd_volume,
           COALESCE(SUM(amount_in_usd * affiliate_fee_bps / 20000.0) FILTER (WHERE status = 'SUCCESS' AND fee_applied = true), 0) AS net_fees_usd,
           COUNT(*) AS total_orders
    FROM konvert_swap_orders`);
  const volumeByAsset = await pool.query(`
    SELECT send_asset, COUNT(*) AS swaps, SUM(send_amount) AS total_volume,
           COALESCE(SUM(amount_in_usd), 0) AS usd_volume,
           COALESCE(SUM(amount_in_usd * affiliate_fee_bps / 20000.0) FILTER (WHERE fee_applied = true), 0) AS fee_revenue_usd
    FROM konvert_swap_orders WHERE status = 'SUCCESS' GROUP BY send_asset ORDER BY fee_revenue_usd DESC`);
  return {
    completedSwaps: parseInt(totals.rows[0].completed_swaps, 10),
    zeroFeeSwaps: parseInt(totals.rows[0].zero_fee_swaps, 10),
    usdVolume: totals.rows[0].usd_volume,
    netFeesUsd: totals.rows[0].net_fees_usd,
    totalOrders: parseInt(totals.rows[0].total_orders, 10),
    volumeByAsset: volumeByAsset.rows,
  };
}

// A user's fee override, if any. 0 is a fully valid override (genuine 0%),
// so callers must check `!== null`, never treat the return value as truthy.
async function getFeeOverride(discordUserId) {
  const r = await pool.query(`SELECT fee_bps FROM konvert_swap_fee_overrides WHERE discord_user_id = $1`, [discordUserId]);
  return r.rows.length ? r.rows[0].fee_bps : null;
}

async function setFeeOverride(discordUserId, feeBps, setBy) {
  await pool.query(
    `INSERT INTO konvert_swap_fee_overrides (discord_user_id, fee_bps, set_by, created_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (discord_user_id) DO UPDATE SET fee_bps = $2, set_by = $3, created_at = now()`,
    [discordUserId, feeBps, setBy]
  );
}

async function clearFeeOverride(discordUserId) {
  const r = await pool.query(`DELETE FROM konvert_swap_fee_overrides WHERE discord_user_id = $1`, [discordUserId]);
  return r.rowCount > 0;
}

async function getAutoSavePref(discordUserId) {
  const r = await pool.query(`SELECT auto_save_addresses FROM konvert_swap_user_prefs WHERE discord_user_id = $1`, [discordUserId]);
  return r.rows.length ? r.rows[0].auto_save_addresses : true; // default: on
}

async function setAutoSavePref(discordUserId, enabled) {
  await pool.query(
    `INSERT INTO konvert_swap_user_prefs (discord_user_id, auto_save_addresses) VALUES ($1, $2)
     ON CONFLICT (discord_user_id) DO UPDATE SET auto_save_addresses = $2`,
    [discordUserId, enabled]
  );
}

async function getSavedAddress(discordUserId, blockchain) {
  const r = await pool.query(
    `SELECT address FROM konvert_swap_saved_addresses WHERE discord_user_id = $1 AND blockchain = $2`,
    [discordUserId, blockchain]
  );
  return r.rows[0]?.address || null;
}

async function saveAddress(discordUserId, blockchain, address) {
  await pool.query(
    `INSERT INTO konvert_swap_saved_addresses (discord_user_id, blockchain, address, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (discord_user_id, blockchain) DO UPDATE SET address = $3, updated_at = now()`,
    [discordUserId, blockchain, address]
  );
}

async function getAllSavedAddresses(discordUserId) {
  const r = await pool.query(
    `SELECT blockchain, address FROM konvert_swap_saved_addresses WHERE discord_user_id = $1 ORDER BY blockchain`,
    [discordUserId]
  );
  return r.rows;
}

async function deleteSavedAddress(discordUserId, blockchain) {
  await pool.query(`DELETE FROM konvert_swap_saved_addresses WHERE discord_user_id = $1 AND blockchain = $2`, [discordUserId, blockchain]);
}

async function deleteAllSavedAddresses(discordUserId) {
  await pool.query(`DELETE FROM konvert_swap_saved_addresses WHERE discord_user_id = $1`, [discordUserId]);
}

async function getSetting(key) {
  const r = await pool.query(`SELECT value FROM konvert_swap_settings WHERE key = $1`, [key]);
  return r.rows[0]?.value ?? null;
}
async function setSetting(key, value) {
  await pool.query(`INSERT INTO konvert_swap_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`, [key, String(value)]);
}

async function getLeaderboard(limit = 10) {
  const r = await pool.query(
    `SELECT discord_user_id, COUNT(*) AS swaps, COALESCE(SUM(amount_in_usd), 0) AS volume
     FROM konvert_swap_orders WHERE status = 'SUCCESS'
     GROUP BY discord_user_id ORDER BY volume DESC LIMIT $1`, [limit]);
  return r.rows;
}

function buildLeaderboardEmbed(rows, stats) {
  const desc = rows.length === 0 ? 'No completed swaps yet.' :
    rows.map((r, i) => `${['🥇','🥈','🥉'][i] || `${i + 1}.`} <@${r.discord_user_id}> — $${Number(r.volume).toFixed(2)} across ${r.swaps} swap(s)`).join('\n');
  const totalSaved = (Number(stats.usdVolume) * (WALLET_SWAP_PCT - OUR_FEE_PCT)) / 100;
  const embed = brand(new EmbedBuilder().setColor(EMBED_COLOR).setTitle('🏆 Top Swappers').setDescription(desc).setTimestamp());
  if (totalSaved > 0.01) embed.setFooter({ text: `Konvert members have saved ≈ $${totalSaved.toFixed(2)} vs typical wallet swap fees` });
  return embed;
}

async function getUserTotalVolume(discordUserId) {
  const r = await pool.query(
    `SELECT COALESCE(SUM(amount_in_usd), 0) AS total FROM konvert_swap_orders WHERE discord_user_id = $1 AND status = 'SUCCESS'`,
    [discordUserId]
  );
  return Number(r.rows[0].total);
}

// ---------------------------------------------------------- Auto-roles & pins

const ROLE_VERIFIED_SWAPPER = '1531108139016126646'; // $10+ lifetime volume, multi-holder, never removed
const ROLE_TOP_VOLUME = '1531109135675031602';        // #1 total volume, single holder, reassigned on overtake
const ROLE_TOP_DEAL = '1531109274225348619';          // biggest single swap ever, single holder, reassigned on overtake

// A ticket's own channel may already be closed by the time a swap
// completes, so fall back to the bot's one server (this bot is built for
// a single guild) rather than failing role assignment outright.
async function resolveGuild(order) {
  if (order && order.channel_id) {
    try {
      const channel = await discordClient.channels.fetch(order.channel_id);
      if (channel && channel.guild) return channel.guild;
    } catch { /* ticket closed — fall through to the guild-wide fallback */ }
  }
  return discordClient.guilds.cache.first() || null;
}

async function maybeGrantVerifiedSwapperRole(discordUserId, guild) {
  if (!guild) return;
  const total = await getUserTotalVolume(discordUserId);
  if (total < 10) return;
  try {
    const member = await guild.members.fetch(discordUserId);
    if (!member.roles.cache.has(ROLE_VERIFIED_SWAPPER)) await member.roles.add(ROLE_VERIFIED_SWAPPER);
  } catch (err) {
    console.error('Verified-swapper role grant failed (check bot has Manage Roles and sits above this role):', err.message);
  }
}

// Single-holder role: moves entirely to whoever is newly #1, removed from
// whoever held it before. Tracked via settings so this never needs a full
// member-list scan — only the two members actually involved get touched.
async function maybeReassignSingleHolderRole(roleId, settingsKey, newHolderId, guild) {
  if (!guild || !newHolderId) return;
  const currentHolder = await getSetting(settingsKey);
  if (currentHolder === newHolderId) return;
  if (currentHolder) {
    try {
      const oldMember = await guild.members.fetch(currentHolder);
      if (oldMember.roles.cache.has(roleId)) await oldMember.roles.remove(roleId);
    } catch (err) {
      console.error(`Could not remove role ${roleId} from previous holder ${currentHolder}:`, err.message);
    }
  }
  try {
    const newMember = await guild.members.fetch(newHolderId);
    await newMember.roles.add(roleId);
    await setSetting(settingsKey, newHolderId);
  } catch (err) {
    console.error(`Could not grant role ${roleId} to new holder ${newHolderId} (check bot has Manage Roles and sits above this role):`, err.message);
  }
}

async function checkAndAssignRoles(order) {
  const guild = await resolveGuild(order);
  if (!guild) return;
  await maybeGrantVerifiedSwapperRole(order.discord_user_id, guild);
  const lb = await getLeaderboard(1);
  if (lb.length > 0) await maybeReassignSingleHolderRole(ROLE_TOP_VOLUME, 'top_volume_role_holder', lb[0].discord_user_id, guild);
  const biggest = await getBiggestSwap();
  if (biggest) await maybeReassignSingleHolderRole(ROLE_TOP_DEAL, 'top_deal_role_holder', biggest.discord_user_id, guild);
}

async function refreshPinnedLeaderboard() {
  const channelId = await getSetting('pinned_leaderboard_channel_id');
  const messageId = await getSetting('pinned_leaderboard_message_id');
  if (!channelId || !messageId) return;
  try {
    const channel = await discordClient.channels.fetch(channelId);
    const message = await channel.messages.fetch(messageId);
    const rows = await getLeaderboard(10);
    const stats = await getStats();
    const embed = buildLeaderboardEmbed(rows, stats);
    embed.setFooter({ text: (embed.data.footer ? embed.data.footer.text + ' • ' : '') + 'auto-updates live' });
    await message.edit({ embeds: [embed] });
  } catch (err) {
    console.error('Pinned leaderboard refresh failed:', err.message);
  }
}

async function refreshPinnedRecord() {
  const channelId = await getSetting('pinned_record_channel_id');
  const messageId = await getSetting('pinned_record_message_id');
  if (!channelId || !messageId) return;
  try {
    const channel = await discordClient.channels.fetch(channelId);
    const message = await channel.messages.fetch(messageId);
    const record = await getBiggestSwap();
    if (!record) return;
    const embed = buildRecordEmbed(record);
    embed.setFooter({ text: 'Auto-updates live — this is the biggest swap right now' });
    await message.edit({ embeds: [embed] });
  } catch (err) {
    console.error('Pinned record refresh failed:', err.message);
  }
}

async function getDailyStats(dayStartIso, dayEndIso) {
  const r = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'SUCCESS') AS completed,
            COUNT(*) FILTER (WHERE status IN ('REFUNDED','FAILED','EXPIRED')) AS failed,
            COALESCE(SUM(amount_in_usd) FILTER (WHERE status = 'SUCCESS'), 0) AS volume,
            COALESCE(SUM(amount_in_usd * affiliate_fee_bps / 20000.0) FILTER (WHERE status = 'SUCCESS' AND fee_applied = true), 0) AS net_fees
     FROM konvert_swap_orders WHERE completed_at >= $1 AND completed_at < $2`, [dayStartIso, dayEndIso]);
  return r.rows[0];
}

// Compact public feed post for completed swaps — no addresses, no tx ids.
async function postToFeed(order) {
  const feedChannelId = await getSetting('feed_channel_id');
  if (!feedChannelId) return;
  const channel = await discordClient.channels.fetch(feedChannelId).catch(() => null);
  if (!channel) return;
  const mins = order.completed_at && order.created_at
    ? Math.max(1, Math.round((new Date(order.completed_at) - new Date(order.created_at)) / 60000)) : null;
  const embed = brand(new EmbedBuilder().setColor(EMBED_COLOR)
    .setDescription(`**${fmt(order.send_amount)} ${assetShort(order.send_asset)}  →  ${fmt(order.actual_receive_amount || order.expected_receive_amount)} ${assetShort(order.receive_asset)}**`)
    .setTimestamp());
  const fields = [];
  if (order.amount_in_usd) fields.push({ name: 'Value', value: `$${Number(order.amount_in_usd).toFixed(2)}`, inline: true });
  if (mins) fields.push({ name: 'Completed in', value: `${mins} min`, inline: true });
  fields.push({ name: 'Client', value: `<@${order.discord_user_id}>`, inline: true });
  embed.addFields(fields);
  await channel.send({ embeds: [embed] }).catch(() => {});
}

// One detailed owner DM per UTC day: yesterday's swaps, volume, est. net fees.
async function maybeSendDailyReport() {
  const today = new Date().toISOString().slice(0, 10);
  const lastSent = await getSetting('last_daily_report');
  if (lastSent === today) return;
  await setSetting('last_daily_report', today);
  if (lastSent === null) return; // first boot: start counting from today

  const dayStart = `${lastSent}T00:00:00.000Z`;
  const dayEnd = `${today}T00:00:00.000Z`;
  const s = await getDailyStats(dayStart, dayEnd);
  const volume = Number(s.volume);
  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(`📊 Konvert Swap — Daily Report (${lastSent})`)
    .setDescription([
      `Completed swaps: **${s.completed}**`,
      `Volume: **$${volume.toFixed(2)}**`,
      `Net fees earned: **$${Number(s.net_fees).toFixed(2)}**`,
      `Refunded/failed/expired: ${s.failed}`,
    ].join('\n')).setTimestamp();
  for (const ownerId of OWNER_IDS) {
    try { const u = await discordClient.users.fetch(ownerId); await u.send({ embeds: [embed] }); }
    catch (err) { console.error(`Daily report DM to ${ownerId} failed:`, err.message); }
  }
}

// Growth over time, not just a snapshot: this week vs the week before,
// sent once every 7 days. Reuses getDailyStats -- it's already generic
// over any date range despite the name.
function startOfWeekUTC(d) {
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? 6 : day - 1); // treat Monday as the start of the week
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff));
  return start;
}

async function maybeSendWeeklyReport() {
  const now = new Date();
  const thisWeekStart = startOfWeekUTC(now);
  const thisWeekKey = thisWeekStart.toISOString().slice(0, 10);
  const lastSentWeek = await getSetting('last_weekly_report');
  if (lastSentWeek === thisWeekKey) return;
  await setSetting('last_weekly_report', thisWeekKey);
  if (lastSentWeek === null) return; // first boot: start counting from this week

  const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * 24 * 3600 * 1000);
  const twoWeeksAgoStart = new Date(thisWeekStart.getTime() - 14 * 24 * 3600 * 1000);
  const [lastWeek, weekBefore] = await Promise.all([
    getDailyStats(lastWeekStart.toISOString(), thisWeekStart.toISOString()),
    getDailyStats(twoWeeksAgoStart.toISOString(), lastWeekStart.toISOString()),
  ]);

  const volNow = Number(lastWeek.volume);
  const volPrev = Number(weekBefore.volume);
  const volChangePct = volPrev > 0 ? ((volNow - volPrev) / volPrev) * 100 : null;
  const trendArrow = volChangePct === null ? '' : volChangePct >= 0 ? '📈' : '📉';
  const trendLine = volChangePct === null
    ? '(no prior week to compare against yet)'
    : `${trendArrow} ${volChangePct >= 0 ? '+' : ''}${volChangePct.toFixed(1)}% vs the week before ($${volPrev.toFixed(2)})`;

  const embed = new EmbedBuilder().setColor(EMBED_COLOR)
    .setTitle(`📈 Konvert Swap — Weekly Report (week of ${lastWeekStart.toISOString().slice(0, 10)})`)
    .setDescription([
      `Completed swaps: **${lastWeek.completed}**`,
      `Volume: **$${volNow.toFixed(2)}**  ${trendLine}`,
      `Net fees earned: **$${Number(lastWeek.net_fees).toFixed(2)}**`,
      `Refunded/failed/expired: ${lastWeek.failed}`,
    ].join('\n')).setTimestamp();
  for (const ownerId of OWNER_IDS) {
    try { const u = await discordClient.users.fetch(ownerId); await u.send({ embeds: [embed] }); }
    catch (err) { console.error(`Weekly report DM to ${ownerId} failed:`, err.message); }
  }
}

async function isSwapEnabled() {
  const r = await pool.query(`SELECT value FROM konvert_swap_settings WHERE key = 'enabled'`);
  return r.rows[0]?.value !== 'false';
}
async function setSwapEnabled(enabled) {
  await pool.query(`INSERT INTO konvert_swap_settings (key, value) VALUES ('enabled', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [enabled ? 'true' : 'false']);
}

async function createSession(channelId, discordUserId) {
  await pool.query(
    `INSERT INTO konvert_swap_sessions (channel_id, discord_user_id, step) VALUES ($1, $2, 'AWAITING_SEND_COIN')
     ON CONFLICT (channel_id) DO UPDATE SET discord_user_id = $2, step = 'AWAITING_SEND_COIN'`, [channelId, discordUserId]);
}
async function getSession(channelId) {
  const r = await pool.query(`SELECT * FROM konvert_swap_sessions WHERE channel_id = $1`, [channelId]);
  return r.rows[0] || null;
}
async function updateSession(channelId, fields) {
  const setClauses = []; const values = []; let i = 1;
  for (const [key, value] of Object.entries(fields)) { setClauses.push(`${key} = $${i}`); values.push(value); i++; }
  setClauses.push('updated_at = now()');
  values.push(channelId);
  const r = await pool.query(`UPDATE konvert_swap_sessions SET ${setClauses.join(', ')} WHERE channel_id = $${i} RETURNING *`, values);
  return r.rows[0];
}
async function deleteSession(channelId) {
  await pool.query(`DELETE FROM konvert_swap_sessions WHERE channel_id = $1`, [channelId]);
}
async function getOpenSessionChannelForUser(discordUserId) {
  const r = await pool.query(`SELECT channel_id FROM konvert_swap_sessions WHERE discord_user_id = $1 LIMIT 1`, [discordUserId]);
  return r.rows[0]?.channel_id || null;
}
async function getStaleSessions() {
  const r = await pool.query(`SELECT * FROM konvert_swap_sessions WHERE updated_at < now() - interval '${SESSION_STALE_MS / 60000} minutes'`);
  return r.rows;
}
async function getClosableOrders() {
  const r = await pool.query(
    `SELECT * FROM konvert_swap_orders
     WHERE ticket_closed = false AND channel_id IS NOT NULL
       AND status IN ('SUCCESS','REFUNDED','FAILED','EXPIRED','EMERGENCY')
       AND completed_at IS NOT NULL
       AND completed_at < now() - interval '${TICKET_CLOSE_GRACE_MS / 60000} minutes'`);
  return r.rows;
}

function parseJsonbField(value) {
  if (value == null) return null;
  if (typeof value === 'string') { try { return JSON.parse(value); } catch { return null; } }
  return value;
}

// -------------------------------------------------------------------- Embeds

const STATUS_STEP = { PENDING_DEPOSIT: 1, KNOWN_DEPOSIT_TX: 2, PROCESSING: 3, SUCCESS: 4, INCOMPLETE_DEPOSIT: 1 };
function progressBar(status) {
  const step = STATUS_STEP[status] || 0;
  if (!step) return '';
  return [1, 2, 3, 4].map((i) => (i <= step ? '▰' : '▱')).join('') + ' ';
}

const STATUS_DISPLAY = {
  PENDING_DEPOSIT: { label: 'Waiting for your deposit', emoji: '⏳' },
  KNOWN_DEPOSIT_TX: { label: 'Deposit detected — confirming on-chain', emoji: '🔍' },
  PROCESSING: { label: 'Swapping now', emoji: '🔄' },
  SUCCESS: { label: 'Complete — funds delivered', emoji: '✅' },
  INCOMPLETE_DEPOSIT: { label: 'Partial deposit received', emoji: '⚠️' },
  REFUNDED: { label: 'Refunded to your refund address', emoji: '↩️' },
  FAILED: { label: 'Failed — refund goes to your refund address', emoji: '❌' },
  EXPIRED: { label: 'Expired — nothing received in time', emoji: '⌛' },
  EMERGENCY: { label: 'Needs attention — an owner has been alerted', emoji: '🚨' },
};

// Uses the bot's own avatar (set the Konvert K logo as the bot avatar in
// the Developer Portal) so every card carries the brand automatically.
function brand(embed) {
  try {
    const icon = discordClient?.user?.displayAvatarURL?.();
    if (icon) embed.setAuthor({ name: 'Konvert Swap', iconURL: icon });
  } catch { /* pre-login or test context */ }
  return embed;
}

function buildErrorEmbed(message) {
  return new EmbedBuilder().setColor(ERROR_COLOR).setDescription(`⚠️ ${message}`);
}
function promptEmbed(title, body) {
  return new EmbedBuilder().setColor(EMBED_COLOR).setTitle(title).setDescription(body);
}
function buildQuoteCheckEmbed(session, quote) {
  const sendSym = assetShort(session.send_asset);
  const recvSym = assetShort(session.receive_asset);
  const inUsd = quote.amountInUsd ? ` (≈ $${Number(quote.amountInUsd).toFixed(2)})` : '';
  const outUsd = quote.amountOutUsd ? ` (≈ $${Number(quote.amountOutUsd).toFixed(2)})` : '';
  const rate = (() => {
    const a = parseFloat(quote.amountInFormatted); const b = parseFloat(quote.amountOutFormatted);
    return a > 0 && b > 0 ? `1 ${sendSym} = ${fmt(b / a)} ${recvSym}` : null;
  })();
  const eta = Number.isFinite(Number(quote.timeEstimate)) ? `~${Math.max(1, Math.ceil(Number(quote.timeEstimate) / 60))} min` : 'a few minutes';
  const minIn = quote.minAmountIn ? `\nMinimum: ${fmt(fromBaseUnits(quote.minAmountIn, tokenInfo(session.send_asset)?.decimals ?? 0))} ${sendSym}` : '';

  const realFeePct = (Number(quote.appliedFeeBps ?? ONECLICK_FEE_BPS) + (ONECLICK_JWT ? 0 : 20)) / 100;
  const costs = costBreakdown(quote.amountInUsd, quote.amountOutUsd, realFeePct);
  const lines = [
    `You send  **${fmt(quote.amountInFormatted || session.amount_display)} ${sendSym}**${inUsd}`,
    `You get  **~${fmt(quote.amountOutFormatted || '?')} ${recvSym}**${outUsd}`,
    '',
    costs
      ? `Konvert fee **${costs.feePct}%** · market spread ~${costs.spreadPct}% · network fee: your wallet${minIn}`
      : `Konvert fee **${realFeePct.toFixed(2).replace(/\.?0+$/, '')}%** · network fee: your wallet${minIn}`,
    rate ? `${rate} · locks on confirm · ~${eta} after deposit` : `~${eta} after deposit`,
    '',
    `Payout \`${session.destination_address}\`\nRefund \`${session.refund_address}\``,
  ];
  if (costs && costs.tinyNote) lines.push(costs.tinyNote);
  const save = savingsLine(quote.amountInUsd, realFeePct);
  if (save) lines.push(save);
  return brand(new EmbedBuilder().setColor(EMBED_COLOR).setTitle('Your Quote').setDescription(lines.join('\n'))
    .setFooter({ text: 'Confirm locks this rate and reserves your personal deposit address.' }));
}

function buildDepositEmbed(order) {
  const t = tokenInfo(order.send_asset);
  const chain = t ? (CHAIN_NAMES[t.blockchain] || t.blockchain) : '';
  const sym = assetShort(order.send_asset);
  const expiresAt = new Date(order.quote_expires_at);
  const isNativeCoin = t && !NATIVE_GAS[t.blockchain] ? true : t && sym === NATIVE_GAS[t.blockchain];
  const gasNote = t && NATIVE_GAS[t.blockchain] && sym !== NATIVE_GAS[t.blockchain]
    ? `You'll need a little **${NATIVE_GAS[t.blockchain]}** in the same wallet for the network fee — your ${sym} amount arrives in full.`
    : `If you're sending your whole balance, leave a little for the network fee, or the deposit arrives short.`;

  const lines = [
    `${progressBar(order.status)}Waiting for your deposit…`,
    '',
    `🚨 **${sym} on ${chain} only — wrong coin or wrong network can't be reversed.**`,
    '',
    `Send **${fmt(order.send_amount)} ${sym}**${order.amount_in_usd ? ` (≈ $${Number(order.amount_in_usd).toFixed(2)})` : ''} on **${chain}**.`,
    `Extra is fine — anything above the quote gets swapped too, so you receive more.`,
    gasNote,
    '',
    `**Deposit address**`,
    `\`\`\`${order.deposit_address}\`\`\``,
    `You get ~**${fmt(order.expected_receive_amount)} ${assetShort(order.receive_asset)}** → \`${order.destination_address}\``,
    `Send before <t:${Math.floor(expiresAt.getTime() / 1000)}:t> (<t:${Math.floor(expiresAt.getTime() / 1000)}:R>) · Order \`${order.order_id.slice(0, 8)}\``,
  ];
  const save = savingsLine(order.amount_in_usd, orderFeePct(order));
  if (save) lines.push(save);
  lines.push('', 'Live updates post here automatically the moment your deposit is detected.');

  const embed = brand(new EmbedBuilder().setColor(EMBED_COLOR).setTitle('Deposit').setDescription(lines.join('\n')))
    .setFooter({ text: 'Funds never pass through Konvert — refunds are automatic if anything fails.' });
  if (order.memo) {
    embed.addFields({
      name: '⚠️ Destination tag / memo (required for this coin)',
      value: `\`\`\`${order.memo}\`\`\`Your wallet's send screen has a standard Tag/Memo field — paste it there.`,
    });
  }
  return embed;
}

// If they deposited more than quoted, FLEX_INPUT swapped the extra too —
// tell them they GOT more, not just that it completed.
// If more was delivered than quoted, the true swapped value is bigger than
// the quote-time USD. Scale it so the feed, stats, leaderboard and daily
// report all reflect reality. Applied once, when the actual amount is
// first learned (guarded by the caller), so it can't compound.
function adjustUsdForActual(originalUsd, expected, actual) {
  const usd = Number(originalUsd), exp = Number(expected), act = Number(actual);
  if (!Number.isFinite(usd) || !Number.isFinite(exp) || !Number.isFinite(act) || exp <= 0 || usd <= 0) return null;
  const ratio = act / exp;
  if (ratio <= 1.005) return null; // rounding noise
  return (usd * ratio).toFixed(2);
}

function overpayLine(order) {
  const actual = parseFloat(order.actual_receive_amount);
  const expected = parseFloat(order.expected_receive_amount);
  if (!Number.isFinite(actual) || !Number.isFinite(expected) || expected <= 0) return null;
  if (actual <= expected * 1.005) return null; // ignore rounding noise
  const extra = actual - expected;
  return `You sent extra — swapped too: **+${fmt(extra)} ${assetShort(order.receive_asset)}** on top of your quote.`;
}

function buildStatusEmbed(order) {
  const s = STATUS_DISPLAY[order.status] || { label: order.status, emoji: 'ℹ️' };
  const t = tokenInfo(order.send_asset);
  const rt = tokenInfo(order.receive_asset);
  const bar = progressBar(order.status);
  const lines = bar ? [bar] : [];

  if (order.status === 'INCOMPLETE_DEPOSIT') {
    const deadline = Math.floor(new Date(order.quote_expires_at).getTime() / 1000);
    if (order.refund_requested) {
      lines.push('', `Refund on the way — what you sent auto-returns to \`${order.refund_address}\` shortly after <t:${deadline}:t> (<t:${deadline}:R>). No action needed.`);
    } else {
      lines.push('', `Your deposit is **less than the quoted ${fmt(order.send_amount)} ${assetShort(order.send_asset)}**. Two options:`);
      lines.push(`**Send the rest** to the same address before <t:${deadline}:t> (<t:${deadline}:R>) — the swap completes automatically,`);
      lines.push(`or **take a refund** — what you sent auto-returns to \`${order.refund_address}\` shortly after the deadline.`);
    }
  }
  if (order.status === 'SUCCESS') {
    lines.push('', `Delivered: **${fmt(order.actual_receive_amount || order.expected_receive_amount)} ${assetShort(order.receive_asset)}**`);
    const bonus = overpayLine(order);
    if (bonus) lines.push(bonus);
    const save = savingsLine(order.amount_in_usd, orderFeePct(order));
    if (save) lines.push(save);
  }
  if (order.status === 'REFUNDED' || order.status === 'FAILED') {
    lines.push('', `Your ${assetShort(order.send_asset)} returns automatically to \`${order.refund_address}\`. Depending on the network this usually lands within minutes to an hour.`);
  }
  const inLink = t ? explorerLink(t.blockchain, order.inbound_txid) : null;
  const outLink = rt ? explorerLink(rt.blockchain, order.outbound_txid) : null;
  if (inLink) lines.push('', `Deposit tx: ${inLink}`);
  if (outLink) lines.push(`Payout tx: ${outLink}`);
  lines.push('', `Order \`${order.order_id}\``);

  return brand(new EmbedBuilder().setColor(order.status === 'SUCCESS' ? OK_COLOR : EMBED_COLOR)
    .setTitle(s.label).setDescription(lines.join('\n')).setTimestamp());
}

// What to tell the client / do next, per status — for /swaplookup.
function adminHint(status) {
  switch (status) {
    case 'PENDING_DEPOSIT': return '1Click has seen NO deposit at this address. Ask the client for their wallet tx hash; verify they sent the right coin on the right network to this exact address.';
    case 'KNOWN_DEPOSIT_TX': return 'Deposit is visible and confirming on-chain. No action — completes on its own.';
    case 'PROCESSING': return 'Escrow has the funds and a solver is filling it. No action — completes shortly.';
    case 'INCOMPLETE_DEPOSIT': return 'They sent less than quoted. They can top up to the same address before the deadline, or wait: auto-refund to their refund address shortly after it.';
    case 'SUCCESS': return 'Paid out — the payout tx below is on-chain proof. If the client says nothing arrived, have them verify the destination address they gave and check that explorer link.';
    case 'REFUNDED': return 'Funds were returned to the refund address below. Point them at that address and the deposit tx.';
    case 'FAILED': return 'Swap failed; refund goes to the refund address below. If nothing arrives within an hour, escalate to NEAR Intents support (Telegram community via docs.near-intents.org) with the order ID and deposit address.';
    case 'EXPIRED': return 'Nothing arrived within our window. If they sent late, this live check may have just rescued it — re-run to confirm. Otherwise the coins never left their wallet.';
    case 'EMERGENCY': return 'Stuck >24h. Escalate to NEAR Intents support (Telegram community via docs.near-intents.org) with the order ID, deposit address, and tx hashes below.';
    default: return 'Unknown state — re-run this lookup; if it persists, escalate with the details below.';
  }
}

function buildAdminLookupEmbed(order) {
  const sT = tokenInfo(order.send_asset);
  const rT = tokenInfo(order.receive_asset);
  const s = STATUS_DISPLAY[order.status] || { label: order.status, emoji: '' };
  const ts = (d) => (d ? `<t:${Math.floor(new Date(d).getTime() / 1000)}:f>` : '—');
  const lines = [
    `**${s.emoji} ${s.label}** · fee ${order.affiliate_fee_bps} bps${order.fee_applied ? '' : ' (not applied)'}${order.refund_requested ? ' · refund requested' : ''}`,
    '',
    `**Route:** ${fmt(order.send_amount)} ${assetShort(order.send_asset)} → ${fmt(order.actual_receive_amount || order.expected_receive_amount)} ${assetShort(order.receive_asset)}${order.amount_in_usd ? ` ($${Number(order.amount_in_usd).toFixed(2)})` : ''}`,
    `**Client:** <@${order.discord_user_id}> · ticket ${order.channel_id ? `<#${order.channel_id}>` : 'closed'}`,
    `**Created:** ${ts(order.created_at)} · **deadline:** ${ts(order.quote_expires_at)} · **done:** ${ts(order.completed_at)} · **last poll:** ${ts(order.last_polled_at)}`,
    '',
    `**Deposit address**\n\`${order.deposit_address}\`${order.memo ? `\n**Memo:** \`${order.memo}\`` : ''}`,
    `**Payout to**\n\`${order.destination_address}\``,
    `**Refunds to**\n\`${order.refund_address || '—'}\``,
  ];
  const inL = sT ? explorerLink(sT.blockchain, order.inbound_txid) : null;
  const outL = rT ? explorerLink(rT.blockchain, order.outbound_txid) : null;
  lines.push('', `**Deposit tx:** ${inL || '— (none seen)'}`, `**Payout tx:** ${outL || '—'}`);
  lines.push('', `**Next step:** ${adminHint(order.status)}`);
  return brand(new EmbedBuilder().setColor(EMBED_COLOR).setTitle(`Order ${order.order_id}`).setDescription(lines.join('\n')).setTimestamp());
}

function buildTranscriptText(order) {
  const line = (label, value) => `${label.padEnd(18)}: ${value ?? '—'}`;
  return [
    'KONVERT SWAP — ORDER TRANSCRIPT',
    '================================',
    '',
    line('Order ID', order.order_id),
    line('Status', order.status),
    line('Client', `Discord ID ${order.discord_user_id}`),
    line('Ticket', order.channel_id ? `#${order.channel_id}` : '(closed)'),
    '',
    'ROUTE',
    '-----',
    line('Send', `${order.send_amount} ${assetShort(order.send_asset)}`),
    line('Receive (expected)', `${order.expected_receive_amount} ${assetShort(order.receive_asset)}`),
    line('Receive (actual)', order.actual_receive_amount || '(pending)'),
    line('USD Value', order.amount_in_usd ? `$${Number(order.amount_in_usd).toFixed(2)}` : '—'),
    line('Konvert Fee', `${order.affiliate_fee_bps} bps${order.fee_applied ? '' : ' (not applied)'}`),
    line('Refund Requested', order.refund_requested ? 'yes' : 'no'),
    '',
    'ADDRESSES',
    '---------',
    line('Deposit Address', order.deposit_address),
    line('Memo / Tag', order.memo || '(none required)'),
    line('Payout Address', order.destination_address),
    line('Refund Address', order.refund_address || '—'),
    '',
    'TRANSACTIONS',
    '------------',
    line('Deposit Tx', order.inbound_txid || '(not seen yet)'),
    line('Payout Tx', order.outbound_txid || '(not yet)'),
    '',
    'TIMESTAMPS (UTC)',
    '-----------------',
    line('Created', order.created_at ? new Date(order.created_at).toISOString() : '—'),
    line('Deadline', order.quote_expires_at ? new Date(order.quote_expires_at).toISOString() : '—'),
    line('Completed', order.completed_at ? new Date(order.completed_at).toISOString() : '—'),
    line('Last Polled', order.last_polled_at ? new Date(order.last_polled_at).toISOString() : '—'),
    '',
    `Generated ${new Date().toISOString()}`,
  ].join('\n');
}

// A REAL transcript of what was actually said in the ticket -- every
// message, who sent it, and when -- not just structured order metadata.
// Paginates up to ~200 messages (Discord's per-request cap is 50).
async function buildChannelTranscript(channel) {
  const messages = [];
  let before;
  for (let i = 0; i < 4; i++) {
    let batch;
    try { batch = await channel.messages.fetch({ limit: 50, ...(before ? { before } : {}) }); }
    catch { break; }
    if (batch.size === 0) break;
    messages.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 50) break;
  }
  messages.reverse(); // oldest first

  const lines = [];
  for (const m of messages) {
    const time = new Date(m.createdTimestamp).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    const author = m.author?.bot ? 'Konvert Swap' : (m.author?.tag || m.author?.username || 'user');
    let text = (m.content || '').trim();
    if (m.embeds && m.embeds.length > 0) {
      for (const e of m.embeds) {
        const parts = [];
        if (e.title) parts.push(e.title);
        if (e.description) parts.push(String(e.description).replace(/\n+/g, ' ').trim());
        if (parts.length) text += (text ? '  |  ' : '') + parts.join('  —  ');
      }
    }
    lines.push(`[${time}] ${author}: ${text || '(no text content)'}`);
  }
  return lines.join('\n') || '(no messages found)';
}

// The ONE transcript for this ticket's whole lifetime -- called exactly
// once, right when the ticket actually closes (swap finished, cancelled,
// or abandoned), never on every intermediate status change.
async function sendFinalTranscript(channel, order, outcomeLabel) {
  if (!AUDIT_LOG_CHANNEL_ID) return;
  try {
    const logChannel = await discordClient.channels.fetch(AUDIT_LOG_CHANNEL_ID);
    const transcriptBody = await buildChannelTranscript(channel);
    const header = [
      'KONVERT SWAP — TICKET TRANSCRIPT',
      '=================================',
      '',
      `Ticket: #${channel.name}`,
      `Outcome: ${outcomeLabel}`,
      order ? `Order ID: ${order.order_id}` : 'No order was created in this ticket.',
      order ? `Client: Discord ID ${order.discord_user_id}` : null,
      order ? `Route: ${fmt(order.send_amount)} ${assetShort(order.send_asset)} -> ${fmt(order.actual_receive_amount || order.expected_receive_amount)} ${assetShort(order.receive_asset)}` : null,
      '',
      '--- MESSAGES ---',
      '',
    ].filter((l) => l !== null).join('\n');

    const file = new AttachmentBuilder(Buffer.from(header + '\n' + transcriptBody, 'utf8'), { name: `transcript-${channel.name}.txt` });
    const embed = brand(new EmbedBuilder()
      .setColor(order && order.status === 'SUCCESS' ? OK_COLOR : EMBED_COLOR)
      .setTitle(`Ticket Closed — ${outcomeLabel}`)
      .setDescription(order
        ? `${fmt(order.send_amount)} ${assetShort(order.send_asset)} → ${fmt(order.actual_receive_amount || order.expected_receive_amount)} ${assetShort(order.receive_asset)}\nOrder \`${order.order_id}\` · <@${order.discord_user_id}>`
        : `#${channel.name} closed — no order was created.`)
      .setTimestamp());
    await logChannel.send({ embeds: [embed], files: [file] });
  } catch (err) {
    console.error('Final transcript send failed:', err.message);
  }
}

async function postToAuditLog(order, eventLabel) {
  if (!AUDIT_LOG_CHANNEL_ID) return;
  try {
    const channel = await discordClient.channels.fetch(AUDIT_LOG_CHANNEL_ID);
    const embed = buildAdminLookupEmbed(order);
    if (eventLabel) embed.setTitle(`${eventLabel} — ${order.order_id}`);
    const file = new AttachmentBuilder(Buffer.from(buildTranscriptText(order), 'utf8'), { name: `swap-${order.order_id}.txt` });
    await channel.send({ embeds: [embed], files: [file] });
  } catch (err) {
    console.error('Audit log post failed:', err.message);
  }
}

function buildHistoryEmbed(orders, userTag) {
  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(`Recent swaps — ${userTag}`).setTimestamp();
  if (orders.length === 0) { embed.setDescription('No swaps yet. Run `/swap` to start one.'); return embed; }
  embed.setDescription(orders.map((o) => {
    const s = STATUS_DISPLAY[o.status] || { emoji: 'ℹ️', label: o.status };
    return `${s.emoji} ${fmt(o.send_amount)} ${assetShort(o.send_asset)} → ${assetShort(o.receive_asset)} · ${s.label} · \`${o.order_id.slice(0, 8)}\``;
  }).join('\n'));
  return embed;
}

function buildStatsEmbed(stats) {
  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle('Konvert Swap — Stats')
    .addFields(
      { name: 'Completed', value: String(stats.completedSwaps), inline: true },
      { name: 'Total Orders', value: String(stats.totalOrders), inline: true },
      { name: 'USD Volume', value: `$${Number(stats.usdVolume).toFixed(2)}`, inline: true },
      { name: 'Net Fees (lifetime)', value: `$${Number(stats.netFeesUsd).toFixed(2)}`, inline: true },
      {
        name: 'Client Savings vs 3.5% wallet fees',
        value: (() => {
          const vol = Number(stats.usdVolume);
          const total = (vol * (WALLET_SWAP_PCT - OUR_FEE_PCT)) / 100;
          const avg = stats.completedSwaps > 0 ? total / stats.completedSwaps : 0;
          return `$${total.toFixed(2)} total · $${avg.toFixed(2)} avg per swap`;
        })(),
        inline: true,
      },
    ).setTimestamp();
  if (stats.volumeByAsset.length > 0) {
    embed.addFields({ name: 'Volume by send asset', value: stats.volumeByAsset.map((r) => `${assetShort(r.send_asset)}: ${r.total_volume} across ${r.swaps} swap(s)`).join('\n').slice(0, 1024) });
    embed.addFields({
      name: 'Fee revenue by coin (highest first)',
      value: [...stats.volumeByAsset].map((r) => `${assetShort(r.send_asset)}: $${Number(r.fee_revenue_usd).toFixed(2)}`).join('\n').slice(0, 1024),
    });
  }
  embed.addFields({
    name: 'Fees',
    value: FEE_CONFIGURED
      ? `${formatBps(ONECLICK_FEE_BPS)} per swap → \`${ONECLICK_FEE_RECIPIENT}\` (1Click keeps half; your net is ${formatBps(ONECLICK_FEE_BPS / 2)})${stats.zeroFeeSwaps ? ` · ${stats.zeroFeeSwaps} swap(s) ran at 0%` : ''}`
      : 'OFF — set ONECLICK_FEE_RECIPIENT (a NEAR account) to start collecting.',
  });
  return embed;
}

// ---------------------------------------------------------------- Components

function cancelRow(label = 'Cancel') {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('swap_cancel_btn').setLabel(label).setStyle(ButtonStyle.Danger));
}
function confirmRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('swap_confirm_btn').setLabel('Confirm').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('swap_changeamount_btn').setLabel('Change amount').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('swap_refresh_btn').setLabel('Refresh rate').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('swap_cancel_btn').setLabel('Cancel').setStyle(ButtonStyle.Danger));
}
function depositRow(orderId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`swap_status_btn:${orderId}`).setLabel('Check status').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`swap_copy_btn:${orderId}`).setLabel('Copy details').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('swap_cancel_btn').setLabel('Close ticket').setStyle(ButtonStyle.Secondary));
}
function sendCoinComponents(menuCoins) {
  const menu = new StringSelectMenuBuilder().setCustomId('swap_send_select')
    .setPlaceholder('Pick the coin you are sending')
    .addOptions(menuCoins.slice(0, 25).map((c) => ({ label: c.label, value: c.assetId })));
  return [new ActionRowBuilder().addComponents(menu), cancelRow('Close Ticket')];
}
function receiveCoinComponents(menuCoins, sendAssetId) {
  const menu = new StringSelectMenuBuilder().setCustomId('swap_receive_select')
    .setPlaceholder('Pick the coin you want')
    .addOptions(menuCoins.filter((c) => c.assetId !== sendAssetId).slice(0, 25).map((c) => ({ label: c.label, value: c.assetId })));
  return [new ActionRowBuilder().addComponents(menu), cancelRow()];
}
function startRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('swap_start_btn').setLabel('Start a swap').setStyle(ButtonStyle.Primary));
}

// ----------------------------------------------------------- Ticket channels

function sanitizeChannelName(username) {
  const cleaned = String(username).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const base = cleaned.slice(0, 20) || 'user';
  return `swap-${base}-${crypto.randomBytes(2).toString('hex')}`;
}

let ticketCategoryCache = null;

function categoryHasRoom(guild, category) {
  // Discord hard-caps categories at 50 channels; leave one slot of margin.
  return guild.channels.cache.filter((c) => c.parentId === category.id).size < 49;
}

async function getOrCreateTicketCategory(guild) {
  if (TICKET_CATEGORY_ID) {
    const existing = guild.channels.cache.get(TICKET_CATEGORY_ID);
    if (existing && categoryHasRoom(guild, existing)) return existing;
  }
  if (ticketCategoryCache && guild.channels.cache.has(ticketCategoryCache.id) && categoryHasRoom(guild, ticketCategoryCache)) {
    return ticketCategoryCache;
  }
  // Walk "Konvert Swap", "Konvert Swap 2", ... and use the first with room;
  // create the next in the series if all existing ones are full.
  for (let n = 1; n <= 10; n++) {
    const name = n === 1 ? TICKET_CATEGORY_NAME : `${TICKET_CATEGORY_NAME} ${n}`;
    const found = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === name);
    if (found) {
      if (categoryHasRoom(guild, found)) { ticketCategoryCache = found; return found; }
      continue;
    }
    const created = await guild.channels.create({ name, type: ChannelType.GuildCategory });
    ticketCategoryCache = created;
    return created;
  }
  throw new Error('All ticket categories are full (500+ open tickets).');
}

async function createTicketChannel(guild, user) {
  const category = await getOrCreateTicketCategory(guild);
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    // Denying @everyone also denies the bot unless it grants itself access.
    { id: discordClient.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ManageChannels] },
  ];
  for (const ownerId of OWNER_IDS) {
    overwrites.push({ id: ownerId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  }
  return guild.channels.create({
    name: sanitizeChannelName(user.username), type: ChannelType.GuildText, parent: category?.id,
    permissionOverwrites: overwrites, topic: `Konvert Swap ticket for ${user.tag} (${user.id})`,
  });
}

// The single point every ticket-closing path routes through, so the
// transcript fires exactly once no matter how the ticket ends (finished,
// cancelled, closed early, or abandoned).
async function closeTicketChannel(channelId, message, order) {
  try {
    const channel = await discordClient.channels.fetch(channelId).catch(() => null);
    if (!channel) return;
    const outcome = order ? (STATUS_DISPLAY[order.status]?.label || order.status) : 'Cancelled before a deposit address was issued';
    await sendFinalTranscript(channel, order || null, outcome);
    await channel.send({ embeds: [new EmbedBuilder().setColor(EMBED_COLOR).setDescription(message)] }).catch(() => {});
    setTimeout(() => { channel.delete().catch((err) => console.error(`Failed to delete channel ${channelId}:`, err.message)); }, 5000);
  } catch (err) {
    console.error(`Failed to close ticket channel ${channelId}:`, err.message);
  }
}

// ------------------------------------------------------------ Slash commands

const commands = [
  new SlashCommandBuilder().setName('swap').setDescription('Swap any coin for any coin — send from any wallet, no memo needed'),
  new SlashCommandBuilder().setName('swapstatus').setDescription('Check one of your swap orders')
    .addStringOption((o) => o.setName('order_id').setDescription('Order ID from your ticket').setRequired(true)),
  new SlashCommandBuilder().setName('swaphistory').setDescription('Show your last 5 swaps'),
  new SlashCommandBuilder().setName('swapaddresses').setDescription('View, edit, or clear your saved addresses')
    .addStringOption((o) => o.setName('action').setDescription('What to do').setRequired(false)
      .addChoices(
        { name: 'View', value: 'view' },
        { name: 'Set/Edit one', value: 'edit' },
        { name: 'Clear one', value: 'clear_one' },
        { name: 'Clear all', value: 'clear' },
        { name: 'Turn auto-save on', value: 'autosave_on' },
        { name: 'Turn auto-save off', value: 'autosave_off' },
      ))
    .addStringOption((o) => o.setName('coin').setDescription('Coin symbol, e.g. BTC, SOL, USDT ETH (needed for Edit / Clear one)').setRequired(false))
    .addStringOption((o) => o.setName('address').setDescription('The address to save (needed for Edit)').setRequired(false)),
  new SlashCommandBuilder().setName('swaptop').setDescription('Top swappers by volume'),
  new SlashCommandBuilder().setName('swaprecord').setDescription('The biggest swap ever completed'),
  new SlashCommandBuilder().setName('swaptoppin').setDescription('[Owner] Post a live, auto-updating leaderboard in this channel').setDefaultMemberPermissions(0),
  new SlashCommandBuilder().setName('swaprecordpin').setDescription('[Owner] Post a live, auto-updating biggest-swap record in this channel').setDefaultMemberPermissions(0),
  // Owner-only: hidden from regular members via default permissions AND
  // hard-checked against OWNER_IDS in the handlers.
  new SlashCommandBuilder().setName('swapstats').setDescription('[Owner] Volume, fees, savings').setDefaultMemberPermissions(0),
  new SlashCommandBuilder().setName('swapexport').setDescription('[Owner] Download all orders as a CSV, for accounting/taxes').setDefaultMemberPermissions(0),
  new SlashCommandBuilder().setName('toggleswap').setDescription('[Owner] Enable or disable swaps').setDefaultMemberPermissions(0),
  new SlashCommandBuilder().setName('swappanel').setDescription('[Owner] Post the public swap panel here').setDefaultMemberPermissions(0),
  new SlashCommandBuilder().setName('swapfeed').setDescription('[Owner] Post completed swaps to this channel').setDefaultMemberPermissions(0),
  new SlashCommandBuilder().setName('swapstatschannel').setDescription("[Owner] Set a voice channel to auto-display total swap volume, like Total Exchanged")
    .addChannelOption((o) => o.setName('channel').setDescription('The channel to rename (create it first, e.g. an empty voice channel)').setRequired(true))
    .setDefaultMemberPermissions(0),
  new SlashCommandBuilder().setName('swaplookup').setDescription('[Owner] Deep-dive an order for support')
    .addStringOption((o) => o.setName('order_id').setDescription('Order ID').setRequired(false))
    .addStringOption((o) => o.setName('deposit_address').setDescription('Deposit address (if the client only has that)').setRequired(false))
    .setDefaultMemberPermissions(0),
  new SlashCommandBuilder().setName('swapuser').setDescription("[Owner] A user's recent orders")
    .addUserOption((o) => o.setName('user').setDescription('The client').setRequired(true))
    .setDefaultMemberPermissions(0),
  new SlashCommandBuilder().setName('swapfee').setDescription('[Owner] Set or clear a custom fee rate for one user')
    .addUserOption((o) => o.setName('user').setDescription('Who to apply this to').setRequired(true))
    .addIntegerOption((o) => o.setName('bps').setDescription('Fee in basis points (0 = free, 100 = 1%). Omit to clear their override.').setRequired(false).setMinValue(0).setMaxValue(1000))
    .setDefaultMemberPermissions(0),
  new SlashCommandBuilder().setName('swapfeeall').setDescription('[Owner] Set (or clear) one fee rate for EVERYONE — e.g. free for a promo period')
    .addIntegerOption((o) => o.setName('bps').setDescription('Fee in basis points for everyone (0 = free). Omit to turn this off and go back to normal.').setRequired(false).setMinValue(0).setMaxValue(1000))
    .setDefaultMemberPermissions(0),
  new SlashCommandBuilder().setName('swapfeetimed').setDescription('[Owner] Set one fee rate for EVERYONE that expires automatically')
    .addIntegerOption((o) => o.setName('bps').setDescription('Fee in basis points for everyone (0 = free)').setRequired(true).setMinValue(0).setMaxValue(1000))
    .addNumberOption((o) => o.setName('days').setDescription('How many days until it auto-reverts to normal (e.g. 3, or 0.5 for 12 hours)').setRequired(true).setMinValue(0.01).setMaxValue(365))
    .setDefaultMemberPermissions(0),
].map((c) => c.toJSON());

// ----------------------------------------------------------- Prompt builders

async function promptForStep(session) {
  const menuCoins = buildMenuCoins();
  switch (session.step) {
    case 'AWAITING_SEND_COIN':
      return {
        embeds: [promptEmbed('What are you sending?', 'Type it — `LTC`, `USDT TRON`, `PEPE` — or pick below. Typing reaches every coin, the menu shows favourites.')],
        components: sendCoinComponents(menuCoins),
      };
    case 'AWAITING_RECEIVE_COIN':
      return {
        embeds: [promptEmbed('What do you want to receive?', 'Type the coin in chat, or pick it below.')],
        components: receiveCoinComponents(menuCoins, session.send_asset),
      };
    case 'AWAITING_AMOUNT': {
      const t = tokenInfo(session.send_asset);
      const rt = tokenInfo(session.receive_asset);
      const lines = [`**${assetDisplayName(session.send_asset)} → ${assetDisplayName(session.receive_asset)}**`];
      // Live indicative rate from cached prices -- no extra API call, just
      // context so the number they're about to type means something.
      if (t && rt && Number.isFinite(Number(t.price)) && Number.isFinite(Number(rt.price)) && Number(rt.price) > 0) {
        const ratio = Number(t.price) / Number(rt.price);
        lines.push(`_1 ${t.symbol} ≈ ${fmt(ratio)} ${rt.symbol} right now (indicative)_`);
      }
      lines.push('Type a dollar amount, like `50` or `$50`. Exact rate shown before anything is final.');
      // A proactive "minimum" line used to live here, based on probing
      // 1Click for minAmountIn ahead of time. Pulled: the probe's own
      // amount was leaking into the number it returned (minAmountIn
      // tracked close to whatever was probed with, not a fixed
      // route-wide floor), so it showed inflated, wrong minimums --
      // confirmed live when a real $19.80 "minimum" turned out false,
      // $1 worked fine. The REACTIVE version (an accurate message if an
      // actual too-small amount gets rejected) is unaffected and stays.
      return {
        embeds: [promptEmbed('How much?', lines.join('\n'))],
        components: [cancelRow()],
      };
    }
    case 'AWAITING_DEST': {
      const t = tokenInfo(session.receive_asset);
      const chain = t ? (CHAIN_NAMES[t.blockchain] || t.blockchain) : '';
      const saved = t ? await getSavedAddress(session.discord_user_id, t.blockchain) : null;
      const savedNote = saved ? `\n\nSaved ${chain} address on file: \`${saved}\` — type \`saved\` to use it.` : '';
      return {
        embeds: [promptEmbed('Where do we send it?', `Paste your **${assetShort(session.receive_asset)}** address in chat. It must be on **${chain}**.${savedNote}`)],
        components: [cancelRow()],
      };
    }
    case 'AWAITING_REFUND': {
      const t = tokenInfo(session.send_asset);
      const chain = t ? (CHAIN_NAMES[t.blockchain] || t.blockchain) : '';
      const saved = t ? await getSavedAddress(session.discord_user_id, t.blockchain) : null;
      const savedNote = saved ? `\n\nSaved ${chain} address on file: \`${saved}\` — type \`saved\` to use it.` : '';
      return {
        embeds: [promptEmbed('Refund address', `If anything fails, your ${assetShort(session.send_asset)} comes back automatically on **${chain}**. Paste a ${assetShort(session.send_asset)} address you control — it's only used if something goes wrong.${savedNote}`)],
        components: [cancelRow()],
      };
    }
    default:
      return { embeds: [promptEmbed('Continue', 'Use the buttons on the quote above, or type `cancel`.')], components: [] };
  }
}

// ------------------------------------------------------------- Quote posting

async function disableSupersededQuote(channel, oldMessageId) {
  if (!oldMessageId) return;
  try {
    const oldMsg = await channel.messages.fetch(oldMessageId);
    await oldMsg.edit({ components: [] });
  } catch { /* deleted; nothing to disable */ }
}

function isOutdatedQuoteClick(session, interaction) {
  return Boolean(session.fee_message_id && interaction.message && interaction.message.id !== session.fee_message_id);
}

// Runs the dry quote and posts/edits the Double Check message. On failure the
// user is dropped back to AWAITING_AMOUNT with everything else preserved —
// there is no state where they are stuck.
async function runQuoteAndPost(channel, session, { editMessage = null } = {}) {
  try {
    const quote = await getOneClickQuote({
      dry: true,
      originAssetId: session.send_asset, destinationAssetId: session.receive_asset,
      amountBase: BigInt(session.amount_1e8), recipient: session.destination_address, refundTo: session.refund_address,
      discordUserId: session.discord_user_id,
    });
    const r = await pool.query(
      `UPDATE konvert_swap_sessions SET quote_snapshot = $1, step = 'AWAITING_CONFIRM', updated_at = now()
       WHERE channel_id = $2 AND step <> 'CONFIRMING' RETURNING *`,
      [JSON.stringify(quote), channel.id]
    );
    if (r.rowCount === 0) {
      // A confirm is finalizing the deposit address right now — this quote
      // refresh must not resurrect the pre-claim state.
      if (editMessage) await editMessage.edit({ embeds: [promptEmbed('One moment', 'Your deposit address is being finalized…')], components: [] }).catch(() => {});
      return false;
    }
    const updated = r.rows[0];
    const payload = { embeds: [buildQuoteCheckEmbed(updated, quote)], components: [confirmRow()] };
    let msg;
    if (editMessage) { msg = await editMessage.edit(payload); }
    else {
      await disableSupersededQuote(channel, session.fee_message_id);
      msg = await channel.send(payload);
    }
    await updateSession(channel.id, { fee_message_id: msg.id });
    return true;
  } catch (err) {
    await updateSession(channel.id, { step: 'AWAITING_AMOUNT' });
    const body = `${describeError(err, tokenInfo(session.send_asset))}\n\nType a new amount to try again — your addresses are saved.`;
    if (editMessage) await editMessage.edit({ embeds: [buildErrorEmbed(body)], components: [cancelRow()] }).catch(() => {});
    else await channel.send({ embeds: [buildErrorEmbed(body)], components: [cancelRow()] });
    return false;
  }
}

// ------------------------------------------------------- Chat message router

async function handleTicketMessage(message, session) {
  const content = message.content.trim();
  if (!content) return;

  if (/^cancel$/i.test(content)) return runCancel(message.channel, session, message.author.id);
  if (/^(status|check)$/i.test(content)) {
    const order = await getLiveOrderForChannel(message.channel.id);
    if (order) { await refreshAndPostStatus(message.channel, order); return; }
  }

  switch (session.step) {
    case 'AWAITING_SEND_COIN': {
      const m = matchCoinText(content, buildMenuCoins());
      if (!m) return void message.reply({ embeds: [buildErrorEmbed('I don\'t recognize that coin. Type something like `LTC` or `USDT ETH`, or use the dropdown above.')] });
      if (m.options) return void message.reply({ embeds: [buildErrorEmbed(`${m.options[0].symbol} exists on more than one network here — type ${m.options.map((o) => `\`${o.symbol} ${o.blockchain}\``).join(' or ')}.`)] });
      const s = await updateSession(message.channel.id, { send_asset: m.coin.assetId, step: 'AWAITING_RECEIVE_COIN' });
      await message.reply({ embeds: [new EmbedBuilder().setColor(OK_COLOR).setDescription(`✅ Sending **${m.coin.label}**`)] });
      return void message.channel.send(await promptForStep(s));
    }
    case 'AWAITING_RECEIVE_COIN': {
      const m = matchCoinText(content, buildMenuCoins());
      if (!m) return void message.reply({ embeds: [buildErrorEmbed('I don\'t recognize that coin. Type something like `SOL` or `USDC ETH`, or use the dropdown above.')] });
      if (m.options) return void message.reply({ embeds: [buildErrorEmbed(`${m.options[0].symbol} exists on more than one network here — type ${m.options.map((o) => `\`${o.symbol} ${o.blockchain}\``).join(' or ')}.`)] });
      if (m.coin.assetId === session.send_asset) return void message.reply({ embeds: [buildErrorEmbed('Send and receive coins must be different.')] });
      const s = await updateSession(message.channel.id, { receive_asset: m.coin.assetId, step: 'AWAITING_AMOUNT' });
      await message.reply({ embeds: [new EmbedBuilder().setColor(OK_COLOR).setDescription(`✅ Receiving **${m.coin.label}**`)] });
      return void message.channel.send(await promptForStep(s));
    }
    case 'AWAITING_AMOUNT': {
      const token = tokenInfo(session.send_asset);
      if (!token) return void message.reply({ embeds: [buildErrorEmbed('The coin list changed — type `cancel` and start a fresh /swap.')] });
      let parsed;
      try { parsed = parseAmountInput(content, token); }
      catch (err) { return void message.reply({ embeds: [buildErrorEmbed(err.message)] }); }
      const s = await updateSession(message.channel.id, {
        amount_1e8: parsed.amountBase.toString(), amount_display: parsed.display, step: 'AWAITING_DEST',
      });
      return void message.channel.send(await promptForStep(s));
    }
    case 'AWAITING_DEST': {
      const t = tokenInfo(session.receive_asset);
      let address = content;
      let usedSaved = false;
      if (/^(saved|use saved)$/i.test(content.trim())) {
        const saved = t ? await getSavedAddress(session.discord_user_id, t.blockchain) : null;
        if (!saved) return void message.reply({ embeds: [buildErrorEmbed('No saved address on file for this coin yet — paste one to get started.')] });
        address = saved;
        usedSaved = true;
      }
      const v = validateAddressForChain(t ? t.blockchain : '', address);
      if (!v.ok) return void message.reply({ embeds: [buildErrorEmbed(`That does not look like a ${assetShort(session.receive_asset)} address on ${t ? CHAIN_NAMES[t.blockchain] || t.blockchain : 'the right network'}. ${v.hint} Double-check it and paste it again.`)] });
      const s = await updateSession(message.channel.id, { destination_address: address, step: 'AWAITING_REFUND' });
      const autoSaveOn1 = !usedSaved && t ? await getAutoSavePref(session.discord_user_id) : false;
      if (autoSaveOn1) {
        await saveAddress(session.discord_user_id, t.blockchain, address).catch(() => {});
        await message.reply({ embeds: [new EmbedBuilder().setColor(OK_COLOR).setDescription(`Saved for next time — type \`saved\` on a future ${assetShort(session.receive_asset)} swap to reuse it. Turn this off anytime with /swapaddresses.`)] }).catch(() => {});
      }
      return void message.channel.send(await promptForStep(s));
    }
    case 'AWAITING_REFUND': {
      const t = tokenInfo(session.send_asset);
      let address = content;
      let usedSaved = false;
      if (/^(saved|use saved)$/i.test(content.trim())) {
        const saved = t ? await getSavedAddress(session.discord_user_id, t.blockchain) : null;
        if (!saved) return void message.reply({ embeds: [buildErrorEmbed('No saved address on file for this coin yet — paste one to get started.')] });
        address = saved;
        usedSaved = true;
      }
      const v = validateAddressForChain(t ? t.blockchain : '', address);
      if (!v.ok) return void message.reply({ embeds: [buildErrorEmbed(`That does not look like a ${assetShort(session.send_asset)} address on ${t ? CHAIN_NAMES[t.blockchain] || t.blockchain : 'the right network'}. ${v.hint} Paste an address you control.`)] });
      if (!usedSaved && t && (await getAutoSavePref(session.discord_user_id))) await saveAddress(session.discord_user_id, t.blockchain, address).catch(() => {});
      const s = await updateSession(message.channel.id, { refund_address: address });
      const placeholder = await message.channel.send({ embeds: [promptEmbed('One moment', '🔎 Getting you the best rate…')] });
      return void runQuoteAndPost(message.channel, { ...s, fee_message_id: session.fee_message_id }, { editMessage: placeholder });
    }
    case 'AWAITING_CONFIRM': {
      // Typing a number here means they want a different amount — honor it.
      const token = tokenInfo(session.send_asset);
      if (token) {
        try {
          const parsed = parseAmountInput(content, token);
          const s = await updateSession(message.channel.id, { amount_1e8: parsed.amountBase.toString(), amount_display: parsed.display });
          const placeholder = await message.channel.send({ embeds: [promptEmbed('One moment', '🔎 Updating your rate…')] });
          return void runQuoteAndPost(message.channel, s, { editMessage: placeholder });
        } catch { /* not an amount — fall through */ }
      }
      return void message.reply({ embeds: [buildErrorEmbed('Use **Confirm** on the quote above, type a new amount to re-quote, or type `cancel`.')] });
    }
    default:
      return;
  }
}

// Closing is always allowed, whenever the client wants -- even with a swap
// still in flight. It never touches the swap itself (which can't be
// stopped once started, and keeps running at 1Click regardless); it only
// closes this channel. DMs and /swapstatus keep working after.
async function runCancel(channel, session, actorId) {
  if (session && session.step === 'CONFIRMING') {
    return void channel.send({ embeds: [buildErrorEmbed('Finalizing your deposit address — give it a second, then close if you still want to.')] });
  }
  const liveOrder = await getLiveOrderForChannel(channel.id);
  const ownerId = session ? session.discord_user_id : (liveOrder ? liveOrder.discord_user_id : null);
  if (ownerId && ownerId !== actorId && !OWNER_IDS.has(actorId)) return;
  await deleteSession(channel.id).catch(() => {});
  if (liveOrder) {
    await markTicketClosed(liveOrder.order_id).catch(() => {});
    await closeTicketChannel(
      channel.id,
      `Closing this ticket — your swap keeps running and **can't be cancelled** once started. You'll still get DM updates, and can check it anytime with \`/swapstatus order_id:${liveOrder.order_id}\`.`,
      liveOrder
    );
  } else {
    await closeTicketChannel(channel.id, 'Swap cancelled. Closing this ticket shortly.');
  }
}

// --------------------------------------------------------- Command handlers

const swapStarting = new Set();

async function startSwapFlow(interaction) {
  if (swapStarting.has(interaction.user.id)) {
    return interaction.reply({ embeds: [buildErrorEmbed('Already opening your ticket — one moment.')], flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  swapStarting.add(interaction.user.id);
  try {
    return await startSwapFlowInner(interaction);
  } finally {
    swapStarting.delete(interaction.user.id);
  }
}

async function startSwapFlowInner(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!(await isSwapEnabled())) return interaction.editReply({ embeds: [buildErrorEmbed('Swaps are currently disabled. Check back later.')] });
  if (!interaction.guild) return interaction.editReply({ embeds: [buildErrorEmbed('Please use this inside the server, not in DMs.')] });

  try { await fetchOneClickTokens(); } catch (err) { console.error('Token fetch failed:', err.message); }
  if (buildMenuCoins().length < 2) return interaction.editReply({ embeds: [buildErrorEmbed("Can't reach the swap service right now — try again in a minute.")] });

  const existingSessionChannel = await getOpenSessionChannelForUser(interaction.user.id);
  const existingOrderChannel = existingSessionChannel ? null : await getOpenOrderChannelForUser(interaction.user.id);
  const existingChannelId = existingSessionChannel || existingOrderChannel;
  if (existingChannelId) {
    if (interaction.guild.channels.cache.get(existingChannelId)) {
      return interaction.editReply({ embeds: [buildErrorEmbed(`You already have an open swap ticket: <#${existingChannelId}>`)] });
    }
    await deleteSession(existingChannelId).catch(() => {});
  }

  let channel;
  try { channel = await createTicketChannel(interaction.guild, interaction.user); }
  catch (err) {
    console.error('Ticket creation failed:', err);
    return interaction.editReply({ embeds: [buildErrorEmbed('Could not create a ticket — I likely need the Manage Channels permission.')] });
  }
  const session = await createSession(channel.id, interaction.user.id).then(() => getSession(channel.id));
  await interaction.editReply({ embeds: [new EmbedBuilder().setColor(OK_COLOR).setDescription(`Your swap ticket is ready: <#${channel.id}>`)] });

  await channel.send({
    embeds: [promptEmbed('Konvert Swap', `<@${interaction.user.id}> — type it, send it, done. Answer in chat or use the menus.\n\n🛡️ We **never** DM first. Keep everything in this ticket.`)],
  });
  await channel.send(await promptForStep(session));
}

async function handleSwapStatusCommand(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const orderId = interaction.options.getString('order_id', true).trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
    return interaction.editReply({ embeds: [buildErrorEmbed("That doesn't look like a valid order ID.")] });
  }
  const order = await getOrderById(orderId);
  if (!order) return interaction.editReply({ embeds: [buildErrorEmbed('No order found with that ID.')] });
  if (order.discord_user_id !== interaction.user.id && !OWNER_IDS.has(interaction.user.id)) {
    return interaction.editReply({ embeds: [buildErrorEmbed("That order doesn't belong to you.")] });
  }
  if (statusCheckAllowed(orderId)) {
    try { await pollSingleOrder(order); } catch { /* show stored state */ }
  }
  return interaction.editReply({ embeds: [buildStatusEmbed(await getOrderById(orderId))] });
}

async function handleSwapPanelCommand(interaction) {
  if (!OWNER_IDS.has(interaction.user.id)) return interaction.reply({ embeds: [buildErrorEmbed('Owner only.')], flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try { await fetchOneClickTokens(); } catch { /* panel still posts */ }
  const coins = buildMenuCoins();
  const symbols = [...new Set(coins.map((c) => c.symbol))].join(' · ') || 'loading…';
  const coinCount = coins.length;
  const netCount = [...new Set(coins.map((c) => c.blockchain))].length;
  const embed = brand(new EmbedBuilder().setColor(EMBED_COLOR)
    .setTitle('Swap any coin, from any wallet')
    .setDescription('No account. No KYC. No memos. Pick your coins, get a personal deposit address, send — done in minutes with live updates the whole way.')
    .addFields(
      { name: 'Assets', value: `${coinCount} coins · ${netCount} networks\n${symbols}`.slice(0, 1024) },
      { name: 'Fee', value: ONECLICK_FEE_BPS_HIGH_TIER < ONECLICK_FEE_BPS
        ? `**${formatBps(ONECLICK_FEE_BPS_HIGH_TIER)}–${formatBps(ONECLICK_FEE_BPS)}**, size-based, shown up-front on every quote`
        : `Flat **${OUR_FEE_PCT.toFixed(2).replace(/\.?0+$/, '')}%**, shown up-front on every quote`, inline: true },
      { name: 'Speed', value: 'Most swaps settle in minutes', inline: true },
      { name: 'Safety', value: 'Non-custodial — automatic refunds if anything fails', inline: true },
    )
    .setFooter({ text: 'We never DM first. If it is not in your ticket, it is not us.' }));
  const icon = discordClient?.user?.displayAvatarURL?.({ size: 256 });
  if (icon) embed.setThumbnail(icon);
  await interaction.channel.send({ embeds: [embed], components: [startRow()] });
  return interaction.editReply({ embeds: [new EmbedBuilder().setColor(OK_COLOR).setDescription('Panel posted.')] });
}

// --------------------------------------------------------- Button handlers

async function handleCoinSelect(interaction, which) {
  const session = await getSession(interaction.channelId);
  if (!session || session.discord_user_id !== interaction.user.id) {
    return interaction.reply({ embeds: [buildErrorEmbed("This ticket isn't yours.")], flags: MessageFlags.Ephemeral });
  }
  const expectedStep = which === 'send' ? 'AWAITING_SEND_COIN' : 'AWAITING_RECEIVE_COIN';
  if (session.step !== expectedStep) {
    return interaction.reply({ embeds: [buildErrorEmbed('This step is already done — check the newest message below.')], flags: MessageFlags.Ephemeral });
  }
  const coin = buildMenuCoins().find((c) => c.assetId === interaction.values[0]);
  if (!coin) return interaction.reply({ embeds: [buildErrorEmbed('Unknown coin — type `cancel` and start fresh.')], flags: MessageFlags.Ephemeral });
  if (which === 'receive' && coin.assetId === session.send_asset) {
    return interaction.reply({ embeds: [buildErrorEmbed('Send and receive coins must be different.')], flags: MessageFlags.Ephemeral });
  }
  const fields = which === 'send' ? { send_asset: coin.assetId, step: 'AWAITING_RECEIVE_COIN' } : { receive_asset: coin.assetId, step: 'AWAITING_AMOUNT' };
  const s = await updateSession(interaction.channelId, fields);
  await interaction.update({ embeds: [new EmbedBuilder().setColor(OK_COLOR).setDescription(`✅ ${which === 'send' ? 'Sending' : 'Receiving'} **${coin.label}**`)], components: [] });
  await interaction.channel.send(await promptForStep(s));
}

async function handleConfirmButton(interaction) {
  const session = await getSession(interaction.channelId);
  if (!session) {
    const live = await getLiveOrderForChannel(interaction.channelId);
    if (live) return interaction.reply({ embeds: [buildErrorEmbed('This swap is already confirmed — your deposit details are above.')], flags: MessageFlags.Ephemeral });
    return interaction.reply({ embeds: [buildErrorEmbed("This ticket isn't yours.")], flags: MessageFlags.Ephemeral });
  }
  if (session.discord_user_id !== interaction.user.id) return interaction.reply({ embeds: [buildErrorEmbed("This ticket isn't yours.")], flags: MessageFlags.Ephemeral });
  if (session.step !== 'AWAITING_CONFIRM' || !session.amount_1e8) return interaction.reply({ embeds: [buildErrorEmbed('Nothing to confirm right now.')], flags: MessageFlags.Ephemeral });
  if (isOutdatedQuoteClick(session, interaction)) return interaction.reply({ embeds: [buildErrorEmbed('This quote was replaced — use the buttons on the newest quote below.')], flags: MessageFlags.Ephemeral });

  // Reserving a deposit address takes a few seconds; a double-click in that
  // window used to create TWO orders with two different deposit addresses.
  // This conditional UPDATE is atomic — exactly one click can flip the step
  // to CONFIRMING; every other concurrent click bounces off here.
  const claim = await pool.query(
    `UPDATE konvert_swap_sessions SET step = 'CONFIRMING', updated_at = now()
     WHERE channel_id = $1 AND step = 'AWAITING_CONFIRM' RETURNING channel_id`,
    [interaction.channelId]
  );
  if (claim.rowCount === 0) {
    return interaction.reply({ embeds: [buildErrorEmbed('Already confirming — one moment.')], flags: MessageFlags.Ephemeral });
  }

  await interaction.deferUpdate();
  const originToken = tokenInfo(session.send_asset);
  const destToken = tokenInfo(session.receive_asset);
  if (!originToken || !destToken) {
    await updateSession(interaction.channelId, { step: 'AWAITING_AMOUNT' }).catch(() => {});
    return void interaction.channel.send({ embeds: [buildErrorEmbed('The coin list changed — type a new amount to re-quote.')] });
  }

  let finalQuote;
  try {
    finalQuote = await getOneClickQuote({
      dry: false,
      originAssetId: session.send_asset, destinationAssetId: session.receive_asset,
      amountBase: BigInt(session.amount_1e8), recipient: session.destination_address, refundTo: session.refund_address,
      discordUserId: session.discord_user_id,
    });
  } catch (err) {
    await interaction.message.edit({ components: [] }).catch(() => {});
    await updateSession(interaction.channelId, { step: 'AWAITING_AMOUNT' });
    return void interaction.channel.send({ embeds: [buildErrorEmbed(`${describeError(err, tokenInfo(session.send_asset))}\n\nType a new amount to try again — your addresses are saved.`)], components: [cancelRow()] });
  }

  const orderId = crypto.randomUUID();
  const quoteExpiresAt = effectiveDeadline(finalQuote.deadline, ONECLICK_DEADLINE_MINUTES);
  let order;
  try {
    order = await insertOrder({
      orderId, discordUserId: interaction.user.id, channelId: interaction.channelId,
      sendAsset: session.send_asset, receiveAsset: session.receive_asset,
      sendAmount: finalQuote.amountInFormatted || session.amount_display,
      expectedReceiveAmount: finalQuote.amountOutFormatted || (finalQuote.amountOut ? fromBaseUnits(finalQuote.amountOut, destToken.decimals) : session.amount_display),
      amountInUsd: finalQuote.amountInUsd || null,
      depositAddress: finalQuote.depositAddress, memo: finalQuote.depositMemo || null,
      destinationAddress: session.destination_address,
      affiliateFeeBps: finalQuote.appliedFeeBps ?? (FEE_CONFIGURED ? ONECLICK_FEE_BPS : 0), feeApplied: (finalQuote.appliedFeeBps ?? 0) > 0,
      refundAddress: session.refund_address, quoteExpiresAt,
    });
  } catch (err) {
    console.error('Order insert failed:', err);
    await updateSession(interaction.channelId, { step: 'AWAITING_CONFIRM' }).catch(() => {});
    return void interaction.channel.send({ embeds: [buildErrorEmbed('Could not save this order — press Confirm again.')] });
  }
  await deleteSession(interaction.channelId);
  await interaction.message.edit({ components: [] }).catch(() => {});

  scheduleDeadlinePoll(order);

  let files = [];
  try {
    const qrBuf = await QRCode.toBuffer(order.deposit_address, { width: 512, margin: 1 });
    files = [new AttachmentBuilder(qrBuf, { name: 'deposit-qr.png' })];
  } catch (err) { console.error('QR generation failed (non-fatal):', err.message); }

  const embed = buildDepositEmbed(order);
  if (files.length) embed.setThumbnail('attachment://deposit-qr.png');
  const depositMsg = await interaction.channel.send({ embeds: [embed], files, components: [depositRow(order.order_id)] });
  // Seeds the message this order will keep editing in place as its status
  // evolves (PENDING -> detected -> processing -> done), instead of a new
  // message per status change.
  await pool.query(`UPDATE konvert_swap_orders SET status_message_id = $1 WHERE order_id = $2`, [depositMsg.id, order.order_id]).catch(() => {});
}

async function handleRefreshButton(interaction) {
  const session = await getSession(interaction.channelId);
  if (!session || session.discord_user_id !== interaction.user.id) return interaction.reply({ embeds: [buildErrorEmbed("This ticket isn't yours.")], flags: MessageFlags.Ephemeral });
  if (session.step !== 'AWAITING_CONFIRM') return interaction.reply({ embeds: [buildErrorEmbed('Nothing to refresh right now.')], flags: MessageFlags.Ephemeral });
  if (isOutdatedQuoteClick(session, interaction)) return interaction.reply({ embeds: [buildErrorEmbed('This quote was replaced — use the newest quote below.')], flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate();
  await runQuoteAndPost(interaction.channel, session, { editMessage: interaction.message });
}

async function handleChangeAmountButton(interaction) {
  const session = await getSession(interaction.channelId);
  if (!session || session.discord_user_id !== interaction.user.id) return interaction.reply({ embeds: [buildErrorEmbed("This ticket isn't yours.")], flags: MessageFlags.Ephemeral });
  if (session.step !== 'AWAITING_CONFIRM') return interaction.reply({ embeds: [buildErrorEmbed('Nothing to change right now.')], flags: MessageFlags.Ephemeral });
  if (isOutdatedQuoteClick(session, interaction)) return interaction.reply({ embeds: [buildErrorEmbed('This quote was replaced — use the newest quote below.')], flags: MessageFlags.Ephemeral });
  const updated = await updateSession(interaction.channelId, { step: 'AWAITING_AMOUNT' });
  await interaction.update({ components: [] }); // freeze the old quote's buttons in place
  await interaction.channel.send(await promptForStep(updated));
}

async function refreshAndPostStatus(channel, order) {
  if (statusCheckAllowed(order.order_id)) {
    try { await pollSingleOrder(order); } catch (err) { console.error('On-demand poll failed:', err.message); }
  }
  const fresh = await getOrderById(order.order_id);
  await channel.send({ embeds: [buildStatusEmbed(fresh)] });
}

async function handleStatusButton(interaction, orderId) {
  const order = await getOrderById(orderId);
  if (!order) return interaction.reply({ embeds: [buildErrorEmbed('Order not found.')], flags: MessageFlags.Ephemeral });
  if (order.discord_user_id !== interaction.user.id && !OWNER_IDS.has(interaction.user.id)) {
    return interaction.reply({ embeds: [buildErrorEmbed("That order isn't yours.")], flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (statusCheckAllowed(orderId)) {
    try { await pollSingleOrder(order); } catch { /* show whatever we have */ }
  }
  const fresh = await getOrderById(orderId);
  return interaction.editReply({ embeds: [buildStatusEmbed(fresh)] });
}

// Posts the amount, address (and memo) as PLAIN ephemeral text messages so
// long-press copy works on any phone — no embed chrome around them.
async function handleCopyButton(interaction, orderId) {
  const order = await getOrderById(orderId);
  if (!order) return interaction.reply({ embeds: [buildErrorEmbed('Order not found.')], flags: MessageFlags.Ephemeral });
  if (order.discord_user_id !== interaction.user.id && !OWNER_IDS.has(interaction.user.id)) {
    return interaction.reply({ embeds: [buildErrorEmbed("That order isn't yours.")], flags: MessageFlags.Ephemeral });
  }
  await interaction.reply({ content: String(order.send_amount), flags: MessageFlags.Ephemeral });
  await interaction.followUp({ content: String(order.deposit_address), flags: MessageFlags.Ephemeral });
  if (order.memo) await interaction.followUp({ content: String(order.memo), flags: MessageFlags.Ephemeral });
}

async function handleCancelButton(interaction) {
  const session = await getSession(interaction.channelId);
  if (session && session.step === 'CONFIRMING') {
    return interaction.reply({ embeds: [buildErrorEmbed('Finalizing your deposit address — give it a second, then close if you still want to.')], flags: MessageFlags.Ephemeral });
  }
  const liveOrder = await getLiveOrderForChannel(interaction.channelId);
  const ownerId = session ? session.discord_user_id : (liveOrder ? liveOrder.discord_user_id : null);
  if (ownerId && ownerId !== interaction.user.id && !OWNER_IDS.has(interaction.user.id)) {
    return interaction.reply({ embeds: [buildErrorEmbed("This ticket isn't yours.")], flags: MessageFlags.Ephemeral });
  }
  await interaction.deferUpdate();
  await deleteSession(interaction.channelId).catch(() => {});
  if (liveOrder) {
    await markTicketClosed(liveOrder.order_id).catch(() => {});
    await closeTicketChannel(
      interaction.channelId,
      `Closing this ticket — your swap keeps running and **can't be cancelled** once started. You'll still get DM updates, and can check it anytime with \`/swapstatus order_id:${liveOrder.order_id}\`.`,
      liveOrder
    );
  } else {
    await closeTicketChannel(interaction.channelId, 'Swap cancelled. Closing this ticket shortly.');
  }
}

// ------------------------------------------------------------------- Polling

const TERMINAL_STATUSES = new Set(['SUCCESS', 'REFUNDED', 'FAILED', 'EXPIRED', 'EMERGENCY']);

async function notifyIfChanged(order) {
  if (!order || order.last_notified_status === order.status) return;
  // Atomic claim: concurrent pollers (background cycle + Check-status
  // button) can both reach here — only the claim winner sends, so the
  // client never gets the same update twice.
  const claim = await pool.query(
    `UPDATE konvert_swap_orders SET last_notified_status = $1
     WHERE order_id = $2 AND last_notified_status IS DISTINCT FROM $1 RETURNING order_id`,
    [order.status, order.order_id]
  );
  if (claim.rowCount === 0) return;
  const embed = buildStatusEmbed(order);
  const isTerminal = TERMINAL_STATUSES.has(order.status);
  if (order.channel_id) {
    try {
      const channel = await discordClient.channels.fetch(order.channel_id);
      const buttons = [];
      if (order.status === 'SUCCESS') {
        buttons.push(new ButtonBuilder().setCustomId(`swap_close_btn:${order.order_id}`).setLabel('Close ticket').setStyle(ButtonStyle.Secondary));
      }
      if (order.status === 'INCOMPLETE_DEPOSIT' && !order.refund_requested) {
        buttons.push(
          new ButtonBuilder().setCustomId(`swap_topup_btn:${order.order_id}`).setLabel('Send the rest').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`swap_refundme_btn:${order.order_id}`).setLabel('Refund instead').setStyle(ButtonStyle.Danger)
        );
      }
      if (isTerminal) {
        buttons.push(new ButtonBuilder().setCustomId('swap_start_btn').setLabel('Swap Again').setStyle(ButtonStyle.Primary));
      }
      // Always set components explicitly (even to []) -- Discord's edit
      // preserves whatever was there before if the key is simply omitted,
      // so an old "Send the rest" button could otherwise linger forever
      // on a message that's since moved past that state.
      const payload = { embeds: [embed], components: buttons.length ? [new ActionRowBuilder().addComponents(...buttons)] : [] };

      // Live-editing: evolve the SAME message (the one that started as the
      // deposit card) through every status, instead of a new message per
      // change. Falls back to sending fresh if there's no stored message
      // yet, or if editing fails (message or channel gone) -- so a status
      // update is never silently lost.
      let edited = false;
      if (order.status_message_id) {
        try {
          const msg = await channel.messages.fetch(order.status_message_id);
          await msg.edit(payload);
          edited = true;
        } catch { /* fall through to sending fresh below */ }
      }
      if (!edited) {
        const sent = await channel.send(payload);
        await pool.query(`UPDATE konvert_swap_orders SET status_message_id = $1 WHERE order_id = $2`, [sent.id, order.order_id]);
      }
    } catch (err) { console.error(`Could not post status in channel ${order.channel_id}:`, err.message); }
  }
  if (order.status === 'SUCCESS') {
    postToFeed(order).catch((e) => console.error('Feed post failed:', e.message));
    checkAndAnnounceRecord(order).catch((e) => console.error('Record check failed:', e.message));
    checkAndAssignRoles(order).catch((e) => console.error('Role assignment failed:', e.message));
    refreshPinnedLeaderboard().catch((e) => console.error('Pinned leaderboard refresh failed:', e.message));
    refreshPinnedRecord().catch((e) => console.error('Pinned record refresh failed:', e.message));
  }
  try {
    const user = await discordClient.users.fetch(order.discord_user_id);
    await user.send({ embeds: [embed] });
  } catch (err) { console.error(`Could not DM user ${order.discord_user_id}:`, err.message); }
  if (order.status === 'EMERGENCY') {
    for (const ownerId of OWNER_IDS) {
      try {
        const owner = await discordClient.users.fetch(ownerId);
        await owner.send({ embeds: [new EmbedBuilder().setColor(ERROR_COLOR).setTitle('🚨 Swap needs attention').setDescription(`Order \`${order.order_id}\` has been in ${order.last_notified_status || 'progress'} for over 24h. User: <@${order.discord_user_id}>`)] });
      } catch (err) { console.error(`Could not DM owner ${ownerId}:`, err.message); }
    }
  }
}

// Best-effort speed boost for catching a refund/expiry right when it
// happens, instead of waiting up to one regular poll cycle. This is NOT
// what makes a refund happen faster -- the escrow itself controls that
// timing -- it just narrows how quickly the bot notices and tells the
// client. The regular cycle is still the reliable backstop if the process
// restarts before this timer fires (setTimeout doesn't survive a restart).
function scheduleDeadlinePoll(order) {
  if (!order || !order.quote_expires_at) return;
  const msUntil = new Date(order.quote_expires_at).getTime() - Date.now() + 5000;
  if (msUntil <= 0 || msUntil > 2 * 60 * 60 * 1000) return;
  setTimeout(() => {
    getOrderById(order.order_id).then((fresh) => {
      if (fresh && !TERMINAL_STATUSES.has(fresh.status)) {
        pollSingleOrder(fresh).catch((e) => console.error('Deadline poll failed:', e.message));
      }
    }).catch(() => {});
  }, msUntil);
}

async function pollSingleOrder(order) {
  const now = Date.now();
  const createdAt = new Date(order.created_at).getTime();
  if (now - createdAt > ORDER_EXPIRY_MS) {
    const finalStatus = (order.status === 'PENDING_DEPOSIT' || order.status === 'EXPIRED') ? 'EXPIRED' : 'EMERGENCY';
    const updated = await updateOrderStatus(order.order_id, { status: finalStatus, completed_at: new Date(), last_polled_at: new Date() });
    await notifyIfChanged(updated);
    return;
  }

  let statusRes;
  try { statusRes = await getSwapStatus(order.deposit_address, order.memo); }
  catch {
    await pool.query(`UPDATE konvert_swap_orders SET last_polled_at = now() WHERE order_id = $1`, [order.order_id]);
    return;
  }

  const apiStatus = statusRes && statusRes.status ? String(statusRes.status) : null;
  let newStatus = apiStatus ? mapOneClickStatus(order.status, apiStatus) : order.status;
  if (newStatus === 'PENDING_DEPOSIT' && now > new Date(order.quote_expires_at).getTime() + EXPIRY_GRACE_MS) {
    newStatus = 'EXPIRED';
  }

  const sd = (statusRes && statusRes.swapDetails) || {};
  const destToken = tokenInfo(order.receive_asset);
  const inboundTxid = firstHash(sd.originChainTxHashes) || order.inbound_txid || null;
  const outboundTxid = firstHash(sd.destinationChainTxHashes) || order.outbound_txid || null;
  let actualReceive = order.actual_receive_amount || null;
  if (sd.amountOutFormatted) actualReceive = sd.amountOutFormatted;
  else if (sd.amountOut && destToken) { try { actualReceive = fromBaseUnits(sd.amountOut, destToken.decimals); } catch { /* keep */ } }

  if (newStatus === order.status && inboundTxid === order.inbound_txid && outboundTxid === order.outbound_txid) {
    await pool.query(`UPDATE konvert_swap_orders SET last_polled_at = now() WHERE order_id = $1`, [order.order_id]);
    return;
  }
  const fields = {
    status: newStatus, inbound_txid: inboundTxid, outbound_txid: outboundTxid,
    actual_receive_amount: actualReceive,
    completed_at: TERMINAL_STATUSES.has(newStatus) ? new Date() : null,
    last_polled_at: new Date(),
  };
  if (!order.actual_receive_amount && actualReceive) {
    const adjusted = adjustUsdForActual(order.amount_in_usd, order.expected_receive_amount, actualReceive);
    if (adjusted) fields.amount_in_usd = adjusted;
  }
  const updated = await updateOrderStatus(order.order_id, fields);
  await notifyIfChanged(updated);
}

const statusCheckCooldown = new Map(); // orderId -> last check timestamp
const STATUS_CHECK_COOLDOWN_MS = 10_000;

function statusCheckAllowed(orderId) {
  const last = statusCheckCooldown.get(orderId) || 0;
  if (Date.now() - last < STATUS_CHECK_COOLDOWN_MS) return false;
  statusCheckCooldown.set(orderId, Date.now());
  return true;
}

let pollInProgress = false;
async function pollActiveOrders() {
  if (pollInProgress) return;
  pollInProgress = true;
  try {
    let orders;
    try { orders = await getActiveOrders(); }
    catch (err) { console.error('Failed to load active orders:', err); return; }
    for (const order of orders) {
      try { await pollSingleOrder(order); }
      catch (err) { console.error(`Error polling order ${order.order_id}:`, err); }
    }
  } finally { pollInProgress = false; }
}

async function closeStaleSessionsAndTickets() {
  try {
    for (const session of await getStaleSessions()) {
      await closeTicketChannel(session.channel_id, 'This ticket expired from inactivity.');
      await deleteSession(session.channel_id);
    }
  } catch (err) { console.error('Stale session cleanup failed:', err); }
  try {
    for (const order of await getClosableOrders()) {
      await closeTicketChannel(order.channel_id, 'Closing this ticket — thanks for using Konvert Swap.', order);
      await markTicketClosed(order.order_id);
    }
  } catch (err) { console.error('Ticket close cycle failed:', err); }
}

// -------------------------------------------------------------- Discord glue

const discordClient = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

discordClient.once(Events.ClientReady, async (c) => {
  console.log(`Konvert Swap logged in as ${c.user.tag}`);
  try {
    await c.application.commands.set(commands);
    console.log(`Registered ${commands.length} slash commands.`);
  } catch (err) { console.error('Slash command registration failed:', err); }
  fetchOneClickTokens()
    .then((t) => console.log(`Loaded ${t.list.length} tokens; ${buildMenuCoins().length} in the menu.`))
    .catch((err) => console.error('Initial token fetch failed:', err.message));
  setInterval(() => {
    pollActiveOrders().catch((err) => console.error('Poll cycle failed:', err));
    closeStaleSessionsAndTickets().catch((err) => console.error('Cleanup cycle failed:', err));
    maybeSendDailyReport().catch((err) => console.error('Daily report failed:', err));
    maybeSendWeeklyReport().catch((err) => console.error('Weekly report failed:', err));
    maybeUpdateStatsChannel().catch((err) => console.error('Stats channel update failed:', err));
    maybeExpireGlobalFeeOverride().catch((err) => console.error('Fee override expiry check failed:', err));
  }, POLL_INTERVAL_MS);
});

discordClient.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot || !message.guild) return;
    if (!message.channel?.name?.startsWith('swap-')) return;
    const session = await getSession(message.channel.id);
    if (!session) {
      // Ticket with a live order but no session: allow "status" checks.
      if (/^(status|check)$/i.test(message.content.trim())) {
        const order = await getLiveOrderForChannel(message.channel.id);
        if (order && (order.discord_user_id === message.author.id || OWNER_IDS.has(message.author.id))) {
          await refreshAndPostStatus(message.channel, order);
        }
      }
      return;
    }
    if (session.discord_user_id !== message.author.id) return;
    await handleTicketMessage(message, session);
  } catch (err) {
    console.error('Ticket message handler error:', err);
    try { await message.reply({ embeds: [buildErrorEmbed('Something went wrong — your progress is saved, just send that again.')] }); } catch { /* ignore */ }
  }
});

discordClient.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      switch (interaction.commandName) {
        case 'swap': return await startSwapFlow(interaction);
        case 'swapstatus': return await handleSwapStatusCommand(interaction);
        case 'swaphistory': {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          return await interaction.editReply({ embeds: [buildHistoryEmbed(await getUserHistory(interaction.user.id, 5), interaction.user.tag)] });
        }
        case 'swapaddresses': {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const action = interaction.options.getString('action') || 'view';
          const coinInput = interaction.options.getString('coin');
          const addressInput = interaction.options.getString('address');

          if (action === 'clear') {
            await deleteAllSavedAddresses(interaction.user.id);
            return interaction.editReply({ embeds: [new EmbedBuilder().setColor(OK_COLOR).setDescription('All your saved addresses have been cleared.')] });
          }

          if (action === 'autosave_on' || action === 'autosave_off') {
            await setAutoSavePref(interaction.user.id, action === 'autosave_on');
            return interaction.editReply({ embeds: [new EmbedBuilder().setColor(OK_COLOR).setDescription(
              action === 'autosave_on'
                ? 'Auto-save turned **on** — addresses you type during a swap will be remembered for next time.'
                : "Auto-save turned **off** — addresses you type won't be remembered automatically. You can still set one manually with `/swapaddresses action:Set/Edit one`."
            )] });
          }

          if (action === 'clear_one' || action === 'edit') {
            if (!coinInput) return interaction.editReply({ embeds: [buildErrorEmbed('Tell me which coin, e.g. `coin: BTC` or `coin: USDT ETH`.')] });
            const match = matchCoinText(coinInput, buildMenuCoins());
            if (!match || !match.coin) {
              return interaction.editReply({ embeds: [buildErrorEmbed(match?.options
                ? `That symbol exists on more than one network — try ${match.options.map((o) => `\`${o.symbol} ${o.blockchain}\``).join(' or ')}.`
                : "I don't recognize that coin — try a symbol like `BTC` or `USDT ETH`.")] });
            }
            const blockchain = match.coin.blockchain;
            const chainName = CHAIN_NAMES[blockchain] || blockchain;

            if (action === 'clear_one') {
              await deleteSavedAddress(interaction.user.id, blockchain);
              return interaction.editReply({ embeds: [new EmbedBuilder().setColor(OK_COLOR).setDescription(`Cleared your saved ${chainName} address.`)] });
            }
            // edit
            if (!addressInput) return interaction.editReply({ embeds: [buildErrorEmbed(`Give me the address too, e.g. \`address: your ${chainName} address\`.`)] });
            const v = validateAddressForChain(blockchain, addressInput.trim());
            if (!v.ok) return interaction.editReply({ embeds: [buildErrorEmbed(`That doesn't look like a valid ${chainName} address. ${v.hint}`)] });
            await saveAddress(interaction.user.id, blockchain, addressInput.trim());
            return interaction.editReply({ embeds: [new EmbedBuilder().setColor(OK_COLOR).setDescription(`Saved — your ${chainName} address is now \`${addressInput.trim()}\`. Type \`saved\` next time you need a ${chainName} address in a ticket.`)] });
          }

          // view (default)
          const rows = await getAllSavedAddresses(interaction.user.id);
          const autoSave = await getAutoSavePref(interaction.user.id);
          const desc = rows.length === 0
            ? "No saved addresses yet — they're saved automatically the first time you use one in a swap (unless you've turned that off)."
            : rows.map((r) => `**${CHAIN_NAMES[r.blockchain] || r.blockchain}**: \`${r.address}\``).join('\n');
          return interaction.editReply({
            embeds: [brand(new EmbedBuilder().setColor(EMBED_COLOR).setTitle('Your Saved Addresses').setDescription(desc)
              .setFooter({ text: `Auto-save is ${autoSave ? 'ON' : 'OFF'} · edit, clear one/all, or toggle auto-save with the action option above` }))],
          });
        }
        case 'swapstats': {
          if (!OWNER_IDS.has(interaction.user.id)) return interaction.reply({ embeds: [buildErrorEmbed('Owner only.')], flags: MessageFlags.Ephemeral });
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const stats = await getStats();
          const embed = buildStatsEmbed(stats);

          // Cross-reference against the live "Total Swapped" channel, so a
          // mismatch is immediately explainable (stale within its 10-min
          // window vs. actually wrong) instead of a guess.
          const statsChannelId = await getSetting('stats_channel_id');
          if (statsChannelId) {
            const trueLabel = `Total Swapped: ${formatVolumeShort(Number(stats.usdVolume))}`;
            let liveChannelName = '(could not fetch — check the bot still has access)';
            try {
              const ch = await discordClient.channels.fetch(statsChannelId);
              liveChannelName = ch ? ch.name : '(channel not found — was it deleted?)';
            } catch { /* keep the fallback message above */ }
            const lastUpdateRaw = await getSetting('stats_channel_last_update');
            const lastUpdateLine = lastUpdateRaw
              ? `<t:${Math.floor(parseInt(lastUpdateRaw, 10) / 1000)}:R>`
              : 'never (run /swapstatschannel again if it seems stuck)';
            const inSync = liveChannelName === trueLabel;
            embed.addFields({
              name: `${inSync ? '✅' : '🕓'} Stats Channel Check`,
              value: [
                `Channel currently shows: **${liveChannelName}**`,
                `Live total right now: **${trueLabel}** (exact: $${Number(stats.usdVolume).toFixed(2)})`,
                `Last synced: ${lastUpdateLine}`,
                inSync ? 'Matches — accurate.' : "Doesn't match yet — normal if a swap completed in the last ~10 min (Discord's rename limit); worth checking if it's been longer.",
              ].join('\n'),
            });
          } else {
            embed.addFields({ name: 'Stats Channel Check', value: 'No stats channel configured yet — set one with /swapstatschannel.' });
          }

          return await interaction.editReply({ embeds: [embed] });
        }
        case 'swapexport': {
          if (!OWNER_IDS.has(interaction.user.id)) return interaction.reply({ embeds: [buildErrorEmbed('Owner only.')], flags: MessageFlags.Ephemeral });
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const r = await pool.query(`
            SELECT order_id, discord_user_id, send_asset, receive_asset, send_amount, expected_receive_amount,
                   actual_receive_amount, amount_in_usd, status, affiliate_fee_bps, fee_applied, created_at, completed_at
            FROM konvert_swap_orders ORDER BY created_at ASC
          `);
          if (r.rows.length === 0) return interaction.editReply({ embeds: [buildErrorEmbed('No orders yet — nothing to export.')] });
          const csvEscape = (v) => {
            const s = v === null || v === undefined ? '' : String(v);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          };
          const header = ['order_id', 'discord_user_id', 'send_asset', 'receive_asset', 'send_amount', 'expected_receive_amount', 'actual_receive_amount', 'amount_in_usd', 'status', 'affiliate_fee_bps', 'fee_applied', 'created_at', 'completed_at'];
          const lines = [header.join(',')];
          for (const row of r.rows) {
            lines.push(header.map((k) => csvEscape(row[k] instanceof Date ? row[k].toISOString() : row[k])).join(','));
          }
          const file = new AttachmentBuilder(Buffer.from(lines.join('\n'), 'utf8'), { name: `konvert-swap-orders-${new Date().toISOString().slice(0, 10)}.csv` });
          return interaction.editReply({ content: `${r.rows.length} orders exported.`, files: [file] });
        }
        case 'toggleswap': {
          if (!OWNER_IDS.has(interaction.user.id)) return interaction.reply({ embeds: [buildErrorEmbed('Owner only.')], flags: MessageFlags.Ephemeral });
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const enabled = await isSwapEnabled();
          await setSwapEnabled(!enabled);
          return await interaction.editReply({ embeds: [new EmbedBuilder().setColor(EMBED_COLOR).setDescription(`Swaps are now **${!enabled ? 'ENABLED' : 'DISABLED'}**.`)] });
        }
        case 'swappanel': return await handleSwapPanelCommand(interaction);
        case 'swaplookup': {
          if (!OWNER_IDS.has(interaction.user.id)) return interaction.reply({ embeds: [buildErrorEmbed('Owner only.')], flags: MessageFlags.Ephemeral });
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const oid = (interaction.options.getString('order_id') || '').trim();
          const dep = (interaction.options.getString('deposit_address') || '').trim();
          let order = null;
          if (oid && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(oid)) order = await getOrderById(oid);
          if (!order && dep) order = await getOrderByDepositAddress(dep);
          if (!order) return interaction.editReply({ embeds: [buildErrorEmbed('No order found — give a valid order ID or a deposit address.')] });
          try { await pollSingleOrder(order); } catch { /* show stored state */ }
          const fresh = await getOrderById(order.order_id);
          return interaction.editReply({ embeds: [buildAdminLookupEmbed(fresh)] });
        }
        case 'swapuser': {
          if (!OWNER_IDS.has(interaction.user.id)) return interaction.reply({ embeds: [buildErrorEmbed('Owner only.')], flags: MessageFlags.Ephemeral });
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const target = interaction.options.getUser('user', true);
          const orders = await getUserHistory(target.id, 10);
          if (orders.length === 0) return interaction.editReply({ embeds: [buildErrorEmbed(`No orders for ${target.tag}.`)] });
          const desc = orders.map((o) => {
            const st = STATUS_DISPLAY[o.status] || { emoji: '', label: o.status };
            return `${st.emoji} ${fmt(o.send_amount)} ${assetShort(o.send_asset)} → ${assetShort(o.receive_asset)}${o.amount_in_usd ? ` ($${Number(o.amount_in_usd).toFixed(2)})` : ''} · ${st.label}\n\`${o.order_id}\``;
          }).join('\n');
          return interaction.editReply({ embeds: [brand(new EmbedBuilder().setColor(EMBED_COLOR).setTitle(`Orders — ${target.tag}`).setDescription(desc.slice(0, 4000)).setFooter({ text: 'Use /swaplookup with an order ID for the full picture.' }).setTimestamp())] });
        }
        case 'swapfee': {
          if (!OWNER_IDS.has(interaction.user.id)) return interaction.reply({ embeds: [buildErrorEmbed('Owner only.')], flags: MessageFlags.Ephemeral });
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const target = interaction.options.getUser('user', true);
          const bps = interaction.options.getInteger('bps');
          if (bps === null) {
            const cleared = await clearFeeOverride(target.id);
            return interaction.editReply({ embeds: [new EmbedBuilder().setColor(EMBED_COLOR).setDescription(
              cleared ? `Cleared the custom rate for ${target.tag} — back to standard pricing (${formatBps(ONECLICK_FEE_BPS_HIGH_TIER)}–${formatBps(ONECLICK_FEE_BPS)}).` : `${target.tag} had no custom rate set.`
            )] });
          }
          await setFeeOverride(target.id, bps, interaction.user.id);
          return interaction.editReply({ embeds: [new EmbedBuilder().setColor(OK_COLOR).setDescription(
            `${target.tag} now pays **${formatBps(bps)}** on every swap${bps === 0 ? ' — completely free' : ''}, overriding standard pricing. Run \`/swapfee user:${target.tag}\` with no bps to remove this later.`
          )] });
        }
        case 'swapfeeall': {
          if (!OWNER_IDS.has(interaction.user.id)) return interaction.reply({ embeds: [buildErrorEmbed('Owner only.')], flags: MessageFlags.Ephemeral });
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const bps = interaction.options.getInteger('bps');
          if (bps === null) {
            await pool.query(`DELETE FROM konvert_swap_settings WHERE key IN ('global_fee_override_bps', 'global_fee_override_expires_at')`);
            return interaction.editReply({ embeds: [new EmbedBuilder().setColor(EMBED_COLOR).setDescription(
              `Global override turned off — back to standard pricing (${formatBps(ONECLICK_FEE_BPS_HIGH_TIER)}–${formatBps(ONECLICK_FEE_BPS)}) for everyone (individual /swapfee rates, if any, are untouched).`
            )] });
          }
          await setSetting('global_fee_override_bps', String(bps));
          // Explicit (non-expiring) here: clear any leftover expiry from a
          // PREVIOUS /swapfeetimed, so this doesn't inherit a stale cutoff.
          await pool.query(`DELETE FROM konvert_swap_settings WHERE key = 'global_fee_override_expires_at'`);
          return interaction.editReply({ embeds: [new EmbedBuilder().setColor(OK_COLOR).setDescription(
            `**Everyone** now pays **${formatBps(bps)}** on every swap${bps === 0 ? ' — completely free' : ''}, until you turn this off. Run \`/swapfeeall\` with no bps to go back to normal pricing. (Anyone with their own /swapfee rate keeps that instead.)`
          )] });
        }
        case 'swapfeetimed': {
          if (!OWNER_IDS.has(interaction.user.id)) return interaction.reply({ embeds: [buildErrorEmbed('Owner only.')], flags: MessageFlags.Ephemeral });
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const bps = interaction.options.getInteger('bps', true);
          const days = interaction.options.getNumber('days', true);
          const expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
          await setSetting('global_fee_override_bps', String(bps));
          await setSetting('global_fee_override_expires_at', String(expiresAt));
          const expiresUnix = Math.floor(expiresAt / 1000);
          return interaction.editReply({ embeds: [new EmbedBuilder().setColor(OK_COLOR).setDescription(
            `**Everyone** now pays **${formatBps(bps)}**${bps === 0 ? ' — completely free' : ''} until <t:${expiresUnix}:F> (<t:${expiresUnix}:R>), then it automatically goes back to standard pricing — no need to run anything to turn it off. (Run \`/swapfeeall\` with no bps anytime to end it early; anyone with their own /swapfee rate keeps that instead.)`
          )] });
        }
        case 'swapfeed': {
          if (!OWNER_IDS.has(interaction.user.id)) return interaction.reply({ embeds: [buildErrorEmbed('Owner only.')], flags: MessageFlags.Ephemeral });
          await setSetting('feed_channel_id', interaction.channelId);
          return interaction.reply({ embeds: [new EmbedBuilder().setColor(OK_COLOR).setDescription('Completed swaps will now post here.')], flags: MessageFlags.Ephemeral });
        }
        case 'swapstatschannel': {
          if (!OWNER_IDS.has(interaction.user.id)) return interaction.reply({ embeds: [buildErrorEmbed('Owner only.')], flags: MessageFlags.Ephemeral });
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const target = interaction.options.getChannel('channel', true);
          const canRename = target.permissionsFor?.(discordClient.user)?.has?.(PermissionFlagsBits.ManageChannels);
          await setSetting('stats_channel_id', target.id);
          await maybeUpdateStatsChannel(true); // immediate first update, bypassing the throttle
          return interaction.editReply({ embeds: [new EmbedBuilder().setColor(OK_COLOR).setDescription(
            `Set — ${target} now shows total swap volume and updates itself roughly every 10 minutes (Discord only allows channel renames that often).${canRename === false ? '\n\n⚠️ I might be missing **Manage Channels** in that specific channel — check its permissions if the name doesn\'t update.' : ''}`
          )] });
        }
        case 'swaptop': {
          await interaction.deferReply();
          const lb = buildLeaderboardEmbed(await getLeaderboard(10), await getStats());
          return interaction.editReply({ embeds: [lb] });
        }
        case 'swaprecord': {
          await interaction.deferReply();
          const record = await getBiggestSwap();
          if (!record) return interaction.editReply({ embeds: [brand(new EmbedBuilder().setColor(EMBED_COLOR).setTitle('🏆 Biggest Swap').setDescription('No completed swaps yet.'))] });
          return interaction.editReply({ embeds: [buildRecordEmbed(record)] });
        }
        case 'swaptoppin': {
          if (!OWNER_IDS.has(interaction.user.id)) return interaction.reply({ embeds: [buildErrorEmbed('Owner only.')], flags: MessageFlags.Ephemeral });
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const embed = buildLeaderboardEmbed(await getLeaderboard(10), await getStats());
          const msg = await interaction.channel.send({ embeds: [embed] });
          await setSetting('pinned_leaderboard_channel_id', interaction.channelId);
          await setSetting('pinned_leaderboard_message_id', msg.id);
          return interaction.editReply({ embeds: [new EmbedBuilder().setColor(OK_COLOR).setDescription('Live leaderboard posted — it updates itself from now on, no need to run this again unless you want to move it.')] });
        }
        case 'swaprecordpin': {
          if (!OWNER_IDS.has(interaction.user.id)) return interaction.reply({ embeds: [buildErrorEmbed('Owner only.')], flags: MessageFlags.Ephemeral });
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const record = await getBiggestSwap();
          const embed = record
            ? buildRecordEmbed(record)
            : brand(new EmbedBuilder().setColor(EMBED_COLOR).setTitle('🏆 Biggest Swap').setDescription('No completed swaps yet — this will update the moment one lands.'));
          const msg2 = await interaction.channel.send({ embeds: [embed] });
          await setSetting('pinned_record_channel_id', interaction.channelId);
          await setSetting('pinned_record_message_id', msg2.id);
          return interaction.editReply({ embeds: [new EmbedBuilder().setColor(OK_COLOR).setDescription('Live record card posted — it updates itself from now on.')] });
        }
        default: return;
      }
    } else if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'swap_send_select') return await handleCoinSelect(interaction, 'send');
      if (interaction.customId === 'swap_receive_select') return await handleCoinSelect(interaction, 'receive');
      return;
    } else if (interaction.isButton()) {
      const id = interaction.customId;
      if (id === 'swap_start_btn') return await startSwapFlow(interaction);
      if (id === 'swap_confirm_btn') return await handleConfirmButton(interaction);
      if (id === 'swap_cancel_btn') return await handleCancelButton(interaction);
      if (id === 'swap_refresh_btn') return await handleRefreshButton(interaction);
      if (id === 'swap_changeamount_btn') return await handleChangeAmountButton(interaction);
      if (id.startsWith('swap_status_btn:')) return await handleStatusButton(interaction, id.split(':')[1]);
      if (id.startsWith('swap_copy_btn:')) return await handleCopyButton(interaction, id.split(':')[1]);
      if (id.startsWith('swap_topup_btn:')) {
        const order = await getOrderById(id.split(':')[1]);
        if (!order) return interaction.reply({ embeds: [buildErrorEmbed('Order not found.')], flags: MessageFlags.Ephemeral });
        if (order.discord_user_id !== interaction.user.id && !OWNER_IDS.has(interaction.user.id)) {
          return interaction.reply({ embeds: [buildErrorEmbed("That order isn't yours.")], flags: MessageFlags.Ephemeral });
        }
        const dl = Math.floor(new Date(order.quote_expires_at).getTime() / 1000);
        await interaction.reply({ content: `Send the remaining ${assetShort(order.send_asset)} to the same address before <t:${dl}:t> — it completes automatically. Address below:`, flags: MessageFlags.Ephemeral });
        await interaction.followUp({ content: String(order.deposit_address), flags: MessageFlags.Ephemeral });
        if (order.memo) await interaction.followUp({ content: String(order.memo), flags: MessageFlags.Ephemeral });
        return;
      }
      if (id.startsWith('swap_refundme_btn:')) {
        const order = await getOrderById(id.split(':')[1]);
        if (!order) return interaction.reply({ embeds: [buildErrorEmbed('Order not found.')], flags: MessageFlags.Ephemeral });
        if (order.discord_user_id !== interaction.user.id && !OWNER_IDS.has(interaction.user.id)) {
          return interaction.reply({ embeds: [buildErrorEmbed("That order isn't yours.")], flags: MessageFlags.Ephemeral });
        }
        const updated = await updateOrderStatus(order.order_id, { refund_requested: true });
        await interaction.update({ components: [] }).catch(() => {});
        const dl = Math.floor(new Date(updated.quote_expires_at).getTime() / 1000);
        await interaction.channel?.send({ embeds: [new EmbedBuilder().setColor(EMBED_COLOR).setDescription(`↩️ Got it — don't send anything more. What you sent auto-returns to \`${updated.refund_address}\` shortly after <t:${dl}:t> (<t:${dl}:R>). I'll confirm here when the refund lands.`)] }).catch(() => {});
        return;
      }
      if (id.startsWith('swap_close_btn:')) {
        const order = await getOrderById(id.split(':')[1]);
        if (!order) return interaction.reply({ embeds: [buildErrorEmbed('Order not found.')], flags: MessageFlags.Ephemeral });
        if (order.discord_user_id !== interaction.user.id && !OWNER_IDS.has(interaction.user.id)) {
          return interaction.reply({ embeds: [buildErrorEmbed("That ticket isn't yours.")], flags: MessageFlags.Ephemeral });
        }
        await interaction.deferUpdate();
        await markTicketClosed(order.order_id);
        await closeTicketChannel(interaction.channelId, 'Thanks for swapping with Konvert. Closing…', order);
        return;
      }
      if (id === 'swap_retry_amount_btn') {
        return interaction.reply({ embeds: [buildErrorEmbed('This ticket is from an older version — type `cancel` and run /swap again.')], flags: MessageFlags.Ephemeral });
      }
      return;
    }
  } catch (err) {
    console.error(`Unhandled interaction error (${interaction.commandName || interaction.customId}):`, err);
    const errorEmbed = buildErrorEmbed('Something went wrong. Try again, or start a fresh /swap ticket.');
    try {
      if (interaction.deferred || interaction.replied) await interaction.editReply({ embeds: [errorEmbed] });
      else await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    } catch (replyErr) { console.error('Error reply failed:', replyErr.message); }
  }
});

discordClient.on(Events.Error, (err) => console.error('Discord client error:', err));
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));
process.on('uncaughtException', (err) => console.error('Uncaught exception:', err));
process.on('SIGTERM', async () => {
  console.log('SIGTERM — shutting down gracefully…');
  await pool.end().catch(() => {});
  discordClient.destroy();
  process.exit(0);
});

// ------------------------------------------------------------------- Startup

// This bot is a background worker (a Discord connection, not a website),
// but Railway's default health check still expects SOMETHING to answer
// HTTP on the assigned port -- without this, Railway can mark a perfectly
// working bot as "failed to respond" forever. This tiny server does
// nothing but say OK; it has zero effect on the actual bot logic.
function startHealthCheckServer() {
  const http = require('http');
  const port = process.env.PORT || 3000;
  http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Konvert Swap is running.');
  }).listen(port, () => {
    console.log(`Health check server listening on port ${port} (for Railway only -- not the bot's real interface).`);
  });
}

async function main() {
  startHealthCheckServer();
  try {
    await pool.query('SELECT 1');
    await initSchema();
    console.log('Database schema ready.');
  } catch (err) {
    console.error('Database init failed:', err);
    process.exit(1);
  }
  try {
    await discordClient.login(DISCORD_TOKEN);
  } catch (err) {
    if (String(err && err.message).toLowerCase().includes('disallowed intents')) {
      console.error('LOGIN FAILED: enable "MESSAGE CONTENT INTENT" for this bot in the Discord Developer Portal (Bot tab), then redeploy.');
    } else {
      console.error('Discord login failed:', err);
    }
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = {
  toBaseUnits, fromBaseUnits, parseAmountInput, matchCoinText, validateAddressForChain,
  computeSavingsUsd, savingsLine, costBreakdown, overpayLine, adjustUsdForActual, effectiveDeadline, fmt, adminHint, getOrderByDepositAddress, statusCheckAllowed, getBiggestSwap, isNewRecord, buildTranscriptText, pickFeeBps, orderFeePct, getSetting, setSetting, getUserTotalVolume, maybeReassignSingleHolderRole, OneClickApiError, coinEmoji, sendCoinComponents, receiveCoinComponents, buildChannelTranscript, sendFinalTranscript, scheduleDeadlinePoll, closeTicketChannel, discordClient, runCancel, getSavedAddress, saveAddress, getAllSavedAddresses, deleteSavedAddress, deleteAllSavedAddresses, promptForStep, handleTicketMessage, getFeeOverride, setFeeOverride, clearFeeOverride, getAutoSavePref, setAutoSavePref, formatVolumeShort, maybeUpdateStatsChannel, notifyIfChanged, confirmRow, handleChangeAmountButton, maybeExpireGlobalFeeOverride,
  getLeaderboard, getDailyStats, buildLeaderboardEmbed, buildRecordEmbed, progressBar, explorerLink, parseJsonbField, describeError,
  formatBps, mapOneClickStatus, firstHash, apiRequest, getOneClickQuote, getSwapStatus,
  fetchOneClickTokens, buildMenuCoins, tokenInfo, initSchema, insertOrder, getOrderById,
  getUserHistory, getActiveOrders, getOpenOrderChannelForUser, getLiveOrderForChannel,
  updateOrderStatus, markTicketClosed, getStats, isSwapEnabled, setSwapEnabled,
  createSession, getSession, updateSession, deleteSession, getOpenSessionChannelForUser,
  getStaleSessions, getClosableOrders, sanitizeChannelName, pollSingleOrder, pool,
  CURATED_COINS, OUR_FEE_PCT,
};
