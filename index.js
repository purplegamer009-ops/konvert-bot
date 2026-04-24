// ============================================================
//  KONVERT BOT -- Final Clean Version
//  Discord.js v14 | Railway Ready
// ============================================================
"use strict";

const {
  Client, GatewayIntentBits, Partials,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  SlashCommandBuilder, PermissionFlagsBits, ModalBuilder,
  TextInputBuilder, TextInputStyle, ChannelType, Events,
} = require("discord.js");
const { REST }   = require("@discordjs/rest");
const { Routes } = require("discord-api-types/v10");
const fetch = (...a) => import("node-fetch").then(({ default: f }) => f(...a));
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { google } = require("googleapis");

// ─── YOUTUBE SETUP ───────────────────────────────────────────
const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  "urn:ietf:wg:oauth:2.0:oob"
);
oauth2Client.setCredentials({ refresh_token: process.env.YOUTUBE_REFRESH_TOKEN });
const youtube = google.youtube({ version: "v3", auth: oauth2Client });

// ─── IMAGES ──────────────────────────────────────────────────
const IMG = {
  LOGO:    "https://i.imgur.com/GXwsQv0.png",
  BANNER:  "https://i.imgur.com/uVQ6hho.png",
  RATES:   "https://i.imgur.com/0zbG9Fc.png",
  FEE:     "https://i.imgur.com/o6bi905.png",
  RULES:   "https://i.imgur.com/CaBjEFU.png",
  TICKET:  "https://i.imgur.com/GasrfTC.png",
  WELCOME: "https://i.imgur.com/hSYrFai.png",
  DEAL:    "https://i.imgur.com/GuBspYH.png",
};

// ─── CONFIG ──────────────────────────────────────────────────
const CONFIG = {
  TOKEN:     process.env.DISCORD_TOKEN,
  CLIENT_ID: process.env.CLIENT_ID,
  GUILD_ID:  process.env.GUILD_ID,
  OWNER_IDS: (process.env.OWNER_IDS || "").split(",").map(s => s.trim()).filter(Boolean),
  STAFF_ROLE:      process.env.STAFF_ROLE_ID     || null,
  EXCHANGER_ROLE:  process.env.EXCHANGER_ROLE_ID || null,
  TICKET_CATEGORY: process.env.TICKET_CATEGORY_ID || null,
  VOUCH_CHANNEL:   process.env.VOUCH_CHANNEL_ID   || null,
  LOG_CHANNEL:     process.env.LOG_CHANNEL_ID     || null,
  RATES_CHANNEL:   process.env.RATES_CHANNEL_ID   || null,
  EXCHANGE_CHANNEL:"1463731676021784587",
  PASS_ROLE:       "1488344770035060786",
  SHORTS_CHANNEL:  process.env.SHORTS_CHANNEL_ID  || null,
  MIN_FEE: 5,
  COLOR:   0x7C4DFF,
  ROLES: {
    paypal:    process.env.ROLE_PAYPAL,
    cashapp:   process.env.ROLE_CASHAPP,
    zelle:     process.env.ROLE_ZELLE,
    interac:   process.env.ROLE_INTERAC,
    venmo:     process.env.ROLE_VENMO,
    applepay:  process.env.ROLE_APPLEPAY,
    skrill:    process.env.ROLE_SKRILL,
    revolut:   process.env.ROLE_REVOLUT,
    upi:       process.env.ROLE_UPI,
    chime:     process.env.ROLE_CHIME,
    bank:      process.env.ROLE_BANK,
    iban:      process.env.ROLE_IBAN,
    giftcard:  process.env.ROLE_GIFTCARD,
    wire:      process.env.ROLE_WIRE,
    googlepay: process.env.ROLE_GOOGLEPAY,
  },
};

// ─── CLIENT TIERS ────────────────────────────────────────────
const TIERS = [
  { min:10000, label:"Whale Client",    role:"1483159341899976905", emoji:"🐋" },
  { min:7000,  label:"Godly Client",   role:"1483159233049657550", emoji:"⚡" },
  { min:5000,  label:"Ethereal Client",role:"1483159184651325622", emoji:"✨" },
  { min:3000,  label:"Bear Client",    role:"1483159114782740540", emoji:"🐻" },
  { min:2000,  label:"Holy Client",    role:"1483159051872375015", emoji:"🔱" },
  { min:1000,  label:"Zombie Client",  role:"1478413185848709367", emoji:"🧟" },
  { min:500,   label:"Legend Client",  role:"1478064885161132092", emoji:"🏆" },
  { min:250,   label:"Tuff Client",    role:"1478412812236623986", emoji:"💪" },
  { min:100,   label:"Ghost Client",   role:"1488346819770581002", emoji:"👻" },
  { min:10,    label:"Client",         role:"1477752522608480442", emoji:"✅" },
  { min:0,     label:"New Client",     role:null,                   emoji:"🆕" },
];

function getTier(volume) {
  return TIERS.find(t => volume >= t.min) || TIERS[TIERS.length - 1];
}
function getNextTier(volume) {
  const idx = TIERS.findIndex(t => volume >= t.min);
  return idx > 0 ? TIERS[idx - 1] : null;
}
function progressBar(current, min, max, len = 12) {
  if (max <= min) return "▓".repeat(len);
  const pct  = Math.min((current - min) / (max - min), 1);
  const fill = Math.round(pct * len);
  return "▓".repeat(fill) + "░".repeat(len - fill) + ` ${Math.round(pct * 100)}%`;
}

async function applyTierRole(guild, userId, volume) {
  try {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return;
    const tier = getTier(volume);
    for (const t of TIERS) {
      if (t.role && member.roles.cache.has(t.role) && t.role !== tier.role) {
        await member.roles.remove(t.role).catch(() => {});
      }
    }
    if (tier.role && !member.roles.cache.has(tier.role)) {
      await member.roles.add(tier.role).catch(() => {});
    }
  } catch {}
}

// ─── PAYMENT METHODS ─────────────────────────────────────────
const METHODS = [
  { value:"paypal",    label:"PayPal"          },
  { value:"cashapp",   label:"Cash App"        },
  { value:"zelle",     label:"Zelle"           },
  { value:"interac",   label:"Interac"         },
  { value:"venmo",     label:"Venmo"           },
  { value:"applepay",  label:"Apple Pay"       },
  { value:"skrill",    label:"Skrill"          },
  { value:"revolut",   label:"Revolut"         },
  { value:"upi",       label:"UPI"             },
  { value:"chime",     label:"Chime"           },
  { value:"bank",      label:"Bank Transfer"   },
  { value:"iban",      label:"IBAN / SWIFT"    },
  { value:"giftcard",  label:"Gift Card"       },
  { value:"wire",      label:"Wire Transfer"   },
  { value:"googlepay", label:"Google Pay"      },
  { value:"crypto",    label:"Crypto to Crypto"},
];
const getMethod = v => METHODS.find(m => m.value === v) || null;

// ─── COINS ───────────────────────────────────────────────────
const COINS = ["BTC","ETH","SOL","LTC","USDT","USDC","XRP","BNB","ADA","DOGE","MATIC","AVAX","DOT","LINK","TRX","SHIB","UNI","ATOM","FTM","NEAR"];
const GECKO = {
  BTC:"bitcoin",ETH:"ethereum",SOL:"solana",LTC:"litecoin",USDT:"tether",
  USDC:"usd-coin",XRP:"ripple",BNB:"binancecoin",ADA:"cardano",DOGE:"dogecoin",
  MATIC:"matic-network",AVAX:"avalanche-2",DOT:"polkadot",LINK:"chainlink",
  TRX:"tron",SHIB:"shiba-inu",UNI:"uniswap",ATOM:"cosmos",FTM:"fantom",NEAR:"near",
};
const COIN_LOGO = {
  BTC:"https://assets.coingecko.com/coins/images/1/large/bitcoin.png",
  ETH:"https://assets.coingecko.com/coins/images/279/large/ethereum.png",
  SOL:"https://assets.coingecko.com/coins/images/4128/large/solana.png",
  LTC:"https://assets.coingecko.com/coins/images/2/large/litecoin.png",
  USDT:"https://assets.coingecko.com/coins/images/325/large/Tether.png",
  USDC:"https://assets.coingecko.com/coins/images/6319/large/usdc.png",
  XRP:"https://assets.coingecko.com/coins/images/44/large/xrp-symbol-white-128.png",
  BNB:"https://assets.coingecko.com/coins/images/825/large/binance-coin-logo.png",
  ADA:"https://assets.coingecko.com/coins/images/975/large/cardano.png",
  DOGE:"https://assets.coingecko.com/coins/images/5/large/dogecoin.png",
};

// ─── STORAGE ─────────────────────────────────────────────────
const DB = { tickets:"./tickets.json", wallets:"./wallets.json", blacklist:"./blacklist.json" };
const load = k => { try { return JSON.parse(fs.readFileSync(DB[k],"utf8")); } catch { return {}; } };
const save = (k,d) => { try { fs.writeFileSync(DB[k],JSON.stringify(d,null,2)); } catch {} };

// ─── HELPERS ─────────────────────────────────────────────────
const fmtUSD = n => {
  if (n >= 1) return `$${n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(8)}`;
};
function calcFee(usd, dir) {
  let r = usd < 150 ? 9 : usd < 500 ? 7 : usd < 1000 ? 6 : 5.5;
  if (dir === "receive") r = Math.max(r - 1, 0);
  return Math.max(usd * r / 100, CONFIG.MIN_FEE);
}
function feeRate(usd, dir) {
  let r = usd < 150 ? 9 : usd < 500 ? 7 : usd < 1000 ? 6 : 5.5;
  if (dir === "receive") r = Math.max(r - 1, 0);
  return r;
}
const base = title => new EmbedBuilder()
  .setColor(CONFIG.COLOR)
  .setAuthor({ name:"Konvert", iconURL:IMG.LOGO })
  .setTitle(title)
  .setTimestamp();

function log(guild, msg) {
  if (!CONFIG.LOG_CHANNEL || !guild) return;
  const ch = guild.channels.cache.get(CONFIG.LOG_CHANNEL);
  if (ch) ch.send({ embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setDescription("```"+msg+"```").setTimestamp()] }).catch(()=>{});
}

async function getPrice(coin) {
  try {
    const id = GECKO[coin]; if (!id) return null;
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`,{signal:AbortSignal.timeout(6000)});
    const d = await r.json();
    return d[id]?.usd || null;
  } catch { return null; }
}

// ─── CLIENT ──────────────────────────────────────────────────
const client = new Client({
  intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent,GatewayIntentBits.GuildMembers],
  partials:[Partials.Channel],
});
const state = { pending:{}, mineGames:{}, cooldowns:{}, alerts:[], passes:{} };

// ─── COMMANDS ────────────────────────────────────────────────
const COMMANDS = [
  new SlashCommandBuilder().setName("rates").setDescription("View live crypto rates"),
  new SlashCommandBuilder().setName("fee").setDescription("Calculate your Konvert fee").addNumberOption(o=>o.setName("amount_usd").setDescription("Amount in USD").setRequired(true)),
  new SlashCommandBuilder().setName("price").setDescription("Quick live price for any coin").addStringOption(o=>o.setName("coin").setDescription("Coin (BTC, ETH, SOL…)").setRequired(true)),
  new SlashCommandBuilder().setName("convert").setDescription("Convert between crypto and fiat").addNumberOption(o=>o.setName("amount").setDescription("Amount").setRequired(true)).addStringOption(o=>o.setName("from").setDescription("From (BTC, USD…)").setRequired(true)).addStringOption(o=>o.setName("to").setDescription("To (ETH, CAD…)").setRequired(true)),
  new SlashCommandBuilder().setName("stats").setDescription("View exchange stats").addUserOption(o=>o.setName("user").setDescription("User (leave blank for yourself)").setRequired(false)),
  new SlashCommandBuilder().setName("leaderboard").setDescription("Top traders by volume"),
  new SlashCommandBuilder().setName("market").setDescription("Live market summary -- top movers"),
  new SlashCommandBuilder().setName("wallets").setDescription("View Konvert deposit wallet addresses"),
  new SlashCommandBuilder().setName("mm").setDescription("Middleman guide"),
  new SlashCommandBuilder().setName("mine").setDescription("Find 3 diamonds to win a free exchange pass"),
  new SlashCommandBuilder().setName("alert").setDescription("Get alerted when a coin hits a price").addStringOption(o=>o.setName("coin").setDescription("Coin").setRequired(true)).addNumberOption(o=>o.setName("price").setDescription("Target price USD").setRequired(true)).addStringOption(o=>o.setName("direction").setDescription("above or below").setRequired(true).addChoices({name:"Above",value:"above"},{name:"Below",value:"below"})),
  new SlashCommandBuilder().setName("ticket").setDescription("Check your open ticket status"),
  new SlashCommandBuilder().setName("howto").setDescription("How to use Konvert Exchange"),
  new SlashCommandBuilder().setName("ping").setDescription("Check bot status and latency"),
  new SlashCommandBuilder().setName("supported").setDescription("All supported payment methods and coins"),
  new SlashCommandBuilder().setName("review").setDescription("Leave a review for Konvert"),
  new SlashCommandBuilder().setName("remind").setDescription("Set a personal reminder").addIntegerOption(o=>o.setName("minutes").setDescription("Minutes from now").setRequired(true)).addStringOption(o=>o.setName("message").setDescription("What to remind you about").setRequired(true)),
  new SlashCommandBuilder().setName("vouch").setDescription("Manually record a completed trade").addUserOption(o=>o.setName("client").setDescription("The client").setRequired(true)).addUserOption(o=>o.setName("exchanger").setDescription("The exchanger").setRequired(true)).addStringOption(o=>o.setName("message").setDescription("Review message").setRequired(true)).addStringOption(o=>o.setName("method").setDescription("Payment method").setRequired(true)).addNumberOption(o=>o.setName("amount").setDescription("Trade amount USD").setRequired(true)).addIntegerOption(o=>o.setName("rating").setDescription("Rating 1-5").setMinValue(1).setMaxValue(5).setRequired(false)),
  new SlashCommandBuilder().setName("postexchange").setDescription("[Owner] Post the exchange embed").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("postsupport").setDescription("[Owner] Post the support embed").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("postmm").setDescription("[Owner] Post the MM info embed").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("calc").setDescription("[Owner] Force-post live rates now").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("setwallet").setDescription("[Owner] Update a deposit wallet").addStringOption(o=>o.setName("coin").setDescription("Coin").setRequired(true)).addStringOption(o=>o.setName("address").setDescription("New address").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("announce").setDescription("[Owner] Post an announcement").addStringOption(o=>o.setName("message").setDescription("Message").setRequired(true)).addStringOption(o=>o.setName("channel").setDescription("Channel ID").setRequired(true)).addStringOption(o=>o.setName("ping").setDescription("everyone / here / none").setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("blacklist").setDescription("[Owner] Blacklist a user").addUserOption(o=>o.setName("user").setDescription("User").setRequired(true)).addStringOption(o=>o.setName("reason").setDescription("Reason").setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("unblacklist").setDescription("[Owner] Remove blacklist").addUserOption(o=>o.setName("user").setDescription("User").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("closeticket").setDescription("[Owner] Close this ticket").addStringOption(o=>o.setName("reason").setDescription("Reason").setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("cancelticket").setDescription("[Owner] Cancel this ticket").addStringOption(o=>o.setName("reason").setDescription("Reason").setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("openticket").setDescription("[Owner] Open ticket to all exchangers").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("note").setDescription("[Owner] Add a staff note to this ticket").addStringOption(o=>o.setName("text").setDescription("Note").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("tradelog").setDescription("[Owner] Recent completed trades").addIntegerOption(o=>o.setName("limit").setDescription("How many (max 10)").setMinValue(1).setMaxValue(10).setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("volume").setDescription("[Owner] Server volume stats").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("snapshot").setDescription("[Owner] Full server snapshot").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("exchangerboard").setDescription("[Owner] Exchanger leaderboard").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("thankclient").setDescription("[Owner] Send a thank-you DM to a client").addUserOption(o=>o.setName("client").setDescription("Client to thank").setRequired(true)).addNumberOption(o=>o.setName("amount").setDescription("Trade amount USD").setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("passes").setDescription("[Owner] View exchange pass holders").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("postinfo").setDescription("[Owner] Post the Info embed in this channel").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("posttos").setDescription("[Owner] Post the Terms of Service embed in this channel").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("postlinks").setDescription("[Owner] Post the Official Links embed in this channel").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("lookup").setDescription("[Owner] Look up a past ticket by channel name").addStringOption(o=>o.setName("name").setDescription("Ticket channel name").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("uptime").setDescription("Check how long the bot has been running"),
  new SlashCommandBuilder().setName("postkonvault").setDescription("[Owner] Post the Konvault wagering server invite embed").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version:"10" }).setToken(CONFIG.TOKEN);
  console.log("Registering commands…");
  await rest.put(Routes.applicationGuildCommands(CONFIG.CLIENT_ID, CONFIG.GUILD_ID), { body:COMMANDS });
  console.log("Commands registered.");
}

// ─── MAIN EMBED ──────────────────────────────────────────────
function mainEmbed() {
  return new EmbedBuilder()
    .setColor(CONFIG.COLOR)
    .setAuthor({ name:"Konvert", iconURL:IMG.LOGO })
    .setTitle("Konvert Exchange")
    .setDescription(
      "**Fast. Safe. Simple.**\n" +
      "Exchange any crypto with any major payment method.\n" +
      "Open a ticket instantly -- a verified handler will assist you.\n\u200b"
    )
    .addFields(
      { name:"💸  Fee",      value:"5% - 9%  \u00b7  Tiered by amount\nMin fee $5 on any deal", inline:true },
      { name:"⚡  Speed",    value:"**Usually < 10 min**\nOften faster",                    inline:true },
      { name:"🤝  Support",  value:"**24/7 Agents**\nAlways available",                    inline:true },
      { name:"💳  Methods",  value:"PayPal  \u00b7  Cash App  \u00b7  Zelle  \u00b7  Interac  \u00b7  Venmo  \u00b7  Apple Pay  \u00b7  Bank  \u00b7  Crypto to Crypto  \u00b7  and more", inline:false },
      { name:"🪙  Crypto",   value:"BTC  \u00b7  ETH  \u00b7  SOL  \u00b7  LTC  \u00b7  USDT  \u00b7  USDC  \u00b7  XRP  \u00b7  BNB  \u00b7  and all major coins", inline:false },
    )
    .setImage(IMG.BANNER)
    .setFooter({ text:"Konvert  •  Click Exchange Now to begin" });
}
function mainButtons() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("btn_exchange_now").setLabel("Exchange Now").setEmoji("📩").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("btn_fee_calc").setLabel("Calculate Fee").setEmoji("💰").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("btn_rates_quick").setLabel("Live Rates").setEmoji("📈").setStyle(ButtonStyle.Secondary),
  )];
}

// ─── STEP EMBEDS ─────────────────────────────────────────────
function step1Embed() {
  return new EmbedBuilder()
    .setColor(CONFIG.COLOR).setAuthor({ name:"Konvert", iconURL:IMG.LOGO })
    .setTitle("Step 1 -- Select Payment Method")
    .setThumbnail(IMG.LOGO)
    .setDescription("Choose how you'd like to pay or receive.\nA private ticket with the right handler opens instantly.\n\u200b")
    .setFooter({ text:"Step 1 of 3  •  Konvert" });
}
function step2Embed(method) {
  const m = getMethod(method);
  if (method === "crypto") {
    return new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({ name:"Konvert", iconURL:IMG.LOGO })
      .setTitle("Step 2 -- Crypto to Crypto")
      .setDescription("**Send one coin, receive another.**\nFor example: send SOL, receive BTC. Or send USDT, receive ETH.\n\nSelect your direction below -- which side are you on?")
      .setFooter({ text:"Step 2 of 3  •  Konvert" });
  }
  return new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({ name:"Konvert", iconURL:IMG.LOGO })
    .setTitle(`Step 2 -- ${m.label}`)
    .setDescription(
      `**Send Crypto → Receive ${m.label}**\nYou send crypto. We pay you via ${m.label}.\n\n` +
      `**Send ${m.label} → Receive Crypto**\nYou pay via ${m.label}. We send crypto to your wallet.`
    )
    .setFooter({ text:"Step 2 of 3  •  Konvert" });
}

// ─── RATES EMBED ─────────────────────────────────────────────
async function buildRatesEmbed() {
  const ids = COINS.map(c => GECKO[c]||c.toLowerCase()).join(",");
  const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd,cad&include_24hr_change=true`,{signal:AbortSignal.timeout(8000)});
  const p   = await res.json();
  const lines = COINS.map(coin => {
    const d = p[GECKO[coin]||coin.toLowerCase()];
    if (!d) return null;
    const usd = d.usd.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
    const cad = d.cad.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
    const ch  = parseFloat(d.usd_24h_change||0).toFixed(2);
    return `\`${coin.padEnd(5)}\` **$${usd}**  \u00b7  CA$${cad}  \u00b7  ${Number(ch)>=0?"▲":"▼"} ${ch}%`;
  }).filter(Boolean).join("\n");
  return new EmbedBuilder()
    .setColor(CONFIG.COLOR).setAuthor({ name:"Konvert", iconURL:IMG.LOGO })
    .setTitle("Live Rates").setThumbnail(IMG.LOGO)
    .setDescription(lines + "\n\u200b")
    .addFields(
      { name:"Exchange", value:`Open a ticket in <#${CONFIG.EXCHANGE_CHANNEL}>`,   inline:true },
      { name:"Tip",      value:"Type **$BTC**, **$ETH** etc. for a quick lookup",  inline:true },
    )
    .setImage(IMG.RATES)
    .setFooter({ text:"Updates every 10 min  •  Use /calc to post now  •  Konvert" })
    .setTimestamp();
}

// ─── MINE GRID ───────────────────────────────────────────────
function buildMineGrid(userId, game) {
  const rows = [];
  for (let r = 0; r < 5; r++) {
    const row = new ActionRowBuilder();
    for (let c = 0; c < 5; c++) {
      const idx      = r * 5 + c;
      const revealed = game.revealed.includes(idx);
      const isDiamond= game.diamonds.includes(idx);
      const isBomb   = game.bombs.includes(idx);
      let label = "?", style = ButtonStyle.Secondary, disabled = false;
      if (revealed || game.over) {
        if (isDiamond)    { label = "💎"; style = ButtonStyle.Success; }
        else if (isBomb)  { label = "💣"; style = ButtonStyle.Danger; }
        else              { label = "\u00b7";  style = ButtonStyle.Secondary; }
        disabled = true;
      }
      row.addComponents(
        new ButtonBuilder().setCustomId(`mine_cell_${userId}_${idx}`).setLabel(label).setStyle(style).setDisabled(disabled)
      );
    }
    rows.push(row);
  }
  return rows;
}

// ─── DEAL COMPLETE EMBED ─────────────────────────────────────
function buildDealEmbed({ clientId, exchangerId, method, amountUSD, direction, coin, message, rating }) {
  const stars  = "★".repeat(Math.min(Math.max(rating||5,1),5));
  const dirStr = direction && coin && method
    ? (direction==="send" ? `${coin} → ${method}` : `${method} → ${coin}`)
    : null;
  const embed = new EmbedBuilder()
    .setColor(CONFIG.COLOR)
    .setAuthor({ name:"Konvert", iconURL:IMG.LOGO })
    .setTitle("Deal Complete")
    .setDescription("Trade verified and completed on Konvert Exchange.\n\u200b")
    .addFields(
      { name:"Client",    value:`<@${clientId}>`,    inline:true },
      { name:"Exchanger", value:`<@${exchangerId}>`, inline:true },
      { name:"Rating",    value:stars,               inline:true },
    );
  if (method)           embed.addFields({ name:"Method",    value:`**${method}**`,          inline:true });
  if (amountUSD)        embed.addFields({ name:"Amount",    value:`**${fmtUSD(amountUSD)}**`, inline:true });
  if (dirStr)           embed.addFields({ name:"Direction", value:dirStr,                   inline:true });
  if (coin && !dirStr)  embed.addFields({ name:"Coin",      value:`**${coin}**`,            inline:true });
  if (message)          embed.addFields({ name:"Review",    value:message,                  inline:false });
  embed.setImage(IMG.DEAL).setTimestamp().setFooter({ text:"Konvert  •  Verified Trade" });
  return embed;
}

async function postVouch(guild, data) {
  if (!CONFIG.VOUCH_CHANNEL) return;
  const ch = guild.channels.cache.get(CONFIG.VOUCH_CHANNEL);
  if (!ch) return;
  await ch.send({ embeds:[buildDealEmbed(data)] });
}

// ─── TICKET CREATION ─────────────────────────────────────────
async function createTicket(interaction, method, direction, amountUSD, coin, walletInfo, notes) {
  const guild   = interaction.guild;
  const user    = interaction.user;
  const m       = getMethod(method);
  const tickets = load("tickets");
  const existing = Object.entries(tickets).find(([,t]) => t.userId===user.id && t.status==="open");
  if (existing) {
    await interaction.editReply({ content:`You already have an open ticket: <#${existing[0]}>`, embeds:[], components:[] });
    return null;
  }
  const feeUSD   = calcFee(amountUSD, direction);
  const rate     = feeRate(amountUSD, direction);
  const receiveU = amountUSD - feeUSD;
  let coinAmt = null;
  try { const price = await getPrice(coin); if (price) coinAmt = (receiveU/price).toFixed(6); } catch {}

  const sendLabel    = direction==="send"
    ? `**${coin}** worth ${fmtUSD(amountUSD)}`
    : `${fmtUSD(amountUSD)} via ${m.label}`;
  const receiveLabel = direction==="send"
    ? `${fmtUSD(receiveU)} via ${m.label}`
    : receiveU<5 ? "To be discussed" : coinAmt ? `${coinAmt} ${coin}` : `${fmtUSD(receiveU)} worth of ${coin}`;

  const perms = [
    { id:guild.roles.everyone, deny:[PermissionFlagsBits.ViewChannel] },
    { id:user.id, allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory] },
  ];
  if (CONFIG.STAFF_ROLE) perms.push({ id:CONFIG.STAFF_ROLE, allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.ManageChannels] });
  const mRoleId = CONFIG.ROLES[m.value];
  if (mRoleId && mRoleId!==CONFIG.STAFF_ROLE) perms.push({ id:mRoleId, allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory] });
  for (const oid of CONFIG.OWNER_IDS) perms.push({ id:oid, allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.ManageChannels] });

  let ch;
  try {
    ch = await guild.channels.create({
      name:`${m.value}-${user.username.replace(/[^a-z0-9]/gi,"").toLowerCase().slice(0,4)}`,
      type:ChannelType.GuildText, parent:CONFIG.TICKET_CATEGORY||null, permissionOverwrites:perms,
    });
  } catch (err) {
    await interaction.editReply({ content:`Failed to create ticket: ${err.message}`, embeds:[], components:[] });
    return null;
  }

  const ticketEmbed = new EmbedBuilder()
    .setColor(CONFIG.COLOR).setAuthor({ name:"Konvert", iconURL:IMG.LOGO })
    .setTitle(`${m.label} Exchange`).setThumbnail(COIN_LOGO[coin]||IMG.LOGO)
    .setDescription(`**Welcome, <@${user.id}>**\n\nYour ticket is open. A **${m.label}** handler has been notified.\n\u200b`)
    .addFields(
      { name:"__Sending__",   value:`**${sendLabel}**`,                    inline:true },
      { name:"__Receiving__", value:`**${receiveLabel}**`,                 inline:true },
      { name:"__Fee__",       value:`**${rate}%**  --  ${fmtUSD(feeUSD)}`, inline:true },
      { name:direction==="send" ? `__Your ${m.label} Details__` : "__Your Receiving Wallet__", value:`\`${walletInfo}\``, inline:false },
    );
  if (notes) ticketEmbed.addFields({ name:"Notes", value:notes, inline:false });
  ticketEmbed.setImage(IMG.TICKET).setTimestamp().setFooter({ text:"Konvert  •  All communication stays in this ticket" });

  const rulesEmbed = new EmbedBuilder()
    .setColor(CONFIG.COLOR).setTitle("Before You Proceed")
    .setDescription(
      "**Middleman required on all trades.**\n" +
      "Agree on a trusted MM with your exchanger before sending anything.\n\n" +
      "**Do not go first** unless **@jswaps** or **@3uce** explicitly says so in this ticket.\n\n" +
      "__Staff will **never** DM you first.__ Anyone claiming to be Konvert in DMs is an impersonator.\n" +
      "All communication stays **in this ticket only.**"
    )
    .setImage(IMG.RULES).setFooter({ text:"Konvert  •  Stay safe, stay in this ticket" });

  const btns = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("btn_done").setLabel("Mark Trade Complete").setEmoji("✅").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("btn_close").setLabel("Close Ticket").setEmoji("🔒").setStyle(ButtonStyle.Danger),
  );
  await ch.send({ content:`<@${user.id}>`, embeds:[ticketEmbed, rulesEmbed], components:[btns] });
  const pings = [];
  if (mRoleId) pings.push(`<@&${mRoleId}>`);
  if (CONFIG.STAFF_ROLE && CONFIG.STAFF_ROLE!==mRoleId) pings.push(`<@&${CONFIG.STAFF_ROLE}>`);
  if (pings.length) await ch.send(`${pings.join(" ")} -- New **${m.label}** ticket!`);

  const t = load("tickets");
  t[ch.id] = { userId:user.id, userTag:user.tag, method, direction, coin, amountUSD, feeUSD, walletInfo, notes:notes||"", status:"open", createdAt:Date.now() };
  save("tickets", t);
  log(guild, `TICKET: #${ch.name} | ${user.tag} | ${m.label} | ${fmtUSD(amountUSD)} | ${coin}`);
  return ch;
}

// ─── CLOSE TICKET ────────────────────────────────────────────
async function doCloseTicket(channel, guild, closedBy, reason) {
  const tickets = load("tickets");
  if (tickets[channel.id]) {
    tickets[channel.id].status  = "closed";
    tickets[channel.id].closedAt = Date.now();
    save("tickets", tickets);
  }
  try {
    const msgs  = await channel.messages.fetch({ limit:100 });
    const lines = [...msgs.values()].reverse()
      .map(m=>`[${new Date(m.createdTimestamp).toISOString()}] ${m.author.tag}: ${m.content||"[embed]"}`)
      .join("\n");
    const fname = `transcript-${channel.name}-${Date.now()}.txt`;
    const fpath = `./${fname}`;
    fs.writeFileSync(fpath, lines);
    if (CONFIG.LOG_CHANNEL) {
      const lch = guild.channels.cache.get(CONFIG.LOG_CHANNEL);
      if (lch) await lch.send({ content:`Transcript: **#${channel.name}** closed by ${closedBy.tag}. Reason: ${reason}`, files:[{attachment:fpath,name:fname}] });
    }
    if (tickets[channel.id]) {
      try {
        const member = await guild.members.fetch(tickets[channel.id].userId).catch(()=>null);
        if (member) {
          const f2=`tr-dm-${channel.name}.txt`, p2=`./${f2}`;
          fs.writeFileSync(p2, lines);
          await member.send({ content:"Your Konvert ticket has been closed. Transcript attached:", files:[{attachment:p2,name:f2}] }).catch(()=>{});
          fs.unlinkSync(p2);
        }
      } catch {}
    }
    for (const oid of CONFIG.OWNER_IDS) {
      try {
        const owner = await guild.members.fetch(oid).then(m=>m.user).catch(()=>null);
        if (owner && owner.id !== closedBy.id) {
          const f3=`tr-owner-${channel.name}.txt`, p3=`./${f3}`;
          fs.writeFileSync(p3, lines);
          await owner.send({ content:`Transcript: **#${channel.name}** | Closed by: ${closedBy.tag}`, files:[{attachment:p3,name:f3}] }).catch(()=>{});
          fs.unlinkSync(p3);
        }
      } catch {}
    }
    fs.unlinkSync(fpath);
  } catch {}
  log(guild, `CLOSED: #${channel.name} by ${closedBy.tag} -- ${reason}`);
}

// ─── GYM MOTIVEZ CAPTIONS ────────────────────────────────────
const GYM_CAPTIONS = [
  "No days off. No excuses. Just results. 💪 Subscribe for daily gym motivation!",
  "Your only competition is who you were yesterday. 🔥 Drop a 💪 if you're grinding!",
  "Pain is temporary. Glory is forever. Subscribe and stay motivated every day!",
  "The gym doesn't care about your feelings. Show up anyway. 💯 Subscribe for more!",
  "Every rep counts. Every set matters. Every day is a chance to be better. 🔥 Subscribe!",
  "Champions aren't born. They're built in the gym. 💪 Subscribe for daily fire!",
  "You don't get what you wish for. You get what you work for. Subscribe now! 🔥",
  "Beast mode activated. 💪 Subscribe to @GymMotivez for daily motivation!",
  "The pain you feel today is the strength you'll feel tomorrow. 🔥 Subscribe!",
  "Sweat now. Shine later. 💪 Subscribe to @GymMotivez and never miss a drop!",
  "Weak people give up. Strong people show up. 💪 Subscribe to @GymMotivez!",
  "Your body can handle almost anything. It's your mind you have to convince. 🔥 Subscribe!",
  "One more rep. One more set. One step closer. 💪 Subscribe to @GymMotivez!",
  "The only bad workout is the one that didn't happen. 🔥 Subscribe for daily fire!",
  "Fall in love with the process and the results will come. 💪 Subscribe now!",
];

// ─── YOUTUBE UPLOAD HANDLER ──────────────────────────────────
client.on(Events.MessageCreate, async message => {
  if (CONFIG.SHORTS_CHANNEL && message.channel.id === CONFIG.SHORTS_CHANNEL && !message.author.bot) {
    const attachment = message.attachments.find(a => a.contentType?.startsWith("video/"));
    if (attachment) {
      await message.react("⏳");
      const filePath = path.join("/tmp", attachment.name);
      try {
        const writer = fs.createWriteStream(filePath);
        const response = await axios({ url: attachment.url, method: "GET", responseType: "stream" });
        response.data.pipe(writer);
        await new Promise((resolve, reject) => { writer.on("finish", resolve); writer.on("error", reject); });
        const rawTitle = attachment.name.replace(/\.[^/.]+$/, "");
        const randomCaption = GYM_CAPTIONS[Math.floor(Math.random() * GYM_CAPTIONS.length)];
        const description = `${randomCaption}\n\n🔔 Subscribe to @GymMotivez for daily gym motivation!\n👊 Like & Share if this fired you up!\n💪 Comment your workout below!\n\n#GymMotivation #GymLife #Fitness #Workout #FitnessMotivation #GymMotivez #Bodybuilding #GymTok #FitLife #Grind #NoExcuses #BeastMode #WorkoutMotivation #GymShorts #FitnessShorts #Gains #LiftHeavy #GymCommunity #FitnessTok #Sweat #Hustle #GymGoals #MuscleMotivation #TrainHard #NeverGiveUp`;
        const res = await youtube.videos.insert({
          part: ["snippet", "status"],
          requestBody: {
            snippet: {
              title: `${rawTitle} 💪 #GymMotivation #Shorts`,
              description,
              tags: ["gym motivation","gym life","fitness motivation","workout motivation","bodybuilding","gym shorts","fitness shorts","no excuses","beast mode","grind","gym goals","muscle motivation","train hard","never give up","gym community","fit life","gains","lift heavy","sweat","hustle","gymtok","fitnesstok","gym","workout","fitness"],
              categoryId: "17",
            },
            status: { privacyStatus: "public" },
          },
          media: { body: fs.createReadStream(filePath) },
        });
        await message.react("✅");
        await message.reply(`✅ Posted to YouTube: https://youtube.com/watch?v=${res.data.id}`);
        fs.unlinkSync(filePath);
      } catch (err) {
        await message.react("❌");
        await message.reply(`❌ Upload failed: ${err.message}`);
        try { fs.unlinkSync(filePath); } catch {}
      }
      return;
    }
  }

  if (message.author.bot) return;
  const match = message.content.trim().match(/^\$([A-Za-z]{2,10})$/i);
  if (!match) return;
  const coin = match[1].toUpperCase();
  if (!COINS.includes(coin)) return;
  const id = GECKO[coin]; if (!id) return;
  let d = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd,cad,eur&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`,{signal:AbortSignal.timeout(6000)});
      if (!res.ok) continue;
      const json = await res.json();
      if (json[id]?.usd){ d = json[id]; break; }
    } catch {}
    await new Promise(r=>setTimeout(r,800));
  }
  if (!d) return;
  const fmt = n => { if(n>=1) return n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}); if(n>=0.01) return n.toFixed(4); return n.toFixed(8); };
  const ch2 = parseFloat(d.usd_24h_change||0);
  const mcap = d.usd_market_cap ? `$${(d.usd_market_cap/1e9).toFixed(2)}B` : "--";
  const vol  = d.usd_24h_vol    ? `$${(d.usd_24h_vol/1e9).toFixed(2)}B`    : "--";
  const fee  = calcFee(Math.max(d.usd,1),"send");
  const rate = feeRate(Math.max(d.usd,1),"send");
  await message.reply({ embeds:[new EmbedBuilder().setColor(CONFIG.COLOR)
    .setAuthor({ name:"Konvert  •  Live Price", iconURL:IMG.LOGO })
    .setTitle(`${coin}  --  $${fmt(d.usd)}`).setThumbnail(COIN_LOGO[coin]||IMG.LOGO)
    .setDescription(`${ch2>=0?"▲":"▼"} **${ch2.toFixed(2)}%** in the last 24 hours\n\u200b`)
    .addFields(
      { name:"USD",         value:`**$${fmt(d.usd)}**`,           inline:true },
      { name:"CAD",         value:`CA$${fmt(d.cad)}`,             inline:true },
      { name:"EUR",         value:`€${fmt(d.eur)}`,               inline:true },
      { name:"Market Cap",  value:mcap,                           inline:true },
      { name:"24h Volume",  value:vol,                            inline:true },
      { name:"Konvert Fee", value:`${rate}%  --  **${fmtUSD(fee)}**`, inline:true },
    ).setFooter({ text:`Konvert  •  /price ${coin} for full details` }).setTimestamp()] }).catch(()=>{});
});

// ─── INTERACTION HANDLER ─────────────────────────────────────
client.on(Events.InteractionCreate, async interaction => {
  try {

    if (interaction.isChatInputCommand()) {
      const cmd = interaction.commandName;

      if (cmd === "postexchange") {
        await interaction.channel.send({ embeds:[mainEmbed()], components:mainButtons() });
        return interaction.reply({ content:"Exchange embed posted.", ephemeral:true });
      }

      if (cmd === "postsupport") {
        const embed = new EmbedBuilder()
          .setColor(CONFIG.COLOR).setAuthor({ name:"Konvert", iconURL:IMG.LOGO })
          .setTitle("Support").setThumbnail(IMG.LOGO)
          .setDescription(
            "This channel is for **support tickets only**.\n\n" +
            `For exchanges, head to <#${CONFIG.EXCHANGE_CHANNEL}>.\n\n` +
            "**What to include in your support request:**\n" +
            "\u00b7 What you need help with\n\u00b7 Any error messages or screenshots\n" +
            "\u00b7 What you have already tried\n\u00b7 A full explanation of what happened\n\u200b"
          )
          .setFooter({ text:"Konvert  •  Support" });
        await interaction.channel.send({ embeds:[embed], components:[new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("btn_support_ticket").setLabel("Open Support Ticket").setEmoji("🎫").setStyle(ButtonStyle.Primary)
        )] });
        return interaction.reply({ content:"Support embed posted.", ephemeral:true });
      }

      if (cmd === "postmm") {
        const embed = new EmbedBuilder()
          .setColor(CONFIG.COLOR).setAuthor({ name:"Konvert", iconURL:IMG.LOGO })
          .setTitle("Middleman Information").setThumbnail(IMG.LOGO)
          .setDescription(
            "**Konvert officially partners with Astro MM** to ensure all deals go smoothly.\n\n" +
            "**How It Works:**\n" +
            `**1.** Open a ticket in <#${CONFIG.EXCHANGE_CHANNEL}>\n` +
            "**2.** Get a quote for your exchange\n" +
            "**3.** If terms are agreed on, open an MM ticket on Astro MM\n" +
            "**4.** Complete the exchange safely\n\u200b"
          )
          .addFields(
            { name:"Important", value:"**Do NOT go first** without using Astro MM, unless explicitly advised by an owner in your ticket.", inline:false },
            { name:"Astro MM",  value:"Click the button below to join the Astro MM server.", inline:false },
          )
          .setImage(IMG.BANNER)
          .setFooter({ text:"Konvert  •  Official Escrow Partner: Astro MM" });
        const mmBtn = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel("Join Astro MM").setEmoji("🤝").setStyle(ButtonStyle.Link).setURL("https://discord.gg/astromm")
        );
        await interaction.channel.send({ embeds:[embed], components:[mmBtn] });
        return interaction.reply({ content:"MM embed posted.", ephemeral:true });
      }

      if (cmd === "rates") {
        await interaction.deferReply();
        return interaction.editReply({ embeds:[await buildRatesEmbed()], components:[new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("btn_refresh_rates").setLabel("Refresh").setStyle(ButtonStyle.Secondary)
        )] });
      }

      if (cmd === "fee") {
        const amt=interaction.options.getNumber("amount_usd");
        const fS=calcFee(amt,"send"),rS=feeRate(amt,"send");
        const fR=calcFee(amt,"receive"),rR=feeRate(amt,"receive");
        return interaction.reply({ embeds:[base("Fee Calculator").setThumbnail(IMG.LOGO)
          .setDescription(`Estimate for **${fmtUSD(amt)}**\n*Final fee may vary slightly.*\n\u200b`)
          .addFields(
            { name:"Fiat → Crypto", value:`Rate: **${rS}%**\nFee: **${fmtUSD(fS)}**\nYou receive: **${fmtUSD(amt-fS)}**`, inline:true },
            { name:"Crypto → Fiat", value:`Rate: **${rR}%**\nFee: **${fmtUSD(fR)}**\nYou receive: **${fmtUSD(amt-fR)}**`, inline:true },
          ).setImage(IMG.FEE).setFooter({ text:"Konvert  •  Open a ticket to begin" })], ephemeral:true });
      }

      if (cmd === "price") {
        await interaction.deferReply();
        const coin=interaction.options.getString("coin").toUpperCase();
        const id=GECKO[coin];
        if (!id) return interaction.editReply({ embeds:[new EmbedBuilder().setColor(0xFF4444).setAuthor({ name:"Konvert",iconURL:IMG.LOGO }).setDescription(`**${coin}** is not supported. Try BTC, ETH, SOL, LTC, BNB, XRP, DOGE and more.`)] });
        try {
          const res=await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd,cad,eur&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`,{signal:AbortSignal.timeout(6000)});
          const dat=await res.json();
          const d=dat[id];
          if (!d) return interaction.editReply("Could not fetch price. Try again.");
          const ch=parseFloat(d.usd_24h_change||0);
          const fmt2=n=>n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
          const mcap=d.usd_market_cap?`$${(d.usd_market_cap/1e9).toFixed(2)}B`:"--";
          const vol=d.usd_24h_vol?`$${(d.usd_24h_vol/1e9).toFixed(2)}B`:"--";
          const fee=calcFee(Math.max(d.usd,1),"send");
          const rate=feeRate(Math.max(d.usd,1),"send");
          return interaction.editReply({ embeds:[new EmbedBuilder()
            .setColor(CONFIG.COLOR).setAuthor({ name:"Konvert  •  Live Price",iconURL:IMG.LOGO })
            .setTitle(`${coin}  --  $${fmt2(d.usd)}`).setThumbnail(COIN_LOGO[coin]||IMG.LOGO)
            .setDescription(`${ch>=0?"▲":"▼"} **${ch.toFixed(2)}%** in the last 24 hours\n\u200b`)
            .addFields(
              { name:"USD",         value:`**$${fmt2(d.usd)}**`,           inline:true },
              { name:"CAD",         value:`CA$${fmt2(d.cad)}`,             inline:true },
              { name:"EUR",         value:`€${fmt2(d.eur)}`,               inline:true },
              { name:"Market Cap",  value:mcap,                            inline:true },
              { name:"24h Volume",  value:vol,                             inline:true },
              { name:"Konvert Fee", value:`${rate}%  --  **${fmtUSD(fee)}**`, inline:true },
            ).setFooter({ text:`Konvert  •  /price ${coin} for details` }).setTimestamp()] });
        } catch { return interaction.editReply("Failed to fetch price. Try again."); }
      }

      if (cmd === "convert") {
        await interaction.deferReply();
        const amount=interaction.options.getNumber("amount");
        const from=interaction.options.getString("from").toUpperCase();
        const to=interaction.options.getString("to").toUpperCase();
        const FIAT={USD:1,CAD:1.37,EUR:0.93,GBP:0.79};
        let amtUSD;
        if (FIAT[from]) amtUSD=amount/FIAT[from];
        else { const p=await getPrice(from); if(!p) return interaction.editReply(`Unknown: ${from}`); amtUSD=amount*p; }
        let result;
        if (FIAT[to]) result=amtUSD*FIAT[to];
        else { const p=await getPrice(to); if(!p) return interaction.editReply(`Unknown: ${to}`); result=amtUSD/p; }
        const fee=calcFee(amtUSD,"send");
        const p2=FIAT[to]?1/FIAT[to]:(await getPrice(to)||1);
        const youGet=result-(fee/p2);
        return interaction.editReply({ embeds:[base("Conversion").setThumbnail(IMG.LOGO)
          .addFields(
            { name:"You Send",    value:`**${amount} ${from}**`,          inline:true },
            { name:"Gross",       value:`${result.toFixed(6)} ${to}`,     inline:true },
            { name:"Fee",         value:`~${fmtUSD(fee)}`,                inline:true },
            { name:"You Receive", value:`**${youGet.toFixed(6)} ${to}**`, inline:true },
          ).setFooter({ text:"Estimate only  •  Konvert" })] });
      }

      if (cmd === "stats") {
        const target  = interaction.options.getUser("user") || interaction.user;
        const isSelf  = target.id === interaction.user.id;
        const allT    = Object.values(load("tickets"));
        const done    = allT.filter(t => t.userId === target.id && t.status === "vouched");
        const volume  = done.reduce((s,t) => s+(t.amountUSD||0), 0);
        const avg     = done.length > 0 ? volume / done.length : 0;
        const methods = {};
        done.forEach(t => { if(t.method) methods[t.method]=(methods[t.method]||0)+1; });
        const topM = Object.entries(methods).sort((a,b)=>b[1]-a[1])[0];
        const coins = {};
        done.forEach(t => { if(t.coin) coins[t.coin]=(coins[t.coin]||0)+1; });
        const topC = Object.entries(coins).sort((a,b)=>b[1]-a[1])[0];
        const tier     = getTier(volume);
        const nextTier = getNextTier(volume);
        const progress = nextTier ? progressBar(volume, tier.min, nextTier.min) : "▓".repeat(12)+" MAX";
        await applyTierRole(interaction.guild, target.id, volume);
        const exchangerDone   = allT.filter(t => t.completedBy === target.id && t.status === "vouched");
        const exchangerVolume = exchangerDone.reduce((s,t) => s+(t.amountUSD||0), 0);
        const embed = new EmbedBuilder()
          .setColor(CONFIG.COLOR)
          .setAuthor({ name:"Konvert", iconURL:IMG.LOGO })
          .setTitle(isSelf ? "Your Exchange Stats" : `${target.username}'s Stats`)
          .setThumbnail(target.displayAvatarURL({ size:128 }))
          .setDescription(`${tier.emoji} **${tier.label}**${nextTier ? `  →  ${nextTier.emoji} ${nextTier.label} at ${fmtUSD(nextTier.min)}` : "  \u00b7  **Max Tier Reached**"}\n\`${progress}\`\n​`)
          .addFields(
            { name:"💳  Completed Trades", value:`**${done.length}**`,                         inline:true },
            { name:"💰  Total Volume",     value:volume>0 ? `**${fmtUSD(volume)}**` : "--",    inline:true },
            { name:"📊  Avg Deal Size",    value:avg>0 ? `**${fmtUSD(avg)}**` : "--",          inline:true },
            { name:"🏆  Top Method",       value:topM ? `**${getMethod(topM[0])?.label||topM[0]}** (${topM[1]} trades)` : "--", inline:true },
            { name:"🪙  Top Coin",         value:topC ? `**${topC[0]}** (${topC[1]} trades)` : "--", inline:true },
            { name:"⭐  Client Tier",      value:`${tier.emoji} **${tier.label}**`,            inline:true },
          );
        if (exchangerDone.length > 0) {
          embed.addFields(
            { name:"​", value:"**-- Exchanger Activity --**", inline:false },
            { name:"Trades Handled", value:`**${exchangerDone.length}**`,    inline:true },
            { name:"Volume Handled", value:`**${fmtUSD(exchangerVolume)}**`, inline:true },
          );
        }
        embed.setFooter({ text: done.length===0 ? "No completed trades yet  •  Konvert" : `${done.length} verified trade${done.length!==1?"s":""} on Konvert` });
        return interaction.reply({ embeds:[embed] });
      }

      if (cmd === "leaderboard") {
        const allT   = Object.values(load("tickets")).filter(t => t.status === "vouched" && t.amountUSD);
        const byUser = {};
        allT.forEach(t => {
          if (!byUser[t.userId]) byUser[t.userId] = { volume:0, trades:0 };
          byUser[t.userId].volume += t.amountUSD;
          byUser[t.userId].trades += 1;
        });
        const ranked = Object.entries(byUser).sort((a,b) => b[1].volume-a[1].volume).slice(0, 10);
        if (!ranked.length) return interaction.reply({ embeds:[base("Top Traders").setThumbnail(IMG.LOGO).setDescription("No completed trades yet -- be the first!").setFooter({ text:"Konvert  •  Leaderboard" })], ephemeral:true });
        const medals = ["🥇","🥈","🥉"];
        const lines  = ranked.map(([uid, d], i) => {
          const tier = getTier(d.volume);
          return `${medals[i] || `**${i+1}.**`}  <@${uid}>  ${tier.emoji}  —  **${fmtUSD(d.volume)}**  ·  ${d.trades} trade${d.trades!==1?"s":""}`;
        }).join("\n");
        const embed = new EmbedBuilder()
          .setColor(CONFIG.COLOR).setAuthor({ name:"Konvert", iconURL:IMG.LOGO })
          .setTitle("Top Traders").setThumbnail(IMG.LOGO)
          .setDescription("Ranked by total USD volume exchanged on Konvert.\n​")
          .addFields({ name:"Rankings", value:lines, inline:false })
          .setFooter({ text:`${ranked.length} traders  •  Konvert Leaderboard` }).setTimestamp();
        return interaction.reply({ embeds:[embed] });
      }

      if (cmd === "market") {
        await interaction.deferReply();
        const ids=COINS.map(c=>GECKO[c]||c.toLowerCase()).join(",");
        const res=await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,{signal:AbortSignal.timeout(8000)});
        const data=await res.json();
        const rows=COINS.map(coin=>{ const d=data[GECKO[coin]||coin.toLowerCase()]; if(!d) return null; return {coin,price:d.usd,change:parseFloat(d.usd_24h_change||0)}; }).filter(Boolean);
        const gainers=[...rows].sort((a,b)=>b.change-a.change).slice(0,3);
        const losers=[...rows].sort((a,b)=>a.change-b.change).slice(0,3);
        const avg=(rows.reduce((s,r)=>s+r.change,0)/rows.length).toFixed(2);
        const fmt2=n=>n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
        return interaction.editReply({ embeds:[base("Market Summary").setThumbnail(IMG.LOGO)
          .addFields(
            { name:"Market Sentiment", value:`**${parseFloat(avg)>=0?"Bullish ▲":"Bearish ▼"}**  \u00b7  Avg 24h: **${avg}%**`, inline:false },
            { name:"Top Gainers",      value:gainers.map(r=>`\`${r.coin.padEnd(5)}\` **▲ ${r.change.toFixed(2)}%**  $${fmt2(r.price)}`).join("\n"), inline:true },
            { name:"Top Losers",       value:losers.map(r=>`\`${r.coin.padEnd(5)}\` **▼ ${Math.abs(r.change).toFixed(2)}%**  $${fmt2(r.price)}`).join("\n"), inline:true },
          ).setImage(IMG.RATES).setFooter({ text:"Live market data  •  Konvert" })] });
      }

      if (cmd === "wallets") {
        const w=load("wallets");
        const fields=Object.entries(w).length?Object.entries(w).map(([coin,addr])=>({name:coin,value:`\`${addr}\``,inline:true})):[{name:"No wallets set",value:"Owner: use /setwallet to add addresses.",inline:false}];
        return interaction.reply({ embeds:[base("Deposit Wallets").setThumbnail(IMG.LOGO)
          .setDescription("Send funds **only** to addresses confirmed by staff **inside your ticket**.\n__Never send to any address given outside of your ticket.__\n\u200b")
          .addFields(fields).setFooter({ text:"Always verify with staff before sending  •  Konvert" })], ephemeral:true });
      }

      if (cmd === "mm") {
        return interaction.reply({ embeds:[base("Middleman Guide")
          .setDescription("A **middleman (MM)** holds crypto between both parties during a trade -- protecting everyone from scams.\n\u200b")
          .addFields(
            { name:"How to Pick an MM",  value:"Agree with your exchanger on a trusted MM you both know. Konvert supports any reputable third-party MM.", inline:false },
            { name:"Owner Override Only",value:"The **only** time you skip an MM is if **@jswaps** or **@3uce** explicitly says so in your ticket.", inline:false },
            { name:"Stay Safe",          value:"**Staff will never DM you first.** All MM arrangements happen in your ticket only.", inline:false },
          ).setImage(IMG.RULES).setFooter({ text:"Konvert  •  Trade safely, always" })] });
      }

      if (cmd === "mine") {
        const userId=interaction.user.id;
        const cooldownMs=3*60*60*1000;
        const remaining=cooldownMs-(Date.now()-(state.cooldowns[userId]||0));
        if (remaining>0) {
          const hrs=Math.floor(remaining/3600000);
          const mins=Math.ceil((remaining%3600000)/60000);
          return interaction.reply({ embeds:[base("Mine -- On Cooldown").setDescription(`You can mine again in **${hrs>0?`${hrs}h ${mins}m`:`${mins}m`}**.`).setFooter({ text:"Konvert Mine  •  Once every 3 hours" })], ephemeral:true });
        }
        state.cooldowns[userId]=Date.now();
        const positions=Array.from({length:25},(_,i)=>i).sort(()=>Math.random()-0.5);
        const diamonds=positions.slice(0,3);
        const bombs=positions.slice(3,8);
        state.mineGames[userId]={ diamonds, bombs, revealed:[], found:0, tries:0, over:false };
        return interaction.reply({
          embeds:[base("Konvert Mine").setThumbnail(IMG.LOGO)
            .setDescription("A **5×5** grid lies before you.\n\n💎 **3 diamonds** are hidden among the cells.\n💣 **5 bombs** are also hidden -- hit one and it's over.\n\nYou have **3 tries**. Find all 3 diamonds to win a **Free Exchange Pass**.\n\u200b")
            .addFields(
              { name:"Tries Remaining", value:"**3**",     inline:true },
              { name:"Diamonds Found",  value:"**0 / 3**", inline:true },
              { name:"Win Condition",   value:"All 3 💎 with no 💣", inline:true },
            ).setFooter({ text:"Konvert Mine  •  Find all 3 diamonds  •  Cooldown: 3 hours" })],
          components:buildMineGrid(userId, state.mineGames[userId]),
          ephemeral:true,
        });
      }

      if (cmd === "vouch") {
        const clientUser=interaction.options.getUser("client");
        const exchUser=interaction.options.getUser("exchanger");
        const message=interaction.options.getString("message");
        const method=interaction.options.getString("method");
        const amount=interaction.options.getNumber("amount");
        const rating=interaction.options.getInteger("rating")||5;
        await postVouch(interaction.guild,{ clientId:clientUser.id, exchangerId:exchUser.id, method, amountUSD:amount, direction:null, coin:null, message, rating });
        return interaction.reply({ content:`Vouch recorded -- <@${clientUser.id}> exchanged with <@${exchUser.id}>.`, ephemeral:true });
      }

      if (cmd === "alert") {
        const coin=interaction.options.getString("coin").toUpperCase();
        const price=interaction.options.getNumber("price");
        const dir=interaction.options.getString("direction");
        if (!COINS.includes(coin)) return interaction.reply({ content:`Unsupported coin: ${coin}`, ephemeral:true });
        state.alerts.push({ userId:interaction.user.id, coin, target:price, direction:dir });
        return interaction.reply({ embeds:[base("Price Alert Set").setThumbnail(COIN_LOGO[coin]||IMG.LOGO)
          .setDescription(`You will be DM'd when **${coin}** goes **${dir}** **$${price.toLocaleString("en-US")}**.`)
          .setFooter({ text:"Konvert  •  Price Alerts" })], ephemeral:true });
      }

      if (cmd === "ticket") {
        const tickets=load("tickets");
        const found=Object.entries(tickets).find(([,t])=>t.userId===interaction.user.id&&t.status==="open");
        if (!found) return interaction.reply({ content:"You don't have an open ticket. Use **Exchange Now** to start one.", ephemeral:true });
        const [channelId,t]=found;
        const m=getMethod(t.method);
        return interaction.reply({ embeds:[base("Your Open Ticket").setThumbnail(IMG.LOGO)
          .addFields(
            { name:"Channel",   value:`<#${channelId}>`,                                     inline:true },
            { name:"Method",    value:`**${m?.label||t.method}**`,                           inline:true },
            { name:"Amount",    value:`**${fmtUSD(t.amountUSD)}**`,                          inline:true },
            { name:"Coin",      value:`**${t.coin||"--"}**`,                                  inline:true },
            { name:"Direction", value:t.direction==="send"?"Fiat → Crypto":"Crypto → Fiat",  inline:true },
            { name:"Opened",    value:`<t:${Math.floor(t.createdAt/1000)}:R>`,               inline:true },
          ).setFooter({ text:"Konvert  •  All communication stays in your ticket" })], ephemeral:true });
      }

      if (cmd === "howto") {
        return interaction.reply({ embeds:[base("How to Use Konvert").setThumbnail(IMG.LOGO)
          .setDescription("New to Konvert? Here's how a trade works step by step.\n\u200b")
          .addFields(
            { name:"1.  Check Rates",    value:"Use **Live Rates** or type `$BTC` / `$ETH` etc. in any channel to see the current price.", inline:false },
            { name:"2.  Calculate Fee",  value:"Use **Calculate Fee** to estimate your cost. Fees range from **5% - 9%** depending on amount.", inline:false },
            { name:"3.  Open a Ticket",  value:"Click **Exchange Now**, pick your payment method, fill in details, confirm. A private ticket opens instantly.", inline:false },
            { name:"4.  Agree on an MM", value:"A **middleman** is required on all trades. Agree on one with your exchanger inside your ticket.", inline:false },
            { name:"5.  Send & Confirm", value:"Staff confirms the deal. You send funds and share proof. Once confirmed, you receive your crypto or payment.", inline:false },
            { name:"Stay Safe",          value:"Staff never DM you first. Anyone doing so is an impersonator. All communication stays in your ticket.", inline:false },
          ).setFooter({ text:"Konvert  •  Questions? Ask in your ticket" })], ephemeral:true });
      }

      if (cmd === "ping") {
        const sent=Date.now();
        await interaction.deferReply({ ephemeral:true });
        return interaction.editReply({ embeds:[base("Bot Status").setThumbnail(IMG.LOGO)
          .setDescription("**All systems operational.** Konvert is online and ready.\n\u200b")
          .addFields(
            { name:"Status",      value:"**Online**",             inline:true },
            { name:"Latency",     value:`**${Date.now()-sent}ms**`, inline:true },
            { name:"API Latency", value:`**${client.ws.ping}ms**`,  inline:true },
          ).setFooter({ text:"Konvert  •  Bot Status" })] });
      }

      if (cmd === "supported") {
        return interaction.reply({ embeds:[base("Supported Methods & Coins").setThumbnail(IMG.LOGO)
          .addFields(
            { name:"💳  Payment Methods",  value:METHODS.map(m=>`**${m.label}**`).join("  \u00b7  "), inline:false },
            { name:"🪙  Cryptocurrencies", value:COINS.map(c=>`\`${c}\``).join("  ")+"\n\n*Don't see your coin? Ask in your ticket -- we support most major coins.*", inline:false },
          ).setFooter({ text:"Don't see your method or coin? Open a ticket and ask  •  Konvert" })], ephemeral:true });
      }

      if (cmd === "review") {
        const modal=new ModalBuilder().setCustomId("modal_review").setTitle("Leave a Review for Konvert");
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("review_text").setLabel("Your experience with Konvert").setStyle(TextInputStyle.Paragraph).setPlaceholder("Fast, legit, smooth -- describe your experience…").setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("review_rating").setLabel("Rating out of 5").setStyle(TextInputStyle.Short).setPlaceholder("5").setRequired(true)),
        );
        return interaction.showModal(modal);
      }

      if (cmd === "remind") {
        const mins=interaction.options.getInteger("minutes");
        const message=interaction.options.getString("message");
        if (mins<1||mins>1440) return interaction.reply({ content:"Reminder must be between 1 minute and 24 hours.", ephemeral:true });
        await interaction.reply({ content:`Got it. I'll remind you about **"${message}"** in **${mins} minute${mins!==1?"s":""}**.`, ephemeral:true });
        setTimeout(async()=>{
          try {
            const user=await client.users.fetch(interaction.user.id);
            await user.send({ embeds:[base("Reminder").setDescription(`**"${message}"**\n\nThis is your reminder from **${mins} minute${mins!==1?"s":""}** ago.`).setFooter({ text:"Konvert  •  Reminder" })] });
          } catch {}
        }, mins*60*1000);
        return;
      }

      if (cmd === "calc") {
        await interaction.deferReply({ ephemeral:true });
        if (!CONFIG.RATES_CHANNEL) return interaction.editReply("RATES_CHANNEL_ID not configured.");
        const ch=interaction.guild.channels.cache.get(CONFIG.RATES_CHANNEL);
        if (!ch) return interaction.editReply("Rates channel not found.");
        const embed=await buildRatesEmbed();
        if (ratesMsgId) { const msg=await ch.messages.fetch(ratesMsgId).catch(()=>null); if(msg){await msg.edit({embeds:[embed]});} else { const s=await ch.send({embeds:[embed]});ratesMsgId=s.id; } }
        else { const s=await ch.send({embeds:[embed]});ratesMsgId=s.id; }
        return interaction.editReply("Rates posted.");
      }

      if (cmd === "setwallet") {
        const coin=interaction.options.getString("coin").toUpperCase();
        const addr=interaction.options.getString("address");
        const w=load("wallets"); w[coin]=addr; save("wallets",w);
        log(interaction.guild,`WALLET: ${interaction.user.tag} set ${coin} → ${addr}`);
        return interaction.reply({ content:`**${coin}** deposit address updated to \`${addr}\``, ephemeral:true });
      }

      if (cmd === "announce") {
        const message=interaction.options.getString("message");
        const channelId=interaction.options.getString("channel");
        const ping=interaction.options.getString("ping")||"none";
        const ch=interaction.guild.channels.cache.get(channelId);
        if (!ch) return interaction.reply({ content:"Channel not found.", ephemeral:true });
        const pingStr=ping==="everyone"?"@everyone ":ping==="here"?"@here ":"";
        await ch.send({ content:pingStr||undefined, embeds:[base("Konvert Announcement").setThumbnail(IMG.LOGO).setDescription(message).setFooter({ text:`Announced by ${interaction.user.tag}  •  Konvert` })] });
        return interaction.reply({ content:"Announced.", ephemeral:true });
      }

      if (cmd === "blacklist") {
        const target=interaction.options.getUser("user");
        const reason=interaction.options.getString("reason")||"No reason given";
        const bl=load("blacklist"); bl[target.id]={tag:target.tag,reason,by:interaction.user.tag,at:Date.now()}; save("blacklist",bl);
        log(interaction.guild,`BLACKLIST: ${target.tag} -- ${reason}`);
        return interaction.reply({ content:`**${target.tag}** blacklisted. Reason: ${reason}`, ephemeral:true });
      }

      if (cmd === "unblacklist") {
        const target=interaction.options.getUser("user");
        const bl=load("blacklist"); delete bl[target.id]; save("blacklist",bl);
        return interaction.reply({ content:`**${target.tag}** removed from blacklist.`, ephemeral:true });
      }

      if (cmd === "closeticket") {
        const reason=interaction.options.getString("reason")||"Completed";
        await interaction.deferReply();
        await doCloseTicket(interaction.channel, interaction.guild, interaction.user, reason);
        await interaction.editReply({ embeds:[new EmbedBuilder().setColor(0xFF4444).setTitle("Ticket Closed").setDescription(`Closed by staff.\n**Reason:** ${reason}\n\nDeleting in 10 seconds.`).setTimestamp()] });
        setTimeout(()=>interaction.channel.delete().catch(()=>{}),10000);
        return;
      }

      if (cmd === "cancelticket") {
        const reason=interaction.options.getString("reason")||"Cancelled by staff";
        await interaction.deferReply();
        const tickets=load("tickets");
        if (tickets[interaction.channel.id]) {
          tickets[interaction.channel.id].status="cancelled"; tickets[interaction.channel.id].cancelledAt=Date.now();
          save("tickets",tickets);
          const t=tickets[interaction.channel.id];
          try { const member=await interaction.guild.members.fetch(t.userId).catch(()=>null); if(member) await member.send({ embeds:[base("Ticket Cancelled").setDescription(`Your Konvert exchange ticket has been cancelled by staff.\n**Reason:** ${reason}\n\nIf this is a mistake, please open a new ticket.`).setFooter({ text:"Konvert" })] }).catch(()=>{}); } catch {}
        }
        await interaction.editReply({ embeds:[new EmbedBuilder().setColor(0xFF6600).setTitle("Ticket Cancelled").setDescription(`Cancelled by ${interaction.user.tag}\n**Reason:** ${reason}\n\nDeleting in 10 seconds.`).setTimestamp()] });
        log(interaction.guild,`CANCELLED: #${interaction.channel.name} by ${interaction.user.tag} -- ${reason}`);
        setTimeout(()=>interaction.channel.delete().catch(()=>{}),10000);
        return;
      }

      if (cmd === "openticket") {
        await interaction.deferReply();
        const allRoleIds=[...Object.values(CONFIG.ROLES),CONFIG.STAFF_ROLE,CONFIG.EXCHANGER_ROLE].filter(Boolean);
        const uniqueRoles=[...new Set(allRoleIds)];
        const addedRoles=[];
        for (const roleId of uniqueRoles) {
          try {
            const role=await interaction.guild.roles.fetch(roleId).catch(()=>null);
            if (!role) continue;
            await interaction.channel.permissionOverwrites.edit(roleId,{ ViewChannel:true,SendMessages:true,ReadMessageHistory:true });
            addedRoles.push(`<@&${roleId}>`);
          } catch {}
        }
        await interaction.editReply({ embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({ name:"Konvert",iconURL:IMG.LOGO }).setTitle("Ticket Opened to All Exchangers")
          .setDescription("This ticket is now **visible to all Konvert exchangers**.\n\nAny available handler can step in and assist with this trade.\n\u200b")
          .addFields({ name:"Roles Added",value:addedRoles.length?addedRoles.join("  "):"None configured",inline:false })
          .setFooter({ text:"Konvert  •  Open Ticket" }).setTimestamp()] });
        log(interaction.guild,`OPENTICKET: #${interaction.channel.name} opened by ${interaction.user.tag}`);
        return;
      }

      if (cmd === "note") {
        const text=interaction.options.getString("text");
        await interaction.channel.send({ embeds:[new EmbedBuilder().setColor(0xFFB347).setAuthor({ name:`Staff Note -- ${interaction.user.tag}`,iconURL:interaction.user.displayAvatarURL() }).setDescription(text).setTimestamp().setFooter({ text:"Konvert  •  Staff Note" })] });
        return interaction.reply({ content:"Note added.", ephemeral:true });
      }

      if (cmd === "tradelog") {
        const limit=interaction.options.getInteger("limit")||5;
        const done=Object.values(load("tickets")).filter(t=>t.status==="vouched"&&t.completedAt).sort((a,b)=>b.completedAt-a.completedAt).slice(0,limit);
        if (!done.length) return interaction.reply({ content:"No completed trades yet.", ephemeral:true });
        const lines=done.map((t,i)=>{ const m=getMethod(t.method); return `**${i+1}.** <@${t.userId}>  \u00b7  ${m?.label||t.method}  \u00b7  ${fmtUSD(t.amountUSD)}  \u00b7  <t:${Math.floor(t.completedAt/1000)}:R>`; }).join("\n");
        return interaction.reply({ embeds:[base(`Last ${done.length} Completed Trades`).setDescription(lines).setFooter({ text:"Konvert  •  Trade Log" })], ephemeral:true });
      }

      if (cmd === "volume") {
        const tickets=load("tickets"); const all=Object.values(tickets);
        const done=all.filter(t=>t.status==="vouched"&&t.amountUSD);
        const totalVol=done.reduce((s,t)=>s+(t.amountUSD||0),0);
        const totalFees=done.reduce((s,t)=>s+(t.feeUSD||0),0);
        const open=all.filter(t=>t.status==="open").length;
        const today=done.filter(t=>t.completedAt&&Date.now()-t.completedAt<86400000);
        const todayVol=today.reduce((s,t)=>s+(t.amountUSD||0),0);
        const methods={}; done.forEach(t=>{ if(t.method) methods[t.method]=(methods[t.method]||0)+1; });
        const topMethod=Object.entries(methods).sort((a,b)=>b[1]-a[1])[0];
        return interaction.reply({ embeds:[base("Konvert Volume Stats").setThumbnail(IMG.LOGO)
          .addFields(
            { name:"Total Completed", value:`**${done.length}** trades`,        inline:true },
            { name:"Total Volume",    value:`**${fmtUSD(totalVol)}**`,          inline:true },
            { name:"Total Fees",      value:`**${fmtUSD(totalFees)}**`,         inline:true },
            { name:"Open Tickets",    value:`**${open}**`,                      inline:true },
            { name:"Today's Volume",  value:`**${fmtUSD(todayVol)}** (${today.length} trades)`, inline:true },
            { name:"Top Method",      value:topMethod?`**${getMethod(topMethod[0])?.label||topMethod[0]}** (${topMethod[1]})`:"--", inline:true },
          ).setFooter({ text:"Konvert  •  Server Volume Statistics" })], ephemeral:true });
      }

      if (cmd === "snapshot") {
        await interaction.deferReply({ ephemeral:true });
        const guild=interaction.guild; const tickets=load("tickets"); const all=Object.values(tickets);
        const done=all.filter(t=>t.status==="vouched"&&t.amountUSD);
        const open=all.filter(t=>t.status==="open");
        const today=done.filter(t=>t.completedAt&&Date.now()-t.completedAt<86400000);
        const week=done.filter(t=>t.completedAt&&Date.now()-t.completedAt<7*86400000);
        const totalVol=done.reduce((s,t)=>s+(t.amountUSD||0),0);
        const methods={}; done.forEach(t=>{ if(t.method) methods[t.method]=(methods[t.method]||0)+1; });
        const topMethod=Object.entries(methods).sort((a,b)=>b[1]-a[1])[0];
        const coins={}; done.forEach(t=>{ if(t.coin) coins[t.coin]=(coins[t.coin]||0)+1; });
        const topCoin=Object.entries(coins).sort((a,b)=>b[1]-a[1])[0];
        const byEx={}; done.forEach(t=>{ if(t.completedBy) byEx[t.completedBy]=(byEx[t.completedBy]||0)+1; });
        const topEx=Object.entries(byEx).sort((a,b)=>b[1]-a[1])[0];
        await guild.members.fetch();
        return interaction.editReply({ embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({ name:"Konvert  •  Server Snapshot",iconURL:IMG.LOGO }).setTitle("Server Snapshot").setThumbnail(IMG.LOGO)
          .setDescription(`Snapshot taken <t:${Math.floor(Date.now()/1000)}:F>\n\u200b`)
          .addFields(
            { name:"👥  Members",         value:`**${guild.memberCount}**`,                                inline:true },
            { name:"🎫  Open Tickets",    value:`**${open.length}**`,                                     inline:true },
            { name:"✅  Total Completed", value:`**${done.length}** trades`,                              inline:true },
            { name:"💰  Total Volume",    value:`**${fmtUSD(totalVol)}**`,                                inline:true },
            { name:"📅  Today",           value:`**${today.length}** trades  \u00b7  ${fmtUSD(today.reduce((s,t)=>s+(t.amountUSD||0),0))}`, inline:true },
            { name:"📆  This Week",       value:`**${week.length}** trades  \u00b7  ${fmtUSD(week.reduce((s,t)=>s+(t.amountUSD||0),0))}`,  inline:true },
            { name:"💳  Top Method",      value:topMethod?`**${getMethod(topMethod[0])?.label||topMethod[0]}** (${topMethod[1]})`:"--", inline:true },
            { name:"🪙  Top Coin",        value:topCoin?`**${topCoin[0]}** (${topCoin[1]})`:"--",          inline:true },
            { name:"🏆  Top Exchanger",   value:topEx?`<@${topEx[0]}> (${topEx[1]} trades)`:"--",          inline:true },
          ).setFooter({ text:"Konvert  •  Snapshot" }).setTimestamp()] });
      }

      if (cmd === "exchangerboard") {
        const done=Object.values(load("tickets")).filter(t=>t.status==="vouched"&&t.completedBy);
        const byEx={};
        done.forEach(t=>{ if(!byEx[t.completedBy]) byEx[t.completedBy]={trades:0,volume:0}; byEx[t.completedBy].trades+=1; byEx[t.completedBy].volume+=(t.amountUSD||0); });
        const ranked=Object.entries(byEx).sort((a,b)=>b[1].trades-a[1].trades).slice(0,10);
        if (!ranked.length) return interaction.reply({ content:"No completed trades yet.", ephemeral:true });
        const medals=["🥇","🥈","🥉"];
        const lines=ranked.map(([uid,d],i)=>`${medals[i]||`**${i+1}.**`}  <@${uid}>  --  **${d.trades}** trade${d.trades!==1?"s":""}  \u00b7  ${fmtUSD(d.volume)}`).join("\n");
        return interaction.reply({ embeds:[base("Exchanger Leaderboard").setThumbnail(IMG.LOGO)
          .setDescription("Top Konvert exchangers ranked by completed trades.\n\u200b")
          .addFields({ name:"Rankings", value:lines, inline:false })
          .setFooter({ text:"Konvert  •  Exchanger Leaderboard" }).setTimestamp()], ephemeral:true });
      }

      if (cmd === "thankclient") {
        const target=interaction.options.getUser("client");
        const amount=interaction.options.getNumber("amount")||null;
        const tickets=load("tickets");
        const clientDone=Object.values(tickets).filter(t=>t.userId===target.id&&t.status==="vouched");
        const totalVol=clientDone.reduce((s,t)=>s+(t.amountUSD||0),0);
        const tradeCount=clientDone.length;
        let tier="New Client", tierColor=CONFIG.COLOR;
        if (tradeCount>=10||totalVol>=5000){ tier="VIP Client"; tierColor=0xFFD700; }
        else if (tradeCount>=5||totalVol>=2000){ tier="Trusted Client"; tierColor=0x9B59B6; }
        else if (tradeCount>=2){ tier="Returning Client"; tierColor=CONFIG.COLOR; }
        const feePreview=amount?`Your rate on your next **${fmtUSD(amount)}** trade: **${feeRate(amount,"send")}%**`:null;
        try {
          await target.send({ embeds:[new EmbedBuilder().setColor(tierColor).setAuthor({ name:"Konvert Exchange",iconURL:IMG.LOGO }).setTitle("Thank You for Trading with Us").setThumbnail(IMG.LOGO)
            .setDescription(`Hey <@${target.id}> -- your trade has been completed successfully.\n\nWe appreciate your trust in **Konvert Exchange**. Every deal matters to us and we're grateful for your business.\n\u200b`)
            .addFields(
              { name:"Your Tier",        value:`**${tier}**`,                              inline:true },
              { name:"Trades With Us",   value:`**${tradeCount}** completed`,              inline:true },
              { name:"Total Exchanged",  value:totalVol>0?`**${fmtUSD(totalVol)}**`:"--",  inline:true },
              { name:"Come Back Anytime",value:"Head to our exchange channel anytime to open a new ticket.\n**Fast  \u00b7  Safe  \u00b7  Simple  \u00b7  Private**", inline:false },
              ...(feePreview?[{ name:"Your Rate Preview",value:feePreview,inline:false }]:[]),
            ).setImage(IMG.DEAL).setFooter({ text:"Konvert Exchange  •  Thank you for your business" }).setTimestamp()] });
          return interaction.reply({ content:`Thank-you card sent to **${target.tag}**.`, ephemeral:true });
        } catch {
          return interaction.reply({ content:`Could not DM **${target.tag}**. They may have DMs disabled.`, ephemeral:true });
        }
      }

      if (cmd === "passes") {
        const holders=Object.entries(state.passes).filter(([,v])=>v>0);
        if (!holders.length) return interaction.reply({ content:"No exchange passes have been won yet.", ephemeral:true });
        const lines=holders.map(([uid,count])=>`<@${uid}> -- **${count}** pass${count!==1?"es":""}`).join("\n");
        return interaction.reply({ embeds:[base("Exchange Pass Holders").setThumbnail(IMG.LOGO).setDescription(lines).setFooter({ text:"Konvert Mine  •  Won by finding all 3 diamonds" })], ephemeral:true });
      }

      if (cmd === "lookup") {
        const query   = interaction.options.getString("name").toLowerCase().trim();
        const tickets = load("tickets");
        const match   = Object.entries(tickets).find(([id, t]) => {
          const chName = interaction.guild.channels.cache.get(id)?.name || "";
          return chName.includes(query) || id === query;
        });
        if (!match) return interaction.reply({ content:`No ticket found matching **${query}**.`, ephemeral:true });
        const [channelId, t] = match;
        const m = getMethod(t.method);
        const statusEmoji = t.status==="vouched"?"✅":t.status==="open"?"🟡":"🔴";
        return interaction.reply({ embeds:[base("Ticket Lookup").setThumbnail(IMG.LOGO)
          .addFields(
            { name:"Client",    value:`<@${t.userId}>`,                                                   inline:true },
            { name:"Status",    value:`${statusEmoji} **${t.status==="vouched"?"Completed":t.status==="open"?"Open":"Closed"}**`, inline:true },
            { name:"Method",    value:m?.label||t.method,                                                 inline:true },
            { name:"Amount",    value:fmtUSD(t.amountUSD||0),                                            inline:true },
            { name:"Coin",      value:t.coin||"--",                                                       inline:true },
            { name:"Opened",    value:t.createdAt?`<t:${Math.floor(t.createdAt/1000)}:R>`:"--",           inline:true },
            { name:"Completed", value:t.completedAt?`<t:${Math.floor(t.completedAt/1000)}:R>`:"--",       inline:true },
            { name:"Channel",   value:`<#${channelId}>`,                                                  inline:true },
          ).setFooter({ text:"Konvert  •  Ticket Lookup" })], ephemeral:true });
      }

      if (cmd === "uptime") {
        const uptimeMs  = process.uptime() * 1000;
        const hrs  = Math.floor(uptimeMs / 3600000);
        const mins = Math.floor((uptimeMs % 3600000) / 60000);
        const secs = Math.floor((uptimeMs % 60000) / 1000);
        const uptimeStr = `${hrs}h ${mins}m ${secs}s`;
        return interaction.reply({ embeds:[base("Bot Uptime").setThumbnail(IMG.LOGO)
          .setDescription(`Konvert Bot has been online for **${uptimeStr}**.\n​`)
          .addFields(
            { name:"Status",  value:"**Online**",           inline:true },
            { name:"Uptime",  value:`**${uptimeStr}**`,     inline:true },
            { name:"Latency", value:`**${client.ws.ping}ms**`, inline:true },
          ).setFooter({ text:"Konvert  •  Bot Status" })], ephemeral:true });
      }

      if (cmd === "postkonvault") {
        const inviteUrl = "https://discord.gg/jnT63k4UA7";
        const embed = new EmbedBuilder()
          .setColor(CONFIG.COLOR).setAuthor({ name:"Konvert", iconURL:IMG.LOGO })
          .setTitle("🚀  Konvault™")
          .setDescription("**The Ultimate Crypto Wagering Hub**\n— Owned by Konvert Exchange\n— Free MM service  ·  0% fee\n\n*Flip, win, repeat. It\'s that simple.*\n\u200b")
          .addFields(
            { name:"What We Offer", value:"💰  Choose any amount of crypto to wager\n🪙  Fair coin flips — winner takes all\n🔒  Funds securely held by trusted middlemen\n⚡  Active agents & support 24/7\n🌐  Supports ALL cryptocurrencies\n🔍  Full transparency — proof provided for every wager\n✅  0 fees — tips are always welcome", inline:false },
            { name:"🎉  Join Now", value:`Click the button below to join Konvault and start flipping!\n${inviteUrl}`, inline:false },
          )
          .setImage(IMG.BANNER).setFooter({ text:"Konvault by Konvert Exchange  •  Free MM  •  0% Fee" }).setTimestamp();
        const joinBtn = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel("Join Konvault").setEmoji("🚀").setStyle(ButtonStyle.Link).setURL(inviteUrl)
        );
        await interaction.channel.send({ embeds:[embed], components:[joinBtn] });
        return interaction.reply({ content:`Konvault embed posted with invite: ${inviteUrl}`, ephemeral:true });
      }

      if (cmd === "postinfo") {
        const embed = new EmbedBuilder()
          .setColor(CONFIG.COLOR).setAuthor({ name:"Konvert", iconURL:IMG.LOGO })
          .setTitle("Info").setThumbnail(IMG.LOGO)
          .setDescription(
            "Konvert is a **fast and reliable exchange community** for converting value across platforms.\n\n" +
            "Easily exchange **PayPal, Crypto, Cash App, Zelle, E-Transfer**, and other payment methods -- both directions -- with **low fees** and **quick processing**.\n\n" +
            "Our agents are available **24/7**, backed by a friendly, active community and real-time crypto price updates to keep you informed. We also run **giveaways of cryptocurrency** which can be won regularly.\n\n" +
            "Say goodbye to slow exchangers and high fees -- hello to convenience and 24/7 replies.\n\u200b"
          )
          .addFields(
            { name:"\ud83d\udcb8  Fees",    value:"5% - 9%  \u00b7  Tiered by amount  \u00b7  Min $5",  inline:true },
            { name:"\u26a1  Speed",   value:"Usually under 10 minutes",                  inline:true },
            { name:"\ud83e\udd1d  Support", value:"24/7 agents always available",              inline:true },
          )
          .setImage(IMG.BANNER).setFooter({ text:"Konvert Exchange  •  Fast  \u00b7  Safe  \u00b7  Simple  \u00b7  Private" });
        await interaction.channel.send({ embeds:[embed] });
        return interaction.reply({ content:"Info embed posted.", ephemeral:true });
      }

      if (cmd === "posttos") {
        const embed = new EmbedBuilder()
          .setColor(CONFIG.COLOR).setAuthor({ name:"Konvert", iconURL:IMG.LOGO })
          .setTitle("Terms of Service").setThumbnail(IMG.LOGO)
          .setDescription("**Konvert -- Exchange Policies**\n\u200b")
          .addFields(
            { name:"1. Lawful Use", value:"Konvert strictly prohibits the use of its services for any unlawful activity, including but not limited to fraud, scams, chargebacks, or abuse of payment systems. Transactions deemed suspicious, unauthorized, or high-risk can be rejected and denied.", inline:false },
            { name:"2. Fees & Pricing", value:"All exchanges are subject to a minimum service fee of **$5 USD**, and a tiered % for larger deals.\n\nFees are **non-refundable** if:\n- The exchange is confirmed completed by both parties\n- Payment details provided are inaccurate or unverifiable\n- The client withdraws after the exchange process has begun\n\nRefunds only in cases of verified error, reported within 24 hours.", inline:false },
            { name:"3. On-Platform Transactions Only", value:"All exchanges must be conducted exclusively through the Konvert server and official ticket system. Transactions arranged outside of Konvert are **strictly prohibited**.\n\nKonvert will not provide support or refund for any off-platform transactions.", inline:false },
            { name:"4. Accepted Payment Methods", value:"PayPal  \u00b7  Cash App  \u00b7  Venmo  \u00b7  Interac e-Transfer  \u00b7  Zelle  \u00b7  IBAN  \u00b7  Bank Transfer  \u00b7  Crypto\n\nAdditional fees may apply for card or bank-based payments. All fees will be clearly disclosed before deal is taken.", inline:false },
            { name:"5. Disputes & Enforcement", value:"Any attempt to chargeback, make false claims, abuse staff, or bypass policies will result in an **immediate ban** from the server.", inline:false },
          )
          .setFooter({ text:"Konvert  •  By using our services you agree to these terms" });
        await interaction.channel.send({ embeds:[embed] });
        return interaction.reply({ content:"Terms of Service embed posted.", ephemeral:true });
      }

      if (cmd === "postlinks") {
        const embed = new EmbedBuilder()
          .setColor(CONFIG.COLOR).setAuthor({ name:"Konvert", iconURL:IMG.LOGO })
          .setTitle("Official Links for Konvert").setThumbnail(IMG.LOGO)
          .setDescription("All official Konvert social media. Follow us for updates, announcements, and giveaways.\n\u200b")
          .addFields(
            { name:"\u{1D54F}  Twitter / X",  value:"[**@KonvertNow**](https://x.com/konvertnow)",                      inline:true },
            { name:"\ud83d\udcf8  Instagram",     value:"[**@KonvertNow**](https://www.instagram.com/konvertnow/)",   inline:true },
            { name:"\u26a0\ufe0f  Stay Safe",  value:"Only interact with accounts listed here. Any other account claiming to be Konvert is an impersonator.", inline:false },
          )
          .setImage(IMG.BANNER).setFooter({ text:"Konvert  •  Official Links  •  Follow us for updates" });
        await interaction.channel.send({ embeds:[embed] });
        return interaction.reply({ content:"Official links embed posted.", ephemeral:true });
      }

      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "select_method") {
        const method=interaction.values[0];
        const _m=getMethod(method);
        if (method === "crypto") {
          const coinOpts = COINS.map(c => new StringSelectMenuOptionBuilder().setLabel(c).setValue(c).setDescription(`Exchange ${c}`));
          const sendRow = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("c2c_send").setPlaceholder("Select coin you are SENDING…").addOptions(coinOpts));
          const recvRow = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("c2c_recv").setPlaceholder("Select coin you want to RECEIVE…").addOptions(coinOpts));
          return interaction.update({
            embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({ name:"Konvert", iconURL:IMG.LOGO }).setTitle("Crypto to Crypto").setDescription("Select the coin you are **sending** and the coin you want to **receive** below.\n\u200b").setFooter({ text:"Step 2 of 3  •  Konvert" })],
            components:[sendRow, recvRow],
          });
        }
        return interaction.update({ embeds:[step2Embed(method)], components:[new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`dir_send__${method}`).setLabel(`Send Crypto → Get ${_m.label}`).setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`dir_receive__${method}`).setLabel(`Send ${_m.label} → Get Crypto`).setStyle(ButtonStyle.Success),
        )] });
      }

      if (interaction.customId === "c2c_send" || interaction.customId === "c2c_recv") {
        const userId = interaction.user.id;
        if (!state.c2cSelections) state.c2cSelections = {};
        if (!state.c2cSelections[userId]) state.c2cSelections[userId] = {};
        if (interaction.customId === "c2c_send") state.c2cSelections[userId].send = interaction.values[0];
        if (interaction.customId === "c2c_recv") state.c2cSelections[userId].recv = interaction.values[0];
        const sel = state.c2cSelections[userId];
        const sendCoin = sel.send || "--";
        const recvCoin = sel.recv || "--";
        const bothSelected = sel.send && sel.recv;
        const coinOpts = COINS.map(c => new StringSelectMenuOptionBuilder().setLabel(c).setValue(c).setDescription(`Exchange ${c}`));
        const sendRow = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("c2c_send").setPlaceholder(sel.send ? `Sending: ${sel.send}` : "Select coin you are SENDING…").addOptions(coinOpts));
        const recvRow = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("c2c_recv").setPlaceholder(sel.recv ? `Receiving: ${sel.recv}` : "Select coin you want to RECEIVE…").addOptions(coinOpts));
        const components = [sendRow, recvRow];
        if (bothSelected) {
          components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("btn_c2c_confirm").setLabel(`Confirm: ${sendCoin} → ${recvCoin}`).setStyle(ButtonStyle.Success)));
        }
        return interaction.update({
          embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({ name:"Konvert", iconURL:IMG.LOGO }).setTitle("Crypto to Crypto")
            .setDescription(`**Sending:** ${sendCoin}\n**Receiving:** ${recvCoin}\n\n${bothSelected ? "Both coins selected. Click **Confirm** to continue.\n\u200b" : "Select both coins then a confirm button will appear.\n\u200b"}`)
            .setFooter({ text:"Step 2 of 3  \u2022  Konvert" })],
          components,
        });
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId === "btn_exchange_now") {
        const bl=load("blacklist");
        if (bl[interaction.user.id]) return interaction.reply({ content:"You are blacklisted from Konvert.", ephemeral:true });
        return interaction.reply({ embeds:[step1Embed()], components:[new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId("select_method").setPlaceholder("Select your payment method…")
            .addOptions(METHODS.map(m=>new StringSelectMenuOptionBuilder().setLabel(m.label).setValue(m.value).setDescription(`Exchange crypto with ${m.label}`)))
        )], ephemeral:true });
      }

      if (interaction.customId === "btn_fee_calc") {
        const modal=new ModalBuilder().setCustomId("modal_fee").setTitle("Fee Calculator");
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("fee_amt").setLabel("Trade amount in USD").setStyle(TextInputStyle.Short).setPlaceholder("e.g. 250").setRequired(true)));
        return interaction.showModal(modal);
      }

      if (interaction.customId === "btn_rates_quick") {
        await interaction.deferReply({ ephemeral:true });
        return interaction.editReply({ embeds:[await buildRatesEmbed()] });
      }

      if (interaction.customId === "btn_refresh_rates") {
        await interaction.deferUpdate();
        return interaction.editReply({ embeds:[await buildRatesEmbed()], components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("btn_refresh_rates").setLabel("Refresh").setStyle(ButtonStyle.Secondary))] });
      }

      if (interaction.customId === "btn_c2c_confirm") {
        const c2cData = state.c2cSelections?.[interaction.user.id];
        if (!c2cData?.send || !c2cData?.recv) return interaction.reply({ content:"Please select both a **sending** coin and a **receiving** coin from the dropdowns before confirming.", ephemeral:true });
        delete state.c2cSelections[interaction.user.id];
        const { send: sendCoin, recv: recvCoin } = c2cData;
        if (sendCoin === recvCoin) return interaction.reply({ content:"You cannot exchange a coin for the same coin.", ephemeral:true });
        const modal = new ModalBuilder().setCustomId(`modal_c2c__${sendCoin}__${recvCoin}`).setTitle(`${sendCoin} → ${recvCoin}`);
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("c2c_amount").setLabel(`Amount in USD you are sending`).setStyle(TextInputStyle.Short).setPlaceholder("e.g. 200").setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("c2c_wallet").setLabel(`Your ${recvCoin} receiving wallet address`).setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("c2c_notes").setLabel("Notes (optional)").setStyle(TextInputStyle.Paragraph).setRequired(false)),
        );
        return interaction.showModal(modal);
      }

      if (interaction.customId.startsWith("dir_send__") || interaction.customId.startsWith("dir_receive__")) {
        const isSend=interaction.customId.startsWith("dir_send__");
        const method=interaction.customId.replace("dir_send__","").replace("dir_receive__","");
        const m=getMethod(method);
        const modal=new ModalBuilder().setCustomId(`modal_amount__${method}__${isSend?"send":"receive"}`).setTitle(`${m.label} -- ${isSend?"Send Crypto":"Receive Crypto"}`);
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("inp_amount").setLabel("Trade amount in USD").setStyle(TextInputStyle.Short).setPlaceholder("e.g. 150").setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("inp_coin").setLabel("Which crypto? (BTC, ETH, SOL…)").setStyle(TextInputStyle.Short).setPlaceholder("e.g. SOL").setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("inp_wallet").setLabel(method==="crypto"?"Your receiving wallet address":(isSend?`Your ${m.label} receiving info`:"Your crypto receiving wallet")).setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("inp_notes").setLabel("Notes (optional)").setStyle(TextInputStyle.Paragraph).setRequired(false)),
        );
        return interaction.showModal(modal);
      }

      if (interaction.customId === "btn_confirm_ticket") {
        await interaction.deferUpdate();
        const pending=state.pending[interaction.user.id];
        if (!pending) return interaction.editReply({ content:"Session expired. Please start again.", embeds:[], components:[] });
        delete state.pending[interaction.user.id];
        const ch=await createTicket(interaction,pending.method,pending.direction,pending.rawAmt,pending.coin,pending.walletInf,pending.notes);
        if (ch) return interaction.editReply({ content:`Ticket opened → <#${ch.id}>`, embeds:[], components:[] });
        return;
      }

      if (interaction.customId === "btn_cancel_ticket") {
        delete state.pending[interaction.user.id];
        return interaction.update({ content:"Cancelled. Click Exchange Now to start again.", embeds:[], components:[] });
      }

      if (interaction.customId === "btn_support_ticket") {
        const modal=new ModalBuilder().setCustomId("modal_support").setTitle("Open a Support Ticket");
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("sup_issue").setLabel("What do you need help with?").setStyle(TextInputStyle.Paragraph).setPlaceholder("Describe your issue clearly…").setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("sup_tried").setLabel("What have you already tried?").setStyle(TextInputStyle.Short).setPlaceholder("e.g. Checked FAQ, contacted staff…").setRequired(false)),
        );
        return interaction.showModal(modal);
      }

      if (interaction.customId === "btn_done") {
        const tickets   = load("tickets");
        const ticket    = tickets[interaction.channel.id];
        const isOwner   = CONFIG.OWNER_IDS.includes(interaction.user.id);
        const isStaff   = CONFIG.STAFF_ROLE ? interaction.member.roles.cache.has(CONFIG.STAFF_ROLE) : false;
        const mRoleId   = ticket?.method ? CONFIG.ROLES[ticket.method] : null;
        const isHandler = mRoleId ? interaction.member.roles.cache.has(mRoleId) : false;
        if (!isOwner && !isStaff && !isHandler) return interaction.reply({ content:"Only staff or the assigned handler can mark a trade complete.", ephemeral:true });
        if (ticket?.status === "vouched" || ticket?.status === "closed") return interaction.reply({ content:"This ticket has already been completed.", ephemeral:true });
        await interaction.deferReply();
        const m = ticket ? getMethod(ticket.method) : null;
        if (ticket) {
          tickets[interaction.channel.id].status      = "vouched";
          tickets[interaction.channel.id].completedBy = interaction.user.id;
          tickets[interaction.channel.id].completedAt = Date.now();
          save("tickets", tickets);
          const vouchData = { clientId:ticket.userId, exchangerId:interaction.user.id, method:m?.label||ticket.method, amountUSD:ticket.amountUSD, direction:ticket.direction, coin:ticket.coin, message:null, rating:5 };
          await postVouch(interaction.guild, vouchData);
          try {
            const _allForRole = Object.values(load("tickets")).filter(t => t.userId === ticket.userId && t.status === "vouched");
            const _newVol     = _allForRole.reduce((s,t) => s+(t.amountUSD||0), 0);
            await applyTierRole(interaction.guild, ticket.userId, _newVol);
          } catch {}
          try {
            const allTickets    = Object.values(load("tickets"));
            const clientDone    = allTickets.filter(t => t.userId === ticket.userId && t.status === "vouched");
            const totalVol      = clientDone.reduce((s,t) => s+(t.amountUSD||0), 0);
            const tradeCount    = clientDone.length;
            let tier = "New Client", tierColor = CONFIG.COLOR;
            if (tradeCount >= 10 || totalVol >= 5000)       { tier = "VIP Client";       tierColor = 0xFFD700; }
            else if (tradeCount >= 5  || totalVol >= 2000)  { tier = "Trusted Client";   tierColor = 0x9B59B6; }
            else if (tradeCount >= 2)                        { tier = "Returning Client"; tierColor = CONFIG.COLOR; }
            const clientUser = await client.users.fetch(ticket.userId);
            const thankEmbed = new EmbedBuilder()
              .setColor(tierColor).setAuthor({ name:"Konvert Exchange", iconURL:IMG.LOGO }).setTitle("Thank You for Trading with Us").setThumbnail(IMG.LOGO)
              .setDescription(`Hey <@${ticket.userId}> -- your trade has been completed successfully.\n\nWe appreciate your trust in **Konvert Exchange**. Every deal matters to us and we look forward to trading with you again.\n\u200b`)
              .addFields(
                { name:"Your Tier",        value:`**${tier}**`,                              inline:true },
                { name:"Trades With Us",   value:`**${tradeCount}** completed`,              inline:true },
                { name:"Total Exchanged",  value:`**${fmtUSD(totalVol)}**`,                  inline:true },
                { name:"This Trade",       value:`**${fmtUSD(ticket.amountUSD)}** via ${m?.label||ticket.method}`, inline:false },
                { name:"Come Back Anytime",value:`Head to our exchange channel anytime to open a new ticket.\n**Fast  \u00b7  Safe  \u00b7  Simple  \u00b7  Private**`, inline:false },
              )
              .setImage(IMG.DEAL).setTimestamp().setFooter({ text:"Konvert Exchange  •  Thank you for your business" });
            await clientUser.send({ embeds:[thankEmbed] });
          } catch {}
        }
        const completionEmbed = ticket
          ? buildDealEmbed({ clientId:ticket.userId, exchangerId:interaction.user.id, method:m?.label||ticket.method, amountUSD:ticket.amountUSD, direction:ticket.direction, coin:ticket.coin, message:null, rating:5 })
          : new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({ name:"Konvert",iconURL:IMG.LOGO }).setTitle("Trade Complete").setDescription("Trade marked complete by staff.").setImage(IMG.DEAL).setTimestamp().setFooter({ text:"Konvert" });
        const replyEmbed = new EmbedBuilder(completionEmbed.data).setDescription("Vouch posted to vouch channel. Thank-you card sent to client. This ticket closes in **15 seconds**.");
        await interaction.editReply({ embeds:[replyEmbed] });
        setTimeout(async () => {
          await doCloseTicket(interaction.channel, interaction.guild, interaction.user, "Trade completed");
          interaction.channel.delete().catch(() => {});
        }, 15000);
        return;
      }

      if (interaction.customId === "btn_close") {
        if (!CONFIG.OWNER_IDS.includes(interaction.user.id) && !(CONFIG.STAFF_ROLE && interaction.member.roles.cache.has(CONFIG.STAFF_ROLE))) {
          return interaction.reply({ content:"Only owners or staff can close tickets.", ephemeral:true });
        }
        await interaction.deferReply();
        await doCloseTicket(interaction.channel, interaction.guild, interaction.user, "Closed by staff");
        await interaction.editReply({ embeds:[new EmbedBuilder().setColor(0xFF4444).setTitle("Ticket Closed").setDescription("This ticket has been closed.\nDeleting in 15 seconds.").setTimestamp()] });
        setTimeout(()=>interaction.channel.delete().catch(()=>{}),15000);
        return;
      }

      if (interaction.customId.startsWith("mine_cell_")) {
        const parts=interaction.customId.split("_");
        const userId=parts[2]; const idx=parseInt(parts[3]);
        if (interaction.user.id!==userId) return interaction.reply({ content:"This is not your mine game.", ephemeral:true });
        const game=state.mineGames[userId];
        if (!game) return interaction.reply({ content:"No active game. Use /mine to start.", ephemeral:true });
        if (game.over) return interaction.reply({ content:"This game is already over.", ephemeral:true });
        if (game.revealed.includes(idx)) return interaction.reply({ content:"You already revealed that cell.", ephemeral:true });
        game.revealed.push(idx); game.tries++;
        const isDiamond=game.diamonds.includes(idx);
        const isBomb=game.bombs.includes(idx);
        if (isDiamond) game.found++;
        if (isBomb) {
          game.over=true; delete state.mineGames[userId];
          const revealGame={ ...game, revealed:Array.from({length:25},(_,i)=>i), over:true };
          return interaction.update({ embeds:[base("Mine -- Bomb Hit").setColor(0xFF4444)
            .setDescription("**BOOM!** You hit a bomb. The grid has been revealed.\n\nBetter luck next time -- you can try again in **3 hours**.\n\u200b")
            .addFields(
              { name:"Diamonds Found", value:`**${game.found} / 3**`, inline:true },
              { name:"Result",         value:"No pass awarded",        inline:true },
              { name:"Next Try",       value:"In **3 hours**",         inline:true },
            ).setFooter({ text:"Konvert Mine  •  Try again in 3 hours" })],
            components:buildMineGrid(userId,revealGame) });
        }
        const triesLeft=3-game.tries;
        if (triesLeft<=0&&game.found<3) {
          game.over=true; delete state.mineGames[userId];
          const revealGame={ ...game, revealed:Array.from({length:25},(_,i)=>i), over:true };
          return interaction.update({ embeds:[base("Mine -- Out of Tries")
            .setDescription(`You used all **3 tries** and found **${game.found} / 3** diamonds.\nThe grid has been revealed. Try again in **3 hours**.\n\u200b`)
            .addFields(
              { name:"Diamonds Found", value:`**${game.found} / 3**`, inline:true },
              { name:"Result",         value:"No pass awarded",        inline:true },
              { name:"Next Try",       value:"In **3 hours**",         inline:true },
            ).setFooter({ text:"Konvert Mine  •  Try again in 3 hours" })],
            components:buildMineGrid(userId,revealGame) });
        }
        if (game.found===3) {
          game.over=true; delete state.mineGames[userId];
          state.passes[userId]=(state.passes[userId]||0)+1;
          try { const member=await interaction.guild.members.fetch(userId); if(CONFIG.PASS_ROLE) await member.roles.add(CONFIG.PASS_ROLE); } catch {}
          for (const oid of CONFIG.OWNER_IDS) {
            try { const owner=await client.users.fetch(oid); await owner.send({ embeds:[new EmbedBuilder().setColor(0xFFD700).setAuthor({ name:"Konvert Mine -- Winner",iconURL:IMG.LOGO }).setTitle("Exchange Pass Won").setDescription(`<@${userId}> (${interaction.user.tag}) found all 3 diamonds and won a free exchange pass.\nTotal passes: **${state.passes[userId]}**`).setTimestamp()] }); } catch {}
          }
          return interaction.update({ embeds:[new EmbedBuilder().setColor(0xFFD700).setAuthor({ name:"Konvert",iconURL:IMG.LOGO }).setTitle("All 3 Diamonds Found")
            .setDescription("You found every diamond without hitting a bomb.\n\nA **Free Exchange Pass** has been awarded and the role has been added to your account.\nOpen a ticket and let staff know.\n\u200b")
            .addFields(
              { name:"Pass Holder", value:`<@${userId}>`,               inline:true },
              { name:"Passes",      value:`**${state.passes[userId]}**`, inline:true },
              { name:"Tries Used",  value:`**${game.tries} / 3**`,      inline:true },
            ).setFooter({ text:"Konvert Mine  •  Screenshot this as proof" }).setTimestamp()],
            components:[] });
        }
        return interaction.update({ embeds:[base("Konvert Mine").setThumbnail(IMG.LOGO)
          .setDescription(`${isDiamond?"**Diamond found!** Keep going.":"Nothing there. Keep looking."}\n\u200b`)
          .addFields(
            { name:"Diamonds Found",  value:`**${game.found} / 3**`, inline:true },
            { name:"Tries Remaining", value:`**${triesLeft}**`,      inline:true },
          ).setFooter({ text:`Konvert Mine  •  ${triesLeft} tr${triesLeft!==1?"ies":"y"} left  •  Hit a bomb = game over` })],
          components:buildMineGrid(userId,game) });
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === "modal_support") {
        const issue=interaction.fields.getTextInputValue("sup_issue");
        const tried=interaction.fields.getTextInputValue("sup_tried")||"Not specified";
        const user=interaction.user; const guild=interaction.guild;
        let ch;
        try {
          ch=await guild.channels.create({
            name:`support-${user.username.replace(/[^a-z0-9]/gi,"").toLowerCase().slice(0,12)}`,
            type:ChannelType.GuildText, parent:CONFIG.TICKET_CATEGORY||null,
            permissionOverwrites:[
              { id:guild.roles.everyone,deny:[PermissionFlagsBits.ViewChannel] },
              { id:user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory] },
              ...(CONFIG.STAFF_ROLE?[{ id:CONFIG.STAFF_ROLE,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.ManageChannels] }]:[]),
              ...CONFIG.OWNER_IDS.map(id=>({ id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.ManageChannels] })),
            ],
          });
        } catch { return interaction.reply({ content:"Failed to create support channel.", ephemeral:true }); }
        await ch.send({ content:`<@${user.id}>`, embeds:[new EmbedBuilder().setColor(0xFF6B35).setAuthor({ name:"Konvert  •  Support",iconURL:IMG.LOGO }).setTitle("Support Ticket").setThumbnail(IMG.LOGO)
          .setDescription(`**Welcome, <@${user.id}>**\n\nStaff will assist you shortly. Please be patient.\n\u200b`)
          .addFields({ name:"Issue",value:issue,inline:false },{ name:"What Tried",value:tried,inline:false })
          .setTimestamp().setFooter({ text:"Konvert  •  Support Ticket" })],
          components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("btn_close").setLabel("Close Ticket").setStyle(ButtonStyle.Danger))] });
        if (CONFIG.STAFF_ROLE) await ch.send(`<@&${CONFIG.STAFF_ROLE}> -- New support ticket from <@${user.id}>`);
        log(guild,`SUPPORT: #${ch.name} opened by ${user.tag}`);
        return interaction.reply({ content:`Support ticket opened → <#${ch.id}>`, ephemeral:true });
      }

      if (interaction.customId === "modal_review") {
        const text=interaction.fields.getTextInputValue("review_text");
        const rating=Math.min(Math.max(parseInt(interaction.fields.getTextInputValue("review_rating"))||5,1),5);
        const stars="★".repeat(rating)+"☆".repeat(5-rating);
        const targetCh=CONFIG.VOUCH_CHANNEL?interaction.guild.channels.cache.get(CONFIG.VOUCH_CHANNEL):interaction.channel;
        if (!targetCh) return interaction.reply({ content:"Review channel not configured.", ephemeral:true });
        await targetCh.send({ embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({ name:"Konvert",iconURL:IMG.LOGO }).setTitle("Community Review")
          .setDescription(`*"${text}"*`)
          .addFields({ name:"From",value:`<@${interaction.user.id}>`,inline:true },{ name:"Rating",value:stars,inline:true })
          .setTimestamp().setFooter({ text:"Konvert  •  Community Review" })] });
        return interaction.reply({ content:"Your review has been posted. Thank you!", ephemeral:true });
      }

      if (interaction.customId === "modal_fee") {
        const raw=parseFloat(interaction.fields.getTextInputValue("fee_amt"));
        if (isNaN(raw)||raw<=0) return interaction.reply({ content:"Please enter a valid amount.", ephemeral:true });
        const fS=calcFee(raw,"send"),rS=feeRate(raw,"send");
        const fR=calcFee(raw,"receive"),rR=feeRate(raw,"receive");
        return interaction.reply({ embeds:[base("Fee Calculator").setThumbnail(IMG.LOGO)
          .setDescription(`Estimate for **${fmtUSD(raw)}**\n*Final fee may vary slightly.*\n\u200b`)
          .addFields(
            { name:"Fiat → Crypto",value:`Rate: **${rS}%**\nFee: **${fmtUSD(fS)}**\nYou receive: **${fmtUSD(raw-fS)}**`,inline:true },
            { name:"Crypto → Fiat",value:`Rate: **${rR}%**\nFee: **${fmtUSD(fR)}**\nYou receive: **${fmtUSD(raw-fR)}**`,inline:true },
          ).setImage(IMG.FEE).setFooter({ text:"Konvert  •  Open a ticket to begin" })], ephemeral:true });
      }

      if (interaction.customId.startsWith("modal_c2c__")) {
        await interaction.deferReply({ ephemeral:true });
        const parts     = interaction.customId.split("__");
        const sendCoin  = parts[1];
        const recvCoin  = parts[2];
        const rawAmt    = parseFloat(interaction.fields.getTextInputValue("c2c_amount"));
        const walletInf = interaction.fields.getTextInputValue("c2c_wallet").trim();
        const notes     = interaction.fields.getTextInputValue("c2c_notes")?.trim()||"";
        if (isNaN(rawAmt)||rawAmt<=0) return interaction.editReply("Please enter a valid amount greater than $0.");
        if (!walletInf) return interaction.editReply("Please enter your receiving wallet address.");
        const fee   = calcFee(rawAmt,"send");
        const rate  = feeRate(rawAmt,"send");
        state.pending[interaction.user.id] = { method:"crypto", direction:"send", rawAmt, coin:sendCoin, walletInf, notes, recvCoin };
        const confirmEmbed = new EmbedBuilder()
          .setColor(CONFIG.COLOR).setAuthor({ name:"Konvert", iconURL:IMG.LOGO }).setTitle("Confirm Crypto to Crypto Exchange").setThumbnail(COIN_LOGO[sendCoin]||IMG.LOGO)
          .setDescription("Review your details below before confirming.\n​")
          .addFields(
            { name:"You Send",       value:`**${sendCoin}** worth **${fmtUSD(rawAmt)}**`, inline:true },
            { name:"You Receive",    value:`**${recvCoin}**`,                             inline:true },
            { name:"Est. Fee",       value:`**${rate}%** -- ${fmtUSD(fee)}`,              inline:true },
            { name:"Receiving Wallet", value:`||${walletInf}||`,                         inline:false },
            ...(notes?[{ name:"Notes", value:notes, inline:false }]:[]),
          ).setFooter({ text:"Fee is an estimate and may vary slightly  •  Konvert" });
        return interaction.editReply({ embeds:[confirmEmbed], components:[new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("btn_confirm_ticket").setLabel("Confirm & Open Ticket").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("btn_cancel_ticket").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
        )] });
      }

      if (interaction.customId.startsWith("modal_amount__")) {
        await interaction.deferReply({ ephemeral:true });
        const parts=interaction.customId.split("__");
        const method=parts[1]; const direction=parts[2];
        const m=getMethod(method);
        const rawAmt=parseFloat(interaction.fields.getTextInputValue("inp_amount"));
        const coin=interaction.fields.getTextInputValue("inp_coin").toUpperCase().trim();
        const walletInf=interaction.fields.getTextInputValue("inp_wallet").trim();
        const notes=interaction.fields.getTextInputValue("inp_notes")?.trim()||"";
        if (isNaN(rawAmt)||rawAmt<=0) return interaction.editReply("Please enter a valid amount greater than $0.");
        if (!COINS.includes(coin)) return interaction.editReply(`**${coin}** is not supported. Supported: ${COINS.join(", ")}`);
        if (!walletInf) return interaction.editReply("Please enter your wallet or account info.");
        const fee=calcFee(rawAmt,direction); const rate=feeRate(rawAmt,direction); const recv=rawAmt-fee;
        const sendLabel=direction==="send"?`**${coin}** worth **${fmtUSD(rawAmt)}**`:`**${fmtUSD(rawAmt)}** via ${m.label}`;
        const recvLabel=direction==="send"?`**${fmtUSD(recv)}** via ${m.label}`:recv<5?"To be discussed":`**~${fmtUSD(recv)}** worth of ${coin}`;
        state.pending[interaction.user.id]={ method, direction, rawAmt, coin, walletInf, notes };
        const confirmEmbed=new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({ name:"Konvert",iconURL:IMG.LOGO }).setTitle("Confirm Your Exchange")
          .setThumbnail(COIN_LOGO[coin]||IMG.LOGO).setDescription("Review your details below before confirming.\n\u200b")
          .addFields(
            { name:"Method",    value:`**${m.label}**`,                                           inline:true },
            { name:"Crypto",    value:`**${coin}**`,                                              inline:true },
            { name:"Direction", value:`**${direction==="send"?"Fiat → Crypto":"Crypto → Fiat"}**`, inline:true },
            { name:"Sending",   value:sendLabel,                                                  inline:true },
            { name:"Receiving", value:recvLabel,                                                  inline:true },
            { name:"Est. Fee",  value:`**${rate}%** -- ${fmtUSD(fee)}`,                           inline:true },
            { name:"Your Info", value:`||${walletInf}||`,                                        inline:false },
          ).setFooter({ text:"Fee is an estimate and may vary slightly  •  Konvert" });
        return interaction.editReply({ embeds:[confirmEmbed], components:[new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("btn_confirm_ticket").setLabel("Confirm & Open Ticket").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("btn_cancel_ticket").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
        )] });
      }
    }

  } catch (err) {
    console.error("Interaction error:", err);
    try {
      const errMsg={ content:"Something went wrong. Please try again.", ephemeral:true };
      if (interaction.deferred||interaction.replied) await interaction.followUp(errMsg).catch(()=>{});
      else await interaction.reply(errMsg).catch(()=>{});
    } catch {}
  }
});

// ─── AUTO RATES ──────────────────────────────────────────────
let ratesMsgId=null;
async function autoRates(guild) {
  if (!CONFIG.RATES_CHANNEL||!guild) return;
  const ch=guild.channels.cache.get(CONFIG.RATES_CHANNEL);
  if (!ch) return;
  try {
    const embed=await buildRatesEmbed();
    if (ratesMsgId) {
      const msg=await ch.messages.fetch(ratesMsgId).catch(()=>null);
      if (msg){ await msg.edit({ embeds:[embed] }); return; }
    }
    const sent=await ch.send({ embeds:[embed] });
    ratesMsgId=sent.id;
  } catch (e){ console.error("Auto rates:",e.message); }
}

// ─── PRICE ALERT CHECKER ─────────────────────────────────────
async function checkAlerts() {
  if (!state.alerts.length) return;
  const ids=[...new Set(state.alerts.map(a=>GECKO[a.coin]||a.coin.toLowerCase()))].join(",");
  try {
    const res=await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,{signal:AbortSignal.timeout(6000)});
    const prices=await res.json();
    const fired=[];
    for (const alert of state.alerts) {
      const price=prices[GECKO[alert.coin]||alert.coin.toLowerCase()]?.usd;
      if (!price) continue;
      if (!(alert.direction==="above"?price>=alert.target:price<=alert.target)) continue;
      try {
        const user=await client.users.fetch(alert.userId);
        await user.send({ embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({ name:"Konvert",iconURL:IMG.LOGO }).setTitle("Price Alert Triggered")
          .setDescription(`**${alert.coin}** is now **${alert.direction==="above"?"above":"below"}** your target of **$${alert.target.toLocaleString("en-US")}**\n\nCurrent price: **$${price.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}**\n\nHead to <#${CONFIG.EXCHANGE_CHANNEL}> to open a trade.`)
          .setThumbnail(COIN_LOGO[alert.coin]||IMG.LOGO).setTimestamp().setFooter({ text:"Konvert  •  Price Alerts" })] });
      } catch {}
      fired.push(alert);
    }
    state.alerts=state.alerts.filter(a=>!fired.includes(a));
  } catch {}
}

// ─── READY ───────────────────────────────────────────────────
client.once(Events.ClientReady, async () => {
  console.log(`Konvert Bot online -- ${client.user.tag}`);
  client.user.setPresence({ activities:[{ name:"Konvert", type:3 }], status:"online" });
  const guild=client.guilds.cache.get(CONFIG.GUILD_ID);
  if (guild) {
    await autoRates(guild);
    setInterval(()=>autoRates(guild), 10*60*1000);
    setInterval(()=>checkAlerts(), 5*60*1000);
  }
});

// ─── BOOT ────────────────────────────────────────────────────
registerCommands().then(()=>client.login(CONFIG.TOKEN)).catch(console.error);
