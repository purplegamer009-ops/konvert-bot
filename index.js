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

  COINS: ["BTC","ETH","SOL","LTC","USDT","USDC","XRP","BNB","ADA","DOGE"],
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

const COIN_EMOJI = { BTC:"₿",ETH:"Ξ",SOL:"◎",LTC:"Ł",USDT:"₮",USDC:"💵",XRP:"✕",BNB:"🔶",ADA:"₳",DOGE:"Ð" };
const GECKO_ID   = { BTC:"bitcoin",ETH:"ethereum",SOL:"solana",LTC:"litecoin",USDT:"tether",
  USDC:"usd-coin",XRP:"ripple",BNB:"binancecoin",ADA:"cardano",DOGE:"dogecoin" };

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
    .setAuthor({ name: "Konvert Exchange", iconURL: CONFIG.LOGO_URL || null })
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
      { name: "💸  Fee",         value: "9% — 5.5%\nTiered by amount", inline: true },
      { name: "⚡  Speed",       value: "Under 30 min\nTypically faster", inline: true },
      { name: "🔒  Security",    value: "Private tickets\nStaff verified", inline: true },
    )
    .setImage(CONFIG.BANNER_URL || null)
    .setFooter({ text: "Konvert Exchange  •  Minimum fee $5" });
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
    .setAuthor({ name: "Konvert Exchange", iconURL: CONFIG.LOGO_URL || null })
    .setTitle("Select Payment Method")
    .setDescription("Choose how you'd like to pay or receive.\nA private ticket will be opened with the right handler automatically.")
    .setFooter({ text: "Step 1 of 3" });
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
    .setAuthor({ name: "Konvert Exchange", iconURL: CONFIG.LOGO_URL || null })
    .setTitle(`${m.emoji}  ${m.label} — Choose Direction`)
    .setDescription(
      `**📤  Send Crypto → Receive ${m.label}**
` +
      `You send crypto. We send ${m.label} to your account.

` +
      `**📥  Send ${m.label} → Receive Crypto**
` +
      `You send ${m.label}. We send crypto to your wallet.
​`
    )
    .setFooter({ text: "Step 2 of 3" });
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
      name:                 `${m.value}-${user.username.replace(/[^a-z0-9]/gi,"").toLowerCase().slice(0,15)}`,
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
  const ticketEmbed = new EmbedBuilder()
    .setColor(CONFIG.COLOR)
    .setAuthor({ name: "Konvert Exchange", iconURL: CONFIG.LOGO_URL || null })
    .setTitle(`${m.label} Exchange`)
    .setDescription(
      `Welcome <@${user.id}>\n\n` +
      `Your ticket has been opened and a **${m.label}** handler has been notified.\n` +
      `Please allow a few minutes for staff to confirm your details.\n\u200b`
    )
    .addFields(
      { name: "Sending",   value: sendLabel,                          inline: true },
      { name: "Receiving", value: receiveLabel,                       inline: true },
      { name: "Fee",       value: `${rate}%  —  ${fmtUSD(feeUSD)}`,  inline: true },
      {
        name:  direction === "send" ? `Your ${m.label} Details` : "Your Receiving Wallet",
        value: `\`${walletInfo}\``,
        inline: false,
      },
    );



  if (notes) ticketEmbed.addFields({ name: "Notes", value: notes, inline: false });

  ticketEmbed
    .setImage(CONFIG.BANNER_URL || null)
    .setTimestamp()
    .setFooter({ text: `Ticket opened  •  Konvert Exchange` });

  // ── Rules embed ──
  const rulesEmbed = new EmbedBuilder()
    .setColor(0xFF4444)
    .setTitle("Important — Please Read")
    .setDescription(
      `**A middleman is required for all trades.**\n` +
      `Do not go first under any circumstances unless **@jswaps** or **@3uce** explicitly says otherwise.\n\n` +
      `**Do not send any funds until your exchanger and a middleman are confirmed.**\n` +
      `If anything looks incorrect, speak up before proceeding.`
    )
    .setFooter({ text: "Konvert Exchange" });

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
      .setFooter({ text: "Konvert Exchange • Verified Trade" });
    if (CONFIG.BANNER_URL) embed.setImage(CONFIG.BANNER_URL);
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
    .setAuthor({ name: "Konvert Exchange", iconURL: CONFIG.LOGO_URL || null })
    .setTitle("✅  Trade Verified")
    .setDescription(`${dirLabel}
​`)
    .addFields(
      { name: "Client",     value: `<@${ticket.userId}>`,                          inline: true },
      { name: "Exchanger",  value: `<@${completedBy.id}>`,                         inline: true },
      { name: "Method",     value: `${m.emoji} ${m.label}`,                        inline: true },
      { name: "Amount",     value: `**${fmtUSD(ticket.amountUSD)}**`,              inline: true },
      { name: "Received",   value: `**${fmtUSD(ticket.amountUSD - ticket.feeUSD)}**`, inline: true },
      { name: "Rating",     value: "⭐⭐⭐⭐⭐",                                  inline: true },
    )
    .setTimestamp()
    .setFooter({ text: "Konvert Exchange  •  Verified Trade" });

  if (CONFIG.BANNER_URL) embed.setImage(CONFIG.BANNER_URL);

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

  // Build clean price rows
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
    `\`${r.coin.padEnd(5)}\`  **$${r.usd}**  ·  CA$${r.cad}  ·  ${r.arrow} ${r.change}%`
  ).join("\n");

  return new EmbedBuilder()
    .setColor(CONFIG.COLOR)
    .setAuthor({ name: "Konvert Exchange", iconURL: CONFIG.LOGO_URL || null })
    .setTitle("Live Rates")
    .setDescription(
      priceLines +
      "\n\u200b"
    )
    .addFields(
      {
        name: "Our Fees",
        value:
          "`Under $150 ` — 9% fiat→crypto  ·  8% crypto→fiat\n" +
          "`$150–$500  ` — 7% fiat→crypto  ·  6% crypto→fiat\n" +
          "`$500–$1000 ` — 6% fiat→crypto  ·  5% crypto→fiat\n" +
          "`$1000+     ` — 5.5% fiat→crypto  ·  4.5% crypto→fiat\n" +
          "`Min fee    ` — **$5 on any deal**",
        inline: false,
      },
      {
        name: "Open a Ticket",
        value: `Head to <#${process.env.EXCHANGE_CHANNEL_ID || CONFIG.TICKET_CATEGORY || ""}> and click **Exchange Now** to get started.`,
        inline: false,
      },
    )
    .setImage(CONFIG.BANNER_URL || null)
    .setFooter({ text: "Rates update every 10 min  •  Konvert Exchange" })
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
                  `\`$0–$150    \` → **9%** fiat→crypto · **8%** crypto→fiat
` +
                  `\`$150–$350  \` → **7%** fiat→crypto · **6%** crypto→fiat
` +
                  `\`$350–$500  \` → **7%** fiat→crypto · **6%** crypto→fiat
` +
                  `\`$500–$1000 \` → **6%** fiat→crypto · **5%** crypto→fiat
` +
                  `\`$1000+     \` → **5.5%** fiat→crypto · **4.5%** crypto→fiat
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
      const isOwner = CONFIG.OWNER_IDS.includes(interaction.user.id);
      const isStaff = CONFIG.STAFF_ROLE ? interaction.member.roles.cache.has(CONFIG.STAFF_ROLE) : false;
      if (!isOwner && !isStaff) {
        return interaction.reply({ content: "❌ Only staff can mark a trade as complete.", ephemeral: true });
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

      // Completion message in ticket
      const m = getMethod(ticket.method);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x00C896)
            .setTitle("✅ Trade Complete!")
            .setDescription(
              `Trade marked complete by <@${interaction.user.id}>.

` +
              `**Client:** <@${ticket.userId}>
` +
              `**Deal:** ${m.emoji} ${m.label} · **${ticket.coin}** · ${fmtUSD(ticket.amountUSD)}
` +
              `**Direction:** ${ticket.direction === "send" ? `Sent ${ticket.coin} → Received ${m.label}` : `Sent ${m.label} → Received ${ticket.coin}`}

` +
              `⭐⭐⭐⭐⭐ vouch has been posted to the vouch channel.

` +
              `This ticket deletes in **15 seconds**.`
            )
            .setTimestamp(),
        ],
      });

      setTimeout(() => interaction.channel.delete().catch(() => {}), 15000);
    }

    // ── 🔒 Close ticket ──
    if (interaction.customId === "btn_close") {
      const tickets = load("tickets");
      const ticket  = tickets[interaction.channel.id];
      if (!ticket) return interaction.reply({ content: "❌ Not a ticket channel.", ephemeral: true });
      if (interaction.user.id !== ticket.userId && !CONFIG.OWNER_IDS.includes(interaction.user.id)) {
        return interaction.reply({ content: "❌ Only the ticket owner or staff can close this.", ephemeral: true });
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
            .setAuthor({ name: "Konvert Exchange", iconURL: CONFIG.LOGO_URL || null })
            .setTitle("Ticket Closed")
            .setDescription("This ticket has been closed.\nTranscript saved. Deleting in 15 seconds.")
            .setTimestamp()
            .setFooter({ text: "Konvert Exchange" }),
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
            .setFooter({ text: "Min fee $5 on any deal • Click Exchange Now to open a ticket" }),
        ],
        ephemeral: true,
      });
    }

    // Amount modal → open ticket
    if (interaction.customId.startsWith("modal_amount__")) {
      await interaction.deferReply({ ephemeral: true });

      const parts     = interaction.customId.split("__"); // modal_amount__METHOD__DIRECTION
      const method    = parts[1];
      const direction = parts[2];

      const rawAmt    = parseFloat(interaction.fields.getTextInputValue("inp_amount"));
      const coin      = interaction.fields.getTextInputValue("inp_coin").toUpperCase().trim();
      const walletInf = interaction.fields.getTextInputValue("inp_wallet").trim();
      const notes     = interaction.fields.getTextInputValue("inp_notes")?.trim() || "";

      if (isNaN(rawAmt) || rawAmt <= 0) {
        return interaction.editReply(`❌ Please enter a valid amount greater than $0.`);
      }
      if (!CONFIG.COINS.includes(coin)) {
        return interaction.editReply(`❌ **${coin}** is not supported.\nSupported: ${CONFIG.COINS.join(", ")}`);
      }
      if (!walletInf) {
        return interaction.editReply("❌ Please enter your wallet or account info.");
      }

      const ch = await createTicket(interaction, method, direction, rawAmt, coin, walletInf, notes);
      if (ch) return interaction.editReply(`✅ Ticket opened! → <#${ch.id}>`);
    }

  }
});


// ════════════════════════════════════════════════════════════════
//  TRANSCRIPT GENERATOR
// ════════════════════════════════════════════════════════════════
async function generateTranscript(channel, ticket) {
  try {
    const messages = await channel.messages.fetch({ limit: 100 });
    const sorted   = [...messages.values()].reverse();
    const m        = getMethod(ticket.method);

    const rows = sorted.map(msg => {
      const time    = new Date(msg.createdTimestamp).toLocaleString("en-US", { timeZone: "America/Toronto" });
      const content = msg.content ? msg.content.replace(/</g,"&lt;").replace(/>/g,"&gt;") : "";
      const embeds  = msg.embeds.map(e =>
        `<div class="embed">` +
        (e.title  ? `<div class="embed-title">${e.title}</div>` : "") +
        (e.description ? `<div class="embed-desc">${e.description.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div>` : "") +
        `</div>`
      ).join("");
      return `
        <div class="msg">
          <img class="avatar" src="${msg.author.displayAvatarURL({ size: 32 })}" onerror="this.style.display='none'"/>
          <div class="msg-body">
            <span class="author">${msg.author.tag}</span>
            <span class="time">${time}</span>
            <div class="content">${content}${embeds}</div>
          </div>
        </div>`;
    }).join("");

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Transcript — ${channel.name}</title>
<style>
  body { background:#1a1a2e; color:#e0e0e0; font-family:sans-serif; margin:0; padding:20px; }
  .header { background:#7C4DFF; padding:20px 24px; border-radius:10px; margin-bottom:20px; }
  .header h1 { margin:0; font-size:18px; }
  .header p  { margin:4px 0 0; opacity:.75; font-size:13px; }
  .msg { display:flex; gap:12px; padding:8px 0; border-bottom:1px solid #2a2a3e; }
  .avatar { width:32px; height:32px; border-radius:50%; flex-shrink:0; }
  .author { font-weight:bold; color:#A78BFA; margin-right:8px; font-size:13px; }
  .time   { color:#666; font-size:11px; }
  .content { margin-top:4px; font-size:13px; white-space:pre-wrap; }
  .embed  { background:#2a2040; border-left:3px solid #7C4DFF; padding:8px 12px; margin-top:6px; border-radius:4px; }
  .embed-title { font-weight:bold; font-size:13px; margin-bottom:4px; }
  .embed-desc  { font-size:12px; opacity:.85; }
</style>
</head>
<body>
<div class="header">
  <h1>Konvert Exchange — Ticket Transcript</h1>
  <p>Channel: #${channel.name} &nbsp;|&nbsp; ${m ? m.label : "Exchange"} &nbsp;|&nbsp; ${ticket.coin} &nbsp;|&nbsp; ${fmtUSD(ticket.amountUSD)} &nbsp;|&nbsp; Client: ${ticket.userTag}</p>
  <p>Generated: ${new Date().toLocaleString("en-US", { timeZone: "America/Toronto" })}</p>
</div>
${rows}
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
    activities: [{ name: "Konvert Exchange", type: 3 }],
    status: "online",
  });
  const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
  if (guild) {
    await autoRates(guild);
    setInterval(() => autoRates(guild), 10 * 60 * 1000);
  }
});

// ─── BOOT ────────────────────────────────────────────────────
registerCommands()
  .then(() => client.login(CONFIG.TOKEN))
  .catch(console.error);
