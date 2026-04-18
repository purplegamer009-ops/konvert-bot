// ============================================================
//  KONVERT BOT™ v3
//  Persistent Exchange Embed → Button → Dropdown Flow
//  Discord.js v14 | Railway Ready
// ============================================================

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

// ─── CONFIG ──────────────────────────────────────────────────
const CONFIG = {
  TOKEN:      process.env.DISCORD_TOKEN,
  CLIENT_ID:  process.env.CLIENT_ID,
  GUILD_ID:   process.env.GUILD_ID,
  LOGO_URL:   process.env.LOGO_URL   || "",
  BANNER_URL: process.env.BANNER_URL || "",

  OWNER_IDS:  (process.env.OWNER_IDS || "").split(",").map(s => s.trim()),
  STAFF_ROLE: process.env.STAFF_ROLE_ID,

  ROLES: {
    paypal:   process.env.ROLE_PAYPAL,
    cashapp:  process.env.ROLE_CASHAPP,
    zelle:    process.env.ROLE_ZELLE,
    interac:  process.env.ROLE_INTERAC,
    venmo:    process.env.ROLE_VENMO,
    applepay: process.env.ROLE_APPLEPAY,
    skrill:   process.env.ROLE_SKRILL,
    revolut:  process.env.ROLE_REVOLUT,
    upi:      process.env.ROLE_UPI,
    chime:    process.env.ROLE_CHIME,
  },

  TICKET_CATEGORY: process.env.TICKET_CATEGORY_ID,
  VOUCH_CHANNEL:   process.env.VOUCH_CHANNEL_ID,
  LOG_CHANNEL:     process.env.LOG_CHANNEL_ID,
  RATES_CHANNEL:   process.env.RATES_CHANNEL_ID,

  MIN_FEE_USD:   5,   // minimum fee on any deal

  COINS: ["BTC","ETH","SOL","LTC","USDT","USDC","XRP","BNB","ADA","DOGE","MATIC","AVAX","DOT","LINK","TRX","SHIB","UNI","ATOM","FTM","NEAR"],
  EXCHANGE_CHANNEL: "1463731676021784587",
  COLOR: 0x7C4DFF,
};

// ─── PAYMENT METHODS ─────────────────────────────────────────
const PAYMENT_METHODS = [
  { value: "paypal",   label: "PayPal",    emoji: "💸", roleKey: "paypal"   },
  { value: "cashapp",  label: "Cash App",  emoji: "💵", roleKey: "cashapp"  },
  { value: "zelle",    label: "Zelle",     emoji: "⚡", roleKey: "zelle"    },
  { value: "interac",  label: "Interac",   emoji: "🍁", roleKey: "interac"  },
  { value: "venmo",    label: "Venmo",     emoji: "🔵", roleKey: "venmo"    },
  { value: "applepay", label: "Apple Pay", emoji: "🍎", roleKey: "applepay" },
  { value: "skrill",   label: "Skrill",    emoji: "🟣", roleKey: "skrill"   },
  { value: "revolut",  label: "Revolut",   emoji: "🔷", roleKey: "revolut"  },
  { value: "upi",      label: "UPI",       emoji: "🪙", roleKey: "upi"      },
  { value: "chime",    label: "Chime",     emoji: "🟩", roleKey: "chime"    },
];

// ─── STORAGE ─────────────────────────────────────────────────
const FILES = {
  tickets:   "./tickets.json",
  wallets:   "./wallets.json",
  blacklist: "./blacklist.json",
  stats:     "./stats.json",
};
function load(key)       { try { return JSON.parse(fs.readFileSync(FILES[key], "utf8")); } catch { return {}; } }
function save(key, data) { fs.writeFileSync(FILES[key], JSON.stringify(data, null, 2)); }

// ─── HELPERS ─────────────────────────────────────────────────
const fmtUSD   = n => n >= 1
  ? `$${n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`
  : `$${n.toFixed(6)}`;
// direction: "send" = fiat→crypto, "receive" = crypto→fiat (1% less each tier)
function calcFee(amountUSD, direction) {
  let rate;
  if (amountUSD < 150)       rate = 9;
  else if (amountUSD < 350)  rate = 7;
  else if (amountUSD < 500)  rate = 7;
  else if (amountUSD < 1000) rate = 6;
  else                        rate = 5.5;

  // crypto→fiat is 1% cheaper per tier
  if (direction === "receive") rate = Math.max(rate - 1, 0);

  return Math.max(amountUSD * (rate / 100), CONFIG.MIN_FEE_USD);
}
function feeRate(amountUSD, direction) {
  let rate;
  if (amountUSD < 150)       rate = 9;
  else if (amountUSD < 350)  rate = 7;
  else if (amountUSD < 500)  rate = 7;
  else if (amountUSD < 1000) rate = 6;
  else                        rate = 5.5;
  if (direction === "receive") rate = Math.max(rate - 1, 0);
  return rate;
}
const getMethod = v  => PAYMENT_METHODS.find(m => m.value === v);

const COIN_EMOJI = { BTC:"₿",ETH:"Ξ",SOL:"◎",LTC:"Ł",USDT:"₮",USDC:"💵",XRP:"✕",BNB:"🔶",ADA:"₳",DOGE:"Ð",MATIC:"⬡",AVAX:"🔺",DOT:"●",LINK:"⬡",TRX:"◈",SHIB:"🐕",UNI:"🦄",ATOM:"⚛",FTM:"👻",NEAR:"Ⓝ" };
const GECKO_ID   = {
  BTC:"bitcoin", ETH:"ethereum", SOL:"solana", LTC:"litecoin", USDT:"tether",
  USDC:"usd-coin", XRP:"ripple", BNB:"binancecoin", ADA:"cardano", DOGE:"dogecoin",
  MATIC:"matic-network", AVAX:"avalanche-2", DOT:"polkadot", LINK:"chainlink",
  TRX:"tron", SHIB:"shiba-inu", UNI:"uniswap", ATOM:"cosmos", FTM:"fantom", NEAR:"near",
};

// Coin logo URLs (CoinGecko CDN)
const COIN_LOGO = {
  BTC:   "https://assets.coingecko.com/coins/images/1/large/bitcoin.png",
  ETH:   "https://assets.coingecko.com/coins/images/279/large/ethereum.png",
  SOL:   "https://assets.coingecko.com/coins/images/4128/large/solana.png",
  LTC:   "https://assets.coingecko.com/coins/images/2/large/litecoin.png",
  USDT:  "https://assets.coingecko.com/coins/images/325/large/Tether.png",
  USDC:  "https://assets.coingecko.com/coins/images/6319/large/usdc.png",
  XRP:   "https://assets.coingecko.com/coins/images/44/large/xrp-symbol-white-128.png",
  BNB:   "https://assets.coingecko.com/coins/images/825/large/binance-coin-logo.png",
  ADA:   "https://assets.coingecko.com/coins/images/975/large/cardano.png",
  DOGE:  "https://assets.coingecko.com/coins/images/5/large/dogecoin.png",
  MATIC: "https://assets.coingecko.com/coins/images/4713/large/matic-token-icon.png",
  AVAX:  "https://assets.coingecko.com/coins/images/12559/large/Avalanche_Circle_RedWhite_Trans.png",
  DOT:   "https://assets.coingecko.com/coins/images/12171/large/polkadot.png",
  LINK:  "https://assets.coingecko.com/coins/images/877/large/chainlink-new-logo.png",
  TRX:   "https://assets.coingecko.com/coins/images/1094/large/tron-logo.png",
  SHIB:  "https://assets.coingecko.com/coins/images/11939/large/shiba.png",
  UNI:   "https://assets.coingecko.com/coins/images/12504/large/uniswap-uni.png",
  ATOM:  "https://assets.coingecko.com/coins/images/1481/large/cosmos_hub.png",
  FTM:   "https://assets.coingecko.com/coins/images/4001/large/Fantom_round.png",
  NEAR:  "https://assets.coingecko.com/coins/images/10365/large/near.jpg",
};

async function getUSDPrice(coin) {
  try {
    const id  = GECKO_ID[coin] || coin.toLowerCase();
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`);
    const dat = await res.json();
    return dat[id]?.usd || null;
  } catch { return null; }
}

function baseEmbed(title) {
  return new EmbedBuilder()
    .setColor(CONFIG.COLOR).setTitle(title).setTimestamp()
    .setThumbnail(CONFIG.LOGO_URL || null);
}

function logAction(guild, msg) {
  if (!CONFIG.LOG_CHANNEL) return;
  const ch = guild.channels.cache.get(CONFIG.LOG_CHANNEL);
  if (ch) ch.send({ embeds: [new EmbedBuilder().setColor(CONFIG.COLOR).setDescription(`\`\`\`${msg}\`\`\``).setTimestamp()] }).catch(()=>{});
}

// ════════════════════════════════════════════════════════════════
//  THE MAIN EXCHANGE EMBED
//  This is what /postexchange drops in the channel permanently
// ════════════════════════════════════════════════════════════════
function buildMainExchangeEmbed() {
  return new EmbedBuilder()
    .setColor(CONFIG.COLOR)
    .setAuthor({ name: "Konvert", iconURL: CONFIG.LOGO_URL || null })
    .setDescription(
      `## Fast. Safe. Simple.
` +
      `Exchange crypto with any payment method in minutes.
` +
      `Open a private ticket — we handle the rest.
​`
    )
    .addFields(
      {
        name: "Payment Methods",
        value: PAYMENT_METHODS.map(m => `${m.emoji} **${m.label}**`).join("   "),
        inline: false,
      },
      {
        name: "​",
        value: "​",
        inline: false,
      },
      { name: "Fee",    value: "5% – 9%\nby trade size",  inline: true },
      { name: "Speed",  value: "Usually < 10 min\nOften faster", inline: true },
      { name: "Privacy", value: "Private tickets\nVerified staff", inline: true },
    )
    .setImage("https://i.imgur.com/VHBuITj.gif")
    .setFooter({ text: "Konvert  •  Min fee $5" });
}

function buildMainExchangeButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("btn_exchange_now")
        .setLabel("Exchange Now")
        .setEmoji("💱")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("btn_fee_preview")
        .setLabel("Calculate Fee")
        .setEmoji("💸")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("btn_rates_preview")
        .setLabel("Live Rates")
        .setEmoji("📈")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// ════════════════════════════════════════════════════════════════
//  SLASH COMMANDS
// ════════════════════════════════════════════════════════════════
const COMMANDS = [

  // ── Owner: post the main embed ──
  new SlashCommandBuilder()
    .setName("postexchange")
    .setDescription("📌 [Owner] Post the Konvert Exchange embed in this channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  // ── Utility ──
  new SlashCommandBuilder()
    .setName("rates")
    .setDescription("📈 View live crypto rates"),

  new SlashCommandBuilder()
    .setName("convert")
    .setDescription("🔄 Convert crypto/fiat with fee breakdown")
    .addNumberOption(o => o.setName("amount").setDescription("Amount").setRequired(true))
    .addStringOption(o => o.setName("from").setDescription("From (BTC, USD…)").setRequired(true))
    .addStringOption(o => o.setName("to").setDescription("To (ETH, CAD…)").setRequired(true)),

  new SlashCommandBuilder()
    .setName("fee")
    .setDescription("💸 Calculate your Konvert fee")
    .addNumberOption(o => o.setName("amount_usd").setDescription("Amount in USD").setRequired(true)),

  new SlashCommandBuilder()
    .setName("vouch")
    .setDescription("⭐ Leave a vouch for a completed trade")
    .addUserOption(o => o.setName("user").setDescription("Who you traded with").setRequired(true))
    .addStringOption(o => o.setName("message").setDescription("Your review").setRequired(true))
    .addIntegerOption(o => o.setName("rating").setDescription("Rating 1–5").setMinValue(1).setMaxValue(5).setRequired(false)),

  // ── Owner tools ──
  new SlashCommandBuilder()
    .setName("closeticket")
    .setDescription("🔒 [Owner] Close & delete this ticket")
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("setwallet")
    .setDescription("💼 [Owner] Update a deposit wallet address")
    .addStringOption(o => o.setName("coin").setDescription("Coin symbol").setRequired(true))
    .addStringOption(o => o.setName("address").setDescription("New address").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("📢 [Owner] Post an announcement")
    .addStringOption(o => o.setName("message").setDescription("Message").setRequired(true))
    .addStringOption(o => o.setName("channel").setDescription("Channel ID to post in").setRequired(true))
    .addStringOption(o => o.setName("ping").setDescription("everyone / here / none").setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("🚫 [Owner] Blacklist a user from opening tickets")
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("unblacklist")
    .setDescription("✅ [Owner] Remove a user from the blacklist")
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("View your exchange stats or someone else's")
    .addUserOption(o => o.setName("user").setDescription("User to check (leave blank for yourself)").setRequired(false)),

  new SlashCommandBuilder()
    .setName("alert")
    .setDescription("🔔 Get alerted when a coin hits a target price")
    .addStringOption(o => o.setName("coin").setDescription("Coin (BTC, ETH…)").setRequired(true))
    .addNumberOption(o => o.setName("price").setDescription("Target price in USD").setRequired(true))
    .addStringOption(o => o.setName("direction").setDescription("above or below").setRequired(true)
      .addChoices({ name: "Above", value: "above" }, { name: "Below", value: "below" })),

].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(CONFIG.TOKEN);
  console.log("Registering slash commands…");
  await rest.put(Routes.applicationGuildCommands(CONFIG.CLIENT_ID, CONFIG.GUILD_ID), { body: COMMANDS });
  console.log("✅ Commands registered.");
}

// ─── CLIENT ──────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel],
});

// ════════════════════════════════════════════════════════════════
//  STEP EMBEDS (sent as ephemeral follow-ups after button clicks)
// ════════════════════════════════════════════════════════════════

// Step 1 — shown after "Exchange Now" is clicked
function step1Embed() {
  return new EmbedBuilder()
    .setColor(CONFIG.COLOR)
    .setAuthor({ name: "Konvert", iconURL: CONFIG.LOGO_URL || null })
    .setTitle("Step 1  —  Payment Method")
    .setDescription(
      "Select the payment method you want to use for this exchange.\n\n" +
      "**Sending crypto?** Pick how you want to be paid.\n" +
      "**Receiving crypto?** Pick how you\'ll be sending payment.\n\u200b"
    )
    .setFooter({ text: "Step 1 of 3  •  Konvert" });
}

function step1Components() {
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("select_method")
        .setPlaceholder("Choose your payment method…")
        .addOptions(
          PAYMENT_METHODS.map(m =>
            new StringSelectMenuOptionBuilder()
              .setLabel(m.label)
              .setValue(m.value)
              .setDescription(`Exchange crypto with ${m.label}`)
              .setEmoji(m.emoji)
          )
        )
    ),
  ];
}

// Step 2 — direction selection, shown after method is chosen
function step2Embed(method) {
  const m = getMethod(method);
  return new EmbedBuilder()
    .setColor(CONFIG.COLOR)
    .setAuthor({ name: "Konvert", iconURL: CONFIG.LOGO_URL || null })
    .setTitle(`Step 2  —  ${m.label}`)
    .setDescription(
      `Choose your direction.\n\n` +
      `**Send Crypto → Receive ${m.label}**\n` +
      `You send crypto. We pay you via ${m.label}.\n\n` +
      `**Send ${m.label} → Receive Crypto**\n` +
      `You pay via ${m.label}. We send crypto to your wallet.`
    )
    .setFooter({ text: "Step 2 of 3  •  Konvert" });
}
function step2Components(method) {
  const m = getMethod(method);
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`dir_send__${method}`)
        .setLabel(`📤 Send Crypto → Get ${m.label}`)
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`dir_receive__${method}`)
        .setLabel(`📥 Send ${m.label} → Get Crypto`)
        .setStyle(ButtonStyle.Success),
    ),
  ];
}

// ════════════════════════════════════════════════════════════════
//  TICKET CREATION
// ════════════════════════════════════════════════════════════════
async function createTicket(interaction, method, direction, amountUSD, coin, walletInfo, notes) {
  const guild   = interaction.guild;
  const user    = interaction.user;
  const m       = getMethod(method);
  const tickets = load("tickets");

  // Block if existing open ticket
  const existing = Object.entries(tickets).find(([,t]) => t.userId === user.id && t.status === "open");
  if (existing) {
    await interaction.editReply({ content: `❌ You already have an open ticket: <#${existing[0]}>`, components: [] });
    return null;
  }

  const feeUSD   = calcFee(amountUSD, direction);
  const rate     = feeRate(amountUSD, direction);
  const receiveU = amountUSD - feeUSD;

  // Estimate coin amount from live price
  let coinAmt = null;
  const coinPrice = await getUSDPrice(coin);
  if (coinPrice) coinAmt = (receiveU / coinPrice).toFixed(6);

  // ── Permission overwrites ──
  const perms = [
    { id: guild.roles.everyone, deny:  [PermissionFlagsBits.ViewChannel] },
    {
      id: user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    },
  ];

  if (CONFIG.STAFF_ROLE) {
    perms.push({
      id: CONFIG.STAFF_ROLE,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels],
    });
  }

  const methodRoleId = CONFIG.ROLES[m.roleKey];
  if (methodRoleId && methodRoleId !== CONFIG.STAFF_ROLE) {
    perms.push({
      id: methodRoleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    });
  }

  for (const oid of CONFIG.OWNER_IDS.filter(Boolean)) {
    perms.push({
      id: oid,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels],
    });
  }

  // ── Create channel ──
  let ch;
  try {
    ch = await guild.channels.create({
      name:                 `${m.value}-${Math.round(amountUSD)}-${user.username.replace(/[^a-z0-9]/gi,"").toLowerCase().slice(0,10)}`,
      type:                 ChannelType.GuildText,
      parent:               CONFIG.TICKET_CATEGORY || null,
      permissionOverwrites: perms,
    });
  } catch (err) {
    console.error("Channel create error:", err);
    await interaction.editReply(`❌ Failed to create ticket channel: ${err.message}`);
    return null;
  }

  // ── Labels ──
  const sendLabel    = direction === "send"
    ? `**${coin}** — ${fmtUSD(amountUSD)}`
    : `**${fmtUSD(amountUSD)}** via ${m.label}`;
  const receiveLabel = direction === "send"
    ? (receiveU < 5 ? "To be discussed" : `**${fmtUSD(receiveU)}** via ${m.label}`)
    : (receiveU < 5 ? "To be discussed" : coinAmt ? `**${coinAmt} ${coin}**` : `**${fmtUSD(receiveU)} worth of ${coin}**`);

  // ── Main ticket embed ──
  const coinLogo = COIN_LOGO[coin] || null;
  const ticketEmbed = new EmbedBuilder()
    .setColor(CONFIG.COLOR)
    .setAuthor({ name: "Konvert", iconURL: CONFIG.LOGO_URL || null })
    .setTitle(`${m.label} Exchange`)
    .setThumbnail(coinLogo)
    .setDescription(
      `**Welcome, <@${user.id}>**\n\n` +
      `Your ticket is open. A **${m.label}** handler has been notified and will confirm your details shortly.\n\u200b`
    )
    .addFields(
      { name: "Sending",   value: `**${sendLabel}**`,                          inline: true },
      { name: "Receiving", value: `**${receiveLabel}**`,                       inline: true },
      { name: "Fee",       value: `**${rate}%** — ${fmtUSD(feeUSD)}`,         inline: true },
      {
        name:  direction === "send" ? `Your ${m.label} Details` : "Your Receiving Wallet",
        value: `\`${walletInfo}\``,
        inline: false,
      },
    );

  if (notes) ticketEmbed.addFields({ name: "Notes", value: notes, inline: false });

  ticketEmbed
    .setImage("https://i.imgur.com/1bcQqKx.png")
    .setTimestamp()
    .setFooter({ text: "Konvert  •  Do not share sensitive info outside this ticket" });

  // ── Rules embed ──
  const rulesEmbed = new EmbedBuilder()
    .setColor(0x7C4DFF)
    .setTitle("Before You Proceed — Please Read")
    .setDescription(
      `**Middleman (MM) Required**\n` +
      `All trades must go through a middleman. We support various trusted third-party MMs — talk to your exchanger to agree on one before sending anything.\n\n` +
      `**Do not go first** under any circumstances unless **@jswaps** or **@3uce** explicitly tells you to.\n\n` +
      `**Stay Safe**\n` +
      `Owners and staff will **never** DM you first.\n` +
      `Do not engage with anyone claiming to be an owner or exchanger in your DMs — they are impersonators.\n` +
      `All communication happens here in this ticket only.`
    )
    .setImage("https://i.imgur.com/mUUxkET.png")
    .setFooter({ text: "Konvert  •  Stay safe, stay in this ticket" });

  // ── Buttons ──
  const ticketButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("btn_done")
      .setLabel("Mark Trade Complete")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("btn_close")
      .setLabel("Close Ticket")
      .setStyle(ButtonStyle.Danger),
  );

  await ch.send({ content: `<@${user.id}>`, embeds: [ticketEmbed, rulesEmbed], components: [ticketButtons] });

  // ── Ping roles ──
  const pings = [];
  if (methodRoleId) pings.push(`<@&${methodRoleId}>`);
  if (CONFIG.STAFF_ROLE && CONFIG.STAFF_ROLE !== methodRoleId) pings.push(`<@&${CONFIG.STAFF_ROLE}>`);
  if (pings.length) await ch.send(`${pings.join(" ")} — New **${m.label}** exchange ticket!`);

  // ── Save ticket ──
  const updated = load("tickets");
  updated[ch.id] = {
    userId: user.id, userTag: user.tag,
    method, direction, coin,
    amountUSD, feeUSD, walletInfo,
    notes: notes || "",
    status: "open",
    createdAt: Date.now(),
    messages: [], // for transcript
  };
  save("tickets", updated);

  logAction(guild,
    `TICKET OPENED: #${ch.name}\nUser: ${user.tag} | ${m.label} | ${direction} | ${fmtUSD(amountUSD)} | ${coin}`
  );

  return ch;
}

// ════════════════════════════════════════════════════════════════
//  VOUCH POSTING
// ════════════════════════════════════════════════════════════════
async function postVouchEmbed(guild, completedBy, ticket) {
  if (!CONFIG.VOUCH_CHANNEL) return;
  const ch = guild.channels.cache.get(CONFIG.VOUCH_CHANNEL);
  if (!ch) return;

  // Manual vouch path (from /vouch command)
  if (ticket._manualMessage !== undefined) {
    const stars = "⭐".repeat(Math.min(Math.max(ticket._manualRating || 5, 1), 5));
    const embed = new EmbedBuilder()
      .setColor(CONFIG.COLOR)
      .setTitle("✨ Vouch Recorded!")
      .addFields(
        { name: "👤 Client",        value: `<@${ticket.userId}>`,      inline: true  },
        { name: "✅ Exchanger",     value: `<@${completedBy.id}>`,     inline: true  },
        { name: "\u200b",          value: "\u200b",                   inline: true  },
        { name: "📝 Message",       value: ticket._manualMessage,       inline: false },
        { name: "⭐ Rating",        value: stars,                       inline: false },
      )
      .setTimestamp()
      .setFooter({ text: "Konvert  •  Verified Trade" });
    embed.setImage("https://i.imgur.com/cSxxqd2.png");
    await ch.send({ embeds: [embed] });
    return;
  }

  // Auto vouch path (from Trade Complete button)
  const m        = getMethod(ticket.method);
  const dirLabel = ticket.direction === "send"
    ? `Sent **${ticket.coin}** → Received **${m.label}**`
    : `Sent **${m.label}** → Received **${ticket.coin}**`;

  const embed = new EmbedBuilder()
    .setColor(0x00C896)
    .setAuthor({ name: "Konvert", iconURL: CONFIG.LOGO_URL || null })
    .setTitle("✅  Trade Verified")
    .setDescription(`${dirLabel}
​`)
    .addFields(
      { name: "Client",     value: `<@${ticket.userId}>`,                          inline: true },
      { name: "Exchanger",  value: `<@${completedBy.id}>`,                         inline: true },
      { name: "Method",     value: `${m.label}`,                                    inline: true },
      { name: "Amount",     value: `**${fmtUSD(ticket.amountUSD)}**`,              inline: true },
      { name: "Received",   value: `**${fmtUSD(ticket.amountUSD - ticket.feeUSD)}**`, inline: true },
      { name: "Rating",     value: "⭐⭐⭐⭐⭐",                                  inline: true },
    )
    .setTimestamp()
    .setFooter({ text: "Konvert  •  Verified Trade" });

  embed.setImage("https://i.imgur.com/cSxxqd2.png");

  await ch.send({ embeds: [embed] });
  logAction(guild, `⭐ Auto-vouch: ${ticket.userTag} · ${m.label} · ${fmtUSD(ticket.amountUSD)} · completed by ${completedBy.tag}`);
}

// ════════════════════════════════════════════════════════════════
//  LIVE RATES EMBED
// ════════════════════════════════════════════════════════════════
async function buildRatesEmbed() {
  const ids = CONFIG.COINS.map(c => GECKO_ID[c]||c.toLowerCase()).join(",");
  const res = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd,cad&include_24hr_change=true`
  );
  const prices = await res.json();

  const rows = CONFIG.COINS.map(coin => {
    const d = prices[GECKO_ID[coin]||coin.toLowerCase()];
    if (!d) return null;
    const usd    = d.usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const cad    = d.cad.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const change = parseFloat(d.usd_24h_change || 0).toFixed(2);
    const arrow  = Number(change) >= 0 ? "▲" : "▼";
    return { coin, usd, cad, change, arrow };
  }).filter(Boolean);

  const priceLines = rows.map(r =>
    `\`${r.coin.padEnd(5)}\` **$${r.usd}** · CA$${r.cad} · ${r.arrow} ${r.change}%`
  ).join("\n");

  return new EmbedBuilder()
    .setColor(CONFIG.COLOR)
    .setAuthor({ name: "Konvert", iconURL: CONFIG.LOGO_URL || null })
    .setTitle("Live Rates")
    .setThumbnail(COIN_LOGO["BTC"] || null)
    .setDescription(priceLines + "\n\u200b")
    .addFields({
      name: "Start an Exchange",
      value:
        `Head to <#${CONFIG.EXCHANGE_CHANNEL}> and tap **Exchange Now**.\n` +
        `Use the **Calculate Fee** button for an instant cost estimate.\n` +
        `*Type \`$BTC\`, \`$ETH\`, \`$SOL\` etc. in any channel for a detailed breakdown.*`,
      inline: false,
    })
    .setImage("https://i.imgur.com/SF8G50a.png")
    .setFooter({ text: "Rates refresh every 10 min  •  Konvert" })
    .setTimestamp();
}


// ════════════════════════════════════════════════════════════════
//  INTERACTION HANDLER
// ════════════════════════════════════════════════════════════════
client.on(Events.InteractionCreate, async interaction => {

  // ── SLASH COMMANDS ──────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    const cmd = interaction.commandName;

    // /postexchange — drops the main embed in the channel
    if (cmd === "postexchange") {
      if (!CONFIG.OWNER_IDS.includes(interaction.user.id)) {
        return interaction.reply({ content: "❌ Owner only.", ephemeral: true });
      }
      await interaction.channel.send({
        embeds:     [buildMainExchangeEmbed()],
        components: buildMainExchangeButtons(),
      });
      return interaction.reply({ content: "✅ Exchange embed posted.", ephemeral: true });
    }

    // /rates
    if (cmd === "rates") {
      await interaction.deferReply();
      try {
        const embed = await buildRatesEmbed();
        const row   = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("btn_refresh_rates").setLabel("🔄 Refresh").setStyle(ButtonStyle.Secondary)
        );
        return interaction.editReply({ embeds: [embed], components: [row] });
      } catch { return interaction.editReply("❌ Could not fetch rates."); }
    }

    // /convert
    if (cmd === "convert") {
      await interaction.deferReply();
      try {
        const amount = interaction.options.getNumber("amount");
        const from   = interaction.options.getString("from").toUpperCase();
        const to     = interaction.options.getString("to").toUpperCase();
        const FIAT   = { USD:1, CAD:1.37, EUR:0.93, GBP:0.79 };
        let amtUSD;
        if (FIAT[from]) amtUSD = amount / FIAT[from];
        else { const p = await getUSDPrice(from); if (!p) return interaction.editReply("❌ Unknown: "+from); amtUSD = amount * p; }
        let result;
        if (FIAT[to]) result = amtUSD * FIAT[to];
        else { const p = await getUSDPrice(to); if (!p) return interaction.editReply("❌ Unknown: "+to); result = amtUSD / p; }
        const feeUSD = calcFee(amtUSD, "send");
        const p2     = FIAT[to] ? (1/FIAT[to]) : (await getUSDPrice(to)||1);
        const youGet = result - (feeUSD / p2);
        return interaction.editReply({
          embeds: [
            baseEmbed("🔄 Konvert Conversion")
              .addFields(
                { name: "You Send",                       value: `**${amount} ${from}**`, inline: true },
                { name: "Gross",                          value: `${result.toFixed(6)} ${to}`, inline: true },
                { name: "\u200b",                         value: "\u200b", inline: true },
                { name: `Fee (~${feeRate(amtUSD,"send")}%)`, value: `~${fmtUSD(feeUSD)}`, inline: true },
                { name: "✅ You Receive",                 value: `**${youGet.toFixed(6)} ${to}**`, inline: true },
                { name: "≈ USD After Fee",                value: fmtUSD(amtUSD - feeUSD), inline: true },
              )
              .setFooter({ text: "Head to the exchange channel to open a ticket • Konvert" }),
          ],
        });
      } catch (e) { console.error(e); return interaction.editReply("❌ Conversion failed."); }
    }

    // /fee
    if (cmd === "fee") {
      const amt      = interaction.options.getNumber("amount_usd");
      if (amt <= 0) return interaction.reply({ content: "❌ Enter a valid amount.", ephemeral: true });

      const feeSend  = calcFee(amt, "send");
      const feeRecv  = calcFee(amt, "receive");
      const rateSend = feeRate(amt, "send");
      const rateRecv = feeRate(amt, "receive");

      return interaction.reply({
        embeds: [
          baseEmbed("💸 Fee Calculator")
            .setDescription(`Fee breakdown for a **${fmtUSD(amt)}** trade.
​`)
            .addFields(
              // Fiat → Crypto
              { name: "💳 Fiat → Crypto",              value: `Rate: **${rateSend}%**`,         inline: true },
              { name: "Fee",                            value: `**${fmtUSD(feeSend)}**`,          inline: true },
              { name: "You Receive",                    value: `**${fmtUSD(amt - feeSend)}**`,    inline: true },
              // Crypto → Fiat
              { name: "🪙 Crypto → Fiat",              value: `Rate: **${rateRecv}%**`,          inline: true },
              { name: "Fee",                            value: `**${fmtUSD(feeRecv)}**`,          inline: true },
              { name: "You Receive",                    value: `**${fmtUSD(amt - feeRecv)}**`,   inline: true },
              // Tier table
              {
                name: "📊 Full Fee Tiers",
                value:
                  `\`Under $150  \` → fiat→crypto **9%**  ·  crypto→fiat **8%**
` +
                  `\`$150–$350  \` → **7%** fiat→crypto · **6%** crypto→fiat
` +
                  `\`$350–$500  \` → **7%** fiat→crypto · **6%** crypto→fiat
` +
                  `\`$500–$1000 \` → **6%** fiat→crypto · **5%** crypto→fiat
` +
                  `\`$1000+      \` → fiat→crypto **5.5%**  ·  crypto→fiat **4.5%**
` +
                  `\`Min fee\`   → **$5.00** on any deal`,
                inline: false,
              },
            )
            .setFooter({ text: "Click Exchange Now in the exchange channel to open a ticket" }),
        ],
        ephemeral: true,
      });
    }

    // /vouch (manual)
    if (cmd === "vouch") {
      const target  = interaction.options.getUser("user");
      const message = interaction.options.getString("message");
      const rating  = interaction.options.getInteger("rating") || 5;
      // Manual vouch — build a minimal ticket-like object for display
      await postVouchEmbed(interaction.guild, interaction.user, {
        userId: target.id, userTag: target.tag,
        method: null, direction: null, coin: "—",
        amountUSD: 0, feeUSD: 0,
        _manualMessage: message, _manualRating: rating,
      });
      return interaction.reply({ content: `✅ Vouch posted for <@${target.id}>!`, ephemeral: true });
    }

    // /closeticket
    if (cmd === "closeticket") {
      if (!CONFIG.OWNER_IDS.includes(interaction.user.id)) return interaction.reply({ content: "❌ Owner only.", ephemeral: true });
      const reason  = interaction.options.getString("reason") || "Completed";
      const tickets = load("tickets");
      const ch      = interaction.channel;
      if (!tickets[ch.id]) return interaction.reply({ content: "❌ Not a ticket channel.", ephemeral: true });
      tickets[ch.id].status     = "closed";
      tickets[ch.id].closedAt   = Date.now();
      tickets[ch.id].closeReason = reason;
      save("tickets", tickets);
      await interaction.reply({
        embeds: [baseEmbed("🔒 Ticket Closed").setDescription(`Closed by staff.\n**Reason:** ${reason}\n\nDeleting in 10 seconds.`).setColor(0xFF4444)],
      });
      logAction(interaction.guild, `🔒 Closed by ${interaction.user.tag} — #${ch.name} — ${reason}`);
      setTimeout(() => ch.delete().catch(()=>{}), 10000);
    }

    // /setwallet
    if (cmd === "setwallet") {
      if (!CONFIG.OWNER_IDS.includes(interaction.user.id)) return interaction.reply({ content: "❌ Owner only.", ephemeral: true });
      const coin = interaction.options.getString("coin").toUpperCase();
      const addr = interaction.options.getString("address");
      const w    = load("wallets"); w[coin] = addr; save("wallets", w);
      logAction(interaction.guild, `💼 ${interaction.user.tag} set ${coin} → ${addr}`);
      return interaction.reply({ content: `✅ **${coin}** deposit address set to \`${addr}\``, ephemeral: true });
    }

    // /announce
    if (cmd === "announce") {
      if (!CONFIG.OWNER_IDS.includes(interaction.user.id)) return interaction.reply({ content: "❌ Owner only.", ephemeral: true });
      const message  = interaction.options.getString("message");
      const channelId = interaction.options.getString("channel");
      const ping     = interaction.options.getString("ping") || "none";
      const ch       = interaction.guild.channels.cache.get(channelId);
      if (!ch) return interaction.reply({ content: "❌ Channel not found.", ephemeral: true });
      const pingStr  = ping === "everyone" ? "@everyone " : ping === "here" ? "@here " : "";
      await ch.send({
        content: pingStr || undefined,
        embeds: [baseEmbed("📢 Konvert Announcement").setDescription(message).setFooter({ text: `By ${interaction.user.tag}` })],
      });
      return interaction.reply({ content: "✅ Announced.", ephemeral: true });
    }

    // /blacklist
    if (cmd === "blacklist") {
      if (!CONFIG.OWNER_IDS.includes(interaction.user.id)) return interaction.reply({ content: "❌ Owner only.", ephemeral: true });
      const target = interaction.options.getUser("user");
      const reason = interaction.options.getString("reason") || "No reason given";
      const bl     = load("blacklist"); bl[target.id] = { tag: target.tag, reason, by: interaction.user.tag, at: Date.now() };
      save("blacklist", bl);
      logAction(interaction.guild, `🚫 ${interaction.user.tag} blacklisted ${target.tag}: ${reason}`);
      return interaction.reply({ content: `🚫 **${target.tag}** blacklisted. Reason: ${reason}`, ephemeral: true });
    }

    // /unblacklist
    if (cmd === "unblacklist") {
      if (!CONFIG.OWNER_IDS.includes(interaction.user.id)) return interaction.reply({ content: "❌ Owner only.", ephemeral: true });
      const target = interaction.options.getUser("user");
      const bl     = load("blacklist"); delete bl[target.id]; save("blacklist", bl);
      return interaction.reply({ content: `✅ **${target.tag}** removed from blacklist.`, ephemeral: true });
    }

    // /stats
    if (cmd === "stats") {
      const target   = interaction.options.getUser("user") || interaction.user;
      const tickets  = load("tickets");
      const userStats = load("stats");
      const all      = Object.values(tickets);

      // Per-user stats from tickets
      const userTickets  = all.filter(t => t.userId === target.id);
      const totalTrades  = userTickets.filter(t => t.status === "vouched").length;
      const totalVolume  = userTickets.filter(t => t.status === "vouched").reduce((s, t) => s + (t.amountUSD || 0), 0);
      const avgDeal      = totalTrades > 0 ? totalVolume / totalTrades : 0;
      const openTicket   = userTickets.find(t => t.status === "open");

      // Method breakdown
      const methods = {};
      userTickets.filter(t => t.status === "vouched").forEach(t => {
        if (t.method) methods[t.method] = (methods[t.method] || 0) + 1;
      });
      const topMethod = Object.entries(methods).sort((a,b) => b[1]-a[1])[0];

      // Most traded coin
      const coins = {};
      userTickets.filter(t => t.status === "vouched").forEach(t => {
        if (t.coin) coins[t.coin] = (coins[t.coin] || 0) + 1;
      });
      const topCoin = Object.entries(coins).sort((a,b) => b[1]-a[1])[0];

      // Last trade date
      const lastTrade = userTickets
        .filter(t => t.completedAt)
        .sort((a,b) => b.completedAt - a.completedAt)[0];

      const isSelf = target.id === interaction.user.id;
      const member = await interaction.guild.members.fetch(target.id).catch(() => null);
      const avatarURL = target.displayAvatarURL({ size: 64 });

      const embed = new EmbedBuilder()
        .setColor(CONFIG.COLOR)
        .setAuthor({ name: "Konvert", iconURL: CONFIG.LOGO_URL || null })
        .setTitle(isSelf ? "Your Exchange Stats" : `${target.username}'s Exchange Stats`)
        .setThumbnail(avatarURL)
        .addFields(
          { name: "Completed Trades", value: `**${totalTrades}**`,                                inline: true },
          { name: "Total Volume",     value: totalVolume > 0 ? `**${fmtUSD(totalVolume)}**` : "—", inline: true },
          { name: "Avg Deal Size",    value: avgDeal > 0 ? `**${fmtUSD(avgDeal)}**` : "—",        inline: true },
          { name: "Favourite Method", value: topMethod ? `**${getMethod(topMethod[0])?.label || topMethod[0]}** (${topMethod[1]} trades)` : "—", inline: true },
          { name: "Favourite Coin",   value: topCoin ? `**${topCoin[0]}** (${topCoin[1]} trades)` : "—", inline: true },
          { name: "Last Trade",       value: lastTrade ? `<t:${Math.floor(lastTrade.completedAt/1000)}:R>` : "—", inline: true },
          { name: "Open Ticket",      value: openTicket ? `<#${Object.entries(tickets).find(([,t])=>t===openTicket)?.[0] || "??"}>` : "None", inline: true },
        )
        .setFooter({ text: totalTrades === 0 ? "No completed trades yet" : `${totalTrades} verified trade${totalTrades !== 1 ? "s" : ""} on Konvert` })
        .setTimestamp();

      embed.setImage("https://i.imgur.com/VHBuITj.gif");
      return interaction.reply({ embeds: [embed] });
    }

    // /alert
    if (cmd === "alert") {
      const coin      = interaction.options.getString("coin").toUpperCase();
      const target    = interaction.options.getNumber("price");
      const direction = interaction.options.getString("direction");
      if (!CONFIG.COINS.includes(coin)) return interaction.reply({ content: `❌ Unsupported coin: ${coin}`, ephemeral: true });

      if (!client._alerts) client._alerts = [];
      client._alerts.push({ userId: interaction.user.id, coin, target, direction, channelId: interaction.channel.id });

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(CONFIG.COLOR)
            .setThumbnail(COIN_LOGO[coin] || null)
            .setTitle("Price Alert Set")
            .setDescription(`You'll be notified when **${coin}** goes **${direction}** $${target.toLocaleString("en-US")}.`)
            .setFooter({ text: "Konvert  •  Price Alerts" }),
        ],
        ephemeral: true,
      });
    }
  }

  // ── STRING SELECT — Method chosen ───────────────────────────
  if (interaction.isStringSelectMenu() && interaction.customId === "select_method") {
    const method = interaction.values[0];
    return interaction.update({
      embeds:     [step2Embed(method)],
      components: step2Components(method),
    });
  }

  // ── BUTTONS ─────────────────────────────────────────────────
  if (interaction.isButton()) {

    // ── "Exchange Now" on the main embed ──
    if (interaction.customId === "btn_exchange_now") {
      const bl = load("blacklist");
      if (bl[interaction.user.id]) {
        return interaction.reply({ content: "🚫 You are blacklisted from Konvert.", ephemeral: true });
      }
      return interaction.reply({
        embeds:     [step1Embed()],
        components: step1Components(),
        ephemeral:  true,
      });
    }

    // ── "Calculate Fee" on the main embed ──
    if (interaction.customId === "btn_fee_preview") {
      const modal = new ModalBuilder()
        .setCustomId("modal_fee_calc")
        .setTitle("💸 Fee Calculator");
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("fee_amount")
            .setLabel("Your trade amount in USD")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("e.g. 250")
            .setRequired(true)
        )
      );
      return interaction.showModal(modal);
    }

    // ── "Live Rates" on the main embed ──
    if (interaction.customId === "btn_rates_preview") {
      await interaction.deferReply({ ephemeral: true });
      try {
        const embed = await buildRatesEmbed();
        return interaction.editReply({ embeds: [embed] });
      } catch { return interaction.editReply("❌ Could not fetch rates right now."); }
    }

    // ── Refresh rates (from /rates command) ──
    if (interaction.customId === "btn_refresh_rates") {
      await interaction.deferUpdate();
      try {
        return interaction.editReply({
          embeds: [await buildRatesEmbed()],
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("btn_refresh_rates").setLabel("🔄 Refresh").setStyle(ButtonStyle.Secondary)
          )],
        });
      } catch { return interaction.followUp({ content: "❌ Refresh failed.", ephemeral: true }); }
    }

    // ── Direction buttons → show amount modal ──
    if (interaction.customId.startsWith("dir_send__") || interaction.customId.startsWith("dir_receive__")) {
      const isSend    = interaction.customId.startsWith("dir_send__");
      const method    = interaction.customId.replace("dir_send__","").replace("dir_receive__","");
      const direction = isSend ? "send" : "receive";
      const m         = getMethod(method);

      const modal = new ModalBuilder()
        .setCustomId(`modal_amount__${method}__${direction}`)
        .setTitle(`${m.label} · ${isSend ? "Send Crypto" : "Receive Crypto"}`);

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("inp_amount")
            .setLabel("Trade amount in USD")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("e.g. 150")
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("inp_coin")
            .setLabel("Which crypto? (BTC / ETH / SOL / LTC…)")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("e.g. SOL")
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("inp_wallet")
            .setLabel(isSend
              ? `Your ${m.label} receiving info (email / tag)`
              : "Your crypto receiving wallet address"
            )
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("inp_notes")
            .setLabel("Any extra notes? (optional)")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
        ),
      );

      return interaction.showModal(modal);
    }

    // ── ✅ Trade Complete → instant auto-vouch, no modal ──
    if (interaction.customId === "btn_done") {
      const tickets = load("tickets");
      const ticket  = tickets[interaction.channel.id];
      if (!ticket) return interaction.reply({ content: "❌ No ticket data found.", ephemeral: true });

      // Staff/owner only
      const isOwner      = CONFIG.OWNER_IDS.includes(interaction.user.id);
      const isStaff      = CONFIG.STAFF_ROLE ? interaction.member.roles.cache.has(CONFIG.STAFF_ROLE) : false;
      const methodRoleId = ticket.method ? CONFIG.ROLES[ticket.method] : null;
      const isHandler    = methodRoleId ? interaction.member.roles.cache.has(methodRoleId) : false;
      if (!isOwner && !isStaff && !isHandler) {
        return interaction.reply({ content: "❌ Only staff or the assigned handler can mark a trade complete.", ephemeral: true });
      }
      if (ticket.status === "vouched" || ticket.status === "closed") {
        return interaction.reply({ content: "❌ This ticket has already been completed.", ephemeral: true });
      }

      await interaction.deferReply();

      // Fire vouch instantly
      await postVouchEmbed(interaction.guild, interaction.user, ticket);

      // Update ticket status
      tickets[interaction.channel.id].status      = "vouched";
      tickets[interaction.channel.id].completedBy = interaction.user.id;
      tickets[interaction.channel.id].completedAt = Date.now();
      save("tickets", tickets);

      // Update per-user stats in tickets.json (stats are derived from tickets)
      // ticket already saved above with status=vouched, completedAt, amountUSD, method, coin
      // /stats command reads directly from tickets so no separate tracking needed

      // Completion message in ticket
      const m = getMethod(ticket.method);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x00C896)
            .setAuthor({ name: "Konvert", iconURL: CONFIG.LOGO_URL || null })
            .setTitle("Trade Complete")
            .addFields(
              { name: "Client",    value: `<@${ticket.userId}>`,   inline: true },
              { name: "Method",    value: m.label,                  inline: true },
              { name: "Amount",    value: fmtUSD(ticket.amountUSD), inline: true },
              { name: "Coin",      value: ticket.coin,              inline: true },
              { name: "Direction", value: ticket.direction === "send" ? `${ticket.coin} → ${m.label}` : `${m.label} → ${ticket.coin}`, inline: true },
              { name: "Rating",    value: "★★★★★",                inline: true },
            )
            .setDescription("Vouch posted. This ticket closes in **15 seconds**.")
            .setImage("https://i.imgur.com/1bcQqKx.png")
            .setTimestamp()
            .setFooter({ text: "Konvert" }),
        ],
      });

            setTimeout(() => interaction.channel.delete().catch(() => {}), 15000);
    }

    // ── 🔒 Close ticket ──
    if (interaction.customId === "btn_close") {
      const tickets = load("tickets");
      const ticket  = tickets[interaction.channel.id];
      if (!ticket) return interaction.reply({ content: "❌ Not a ticket channel.", ephemeral: true });
      if (!CONFIG.OWNER_IDS.includes(interaction.user.id)) {
        return interaction.reply({ content: "❌ Only an owner can close tickets.", ephemeral: true });
      }

      await interaction.deferReply();

      // Generate transcript before closing
      const transcript = await generateTranscript(interaction.channel, ticket);

      tickets[interaction.channel.id].status   = "closed";
      tickets[interaction.channel.id].closedAt = Date.now();
      save("tickets", tickets);

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xFF4444)
            .setAuthor({ name: "Konvert", iconURL: CONFIG.LOGO_URL || null })
            .setTitle("Ticket Closed")
            .setDescription("This ticket has been closed.\nTranscript saved. Deleting in 15 seconds.")
            .setTimestamp()
            .setFooter({ text: "Konvert" }),
        ],
      });

      // Send transcript to log channel
      if (transcript && CONFIG.LOG_CHANNEL) {
        const logCh = interaction.guild.channels.cache.get(CONFIG.LOG_CHANNEL);
        if (logCh) {
          await logCh.send({
            content: `Transcript for **#${interaction.channel.name}** — closed by ${interaction.user.tag}`,
            files: [{ attachment: transcript.filepath, name: transcript.filename }],
          });
          fs.unlinkSync(transcript.filepath);
        }
      }

      // DM transcript to ticket owner
      try {
        const owner = await interaction.guild.members.fetch(ticket.userId);
        if (owner && transcript) {
          const dmFile = await generateTranscript(interaction.channel, ticket);
          if (dmFile) {
            await owner.send({
              content: `Your Konvert exchange ticket has been closed. Here is your transcript:`,
              files: [{ attachment: dmFile.filepath, name: dmFile.filename }],
            }).catch(() => {});
            fs.unlinkSync(dmFile.filepath);
          }
        }
      } catch {}

      logAction(interaction.guild, `CLOSED by ${interaction.user.tag} — #${interaction.channel.name}`);
      setTimeout(() => interaction.channel.delete().catch(()=>{}), 15000);
    }

    // ── Confirm ticket ──
    if (interaction.customId === "btn_confirm_ticket") {
      await interaction.deferUpdate();
      const pending = client._pendingTickets?.[interaction.user.id];
      if (!pending) {
        return interaction.editReply({ content: "❌ Session expired. Please run /exchange again.", components: [], embeds: [] });
      }
      delete client._pendingTickets[interaction.user.id];
      const ch = await createTicket(
        interaction, pending.method, pending.direction,
        pending.rawAmt, pending.coin, pending.walletInf, pending.notes
      );
      if (ch) return interaction.editReply({ content: `✅ Your ticket is open → <#${ch.id}>`, embeds: [], components: [] });
    }

    // ── Cancel ticket ──
    if (interaction.customId === "btn_cancel_ticket") {
      if (client._pendingTickets) delete client._pendingTickets[interaction.user.id];
      return interaction.update({ content: "Cancelled. Run /exchange or click **Exchange Now** to start again.", embeds: [], components: [] });
    }

  }

  // ── MODALS ──────────────────────────────────────────────────
  if (interaction.isModalSubmit()) {

    // Fee calc modal
    if (interaction.customId === "modal_fee_calc") {
      const raw = parseFloat(interaction.fields.getTextInputValue("fee_amount"));
      if (isNaN(raw) || raw <= 0) {
        return interaction.reply({ content: "❌ Enter a valid amount greater than $0.", ephemeral: true });
      }

      const feeSend  = calcFee(raw, "send");
      const feeRecv  = calcFee(raw, "receive");
      const rateSend = feeRate(raw, "send");
      const rateRecv = feeRate(raw, "receive");

      return interaction.reply({
        embeds: [
          baseEmbed("💸 Fee Breakdown")
            .setDescription(`Breakdown for a **${fmtUSD(raw)}** trade.
​`)
            .addFields(
              { name: "💳 Fiat → Crypto",   value: `Rate: **${rateSend}%**`,        inline: true },
              { name: "Fee",                 value: `**${fmtUSD(feeSend)}**`,         inline: true },
              { name: "You Receive",         value: `**${fmtUSD(raw - feeSend)}**`,   inline: true },
              { name: "🪙 Crypto → Fiat",   value: `Rate: **${rateRecv}%**`,         inline: true },
              { name: "Fee",                 value: `**${fmtUSD(feeRecv)}**`,         inline: true },
              { name: "You Receive",         value: `**${fmtUSD(raw - feeRecv)}**`,   inline: true },
            )
            .setFooter({ text: "Estimate only — final fee may vary slightly  •  Konvert" }),
        ],
        ephemeral: true,
      });
    }

    // Amount modal → show confirmation summary before opening ticket
    if (interaction.customId.startsWith("modal_amount__")) {
      await interaction.deferReply({ ephemeral: true });

      const parts     = interaction.customId.split("__");
      const method    = parts[1];
      const direction = parts[2];
      const m         = getMethod(method);

      const rawAmt    = parseFloat(interaction.fields.getTextInputValue("inp_amount"));
      const coin      = interaction.fields.getTextInputValue("inp_coin").toUpperCase().trim();
      const walletInf = interaction.fields.getTextInputValue("inp_wallet").trim();
      const notes     = interaction.fields.getTextInputValue("inp_notes")?.trim() || "";

      if (isNaN(rawAmt) || rawAmt <= 0) {
        return interaction.editReply("❌ Please enter a valid amount greater than $0.");
      }
      if (!CONFIG.COINS.includes(coin)) {
        return interaction.editReply(`❌ **${coin}** is not supported.\nTry one of: ${CONFIG.COINS.join(", ")}`);
      }
      if (!walletInf) {
        return interaction.editReply("❌ Please enter your receiving wallet or account info.");
      }

      const fee      = calcFee(rawAmt, direction);
      const rate     = feeRate(rawAmt, direction);
      const receives = rawAmt - fee;
      const coinLogo = COIN_LOGO[coin] || null;

      const sendLabel = direction === "send"
        ? `**${coin}** worth **${fmtUSD(rawAmt)}**`
        : `**${fmtUSD(rawAmt)}** via ${m.label}`;
      const recvLabel = direction === "send"
        ? `**${fmtUSD(receives)}** via ${m.label}`
        : (receives < 5 ? "To be discussed" : `**~${fmtUSD(receives)}** worth of ${coin}`);

      // Store pending data in memory keyed by user ID
      if (!client._pendingTickets) client._pendingTickets = {};
      client._pendingTickets[interaction.user.id] = { method, direction, rawAmt, coin, walletInf, notes };

      const confirmEmbed = new EmbedBuilder()
        .setColor(CONFIG.COLOR)
        .setAuthor({ name: "Konvert", iconURL: CONFIG.LOGO_URL || null })
        .setThumbnail(coinLogo || "https://i.imgur.com/GXwsQv0.mp4")
        .setTitle("Confirm Your Exchange")
        .setDescription("Please review your exchange details below before confirming.\nOnce confirmed a private ticket will be opened for you.\n\u200b")
        .addFields(
          { name: "Payment Method", value: m.label,                        inline: true },
          { name: "Crypto",         value: coin,                            inline: true },
          { name: "Direction",      value: direction === "send" ? "Fiat → Crypto" : "Crypto → Fiat", inline: true },
          { name: "You Send",       value: sendLabel,                       inline: true },
          { name: "You Receive",    value: recvLabel,                       inline: true },
          { name: "Est. Fee",       value: `${rate}% — ${fmtUSD(fee)}`,    inline: true },
          { name: "Your Info",      value: `||${walletInf}||`,              inline: false },
        )
        .setImage("https://i.imgur.com/pYBg770.png")
        .setFooter({ text: "Estimate only — final fee may vary  •  Konvert" });

      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("btn_confirm_ticket")
          .setLabel("Confirm & Open Ticket")
          .setStyle(ButtonStyle.Success)
          .setEmoji("✅"),
        new ButtonBuilder()
          .setCustomId("btn_cancel_ticket")
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("✖️"),
      );

      return interaction.editReply({ embeds: [confirmEmbed], components: [confirmRow] });
    }

  }
});


// ════════════════════════════════════════════════════════════════
//  TRANSCRIPT GENERATOR
// ════════════════════════════════════════════════════════════════
async function generateTranscript(channel, ticket) {
  try {
    const fetched  = await channel.messages.fetch({ limit: 100 });
    const sorted   = [...fetched.values()].reverse();
    const m        = getMethod(ticket.method);
    const opened   = new Date(ticket.createdAt).toLocaleString("en-US", { timeZone: "America/Toronto" });
    const generated = new Date().toLocaleString("en-US", { timeZone: "America/Toronto" });

    const rows = sorted.map(msg => {
      const time      = new Date(msg.createdTimestamp).toLocaleString("en-US", { timeZone: "America/Toronto" });
      const isBot     = msg.author.bot;
      const avatarURL = msg.author.displayAvatarURL({ size: 64, extension: "png" });
      const content   = msg.content ? msg.content.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;") : "";

      const embedsHtml = msg.embeds.map(e => {
        const fields = (e.fields || []).map(f =>
          `<div class="field"><span class="field-name">${f.name.replace(/</g,"&lt;")}</span><span class="field-value">${String(f.value).replace(/</g,"&lt;").replace(/>/g,"&gt;")}</span></div>`
        ).join("");
        return `<div class="embed" style="border-color:${e.hexColor||"#7C4DFF"}">
          ${e.author ? `<div class="embed-author">${e.author.name||""}</div>` : ""}
          ${e.title  ? `<div class="embed-title">${e.title.replace(/</g,"&lt;")}</div>` : ""}
          ${e.description ? `<div class="embed-desc">${e.description.replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br>")}</div>` : ""}
          ${fields ? `<div class="fields">${fields}</div>` : ""}
        </div>`;
      }).join("");

      const attachHtml = [...(msg.attachments?.values()||[])].map(a =>
        a.contentType?.startsWith("image") ? `<img class="attach-img" src="${a.url}"/>` : `<a class="attach-link" href="${a.url}">${a.name}</a>`
      ).join("");

      return `<div class="msg ${isBot ? "bot-msg" : ""}">
        <img class="avatar" src="${avatarURL}" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'"/>
        <div class="msg-body">
          <div class="msg-header">
            <span class="author ${isBot ? "bot-tag" : ""}">${msg.author.username}${isBot ? " <span class='app-badge'>APP</span>" : ""}</span>
            <span class="userid">ID: ${msg.author.id}</span>
            <span class="time">${time}</span>
          </div>
          ${content ? `<div class="content">${content}</div>` : ""}
          ${embedsHtml}
          ${attachHtml}
        </div>
      </div>`;
    }).join("");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Konvert — Transcript #${channel.name}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0e0e1a;color:#dcddde;font-family:'Segoe UI',sans-serif;font-size:14px;line-height:1.5}
  .topbar{background:linear-gradient(135deg,#7C4DFF,#5c35cc);padding:24px 32px;display:flex;align-items:center;gap:16px}
  .topbar img{width:48px;height:48px;border-radius:50%;border:2px solid rgba(255,255,255,.3)}
  .topbar h1{font-size:20px;font-weight:700;color:#fff}
  .topbar p{font-size:12px;color:rgba(255,255,255,.7);margin-top:2px}
  .meta-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1px;background:#1a1a2e;border-bottom:1px solid #2a2a40}
  .meta-item{background:#12121f;padding:16px 24px}
  .meta-label{font-size:10px;font-weight:700;letter-spacing:1px;color:#7C4DFF;text-transform:uppercase;margin-bottom:4px}
  .meta-value{font-size:14px;color:#fff;font-weight:500}
  .messages{padding:16px 24px;max-width:900px;margin:0 auto}
  .msg{display:flex;gap:14px;padding:12px 0;border-bottom:1px solid #1a1a2e;transition:background .1s}
  .msg:hover{background:#12121f;border-radius:8px;padding:12px 8px;margin:0 -8px}
  .bot-msg .msg-body{opacity:.9}
  .avatar{width:40px;height:40px;border-radius:50%;flex-shrink:0;object-fit:cover}
  .msg-header{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:4px}
  .author{font-weight:700;color:#A78BFA;font-size:14px}
  .bot-tag{color:#7289da}
  .app-badge{background:#5865f2;color:#fff;font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;letter-spacing:.5px;vertical-align:middle}
  .userid{font-size:10px;color:#4a4a6a;font-family:monospace}
  .time{font-size:11px;color:#4f545c;margin-left:auto}
  .content{color:#dcddde;white-space:pre-wrap;word-break:break-word}
  .embed{background:#1e1e2e;border-left:4px solid #7C4DFF;border-radius:0 6px 6px 0;padding:12px 16px;margin-top:8px;max-width:520px}
  .embed-author{font-size:12px;color:#b9bbbe;font-weight:600;margin-bottom:6px}
  .embed-title{font-size:15px;font-weight:700;color:#fff;margin-bottom:6px}
  .embed-desc{font-size:13px;color:#b9bbbe;white-space:pre-wrap}
  .fields{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}
  .field{background:#16162a;padding:8px;border-radius:4px}
  .field-name{display:block;font-size:11px;font-weight:700;color:#7C4DFF;margin-bottom:2px}
  .field-value{display:block;font-size:12px;color:#dcddde}
  .attach-img{max-width:300px;max-height:200px;border-radius:6px;margin-top:8px;display:block}
  .attach-link{color:#7C4DFF;font-size:12px;margin-top:6px;display:block}
  .footer{text-align:center;padding:24px;color:#4f545c;font-size:11px;border-top:1px solid #1a1a2e;margin-top:24px}
</style>
</head>
<body>
<div class="topbar">
  ${CONFIG.LOGO_URL ? `<img src="${CONFIG.LOGO_URL}" alt="Konvert"/>` : ""}
  <div>
    <h1>Konvert Exchange — Ticket Transcript</h1>
    <p>#${channel.name}</p>
  </div>
</div>
<div class="meta-grid">
  <div class="meta-item"><div class="meta-label">Channel</div><div class="meta-value">#${channel.name}</div></div>
  <div class="meta-item"><div class="meta-label">Client</div><div class="meta-value">${ticket.userTag} <span style="color:#4a4a6a;font-size:11px">(${ticket.userId})</span></div></div>
  <div class="meta-item"><div class="meta-label">Method</div><div class="meta-value">${m ? m.label : "—"}</div></div>
  <div class="meta-item"><div class="meta-label">Coin</div><div class="meta-value">${ticket.coin || "—"}</div></div>
  <div class="meta-item"><div class="meta-label">Amount</div><div class="meta-value">${fmtUSD(ticket.amountUSD || 0)}</div></div>
  <div class="meta-item"><div class="meta-label">Direction</div><div class="meta-value">${ticket.direction === "send" ? "Fiat → Crypto" : "Crypto → Fiat"}</div></div>
  <div class="meta-item"><div class="meta-label">Opened</div><div class="meta-value">${opened}</div></div>
  <div class="meta-item"><div class="meta-label">Status</div><div class="meta-value">${ticket.status || "closed"}</div></div>
  <div class="meta-item"><div class="meta-label">Generated</div><div class="meta-value">${generated}</div></div>
</div>
<div class="messages">${rows}</div>
<div class="footer">Konvert Exchange &nbsp;•&nbsp; Transcript generated ${generated} &nbsp;•&nbsp; ${sorted.length} messages</div>
</body>
</html>`;

    const filename = `transcript-${channel.name}-${Date.now()}.html`;
    const filepath  = `./${filename}`;
    fs.writeFileSync(filepath, html);
    return { filepath, filename };
  } catch (e) {
    console.error("Transcript error:", e);
    return null;
  }
}


// ════════════════════════════════════════════════════════════════
//  $COIN QUICK LOOKUP — type $BTC $ETH etc in any channel
// ════════════════════════════════════════════════════════════════
client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;
  const match = message.content.trim().match(/^\$([A-Za-z]{2,10})$/);
  if (!match) return;
  const coin = match[1].toUpperCase();
  if (!CONFIG.COINS.includes(coin)) return;

  try {
    const id  = GECKO_ID[coin] || coin.toLowerCase();
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd,cad,eur,gbp&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`
    );
    const dat = await res.json();
    const d   = dat[id];
    if (!d) return;

    const fmt = (n) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const change = parseFloat(d.usd_24h_change || 0).toFixed(2);
    const arrow  = Number(change) >= 0 ? "▲" : "▼";
    const color  = Number(change) >= 0 ? 0x00C896 : 0xFF4444;
    const mcap   = d.usd_market_cap ? `$${(d.usd_market_cap / 1e9).toFixed(2)}B` : "—";
    const vol    = d.usd_24h_vol    ? `$${(d.usd_24h_vol / 1e9).toFixed(2)}B`    : "—";
    const logo   = COIN_LOGO[coin] || CONFIG.LOGO_URL || null;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setAuthor({ name: `${coin} — Live Price`, iconURL: logo })
      .setThumbnail(logo)
      .addFields(
        { name: "USD",        value: `**$${fmt(d.usd)}**`,        inline: true },
        { name: "CAD",        value: `CA$${fmt(d.cad)}`,          inline: true },
        { name: "EUR",        value: `€${fmt(d.eur)}`,            inline: true },
        { name: "24h Change", value: `${arrow} **${change}%**`,   inline: true },
        { name: "Market Cap", value: mcap,                         inline: true },
        { name: "24h Volume", value: vol,                          inline: true },
      )
      .setFooter({ text: `Type $${coin} in any channel for a live update  •  Konvert` })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  } catch (e) {
    console.error("Coin lookup error:", e.message);
  }
});

// ─── AUTO RATES ──────────────────────────────────────────────
let ratesMsgId = null;
async function autoRates(guild) {
  if (!CONFIG.RATES_CHANNEL) return;
  const ch = guild.channels.cache.get(CONFIG.RATES_CHANNEL);
  if (!ch) return;
  try {
    const embed = await buildRatesEmbed();
    if (ratesMsgId) {
      const msg = await ch.messages.fetch(ratesMsgId).catch(()=>null);
      if (msg) { await msg.edit({ embeds: [embed] }); return; }
    }
    const sent = await ch.send({ embeds: [embed] });
    ratesMsgId  = sent.id;
  } catch (e) { console.error("Auto rates:", e.message); }
}

// ─── READY ───────────────────────────────────────────────────
client.once(Events.ClientReady, async () => {
  console.log(`✅ Konvert Bot v3 online — ${client.user.tag}`);
  client.user.setPresence({
    activities: [{ name: "Konvert", type: 3 }],
    status: "online",
  });
  const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
  if (guild) {
    await autoRates(guild);
    setInterval(() => autoRates(guild), 10 * 60 * 1000);

    // Price alert checker — runs every 5 minutes
    setInterval(async () => {
      if (!client._alerts || client._alerts.length === 0) return;
      const ids  = [...new Set(client._alerts.map(a => GECKO_ID[a.coin]||a.coin.toLowerCase()))].join(",");
      try {
        const res    = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`);
        const prices = await res.json();
        const fired  = [];
        for (const alert of client._alerts) {
          const price = prices[GECKO_ID[alert.coin]||alert.coin.toLowerCase()]?.usd;
          if (!price) continue;
          const triggered = alert.direction === "above" ? price >= alert.target : price <= alert.target;
          if (!triggered) continue;
          try {
            const user = await client.users.fetch(alert.userId);
            await user.send({
              embeds: [
                new EmbedBuilder()
                  .setColor(CONFIG.COLOR)
                  .setThumbnail(COIN_LOGO[alert.coin] || null)
                  .setTitle("🔔 Price Alert Triggered!")
                  .setDescription(
                    `**${alert.coin}** is now **${alert.direction === "above" ? "above" : "below"}** your target of $${alert.target.toLocaleString("en-US")}\n\n` +
                    `Current price: **$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}**\n\n` +
                    `Head to <#${CONFIG.EXCHANGE_CHANNEL}> to open a trade.`
                  )
                  .setFooter({ text: "Konvert  •  Price Alerts" })
                  .setTimestamp(),
              ],
            });
          } catch {}
          fired.push(alert);
        }
        // Remove fired alerts
        client._alerts = client._alerts.filter(a => !fired.includes(a));
      } catch {}
    }, 5 * 60 * 1000);
  }
});

// ─── BOOT ────────────────────────────────────────────────────
registerCommands()
  .then(() => client.login(CONFIG.TOKEN))
  .catch(console.error);
