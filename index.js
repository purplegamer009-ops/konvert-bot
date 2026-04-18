// ============================================================
//  KONVERT BOT — Final Clean Version
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
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
const fs = require("fs");

// ─── IMAGES ──────────────────────────────────────────────────
const IMG = {
  LOGO:   "https://i.imgur.com/GXwsQv0.png",
  VOUCH:  "https://i.imgur.com/cSxxqd2.png",
  TICKET: "https://i.imgur.com/1bcQqKx.png",
  RATES:  "https://i.imgur.com/SF8G50a.png",
  FEE:    "https://i.imgur.com/pYBg770.png",
  RULES:  "https://i.imgur.com/mUUxkET.png",
};

// ─── CONFIG ──────────────────────────────────────────────────
const CONFIG = {
  TOKEN:     process.env.DISCORD_TOKEN,
  CLIENT_ID: process.env.CLIENT_ID,
  GUILD_ID:  process.env.GUILD_ID,
  OWNER_IDS: (process.env.OWNER_IDS || "").split(",").map(s => s.trim()).filter(Boolean),
  STAFF_ROLE:      process.env.STAFF_ROLE_ID   || null,
  TICKET_CATEGORY: process.env.TICKET_CATEGORY_ID || null,
  VOUCH_CHANNEL:   process.env.VOUCH_CHANNEL_ID   || null,
  LOG_CHANNEL:     process.env.LOG_CHANNEL_ID     || null,
  RATES_CHANNEL:   process.env.RATES_CHANNEL_ID   || null,
  EXCHANGE_CHANNEL:"1463731676021784587",
  MIN_FEE: 5,
  COLOR:   0x7C4DFF,
  ROLES: {
    paypal: process.env.ROLE_PAYPAL, cashapp: process.env.ROLE_CASHAPP,
    zelle: process.env.ROLE_ZELLE, interac: process.env.ROLE_INTERAC,
    venmo: process.env.ROLE_VENMO, applepay: process.env.ROLE_APPLEPAY,
    skrill: process.env.ROLE_SKRILL, revolut: process.env.ROLE_REVOLUT,
    upi: process.env.ROLE_UPI, chime: process.env.ROLE_CHIME,
    bank: process.env.ROLE_BANK, iban: process.env.ROLE_IBAN,
    giftcard: process.env.ROLE_GIFTCARD, wire: process.env.ROLE_WIRE,
    googlepay: process.env.ROLE_GOOGLEPAY,
  },
};

// ─── PAYMENT METHODS ─────────────────────────────────────────
const METHODS = [
  { value: "paypal",    label: "PayPal"        },
  { value: "cashapp",   label: "Cash App"      },
  { value: "zelle",     label: "Zelle"         },
  { value: "interac",   label: "Interac"       },
  { value: "venmo",     label: "Venmo"         },
  { value: "applepay",  label: "Apple Pay"     },
  { value: "skrill",    label: "Skrill"        },
  { value: "revolut",   label: "Revolut"       },
  { value: "upi",       label: "UPI"           },
  { value: "chime",     label: "Chime"         },
  { value: "bank",      label: "Bank Transfer" },
  { value: "iban",      label: "IBAN / SWIFT"  },
  { value: "giftcard",  label: "Gift Card"     },
  { value: "wire",      label: "Wire Transfer" },
  { value: "googlepay", label: "Google Pay"    },
];
const getMethod = v => METHODS.find(m => m.value === v) || null;

// ─── COINS ───────────────────────────────────────────────────
const COINS = ["BTC","ETH","SOL","LTC","USDT","USDC","XRP","BNB","ADA","DOGE","MATIC","AVAX","DOT","LINK","TRX","SHIB","UNI","ATOM","FTM","NEAR"];
const GECKO = { BTC:"bitcoin",ETH:"ethereum",SOL:"solana",LTC:"litecoin",USDT:"tether",USDC:"usd-coin",XRP:"ripple",BNB:"binancecoin",ADA:"cardano",DOGE:"dogecoin",MATIC:"matic-network",AVAX:"avalanche-2",DOT:"polkadot",LINK:"chainlink",TRX:"tron",SHIB:"shiba-inu",UNI:"uniswap",ATOM:"cosmos",FTM:"fantom",NEAR:"near" };
const COIN_LOGO = { BTC:"https://assets.coingecko.com/coins/images/1/large/bitcoin.png",ETH:"https://assets.coingecko.com/coins/images/279/large/ethereum.png",SOL:"https://assets.coingecko.com/coins/images/4128/large/solana.png",LTC:"https://assets.coingecko.com/coins/images/2/large/litecoin.png",USDT:"https://assets.coingecko.com/coins/images/325/large/Tether.png",USDC:"https://assets.coingecko.com/coins/images/6319/large/usdc.png",XRP:"https://assets.coingecko.com/coins/images/44/large/xrp-symbol-white-128.png",BNB:"https://assets.coingecko.com/coins/images/825/large/binance-coin-logo.png",ADA:"https://assets.coingecko.com/coins/images/975/large/cardano.png",DOGE:"https://assets.coingecko.com/coins/images/5/large/dogecoin.png" };

// ─── STORAGE ─────────────────────────────────────────────────
const DB = { tickets:"./tickets.json", wallets:"./wallets.json", blacklist:"./blacklist.json" };
const load = k => { try { return JSON.parse(fs.readFileSync(DB[k],"utf8")); } catch { return {}; } };
const save = (k,d) => { try { fs.writeFileSync(DB[k],JSON.stringify(d,null,2)); } catch {} };

// ─── HELPERS ─────────────────────────────────────────────────
const fmtUSD = n => n >= 1 ? `$${n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}` : `$${n.toFixed(6)}`;

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

const base = title => new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({ name:"Konvert", iconURL:IMG.LOGO }).setTitle(title).setTimestamp();

function log(guild, msg) {
  if (!CONFIG.LOG_CHANNEL || !guild) return;
  const ch = guild.channels.cache.get(CONFIG.LOG_CHANNEL);
  if (ch) ch.send({ embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setDescription("```"+msg+"```").setTimestamp()] }).catch(()=>{});
}

async function getPrice(coin) {
  try {
    const id = GECKO[coin] || coin.toLowerCase();
    const r  = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`);
    const d  = await r.json();
    return d[id]?.usd || null;
  } catch { return null; }
}

// ─── SLASH COMMANDS ──────────────────────────────────────────
const COMMANDS = [
  new SlashCommandBuilder().setName("postexchange").setDescription("[Owner] Post the exchange embed in this channel").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("rates").setDescription("View live crypto rates"),
  new SlashCommandBuilder().setName("fee").setDescription("Calculate your Konvert fee").addNumberOption(o=>o.setName("amount_usd").setDescription("Amount in USD").setRequired(true)),
  new SlashCommandBuilder().setName("convert").setDescription("Convert between crypto and fiat").addNumberOption(o=>o.setName("amount").setDescription("Amount").setRequired(true)).addStringOption(o=>o.setName("from").setDescription("From (BTC, USD…)").setRequired(true)).addStringOption(o=>o.setName("to").setDescription("To (ETH, CAD…)").setRequired(true)),
  new SlashCommandBuilder().setName("stats").setDescription("View exchange stats").addUserOption(o=>o.setName("user").setDescription("User (leave blank for yourself)").setRequired(false)),
  new SlashCommandBuilder().setName("leaderboard").setDescription("Top traders by volume"),
  new SlashCommandBuilder().setName("market").setDescription("Live market summary — top movers"),
  new SlashCommandBuilder().setName("wallets").setDescription("View Konvert deposit wallet addresses"),
  new SlashCommandBuilder().setName("mm").setDescription("Middleman guide — how to pick one for your trade"),
  new SlashCommandBuilder().setName("mine").setDescription("Find 3 diamonds in a 5x5 grid to win a free exchange pass"),
  new SlashCommandBuilder().setName("vouch").setDescription("Manually record a vouch for a completed trade").addUserOption(o=>o.setName("client").setDescription("The client who received the exchange").setRequired(true)).addUserOption(o=>o.setName("exchanger").setDescription("The exchanger who completed the trade").setRequired(true)).addStringOption(o=>o.setName("message").setDescription("Review message").setRequired(true)).addStringOption(o=>o.setName("method").setDescription("Payment method used").setRequired(true)).addNumberOption(o=>o.setName("amount").setDescription("Trade amount in USD").setRequired(true)).addIntegerOption(o=>o.setName("rating").setDescription("Rating 1-5").setMinValue(1).setMaxValue(5).setRequired(false)),
  new SlashCommandBuilder().setName("alert").setDescription("Get alerted when a coin hits a target price").addStringOption(o=>o.setName("coin").setDescription("Coin (BTC, ETH…)").setRequired(true)).addNumberOption(o=>o.setName("price").setDescription("Target price in USD").setRequired(true)).addStringOption(o=>o.setName("direction").setDescription("above or below").setRequired(true).addChoices({name:"Above",value:"above"},{name:"Below",value:"below"})),
  new SlashCommandBuilder().setName("closeticket").setDescription("[Owner] Close this ticket").addStringOption(o=>o.setName("reason").setDescription("Reason").setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("setwallet").setDescription("[Owner] Update a deposit wallet address").addStringOption(o=>o.setName("coin").setDescription("Coin symbol").setRequired(true)).addStringOption(o=>o.setName("address").setDescription("New address").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("announce").setDescription("[Owner] Post an announcement").addStringOption(o=>o.setName("message").setDescription("Message").setRequired(true)).addStringOption(o=>o.setName("channel").setDescription("Channel ID").setRequired(true)).addStringOption(o=>o.setName("ping").setDescription("everyone / here / none").setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("blacklist").setDescription("[Owner] Blacklist a user").addUserOption(o=>o.setName("user").setDescription("User").setRequired(true)).addStringOption(o=>o.setName("reason").setDescription("Reason").setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("unblacklist").setDescription("[Owner] Remove blacklist").addUserOption(o=>o.setName("user").setDescription("User").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version:"10" }).setToken(CONFIG.TOKEN);
  console.log("Registering commands…");
  await rest.put(Routes.applicationGuildCommands(CONFIG.CLIENT_ID, CONFIG.GUILD_ID), { body: COMMANDS });
  console.log("Commands registered.");
}

// ─── CLIENT ──────────────────────────────────────────────────
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel],
});

// In-memory state
const state = { pending:{}, mineGames:{}, cooldowns:{}, alerts:[], passes:{} };

// ─── EMBED BUILDERS ──────────────────────────────────────────
function mainEmbed() {
  return new EmbedBuilder()
    .setColor(CONFIG.COLOR)
    .setAuthor({ name:"Konvert", iconURL:IMG.LOGO })
    .setTitle("Konvert Exchange")
    .setDescription("**Fast. Safe. Simple.**\nExchange crypto with any major payment method. Open a private ticket — a verified handler will assist you.\n\u200b")
    .addFields(
      { name:"Payment Methods", value:METHODS.map(m=>`**${m.label}**`).join("  ·  "), inline:false },
      { name:"Supported Crypto", value:COINS.map(c=>`\`${c}\``).join("  "), inline:false },
      { name:"Fee", value:"5% – 9%\nTiered by amount", inline:true },
      { name:"Speed", value:"Usually < 10 min\nOften faster", inline:true },
      { name:"Support", value:"24/7\nAlways available", inline:true },
    )
    .setImage(IMG.TICKET)
    .setFooter({ text:"Konvert  •  Click Exchange Now to begin" });
}

function mainButtons() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("btn_exchange_now").setLabel("Exchange Now").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("btn_fee_calc").setLabel("Calculate Fee").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("btn_rates_quick").setLabel("Live Rates").setStyle(ButtonStyle.Secondary),
  )];
}

function step1Embed() {
  return new EmbedBuilder()
    .setColor(CONFIG.COLOR).setAuthor({ name:"Konvert", iconURL:IMG.LOGO })
    .setTitle("Step 1 — Payment Method")
    .setDescription("Select your payment method from the dropdown below.\n\u200b")
    .setFooter({ text:"Step 1 of 3  •  Konvert" });
}

function step2Embed(method) {
  const m = getMethod(method);
  return new EmbedBuilder()
    .setColor(CONFIG.COLOR).setAuthor({ name:"Konvert", iconURL:IMG.LOGO })
    .setTitle(`Step 2 — ${m.label}`)
    .setDescription(
      `**Send Crypto → Receive ${m.label}**\nYou send crypto. We pay you via ${m.label}.\n\n` +
      `**Send ${m.label} → Receive Crypto**\nYou pay via ${m.label}. We send crypto to your wallet.`
    )
    .setFooter({ text:"Step 2 of 3  •  Konvert" });
}

// ─── RATES ───────────────────────────────────────────────────
async function buildRatesEmbed() {
  const ids = COINS.map(c => GECKO[c]||c.toLowerCase()).join(",");
  const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd,cad&include_24hr_change=true`);
  const p   = await res.json();
  const lines = COINS.map(coin => {
    const d = p[GECKO[coin]||coin.toLowerCase()];
    if (!d) return null;
    const usd = d.usd.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
    const cad = d.cad.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
    const ch  = parseFloat(d.usd_24h_change||0).toFixed(2);
    const arr = Number(ch) >= 0 ? "▲" : "▼";
    return `\`${coin.padEnd(5)}\` **$${usd}**  ·  CA$${cad}  ·  ${arr} ${ch}%`;
  }).filter(Boolean).join("\n");

  return new EmbedBuilder()
    .setColor(CONFIG.COLOR).setAuthor({ name:"Konvert", iconURL:IMG.LOGO })
    .setTitle("Live Rates").setThumbnail(COIN_LOGO["BTC"])
    .setDescription(lines + "\n\u200b")
    .addFields({ name:"Start an Exchange", value:`Head to <#${CONFIG.EXCHANGE_CHANNEL}> and tap **Exchange Now**.\nType **$BTC**, **$ETH** etc. in any channel for a detailed single-coin lookup.`, inline:false })
    .setImage(IMG.RATES)
    .setFooter({ text:"Rates refresh every 10 min  •  Konvert" }).setTimestamp();
}

// ─── TICKET CREATION ─────────────────────────────────────────
async function createTicket(interaction, method, direction, amountUSD, coin, walletInfo, notes) {
  const guild   = interaction.guild;
  const user    = interaction.user;
  const m       = getMethod(method);
  const tickets = load("tickets");

  const existing = Object.entries(tickets).find(([,t]) => t.userId === user.id && t.status === "open");
  if (existing) {
    await interaction.editReply({ content:`You already have an open ticket: <#${existing[0]}>`, embeds:[], components:[] });
    return null;
  }

  const feeUSD   = calcFee(amountUSD, direction);
  const rate     = feeRate(amountUSD, direction);
  const receiveU = amountUSD - feeUSD;
  let coinAmt = null;
  try { const price = await getPrice(coin); if (price) coinAmt = (receiveU / price).toFixed(6); } catch {}

  const sendLabel    = direction === "send"
    ? `**${coin}** worth ${fmtUSD(amountUSD)}`
    : `${fmtUSD(amountUSD)} via ${m.label}`;
  const receiveLabel = direction === "send"
    ? `${fmtUSD(receiveU)} via ${m.label}`
    : receiveU < 5 ? "To be discussed" : coinAmt ? `${coinAmt} ${coin}` : `${fmtUSD(receiveU)} worth of ${coin}`;

  const perms = [
    { id:guild.roles.everyone, deny:[PermissionFlagsBits.ViewChannel] },
    { id:user.id, allow:[PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
  ];
  if (CONFIG.STAFF_ROLE) perms.push({ id:CONFIG.STAFF_ROLE, allow:[PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] });
  const mRoleId = CONFIG.ROLES[m.value];
  if (mRoleId && mRoleId !== CONFIG.STAFF_ROLE) perms.push({ id:mRoleId, allow:[PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  for (const oid of CONFIG.OWNER_IDS) perms.push({ id:oid, allow:[PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] });

  let ch;
  try {
    ch = await guild.channels.create({
      name:`${m.value}-${Math.round(amountUSD)}-${user.username.replace(/[^a-z0-9]/gi,"").toLowerCase().slice(0,12)}`,
      type:ChannelType.GuildText,
      parent:CONFIG.TICKET_CATEGORY||null,
      permissionOverwrites:perms,
    });
  } catch (err) {
    await interaction.editReply({ content:`Failed to create ticket: ${err.message}`, embeds:[], components:[] });
    return null;
  }

  const ticketEmbed = new EmbedBuilder()
    .setColor(CONFIG.COLOR)
    .setAuthor({ name:"Konvert", iconURL:IMG.LOGO })
    .setTitle(`${m.label} Exchange`)
    .setThumbnail(COIN_LOGO[coin] || IMG.LOGO)
    .setDescription(`**Welcome, <@${user.id}>**\n\nYour ticket is open. A **${m.label}** handler has been notified and will confirm your details shortly.\n\u200b`)
    .addFields(
      { name:"Sending",   value:sendLabel,                                  inline:true },
      { name:"Receiving", value:receiveLabel,                               inline:true },
      { name:"Fee",       value:`**${rate}%**  —  ${fmtUSD(feeUSD)}`,      inline:true },
      { name:direction === "send" ? `Your ${m.label} Details` : "Your Receiving Wallet", value:`\`${walletInfo}\``, inline:false },
    );
  if (notes) ticketEmbed.addFields({ name:"Notes", value:notes, inline:false });
  ticketEmbed.setImage(IMG.TICKET).setTimestamp().setFooter({ text:"Konvert  •  All communication stays in this ticket" });

  const rulesEmbed = new EmbedBuilder()
    .setColor(CONFIG.COLOR)
    .setTitle("Before You Proceed")
    .setDescription(
      "**Middleman required on all trades.**\n" +
      "We support various trusted third-party MMs — agree on one with your exchanger before sending anything.\n\n" +
      "**Do not go first** unless **@jswaps** or **@3uce** explicitly tells you to in this ticket.\n\n" +
      "Staff will **never** DM you first. Anyone claiming to be Konvert in your DMs is an impersonator."
    )
    .setImage(IMG.RULES)
    .setFooter({ text:"Konvert  •  Stay safe, stay in this ticket" });

  const btns = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("btn_done").setLabel("Mark Trade Complete").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("btn_close").setLabel("Close Ticket").setStyle(ButtonStyle.Danger),
  );

  await ch.send({ content:`<@${user.id}>`, embeds:[ticketEmbed, rulesEmbed], components:[btns] });

  const pings = [];
  if (mRoleId) pings.push(`<@&${mRoleId}>`);
  if (CONFIG.STAFF_ROLE && CONFIG.STAFF_ROLE !== mRoleId) pings.push(`<@&${CONFIG.STAFF_ROLE}>`);
  if (pings.length) await ch.send(`${pings.join(" ")} — New **${m.label}** exchange ticket!`);

  const t = load("tickets");
  t[ch.id] = { userId:user.id, userTag:user.tag, method, direction, coin, amountUSD, feeUSD, walletInfo, notes:notes||"", status:"open", createdAt:Date.now() };
  save("tickets", t);
  log(guild, `TICKET: #${ch.name} | ${user.tag} | ${m.label} | ${fmtUSD(amountUSD)} | ${coin}`);
  return ch;
}

// ─── VOUCH ───────────────────────────────────────────────────
async function postVouch(guild, { clientId, exchangerId, method, amountUSD, direction, coin, message, rating }) {
  if (!CONFIG.VOUCH_CHANNEL) return;
  const ch = guild.channels.cache.get(CONFIG.VOUCH_CHANNEL);
  if (!ch) return;
  const stars = "★".repeat(Math.min(Math.max(rating||5,1),5));
  const embed = new EmbedBuilder()
    .setColor(CONFIG.COLOR)
    .setAuthor({ name:"Konvert", iconURL:IMG.LOGO })
    .setTitle("Vouch Recorded")
    .addFields(
      { name:"Client",    value:`<@${clientId}>`,   inline:true },
      { name:"Exchanger", value:`<@${exchangerId}>`, inline:true },
      { name:"Rating",    value:stars,               inline:true },
    );
  if (method) embed.addFields({ name:"Method", value:method, inline:true });
  if (amountUSD) embed.addFields({ name:"Amount", value:fmtUSD(amountUSD), inline:true });
  if (direction && coin && method) embed.addFields({ name:"Direction", value:direction === "send" ? `${coin} → ${method}` : `${method} → ${coin}`, inline:true });
  if (message) embed.addFields({ name:"Review", value:message, inline:false });
  embed.setImage(IMG.VOUCH).setTimestamp().setFooter({ text:"Konvert  •  Verified Trade" });
  await ch.send({ embeds:[embed] });
}

// ─── MINE GAME ───────────────────────────────────────────────
function buildMineEmbed(userId, game) {
  // Build 5x5 button grid showing revealed/unrevealed cells
  const rows = [];
  for (let r = 0; r < 5; r++) {
    const row = new ActionRowBuilder();
    for (let c = 0; c < 5; c++) {
      const idx = r * 5 + c;
      const revealed = game.revealed.includes(idx);
      const isDiamond = game.diamonds.includes(idx);
      let label = "?", style = ButtonStyle.Secondary, disabled = false;
      if (revealed) {
        if (isDiamond) { label = "💎"; style = ButtonStyle.Success; }
        else { label = "X"; style = ButtonStyle.Danger; }
        disabled = true;
      }
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`mine_cell_${userId}_${idx}`)
          .setLabel(label)
          .setStyle(style)
          .setDisabled(disabled)
      );
    }
    rows.push(row);
  }
  return rows;
}

// ─── CLOSE TICKET ────────────────────────────────────────────
async function doCloseTicket(channel, guild, closedBy, reason) {
  const tickets = load("tickets");
  if (!tickets[channel.id]) return false;
  tickets[channel.id].status   = "closed";
  tickets[channel.id].closedAt = Date.now();
  save("tickets", tickets);
  try {
    const msgs   = await channel.messages.fetch({ limit:100 });
    const sorted = [...msgs.values()].reverse();
    const lines  = sorted.map(m => `[${new Date(m.createdTimestamp).toISOString()}] ${m.author.tag} (${m.author.id}): ${m.content||"[embed]"}`).join("\n");
    const fname  = `transcript-${channel.name}-${Date.now()}.txt`;
    const fpath  = `./${fname}`;
    fs.writeFileSync(fpath, lines);
    if (CONFIG.LOG_CHANNEL) {
      const logCh = guild.channels.cache.get(CONFIG.LOG_CHANNEL);
      if (logCh) { await logCh.send({ content:`Transcript: **#${channel.name}** closed by ${closedBy.tag}. Reason: ${reason}`, files:[{ attachment:fpath, name:fname }] }); }
    }
    fs.unlinkSync(fpath);
    // DM client
    try {
      const t = tickets[channel.id];
      const member = await guild.members.fetch(t.userId).catch(()=>null);
      if (member) {
        const fname2 = `transcript-${channel.name}-dm.txt`;
        const fpath2 = `./${fname2}`;
        fs.writeFileSync(fpath2, lines);
        await member.send({ content:"Your Konvert ticket has been closed. Transcript attached:", files:[{ attachment:fpath2, name:fname2 }] }).catch(()=>{});
        fs.unlinkSync(fpath2);
      }
    } catch {}
  } catch {}
  log(guild, `CLOSED: #${channel.name} by ${closedBy.tag} — ${reason}`);
  return true;
}

// ─── INTERACTION HANDLER ─────────────────────────────────────
client.on(Events.InteractionCreate, async interaction => {
  try {

    // ════ SLASH COMMANDS ════════════════════════════════════
    if (interaction.isChatInputCommand()) {
      const cmd = interaction.commandName;

      if (cmd === "postexchange") {
        await interaction.channel.send({ embeds:[mainEmbed()], components:mainButtons() });
        return interaction.reply({ content:"Exchange embed posted.", ephemeral:true });
      }

      if (cmd === "rates") {
        await interaction.deferReply();
        const embed = await buildRatesEmbed();
        return interaction.editReply({ embeds:[embed], components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("btn_refresh_rates").setLabel("Refresh").setStyle(ButtonStyle.Secondary))] });
      }

      if (cmd === "fee") {
        const amt  = interaction.options.getNumber("amount_usd");
        const fS   = calcFee(amt,"send"), rS = feeRate(amt,"send");
        const fR   = calcFee(amt,"receive"), rR = feeRate(amt,"receive");
        return interaction.reply({
          embeds:[base("Fee Calculator")
            .setDescription(`Estimate for **${fmtUSD(amt)}**\n*Final fee may vary slightly based on deal terms.*\n\u200b`)
            .addFields(
              { name:"Fiat → Crypto", value:`Rate: **${rS}%**\nFee: **${fmtUSD(fS)}**\nYou receive: **${fmtUSD(amt-fS)}**`, inline:true },
              { name:"Crypto → Fiat", value:`Rate: **${rR}%**\nFee: **${fmtUSD(fR)}**\nYou receive: **${fmtUSD(amt-fR)}**`, inline:true },
            ).setImage(IMG.FEE).setFooter({ text:"Konvert  •  Open a ticket to proceed" })],
          ephemeral:true,
        });
      }

      if (cmd === "convert") {
        await interaction.deferReply();
        const amount = interaction.options.getNumber("amount");
        const from   = interaction.options.getString("from").toUpperCase();
        const to     = interaction.options.getString("to").toUpperCase();
        const FIAT   = { USD:1, CAD:1.37, EUR:0.93, GBP:0.79 };
        let amtUSD;
        if (FIAT[from]) amtUSD = amount / FIAT[from];
        else { const p = await getPrice(from); if (!p) return interaction.editReply(`Unknown currency: ${from}`); amtUSD = amount * p; }
        let result;
        if (FIAT[to]) result = amtUSD * FIAT[to];
        else { const p = await getPrice(to); if (!p) return interaction.editReply(`Unknown currency: ${to}`); result = amtUSD / p; }
        const fee    = calcFee(amtUSD,"send");
        const p2     = FIAT[to] ? 1/FIAT[to] : (await getPrice(to)||1);
        const youGet = result - (fee/p2);
        return interaction.editReply({ embeds:[base("Conversion").addFields(
          { name:"You Send",    value:`**${amount} ${from}**`,      inline:true },
          { name:"Gross",       value:`${result.toFixed(6)} ${to}`, inline:true },
          { name:"Fee",         value:`~${fmtUSD(fee)}`,            inline:true },
          { name:"You Receive", value:`**${youGet.toFixed(6)} ${to}**`, inline:true },
        ).setFooter({ text:"Estimate  •  Konvert" })] });
      }

      if (cmd === "stats") {
        const target  = interaction.options.getUser("user") || interaction.user;
        const all     = Object.values(load("tickets")).filter(t => t.userId === target.id && t.status === "vouched");
        const volume  = all.reduce((s,t) => s+(t.amountUSD||0), 0);
        const avg     = all.length > 0 ? volume/all.length : 0;
        const methods = {}; all.forEach(t => { if(t.method) methods[t.method]=(methods[t.method]||0)+1; });
        const topM    = Object.entries(methods).sort((a,b)=>b[1]-a[1])[0];
        const coins   = {}; all.forEach(t => { if(t.coin) coins[t.coin]=(coins[t.coin]||0)+1; });
        const topC    = Object.entries(coins).sort((a,b)=>b[1]-a[1])[0];
        const isSelf  = target.id === interaction.user.id;
        return interaction.reply({ embeds:[base(isSelf ? "Your Exchange Stats" : `${target.username}'s Stats`)
          .setThumbnail(target.displayAvatarURL({ size:64 }))
          .addFields(
            { name:"Completed Trades", value:`**${all.length}**`,                           inline:true },
            { name:"Total Volume",     value:volume>0?`**${fmtUSD(volume)}**`:"—",          inline:true },
            { name:"Avg Deal Size",    value:avg>0?`**${fmtUSD(avg)}**`:"—",               inline:true },
            { name:"Top Method",       value:topM?`**${getMethod(topM[0])?.label||topM[0]}** (${topM[1]})`:"—", inline:true },
            { name:"Top Coin",         value:topC?`**${topC[0]}** (${topC[1]})`:"—",       inline:true },
          ).setFooter({ text:all.length===0?"No completed trades yet":`${all.length} verified trade${all.length!==1?"s":""} on Konvert` })] });
      }

      if (cmd === "leaderboard") {
        const all    = Object.values(load("tickets")).filter(t=>t.status==="vouched"&&t.amountUSD);
        const byUser = {};
        all.forEach(t => { if(!byUser[t.userId]) byUser[t.userId]={userId:t.userId,volume:0,trades:0}; byUser[t.userId].volume+=t.amountUSD; byUser[t.userId].trades+=1; });
        const ranked = Object.values(byUser).sort((a,b)=>b.volume-a.volume).slice(0,10);
        if (!ranked.length) return interaction.reply({ content:"No completed trades yet.", ephemeral:true });
        const medals = ["🥇","🥈","🥉"];
        const lines  = ranked.map((u,i)=>`${medals[i]||`**${i+1}.**`}  <@${u.userId}>  —  **${fmtUSD(u.volume)}**  ·  ${u.trades} trade${u.trades!==1?"s":""}`).join("\n");
        return interaction.reply({ embeds:[base("Top Traders").setThumbnail(IMG.LOGO).setDescription(lines+"\n\u200b").setFooter({ text:"Ranked by total volume  •  Konvert" })] });
      }

      if (cmd === "market") {
        await interaction.deferReply();
        const ids  = COINS.map(c=>GECKO[c]||c.toLowerCase()).join(",");
        const res  = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`);
        const data = await res.json();
        const rows = COINS.map(coin=>{ const d=data[GECKO[coin]||coin.toLowerCase()]; if(!d) return null; return {coin,price:d.usd,change:parseFloat(d.usd_24h_change||0)}; }).filter(Boolean);
        const gainers = [...rows].sort((a,b)=>b.change-a.change).slice(0,3);
        const losers  = [...rows].sort((a,b)=>a.change-b.change).slice(0,3);
        const avg     = (rows.reduce((s,r)=>s+r.change,0)/rows.length).toFixed(2);
        const fmt2    = n=>n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
        return interaction.editReply({ embeds:[base("Market Summary").setThumbnail(IMG.LOGO)
          .addFields(
            { name:"Sentiment",   value:`**${parseFloat(avg)>=0?"Bullish":"Bearish"}**  ·  Avg 24h: **${avg}%**`, inline:false },
            { name:"Top Gainers", value:gainers.map(r=>`\`${r.coin.padEnd(5)}\` **▲ ${r.change.toFixed(2)}%**  $${fmt2(r.price)}`).join("\n"), inline:true },
            { name:"Top Losers",  value:losers.map(r=>`\`${r.coin.padEnd(5)}\` **▼ ${Math.abs(r.change).toFixed(2)}%**  $${fmt2(r.price)}`).join("\n"), inline:true },
          ).setImage(IMG.RATES).setFooter({ text:"Live market data  •  Konvert" })] });
      }

      if (cmd === "wallets") {
        const w = load("wallets");
        const fields = Object.entries(w).length
          ? Object.entries(w).map(([coin,addr])=>({ name:coin, value:`\`${addr}\``, inline:true }))
          : [{ name:"No wallets set", value:"Owner: use /setwallet to add addresses.", inline:false }];
        return interaction.reply({ embeds:[base("Deposit Wallets").setThumbnail(IMG.LOGO).setDescription("Send funds only to addresses confirmed by staff in your ticket.\n\u200b").addFields(fields).setFooter({ text:"Always verify with staff before sending  •  Konvert" })], ephemeral:true });
      }

      if (cmd === "mm") {
        return interaction.reply({ embeds:[base("Middleman Guide")
          .setDescription("A **middleman (MM)** holds crypto between both parties during a trade — protecting everyone from scams.\n\u200b")
          .addFields(
            { name:"How to Pick",    value:"Agree with your exchanger on a trusted MM you both know. Konvert supports any reputable third-party MM.", inline:false },
            { name:"Owner Override", value:"The only time you skip an MM is if **@jswaps** or **@3uce** explicitly says so in your ticket. Anyone else saying this is an impersonator.", inline:false },
            { name:"Stay Safe",      value:"Staff never DM you first. All arrangements happen in your ticket only.", inline:false },
          ).setImage(IMG.RULES).setFooter({ text:"Konvert  •  Trade safely, always" })] });
      }

      if (cmd === "mine") {
        const userId     = interaction.user.id;
        const cooldownMs = 3 * 60 * 60 * 1000;
        const remaining  = cooldownMs - (Date.now() - (state.cooldowns[userId]||0));
        if (remaining > 0) {
          const hrs  = Math.floor(remaining/3600000);
          const mins = Math.ceil((remaining%3600000)/60000);
          return interaction.reply({ embeds:[base("Mine — On Cooldown").setDescription(`You can mine again in **${hrs>0?`${hrs}h ${mins}m`:`${mins}m`}**.`).setFooter({ text:"Konvert Mine  •  Once every 3 hours" })], ephemeral:true });
        }
        state.cooldowns[userId] = Date.now();
        // Generate 3 hidden diamonds in 25 cells
        const diamonds = new Set();
        while (diamonds.size < 3) diamonds.add(Math.floor(Math.random()*25));
        state.mineGames[userId] = { diamonds:[...diamonds], revealed:[], found:0 };

        const components = buildMineEmbed(userId, state.mineGames[userId]);
        return interaction.reply({
          embeds:[base("Konvert Mine")
            .setDescription("A **5x5** grid lies before you. Hidden within are **3 diamonds**.\n\nClick cells to reveal them. Find all **3 diamonds** to win a **Free Exchange Pass**.\n\u200b")
            .setFooter({ text:"Konvert Mine  •  Find all 3 diamonds  •  Cooldown: 3 hours" })],
          components,
          ephemeral:true,
        });
      }

      if (cmd === "vouch") {
        const clientUser    = interaction.options.getUser("client");
        const exchangerUser = interaction.options.getUser("exchanger");
        const message       = interaction.options.getString("message");
        const method        = interaction.options.getString("method");
        const amount        = interaction.options.getNumber("amount");
        const rating        = interaction.options.getInteger("rating") || 5;
        await postVouch(interaction.guild, { clientId:clientUser.id, exchangerId:exchangerUser.id, method, amountUSD:amount, direction:null, coin:null, message, rating });
        return interaction.reply({ content:`Vouch recorded for <@${clientUser.id}> exchanged by <@${exchangerUser.id}>.`, ephemeral:true });
      }

      if (cmd === "alert") {
        const coin  = interaction.options.getString("coin").toUpperCase();
        const price = interaction.options.getNumber("price");
        const dir   = interaction.options.getString("direction");
        if (!COINS.includes(coin)) return interaction.reply({ content:`Unsupported coin: ${coin}`, ephemeral:true });
        state.alerts.push({ userId:interaction.user.id, coin, target:price, direction:dir });
        return interaction.reply({ embeds:[base("Price Alert Set").setThumbnail(COIN_LOGO[coin]||IMG.LOGO).setDescription(`You will be notified when **${coin}** goes **${dir}** **$${price.toLocaleString("en-US")}**.`).setFooter({ text:"Konvert  •  Price Alerts" })], ephemeral:true });
      }

      if (cmd === "closeticket") {
        const reason  = interaction.options.getString("reason") || "Completed";
        const tickets = load("tickets");
        if (!tickets[interaction.channel.id]) return interaction.reply({ content:"This is not a ticket channel.", ephemeral:true });
        await interaction.deferReply();
        await doCloseTicket(interaction.channel, interaction.guild, interaction.user, reason);
        await interaction.editReply({ embeds:[new EmbedBuilder().setColor(0xFF4444).setTitle("Ticket Closed").setDescription(`Closed by staff.\n**Reason:** ${reason}\n\nDeleting in 10 seconds.`).setTimestamp()] });
        setTimeout(()=>interaction.channel.delete().catch(()=>{}), 10000);
        return;
      }

      if (cmd === "setwallet") {
        const coin = interaction.options.getString("coin").toUpperCase();
        const addr = interaction.options.getString("address");
        const w    = load("wallets"); w[coin] = addr; save("wallets", w);
        log(interaction.guild, `WALLET: ${interaction.user.tag} set ${coin} → ${addr}`);
        return interaction.reply({ content:`**${coin}** deposit address updated to \`${addr}\``, ephemeral:true });
      }

      if (cmd === "announce") {
        const message   = interaction.options.getString("message");
        const channelId = interaction.options.getString("channel");
        const ping      = interaction.options.getString("ping") || "none";
        const ch        = interaction.guild.channels.cache.get(channelId);
        if (!ch) return interaction.reply({ content:"Channel not found.", ephemeral:true });
        const pingStr = ping==="everyone"?"@everyone ":ping==="here"?"@here ":"";
        await ch.send({ content:pingStr||undefined, embeds:[base("Konvert Announcement").setDescription(message).setFooter({ text:`By ${interaction.user.tag}` })] });
        return interaction.reply({ content:"Announced.", ephemeral:true });
      }

      if (cmd === "blacklist") {
        const target = interaction.options.getUser("user");
        const reason = interaction.options.getString("reason") || "No reason given";
        const bl     = load("blacklist"); bl[target.id]={ tag:target.tag, reason, by:interaction.user.tag, at:Date.now() }; save("blacklist", bl);
        log(interaction.guild, `BLACKLIST: ${target.tag} — ${reason}`);
        return interaction.reply({ content:`**${target.tag}** blacklisted. Reason: ${reason}`, ephemeral:true });
      }

      if (cmd === "unblacklist") {
        const target = interaction.options.getUser("user");
        const bl     = load("blacklist"); delete bl[target.id]; save("blacklist", bl);
        return interaction.reply({ content:`**${target.tag}** removed from blacklist.`, ephemeral:true });
      }

      return;
    }

    // ════ SELECT MENUS ══════════════════════════════════════
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "select_method") {
        const method = interaction.values[0];
        return interaction.update({ embeds:[step2Embed(method)], components:[new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`dir_send__${method}`).setLabel(`Send Crypto → Get ${getMethod(method).label}`).setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`dir_receive__${method}`).setLabel(`Send ${getMethod(method).label} → Get Crypto`).setStyle(ButtonStyle.Success),
        )] });
      }
    }

    // ════ BUTTONS ═══════════════════════════════════════════
    if (interaction.isButton()) {

      // Exchange Now
      if (interaction.customId === "btn_exchange_now") {
        const bl = load("blacklist");
        if (bl[interaction.user.id]) return interaction.reply({ content:"You are blacklisted from Konvert.", ephemeral:true });
        return interaction.reply({ embeds:[step1Embed()], components:[new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId("select_method").setPlaceholder("Select your payment method…")
            .addOptions(METHODS.map(m=>new StringSelectMenuOptionBuilder().setLabel(m.label).setValue(m.value).setDescription(`Exchange crypto with ${m.label}`)))
        )], ephemeral:true });
      }

      // Fee calc button
      if (interaction.customId === "btn_fee_calc") {
        const modal = new ModalBuilder().setCustomId("modal_fee").setTitle("Fee Calculator");
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("fee_amt").setLabel("Trade amount in USD").setStyle(TextInputStyle.Short).setPlaceholder("e.g. 250").setRequired(true)));
        return interaction.showModal(modal);
      }

      // Live Rates quick
      if (interaction.customId === "btn_rates_quick") {
        await interaction.deferReply({ ephemeral:true });
        return interaction.editReply({ embeds:[await buildRatesEmbed()] });
      }

      // Refresh rates
      if (interaction.customId === "btn_refresh_rates") {
        await interaction.deferUpdate();
        const embed = await buildRatesEmbed();
        return interaction.editReply({ embeds:[embed], components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("btn_refresh_rates").setLabel("Refresh").setStyle(ButtonStyle.Secondary))] });
      }

      // Direction buttons
      if (interaction.customId.startsWith("dir_send__") || interaction.customId.startsWith("dir_receive__")) {
        const isSend  = interaction.customId.startsWith("dir_send__");
        const method  = interaction.customId.replace("dir_send__","").replace("dir_receive__","");
        const m       = getMethod(method);
        const modal   = new ModalBuilder().setCustomId(`modal_amount__${method}__${isSend?"send":"receive"}`).setTitle(`${m.label} — ${isSend?"Send Crypto":"Receive Crypto"}`);
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("inp_amount").setLabel("Trade amount in USD").setStyle(TextInputStyle.Short).setPlaceholder("e.g. 150").setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("inp_coin").setLabel("Which crypto? (BTC, ETH, SOL…)").setStyle(TextInputStyle.Short).setPlaceholder("e.g. SOL").setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("inp_wallet").setLabel(isSend?`Your ${m.label} receiving info`:"Your crypto receiving wallet").setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("inp_notes").setLabel("Notes (optional)").setStyle(TextInputStyle.Paragraph).setRequired(false)),
        );
        return interaction.showModal(modal);
      }

      // Confirm ticket
      if (interaction.customId === "btn_confirm_ticket") {
        await interaction.deferUpdate();
        const pending = state.pending[interaction.user.id];
        if (!pending) return interaction.editReply({ content:"Session expired. Please start again.", embeds:[], components:[] });
        delete state.pending[interaction.user.id];
        const ch = await createTicket(interaction, pending.method, pending.direction, pending.rawAmt, pending.coin, pending.walletInf, pending.notes);
        if (ch) return interaction.editReply({ content:`Ticket opened → <#${ch.id}>`, embeds:[], components:[] });
        return;
      }

      // Cancel ticket
      if (interaction.customId === "btn_cancel_ticket") {
        delete state.pending[interaction.user.id];
        return interaction.update({ content:"Cancelled. Click Exchange Now to start again.", embeds:[], components:[] });
      }

      // Mark Trade Complete
      if (interaction.customId === "btn_done") {
        const tickets = load("tickets");
        const ticket  = tickets[interaction.channel.id];
        if (!ticket) return interaction.reply({ content:"No ticket data found.", ephemeral:true });
        const isOwner   = CONFIG.OWNER_IDS.includes(interaction.user.id);
        const isStaff   = CONFIG.STAFF_ROLE ? interaction.member.roles.cache.has(CONFIG.STAFF_ROLE) : false;
        const mRoleId   = ticket.method ? CONFIG.ROLES[ticket.method] : null;
        const isHandler = mRoleId ? interaction.member.roles.cache.has(mRoleId) : false;
        if (!isOwner && !isStaff && !isHandler) return interaction.reply({ content:"Only staff or the assigned handler can mark a trade complete.", ephemeral:true });
        if (ticket.status === "vouched" || ticket.status === "closed") return interaction.reply({ content:"This ticket has already been completed.", ephemeral:true });
        await interaction.deferReply();
        const m = getMethod(ticket.method);
        await postVouch(interaction.guild, { clientId:ticket.userId, exchangerId:interaction.user.id, method:m?.label||ticket.method, amountUSD:ticket.amountUSD, direction:ticket.direction, coin:ticket.coin, message:null, rating:5 });
        tickets[interaction.channel.id].status      = "vouched";
        tickets[interaction.channel.id].completedBy = interaction.user.id;
        tickets[interaction.channel.id].completedAt = Date.now();
        save("tickets", tickets);
        await interaction.editReply({ embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({ name:"Konvert", iconURL:IMG.LOGO }).setTitle("Trade Complete")
          .addFields(
            { name:"Client",    value:`<@${ticket.userId}>`,    inline:true },
            { name:"Exchanger", value:`<@${interaction.user.id}>`, inline:true },
            { name:"Method",    value:m?.label||"—",             inline:true },
            { name:"Amount",    value:fmtUSD(ticket.amountUSD),  inline:true },
            { name:"Coin",      value:ticket.coin||"—",          inline:true },
            { name:"Rating",    value:"★★★★★",                inline:true },
          ).setDescription("Vouch posted. This ticket closes in **15 seconds**.").setTimestamp().setFooter({ text:"Konvert" })] });
        setTimeout(async () => { await doCloseTicket(interaction.channel, interaction.guild, interaction.user, "Trade completed"); interaction.channel.delete().catch(()=>{}); }, 15000);
        return;
      }

      // Close Ticket
      if (interaction.customId === "btn_close") {
        const tickets = load("tickets");
        if (!tickets[interaction.channel.id]) return interaction.reply({ content:"Not a ticket channel.", ephemeral:true });
        if (!CONFIG.OWNER_IDS.includes(interaction.user.id)) return interaction.reply({ content:"Only owners can close tickets.", ephemeral:true });
        await interaction.deferReply();
        await doCloseTicket(interaction.channel, interaction.guild, interaction.user, "Closed by owner");
        await interaction.editReply({ embeds:[new EmbedBuilder().setColor(0xFF4444).setTitle("Ticket Closed").setDescription("This ticket has been closed.\nDeleting in 15 seconds.").setTimestamp()] });
        setTimeout(()=>interaction.channel.delete().catch(()=>{}), 15000);
        return;
      }

      // Mine cell click
      if (interaction.customId.startsWith("mine_cell_")) {
        const parts  = interaction.customId.split("_"); // mine_cell_USERID_IDX
        const userId = parts[2];
        const idx    = parseInt(parts[3]);
        if (interaction.user.id !== userId) return interaction.reply({ content:"This is not your mine game.", ephemeral:true });
        const game = state.mineGames[userId];
        if (!game) return interaction.reply({ content:"No active game. Use /mine to start.", ephemeral:true });
        if (game.revealed.includes(idx)) return interaction.reply({ content:"You already revealed that cell.", ephemeral:true });

        game.revealed.push(idx);
        const isDiamond = game.diamonds.includes(idx);
        if (isDiamond) game.found++;

        const allFound = game.found === 3;
        const components = buildMineEmbed(userId, game);

        if (allFound) {
          delete state.mineGames[userId];
          state.passes[userId] = (state.passes[userId]||0) + 1;
          // DM owners
          for (const oid of CONFIG.OWNER_IDS) {
            try {
              const owner = await client.users.fetch(oid);
              await owner.send({ embeds:[new EmbedBuilder().setColor(0xFFD700).setAuthor({ name:"Konvert Mine — Winner", iconURL:IMG.LOGO }).setTitle("Exchange Pass Won").setDescription(`<@${userId}> (${interaction.user.tag}) found all 3 diamonds and won a free exchange pass.\nTotal passes: **${state.passes[userId]}**`).setTimestamp()] });
            } catch {}
          }
          return interaction.update({
            embeds:[new EmbedBuilder().setColor(0xFFD700).setAuthor({ name:"Konvert", iconURL:IMG.LOGO }).setTitle("All 3 Diamonds Found")
              .setDescription("You found every diamond. A **Free Exchange Pass** has been awarded.\n\nOpen a ticket and let staff know — they have been notified.")
              .addFields({ name:"Pass Holder", value:`<@${userId}>`, inline:true }, { name:"Passes", value:`**${state.passes[userId]}**`, inline:true })
              .setFooter({ text:"Konvert Mine  •  Screenshot this as proof" }).setTimestamp()],
            components:[],
          });
        }

        // Update the grid embed
        const embed = base("Konvert Mine")
          .setDescription(`**${game.found}/3 diamonds found.**\n${isDiamond?"You found a diamond! Keep going.":"Nothing there. Keep looking."}\n\u200b`)
          .setFooter({ text:`Konvert Mine  •  ${3-game.found} diamond${3-game.found!==1?"s":""} remaining` });

        return interaction.update({ embeds:[embed], components });
      }
    }

    // ════ MODALS ════════════════════════════════════════════
    if (interaction.isModalSubmit()) {

      // Fee calc modal
      if (interaction.customId === "modal_fee") {
        const raw = parseFloat(interaction.fields.getTextInputValue("fee_amt"));
        if (isNaN(raw) || raw <= 0) return interaction.reply({ content:"Please enter a valid amount.", ephemeral:true });
        const fS = calcFee(raw,"send"), rS = feeRate(raw,"send");
        const fR = calcFee(raw,"receive"), rR = feeRate(raw,"receive");
        return interaction.reply({ embeds:[base("Fee Calculator")
          .setDescription(`Estimate for **${fmtUSD(raw)}**\n*Final fee may vary slightly.*\n\u200b`)
          .addFields(
            { name:"Fiat → Crypto", value:`Rate: **${rS}%**\nFee: **${fmtUSD(fS)}**\nYou receive: **${fmtUSD(raw-fS)}**`, inline:true },
            { name:"Crypto → Fiat", value:`Rate: **${rR}%**\nFee: **${fmtUSD(fR)}**\nYou receive: **${fmtUSD(raw-fR)}**`, inline:true },
          ).setImage(IMG.FEE).setFooter({ text:"Konvert  •  Head to exchange channel to open a ticket" })], ephemeral:true });
      }

      // Amount modal → show confirmation
      if (interaction.customId.startsWith("modal_amount__")) {
        await interaction.deferReply({ ephemeral:true });
        const parts     = interaction.customId.split("__");
        const method    = parts[1];
        const direction = parts[2];
        const m         = getMethod(method);
        const rawAmt    = parseFloat(interaction.fields.getTextInputValue("inp_amount"));
        const coin      = interaction.fields.getTextInputValue("inp_coin").toUpperCase().trim();
        const walletInf = interaction.fields.getTextInputValue("inp_wallet").trim();
        const notes     = interaction.fields.getTextInputValue("inp_notes")?.trim() || "";

        if (isNaN(rawAmt) || rawAmt <= 0) return interaction.editReply("Please enter a valid amount greater than $0.");
        if (!COINS.includes(coin)) return interaction.editReply(`**${coin}** is not supported. Supported: ${COINS.join(", ")}`);
        if (!walletInf) return interaction.editReply("Please enter your wallet or account info.");

        const fee    = calcFee(rawAmt, direction);
        const rate   = feeRate(rawAmt, direction);
        const recv   = rawAmt - fee;
        const coinL  = COIN_LOGO[coin] || null;

        const sendLabel = direction === "send" ? `**${coin}** worth **${fmtUSD(rawAmt)}**` : `**${fmtUSD(rawAmt)}** via ${m.label}`;
        const recvLabel = direction === "send" ? `**${fmtUSD(recv)}** via ${m.label}` : recv < 5 ? "To be discussed" : `**~${fmtUSD(recv)}** worth of ${coin}`;

        state.pending[interaction.user.id] = { method, direction, rawAmt, coin, walletInf, notes };

        const confirmEmbed = new EmbedBuilder()
          .setColor(CONFIG.COLOR)
          .setAuthor({ name:"Konvert", iconURL:IMG.LOGO })
          .setTitle("Confirm Your Exchange")
          .setThumbnail(coinL)
          .setDescription("Review your details below before confirming.\n\u200b")
          .addFields(
            { name:"Method",    value:m.label,                             inline:true },
            { name:"Crypto",    value:coin,                                inline:true },
            { name:"Direction", value:direction==="send"?"Fiat → Crypto":"Crypto → Fiat", inline:true },
            { name:"Sending",   value:sendLabel,                           inline:true },
            { name:"Receiving", value:recvLabel,                           inline:true },
            { name:"Est. Fee",  value:`${rate}% — ${fmtUSD(fee)}`,        inline:true },
            { name:"Your Info", value:`||${walletInf}||`,                 inline:false },
          )
          .setFooter({ text:"Fee is an estimate and may vary slightly  •  Konvert" });

        return interaction.editReply({ embeds:[confirmEmbed], components:[new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("btn_confirm_ticket").setLabel("Confirm & Open Ticket").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("btn_cancel_ticket").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
        )] });
      }
    }

  } catch (err) {
    console.error("Interaction error:", err);
    try {
      const errMsg = { content:"Something went wrong. Please try again.", ephemeral:true };
      if (interaction.deferred || interaction.replied) await interaction.followUp(errMsg).catch(()=>{});
      else await interaction.reply(errMsg).catch(()=>{});
    } catch {}
  }
});

// ─── $COIN MESSAGE LOOKUP ────────────────────────────────────
client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;
  const match = message.content.trim().match(/^\$([A-Za-z]{2,10})$/);
  if (!match) return;
  const coin = match[1].toUpperCase();
  if (!COINS.includes(coin)) return;
  try {
    const id  = GECKO[coin] || coin.toLowerCase();
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd,cad,eur,gbp&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`);
    const dat = await res.json();
    const d   = dat[id];
    if (!d) return;
    const fmt = n => n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
    const change = parseFloat(d.usd_24h_change||0).toFixed(2);
    const embed  = new EmbedBuilder()
      .setColor(Number(change) >= 0 ? 0x00C896 : 0xFF4444)
      .setAuthor({ name:`${coin} — Live Price`, iconURL:COIN_LOGO[coin]||IMG.LOGO })
      .setThumbnail(COIN_LOGO[coin]||IMG.LOGO)
      .addFields(
        { name:"USD",        value:`**$${fmt(d.usd)}**`,   inline:true },
        { name:"CAD",        value:`CA$${fmt(d.cad)}`,     inline:true },
        { name:"EUR",        value:`€${fmt(d.eur)}`,       inline:true },
        { name:"24h Change", value:`${Number(change)>=0?"▲":"▼"} **${change}%**`, inline:true },
        { name:"Market Cap", value:d.usd_market_cap?`$${(d.usd_market_cap/1e9).toFixed(2)}B`:"—", inline:true },
        { name:"24h Volume", value:d.usd_24h_vol?`$${(d.usd_24h_vol/1e9).toFixed(2)}B`:"—", inline:true },
      )
      .setFooter({ text:`Type $${coin} anytime for a live update  •  Konvert` }).setTimestamp();
    await message.reply({ embeds:[embed] });
  } catch {}
});

// ─── AUTO RATES ──────────────────────────────────────────────
let ratesMsgId = null;
async function autoRates(guild) {
  if (!CONFIG.RATES_CHANNEL || !guild) return;
  const ch = guild.channels.cache.get(CONFIG.RATES_CHANNEL);
  if (!ch) return;
  try {
    const embed = await buildRatesEmbed();
    if (ratesMsgId) {
      const msg = await ch.messages.fetch(ratesMsgId).catch(()=>null);
      if (msg) { await msg.edit({ embeds:[embed] }); return; }
    }
    const sent = await ch.send({ embeds:[embed] });
    ratesMsgId = sent.id;
  } catch (e) { console.error("Auto rates:", e.message); }
}

// ─── PRICE ALERT CHECKER ─────────────────────────────────────
async function checkAlerts() {
  if (!state.alerts.length) return;
  const ids = [...new Set(state.alerts.map(a => GECKO[a.coin]||a.coin.toLowerCase()))].join(",");
  try {
    const res    = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`);
    const prices = await res.json();
    const fired  = [];
    for (const alert of state.alerts) {
      const price = prices[GECKO[alert.coin]||alert.coin.toLowerCase()]?.usd;
      if (!price) continue;
      const triggered = alert.direction === "above" ? price >= alert.target : price <= alert.target;
      if (!triggered) continue;
      try {
        const user = await client.users.fetch(alert.userId);
        await user.send({ embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({ name:"Konvert", iconURL:IMG.LOGO }).setTitle("Price Alert Triggered").setDescription(`**${alert.coin}** is now **${alert.direction === "above" ? "above" : "below"}** your target of $${alert.target.toLocaleString("en-US")}\n\nCurrent price: **$${price.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}**\n\nHead to <#${CONFIG.EXCHANGE_CHANNEL}> to open a trade.`).setThumbnail(COIN_LOGO[alert.coin]||IMG.LOGO).setTimestamp().setFooter({ text:"Konvert  •  Price Alerts" })] });
      } catch {}
      fired.push(alert);
    }
    state.alerts = state.alerts.filter(a => !fired.includes(a));
  } catch {}
}

// ─── READY ───────────────────────────────────────────────────
client.once(Events.ClientReady, async () => {
  console.log(`Konvert Bot online — ${client.user.tag}`);
  client.user.setPresence({ activities:[{ name:"Konvert", type:3 }], status:"online" });
  const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
  if (guild) {
    await autoRates(guild);
    setInterval(() => autoRates(guild), 10 * 60 * 1000);
    setInterval(() => checkAlerts(), 5 * 60 * 1000);
  }
});

// ─── BOOT ────────────────────────────────────────────────────
registerCommands().then(() => client.login(CONFIG.TOKEN)).catch(console.error);
