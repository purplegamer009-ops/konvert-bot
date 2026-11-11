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
const fs   = require("fs");
const path = require("path");
const axios = require("axios");
const { google } = require("googleapis");
const { Pool } = require("pg");

// Which build is running. Shown at the bottom of /ping and printed in the logs, so a deploy that did not go through is easy to spot.
// BOT_BUILD is the first 7 characters of the commit Railway built (it matches the commit on GitHub); it is blank when run anywhere else.
const BOT_VERSION="v18";
const BOT_BUILD=String(process.env.RAILWAY_GIT_COMMIT_SHA||"").slice(0,7);
const BUILD_TEXT=BOT_BUILD?`${BOT_VERSION}  ·  ${BOT_BUILD}`:BOT_VERSION;

// ── POSTGRES ─────────────────────────────────────────────────────────────────
// Connects to Railway Postgres via DATABASE_URL env var.
// Falls back to JSON files if DATABASE_URL is not set (local dev).
const pgPool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

if(pgPool){
  pgPool.on("error", (err) => console.error("[pg] idle client error:", err.message));
}

async function dbQuery(sql, params=[]){
  if(!pgPool) return null;
  try{
    const result = await pgPool.query(sql, params);
    return result;
  }catch(e){
    console.error("[db] query error:", e.message, "| SQL:", sql.slice(0,80));
    return null;
  }
}

async function initDB(){
  if(!pgPool){ console.log("[db] no DATABASE_URL — using JSON fallback"); return; }
  await dbQuery(`CREATE TABLE IF NOT EXISTS kv_store (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  console.log("[db] ✅ Postgres connected and tables ready");
}

// Save any JSON-serialisable value under a key
async function dbSet(key, value){
  if(!pgPool){ return; }
  await dbQuery(
    `INSERT INTO kv_store (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
    [key, JSON.stringify(value)]
  );
}

// Get a value by key — returns the parsed object or null
async function dbGet(key){
  if(!pgPool) return null;
  const r = await dbQuery(`SELECT value FROM kv_store WHERE key = $1`, [key]);
  if(!r || r.rows.length === 0) return null;
  return r.rows[0].value;
}

// Save promos state to Postgres — call after any promo change
async function savePromos(){
  await dbSet("konvert_promos", state.promos).catch(e=>console.error("[savePromos]",e.message));
}

// Save live leaderboard message location — survives restarts
async function saveLiveLb(){
  await dbSet("konvert_live_lb",{messageId:state.liveLbMessageId,channelId:state.liveLbChannelId}).catch(e=>console.error("[saveLiveLb]",e.message));
}

const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID, process.env.YOUTUBE_CLIENT_SECRET, "urn:ietf:wg:oauth:2.0:oob");
oauth2Client.setCredentials({ refresh_token: process.env.YOUTUBE_REFRESH_TOKEN });
const youtube = google.youtube({ version: "v3", auth: oauth2Client });

// The banner on every card and post. It is a file in this repository (assets/konvert-banner.png) served by GitHub, so it can't go missing the way a
// picture on someone else's image host can. A different picture needs a new file name (Discord remembers a picture by its address).
// KONVERT_BANNER_URL points the bot somewhere else. The older BOT_BANNER setting is ignored on purpose: it was the previous banner.
const BANNER_URL="https://raw.githubusercontent.com/purplegamer009-ops/konvert-bot/main/assets/konvert-banner.png?v=1";
const _bannerEnv=String(process.env.KONVERT_BANNER_URL||"").trim();
const BANNER=/^https:\/\/\S+$/i.test(_bannerEnv)?_bannerEnv:BANNER_URL;
// Pictures earlier versions used as the banner: a post that still shows one of them is switched to the new banner when the bot starts (see healBanners)
const OLD_BANNERS=["i.imgur.com/EdIbiik",...(/^https?:\/\//i.test(String(process.env.BOT_BANNER||"").trim())?[String(process.env.BOT_BANNER).trim()]:[])];
const IMG = {
  LOGO:process.env.BOT_LOGO||"https://i.imgur.com/dXKH5Fv.png",
  BANNER,
  RATES:process.env.BOT_LOGO||"https://i.imgur.com/dXKH5Fv.png",
  FEE:process.env.BOT_LOGO||"https://i.imgur.com/dXKH5Fv.png",
  RULES:process.env.BOT_LOGO||"https://i.imgur.com/dXKH5Fv.png",
  TICKET:BANNER,
  WELCOME:BANNER,
  DEAL:BANNER,
};

const PTS_IMG=IMG?.LOGO||"https://i.imgur.com/dXKH5Fv.png";
const SUPPORT_CH="1477230600959299605";

// Owners that can never be removed, frozen, held, flagged, blacklisted or analysed by the safety system
const PERMANENT_OWNER_IDS=["1203760586379370601","1506173494398812220"];

const CONFIG = {
  TOKEN:process.env.DISCORD_TOKEN, CLIENT_ID:process.env.CLIENT_ID, GUILD_ID:process.env.GUILD_ID,
  OWNER_IDS:[...(process.env.OWNER_IDS||"").split(",").map(s=>s.trim()).filter(Boolean),...PERMANENT_OWNER_IDS.filter(id=>!(process.env.OWNER_IDS||"").includes(id))],
  STAFF_ROLE:process.env.STAFF_ROLE_ID||null, EXCHANGER_ROLE:process.env.EXCHANGER_ROLE_ID||null,
  TICKET_CATEGORY:process.env.TICKET_CATEGORY_ID||null, VOUCH_CHANNEL:process.env.VOUCH_CHANNEL_ID||null, HELPER_ROLE:process.env.HELPER_ROLE_ID||null,
  LOG_CHANNEL:process.env.LOG_CHANNEL_ID||null, RATES_CHANNEL:process.env.RATES_CHANNEL_ID||null,
  EXCHANGE_CHANNEL:"1463731676021784587", PASS_ROLE:"1488344770035060786",
  SHORTS_CHANNEL:process.env.SHORTS_CHANNEL_ID||null, MIN_FEE:5, MIN_AMOUNT:6, COLOR:0x7C4DFF,
  ROLES:{
    paypal:process.env.ROLE_PAYPAL,cashapp:process.env.ROLE_CASHAPP,zelle:process.env.ROLE_ZELLE,
    interac:process.env.ROLE_INTERAC,venmo:process.env.ROLE_VENMO,applepay:process.env.ROLE_APPLEPAY,
    skrill:process.env.ROLE_SKRILL,revolut:process.env.ROLE_REVOLUT,upi:process.env.ROLE_UPI,
    chime:process.env.ROLE_CHIME,bank:process.env.ROLE_BANK,iban:process.env.ROLE_IBAN,
    giftcard:process.env.ROLE_GIFTCARD,wire:process.env.ROLE_WIRE,googlepay:process.env.ROLE_GOOGLEPAY,
  },
};

// ── Look & feel ──────────────────────────────────────────────────────────────────────────────────────────────
// One style for every embed, button and message, and no emoji anywhere: the hierarchy comes from type size, spacing and colour.
//   purple = information · green = done / safe · amber = take care · red = a problem · grey = finished
// A card reads top to bottom:  brand line · short title · one big line (the deal, the verdict) · a quiet line under it · details · footer
// Discord only has four button colours (blurple, grey, green, red) and no orange, so a button's colour carries its meaning:
//   blurple = start / the main choice · green = go ahead (Claim, Mark Complete, Confirm) · red = report a problem (Flag Ticket) · grey = everything else (Close, Remind, Cancel)
const UI={brand:CONFIG.COLOR,ok:0x22C55E,warn:0xF59E0B,bad:0xEF4444,mute:0x64748B};
const kAuthor=area=>({name:area?`Konvert Exchange  ·  ${area}`:"Konvert Exchange",iconURL:IMG.LOGO});
const kFoot=text=>({text:text?`Konvert Exchange  ·  ${text}`:"Konvert Exchange"});
function kEmbed(area,tone){return new EmbedBuilder().setColor(UI[tone||"brand"]).setAuthor(kAuthor(area));}
function kBtn(id,label,style){return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);}
function kLink(label,url){return new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url);}
const kHero=text=>`## ${text}`;                    // the one big line of a card
const kNote=text=>`*${text}*`;                     // the quiet line under it
// Label / value rows in a code block: reads like a receipt, lines up on every screen and stays inside a phone's width
function kLedger(rows,minWidth){
  const r=(rows||[]).filter(x=>x&&x[1]!=null&&String(x[1])!=="").map(x=>[String(x[0]),String(x[1]).replace(/`/g,"'")]);
  if(!r.length)return "";
  const w=Math.max(minWidth||30,...r.map(x=>x[0].length+x[1].length+2));
  return "```\n"+r.map(x=>x[0]+" ".repeat(w-x[0].length-x[1].length)+x[1]).join("\n")+"\n```\n";
}
// What people type into an amount box: "250", "$1,250.50", "100 usd" all work; "12,50" (a decimal comma), words, "1e9" and negatives are not amounts
function parseAmount(raw){
  let s=String(raw==null?"":raw).trim().replace(/^\$\s*/,"").replace(/\s*(?:usd|us\$|\$)$/i,"").trim();
  if(/,/.test(s)){if(!/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(s))return NaN;s=s.replace(/,/g,"");}
  if(!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(s))return NaN;
  const n=parseFloat(s);
  return Number.isFinite(n)&&n<=1e9?Math.round(n*100)/100:NaN;
}
// A coin as typed (any coin is accepted), cleaned so it can never carry formatting or links into a card
function cleanCoin(raw){
  const s=String(raw==null?"":raw).normalize("NFKC").replace(/[^A-Za-z0-9 .\/-]/g,"").replace(/\s+/g," ").trim().slice(0,14).trim();
  return s?resolveCoin(s):"";
}
// ── end Look & feel ───────────────────────────────────────────────────────────────────────────────────────────
// ── end Look & feel ───────────────────────────────────────────────────────────────────────────────────────────

const TIERS = [
  { min:100000, label:"Legendary Client", role:"1526741064076099704" },
  { min:75000,  label:"Elite Client",     role:"1526740903803355307" },
  { min:50000,  label:"Diamond Client",   role:"1526740774132256839" },
  { min:35000,  label:"Prestige Client",  role:"1526740529943937124" },
  { min:20000,  label:"Opulent Client",   role:"1514890647436394496" },
  { min:10000, label:"Whale Client",    role:"1483159341899976905" },
  { min:7000,  label:"Godly Client",   role:"1483159233049657550"        },
  { min:5000,  label:"Ethereal Client",role:"1483159184651325622"        },
  { min:3000,  label:"Bear Client",    role:"1483159114782740540"  },
  { min:2000,  label:"Holy Client",    role:"1483159051872375015"  },
  { min:1000,  label:"Zombie Client",  role:"1478413185848709367"  },
  { min:500,   label:"Legend Client",  role:"1478064885161132092"  },
  { min:250,   label:"Tuff Client",    role:"1478412812236623986"  },
  { min:100,   label:"Ghost Client",   role:"1488346819770581002"  },
  { min:10,    label:"Client",         role:"1477752522608480442"        },
  { min:0,     label:"New Client",     role:null },
];
function getTier(v){return TIERS.find(t=>v>=t.min)||TIERS[TIERS.length-1];}
function getNextTier(v){const i=TIERS.findIndex(t=>v>=t.min);return i>0?TIERS[i-1]:null;}
function progressBar(cur,min,max,len=12){
  if(max<=min)return "\u2593".repeat(len)+" MAX";
  const pct=Math.min((cur-min)/(max-min),1),fill=Math.round(pct*len);
  return "\u2593".repeat(fill)+"\u2591".repeat(len-fill)+" "+Math.round(pct*100)+"%";
}
async function applyTierRole(guild,userId,volume){
  try{
    // Fetch fresh member data
    const member=await guild.members.fetch({user:userId,force:true}).catch(()=>null);
    if(!member){console.log(`[tierRole] user ${userId} not in guild`);return;}
    const tier=getTier(volume);

    // Verify bot has Manage Roles permission
    const botMember=await guild.members.fetchMe().catch(()=>null);
    if(botMember&&!botMember.permissions.has("ManageRoles")){
      console.log("[tierRole] ❌ CRITICAL: Bot is missing Manage Roles permission");
      return;
    }

    // Verify the target role exists and bot can manage it
    if(tier.role){
      const roleObj=guild.roles.cache.get(tier.role)||await guild.roles.fetch(tier.role).catch(()=>null);
      if(!roleObj){console.log(`[tierRole] ❌ Role ${tier.role} (${tier.label}) not found in server`);return;}
      if(botMember&&roleObj.position>=botMember.roles.highest.position){
        console.log(`[tierRole] ❌ Bot role is too low to assign ${tier.label} — move bot role ABOVE all tier roles in server settings`);
        return;
      }
    }

    // Build the set of roles the member should have after this update
    // Keep all non-tier roles, remove all tier roles, add correct one
    const tierRoleIds=new Set(TIERS.map(t=>t.role).filter(Boolean));
    const keptRoles=member.roles.cache.filter(r=>!tierRoleIds.has(r.id)).map(r=>r.id);
    const newRoleIds=tier.role?[...keptRoles,tier.role]:keptRoles;

    await member.roles.set(newRoleIds,`Konvert tier update: ${tier.label} (${fmtUSD(volume)})`).catch(e=>{
      console.log(`[tierRole] ❌ roles.set() failed for ${member.user.tag}: ${e.message}`);
    });
    console.log(`[tierRole] ✅ ${member.user.tag} → ${tier.label} (${fmtUSD(volume)})`);
  }catch(e){console.log("[applyTierRole] error:",e.message);}
}

// Runs every hour — syncs ALL members' tier roles based on their current volume
async function syncAllTierRoles(guild){
  try{
    const allTickets=Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets");
    // Get unique userIds who have any trades
    const userIds=[...new Set(Object.values(allTickets).map(t=>t.userId).filter(Boolean))];
    console.log(`[tierSync] syncing ${userIds.length} users...`);
    let synced=0;
    for(const userId of userIds){
      const vol=getUserVolume(userId);
      await applyTierRole(guild,userId,vol).catch(()=>{});
      synced++;
      // Small delay to avoid rate limiting
      if(synced%10===0)await new Promise(r=>setTimeout(r,1000));
    }
    console.log(`[tierSync] done — ${synced} users synced`);
  }catch(e){console.error("[tierSync error]",e.message);}
}

const METHODS=[
  {value:"paypal",label:"PayPal"},{value:"cashapp",label:"Cash App"},{value:"zelle",label:"Zelle"},
  {value:"interac",label:"Interac"},{value:"venmo",label:"Venmo"},{value:"applepay",label:"Apple Pay"},
  {value:"skrill",label:"Skrill"},{value:"revolut",label:"Revolut"},{value:"upi",label:"UPI"},
  {value:"chime",label:"Chime"},{value:"bank",label:"Bank Transfer"},{value:"iban",label:"IBAN / SWIFT"},
  {value:"giftcard",label:"Gift Card"},{value:"wire",label:"Wire Transfer"},
  {value:"googlepay",label:"Google Pay"},
  {value:"buyforyou",label:"Buy For You"},
  {value:"custom",label:"Custom Exchange"},
];
const getMethod=v=>METHODS.find(m=>m.value===v)||null;
// How a payment method reads on any card. An id that is not a payment method (a staff adjustment, a blank) reads "Unknown": a raw id never reaches a client.
const INTERNAL_METHODS=["adjustment","adjustment_deal"];
function methodLabel(id){
  const m=getMethod(id);if(m)return m.label;
  const raw=String(id==null?"":id).trim();
  if(!raw||INTERNAL_METHODS.includes(raw))return "Unknown";
  return raw.charAt(0).toUpperCase()+raw.slice(1).replace(/_/g," ");
}
// The most used payment method or coin among some trades, as {name,n}, or null when the trades do not say. A staff adjustment is not a payment method, so it can never be the top one.
function topOf(list,kind){
  const c={};
  for(const t of list||[]){
    if(!t)continue;
    const k=kind==="coin"?t.coin:(t.method&&!INTERNAL_METHODS.includes(t.method)?t.method:null);
    if(k)c[k]=(c[k]||0)+1;
  }
  const e=Object.entries(c).sort((a,b)=>b[1]-a[1])[0];
  return e?{name:kind==="coin"?String(e[0]):methodLabel(e[0]),n:e[1]}:null;
}
const noTop=list=>(list&&list.length)?"Unknown":"\u2014";      // there are exchanges but they do not say: "Unknown". No exchanges at all: a dash

// ── Several payment methods on one ticket ────────────────────────────────────────────────────────────────────
// A client can open one ticket for up to MAX_TICKET_METHODS payment methods ("Cash App or Venmo"). Exchangers for ANY of them can see and claim it, and
// the exchanger who claims it fixes the method the deal is done in. Until then ticket.methods lists what it accepts (ticket.method is the first of them).
// Gift Card, Buy For You and Custom Exchange are their own flows and are never mixed with another method.
const MAX_TICKET_METHODS=3;
const SOLO_METHODS=["giftcard","buyforyou","custom"];
const isSoloMethod=v=>SOLO_METHODS.includes(v);
const methodIndex=v=>METHODS.findIndex(m=>m.value===v);
// Open to several methods: more than one accepted, and no exchanger has fixed the one in use yet
const isMultiMethod=t=>!!t&&Array.isArray(t.methods)&&t.methods.length>1&&!t.methodLocked;
// What a ticket accepts right now, first choice first
const ticketMethods=t=>isMultiMethod(t)?t.methods.slice():(t&&t.method?[t.method]:[]);
const joinOr=names=>names.length<2?names.join(""):names.slice(0,-1).join(", ")+" or "+names[names.length-1];
const joinAnd=names=>names.length<2?names.join(""):names.slice(0,-1).join(", ")+" and "+names[names.length-1];
// "Cash App / Venmo" (and "Cash App / Venmo +2" past three, which a ticket never has at the moment)
function methodsLabel(list){
  const names=(list||[]).map(methodLabel);
  return names.length>MAX_TICKET_METHODS?`${names.slice(0,2).join(" / ")} +${names.length-2}`:names.join(" / ");
}
// How a ticket's method reads on a card: "Cash App / Venmo" while it accepts several, the one method otherwise
const ticketMethodText=t=>isMultiMethod(t)?methodsLabel(t.methods):methodLabel(t&&t.method);
// What a client picked in the method menu: real payment methods only, in menu order, no repeats, at most MAX_TICKET_METHODS. A solo flow (Gift Card...) only counts on its own.
function pickedMethods(values){
  const all=[...new Set((values||[]).filter(v=>getMethod(v)))];
  const std=all.filter(v=>!isSoloMethod(v));
  return (std.length?std:all.slice(0,1)).sort((a,b)=>methodIndex(a)-methodIndex(b)).slice(0,MAX_TICKET_METHODS);
}
// A method (or several) inside a button or modal id: one method is just its name, as before; several are "m:" and one character each (the method's place in the menu)
const methodCode=v=>methodIndex(v).toString(36);
const methodTag=list=>list.length>1?"m:"+list.map(methodCode).join(""):String(list[0]||"");
function parseMethodTag(tag){
  tag=String(tag||"");
  if(!tag.startsWith("m:"))return tag?[tag]:[];
  const out=[];
  for(const c of tag.slice(2)){const m=METHODS[parseInt(c,36)];if(m&&!isSoloMethod(m.value)&&!out.includes(m.value))out.push(m.value);}
  return out.slice(0,MAX_TICKET_METHODS);
}

const COINS=["BTC","ETH","SOL","LTC","USDT","USDC","XRP","BNB","ADA","DOGE","MATIC","AVAX","DOT","LINK","TRX","SHIB","UNI","ATOM","FTM","NEAR","ARB","OP","MANA","SAND","APE","IMX","GALA","AXS","ENJ","CHZ","FLOW","ICP","HBAR","VET","EOS","ZEC","DASH","XMR","XLM","ALGO","EGLD","THETA","KLAY","ROSE","ONE","CELO","QTUM","ZIL","ICX","ONT","WAVES","BAT","GRT","MKR","AAVE","COMP","SNX","YFI","SUSHI","CRV","1INCH","BAL","BAND","KNC","ZRX","REN","NMR","ANKR","CELR","SKL","STORJ","ORN","OGN","LRC","PERP","DYDX","CAKE","TWT","ALPHA","AUTO","BAKE","BNX","C98","CHESS","MBOX","MDX","SFP","TKO","XVS","BIFI","ELF","FOR","FRONT","HARD","INJ","KAVA","LINA","MITH","NAV","NULS","PAXG","PEARL","QNT","RAY","RSR","RUNE","SRM","STX","TFUEL","VGX","WAXP","WRX","XTZ","ZEN"];
const COIN_NAMES={bitcoin:"BTC",ethereum:"ETH",solana:"SOL",litecoin:"LTC",tether:"USDT","usd coin":"USDC","usdc":"USDC",ripple:"XRP","binance coin":"BNB",cardano:"ADA",dogecoin:"DOGE",polygon:"MATIC",avalanche:"AVAX",polkadot:"DOT",chainlink:"LINK",tron:"TRX","shiba inu":"SHIB",uniswap:"UNI",cosmos:"ATOM",fantom:"FTM","near protocol":"NEAR",near:"NEAR",arbitrum:"ARB",optimism:"OP",decentraland:"MANA",sandbox:"SAND",apecoin:"APE","immutable x":"IMX",gala:"GALA","axie infinity":"AXS",enjin:"ENJ",chiliz:"CHZ",flow:"FLOW","internet computer":"ICP",hedera:"HBAR",vechain:"VET",stellar:"XLM",algorand:"ALGO",elrond:"EGLD",theta:"THETA",klaytn:"KLAY",rose:"ROSE",harmony:"ONE",celo:"CELO",qtum:"QTUM",zilliqa:"ZIL",icon:"ICX",ontology:"ONT",waves:"WAVES","basic attention token":"BAT",bat:"BAT","the graph":"GRT",maker:"MKR",aave:"AAVE",compound:"COMP",synthetix:"SNX","yearn finance":"YFI",sushiswap:"SUSHI",sushi:"SUSHI",curve:"CRV","1inch":"1INCH",balancer:"BAL",band:"BAND",kyber:"KNC","0x":"ZRX",ren:"REN",numerai:"NMR",ankr:"ANKR",celer:"CELR",skale:"SKL",storj:"STORJ",loopring:"LRC",perpetual:"PERP",dydx:"DYDX",pancakeswap:"CAKE",cake:"CAKE",injective:"INJ",kava:"KAVA",stacks:"STX",thorchain:"RUNE",rune:"RUNE",tezos:"XTZ",quant:"QNT","pax gold":"PAXG","horizen":"ZEN","theta fuel":"TFUEL",wazirx:"WRX",wax:"WAXP",eos:"EOS",zcash:"ZEC",dash:"DASH",monero:"XMR"};
function resolveCoin(input){const s=(input||"").trim().toLowerCase();const byName=COIN_NAMES[s];if(byName)return byName;const up=(input||"").trim().toUpperCase();if(COINS.includes(up))return up;return up;}
const GECKO={BTC:"bitcoin",ETH:"ethereum",SOL:"solana",LTC:"litecoin",USDT:"tether",USDC:"usd-coin",XRP:"ripple",BNB:"binancecoin",ADA:"cardano",DOGE:"dogecoin",MATIC:"matic-network",AVAX:"avalanche-2",DOT:"polkadot",LINK:"chainlink",TRX:"tron",SHIB:"shiba-inu",UNI:"uniswap",ATOM:"cosmos",FTM:"fantom",NEAR:"near"};
const COIN_LOGO={POL:"https://assets.coingecko.com/coins/images/4713/large/polygon.png",BTC:"https://assets.coingecko.com/coins/images/1/large/bitcoin.png",ETH:"https://assets.coingecko.com/coins/images/279/large/ethereum.png",SOL:"https://assets.coingecko.com/coins/images/4128/large/solana.png",LTC:"https://assets.coingecko.com/coins/images/2/large/litecoin.png",USDT:"https://assets.coingecko.com/coins/images/325/large/Tether.png",USDC:"https://assets.coingecko.com/coins/images/6319/large/usdc.png",XRP:"https://assets.coingecko.com/coins/images/44/large/xrp-symbol-white-128.png",BNB:"https://assets.coingecko.com/coins/images/825/large/binance-coin-logo.png",ADA:"https://assets.coingecko.com/coins/images/975/large/cardano.png",DOGE:"https://assets.coingecko.com/coins/images/5/large/dogecoin.png"};

// ── PERSISTENT STORAGE ──────────────────────────────────────────────────────
const DATA_DIR=process.env.DATA_DIR||"/tmp";
try{fs.mkdirSync(DATA_DIR,{recursive:true});}catch{}
console.log(`[storage] using ${DATA_DIR}`);
const DB={
  tickets:`${DATA_DIR}/konvert_tickets.json`,
  wallets:`${DATA_DIR}/konvert_wallets.json`,
  blacklist:`${DATA_DIR}/konvert_blacklist.json`,
  referrals:`${DATA_DIR}/konvert_referrals.json`,
  suspensions:`${DATA_DIR}/konvert_suspensions.json`,
  holds:`${DATA_DIR}/konvert_holds.json`,
};
const _mem={tickets:{},wallets:{},blacklist:{},referrals:{},suspensions:{},holds:{}};

const load=k=>{
  // Always return in-memory cache if populated
  if(Object.keys(_mem[k]||{}).length>0)return _mem[k];
  // Try local disk as fast fallback
  try{
    const d=JSON.parse(fs.readFileSync(DB[k],"utf8"));
    if(Object.keys(d).length>0){
      _mem[k]=d;
      console.log(`[load] ${k} from disk cache: ${Object.keys(d).length} entries`);
      return d;
    }
  }catch(e){}
  return {};
};

// Async version that checks Postgres then disk — called at startup
async function loadAsync(k){
  // 1. Try Postgres
  const pgData = await dbGet(`konvert_${k}`);
  if(pgData && Object.keys(pgData).length>0){
    _mem[k]=pgData;
    // Sync to disk cache
    try{fs.writeFileSync(DB[k],JSON.stringify(pgData,null,2));}catch{}
    console.log(`[load] ${k} from Postgres: ${Object.keys(pgData).length} entries`);
    return pgData;
  }
  // 2. Try disk
  try{
    const d=JSON.parse(fs.readFileSync(DB[k],"utf8"));
    if(Object.keys(d).length>0){
      _mem[k]=d;
      // Back-fill Postgres from disk
      await dbSet(`konvert_${k}`, d);
      console.log(`[load] ${k} from disk (migrated to pg): ${Object.keys(d).length} entries`);
      return d;
    }
  }catch(e){}
  return {};
}

const save=(k,d)=>{
  _mem[k]=d;
  // Write to local disk (fallback / cache)
  try{
    fs.writeFileSync(DB[k],JSON.stringify(d,null,2));
  }catch(e){
    console.error(`[save disk ERROR] ${k}: ${e.message}`);
  }
  // Write to Postgres (primary persistent storage)
  dbSet(`konvert_${k}`, d).catch(e=>console.error(`[save pg ERROR] ${k}:`,e.message));
  // Discord backup (secondary redundancy)
  if(k==="tickets"&&process.env.BACKUP_CHANNEL_ID){_backupToDiscord(d).catch(()=>{});}
  if(k==="referrals"&&process.env.BACKUP_CHANNEL_ID){_backupReferralsToDiscord(d).catch(()=>{});}
};

async function _backupToDiscord(data){
  if(!client.isReady()){console.log("[backup] skipped - client not ready");return;}
  if(!process.env.BACKUP_CHANNEL_ID){console.log("[backup] skipped - no BACKUP_CHANNEL_ID");return;}
  try{
    const ch=await client.channels.fetch(process.env.BACKUP_CHANNEL_ID).catch(e=>{console.error("[backup] CANNOT FETCH CHANNEL:",process.env.BACKUP_CHANNEL_ID,"error:",e.message);return null;});
    if(!ch){return;}
    const json=JSON.stringify(data,null,2);
    const buf=Buffer.from(json,"utf8");
    try{const msgs=await ch.messages.fetch({limit:10});for(const m of msgs.values()){if(m.author?.id===client.user.id&&m.attachments.find(a=>a.name==="konvert_tickets.json"))await m.delete().catch(()=>{});}}catch{}
    await ch.send({content:`**Backup** \`${new Date().toISOString()}\` — ${Object.keys(data).length} entries`,files:[{attachment:buf,name:"konvert_tickets.json"}]});
    console.log(`[backup] SUCCESS — ${Object.keys(data).length} tickets`);
  }catch(e){console.error("[backup] FAILED:",e.message);}
}

async function _backupReferralsToDiscord(data){
  if(!client.isReady())return;
  if(!process.env.BACKUP_CHANNEL_ID)return;
  try{
    const ch=await client.channels.fetch(process.env.BACKUP_CHANNEL_ID).catch(()=>null);
    if(!ch)return;
    const json=JSON.stringify(data,null,2);
    const buf=Buffer.from(json,"utf8");
    try{const msgs=await ch.messages.fetch({limit:20});for(const m of msgs.values()){if(m.author?.id===client.user.id&&m.attachments.find(a=>a.name==="konvert_referrals.json"))await m.delete().catch(()=>{});}}catch{}
    await ch.send({content:`**Referral Backup** \`${new Date().toISOString()}\``,files:[{attachment:buf,name:"konvert_referrals.json"}]});
  }catch(e){console.error("[referral backup] FAILED:",e.message);}
}

async function restoreFromDiscord(){
  if(!process.env.BACKUP_CHANNEL_ID)return;
  try{
    const ch=await client.channels.fetch(process.env.BACKUP_CHANNEL_ID).catch(e=>{
      console.error("[restore] cannot fetch backup channel:",e.message);return null;
    });
    if(!ch){console.log("[restore] backup channel not found");return;}
    const msgs=await ch.messages.fetch({limit:50});
    const ticketCandidates=[],refCandidates=[];
    for(const msg of msgs.values()){
      if(msg.attachments.size===0)continue;
      const ta=msg.attachments.find(a=>a.name==="konvert_tickets.json");
      if(ta)ticketCandidates.push({url:ta.url,size:ta.size});
      const ra=msg.attachments.find(a=>a.name==="konvert_referrals.json");
      if(ra)refCandidates.push({url:ra.url,size:ra.size});
    }
    console.log(`[restore] found ${ticketCandidates.length} ticket backups, ${refCandidates.length} referral backups`);
    if(ticketCandidates.length>0){
      ticketCandidates.sort((a,b)=>b.size-a.size);
      try{
        const res=await fetch(ticketCandidates[0].url,{signal:AbortSignal.timeout(15000)});
        if(res.ok){
          const data=await res.json();
          if(Object.keys(data).length>0){
            _mem.tickets=data;
            fs.writeFileSync(DB.tickets,JSON.stringify(data,null,2));
            await dbSet("konvert_tickets",data);
            console.log(`[restore] ✅ tickets: migrated ${Object.keys(data).length} entries to Postgres`);
          }
        }
      }catch(e){console.error("[restore] ticket error:",e.message);}
    }
    if(refCandidates.length>0){
      refCandidates.sort((a,b)=>b.size-a.size);
      try{
        const res=await fetch(refCandidates[0].url,{signal:AbortSignal.timeout(15000)});
        if(res.ok){
          const data=await res.json();
          _mem.referrals=data;
          fs.writeFileSync(DB.referrals,JSON.stringify(data,null,2));
          await dbSet("konvert_referrals",data);
          console.log("[restore] ✅ referrals: migrated to Postgres");
        }
      }catch(e){console.error("[restore] referral error:",e.message);}
    }
    console.log("[restore] Discord migration complete");
  }catch(e){console.error("[restore error]",e.message);}
}

function getReferrals(){
  const r=Object.keys(_mem.referrals||{}).length>0?_mem.referrals:load("referrals");
  if(!r.invites)r.invites={};if(!r.referred)r.referred={};if(!r.points)r.points={};if(!r.inviteCodes)r.inviteCodes={};
  return r;
}
function saveReferrals(data){_mem.referrals=data;save("referrals",data);}

const POINTS_PER_100=5,POINTS_PER_DOLLAR=10,MIN_WITHDRAW_POINTS=50;
function nExchanges(n){n=Number(n)||0;return `${n} exchange${n===1?"":"s"}`;}          // "1 exchange", "2 exchanges"
function calcReferralPoints(amountUSD){return Math.floor((amountUSD/100)*POINTS_PER_100);}
function pointsToDollars(pts){return (pts/POINTS_PER_DOLLAR).toFixed(2);}

async function handleReferralTrade(guild,clientUserId,amountUSD){
  try{
    const referrerId=null;
    if(!referrerId||referrerId===clientUserId)return;
    const _refBL=ref.blacklist||{};
    if(_refBL[referrerId]||_refBL[clientUserId])return;
    const pts=calcReferralPoints(amountUSD);
    if(pts<=0)return;
    if(!ref.points[referrerId])ref.points[referrerId]={balance:0,paid:0,history:[],pendingPayout:false};
    ref.points[referrerId].balance+=pts;
    ref.points[referrerId].history.push({type:"earned",referredUserId:clientUserId,amountUSD,points:pts,at:Date.now()});
    
    try{
      const referrer=await client.users.fetch(referrerId);
      const referred=await client.users.fetch(clientUserId).catch(()=>null);
      const dollarVal="$0.00";
      const newBal=ref.points[referrerId].balance;
      await referrer.send({embeds:[new EmbedBuilder()
        .setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO})
        .setTitle("Points Earned")
        .setDescription(`<@${referrerId}>, an exchange just completed through your referral link.\n\u200b`)
        .addFields(
          {name:"Referred User",value:referred?`<@${referred.id}>`:"A referred client",inline:true},
          {name:"Amount",value:`**${fmtUSD(amountUSD)}**`,inline:true},
          {name:"Points Earned",value:`**+${pts} pts  (+${dollarVal})**`,inline:true},
          {name:"Your Balance",value:`**${newBal} pts**  \u00b7  **${pointsToDollars(newBal)}**`,inline:true},
          {name:"Status",value:newBal>=MIN_WITHDRAW_POINTS?`**Ready to withdraw** \u2014 open a ticket in <#${SUPPORT_CH}>`:`${MIN_WITHDRAW_POINTS-newBal} more pts until withdrawal`,inline:true},
        )
        .setImage(IMG.BANNER).setFooter({text:"Konvert Referral Program  ·  10 pts = $1"}).setTimestamp()]});
    }catch{}
  }catch(e){console.error("[referral exchange error]",e.message);}
}

const fmtUSD=n=>{n=Number(n);if(!Number.isFinite(n)||n===0)return"$0.00";if(n<0)return"-"+fmtUSD(-n);if(n>=1)return`$${n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`;if(n>=0.01)return`$${n.toFixed(4)}`;return`$${n.toFixed(8)}`;};
function calcFee(usd,dir,isVip=false){const red=state.feeMode==="reduced";const base=dir==="receive"?(usd<150?9:usd<350?8:usd<600?7:usd<800?6:5):(red?(usd<150?9:usd<350?8:usd<600?7:usd<800?6:5):(usd<150?10:usd<350?9:usd<600?8:usd<800?7:6));const r=isVip?Math.max(base-0.75,1):base;return Math.max(usd*r/100,CONFIG.MIN_FEE);}
function feeRate(usd,dir,isVip=false){const red=state.feeMode==="reduced";const base=dir==="receive"?(usd<150?9:usd<350?8:usd<600?7:usd<800?6:5):(red?(usd<150?9:usd<350?8:usd<600?7:usd<800?6:5):(usd<150?10:usd<350?9:usd<600?8:usd<800?7:6));return isVip?Math.max(base-0.75,1):base;}
// ── The deal, worded the same way on every card ─────────────────────────────────────────────────────────────────
// direction "send" = the client pays with the method and receives crypto · "receive" = the client sends crypto and is paid through the method.
// An exchange is for at least CONFIG.MIN_AMOUNT ($6), and every exchange pays a fee of at least CONFIG.MIN_FEE ($5): a smaller amount would leave nothing to exchange.
const DEAL_SMALL=CONFIG.MIN_AMOUNT-CONFIG.MIN_FEE;     // below this much left after the fee, what the client gets is agreed in the ticket instead of being quoted (the smallest exchange leaves exactly this)
function meetsMinimum(n){return Number.isFinite(n)&&n>=CONFIG.MIN_AMOUNT;}
const aboveMinimum=meetsMinimum;     // (the name older code and tests use)
const minAmountText=()=>`The minimum amount is **${fmtUSD(CONFIG.MIN_AMOUNT)}**. Every exchange pays a minimum fee of **${fmtUSD(CONFIG.MIN_FEE)}**, so a smaller amount leaves nothing to exchange. Enter ${fmtUSD(CONFIG.MIN_AMOUNT)} or more.`;
const minFeeText=()=>`Minimum amount ${fmtUSD(CONFIG.MIN_AMOUNT)}  ·  Minimum fee ${fmtUSD(CONFIG.MIN_FEE)} per exchange`;
function dealOf(t){
  t=t||{};
  const label=isMultiMethod(t)?methodsLabel(t.methods):(t.method?methodLabel(t.method):"Exchange");
  const amt=Number(t.amountUSD)||0;
  const feeN=(t.feeUSD==null||t.feeUSD==="")?NaN:Number(t.feeUSD);
  const fee=Number.isFinite(feeN)?feeN:null;
  const coin=t.coin||"Crypto";
  const c2c=t.method==="crypto"&&!!t.recvCoin;
  const custom=t.method==="custom"||t.method==="buyforyou";
  const gift=t.method==="giftcard";
  const plain=custom||(!c2c&&t.direction!=="send"&&t.direction!=="receive");     // no direction on the record (a manual or an old one): the amount and the method, nothing either side of an arrow
  let giveName,getName;
  if(c2c){giveName=coin;getName=t.recvCoin;}
  else if(t.direction==="receive"){giveName=coin;getName=label;}
  else{giveName=label;getName=coin;}
  const estimable=!plain&&!gift&&amt>0&&fee!=null;
  const left=estimable?Math.max(amt-fee,0):null;
  const net=left!=null&&left>=DEAL_SMALL?left:null;
  const give=amt>0?`${fmtUSD(amt)} ${giveName}`:giveName;
  const get=net!=null?`${fmtUSD(net)} ${getName}`:getName;
  const hero=plain?(amt>0?`${fmtUSD(amt)} · ${label}`:label):`${give} → ${get}`;
  const verb=c2c?`Swap ${giveName} for ${getName}`:plain?label:(t.direction==="receive"?`Sell ${coin} for ${label}`:`Buy ${coin} with ${label}`);
  const pair=`${giveName} \u2192 ${getName}`;
  return {label,coin,giveName,getName,amount:amt,fee,net,estimable,custom,plain,gift,c2c,give,get,hero,pair,verb,...(isMultiMethod(t)?{multi:true}:{})};
}
// The receipt rows of a deal. opts.rate = the tier % (shown beside the fee) · opts.coinAmt = how much coin that is, when a live price is known · opts.final = a finished deal (no "est.")
function dealRows(d,opts){
  opts=opts||{};
  if(d.plain){                                                           // nothing is quoted on these: custom deals are agreed in the ticket, manual and old records only know what was paid
    const rows=d.amount>0?[["Amount",fmtUSD(d.amount)]]:[];
    if(!d.custom&&d.amount>0&&d.fee!=null)rows.push(["Fee",fmtUSD(d.fee)]);
    return rows;
  }
  const rows=[[opts.final?"You sent":"You send",(d.multi&&d.giveName===d.label&&d.amount>0)?fmtUSD(d.amount):d.give]];
  if(d.gift){rows.push(["Fee","Agreed in ticket"]);return rows;}
  if(d.fee!=null){
    const rate=opts.rate!=null?opts.rate:null,atMin=rate!=null&&d.fee>d.amount*rate/100+0.005;
    rows.push([atMin?"Fee · minimum":(rate!=null?`Fee · ${rate}%`:"Fee"),fmtUSD(d.fee)]);
  }
  if(d.estimable){
    rows.push([opts.final?"You received":"You receive",d.net!=null?((d.multi&&d.getName===d.label)?fmtUSD(d.net):d.get):"To be discussed"]);
    if(opts.coinAmt&&!opts.final&&d.net!=null)rows.push(["Coin amount",`${opts.coinAmt} ${d.getName}`]);        // never next to "To be discussed"
  }
  return rows;
}
// The top of a deal card: the big line, then what kind of deal it is in plain words (and any discount that applies)
function dealHead(d,notes){
  const line=[...(d.plain?[]:[d.verb]),...(notes||[])].join("  ·  ");          // a record that only knows the method already says it in the headline
  return line?`${kHero(d.hero)}\n${kNote(line)}`:kHero(d.hero);
}
// ── end The deal ─────────────────────────────────────────────────────────────────────────────────────────────
async function isDualMember(userId){
  try{
    const g2=client.guilds.cache.get(SECOND_GUILD_ID)||await client.guilds.fetch(SECOND_GUILD_ID).catch(()=>null);
    if(!g2)return false;
    const m=await g2.members.fetch({user:userId,force:false}).catch(()=>null);
    return !!m;
  }catch{return false;}
}
function isVipVolume(vol){return vol>=7000;}
// Wrap any async command handler with a timeout — prevents "thinking" forever
async function withTimeout(interaction,fn,ms=8000){
  let done=false;
  const timer=setTimeout(()=>{
    if(!done&&!interaction.replied&&!interaction.deferred)return;
    if(!done){
      done=true;
      interaction.editReply({content:"Request timed out. Please try again.",embeds:[],components:[]}).catch(()=>{});
    }
  },ms);
  try{
    await fn();
    done=true;
  }catch(e){
    done=true;
    console.error("[withTimeout]",e.message);
    interaction.editReply({content:"Something went wrong. Please try again.",embeds:[],components:[]}).catch(()=>{});
  }finally{
    clearTimeout(timer);
  }
}
const KONV_TAG_ROLE="1526282822468370566";
const SECOND_GUILD_ID="1531692858577518602";
const VOUCH_POST_CHANNEL="1533253002763436072";
const VOUCH_LINK="https://discord.com/channels/1432137319611105375/1533253002763436072";
function isKonvTag(userId,member){try{if(member){const pg=member.user&&member.user.primaryGuild;const hasPG=!!(pg&&pg.identityEnabled&&pg.identityGuildId===CONFIG.GUILD_ID);return !!(member.roles&&member.roles.cache&&member.roles.cache.has(KONV_TAG_ROLE))||hasPG;}}catch{}return !!(state.konvTagUsers&&state.konvTagUsers.has(userId));}
const OWNER_ROLE="1477857207600152608";
// Owner = in OWNER_IDS list OR holding the owner role
function isOwner(userId,member){
  try{
    if(PERMANENT_OWNER_IDS.includes(userId)||CONFIG.OWNER_IDS.includes(userId))return true;
    if(member&&member.roles&&member.roles.cache&&member.roles.cache.has(OWNER_ROLE))return true;
  }catch{}
  return false;
}
// ── Profit sharing ───────────────────────────────────────────
const OWNER_PROFIT_SHARE=0.40;                      // the owner's cut of every exchanger's profit
const PROFIT_REPLY_WINDOW_MS=24*60*60*1000;         // how long an exchanger has to respond before the owner is told they didn't
const PROFIT_J_ID="1506173494398812220";            // always gets the profit-split notices, whatever PROFIT_DM_IDS says
const _idList=v=>String(v||"").split(/[\s,;]+/).map(x=>x.replace(/[<@!>]/g,"")).filter(Boolean);
// Who is told about splits: PROFIT_DM_IDS (default: Haq) and always J, so a stale or mistyped env value can never leave him out
const PROFIT_DM_IDS=[...new Set([...(_idList(process.env.PROFIT_DM_IDS).length?_idList(process.env.PROFIT_DM_IDS):["1203760586379370601"]),PROFIT_J_ID])];
// Nobody owes a split to themselves: J (the one being paid) and anyone in PROFIT_EXEMPT_IDS are never asked. Every other exchanger, owners included, is.
const PROFIT_EXEMPT_IDS=[...new Set([..._idList(process.env.PROFIT_EXEMPT_IDS),PROFIT_J_ID])];
const PROFIT_LOG_CHANNEL=process.env.PROFIT_LOG_CHANNEL_ID||CONFIG.LOG_CHANNEL||null;   // where a notice goes when someone's DMs are closed
const PROFIT_PAYEE=process.env.PROFIT_PAYEE||"J (@jsballing)";   // who exchangers are told to pay
const _sharePct=Math.round(OWNER_PROFIT_SHARE*100);
const _r2=n=>Math.round(Number(n)*100)/100;
const ownerCut=profit=>Math.round(Math.round(Number(profit)*100)*OWNER_PROFIT_SHARE)/100;
const defaultProfit=t=>_r2(ticketFee(t));           // unless they say otherwise, the profit is the fee the client was charged

function _dealLine(t){return dealOf({...t,feeUSD:ticketFee(t)}).hero;}          // "$100.00 Interac → $90.00 ETH"
function profitRequestEmbed(t){
  return new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO})
    .setTitle("Deal Complete")
    .setDescription(`${kHero(_dealLine(t))}\nFee charged to client: **${fmtUSD(t.profitDefault)}**\nYou owe **${PROFIT_PAYEE}** ${_sharePct}%: **${fmtUSD(t.profitDefaultCut)}**\n\nConfirm the split, or enter your actual profit if it was different.`)
    .setFooter({text:"Konvert Exchange  ·  Please respond within 24 hours"}).setTimestamp();
}
function profitButtonRow(ticketId){
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`btn_profitok__${ticketId}`).setLabel("Confirm Split").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`btn_profit__${ticketId}`).setLabel("Different Profit").setStyle(ButtonStyle.Secondary));
}
function ownerProfitEmbed(t,late){
  const profitText=t.profitConfirmedDefault?`**${fmtUSD(t.profitAmount)}** (confirmed)`:`**${fmtUSD(t.profitAmount)}** (changed from ${fmtUSD(t.profitDefault)})`;
  return new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange  ·  Profit Share",iconURL:IMG.LOGO})
    .setTitle(`Owed: ${fmtUSD(t.ownerCut)}`)
    .setDescription(`${kHero(_dealLine(t))}\n<@${t.completedBy}> with client <@${t.userId}>\nProfit ${profitText} \u2192 your ${_sharePct}%${late?" \u00b7 reported late":""}`)
    .setTimestamp();
}
function noReplyEmbed(t){
  return new EmbedBuilder().setColor(0xef4444).setAuthor({name:"Konvert Exchange  ·  Profit Share",iconURL:IMG.LOGO})
    .setTitle("No Response")
    .setDescription(`${kHero(_dealLine(t))}\n<@${t.completedBy}> hasn't confirmed the split for this deal.\nExpected: **${fmtUSD(t.profitDefaultCut)}** (${_sharePct}% of the ${fmtUSD(t.profitDefault)} fee).`)
    .setFooter({text:"Konvert Exchange  ·  They can still respond \u2014 you'll get a DM"}).setTimestamp();
}
function dmFailedEmbed(t){
  return new EmbedBuilder().setColor(0xef4444).setAuthor({name:"Konvert Exchange  ·  Profit Share",iconURL:IMG.LOGO})
    .setTitle("Couldn't DM Exchanger")
    .setDescription(`${kHero(_dealLine(t))}\n<@${t.completedBy}>'s DMs are closed, so the split wasn't delivered.\nExpected: **${fmtUSD(t.profitDefaultCut)}** (${_sharePct}% of the ${fmtUSD(t.profitDefault)} fee).`)
    .setTimestamp();
}
function profitTestEmbed(){
  return new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange  ·  Profit Share",iconURL:IMG.LOGO})
    .setTitle("Test: profit notices reach you").setDescription("This is only a test. Real notices arrive here when an exchanger confirms a split.").setTimestamp();
}
function _homeGuild(){
  try{const c=client.guilds.cache;return (CONFIG.GUILD_ID&&c.get(CONFIG.GUILD_ID))||c.first()||null;}catch{return null;}
}
// DMs every recipient in PROFIT_DM_IDS. Someone who can't be DMed (closed DMs, ...) is written to the console with the reason and gets the notice in
// the log channel instead, with an @mention, so a split can never silently go missing. Resolves to {sent:[ids], failed:[{id,reason}]}.
async function notifyProfitOwners(embed,{test=false}={}){
  const sent=[],failed=[];
  await Promise.all(PROFIT_DM_IDS.map(async id=>{
    try{const u=await client.users.fetch(id);await u.send({embeds:[embed]});sent.push(id);}
    catch(e){const reason=(e&&e.message)||String(e);failed.push({id,reason});console.error("[profit] couldn't DM",id+":",reason);}
  }));
  if(failed.length&&!test)await profitFallback(embed,failed);
  return {sent,failed};
}
async function profitFallback(embed,failed){
  try{
    const guild=_homeGuild();
    const ch=guild&&PROFIT_LOG_CHANNEL?guild.channels.cache.get(PROFIT_LOG_CHANNEL):null;
    if(!ch)return false;
    await ch.send({content:`${failed.map(f=>`<@${f.id}>`).join(" ")} — I couldn't DM you this profit notice (check your DM settings for this server), so it is here instead:`,embeds:[embed],allowedMentions:{users:failed.map(f=>f.id)}});
    return true;
  }catch(e){console.error("[profit] fallback post failed:",e.message);return false;}
}
// Called once a deal is finalized: asks the exchanger who was credited to confirm the split
async function requestProfit(guild,ticketId,channelName){
  const t=(_mem.tickets||{})[ticketId];
  if(!t||!t.completedBy||t.profitRequestedAt)return;                 // nobody to ask, or already asked
  const exId=t.completedBy,where=`#${channelName||ticketId}`;
  if(PROFIT_EXEMPT_IDS.includes(exId)){log(guild,`PROFIT: ${where} | ${exId} is the one being paid, so no split is asked`);return;}
  t.profitRequestedAt=Date.now();t.profitChannelName=channelName||null;
  t.profitDefault=defaultProfit(t);t.profitDefaultCut=ownerCut(t.profitDefault);
  save("tickets",_mem.tickets);
  let delivered=false,why="";
  try{
    const u=await client.users.fetch(exId);
    await u.send({embeds:[profitRequestEmbed(t)],components:[profitButtonRow(ticketId)]});
    delivered=true;
  }catch(e){why=(e&&e.message)||String(e);console.error("[profit] couldn't DM exchanger",exId+":",why);}
  if(delivered){log(guild,`PROFIT: ${where} | split asked of ${exId} | fee ${fmtUSD(t.profitDefault)} | owed ${fmtUSD(t.profitDefaultCut)}`);return;}
  // Closed DMs: tell the owners right away instead of waiting out the 24 hours
  t.profitDmFailed=true;t.profitOwnerNotified=true;
  save("tickets",_mem.tickets);
  log(guild,`PROFIT: ${where} | couldn't DM exchanger ${exId} (${why}) | owners told`);
  await notifyProfitOwners(dmFailedEmbed(t));
}
// Saves the final number, shows the exchanger their receipt, DMs the owner
async function recordProfit(interaction,t,profit){
  const late=!!t.profitOwnerNotified;                                 // the owner was already told they hadn't replied
  t.profitAmount=_r2(profit);
  t.ownerCut=ownerCut(profit);
  t.profitConfirmedDefault=t.profitAmount===_r2(t.profitDefault);
  t.profitReportedAt=Date.now();
  save("tickets",_mem.tickets);
  const done=new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO}).setTitle("Split Recorded")
    .setDescription(`Profit **${fmtUSD(t.profitAmount)}** \u2192 you owe **${PROFIT_PAYEE}** **${fmtUSD(t.ownerCut)}**.`)
    .setFooter({text:"Konvert Exchange  ·  Thanks \u2014 the owner has been notified"}).setTimestamp();
  const canUpdate=(typeof interaction.isButton==="function"&&interaction.isButton())||(typeof interaction.isFromMessage==="function"&&interaction.isFromMessage());
  if(canUpdate)await interaction.update({embeds:[done],components:[]}).catch(()=>{});
  else await interaction.reply({embeds:[done],flags:64}).catch(()=>{});
  const r=await notifyProfitOwners(ownerProfitEmbed(t,late));
  log(_homeGuild(),`PROFIT: ${t.profitChannelName?"#"+t.profitChannelName+" | ":""}${t.completedBy} reported ${fmtUSD(t.profitAmount)}${late?" (late)":""} | owed ${fmtUSD(t.ownerCut)} | told ${r.sent.length}/${PROFIT_DM_IDS.length}`);
}
// "Confirm Split": accept the default (40% of the fee)
async function confirmProfitSplit(interaction){
  const tid=interaction.customId.slice("btn_profitok__".length);
  const t=(_mem.tickets||{})[tid];
  if(!t||t.completedBy!==interaction.user.id)return interaction.reply({content:"This isn't your deal to confirm.",flags:64});
  if(t.profitReportedAt)return interaction.reply({content:"You already confirmed this deal.",flags:64});
  return recordProfit(interaction,t,t.profitDefault);
}
// "Different Profit": open the form
async function openProfitModal(interaction){
  const tid=interaction.customId.slice("btn_profit__".length);
  const t=(_mem.tickets||{})[tid];
  if(!t||t.completedBy!==interaction.user.id)return interaction.reply({content:"This isn't your deal to report.",flags:64});
  if(t.profitReportedAt)return interaction.reply({content:"You already confirmed this deal.",flags:64});
  const modal=new ModalBuilder().setCustomId(`modal_profit__${tid}`).setTitle("Actual Profit");
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId("inp_profit").setLabel("Profit on this deal (USD)").setStyle(TextInputStyle.Short)
      .setPlaceholder("e.g. 12.50  \u2014  enter 0 if none").setMinLength(1).setMaxLength(12).setRequired(true)));
  return interaction.showModal(modal);
}
async function submitProfit(interaction){
  const tid=interaction.customId.slice("modal_profit__".length);
  const t=(_mem.tickets||{})[tid];
  if(!t||t.completedBy!==interaction.user.id)return interaction.reply({content:"This isn't your deal to report.",flags:64});
  if(t.profitReportedAt)return interaction.reply({content:"You already confirmed this deal.",flags:64});
  const raw=String(interaction.fields.getTextInputValue("inp_profit")||"").replace(/[$,\s]/g,"");
  const profit=Number(raw);
  const deal=parseFloat(t.amountUSD)||0;
  if(raw===""||!Number.isFinite(profit)||profit<0)
    return interaction.reply({content:"Enter a number like **12.50** \u2014 or **0** if you made nothing. Press the button to try again.",flags:64});
  if(profit>deal+0.005)
    return interaction.reply({content:`That's more than the whole deal (${fmtUSD(deal)}). Check the number and press the button to try again.`,flags:64});
  return recordProfit(interaction,t,profit);
}
// Runs every 10 minutes (and once at startup): tells the owner about exchangers who never responded
let _profitSweepRunning=false;
async function sweepProfitReplies(){
  if(_profitSweepRunning)return;
  _profitSweepRunning=true;
  try{
    const now=Date.now(),due=[];
    for(const t of Object.values(_mem.tickets||{})){
      if(!t||!t.profitRequestedAt||t.profitReportedAt||t.profitOwnerNotified)continue;
      if(now-t.profitRequestedAt<PROFIT_REPLY_WINDOW_MS)continue;
      t.profitOwnerNotified=true;due.push(t);
    }
    if(!due.length)return;
    save("tickets",_mem.tickets);                                     // flag first, so a slow DM can never cause a duplicate
    for(const t of due)await notifyProfitOwners(noReplyEmbed(t));
  }finally{_profitSweepRunning=false;}
}
// ── end profit sharing ──

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════
// v16: Konvert's built-in server middleman bot -- run by this bot inside the ticket
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════
// When an exchange needs a middleman, the crypto side of it is sent to the middleman wallet, the bot checks the payment on the blockchain itself,
// the other side pays, and the crypto is then released to whoever it belongs to (or refunded). Nobody has to leave the ticket or trust another server.
//
// How it stays safe:
//   * A deposit only counts when the bot has read it on-chain: right coin, right network, sent to the middleman address, not failed, confirmed, and
//     for exactly the amount this deal was asked to send. Every deal is asked for a slightly different amount (a tiny "tag" in the last digits), so a
//     payment can only ever belong to one deal. Anything that does not match exactly goes to an owner to check; it is never guessed.
//   * A transaction ID can be used once, for one deal, ever (a row in Postgres that can only be inserted once).
//   * Funds only leave on Release (pressed by the person who deposited, after they were paid), on Refund (pressed by the other side), or by an owner.
//     A deal is marked "sending" in Postgres BEFORE anything is signed, and the signed transaction is stored BEFORE it is broadcast, so a restart, a
//     double tap or two copies of the bot running during a redeploy can never pay twice: the same signed transaction is simply sent again.
//   * Before every send the wallet is checked against everything it is holding for other deals, so one deal can never be paid with another deal's funds.
//   * The keys never leave the server: they are read from Railway variables (MM_EVM_KEY / MM_SOL_KEY), or made by the bot itself and kept in Postgres.
//     They are never logged, never put in a ticket, never backed up to a channel. ethers signs offline; every network call is plain JSON-RPC.
//   * Bitcoin and Litecoin are watch-only: the bot checks deposits to the address an owner sets, and an owner sends the release by hand.
//   * Whatever the bot cannot do or is not sure about (a coin it does not hold, a price it cannot get, a deal over the limit, a node that is down)
//     falls back to an owner acting as middleman in the ticket, and every card has a Help menu (and "$mm help") that pings the owners.
const crypto=require("crypto");
class MmError extends Error{constructor(code,message,extra){super(message||code);this.code=code;Object.assign(this,extra||{});}}
// Tunables (let, so the tests can shorten them)
let MM_QUOTE_MS=30*60*1000,          // how long the asked amount stands before it is worked out again from a fresh price
    MM_OPEN_MS=24*60*60*1000,        // a deal nobody has paid into after this long is cancelled (the ticket stays; a deal that holds funds never is)
    MM_WATCH_MS=30*60*1000,          // a submitted transaction the network cannot see yet is looked for again for this long
    MM_EARLY_MS=5*60*1000,           // a payment mined more than this long BEFORE the deal showed its address is not this deal's
    MM_LATE_MS=60*60*1000,           // a payment for an older quote of the same deal still counts when it was mined within this long of that quote's end
    MM_SWEEP_MS=20*1000,MM_RPC_MS=8000,MM_SEND_WAIT_MS=75*1000,MM_POLL_MS=2500,MM_LOCK_WAIT_MS=45*1000,
    MM_FAST_MS=5*1000,               // while a deal waits for its deposit everything is looked at this often (otherwise every MM_SWEEP_MS)
    MM_IDLE_REMIND_MS=30*60*1000,    // both sides are reminded after this long with no deposit
    MM_REBROADCAST_MS=30*60*1000,    // a sent transaction that still has not landed after this long is handed to an owner
    MM_HELP_COOLDOWN_MS=3*60*1000,MM_DEFAULT_MAX_USD=1000,MM_MIN_USD=1;
let MM_SCAN_BLOCKS=120,              // most blocks of one network read in a single pass when looking for native-coin deposits
    MM_LOG_RANGE=2000,               // blocks per token-transfer question
    MM_LOG_BACK_MAX=20000,           // how far back a first look goes at most
    MM_SCAN_SLACK_MS=60*1000,        // a payment mined this long before a deal showed its address is still looked at (clocks differ a little)
    MM_SCAN_SAVE_MS=60*1000,         // how often the place where scanning stopped is saved (so a restart carries on from there)
    MM_ASK_MS=15*60*1000,            // whoever has to paste an address is reminded after this long (then every six hours)
    MM_RETRY_MS=2*60*1000,           // after five failed tries in a row a payout is tried again this often, by itself, until it goes through
    MM_PAY_TRIES=5,MM_PAY_GAP_MS=20*1000,   // a payout that fails is tried again every 20 seconds, five times, and then the owners are told
    MM_FULL_PCT=1,                   // a deposit within this many percent of the asked amount counts as the full amount
    MM_MATCH_PCT=2,                  // with several deals waiting on one address, a deposit goes to the one whose asked amount it is within this many percent of
    MM_DUST_PCT=1,                   // a payment under this percent of every asked amount is too small to be a deposit
    MM_NODE_SLOW_MS=2*60*1000,       // the card says "network is slow" once the nodes have failed for this long
    MM_SCAN_GAP_MS=90*1000,          // when nobody has looked at an address for this long, the next look reads its history again (an unchanged balance proves nothing after a quiet time)
    MM_REASK_MS=60*1000;             // pressing Release or Refund again asks for the address again at most this often

// ── Networks and coins ─────────────────────────────────────────────────────────────────────────────────────
// confs = confirmations before a deposit counts · feeMult = cushion on the network fee taken out of a native-coin release (num/den)
const MM_CHAINS={
  eth:{key:"eth",name:"Ethereum",short:"ERC20",family:"evm",chainId:1,native:"ETH",decimals:18,confs:5,blockSec:12,type2:true,feeMult:[5,4],
       rpcs:["https://ethereum-rpc.publicnode.com","https://eth.llamarpc.com","https://cloudflare-eth.com"],tx:"https://etherscan.io/tx/"},
  bsc:{key:"bsc",name:"BNB Chain",short:"BEP20",family:"evm",chainId:56,native:"BNB",decimals:18,confs:15,blockSec:0.5,feeMult:[1,1],
       rpcs:["https://bsc-dataseed.binance.org","https://bsc-rpc.publicnode.com","https://bsc-dataseed1.defibit.io"],tx:"https://bscscan.com/tx/"},
  base:{key:"base",name:"Base",short:"Base",family:"evm",chainId:8453,native:"ETH",decimals:18,confs:20,blockSec:2,feeMult:[3,1],
       rpcs:["https://mainnet.base.org","https://base-rpc.publicnode.com","https://base.llamarpc.com"],tx:"https://basescan.org/tx/"},
  arb:{key:"arb",name:"Arbitrum",short:"Arbitrum",family:"evm",chainId:42161,native:"ETH",decimals:18,confs:40,blockSec:0.25,feeMult:[1,1],
       rpcs:["https://arb1.arbitrum.io/rpc","https://arbitrum-one-rpc.publicnode.com"],tx:"https://arbiscan.io/tx/"},
  pol:{key:"pol",name:"Polygon",short:"Polygon",family:"evm",chainId:137,native:"POL",decimals:18,confs:60,blockSec:2,feeMult:[1,1],
       rpcs:["https://polygon-bor-rpc.publicnode.com","https://polygon-rpc.com","https://polygon.llamarpc.com"],tx:"https://polygonscan.com/tx/"},
  sol:{key:"sol",name:"Solana",short:"Solana",family:"sol",native:"SOL",decimals:9,confs:1,
       rpcs:["https://api.mainnet-beta.solana.com","https://solana-rpc.publicnode.com"],tx:"https://solscan.io/tx/"},
  btc:{key:"btc",name:"Bitcoin",short:"Bitcoin",family:"utxo",native:"BTC",decimals:8,confs:1,
       rpcs:["https://mempool.space/api","https://blockstream.info/api"],tx:"https://mempool.space/tx/"},
  ltc:{key:"ltc",name:"Litecoin",short:"Litecoin",family:"utxo",native:"LTC",decimals:8,confs:2,
       rpcs:["https://litecoinspace.org/api"],tx:"https://litecoinspace.org/tx/"},
};
// A token is only ever recognised by its contract address (all lowercase here), never by its name.
const MM_ASSETS=[
  {coin:"ETH",chain:"eth",contract:null,decimals:18},{coin:"ETH",chain:"base",contract:null,decimals:18},{coin:"ETH",chain:"arb",contract:null,decimals:18},
  {coin:"BNB",chain:"bsc",contract:null,decimals:18},{coin:"POL",chain:"pol",contract:null,decimals:18},{coin:"SOL",chain:"sol",contract:null,decimals:9},
  {coin:"BTC",chain:"btc",contract:null,decimals:8},{coin:"LTC",chain:"ltc",contract:null,decimals:8},
  {coin:"USDT",chain:"bsc",contract:"0x55d398326f99059ff775485246999027b3197955",decimals:18},
  {coin:"USDT",chain:"eth",contract:"0xdac17f958d2ee523a2206206994597c13d831ec7",decimals:6},
  {coin:"USDT",chain:"arb",contract:"0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9",decimals:6},
  {coin:"USDT",chain:"pol",contract:"0xc2132d05d31c914a87c6611c10748aeb04b58e8f",decimals:6},
  {coin:"USDC",chain:"bsc",contract:"0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",decimals:18},
  {coin:"USDC",chain:"eth",contract:"0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",decimals:6},
  {coin:"USDC",chain:"base",contract:"0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",decimals:6},
  {coin:"USDC",chain:"arb",contract:"0xaf88d065e77c8cc2239327c5edb3a432268e5831",decimals:6},
  {coin:"USDC",chain:"pol",contract:"0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",decimals:6},
];
const mmAssetKey=a=>`${a.chain}:${a.contract||"native"}`;
const mmAsset=(coin,chain)=>MM_ASSETS.find(a=>a.coin===coin&&a.chain===chain)||null;
const mmCoinOf=c=>{const s=String(c||"").trim().toUpperCase();return CANON[s]||s;};
const mmNetLabel=a=>a.contract?`${MM_CHAINS[a.chain].name} (${MM_CHAINS[a.chain].short})`:MM_CHAINS[a.chain].name;
const MM_TRANSFER_TOPIC="0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// ── Signing library (only ethers; Solana is signed with Node's own ed25519) ───────────────────────────────
let _mmLibs;
function mmLibs(){
  if(_mmLibs!==undefined)return _mmLibs;
  try{_mmLibs={ethers:require("ethers")};}
  catch(e){_mmLibs=null;console.error(`[mm] ethers is not installed (${String(e.message).split("\n")[0]}): Ethereum-family middleman deals go to an owner until package.json is deployed`);}
  return _mmLibs;
}

// ── Amounts: always whole base units (wei, lamports, satoshi...) as BigInt; kept as strings when stored ─────
const mmPow10=n=>10n**BigInt(n);
function mmFmtUnits(raw,dec,dp){
  let v=BigInt(raw);const neg=v<0n;if(neg)v=-v;
  const s=v.toString().padStart(dec+1,"0"),whole=s.slice(0,s.length-dec);
  let frac=dec?s.slice(s.length-dec):"";
  frac=dp!=null?frac.slice(0,dp).padEnd(dp,"0"):frac.replace(/0+$/,"");
  return (neg?"-":"")+whole+(frac?"."+frac:"");
}
function mmParseUnits(text,dec){
  const m=String(text==null?"":text).trim().replace(/,/g,"").match(/^(\d{1,30})(?:\.(\d+))?$/);
  if(!m)return null;
  const f=m[2]||"";
  if(f.length>dec&&/[1-9]/.test(f.slice(dec)))return null;        // more precision than the coin has
  return BigInt(m[1])*mmPow10(dec)+BigInt(f.slice(0,dec).padEnd(dec,"0")||"0");
}
// How many decimals an asked amount is shown with: fine enough that one step is a fraction of a cent, coarse enough that any wallet or exchange can send it
function mmDisplayDp(asset,price){
  if(STABLE.has(asset.coin))return Math.min(4,asset.decimals);
  const d=Math.ceil(Math.log10(price))+3;
  return Math.max(2,Math.min(d,asset.decimals,8));
}
// usd / price, rounded UP to the display step, plus `tag` steps
function mmNeedRaw(usd,price,asset,dp,tag){
  const cents=BigInt(Math.round(usd*100)),pE8=BigInt(Math.round(price*1e8));
  if(cents<=0n||pE8<=0n)throw new MmError("price","no usable price");
  const tick=mmPow10(asset.decimals-dp),num=cents*mmPow10(asset.decimals)*1000000n;
  let raw=num/pE8;if(num%pE8)raw+=1n;
  raw=((raw+tick-1n)/tick)*tick;
  return raw+BigInt(tag)*tick;
}

// ── Addresses and transaction IDs ───────────────────────────────────────────────────────────────────────────
const MM_B58="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function mmB58Enc(bytes){
  let n=0n;for(const b of bytes)n=(n<<8n)|BigInt(b);
  let out="";while(n>0n){out=MM_B58[Number(n%58n)]+out;n/=58n;}
  for(const b of bytes){if(b===0)out="1"+out;else break;}
  return out;
}
function mmB58Dec(text){
  let n=0n;
  for(const c of String(text)){const i=MM_B58.indexOf(c);if(i<0)throw new Error("not base58");n=n*58n+BigInt(i);}
  const bytes=[];while(n>0n){bytes.unshift(Number(n&255n));n>>=8n;}
  let zeros=0;for(const c of String(text)){if(c==="1")zeros++;else break;}
  return Buffer.from([...new Array(zeros).fill(0),...bytes]);
}
const _mmSha256=b=>crypto.createHash("sha256").update(b).digest();
// Base58Check (Bitcoin / Litecoin legacy addresses): {version,payload} or null
function mmB58Check(text){
  try{
    const raw=mmB58Dec(text);if(raw.length!==25)return null;
    const body=raw.subarray(0,21),sum=_mmSha256(_mmSha256(body)).subarray(0,4);
    if(!sum.equals(raw.subarray(21)))return null;
    return {version:body[0],payload:body.subarray(1)};
  }catch{return null;}
}
// Bech32 / Bech32m (BIP173 / BIP350): {hrp,version,program} or null
const MM_BECH="qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function _mmBechPolymod(values){
  const G=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];let chk=1;
  for(const v of values){const top=chk>>>25;chk=((chk&0x1ffffff)<<5)^v;for(let i=0;i<5;i++)if((top>>>i)&1)chk^=G[i];}
  return chk>>>0;
}
function mmBech32(text){
  const s=String(text||"");
  if(s.length<14||s.length>90||(s!==s.toLowerCase()&&s!==s.toUpperCase()))return null;
  const low=s.toLowerCase(),pos=low.lastIndexOf("1");
  if(pos<1||pos+7>low.length)return null;
  const hrp=low.slice(0,pos),data=[];
  for(const c of low.slice(pos+1)){const i=MM_BECH.indexOf(c);if(i<0)return null;data.push(i);}
  const exp=[...hrp].map(c=>c.charCodeAt(0)>>5).concat([0],[...hrp].map(c=>c.charCodeAt(0)&31));
  const pm=_mmBechPolymod(exp.concat(data)),enc=pm===1?"bech32":pm===0x2bc830a3?"bech32m":null;
  if(!enc)return null;
  const version=data[0],body=data.slice(1,-6);
  let acc=0,bits=0;const prog=[];
  for(const v of body){acc=(acc<<5)|v;bits+=5;while(bits>=8){bits-=8;prog.push((acc>>bits)&255);}}
  if(bits>=5||((acc<<(8-bits))&255))return null;                  // bad padding
  if(version>16||prog.length<2||prog.length>40)return null;
  if(version===0&&(enc!=="bech32"||(prog.length!==20&&prog.length!==32)))return null;
  if(version>0&&enc!=="bech32m")return null;
  return {hrp,version,program:Buffer.from(prog)};
}
// Is this 32-byte value a real ed25519 public key (a point on the curve)? Rejects typos and program-owned addresses nobody can sign for.
const MM_ED_P=(1n<<255n)-19n,MM_ED_D=37095705934669439343138083508754565189542113879843219016388785533085940283555n;
function _mmModPow(base,exp,mod){let r=1n,b=base%mod,e=exp;while(e>0n){if(e&1n)r=(r*b)%mod;b=(b*b)%mod;e>>=1n;}return r;}
function mmOnCurve(bytes32){
  const b=Buffer.from(bytes32);if(b.length!==32)return false;
  const sign=(b[31]&0x80)!==0;b[31]&=0x7f;
  let y=0n;for(let i=31;i>=0;i--)y=(y<<8n)|BigInt(b[i]);
  if(y>=MM_ED_P)return false;
  const y2=(y*y)%MM_ED_P,u=(y2+MM_ED_P-1n)%MM_ED_P,v=(MM_ED_D*y2+1n)%MM_ED_P;
  const x2=(u*_mmModPow(v,MM_ED_P-2n,MM_ED_P))%MM_ED_P;
  if(x2===0n)return !sign;
  return _mmModPow(x2,(MM_ED_P-1n)/2n,MM_ED_P)===1n;
}
// The address as it should be stored for this network, or null when it is not a valid one
function mmNormAddress(chainKey,raw){
  const chain=MM_CHAINS[chainKey],text=String(raw==null?"":raw).trim();
  if(!chain||!text||/\s/.test(text))return null;
  if(chain.family==="evm"){
    if(!/^0x[0-9a-fA-F]{40}$/.test(text)||/^0x0{40}$/i.test(text))return null;
    const libs=mmLibs();
    if(!libs)return /^0x[0-9a-f]{40}$/.test(text)?text:null;       // without the library a mixed-case checksum cannot be checked, so only plain lowercase is taken
    try{return libs.ethers.getAddress(text);}catch{return null;}  // a wrong mixed-case checksum is a typo
  }
  if(chain.family==="sol"){
    try{const b=mmB58Dec(text);if(b.length!==32||b.every(x=>x===0)||!mmOnCurve(b))return null;return mmB58Enc(b)===text?text:null;}catch{return null;}
  }
  if(chainKey==="btc"){
    const be=mmBech32(text);if(be)return be.hrp==="bc"?text.toLowerCase():null;
    const b=mmB58Check(text);return b&&(b.version===0x00||b.version===0x05)?text:null;
  }
  if(chainKey==="ltc"){
    const be=mmBech32(text);if(be)return be.hrp==="ltc"?text.toLowerCase():null;
    const b=mmB58Check(text);return b&&(b.version===0x30||b.version===0x32)?text:null;
  }
  return null;
}
const mmSameAddr=(chainKey,a,b)=>!!a&&!!b&&(MM_CHAINS[chainKey].family==="evm"?String(a).toLowerCase()===String(b).toLowerCase():String(a)===String(b));
// A transaction ID out of whatever was pasted (the bare ID or an explorer link), or null
function mmParseTxid(chainKey,text){
  const fam=MM_CHAINS[chainKey].family,s=String(text==null?"":text).trim();
  if(!s||s.length>300)return null;
  if(fam==="evm"){const m=s.match(/(?:^|[^0-9a-fA-F])(?:0x)?([0-9a-fA-F]{64})(?![0-9a-fA-F])/);return m?"0x"+m[1].toLowerCase():null;}
  if(fam==="utxo"){const m=s.match(/(?:^|[^0-9a-fA-F])([0-9a-fA-F]{64})(?![0-9a-fA-F])/);return m?m[1].toLowerCase():null;}
  const m=s.match(/(?:^|[^1-9A-HJ-NP-Za-km-z])([1-9A-HJ-NP-Za-km-z]{80,90})(?![1-9A-HJ-NP-Za-km-z])/);
  if(!m)return null;
  try{return mmB58Dec(m[1]).length===64?m[1]:null;}catch{return null;}
}

// ── Storage: its own rows in Postgres (kv_store), written and awaited one at a time. No Postgres (a local run, the tests) = one JSON file. ──
const MM_PREFIX="konvert_mm:";
const _mmFile={data:null};
const _mmFilePath=()=>`${DATA_DIR}/konvert_mm.json`;
function _mmFileLoad(){if(!_mmFile.data){try{_mmFile.data=JSON.parse(fs.readFileSync(_mmFilePath(),"utf8"));}catch{_mmFile.data={};}}return _mmFile.data;}
function _mmFileSave(){fs.writeFileSync(_mmFilePath(),JSON.stringify(_mmFile.data));}
const _mmClone=v=>JSON.parse(JSON.stringify(v));
const _mmQueues=new Map();
const _mmSleep=ms=>new Promise(r=>setTimeout(r,ms));
const MMDB={
  async get(k){
    if(pgPool){const r=await pgPool.query("SELECT value FROM kv_store WHERE key=$1",[MM_PREFIX+k]);return r.rows.length?r.rows[0].value:null;}
    const d=_mmFileLoad();return Object.prototype.hasOwnProperty.call(d,k)?_mmClone(d[k]):null;
  },
  async set(k,v){
    if(pgPool){await pgPool.query("INSERT INTO kv_store (key,value,updated_at) VALUES ($1,$2::jsonb,NOW()) ON CONFLICT (key) DO UPDATE SET value=$2::jsonb,updated_at=NOW()",[MM_PREFIX+k,JSON.stringify(v)]);return;}
    const d=_mmFileLoad();d[k]=_mmClone(v);_mmFileSave();
  },
  // Insert only if the key is new. true = this call created it. (How a transaction ID is claimed by exactly one deal.)
  async add(k,v){
    if(pgPool){const r=await pgPool.query("INSERT INTO kv_store (key,value,updated_at) VALUES ($1,$2::jsonb,NOW()) ON CONFLICT (key) DO NOTHING",[MM_PREFIX+k,JSON.stringify(v)]);return r.rowCount===1;}
    const d=_mmFileLoad();if(Object.prototype.hasOwnProperty.call(d,k))return false;d[k]=_mmClone(v);_mmFileSave();return true;
  },
  async del(k){
    if(pgPool){await pgPool.query("DELETE FROM kv_store WHERE key=$1",[MM_PREFIX+k]);return;}
    const d=_mmFileLoad();delete d[k];_mmFileSave();
  },
  async list(prefix){
    if(pgPool){
      const like=(MM_PREFIX+prefix).replace(/[\\%_]/g,"\\$&")+"%";
      const r=await pgPool.query("SELECT key,value FROM kv_store WHERE key LIKE $1 ORDER BY key",[like]);
      return r.rows.map(x=>[x.key.slice(MM_PREFIX.length),x.value]);
    }
    const d=_mmFileLoad();return Object.keys(d).filter(k=>k.startsWith(prefix)).sort().map(k=>[k,_mmClone(d[k])]);
  },
  // One holder at a time, in this process (a queue) and across every copy of the bot (a Postgres advisory lock held on its own connection).
  // The locks have a connection pool of their own, so a few payouts in flight can never use up the connections the rest of the bot needs.
  async lock(name,fn){
    const prev=_mmQueues.get(name)||Promise.resolve();
    let release;const mine=new Promise(r=>{release=r;});
    const tail=prev.then(()=>mine);
    _mmQueues.set(name,tail);
    let conn=null;
    try{
      await prev;
      const lp=mmLockPool();
      if(lp){
        try{conn=await lp.connect();}catch(e){throw new MmError("busy","That is busy right now. Try again in a moment.");}
        const deadline=Date.now()+MM_LOCK_WAIT_MS;
        for(;;){
          const r=await conn.query("SELECT pg_try_advisory_lock(hashtext($1)) AS ok",["konvert-mm:"+name]);
          if(r.rows[0].ok)break;
          if(Date.now()>deadline)throw new MmError("busy","That is busy right now. Try again in a moment.");
          await _mmSleep(200);
        }
      }
      try{return await fn();}
      finally{if(conn)await conn.query("SELECT pg_advisory_unlock(hashtext($1))",["konvert-mm:"+name]).catch(()=>{});}
    }finally{
      if(conn)conn.release();
      release();
      if(_mmQueues.get(name)===tail)_mmQueues.delete(name);
    }
  },
};
let _mmLockPool=null;
function mmLockPool(){
  if(!pgPool)return null;
  if(!_mmLockPool){
    _mmLockPool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},max:24,connectionTimeoutMillis:15000,idleTimeoutMillis:30000});
    _mmLockPool.on("error",e=>console.error("[mm] lock pool:",e.message));
  }
  return _mmLockPool;
}

// ── Settings an owner can change live (no redeploy) ─────────────────────────────────────────────────────────
let _mmMeta={maxUsd:MM_DEFAULT_MAX_USD,paused:false,watch:{},off:{}};
async function mmLoadMeta(){const m=await MMDB.get("meta").catch(()=>null);if(m)_mmMeta={maxUsd:MM_DEFAULT_MAX_USD,paused:false,...m,watch:{...(m.watch||{})},off:{...(m.off||{})}};return _mmMeta;}
async function mmSaveMeta(){await MMDB.set("meta",_mmMeta);}

// ── The middleman wallet ───────────────────────────────────────────────────────────────────────────────────
// Signers come from Railway variables (MM_EVM_KEY: 64 hex characters · MM_SOL_KEY: a Solana secret key, base58 or a [..] byte list) and, when a
// variable is not set, from a wallet the bot made for itself the first time it started (kept in Postgres, shown only by /mmadmin backup).
// A deal remembers the address it was paid to, and is always paid out by the signer of that address.
const MM_PKCS8_ED25519=Buffer.from("302e020100300506032b657004220420","hex");
function mmSolKeypair(secret){
  const bytes=Buffer.from(secret);
  if(bytes.length!==64)throw new Error("shape");
  const privateKey=crypto.createPrivateKey({key:Buffer.concat([MM_PKCS8_ED25519,bytes.subarray(0,32)]),format:"der",type:"pkcs8"});
  const spki=crypto.createPublicKey(privateKey).export({format:"der",type:"spki"});
  const publicKey=Buffer.from(spki.subarray(spki.length-32));
  if(!publicKey.equals(bytes.subarray(32)))throw new Error("the two halves of the key do not belong together");
  return {privateKey,publicKey,address:mmB58Enc(publicKey)};
}
function mmSolNewSecret(){
  const {privateKey,publicKey}=crypto.generateKeyPairSync("ed25519");
  const seed=privateKey.export({format:"der",type:"pkcs8"}),pub=publicKey.export({format:"der",type:"spki"});
  return mmB58Enc(Buffer.concat([seed.subarray(seed.length-32),pub.subarray(pub.length-32)]));
}
let _mmKeys=null,_mmWalletCache=null;
// Runs once at start-up. A wallet is only ever made when it can be kept safely (Postgres), and only if none exists.
async function mmInitKeys(){
  let k=await MMDB.get("keys");
  const canKeep=!!pgPool||process.env.MM_FILE_KEYS==="1";
  if(!k&&canKeep&&mmLibs()&&process.env.MM_NO_OWN_WALLET!=="1"){
    const fresh={v:1,at:Date.now(),evm:"0x"+crypto.randomBytes(32).toString("hex"),sol:mmSolNewSecret()};
    new (mmLibs().ethers.Wallet)(fresh.evm);mmSolKeypair(mmB58Dec(fresh.sol));      // both must load, or nothing is kept
    await MMDB.add("keys",fresh);
    k=await MMDB.get("keys");                                                       // if two copies of the bot started together, the first one's wallet is THE wallet
    if(k&&k.at===fresh.at&&k.evm===fresh.evm)console.log("[mm] made the bot's own middleman wallet (run /mmadmin backup once and keep the keys safe)");
  }
  _mmKeys=k||null;_mmWalletCache=null;
  return !!_mmKeys;
}
function mmWallets(){
  const envE=String(process.env.MM_EVM_KEY||"").trim(),envS=String(process.env.MM_SOL_KEY||"").trim();
  const ck=`${envE}|${envS}|${_mmKeys?_mmKeys.at:0}`;
  if(_mmWalletCache&&_mmWalletCache.ck===ck)return _mmWalletCache;
  const out={ck,evm:[],sol:[],problems:[]},libs=mmLibs();
  const addEvm=(raw,src)=>{
    if(!raw)return;
    if(!libs){if(src==="railway")out.problems.push("ethers is not installed");return;}
    try{
      const hex=String(raw).replace(/^0x/i,"");if(!/^[0-9a-fA-F]{64}$/.test(hex))throw new Error("shape");
      const wallet=new libs.ethers.Wallet("0x"+hex);
      if(!out.evm.some(s=>s.address===wallet.address))out.evm.push({address:wallet.address,wallet,src});
    }catch{out.problems.push(src==="railway"?"MM_EVM_KEY is not a valid private key (64 hex characters)":"the bot's own Ethereum key could not be read");}
  };
  const addSol=(raw,src)=>{
    if(!raw)return;
    try{
      const bytes=String(raw).startsWith("[")?Uint8Array.from(JSON.parse(raw)):mmB58Dec(raw);
      const kp=mmSolKeypair(bytes);
      if(!out.sol.some(s=>s.address===kp.address))out.sol.push({...kp,src});
    }catch{out.problems.push(src==="railway"?"MM_SOL_KEY is not a valid Solana secret key":"the bot's own Solana key could not be read");}
  };
  addEvm(envE,"railway");addSol(envS,"railway");
  if(_mmKeys){addEvm(_mmKeys.evm,"bot");addSol(_mmKeys.sol,"bot");}
  _mmWalletCache=out;
  return out;
}
const mmWatchKey=chainKey=>MM_CHAINS[chainKey].family==="utxo"?chainKey:MM_CHAINS[chainKey].family;
function mmSigner(chainKey,address){
  const fam=MM_CHAINS[chainKey].family;if(fam==="utxo")return null;
  return mmWallets()[fam].find(s=>mmSameAddr(chainKey,s.address,address))||null;
}
// Where deposits for a network go: the address an owner set (watch-only unless the bot also holds its key), else the bot's wallet
function mmDepositAddress(chainKey){
  const chain=MM_CHAINS[chainKey];if(!chain||_mmMeta.off[chainKey])return null;
  const watch=_mmMeta.watch[mmWatchKey(chainKey)];
  if(watch)return watch;
  if(chain.family==="utxo")return null;
  const first=mmWallets()[chain.family][0];
  return first?first.address:null;
}
const mmIsAuto=(chainKey,address)=>!!mmSigner(chainKey,address);
function mmAssetsFor(coin){const c=mmCoinOf(coin);return MM_ASSETS.filter(a=>a.coin===c&&!!mmDepositAddress(a.chain));}

// ── Talking to the networks: plain JSON-RPC (and the Esplora REST API for Bitcoin / Litecoin), trying the next node when one is down ──
const MM_TRANSIENT_RE=/rate.?limit|limit exceeded|too many|capacity|overload|try again|timed? ?out|unauthori[sz]ed|api.?key|forbidden|temporar|unavailable|behind by|not available|busy|header not found|missing trie node|internal error/i;
function mmRpcUrls(chainKey){
  const env=String(process.env["MM_RPC_"+chainKey.toUpperCase()]||"").split(",").map(s=>s.trim().replace(/\/+$/,"")).filter(s=>/^https?:\/\//i.test(s));
  return env.length?env:MM_CHAINS[chainKey].rpcs;
}
// opts.start = which node to ask first · opts.one = ask only that node · opts.nullNext = an empty answer is not an answer, ask the next node too
async function mmRpc(chainKey,method,params,opts){
  opts=opts||{};
  const urls=mmRpcUrls(chainKey),n=urls.length;let last=null,sawNull=false;
  for(let k=0;k<n;k++){
    if(opts.one&&k>0)break;
    const url=urls[((opts.start||0)+k)%n];
    try{
      const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params:params||[]}),signal:AbortSignal.timeout(opts.timeoutMs||MM_RPC_MS)});
      if(!r.ok){_drop(r);throw new Error("HTTP "+r.status);}
      const body=await r.json();
      if(body&&body.error){
        const e=new Error(String(body.error.message||"RPC error"));
        e.rpcError=!MM_TRANSIENT_RE.test(e.message);e.rpcCode=body.error.code;      // a busy node is not an answer: the next one is asked
        throw e;
      }
      if(!body||!Object.prototype.hasOwnProperty.call(body,"result"))throw new Error("no result");
      if(body.result==null&&opts.nullNext){sawNull=true;continue;}
      return body.result;
    }catch(e){if(e.rpcError)throw e;last=e;}
  }
  if(sawNull)return null;
  throw new MmError("rpc",`no ${chainKey} node answered (${last?String(last.message).slice(0,80):"no nodes"})`);
}
async function mmApi(chainKey,pathPart,opts){
  opts=opts||{};
  const urls=mmRpcUrls(chainKey),n=urls.length;let last=null,missing=0;
  for(let k=0;k<n;k++){
    if(opts.one&&k>0)break;
    const url=urls[((opts.start||0)+k)%n]+pathPart;
    try{
      const r=await fetch(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(opts.timeoutMs||MM_RPC_MS)});
      if(r.status===404||r.status===400){_drop(r);missing++;continue;}
      if(!r.ok){_drop(r);throw new Error("HTTP "+r.status);}
      return opts.text?String(await r.text()).trim():await r.json();
    }catch(e){last=e;}
  }
  if(missing&&!last)return null;                                  // every node that answered said "no such thing"
  if(missing&&opts.one)return null;
  throw new MmError("rpc",`no ${chainKey} node answered (${last?String(last.message).slice(0,80):"no nodes"})`);
}

// ── Reading a payment off the chain ─────────────────────────────────────────────────────────────────────────
// Result: {found:false} or {found:true, ok (not failed), toUs, amountRaw (what reached OUR address in THIS asset), from, self (it came from the
// middleman wallet itself), mined, conf, final (enough confirmations), blockTime (seconds), viaContract}. Throws MmError("rpc") when no node answers.
async function mmVerifyEvm(chainKey,asset,address,txid,opts){
  const low=String(address).toLowerCase(),q={...opts,nullNext:true};
  const tx=await mmRpc(chainKey,"eth_getTransactionByHash",[txid],q);
  if(!tx||String(tx.hash||"").toLowerCase()!==txid)return {found:false};
  const out={found:true,ok:null,toUs:false,amountRaw:0n,from:tx.from?String(tx.from).toLowerCase():null,self:String(tx.from||"").toLowerCase()===low,mined:false,conf:0,final:false,blockTime:null,viaContract:false};
  if(!asset.contract){
    if(String(tx.to||"").toLowerCase()===low){out.toUs=true;out.amountRaw=BigInt(tx.value||"0x0");}
    else out.viaContract=String(tx.input||tx.data||"0x").length>2;   // a contract call (some exchanges batch their withdrawals) cannot be read from here; a plain transfer to somebody else is just not ours
  }else if(String(tx.to||"").toLowerCase()===asset.contract&&/^0xa9059cbb[0-9a-f]{128}/i.test(String(tx.input||tx.data||""))){
    const inp=String(tx.input||tx.data);                          // a plain transfer(to, amount): readable before it is mined
    if(("0x"+inp.slice(34,74)).toLowerCase()===low){out.toUs=true;out.amountRaw=BigInt("0x"+inp.slice(74,138));}
  }
  if(tx.blockNumber==null)return out;
  const rc=await mmRpc(chainKey,"eth_getTransactionReceipt",[txid],q);
  if(!rc||String(rc.transactionHash||"").toLowerCase()!==txid)return out;
  const blk=await mmRpc(chainKey,"eth_getBlockByNumber",[rc.blockNumber,false],q);
  if(!blk||!blk.hash||blk.hash!==rc.blockHash)return out;          // not (or no longer) part of the chain this node follows: treated as still unconfirmed
  out.mined=true;out.ok=rc.status==="0x1";
  if(asset.contract){
    let sum=0n,from=null;
    for(const l of rc.logs||[]){
      const t=l.topics||[];
      if(l.removed||String(l.address||"").toLowerCase()!==asset.contract||t.length!==3||t[0]!==MM_TRANSFER_TOPIC)continue;
      if(("0x"+String(t[2]).slice(26)).toLowerCase()!==low)continue;
      sum+=BigInt(l.data&&l.data!=="0x"?l.data:"0x0");
      if(!from)from=("0x"+String(t[1]).slice(26)).toLowerCase();
    }
    out.amountRaw=sum;out.toUs=sum>0n;
    if(from){out.from=from;out.self=from===low;}
  }
  const head=BigInt(await mmRpc(chainKey,"eth_blockNumber",[],opts)),bn=BigInt(rc.blockNumber);
  out.conf=head>=bn?Number(head-bn)+1:0;
  out.final=out.conf>=MM_CHAINS[chainKey].confs;
  out.blockTime=blk.timestamp?Number(BigInt(blk.timestamp)):null;
  return out;
}
async function mmVerifySol(address,txid,opts){
  const q={...opts,nullNext:true},ask=c=>mmRpc("sol","getTransaction",[txid,{encoding:"jsonParsed",maxSupportedTransactionVersion:0,commitment:c}],q);
  let tx=await ask("finalized"),fin=true;
  if(!tx){tx=await ask("confirmed");fin=false;}
  if(!tx||!tx.meta||!tx.transaction)return {found:false};
  const keys=((tx.transaction.message&&tx.transaction.message.accountKeys)||[]).map(k=>typeof k==="string"?k:(k&&k.pubkey));
  const i=keys.indexOf(address),meta=tx.meta;
  const out={found:true,ok:meta.err==null,toUs:false,amountRaw:0n,from:keys[0]||null,self:keys[0]===address,mined:true,conf:fin?1:0,final:fin,blockTime:tx.blockTime||null,viaContract:false};
  if(i>=0&&Array.isArray(meta.preBalances)&&Array.isArray(meta.postBalances)&&meta.preBalances.length===keys.length&&meta.postBalances.length===keys.length){
    const d=BigInt(meta.postBalances[i])-BigInt(meta.preBalances[i]);
    if(d>0n){out.toUs=true;out.amountRaw=d;}
  }
  return out;
}
async function mmVerifyUtxo(chainKey,address,txid,opts){
  const tx=await mmApi(chainKey,"/tx/"+txid,opts);
  if(!tx||String(tx.txid||"").toLowerCase()!==txid)return {found:false};
  let sum=0n;for(const o of tx.vout||[])if(o&&o.scriptpubkey_address===address)sum+=BigInt(o.value);
  const st=tx.status||{},vin=tx.vin||[];
  const out={found:true,ok:true,toUs:sum>0n,amountRaw:sum,from:(vin[0]&&vin[0].prevout&&vin[0].prevout.scriptpubkey_address)||null,
    self:vin.some(v=>v&&v.prevout&&v.prevout.scriptpubkey_address===address),mined:!!st.confirmed,conf:0,final:false,blockTime:st.block_time||null,viaContract:false};
  if(st.confirmed){
    const tip=Number(await mmApi(chainKey,"/blocks/tip/height",{...opts,text:true}));
    if(Number.isFinite(tip)&&tip>=st.block_height)out.conf=tip-st.block_height+1;
    out.final=out.conf>=MM_CHAINS[chainKey].confs;
  }
  return out;
}
function mmVerifyTx(chainKey,asset,address,txid,opts){
  const fam=MM_CHAINS[chainKey].family;
  return fam==="evm"?mmVerifyEvm(chainKey,asset,address,txid,opts):fam==="sol"?mmVerifySol(address,txid,opts):mmVerifyUtxo(chainKey,address,txid,opts);
}
// A token is used only after its contract has answered with the decimals this table expects (a wrong address or a wrong network answers nothing)
const _mmTokenOk=new Map();
async function mmTokenCheck(asset){
  if(!asset.contract)return true;
  const k=mmAssetKey(asset);
  if(_mmTokenOk.get(k))return true;
  const r=await mmRpc(asset.chain,"eth_call",[{to:asset.contract,data:"0x313ce567"},"latest"]);
  const ok=typeof r==="string"&&/^0x[0-9a-f]{1,64}$/i.test(r)&&r!=="0x"&&BigInt(r)===BigInt(asset.decimals);
  if(ok)_mmTokenOk.set(k,true);
  return ok;
}
async function mmBalances(chainKey,asset,address){
  const fam=MM_CHAINS[chainKey].family;
  if(fam==="evm"){
    const native=BigInt(await mmRpc(chainKey,"eth_getBalance",[address,"latest"]));
    let token=null;
    if(asset&&asset.contract){const r=await mmRpc(chainKey,"eth_call",[{to:asset.contract,data:"0x70a08231"+"0".repeat(24)+String(address).slice(2).toLowerCase()},"latest"]);token=BigInt(r&&r!=="0x"?r:"0x0");}
    return {native,token};
  }
  if(fam==="sol"){const r=await mmRpc("sol","getBalance",[address,{commitment:"confirmed"}]);return {native:BigInt(r.value),token:null};}
  const a=await mmApi(chainKey,"/address/"+address);
  const c=(a&&a.chain_stats)||{};
  return {native:BigInt(c.funded_txo_sum||0)-BigInt(c.spent_txo_sum||0),token:null};
}

// Can this network's wallet pay the network fee of a token payout? true / false / null (the network could not be asked). Remembered for a minute.
const _mmGasCache=new Map();
async function mmGasReady(chainKey,address){
  const k=chainKey+":"+String(address).toLowerCase(),c=_mmGasCache.get(k);
  if(c&&Date.now()-c.at<60*1000)return c.ok;
  let ok=null;
  try{
    const ch=MM_CHAINS[chainKey];
    const [bal,gp]=await Promise.all([mmRpc(chainKey,"eth_getBalance",[address,"latest"],{timeoutMs:6000}),mmRpc(chainKey,"eth_gasPrice",[],{timeoutMs:6000})]);
    const need=BigInt(gp)*120000n*(ch.type2?5n:1n)/(ch.type2?4n:1n)*2n;            // two token transfers' worth of fees
    ok=BigInt(bal)>=need;
  }catch{}
  _mmGasCache.set(k,{at:Date.now(),ok});
  return ok;
}
// The fee a native-coin payout would take out of the amount, in whole base units (what mmSendEvm will use, with the same cushions), or null when the network can't say
async function mmNativeFeeRaw(chainKey){
  try{
    const ch=MM_CHAINS[chainKey],m=ch.feeMult||[1,1],gp=BigInt(await mmRpc(chainKey,"eth_gasPrice",[],{timeoutMs:6000}));
    return 21000n*(gp*(ch.type2?5n:11n)/(ch.type2?4n:10n))*BigInt(m[0])/BigInt(m[1]);
  }catch{return null;}
}

// ── Sending (release / refund) ──────────────────────────────────────────────────────────────────────────────
// job: {chainKey, signer, to, contract (null = the native coin), amountRaw (what the deal holds), owed:{native,token} (held for OTHER deals), nonce?, minGasPrice?}
// onSigned({hash,raw,nonce,gasPrice,sentRaw,feeRaw,lastValid}) is awaited after signing and BEFORE broadcasting.
// A native-coin send takes the network fee out of the amount; a token send pays its fee from the wallet's own gas.
async function mmBroadcastEvm(chainKey,raw,hash){
  try{return await mmRpc(chainKey,"eth_sendRawTransaction",[raw]);}
  catch(e){
    if(e instanceof MmError&&e.code==="rpc")throw new MmError("unknown","the network did not acknowledge the transaction",{hash});
    const msg=String(e.message||"");
    if(/already known|known transaction|already imported|alreadyknown|same hash|already exists/i.test(msg))return hash;
    if(/nonce too low|nonce is too low|already been used/i.test(msg)){
      const mined=await mmRpc(chainKey,"eth_getTransactionReceipt",[hash],{nullNext:true}).catch(()=>null);
      if(mined)return hash;
      throw new MmError("nonce",msg);
    }
    if(/insufficient funds|insufficient balance/i.test(msg))throw new MmError("no_gas",msg);
    throw new MmError("rejected",msg);
  }
}
async function mmWaitEvm(chainKey,hash,timeoutMs){
  const t0=Date.now();
  for(;;){
    const rc=await mmRpc(chainKey,"eth_getTransactionReceipt",[hash],{nullNext:true,timeoutMs:6000}).catch(()=>null);
    if(rc){if(rc.status==="0x1")return {confirmed:true};throw new MmError("reverted","the transfer was refused on-chain",{hash});}
    if(Date.now()-t0>timeoutMs)return {confirmed:false};
    await _mmSleep(MM_POLL_MS);
  }
}
async function mmSendEvm(job,onSigned){
  const {ethers}=mmLibs(),chain=MM_CHAINS[job.chainKey],wallet=job.signer.wallet,from=wallet.address,ck=job.chainKey;
  const owed=job.owed||{native:0n,token:0n};
  return MMDB.lock("send:"+ck+":"+from.toLowerCase(),async()=>{
    const [balHex,nonceHex,gpHex]=await Promise.all([mmRpc(ck,"eth_getBalance",[from,"latest"]),mmRpc(ck,"eth_getTransactionCount",[from,"pending"]),mmRpc(ck,"eth_gasPrice",[])]);
    const balance=BigInt(balHex),nonce=job.nonce!=null?job.nonce:Number(BigInt(nonceHex));
    let price=BigInt(gpHex)*(chain.type2?5n:11n)/(chain.type2?4n:10n);       // headroom so it is not left waiting when fees tick up
    if(job.minGasPrice!=null&&price<BigInt(job.minGasPrice))price=BigInt(job.minGasPrice);
    if(price<=0n)throw new MmError("rpc","the network sent no fee price");
    let to=job.to,data="0x",value,gasLimit,feeRaw;
    if(job.contract){
      data="0xa9059cbb"+"0".repeat(24)+String(job.to).slice(2).toLowerCase()+BigInt(job.amountRaw).toString(16).padStart(64,"0");
      to=job.contract;value=0n;
      const tb=await mmRpc(ck,"eth_call",[{to:job.contract,data:"0x70a08231"+"0".repeat(24)+from.slice(2).toLowerCase()},"latest"]);
      {const have=BigInt(tb&&tb!=="0x"?tb:"0x0");if(have<BigInt(job.amountRaw)+owed.token)throw mmShortError(job,have,BigInt(job.amountRaw),owed.token);}
      let est;
      try{est=BigInt(await mmRpc(ck,"eth_estimateGas",[{from,to,data}]));}
      catch(e){if(e instanceof MmError)throw e;if(/insufficient funds/i.test(e.message))throw new MmError("no_gas",e.message);throw new MmError("bad_recipient",String(e.message).slice(0,160));}
      gasLimit=est*13n/10n;
      if(gasLimit>400000n)throw new MmError("bad_recipient","the transfer needs an unusual amount of gas");
      feeRaw=gasLimit*price;
      if(balance<feeRaw+owed.native)throw new MmError("no_gas","the wallet needs gas",{needRaw:feeRaw+owed.native-balance});
    }else{
      if(balance<BigInt(job.amountRaw)+owed.native)throw mmShortError(job,balance,BigInt(job.amountRaw),owed.native);
      gasLimit=21000n;
      const m=chain.feeMult||[1,1];
      feeRaw=gasLimit*price*BigInt(m[0])/BigInt(m[1]);
      value=BigInt(job.amountRaw)-feeRaw;
      if(value<=0n)throw new MmError("dust","the amount is smaller than the network fee");
      let est;
      try{est=BigInt(await mmRpc(ck,"eth_estimateGas",[{from,to,value:"0x"+value.toString(16)}]));}
      catch(e){if(e instanceof MmError)throw e;throw new MmError("bad_recipient",String(e.message).slice(0,160));}
      if(est>21000n){                                            // the receiving address is a contract (a smart wallet): it needs more gas
        gasLimit=est*12n/10n;
        if(gasLimit>150000n)throw new MmError("bad_recipient","the receiving address needs too much gas to accept a transfer");
        feeRaw=gasLimit*price*BigInt(m[0])/BigInt(m[1]);
        value=BigInt(job.amountRaw)-feeRaw;
        if(value<=0n)throw new MmError("dust","the amount is smaller than the network fee");
      }
    }
    let tx;
    if(chain.type2){
      let tip;try{tip=BigInt(await mmRpc(ck,"eth_maxPriorityFeePerGas",[]));}catch{tip=price/10n;}
      if(tip>price)tip=price;if(tip<1n)tip=1n;
      tx={type:2,chainId:chain.chainId,nonce,to,value,data,gasLimit,maxFeePerGas:price,maxPriorityFeePerGas:tip};
    }else tx={type:0,chainId:chain.chainId,nonce,to,value,data,gasLimit,gasPrice:price};
    const raw=await wallet.signTransaction(tx),hash=ethers.keccak256(raw);
    await onSigned({hash,raw,nonce,gasPrice:price.toString(),sentRaw:(job.contract?BigInt(job.amountRaw):value).toString(),feeRaw:feeRaw.toString()});
    await mmBroadcastEvm(ck,raw,hash);
    return {hash,...(await mmWaitEvm(ck,hash,MM_SEND_WAIT_MS))};
  });
}
// A legacy Solana transaction: one signer, one System Program transfer
function mmCompactU16(n){const out=[];let v=n;for(;;){const low=v&0x7f;v>>=7;if(v===0){out.push(low);break;}out.push(low|0x80);}return Buffer.from(out);}
function mmSolSignedTransfer(wallet,destBytes,lamports,blockhashBytes){
  const dest=Buffer.from(destBytes),blockhash=Buffer.from(blockhashBytes);
  if(dest.length!==32||blockhash.length!==32)throw new Error("bad transfer inputs");
  const data=Buffer.alloc(12);data.writeUInt32LE(2,0);data.writeBigUInt64LE(BigInt(lamports),4);
  const message=Buffer.concat([
    Buffer.from([1,0,1]),
    mmCompactU16(3),wallet.publicKey,dest,Buffer.alloc(32),
    blockhash,
    mmCompactU16(1),Buffer.from([2]),
    mmCompactU16(2),Buffer.from([0,1]),
    mmCompactU16(data.length),data,
  ]);
  const signature=crypto.sign(null,message,wallet.privateKey);
  return {raw:Buffer.concat([mmCompactU16(1),signature,message]),signature};
}
const MM_SOL_FEE=5000n;
async function mmSolRentMin(){try{const n=Number(await mmRpc("sol","getMinimumBalanceForRentExemption",[0]));if(n>0)return BigInt(n);}catch{}return 890880n;}
async function mmSolStatus(signature,history){
  const r=await mmRpc("sol","getSignatureStatuses",[[signature],{searchTransactionHistory:!!history}],{timeoutMs:6000});
  return ((r&&r.value)||[])[0]||null;
}
async function mmSendSol(job,onSigned){
  const wallet=job.signer,owed=job.owed||{native:0n};
  return MMDB.lock("send:sol:"+wallet.address,async()=>{
    const dest=mmB58Dec(job.to);
    const balance=BigInt((await mmRpc("sol","getBalance",[wallet.address,{commitment:"confirmed"}])).value);
    const destBal=BigInt((await mmRpc("sol","getBalance",[job.to,{commitment:"confirmed"}])).value),rentMin=await mmSolRentMin();
    const amount=BigInt(job.amountRaw);let lamports=amount-MM_SOL_FEE;
    if(lamports<=0n)throw new MmError("dust","the amount is smaller than the network fee");
    if(balance<amount+owed.native)throw mmShortError(job,balance,amount,owed.native);
    let left=balance-amount;
    if(left>0n&&left<rentMin&&owed.native===0n){lamports+=left;left=0n;}      // nothing else is held here: the few lamports that would be left behind (an account can't keep less than the minimum) go along
    if(left>0n&&left<rentMin)throw new MmError("no_gas","the Solana wallet has to keep a small minimum balance",{needRaw:rentMin-left});
    if(destBal+lamports<rentMin)throw new MmError("bad_recipient","the amount is too small to open a new Solana wallet");
    const bh=(await mmRpc("sol","getLatestBlockhash",[{commitment:"confirmed"}])).value,bhBytes=mmB58Dec(bh.blockhash);
    if(bhBytes.length!==32)throw new MmError("rpc","the network sent an unusable blockhash");
    const signed=mmSolSignedTransfer(wallet,dest,lamports,bhBytes),signature=mmB58Enc(signed.signature),raw=signed.raw.toString("base64");
    await onSigned({hash:signature,raw,sentRaw:lamports.toString(),feeRaw:MM_SOL_FEE.toString(),lastValid:Number(bh.lastValidBlockHeight)});
    try{await mmRpc("sol","sendTransaction",[raw,{encoding:"base64",preflightCommitment:"confirmed",maxRetries:5}]);}
    catch(e){
      if(e instanceof MmError&&e.code==="rpc")throw new MmError("unknown","the network did not acknowledge the transaction",{hash:signature});
      if(/already been processed|already processed/i.test(e.message))return {hash:signature,confirmed:true};
      if(/insufficient (funds|lamports)/i.test(e.message))throw new MmError("no_gas",e.message);
      throw new MmError("rejected",String(e.message).slice(0,200));
    }
    const t0=Date.now();
    for(;;){
      const st=await mmSolStatus(signature,false).catch(()=>null);
      if(st){
        if(st.err)throw new MmError("reverted",JSON.stringify(st.err).slice(0,160),{hash:signature});
        if(st.confirmationStatus==="confirmed"||st.confirmationStatus==="finalized")return {hash:signature,confirmed:true};
      }
      if(Date.now()-t0>MM_SEND_WAIT_MS)return {hash:signature,confirmed:false};
      await _mmSleep(MM_POLL_MS);
    }
  });
}
// Where a transaction that was sent earlier stands now: "landed" · "failed" · "pending" (still possible) · "gone" (it can never land any more)
async function mmSentStatus(e){
  const o=e.out||{},ck=e.chain;
  if(!o.txid)return "gone";
  if(MM_CHAINS[ck].family==="evm"){
    const rc=await mmRpc(ck,"eth_getTransactionReceipt",[o.txid],{nullNext:true});
    if(rc)return rc.status==="0x1"?"landed":"failed";
    return "pending";                                             // an unmined Ethereum transaction can always still land (its nonce is only settled by a replacement with the same nonce)
  }
  const st=await mmSolStatus(o.txid,true);
  if(st)return st.err?"failed":(st.confirmationStatus==="confirmed"||st.confirmationStatus==="finalized")?"landed":"pending";
  if(o.lastValid!=null){
    const h=Number(await mmRpc("sol","getBlockHeight",[{commitment:"finalized"}]));
    if(h>o.lastValid+5){const again=await mmSolStatus(o.txid,true);if(again)return again.err?"failed":"landed";return "gone";}
  }
  return "pending";
}
async function mmRebroadcast(e){
  const o=e.out||{};if(!o.raw)return;
  if(MM_CHAINS[e.chain].family==="evm")await mmRpc(e.chain,"eth_sendRawTransaction",[o.raw]).catch(()=>{});
  else await mmRpc("sol","sendTransaction",[o.raw,{encoding:"base64",skipPreflight:true,maxRetries:3}]).catch(()=>{});
}


// ── Deals ───────────────────────────────────────────────────────────────────────────────────────────────────
// state: net (choose the network) · await (waiting for the deposit) · confirming · review (an owner checks the deposit) · funded ·
//        sending (the bot is paying out) · payout (an owner pays out by hand) · stuck (an owner has to finish it) · released · refunded · cancelled
const MM_TERMINAL=new Set(["released","refunded","cancelled"]);
const MM_HOLDING=new Set(["short","confirming","review","funded","sending","payout","stuck"]);
const MM_WAITING=new Set(["await","short","confirming"]);          // an address is on the card and a deposit is (or may still be) on its way
const _mmCache=new Map();
async function mmFresh(id){if(!id)return null;const e=(await MMDB.get("e:"+id))||(await MMDB.get("done:"+id));if(e)_mmCache.set(id,e);return e;}
async function mmGet(id){if(!id)return null;return _mmCache.get(id)||mmFresh(id);}
// Every change to a deal: take its lock, read it fresh from storage, change it, write it back. fn may throw to change nothing.
async function mmUpdate(id,fn){
  return MMDB.lock("e:"+id,async()=>{
    const e=(await MMDB.get("e:"+id))||(await MMDB.get("done:"+id));
    if(!e)throw new MmError("gone","That middleman deal no longer exists.");
    await fn(e);
    e.updatedAt=Date.now();
    if(MM_TERMINAL.has(e.state)){await MMDB.set("done:"+id,e);await MMDB.del("e:"+id);}
    else await MMDB.set("e:"+id,e);
    _mmCache.set(id,e);
    return e;
  });
}
const mmNote=(e,ev,by)=>{e.log=(e.log||[]).concat([{at:Date.now(),ev:String(ev).slice(0,200),by:by||null}]).slice(-200);};
const mmOfChannel=channelId=>{const t=(_mem.tickets||{})[channelId];return t&&t.mmId?_mmCache.get(t.mmId)||null:null;};
// The deal on a ticket that is still running (null when there is none or it is finished)
const mmActive=channelId=>{const e=mmOfChannel(channelId);return e&&!MM_TERMINAL.has(e.state)?e:null;};
// Is the middleman holding (or about to hold) funds for this ticket? Such a ticket cannot be closed, completed or handed to someone else.
const mmHolds=channelId=>{const e=mmActive(channelId);return !!e&&(MM_HOLDING.has(e.state)||((e.watch||[]).length>0));};
const MM_HOLD_TEXT="The built-in server middleman bot is still holding funds for this ticket. Release or refund them first (or type `$mm help` and an owner will step in).";
const MM_OPEN_CARD_TEXT="The middleman card is still open. Type `$mm cancel` first (or press **Help** on the card, then **Cancel Middleman**). If you already sent crypto to the middleman, type `$mm help` instead.";
// Called before a ticket is closed, completed or given back to the queue. Returns why it can't be (text), or null. A card that holds nothing is cancelled.
// ownerLike = an owner (or the bot itself) is doing it, so a card that is waiting for a deposit does not stop it.
async function mmBeforeClose(channel,ownerLike){
  const e=mmActive(channel.id);
  if(!e)return null;
  if(mmHolds(channel.id))return MM_HOLD_TEXT;
  if(e.state==="await"&&!ownerLike)return MM_OPEN_CARD_TEXT;
  await mmUpdate(e.id,x=>{if(x.state==="net"||x.state==="await"){x.state="cancelled";mmNote(x,"ticket ended");}}).catch(()=>{});
  await mmFresh(e.id).catch(()=>{});
  if(mmHolds(channel.id))return MM_HOLD_TEXT;                      // a deposit landed in the same moment
  mmSaveTicket(channel.id,t=>{if(t.mmId===e.id)t.mmStage=null;});
  return null;
}
const mmResetTicket=t=>{delete t.mmId;delete t.mmStage;delete t.mmOwner;delete t.mmOwnerPingAt;};
// Why a ticket can't be marked complete right now, or null. It answers at once (no waiting), so a caller can use it before its first await.
// Funds still held always stop it; a card that is waiting for a deposit stops it for everyone except an owner; a refunded deal can't be "completed".
function mmCompleteBlock(channelId,ownerLike){
  if(mmHolds(channelId))return MM_HOLD_TEXT;
  const e=mmActive(channelId);
  if(e&&!ownerLike)return MM_OPEN_CARD_TEXT;
  const t=(_mem.tickets||{})[channelId],last=t&&t.mmId?_mmCache.get(t.mmId):null;
  if(!e&&last&&last.state==="refunded"&&!ownerLike)return "The built-in server middleman bot refunded the funds for this exchange, so it was called off. Close the ticket instead.";
  return null;
}
const mmAssetOf=e=>({coin:e.coin,chain:e.chain,contract:e.contract||null,decimals:e.decimals});
const mmAmt=(e,raw,dp)=>`${mmFmtUnits(raw,e.decimals,dp)} ${e.coin}`;
const mmTxLink=(e,txid)=>`[transaction](${MM_CHAINS[e.chain].tx}${txid})`;
const mmNetOf=e=>e.chain?mmNetLabel(mmAssetOf(e)):"";
const mmShort=a=>{const s=String(a||"");return s.length>20?`${s.slice(0,8)}…${s.slice(-6)}`:s;};
const mmAddrTag=a=>crypto.createHash("sha256").update(String(a||"")).digest("hex").slice(0,10);

// What the middleman would hold for this ticket, and who deposits it. direction "send": the exchanger owes the client crypto, so the exchanger deposits what
// the client is to receive. "receive" and crypto-to-crypto: the client deposits the crypto they are selling.
function mmPlan(ticket){
  if(!ticket||!ticket.claimedBy)return {ok:false,why:"unclaimed"};
  const d=dealOf(ticket);
  if(d.gift||d.custom||d.plain)return {ok:false,why:"kind"};
  const clientDeposits=d.c2c||ticket.direction==="receive";
  const usd=clientDeposits?d.amount:d.net;
  if(!(usd>=MM_MIN_USD))return {ok:false,why:"amount"};
  return {ok:true,coin:mmCoinOf(ticket.coin),usd:Math.round(usd*100)/100,
    depositorId:clientDeposits?ticket.userId:ticket.claimedBy,recipientId:clientDeposits?ticket.claimedBy:ticket.userId,
    pays:d.c2c?String(ticket.recvCoin):methodLabel(ticket.method)};
}
const MM_OWNER_WHY={
  paused:"The built-in server middleman bot is paused right now.",kind:"This kind of exchange is middlemanned by an owner.",amount:"This exchange has no fixed crypto amount yet.",
  coin:"The built-in server middleman bot does not hold this coin yet.",error:"The built-in server middleman bot could not be set up for this exchange right now.",unclaimed:"No exchanger has claimed this ticket yet.",
  gas:"The built-in server middleman bot can't pay the network fees for this coin right now.",
};
function mmSaveTicket(channelId,fn){
  const tickets=Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets"),t=tickets[channelId];
  if(!t)return null;
  fn(t);_mem.tickets=tickets;save("tickets",tickets);
  return t;
}
async function mmAlertOwners(payload){
  for(const oid of CONFIG.OWNER_IDS)client.users.fetch(oid).then(u=>u.send(payload)).catch(()=>{});
}
const mmChannelOf=async e=>{
  if(!e||!e.channelId)return null;
  const g=client.guilds.cache.get(e.guildId||CONFIG.GUILD_ID)||client.guilds.cache.first();
  return (g&&g.channels.cache.get(e.channelId))||null;
};
const mmLinkRow=(e,extra)=>{
  const row=new ActionRowBuilder();
  for(const b of extra||[])row.addComponents(b);
  if(e&&e.guildId&&e.channelId)row.addComponents(kLink("Open Ticket",`https://discord.com/channels/${e.guildId}/${e.channelId}`));
  return row.components.length?[row]:[];
};

// An owner steps in as the middleman (anything the bot does not or cannot hold). Owners are pinged in the ticket and by DM, at most once every ten minutes.
async function mmOwnerFallback(channel,ticket,why,detail){
  const text=why==="limit"?`This exchange is above the built-in server middleman bot's **${fmtUSD(_mmMeta.maxUsd)}** limit.`:(MM_OWNER_WHY[why]||MM_OWNER_WHY.error);
  const now=Date.now(),quiet=ticket.mmOwnerPingAt&&now-ticket.mmOwnerPingAt<10*60*1000;
  const saved=mmSaveTicket(channel.id,t=>{t.mmOwner=why;t.mmStage="owner";if(!quiet)t.mmOwnerPingAt=now;});
  if(saved)refreshTicketCard(channel,saved).catch(()=>{});          // the ticket card's status row follows
  const owners=CONFIG.OWNER_IDS;
  const embed=kEmbed("Middleman","warn").setTitle("Owner Middleman")
    .setDescription(`${kHero(dealOf(ticket).hero)}\n${text}\n\nA Konvert owner will act as the middleman for this exchange, right here in this ticket. **Don't send anything until an owner tells you to.**`)
    .setFooter(kFoot("Built-in server middleman bot")).setTimestamp();
  await channel.send({content:quiet?undefined:owners.map(id=>`<@${id}>`).join(" "),embeds:[embed],allowedMentions:{users:quiet?[]:owners}}).catch(()=>{});
  if(!quiet){
    const link=channel.guild?`https://discord.com/channels/${channel.guild.id}/${channel.id}`:null;
    mmAlertOwners({embeds:[kEmbed("Middleman","warn").setTitle("Owner Middleman Needed").setDescription(`${kHero(dealOf(ticket).hero)}\n${text}\n<@${ticket.userId}> with <@${ticket.claimedBy}>${detail?`\n> ${String(detail).slice(0,200)}`:""}`).setTimestamp()],
      components:link?[new ActionRowBuilder().addComponents(kLink("Open Ticket",link))]:[]});
  }
  log(channel.guild,`MM OWNER: #${channel.name} | ${why}${detail?" | "+String(detail).slice(0,120):""}`);
  return {kind:"owner",why};
}

// Starts (or shows again) the middleman on a ticket
// Networks where a token payout could not be paid for (the bot's wallet has no gas there) are left out, and the owners are told so it gets topped up
async function mmGasFilter(assets){
  const out=[];
  for(const a of assets){
    if(!a.contract||MM_CHAINS[a.chain].family!=="evm"){out.push(a);continue;}
    const addr=mmDepositAddress(a.chain);
    if(!addr||!mmSigner(a.chain,addr)){out.push(a);continue;}        // an owner sends that one by hand: nothing to pay for from the bot's wallet
    const ok=await mmGasReady(a.chain,addr);
    if(ok===false){mmGasLow(a.chain,addr);continue;}
    out.push(a);                                                     // true, or null (the network could not be asked: the payout step checks again)
  }
  return out;
}
const _mmGasWarnAt=new Map();
function mmGasLow(chainKey,address){
  const now=Date.now();
  if(now-(_mmGasWarnAt.get(chainKey)||0)<60*60*1000)return;
  _mmGasWarnAt.set(chainKey,now);
  const chain=MM_CHAINS[chainKey],coins=MM_ASSETS.filter(a=>a.chain===chainKey&&a.contract).map(a=>a.coin).join(" and ");
  mmAlertOwners({embeds:[kEmbed("Middleman","warn").setTitle("Middleman Wallet Is Low On Gas")
    .setDescription(`The middleman wallet has too little ${chain.native} on **${chain.name}** to pay the network fee of a payout, so ${coins} on ${chain.name} is not offered right now.\n\nSend a small amount of ${chain.native} to:\n\`\`\`${address}\`\`\`\nIt is picked up within a minute.`).setTimestamp()]});
}
// ── v18: the coin menu, the shortfall error, the start question ──────────────────────────────────────────────
// The coins the menu on the card offers (only the ones the bot can take right now are shown)
const MM_COIN_MENU=["SOL","ETH","USDT","USDC","BNB","POL","BTC","LTC"];
const mmMenuCoins=()=>MM_COIN_MENU.filter(c=>mmAssetsFor(c).length>0);
// "The wallet is short": says exactly what the wallet holds, what the payout needs and what is reserved for other deals (the owners see this text)
function mmShortError(job,have,need,owed){
  const dec=job.decimals==null?0:job.decimals,f=x=>`${mmFmtUnits(x,dec)} ${job.coin||""}`.trim();
  return new MmError("short",`the wallet holds ${f(have)} but this payout needs ${f(need)}${owed>0n?` plus ${f(owed)} that is reserved for other deals`:""}`,{have,need,owed});
}

// Starts (or shows again) the middleman on a ticket. opts.by = who confirmed it.
async function mmOpen(channel,ticket,opts){
  opts=opts||{};
  const cur=ticket.mmId?await mmGet(ticket.mmId):null;
  if(cur&&!MM_TERMINAL.has(cur.state)){await mmPostCard(channel,cur,{fresh:true});return {kind:"existing",e:cur};}
  if(cur&&cur.state==="released")return {kind:"done",e:cur};          // already paid out: the exchange is finished
  const plan=mmPlan(ticket);
  let why=null,assets=[];
  if(_mmMeta.paused)why="paused";
  else if(!plan.ok)why=plan.why;
  else if(plan.usd>_mmMeta.maxUsd)why="limit";
  else{
    assets=mmAssetsFor(plan.coin);
    if(!assets.length)why="coin";
    else{assets=await mmGasFilter(assets);if(!assets.length)why="gas";}
  }
  if(why)return mmOwnerFallback(channel,ticket,why);
  let e;
  try{
    const id=await MMDB.lock("seq",async()=>{const n=(Number(await MMDB.get("seq"))||0)+1;await MMDB.set("seq",n);return "MM-"+String(n).padStart(4,"0");});
    const now=Date.now();
    e={v:2,id,channelId:channel.id,guildId:channel.guild?channel.guild.id:null,clientId:ticket.userId,exchangerId:ticket.claimedBy,startedBy:opts.by||null,
      depositorId:plan.depositorId,recipientId:plan.recipientId,coin:plan.coin,usd:plan.usd,pays:plan.pays,hero:dealOf(ticket).hero,
      state:"net",chain:null,nets:assets.map(a=>a.chain),quotes:[],txs:[],watch:[],createdAt:now,updatedAt:now,log:[]};
    mmNote(e,"started",opts.by||null);
    await MMDB.set("e:"+id,e);_mmCache.set(id,e);
  }catch(err){
    console.error("[mm] open failed:",err.message);
    return mmOwnerFallback(channel,ticket,"error",err.message);
  }
  mmSaveTicket(channel.id,t=>{t.mmId=e.id;t.mmStage="net";delete t.mmOwner;delete t.mmAsk;});
  let note=null;
  if(assets.length===1){try{e=await mmArm(e.id,assets[0].chain);}catch(err){note=err instanceof MmError?err.message:"That network could not be prepared right now. Nothing was sent and nothing is lost.";if(!(err instanceof MmError))console.error("[mm] arm failed:",err.message);}}
  await mmPostCard(channel,e,{fresh:true,note});
  mmStage(e);
  log(channel.guild,`MM OPEN: #${channel.name} | ${e.id} | ${fmtUSD(e.usd)} ${e.coin} | depositor ${e.depositorId} | recipient ${e.recipientId}`);
  return {kind:"card",e};
}
// Fixes the network, the address and the amount to send (again, from a fresh price, for "Refresh Amount"). Not possible once a deposit has been seen.
async function mmArm(id,chainKey){
  const e0=await mmGet(id);
  if(!e0)throw new MmError("gone","That middleman deal no longer exists.");
  const asset=mmAsset(e0.coin,chainKey),address=asset?mmDepositAddress(chainKey):null;
  if(!asset||!address)throw new MmError("coin","That network isn't available for this coin right now. Nothing changed and nobody has lost anything. Pick another one from the menu.");
  if(e0.nets&&!e0.nets.includes(chainKey))throw new MmError("coin","That network isn't offered for this deal. Nothing changed. Pick one from the menu.");
  if((e0.txs||[]).length)throw new MmError("state","A deposit was already seen for this deal, so the amount and the network can't change any more. Nothing changed and your funds are safe.");
  if(asset.contract&&!(await mmTokenCheck(asset).catch(()=>false)))throw new MmError("token",`I couldn't verify ${asset.coin} on ${MM_CHAINS[chainKey].name} right now. Nothing changed. Try again in a moment or pick another network.`);
  const byBot=!!mmSigner(chainKey,address),isEvm=MM_CHAINS[chainKey].family==="evm";
  if(byBot&&isEvm&&asset.contract&&(await mmGasReady(chainKey,address))===false){
    mmGasLow(chainKey,address);
    throw new MmError("gas",`The middleman can't take ${asset.coin} on ${MM_CHAINS[chainKey].name} right now. Nothing changed. Pick another network or type \`$mm help\`.`);
  }
  const price=STABLE.has(asset.coin)?1:await Promise.race([getPrice(asset.coin),new Promise(r=>setTimeout(()=>r(null),8000))]).catch(()=>null);
  if(!(price>0))throw new MmError("price",`I can't get a live price for ${asset.coin} right now. Nothing changed. Try again in a moment.`);
  if(byBot&&isEvm&&!asset.contract){                                 // a native-coin payout pays its network fee out of the amount: refuse a network where that fee would eat the exchange
    const fee=await mmNativeFeeRaw(chainKey);
    if(fee!=null){
      const feeUsd=Number(fee)/Math.pow(10,asset.decimals)*price;
      if(feeUsd>Math.max(e0.usd*0.25,0.5))throw new MmError("fee",`The network fee on ${MM_CHAINS[chainKey].name} is about ${fmtUSD(feeUsd)} right now, which is too much for a ${fmtUSD(e0.usd)} exchange. Nothing changed. Pick another network.`);
    }
  }
  const dp=mmDisplayDp(asset,price),tick=mmPow10(asset.decimals-dp);
  return MMDB.lock("asset:"+mmAssetKey(asset),async()=>{
    const taken=new Set();              // every amount an open deal on this coin and address has been asked for: each stays one of a kind
    for(const [,x] of await MMDB.list("e:")){
      if(x.chain!==chainKey||(x.contract||null)!==(asset.contract||null)||!mmSameAddr(chainKey,x.address,address))continue;
      for(const q of x.quotes||[])taken.add(q.needRaw);
    }
    let need=null;
    for(let i=0;i<500&&need==null;i++){
      const raw=mmNeedRaw(e0.usd,price,asset,dp,1+Math.floor(Math.random()*(i<250?99:999)));
      if((raw/tick)%10n!==0n&&!taken.has(raw.toString()))need=raw;
    }
    if(need==null)throw new MmError("busy","There are too many open deals for that coin right now. Nothing changed. Try again in a minute.");
    return mmUpdate(id,e=>{
      if(e.state!=="net"&&e.state!=="await")throw new MmError("state","The deposit for this deal is already in. Nothing changed and your funds are safe.");
      if((e.txs||[]).length)throw new MmError("state","A deposit was already seen for this deal, so the amount and the network can't change any more. Nothing changed and your funds are safe.");
      const now=Date.now(),same=e.chain===chainKey;
      Object.assign(e,{chain:chainKey,contract:asset.contract||null,decimals:asset.decimals,dp,address,auto:mmIsAuto(chainKey,address),price,needRaw:need.toString(),quotedAt:now,quoteExp:now+MM_QUOTE_MS,state:"await"});
      e.quotes=(same?(e.quotes||[]):[]).concat([{needRaw:e.needRaw,at:now,exp:e.quoteExp}]).slice(-10);       // (amounts asked on another network or coin mean nothing here)
      e.watch=[];delete e.remindedAt;delete e.netSlow;
      if(!e.shownAt)e.shownAt=now;
      mmNote(e,`asked for ${mmAmt(e,e.needRaw,dp)} on ${chainKey}`);
    });
  });
}
// The coin menu: another coin (and so another network and address) until a deposit has been seen
async function mmSetCoin(id,coinRaw,by){
  const coin=mmCoinOf(coinRaw),cur=await mmFresh(id);
  if(!cur)throw new MmError("gone","That middleman deal no longer exists.");
  if(!MM_COIN_MENU.includes(coin))throw new MmError("coin","That coin isn't offered. Nothing changed. Pick one from the menu.");
  if(cur.coin===coin)return cur;
  let assets=mmAssetsFor(coin);
  if(!assets.length)throw new MmError("coin",`The middleman can't take ${coin} right now. Nothing changed and nobody has lost anything. Pick another coin, or type \`$mm help\`.`);
  assets=await mmGasFilter(assets);
  if(!assets.length)throw new MmError("gas",`The middleman can't pay the network fees for ${coin} right now. Nothing changed. Pick another coin, or type \`$mm help\`.`);
  await mmUpdate(id,x=>{
    if(x.state!=="net"&&x.state!=="await")throw new MmError("state","A deposit was already seen for this deal, so the coin can't change any more. Nothing changed and your funds are safe.");
    if((x.txs||[]).length||(x.watch||[]).length)throw new MmError("state","A deposit was already seen (or is being looked for), so the coin can't change. Nothing changed and your funds are safe.");
    const was=x.coin;
    x.coin=coin;x.nets=assets.map(a=>a.chain);x.state="net";x.chain=null;x.quotes=[];
    for(const k of ["contract","decimals","dp","address","auto","price","needRaw","quotedAt","quoteExp","remindedAt","netSlow"])delete x[k];
    mmNote(x,`coin changed from ${was} to ${coin}`,by);
  });
  if(assets.length===1)return mmArm(id,assets[0].chain);
  return mmFresh(id);
}

// ── "Use the server middleman?": both sides have to say yes before anything starts ───────────────────────────
const MM_PROMPT_REPOST_MS=60*1000;
const mmNeedsPrompt=t=>!t.mmRequired;                               // a claim that REQUIRED the middleman was already confirmed by both sides at the claim
function mmPromptPayload(t,state){
  const a=t.mmAsk||{ok:{}},ok=a.ok||{},C=`<@${t.userId}>`,X=`<@${t.claimedBy}>`,line=(who,uid)=>`${who}  ${ok[uid]?"**Confirmed**":"waiting"}`;
  const emb=kEmbed("Middleman",state==="start"?"ok":"brand").setTitle(state==="start"?"Middleman Confirmed":"Use The Server Middleman?")
    .setDescription(`${kHero(dealOf(t).hero)}\n${state==="start"?"Both of you confirmed. The middleman card is below.":"The server middleman holds the crypto until both sides are done, so nobody has to go first. Nothing is sent until you both press **Confirm**."}\n\n${line(C,t.userId)}\n${line(X,t.claimedBy)}`)
    .setFooter(kFoot("Built-in server middleman bot"));
  return {embeds:[emb],components:state?[]:[new ActionRowBuilder().addComponents(kBtn("mm_ok","Confirm",ButtonStyle.Success),kBtn("mm_no","No Thanks",ButtonStyle.Secondary))]};
}
// Posts the question (once; asking again within a minute does nothing, and later it comes back down as a fresh message)
async function mmPrompt(ch,ticket,by){
  const a=ticket.mmAsk;
  if(a&&a.msgId&&Date.now()-(a.shownAt||0)<MM_PROMPT_REPOST_MS)return {kind:"waiting"};
  const old=a&&a.msgId?await ch.messages.fetch(a.msgId).catch(()=>null):null,ok=(a&&a.ok)||{};
  const t=mmSaveTicket(ch.id,x=>{x.mmAsk={ok,by:(a&&a.by)||by||null,at:(a&&a.at)||Date.now(),shownAt:Date.now()};})||ticket;
  const need=[t.userId,t.claimedBy].filter(u=>u&&!ok[u]);
  const sent=await ch.send({content:need.map(u=>`<@${u}>`).join(" ")||undefined,...mmPromptPayload(t),allowedMentions:{users:need}}).catch(()=>null);
  if(sent)mmSaveTicket(ch.id,x=>{if(x.mmAsk)x.mmAsk.msgId=sent.id;});
  if(old)await old.edit({components:[]}).catch(()=>{});             // only the newest question can be answered
  return {kind:"asked"};
}
// Starts the deal now (a required middleman) or asks first. Returns what happened.
async function mmBegin(ch,ticket,by){
  if(!mmNeedsPrompt(ticket))return mmOpen(ch,ticket,{by});
  const cur=ticket.mmId?await mmGet(ticket.mmId):null;
  if(cur&&(!MM_TERMINAL.has(cur.state)||cur.state==="released"))return mmOpen(ch,ticket,{by});      // a deal is running (its card comes back down) or finished (reported)
  return mmPrompt(ch,ticket,by);                                    // none, or a cancelled / refunded one: a new deal needs both sides to say yes again
}

// A submitted transaction. Returns {status:"watch"|"rejected"|"confirming"|"funded"|"short"|"review", why?, e?}
async function mmSubmit(id,txid,by){
  const e=await mmGet(id);
  if(!e||!MM_WAITING.has(e.state))throw new MmError("state",e&&MM_HOLDING.has(e.state)?"The deposit for this deal is already in. Nothing changed and the funds are safe.":"This deal is not waiting for a deposit. Nothing changed.");
  const v=await mmVerifyTx(e.chain,mmAssetOf(e),e.address,txid);
  if(!v.found){
    await mmUpdate(id,x=>{if(x.state==="await"||x.state==="short"||x.state==="confirming")x.watch=(x.watch||[]).filter(w=>w.txid!==txid).concat([{txid,by,at:Date.now()}]).slice(-3);});
    return {status:"watch"};
  }
  return mmJudge(id,txid,v,by);
}
// What a deal has received so far (every deposit added up) and how that compares with what was asked.
//   ok = within MM_FULL_PCT percent of an amount the deal was asked for (it counts as the full amount) · short = less · over = more
function mmReceived(x){let t=0n;for(const tx of x.txs||[])if(tx&&tx.raw!=null)t+=BigInt(tx.raw);return t;}
function mmVerdict(x){
  const got=mmReceived(x),asks=(x.quotes||[]).map(q=>BigInt(q.needRaw)).filter(a=>a>0n),latest=BigInt(x.needRaw||"0");
  if(!asks.length||latest<=0n)return {kind:"ok",got,asked:got,diff:0n};
  for(const a of asks){const d=got>a?got-a:a-got;if(d*100n<=a*BigInt(MM_FULL_PCT))return {kind:"ok",got,asked:a,diff:0n};}
  return got<latest?{kind:"short",got,asked:latest,diff:latest-got}:{kind:"over",got,asked:latest,diff:got-latest};
}
// Runs INSIDE a deal update: once every deposit is final the deal becomes funded (or "short", when the deposits add up to less than was asked and nobody has
// called it off). Returns true when the state changed.
function mmSettle(x,now){
  if(x.state!=="confirming")return false;
  if(!(x.txs||[]).length||!x.txs.every(t=>t.final))return false;
  const v=mmVerdict(x);x.verdict=v.kind;x.askedRaw=v.asked.toString();x.gotRaw=v.got.toString();
  if(x.ref||v.kind!=="short"){
    x.state="funded";x.fundedAt=now||Date.now();
    mmNote(x,v.kind==="over"?`funds secured (overpaid by ${mmAmt(x,v.diff)})`:v.got!==v.asked?`funds secured (${mmAmt(x,v.got)}, asked ${mmAmt(x,v.asked)})`:"funds secured");
  }else{x.state="short";x.shortAt=now||Date.now();mmNote(x,`shortfall: ${mmAmt(x,v.got)} of ${mmAmt(x,v.asked)}`);}
  return true;
}
async function mmJudge(id,txid,v,by){
  const e0=await mmGet(id);
  const drop=async why=>{await mmUpdate(id,x=>{x.watch=(x.watch||[]).filter(w=>w.txid!==txid);}).catch(()=>{});return {status:"rejected",why};};
  if(v.ok===false)return drop("failed");
  if(v.self)return drop("self");
  if(!v.toUs)return drop(v.viaContract?"contract":"notus");
  const amt=v.amountRaw.toString();
  for(const [,x] of await MMDB.list("e:")){                       // an amount that was asked of a DIFFERENT open deal is that deal's payment, whoever pastes it
    if(x.id===id||x.chain!==e0.chain||(x.contract||null)!==(e0.contract||null)||!mmSameAddr(e0.chain,x.address,e0.address))continue;
    if((x.quotes||[]).some(q=>q.needRaw===amt)){
      mmAlertOwners({embeds:[kEmbed("Middleman","bad").setTitle("Payment Claimed By The Wrong Deal").setDescription(`${by?`<@${by}> submitted`:"The bot found"} a payment on **${e0.id}** that matches the amount asked of **${x.id}**. It was refused.\n\`${txid}\``).setTimestamp()],components:mmLinkRow(e0)});
      return drop("other");
    }
  }
  const key=`tx:${e0.chain}:${txid}`;
  if(!(await MMDB.add(key,{id,at:Date.now()}))){
    const prev=await MMDB.get(key);
    if(!prev||prev.id!==id)return drop("used");
    if(prev.refused)return drop("refused");
  }
  if(v.blockTime!=null&&v.blockTime*1000<(e0.shownAt||e0.createdAt)-MM_EARLY_MS){await MMDB.del(key).catch(()=>{});return drop("early");}      // sent before this deal showed its address: it is not this deal's
  let final=v.final;
  if(final&&!(await mmSecondOpinion(e0,txid,amt)))final=false;
  const e=await mmUpdate(id,x=>{
    if(x.state!=="await"&&x.state!=="short"&&x.state!=="confirming")throw new MmError("state","The deposit for this deal is already in.");
    if((x.txs||[]).some(t=>t.txid===txid)){x.watch=[];return;}                  // counted already
    const now=Date.now();
    x.txs=(x.txs||[]).concat([{txid,raw:amt,from:v.from||null,at:now,by:by||null,via:by?"paste":"auto",blockTime:v.blockTime||null,mined:!!v.mined,conf:v.conf||0,final:!!final}]).slice(-12);
    x.gotRaw=mmReceived(x).toString();x.watch=(x.watch||[]).filter(w=>w.txid!==txid);x.doubts=0;x.missing=0;delete x.netSlow;
    const big=(x.txs||[]).filter(t=>t&&t.from&&t.raw!=null).reduce((m,t)=>!m||BigInt(t.raw)>BigInt(m.raw)?t:m,null);      // the wallet the money came from (the biggest deposit's): where a refund can go with one click
    if(big)x.sender=mmNormAddress(x.chain,big.from)||x.sender||null;
    delete x.shortAt;
    x.state="confirming";mmNote(x,`deposit ${txid} seen: ${mmAmt(x,amt)}`,by);mmSettle(x,now);
  });
  return {status:e.state,e};
}

// Before a deposit counts, a second node is asked the same question. true = it agrees, or no second node could be asked. false = it does not (yet) agree.
async function mmSecondOpinion(e,txid,amt){
  if(mmRpcUrls(e.chain).length<2)return true;
  let v;
  try{v=await mmVerifyTx(e.chain,mmAssetOf(e),e.address,txid,{start:1,one:true});}catch{return true;}
  return !!(v&&v.found&&v.ok===true&&v.toUs&&v.final&&v.amountRaw.toString()===amt);
}
function mmWhyText(e,why){
  const net=mmNetOf(e);
  return ({
    failed:"That transaction failed on the network, so nothing arrived and nothing was lost. Send it again; I spot the new transaction by myself.",
    self:"That transaction was sent by the middleman wallet itself, so it is not a deposit.",
    notus:`That transaction doesn't send ${e.coin} on ${net} to the middleman address. Check the coin, the network and the address. Nothing was lost and your funds are safe.`,
    contract:"That transaction went through a contract (some exchanges send this way), so I can't read it myself. Type `$mm help` and an owner will confirm it by hand.",
    other:"That payment belongs to a different deal.",used:"That transaction was already used for another deal.",refused:"An owner already refused that transaction for this deal.",
  })[why]||"That transaction can't be used for this deal.";
}
const MM_REVIEW_TEXT={
  amount:"The amount on the network no longer matches what was recorded for this deposit.",early:"The payment was sent before this deal started.",late:"The payment arrived long after the amount was quoted.",
  nodes:"The network's nodes did not agree about this payment.",vanished:"The payment can no longer be found on the network.",
};

// ── Paying out ──────────────────────────────────────────────────────────────────────────────────────────────
// Why a payout can't be decided right now, in plain words (every answer says that nothing changed)
function mmStateWhy(x){
  if(MM_TERMINAL.has(x.state))return "This deal is already finished. Nothing changed.";
  if(x.state==="sending"||x.state==="payout"||x.state==="stuck")return "A payout is already running for this deal. Nothing changed and the funds are safe.";
  return "The funds are not secured yet. Nothing changed and nobody has lost anything. Wait for **Funds Secured**.";
}
// What the wallet at this deal's address is holding for OTHER deals on the same network (their coin must never pay this one out).
// Only deposits the bot has read on the chain are reserved: a deposit an owner confirmed by hand may never have arrived, and must not block the others.
async function mmOwed(e){
  let native=0n,token=0n;
  for(const [,x] of await MMDB.list("e:")){
    if(x.id===e.id||x.chain!==e.chain||!x.gotRaw||!MM_HOLDING.has(x.state)||!mmSameAddr(e.chain,x.address,e.address))continue;
    let real=0n;for(const t of x.txs||[])if(t&&t.mined&&!t.hand&&t.raw!=null)real+=BigInt(t.raw);
    if(real<=0n)continue;
    if(x.contract){if(x.contract===(e.contract||null))token+=real;}
    else native+=real;
  }
  return {native,token};
}
// What every deal that holds funds on this address has recorded, hand-confirmed ones included (for reports and sweeps, which must be careful rather than quick)
async function mmReservedAll(chainKey,address,contract){
  let total=0n;const deals=[];
  for(const [,x] of await MMDB.list("e:")){
    if(x.chain!==chainKey||!x.gotRaw||!MM_HOLDING.has(x.state)||!mmSameAddr(chainKey,x.address,address)||(x.contract||null)!==(contract||null))continue;
    total+=BigInt(x.gotRaw);deals.push({id:x.id,raw:x.gotRaw,hand:(x.txs||[]).some(t=>t&&t.hand),state:x.state});
  }
  return {total,deals};
}
// A pasted address has to be confirmed by whoever pasted it (deals made from v18 on). A refund "to sender" and anything an owner sets counts as confirmed.
function mmNeedsAddrOk(x,kind,to){
  if((x.v||1)<2)return false;                                     // deals from before v18 pay out as they always did
  return (kind==="release"?x.payoutOk:x.refundOk)!==mmAddrTag(to);
}
// Marks the deal as paying out. Nothing is sent here: mmDrive does that (or an owner, for a watch-only wallet).
// opts.owner = an owner is doing it · opts.force = ignore what the wallet holds for other deals · opts.to = pay this address instead
async function mmStartPayout(id,kind,by,opts){
  opts=opts||{};
  return mmUpdate(id,x=>{
    if(x.state!=="funded")throw new MmError("state",mmStateWhy(x));
    if(x.dispute&&!opts.owner)throw new MmError("dispute","This deal is in dispute. Nothing was sent and the funds are safe. Only an owner can release or refund it now.");
    const to=opts.to||(kind==="release"?x.payout:x.refundTo);
    if(!to)throw new MmError("address",kind==="release"?"The payout address is not set yet. Nothing was sent and the funds are safe. The receiver pastes their address in the chat.":"The refund address is not set yet. Nothing was sent and the funds are safe. The sender pastes their address in the chat.");
    if(opts.tag&&mmAddrTag(to)!==opts.tag)throw new MmError("changed","The address changed since you opened this. Nothing was sent and the funds are safe. Check it and press the button again.");
    if(!opts.owner&&mmNeedsAddrOk(x,kind,to))throw new MmError("confirm","The address still has to be confirmed. Nothing was sent and the funds are safe.");
    x.out={kind,to,by,at:Date.now(),amountRaw:x.gotRaw,attempts:0,txids:[]};
    if(opts.force)x.out.force=true;
    x.state=mmSigner(x.chain,x.address)?"sending":"payout";
    delete x.retryAt;
    mmNote(x,`${kind} to ${to}${x.state==="payout"?" (an owner sends it)":""}${opts.force?" (forced by an owner)":""}`,by);
  });
}
async function mmFinish(id,txid,how){
  return mmUpdate(id,x=>{
    if(MM_TERMINAL.has(x.state))return;
    x.out=x.out||{kind:"release"};
    x.out.txid=txid||x.out.txid||null;x.out.doneAt=Date.now();if(how)x.out.how=how;
    x.state=x.out.kind==="refund"?"refunded":"released";
    delete x.payFail;delete x.retryAt;delete x.netSlow;
    mmNote(x,`${x.state}${txid?" "+txid:""}${how?" ("+how+")":""}`);
  });
}

// Has this account's nonce been used by a transaction that is not ours? (Then ours can never be mined.) Asked of one node at a time, twice, so a node that is behind cannot say yes.
async function mmEvmNonceDead(e,t){
  const from=e.address,urls=mmRpcUrls(e.chain);
  for(let i=0;i<urls.length;i++){
    try{
      const o={start:i,one:true};
      const used=Number(BigInt(await mmRpc(e.chain,"eth_getTransactionCount",[from,"latest"],o)))>Number(t.nonce);
      if(!used)continue;
      if(await mmRpc(e.chain,"eth_getTransactionReceipt",[t.txid],o))return false;
      await _mmSleep(Math.min(MM_POLL_MS*2,4000));
      if(await mmRpc(e.chain,"eth_getTransactionReceipt",[t.txid],{nullNext:true}))return false;
      return true;
    }catch{}
  }
  return false;
}
async function mmOneStatus(e,t){
  if(MM_CHAINS[e.chain].family==="evm"){
    const rc=await mmRpc(e.chain,"eth_getTransactionReceipt",[t.txid],{nullNext:true});
    return rc?(rc.status==="0x1"?"landed":"failed"):"pending";
  }
  return mmSentStatus({chain:e.chain,out:{txid:t.txid,lastValid:t.lastValid}});
}
// Carries a payout forward from wherever it is: nothing sent yet, sent and waiting, landed, failed. Safe to call any number of times, from a button or the
// background sweep, on any copy of the bot: one caller at a time per deal, and the deal is read fresh from storage each time.
// opts.retry (an owner): send again -- on Ethereum-family networks with the SAME nonce and a higher fee (so only one of them can ever be mined).
async function mmDrive(id,opts){
  opts=opts||{};
  return MMDB.lock("drive:"+id,async()=>{
    let e=await mmFresh(id);
    if(!e||(e.state!=="sending"&&!(opts.retry&&e.state==="stuck")))return e;
    const fam=MM_CHAINS[e.chain].family,o=e.out,sent=o.txids||[];
    let nonce=null,minGas=null,again=sent.length===0;
    if(sent.length){
      let pending=null,failed=null;
      for(const t of sent){
        const st=await mmOneStatus(e,t);
        if(st==="landed"){e=await mmFinish(id,t.txid);await mmAnnounceDone(e);return e;}
        if(st==="failed")failed=t;else if(st==="pending")pending=t;
      }
      const last=sent[sent.length-1];
      if(pending){
        if(fam==="evm"&&(await mmEvmNonceDead(e,pending))){again=true;}        // something else used that nonce: ours is dead, a new one is safe
        else if(opts.retry&&fam==="evm"){again=true;nonce=Number(pending.nonce);minGas=(BigInt(pending.gasPrice||"0")*13n/10n+1n).toString();}
        else{
          await mmRebroadcast({chain:e.chain,out:{raw:last.raw}});
          if(e.state==="sending"&&Date.now()-last.at>MM_REBROADCAST_MS){e=await mmUpdate(id,x=>{if(x.state==="sending"){x.state="stuck";x.out.problem="The transaction has been waiting on the network for a long time.";}});await mmAnnounceStuck(e);}
          return e;
        }
      }else if(failed){
        if(!opts.retry){
          if(e.state!=="stuck"){e=await mmUpdate(id,x=>{if(x.state==="sending"){x.state="stuck";x.out.problem="The network refused the transfer.";}});await mmAnnounceStuck(e);}
          return e;
        }
        again=true;
      }else again=true;                                           // every earlier attempt is gone for good (Solana: its time window passed)
    }
    if(!again)return e;
    if(sent.length&&nonce==null)e=await mmUpdate(id,x=>{x.out.dead=(x.out.dead||[]).concat((x.out.txids||[]).map(t=>t.txid)).slice(-12);x.out.txids=[];});      // every earlier attempt is finished for good (failed, expired, or its nonce was used by something else)
    const signer=mmSigner(e.chain,e.address);
    if(!signer){e=await mmUpdate(id,x=>{if(x.state==="sending"||x.state==="stuck")x.state="payout";});await mmAnnouncePayout(e);return e;}
    if(e.state==="stuck")e=await mmUpdate(id,x=>{if(x.state==="stuck"){x.state="sending";delete x.out.problem;}});
    let signed=false;
    const onSigned=async s=>{
      const d=await mmUpdate(id,x=>{
        x.out.txids=(x.out.txids||[]).concat([{txid:s.hash,raw:s.raw,nonce:s.nonce==null?null:s.nonce,gasPrice:s.gasPrice||null,lastValid:s.lastValid==null?null:s.lastValid,at:Date.now()}]);
        x.out.sentRaw=s.sentRaw;x.out.feeRaw=s.feeRaw;
        mmNote(x,`signed ${s.hash}`);
      });
      signed=true;
      mmScanPoke(d);
      mmPayLog(d,"sent");
    };
    const job={chainKey:e.chain,signer,to:o.to,contract:e.contract||null,amountRaw:BigInt(o.amountRaw),coin:e.coin,decimals:e.decimals,owed:o.force?{native:0n,token:0n}:await mmOwed(e),nonce,minGasPrice:minGas};
    try{
      const r=await (fam==="evm"?mmSendEvm(job,onSigned):mmSendSol(job,onSigned));
      mmNodeOk(e.chain);
      if(r.confirmed){e=await mmFinish(id,r.hash);await mmAnnounceDone(e);return e;}
      return mmFresh(id);                                         // sent, not confirmed yet: the sweep follows it
    }catch(err){
      const code=err instanceof MmError?err.code:"error",msg=String(err.message||err).slice(0,240);
      if(!(err instanceof MmError))console.error("[mm] send error:",msg);
      if(code==="rpc")mmNodeFail(e.chain);
      if(signed){
        // A signed transaction exists, so from here the deal only moves forward: it is followed (and sent again as the same transaction) until it lands
        if(code==="reverted"){e=await mmUpdate(id,x=>{if(x.state==="sending"){x.state="stuck";x.out.problem="The network refused the transfer.";}});await mmAnnounceStuck(e);return e;}
        e=await mmUpdate(id,x=>{x.out.lastError=`${code}: ${msg}`;});
        if(code==="no_gas")mmGasAlert(e,err);
        return e;
      }
      const retryable=code!=="bad_recipient"&&code!=="dust";
      e=await mmUpdate(id,x=>{
        if(x.state!=="sending")return;
        x.out.attempts=(x.out.attempts||0)+1;x.out.lastError=`${code}: ${msg}`;x.out.nextAt=Date.now()+MM_PAY_GAP_MS;
        if((x.out.txids||[]).length){x.state="stuck";x.out.problem="A new attempt could not be made while an earlier transaction is still waiting on the network.";return;}     // an earlier transaction could still land: never offer Release again
        if(!retryable||x.out.attempts>=MM_PAY_TRIES){
          const was=x.payFail&&x.payFail.code===code&&x.payFail.announced;
          x.lastOut={...x.out};x.state="funded";delete x.out;x.retryAt=Date.now()+MM_RETRY_MS;
          x.payFail={code,msg:x.lastOut.lastError,at:Date.now(),tries:x.lastOut.attempts,announced:!!was};
          mmNote(x,`could not send (${code})`);
        }
      });
      if(e.state==="stuck"){await mmAnnounceStuck(e);return e;}
      if(e.state==="funded")await mmAnnounceSendFailed(e,code,err);
      else if(e.state==="sending"){const ch=await mmChannelOf(e);if(ch)await mmRefreshCard(ch,e).catch(()=>{});}      // the card says the try did not go through, how many tries are left, and that the funds are safe
      return e;
    }
  });
}
function mmGasAlert(e,err){
  const chain=MM_CHAINS[e.chain];
  mmAlertOwners({embeds:[kEmbed("Middleman","warn").setTitle("Middleman Wallet Needs Gas")
    .setDescription(`A payout on **${chain.name}** is waiting because the middleman wallet is out of ${chain.native} for network fees.\n\nSend a little ${chain.native}${err&&err.needRaw?` (at least ${mmFmtUnits(err.needRaw,chain.decimals)} more)`:""} to:\n\`\`\`${e.address}\`\`\`\nThe payout continues by itself once it arrives, or press Retry Payout once it has.`).setTimestamp()],components:mmLinkRow(e,[kBtn(`mm_x__kick__${e.id}`,"Retry Payout",ButtonStyle.Success)])});
}
const MM_SEND_FAIL_TEXT={
  no_gas:"The middleman wallet is out of gas for the network fee. The owners have been told, and it is tried again by itself once they have topped it up.",
  bad_recipient:"The receiving address refused the transfer, so it needs a different one.",
  dust:"The amount is smaller than the network fee, so it can't be sent on its own.",
  short:"The middleman wallet is short of the full amount for the moment.",
  rpc:"The network is not answering right now.",
};
// Called when a payout failed for good this round (five tries, 20 seconds apart). The ticket is told once, the owners once (with a Retry button);
// after that the bot keeps trying by itself every few minutes and stays quiet.
async function mmAnnounceSendFailed(e,code,err){
  const ch=await mmChannelOf(e),pf=e.payFail||{},lo=e.lastOut||{};
  if(code==="bad_recipient"){                                       // that address can't take the transfer: it is dropped and asked for again
    const x=await mmUpdate(e.id,y=>{const k=(y.lastOut&&y.lastOut.kind)||(y.ref&&!y.rel?"refund":"release");if(k==="refund"){delete y.refundTo;delete y.refundOk;}else{delete y.payout;delete y.payoutOk;}delete y.payFail;delete y.retryAt;y.autoTries=0;}).catch(()=>e);
    if(ch){await mmRefreshCard(ch,x);await mmAskAddress(ch,x,{reason:"The network refused that address, so nothing was sent and the funds are safe."});}
    return;
  }
  const first=!pf.announced;
  if(first)await mmUpdate(e.id,x=>{if(x.payFail)x.payFail.announced=true;}).catch(()=>{});
  const text=MM_SEND_FAIL_TEXT[code]||"The network could not carry out the transfer.";
  if(ch){
    await mmRefreshCard(ch,e);
    if(first)await ch.send({embeds:[mmEmb(e,"warn","Not Sent Yet").setDescription(`Nothing left the middleman, and the funds are still secured.\n${text}\nThe owners have been told. I keep trying by myself, so you don't need to do anything.`).setFooter(kFoot(e.id))]}).catch(()=>{});
  }
  if(first){
    mmAlertOwners({embeds:[kEmbed("Middleman","bad").setTitle("Middleman Payout Did Not Send").setDescription(`**${e.id}** · the ${lo.kind||"release"} of ${mmAmt(e,lo.amountRaw||e.gotRaw)} to \`${lo.to||"?"}\` failed ${lo.attempts||MM_PAY_TRIES} times in a row.\n**Reason:** ${String(pf.msg||lo.lastError||code).slice(0,400)}\n\nThe funds are safe in the wallet. The bot tries again every ${Math.round(MM_RETRY_MS/60000)} minutes by itself; press **Retry Payout** to try right now.`).setTimestamp()],
      components:mmLinkRow(e,[kBtn(`mm_x__kick__${e.id}`,"Retry Payout",ButtonStyle.Success)])});
    if(code==="no_gas")mmGasAlert(e,err);
  }
}

async function mmAnnounceStuck(e){
  const ch=await mmChannelOf(e),o=e.out||{},last=(o.txids||[])[(o.txids||[]).length-1];
  if(ch){
    await mmRefreshCard(ch,e);
    await ch.send({content:CONFIG.OWNER_IDS.map(id=>`<@${id}>`).join(" "),embeds:[mmEmb(e,"bad","An Owner Is Needed").setDescription(`The payout for this deal did not finish by itself. ${o.problem||""}\n\nThe funds are accounted for and safe, and an owner will complete it here. Nobody needs to send anything.`).setFooter(kFoot(e.id))],allowedMentions:{users:CONFIG.OWNER_IDS}}).catch(()=>{});
  }
  mmAlertOwners({embeds:[kEmbed("Middleman","bad").setTitle("Middleman Payout Needs You").setDescription(`**${e.id}** · ${o.kind||"release"} of ${mmAmt(e,o.amountRaw||e.gotRaw)} to \`${o.to}\`\n${o.problem||""}${last?`\nLast transaction: \`${last.txid}\``:""}\n\nPress **Retry Payout** (it sends again safely), or pay it by hand and type \`$mm sent <transaction id>\` in the ticket. \`$mm panel\` shows everything.`).setTimestamp()],components:mmLinkRow(e,[kBtn(`mm_x__kick__${e.id}`,"Retry Payout",ButtonStyle.Success)])});
}
async function mmAnnouncePayout(e){
  const ch=await mmChannelOf(e),o=e.out||{};
  const what=`**${mmAmt(e,o.amountRaw)}** on ${mmNetOf(e)}`;
  if(ch){
    await mmRefreshCard(ch,e);
    await ch.send({content:CONFIG.OWNER_IDS.map(id=>`<@${id}>`).join(" "),embeds:[mmEmb(e,"brand",o.kind==="refund"?"Refund Requested":"Release Requested").setDescription(`An owner sends this one by hand: ${what} to <@${o.kind==="refund"?e.depositorId:e.recipientId}>. The funds are safe in the meantime.\n\`\`\`${o.to}\`\`\`\nOwners: send it, then type \`$mm sent <transaction id>\` here (or **Help**, **Owner Controls**, **Mark Sent**).`).setFooter(kFoot(e.id))],allowedMentions:{users:CONFIG.OWNER_IDS}}).catch(()=>{});
  }
  mmAlertOwners({embeds:[kEmbed("Middleman","warn").setTitle(o.kind==="refund"?"Send A Middleman Refund":"Send A Middleman Release").setDescription(`**${e.id}** · send ${what} to:\n\`\`\`${o.to}\`\`\`\nThen open the ticket and type \`$mm sent <transaction id>\`.`).setTimestamp()],components:mmLinkRow(e)});
}
// The receipt: amount, transaction, both parties, how long it took
function mmReceiptEmbed(e){
  const o=e.out||{},refund=e.state==="refunded",sent=o.sentRaw||o.amountRaw||e.gotRaw||"0";
  const emb=mmEmb(e,refund?"mute":"ok",refund?"Funds Refunded":"Funds Released")
    .setDescription(kHero(`${mmAmt(e,sent)} → ${refund?"refunded":"released"}`))
    .addFields({name:"Amount",value:mmAmt(e,sent),inline:true},{name:"Network",value:mmNetOf(e),inline:true},{name:"Time taken",value:mmTook(e),inline:true},
      {name:"Sender",value:`<@${e.depositorId}>`,inline:true},{name:"Receiver",value:`<@${e.recipientId}>`,inline:true},{name:"Transaction",value:o.txid?mmTxLink(e,o.txid):"sent by hand",inline:true},
      {name:refund?"Refunded to address":"Released to address",value:"```"+(o.to||"unknown")+"```",inline:false});
  if(o.feeRaw&&!e.contract&&o.sentRaw)emb.addFields({name:"Network fee",value:mmAmt(e,o.feeRaw),inline:true});
  return emb.setFooter(kFoot(`Built-in server middleman bot  ·  ${e.id}`)).setTimestamp();
}
// Released or refunded: the card, one receipt (in the ticket, and as a DM to both sides), and (after a release) the usual "confirm completion" step
async function mmAnnounceDone(e){
  const ch=await mmChannelOf(e),o=e.out||{},refund=e.state==="refunded",sent=o.sentRaw||o.amountRaw||e.gotRaw;
  mmStage(e);
  mmPayLog(e,"confirmed");
  const receipt=mmReceiptEmbed(e);
  if(e.kind){for(const u of new Set([e.depositorId]))mmDm(u,{embeds:[receipt]});return;}          // an owner's sweep or return: only the owner who asked hears about it
  for(const u of new Set([e.depositorId,e.recipientId]))mmDm(u,{embeds:[receipt]});
  if(!ch)return;
  await mmRefreshCard(ch,e);
  await ch.send({content:`<@${e.depositorId}> <@${e.recipientId}>`,embeds:[receipt],allowedMentions:{users:[e.depositorId,e.recipientId]}}).catch(()=>{});
  log(ch.guild,`MM ${refund?"REFUND":"RELEASE"}: #${ch.name} | ${e.id} | ${mmAmt(e,sent)} -> ${o.to} | ${o.txid||"by hand"}`);
  if(!refund){
    const tickets=Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets"),t=tickets[ch.id];
    if(t&&t.status==="open"&&t.claimedBy&&!t.completionPending&&!t.reported)await requestCompletion(ch,t,tickets).catch(()=>{});
  }
}
// The deposit is confirmed: tell both sides what happens next
async function mmAnnounceFunded(e){
  if(e.ref&&!e.rel&&!e.out){                                         // a refund was decided before the deposit was final: it goes ahead now
    mmStage(e);
    await mmGoPayout(e.id,"refund",(e.ref&&e.ref.by)||"auto",{owner:!!(e.ref&&e.ref.by&&isOwner(e.ref.by)),ask:true,again:true}).catch(err=>{if(!(err instanceof MmError))console.error("[mm] refund after funding:",err.message);});
    return;
  }
  const ch=await mmChannelOf(e);
  mmStage(e);
  if(!ch)return;
  await mmRefreshCard(ch,e);
  const v=mmVerdict(e);
  const extra=v.kind==="over"?`\n**Overpaid by ${mmAmt(e,v.diff)}.** All of it is held, and a release sends all of it.`
    :e.accepted?`\n<@${e.accepted.by}> accepted the shortfall (received ${mmAmt(e,v.got)} of ${mmAmt(e,v.asked,e.dp)}).`
    :v.got!==v.asked?`\nReceived ${mmAmt(e,v.got)} (asked ${mmAmt(e,v.asked,e.dp)}).`:"";
  await ch.send({content:`<@${e.recipientId}> <@${e.depositorId}>`,embeds:[mmEmb(e,"ok","Funds Secured")
    .setDescription(`${kHero(`${mmAmt(e,e.gotRaw)} held`)}${extra}\n<@${e.recipientId}>, it is safe to pay now: send <@${e.depositorId}> the **${e.pays}** side of this exchange${e.payout?".":`, and paste your **${e.coin}** address in this chat.`}\n<@${e.depositorId}>, once you have it **in full**, press **Release Funds** on the card.`)
    .setFooter(kFoot(`Built-in server middleman bot  ·  ${e.id}`)).setTimestamp()],allowedMentions:{users:[e.recipientId,e.depositorId]}}).catch(()=>{});
  log(ch.guild,`MM FUNDED: #${ch.name} | ${e.id} | ${mmAmt(e,e.gotRaw)} | ${(e.txs[0]||{}).txid||"by hand"}`);
}
// Less than asked arrived (and nobody has called it off): the card becomes the Shortfall card, as a new message that pings both sides
async function mmAnnounceShort(e){
  const ch=await mmChannelOf(e);
  mmStage(e);
  if(!ch)return;
  await mmPostCard(ch,e,{fresh:true,ping:[e.recipientId,e.depositorId]});
  const v=mmVerdict(e);
  log(ch.guild,`MM SHORT: #${ch.name} | ${e.id} | ${mmAmt(e,v.got)} of ${mmAmt(e,v.asked,e.dp)}`);
}
async function mmAnnounceReview(e){
  const ch=await mmChannelOf(e),r=e.review||{},why=MM_REVIEW_TEXT[r.reason]||"This deposit needs a second look.";
  mmStage(e);
  const detail=`Asked for **${mmAmt(e,e.needRaw,e.dp)}** · arrived **${mmAmt(e,e.gotRaw)}**${r.txid?` · ${mmTxLink(e,r.txid)}`:""}`;
  if(ch){
    await mmRefreshCard(ch,e);
    await ch.send({content:CONFIG.OWNER_IDS.map(id=>`<@${id}>`).join(" "),embeds:[mmEmb(e,"warn","An Owner Is Checking The Deposit").setDescription(`${why}\n${detail}\n\nAn owner will confirm it here. Nobody needs to send anything else for now, and your funds are safe.`).setFooter(kFoot(e.id))],allowedMentions:{users:CONFIG.OWNER_IDS}}).catch(()=>{});
  }
  const tx=(e.txs||[]).find(t=>t.txid===r.txid)||(e.txs||[])[0]||{};
  mmAlertOwners({content:CONFIG.OWNER_IDS.map(id=>`<@${id}>`).join(" "),embeds:[kEmbed("Middleman","warn").setTitle("Middleman Deposit To Check").setDescription(`**${e.id}** · <@${e.depositorId}> → <@${e.recipientId}>\n${why}\n${detail}\nFrom: \`${tx.from||"unknown"}\`\n\n**Approve** only if this payment really is this deal's deposit (and not, for example, your own top-up of the wallet).`).setTimestamp()],
    components:mmLinkRow(e,[kBtn(`mm_x__approve__${e.id}`,"Approve Deposit",ButtonStyle.Success),kBtn(`mm_x__reject__${e.id}`,"Reject Deposit",ButtonStyle.Danger)])});
}
// Keeps the ticket card's status row in step with the middleman
function mmStage(e){
  if(!e.channelId)return;
  const t=mmSaveTicket(e.channelId,x=>{if(x.mmId===e.id)x.mmStage=e.state;});
  if(t)mmChannelOf(e).then(ch=>{if(ch)refreshTicketCard(ch,t).catch(()=>{});}).catch(()=>{});
}
const MM_STAGE_TEXT={net:"Middleman: choosing network",await:"Middleman: waiting for deposit",confirming:"Middleman: confirming deposit",review:"Middleman: owner checking deposit",short:"Middleman: shortfall, waiting for a choice",funded:"Middleman: funds secured",
  sending:"Middleman: sending",payout:"Middleman: owner sending",stuck:"Middleman: owner needed",released:"Middleman: released",refunded:"Middleman: refunded",owner:"Owner middleman"};
// "What happens next" on the ticket card while a middleman is running
const MM_NEXT_TEXT={
  net:"1. The sender picks the coin and the network on the middleman card.\n2. The bot shows the address and the amount.\n3. Nothing is sent to each other directly.",
  await:"1. The sender sends the amount shown to the address on the card (a little off is fine). The bot spots it by itself.\n2. The bot confirms it on the blockchain.\n3. The other side pays only after it says Funds Secured.",
  confirming:"The deposit is on its way. Wait for Funds Secured before paying anything.",
  review:"An owner is checking the deposit. Nobody needs to send anything else for now.",
  short:"Less than the asked amount arrived. The receiver presses Continue to accept it or Refund to send it back, or the sender sends the rest.",
  funded:"1. The other side pays now and pastes their address in the chat.\n2. Once the payment arrived in full, the sender presses Release Funds.\n3. The bot sends the crypto on.",
  sending:"The payout is on its way. This card updates when the network confirms it.",
  payout:"An owner is sending the payout by hand. This card updates when it is sent.",
  stuck:"An owner is finishing the payout. Nobody needs to send anything.",
  owner:"A Konvert owner is acting as the middleman here. Don't send anything until they say so.",
};

// ── The middleman card ──────────────────────────────────────────────────────────────────────────────────────
// One live card per deal, edited in place (a new message only when something needs attention): the coin's logo, "SOL · Solana" in the title, a progress line, and
// at most two buttons. Menus (coin, network) are not buttons, so they sit above them.
const MM_TITLE={net:"Choose The Network",await:"Send The Deposit",confirming:"Deposit Seen",review:"Owner Check",short:"Shortfall Detected",funded:"Funds Secured",sending:"Sending",payout:"An Owner Is Sending",stuck:"An Owner Is Needed",released:"Released",refunded:"Refunded",cancelled:"Cancelled"};
const MM_TONE={net:"brand",await:"brand",confirming:"brand",review:"warn",short:"warn",funded:"ok",sending:"brand",payout:"brand",stuck:"bad",released:"ok",refunded:"mute",cancelled:"mute"};
// The title also says when a release or a refund is decided and only the address is missing
const mmTitleOf=e=>e.state==="funded"&&e.rel?"Released: Waiting For The Address":e.state==="funded"&&e.ref?"Refund: Waiting For The Address":(MM_TITLE[e.state]||e.state);
// Step 1 Send Deposit · 2 Deposit Seen · 3 Funds Secured · 4 Released (or Refunded)
function mmStepOf(e){
  const s=e.state;
  if(s==="net"||s==="await")return 1;
  if(s==="confirming"||s==="review"||s==="short")return 2;
  if(s==="funded")return 3;
  if(s==="sending"||s==="payout"||s==="stuck")return 4;
  if(s==="released"||s==="refunded")return 5;
  return 0;
}
function mmProgress(e){
  const n=mmStepOf(e);if(!n)return "";
  const refund=e.state==="refunded"||(e.out&&e.out.kind==="refund")||(e.state==="funded"&&!!e.ref&&!e.rel);
  const names=["Send Deposit","Deposit Seen","Funds Secured",refund?"Refunded":"Released"],cur=Math.min(n,4);
  const label=n===5?"Done":n===4?"Sending":names[cur-1];
  return `Step ${cur} of 4  ·  ${label}\n${names.map((x,i)=>i+1===cur?`**${x}**`:x).join("  ›  ")}`;
}
// "Received X (asked Y)" · "Overpaid by Z" (nothing before a deposit was seen)
function mmRecvLine(e){
  if(!(e.txs||[]).length)return "";
  const v=mmVerdict(e);
  if(v.kind==="over")return `Received **${mmAmt(e,v.got)}** (asked ${mmAmt(e,v.asked,e.dp)})  ·  **Overpaid by ${mmAmt(e,v.diff)}**`;
  if(v.got!==v.asked)return `Received **${mmAmt(e,v.got)}** (asked ${mmAmt(e,v.asked,e.dp)})`;
  return `Received **${mmAmt(e,v.got)}**`;
}
// "Deposit seen, confirming (2 of 5)" for every payment that is not final yet
function mmConfLine(e){
  const N=MM_CHAINS[e.chain].confs,todo=(e.txs||[]).filter(t=>!t.final);
  return todo.map(t=>`Deposit seen, confirming (${Math.min(t.conf||0,N)} of ${N})${t.txid?`  ·  ${mmTxLink(e,t.txid)}`:""}`).join("\n");
}
const mmTook=e=>{
  const ms=Math.max(0,((e.out&&e.out.doneAt)||Date.now())-(e.createdAt||Date.now())),s=Math.round(ms/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60);
  return h?`${h} h ${m} min`:m?`${m} min ${s%60} s`:`${s} s`;
};
function mmCardEmbed(e,note){
  const D=`<@${e.depositorId}>`,R=`<@${e.recipientId}>`,o=e.out||{},terminal=MM_TERMINAL.has(e.state);
  const emb=mmEmb(e,e.dispute&&!terminal?"bad":MM_TONE[e.state],mmTitleOf(e));
  const L=[kHero(e.hero)],prog=mmProgress(e);
  if(prog)L.push(prog);
  if(e.state==="net"){
    L.push(`${D}, choose the network you will send the ${e.coin} on. ${R} receives on the same one.`);
    L.push(kNote("Wrong coin? Change it with the first menu. Nothing is sent until the amount and the address are shown."));
  }else if(e.state==="await"){
    L.push(`${D}, send **${mmFmtUnits(e.needRaw,e.decimals,e.dp)} ${e.coin}** on **${mmNetOf(e)}** to this address. A little off is fine.`);
    L.push("```"+e.address+"```");
    L.push(`Worth about ${fmtUSD(e.usd)}  ·  this amount holds until <t:${Math.floor(e.quoteExp/1000)}:t>`);
    L.push(kNote("I spot your payment by myself, so there is nothing to paste. Sending from an exchange? It may take its fee out, so send a little extra."));
    if((e.watch||[]).length)L.push(`Looking for ${e.watch.map(w=>`\`${mmShort(w.txid)}\``).join("  ")}. The network can't see it yet, so I keep checking for 30 minutes.`);
  }else if(e.state==="confirming"){
    L.push(mmConfLine(e)||"Deposit seen, confirming.");
    L.push(mmRecvLine(e));
    L.push(e.ref?"The exchange was called off. The refund goes ahead as soon as the deposit is final.":`${R}, wait for **Funds Secured** before you pay.`);
  }else if(e.state==="review"){
    L.push(mmRecvLine(e));
    L.push("An owner is checking this deposit. Nobody needs to do anything for now, and your funds are safe.");
    L.push(kNote(MM_REVIEW_TEXT[(e.review||{}).reason]||"This deposit needs a second look."));
  }else if(e.state==="short"){
    const v=mmVerdict(e);
    L.push(`Received **${mmAmt(e,v.got)}** of **${mmAmt(e,v.asked,e.dp)}**  ·  **${mmAmt(e,v.diff)}** short. Your funds are safe.`);
    L.push(`${R}, press **Continue** to accept what arrived, or **Refund** to send it back. ${D}, you can also send the rest to this address and it is added automatically:`);
    L.push("```"+e.address+"```");
  }else if(e.state==="funded"){
    const tx0=(e.txs||[])[0];
    L.push(`**${mmAmt(e,e.gotRaw)}** is held by the middleman${tx0&&tx0.txid&&e.txs.length===1?` (${mmTxLink(e,tx0.txid)})`:""}.`);
    const rl=mmRecvLine(e);if(rl&&mmVerdict(e).got!==mmVerdict(e).asked)L.push(rl);
    if(e.accepted)L.push(`<@${e.accepted.by}> accepted the shortfall.`);
    if(e.rel){
      L.push(e.payout?`${D} released the funds. ${R}, confirm your address on the card below and I send it.`:`${D} released the funds. ${R}, paste your **${e.coin}** address (${mmNetOf(e)}) in this chat. I show it back to you to confirm, then send it.`);
    }else if(e.ref){
      L.push(e.refundTo?`The exchange was called off. ${D}, confirm the refund address on the card below and I send it.`
        :`The exchange was called off. ${D}, press **Refund To Sender** to send it straight back${e.sender?` to \`${mmShort(e.sender)}\``:""}, or **Other Address** to paste a different one in this chat.\n${kNote("Sent it from an exchange? Use Other Address and paste your own wallet, because an exchange may not credit a refund.")}`);
    }else{
      L.push(`${R}  Pay ${D} now (${e.pays}).`,`${D}  Once you have it in full, press **Release Funds**.`);
      L.push(kNote(e.payout?`Payout address saved: ${mmShort(e.payout)}`:`${R}, paste your ${e.coin} address in this chat so the funds can go to you as soon as they are released.`));
    }
  }else if(e.state==="sending"||e.state==="payout"||e.state==="stuck"){
    const last=(o.txids||[])[(o.txids||[]).length-1],to=o.kind==="refund"?e.depositorId:e.recipientId;
    L.push(e.state==="sending"?`Sending **${mmAmt(e,o.amountRaw||e.gotRaw)}** to <@${to}> (${mmShort(o.to)}). This updates by itself when the network confirms it.${last?` ${mmTxLink(e,last.txid)}`:""}`
      :e.state==="payout"?`An owner sends **${mmAmt(e,o.amountRaw||e.gotRaw)}** to <@${to}> by hand (${mmShort(o.to)}). This updates when it is sent.`
      :`The payout did not finish by itself. The funds are safe and an owner will complete it here.`);
    if(e.state==="sending"&&o.lastError&&!last)L.push(kNote(`The last try did not go through. I try again in a few seconds (${Math.min(o.attempts||0,MM_PAY_TRIES)} of ${MM_PAY_TRIES}). Your funds are safe.`));
  }else if(e.state==="released"||e.state==="refunded"){
    const to=e.state==="released"?R:D;
    L.push(`**${mmAmt(e,o.sentRaw||o.amountRaw||e.gotRaw||"0")}** ${e.state==="released"?"released":"refunded"} to ${to}${o.txid?` (${mmTxLink(e,o.txid)})`:""}  ·  took ${mmTook(e)}.`);
  }else if(e.state==="cancelled"){
    L.push("This middleman deal was cancelled before any funds were held. Nothing was lost. Type `$mm` to start a new one.");
  }
  if(e.netSlow&&!terminal)L.push("**Network is slow, your funds are safe.** I keep checking and this card updates by itself.");
  if(e.dispute&&!terminal)L.push(`**In dispute.** <@${e.dispute.by}> opened a dispute, so the funds are locked and only an owner can release or refund now.\n> ${String(e.dispute.reason||"").slice(0,300)}`);
  if(note)L.push(`**Note.** ${String(note).slice(0,500)}`);
  return emb.setDescription(L.filter(x=>x!=null&&x!=="").join("\n")).setFooter(kFoot(`Built-in server middleman bot  ·  ${e.id}${terminal?"":"  ·  Stuck? Type $mm help"}`)).setTimestamp(e.updatedAt||Date.now());
}
// The coin menu (every coin the bot can take) and the network menu (the networks of the chosen coin)
function mmCoinRow(e){
  const coins=mmMenuCoins();
  if(coins.length<2)return null;
  const opts=coins.slice(0,25).map(c=>{const nets=[...new Set(mmAssetsFor(c).map(a=>MM_CHAINS[a.chain].name))];return new StringSelectMenuOptionBuilder().setLabel(c).setValue(c).setDescription((nets.slice(0,3).join(", ")+(nets.length>3?"…":"")).slice(0,100)).setDefault(c===e.coin);});
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("mm_coin").setPlaceholder("Change the coin").addOptions(opts));
}
function mmNetRow(e){
  const assets=mmAssetsFor(e.coin).filter(a=>!e.nets||e.nets.includes(a.chain)).slice(0,25);
  if(!assets.length||(assets.length<2&&e.state!=="net"))return null;
  const opts=assets.map(a=>new StringSelectMenuOptionBuilder().setLabel(mmNetLabel(a)).setValue(a.chain).setDescription(mmIsAuto(a.chain,mmDepositAddress(a.chain))?"Released by the bot":"Released by an owner").setDefault(a.chain===e.chain));
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("mm_net").setPlaceholder(`Choose the network for ${e.coin}`).addOptions(opts));
}
function mmCardRows(e){
  const G=ButtonStyle.Secondary,row=(...b)=>new ActionRowBuilder().addComponents(...b),help=kBtn("mm_menu","Help",G);
  if(MM_TERMINAL.has(e.state))return [];
  const rows=[];
  if((e.state==="net"||e.state==="await")&&!(e.txs||[]).length){
    const c=mmCoinRow(e),n=mmNetRow(e);
    if(c)rows.push(c);
    if(n)rows.push(n);
  }
  if(e.state==="net")rows.push(row(help));
  else if(e.state==="await")rows.push(row(kBtn("mm_copy","Copy Address",G),help));
  else if(e.state==="short"&&!e.dispute)rows.push(row(kBtn("mm_cont","Continue",ButtonStyle.Success),kBtn("mm_refund","Refund",G)));
  else if(e.state==="funded"&&!e.dispute&&!e.rel&&e.ref&&!e.refundTo)rows.push(row(...(e.sender?[kBtn("mm_rts","Refund To Sender",ButtonStyle.Success)]:[]),kBtn("mm_other","Other Address",G)));
  else if(e.state==="funded"&&!e.rel&&!e.ref&&!e.dispute)rows.push(row(kBtn("mm_release","Release Funds",ButtonStyle.Success),help));
  else rows.push(row(help));
  return rows;
}
// Draws the card. fresh = a new message (the old one loses its buttons, so only one live card exists); otherwise the existing one is edited in place.
// opts.ping = people to mention (only a new message can ping)
async function mmPostCard(channel,e,opts){
  opts=opts||{};
  const payload={embeds:[mmCardEmbed(e,opts.note)],components:mmCardRows(e)};
  if(opts.ping&&opts.ping.length){payload.content=opts.ping.map(u=>`<@${u}>`).join(" ");payload.allowedMentions={users:opts.ping};}
  const old=e.cardId?await channel.messages.fetch(e.cardId).catch(()=>null):null;
  if(old&&!opts.fresh){const ok=await old.edit(payload).then(()=>true).catch(()=>false);if(ok)return old;}
  if(old)await old.edit({components:[]}).catch(()=>{});
  const sent=await channel.send(payload).catch(err=>{console.error("[mm] card send failed:",err.message);return null;});
  if(sent){e.cardId=sent.id;await mmUpdate(e.id,x=>{x.cardId=sent.id;}).catch(()=>{});}
  return sent;
}
const mmRefreshCard=(channel,e,note)=>mmPostCard(channel,e,{note});

// ── Finding deposits by itself ────────────────────────────────────────────────────────────────────────────────
// Nobody pastes a transaction ID. While a deal waits for its deposit the bot looks at what arrives at the middleman address: token transfers (the
// transfer log of the token's contract), native coins (the blocks, read only when the balance moved), Solana (the address's latest signatures) and
// Bitcoin / Litecoin (the address's latest transactions). What it finds is only a SUGGESTION. It goes through exactly the checks a pasted transaction
// goes through (read again from the chain, a second node, the same amount rules), and it is only attached to a deal when its amount is exactly one that
// was asked of that deal and of no other. Anything else is left alone: a person can still paste it, and an owner decides.
const _mmSeen=new Map(),_mmLater=new Map(),_mmRange=new Map(),_mmRequoteAt=new Map();
const mmSeenKey=(chainKey,txid)=>`${chainKey}:${txid}`;
function mmSeenAdd(chainKey,txid){
  _mmSeen.set(mmSeenKey(chainKey,txid),Date.now());
  if(_mmSeen.size>3000)for(const k of _mmSeen.keys()){_mmSeen.delete(k);if(_mmSeen.size<=2000)break;}
}
const mmHex=n=>"0x"+BigInt(n).toString(16);
// One question with several parts in a single request (many nodes allow it); when a node will not, the parts are asked one by one
async function mmRpcBatch(chainKey,calls,opts){
  opts=opts||{};
  const urls=mmRpcUrls(chainKey),n=urls.length;
  for(let k=0;k<n;k++){
    const url=urls[((opts.start||0)+k)%n];
    try{
      const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(calls.map((c,i)=>({jsonrpc:"2.0",id:i+1,method:c.method,params:c.params||[]}))),signal:AbortSignal.timeout(opts.timeoutMs||MM_RPC_MS*2)});
      if(!r.ok){_drop(r);throw new Error("HTTP "+r.status);}
      const body=await r.json();
      if(!Array.isArray(body))throw new Error("no batches");
      const out=new Array(calls.length).fill(undefined);
      for(const it of body)if(it&&Number.isInteger(it.id)&&it.id>=1&&it.id<=calls.length&&Object.prototype.hasOwnProperty.call(it,"result"))out[it.id-1]=it.result;
      if(out.some(v=>v===undefined))throw new Error("incomplete batch");
      return out;
    }catch{}
  }
  const out=[];
  for(const c of calls)out.push(await mmRpc(chainKey,c.method,c.params,opts));
  return out;
}
// Where a first look starts: the block mined around the moment the oldest waiting deal showed its address (never further back than MM_LOG_BACK_MAX)
function mmFirstBlock(chainKey,head,sinceMs){
  const sec=MM_CHAINS[chainKey].blockSec||2,back=Math.ceil(Math.max(0,Date.now()-sinceMs+MM_SCAN_SLACK_MS)/(sec*1000))+10;
  return Math.max(0,head-Math.min(back,MM_LOG_BACK_MAX));
}
// Token payments to the address, newest range of blocks: [{txid, raw}] (several transfers inside one transaction are added up)
async function mmFindEvmToken(chainKey,asset,address,from,to){
  const pad="0x"+"0".repeat(24)+String(address).toLowerCase().slice(2),sums=new Map(),range=_mmRange.get(chainKey)||MM_LOG_RANGE;
  for(let a=from;a<=to;a+=range){
    const b=Math.min(to,a+range-1);
    const logs=await mmRpc(chainKey,"eth_getLogs",[{address:asset.contract,fromBlock:mmHex(a),toBlock:mmHex(b),topics:[MM_TRANSFER_TOPIC,null,pad]}]);
    for(const l of Array.isArray(logs)?logs:[]){
      const t=(l&&l.topics)||[];
      if(!l||l.removed||!l.transactionHash||t.length!==3||t[0]!==MM_TRANSFER_TOPIC)continue;
      const id=String(l.transactionHash).toLowerCase();
      sums.set(id,(sums.get(id)||0n)+BigInt(l.data&&l.data!=="0x"?l.data:"0x0"));
    }
  }
  return [...sums].map(([txid,raw])=>({txid,raw}));
}
// Native-coin payments made straight to the address, read out of whole blocks. Stops at a block the node does not have yet (it is picked up next time).
async function mmFindEvmNative(chainKey,address,from,to){
  const low=String(address).toLowerCase(),found=[];let done=from-1;
  for(let a=from;a<=to;a+=10){
    const nums=[];for(let n=a;n<=Math.min(to,a+9);n++)nums.push(n);
    const blocks=await mmRpcBatch(chainKey,nums.map(n=>({method:"eth_getBlockByNumber",params:[mmHex(n),true]})));
    for(let i=0;i<nums.length;i++){
      const b=blocks[i];
      if(!b||!Array.isArray(b.transactions)){if(nums[i]>to-8)return {found,done};done=nums[i];continue;}     // (an old block a node lacks is skipped; one near the head is waited for)
      for(const t of b.transactions)if(t&&typeof t==="object"&&String(t.to||"").toLowerCase()===low){const v=BigInt(t.value||"0x0");if(v>0n)found.push({txid:String(t.hash).toLowerCase(),raw:v});}
      done=nums[i];
    }
  }
  return {found,done};
}
// The address's latest signatures (newest first), up to the one seen last time
async function mmFindSol(address,sinceMs,untilSig){
  const opts={limit:20,commitment:"confirmed"};if(untilSig)opts.until=untilSig;
  const list=await mmRpc("sol","getSignaturesForAddress",[address,opts]),out=[];
  for(const s of Array.isArray(list)?list:[]){
    if(!s||!s.signature||s.err)continue;
    if(s.blockTime&&s.blockTime*1000<sinceMs-MM_SCAN_SLACK_MS)continue;
    out.push({txid:s.signature,raw:null});
  }
  return {found:out,newest:(list&&list[0]&&list[0].signature)||null};
}
// Bitcoin / Litecoin: the latest transactions of the address that pay it (and were not sent from it)
async function mmFindUtxo(chainKey,address,sinceMs){
  const list=await mmApi(chainKey,"/address/"+address+"/txs"),out=[];
  for(const t of Array.isArray(list)?list:[]){
    if(!t||!t.txid)continue;
    const st=t.status||{};
    if(st.confirmed&&st.block_time&&st.block_time*1000<sinceMs-MM_SCAN_SLACK_MS)continue;
    let sum=0n;for(const o of t.vout||[])if(o&&o.scriptpubkey_address===address)sum+=BigInt(o.value);
    if(sum<=0n||(t.vin||[]).some(v=>v&&v.prevout&&v.prevout.scriptpubkey_address===address))continue;
    out.push({txid:String(t.txid).toLowerCase(),raw:sum});
  }
  return out;
}
// The place where scanning stopped is kept (about once a minute) so a restart carries on from there
const mmScanKey=e=>`${e.chain}:${e.contract||"native"}`;
let _mmScanSavedAt=0;
function mmScanPut(key,st){
  _mmMeta.scan=_mmMeta.scan||{};_mmMeta.scan[key]=st;
  const now=Date.now();
  if(now-_mmScanSavedAt>MM_SCAN_SAVE_MS){_mmScanSavedAt=now;mmSaveMeta().catch(()=>{});}
}
// After the wallet sent something its balance moved without any look noticing: the next look must read the history again ("the balance has not changed" proves nothing then)
function mmScanPoke(e){const s=((_mmMeta.scan||{})[mmScanKey(e)]);if(s)s.bal=null;}
const mmWaitingIn=(list,e0)=>list.filter(x=>MM_WAITING.has(x.state)&&x.chain===e0.chain&&(x.contract||null)===(e0.contract||null)&&mmSameAddr(e0.chain,x.address,e0.address));
const mmIgnored=(chainKey,from)=>!!from&&(_mmMeta.ignore||[]).some(a=>mmSameAddr(chainKey,a,from));
// Which waiting deal does a payment of `raw` belong to?
//   {deal}  that one: the only deal waiting on this address and coin, or the one whose asked amount it is exactly (or within MM_MATCH_PCT percent of, when several wait)
//   {dust}  far too small to be a deposit (under MM_DUST_PCT percent of every amount asked): ignored
//   {cands} several deals could own it, or none is close: the owners decide
//   {none}  nobody is waiting
function mmMatchDeal(deals,raw,from){
  const r=BigInt(raw);
  if(!deals.length)return {none:true};
  const asked=d=>BigInt(d.needRaw||"0");
  const small=deals.every(d=>asked(d)>0n&&r*100n<asked(d)*BigInt(MM_DUST_PCT));
  if(small&&!(from&&deals.some(d=>(d.txs||[]).some(t=>t.from&&t.from===from))))return {dust:true};
  const exact=deals.filter(d=>(d.quotes||[]).some(q=>q.needRaw===r.toString()));
  if(exact.length===1)return {deal:exact[0],how:"exact"};
  if(deals.length===1)return {deal:deals[0],how:"only"};
  const near=deals.filter(d=>(d.quotes||[]).some(q=>{const a=BigInt(q.needRaw);if(a<=0n)return false;const diff=r>a?r-a:a-r;return diff*100n<=a*BigInt(MM_MATCH_PCT);}));
  if(near.length===1)return {deal:near[0],how:"near"};
  return {cands:near.length?near:deals};
}
// A payment that was found: read again from the chain like a pasted one, and attached to its deal. Returns what happened.
async function mmAttach(e0,c,deals){
  const chainKey=e0.chain,asset=mmAssetOf(e0),sk=mmSeenKey(chainKey,c.txid);
  if(_mmSeen.has(sk))return "seen";
  if(!deals)deals=mmWaitingIn((await MMDB.list("e:")).map(([,x])=>x),e0);
  if(!deals.length){mmSeenAdd(chainKey,c.txid);return "skip";}
  if(c.raw!=null&&mmMatchDeal(deals,c.raw).dust){mmSeenAdd(chainKey,c.txid);return "skip";}      // far too small to be a deposit (and no node call is needed to know)
  if(await MMDB.get(`tx:${chainKey}:${c.txid}`)){mmSeenAdd(chainKey,c.txid);return "used";}
  const v=await mmVerifyTx(chainKey,asset,e0.address,c.txid);
  if(!v.found)return "later";                                              // the node that was asked does not know it yet: looked at again in a moment
  if(!v.toUs||v.ok===false||v.self||(v.from&&mmIgnored(chainKey,v.from))){mmSeenAdd(chainKey,c.txid);return "skip";}      // not a deposit: it left the wallet, failed, or is an owner's own top-up
  const m=mmMatchDeal(deals,v.amountRaw,v.from);
  if(m.dust){mmSeenAdd(chainKey,c.txid);return "skip";}
  if(!m.deal){
    mmSeenAdd(chainKey,c.txid);
    await mmStrayReport({kind:"ambiguous",chainKey,asset,v,txid:c.txid,deals:m.cands||deals});
    return "stray";
  }
  const r=await mmJudge(m.deal.id,c.txid,v,null);
  mmSeenAdd(chainKey,c.txid);
  if(r.status==="rejected"){console.log(`[mm] ${m.deal.id}: a payment that arrived was not used (${r.why}): ${c.txid}`);return "rejected";}
  await mmAfterJudge(await mmGet(m.deal.id),r,m.deal.depositorId);
  return r.status;
}

// One network, one coin, one address: look for new payments and hand every one that might be a deposit to mmAttach
async function mmScanGroup(deals0){
  const e0=deals0[0],chainKey=e0.chain,fam=MM_CHAINS[chainKey].family,key=mmScanKey(e0),st=(_mmMeta.scan||{})[key]||null,now=Date.now();
  const since=Math.min(...deals0.map(d=>d.shownAt||d.createdAt||now));
  const waiting=async()=>mmWaitingIn((await MMDB.list("e:")).map(([,x])=>x),e0);       // read fresh: a deal that showed its address a moment ago counts too
  let found=[];
  // payments seen a moment ago that a second node did not know yet are tried again first
  const later=[..._mmLater].filter(([,l])=>l.key===key);
  if(later.length){
    const deals=await waiting();
    for(const [k,l] of later){
      if(now-l.at>15*60*1000){_mmLater.delete(k);continue;}
      let r;try{r=await mmAttach(e0,l.c,deals);}catch(err){if(!(err instanceof MmError))console.error("[mm] retry:",err.message);continue;}
      if(r!=="later")_mmLater.delete(k);
    }
  }
  if(fam==="evm"&&e0.contract){
    const head=Number(BigInt(await mmRpc(chainKey,"eth_blockNumber",[]))),first=mmFirstBlock(chainKey,head,since);
    const overlap=Math.min(2000,Math.ceil(120/(MM_CHAINS[chainKey].blockSec||2)));
    const from=Math.max(first,st&&st.b!=null?st.b-overlap:0);
    for(let tries=0;;tries++){
      try{found=await mmFindEvmToken(chainKey,mmAssetOf(e0),e0.address,from,head);break;}
      catch(err){                                                                         // a node that refuses big ranges is asked for smaller ones, right away
        const r=_mmRange.get(chainKey)||MM_LOG_RANGE;
        if(err&&err.rpcError&&r>200&&tries<5){_mmRange.set(chainKey,Math.max(200,Math.floor(r/2)));continue;}
        throw err;
      }
    }
    mmScanPut(key,{b:head,at:now});
  }else if(fam==="evm"){
    const head=Number(BigInt(await mmRpc(chainKey,"eth_blockNumber",[]))),bal=BigInt(await mmRpc(chainKey,"eth_getBalance",[e0.address,mmHex(head)])).toString();
    const first=mmFirstBlock(chainKey,head,since),overlap=Math.min(40,Math.ceil(30/(MM_CHAINS[chainKey].blockSec||2)));
    let from=null;
    if(st&&st.pend)from=Math.max(first,st.b+1);                                           // an earlier pass did not finish its range
    else if(!st||st.b==null)from=first;                                                  // first look
    else if(st.bal==null||String(st.bal)!==bal||now-(st.at||0)>MM_SCAN_GAP_MS)from=Math.max(first,st.b-overlap);                       // the balance moved since the last look: something arrived (or left)
    if(from==null||from>head){mmScanPut(key,{b:head,bal,at:now});from=null;}              // nothing to read: just remember where we are
    if(from!=null){
      const to=Math.min(head,from+MM_SCAN_BLOCKS-1),r=await mmFindEvmNative(chainKey,e0.address,from,to);
      found=r.found;
      if(r.done>=head)mmScanPut(key,{b:head,bal,at:now});
      else mmScanPut(key,{b:Math.max(r.done,from-1),bal:st&&st.bal!=null?st.bal:null,pend:true,at:now});
    }
  }else if(fam==="sol"){
    const b=await mmRpc("sol","getBalance",[e0.address,{commitment:"confirmed"}]),bal=String(b&&b.value!=null?b.value:b);
    if(!st||st.bal==null||String(st.bal)!==bal||now-(st.fullAt||0)>120*1000){
      const r=await mmFindSol(e0.address,since,st&&st.sig);
      found=r.found.slice(0,10);
      mmScanPut(key,{sig:r.newest||(st&&st.sig)||null,bal,fullAt:now,at:now});
    }
  }else{
    found=await mmFindUtxo(chainKey,e0.address,since);
  }
  if(!found.length)return;
  const deals=await waiting();
  for(const c of found){
    try{
      const r=await mmAttach(e0,c,deals);
      if(r==="later")_mmLater.set(mmSeenKey(chainKey,c.txid),{key,c,at:now});
    }catch(err){
      if(err instanceof MmError&&(err.code==="state"||err.code==="busy"))continue;
      if(err instanceof MmError&&err.code==="rpc"){_mmLater.set(mmSeenKey(chainKey,c.txid),{key,c,at:now});continue;}
      console.error("[mm] attach:",err.message);
    }
  }
}
const _mmScanWarnAt=new Map();
function mmWarnOnce(k,msg){const now=Date.now();if(now-(_mmScanWarnAt.get(k)||0)>30*60*1000){_mmScanWarnAt.set(k,now);console.error(msg);}}
async function mmSweepDeposits(open){
  const groups=new Map();
  for(const e of open){
    if(!MM_WAITING.has(e.state)||!e.chain||!e.address)continue;
    const k=`${e.chain}|${e.contract||"native"}|${String(e.address).toLowerCase()}`;
    if(!groups.has(k))groups.set(k,[]);
    groups.get(k).push(e);
  }
  for(const [,deals] of groups){
    try{await mmScanGroup(deals);mmNodeOk(deals[0].chain);}
    catch(err){
      if(err instanceof MmError&&err.code==="rpc")mmNodeFail(deals[0].chain);
      if(err instanceof MmError&&(err.code==="rpc"||err.code==="busy"||err.code==="state"))continue;
      const k=deals[0].chain,now=Date.now();
      if(now-(_mmScanWarnAt.get(k)||0)>30*60*1000){_mmScanWarnAt.set(k,now);console.error(`[mm] scan ${k}:`,err.message);}      // (a node that cannot do it must not fill the log)
    }
  }
}

// ── When the network's nodes stop answering ─────────────────────────────────────────────────────────────────
// After MM_NODE_SLOW_MS of failures the cards say "Network is slow, your funds are safe" and the owners are told once; it clears by itself.
const _mmNode=new Map();
function mmNodeFail(ck){if(!_mmNode.has(ck))_mmNode.set(ck,{since:Date.now(),alerted:false});}
function mmNodeOk(ck){
  const n=_mmNode.get(ck);if(!n)return;
  _mmNode.delete(ck);
  if(n.alerted)mmNodeFlag(ck,false).catch(()=>{});
}
async function mmNodeFlag(ck,on){
  for(const [,e] of await MMDB.list("e:")){
    if(e.chain!==ck||e.state==="net"||!!e.netSlow===on)continue;
    const x=await mmUpdate(e.id,y=>{if(on)y.netSlow=true;else delete y.netSlow;}).catch(()=>null);
    const ch=x&&await mmChannelOf(x);
    if(ch)await mmRefreshCard(ch,x).catch(()=>{});
  }
}
async function mmNodeCheck(){
  const now=Date.now();
  for(const [ck,n] of _mmNode){
    if(n.alerted||now-n.since<MM_NODE_SLOW_MS)continue;
    n.alerted=true;
    await mmNodeFlag(ck,true).catch(()=>{});
    mmAlertOwners({embeds:[kEmbed("Middleman","warn").setTitle("Network Nodes Are Not Answering").setDescription(`None of the **${MM_CHAINS[ck].name}** nodes has answered for ${Math.round((now-n.since)/60000)} minutes. Open deals on it show "Network is slow, your funds are safe". Nothing is lost: deposits and payouts carry on by themselves when the nodes answer again.${(process.env["MM_RPC_"+ck.toUpperCase()]||"")?"":`\nIf this keeps happening, set a private node in the Railway variable \`MM_RPC_${ck.toUpperCase()}\`.`}`).setTimestamp()]});
  }
}

// ── Money that belongs to no deal ───────────────────────────────────────────────────────────────────────────
// Several deals could own a payment, another coin than the one asked for, or any coin on another network: it is written down once, the ticket is told plainly
// (when exactly one deal waits there) and the owners get buttons to send it back to where it came from, attach it to a deal, or ignore it.
async function mmStrayReport(info){
  const {chainKey,txid}=info,asset=info.asset||{},contract=asset.contract||null,chain=MM_CHAINS[chainKey];
  if(!(await MMDB.add(`stray:${chainKey}:${txid}:${contract||"native"}`,{at:Date.now()})))return null;      // one report per payment
  const code=crypto.randomBytes(4).toString("hex"),raw=String(info.v?info.v.amountRaw:info.raw);
  const dec=asset.decimals!=null?asset.decimals:chain.decimals,coin=asset.coin||(contract?"tokens":chain.native);
  const from=(info.v&&info.v.from)||info.from||null;
  const rec={code,kind:info.kind,chain:chainKey,contract,coin,decimals:dec,raw,from,txid,at:Date.now(),deals:(info.deals||[]).map(d=>d.id),state:"open"};
  await MMDB.set("st:"+code,rec);
  const amt=`${mmFmtUnits(raw,dec)} ${coin}`,link=info.noLink?`\`${txid}\``:`[transaction](${chain.tx}${txid})`;
  const one=info.deals&&info.deals.length===1?info.deals[0]:null;
  if(one){
    const ch=await mmChannelOf(one),exp=`${one.coin} on ${mmNetOf(one)}`;
    const text=info.kind==="token"?`A payment of **${amt}** arrived at the middleman address, but this deal is waiting for **${exp}**. That payment can't be used for this deal.`
      :info.kind==="network"?`A payment of **${amt}** arrived on **${chain.name}**, but this deal is on **${mmNetOf(one)}**. That payment can't be used for this deal.`
      :`A payment of **${amt}** arrived, but I can't tell for sure which deal it belongs to.`;
    if(ch)await ch.send({embeds:[mmEmb(one,"warn","Payment Needs An Owner").setDescription(`${text}\nYour funds are safe: nothing was lost and the owners have been told. They can send it back to where it came from.${info.kind==="ambiguous"?"":` To go on with the exchange, send **${exp}** to the address on the card.`}`).setFooter(kFoot(one.id))]}).catch(()=>{});
  }
  const cands=(info.deals||[]).slice(0,2);
  const btns=[];
  if(info.kind==="ambiguous")for(const d of cands)btns.push(kBtn(`mm_s__att__${code}__${d.id}`,`Attach To ${d.id}`,ButtonStyle.Primary));
  if(!info.noReturn)btns.push(kBtn(`mm_s__ret__${code}`,"Return To Sender",ButtonStyle.Success));
  btns.push(kBtn(`mm_s__ign__${code}`,"Ignore",ButtonStyle.Secondary),kBtn(`mm_s__igs__${code}`,"Ignore Sender",ButtonStyle.Secondary));
  const why=info.kind==="token"?"A different coin than the deal asked for":info.kind==="network"?"A payment on a different network than the deal":info.kind==="ambiguous"?"Several waiting deals could own this payment (or none is close)":"A payment nobody is waiting for";
  mmAlertOwners({embeds:[kEmbed("Middleman","warn").setTitle("Middleman Payment To Check").setDescription(`${why}.\n**${amt}** on ${chain.name}\nFrom: \`${from||"unknown"}\`\n${link}${(info.deals||[]).length?`\nWaiting deals: ${(info.deals||[]).map(d=>d.id).join(", ")}`:""}\n\nIt is safe in the middleman wallet and is not used by any deal until you decide.${info.noReturn?"\nThe bot can't send this kind of token itself: move it with the wallet key (see /mmadmin backup).":""}`).setTimestamp()],
    components:[new ActionRowBuilder().addComponents(...btns.slice(0,5))]});
  return rec;
}
// Owner decisions on such a payment
async function mmStrayAct(act,code,dealId,uid){
  const rec=await MMDB.get("st:"+code);
  if(!rec)throw new MmError("gone","That payment is not on the list any more. Nothing changed.");
  if(rec.state!=="open")throw new MmError("state",`That payment was already dealt with (${rec.state}). Nothing changed.`);
  const chain=MM_CHAINS[rec.chain],setState=async(state,extra)=>{await MMDB.set("st:"+code,{...rec,state,by:uid,doneAt:Date.now(),...(extra||{})});};
  if(act==="ign"){await setState("ignored");return "Ignored. It stays in the wallet and no deal will use it.";}
  if(act==="igs"){
    if(rec.from){_mmMeta.ignore=(_mmMeta.ignore||[]).concat([rec.from]).slice(-50);await mmSaveMeta();}
    await setState("ignored");return "Ignored, and payments from that wallet are not used for deals from now on.";
  }
  if(act==="ret"){
    const to=rec.from&&mmNormAddress(rec.chain,rec.from);
    if(!to)throw new MmError("address","I can't tell which wallet that payment came from, so I can't send it back by myself. Nothing changed and the money is safe. Move it by hand with the wallet key.");
    const e=await mmPseudoDeal({kind:"recover",chainKey:rec.chain,contract:rec.contract,coin:rec.coin,decimals:rec.decimals,amountRaw:rec.raw,to,by:uid,txid:rec.txid,from:rec.from});
    await setState("returned",{deal:e.id});
    const r=await mmGoPayout(e.id,"refund",uid,{owner:true});
    return `Sending it back to \`${to}\` as **${e.id}**. ${mmPayoutText(r,"refund")}`;
  }
  if(act==="att"){
    const deal=await mmFresh(dealId);
    if(!deal||!MM_WAITING.has(deal.state))throw new MmError("state","That deal is not waiting for a deposit any more. Nothing changed.");
    if(deal.chain!==rec.chain||(deal.contract||null)!==(rec.contract||null))throw new MmError("state","That deal expects a different coin or network. Nothing changed.");
    const asset=mmAssetOf(deal),v=await mmVerifyTx(rec.chain,asset,deal.address,rec.txid);
    if(!v.found||!v.toUs)throw new MmError("state","I can't read that payment on the network right now. Nothing changed. Try again in a minute.");
    const r=await mmJudge(deal.id,rec.txid,v,null);
    if(r.status==="rejected")throw new MmError("state",`It can't be attached: ${mmWhyText(deal,r.why)}`);
    await setState("attached",{deal:deal.id});
    await mmAfterJudge(await mmGet(deal.id),r,deal.depositorId);
    return `Attached to **${deal.id}**.`;
  }
  throw new MmError("gone","That button is no longer in use.");
}
// A deal that is not a deal: the bot sending money out of its wallet for an owner (a sweep, or the return of a payment that belongs to nobody).
// It goes through exactly the same payout machinery, so it is just as safe against restarts and double sends.
async function mmPseudoDeal(o){
  const fam=MM_CHAINS[o.chainKey].family,w=mmWallets(),signer=fam==="evm"?w.evm[0]:fam==="sol"?w.sol[0]:null;
  if(!signer)throw new MmError("coin","The bot holds no key for that network, so it can't send this itself. Nothing changed and the money is safe.");
  const id=await MMDB.lock("seq",async()=>{const n=(Number(await MMDB.get("seq"))||0)+1;await MMDB.set("seq",n);return "MM-"+String(n).padStart(4,"0");});
  const now=Date.now(),amt=String(o.amountRaw);
  const e={v:2,id,kind:o.kind,channelId:null,guildId:null,clientId:o.by,exchangerId:o.by,depositorId:o.by,recipientId:o.by,coin:o.coin,usd:0,pays:"",
    hero:`${mmFmtUnits(amt,o.decimals)} ${o.coin} → ${o.kind==="sweep"?"swept out":"sent back"}`,state:"funded",chain:o.chainKey,contract:o.contract||null,decimals:o.decimals,dp:Math.min(8,o.decimals),
    address:signer.address,auto:true,quotes:[],watch:[],txs:[{txid:o.txid||null,raw:amt,from:o.from||null,at:now,by:o.by,mined:true,final:true,pseudo:true}],gotRaw:amt,askedRaw:amt,verdict:"ok",
    fundedAt:now,createdAt:now,updatedAt:now,log:[]};
  if(o.kind==="sweep")e.payout=o.to;else e.refundTo=o.to;
  e.payoutOk=e.refundOk=mmAddrTag(o.to);
  mmNote(e,`${o.kind} of ${mmFmtUnits(amt,o.decimals)} ${o.coin} to ${o.to}`,o.by);
  await MMDB.set("e:"+id,e);_mmCache.set(id,e);
  return e;
}
// Looks for money at the middleman address that belongs to no waiting deal. Only while a deal waits, and at most every 20 seconds.
const _mmStrayAt={t:0};
async function mmScanStray(open){
  const now=Date.now();
  if(now-_mmStrayAt.t<MM_SWEEP_MS)return;
  const waiting=open.filter(e=>MM_WAITING.has(e.state)&&e.chain&&e.address);
  if(!waiting.length)return;
  _mmStrayAt.t=now;
  const w=mmWallets();
  const evmWaiting=waiting.filter(e=>MM_CHAINS[e.chain].family==="evm");
  if(evmWaiting.length&&w.evm[0]){
    const addr=w.evm[0].address;
    for(const ck of Object.keys(MM_CHAINS).filter(k=>MM_CHAINS[k].family==="evm")){
      if(!mmSameAddr(ck,mmDepositAddress(ck)||"",addr))continue;
      try{await mmScanStrayEvm(ck,addr,waiting,evmWaiting);}
      catch(err){if(!(err instanceof MmError))mmWarnOnce("stray:"+ck,`[mm] stray scan ${ck}: ${err.message}`);}
    }
  }
  const solWaiting=waiting.filter(e=>e.chain==="sol");
  if(solWaiting.length&&w.sol[0]){try{await mmScanStraySol(w.sol[0].address,solWaiting);}catch(err){if(!(err instanceof MmError))mmWarnOnce("stray:sol",`[mm] stray scan sol: ${err.message}`);}}
}
async function mmScanStrayEvm(ck,addr,waiting,evmWaiting){
  _mmMeta.stray=_mmMeta.stray||{};
  const st=_mmMeta.stray[ck]||null,now=Date.now(),low=addr.toLowerCase();
  const head=Number(BigInt(await mmRpc(ck,"eth_blockNumber",[]))),since=Math.min(...evmWaiting.map(d=>d.shownAt||d.createdAt||now));
  const from=Math.max(mmFirstBlock(ck,head,since),st&&st.b!=null?st.b-2:0);
  const expects=contract=>waiting.some(d=>d.chain===ck&&(d.contract||null)===(contract||null)&&mmSameAddr(ck,d.address,addr));
  const here=waiting.filter(d=>d.chain===ck);
  const deals=here.length?here:evmWaiting;
  const pad="0x"+"0".repeat(24)+low.slice(2),sums=new Map(),range=_mmRange.get(ck)||MM_LOG_RANGE;
  for(let a=from;a<=head;a+=range){
    const logs=await mmRpc(ck,"eth_getLogs",[{fromBlock:mmHex(a),toBlock:mmHex(Math.min(head,a+range-1)),topics:[MM_TRANSFER_TOPIC,null,pad]}]);
    for(const l of Array.isArray(logs)?logs:[]){
      const t=(l&&l.topics)||[];
      if(!l||l.removed||!l.transactionHash||!l.address||t.length!==3||t[0]!==MM_TRANSFER_TOPIC)continue;
      const k=`${String(l.transactionHash).toLowerCase()}|${String(l.address).toLowerCase()}`,cur=sums.get(k)||{raw:0n,from:("0x"+String(t[1]).slice(26)).toLowerCase()};
      cur.raw+=BigInt(l.data&&l.data!=="0x"?l.data:"0x0");sums.set(k,cur);
    }
  }
  for(const [k,s] of sums){
    const [txid,contract]=k.split("|");
    if(expects(contract)||s.raw<=0n||mmIgnored(ck,s.from))continue;
    const known=MM_ASSETS.find(a=>a.chain===ck&&a.contract===contract);
    let dec=known?known.decimals:null,coin=known?known.coin:null;
    if(dec==null){try{const r=await mmRpc(ck,"eth_call",[{to:contract,data:"0x313ce567"},"latest"]);dec=/^0x[0-9a-f]+$/i.test(r)&&r!=="0x"?Number(BigInt(r)):18;}catch{dec=18;}}
    if(!coin)coin=`token ${mmShort(contract)}`;
    await mmStrayReport({kind:here.length?"token":"network",chainKey:ck,asset:{coin,contract,decimals:dec},raw:s.raw,from:s.from,txid,deals});
  }
  // the chain's own coin: only when no waiting deal expects it, and only when the balance went up since the last look
  let bal=null,newSt={b:head,at:now};
  if(!expects(null)){
    bal=BigInt(await mmRpc(ck,"eth_getBalance",[addr,"latest"]));
    newSt.bal=bal.toString();
    if(st&&st.bal!=null&&bal>BigInt(st.bal)){
      const r=await mmFindEvmNative(ck,addr,Math.max(mmFirstBlock(ck,head,since),(st.b||head)-MM_SCAN_BLOCKS),head);
      for(const f of r.found){
        let fromAddr=null;
        try{const tx=await mmRpc(ck,"eth_getTransactionByHash",[f.txid]);fromAddr=tx&&tx.from?String(tx.from).toLowerCase():null;}catch{}
        if(fromAddr&&mmIgnored(ck,fromAddr))continue;
        await mmStrayReport({kind:here.length?"token":"network",chainKey:ck,asset:{coin:MM_CHAINS[ck].native,contract:null,decimals:MM_CHAINS[ck].decimals},raw:f.raw,from:fromAddr,txid:f.txid,deals});
      }
    }
  }
  _mmMeta.stray[ck]=newSt;
}
// Solana: any SPL token the wallet holds that is not a coin the bot trades (the bot only sends SOL, so it tells the owners and nothing else)
async function mmScanStraySol(addr,solWaiting){
  for(const pid of ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA","TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"]){
    const r=await mmRpc("sol","getTokenAccountsByOwner",[addr,{programId:pid},{encoding:"jsonParsed"}]);
    for(const a of (r&&r.value)||[]){
      const info=a.account&&a.account.data&&a.account.data.parsed&&a.account.data.parsed.info,ta=info&&info.tokenAmount;
      if(!ta||!ta.amount||ta.amount==="0")continue;
      await mmStrayReport({kind:"token",chainKey:"sol",asset:{coin:`token ${mmShort(info.mint)}`,contract:info.mint,decimals:Number(ta.decimals)||0},raw:ta.amount,from:null,txid:`${info.mint}:${ta.amount}`,deals:solWaiting,noLink:true,noReturn:true});
    }
  }
}

// ── Background sweep: confirmations, payouts in flight, transactions being looked for, deals nobody paid into ──
// The timer calls mmTick every few seconds: while a deal waits for a deposit everything runs every MM_FAST_MS (5 seconds), otherwise every MM_SWEEP_MS (20 seconds).
let _mmSweeping=false,_mmOrphanAt=new Map(),_mmLastFull=0;
async function mmTick(){
  const now=Date.now();
  let waiting=false;
  for(const [,e] of await MMDB.list("e:"))if(MM_WAITING.has(e.state)||(e.watch||[]).length){waiting=true;break;}
  if(waiting||now-_mmLastFull>=MM_SWEEP_MS){_mmLastFull=now;await mmSweep();}
}
async function mmSweep(){
  if(_mmSweeping)return;
  _mmSweeping=true;
  try{
    const open=await MMDB.list("e:");
    const live=new Set(open.map(([,e])=>e.id));
    for(const [id,e] of _mmCache)if(!MM_TERMINAL.has(e.state)&&!live.has(id))await mmFresh(id);      // finished by another copy of the bot
    for(const [,e] of open){
      _mmCache.set(e.id,e);
      try{await mmSweepOne(e);}catch(err){if(!(err instanceof MmError&&(err.code==="rpc"||err.code==="busy"||err.code==="state")))console.error(`[mm] sweep ${e.id}:`,err.message);}
    }
    const again=(await MMDB.list("e:")).map(([,x])=>x);
    await mmSweepDeposits(again);                                                                       // deposits are found by the bot itself: nobody has to paste a transaction
    await mmScanStray(again);                                                                           // and money that belongs to no deal is noticed too
    await mmNodeCheck();
  }catch(err){console.error("[mm] sweep:",err.message);}
  finally{_mmSweeping=false;}
}
async function mmSweepOne(e){
  const now=Date.now(),id=e.id;
  // ── waiting for the deposit (or for the rest of it) ──
  if(e.state==="net"||e.state==="await"||e.state==="short"){
    for(const w of e.watch||[]){
      if(now-w.at>MM_WATCH_MS){await mmUpdate(id,x=>{x.watch=(x.watch||[]).filter(y=>y.txid!==w.txid);});const ch=await mmChannelOf(e);if(ch){await mmRefreshCard(ch,await mmGet(id));await ch.send({content:`<@${w.by||e.depositorId}>`,embeds:[mmEmb(e,"warn","Transaction Not Found").setDescription(`The network never showed \`${mmShort(w.txid)}\`. Nothing was lost and your funds are safe. Check that it was really sent on **${mmNetOf(e)}**, then paste it again or type \`$mm help\`.`).setFooter(kFoot(e.id))],allowedMentions:{users:[w.by||e.depositorId]}}).catch(()=>{});}continue;}
      const v=await mmVerifyTx(e.chain,mmAssetOf(e),e.address,w.txid);
      if(!v.found)continue;
      const r=await mmJudge(id,w.txid,v,w.by);
      await mmAfterJudge(await mmGet(id),r,w.by);
      return;
    }
    if(e.state==="await"&&e.quoteExp&&now>e.quoteExp&&!(e.watch||[]).length&&!(e.txs||[]).length&&now>(_mmRequoteAt.get(id)||0)){
      _mmRequoteAt.set(id,now+60*1000);                             // the amount is worked out again from a fresh price (not more than once a minute); earlier amounts still count
      try{
        const x=await mmArm(id,e.chain),ch=await mmChannelOf(x);
        if(ch)await mmPostCard(ch,x,{note:"The price moved, so the amount was worked out again. Sending the earlier amount still works."});
      }catch(err){if(!(err instanceof MmError))console.error(`[mm] requote ${id}:`,err.message);}
    }
    if((e.state==="net"||e.state==="await")&&!(e.watch||[]).length&&!(e.txs||[]).length){
      if(now-e.createdAt>MM_OPEN_MS){                               // nobody paid in for a day: the deal is cancelled (the ticket stays). A deal that holds anything is never cancelled by itself.
        let did=false;
        const x=await mmUpdate(id,y=>{if((y.state==="net"||y.state==="await")&&!(y.watch||[]).length&&!(y.txs||[]).length){y.state="cancelled";mmNote(y,"nobody paid in: cancelled");did=true;}});
        if(did){
          mmSaveTicket(x.channelId,t=>{if(t.mmId===x.id)t.mmStage=null;});
          const ch=await mmChannelOf(x);
          if(ch){await mmRefreshCard(ch,x);await ch.send({embeds:[mmEmb(x,"mute","Cancelled").setDescription("Nothing arrived within a day, so the middleman deal was cancelled. Nothing was held and nothing was lost. Type `$mm` to start a new one.").setFooter(kFoot(x.id))]}).catch(()=>{});}
        }
      }else if(e.state==="await"&&!e.remindedAt&&now-(e.shownAt||e.createdAt)>MM_IDLE_REMIND_MS){
        let did=false;
        const x=await mmUpdate(id,y=>{if(y.state==="await"&&!y.remindedAt&&!(y.txs||[]).length){y.remindedAt=now;did=true;}});
        const ch=did?await mmChannelOf(x):null;
        if(ch)await ch.send({content:`<@${x.depositorId}> <@${x.recipientId}>`,embeds:[mmEmb(x,"warn","Still Waiting For The Deposit").setDescription(`Nothing has arrived yet, and nothing is held. <@${x.depositorId}>, send **${mmFmtUnits(x.needRaw,x.decimals,x.dp)} ${x.coin}** on **${mmNetOf(x)}** to the address on the card (a little off is fine). <@${x.recipientId}>, nothing is needed from you yet.\nIf the exchange is off, press **Help**, then **Cancel Middleman**. A deal nobody pays into is cancelled by itself after 24 hours.`).setFooter(kFoot(x.id))],allowedMentions:{users:[x.depositorId,x.recipientId]}}).catch(()=>{});
      }
    }
    if(e.state==="short"&&!e.shortRemindedAt&&e.shortAt&&now-e.shortAt>MM_IDLE_REMIND_MS){
      let did=false;
      const x=await mmUpdate(id,y=>{if(y.state==="short"&&!y.shortRemindedAt){y.shortRemindedAt=now;did=true;}});
      const ch=did?await mmChannelOf(x):null;
      if(ch)await ch.send({content:`<@${x.depositorId}> <@${x.recipientId}>`,embeds:[mmEmb(x,"warn","Still Short").setDescription(`The deposit is still **${mmAmt(x,mmVerdict(x).diff)}** short. Your funds are safe. <@${x.depositorId}>, send the rest to the same address, or <@${x.recipientId}> can press **Continue** to accept what arrived, or **Refund** to send it back.`).setFooter(kFoot(x.id))],allowedMentions:{users:[x.depositorId,x.recipientId]}}).catch(()=>{});
    }
    return;
  }
  // ── a deposit is on its way: every payment is read again until it is final, and then the deal is settled ──
  if(e.state==="confirming"){
    const todo=(e.txs||[]).filter(t=>!t.final);
    const res=[];
    for(const tx of todo){
      if(tx.hand||tx.pseudo||!tx.txid){res.push({tx,fixed:true});continue;}
      const v=await mmVerifyTx(e.chain,mmAssetOf(e),e.address,tx.txid);
      const r={tx,v};
      if(v.found&&v.ok!==false&&v.final&&v.toUs&&v.amountRaw.toString()===tx.raw&&!tx.approved)r.second=await mmSecondOpinion(e,tx.txid,tx.raw);
      res.push(r);
    }
    const out={review:false,failed:[],changed:false,settled:false};
    const x=await mmUpdate(id,y=>{
      if(y.state!=="confirming")return;
      for(const r of res){
        const t=(y.txs||[]).find(z=>z.txid===r.tx.txid&&z.txid!=null)||(r.fixed?(y.txs||[]).find(z=>!z.txid||z.hand||z.pseudo):null);
        if(!t||t.final)continue;
        if(r.fixed){t.final=true;out.changed=true;continue;}
        const v=r.v;
        if(!v.found||(v.mined===false&&t.mined)){
          y.missing=(y.missing||0)+1;
          if(y.missing>=15){y.state="review";y.review={txid:t.txid,reason:"vanished",at:Date.now()};out.review=true;break;}
          continue;
        }
        if(v.ok===false){                                            // that payment failed on the network: it never arrived
          y.txs=y.txs.filter(z=>z!==t);y.gotRaw=mmReceived(y).toString();out.failed.push(t.txid);out.changed=true;
          mmNote(y,`deposit ${t.txid} failed on-chain`);
          if(!y.txs.length){y.state="await";delete y.gotRaw;break;}
          continue;
        }
        const amt=v.amountRaw.toString();
        if(v.mined&&(!v.toUs||amt!==t.raw)){y.state="review";y.review={txid:t.txid,reason:"amount",at:Date.now()};t.approved=false;out.review=true;break;}
        if(v.mined&&!t.mined){t.mined=true;out.changed=true;}
        if((v.conf||0)!==(t.conf||0)){t.conf=v.conf||0;out.changed=true;}
        if(!v.final)continue;
        if(r.second===false){
          y.doubts=(y.doubts||0)+1;
          if(y.doubts>=9&&!t.approved){y.state="review";y.review={txid:t.txid,reason:"nodes",at:Date.now()};out.review=true;break;}
          if(!(t.approved&&y.doubts>=9))continue;                    // an owner already approved this payment: after a long disagreement their word stands
        }
        t.final=true;t.mined=true;out.changed=true;
      }
      if(y.state==="confirming")out.settled=mmSettle(y,Date.now());
    });
    if(out.failed.length){
      const ch=await mmChannelOf(x);
      if(ch){await mmRefreshCard(ch,x);await ch.send({content:`<@${x.depositorId}>`,embeds:[mmEmb(x,"warn","Deposit Failed").setDescription("That transaction failed on the network, so nothing arrived and nothing was lost. Send it again; I spot the new transaction by myself.").setFooter(kFoot(x.id))],allowedMentions:{users:[x.depositorId]}}).catch(()=>{});}
      return;
    }
    if(out.review&&x.state==="review"){await mmAnnounceReview(x);return;}
    if(out.settled){await mmAfterJudge(x,{status:x.state},null);return;}
    if(out.changed){const ch=await mmChannelOf(x);if(ch)await mmRefreshCard(ch,x);}          // (n of N) moved
    return;
  }
  if(e.state==="sending"){
    if(!((e.out&&e.out.txids)||[]).length&&now<(e.out.nextAt||0))return;      // a failed attempt is tried again after MM_PAY_GAP_MS (20 seconds)
    await mmDrive(id);return;
  }
  // A deal that holds funds whose ticket channel is gone: the owners are told (once a day) so it is never forgotten
  if(MM_HOLDING.has(e.state)&&!e.kind&&!(await mmChannelOf(e))){
    if(now-(_mmOrphanAt.get(id)||0)>24*60*60*1000){
      _mmOrphanAt.set(id,now);
      mmAlertOwners({embeds:[kEmbed("Middleman","bad").setTitle("Middleman Funds Without A Ticket").setDescription(`**${id}** still holds **${mmAmt(e,e.gotRaw||"0")}** (${e.state}) but its ticket channel no longer exists.\nDepositor <@${e.depositorId}> · recipient <@${e.recipientId}>\n\nRun \`$mm send ${id} <address>\` to pay it out, or \`/mmadmin action:deal value:${id}\` for the controls.`).setTimestamp()]});
    }
    if(!(e.rel||e.ref))return;                                       // (a payout that was already decided is still carried out below)
  }
  // Decided (release or refund): the payout is tried again by itself every few minutes when it failed, and the address is asked for again when it is missing or unconfirmed
  if(e.state==="funded"&&!e.dispute&&(e.rel||e.ref)){
    const dec=e.rel||e.ref,kind=e.rel?"release":"refund",to=e.rel?e.payout:e.refundTo,t=(_mem.tickets||{})[e.channelId];
    if(t&&t.reported)return;                                        // a flagged ticket is frozen until an owner has looked at it
    if(to&&!mmNeedsAddrOk(e,kind,to)){
      if(now>=(e.retryAt||0)){
        await mmUpdate(id,y=>{if(y.state==="funded")y.retryAt=now+MM_RETRY_MS;});
        await mmGoPayout(id,kind,dec.by||"auto",{owner:!!(e.out&&e.out.force)||(dec.by&&isOwner(dec.by))}).catch(err=>{if(!(err instanceof MmError))console.error(`[mm] payout retry ${id}:`,err.message);});
      }
    }else{
      const asked=Math.max(e.askedAt||0,dec.at||0);
      if(now-asked>(e.askedAgain?6*60*60*1000:MM_ASK_MS)){
        const ch=await mmChannelOf(e);
        if(ch){await mmUpdate(id,y=>{y.askedAgain=true;});const cur=await mmGet(id);if(to)await mmAddrCard(ch,cur,e.rel?"payout":"refundTo",true);else await mmAskAddress(ch,cur,{again:true});}
      }
    }
    return;
  }
  // Funds that have been secured for a day without a release or a refund: both sides are reminded (once a day), and the owners hear about it
  if(e.state==="funded"&&!e.dispute&&!e.kind){
    const since=Math.max(e.fundedAt||0,e.nudgedAt||0);
    if(since&&now-since>24*60*60*1000){
      let did=false;
      const x=await mmUpdate(id,y=>{if(y.state==="funded"&&Math.max(y.fundedAt||0,y.nudgedAt||0)===since){y.nudgedAt=now;did=true;}});
      if(did){
        const ch=await mmChannelOf(x);
        if(ch)await ch.send({content:`<@${x.depositorId}> <@${x.recipientId}>`,embeds:[mmEmb(x,"warn","Still Holding Funds")
          .setDescription(`The middleman is still holding **${mmAmt(x,x.gotRaw)}** for this ticket. Finish the exchange and press **Release Funds** on the card, or use **Help**, then **Refund**, if it is called off. Stuck? Type \`$mm help\`.`).setFooter(kFoot(x.id))],allowedMentions:{users:[x.depositorId,x.recipientId]}}).catch(()=>{});
        mmAlertOwners({embeds:[kEmbed("Middleman","warn").setTitle("Middleman Funds Waiting").setDescription(`**${x.id}** has held **${mmAmt(x,x.gotRaw)}** for over a day. <@${x.depositorId}> → <@${x.recipientId}>`).setTimestamp()],components:mmLinkRow(x)});
      }
    }
  }
}
// What a person is told after a transaction was judged, and what the channel hears
async function mmAfterJudge(e,r,by){
  const ch=await mmChannelOf(e);
  if(r.status==="rejected"){
    if(ch){await mmRefreshCard(ch,e);await ch.send({content:`<@${by||e.depositorId}>`,embeds:[mmEmb(e,"warn","Transaction Not Accepted").setDescription(mmWhyText(e,r.why)).setFooter(kFoot(e.id))],allowedMentions:{users:[by||e.depositorId]}}).catch(()=>{});}
    return;
  }
  if(r.status==="funded"){await mmAnnounceFunded(e);return;}
  if(r.status==="short"){await mmAnnounceShort(e);return;}
  if(r.status==="review"){await mmAnnounceReview(e);return;}
  mmStage(e);
  if(ch)await mmRefreshCard(ch,e);
}

// ── The wallet against what the deals say it should hold ────────────────────────────────────────────────────
// For every coin the bot holds a key for: what is in the wallet, what deals have recorded as held (hand-confirmed ones included), and the free rest.
async function mmWalletRows(){
  const rows=[];
  for(const ck of Object.keys(MM_CHAINS)){
    const chain=MM_CHAINS[ck];
    if(chain.family==="utxo")continue;
    const addr=mmDepositAddress(ck);
    if(!addr||!mmSigner(ck,addr))continue;
    let native=null;
    try{native=(await mmBalances(ck,null,addr)).native;}catch{}
    for(const a of MM_ASSETS.filter(x=>x.chain===ck)){
      let bal=null;
      if(!a.contract)bal=native;
      else{try{bal=(await mmBalances(ck,a,addr)).token;}catch{}}
      const res=await mmReservedAll(ck,addr,a.contract);
      rows.push({chain:ck,address:addr,coin:a.coin,contract:a.contract,decimals:a.decimals,balance:bal,reserved:res.total,deals:res.deals,free:bal==null?null:bal-res.total});
    }
  }
  return rows;
}
const mmRowText=r=>`**${r.coin}** on ${MM_CHAINS[r.chain].name}: holds ${r.balance==null?"unknown":mmFmtUnits(r.balance,r.decimals)} · reserved ${mmFmtUnits(r.reserved,r.decimals)}${r.deals.length?` (${r.deals.map(d=>`${d.id}${d.hand?" by hand":""}`).join(", ")})`:""} · free ${r.free==null?"unknown":mmFmtUnits(r.free,r.decimals)}`;
// Checked at start-up and every hour: one owner alert when the wallet holds less than the deals say, and a gas warning when a network can't pay a token payout
async function mmReconcile(opts){
  opts=opts||{};
  let rows;
  try{rows=await mmWalletRows();}catch(err){console.error("[mm] balance check:",err.message);return null;}
  const bad=rows.filter(r=>r.free!=null&&r.free<0n),sig=bad.map(r=>`${r.chain}:${r.coin}:${r.balance}:${r.reserved}`).join("|");
  if(bad.length&&(opts.force||sig!==_mmMeta.reconSig||Date.now()-(_mmMeta.reconAt||0)>12*60*60*1000)){
    _mmMeta.reconSig=sig;_mmMeta.reconAt=Date.now();mmSaveMeta().catch(()=>{});
    mmAlertOwners({embeds:[kEmbed("Middleman","bad").setTitle("Middleman Wallet Holds Less Than Expected").setDescription(`${bad.map(mmRowText).join("\n")}\n\nEither money is missing, or a deal that was confirmed by hand never really arrived. Look at \`$mm wallet\` and \`$mm deals\`. If a deal holds nothing, close it with \`$mm close <deal> confirm\`.`).setTimestamp()]});
  }else if(!bad.length&&_mmMeta.reconSig){_mmMeta.reconSig="";mmSaveMeta().catch(()=>{});}
  for(const ck of Object.keys(MM_CHAINS)){                           // gas watch: can the wallet pay the network fee of a token payout?
    const chain=MM_CHAINS[ck];
    if(chain.family!=="evm"||!MM_ASSETS.some(a=>a.chain===ck&&a.contract))continue;
    const addr=mmDepositAddress(ck);
    if(addr&&mmSigner(ck,addr)&&(await mmGasReady(ck,addr))===false)mmGasLow(ck,addr);
  }
  return rows;
}
// Once, after the first start with a wallet the bot made for itself: the owners are reminded to save the keys
async function mmBackupReminder(){
  if(!_mmKeys||_mmMeta.backupAt||_mmMeta.backupReminded)return false;
  _mmMeta.backupReminded=Date.now();await mmSaveMeta().catch(()=>{});
  await mmAlertOwners({embeds:[kEmbed("Middleman","warn").setTitle("Save The Middleman Wallet Keys").setDescription("The bot made its own middleman wallet, and its keys have not been backed up yet. If the bot or its database is ever lost, the money in it is lost with it.\n\nRun `/mmadmin action:backup` once and keep the keys somewhere private. This reminder is sent only once.").setTimestamp()]});
  return true;
}

// ── Buttons, menus and forms on the middleman card ──────────────────────────────────────────────────────────
const mmReply=(i,content,extra)=>{
  const p={content,embeds:[],components:[],...(extra||{})};
  return (i.deferred||i.replied)?i.editReply(p).catch(()=>i.followUp({...p,flags:64}).catch(()=>{})):i.reply({...p,flags:64}).catch(()=>{});
};
const mmModal=(id,title,inputs)=>{
  const m=new ModalBuilder().setCustomId(id).setTitle(String(title).slice(0,45));
  for(const x of inputs)m.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(x.id).setLabel(String(x.label).slice(0,45)).setStyle(x.long?TextInputStyle.Paragraph:TextInputStyle.Short).setRequired(x.required!==false).setMinLength(x.min||0).setMaxLength(x.max||200).setPlaceholder(String(x.hint||"").slice(0,100))));
  return m;
};
async function mmCtx(interaction,id){
  const uid=interaction.user.id,owner=isOwner(uid,interaction.member);
  let e=null;
  if(id)e=await mmFresh(id);
  else{const t=(_mem.tickets||{})[interaction.channelId||(interaction.channel&&interaction.channel.id)];e=t&&t.mmId?await mmFresh(t.mmId):null;}
  if(!e)throw new MmError("gone","There is no middleman deal here any more. Type `$mm` in the ticket to start one.");
  return {e,uid,owner,isDep:uid===e.depositorId,isRec:uid===e.recipientId,ticket:(_mem.tickets||{})[e.channelId]||null};
}
const _mmHelpAt=new Map(),_mmTapAt=new Map();
// Pings the owners into the ticket (and by DM). Used by Ping Owners (in the Help menu), by "$mm help", and by any button that breaks.
async function mmHelp(channel,uid,e,why){
  const wait=MM_HELP_COOLDOWN_MS-(Date.now()-(_mmHelpAt.get(channel.id)||0));
  if(wait>0)return {ok:false,wait};
  _mmHelpAt.set(channel.id,Date.now());
  const owners=CONFIG.OWNER_IDS;
  await channel.send({content:`${owners.map(id=>`<@${id}>`).join(" ")} <@${uid}> needs help with the middleman in this ticket.${why?`\n> ${String(why).slice(0,300)}`:""}`,allowedMentions:{users:owners}}).catch(()=>{});
  const link=channel.guild?`https://discord.com/channels/${channel.guild.id}/${channel.id}`:null;
  mmAlertOwners({embeds:[kEmbed("Middleman","warn").setTitle("Middleman Help Requested").setDescription(`<@${uid}> asked for help${e?` on **${e.id}** (${MM_TITLE[e.state]||e.state})`:""} in #${channel.name}.${why?`\n> ${String(why).slice(0,300)}`:""}`).setTimestamp()],
    components:link?[new ActionRowBuilder().addComponents(kLink("Open Ticket",link))]:[]});
  return {ok:true};
}
// A pasted or typed transaction: checks it, updates the card and the channel, and returns what to tell the person who sent it
async function mmDoSubmit(e,text,uid){
  const txid=mmParseTxid(e.chain,text);
  if(!txid)return `That doesn't look like a ${MM_CHAINS[e.chain].name} transaction ID. Nothing changed. Paste the ID (or the explorer link) of the transaction you sent.`;
  const r=await mmSubmit(e.id,txid,uid),cur=await mmGet(e.id);
  if(r.status==="watch"){
    const ch=await mmChannelOf(cur);if(ch)await mmRefreshCard(ch,cur);
    return "The network can't see that transaction yet, which is normal for the first minute. Your funds are safe. I'll keep checking for 30 minutes and update the card by myself.";
  }
  if(r.status==="rejected"){const ch=await mmChannelOf(cur);if(ch)await mmRefreshCard(ch,cur);return mmWhyText(cur,r.why);}
  await mmAfterJudge(cur,r,uid);
  return r.status==="funded"?"Deposit confirmed. The funds are secured.":r.status==="short"?"Got it. Less than the asked amount arrived, so the card now lets the receiver continue or refund. Your funds are safe.":r.status==="review"?"Got it. An owner has to check this deposit before it counts, and they have been pinged. Your funds are safe.":"Got it. Deposit seen, waiting for the network to confirm it. The card updates by itself.";
}
function mmOwnerPanel(e){
  const o=e.out||{},last=(o.txids||[])[(o.txids||[]).length-1],v=e.txs&&e.txs.length?mmVerdict(e):null;
  const lines=[
    `**State**  ${MM_TITLE[e.state]||e.state}${e.dispute?"  ·  in dispute":""}`,
    `**Deal**  ${e.hero}  ·  ${fmtUSD(e.usd)} of ${e.coin}`,
    `**Depositor**  <@${e.depositorId}>   **Recipient**  <@${e.recipientId}>`,
  ];
  if(e.chain){
    lines.push(`**Network**  ${mmNetOf(e)}  ·  ${mmSigner(e.chain,e.address)?"the bot pays out":"an owner pays out"}`,`**Middleman address**  \`${e.address}\``,`**Asked**  ${mmAmt(e,e.needRaw,e.dp)}${e.gotRaw?`   **Arrived**  ${mmAmt(e,e.gotRaw)}${v&&v.kind!=="ok"?` (${v.kind==="over"?"over":"short"} by ${mmAmt(e,v.diff)})`:""}`:""}`);
    for(const t of (e.txs||[]).slice(-4))lines.push(`**Deposit**  ${t.txid?mmTxLink(e,t.txid):"confirmed by hand"}  ${mmAmt(e,t.raw)}${t.from?`  from \`${t.from}\``:""}${t.final?"":"  (not final)"}`);
    if(e.sender)lines.push(`**Sender wallet**  \`${e.sender}\``);
  }
  lines.push(`**Payout address**  ${e.payout?`\`${e.payout}\``:"not set"}`,`**Refund address**  ${e.refundTo?`\`${e.refundTo}\``:"not set"}`);
  if(o.kind)lines.push(`**${o.kind==="refund"?"Refund":"Release"}**  ${mmAmt(e,o.amountRaw||e.gotRaw||"0")} to \`${o.to}\`${last?`  ·  ${mmTxLink(e,last.txid)}`:""}${o.problem?`\n${o.problem}`:""}${o.lastError?`\nLast error: ${String(o.lastError).slice(0,150)}`:""}`);
  if(e.payFail)lines.push(`**Payout problem**  ${String(e.payFail.msg||"").slice(0,200)}`);
  const hist=(e.log||[]).slice(-6).map(l=>`<t:${Math.floor(l.at/1000)}:t> ${String(l.ev).slice(0,90)}`).join("\n");
  const emb=mmEmb(e,"brand",`Owner Controls  ·  ${e.id}`).setDescription(lines.join("\n").slice(0,3500));
  if(hist)emb.addFields({name:"History (the last six; `$mm history "+e.id+"` shows all)",value:hist.slice(0,1024),inline:false});
  const G=ButtonStyle.Secondary,b=(act,label,style)=>kBtn(`mm_x__${act}__${e.id}`,label,style||G),rows=[];
  const add=(...btns)=>{if(btns.length)rows.push(new ActionRowBuilder().addComponents(...btns));};
  if(e.state==="net")add(b("cancel","Cancel Middleman"));
  if(e.state==="await")add(b("hand","Confirm Deposit By Hand",ButtonStyle.Success),b("setpay","Set Payout Address"),b("cancel","Cancel Middleman"));
  if(e.state==="review")add(b("approve","Approve Deposit",ButtonStyle.Success),b("reject","Reject Deposit",ButtonStyle.Danger),b("setpay","Set Payout Address"));
  if(e.state==="confirming")add(b("release","Release To Recipient",ButtonStyle.Success),b("refund","Refund Depositor",ButtonStyle.Danger),b("setpay","Set Payout Address"),b("setref","Set Refund Address"));
  if(e.state==="short")add(b("accept","Accept Shortfall",ButtonStyle.Success),b("refund","Refund Depositor",ButtonStyle.Danger),b("hand","Add Deposit By Hand"),b("setref","Set Refund Address"));
  if(e.state==="funded"){
    add(b("release","Release To Recipient",ButtonStyle.Success),b("refund","Refund Depositor",ButtonStyle.Danger),b("sent","Mark Sent By Hand"));
    add(b("setpay","Set Payout Address"),b("setref","Set Refund Address"),...(e.payFail?[b("kick","Retry Payout",ButtonStyle.Success)]:[]),...(e.dispute?[b("undispute","Clear Dispute")]:[]));
  }
  if(e.state==="sending"||e.state==="stuck")add(b("retry","Retry Send",ButtonStyle.Success),b("sent","Mark Sent By Hand"));
  if(e.state==="payout")add(b("sent","Mark Sent",ButtonStyle.Success));
  return {embeds:[emb],components:rows};
}

// ── Looks shared by every middleman message: the coin's logo as the thumbnail, coin and network in the title ──
const mmCoinTitle=e=>e&&e.coin?`${e.coin}${e.chain?`  ·  ${MM_CHAINS[e.chain].name}`:""}`:"Middleman";
function mmEmb(e,tone,label){
  const emb=kEmbed("Middleman",tone).setTitle(label?`${mmCoinTitle(e)}  ·  ${label}`:mmCoinTitle(e));
  const logo=e&&COIN_LOGO[e.coin];
  if(logo)emb.setThumbnail(logo);
  return emb;
}
async function mmDm(uid,payload){try{const u=await client.users.fetch(uid);await u.send(payload);return true;}catch{return false;}}
// Every payment that leaves the wallet is written to a private owner channel (MM_LOG_CHANNEL_ID, or the bot's log channel): deal, amount, address, link, who
const mmLogChannelId=()=>process.env.MM_LOG_CHANNEL_ID||CONFIG.LOG_CHANNEL||null;
const mmWho=by=>/^\d{15,25}$/.test(String(by||""))?`<@${by}>`:(by?String(by):"the bot, by itself");
async function mmPayLog(e,what){
  try{
    const id=mmLogChannelId();if(!id||!e)return;
    const g=client.guilds.cache.get(e.guildId||CONFIG.GUILD_ID)||client.guilds.cache.first(),ch=g&&g.channels.cache.get(id);
    if(!ch)return;
    const o=e.out||e.lastOut||{},last=(o.txids||[])[(o.txids||[]).length-1],txid=o.txid||(last&&last.txid)||null;
    const title=what==="sent"?"Payment Sent":what==="confirmed"?"Payment Confirmed":"Payment Marked Sent By Hand";
    const emb=kEmbed("Middleman Payments",what==="sent"?"brand":"ok").setTitle(`${title}  ·  ${e.id}`)
      .addFields({name:"Deal",value:`${e.id}  ·  ${o.kind||"release"}${e.kind?`  ·  ${e.kind}`:""}`,inline:true},{name:"Amount",value:mmAmt(e,o.sentRaw||o.amountRaw||e.gotRaw||"0"),inline:true},{name:"Network",value:mmNetOf(e),inline:true},
        {name:"To",value:"```"+(o.to||"unknown")+"```",inline:false},{name:"Transaction",value:txid?mmTxLink(e,txid):"none yet",inline:true},{name:"Triggered by",value:mmWho(o.by),inline:true})
      .setTimestamp();
    await ch.send({embeds:[emb]});
  }catch(err){console.error("[mm] payment log:",err.message);}
}

// ── Who gets the funds: decide first, then the address ──────────────────────────────────────────────────────
// A release or a refund is DECIDED first (e.rel / e.ref). The address can come before or after: the receiving person simply pastes it in the ticket and
// confirms it. The moment a decision and a confirmed address are both there, the payout starts.
async function mmSaveAddress(e,which,raw,uid,opts){
  opts=opts||{};
  const addr=mmNormAddress(e.chain,raw);
  if(!addr)return {ok:false,text:`That is not a valid ${MM_CHAINS[e.chain].name} address. Nothing was changed and the funds are safe. Check it and paste it again.`};
  if(mmSameAddr(e.chain,addr,e.address)||(e.contract&&String(addr).toLowerCase()===e.contract))return {ok:false,text:"That is the middleman's own address. Nothing was changed and the funds are safe. Paste the wallet that should receive the funds."};
  let was=null;
  const okKey=which==="payout"?"payoutOk":"refundOk";
  const x=await mmUpdate(e.id,y=>{
    if(!["await","short","confirming","review","funded"].includes(y.state))throw new MmError("state","The address can't be changed at this stage. Nothing changed and the funds are safe.");
    was=y[which]||null;y[which]=addr;
    if(opts.owner||(y.v||1)<2)y[okKey]=mmAddrTag(addr);             // an owner's address, and every address on a deal from before v18, needs no confirmation
    else if(was!==addr)delete y[okKey];
    mmNote(y,`${which==="payout"?"payout":"refund"} address ${was?"changed to":"set to"} ${addr}`,uid);
  });
  const kind=which==="payout"?"release":"refund",decided=kind==="release"?x.rel:x.ref;
  if(!opts.owner&&(x.v||1)>=2&&mmNeedsAddrOk(x,kind,addr)){          // it is shown back to the person who pasted it, who confirms it
    const ch=await mmChannelOf(x);
    if(ch){await mmRefreshCard(ch,x);await mmAddrCard(ch,x,which,false);}
    return {ok:true,confirm:true,e:x,text:"Saved. Press **Confirm Address** on the card to lock it in."};
  }
  if(decided&&x.state==="funded"){                                  // the decision came first: this address was the missing piece
    try{
      const r=await mmGoPayout(x.id,kind,decided.by||uid,{owner:!!opts.owner});
      return {ok:true,sent:true,e:r.e,text:r.state==="payout"?"Saved. An owner sends it by hand and has been pinged.":"Saved. Sending now."};
    }catch(err){if(err instanceof MmError)return {ok:true,e:x,text:`Saved. ${err.message}`};throw err;}
  }
  const ch=await mmChannelOf(x);
  if(ch)await mmRefreshCard(ch,x);
  return {ok:true,e:x,text:"Saved."};
}
// The pasted address, shown back with two buttons. It is only used once its owner confirms it.
async function mmAddrCard(ch,e,which,ping){
  const rel=which==="payout",to=rel?e.payout:e.refundTo,who=rel?e.recipientId:e.depositorId;
  const emb=mmEmb(e,"warn","Confirm The Address")
    .setDescription(`${kHero(`${mmAmt(e,e.gotRaw||e.needRaw)} → <@${who}>`)}\nIs this the right **${e.coin}** address (${mmNetOf(e)})? A payment can't be undone, so check every character.\n\`\`\`${to}\`\`\`\n${rel?"It is sent as soon as you confirm and the release is done.":"It is sent as soon as you confirm."}`)
    .setFooter(kFoot(`Built-in server middleman bot  ·  ${e.id}`));
  const payload={embeds:[emb],components:[new ActionRowBuilder().addComponents(kBtn(`mm_aok__${which}__${e.id}__${mmAddrTag(to)}`,"Confirm Address",ButtonStyle.Success),kBtn(`mm_achg__${which}__${e.id}`,"Change",ButtonStyle.Secondary))]};
  if(ping){payload.content=`<@${who}>`;payload.allowedMentions={users:[who]};}
  const old=e.addrMsgId?await ch.messages.fetch(e.addrMsgId).catch(()=>null):null;
  if(old)await old.edit({components:[]}).catch(()=>{});            // an older card can't be used any more
  const sent=await ch.send(payload).catch(()=>null);
  if(sent){e.addrMsgId=sent.id;await mmUpdate(e.id,x=>{x.addrMsgId=sent.id;x.askedAt=Date.now();}).catch(()=>{});}
  return sent;
}
// Asks the right person (the receiver after a release, the sender after a refund) for their address, in the chat
async function mmAskAddress(ch,e,opts){
  opts=opts||{};
  const refund=!!e.ref&&!e.rel,who=refund?e.depositorId:e.recipientId,v2=(e.v||1)>=2,amt=mmAmt(e,e.gotRaw);
  await mmUpdate(e.id,x=>{x.askedAt=Date.now();}).catch(()=>{});
  const how=refund
    ?(v2&&e.sender?`press **Refund To Sender** on the card to send it straight back to the wallet it came from (\`${mmShort(e.sender)}\`), or press **Other Address** and paste a different **${e.coin}** address (${mmNetOf(e)}) in this chat. If you sent from an exchange, use **Other Address** and paste your own wallet.`
      :`paste your **${e.coin}** address (${mmNetOf(e)}) in this chat and I send **${amt}** to it${v2?" as soon as you confirm it":" right away"}.`)
    :`paste your **${e.coin}** address (${mmNetOf(e)}) in this chat.${v2?` I show it back to you to confirm, then`:` I`} send **${amt}** to it right away.`;
  await ch.send({content:`<@${who}>`,embeds:[mmEmb(e,"ok",opts.again?"Still Waiting For Your Address":refund?"Refund":"Paste Your Address")
    .setDescription(`${opts.reason?`${opts.reason}\n`:""}${refund?"The exchange was called off.":`<@${e.depositorId}> released the funds.`} <@${who}>, ${how}`)
    .setFooter(kFoot(`Built-in server middleman bot  ·  ${e.id}`))],allowedMentions:{users:[who]}}).catch(()=>{});
}

// The first valid address for this deal's network in a message: a bare address, one inside a sentence, or an explorer link to it
function mmFindAddress(e,text){
  const s=String(text||"").trim();
  if(!e||!e.chain||s.length<20||s.length>300)return null;
  for(const tok of s.split(/[\s,;]+/)){
    let t=tok.replace(/^[`"'(<\[*_]+|[`"'.)>\]:!?*_]+$/g,"");
    const m=t.match(/\/address\/([^/?#\s]+)/);
    if(m)t=m[1];
    if(t.length<20||t.length>100)continue;
    const a=mmNormAddress(e.chain,t);
    if(a)return a;
  }
  return null;
}
// Records "release" or "refund" (the decision). opts.tag (from the confirmation the person saw) must still match the address on file.
// An owner can decide in any holding state: the deposit then counts on their word and no approve step is needed.
async function mmDecide(id,kind,by,opts){
  opts=opts||{};
  let created=false,ended=false;
  const e=await mmUpdate(id,x=>{
    const was=x.state,early=(was==="confirming"||was==="review"||was==="short")&&(!!opts.owner||(!!opts.early&&kind==="refund"&&was!=="review"));
    if(x.state!=="funded"&&!early)throw new MmError("state",mmStateWhy(x));
    if(x.dispute&&!opts.owner)throw new MmError("dispute","This deal is in dispute. Nothing changed and the funds are safe. Only an owner can release or refund it now.");
    const key=kind==="release"?"rel":"ref",other=kind==="release"?"ref":"rel";
    if(opts.tag!=null){
      const to=kind==="release"?x.payout:x.refundTo,cur=to?mmAddrTag(to):"-";
      if(opts.tag!==cur)throw new MmError("changed","The address changed since you opened this. Nothing changed and the funds are safe. Check it and press the button again.");
    }
    if(early){
      if(!x.gotRaw||!(x.txs||[]).length)throw new MmError("state",`No deposit has arrived for this deal, so there is nothing to ${kind}. Nothing changed and nobody has lost anything. Use cancel instead.`);
      if(opts.owner){                                                // an owner's word counts: the deposit is taken as it is, no approve step
        for(const t of x.txs){t.approved=true;t.final=true;}
        x.state="funded";x.fundedAt=x.fundedAt||Date.now();delete x.review;if(was==="short")x.accepted={by,at:Date.now(),owner:true};
        mmNote(x,`an owner decided the ${kind} while the deal was ${was}`,by);
      }else if(was==="short"){x.state="funded";x.fundedAt=x.fundedAt||Date.now();mmNote(x,`the ${kind} was decided while the deal was short`,by);}      // nothing was paid for yet: either side may call it off
      else mmNote(x,`the ${kind} was decided while the deposit was confirming`,by);                                                                        // it goes ahead as soon as the deposit is final
    }
    if(x[other]){
      if(!opts.owner)throw new MmError("state",`A ${other==="rel"?"release":"refund"} is already decided for this deal. Nothing changed and the funds are safe. An owner can change that.`);
      delete x[other];
    }
    if(!x[key]){x[key]={by,at:Date.now()};delete x.askedAt;delete x.askedAgain;x.autoTries=0;delete x.autoAt;mmNote(x,`${kind} decided`,by);created=true;}
    if(opts.owner&&x.dispute){                                       // an owner's decision settles the dispute: the lock ends, so the address can be confirmed and the payout runs as usual
      x.disputeEnded={opened:x.dispute,by,at:Date.now(),how:kind};delete x.dispute;
      mmNote(x,`an owner decided the dispute: ${kind}`,by);ended=true;
    }
  });
  return {e,created,ended};
}
// Decide, then pay out if the address is known and confirmed, or ask for it. Returns {state:"ask"|"confirm"|"sending"|"payout"|..., e}.
// On a deal that is already paying out (or stuck) the same call tries the payout again right now.
async function mmGoPayout(id,kind,by,opts){
  opts=opts||{};
  const cur=await mmFresh(id);
  if(cur&&(cur.state==="sending"||cur.state==="stuck"||cur.state==="payout"))return mmRetryPayout(id,kind,by,opts);
  const d=await mmDecide(id,kind,by,opts);
  let e=d.e;
  const ch=await mmChannelOf(e);
  if(d.ended&&ch)await ch.send({embeds:[mmEmb(e,"ok","Dispute Decided").setDescription(`<@${by}> decided the dispute: the funds are ${kind==="release"?`released to <@${e.recipientId}>`:`refunded to <@${e.depositorId}>`}. The funds stay safe until the next step on the card is done.`).setFooter(kFoot(e.id))]}).catch(()=>{});
  if(e.state!=="funded"){mmStage(e);if(ch)await mmRefreshCard(ch,e);return {state:e.state,e};}      // decided while the deposit is still confirming: it goes ahead once the deposit is final
  const to=opts.to||(kind==="release"?e.payout:e.refundTo);
  if(!to){
    if(d.created||(opts.ask&&Date.now()-(e.askedAt||0)>MM_REASK_MS)){mmStage(e);if(ch){await mmRefreshCard(ch,e);await mmAskAddress(ch,e);}}      // only the press that made the decision asks (a second press does not ask again)
    return {state:"ask",e};
  }
  if(!opts.owner&&mmNeedsAddrOk(e,kind,to)){
    mmStage(e);
    if(ch){await mmRefreshCard(ch,e);if(d.created||(opts.again&&Date.now()-(e.askedAt||0)>MM_REASK_MS))await mmAddrCard(ch,e,kind==="release"?"payout":"refundTo",true);}
    return {state:"confirm",e};
  }
  e=await mmStartPayout(id,kind,by,{owner:opts.owner,force:opts.force,to:opts.to,tag:opts.tag});
  if(ch)await mmRefreshCard(ch,e);
  mmStage(e);
  if(e.state==="payout"){await mmAnnouncePayout(e);return {state:"payout",e};}
  if(opts.wait){e=await mmDrive(id).catch(err=>{console.error("[mm] drive:",err.message);return e;});return {state:e.state,e};}
  mmDrive(id).catch(err=>console.error("[mm] drive:",err.message));
  return {state:"sending",e};
}
// Repeating release/refund on a deal that is already paying out: it is tried again NOW, and the answer says what really happened
async function mmRetryPayout(id,kind,by,opts){
  opts=opts||{};
  let e=await mmFresh(id);
  const o=e.out||{};
  if(o.kind&&o.kind!==kind){
    if((o.txids||[]).length)throw new MmError("state",`A ${o.kind} is already on its way, so it can't be switched to a ${kind}. Nothing changed and the funds are safe. Wait for it to land.`);
    if(!opts.owner)throw new MmError("state",`A ${o.kind} was already decided for this deal, so a ${kind} isn't possible. Nothing changed and the funds are safe. An owner can change that.`);
    await mmUpdate(id,x=>{
      if((x.state!=="sending"&&x.state!=="stuck"&&x.state!=="payout")||(x.out&&(x.out.txids||[]).length))throw new MmError("state","This payout moved on in the meantime. Nothing changed. Check the card.");
      x.lastOut={...x.out};delete x.out;x.state="funded";delete x.rel;delete x.ref;mmNote(x,`an owner switched the ${o.kind} to a ${kind}`,by);
    });
    return mmGoPayout(id,kind,by,opts);
  }
  if(e.state==="payout"){await mmAnnouncePayout(e);return {state:"payout",e};}
  if(e.state==="stuck"&&!opts.owner)throw new MmError("state","An owner has to finish this payout. Nothing changed and the funds are safe. Press **Help**, then **Ping Owners** if they have not answered yet.");
  if(e.state==="sending"&&!(e.out.txids||[]).length)await mmUpdate(id,x=>{if(x.state==="sending"&&x.out&&!(x.out.txids||[]).length){x.out.attempts=0;delete x.out.nextAt;}}).catch(()=>{});
  const x=await mmDrive(id,{retry:e.state==="stuck"});
  const ch=await mmChannelOf(x);if(ch)await mmRefreshCard(ch,x);
  return {state:x.state,e:x,retried:true};
}
const mmErrText=s=>String(s||"").replace(/^[a-z_]+:\s*/i,"").slice(0,220);
// What to tell a person after a release / refund press or a retry. Never "already being sent" when nothing is in flight.
function mmPayoutText(r,kind){
  const e=r.e,who=`<@${kind==="release"?e.recipientId:e.depositorId}>`,o=e.out||{},last=(o.txids||[])[(o.txids||[]).length-1];
  if(r.state==="ask")return kind==="refund"&&(e.v||1)>=2?`Done. ${who} chooses **Refund To Sender** or **Other Address** on the card, and the funds go back right away.`:`Done. ${who} has been asked to paste their address in the chat, and the funds go out as soon as it is confirmed.`;
  if(r.state==="funded"||r.state==="confirming"||r.state==="short")return `Noted. The refund goes ahead as soon as the deposit is final. ${who} is asked for the address then. Nothing was sent yet and the funds are safe.`;
  if(r.state==="confirm")return `Saved. ${who} has to confirm the address on the card, and the funds go out right away.`;
  if(r.state==="payout")return "This wallet is watch-only, so an owner sends it by hand. They have been pinged and the card updates when it is sent.";
  if(MM_TERMINAL.has(e.state))return `Sent.${e.out&&e.out.txid?` ${mmTxLink(e,e.out.txid)}`:""} The card is updated.`;
  if(e.state==="stuck")return "The payout needs an owner to finish it. The funds are safe and the owners have been told.";
  if(e.state==="funded"&&e.payFail)return `Not through yet: ${mmErrText(e.payFail.msg)}. The funds are safe in the middleman. I keep trying by myself and the owners have been told.`;
  if(r.retried&&last)return `A payment is already on its way (${mmTxLink(e,last.txid)}). The card updates when the network confirms it.`;
  if(r.retried&&o.lastError)return `Trying again now. The last try failed: ${mmErrText(o.lastError)}. The funds are safe. I try every ${Math.round(MM_PAY_GAP_MS/1000)} seconds, ${MM_PAY_TRIES} times, and then tell the owners.`;
  return "Sending now. The card updates when the network confirms it.";
}

// Cancelling: a deal that holds nothing is simply cancelled. Once funds have arrived (or are arriving), cancelling IS the refund flow.
async function mmCancelDo(e,uid,owner){
  const id=e.id,need=(ok,text)=>{if(!ok)throw new MmError("no",text);},isRec=uid===e.recipientId;
  if((e.state==="net"||e.state==="await")&&!(e.txs||[]).length){
    need(!(e.watch||[]).length||owner,"A transaction is still being looked for, so this can't be cancelled yet. Nothing changed and your funds are safe. Wait for it, or press **Ping Owners**.");
    let moved=false;
    const x=await mmUpdate(id,y=>{
      if((y.state!=="net"&&y.state!=="await")||(y.txs||[]).length){moved=true;return;}
      need(!(y.watch||[]).length||owner,"A transaction is still being looked for. Nothing changed and your funds are safe.");
      y.state="cancelled";mmNote(y,owner?"cancelled by an owner":"cancelled",uid);
    });
    if(!moved){
      mmSaveTicket(x.channelId,t=>{if(t.mmId===x.id)t.mmStage=null;});
      const ch=await mmChannelOf(x);if(ch)await mmRefreshCard(ch,x);
      return "Cancelled. Nothing was held, so nothing needed to be sent back.";
    }
    e=await mmFresh(id);                                             // a deposit landed in the same moment: it goes to the refund flow below
  }
  need(MM_HOLDING.has(e.state),"This deal is already finished. Nothing changed.");
  need(!["sending","payout","stuck"].includes(e.state),"A payout is already running for this deal. Nothing changed and the funds are safe.");
  need(!e.dispute||owner,"This deal is in dispute, so only an owner can call it off. Nothing changed and the funds are safe.");
  need(e.state!=="review"||owner,"An owner is checking the deposit, so only they can refund it. Nothing changed and the funds are safe.");
  need(e.state!=="funded"||owner||isRec,`The funds are secured, so only <@${e.recipientId}> can call the exchange off (they have not been paid yet). Ask them to press **Refund**, or press **Dispute** in the help menu if you don't agree. Nothing changed and the funds are safe.`);
  need(!e.rel||owner,`The release is already decided. <@${e.recipientId}> just confirms their address. Nothing changed and the funds are safe.`);
  const r=await mmGoPayout(id,"refund",uid,{owner,early:true});
  return `The exchange is called off. ${mmPayoutText(r,"refund")}`;
}
// Continue: the receiver accepts what arrived (less than asked)
async function mmAccept(id,uid,owner){
  let did=false;
  const x=await mmUpdate(id,y=>{
    if(y.state!=="short")throw new MmError("state","There is no shortfall to accept on this deal. Nothing changed and the funds are safe.");
    if(y.dispute&&!owner)throw new MmError("dispute","This deal is in dispute. Nothing changed and the funds are safe. Only an owner can decide it now.");
    y.state="funded";y.fundedAt=Date.now();y.accepted={by:uid,at:Date.now(),owner:!!owner&&uid!==y.recipientId};mmNote(y,"shortfall accepted",uid);did=true;
  });
  if(did)await mmAnnounceFunded(x);
  return "Accepted. The funds are secured at the amount that arrived, and the card says so.";
}
// A dispute: the funds lock, both sides give their statement, the owners get both and Release / Refund buttons
function mmDisputeAlert(x,again){
  const st=(x.dispute&&x.dispute.stmts)||{},line=u=>st[u]?`<@${u}>: ${String(st[u]).slice(0,380)}`:`<@${u}>: has not added their side yet`;
  mmAlertOwners({content:CONFIG.OWNER_IDS.map(o=>`<@${o}>`).join(" "),embeds:[kEmbed("Middleman","bad").setTitle(again?"Middleman Dispute: Both Sides In":"Middleman Dispute").setDescription(`**${x.id}** · holding **${mmAmt(x,x.gotRaw||"0")}** · <@${x.depositorId}> → <@${x.recipientId}>\n${line(x.depositorId)}\n${line(x.recipientId)}\n\nThe funds are locked. Decide it with a button; it asks for the address as usual.`).setTimestamp()],
    components:mmLinkRow(x,[kBtn(`mm_x__release__${x.id}`,"Release To Recipient",ButtonStyle.Success),kBtn(`mm_x__refund__${x.id}`,"Refund Depositor",ButtonStyle.Danger)])});
}
async function mmOpenDispute(e,uid,reasonRaw){
  const reason=String(reasonRaw||"").replace(/\s+/g," ").trim().slice(0,500);
  if(reason.length<10)throw new MmError("no","Say what went wrong in a few words, for example \"the exchanger has not paid me yet\". Nothing changed and the funds are safe.");
  let did=false,added=false;
  const x=await mmUpdate(e.id,y=>{
    if(!MM_HOLDING.has(y.state))throw new MmError("no","There are no funds in the middleman to dispute. Nothing changed. Press **Ping Owners** if you need an owner.");
    if(y.dispute){
      if((uid===y.depositorId||uid===y.recipientId)&&!(y.dispute.stmts||{})[uid]){y.dispute.stmts={...(y.dispute.stmts||{}),[uid]:reason};mmNote(y,"dispute statement added",uid);added=true;}
      return;
    }
    y.dispute={by:uid,at:Date.now(),reason,stmts:{[uid]:reason}};mmNote(y,"dispute opened",uid);did=true;
  });
  const ch=await mmChannelOf(x),other=uid===x.depositorId?x.recipientId:x.depositorId;
  if(did){
    if(ch){
      await mmRefreshCard(ch,x);
      const owners=CONFIG.OWNER_IDS;
      await ch.send({content:`${owners.map(o=>`<@${o}>`).join(" ")} <@${other}>`,embeds:[mmEmb(x,"bad","Dispute Opened").setDescription(`<@${uid}> opened a dispute. The funds stay locked until an owner decides.\n> ${reason}\n\n<@${other}>, press **Add Your Side** so the owners hear both of you.`).setFooter(kFoot(x.id)).setTimestamp()],
        components:[new ActionRowBuilder().addComponents(kBtn(`mm_dstmt__${x.id}`,"Add Your Side",ButtonStyle.Secondary))],allowedMentions:{users:[...owners,other]}}).catch(()=>{});
      log(ch.guild,`MM DISPUTE: #${ch.name} | ${x.id} | by ${uid} | ${reason.slice(0,150)}`);
    }
    mmDisputeAlert(x,false);
    return `The dispute is open: the funds are locked and the owners have been pinged. <@${other}> was asked to add their side.`;
  }
  if(added){
    if(ch)await ch.send({embeds:[mmEmb(x,"warn","Dispute: Statement Added").setDescription(`<@${uid}> added their side. The owners have both sides now and will decide. The funds stay locked.`).setFooter(kFoot(x.id))]}).catch(()=>{});
    mmDisputeAlert(x,true);
    return "Added. The owners have both sides now, and the funds stay locked until they decide.";
  }
  return "This deal is already in dispute and your side is on record. The owners are on it, and the funds stay locked.";
}
// Owner tools that work on a deal by its ID (typed anywhere, or from /mmadmin)
async function mmOwnerClose(id,uid,confirmed){
  const e=await mmFresh(id);
  if(!e)throw new MmError("gone","No deal with that ID. Nothing changed.");
  if(MM_TERMINAL.has(e.state))throw new MmError("state",`${e.id} is already finished (${e.state}). Nothing changed.`);
  if(["sending","payout","stuck"].includes(e.state))throw new MmError("state","A payout is running for that deal, so it can't be closed. Nothing changed and the funds are safe.");
  const holds=e.gotRaw&&BigInt(e.gotRaw)>0n&&MM_HOLDING.has(e.state);
  if(holds&&!confirmed)throw new MmError("confirm",`**${e.id}** says it holds **${mmAmt(e,e.gotRaw)}**. Close it only if that money is not really in the wallet (a deposit confirmed by hand that never arrived, say), or you have dealt with it yourself. To close it anyway, type \`$mm close ${e.id} confirm\`.`);
  const x=await mmUpdate(id,y=>{if(MM_TERMINAL.has(y.state)||["sending","payout","stuck"].includes(y.state))throw new MmError("state","That deal changed in the meantime. Nothing changed.");y.state="cancelled";y.closedBy=uid;mmNote(y,holds?`closed by an owner while it said it held ${mmAmt(y,y.gotRaw)}`:"closed by an owner",uid);});
  mmSaveTicket(x.channelId,t=>{if(t.mmId===x.id)t.mmStage=null;});
  const ch=await mmChannelOf(x);
  if(ch){await mmRefreshCard(ch,x);await ch.send({embeds:[mmEmb(x,"mute","Closed By An Owner").setDescription("An owner closed this middleman deal. If you still have something to sort out, type `$mm help` and an owner will help.").setFooter(kFoot(x.id))]}).catch(()=>{});}
  return `Closed **${x.id}**.${holds?" It no longer counts as holding anything.":""}`;
}
// Forces a deal's payout to an address an owner gives (any holding state; nothing signed may be in flight)
async function mmOwnerSend(id,addressRaw,uid){
  const e=await mmFresh(id);
  if(!e)throw new MmError("gone","No deal with that ID. Nothing changed.");
  if(MM_TERMINAL.has(e.state))throw new MmError("state",`${e.id} is already finished (${e.state}). Nothing changed.`);
  if(!MM_HOLDING.has(e.state)||!e.gotRaw)throw new MmError("state",`${e.id} holds nothing yet, so there is nothing to send. Nothing changed.`);
  const to=mmNormAddress(e.chain,addressRaw);
  if(!to)throw new MmError("address",`That is not a valid ${MM_CHAINS[e.chain].name} address. Nothing was sent and the funds are safe.`);
  const cur=e.out||{};
  if((cur.txids||[]).length)throw new MmError("state","A payment for that deal is already on its way (or needs checking). Use Retry Payout instead. Nothing was changed and the funds are safe.");
  if(e.state==="sending"||e.state==="stuck"||e.state==="payout")await mmUpdate(id,x=>{if((x.out&&(x.out.txids||[]).length)||!["sending","stuck","payout"].includes(x.state))throw new MmError("state","That payout moved on in the meantime. Nothing changed.");x.lastOut={...x.out};delete x.out;x.state="funded";mmNote(x,"payout reset by an owner",uid);});
  const kind=e.ref&&!e.rel?"refund":e.rel?"release":(e.sender&&mmSameAddr(e.chain,e.sender,to)?"refund":"release");
  const r=await mmGoPayout(id,kind,uid,{owner:true,force:true,to});
  return `Sending **${mmAmt(e,e.gotRaw)}** to \`${to}\` (${kind}). ${mmPayoutText(r,kind)}`;
}
// Everything an owner can do to a deal. The owner panel's buttons and the `$mm ...` commands typed in the ticket both end up here.
// Returns the text to tell the owner. A mistake throws MmError (its message is shown).
async function mmOwnerRun(e,act,arg,uid){
  arg=arg||{};
  const id=e.id,need=(ok,text)=>{if(!ok)throw new MmError("no",text);};
  if(act==="approve"){
    let did=false;
    await mmUpdate(id,y=>{need(y.state==="review","This deposit is not waiting for a check any more.");const t=(y.txs||[]).find(z=>z.txid===(y.review||{}).txid)||(y.txs||[])[0];if(t)t.approved=true;y.state="confirming";y.doubts=0;y.missing=0;delete y.review;mmNote(y,"deposit approved",uid);did=true;});
    if(did){await mmSweepOne(await mmFresh(id)).catch(()=>{});const x=await mmGet(id),c=await mmChannelOf(x);if(c&&x.state==="confirming"){mmStage(x);await mmRefreshCard(c,x);}}
    return `Approved. ${(await mmGet(id)).state==="funded"?"The funds are secured.":"It counts as soon as the network has confirmed it."}`;
  }
  if(act==="reject"){
    const rev=e.review||{},tx=(e.txs||[]).find(t=>t.txid===rev.txid)||(e.txs||[])[0];
    const x=await mmUpdate(id,y=>{
      need(y.state==="review","This deposit is not waiting for a check any more.");
      y.txs=(y.txs||[]).filter(t=>!(tx&&tx.txid&&t.txid===tx.txid));
      y.gotRaw=mmReceived(y).toString();delete y.review;y.doubts=0;y.missing=0;
      if(!y.txs.length){y.state="await";delete y.gotRaw;}else{y.state="confirming";mmSettle(y,Date.now());}
      mmNote(y,"deposit rejected",uid);
    });
    if(tx&&tx.txid)await MMDB.set(`tx:${e.chain}:${tx.txid}`,{id,at:Date.now(),refused:true}).catch(()=>{});
    const c=await mmChannelOf(x);
    if(c){mmStage(x);await mmRefreshCard(c,x);await c.send({content:`<@${x.depositorId}>`,embeds:[mmEmb(x,"warn","Deposit Not Accepted").setDescription("An owner checked that payment and it does not count for this deal. Nothing was lost: the money is still at the middleman address and the owners will sort it out with you. The deal is waiting for the deposit again. If you think this is wrong, press **Help**, then **Ping Owners**.").setFooter(kFoot(x.id))],allowedMentions:{users:[x.depositorId]}}).catch(()=>{});}
    return "Rejected. That transaction can never be used for this deal.";
  }
  if(act==="hand"){
    need(e.state==="await"||e.state==="short"||e.state==="confirming","Choose the network first, then confirm the deposit.");
    const amt=mmParseUnits(arg.amount,e.decimals),rawTx=String(arg.txid||"").trim();
    need(amt!=null&&amt>0n,`Enter the amount as a number of ${e.coin}, for example ${mmFmtUnits(e.needRaw,e.decimals,e.dp)}.`);
    const txid=rawTx?mmParseTxid(e.chain,rawTx):null;
    need(!rawTx||!!txid,"That transaction ID doesn't look right. Fix it or leave it empty.");
    if(txid&&!(await MMDB.add(`tx:${e.chain}:${txid}`,{id,at:Date.now(),hand:true}))){const prev=await MMDB.get(`tx:${e.chain}:${txid}`);need(prev&&prev.id===id,"That transaction was already used for another deal.");}
    let did=false;
    const x=await mmUpdate(id,y=>{
      need(["await","short","confirming"].includes(y.state),"This deal is not waiting for a deposit any more.");
      y.txs=(y.txs||[]).concat([{txid:txid||null,raw:amt.toString(),from:null,at:Date.now(),by:uid,mined:true,approved:true,hand:true,final:true}]);
      for(const t of y.txs)t.final=true;
      y.gotRaw=mmReceived(y).toString();y.watch=[];y.state="funded";y.fundedAt=Date.now();delete y.shortAt;
      const v=mmVerdict(y);y.verdict=v.kind;y.askedRaw=v.asked.toString();
      mmNote(y,`deposit of ${mmAmt(y,amt)} confirmed by hand`,uid);did=true;
    });
    if(did)await mmAnnounceFunded(x);
    return `Marked as funded with ${mmAmt(x,x.gotRaw)}.`;
  }
  if(act==="sent"){
    const rawTx=String(arg.txid||"").trim(),txid=rawTx?mmParseTxid(e.chain,rawTx):null;
    need(!rawTx||!!txid,"That transaction ID doesn't look right. Fix it or leave it empty.");
    need(["payout","stuck","sending","funded"].includes(e.state),"There is nothing to mark as sent on this deal.");
    if(e.state==="funded")await mmUpdate(id,y=>{need(y.state==="funded","This deal changed. Open the controls again.");const kind=y.ref&&!y.rel?"refund":"release";y.out={kind,to:(kind==="refund"?y.refundTo:y.payout)||"sent by an owner",by:uid,at:Date.now(),amountRaw:y.gotRaw,txids:[]};});
    const x=await mmFinish(id,txid,"by hand");
    await mmAnnounceDone(x);
    return "Recorded as sent.";
  }
  if(act==="release"||act==="refund"){
    const r=await mmGoPayout(id,act,uid,{owner:true});
    return mmPayoutText(r,act);
  }
  if(act==="accept")return mmAccept(id,uid,true);
  if(act==="kick"||act==="retry"){
    const cur=await mmFresh(id);
    need(cur&&(cur.state==="sending"||cur.state==="stuck"||(cur.state==="funded"&&(cur.rel||cur.ref))),"There is no payout to retry on this deal.");
    if(cur.state==="funded"){const kind=cur.rel?"release":"refund",r=await mmGoPayout(id,kind,uid,{owner:true});return mmPayoutText(r,kind);}
    const x=await mmDrive(id,{retry:true}),c=await mmChannelOf(x);
    if(c)await mmRefreshCard(c,x);
    return MM_TERMINAL.has(x.state)?"It has landed. The deal is finished.":x.state==="sending"?"Sent again. The card updates when the network confirms it.":`Still not through (${(x.out&&x.out.lastError)||x.state}). You can pay it by hand and use \`$mm sent <transaction id>\`.`;
  }
  if(act==="undispute"){
    const x=await mmUpdate(id,y=>{delete y.dispute;mmNote(y,"dispute cleared",uid);}),c=await mmChannelOf(x);
    if(c)await mmRefreshCard(c,x);
    return "Dispute cleared. The two sides can use the buttons again.";
  }
  if(act==="cancel")return mmCancelDo(e,uid,true);
  if(act==="close")return mmOwnerClose(id,uid,!!arg.confirm);
  if(act==="setpay"||act==="setref"){
    need(!!e.chain,"The network is not chosen yet.");
    return (await mmSaveAddress(e,act==="setpay"?"payout":"refundTo",arg.address,uid,{owner:true})).text;
  }
  return "That button is no longer in use.";
}

// ── What the person is shown: the confirmation, the help menu ───────────────────────────────────────────────
// The "are you sure" for Release / Refund. The button carries a tag of the address on file ("-" = none yet), so a changed address is never paid by a stale confirmation.
function mmConfirmPayload(e,kind){
  const rel=kind==="release",to=rel?e.payout:e.refundTo,who=rel?e.recipientId:e.depositorId,v2=(e.v||1)>=2;
  const lines=[kHero(`${mmAmt(e,e.gotRaw)} → <@${who}>`),mmNetOf(e)];
  if(to)lines.push("```"+to+"```");
  lines.push(rel?`Only release **after you have received the ${e.pays} payment in full**.${to?"":` <@${who}> then pastes their ${e.coin} address in the chat${v2?", confirms it,":""} and the funds go out right away.`}`
    :`This calls the exchange off and sends the ${e.coin} back to <@${who}>.${to?"":v2?` <@${who}> then chooses **Refund To Sender** or **Other Address** on the card and the funds go back right away.`:` <@${who}> pastes their ${e.coin} address in the chat and the funds go back right away.`}`);
  lines.push(`It can't be undone.${e.contract?"":" The network fee is taken out of the amount."}`);
  return {embeds:[mmEmb(e,"warn",rel?"Release The Funds?":"Refund The Funds?").setDescription(lines.join("\n"))],
    components:[new ActionRowBuilder().addComponents(kBtn(`mm_go__${kind}__${e.id}__${to?mmAddrTag(to):"-"}`,rel?"Release Now":"Refund Now",ButtonStyle.Success),kBtn("mm_back","Cancel",ButtonStyle.Secondary))]};
}
// The Help button on the card: a private menu that says what happens next and holds the rarely needed buttons, so the card itself stays clean
function mmMenuPayload(e,who){
  const G=ButtonStyle.Secondary,D=`<@${e.depositorId}>`,R=`<@${e.recipientId}>`,canDep=who.isDep||who.owner,canRec=who.isRec||who.owner,btns=[],noTx=!(e.txs||[]).length;
  const text={
    net:`${D} chooses the network on the card. Nothing is sent yet, and the coin can be changed with the first menu.`,
    await:`${D} sends the amount shown to the address on the card (a little off is fine). I spot the deposit by myself, usually within a minute or two. If it is not noticed, use **Paste Transaction**.`,
    confirming:"The deposit was spotted. I am waiting for the network to confirm it. Your funds are safe.",
    review:"An owner is checking the deposit. Nobody needs to do anything, and your funds are safe.",
    short:`Less than the asked amount arrived. ${R} presses **Continue** to accept it or **Refund** to send it back, or ${D} sends the rest to the same address.`,
    funded:e.rel||e.ref?`The funds are decided. ${e.rel?R:D} confirms the address and I send them right away.`
      :`${R} pays ${D} now. When ${D} has it in full, ${D} presses **Release Funds** on the card. ${R} can paste their address in the chat at any time.`,
    sending:"The payout is on its way. Your funds are safe.",payout:"An owner is sending the payout by hand.",stuck:"An owner is finishing the payout. Your funds are safe.",
  }[e.state]||"";
  if(MM_WAITING.has(e.state)&&e.state!=="confirming"&&canDep)btns.push(kBtn("mm_submit","Paste Transaction",G));
  if(e.state==="await"&&noTx&&canDep)btns.push(kBtn("mm_requote","Refresh Amount",G));
  if(e.state==="confirming"||e.state==="sending")btns.push(kBtn("mm_check","Check Now",G));
  if(e.state==="funded"&&!e.rel&&!e.ref&&!e.dispute&&canRec)btns.push(kBtn("mm_refund","Refund",G));
  if(MM_HOLDING.has(e.state)&&!e.dispute&&!["sending","payout","stuck"].includes(e.state))btns.push(kBtn("mm_dispute","Dispute",ButtonStyle.Danger));
  if(!["sending","payout","stuck"].includes(e.state)&&(who.isDep||who.isRec||who.owner))btns.push(kBtn("mm_cancel","Cancel Middleman",G));
  btns.push(kBtn("mm_help","Ping Owners",G));
  if(who.owner)btns.push(kBtn("mm_owner","Owner Controls",G));
  const rows=[];for(let i=0;i<btns.length;i+=5)rows.push(new ActionRowBuilder().addComponents(...btns.slice(i,i+5)));
  return {embeds:[mmEmb(e,"brand","Middleman Help").setDescription(`${text}\n\n${kNote("Type `$mm help` to ping the owners, or `$mm` to bring the card back down.")}`).setFooter(kFoot(`Built-in server middleman bot  ·  ${e.id}`))],components:rows};
}

// "we need mm", "can we use a middleman", "need mm pls" ... (short, to the point, and never a "don't")
const MM_W="(?:mm|middle ?man)",MM_TAIL="(?: (?:please|pls|plz|now|here|too|then|instead|first|asap|for this|for this one|for this ticket|for this deal|for this trade|for this exchange|for it))*$";
const MM_INTENT=[
  `^(?:(?:ok|okay|yes|yeah|yep|so|hey|hi|well|um|also|actually) )?(?:we|i|you|u|ya|they)(?: will| do| should| gotta| got to| have to| must| really| all| both)? (?:need|want|require|use|get)(?: to use| to get)? (?:a |the |an )?${MM_W}`,
  `^(?:lets|let's|let us) (?:just |also )?(?:use|do|get|start|have|open|go with|add|bring in)(?: a| the| an)? ${MM_W}`,
  `^(?:can|could|shall|should|may|do|will|would) (?:we|you|u|i|they) (?:just |please )?(?:need|use|get|start|have|open|do|go with|add|bring in)(?: a| the| an)? ${MM_W}`,
  `^(?:please |pls |plz )?(?:use|get|start|open|need|want|require|bring in|bring)(?: a| the| an)? ${MM_W}`,
  `^(?:a |the )?${MM_W}(?: please| pls| plz| needed| required| now| time)`,
  `^(?:a |the )?middle ?man`,
].map(p=>new RegExp(p+MM_TAIL));
function mmWantsMm(text){
  const t=String(text||"").toLowerCase().replace(/[‘’]/g,"'").replace(/[^a-z0-9' ]+/g," ").replace(/\s+/g," ").trim();
  if(!t||t.length>70)return false;
  return MM_INTENT.some(r=>r.test(t));
}

async function mmInteraction(interaction){
  const cid=String(interaction.customId||"");
  if(!cid.startsWith("mm_"))return false;
  try{await mmRoute(interaction,cid);}
  catch(err){
    const known=err instanceof MmError;
    if(!known){
      console.error("[mm] button failed:",cid,(err&&err.stack)||err);
      mmAlertOwners({embeds:[kEmbed("Middleman","bad").setTitle("Middleman Button Error").setDescription(`\`${cid}\` pressed by <@${interaction.user.id}>${interaction.channel&&interaction.channel.name?` in #${interaction.channel.name}`:""} failed:\n> ${String(err&&err.message).slice(0,300)}\nNothing was sent because of it.`).setTimestamp()],
        components:interaction.guild&&interaction.channel?[new ActionRowBuilder().addComponents(kLink("Open Ticket",`https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}`))]:[]});
    }
    await mmReply(interaction,known?(err.code==="rpc"?"I couldn't reach the network just now. Nothing changed and your funds are safe. Try again in a minute.":err.message):"Something went wrong on my side. Nothing was sent and your funds are safe. The owners have been told. You can also type `$mm help`.");
  }
  return true;
}
const mmFollow=(i,content)=>i.followUp({content,flags:64}).catch(()=>{});
async function mmRoute(interaction,cid){
  const parts=cid.split("__"),head=parts[0],ch=interaction.channel;
  const need=(ok,text)=>{if(!ok)throw new MmError("no",text);};
  // ── owner actions (they carry the deal's ID, so they also work from a DM or from /mmadmin) ──
  if(head==="mm_x"||head==="mm_xm"){
    const act=parts[1],{e,uid,owner}=await mmCtx(interaction,parts[2]);
    need(owner,"Only an owner can do that.");
    const id=e.id;
    if(head==="mm_x"&&["hand","sent","setpay","setref"].includes(act)){
      if(act==="hand"){need(["await","short","confirming"].includes(e.state),"Choose the network first, then confirm the deposit.");return interaction.showModal(mmModal(`mm_xm__hand__${id}`,"Confirm Deposit By Hand",[{id:"amount",label:`Amount that arrived, in ${e.coin}`,hint:mmFmtUnits(e.needRaw,e.decimals,e.dp),max:40},{id:"txid",label:"Transaction ID (optional)",required:false,max:200}]));}
      if(act==="sent")return interaction.showModal(mmModal(`mm_xm__sent__${id}`,"Mark Sent",[{id:"txid",label:"Transaction ID of the payment you sent",required:false,max:200,hint:"Leave empty if there is none"}]));
      need(!!e.chain,"The network is not chosen yet.");
      return interaction.showModal(mmModal(`mm_xm__${act}__${id}`,act==="setpay"?"Payout Address":"Refund Address",[{id:"address",label:`${MM_CHAINS[e.chain].name} address`,max:120,min:20}]));
    }
    await interaction.deferReply({flags:64});
    if(head==="mm_xm"){
      const f=n=>interaction.fields.getTextInputValue(n);
      if(act==="setpay"||act==="setref")return mmReply(interaction,await mmOwnerRun(e,act,{address:f("address")},uid));
      if(act==="hand")return mmReply(interaction,await mmOwnerRun(e,"hand",{amount:f("amount"),txid:f("txid")},uid));
      if(act==="sent")return mmReply(interaction,await mmOwnerRun(e,"sent",{txid:f("txid")},uid));
      return mmReply(interaction,"That form is no longer in use.");
    }
    return mmReply(interaction,await mmOwnerRun(e,act,{},uid));
  }
  // ── money that belongs to no deal / a sweep the owner is asked to confirm (owners only, DMs included) ──
  if(head==="mm_s"||head==="mm_sw"){
    const uid=interaction.user.id;
    need(isOwner(uid,interaction.member),"Only an owner can do that.");
    await interaction.deferReply({flags:64});
    if(head==="mm_s")return mmReply(interaction,await mmStrayAct(parts[1],parts[2],parts[3],uid));
    return mmReply(interaction,await mmSweepConfirm(parts[1],parts[2],uid));
  }
  if(head==="mm_back")return interaction.update({content:"Cancelled. Nothing was sent.",embeds:[],components:[]}).catch(()=>{});
  // ── "Use the server middleman?": both sides have to confirm ──
  if(head==="mm_start"||head==="mm_ok"||head==="mm_no"){
    const tickets=Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets"),t=ch&&tickets[ch.id],uid=interaction.user.id,owner=isOwner(uid,interaction.member);
    need(t&&t.status==="open","Open your ticket and type `$mm` there.");
    need(uid===t.userId||uid===t.claimedBy||owner,"Only the client, the exchanger on this ticket or an owner can do that. Nothing changed.");
    need(!!t.claimedBy&&!t.mmPending,t.claimedBy?"Press **Confirm Middleman** first.":"An exchanger has to claim this ticket first.");
    need(!t.reported||owner,"This ticket is flagged. An owner has to review it first.");
    if(head==="mm_start"){
      const running=mmActive(ch.id);
      if(running&&running.cardId){
        const url=interaction.guild?`https://discord.com/channels/${interaction.guild.id}/${ch.id}/${running.cardId}`:null;
        return interaction.reply({content:`The middleman is already running in this ticket.${url?` ${url}`:""} Type \`$mm\` to bring the card back down.`,flags:64});
      }
      await interaction.deferReply({flags:64});
      const r=await mmBegin(ch,t,uid);
      return mmReply(interaction,r.kind==="owner"?"An owner will middleman this one. They have been pinged.":r.kind==="done"?"The middleman already released the funds for this exchange.":r.kind==="asked"||r.kind==="waiting"?"I asked you both in the ticket. The middleman starts as soon as you both press **Confirm**.":"The middleman card is in the ticket.");
    }
    const a=t.mmAsk;
    if(!a||(a.msgId&&interaction.message&&a.msgId!==interaction.message.id)){
      await interaction.update({components:[]}).catch(()=>{});
      return mmFollow(interaction,"That question is out of date, so nothing changed. Type `$mm` to ask again.");
    }
    if(head==="mm_no"){
      mmSaveTicket(ch.id,x=>{delete x.mmAsk;});
      return interaction.update({content:null,embeds:[kEmbed("Middleman","mute").setTitle("No Middleman").setDescription(`<@${uid}> said no thanks, so the server middleman is not used. Nothing was started and nothing was lost. Type \`$mm\` any time to ask again.`).setFooter(kFoot("Built-in server middleman bot"))],components:[]}).catch(()=>{});
    }
    const sides=(uid===t.userId||uid===t.claimedBy)?[...(uid===t.userId?[t.userId]:[]),...(uid===t.claimedBy?[t.claimedBy]:[])]:[t.userId,t.claimedBy];     // an owner who is neither side answers for both
    let both=false;
    const t2=mmSaveTicket(ch.id,x=>{const k=x.mmAsk;if(!k)return;k.ok=k.ok||{};for(const s of sides)k.ok[s]=Date.now();if(k.ok[x.userId]&&k.ok[x.claimedBy]&&!k.starting){k.starting=true;both=true;}});
    need(t2&&t2.mmAsk,"That question is out of date, so nothing changed. Type `$mm` to ask again.");
    if(!both)return interaction.update({...mmPromptPayload(t2)}).catch(()=>{});
    await interaction.update({content:null,...mmPromptPayload(t2,"start")}).catch(()=>{});
    try{await mmOpen(ch,t2,{by:uid});}
    catch(err){console.error("[mm] could not open after both confirmed:",err.message);await mmOwnerFallback(ch,t2,"error",err.message).catch(()=>{});}
    log(interaction.guild,`MM CONFIRMED BY BOTH: #${ch.name} | client <@${t2.userId}> | exchanger <@${t2.claimedBy}>`);
    return;
  }
  // ── everything else acts on the deal of the ticket the button is in ──
  const withId=head==="mm_go"||head==="mm_aok"||head==="mm_achg";
  const {e,uid,owner,isDep,isRec,ticket}=await mmCtx(interaction,withId?parts[2]:null);
  const id=e.id,party=isDep||isRec;
  need(party||owner,"Only the two people in this exchange (or an owner) can use the middleman.");
  const flagged=!!(ticket&&ticket.reported);
  if(head==="mm_menu")return interaction.reply({...mmMenuPayload(e,{isDep,isRec,owner}),flags:64});
  if(head==="mm_help"){
    const r=await mmHelp(ch,uid,e);
    return mmReply(interaction,r.ok?"The owners have been pinged here and by DM. Stay in this ticket.":`The owners were already pinged. You can ask again in ${Math.ceil(r.wait/1000)}s.`);
  }
  if(head==="mm_owner"){need(owner,"That button is for the Konvert owners.");return interaction.reply({...mmOwnerPanel(e),flags:64});}
  if(head==="mm_copy"||head==="mm_copyaddr"||head==="mm_copyamt"){
    need(!!e.address&&MM_WAITING.has(e.state),"There is nothing to copy right now.");
    if(head==="mm_copyamt")return interaction.reply({content:"```"+mmFmtUnits(e.needRaw,e.decimals,e.dp)+"```",flags:64});
    await interaction.reply({content:"```"+e.address+"```",flags:64});
    if(head==="mm_copy")return mmFollow(interaction,`Send **${mmFmtUnits(e.needRaw,e.decimals,e.dp)} ${e.coin}** on **${mmNetOf(e)}** to that address. A little off is fine.`);
    return;
  }
  if(head==="mm_coin"){
    need(isDep||isRec||owner,"Only the two people in this exchange (or an owner) can change the coin.");
    need((e.state==="net"||e.state==="await")&&!(e.txs||[]).length,"A deposit was already seen for this deal, so the coin can't change any more. Nothing changed and your funds are safe.");
    await interaction.deferReply({flags:64});
    const x=await mmSetCoin(id,String((interaction.values||[])[0]||""),uid);
    await mmRefreshCard(ch,x,x.coin!==e.coin?`<@${uid}> changed the coin to ${x.coin}. Both of you, check that it is what you agreed.`:null);mmStage(x);
    return mmReply(interaction,x.coin===e.coin?"That coin is already selected. Nothing changed.":`Coin set to ${x.coin}.${x.state==="net"?" Choose the network on the card.":" The amount and the address are on the card."}`);
  }
  if(head==="mm_net"){
    need(isDep||owner,`Only <@${e.depositorId}> chooses the network, because they are the one sending. Nothing changed.`);
    need(e.state==="net"||(e.state==="await"&&!(e.txs||[]).length),"A deposit was already seen for this deal, so the network can't change any more. Nothing changed and your funds are safe.");
    await interaction.deferReply({flags:64});
    const x=await mmArm(id,String((interaction.values||[])[0]||""));
    await mmRefreshCard(ch,x);mmStage(x);
    return mmReply(interaction,`Network set to ${mmNetOf(x)}. The amount and the address are on the card.`);
  }
  if(head==="mm_requote"){
    need(isDep||owner,`Only <@${e.depositorId}> can refresh the amount. Nothing changed.`);
    need(e.state==="await"&&!(e.txs||[]).length,"A deposit was already seen for this deal, so the amount can't change any more. Nothing changed and your funds are safe.");
    const k="q:"+id,wait=20000-(Date.now()-(_mmTapAt.get(k)||0));
    need(wait<=0,`Try again in ${Math.ceil(wait/1000)}s.`);
    _mmTapAt.set(k,Date.now());
    await interaction.deferReply({flags:64});
    const x=await mmArm(id,e.chain);
    await mmRefreshCard(ch,x);
    return mmReply(interaction,`New amount: ${mmAmt(x,x.needRaw,x.dp)}. If you already sent an earlier amount, it still counts.`);
  }
  if(head==="mm_submit"){
    need(isDep||owner,`Only <@${e.depositorId}> submits the deposit. Nothing changed.`);
    need(MM_WAITING.has(e.state)&&e.state!=="confirming",MM_HOLDING.has(e.state)?"The deposit for this deal is already in. Nothing changed and the funds are safe.":"This deal is not waiting for a deposit. Nothing changed.");
    return interaction.showModal(mmModal("mm_m_submit","Paste Transaction",[{id:"txid",label:"Transaction ID or explorer link",max:300,min:20,hint:"The ID (hash) of the transaction you sent"}]));
  }
  if(head==="mm_m_submit"){
    need(isDep||owner,`Only <@${e.depositorId}> submits the deposit. Nothing changed.`);
    await interaction.deferReply({flags:64});
    return mmReply(interaction,await mmDoSubmit(e,interaction.fields.getTextInputValue("txid"),uid));
  }
  if(head==="mm_check"){
    const k="c:"+id,wait=10000-(Date.now()-(_mmTapAt.get(k)||0));
    need(wait<=0,`Checked a moment ago. Try again in ${Math.ceil(wait/1000)}s.`);
    _mmTapAt.set(k,Date.now());
    await interaction.deferReply({flags:64});
    await mmSweepOne(e);
    const x=await mmGet(id);
    if(ch)await mmRefreshCard(ch,x);
    return mmReply(interaction,`Checked. ${mmTitleOf(x)}.`);
  }
  // Continue: the receiver accepts what arrived
  if(head==="mm_cont"){
    need(isRec||owner,`Only <@${e.recipientId}> can accept a shortfall, because they are the one receiving. Nothing changed and the funds are safe.`);
    need(e.state==="short","There is no shortfall to accept on this deal. Nothing changed and the funds are safe.");
    need(!flagged||owner,"This ticket is flagged. An owner has to review it first. Nothing changed.");
    await interaction.deferReply({flags:64});
    return mmReply(interaction,await mmAccept(id,uid,owner));
  }
  // The refund card: back to the wallet the deposit came from (one click), or to another address pasted in the chat
  if(head==="mm_rts"||head==="mm_other"){
    need(isDep||owner,`Only <@${e.depositorId}> can choose where the refund goes, because it is their deposit. Nothing changed and the funds are safe.`);
    need(e.state==="funded"&&!!e.ref&&!e.rel,"There is no refund waiting for an address. Nothing changed and the funds are safe.");
    need(!flagged||owner,"This ticket is flagged. An owner has to review it first. Nothing changed.");
    if(head==="mm_other")return interaction.reply({content:`Paste your **${e.coin}** address (${mmNetOf(e)}) in this chat. I show it back to you to confirm before anything is sent. Nothing has been sent yet and the funds are safe.`,flags:64});
    need(!!e.sender,"I can't tell which wallet sent this deposit, so use **Other Address** and paste your own wallet. Nothing changed and the funds are safe.");
    await interaction.deferReply({flags:64});
    await mmUpdate(id,y=>{if(y.state!=="funded"||!y.ref)throw new MmError("state","This refund moved on in the meantime. Nothing changed.");y.refundTo=y.sender;y.refundOk=mmAddrTag(y.sender);mmNote(y,"refund to the sender chosen",uid);});
    const r=await mmGoPayout(id,"refund",uid,{owner});
    return mmReply(interaction,mmPayoutText(r,"refund"));
  }
  // The pasted address, shown back: Confirm Address / Change
  if(head==="mm_aok"||head==="mm_achg"){
    const rel=parts[1]==="payout",which=rel?"payout":"refundTo",kind=rel?"release":"refund";
    need(rel?(isRec||owner):(isDep||owner),rel?`Only <@${e.recipientId}> can confirm this address, because they receive the ${e.coin}. Nothing changed and the funds are safe.`:`Only <@${e.depositorId}> can confirm this address, because it is their refund. Nothing changed and the funds are safe.`);
    need(!flagged||owner,"This ticket is flagged. An owner has to review it first. Nothing changed.");
    need(["await","short","confirming","review","funded"].includes(e.state),"This deal moved on, so the address can't be changed. Nothing changed and the funds are safe.");
    if(head==="mm_achg"){
      await mmUpdate(id,y=>{delete y[which];delete y[rel?"payoutOk":"refundOk"];mmNote(y,`${which==="payout"?"payout":"refund"} address cleared to be changed`,uid);});
      await interaction.update({components:[]}).catch(()=>{});
      const x=await mmFresh(id);if(ch)await mmRefreshCard(ch,x);
      return mmFollow(interaction,`Paste the right **${e.coin}** address (${mmNetOf(e)}) in this chat. I show it back to you to confirm before anything is sent. Nothing was sent and the funds are safe.`);
    }
    const tag=parts[3],cur=e[which];
    need(cur&&mmAddrTag(cur)===tag,"That address was changed since this card was posted, so nothing was sent. Use the newest address card. The funds are safe.");
    await interaction.deferUpdate().catch(()=>{});
    await mmUpdate(id,y=>{y[rel?"payoutOk":"refundOk"]=tag;mmNote(y,`${which==="payout"?"payout":"refund"} address confirmed`,uid);});
    await interaction.editReply({embeds:[mmEmb(e,"ok","Address Confirmed").setDescription(`Confirmed by <@${uid}>.\n\`\`\`${cur}\`\`\``).setFooter(kFoot(`Built-in server middleman bot  ·  ${e.id}`))],components:[],content:null}).catch(()=>{});
    const x=await mmFresh(id),dec=rel?x.rel:x.ref;
    if(dec&&x.state==="funded"){
      const r=await mmGoPayout(id,kind,uid,{owner,tag});
      return mmFollow(interaction,mmPayoutText(r,kind));
    }
    if(ch)await mmRefreshCard(ch,x);
    return mmFollow(interaction,`Address saved and confirmed. It is used as soon as the ${kind} is decided.`);
  }
  // (older cards still carry these two buttons: the address is normally just pasted in the chat now)
  if(head==="mm_addr"||head==="mm_raddr"){
    const pay=head==="mm_addr";
    need(pay?(isRec||owner):(isDep||owner),pay?`Only <@${e.recipientId}> sets the payout address, because they receive the ${e.coin}.`:`Only <@${e.depositorId}> sets the refund address.`);
    need(!!e.chain,"The network has to be chosen first.");
    need(["await","short","confirming","review","funded"].includes(e.state),"The address can't be changed at this stage. Nothing changed and the funds are safe.");
    need(!flagged||owner,"This ticket is flagged. An owner has to review it first.");
    return interaction.showModal(mmModal(pay?"mm_m_addr":"mm_m_raddr",pay?"Payout Address":"Refund Address",[{id:"address",label:`Your ${MM_CHAINS[e.chain].name} address for ${e.coin}`,max:120,min:20,hint:`Must be able to receive ${e.coin} on ${MM_CHAINS[e.chain].name}`}]));
  }
  if(head==="mm_m_addr"||head==="mm_m_raddr"){
    const pay=head==="mm_m_addr";
    need(pay?(isRec||owner):(isDep||owner),"That form is not yours to send.");
    need(!flagged||owner,"This ticket is flagged. An owner has to review it first.");
    await interaction.deferReply({flags:64});
    const r=await mmSaveAddress(e,pay?"payout":"refundTo",interaction.fields.getTextInputValue("address"),uid,{owner});
    return mmReply(interaction,r.text);
  }
  if(head==="mm_cancel"){
    need(!flagged||owner,"This ticket is flagged. An owner has to review it first. Nothing changed.");
    await interaction.deferReply({flags:64});
    return mmReply(interaction,await mmCancelDo(e,uid,owner));
  }
  if(head==="mm_dispute"){
    need(MM_HOLDING.has(e.state),"There are no funds in the middleman to dispute yet. Press **Ping Owners** if you need an owner.");
    need(!e.dispute,"This deal is already in dispute. An owner is on it.");
    return interaction.showModal(mmModal("mm_m_dispute","Dispute",[{id:"reason",label:"What went wrong?",long:true,min:10,max:500,hint:"The funds stay locked until an owner decides."}]));
  }
  if(head==="mm_dstmt"){
    need(MM_HOLDING.has(e.state)&&!!e.dispute,"There is no open dispute on this deal.");
    need(party,"Only the two people in this exchange can add their side.");
    need(!((e.dispute.stmts||{})[uid]),"Your side is already on record. The owners have it.");
    return interaction.showModal(mmModal("mm_m_dispute","Your Side",[{id:"reason",label:"What happened, from your side?",long:true,min:10,max:500,hint:"The owners read both sides before they decide."}]));
  }
  if(head==="mm_m_dispute"){
    await interaction.deferReply({flags:64});
    return mmReply(interaction,await mmOpenDispute(e,uid,interaction.fields.getTextInputValue("reason")));
  }
  if(head==="mm_release"||head==="mm_refund"){
    const rel=head==="mm_release";
    if(!rel&&e.state==="short"){                                     // from the Shortfall card: nothing was paid for yet, so either side may call it off
      need(!e.dispute||owner,"This deal is in dispute. Only an owner can decide it now. Nothing changed and the funds are safe.");
      need(!flagged||owner,"This ticket is flagged. An owner has to review it first. Nothing changed.");
      await interaction.deferReply({flags:64});
      const r=await mmGoPayout(id,"refund",uid,{owner,early:true});
      return mmReply(interaction,mmPayoutText(r,"refund"));
    }
    need(rel?(isDep||owner):(isRec||owner),rel?`Only <@${e.depositorId}> can release, because it is their deposit. Nothing changed and the funds are safe.`:`Only <@${e.recipientId}> can refund. If you are <@${e.depositorId}> and want your deposit back, ask them or press **Dispute** in the help menu. Nothing changed and the funds are safe.`);
    need(!e.dispute||owner,"This deal is in dispute. Only an owner can release or refund it now. Nothing changed and the funds are safe.");
    need(!flagged||owner,"This ticket is flagged. An owner has to review it first. Nothing changed.");
    {                                                                // the same decision pressed again: the payout is tried again NOW (or the address is asked for again), and the answer says what really happened
      const kind=rel?"release":"refund",decided=rel?e.rel:e.ref,other=rel?e.ref:e.rel;
      if(decided&&!other&&(e.state==="funded"||(["sending","stuck","payout"].includes(e.state)&&(e.out||{}).kind===kind))){
        await interaction.deferReply({flags:64});
        const r=await mmGoPayout(id,kind,uid,{owner,ask:true,again:true});
        return mmReply(interaction,mmPayoutText(r,kind));
      }
    }
    need(e.state==="funded",mmStateWhy(e));
    need(!(e.rel||e.ref)||owner,e.rel?`The release is already decided. <@${e.recipientId}> just confirms their address. Nothing changed and the funds are safe.`:`The refund is already decided. <@${e.depositorId}> just chooses where it goes. Nothing changed and the funds are safe.`);
    return interaction.reply({flags:64,...mmConfirmPayload(e,rel?"release":"refund")});
  }
  if(head==="mm_go"){
    const kind=parts[1]==="refund"?"refund":"release",rel=kind==="release";
    need(rel?(isDep||owner):(isRec||owner),"That button is not yours to press. Nothing changed and the funds are safe.");
    need(!flagged||owner,"This ticket is flagged. An owner has to review it first. Nothing changed.");
    await interaction.update({content:"Working on it…",embeds:[],components:[]}).catch(()=>{});
    const r=await mmGoPayout(id,kind,uid,{owner,tag:parts[3]});
    return mmReply(interaction,mmPayoutText(r,kind));
  }
  return mmReply(interaction,"That button is no longer in use. Type `$mm` for a fresh card.");
}

// ── Things typed in a ticket ────────────────────────────────────────────────────────────────────────────────────
// "$mm" asks (or brings the card back) · "$mm help" pings the owners · "we need mm" asks too · the receiving person pastes their address here · owners run the
// whole deal with "$mm release", "$mm refund", "$mm funded 0.1", "$mm sent <tx>", "$mm approve", "$mm panel" ... and, anywhere, "$mm wallet", "$mm deals", ...
const MM_HELP_PARTY="`$mm` shows the card  ·  `$mm help` pings the owners  ·  `$mm status`  ·  `$mm release`  ·  `$mm refund`  ·  `$mm continue` (accept a shortfall)  ·  `$mm cancel`  ·  `$mm dispute <what went wrong>`  ·  `$mm address <your address>`\nYou can also just say **we need mm** to start it, and paste your address in the chat when the funds are released.";
const MM_HELP_OWNER="Owner commands: `$mm status`  ·  `$mm panel`  ·  `$mm release`  ·  `$mm refund`  ·  `$mm accept`  ·  `$mm funded <amount> [tx]`  ·  `$mm approve`  ·  `$mm reject`  ·  `$mm sent [tx]`  ·  `$mm retry`  ·  `$mm payout <address>`  ·  `$mm refundto <address>`  ·  `$mm cancel`  ·  `$mm undispute`  ·  `$mm wallet`  ·  `$mm deals`  ·  `$mm send <deal> <address>`  ·  `$mm sweep <chain> <address>`  ·  `$mm close <deal>`  ·  `$mm history <deal>`  ·  `$mm help`";
const _mmIntentAt=new Map();
async function mmMessage(message,ticket){
  if(!ticket||ticket.status!=="open")return false;
  const text=String(message.content||"").trim(),uid=message.author.id,ch=message.channel;
  if(!text||text.length>400)return false;
  const cmd=text.match(/^\$(?:mm|middleman)(?:\s+([\s\S]*))?$/i);
  const owner=isOwner(uid,message.member),party=uid===ticket.userId||uid===ticket.claimedBy;
  if(!party&&!owner)return !!cmd;                                        // somebody else typing $mm is simply not answered
  const say=t=>message.reply({content:t,allowedMentions:{parse:[]}}).catch(()=>{});
  const x={uid,ch,owner,party,say,message};
  try{
    if(cmd)return await mmCommand(ticket,String(cmd[1]||"").trim(),x);
    if(text.length<=70&&mmWantsMm(text)){await mmIntent(ticket,x);return false;}       // (an ordinary message as far as everything else is concerned)
    const e=mmActive(ch.id);
    if(!e)return false;
    // the address, pasted in the chat: the receiver's is where a release goes, the sender's is where a refund goes. It is shown back to be confirmed.
    if(e.chain&&["await","short","confirming","review","funded"].includes(e.state)){
      const rec=uid===e.recipientId,dep=uid===e.depositorId,which=rec?"payout":(dep&&e.ref&&!e.rel?"refundTo":null);
      if(which){
        const addr=mmFindAddress(e,text),waiting=which==="payout"?e.rel:e.ref;
        if(addr){
          if(ticket.reported&&!owner){await say("This ticket is flagged. An owner has to review it first. Nothing changed and the funds are safe.");return false;}
          const r=await mmSaveAddress(e,which,addr,uid);
          if(!r.ok){if(waiting||!mmSameAddr(e.chain,addr,e.address))await say(r.text);return false;}
          if(r.confirm||/^Saved\.( Sending now\.)?$/.test(r.text)){const ok=await message.react("✅").then(()=>true).catch(()=>false);if(!ok&&!r.confirm)await say(r.text);}
          else await say(r.text);
          return false;
        }
        if(waiting&&/^[A-Za-z0-9]{26,64}$/.test(text)){await say(`That doesn't look like a valid ${MM_CHAINS[e.chain].name} address. Nothing was sent and the funds are safe. Check it and paste it again.`);return false;}
      }
    }
    // a transaction pasted by the sender (only needed when the bot has not spotted the deposit by itself)
    if(MM_WAITING.has(e.state)&&e.state!=="confirming"&&text.length>=40&&text.length<=300&&(uid===e.depositorId||owner)&&mmParseTxid(e.chain,text)){await say(await mmDoSubmit(e,text,uid));return true;}
    return false;
  }catch(err){
    const known=err instanceof MmError;
    if(!known)console.error("[mm] message failed:",(err&&err.stack)||err);
    await say(known?(err.code==="rpc"?"I couldn't reach the network just now. Nothing changed and your funds are safe. Try again in a minute.":err.message):"Something went wrong on my side, and nothing was sent. Type `$mm help` to ping the owners.");
    return !!cmd;
  }
}
// "we need mm": asks both sides (or brings the card back down); before anybody has claimed the ticket it is remembered and asked at the claim
async function mmIntent(ticket,x){
  const {uid,ch,say,party}=x;
  if(!ticket.claimedBy){
    if(party&&uid===ticket.userId&&!ticket.mmWanted){
      mmSaveTicket(ch.id,t=>{t.mmWanted=true;});
      await say("Noted. As soon as an exchanger claims this ticket, I ask you both to confirm the server middleman.");
    }
    return;
  }
  if(ticket.mmPending){if(uid!==ticket.userId)await say("The client presses **Confirm Middleman** first.");return;}
  if(ticket.reported&&!x.owner)return;
  const e=mmActive(ch.id);
  if(e){                                                                  // already running: the card comes back down, at most once a minute
    if(Date.now()-(_mmIntentAt.get(ch.id)||0)<60*1000)return;
    _mmIntentAt.set(ch.id,Date.now());
    await mmPostCard(ch,e,{fresh:true});
    return;
  }
  const r=await mmBegin(ch,ticket,uid);
  if(r.kind==="done")await say("The middleman already released the funds for this exchange.");
}
async function mmCommand(ticket,arg,x){
  const {uid,ch,owner,say}=x,sp=arg.split(/\s+/).filter(Boolean),sub=(sp[0]||"").toLowerCase(),rest=arg.slice(sub.length).trim();
  const e0=ticket.mmId?await mmFresh(ticket.mmId):null,e=e0&&!MM_TERMINAL.has(e0.state)?e0:null;
  const isDep=!!e&&uid===e.depositorId,isRec=!!e&&uid===e.recipientId;
  const need=(ok,t)=>{if(!ok)throw new MmError("no",t);};
  const needDeal=()=>{need(!!e,"There is no middleman running in this ticket. Type `$mm` to start it.");return e;};
  const ownerOnly=()=>need(owner,"Only an owner can do that.");
  if(sub===""){
    if(!ticket.claimedBy){await say("An exchanger has to claim this ticket before the middleman can start.");return true;}
    if(ticket.mmPending){await say("The client presses **Confirm Middleman** first.");return true;}
    if(ticket.reported&&!owner){await say("This ticket is flagged. An owner has to review it first.");return true;}
    const r=await mmBegin(ch,ticket,uid);
    if(r.kind==="done")await say("The middleman already released the funds for this exchange.");
    return true;
  }
  if(sub==="help"){
    const r=await mmHelp(ch,uid,e);
    if(!r.ok)await say(`The owners were already pinged. You can ask again in ${Math.ceil(r.wait/1000)}s.`);
    return true;
  }
  if(sub==="commands"||sub==="cmds"||sub==="?"){await say(owner?`${MM_HELP_PARTY}\n${MM_HELP_OWNER}`:MM_HELP_PARTY);return true;}
  if(sub==="status"){
    const d=e||e0;
    if(!d){await say("There is no middleman deal in this ticket yet. Type `$mm` to start it.");return true;}
    await say(`**${d.id}**  ·  ${mmTitleOf(d)}${d.dispute?" (in dispute)":""}  ·  ${d.coin}${d.chain?` on ${mmNetOf(d)}`:""}  ·  ${d.gotRaw?`holding ${mmAmt(d,d.gotRaw)}`:fmtUSD(d.usd)}\nSender <@${d.depositorId}> → receiver <@${d.recipientId}>${d.payout?`\nPayout address saved: ${d.payout}`:""}`);
    return true;
  }
  if(sub==="cancel"){needDeal();need(isDep||isRec||owner,"Only the two people in this exchange can do that.");need(!ticket.reported||owner,"This ticket is flagged. An owner has to review it first.");await say(await mmCancelDo(e,uid,owner));return true;}
  if(sub==="continue"||sub==="accept"){
    needDeal();need(isRec||owner,`Only <@${e.recipientId}> can accept a shortfall, because they are the one receiving. Nothing changed and the funds are safe.`);
    need(!ticket.reported||owner,"This ticket is flagged. An owner has to review it first.");
    await say(await mmAccept(e.id,uid,owner));return true;
  }
  if(sub==="release"||sub==="refund"){
    needDeal();
    const rel=sub==="release",mine=rel?isDep:isRec;
    need(mine||owner||(!rel&&e.state==="short"&&(isDep||isRec)),rel?`Only <@${e.depositorId}> can release, because it is their deposit. Nothing changed and the funds are safe.`:`Only <@${e.recipientId}> can refund. If you are <@${e.depositorId}> and want your deposit back, ask them or use \`$mm dispute <what went wrong>\`. Nothing changed and the funds are safe.`);
    need(!ticket.reported||owner,"This ticket is flagged. An owner has to review it first. Nothing changed.");
    if(owner&&(!mine||e.state!=="funded")){await say(await mmOwnerRun(e,sub,{},uid));return true;}          // an owner settles a deal in any holding state: decided at once, no approve step
    if(!rel&&e.state==="short"){
      need(!e.dispute||owner,"This deal is in dispute. Only an owner can decide it now. Nothing changed and the funds are safe.");
      const r=await mmGoPayout(e.id,"refund",uid,{owner,early:true});await say(mmPayoutText(r,"refund"));return true;
    }
    need(!e.dispute||owner,"This deal is in dispute. Only an owner can release or refund it now. Nothing changed and the funds are safe.");
    {                                                                // the same decision typed again: the payout is tried again NOW (or the address is asked for again), and the answer says what really happened
      const decided=rel?e.rel:e.ref,other=rel?e.ref:e.rel;
      if(decided&&!other&&(e.state==="funded"||(["sending","stuck","payout"].includes(e.state)&&(e.out||{}).kind===sub))){
        const r=await mmGoPayout(e.id,sub,uid,{owner,ask:true,again:true});await say(mmPayoutText(r,sub));return true;
      }
    }
    need(e.state==="funded",mmStateWhy(e));
    need(!(e.rel||e.ref)||owner,e.rel?`The release is already decided. <@${e.recipientId}> just confirms their address. Nothing changed and the funds are safe.`:`The refund is already decided. <@${e.depositorId}> just chooses where it goes. Nothing changed and the funds are safe.`);
    await ch.send({content:`<@${uid}>`,...mmConfirmPayload(e,sub),allowedMentions:{users:[uid]}}).catch(()=>{});
    return true;
  }
  if(sub==="dispute"){
    needDeal();need(isDep||isRec||owner,"Only the two people in this exchange can do that.");
    need(rest.length>=10,"Say what went wrong, for example `$mm dispute the exchanger has not paid me yet`. The funds stay locked until an owner decides.");
    await say(await mmOpenDispute(e,uid,rest));return true;
  }
  if(sub==="address"||sub==="payout"||sub==="wallet"||sub==="refundto"||sub==="refundaddress"){
    needDeal();need(!!e.chain,"The network has to be chosen first.");
    const refundTo=sub==="refundto"||sub==="refundaddress";
    need(refundTo?(isDep||owner):(isRec||owner),refundTo?`Only <@${e.depositorId}> sets the refund address.`:`Only <@${e.recipientId}> sets the payout address, because they receive the ${e.coin}.`);
    need(!ticket.reported||owner,"This ticket is flagged. An owner has to review it first.");
    const r=await mmSaveAddress(e,refundTo?"refundTo":"payout",rest,uid,{owner});
    if(!r.confirm)await say(r.text);
    return true;
  }
  if(["approve","reject","retry","undispute","funded","hand","sent","panel","kick"].includes(sub)){
    ownerOnly();needDeal();
    if(sub==="panel"){await ch.send({...mmOwnerPanel(e),allowedMentions:{parse:[]}}).catch(()=>{});return true;}
    const arg2=sub==="funded"||sub==="hand"?{amount:sp[1],txid:sp.slice(2).join(" ")}:sub==="sent"?{txid:rest}:{};
    await say(await mmOwnerRun(e,sub==="funded"?"hand":sub,arg2,uid));
    return true;
  }
  await say(owner?`${MM_HELP_PARTY}\n${MM_HELP_OWNER}`:MM_HELP_PARTY);
  return true;
}

// ── Owner tools that work anywhere ("$mm wallet", "$mm deals", "$mm send ...") ──────────────────────────────────
// The answer goes to the owner's DMs (a ticket has clients in it, and the wallet is nobody else's business).
const MM_GLOBAL_SUBS=new Set(["wallet","deals","send","sweep","close","history"]);
const mmAge=ms=>{const s=Math.max(0,Math.round(ms/1000)),d=Math.floor(s/86400),h=Math.floor((s%86400)/3600),m=Math.floor((s%3600)/60);return d?`${d}d ${h}h`:h?`${h}h ${m}m`:m?`${m}m`:`${s}s`;};
async function mmWalletReport(){
  const w=mmWallets(),rows=await mmWalletRows(),out=[];
  for(const [f,name] of [["evm","Ethereum, BNB Chain, Base, Arbitrum, Polygon"],["sol","Solana"]]){
    const s=w[f][0];if(!s)continue;
    out.push(`**${name}**  \`${s.address}\``);
    for(const r of rows.filter(q=>MM_CHAINS[q.chain].family===f&&(!q.contract||(q.balance||0n)>0n||q.reserved>0n)))out.push(mmRowText(r));
    out.push("");
  }
  for(const k of ["btc","ltc"])if(_mmMeta.watch[k])out.push(`**${MM_CHAINS[k].name}** (watch only)  \`${_mmMeta.watch[k]}\`  ·  you release by hand`);
  out.push(kNote("holds = what the wallet has  ·  reserved = what open deals have recorded (deals confirmed by hand included)  ·  free = the rest"));
  return out.join("\n");
}
async function mmDealsReport(){
  const open=(await MMDB.list("e:")).map(([,e])=>e).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)),now=Date.now();
  const rows=open.map(e=>`**${e.id}**  ·  ${mmTitleOf(e)}${e.dispute?" (dispute)":""}  ·  ${e.gotRaw?mmAmt(e,e.gotRaw):`${fmtUSD(e.usd)} ${e.coin}`}  ·  ${mmAge(now-(e.createdAt||now))}  ·  ${e.channelId?`<#${e.channelId}>`:(e.kind||"owner action")}`);
  return {count:open.length,text:rows.length?rows.join("\n"):"No open deals."};
}
async function mmHistoryPages(id){
  const e=await mmFresh(id);
  if(!e)throw new MmError("gone","No deal with that ID. Nothing changed.");
  const head=`**${e.id}**  ·  ${mmTitleOf(e)}  ·  ${e.coin}${e.chain?` on ${mmNetOf(e)}`:""}  ·  <@${e.depositorId}> → <@${e.recipientId}>${e.channelId?`  ·  <#${e.channelId}>`:""}`;
  const lines=(e.log||[]).map(l=>`<t:${Math.floor(l.at/1000)}:d> <t:${Math.floor(l.at/1000)}:T>  ${l.ev}${l.by?`  (${mmWho(l.by)})`:""}`);
  const pages=[];let cur=head+"\n";
  for(const l of lines.length?lines:["No events recorded."]){if(cur.length+l.length+1>3800){pages.push(cur);cur="";}cur+=l+"\n";}
  pages.push(cur);
  return {id:e.id,pages};
}
async function mmSweepPrepare(chainKey,addressRaw,uid){
  if(!PERMANENT_OWNER_IDS.includes(uid))throw new MmError("no","Only the two permanent owners can sweep the wallet. Nothing changed and the funds are safe.");
  const ck=String(chainKey||"").toLowerCase(),chain=MM_CHAINS[ck];
  if(!chain||chain.family==="utxo")throw new MmError("no",`Use one of: ${Object.keys(MM_CHAINS).filter(k=>MM_CHAINS[k].family!=="utxo").join(", ")}. Bitcoin and Litecoin are watch-only, so they can't be swept from here. Nothing changed.`);
  const to=mmNormAddress(ck,addressRaw);
  if(!to)throw new MmError("address",`That is not a valid ${chain.name} address. Nothing changed and the funds are safe.`);
  if(mmSameAddr(ck,to,mmDepositAddress(ck)||""))throw new MmError("address","That is the middleman's own address. Nothing changed and the funds are safe.");
  const rows=(await mmWalletRows()).filter(r=>r.chain===ck&&r.free!=null&&r.free>0n);
  if(!rows.length)throw new MmError("state","There is nothing free to sweep on that network: everything the wallet holds is reserved for open deals (or it is empty). Nothing changed.");
  const code=crypto.randomBytes(4).toString("hex");
  await MMDB.set("sw:"+code,{chain:ck,to,by:uid,at:Date.now()});
  return {embeds:[kEmbed("Middleman","warn").setTitle("Sweep The Wallet?").setDescription(`Send everything that is **not reserved for an open deal** on **${chain.name}** to:\n\`\`\`${to}\`\`\`\n${rows.map(r=>`${mmFmtUnits(r.free,r.decimals)} ${r.coin}`).join("\n")}\n\nThe network fee comes out of the ${chain.native} amount. It can't be undone, and the confirmation expires in 10 minutes.`)],
    components:[new ActionRowBuilder().addComponents(kBtn(`mm_sw__ok__${code}`,"Confirm Sweep",ButtonStyle.Danger),kBtn(`mm_sw__no__${code}`,"Cancel",ButtonStyle.Secondary))]};
}
async function mmSweepConfirm(act,code,uid){
  const rec=await MMDB.get("sw:"+code);
  if(!rec)throw new MmError("gone","That sweep is no longer waiting. Nothing was sent and the funds are safe.");
  if(!PERMANENT_OWNER_IDS.includes(uid))throw new MmError("no","Only the two permanent owners can sweep the wallet. Nothing was sent and the funds are safe.");
  await MMDB.del("sw:"+code);                                        // one use only
  if(act==="no")return "Cancelled. Nothing was sent.";
  if(Date.now()-rec.at>10*60*1000)throw new MmError("gone","That sweep expired. Nothing was sent and the funds are safe. Ask for it again.");
  const rows=(await mmWalletRows()).filter(r=>r.chain===rec.chain&&r.free!=null&&r.free>0n).sort((a,b)=>(a.contract?0:1)-(b.contract?0:1));      // tokens first (they need the coin for fees), the native coin last
  const out=[];
  for(const r of rows){
    try{
      const e=await mmPseudoDeal({kind:"sweep",chainKey:rec.chain,contract:r.contract,coin:r.coin,decimals:r.decimals,amountRaw:r.free,to:rec.to,by:uid});
      const g=await mmGoPayout(e.id,"release",uid,{owner:true,wait:true});
      out.push(`${mmFmtUnits(r.free,r.decimals)} ${r.coin}: ${MM_TERMINAL.has(g.e.state)?`sent${g.e.out&&g.e.out.txid?` (${mmTxLink(g.e,g.e.out.txid)})`:""}`:g.e.state==="sending"?"on its way (it is followed until it lands)":`not sent yet (${mmErrText((g.e.payFail&&g.e.payFail.msg)||g.e.state)})`}`);
    }catch(err){out.push(`${r.coin}: ${err instanceof MmError?err.message:"failed"}`);}
  }
  return `Sweep to \`${rec.to}\`:\n${out.join("\n")}`;
}
async function mmGlobalCommand(message,ticket){
  const text=String(message.content||"").trim();
  if(!text||text.length>400||text[0]!=="$")return false;
  const m=text.match(/^\$(?:mm|middleman)\s+(\w+)(?:\s+([\s\S]*))?$/i);
  if(!m)return false;
  const sub=m[1].toLowerCase(),rest=String(m[2]||"").trim(),sp=rest.split(/\s+/).filter(Boolean);
  if(!MM_GLOBAL_SUBS.has(sub)||(sub==="wallet"&&rest))return false;                // ("$mm wallet <address>" is the receiver's payout address)
  const uid=message.author.id;
  if(!isOwner(uid,message.member))return false;
  const dm=async payload=>{
    const ok=await mmDm(uid,payload);
    if(ok){await message.react("✅").catch(()=>{});return;}
    if(ticket){await message.reply({content:"I couldn't DM you, so nothing was shown here (a ticket has clients in it). Open your DMs from this server and try again.",allowedMentions:{parse:[]}}).catch(()=>{});return;}
    await message.reply({...payload,allowedMentions:{parse:[]}}).catch(()=>{});
  };
  const dealArg=()=>(sp[0]&&/^mm-\d+$/i.test(sp[0])?sp[0].toUpperCase():(ticket&&ticket.mmId)||null);
  try{
    if(sub==="wallet")return await dm({embeds:[kEmbed("Middleman").setTitle("Middleman Wallet").setDescription((await mmWalletReport()).slice(0,4000))]}),true;
    if(sub==="deals"){const d=await mmDealsReport();return await dm({embeds:[kEmbed("Middleman").setTitle(`Open Middleman Deals (${d.count})`).setDescription(d.text.slice(0,4000))]}),true;}
    if(sub==="history"){
      const id=dealArg();if(!id)throw new MmError("no","Say which deal, for example `$mm history MM-0003`.");
      const h=await mmHistoryPages(id);
      for(let i=0;i<h.pages.length&&i<8;i++)await dm({embeds:[kEmbed("Middleman").setTitle(`History  ·  ${h.id}${h.pages.length>1?`  (${i+1} of ${h.pages.length})`:""}`).setDescription(h.pages[i])]});
      return true;
    }
    if(sub==="send"){
      const id=dealArg(),addr=sp[0]&&/^mm-\d+$/i.test(sp[0])?sp[1]:sp[0];
      if(!id||!addr)throw new MmError("no","Use `$mm send <deal> <address>`, for example `$mm send MM-0003 <your wallet address>`.");
      return await dm({content:await mmOwnerSend(id,addr,uid)}),true;
    }
    if(sub==="close"){
      const id=dealArg();if(!id)throw new MmError("no","Say which deal, for example `$mm close MM-0002`.");
      return await dm({content:await mmOwnerClose(id,uid,sp.some(w=>/^confirm$/i.test(w)))}),true;
    }
    if(sub==="sweep"){
      if(sp.length<2)throw new MmError("no","Use `$mm sweep <chain> <address>`, for example `$mm sweep sol <your wallet address>`.");
      return await dm(await mmSweepPrepare(sp[0],sp[1],uid)),true;
    }
  }catch(err){
    const known=err instanceof MmError;
    if(!known)console.error("[mm] owner command failed:",(err&&err.stack)||err);
    await dm({content:known?err.message:"Something went wrong on my side, and nothing was sent. The details are in the bot log."});
    return true;
  }
  return false;
}

// ── The guide and the owner tools ───────────────────────────────────────────────────────────────────────────
function mmCoinsText(){
  const by={};
  for(const a of MM_ASSETS){if(!mmDepositAddress(a.chain))continue;(by[a.coin]=by[a.coin]||[]).push(MM_CHAINS[a.chain].family==="utxo"||!a.contract&&MM_ASSETS.filter(x=>x.coin===a.coin).length===1?null:MM_CHAINS[a.chain].name);}
  const out=Object.entries(by).map(([c,n])=>{const nets=n.filter(Boolean);return nets.length?`**${c}** (${nets.join(", ")})`:`**${c}**`;});
  return out.length?out.join("  ·  "):"Being set up. Until then an owner middlemans every deal.";
}
function mmGuideEmbed(){
  return slim("Middleman Guide").setTitle("Built-In Server Middleman Bot")
    .setDescription("Konvert has its own **built-in server middleman bot**. It runs inside your ticket and holds the crypto side of an exchange until both sides are done, so nobody has to go first and nobody has to join another server.")
    .addFields(
      {name:"When it is used",value:"Whenever an exchange is above your exchanger's go-first limit (it is in their name, like **Up To $50**), or their name says **Use MM Always**. You can also ask for it on any exchange: just say **we need mm** in your ticket, or type `$mm`.",inline:false},
      {name:"How it works",value:"**1.** Whoever is sending the crypto sends it to the address on the card. The bot spots the payment by itself, so there is nothing to paste.\n**2.** It confirms the payment on the blockchain and says **Funds Secured**.\n**3.** The other side pays.\n**4.** The sender presses **Release Funds**, the receiver pastes their address in the chat, and the bot sends the crypto on. If the exchange is called off it is refunded instead.",inline:false},
      {name:"Coins it holds",value:mmCoinsText().slice(0,1024),inline:false},
      {name:"Anything else",value:`For other coins, gift cards, custom orders or amounts above **${fmtUSD(_mmMeta.maxUsd)}**, a Konvert owner acts as the middleman in your ticket.`,inline:false},
      {name:"Stay safe",value:"The middleman only ever appears **inside your ticket**, as a card from Konvert Bot. Staff never DM first, and nobody will ever send you a middleman address in DMs. If something doesn't work, type `$mm help` (or press **Help** on the card, then **Ping Owners**) and an owner is pinged.",inline:false})
    .setFooter({text:"Konvert Exchange  ·  Built-in server middleman bot"});
}
// The public post for /postmm
function mmInfoEmbed(){
  return kEmbed("Middleman").setTitle("Built-In Server Middleman Bot").setThumbnail(IMG.LOGO)
    .setDescription("Konvert runs its own **built-in server middleman bot** inside every ticket. It holds the crypto side of an exchange until both sides are done, so **nobody has to go first** and nobody has to join another server.\n​")
    .addFields(
      {name:"How it works",value:"**1.** Whoever is sending the crypto sends it to the address on the middleman card. The bot spots the payment by itself, so there is nothing to paste.\n**2.** It confirms the payment on the blockchain and says **Funds Secured**.\n**3.** The other side pays.\n**4.** The sender presses **Release Funds**, the receiver pastes their address in the chat, and the bot sends the crypto on. If the exchange is called off, it is refunded instead.",inline:false},
      {name:"Coins it holds",value:mmCoinsText().slice(0,1024),inline:false},
      {name:"Other coins and large amounts",value:"A Konvert owner acts as the middleman in your ticket.",inline:false},
      {name:"Important",value:"**Do NOT go first** above your exchanger's go-first limit, unless an owner says so in your ticket. The middleman only ever appears **inside your ticket**, as a card from Konvert Bot. Staff never DM first.",inline:false},
      {name:"Something not working?",value:"Type `$mm help` in your ticket (or press **Help** on the middleman card, then **Ping Owners**). The owners are pinged right away.",inline:false})
    .setImage(IMG.BANNER).setFooter(kFoot("Built-in server middleman bot"));
}
async function mmSelfCheck(opts){
  opts=opts||{};
  const lines=[],w=mmWallets(),libs=mmLibs();
  lines.push(`wallet: evm ${w.evm[0]?`${w.evm[0].address} (${w.evm[0].src==="railway"?"Railway variable":"made by the bot"})`:"none"} · sol ${w.sol[0]?`${w.sol[0].address} (${w.sol[0].src==="railway"?"Railway variable":"made by the bot"})`:"none"}${w.problems.length?" · PROBLEMS: "+w.problems.join("; "):""}`);
  if(!libs)lines.push("ethers is NOT installed: Ethereum-family deals go to an owner");
  for(const ck of Object.keys(MM_CHAINS)){
    const chain=MM_CHAINS[ck],addr=mmDepositAddress(ck);
    if(!addr){lines.push(`${ck}: no address set`);continue;}
    const urls=mmRpcUrls(ck);let up=0;const bits=[];
    for(let i=0;i<urls.length;i++){
      try{
        if(chain.family==="evm"){if(Number(BigInt(await mmRpc(ck,"eth_chainId",[],{start:i,one:true,timeoutMs:6000})))===chain.chainId)up++;}
        else if(chain.family==="sol"){if((await mmRpc("sol","getSlot",[{commitment:"finalized"}],{start:i,one:true,timeoutMs:6000}))>0)up++;}
        else{if(Number(await mmApi(ck,"/blocks/tip/height",{start:i,one:true,text:true,timeoutMs:6000}))>0)up++;}
      }catch{}
    }
    bits.push(`nodes ${up}/${urls.length}`);
    if(up){
      try{const b=await mmBalances(ck,null,addr);bits.push(`${mmFmtUnits(b.native,chain.decimals,6)} ${chain.native}`);}catch{bits.push("balance unknown");}
      for(const a of MM_ASSETS.filter(x=>x.chain===ck&&x.contract)){let ok=false;try{ok=await mmTokenCheck(a);}catch{}bits.push(`${a.coin} ${ok?"ok":"NOT VERIFIED"}`);}
    }
    bits.push(mmIsAuto(ck,addr)?"auto release":"owner release");
    lines.push(`${ck}: ${bits.join(" · ")}`);
  }
  if(opts.deep&&libs){
    try{const s=w.evm[0];if(s){const raw=await s.wallet.signTransaction({type:0,chainId:1,nonce:0,to:s.address,value:0n,gasLimit:21000n,gasPrice:1n});lines.push(`evm signing: ${libs.ethers.Transaction.from(raw).from===s.address?"ok":"MISMATCH"}`);}}catch(e){lines.push("evm signing: FAILED "+String(e.message).slice(0,60));}
    try{const s=w.sol[0];if(s){const sig=mmSolSignedTransfer(s,s.publicKey,1n,Buffer.alloc(32,7));lines.push(`sol signing: ${crypto.verify(null,sig.raw.subarray(65),crypto.createPublicKey({key:Buffer.concat([Buffer.from("302a300506032b6570032100","hex"),s.publicKey]),format:"der",type:"spki"}),sig.signature)?"ok":"MISMATCH"}`);}}catch(e){lines.push("sol signing: FAILED "+String(e.message).slice(0,60));}
  }
  return lines;
}
const MM_ADMIN_ACTIONS=[["status","Status and open deals"],["wallet","Wallet balances, reserved and free (value: btc <address> to set one)"],["deals","Every open deal with its state, amount and age"],["history","Full event log of a deal (value: its ID, like MM-0003)"],["send","Force a deal's payout (value: deal address)"],["sweep","Send the unreserved balance out (value: chain address)"],["close","Close a stale deal that holds nothing (value: deal, then confirm)"],["reconcile","Check the wallet against the deals now"],["limit","Largest deal the bot holds (value: dollars)"],["pause","Pause: every deal goes to an owner"],["resume","Resume"],["deal","Controls for one deal (value: its ID, like MM-0001)"],["check","Read a transaction (value: network coin txid)"],["test","Test the networks and the wallet"],["backup","Show the keys of the bot's own wallet"]];
async function mmAdmin(interaction){
  const action=interaction.options.getString("action")||"status",value=String(interaction.options.getString("value")||"").trim(),uid=interaction.user.id;
  await interaction.deferReply({flags:64});
  const done=(title,desc,extra)=>interaction.editReply({embeds:[kEmbed("Middleman").setTitle(title).setDescription(String(desc).slice(0,4000))],...(extra||{})});
  const srcText=s=>s.src==="railway"?"Railway variable":"made by the bot";
  if(action==="status"){
    const open=(await MMDB.list("e:")).map(([,e])=>e),w=mmWallets();
    const rows=open.slice(0,20).map(e=>`**${e.id}**  ·  ${MM_TITLE[e.state]||e.state}${e.dispute?" (dispute)":""}  ·  ${e.gotRaw?mmAmt(e,e.gotRaw):fmtUSD(e.usd)+" "+e.coin}  ·  ${e.channelId?`<#${e.channelId}>`:(e.kind||"owner action")}`);
    return done("Middleman Status",[
      `**Built-in server middleman bot**  ${_mmMeta.paused?"paused (every deal goes to an owner)":"on"}`,
      `**Largest deal held by the bot**  ${fmtUSD(_mmMeta.maxUsd)}`,
      `**Ethereum-family wallet**  ${w.evm[0]?`\`${w.evm[0].address}\` (${srcText(w.evm[0])})`:"none"}`,
      `**Solana wallet**  ${w.sol[0]?`\`${w.sol[0].address}\` (${srcText(w.sol[0])})`:"none"}`,
      `**Bitcoin address**  ${_mmMeta.watch.btc?`\`${_mmMeta.watch.btc}\` (you release by hand)`:"not set"}`,
      `**Litecoin address**  ${_mmMeta.watch.ltc?`\`${_mmMeta.watch.ltc}\` (you release by hand)`:"not set"}`,
      ...(w.problems.length?[`**Problems**  ${w.problems.join("; ")}`]:[]),
      "",`**Open deals (${open.length})**`,rows.length?rows.join("\n"):"None.",
    ].join("\n"));
  }
  if(action==="wallet"){
    if(value){
      const m=value.match(/^(btc|ltc|evm|sol)\s+(\S+)$/i);
      if(!m)return done("Wallet","Use `btc <address>`, `ltc <address>`, `evm <address>` or `sol <address>`. Use `clear` instead of an address to remove it.");
      const fam=m[1].toLowerCase(),chainKey=fam==="evm"?"eth":fam;
      if(/^clear$/i.test(m[2])){delete _mmMeta.watch[fam];await mmSaveMeta();return done("Wallet",`The ${fam.toUpperCase()} address was cleared. New deals use ${fam==="btc"||fam==="ltc"?"an owner as middleman for that coin":"the bot's own wallet"}.`);}
      const addr=mmNormAddress(chainKey,m[2]);
      if(!addr)return done("Wallet",`That is not a valid ${MM_CHAINS[chainKey].name} address, so nothing was changed.`);
      _mmMeta.watch[fam]=addr;await mmSaveMeta();
      return done("Wallet",`New ${fam.toUpperCase()} deals are paid to:\n\`\`\`${addr}\`\`\`\n${mmSigner(chainKey,addr)?"The bot holds the key for it, so it releases by itself.":"The bot only **watches** this address: it confirms deposits, and **you send each release or refund by hand** when it pings you."}\nDeals that are already open keep the address they started with.`);
    }
    return done("Middleman Wallet",(await mmWalletReport()).slice(0,3800)+"\n\nGas for token payouts comes from this wallet's own ETH / BNB / POL. The network fee of a native-coin payout comes out of the amount. `$mm wallet` shows the same in your DMs.");
  }

  if(action==="deals"){
    const d=await mmDealsReport();
    return done(`Open Middleman Deals (${d.count})`,d.text);
  }
  if(action==="history"){
    try{
      const h=await mmHistoryPages(value.toUpperCase());
      await done(`History  ·  ${h.id}${h.pages.length>1?`  (1 of ${h.pages.length})`:""}`,h.pages[0]);
      for(let i=1;i<h.pages.length&&i<6;i++)await interaction.followUp({flags:64,embeds:[kEmbed("Middleman").setTitle(`History  ·  ${h.id}  (${i+1} of ${h.pages.length})`).setDescription(h.pages[i])]}).catch(()=>{});
      return;
    }catch(err){return done("History",err instanceof MmError?err.message:"Something went wrong. Nothing changed.");}
  }
  if(action==="send"){
    const m=value.match(/^(MM-\d+)\s+(\S+)$/i);
    if(!m)return done("Send","Use `deal address`, for example `MM-0003 <wallet address>`. It sends that deal's funds there (as the refund when a refund was decided, otherwise as a release), even when the wallet looks short because of other deals.");
    try{return done("Send",await mmOwnerSend(m[1].toUpperCase(),m[2],uid));}catch(err){return done("Send",err instanceof MmError?err.message:"Something went wrong. Nothing was sent.");}
  }
  if(action==="sweep"){
    const m=value.match(/^(\w+)\s+(\S+)$/);
    if(!m)return done("Sweep","Use `chain address`, for example `sol <wallet address>`. Everything that is not reserved for an open deal is sent there, after you confirm.");
    try{return interaction.editReply(await mmSweepPrepare(m[1],m[2],uid));}catch(err){return done("Sweep",err instanceof MmError?err.message:"Something went wrong. Nothing was sent.");}
  }
  if(action==="close"){
    const m=value.match(/^(MM-\d+)(?:\s+(confirm))?$/i);
    if(!m)return done("Close","Use `deal`, then add `confirm` once you have seen what it holds, for example `MM-0002 confirm`.");
    try{return done("Close",await mmOwnerClose(m[1].toUpperCase(),uid,!!m[2]));}catch(err){return done("Close",err instanceof MmError?err.message:"Something went wrong. Nothing changed.");}
  }
  if(action==="reconcile"){
    const rows=await mmReconcile({force:true});
    if(!rows)return done("Wallet Check","The networks did not answer, so nothing could be compared. Nothing changed.");
    const bad=rows.filter(r=>r.free!=null&&r.free<0n);
    return done("Wallet Check",`${bad.length?`**Mismatch**\n${bad.map(mmRowText).join("\n")}\n\nThe wallet holds less than the open deals say. The owners were alerted.`:"The wallet holds at least what every open deal says it should."}\n\n${rows.filter(r=>!r.contract||(r.balance||0n)>0n||r.reserved>0n).map(mmRowText).join("\n")}`);
  }
  if(action==="limit"){
    const n=Number(value.replace(/[$,]/g,""));
    if(!(n>=1&&n<=1000000))return done("Limit",`The bot currently holds deals up to **${fmtUSD(_mmMeta.maxUsd)}**. Give a number of dollars to change it, for example \`2500\`.`);
    _mmMeta.maxUsd=Math.round(n*100)/100;await mmSaveMeta();
    return done("Limit",`The built-in server middleman bot now holds deals up to **${fmtUSD(_mmMeta.maxUsd)}**. Bigger ones go to an owner.`);
  }
  if(action==="pause"||action==="resume"){
    _mmMeta.paused=action==="pause";await mmSaveMeta();
    return done("Middleman",_mmMeta.paused?"Paused. New middleman deals go to an owner. Deals already open carry on.":"Resumed. The bot holds new middleman deals again.");
  }
  if(action==="deal"){
    const e=await mmFresh(value.toUpperCase());
    if(!e)return done("Deal","No deal with that ID. Use the ID from the card's footer, like `MM-0001`.");
    return interaction.editReply(mmOwnerPanel(e));
  }
  if(action==="check"){
    const m=value.match(/^(\w+)\s+(\w+)\s+(\S+)$/);
    const ck=m&&m[1].toLowerCase(),asset=m&&mmAsset(mmCoinOf(m[2]),ck),addr=asset&&mmDepositAddress(ck),txid=asset&&mmParseTxid(ck,m[3]);
    if(!asset||!addr||!txid)return done("Check","Use `network coin transaction`, for example `bsc USDT 0xabc…`. Networks: "+Object.keys(MM_CHAINS).join(", ")+".");
    try{
      const v=await mmVerifyTx(ck,asset,addr,txid);
      return done("Check",v.found?[`**Found**  yes`,`**Sent to the middleman address**  ${v.toUs?"yes":"no"}${v.viaContract?" (went through a contract)":""}`,`**Amount**  ${mmFmtUnits(v.amountRaw,asset.decimals)} ${asset.coin}`,`**From**  \`${v.from||"unknown"}\``,`**Result**  ${v.ok===false?"failed":v.ok?"succeeded":"not mined yet"}`,`**Confirmations**  ${v.conf}${v.final?" (enough)":""}`,`**Time**  ${v.blockTime?`<t:${v.blockTime}:f>`:"not mined yet"}`].join("\n"):"The network does not know that transaction (yet).");
    }catch(err){return done("Check","Could not reach the network: "+String(err.message).slice(0,200));}
  }
  if(action==="test"){const lines=await mmSelfCheck({deep:true});return done("Middleman Test","```\n"+lines.join("\n").slice(0,3800)+"\n```");}
  if(action==="backup"){
    if(!PERMANENT_OWNER_IDS.includes(uid))return done("Backup","Only the two permanent owners can see the wallet keys.");
    if(!_mmKeys)return done("Backup","The bot has not made a wallet of its own. If `MM_EVM_KEY` / `MM_SOL_KEY` are set in Railway, those are the keys and Railway is the backup.");
    _mmMeta.backupAt=Date.now();await mmSaveMeta().catch(()=>{});          // (the reminder to back up is only sent while this has never been done)
    const w=mmWallets(),own=x=>x.find(s=>s.src==="bot");
    return done("Wallet Backup",[
      "These are the keys of the wallet the bot made for itself. **Anyone who has them can move the funds.** Save them somewhere private, then dismiss this message.","",
      `**Ethereum / BNB Chain / Base / Arbitrum / Polygon**  ${own(w.evm)?`\`${own(w.evm).address}\``:""}`,`||\`${_mmKeys.evm}\`||`,"MetaMask: account menu, Add account or hardware wallet, Import account, paste the key.","",
      `**Solana**  ${own(w.sol)?`\`${own(w.sol).address}\``:""}`,`||\`${_mmKeys.sol}\`||`,"Phantom: Add / Connect Wallet, Import Private Key, paste the key.",
    ].join("\n"));
  }
  return done("Middleman","Unknown action.");
}
// Runs once when the bot starts
async function mmInit(){
  try{await mmLoadMeta();}catch(e){console.error("[mm] settings could not be read:",e.message);}
  try{await mmInitKeys();}catch(e){console.error("[mm] wallet could not be prepared:",e.message);}
  let n=0;
  try{for(const [,e] of await MMDB.list("e:")){_mmCache.set(e.id,e);n++;}}catch(e){console.error("[mm] open deals could not be read:",e.message);}
  const w=mmWallets();
  console.log(`[mm] built-in server middleman bot ready · evm ${w.evm[0]?w.evm[0].address+" ("+w.evm[0].src+")":"none"} · sol ${w.sol[0]?w.sol[0].address+" ("+w.sol[0].src+")":"none"} · btc ${_mmMeta.watch.btc||"not set"} · ltc ${_mmMeta.watch.ltc||"not set"} · open deals ${n}${w.problems.length?" · problems: "+w.problems.join("; "):""}`);
}

// After Discord is ready: payouts that were mid-send when the bot stopped are picked up (a signed transaction is looked up first, so nothing is sent twice),
// the wallet is checked against what the deals say it should hold, and the owners are reminded once to back the wallet up
async function mmRecover(){
  let sending=0,stuck=0,paid=0;
  for(const [,e] of await MMDB.list("e:")){
    _mmCache.set(e.id,e);
    if(e.state==="stuck"){stuck++;continue;}
    if(e.state!=="sending")continue;
    sending++;
    const r=await mmDrive(e.id).catch(err=>{console.error(`[mm] recovery ${e.id}:`,err.message);return null;});
    if(r&&MM_TERMINAL.has(r.state))paid++;
  }
  console.log(`[mm] startup recovery: ${sending} payout(s) were in flight and were picked up again${paid?` (${paid} already landed)`:""}${stuck?` · ${stuck} waiting on an owner`:""}`);
  return {sending,stuck,paid};
}
async function mmStartup(){
  try{await mmRecover();}catch(err){console.error("[mm] recovery:",err.message);}
  try{await mmReconcile();}catch(err){console.error("[mm] balance check:",err.message);}
  try{await mmBackupReminder();}catch(err){console.error("[mm] backup reminder:",err.message);}
}

// ── The new banner on posts that were made with the old one ─────────────────────────────────────────────────
// Every embed takes its banner from IMG.BANNER, so new posts are right by themselves. Posts already sitting in channels (policy, guide, links, panels...)
// carry the old picture: once per banner, the bot looks through the last messages of every text channel and swaps the picture in its own posts.
async function healBanners(guild){
  if(!guild||!client.user)return 0;
  const mark=await dbGet("konvert_banner_healed").catch(()=>null);
  if(mark&&mark.url===IMG.BANNER)return 0;
  console.log("[banner] refreshing the banner on older posts (this can take a few minutes)");
  const isOld=u=>!!u&&OLD_BANNERS.some(o=>String(u).includes(o));
  const tickets=Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets");
  let fixed=0;
  for(const ch of [...guild.channels.cache.values()]){
    if(!ch||ch.type!==ChannelType.GuildText||!ch.messages||typeof ch.messages.fetch!=="function")continue;
    if(tickets[ch.id]||(CONFIG.TICKET_CATEGORY&&ch.parentId===CONFIG.TICKET_CATEGORY))continue;      // tickets are short-lived and already drawn with the new banner
    if(ch.viewable===false)continue;
    const msgs=await ch.messages.fetch({limit:100}).catch(()=>null);
    if(!msgs)continue;
    for(const m of msgs.values()){
      if(!m.author||m.author.id!==client.user.id||!m.embeds||!m.embeds.some(e=>e&&e.image&&isOld(e.image.url)))continue;
      const embeds=m.embeds.map(e=>{const b=EmbedBuilder.from(e);if(e.image&&isOld(e.image.url))b.setImage(IMG.BANNER);return b;});
      if(await m.edit({embeds}).then(()=>true).catch(()=>false)){fixed++;if(fixed%25===0)console.log(`[banner] ${fixed} older posts refreshed so far`);}
      await _mmSleep(HEAL_PAUSE_MS);
    }
  }
  await dbSet("konvert_banner_healed",{url:IMG.BANNER,at:Date.now(),fixed}).catch(()=>{});
  console.log(`[banner] ${fixed} older post${fixed===1?"":"s"} now show the new banner`);
  return fixed;
}
let HEAL_PAUSE_MS=1200;


// ── Ticket claim system ──────────────────────────────────────
const MM_SERVICES="Konvert's built-in server middleman bot";   // the middleman is a bot inside the ticket (the engine is below, under "Konvert's built-in server middleman bot")
const REMIND_COOLDOWN_MS=2*60*1000;       // an exchanger can nudge the client once every 2 minutes
const _remindAt=new Map();
const _money=n=>"$"+Number(n).toLocaleString("en-US",{maximumFractionDigits:2});
const _CLAIM_PERMS={ViewChannel:true,SendMessages:true,ReadMessageHistory:true,AttachFiles:true,EmbedLinks:true};

// Reads the go-first limit from an exchanger's display name, e.g. "Tye - Up To $50"
function parseExchangerLimit(member){
  const name=String((member&&(member.displayName||(member.user&&member.user.username)))||"");
  if(/mm\s*always|use\s*mm|always\s*mm/i.test(name))return {mm:true,amount:0};
  const m=name.match(/up\s*to\s*\$?\s*(\d[\d,]*(?:\.\d+)?)([kK](?![a-zA-Z]))?/i)
        ||name.match(/\$\s*(\d[\d,]*(?:\.\d+)?)([kK](?![a-zA-Z]))?/)
        ||name.match(/(\d[\d,]*(?:\.\d+)?)([kK](?![a-zA-Z]))?\s*\$/);
  if(m){
    let n=parseFloat(m[1].replace(/,/g,""));
    if(m[2])n*=1000;
    if(n>0)return {mm:false,amount:n};
  }
  return null;
}
function describeLimit(lim){
  if(lim&&lim.mm)return {limitText:"Use MM Always",rule:`This exchanger always uses a middleman, so the built-in server middleman bot holds the crypto. Don't send anything first.`};
  if(lim)return {limitText:_money(lim.amount),rule:`Go-first limit: **${_money(lim.amount)}**. Above that, the built-in server middleman bot holds the crypto.`};
  return {limitText:"Not listed",rule:`No go-first limit is listed. Ask the exchanger to confirm it. Above it, the built-in server middleman bot holds the crypto.`};
}

// ---- One panel message; its buttons always follow the ticket's real state ----
// Green = go ahead · red = report a problem (Flag Ticket is the only red button on a ticket, so it is easy to find in a hurry) · grey = everything else.
function closeButton(){return kBtn("btn_close","Close Ticket",ButtonStyle.Secondary);}
// Why a ticket can't take another payment method (null = it can). Only ordinary payment methods, only while nobody has claimed it, only up to the limit.
function addMethodBlock(t){
  if(!t||(t.status&&t.status!=="open"))return "This ticket is no longer open.";
  if(t.claimedBy)return "An exchanger already has this ticket, so the method is set.";
  const cur=ticketMethods(t);
  if(!cur.length||cur.some(v=>!getMethod(v)||isSoloMethod(v)))return "This kind of ticket takes one method only.";
  if(cur.length>=MAX_TICKET_METHODS)return `This ticket already accepts ${MAX_TICKET_METHODS} methods, the most it can.`;
  return null;
}
const canAddMethod=t=>addMethodBlock(t)===null;
function claimRow(ticket){
  const row=new ActionRowBuilder().addComponents(kBtn("btn_claim","Claim Ticket",ButtonStyle.Success));
  if(ticket&&canAddMethod(ticket))row.addComponents(kBtn("btn_addmethod","Add Method",ButtonStyle.Secondary));    // the client can widen who may take it
  return row.addComponents(closeButton());
}
function flagButton(){return kBtn("btn_report","Flag Ticket",ButtonStyle.Danger);}
function remindButton(){return kBtn("btn_remind","Remind",ButtonStyle.Secondary);}
function mmConfirmRow(){
  return new ActionRowBuilder().addComponents(kBtn("btn_mmconfirm","Confirm Middleman",ButtonStyle.Success),remindButton());
}
function issueButton(label){return kBtn("btn_report",label,ButtonStyle.Danger);}
function completionRow(){
  return new ActionRowBuilder().addComponents(kBtn("btn_confirmdone","Confirm Completion",ButtonStyle.Success),issueButton("Report Issue"));
}
function hopButton(){return kBtn("btn_hopin","Hop In",ButtonStyle.Primary);}
function panelRow(ticket){
  if(ticket.status&&ticket.status!=="open")return null;           // finished: no buttons
  if(!ticket.claimedBy)return claimRow(ticket);                          // waiting for an exchanger
  const close=closeButton();
  if(ticket.reported)return new ActionRowBuilder().addComponents(close);                       // frozen, waiting on an owner
  const hop=ticket.openToAll?[hopButton()]:[];                      // opened to all exchangers ($all): anyone can join
  if(ticket.mmPending||ticket.completionPending)return new ActionRowBuilder().addComponents(flagButton(),...hop,close);   // waiting on the client
  const done=kBtn("btn_done","Mark Complete",ButtonStyle.Success);
  return new ActionRowBuilder().addComponents(done,flagButton(),...hop,close);
}
async function findPanelMessage(channel,ticket){
  if(ticket.panelMessageId){const m=await channel.messages.fetch(ticket.panelMessageId).catch(()=>null);if(m)return m;}
  // Older tickets don't have the id saved: find the bot's panel (it carries Claim or Mark Complete)
  const recent=await channel.messages.fetch({limit:50}).catch(()=>null);
  if(!recent)return null;
  const IDS=new Set(["btn_claim","btn_done","btn_hopin"]);
  const m=recent.find(x=>x.author&&client.user&&x.author.id===client.user.id&&(x.components||[]).some(r=>(r.components||[]).some(c=>IDS.has(c.customId))));
  if(m)ticket.panelMessageId=m.id;
  return m||null;
}
async function refreshPanel(channel,ticket,opts){
  try{
    const msg=await findPanelMessage(channel,ticket);
    if(msg){const row=panelRow(ticket);await msg.edit({components:row?[row]:[]});}
  }catch(e){console.error("[panel] refresh failed:",e.message);}
  if(!(opts&&opts.card===false))await refreshTicketCard(channel,ticket);        // the card's status row follows the ticket (best effort, like the buttons)
}
// Strips the buttons off any confirmation message that is no longer relevant
async function clearConfirmButtons(channel,ticket){
  for(const id of [ticket.completionMessageId,ticket.mmPending?ticket.claimMessageId:null,ticket.checkinAnswered?null:ticket.checkinMessageId]){
    if(!id)continue;
    const m=await channel.messages.fetch(id).catch(()=>null);
    if(m)await m.edit({components:[]}).catch(()=>{});
  }
}

// ---- The "claimed" announcement ----
// A line for the client when the exchanger picked one of the methods they offered
const methodNote=t=>t.methodPicked?`Handled through **${methodLabel(t.method)}**, one of the methods you picked.\n\n`:"";
function buildClaimEmbed(ticket,mode){
  const ex=ticket.claimedBy,cl=ticket.userId,hero=kHero(dealOf(ticket).hero);
  const e=kEmbed("Ticket");
  if(mode==="normal"){
    const {rule}=describeLimit(ticket.claimLimit||null);
    return e.setTitle("Ticket Claimed")
      .setDescription(`${hero}\n<@${cl}>, your ticket was claimed by <@${ex}>.\n\n${methodNote(ticket)}${rule}\n\nNot comfortable going first? Press **Use Middleman** (or type \`$mm\`, or just say **we need mm**) and the built-in server middleman bot holds the crypto for you.`)
      .setFooter(kFoot("Something wrong? Press Flag Ticket")).setTimestamp();
  }
  if(mode==="owner"){
    return kEmbed("Ticket","ok").setTitle("Owner Verified")
      .setDescription(`${hero}\n<@${cl}>, your ticket was claimed by <@${ex}>.\n\n${methodNote(ticket)}<@${ex}> is a Konvert owner \u2014 **safe to go first**. You can exchange with full confidence.\n\nWant the crypto held anyway? Press **Use Middleman** (or type \`$mm\`, or just say **we need mm**) and the built-in server middleman bot holds it for you.`)
      .setFooter(kFoot("Verified Konvert owner")).setTimestamp();
  }
  if(mode==="mmConfirmed"){
    return kEmbed("Ticket","ok").setTitle("Middleman Confirmed")
      .setDescription(`${hero}\n<@${cl}> and <@${ex}> both confirmed the built-in server middleman bot.\n\n${methodNote(ticket)}Its card below shows where the crypto goes. Don't send anything to each other directly.`)
      .setFooter(kFoot("Something wrong? Press Flag Ticket")).setTimestamp();
  }
  const why=ticket.mmReason||"This exchange needs a middleman.";
  return kEmbed("Ticket","warn").setTitle("Middleman Required")
    .setDescription(`${hero}\n<@${cl}>, your ticket was claimed by <@${ex}>.\n\n${methodNote(ticket)}${why} The built-in server middleman bot will hold the crypto, so **nobody has to go first and nothing is sent to the exchanger directly.**\n\n<@${cl}>, press **Confirm Middleman** to start it.`)
    .setFooter(kFoot("Exchanger confirmed  \u00b7  waiting for the client")).setTimestamp();
}

// ---- Exchanger suspension (triggered by the client's Flag Ticket button) ----
function isSuspended(userId){return !!(_mem.suspensions&&_mem.suspensions[userId]);}
// Open ticket channels that still exist, skipping tickets where this person is the *client*
function _openTicketChannels(guild,exceptClientId){
  const tickets=Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets");
  const out=[];
  for(const [cid,t] of Object.entries(tickets)){
    if(!t||t.status!=="open")continue;
    if(exceptClientId&&t.userId===exceptClientId)continue;
    const ch=guild.channels.cache.get(cid);
    if(ch)out.push({ch,t});
  }
  return out;
}
// A member-level deny beats any role-level allow, so this mutes them even in older tickets
async function lockExchangerEverywhere(guild,userId){
  let n=0;
  for(const {ch} of _openTicketChannels(guild,userId)){
    try{await ch.permissionOverwrites.edit(userId,{SendMessages:false},{type:1});n++;}
    catch(e){console.error(`[suspend] lock failed in ${ch.id}:`,e.message);}
  }
  return n;
}
async function unlockExchangerEverywhere(guild,userId){
  let n=0;
  for(const {ch,t} of _openTicketChannels(guild,userId)){
    try{
      // Confirmed claims get typing back; unclaimed or still-waiting-on-the-client tickets fall back to the role (view-only)
      if(t.claimedBy===userId&&!t.mmPending)await ch.permissionOverwrites.edit(userId,_CLAIM_PERMS,{type:1});
      else await ch.permissionOverwrites.delete(userId);
      n++;
    }catch(e){/* nothing to remove is fine */}
  }
  return n;
}
async function reportTicket(interaction,ticket,tickets,reason,opts={}){
  const guild=interaction.guild,ch=interaction.channel,exId=ticket.claimedBy,source=opts.source||"client";
  ticket.reported=true;ticket.reportedAt=Date.now();ticket.reportReason=reason;ticket.reportedExchanger=exId;
  _mem.tickets=tickets;save("tickets",tickets);

  const exMember=await guild.members.fetch(exId).catch(()=>null);
  const exempt=isOwner(exId,exMember);   // owners are reviewed, never auto-frozen
  if(!exempt){ticket.clientHeld=true;save("tickets",tickets);}   // the client was told to hold off, so they hear when it is over
  if(!exempt){
    if(!_mem.suspensions)_mem.suspensions={};
    _mem.suspensions[exId]={reason,channelId:ch.id,clientId:ticket.userId,amountUSD:parseFloat(ticket.amountUSD)||0,method:ticket.method||null,at:Date.now()};
    save("suspensions",_mem.suspensions);
    await lockExchangerEverywhere(guild,exId);
  }
  await refreshPanel(ch,ticket);   // the panel drops to just "Close Ticket"
  if(ticket.checkinMessageId&&!ticket.checkinAnswered){
    const cm=await ch.messages.fetch(ticket.checkinMessageId).catch(()=>null);
    if(cm)await cm.edit({components:[]}).catch(()=>{});
    ticket.checkinAnswered="reported";save("tickets",_mem.tickets);
  }

  const owners=CONFIG.OWNER_IDS;
  const clean=String(reason).replace(/\s+/g," ").trim().slice(0,300);
  const auto=source!=="client";   // paused by the safety system or an owner rather than flagged by the client
  const desc=auto
    ?(exempt?`An owner will review this ticket.`
            :`This ticket was paused for a safety review. <@${exId}> is frozen until an owner reviews it.\n**Don't send any more funds.**`)
    :(exempt?`<@${ticket.userId}> flagged this ticket. An owner will review it.\n> ${clean}`
            :`<@${ticket.userId}> flagged this ticket. <@${exId}> is frozen until an owner reviews it.\n**Don't send any more funds.**\n> ${clean}`);
  const title=auto?`Ticket Paused`:`Ticket Flagged`;
  await ch.send({
    content:owners.map(id=>`<@${id}>`).join(" "),
    embeds:[kEmbed("Safety","bad").setTitle(title).setDescription(`${kHero(dealOf(ticket).hero)}\n${desc}`).setTimestamp()],
    allowedMentions:{users:owners}
  }).catch(()=>{});

  const link=`https://discord.com/channels/${guild.id}/${ch.id}`;
  const who=source==="system"?`Paused by the safety system · <@${ticket.userId}> with <@${exId}>`
    :source==="owner"?`Paused by <@${opts.by}> · <@${ticket.userId}> with <@${exId}>`
    :`<@${ticket.userId}> flagged <@${exId}>`;
  const dm={embeds:[kEmbed("Safety","bad").setTitle(title)
      .setDescription(`${kHero(dealOf(ticket).hero)}\n${who}\n> ${clean}${exempt?"":"\n\n`/reinstate` lifts the freeze."}`)
      .setTimestamp()]};
  const dmRow=(auto&&!exempt)?riskAlertRow(exId,ch.id,{frozen:true}):new ActionRowBuilder();   // one tap to undo an automatic freeze
  dmRow.addComponents(kLink("Open Ticket",link));
  dm.components=[dmRow];
  for(const oid of owners)client.users.fetch(oid).then(u=>u.send(dm)).catch(()=>{});
  log(guild,`${auto?"PAUSE":"FLAG"}: #${ch.name} | client ${ticket.userId} | exchanger ${exId}${exempt?" (owner - not frozen)":" frozen"} | ${clean.slice(0,150)}`);
  return {exempt};
}

// ---- Claiming ----
async function claimTicket(interaction,opts={}){
  const fromEphemeral=!!(opts.mmConfirmed||opts.fromPicker);   // came from an ephemeral step: the method picker or the "Claim with Middleman" confirmation
  const tickets=Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets");
  const ch=interaction.channel;
  const ticket=tickets[ch.id];
  if(!ticket||ticket.status!=="open")return interaction.reply({content:"This ticket is no longer open.",flags:64});
  const owner=isOwner(interaction.user.id,interaction.member);
  if(!isExchanger(interaction.member))return interaction.reply({content:"Only exchangers can claim tickets.",flags:64});
  if(interaction.user.id===ticket.userId)return interaction.reply({content:"You can't claim your own ticket.",flags:64});
  if(ticket.claimedBy){
    return interaction.reply({content:ticket.claimedBy===interaction.user.id?"You already claimed this ticket.":`This ticket was already claimed by <@${ticket.claimedBy}>.`,flags:64});
  }
  if(isSuspended(interaction.user.id)&&!owner)
    return interaction.reply({content:"Your exchanger access is suspended pending owner review, so you can't claim tickets.",flags:64});
  if(isOnHold(interaction.user.id)&&!owner)
    return interaction.reply({content:"New claims are paused while an owner reviews recent activity on your account. You can keep working your open tickets.",flags:64});

  // A ticket open to several methods: the exchanger says which one they'll use (decided for them when only one of its methods is theirs)
  let chosen=null;
  if(isMultiMethod(ticket)){
    const mine=exchangerMethods(interaction.member,ticket),options=mine.length?mine:ticketMethods(ticket);
    if(opts.method&&options.includes(opts.method))chosen=opts.method;
    else if(options.length===1)chosen=options[0];
    else return methodPicker(interaction,ticket,options);
  }

  // Does this claim need a middleman? Over their limit, over it in total across open tickets, or "Use MM Always".
  const lim=parseExchangerLimit(interaction.member);
  const amt=parseFloat(ticket.amountUSD)||0;
  let mmReason=null,warnText=null;
  if(!owner&&lim){
    if(lim.mm){
      mmReason="This exchanger always uses a middleman.";
      warnText="Your name says **Use MM Always**.";
    }else if(amt>lim.amount+0.005){
      mmReason=`This exchange is above their **${_money(lim.amount)}** go-first limit.`;
      warnText=`This ticket (**${_money(amt)}**) is above your **${_money(lim.amount)}** limit.`;
    }else{
      let held=0;
      for(const [cid,t] of Object.entries(tickets)){
        // open tickets only (a ticket stays open until the client confirms it's complete); middleman tickets carry no go-first risk
        if(cid===ch.id||!t||t.status!=="open"||t.claimedBy!==interaction.user.id||t.mmRequired)continue;
        if(interaction.guild.channels.cache.has(cid))held+=parseFloat(t.amountUSD)||0;
      }
      if(held+amt>lim.amount+0.005){
        mmReason=`They're at their **${_money(lim.amount)}** go-first limit across other tickets.`;
        warnText=`You have **${_money(held)}** open \u2014 this would bring you to **${_money(held+amt)}**, over your **${_money(lim.amount)}** limit.`;
      }
    }
  }
  const needsMm=!!mmReason;

  // Step 1 for a middleman claim: the exchanger has to knowingly opt in
  if(needsMm&&!opts.mmConfirmed){
    const prompt={
      embeds:[kEmbed("Ticket","warn").setTitle(`Middleman Required`)
        .setDescription(`${warnText}\n\nYou can still take it: Konvert's built-in server middleman bot holds the crypto. The client must confirm first, and you can't message until they do.`)],
      components:[new ActionRowBuilder().addComponents(
        kBtn(chosen?`btn_mmclaim__${chosen}`:"btn_mmclaim","Claim with Middleman",ButtonStyle.Success),     // the button remembers the method they picked
        kBtn("btn_mmcancel","Cancel",ButtonStyle.Secondary))]};
    return opts.fromPicker?interaction.update(prompt):interaction.reply({...prompt,flags:64});
  }

  if(!ticket.panelMessageId&&interaction.message&&!fromEphemeral)ticket.panelMessageId=interaction.message.id;
  // Lock synchronously, before any await, so two simultaneous clicks can't both claim it
  ticket.claimedBy=interaction.user.id;
  ticket.claimedAt=Date.now();
  if(chosen)lockTicketMethod(ticket,chosen);
  ticket.claimLimit=(!owner&&lim)?(lim.mm?{mm:true}:{amount:lim.amount}):null;
  if(owner)ticket.ownerClaim=true;else delete ticket.ownerClaim;   // owners are trusted: no limits, no middleman wording
  if(needsMm){ticket.mmRequired=true;ticket.mmPending=true;ticket.mmReason=mmReason;}
  await interaction.deferUpdate().catch(()=>{});
  if(!needsMm){
    try{
      await ch.permissionOverwrites.edit(interaction.user,_CLAIM_PERMS);
    }catch(e){
      // Roll back so the ticket isn't left locked with nobody able to talk
      delete ticket.claimedBy;delete ticket.claimedAt;delete ticket.claimLimit;delete ticket.ownerClaim;
      if(chosen)unlockTicketMethod(ticket);
      console.error("[claim] permission edit failed:",e.message);
      return interaction.followUp({content:"Couldn't claim this ticket (permission update failed). Try again.",flags:64}).catch(()=>{});
    }
  }
  _mem.tickets=tickets;save("tickets",tickets);
  await retireNudge(ch,ticket);                          // the ten-minute "add a method" prompt has done its job
  await refreshPanel(ch,ticket,{card:false});
  if(chosen)await syncTicketMethod(ch,ticket);          // channel name, topic and the ticket card now say the method in use
  else await refreshTicketCard(ch,ticket);              // (and the card drops its "Add Method" tip)

  const payload={
    content:`<@${interaction.user.id}> <@${ticket.userId}>`,
    embeds:[buildClaimEmbed(ticket,needsMm?"mmPending":(owner?"owner":"normal"))],
    allowedMentions:{users:[interaction.user.id,ticket.userId]}
  };
  if(needsMm)payload.components=[mmConfirmRow()];
  else payload.components=[new ActionRowBuilder().addComponents(kBtn("mm_start","Use Middleman",ButtonStyle.Secondary))];     // the client or the exchanger (an owner too) can ask for the built-in middleman any time
  const sent=await ch.send(payload).catch(()=>null);
  if(sent){ticket.claimMessageId=sent.id;_mem.tickets=tickets;save("tickets",tickets);}
  if(ticket.mmWanted){                                              // the client already said "we need mm": it starts right away (when the exchanger is limited, the client confirms it first)
    delete ticket.mmWanted;_mem.tickets=tickets;save("tickets",tickets);
    if(!needsMm)try{await mmBegin(ch,ticket,ticket.userId);}catch(err){console.error("[mm] could not open at claim:",err.message);await mmOwnerFallback(ch,ticket,"error",err.message).catch(()=>{});}
  }
  const via=chosen?` through ${methodLabel(chosen)}`:"";
  if(fromEphemeral)await interaction.editReply({content:needsMm?`You claimed this ticket${via}. Waiting for the client to confirm the middleman.`:`You claimed this ticket${via}.`,embeds:[],components:[]}).catch(()=>{});
  log(interaction.guild,`CLAIM: #${ch.name} | ${interaction.user.tag} | client <@${ticket.userId}> | ${needsMm?"MIDDLEMAN":owner?"OWNER":"limit "+describeLimit(ticket.claimLimit).limitText}${chosen?" | "+methodLabel(chosen):""}`);
}

// Client presses "Confirm Middleman": unlocks the exchanger
async function confirmMiddleman(interaction){
  const tickets=Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets");
  const ch=interaction.channel;
  const ticket=tickets[ch.id];
  if(!ticket||ticket.status!=="open")return interaction.reply({content:"This ticket is no longer open.",flags:64});
  if(interaction.user.id!==ticket.userId)return interaction.reply({content:"Only the client can confirm this.",flags:64});
  if(!ticket.claimedBy||!ticket.mmPending)return interaction.reply({content:"There's nothing to confirm right now.",flags:64});
  if(ticket.reported)return interaction.reply({content:"This ticket is flagged \u2014 an owner needs to review it first.",flags:64});
  if(isSuspended(ticket.claimedBy))return interaction.reply({content:"This exchanger is currently frozen pending owner review.",flags:64});
  await interaction.deferUpdate().catch(()=>{});
  ticket.mmPending=false;ticket.mmConfirmedAt=Date.now();
  try{
    await ch.permissionOverwrites.edit(ticket.claimedBy,_CLAIM_PERMS,{type:1});
  }catch(e){
    ticket.mmPending=true;delete ticket.mmConfirmedAt;
    console.error("[mm] unlock failed:",e.message);
    return interaction.followUp({content:"Couldn't unlock the exchanger (permission update failed). Press the button again.",flags:64}).catch(()=>{});
  }
  _mem.tickets=tickets;save("tickets",tickets);
  await interaction.editReply({embeds:[buildClaimEmbed(ticket,"mmConfirmed")],components:[]}).catch(()=>{});
  await refreshPanel(ch,ticket);
  await ch.send({content:`<@${ticket.claimedBy}> The client confirmed the middleman — you can chat now.`,allowedMentions:{users:[ticket.claimedBy]}}).catch(()=>{});
  try{await mmOpen(ch,ticket);}                                    // the built-in server middleman bot posts its card (an owner steps in for anything it does not hold)
  catch(err){console.error("[mm] could not open after confirm:",err.message);await mmOwnerFallback(ch,ticket,"error",err.message).catch(()=>{});}
  log(interaction.guild,`MM CONFIRMED: #${ch.name} | client <@${ticket.userId}> | exchanger <@${ticket.claimedBy}>`);
}

// ---- Completion: the exchanger marks it, the client confirms (or flags) ----
function completionEmbed(ticket){
  return kEmbed("Ticket").setTitle(`Confirm Completion`)
    .setDescription(`${kHero(dealOf(ticket).hero)}\n<@${ticket.userId}>, <@${ticket.claimedBy}> marked this exchange as complete.\n\nPress **Confirm Completion** if everything went through, or **Report Issue** if something is wrong.`)
    .setFooter(kFoot("Reporting an issue freezes the exchanger until an owner reviews it")).setTimestamp();
}
async function requestCompletion(channel,ticket,tickets){
  if(ticket.completionPending)return false;
  ticket.completionPending=true;ticket.completionRequestedAt=Date.now();
  tickets[channel.id]=ticket;_mem.tickets=tickets;save("tickets",tickets);
  const sent=await channel.send({content:`<@${ticket.userId}>`,embeds:[completionEmbed(ticket)],components:[completionRow()],allowedMentions:{users:[ticket.userId]}}).catch(()=>null);
  if(!sent){
    ticket.completionPending=false;delete ticket.completionRequestedAt;
    save("tickets",_mem.tickets);
    return false;
  }
  ticket.completionMessageId=sent.id;
  save("tickets",_mem.tickets);
  await refreshPanel(channel,ticket);
  return true;
}
async function confirmCompletion(interaction){
  const tickets=Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets");
  const ch=interaction.channel;
  const ticket=tickets[ch.id];
  if(!ticket||ticket.status!=="open")return interaction.reply({content:"This ticket is no longer open.",flags:64});
  const byOwner=interaction.user.id!==ticket.userId&&isOwner(interaction.user.id,interaction.member);       // an owner can confirm in the client's place
  if(interaction.user.id!==ticket.userId&&!byOwner)return interaction.reply({content:"Only the client or an owner can confirm this.",flags:64});
  if(!ticket.completionPending||!ticket.claimedBy)return interaction.reply({content:"There's nothing to confirm right now.",flags:64});
  if(ticket.reported&&!byOwner)return interaction.reply({content:"This ticket is flagged \u2014 an owner needs to review it first.",flags:64});
  {const _mw=mmCompleteBlock(ch.id,byOwner);if(_mw)return interaction.reply({content:_mw,flags:64});}       // the built-in middleman bot still holds funds, or its card is waiting for a deposit
  // Settled before the first await: the client and an owner pressing together (or a double tap) must not both finish the trade
  ticket.completionPending=false;ticket.completionConfirmedAt=Date.now();delete ticket.completionMessageId;
  if(byOwner)ticket.completionConfirmedBy=interaction.user.id;else delete ticket.completionConfirmedBy;
  await interaction.deferUpdate().catch(()=>{});
  await interaction.editReply({embeds:[kEmbed("Ticket","ok").setTitle(`Completion Confirmed`)
    .setDescription(`${kHero(dealOf(ticket).hero)}\n${byOwner?`<@${interaction.user.id}> confirmed the exchange for <@${ticket.userId}>.`:`<@${ticket.userId}> confirmed the exchange.`}`).setTimestamp()],components:[]}).catch(()=>{});
  if(byOwner)log(interaction.guild,`OWNER CONFIRM: #${ch.name} | ${interaction.user.tag} confirmed for client <@${ticket.userId}> | exchanger <@${ticket.claimedBy}>`);
  // Finalize as the exchanger who handled it, so stats, receipts and the profit DM all credit the right person
  ticket._overrideExchangerId=ticket.claimedBy;
  const exUser=await client.users.fetch(ticket.claimedBy).catch(()=>({id:ticket.claimedBy,tag:ticket.claimedBy,username:ticket.claimedBy}));
  const exMember=interaction.guild?await interaction.guild.members.fetch(ticket.claimedBy).catch(()=>null):null;
  const proxy={_fake:true,guild:interaction.guild,channel:ch,user:exUser,member:exMember,deferred:true,replied:false,editReply:async()=>{},followUp:async()=>{}};
  await completeTrade(proxy,ticket,tickets);
}

// Exchanger nudges the client without needing to type
async function remindClient(interaction){
  const tickets=Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets");
  const ch=interaction.channel;
  const ticket=tickets[ch.id];
  if(!ticket||ticket.status!=="open")return interaction.reply({content:"This ticket is no longer open.",flags:64});
  const owner=isOwner(interaction.user.id,interaction.member);
  if(!owner&&interaction.user.id!==ticket.claimedBy)return interaction.reply({content:"Only the exchanger on this ticket can send a reminder.",flags:64});
  if(isSuspended(interaction.user.id)&&!owner)return interaction.reply({content:"Your exchanger access is suspended pending owner review.",flags:64});
  if(ticket.reported)return interaction.reply({content:"This ticket is flagged.",flags:64});
  if(!ticket.mmPending)return interaction.reply({content:"Nothing is waiting on the client.",flags:64});
  const what="confirm the middleman",msgId=ticket.claimMessageId;
  const wait=REMIND_COOLDOWN_MS-(Date.now()-(_remindAt.get(ch.id)||0));
  if(wait>0)return interaction.reply({content:`You can remind the client again in ${Math.ceil(wait/1000)}s.`,flags:64});
  _remindAt.set(ch.id,Date.now());
  await interaction.deferUpdate().catch(()=>{});
  const link=msgId&&interaction.guild?`https://discord.com/channels/${interaction.guild.id}/${ch.id}/${msgId}`:null;
  await ch.send({content:`<@${ticket.userId}>, <@${ticket.claimedBy}> is waiting for you to ${link?`[${what}](${link})`:what}.`,allowedMentions:{users:[ticket.userId]}}).catch(()=>{});
}

// ---- A ticket nobody has claimed for ten minutes: the client is pinged once and asked to add other payment methods ----
// One tidy message in the ticket: the ping, the deal, what it accepts now, and one dropdown of the methods it doesn't accept yet (the menu Add Method opens).
// It is sent once per ticket, and it goes away when an exchanger claims the ticket or the client adds methods.
const NUDGE_AFTER_MS=10*60*1000;
const NUDGE_LATE_MS=2*60*60*1000;           // a ticket that has already waited this long when the sweep first sees it (the bot was off) is left alone
let _nudgeRunning=false;
function nudgeEmbed(t){
  const cur=ticketMethods(t),room=MAX_TICKET_METHODS-cur.length;
  return kEmbed("Ticket").setTitle("Add Another Payment Method")
    .setDescription(`${kHero(dealOf(t).hero)}\n${room===1?"Add one more method":`Add up to ${room} more methods`} and their exchangers are pinged too, so the first one available can claim your ticket.\n\n**Accepted now**  ·  ${methodsLabel(cur)}`)
    .setFooter(kFoot("Your ticket stays open while you wait"));
}
async function sweepUnclaimed(guild){
  if(_nudgeRunning)return;
  _nudgeRunning=true;
  try{
    const now=Date.now(),due=[];
    for(const [cid,t] of Object.entries(_mem.tickets||{})){
      if(!t||t.nudgePingAt||t.status!=="open"||t.claimedBy||!t.claimSystem)continue;
      const waited=now-Math.max(t.createdAt||0,t.reopenedAt||0,t.widenedAt||0);
      if(waited<NUDGE_AFTER_MS||waited>NUDGE_LATE_MS||!canAddMethod(t))continue;
      const ch=guild.channels.cache.get(cid);
      if(!ch)continue;
      t.nudgePingAt=now;due.push([ch,t]);                         // marked first so overlapping runs can't send it twice
    }
    if(due.length)save("tickets",_mem.tickets);
    for(const [ch,t] of due){
      try{
        const sent=await ch.send({content:`<@${t.userId}>, nobody has claimed your ticket yet.`,embeds:[nudgeEmbed(t)],components:[new ActionRowBuilder().addComponents(addMethodMenu(t).menu)],allowedMentions:{users:[t.userId]}});
        t.nudgeMessageId=sent.id;save("tickets",_mem.tickets);
      }catch(e){console.error("[nudge] couldn't post:",e.message);}
    }
  }finally{_nudgeRunning=false;}
}
// Takes that prompt down (an exchanger claimed the ticket, or methods were added). keepId = a message that is being edited into something else right now.
async function retireNudge(ch,ticket,keepId){
  const id=ticket&&ticket.nudgeMessageId;
  if(!id)return;
  delete ticket.nudgeMessageId;save("tickets",_mem.tickets);
  if(id===keepId)return;
  const m=await ch.messages.fetch(id).catch(()=>null);
  if(m)await m.delete().catch(()=>{});
}

// ---- "Is everything okay?" check-in: ONLY for the other clients of an exchanger the safety system really suspects ----
// There is no routine or random check-in. forceCheckin() (safety section) books one 1-3 minutes out; this sweep delivers it.
let _checkinSweepRunning=false;
function checkinEmbed(t){
  return kEmbed("Ticket").setTitle(`Is everything okay?`)
    .setDescription(`**${dealOf(t).hero}**\n<@${t.userId}>, how is your exchange with <@${t.claimedBy}> going?`)
    .setFooter(kFoot("Press No to report an issue — the exchanger is frozen until an owner reviews it")).setTimestamp();
}
function checkinRow(){
  return new ActionRowBuilder().addComponents(
    kBtn("btn_checkin_ok","Yes, all good",ButtonStyle.Success),
    issueButton("No, report issue"));
}
// Runs every minute (and once at startup): posts a booked check-in when its time arrives.
// A check-in time that was not booked by the safety system (tickets saved by an earlier version, which asked everyone at random) is dropped, never sent.
async function sweepCheckins(guild){
  if(_checkinSweepRunning)return;
  _checkinSweepRunning=true;
  try{
    const now=Date.now(),due=[];let changed=false;
    for(const [cid,t] of Object.entries(_mem.tickets||{})){
      if(!t||t.checkinSentAt)continue;
      if(t.checkinAt&&t.checkinPlan!=="forced"){delete t.checkinAt;changed=true;continue;}     // an old routine check-in
      if(t.checkinPlan!=="forced"||!t.checkinAt)continue;
      if(t.status!=="open"||!t.claimSystem||!t.claimedBy)continue;
      if(t.mmPending||t.completionPending||t.reported)continue;          // already waiting on the client, or frozen
      if(t.ownerClaim||isOwner(t.claimedBy))continue;                // owners are trusted
      if(t.checkinAt>now)continue;
      if(isSuspended(t.claimedBy)){delete t.checkinAt;delete t.checkinPlan;changed=true;continue;}   // frozen: the owners and the clients already know
      const ch=guild.channels.cache.get(cid);
      if(!ch)continue;
      t.checkinSentAt=now;changed=true;due.push([ch,t]);                  // mark first so overlapping runs can't double-post
    }
    if(changed)save("tickets",_mem.tickets);
    for(const [ch,t] of due){
      // The client left the server: nobody to ask (any other lookup failure still sends it)
      const here=await guild.members.fetch(t.userId).then(()=>true).catch(e=>![10007,10013].includes(e&&e.code));
      if(!here){t.checkinSkipped="client left";save("tickets",_mem.tickets);continue;}
      const sent=await ch.send({content:`<@${t.userId}>`,embeds:[checkinEmbed(t)],components:[checkinRow()],allowedMentions:{users:[t.userId]}}).catch(()=>null);
      if(sent)t.checkinMessageId=sent.id;
      else{delete t.checkinSentAt;t.checkinAt=Date.now()+60*1000;}       // couldn't post: try again in a minute
      save("tickets",_mem.tickets);
    }
  }finally{_checkinSweepRunning=false;}
}
// Client answers "Yes, all good" (the "No" button is the normal report flow)
async function answerCheckin(interaction){
  const tickets=Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets");
  const ticket=tickets[interaction.channel.id];
  if(!ticket||ticket.status!=="open")return interaction.reply({content:"This ticket is no longer open.",flags:64});
  if(interaction.user.id!==ticket.userId)return interaction.reply({content:"Only the client can answer this.",flags:64});
  if(ticket.checkinAnswered)return interaction.reply({content:"Already answered.",flags:64});
  await interaction.deferUpdate().catch(()=>{});
  ticket.checkinAnswered="ok";
  save("tickets",_mem.tickets);
  await interaction.editReply({embeds:[kEmbed("Ticket","ok")
    .setTitle(`Check-In`).setDescription(`<@${ticket.userId}> says everything is fine.`).setTimestamp()],components:[]}).catch(()=>{});
}

// Gives a ticket back to the queue (used by $unclaim). A fresh embed with new buttons goes out and re-pings the payment method's exchangers.
async function releaseClaim(channel,ticket,tickets,{by=null}={}){
  const prev=ticket.claimedBy;
  if(!prev)return false;
  {const _mw=await mmBeforeClose(channel,!by||isOwner(by)).catch(()=>null);if(_mw){await channel.send({content:_mw,allowedMentions:{parse:[]}}).catch(()=>{});return false;}}      // the built-in middleman bot may hold funds
  const staleMsgs=[ticket.claimMessageId,ticket.completionMessageId,ticket.checkinMessageId].filter(Boolean);
  const hoppers=Object.keys(ticket.hoppedIn||{});
  delete ticket.claimedBy;delete ticket.claimedAt;delete ticket.claimLimit;delete ticket.ownerClaim;delete ticket.reported;
  delete ticket.mmRequired;delete ticket.mmPending;delete ticket.mmPendingUntil;delete ticket.mmConfirmedAt;delete ticket.mmReason;delete ticket.claimMessageId;
  delete ticket.completionPending;delete ticket.completionRequestedAt;delete ticket.completionMessageId;
  delete ticket.checkinAt;delete ticket.checkinSentAt;delete ticket.checkinMessageId;delete ticket.checkinAnswered;
  delete ticket.hoppedIn;delete ticket.nudged;mmResetTicket(ticket);
  const relabel=unlockTicketMethod(ticket);                         // a several-method ticket accepts all its methods again
  resetSafetyFields(ticket);_safety.delete(channel.id);
  ticket.reopenedAt=Date.now();
  tickets[channel.id]=ticket;_mem.tickets=tickets;save("tickets",tickets);
  // Tidy up: old claim/confirmation messages, and the special access of the exchanger (and anyone who hopped in); owners keep theirs from ticket creation
  for(const id of staleMsgs){const m=await channel.messages.fetch(id).catch(()=>null);if(m)await m.delete().catch(()=>{});}
  for(const id of new Set([prev,...hoppers]))if(!CONFIG.OWNER_IDS.includes(id))await channel.permissionOverwrites.delete(id).catch(()=>{});
  // The old panel is retired. A fresh one (new embed + new Claim / Close buttons) pings whoever can take the ticket and becomes its panel.
  const oldPanel=await findPanelMessage(channel,ticket);
  const fresh=await postOpenPanel(channel,ticket,{title:`Ticket Open Again`,lead:`<@${prev}> released this ticket. It is back in the queue — any exchanger can claim it.`});
  if(fresh){if(oldPanel&&oldPanel.id!==fresh.id)await oldPanel.edit({components:[]}).catch(()=>{});}
  else await refreshPanel(channel,ticket);                          // couldn't post: at least put the buttons back on the old panel
  if(relabel)await syncTicketMethod(channel,ticket);else await refreshTicketCard(channel,ticket);                 // the channel name, topic and card list every method again
  log(channel.guild,`RELEASE: #${channel.name} | ${prev}${by&&by!==prev?" | by "+by:""}`);
  return true;
}
// A fresh panel for a ticket that needs an exchanger: an embed plus the buttons for its current state. It pings the roles that can take the
// ticket and becomes the ticket's panel, so later claims / completions keep its buttons up to date.
async function postOpenPanel(channel,ticket,{title,lead,known,only,pingClient=true}){
  const roles=only?_rolesThatSee(channel,only,known):ticketPingRoles(channel,ticket,known);       // `only` = just these roles (a method was added: only its exchangers need to hear)
  const row=panelRow(ticket);
  const embed=kEmbed("Ticket").setTitle(title)
    .setDescription(`${kHero(dealOf(ticket).hero)}\n${lead}`)
    .setFooter(kFoot(ticket.claimedBy?"Press Hop In to join this ticket":"Press Claim Ticket to take it")).setTimestamp();
  const content=[...roles.map(r=>`<@&${r}>`),...(pingClient?[`<@${ticket.userId}>`]:[])].join(" ");
  warnUnpingable(channel.guild,roles);
  const sent=await channel.send({content,embeds:[embed],components:row?[row]:[],allowedMentions:{roles,users:pingClient?[ticket.userId]:[]}}).catch(e=>{console.error("[panel] couldn't post:",e.message);return null;});
  if(sent){ticket.panelMessageId=sent.id;save("tickets",_mem.tickets);}
  return sent;
}
// Every role that handles exchanges: the payment-method roles and the general exchanger role
function exchangerRoleIds(){
  return [...new Set([...Object.values(CONFIG.ROLES||{}),CONFIG.EXCHANGER_ROLE].filter(Boolean))];
}
// Which of these roles can actually see the channel. `known` = roles that were only just given access: discord.js learns of an overwrite change when
// Discord's update event arrives, a moment AFTER the edit succeeds, so the cached permissions can't be trusted for them yet.
function _rolesThatSee(channel,ids,known){
  const guild=channel.guild;
  return ids.filter(rid=>{
    if(known&&known.has(rid))return true;
    const role=guild&&guild.roles&&guild.roles.cache.get(rid);
    if(!role)return false;
    try{const p=channel.permissionsFor(role);return !!(p&&p.has(PermissionFlagsBits.ViewChannel));}catch{return false;}
  });
}
// Who hears about a ticket that needs an exchanger: its payment method's role, staff, the helper role for custom orders, and every exchanger
// role once it has been opened to all. Only roles that can see the channel are pinged (Discord notifies nobody else anyway).
function ticketPingRoles(channel,ticket,known){
  const want=[];
  want.push(...rolesForMethods(ticketMethods(ticket)));         // the role of every method the ticket accepts
  if(CONFIG.STAFF_ROLE)want.push(CONFIG.STAFF_ROLE);
  if((ticket.method==="custom"||ticket.method==="buyforyou")&&CONFIG.HELPER_ROLE)want.push(CONFIG.HELPER_ROLE);
  if(ticket.openToAll)want.push(...exchangerRoleIds());
  return _rolesThatSee(channel,[...new Set(want)],known);
}
// $all: every exchanger role (whatever the payment method) can see the ticket, and a fresh panel pings them all.
// Unclaimed: anyone can press Claim Ticket. Claimed: anyone can press Hop In and talk alongside the exchanger.
const ALL_COOLDOWN_MS=60*1000;             // once a minute per ticket (it pings a lot of people)
const _allAt=new Map();
async function openToAllExchangers(channel,ticket,tickets,{by=null}={}){
  const last=_allAt.get(channel.id)||0;
  if(Date.now()-last<ALL_COOLDOWN_MS)return {ok:false,wait:Math.ceil((ALL_COOLDOWN_MS-(Date.now()-last))/1000)};
  _allAt.set(channel.id,Date.now());
  const guild=channel.guild;
  const granted=new Set(),failed=[];                                  // roles opened just now / roles that could not be
  for(const rid of exchangerRoleIds()){
    const role=guild&&guild.roles&&guild.roles.cache.get(rid);
    if(!role||_rolesThatSee(channel,[rid]).length)continue;          // no such role, or it can already see the ticket
    try{await channel.permissionOverwrites.edit(role,{ViewChannel:true,ReadMessageHistory:true,SendMessages:false});granted.add(rid);}
    catch(e){failed.push(rid);console.error("[all] couldn't open the ticket to role",rid+":",e.message);}
  }
  const opened=granted.size;
  ticket.openToAll=true;ticket.openToAllAt=Date.now();ticket.openToAllBy=by;
  tickets[channel.id]=ticket;_mem.tickets=tickets;save("tickets",tickets);
  const lead=ticket.claimedBy
    ?`This ticket is open to **all exchangers**. <@${ticket.claimedBy}> is handling it — anyone else can press **Hop In** to join.`
    :`This ticket is open to **all exchangers**, whatever their payment method. Press **Claim Ticket** to take it.`;
  const oldPanel=await findPanelMessage(channel,ticket);
  const fresh=await postOpenPanel(channel,ticket,{title:`Open to All Exchangers`,lead,known:granted});   // the roles opened a moment ago are pinged too
  if(fresh){if(oldPanel&&oldPanel.id!==fresh.id)await oldPanel.edit({components:[]}).catch(()=>{});}
  else await refreshPanel(channel,ticket);
  log(guild,`OPEN TO ALL: #${channel.name} | by ${by} | ${opened} role(s) can now see it${failed.length?` | COULDN'T OPEN TO ${failed.join(", ")}`:""}`);
  return {ok:true,opened,failed,posted:!!fresh};
}
// "Hop In": an exchanger joins a ticket someone else has claimed (only once it has been opened to all with $all)
async function hopIn(interaction){
  const tickets=Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets");
  const ch=interaction.channel;
  const ticket=tickets[ch.id];
  const uid=interaction.user.id;
  if(!ticket||ticket.status!=="open")return interaction.reply({content:"This ticket is no longer open.",flags:64});
  if(!isExchanger(interaction.member))return interaction.reply({content:"Only exchangers can hop in.",flags:64});
  if(uid===ticket.userId)return interaction.reply({content:"You can't hop into your own ticket.",flags:64});
  if(!ticket.openToAll)return interaction.reply({content:"This ticket isn't open to everyone.",flags:64});
  if(!ticket.claimedBy)return interaction.reply({content:"Nobody has claimed this yet — press Claim Ticket instead.",flags:64});
  if(ticket.reported)return interaction.reply({content:"This ticket is flagged — an owner needs to review it first.",flags:64});
  const owner=isOwner(uid,interaction.member);
  if(isSuspended(uid)&&!owner)return interaction.reply({content:"Your exchanger access is suspended pending owner review.",flags:64});
  if(isOnHold(uid)&&!owner)return interaction.reply({content:"Joining tickets is paused while an owner reviews recent activity on your account.",flags:64});
  if(uid===ticket.claimedBy||(ticket.hoppedIn&&ticket.hoppedIn[uid]))return interaction.reply({content:"You're already in this ticket.",flags:64});
  try{await ch.permissionOverwrites.edit(interaction.user,_CLAIM_PERMS);}
  catch(e){console.error("[hopin] permission edit failed:",e.message);return interaction.reply({content:"Couldn't add you to this ticket (permission update failed). Try again.",flags:64});}
  ticket.hoppedIn={...(ticket.hoppedIn||{}),[uid]:Date.now()};
  _mem.tickets=tickets;save("tickets",tickets);
  await interaction.reply({content:"You're in — you can talk in this ticket now.",flags:64}).catch(()=>{});
  await ch.send({embeds:[kEmbed("Ticket").setTitle(`Exchanger Joined`)
    .setDescription(`<@${uid}> hopped in to help <@${ticket.claimedBy}>.`).setTimestamp()],allowedMentions:{parse:[]}}).catch(()=>{});
  log(interaction.guild,`HOP IN: #${ch.name} | ${uid} | claimed by ${ticket.claimedBy}`);
}

// ── Several payment methods: the ticket's side ───────────────────────────────────────────────────────────────
// The exchanger roles of some payment methods (the ones that are set up, each once)
const rolesForMethods=list=>[...new Set((list||[]).map(v=>CONFIG.ROLES&&CONFIG.ROLES[v]).filter(Boolean))];
// "Exchangers for Cash App, Venmo and Zelle were pinged." for the client who just opened a ticket (nothing when no method has an exchanger role set)
function pingedNote(p){
  const list=pickedMethods([p&&p.method,...((p&&p.methods)||[])]),names=list.filter(v=>CONFIG.ROLES&&CONFIG.ROLES[v]).map(methodLabel);
  return names.length?`\nPinged the ${joinAnd(names)} exchanger${names.length>1?"s":""}.`:"";
}
// A role that is not mentionable only gets notified when the bot may mention every role. When neither is true the ping looks fine but reaches nobody,
// so the owners are told (once an hour per role) instead of finding out from a ticket nobody answered.
const _pingWarned=new Map();
function warnUnpingable(guild,roleIds){
  try{
    const me=guild&&guild.members&&guild.members.me;
    if(!me||!me.permissions||me.permissions.has(PermissionFlagsBits.MentionEveryone))return;
    const bad=(roleIds||[]).map(rid=>guild.roles&&guild.roles.cache&&guild.roles.cache.get(rid)).filter(r=>r&&!r.mentionable&&Date.now()-(_pingWarned.get(r.id)||0)>60*60*1000);
    if(!bad.length)return;
    bad.forEach(r=>_pingWarned.set(r.id,Date.now()));
    log(guild,`PING WARNING: ${bad.map(r=>r.name).join(", ")} can't be pinged: the role isn't mentionable and I don't have the Mention Everyone permission. Make the role mentionable (or give me that permission) so ticket pings reach those exchangers.`);
  }catch{}
}
// Which of a ticket's accepted methods this exchanger handles, going by their roles
function exchangerMethods(member,ticket){
  const has=r=>!!(r&&member&&member.roles&&member.roles.cache&&member.roles.cache.has(r));
  return ticketMethods(ticket).filter(v=>has(CONFIG.ROLES&&CONFIG.ROLES[v]));
}
// An exchanger claimed a ticket open to several methods: the method they will use becomes the deal's method
function lockTicketMethod(ticket,method){ticket.method=method;ticket.methodLocked=true;ticket.methodPicked=true;}
// The ticket went back to the queue, or the claim failed: it accepts all its methods again. true = something changed
function unlockTicketMethod(ticket){
  if(!(Array.isArray(ticket.methods)&&ticket.methods.length>1&&ticket.methodLocked))return false;
  ticket.method=ticket.methods[0];delete ticket.methodLocked;delete ticket.methodPicked;
  return true;
}
const ticketChannelName=(t,suffix)=>`${ticketMethods(t).join("-")}-${suffix}`;
// Where the ticket stands, in a few words (the card's Status field)
function ticketStatusText(t){
  if(t.status==="vouched")return "Completed";
  if(t.status&&t.status!=="open")return "Closed";
  if(t.reported)return "On hold";
  if(!t.claimedBy)return "Waiting for an exchanger";
  if(t.mmPending)return "Middleman needed";
  if(t.completionPending)return "Awaiting confirmation";
  if(t.mmStage&&MM_STAGE_TEXT[t.mmStage])return MM_STAGE_TEXT[t.mmStage];          // the built-in middleman bot is running: where it stands
  return "In progress";
}
// What happens next, for the stage the ticket is in (null once it is finished)
function ticketNextSteps(t){
  if(t.status&&t.status!=="open")return null;
  if(t.reported)return "An owner is reviewing this ticket. Please wait here and don't send anything until they say so.";
  if(!t.claimedBy)return isMultiMethod(t)
    ?"1. An exchanger for any of your methods claims this ticket.\n2. They confirm the method, wallet and payment details here.\n3. Final amounts are agreed in this ticket before anything is sent."
    :"1. An exchanger claims this ticket.\n2. They confirm the wallet and payment details here.\n3. Final amounts are agreed in this ticket before anything is sent.";
  if(t.mmPending)return "1. Press Confirm Middleman to start the built-in server middleman bot.\n2. It holds the crypto, so nobody has to go first.\n3. Don't send anything to each other directly.";
  if(t.completionPending)return "Your exchanger marked this complete.\nPress Confirm Completion if everything arrived, or Report Issue if it didn't.";
  if(t.mmStage&&MM_NEXT_TEXT[t.mmStage])return MM_NEXT_TEXT[t.mmStage];
  return "1. Confirm the wallet and payment details here.\n2. Agree the final amounts before anything is sent.\n3. Your exchanger marks it complete, then you confirm.";
}
// The ticket's first card: title, the deal, who has it and where it stands, what happens next. It is drawn again whenever the ticket changes (a claim,
// a method added, a completion...), from what createTicket kept in t.card. opts.hint = the "Add Method" tip for a one-method ticket, shown as it is first drawn.
function buildTicketCard(t,opts){
  const d=dealOf(t),c=t.card||{};
  const open=!t.status||t.status==="open",waiting=open&&!t.claimedBy;
  const intro=!open?(t.status==="vouched"?"This exchange is complete. Thank you for using Konvert.":"This ticket is closed.")
    :!waiting?`Welcome, <@${t.userId}>. <@${t.claimedBy}> is handling your exchange.`
    :(t.method==="buyforyou"||t.method==="custom")
      ?`${CONFIG.HELPER_ROLE?`<@&${CONFIG.HELPER_ROLE}>`:"@Helper"} — New **${d.label}** ticket opened.`
      :`Welcome, <@${t.userId}>. Your ticket is open and an exchanger will claim it shortly.`;
  // How to reach more exchangers: right after opening, a one-method ticket is told it can add more (the ten-minute prompt is a message of its own)
  const tip=waiting&&canAddMethod(t)&&opts&&opts.hint&&!isMultiMethod(t)?"\n*Tip: press Add Method to speed this up. Exchangers for another method can claim it too.*":"";
  const next=ticketNextSteps(t);
  return kEmbed("Ticket").setTitle(t.method==="crypto"?"Crypto to Crypto Exchange":(t.method==="buyforyou"||t.method==="custom")?d.label:`${d.label} Exchange`)
    .setDescription(`${dealHead(d,c.notes||[])}\n${kLedger(dealRows(d,{rate:c.rate!=null?c.rate:null,coinAmt:c.coinAmt||null}))}${intro}${tip}`)
    .addFields(
      {name:"Status",value:ticketStatusText(t),inline:true},
      {name:"Exchanger",value:t.claimedBy?`<@${t.claimedBy}>`:"Unclaimed",inline:true},
      {name:"Opened",value:`<t:${Math.floor((t.createdAt||Date.now())/1000)}:R>`,inline:true},
      ...(isMultiMethod(t)?[{name:"Accepted Methods",value:t.methods.map(methodLabel).join("  ·  "),inline:false}]:[]),
      ...(next?[{name:"What happens next",value:next,inline:false}]:[]))
    .setImage(IMG.BANNER).setTimestamp(t.createdAt||Date.now()).setFooter(kFoot("All communication stays in this ticket"));
}
// Redraws the ticket's first card (best effort: a failed edit never stops the ticket)
async function refreshTicketCard(ch,ticket){
  if(!ticket.card||!ticket.cardMessageId)return;
  try{
    const msg=await ch.messages.fetch(ticket.cardMessageId).catch(()=>null);
    if(!msg)return;
    await msg.edit({embeds:[buildTicketCard(ticket),...(msg.embeds||[]).slice(1)]});
  }catch(e){console.error("[card] refresh failed:",e.message);}
}
// Brings the channel's name and topic, and the ticket card, in line with the ticket's methods. The rename is not awaited: Discord allows two of them
// per channel every ten minutes, and a queued one must never hold the ticket up.
const _methodSync=new Map();           // channel id -> the name and topic last asked for (a rename still queued must not make the next one look unnecessary)
async function syncTicketMethod(ch,ticket){
  try{
    const name=ticketChannelName(ticket,String(ch.name||"").split("-").pop()),topic=dealOf(ticket).hero.slice(0,1024),patch={};
    const last=_methodSync.get(ch.id)||{name:ch.name,topic:ch.topic};
    if(name!==last.name)patch.name=name;
    if(topic!==last.topic)patch.topic=topic;
    if(Object.keys(patch).length&&typeof ch.edit==="function"){
      _methodSync.set(ch.id,{name,topic});
      Promise.resolve(ch.edit(patch)).catch(e=>console.error("[method] channel edit failed:",e.message));
    }
  }catch(e){console.error("[method] sync failed:",e.message);}
  await refreshTicketCard(ch,ticket);
}
// An exchanger who could take a ticket by more than one of its methods says which one they will use (ephemeral; the choice comes back to claimTicket)
function methodPicker(interaction,ticket,options){
  return interaction.reply({
    embeds:[kEmbed("Ticket").setTitle(`Which Method Will You Use?`)
      .setDescription(`${kHero(dealOf(ticket).hero)}\nThe client accepts more than one method. Pick the one you'll handle — it becomes the method for this exchange.`)],
    components:[new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("sel_claimmethod").setPlaceholder("Choose your method...")
      .addOptions(options.map(v=>new StringSelectMenuOptionBuilder().setLabel(methodLabel(v)).setValue(v))))],
    flags:64});
}
// ---- The client widens their ticket: "Add Method" ----
const ADD_METHOD_COOLDOWN_MS=2*60*1000;          // each addition pings the new methods' exchangers, so once every 2 minutes per ticket
const _addMethodAt=new Map();
// The dropdown that adds payment methods to a ticket: the ordinary methods it doesn't accept yet, as many as the limit leaves room for
function addMethodMenu(ticket){
  const cur=ticketMethods(ticket),room=MAX_TICKET_METHODS-cur.length;
  const opts=METHODS.filter(m=>!isSoloMethod(m.value)&&!cur.includes(m.value));
  const menu=new StringSelectMenuBuilder().setCustomId("sel_addmethod").setPlaceholder(room===1?"Choose a method to add...":`Add up to ${room} more...`).setMinValues(1).setMaxValues(Math.min(room,opts.length))
    .addOptions(opts.map(m=>new StringSelectMenuOptionBuilder().setLabel(m.label).setValue(m.value).setDescription(`Also accept ${m.label}`)));
  return {room,menu};
}
async function addMethodPrompt(interaction){
  const tickets=Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets");
  const ticket=tickets[interaction.channel.id];
  if(!ticket)return interaction.reply({content:"This ticket is no longer open.",flags:64});
  if(interaction.user.id!==ticket.userId&&!isOwner(interaction.user.id,interaction.member))return interaction.reply({content:"Only the client can add a payment method.",flags:64});
  const why=addMethodBlock(ticket);
  if(why)return interaction.reply({content:why,flags:64});
  const {room,menu}=addMethodMenu(ticket);
  return interaction.reply({
    embeds:[kEmbed("Ticket").setTitle(`Add a Payment Method`)
      .setDescription(`${kHero(dealOf(ticket).hero)}\n${room===1?"Pick one more method. Its exchangers will be notified and can claim this ticket.":`Pick up to ${room} more. Exchangers for each will be notified, and any of them can claim this ticket.`}`)
      .setFooter(kFoot("Your ticket stays open while you wait"))],
    components:[new ActionRowBuilder().addComponents(menu)],flags:64});
}
async function addMethods(interaction){
  const tickets=Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets");
  const ch=interaction.channel,ticket=tickets[ch.id];
  if(!ticket)return interaction.reply({content:"This ticket is no longer open.",flags:64});
  const owner=isOwner(interaction.user.id,interaction.member);
  if(interaction.user.id!==ticket.userId&&!owner)return interaction.reply({content:"Only the client can add a payment method.",flags:64});
  const why=addMethodBlock(ticket);
  if(why)return interaction.reply({content:why,flags:64});
  const cur=ticketMethods(ticket);
  const want=[...new Set(interaction.values||[])].filter(v=>getMethod(v)&&!isSoloMethod(v)&&!cur.includes(v)).sort((a,b)=>methodIndex(a)-methodIndex(b)).slice(0,MAX_TICKET_METHODS-cur.length);
  if(!want.length)return interaction.reply({content:"Pick a method this ticket doesn't accept yet.",flags:64});
  const wait=ADD_METHOD_COOLDOWN_MS-(Date.now()-(_addMethodAt.get(ch.id)||0));
  if(wait>0&&!owner)return interaction.reply({content:`You can add another method in ${Math.ceil(wait/1000)}s.`,flags:64});
  _addMethodAt.set(ch.id,Date.now());
  await interaction.deferUpdate().catch(()=>{});
  // The exchangers of each new method have to be able to see the ticket. A method whose role can't be let in is left out.
  const granted=new Set(),add=[];
  for(const v of want){
    const rid=CONFIG.ROLES&&CONFIG.ROLES[v];
    if(!rid||_rolesThatSee(ch,[rid]).length){add.push(v);continue;}
    try{await ch.permissionOverwrites.edit(rid,{ViewChannel:true,ReadMessageHistory:true,SendMessages:false},{type:0});granted.add(rid);add.push(v);}
    catch(e){console.error("[addmethod] couldn't open the ticket to role",rid+":",e.message);}
  }
  if(!add.length){
    _addMethodAt.delete(ch.id);
    return interaction.editReply({content:"Couldn't open this ticket to those exchangers. Ask staff for help.",embeds:[],components:[]}).catch(()=>{});
  }
  // Letting those roles in took a moment: make sure the ticket is still unclaimed and has room before the methods are recorded
  const stop=addMethodBlock(ticket),now=ticketMethods(ticket);
  const fin=stop?[]:add.filter(v=>!now.includes(v)).slice(0,MAX_TICKET_METHODS-now.length);
  if(!fin.length){
    for(const rid of granted)await ch.permissionOverwrites.delete(rid).catch(()=>{});       // take back the access just opened
    _addMethodAt.delete(ch.id);
    return interaction.editReply({content:stop||"This ticket already accepts those methods.",embeds:[],components:[]}).catch(()=>{});
  }
  ticket.methods=[...now,...fin];delete ticket.nudged;ticket.widenedAt=Date.now();
  tickets[ch.id]=ticket;_mem.tickets=tickets;save("tickets",tickets);
  await syncTicketMethod(ch,ticket);
  const names=joinOr(fin.map(methodLabel));
  const oldPanel=await findPanelMessage(ch,ticket);
  const fresh=await postOpenPanel(ch,ticket,{title:`Methods Added`,lead:`<@${ticket.userId}> now also accepts **${names}**. Exchangers for ${fin.length>1?"these methods":"this method"} can claim this ticket.`,known:granted,only:rolesForMethods(fin),pingClient:false});
  if(fresh){if(oldPanel&&oldPanel.id!==fresh.id)await oldPanel.edit({components:[]}).catch(()=>{});}
  else await refreshPanel(ch,ticket);
  await retireNudge(ch,ticket,interaction.message&&interaction.message.id);        // the ten-minute prompt is no longer needed (if it was the one used, it becomes this confirmation)
  await interaction.editReply({content:"",embeds:[kEmbed("Ticket","ok").setTitle(`Method Added`).setDescription(`${kHero(dealOf(ticket).hero)}\n${names} exchangers have been notified.`)],components:[]}).catch(()=>{});
  log(interaction.guild,`ADD METHOD: #${ch.name} | ${interaction.user.tag} | +${fin.join(",")} | now ${ticket.methods.join(",")}`);
}
// ── end Several payment methods ──────────────────────────────────────────────────────────────────────────────

// ── Safety system ────────────────────────────────────────────
// Reads each claimed ticket for signs an exchanger is scamming the client, and says nothing in the ticket until it really thinks so.
// Two kinds of evidence are kept apart:
//   what the CLIENT says  (accusations, demands, "where is my money", nerves) -- it can be wrong or just impatient, so it never decides anything alone
//   what the EXCHANGER does (asks to leave the ticket, asks for a password / seed phrase / 2FA code, pushes the client to confirm while nothing
//                            has arrived, asks for an extra fee, posts a wallet that isn't theirs, tells the client to ignore the bot or staff,
//                            or goes quiet while the client is spamming, asking for help or proof, or saying "scam")
// A ticket only reaches caution or critical when the exchanger's own conduct backs up what the client says.
// Silence on its own means nothing (people step away): it only counts while the client is spamming, asking for help or proof, reporting that
// nothing arrived, saying "scam", or has paid, and the longer it lasts and the more of those there are, the more it weighs.
//   watch    (25+)  real evidence seen: written to the log channel only; nothing visible in the ticket
//   caution  (70+)  the exchanger can't claim new tickets · the client gets a calm "Safety Check" (with the "we never DM first"
//                   warning) · owners are alerted (Clear / Freeze) · the exchanger's other clients get a quick check-in
//   critical (100)  hard evidence only (60+ points of what the exchanger did): the ticket is paused and the exchanger frozen, exactly like a client flag
// Owners, and any ticket an owner claims or opens, are never analysed, held or frozen. While an owner is talking in a ticket nothing escalates.
// Veteran exchangers (10+ completed trades) and tickets an owner already cleared need stronger evidence.
// Owners clear an exchanger of all doubt with /clearexchanger, $clear, /reinstate or the alert's Clear button (liftRestrictions).
// Turn the whole thing off with the environment variable SAFETY_SYSTEM=off.
const SAFETY={
  enabled:process.env.SAFETY_SYSTEM!=="off",
  levels:{watch:25,caution:70,critical:100},
  rank:{watch:1,caution:2,critical:3},
  // most one kind of signal can add. Client words first (weak: without an accusation they pile up to 66), then what the exchanger does.
  caps:{accuse:60,demand:30,missing:20,chase:10,worry:6,
        steer:40,sensitive:70,discredit:40,pressure:40,advance:35,refuse:30,addr:25,stall:12,ignored:60},
  points:{accuse:50,demand:20,missing:10,chase:5,worry:3},
  conduct:["steer","sensitive","discredit","pressure","advance","refuse","addr","stall","ignored"],   // the exchanger's own doing
  realConduct:25,              // this much conduct (or any accusation) is real evidence: a stray outside link (20) or a stall excuse (12) is not
  cautionConduct:30,           // caution needs at least this much from the exchanger's side, whatever the client says
  criticalConduct:60,          // ...and an automatic freeze (critical) this much in real deeds (silence and excuses are not deeds): one outside link or one steering attempt is never enough
  confirmMs:90*1000,           // "did you send?" only counts if nobody answered it by then
  repeatMs:20*60*1000,         // ...unless it's the 3rd+ in this window (stalling replies can't reset it)
  ignoreMs:[10*60*1000,6*60*1000,4*60*1000],   // silence starts to count after this long with 1 / 2 / 3+ signs of distress from the client
  spamMs:3*60*1000,spamCount:4,nudgeSpam:3,    // "spamming" = 4 messages in 3 minutes, or 3 nudges, with no answer
  missingMs:60*60*1000,        // "nothing arrived" is remembered this long when judging what the exchanger says next
  stallFree:2,                 // an honest exchanger may say "one sec" twice (within repeatMs) while the client says nothing arrived; from the 3rd excuse on it counts a little
  ownerPauseMs:10*60*1000,     // nothing escalates for this long after an owner speaks in the ticket
  holdMs:6*60*60*1000,         // a caution hold lifts by itself after this, unless an owner acts sooner
  noteMax:160,                 // longest note kept on a ticket (and shown to the owners)
  clearedBonus:15,             // a ticket an owner cleared needs stronger evidence to be flagged again
  heldBonus:10,                // an exchanger already on hold is judged a little stricter in their other tickets
  trustedAfter:10,trustedBonus:10   // an exchanger with this many completed exchanges gets the benefit of the doubt
};
const _safety=new Map();       // channelId -> live conversation state (not saved; it rebuilds as people talk)
let _safetySweepRunning=false;

// ---- 1. Reading the conversation (pure text rules, no Discord calls) ----
const _NEG=/\b(?:not|never|no|nothing|none|without|didn'?t|haven'?t|hasn'?t|wasn'?t|isn'?t|won'?t|can'?t|couldn'?t|don'?t|doesn'?t|aren'?t|weren'?t|wouldn'?t)\b/;
function _norm(raw){
  return String(raw||"").toLowerCase()
    .replace(/<a?:\w+:\d+>/g," ").replace(/<[@#&!]+\d+>/g," ").replace(/https?:\/\/\S+/g," ")
    .replace(/[\u2018\u2019]/g,"'").replace(/([a-z])\1{2,}/g,"$1").replace(/\s+/g," ").trim();
}
function _hasNeg(t){return _NEG.test(t.replace(/\bno\s+(?:problem|problems|worries|rush|issue|issues)\b/g," "));}
const _C={
  // an outright accusation, however it's phrased (a question like "did you scam me?" is still a worry, a statement is not)
  accuseHard:[
    /\b(?:scamm?(?:ed|ing)|stole|stolen|robbed|robbing)\s+(?:me|my)\b/,
    /\byou\s+(?:just\s+|really\s+|actually\s+)?(?:scamm?ed|stole|robbed|ripped|conned|cheated)\b/,
    /\b(?:ripped|rip|ripping)\s+(?:me\s+)?off\b/,
    /\b(?:i|im|i'm|ive|i've|i\s+am|i\s+was|i\s+got|i\s+have\s+been|i\s+been|got|been)\s+(?:(?:just|literally|being|been|gotten|really|so|totally)\s+)*(?:scamm?ed|robbed|cheated|conned)\b/,
    /\bstop\s+lying\b/
  ],
  // "you're keeping my money": an accusation as a statement, only a worry as a question ("will you keep my money safe?")
  keepHard:[
    /\b(?:keeping|kept|took|taking|holding)\s+(?:all\s+)?(?:of\s+)?my\s+(?:money|funds?|crypto|coins?|payment|btc|ltc|usdt|eth|sol|cash)\b/
  ],
  // asking for it back: heat, not proof. "give me my money back" is a demand; "what is your refund policy?" or "if I want a refund" is a worry
  demandHard:[
    /\b(?:money|funds?|crypto|coins?|payment|cash)\s+back\b|\bback\s+(?:my|the)\s+(?:money|funds?|crypto|coins?|payment|cash)\b/,
    /\b(?:give|return|pay)\s+me\s+(?:back\s+)?my\s+(?:money|funds?|crypto|coins?|btc|ltc|usdt|eth|sol|payment|cash)\b/,
    /\b(?:give|send|return|pay)\s+(?:me\s+)?(?:back\s+)?(?:my|the)\s+(?:money|funds?|crypto|coins?|btc|ltc|usdt|eth|sol|payment|cash)\s+back\b/,
    /\b(?:give|send|return|pay)\s+(?:me\s+)?back\s+(?:my|the)\s+(?:money|funds?|crypto|coins?|btc|ltc|usdt|eth|sol|payment|cash)\b/,
    /\b(?:refund|chargeback|charge\s+back)\b/,
    /\b(?:send|give|return|pay|put|transfer)\s+(?:it|them|that|this|everything|all\s+of\s+it)\s+back\b/,
    /\bi\s+(?:want|need|demand)\s+(?:it|them|that|my\s+\w+|the\s+\w+|everything)\s+back\b/,
    /\breturn\s+(?:my|the)\s+(?:money|funds?|crypto|coins?|btc|ltc|usdt|eth|sol|payment|cash)\b/
  ],
  // threats: the same rule ("I'm reporting you" is heat; "how do I report this?" and "if you don't send it I'll report you" are worries)
  threatHard:[
    /\b(?:report(?:ing)?|expos(?:e|ing)|sue|suing)\s+(?:you|u|him|her|this)\b/,
    /\b(?:calling|call|contact(?:ing)?|going\s+to|go\s+to)\s+(?:the\s+)?(?:police|cops|fbi|rcmp)\b/,
    /\b(?:calling|call|contact(?:ing)?)\s+(?:the\s+|my\s+)?(?:bank|paypal|cash\s*app)\b[^.?!]{0,40}\b(?:dispute|report|reverse|chargeback|scam|scammed|fraud|stolen|steal|refund|back)\b/,
    /\b(?:going|gonna|will|i'?ll|im\s+going)\s+(?:to\s+)?dispute\b/,
    /\b(?:lawyer|attorney|legal\s+action|cyber\s*crime|authorities|rcmp|interpol)\b/,
    /\bwarn(?:ing)?\s+(?:everyone|everybody|others|people|the\s+(?:server|community))\b/,
    /\b(?:get|have)\s+(?:you|u)\s+(?:banned|blacklisted|arrested)\b|\bban\s+(?:you|u)\b/
  ],
  // accusation wording that is only an accusation when it isn't a question ("are you a scammer?" is a worry)
  accuseSoft:[
    /\byou(?:'?re|\s+are|\s+r|\s+ur)?\s+(?:(?:a|the|just|literally|really|trying\s+to|tryna|gonna|such\s+a)\s+)*(?:scamm?(?:er|ers|ing|ed)?|thief|stealing|steal|fraud|fraudster|fake)\b/,
    /\b(?:u|ur|ya|your)\s+(?:(?:a|just|such\s+a)\s+)*(?:scamm?(?:er|ers|ing|ed)?|thief|fraud|fake)\b/,
    /\b(?:he|she|they|this\s+(?:guy|dude|person|man|girl|exchanger))\s+(?:(?:is|are|was|just|literally|a)\s+)*(?:scamm?(?:er|ers|ing|ed)?|stealing|thief|fraud)\b/,
    /\b(?:this|that|it)\s+(?:is|was|'?s)\s+(?:a\s+)?(?:scam|fraud|theft|robbery)\b/,
    /^(?:scammer|scam|thief|fraud)[\s!.]*$/
  ],
  // the client says something hasn't arrived
  missing:[
    /\b(?:haven'?t|have\s+not|hasn'?t|has\s+not|didn'?t|did\s+not|never|not\s+yet|yet\s+to)\s+(?:received|receive|seen|see|find|found|gotten|get|got)\s+(?:it|them|anything|any|the\s+(?:money|funds?|crypto|payment|coins?)|my\s+(?:money|funds?|crypto|payment|coins?))\b(?!\s+(?:address|link|details?|info|instructions?|method|page|button|qr|code|tag|name|email))/,
    /\b(?:haven'?t|have\s+not|hasn'?t|has\s+not|didn'?t|did\s+not|never|not\s+yet|yet\s+to)\s+(?:received|receive)\b/,
    /\b(?:don'?t|do\s+not|can'?t|cannot|can\s+not|couldn'?t)\s+(?:see|find|receive)\s+(?:it|them|anything|any|the\s+(?:money|funds?|crypto|payment|coins?)|my\s+(?:money|funds?|crypto|payment|coins?))\b(?!\s+(?:address|link|details?|info|instructions?|method|page|button|qr|code|tag|name|email))/,
    /\bnot\s+(?:yet\s+)?received\b/,
    /\b(?:nothing|no\s+(?:money|funds?|payment|crypto|coins?|btc|ltc|usdt|eth|sol|transfer|deposit|notification))\s+(?:yet|here|arrived|came|has|have|hasn'?t|received|showing|in|on|from|through|at\s+all)\b/,
    /\b(?:received|got|get|see|seen)\s+(?:nothing(?!\s+(?:wrong|bad|weird|suspicious|off|odd|strange|special|else|more|new|unusual))|no\s+(?:money|funds?|payment|crypto|coins?|transfer))\b/,
    /\bwhere(?:'?s|\s+is|\s+are|\s+r)?\s+(?:my|the|our)\s+(?:\w+\s+){0,2}(?:money|funds?|crypto|coins?|payment|btc|ltc|usdt|eth|sol|transfer|order|stuff)\b/,
    /\bwhere(?:'?s|\s+is)\s+it\b/,
    /\b(?:not|isn'?t|aren'?t|hasn'?t|haven'?t)\s+(?:showing|arrived|in\s+my|come\s+through|come\s+in|reflect(?:ing|ed)|appear(?:ing|ed))\b/,
    /\b(?:isn'?t|aren'?t|hasn'?t|haven'?t)\s+(?:here|there)\b/,
    /\b(?:you|u|he)\s+(?:still\s+)?(?:didn'?t|did\s+not|never|haven'?t|have\s+not)\s+(?:send|sent|pay|paid|transfer(?:red)?|give|gave)\b/,
    /\bstill\s+(?:nothing|no\s+(?:money|funds?|crypto|payment|update|response|reply))\b/
  ],
  // impatience: nudges and "are you there?"
  chase:[
    /\b(?:did|have|has)\s+(?:you|u|ya|he)\s+(?:already\s+)?(?:send|sent|pay|paid|transfer(?:red)?|check(?:ed)?|receive[d]?|get|got|confirm(?:ed)?|do|done|look(?:ed)?|see|seen)\b(?!\s+(?:this|that|it|these|those)\s+before)/,
    /\b(?:you|u)\s+(?:sent|send|sending)\s*\?/,
    /\b(?:sent|paid|done)\s+yet\b|\byet\s*\?/,
    /\b(?:any|no)\s+(?:update|updates|news|progress)\b/,
    /\bupdate\s*\?/,
    /\bwhat'?s\s+(?:the\s+)?(?:update|status|delay|holding\s+(?:it|this)\s+up|taking\s+so\s+long)\b/,
    /\bhow\s+long\b/,
    /\btaking\s+(?:so\s+)?(?:long|forever|ages)\b/,
    /\bhurry(?:\s+up)?\b|\bcome\s+on\b|\bany\s+(?:minute|time)\s+now\b|\bplease\s+(?:respond|reply|answer)\b/,
    /\b(?:are|r)\s+(?:you|u)\s+(?:there|here|alive|ignoring|even)\b/,
    /\b(?:you|u)\s+(?:there|here|alive)\s*\?/,
    /\bhe+l+o+\s*\?|\banyone\s+(?:there|here)\b|\bwhere\s+(?:are|r|did)\s+(?:you|u|he)(?!\s+(?:from|located|based|live|living|stay|staying|send|sent|get|got|buy|bought|find|found))\b/,
    /\b(?:ignoring|ignored)\s+me\b|\banswer\s+me\b/,
    /\bstill\s+waiting\b|\bwaiting\s+(?:for|on)\s+(?:you\b|u\b|ur\s+(?:reply|response|answer|confirmation)|your\s+(?:reply|response|answer|confirmation|message|update)|a\s+(?:response|reply))|\bi'?m\s+waiting\b/,
    /\b(?:ive|i'?ve|i\s+have|been|have\s+been)\s+(?:been\s+)?waiting\b|\bwaiting\s+(?:forever|ages|so\s+long|too\s+long|a\s+long\s+time)\b/,
    /\b(?:is|are)\s+(?:it|you|this|that)\s+(?:sent|done|ready|finished|complete|completed|processed|going\s+through|on\s+(?:the|its)\s+way)\b/,
    /\b(?:sent|paid|done|ready|finished|processed)\s+yet\b/,
    /\b(?:are|r)\s+(?:you|u)\s+(?:coming|going\s+to\s+come)\s+back\b|\bwhere(?:'?d|\s+did)\s+(?:you|u)\s+go\b/,
    /\bhow(?:'?s|\s+is)\s+(?:it|that|the\s+(?:send|payment|transfer|order|trade|exchange|swap))\s+(?:coming|progressing|looking)\b|\bhow(?:'?s|\s+is)\s+it\s+going\s+with\b/,
    /\btaking\s+(?:(?:way|so|too|very|really)\s+)*(?:long|forever|ages|slow)\b/,
    /\b(?:give|need|want|get)\s+(?:me\s+)?(?:an?\s+)?updates?\b/,
    /\bdo\s+(?:it|this)\s+already\b/,
    /\bdid\s+(?:it|that|the\s+\w+)\s+(?:go\s+through|work|arrive|land|come\s+through|hit)\b/,
    /\bany\s+(?:news|luck|progress)\b/,
    /\bwhat(?:'?s|\s+is)\s+(?:the\s+)?(?:update|status|delay|eta|progress|holding\s+(?:it|this)\s+up|going\s+on|happening|hold\s*up|problem|issue)\b/,
    /^(?:(?:hello|hey|yo|hi)\s+)?(?:are\s+)?(?:you|u)\s+(?:still\s+)?(?:there|here|alive|awake|around|online)\s*[?!.]*$/,
    /\b(?:you|u)\s+(?:alive|awake|around|online|active)\s*\?/,
    /\b(?:anybody|anyone|somebody)\s+(?:home|alive|awake|around|there|here)\b|\b(?:hello|hey|hi|yo)\s+(?:anyone|anybody)\b|\bwake\s+up\b|\b(?:ghost|ghosted|ghosting)\b/,
    /(?<!\b(?:only|just|barely|hardly)\s)\b(?:been|it'?s|its|it\s+has\s+been)\s+(?:been\s+)?(?:\d+\s*(?:min|mins|minutes?|hours?|hrs?)|an?\s+(?:hour|while|long\s+time)|ages|forever)\b/,
    /(?<!\b(?:i|i'll|ill|im|will|am|gonna|to|me|we|let)\s)\b(?:send|release|process|confirm|finish|complete)\s+(?:it|this|them|that|everything|my\s+\w+|the\s+\w+)?\s*(?:already|asap)\b/,
    /^(?:please\s+|pls\s+|plz\s+)?(?:send|release|process|confirm|finish|complete)\s+(?:it|this|them|that|everything)\s+now\b/,
    /\b(?:respond|reply|answer)\s+(?:me|now|already|please|pls|plz)\b|\b(?:please|pls|plz)\s+(?:respond|reply|answer)\b|\bget\s+back\s+to\s+me\b|\btalk\s+to\s+me\b|\bsay\s+something\b|\bbump\b/
  ],
  // "never mind, it just arrived": a worry the client has already put to rest
  settled:/\b(?:nvm|nevermind|never\s+mind|false\s+alarm|ignore\s+(?:that|me|what\s+i\s+said)|just\s+(?:arrived|came|landed|hit|showed\s+up|got\s+it|received\s+it)|finally\s+(?:arrived|came|got|received|landed|hit|showed\s+up)|(?:it|they|the\s+(?:money|funds|payment|crypto))\s+(?:just\s+|finally\s+)?(?:arrived|came|landed|hit|showed\s+up)\b|got\s+it\s+now|see\s+it\s+now|found\s+it|there\s+it\s+is)\b/,
  // a short nudge on its own: "hello?", "u there?", "status?", "sent?"
  shortAsk:/^(?:(?:hello+|hey+|hi+|yo+|bro|sir|man|dude|anyone|anybody|there|here|you|u|alive|awake|update|status|eta|sent|done|ready|wait|waiting)\s*){1,3}\?+$/,
  // nerves, not trouble
  worry:[
    /(?<!\bnot\s)(?<!\bnever\s)(?<!n't\s)\b(?:nervous|scared|worried|worry|worrying|afraid|anxious|sketchy|sus|suspicious|uneasy|hesitant)\b/,
    /\bhow\s+do\s+i\s+know\b|\bcan\s+i\s+trust\b|\bcan\s+(?:i|we)\s+(?:be\s+)?sure\b/,
    /\b(?:is|are)\s+(?:this|it|he|she|you|u)\s+(?:legit|legitimate|safe|real|trusted|trustworthy|verified)\b/,
    /\b(?:legit|safe|trust(?:worthy)?)\s*\?/,
    /\bwhat\s+if\s+(?:you|u|he|it)\b/,
    /\b(?:shady|shadey|dodgy|fishy|iffy|risky|uncomfortable|doubtful|skeptical|sceptical)\b|\bnot\s+comfortable\b/,
    /\b(?:i'?m|im|i\s+am|a\s+bit|bit|little|kinda|kind\s+of|slightly|very|so|quite|really)\s+concerned\b/,
    /\b(?:unsure|uncertain)\s+(?:about|of)\b|\b(?:unsure|uncertain)\s*$/,
    /\b(?:i\s+(?:have|got)\s+(?:some\s+|my\s+)?doubts?|doubts?\s+(?:about|that))\b/,
    /\b(?:not|don'?t|do\s+not)\s+(?:feel\s+)?sure\s+(?:about|of)\b|\b(?:don'?t|do\s+not|not)\s+feel\s+(?:safe|right)\b/,
    /\b(?:bad|weird|funny|gut)\s+feeling\b|\bred\s+flags?\b|\btrust\s+issues\b|\b(?:don'?t|do\s+not)\s+trust\b/,
    /\b(?:will|am|would)\s+i\s+(?:(?:really|definitely|actually|even|still)\s+)?(?:get|receive|be\s+paid)\b|\b(?:am|are)\s+i\s+(?:going\s+to|gonna)\s+(?:get|receive)\b/,
    /\bwhat\s+(?:if|happens\s+if)\s+i\b/,
    /\bhow\s+(?:safe|secure)\b/,
    /\b(?:feels?|seems?|looks?)\s+(?:off|wrong|weird|odd|strange|funny|fishy|sketchy|shady|dodgy|suspicious)\b/,
    /\b(?:a|the|any|what|no)\s+guarantee\b|\bguarantee\s*\?/,
    /\b(?:calling|call|contact(?:ing)?)\s+(?:the\s+|my\s+)?(?:bank|paypal|cash\s*app)\b/
  ],
  // the client says they've sent their side
  paid:[
    /\b(?:i|ive|i've)\s+(?:just\s+|already\s+|now\s+|have\s+)*(?:sent|paid|payed|transferred)\b/,
    /^(?:sent|paid|payed|done|payment\s+sent)\b[\s.!]*(?:it|already|now)?[\s.!]*$/,
    /\b(?:sent|paid)\s+(?:it|already|just\s+now|the\s+(?:money|funds|payment))\b/
  ],
  // the client says it all went through
  resolved:[
    /\b(?:received|got\s+(?:it|them|that|the\s+\w+)|arrived|came\s+through|came\s+in|it'?s\s+here|its\s+here|all\s+good|looks?\s+good|perfect|confirmed|thank(?:s|\s+you)|thx|tysm|ty|appreciate\s+it|smooth)\b/
  ]
};
// ---- Meaning layer: different words, same signal ----
// Nobody types the exact phrases above. The same ideas are also recognised from word groups, so "didn't get it",
// "haven't received", "not showing up", "where's my money" and "no sign of it" are all one signal ("it hasn't
// arrived"), and every wording of a signal is worth exactly the same.
const _W=s=>new Set(s.split(/\s+/));
const _SLANG={u:"you",ya:"you",yu:"you",ur:"your",r:"are",wat:"what",wut:"what",wht:"what",abt:"about",bc:"because",cuz:"because",
  pls:"please",plz:"please",plss:"please",nvr:"never",dnt:"dont",cnt:"cant",recieve:"receive",recieved:"received",recive:"receive",
  recived:"received",recieving:"receiving",arive:"arrive",arived:"arrived",payed:"paid",wen:"when",
  wheres:"where is",whers:"where is",theres:"there is",whats:"what is",youre:"you are",hes:"he is",shes:"she is",theyre:"they are",
  thats:"that is",its:"it is",im:"i am",ive:"i have",ill:"i will"};
const _GETV=_W("get gets got gotten getting receive receives received receiving see sees seen saw seeing find finds found finding deliver delivered");
const _GETNOW=_W("get gets getting");                                     // "I don't get it" is about understanding, not about money
const _ARRV=_W("arrive arrives arrived arriving come comes came coming land lands landed landing hit hits reach reaches reached reaching credited reflect reflects reflected reflecting appear appears appeared appearing deliver delivered");
const _SHOWV=_W("show shows showed showing shown posted update updated process processed clear cleared go goes went going");
const _ARRIVES=new Set([..._ARRV,..._SHOWV]);
const _ARRV_NEXT=_W("up in yet here there through on at to into still now anything any so far again either ever for my your the me us mine our this that a an");
const _SHOW_NEXT=_W("up in yet here there through on at to into still now anything any so far again either ever for");
const _NEGP=_W("not never nothing none zero nowhere without cannot cant dont doesnt didnt dint dident havent hasnt hadnt isnt arent wasnt werent wont wouldnt couldnt shouldnt aint unable failed fails");
const _NEGNOW=_W("dont doesnt wont wouldnt");
const _NEGS=_W("not never hasnt havent hadnt isnt arent wasnt werent didnt doesnt dont wont cant couldnt wouldnt aint");
const _LIGHT=_W("even yet still really actually ever just quite fully properly completely already the my your a an to be been being able seem seems seemed manage managed has have had did does do is are was were it am i we you they he she");
const _LEAD=_W("still yet also ok okay hello hey bro wait and now rn it is has have");
const _STUFF=_W("money moneys funds fund crypto coin coins btc bitcoin ltc litecoin eth ethereum sol solana usdt usdc tether bnb xrp doge payment payments transfer transfers etransfer interac paypal cashapp venmo zelle applepay cash cad usd dollars dollar bucks order orders stuff deposit deposits");
const _NOTICE=_W("notification notifications notif alert sign signs trace confirmation");
const _THING=new Set([..._STUFF,..._NOTICE,..._W("it them anything something everything")]);
const _ADDR=_W("address addr details detail link links info information instructions instruction method methods option options qr code page button menu section tab screen screenshot tag cashtag handle username user name id number email phone contact key");
const _SUBJ=new Set([..._STUFF,..._W("it they them that this those these")]);
const _TAILMARK=_W("yet still at all either anywhere anymore ever so far from paid");
const _PRED=_W("here there visible available present");
const _CALM=/\b(?:no\s+(?:rush|hurry|pressure|worries|problem|problems|stress)|not\s+(?:in\s+a\s+)?(?:rush|hurry|urgent)|(?:don'?t|do\s+not)\s+(?:worry|rush|stress)|nothing\s+to\s+(?:worry|be\s+worried|be\s+nervous|fear)(?:\s+about)?|take\s+your\s+time|whenever\s+you\s+(?:can|like|want|are\s+ready)|when\s+you\s+(?:can|are\s+ready|get\s+a\s+chance)|at\s+your\s+(?:own\s+)?pace|no\s+need\s+(?:to|for)\s+(?:rush|hurry|worry|stress|panic)|(?:don'?t|do\s+not)\s+(?:need|have)\s+to\s+(?:rush|hurry)|there'?s\s+no\s+(?:need\s+to\s+)?(?:rush|hurry))\b/g;
const _PRESS=_W("hurry asap urgent urgently quickly faster rush rushing immediately");
const _ACCW=_W("scammer scammers scammed scamming scammin fraud fraudster fraudulent thief thieves steal stealing steals stole stolen rob robbed robbing cheat cheated cheating cheater conned conman swindle swindled swindler crook crooked criminal liar lying lied fake phony");
const _ACCS=_W("you your he she they exchanger guy dude person man girl this that");
const _ACCFILL=_W("a an the just really such literally actually definitely obviously clearly totally so very big dirty little stupid fucking damn is are was were am be being been to");
const _STAT=_W("eta status update updates progress news");
const _DET=_W("the my our your that those this these");
// what a message looks like once slang, apostrophes and money spellings are tidied: a list of short clauses of plain words
const _clauses=t=>String(t)
  .replace(/(\d)[.,](\d)/g,"$1$2").replace(/'/g,"").replace(/\be[\s-]?transfer\b/g,"etransfer").replace(/\bcash\s*app\b/g,"cashapp")
  .replace(/\bapple\s*pay\b/g,"applepay").replace(/\byet\s+to\b/g,"not").replace(/\bno\s+longer\b/g,"not")
  .split(/[.!?;:,\n]+|\bbut\b|\bhowever\b|\bso\b/)
  .map(c=>c.split(/[^a-z0-9$]+/).filter(Boolean).flatMap(w=>(_SLANG[w]||w.replace(/^\$/,"")).split(" ")))
  .filter(c=>c.length);
const _skip=(c,i)=>{while(i<c.length&&_LIGHT.has(c[i]))i++;return i;};
// an arrival verb that really says "it didn't show up" (and not "it doesn't show the address")
const _arrived=(c,k)=>{
  const w=c[k],next=c[k+1];
  if(["go","goes","went","going"].includes(w))return next==="through";
  return next===undefined||(_SHOWV.has(w)?_SHOW_NEXT:_ARRV_NEXT).has(next);
};
const _nearBank=(c,k)=>c[k]==="in"&&(c[k+1]===undefined||c[k+1]==="yet"||["my","your","the","mine","account","wallet","bank"].includes(c[k+1]));
const _notThere=(c,k)=>(_ARRIVES.has(c[k])&&_arrived(c,k))||_PRED.has(c[k])||_nearBank(c,k);
// "it hasn't arrived": the client says what they were promised isn't there, in any of its wordings
function _meansMissing(c,all){
  if(all.some(w=>w==="before"||w==="until"||w==="since"))return false;            // "I've never seen this before"
  let lead=0;while(lead<c.length&&_LEAD.has(c[lead]))lead++;
  if(_NEGS.has(c[lead])&&_notThere(c,_skip(c,lead+1)))return true;                 // "hasn't arrived" | "still not here" | "doesn't show up"
  for(let i=0;i<c.length;i++){
    const w=c[i];
    // 1. a negative, a few light words, then a receiving verb:  didn't get | haven't received it | can't see anything
    if(_NEGP.has(w)){
      const j=_skip(c,i+1),v=c[j];
      if(_GETV.has(v)&&!(_GETNOW.has(v)&&_NEGNOW.has(w))){
        const tail=c.slice(j+1,j+4);
        if(!tail.length||_TAILMARK.has(tail[0])||(tail.length===1&&tail[0]==="any"))return true;
        for(let k=0;k<tail.length;k++){
          if(_THING.has(tail[k])&&!_ADDR.has(tail[k+1]||"")&&!(k>0&&_ADDR.has(tail[k-1])))return true;
        }
      }
      // "nothing came through" / "nothing is showing" / "nothing here" / "nothing in my account"
      if((w==="nothing"||w==="none")&&_notThere(c,_skip(c,i+1)))return true;
      if(w==="nothing"&&i>0&&i===c.length-1&&["is","still","there","here","yet"].includes(c[i-1]))return true;     // "theres nothing"
    }
    // 2. receiving (or showing), then nothing:  received nothing | got no money | cashapp shows nothing
    if(_GETV.has(w)||["show","shows","showing","showed"].includes(w)){
      const a=c[i+1],b=c[i+2];
      if(a==="nothing"||a==="none"||a==="nada"){if(!["wrong","bad","weird","suspicious","off","odd","strange","special","else","more","new","unusual"].includes(b))return true;}
      if((a==="no"||a==="zero")&&(_STUFF.has(b)||_NOTICE.has(b)))return true;
    }
    // 3. something that should be there, isn't:  the money hasn't arrived | it isn't showing up | payment not here
    if(_SUBJ.has(w)){
      const n=_skip(c,i+1);
      if(_NEGS.has(c[n])&&_notThere(c,_skip(c,n+1)))return true;
    }
    // 4. "no" + the thing, at the start of what they say:  no money yet | no sign of it | no notification
    if(w==="no"&&(i===0||["still","yet","and","ok","okay","hello","hey","hi","yo","bro","wait","there","theres","see","saw"].includes(c[i-1]))){
      const x=c[i+1];
      if(_STUFF.has(x)||_NOTICE.has(x)||x==="email")return true;
    }
    // 5. where is it | where's my money | where did it go
    if(w==="where"&&i<=2&&c.slice(0,i).every(p=>_W("ok so hello hey hi yo bro wait and um uh sir man dude wtf tf").has(p))){
      let k=i+1;
      if(["is","are","was","were","did","does"].includes(c[k]))k++;
      if(["it","they","them","that","this","those","these"].includes(c[k])&&!["send","sending","find","see","check"].includes(c[k+1]))return true;
      if(_DET.has(c[k])||_STUFF.has(c[k])){
        for(let m=k;m<c.length&&m<=k+3;m++){
          if(_STUFF.has(c[m])&&!_ADDR.has(c[m+1]||""))return true;
          if(["address","wallet","qr","ticket","exchanger","link","tag","cashtag","email","number","info","details","instructions","screenshot","proof"].includes(c[m]))break;
        }
      }
    }
    // 6. still pending | still waiting for my money | waiting on my payment
    if(w==="still"){
      for(let j=i+1;j<c.length&&j<=i+2;j++){
        if(["pending","processing","empty","zero","missing","unpaid","unsent","unreceived"].includes(c[j]))return true;
      }
    }
    if((w==="waiting"||w==="waited")&&["for","on"].includes(c[i+1])){
      for(let m=i+2;m<c.length&&m<=i+5;m++){
        if(_STUFF.has(c[m])&&!_ADDR.has(c[m+1]||""))return true;
        if(!_DET.has(c[m])&&!_STUFF.has(c[m]))break;
      }
    }
    // 7. the balance says so:  balance is 0 | wallet is empty | account hasn't changed
    if(["balance","wallet","account","acct","bank"].includes(w)){
      for(let j=i+1;j<c.length&&j<=i+5;j++){
        if(["zero","empty","unchanged","0","00","000"].includes(c[j]))return true;
        if(c[j]==="same"&&c.slice(i+1,j).includes("still"))return true;
        if(_NEGS.has(c[j])&&["change","changed","update","updated","increase","increased","refresh","refreshed","move","moved","budge","budged","reflect","reflected","reflecting","changing","updating"].includes(c[j+1]||""))return true;
      }
    }
    // 8. gone | missing | vanished
    if(["missing","gone","vanished","disappeared","stuck"].includes(w)){
      for(let j=Math.max(0,i-3);j<i;j++){if(_STUFF.has(c[j]))return true;}
    }
  }
  return false;
}
// impatience in any wording: "when will you send it", "how much longer", "hurry", "status?"
function _meansChase(c){
  for(let i=0;i<c.length;i++){
    const w=c[i];
    if(w==="when"&&i<=2){
      const a=c[i+1],s=c[i+2],v=c.slice(i+3,i+6);
      if(["will","are","do","does","can","could","would","is","am","gonna"].includes(a)){
        if(["you","he","it"].includes(s)&&v.some(x=>["send","sending","sent","pay","paying","transfer","transferring","ready","done","finish","finished","arrive","arriving","come","coming","reply","respond","back","here","online"].includes(x)))return true;
        if(s==="i"&&v.some(x=>["get","receive","see"].includes(x)))return true;
      }
    }
    if(w==="how"&&(["soon","longer"].includes(c[i+1])||(c[i+1]==="much"&&c[i+2]==="longer")||(c[i+1]==="many"&&c[i+2]==="more")))return true;
    if(_PRESS.has(w)&&!c.slice(Math.max(0,i-3),i).some(x=>["no","not","dont","never","without","nothing"].includes(x)))return true;
    if(_STAT.has(w)&&c.length<=3)return true;
  }
  return false;
}
// the client turns on the exchanger, in any wording ("you're a liar", "he is a fraud", "they scammed me")
function _meansAccuse(c){
  for(let i=0;i<c.length;i++){
    if(!_ACCW.has(c[i]))continue;
    for(let j=i-1;j>=0&&j>=i-4;j--){
      if(_NEGP.has(c[j])||c[j]==="no")break;
      if(_ACCS.has(c[j])){
        const before=c.slice(Math.max(0,j-4),j);                               // "I don't think you're a scammer"
        if(!(before.some(x=>_NEGP.has(x))&&before.some(x=>["think","believe","say","said","feel","suppose","guess","imply"].includes(x))))return true;
        break;
      }
      if(!_ACCFILL.has(c[j]))break;
    }
  }
  return false;
}
// ---- What the client asks for: help, proof, or says "scam". These never score by themselves: they only decide how much the exchanger's silence counts. ----
const _HELP=[
  /^(?:(?:pls|please|plz|ok|okay|hello|hey|yo|guys|guy)\s+)*(?:help+|halp)(?:\s+(?:me|us|please|pls|plz|asap|now|someone|anyone|somebody|here))*[\s!?.]*$/,
  /\b(?:pls|please|plz)\s+help\b(?!\s+(?:you|him|her|them)\b)/,
  /\b(?:i|we)\s+(?:really\s+|urgently\s+|desperately\s+)?(?:need|want|require)\s+(?:some\s+|urgent\s+|immediate\s+|your\s+|a\s+bit\s+of\s+)?(?:help|assistance|support)\b/,
  /(?<!\b(?:you|u|ya|they|he|she|him|her|it|that|this|who|whoever)\s)\bneed\s+(?:some\s+)?(?:help|assistance)\b/,
  /\b(?:talk|speak|chat)\s+(?:to|with)\s+(?:a\s+|an\s+|the\s+|some\s+|your\s+)?(?:staff|mods?|moderators?|admins?|owners?|support|manager|supervisor|human|real\s+person)\b/,
  /\b(?:any(?:one|body)|someone|somebody)\s+(?:from|in|on)\s+(?:the\s+)?(?:staff|mods?|moderators?|admins?|owners?|support|team)\b/,
  /\b(?:can|could|will|would)\s+(?:someone|somebody|anyone|anybody|a\s+(?:staff|mod|moderator|admin|owner)|staff|an?\s+(?:staff|owner|admin))\s+(?:please\s+|pls\s+|plz\s+)?(?:help|assist|check|look|step\s+in|jump\s+in|come|respond|reply|answer)\b/,
  /\b(?:somebody|someone|anybody|anyone|staff|mods?|admins?|owners?|moderators?)\s+(?:please\s+|pls\s+|plz\s+)?(?:help|answer|respond|reply|check|assist|come|step\s+in)\b/,
  /\b(?:get|call|ping|tag|need|want|bring|fetch|find|contact|ask|summon|page)\s+(?:me\s+)?(?:a\s+|an\s+|the\s+|some\s+|another\s+|your\s+)?(?:staff|mods?|moderators?|admins?|owners?|support|manager|supervisor|human|real\s+person)\b/,
  /\b(?:is\s+)?(?:any|a)\s+(?:staff|mods?|admins?|owners?|moderators?)\s+(?:here|online|available|around|there)\b/,
  /\bwhere(?:'?s|\s+is|\s+are)\s+(?:the\s+)?(?:staff|mods?|admins?|owners?|support)\b/,
  /^(?:staff|mods?|admins?|owners?|support|moderators?)\s*[?!.]*$/
];
const _PROOF=[
  /\b(?:send|show|share|give|post|provide|upload|attach|see|check|verify|view|get|need|want|where(?:'?s|\s+is)|what(?:'?s|\s+is)|got|have|any|prove)\b[^.?!]{0,25}\b(?:proof|evidence|receipts?|screenshots?|ss|txid|tx\s*id|tx\s*hash|transaction\s*(?:id|hash|link|number|screenshot)|hash|blockchain\s+link|explorer\s+link)\b/,
  /^(?:(?:any|some|the|your)\s+)?(?:proof|evidence|receipts?|screenshots?|ss|txid|tx\s*id|hash|transaction\s*(?:id|hash|link))\s*[?!.]*$/,
  /\b(?:proof|screenshot|txid|hash|receipt)\s*\?/,
  /\bprove\s+(?:it|that|you|u|this)\b/
];
// the client giving their OWN proof is not asking for any ("here is my screenshot", "i sent proof", "i can show proof"); "i need proof" and "can i see proof?" still are
const _PROOF_OFFER=/(?<!\b(?:can|could|may|should|do|would|will|how\s+can|how\s+do)\s)\b(?:i|i'll|ill|i\s+will|i\s+am|i'm|im|let\s+me|lemme|gonna)\s+(?:(?:just|already|now|also|can|will)\s+)*(?:sent|send|sending|attach(?:ed|ing)?|upload(?:ed|ing)?|share[ds]?|sharing|post(?:ed|ing)?|have|got|show|showing|took|take|taking)\b[^.?!]{0,14}\b(?:proof|evidence|receipts?|screenshots?|ss|txid|hash)\b|\b(?:here(?:'s|\s+is)|attached|attaching)\b/;
const _SCAMW=/\b(?:scamm?(?:er|ers|ed|ing|s|y)?|scammin|fraud(?:ster|ulent|s)?|rip(?:ped|ping)?\s*(?:me\s+)?off|thie(?:f|ves)|stole|stolen|steal(?:ing)?|swindl\w+|con\s*man|conned|rug\s*pull\w*)\b/;
const _SCAMNEG=/(?:\b(?:not|never|isnt|arent|wasnt|werent|aint|no)|n't)\s+(?:a\s+|an\s+|the\s+|some\s+|any\s+)?(?:scam\w*|fraud\w*)\b(?!\s+me\b)/;     // "this is not a scam" (but "don't scam me" is a plea)
const _HELP_NO=/\b(?:dont|do\s+not|doesnt|didnt|wont|cant|no|not|never)\s+(?:really\s+|longer\s+|even\s+)?(?:need|want|require|ask(?:ing)?\s+for)\b[^.?!]{0,12}\b(?:help|assistance|staff|mods?|moderators?|admins?|owners?|support)\b|\bno\s+(?:help|assistance|staff|support)\s+(?:needed|required|necessary)\b/;     // "i dont need help"
function analyzeDistress(raw){
  const t=_norm(raw);
  return {
    help:!_HELP_NO.test(t)&&_HELP.some(re=>re.test(t)),
    proof:!_PROOF_OFFER.test(t)&&_PROOF.some(re=>re.test(t)),
    scam:_SCAMW.test(t)&&!_SCAMNEG.test(t)
  };
}
// a question or a "what if": wording like "refund" or "report" is only a worry there ("what is your refund policy?", "if you don't send it I'll report you")
const _HYPO=/\b(?:if|in\s+case|incase|unless|whenever|what\s+if|what\s+happens|should\s+i|can\s+i|could\s+i|may\s+i|do\s+i|will\s+i|would\s+i|how\s+(?:do|can|would|will|should)\s+i|is\s+there|are\s+there|do\s+you\s+(?:guys\s+)?(?:offer|give|have|do)|policy|policies|possible|possibly|allowed|eligible|supposed\s+to|just\s+asking|curious|wondering|hypothetically|theoretically|next\s+time|someday)\b/;
// asking for it back because of their own mistake is a cancellation, not a demand
const _CANCEL=/\b(?:wrong\s+(?:address|wallet|network|amount|person|chain)|by\s+mistake|my\s+(?:bad|mistake)|oops|accident(?:ally)?|changed\s+my\s+mind|cancel(?:led|ling)?|mistook)\b/;
// What the client's message says: {kind: accuse|demand|missing|chase|worry|null, paid, resolved, help, proof, scam, demand}
function analyzeClientText(raw){
  const s=String(raw||""),q=(s.match(/\?/g)||[]).length;
  const t=_norm(s).replace(_CALM," ").replace(/\s+/g," ").replace(/^[\s,.;:!-]+/,"").trim();    // "no rush", "take your time", "don't worry" are calm, not signals
  const out={kind:null,paid:false,resolved:false,help:false,proof:false,scam:false,demand:false};
  if(!t&&!q)return out;
  const asks=q>0&&/^(?:are|r|is|am|isn'?t|aren'?t|do|does|can|could|should|would|will|what|how|why|who|where|when|which)\b/.test(t);
  const any=list=>list.some(re=>re.test(t));
  const cl=_clauses(t),all=cl.flat();
  const history=/\b(?:before|previously|in\s+the\s+past|last\s+(?:time|year|month|week)|years?\s+ago|months?\s+ago|used\s+to|once|twice)\b/.test(t)&&!/\b(?:you|u|ur|your|yours|him|her|this\s+(?:guy|dude|person|man|girl|exchanger))\b/.test(t);
  const soft=asks||history||_HYPO.test(t)||_CANCEL.test(t);     // a question, a "what if", something that happened before or a cancellation: wording that is only a demand or a threat is just a worry
  const keep=any(_C.keepHard),demWord=any(_C.demandHard)||any(_C.threatHard);
  const acc=any(_C.accuseHard)||(!asks&&(any(_C.accuseSoft)||cl.some(_meansAccuse)))||(keep&&!soft);
  const missing=any(_C.missing)||cl.some(c=>_meansMissing(c,all));
  const chase=any(_C.chase)||_C.shortAsk.test(t)||cl.some(_meansChase);
  if(acc&&!history)out.kind="accuse";
  else if(demWord&&!soft)out.kind="demand";
  else if(missing)out.kind="missing";
  else if(chase)out.kind="chase";
  else if(acc||demWord||keep||any(_C.worry)||/\bscamm?(?:ed|ers?|ing|s)?\b/.test(t))out.kind="worry";
  else if(q>=2||/^[\s?!.]*\?[\s?!.]*$/.test(s))out.kind="chase";
  if(out.kind&&out.kind!=="accuse"&&_C.settled.test(t)){out.kind=null;out.resolved=true;}   // "never mind, it just arrived"
  if(!asks&&any(_C.paid))out.paid=true;
  if(!out.kind&&!q&&!out.paid&&!out.resolved&&any(_C.resolved)&&!_hasNeg(t))out.resolved=true;
  if(!out.resolved){
    const d=analyzeDistress(s);
    out.help=d.help;out.proof=d.proof;
    out.scam=d.scam||out.kind==="accuse";
    out.demand=out.kind==="demand";
  }
  return out;
}

// What the exchanger's message says: {pts, why} when they steer the client away from the ticket
const _SAFE_HOSTS=/(?:^|\.)(?:discord\.com|discordapp\.com|discordapp\.net|discord\.media|tenor\.com|giphy\.com|imgur\.com|paypal\.com|paypal\.me|cash\.app|venmo\.com|zellepay\.com|blockchair\.com|blockchain\.com|blockchain\.info|etherscan\.io|bscscan\.com|polygonscan\.com|arbiscan\.io|solscan\.io|tronscan\.org|mempool\.space|blockcypher\.com|xrpscan\.com)$/;
const _APP_HOSTS=/(?:^|\.)(?:t\.me|telegram\.(?:me|org)|wa\.me|wa\.link|whatsapp\.com|signal\.me|snapchat\.com|instagram\.com|ig\.me|kik\.com|wickr\.com|skype\.com)$/;
const _STEER=[    // [pattern, points, what it means, tag, ignore-if]  -- every way of moving the client off the ticket is worth the same: 40
  [/\b(?:telegram|tele|tg|whats\s*app|wa|snap\s*chat|snapchat|instagram|insta|kik|wickr|viber|wechat|skype|facetime|imessage)\b|\b(?:my|on|add|via|use|through)\s+snap\b|\bsnap\s*(?:me|id|name|user)\b|\bon\s+signal\b|\bsignal\s+(?:app|me)\b/,40,"asked to move to another app"],
  [/(?<!\b(?:not|never|don'?t|dont|won'?t|wont)\s)\b(?:dm|pm|dms|pms|inbox)\s+me\b|\bhit\s+(?:me|my)\s+(?:up|dms?|inbox)\b|\bslide\s+(?:in|into)\b/,40,"asked to move to DMs"],
  [/\b(?:msg|message|text|contact|hmu|call|reach|find)\s+me\s+(?:privately|in\s+private|directly|off|outside|via|through|at|on\s+(?!here\b|the\b|this\b)\w+)/,40,"asked to move to DMs"],
  [/\b(?:in|to|via|through|on|over)\s+(?:the\s+)?(?:dms?|pms?|private(?:ly)?|direct\s+messages?)\b/,40,"asked to move to DMs"],
  [/\b(?:let'?s|lets|we\s+can|can\s+we|come|move|switch|go|talk|continue|chat|take\s+(?:this|it))\b[^.?!]{0,30}\b(?:dms?|pms?|privately|elsewhere|off\s+(?:the\s+)?(?:ticket|server|discord|platform))\b/,40,"asked to move to DMs"],
  [/\b(?:add|friend|follow)\s+me\b/,40,"asked to connect outside the ticket"],
  [/\b(?:outside|off|away\s+from)\s+(?:of\s+)?(?:the\s+|this\s+)?(?:ticket|server|discord|platform)\b|\b(?:go|move|switch|come|join|talk|chat|continue|take\s+(?:this|it)|get)\b[^.?!]{0,25}\b(?:another|other|different|separate|my)\s+(?:server|chat|group|platform)\b|\b(?:in|to|use|start|open|make|join|do|have|take)\s+(?:a\s+|the\s+|my\s+)?private\s+(?:chat|convo|conversation|group)\b|\b(?:private\s+(?:chat|convo|conversation|group)|(?:another|other|different|separate|my)\s+(?:server|chat|group|platform|app))\s+(?:is|would\s+be|will\s+be)\s+(?:better|easier|safer|best)\b/,40,"asked to deal outside the ticket"],
  [/\b(?:skip|no\s+need\s+for|don'?t\s+need|do\s+not\s+need|forget|ignore|avoid|bypass|not\s+(?:using|use|need))\s+(?:the\s+|a\s+|an\s+|any\s+)?(?:mm|middle\s*man|escrow)\b/,40,"pushed to skip the middleman","mm"],
  [/\b(?:mm|middle\s*man|escrow)\s+(?:(?:isn'?t|is\s+not|not|aint)\s+(?:needed|necessary|required)|(?:is\s+)?(?:unnecessary|pointless|a\s+waste))\b|\bno\s+(?:mm|middle\s*man|escrow)\s+(?:needed|necessary|required)\b/,40,"pushed to skip the middleman","mm"],
  [/\b(?:do|doing|go|going|proceed|proceeding|trade|trading|exchange|exchanging|send|sending|deal|dealing|work|working|swap|swapping)\b[^.?!]{0,25}\bwithout\s+(?:the\s+|a\s+|an\s+|any\s+)?(?:mm|middle\s*man|escrow)\b/,40,"pushed to skip the middleman","mm",/\b(?:won'?t|can'?t|cannot|never|not|don'?t|do\s+not|refuse|unless|only)\b/],
  [/\btrust\s+me\b(?:(?!\bi(?:'ll|ll|\s+will|\s+am|'m|m)\b)[^.?!]){0,25}\b(?:send|pay)\s+first\b/,40,"pressured the client to send first"]
];
// underLimit: the exchanger is within their go-first limit, so "no middleman needed" is simply true
function analyzeExchangerText(raw,{underLimit=false}={}){
  const s=String(raw||""),t=_norm(s);
  let best={pts:0,why:null};
  const take=(pts,why)=>{if(pts>best.pts)best={pts,why};};
  for(const [re,pts,why,tag,unless] of _STEER){
    if(tag==="mm"&&underLimit)continue;
    if(_live(t,re)&&!(unless&&unless.test(t)))take(pts,why);
  }
  String(s).replace(/https?:\/\/([^\s/<>)]+)([^\s<>)]*)/gi,(m,h,p)=>{
    const host=h.toLowerCase().replace(/:\d+$/,"");
    if(host==="discord.gg"||(/(?:^|\.)discord(?:app)?\.com$/.test(host)&&/^\/invite\b/i.test(p)))take(40,"shared a server invite");
    else if(_APP_HOSTS.test(host))take(40,"asked to move to another app");
    else if(!_SAFE_HOSTS.test(host))take(20,"shared an outside link");
    return m;
  });
  if(/(?:^|[\s(])(?:discord\.gg|dsc\.gg|discord(?:app)?\.com\/invite)\/[\w-]+/i.test(s))take(40,"shared a server invite");
  if(/(?:^|[\s(])(?:t\.me|telegram\.me|wa\.me)\/\S+/i.test(s))take(40,"asked to move to another app");
  return best;
}

// ---- What the exchanger DOES (this is the evidence a level is built on) ----
// A phrase that is negated in its own sentence is not a signal: "I won't ask for your password", "never dm me first", "telegram is not allowed".
const _NOT=/\b(?:not|never|no(?!\s+(?:problems?|worries|rush|issues?|prob|big\s+deal))|dont|wont|cant|cannot|without|beware|impersonat\w*|fake|scammers?|\w+n't)\b/;
const _AFTER_NOT=/^\s*(?:is\s+|are\s+|was\s+|will\s+be\s+)?(?:not|never|\w+n't|no\s+longer)\b/;
function _before(t,i){                                       // the part of the sentence in front of position i
  const head=t.slice(0,i),re=/[.,;!?]|\b(?:and|but|so|then|instead|because|since|while|also)\b/g;
  let cut=0,m;
  while((m=re.exec(head)))cut=m.index+m[0].length;
  return head.slice(cut);
}
function _live(t,re){                                        // does re match somewhere that is not negated?
  const g=new RegExp(re.source,re.flags.replace("g","")+"g");
  let m;
  while((m=g.exec(t))){
    if(!_NOT.test(_before(t,m.index))&&!_AFTER_NOT.test(t.slice(m.index+m[0].length)))return true;
    if(m[0].length===0)g.lastIndex++;
  }
  return false;
}
// asking for things nobody legitimate needs (a gift card CODE or an Interac security answer is normal, so those are not here)
const _SENS=[
  [/\b(?:seed|recovery|secret|backup)\s*(?:phrase|words?|key)\b|\bmnemonic\b|\bprivate\s*key\b|\b(?:12|24)\s*(?:words?|word\s+phrase)\b/,70,"asked for a seed phrase or private key"],
  [/\b(?:send|give|tell|share|show|provide|type|enter|gimme|need|want|what(?:'?s|\s+is)|whats)\b[^.?!]{0,30}\b(?:pass\s*word|passcode|passphrase|login\s+(?:details|info|credentials)|credentials|pin\s*(?:code|number)?)\b/,70,"asked for a password or PIN"],
  [/\b(?:send|give|tell|share|show|provide|type|enter|gimme|need|want|read(?:\s+out)?|what(?:'?s|\s+is)|whats)\b[^.?!]{0,30}\b(?:otp|2fa|two\s*factor|one\s*time\s*(?:code|pass\w*|pin)|(?:verification|security|sms|text|login|auth\w*|confirmation|6\s*digit)\s+code)\b/,70,"asked for a verification (2FA) code"],
  [/\b(?:anydesk|any\s+desk|teamviewer|team\s+viewer|ultraviewer|rustdesk|supremo|remote\s+(?:access|control|desktop|session|support)|quick\s*support)\b/,70,"asked for remote access to the client's device"],
  [/\b(?:send|give|share|show|provide|need|want|what(?:'?s|\s+is)|whats)\b[^.?!]{0,30}\b(?:(?<!gift\s)card\s+number|cvv|cvc|expir\w+\s+date|ssn|social\s+(?:security|insurance)|sin\s+number|passport|driver'?s?\s+licen[sc]e|government\s+id|gov\s+id|photo\s+id|id\s+card|selfie)\b/,50,"asked for ID or card details"],
  [/\b(?:photo|picture|pic|copy|scan|image|snap)\s+of\s+(?:your\s+|ur\s+|the\s+|a\s+)?(?:id|identification|licen[sc]e|passport|credit\s+card|debit\s+card|bank\s+card)\b/,50,"asked for ID or card details"],
  [/\b(?:screen\s*share|share\s+(?:your\s+)?screen|screenshare)\b/,40,"asked the client to share their screen"]
];
// undermining the safety net
const _DISC=[
  [/\b(?:ignore|disregard|skip|dont\s+(?:listen\s+to|read|mind|trust|believe|follow|worry\s+about)|don't\s+(?:listen\s+to|read|mind|trust|believe|follow|worry\s+about)|never\s*mind)\s+(?:the\s+|that\s+|this\s+|those\s+|these\s+|any\s+|all\s+)?(?:bot|warnings?|safety\s+(?:check|message|notice)|notices?|staff|mods?|moderators?|admins?|owners?|support|embed)\b/,40,"told the client to ignore the bot or staff"],
  [/\b(?:the\s+)?(?:bot|staff|mods?|owners?|admins?)\s+(?:is|are|just|always)\s+(?:fake|broken|wrong|lying|useless|glitch\w*|bugged|trolling)\b/,40,"told the client not to trust the bot or staff"],
  [/\b(?:don't|do\s+not|dont|never|stop|no\s+need\s+to|please\s+don't|pls\s+don't|plz\s+dont)\s+(?:press|click|hit|use|touch)\s+(?:the\s+|that\s+|this\s+)?(?:flag|report|red)\b/,40,"told the client not to flag the ticket"],
  [/\b(?:don't|do\s+not|dont|never|stop|no\s+need\s+to|please\s+don't|pls\s+don't|plz\s+dont)\s+(?:flag|report)\s+(?:me|this|it|the\s+ticket)\b/,40,"told the client not to flag the ticket"],
  [/\b(?:don't|do\s+not|dont|never|stop|no\s+need\s+to|please\s+don't|pls\s+don't|plz\s+dont)\s+(?:call|ping|tag|tell|contact|involve|bother|notify|get)\s+(?:the\s+|any\s+|our\s+)?(?:staff|mods?|moderators?|admins?|owners?|support|anyone|anybody)\b/,40,"told the client not to involve staff"],
  [/\b(?:between\s+(?:us|you\s+and\s+me)|our\s+little\s+secret|keep\s+(?:this|it)\s+(?:quiet|secret|private))\b/,40,"asked the client to keep it quiet"]
];
// pushing the client to confirm, close or vouch (only counts while the client has said nothing arrived)
const _PRESS_C=[
  /\b(?:confirm|confirming)\b[^.?!]{0,25}\b(?:now|first|already|asap|quick|quickly|fast|right\s+away|immediately|before|so\s+(?:i|we|that)|pls|please|plz)\b/,
  /\b(?:press|click|hit|tap)\s+(?:on\s+)?(?:the\s+)?(?:confirm|complete|completion|done|green\s+button)\b/,
  /\b(?:vouch|review|rate)\s+(?:me|us)\b|\b(?:leave|give|drop|write)\s+(?:me\s+)?(?:a\s+)?(?:vouch|review|rating)\b/,
  /\b(?:close|finish|end|complete)\s+(?:the\s+|this\s+)?(?:ticket|trade|order|exchange|deal)\b[^.?!]{0,20}\b(?:now|already|first|asap|so|pls|please)\b/,
  /\bmark\s+(?:it|this|the\s+(?:trade|order|exchange|deal))\s+(?:as\s+)?(?:done|complete|completed|received)\b/
];
// "pay a fee first to release it" (a fee to cover being SHORT is normal, so that is excluded)
const _ADV=[
  /\b(?:send|pay|deposit|transfer|add|top\s*up|need)\b[^.?!]{0,30}\b(?:extra|more|another|additional)\b[^.?!]{0,20}\b(?:fee|fees|tax|taxes|deposit|gas|charge|verification|insurance|activation|unlock|release)\b/,
  /\b(?:fee|fees|tax|taxes|deposit|insurance|activation|verification|unlock\w*|clearance)\b[^.?!]{0,20}\b(?:to|before|so\s+(?:i|we|it)|in\s+order\s+to)\b[^.?!]{0,20}\b(?:release|unlock|verify|activate|clear|withdraw)\b/,
  /\b(?:pay|send)\b[^.?!]{0,15}\b(?:a\s+)?(?:fee|tax|deposit|insurance)\s+(?:first|before|up\s*front|to\s+(?:verify|unlock|release|activate))\b/
];
const _ADV_OK=/\b(?:short|underpaid|under\s*paid|less\s+than|remaining|difference|balance|missing|owe|owed|rest|left\s+over)\b/;
// refusing to show proof
const _REF=[
  /\b(?:won't|will\s+not|wont|not\s+going\s+to|not\s+gonna|refuse\s+to|can't|cant|cannot|don't\s+(?:need|have)\s+to|dont\s+(?:need|have)\s+to|no\s+need\s+to)\s+(?:send|show|give|share|provide|post|prove|record)\b[^.?!]{0,25}\b(?:proof|screenshots?|ss|txid|tx\s*id|hash|receipt|evidence|confirmation|video|screen\s*record\w*)\b/,
  /\bno\s+need\s+for\s+(?:any\s+)?(?:proof|screenshots?|txid|a\s+hash|receipts?)\b/,
  /\bstop\s+asking\s+(?:me\s+)?(?:for\s+)?(?:proof|screenshots?|a\s+screenshot|txid|a\s+hash|evidence)\b/,
  /\b(?:proof|screenshots?|hash|txid|receipt)\s+(?:isn't|is\s+not|not)\s+(?:needed|necessary|required)\b/,
  /\bnot\s+(?:giving|showing|sending|sharing)\s+(?:you\s+)?(?:any\s+)?(?:proof|screenshots?|txid|hash|receipt)\b/
];
// the excuses of someone buying time (weak: an honest delay sounds the same, so these never count on their own)
const _STALL=/\b(?:one\s+(?:sec|second|moment|min|minute)|just\s+a\s+(?:sec|second|moment|min|minute)|give\s+me\s+(?:a\s+|an\s+)?(?:\d+\s*)?(?:sec|secs|seconds?|moments?|mins?|minutes?|hour)|hold\s+on|hang\s+on|still\s+processing|processing|pending|bank\s+(?:is\s+)?(?:slow|delayed?|down|issues?|problems?|glitch\w*)|network\s+(?:is\s+)?(?:congested|busy|slow|delayed?|down)|congest\w+|any\s+(?:second|minute|moment)\s+now|should\s+(?:be\s+)?(?:arrive|arriving|land|landing|hit|there|with\s+you)\b|coming\s+(?:soon|shortly)|on\s+(?:the|its)\s+way|will\s+(?:arrive|land|hit|be\s+there)\s+(?:soon|shortly)|be\s+there\s+(?:soon|shortly))\b/;
// wallet addresses: the family of an address, and whether the exchanger posted one that is not theirs
const _AF=[["evm",/^0x[a-fA-F0-9]{40}$/],["btc",/^(?:bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/],["ltc",/^(?:ltc1[a-z0-9]{25,62}|[LM][a-km-zA-HJ-NP-Z1-9]{25,34})$/],["trx",/^T[1-9A-HJ-NP-Za-km-z]{33}$/],["sol",/^[1-9A-HJ-NP-Za-km-z]{32,44}$/]];
function addrFamily(a){for(const [f,re] of _AF)if(re.test(a))return f;return null;}
function addrsIn(s){
  const out=[];
  for(const w of String(s||"").replace(/https?:\/\/\S+/gi," ").split(/[^A-Za-z0-9]+/)){
    if(w.length<26)continue;
    const f=addrFamily(w);
    if(f)out.push({addr:w,fam:f});
  }
  return out;
}
const _ADDR_TALK=/\b(?:your|ur)\s+(?:address|wallet|addr)\b|\btx\s*id\b|\btxid\b|\bhash\b|\bexplorer\b|\bsent\b|\bsending\b/i;
// true when the message holds a wallet address of a kind the exchanger has saved, but not one of theirs, and it is not the client's own
function foreignAddress(raw,saved,clientAddrs){
  const mine=(saved||[]).map(String).filter(Boolean);
  if(!mine.length||_ADDR_TALK.test(String(raw||"")))return false;
  const have=new Set(mine.map(a=>a.toLowerCase())),fams=new Set(mine.map(addrFamily).filter(Boolean));
  for(const {addr,fam} of addrsIn(raw)){
    const k=addr.toLowerCase();
    if(fams.has(fam)&&!have.has(k)&&!(clientAddrs&&clientAddrs.has(k)))return true;
  }
  return false;
}
function exchangerSavedWallets(exId){
  try{return Object.values((state.exchangerWallets||{})[exId]||{}).filter(Boolean).map(String);}catch{return [];}
}
// Everything one exchanger message says about the exchanger: [{kind, pts, why}]
//   ctx: {underLimit, clientMissing (the client said nothing arrived), saved (their saved wallets), clientAddrs (addresses the client posted)}
function analyzeConduct(raw,ctx={}){
  const s=String(raw||""),t=_norm(s),out=[];
  const st=analyzeExchangerText(s,{underLimit:!!ctx.underLimit});
  if(st.pts)out.push({kind:"steer",pts:st.pts,why:st.why});
  const best=(kind,list)=>{
    let b=null;
    for(const [re,pts,why] of list)if((!b||pts>b.pts)&&_live(t,re))b={kind,pts,why};
    if(b)out.push(b);
  };
  best("sensitive",_SENS);
  best("discredit",_DISC);
  if(_ADV.some(re=>_live(t,re))&&!_ADV_OK.test(t))out.push({kind:"advance",pts:35,why:"asked for an extra fee before releasing the funds"});
  if(_REF.some(re=>_live(t,re)))out.push({kind:"refuse",pts:30,why:"refused to show proof"});
  if(foreignAddress(s,ctx.saved,ctx.clientAddrs))out.push({kind:"addr",pts:25,why:"posted a wallet address that isn't one of their saved ones"});
  if(ctx.clientMissing){
    if(_PRESS_C.some(re=>_live(t,re)))out.push({kind:"pressure",pts:40,why:"pushed the client to confirm or vouch while they said nothing had arrived"});
    else if(_STALL.test(t)&&!out.length)out.push({kind:"stall",pts:4,why:"gave another delay excuse while the client said nothing had arrived"});
  }
  return out;
}

// ---- 2. Scoring ----
function riskScore(by){
  let s=0;
  for(const [k,v] of Object.entries(by||{}))s+=Math.min(SAFETY.caps[k]||0,v||0);
  return Math.min(100,s);
}
// What the exchanger did, as points: everything in SAFETY.conduct (silence included), and the part of it that is a deed (silence and excuses are not)
const conductScore=by=>SAFETY.conduct.reduce((n,k)=>n+Math.min(SAFETY.caps[k]||0,(by&&by[k])||0),0);
const deedScore=by=>conductScore(by)-Math.min(SAFETY.caps.ignored,(by&&by.ignored)||0)-Math.min(SAFETY.caps.stall,(by&&by.stall)||0);
// Real evidence = the client accuses the exchanger, or the exchanger's own conduct adds up to something (a stray outside link or an excuse does not).
// Without it a ticket never gets a level, however impatient the client is; with it, the other signs add weight.
function hasRealEvidence(by){return !!by&&((by.accuse||0)>0||conductScore(by)>=SAFETY.realConduct);}
function riskLevelFor(score,adj=0){
  const L=SAFETY.levels;
  if(score>=L.critical+adj)return "critical";
  if(score>=L.caution+adj)return "caution";
  if(score>=L.watch+adj)return "watch";
  return null;
}
// Veterans get the benefit of the doubt: an exchanger with many completed trades has a record
function exchangerTrusted(exId){
  if(!exId)return false;
  const tk=Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets");
  let n=0;
  for(const o of Object.values(tk||{})){
    if(o&&o.status==="vouched"&&o.completedBy===exId&&++n>=SAFETY.trustedAfter)return true;
  }
  return false;
}
// How far the bar moves for this ticket: up after an owner cleared it or for a veteran, down for an exchanger already on hold in another ticket
function riskAdj(t,cid){
  const h=_mem.holds&&_mem.holds[t.claimedBy];
  const heldElsewhere=!!(h&&isOnHold(t.claimedBy)&&h.channelId!==cid);
  return (t.riskCleared?SAFETY.clearedBonus:0)+(exchangerTrusted(t.claimedBy)?SAFETY.trustedBonus:0)-(heldElsewhere?SAFETY.heldBonus:0);
}
// The level a ticket's marks add up to right now. What the client says can only ever make a watch; caution needs the exchanger's own
// conduct to back it up, and critical needs a real deed (not just silence), so impatient or angry clients cannot get an honest exchanger frozen.
function riskLevelOf(t,cid){
  const by=t.riskByKind;
  if(!by)return null;
  let lvl=riskLevelFor(riskScore(by),riskAdj(t,cid));
  if(!lvl)return null;
  if(lvl==="critical"&&deedScore(by)<SAFETY.criticalConduct)lvl="caution";
  if(lvl==="caution"&&conductScore(by)<SAFETY.cautionConduct)lvl="watch";
  return lvl==="watch"&&!hasRealEvidence(by)?null:lvl;
}
// Levels only ever rise here; returns the new level when it just went up, else null.
function raiseRisk(t,cid){
  const lvl=riskLevelOf(t,cid);
  if(lvl&&SAFETY.rank[lvl]>(SAFETY.rank[t.riskLevel]||0)){t.riskLevel=lvl;return lvl;}
  return null;
}
// Adds a signal (or, with opts.set, raises a measured one to this value). opts.replace drops an older note of the same kind;
// opts.paused (an owner is in the ticket) keeps the marks but lets nothing escalate yet.
function addRisk(t,cid,kind,pts,note,opts={}){
  if(!t.riskByKind)t.riskByKind={};
  const cur=t.riskByKind[kind]||0;
  t.riskByKind[kind]=Math.min(SAFETY.caps[kind]||0,opts.set?Math.max(cur,pts):cur+pts);
  t.riskScore=riskScore(t.riskByKind);
  if(note){
    if(!t.riskNotes)t.riskNotes=[];
    if(opts.replace)t.riskNotes=t.riskNotes.filter(n=>!opts.replace.test(n));
    t.riskNotes.push(String(note).slice(0,SAFETY.noteMax));
    if(t.riskNotes.length>8)t.riskNotes.splice(0,t.riskNotes.length-8);
  }
  return opts.paused?null:raiseRisk(t,cid);
}
function clearTicketRisk(t,{byOwner=true}={}){
  delete t.riskByKind;delete t.riskScore;delete t.riskLevel;delete t.riskNotes;delete t.alertedRank;
  if(byOwner)t.riskCleared=true;
}
// Everything safety-related that belongs to one exchanger's claim (used when a ticket goes back to the queue)
function resetSafetyFields(t){
  clearTicketRisk(t,{byOwner:false});
  delete t.riskCleared;delete t.safetyNoticeAt;delete t.siblingsNotified;delete t.clientHeld;
  delete t.checkinPlan;delete t.checkinRolls;
}

// ---- 3. Holds: a flagged exchanger can't take new tickets until an owner has looked ----
function isOnHold(userId){
  const h=_mem.holds&&_mem.holds[userId];
  return !!h&&(!h.expiresAt||h.expiresAt>Date.now());
}
function placeHold(guild,cid,t,level){
  const ex=t.claimedBy;
  if(!ex||isOwner(ex))return false;
  if(!_mem.holds)_mem.holds={};
  const prev=_mem.holds[ex],now=Date.now();
  if(prev&&SAFETY.rank[prev.level]>=SAFETY.rank[level]){   // already at least this serious: just keep it alive
    if(prev.expiresAt)prev.expiresAt=Math.max(prev.expiresAt,now+SAFETY.holdMs);
  }else{
    _mem.holds[ex]={level,score:t.riskScore||0,channelId:cid,clientId:t.userId,amountUSD:parseFloat(t.amountUSD)||0,guildId:guild&&guild.id||null,
      reason:(t.riskNotes||[]).slice(-3).join(" \u00B7 ").slice(0,300),at:now,expiresAt:level==="critical"?null:now+SAFETY.holdMs};
  }
  save("holds",_mem.holds);
  return true;
}
// Used by /clearexchanger, $clear, /reinstate and the Clear button: lifts the freeze and the hold, wipes the risk marks and
// anything still waiting to be counted, cancels quick check-ins that only existed because of the doubt, and tells clients
// who were asked to hold off that the review is over
async function liftRestrictions(guild,exId){
  const out={suspended:isSuspended(exId),held:!!(_mem.holds&&_mem.holds[exId]),restored:0,cleared:0,pending:0,checkins:0,notified:0};
  if(out.suspended){delete _mem.suspensions[exId];save("suspensions",_mem.suspensions);}
  if(out.held){delete _mem.holds[exId];save("holds",_mem.holds);}
  const tk=Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets");
  const panels=[],told=[];let dirty=false;
  for(const [cid,t] of Object.entries(tk)){
    if(!t||t.status!=="open")continue;
    if(t.reported&&t.reportedExchanger===exId){delete t.reported;panels.push(cid);dirty=true;}
    if(t.claimedBy!==exId)continue;
    const S=_safety.get(cid);                                    // worries still waiting to be counted, and the waiting timers
    if(S){out.pending+=S.pending.length;_safety.delete(cid);}
    if(t.riskLevel||t.riskScore){clearTicketRisk(t);out.cleared++;dirty=true;}
    if(t.checkinPlan==="forced"&&!t.checkinSentAt){delete t.checkinAt;delete t.checkinPlan;out.checkins++;dirty=true;}   // a quick check-in that only existed because of the doubt
    if(t.safetyNoticeAt||t.siblingsNotified){delete t.safetyNoticeAt;delete t.siblingsNotified;dirty=true;}
    if(t.clientHeld){delete t.clientHeld;told.push(cid);dirty=true;}
  }
  if(dirty){_mem.tickets=tk;save("tickets",tk);}
  if(out.suspended)out.restored=await unlockExchangerEverywhere(guild,exId);
  for(const cid of panels){const c=guild.channels.cache.get(cid);if(c)await refreshPanel(c,tk[cid]);}
  for(const cid of told){                                        // the client was told to hold off, so tell them it is over
    const c=guild.channels.cache.get(cid),t=tk[cid];
    if(!c||!t)continue;
    const sent=await c.send({content:`<@${t.userId}>`,allowedMentions:{users:[t.userId]},embeds:[reviewDoneEmbed(t)]}).then(()=>true).catch(()=>false);
    if(sent)out.notified++;
  }
  return out;
}
// What a clear did, in one line (used by /clearexchanger and $clear)
function clearSummary(exId,r){
  const n=(k,w)=>`${k} ${w}${k===1?"":"s"}`;
  const parts=[];
  if(r.suspended)parts.push("freeze lifted");
  if(r.held)parts.push("hold removed");
  if(r.cleared)parts.push(`${n(r.cleared,"ticket")} reset`);
  if(r.pending)parts.push(`${n(r.pending,"pending signal")} dropped`);
  if(r.checkins)parts.push(`${n(r.checkins,"early check-in")} cancelled`);
  if(r.notified)parts.push(`${n(r.notified,"client")} told the review is done`);
  return parts.length?`Cleared <@${exId}> of all doubt: ${parts.join(" · ")}.`:`Nothing to clear on <@${exId}>.`;
}

// ---- 4. Quick check-ins on the OTHER clients of an exchanger the system really suspects (never routine, never random) ----
// Asks this ticket's client within 1-3 minutes (used when the exchanger reaches caution in another ticket)
function forceCheckin(o,rnd=Math.random){
  if(o.checkinSentAt||o.mmPending||o.reported||o.ownerClaim)return false;
  const when=Date.now()+60*1000+Math.floor(rnd()*120*1000);
  if(!o.checkinAt||o.checkinAt>when)o.checkinAt=when;
  o.checkinPlan="forced";
  return true;
}
function boostOtherTickets(guild,cid,t){
  let n=0;
  for(const [ocid,o] of Object.entries(_mem.tickets||{})){
    if(ocid===cid||!o||o.status!=="open"||o.claimedBy!==t.claimedBy||o.ownerClaim)continue;
    if(guild&&!guild.channels.cache.has(ocid))continue;
    if(forceCheckin(o))n++;
  }
  return n;
}

// ---- 5. What the client and owners see ----
// Only ever said when the system really suspects a scam (it is part of the Safety Check), never on a timer
const IMPERSONATOR_NOTICE="**@3uce will NOT DM you first. @jswaps will NOT DM you first.** If you received a random DM from anyone claiming to be Konvert staff or an owner \u2014 it is an impersonator. Block and report them immediately. All communication happens inside this ticket only.";
function safetyCheckEmbed(t){
  return kEmbed("Safety","warn").setTitle(`Safety Check`)
    .setDescription(`<@${t.userId}>, a quick safety review has started on this ticket and an owner has been notified.\nAs a precaution, **please hold off on sending any further funds** until they confirm.\n\n${IMPERSONATOR_NOTICE}`)
    .setFooter(kFoot("Automatic check  ·  Nothing is needed from you right now")).setTimestamp();
}
function reviewDoneEmbed(t){
  return kEmbed("Safety","ok").setTitle(`Safety Review Complete`)
    .setDescription(`An owner has finished the review. <@${t.claimedBy}> is cleared to continue and you can carry on with your exchange.`).setTimestamp();
}
// Clear (and, when frozen, reinstate) · Freeze · and a link straight to the ticket when there is one
function riskAlertRow(exId,cid,{frozen=false,link=null}={}){
  const row=new ActionRowBuilder().addComponents(
    kBtn(`btn_riskclear__${exId}`,frozen?"Clear & Reinstate":"Clear",ButtonStyle.Success));
  if(!frozen)row.addComponents(kBtn(`btn_riskfreeze__${cid}`,"Freeze Exchanger",ButtonStyle.Danger));
  if(link)row.addComponents(kLink("Open Ticket",link));
  return row;
}
async function postSafetyCheck(ch,t){
  if(t.safetyNoticeAt)return;
  t.safetyNoticeAt=Date.now();                  // claimed first so two signals at once can't post it twice
  const sent=await ch.send({content:`<@${t.userId}>`,embeds:[safetyCheckEmbed(t)],allowedMentions:{users:[t.userId]}}).catch(()=>null);
  if(!sent)delete t.safetyNoticeAt;             // couldn't post it: try again next time
  else t.clientHeld=true;                       // the client was told to hold off, so they hear when it is over
  save("tickets",_mem.tickets);
}
// The marks on a ticket, sorted into what the exchanger did and what the client said (for the owners' alert)
function evidenceGroups(t){
  const did=[],said=[],other=[];
  for(const n of (t.riskNotes||[])){
    if(/^Exchanger\s/.test(n)){const x=n.replace(/^Exchanger\s+/,"");did.push(x.charAt(0).toUpperCase()+x.slice(1));}
    else if(/^Client:/.test(n))said.push(n.replace(/^Client:\s*/,""));
    else other.push(n);
  }
  const uniq=a=>[...new Set(a)];
  return {did:uniq(did).slice(-5),said:uniq(said).slice(-4),other:uniq(other).slice(-2)};
}
async function alertOwners(guild,ch,t,level){
  const rank=SAFETY.rank[level];
  if((t.alertedRank||0)>=rank)return;          // one alert per ticket per level
  t.alertedRank=rank;save("tickets",_mem.tickets);
  const link=`https://discord.com/channels/${guild.id}/${ch.id}`,g=evidenceGroups(t);
  const others=Object.entries(_mem.tickets||{}).filter(([ocid,o])=>ocid!==ch.id&&o&&o.status==="open"&&o.claimedBy===t.claimedBy&&!o.ownerClaim).length;
  const lines=a=>a.map(x=>`• ${x}`).join("\n").slice(0,1000);
  const embed=kEmbed("Safety","warn").setTitle(`Safety Alert`)
    .setDescription(`${kHero(dealOf(t).hero)}\n<@${t.userId}> with <@${t.claimedBy}>`)
    .addFields({name:"Risk",value:`**${level.charAt(0).toUpperCase()+level.slice(1)}**  ·  ${t.riskScore||0}/100`,inline:true},
              {name:"Already done",value:`New claims paused${others?`\n${others} other client${others===1?"":"s"} will be checked on`:""}`,inline:true});
  if(g.did.length)embed.addFields({name:`What the exchanger did`,value:lines(g.did)});
  if(g.said.length)embed.addFields({name:`What the client said`,value:lines(g.said)});
  if(!g.did.length&&!g.said.length)embed.addFields({name:`What was seen`,value:lines(g.other.length?g.other:["Several warning signs"])});
  embed.setFooter(kFoot("Clear if it looks fine  ·  Freeze to stop the exchanger now")).setTimestamp();
  const row=riskAlertRow(t.claimedBy,ch.id,{link});
  for(const oid of CONFIG.OWNER_IDS)client.users.fetch(oid).then(u=>u.send({embeds:[embed],components:[row]})).catch(()=>{});
}
// When an exchanger is frozen, their other clients hear about it calmly
async function noticeOtherClients(guild,cid,t){
  if(t.siblingsNotified)return 0;
  t.siblingsNotified=true;save("tickets",_mem.tickets);
  let n=0;
  for(const [ocid,o] of Object.entries(_mem.tickets||{})){
    if(ocid===cid||!o||o.status!=="open"||o.claimedBy!==t.claimedBy||o.ownerClaim)continue;
    const och=guild.channels.cache.get(ocid);
    if(!och)continue;
    await och.send({content:`<@${o.userId}>`,allowedMentions:{users:[o.userId]},embeds:[kEmbed("Safety","warn").setTitle(`Exchanger Unavailable`)
      .setDescription(`<@${o.claimedBy}> is temporarily unavailable while an owner completes a review. An owner will follow up in this ticket shortly.\nPlease hold off on sending anything until then.`).setTimestamp()]}).then(()=>{n++;o.clientHeld=true;}).catch(()=>{});
  }
  if(n)save("tickets",_mem.tickets);
  return n;
}

// ---- 6. Acting on a signal ----
async function escalate(guild,ch,t,level){
  const cid=ch.id,why=(t.riskNotes||[]).slice(-3).join(" \u00B7 ").replace(/`/g,"'");
  log(guild,`SAFETY ${level.toUpperCase()}: #${ch.name} | exchanger ${t.claimedBy} | client ${t.userId} | score ${t.riskScore} | ${why.slice(0,200)}`);
  if(level==="watch")return;
  placeHold(guild,cid,t,level);
  boostOtherTickets(guild,cid,t);
  save("tickets",_mem.tickets);
  if(level==="caution"){
    await postSafetyCheck(ch,t);
    await alertOwners(guild,ch,t,level);
    return;
  }
  if(!t.reported){   // critical: the same outcome as a client flag, started by the system
    await reportTicket({guild,channel:ch},t,_mem.tickets,`Automatic safety check: ${why||"several warning signs"}`,{source:"system"});
    await noticeOtherClients(guild,cid,t);
  }
}
const ownerActive=cid=>{const S=_safety.get(cid);return !!(S&&S.ownerAt&&Date.now()-S.ownerAt<SAFETY.ownerPauseMs);};   // an owner spoke in the ticket a moment ago
async function riskEvent(guild,ch,t,kind,pts,note,opts={}){
  const before=(t.riskByKind&&t.riskByKind[kind])||0;
  const level=addRisk(t,ch.id,kind,pts,note,{...opts,paused:ownerActive(ch.id)});
  const shown=opts.set?((t.riskByKind&&t.riskByKind[kind])||0)-before:pts;
  save("tickets",_mem.tickets);
  // quiet until it is time to act: nothing is ever said in the ticket here. Impatience and worry are only counted; once there is real
  // evidence (an accusation or conduct) the signals are written to the log channel too. A new level has its own, fuller log line.
  if(level)await escalate(guild,ch,t,level);
  else if(hasRealEvidence(t.riskByKind))log(guild,`SAFETY signal: #${ch.name} | exchanger ${t.claimedBy} | client ${t.userId} | ${kind} +${shown} | score ${t.riskScore||0}/100 | ${String(note||"").replace(/`/g,"'").slice(0,SAFETY.noteMax)}`);
}
// A level that was held back (an owner was in the ticket) is acted on once the owner has been quiet for a while
async function recheckRisk(guild,ch,t){
  if(!t.riskByKind||ownerActive(ch.id))return;
  const level=raiseRisk(t,ch.id);
  if(level){save("tickets",_mem.tickets);await escalate(guild,ch,t,level);}
}
// The client says it arrived: what they said and the waiting both clear themselves, so an honest exchanger is never left marked.
// Only the exchanger's own conduct (steering, sensitive requests, pressure, ...) stays, and that needs an owner.
async function easeRisk(guild,ch,t){
  const by=t.riskByKind,EASE=["accuse","demand","missing","chase","worry","ignored","stall","silent"];
  if(!by||!EASE.some(k=>by[k]))return;
  for(const k of EASE)by[k]=0;
  t.riskScore=riskScore(by);
  if(!t.riskNotes)t.riskNotes=[];
  t.riskNotes.push("Client confirmed it arrived");
  if(t.riskNotes.length>8)t.riskNotes.splice(0,t.riskNotes.length-8);
  if(!hasRealEvidence(by)){
    if(t.riskLevel==="watch")t.riskLevel=null;
    if(t.riskLevel==="caution"){
      t.riskLevel=null;delete t.alertedRank;delete t.clientHeld;       // if it flares up again, the owners hear about it again
      const ex=t.claimedBy,h=_mem.holds&&_mem.holds[ex];
      if(h&&h.level==="caution"&&h.channelId===ch.id){
        const other=Object.entries(_mem.tickets||{}).find(([ocid,o])=>ocid!==ch.id&&o&&o.status==="open"&&o.claimedBy===ex&&(SAFETY.rank[o.riskLevel]||0)>=SAFETY.rank.caution);
        if(other){h.channelId=other[0];}                       // another ticket still justifies it
        else{delete _mem.holds[ex];log(guild,`SAFETY EASED: #${ch.name} | client confirmed | hold on ${ex} lifted`);}
        save("holds",_mem.holds);
      }
    }
  }
  save("tickets",_mem.tickets);
}

// ---- 7. Watching a ticket ----
function safetyApplies(t){
  return !!(SAFETY.enabled&&t&&t.status==="open"&&t.claimSystem&&t.claimedBy&&!t.mmPending&&!t.reported&&!t.ownerClaim
    &&!isSuspended(t.claimedBy)&&!isOwner(t.claimedBy)&&!isOwner(t.userId));
}
function safetyState(cid){
  let S=_safety.get(cid);
  if(!S){
    S={pending:[],hist:[],waitingSince:0,lastExAt:0,    // worries waiting to be counted · when the client started waiting for an answer
       factors:new Set(),burst:[],nudges:0,              // what the client has shown since the last answer: paid / spam / missing / help / proof / scam
       missingSince:0,ownerAt:0,stallAt:[],clientAddrs:new Set()};
    _safety.set(cid,S);
  }
  return S;
}
// How much the exchanger's silence counts for, given how long it has lasted and how many signs of distress the client has shown.
// No sign of distress, no points: people step away. One sign counts after 10 minutes, two after 6, three or more after 4,
// then it grows with every further stretch of the same length, and with each extra sign.
function ignoredValue(S,now){
  const n=S.factors.size;
  if(!S.waitingSince||!n)return 0;
  const thr=SAFETY.ignoreMs[Math.min(n,SAFETY.ignoreMs.length)-1],waited=now-S.waitingSince;
  if(waited<thr)return 0;
  return Math.min(SAFETY.caps.ignored,10*Math.floor(waited/thr)+10*(n-1));
}
const _FACTOR_TXT={paid:"had paid",missing:"said nothing arrived",scam:"mentioned a scam",demand:"asked for a refund",proof:"asked for proof",help:"asked for help",spam:"kept messaging"};     // most telling first
function ignoredNote(S,waited){
  const head=`Exchanger didn't reply for ${Math.round(waited/60000)} min while the client `;
  const all=Object.keys(_FACTOR_TXT).filter(k=>S.factors.has(k)).map(k=>_FACTOR_TXT[k]);
  let body="",used=0;
  for(const w of all){                      // whole reasons only; if they do not all fit, say how many were left out
    const next=body?`${body}, ${w}`:w;
    if(used&&(head+next).length>SAFETY.noteMax-6)break;
    body=next;used++;
  }
  return head+body+(used<all.length?` (+${all.length-used})`:"");
}
// Called for every message in an open ticket
async function safetyOnMessage(message,ticket){
  if(!safetyApplies(ticket))return;
  const text=String(message.content||"");
  if(!text.trim()||/^[$/!]/.test(text.trim()))return;
  const ch=message.channel,guild=message.guild,uid=message.author.id,now=Date.now();
  const fromClient=uid===ticket.userId,fromEx=uid===ticket.claimedBy;
  const fromOwner=!fromClient&&!fromEx&&isOwner(uid,message.member);
  const fromHelper=!fromClient&&!fromEx&&!fromOwner&&!!(ticket.hoppedIn&&ticket.hoppedIn[uid]);   // an exchanger who hopped in
  if(!fromClient&&!fromEx&&!fromOwner&&!fromHelper)return;
  const S=safetyState(ch.id);
  if(fromEx||fromOwner||fromHelper){      // answered: whatever the client was waiting on has been addressed
    S.lastExAt=now;S.waitingSince=0;S.factors.clear();S.burst=[];S.nudges=0;
    S.pending=S.pending.filter(p=>p.sticky);
    if(fromOwner)S.ownerAt=now;           // an owner is looking: nothing escalates for a while
  }
  if(fromEx){
    const lim=Number(ticket.claimLimit&&ticket.claimLimit.amount)||0;
    const found=analyzeConduct(text,{
      underLimit:!ticket.mmRequired&&lim>0&&(parseFloat(ticket.amountUSD)||0)<=lim,
      clientMissing:!!S.missingSince&&now-S.missingSince<SAFETY.missingMs,
      saved:exchangerSavedWallets(ticket.claimedBy),clientAddrs:S.clientAddrs});
    for(const f of found){
      if(f.kind==="stall"){                  // the first excuses are given the benefit of the doubt; excuses spread over time are not a pattern
        S.stallAt=S.stallAt.filter(ts=>now-ts<SAFETY.repeatMs);S.stallAt.push(now);
        if(S.stallAt.length<=SAFETY.stallFree)continue;
      }
      await riskEvent(guild,ch,ticket,f.kind,f.pts,`Exchanger ${f.why}`);
      if(!safetyApplies(ticket))break;     // the first one may have just paused the ticket
    }
    return;
  }
  if(!fromClient)return;
  for(const a of addrsIn(text)){S.clientAddrs.add(a.addr.toLowerCase());if(S.clientAddrs.size>12)S.clientAddrs.delete(S.clientAddrs.values().next().value);}
  const a=analyzeClientText(text);
  if(a.resolved){
    S.pending=[];S.waitingSince=0;S.factors.clear();S.burst=[];S.nudges=0;S.missingSince=0;S.stallAt=[];
    await easeRisk(guild,ch,ticket);
    return;
  }
  // what the client has shown since the last answer
  S.burst.push(now);S.burst=S.burst.filter(ts=>now-ts<=SAFETY.spamMs);
  if(a.paid)S.factors.add("paid");
  if(a.help)S.factors.add("help");
  if(a.proof)S.factors.add("proof");
  if(a.scam)S.factors.add("scam");
  if(a.demand)S.factors.add("demand");
  if(a.kind==="missing"){S.factors.add("missing");S.missingSince=now;}
  if(a.kind==="missing"||a.kind==="chase")S.nudges++;
  if(S.burst.length>=SAFETY.spamCount||S.nudges>=SAFETY.nudgeSpam)S.factors.add("spam");
  if((a.kind||a.paid||a.help||a.proof||a.scam||/\?/.test(text))&&!S.waitingSince)S.waitingSince=now;
  if(!a.kind)return;
  const note=`Client: "${text.replace(/\s+/g," ").trim().slice(0,70)}"`;
  if(a.kind==="accuse"||a.kind==="demand"||a.kind==="worry"){   // never wait on these
    await riskEvent(guild,ch,ticket,a.kind,SAFETY.points[a.kind],note);
    return;
  }
  S.hist=S.hist.filter(ts=>now-ts<SAFETY.repeatMs);S.hist.push(now);
  S.pending.push({at:now,kind:a.kind,pts:SAFETY.points[a.kind],note,sticky:S.hist.length>=3});
}
// Runs every 30 seconds: settles unanswered worries, measures how long a distressed client has been ignored, acts on held-back levels, retires old holds
async function sweepSafety(guild){
  if(!SAFETY.enabled||_safetySweepRunning)return;
  _safetySweepRunning=true;
  try{
    const now=Date.now();
    for(const [cid,S] of [..._safety]){
      if(_safety.get(cid)!==S)continue;       // cleared while this sweep was running
      const t=(_mem.tickets||{})[cid],ch=guild.channels.cache.get(cid);
      if(!t||t.status!=="open"||!ch){_safety.delete(cid);continue;}
      if(!safetyApplies(t)){S.pending=[];S.waitingSince=0;S.factors.clear();continue;}
      const due=S.pending.filter(p=>now-p.at>=SAFETY.confirmMs);
      if(due.length){
        S.pending=S.pending.filter(p=>!due.includes(p));
        for(const p of due)await riskEvent(guild,ch,t,p.kind,p.pts,p.note);
        if(!safetyApplies(t))continue;     // the ticket may have just been paused
      }
      const v=ignoredValue(S,now);
      if(v>((t.riskByKind&&t.riskByKind.ignored)||0)){
        await riskEvent(guild,ch,t,"ignored",v,ignoredNote(S,now-S.waitingSince),{set:true,replace:/^Exchanger didn't reply/});
        if(!safetyApplies(t))continue;
      }
      await recheckRisk(guild,ch,t);
    }
    let dirty=false;
    for(const [id,h] of Object.entries(_mem.holds||{}))if(h&&h.expiresAt&&h.expiresAt<=now){delete _mem.holds[id];dirty=true;}
    if(dirty)save("holds",_mem.holds);
  }finally{_safetySweepRunning=false;}
}

// ---- 8. Owner buttons on the safety alert (these arrive in DMs) ----
async function handleRiskButton(interaction){
  const [action,arg]=String(interaction.customId).split("__");
  const guild=interaction.guild||client.guilds.cache.get(CONFIG.GUILD_ID)||client.guilds.cache.first()||null;
  if(!guild)return interaction.reply({content:"Couldn't find the server.",flags:64});
  const member=await guild.members.fetch(interaction.user.id).catch(()=>null);
  if(!isOwner(interaction.user.id,member))return interaction.reply({content:"Owners only.",flags:64});
  await interaction.deferUpdate().catch(()=>{});
  const finish=async note=>{    // strip the buttons and stamp who handled it
    const base=interaction.message&&interaction.message.embeds&&interaction.message.embeds[0];
    const e=base?EmbedBuilder.from(base):new EmbedBuilder().setColor(0xf59e0b);
    e.setFooter({text:note});
    await interaction.editReply({embeds:[e],components:[]}).catch(()=>{});
  };
  const who=interaction.user.username||interaction.user.id;
  if(action==="btn_riskclear"){
    const r=await liftRestrictions(guild,arg);
    if(!r.suspended&&!r.held&&!r.cleared&&!r.pending&&!r.checkins&&!r.notified)return finish("Already handled");
    log(guild,`SAFETY CLEARED: ${who} cleared exchanger ${arg}`);
    return finish(`Cleared by ${who}`);
  }
  if(action==="btn_riskfreeze"){
    const tickets=Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets");
    const t=tickets[arg],ch=guild.channels.cache.get(arg);
    if(!t||t.status!=="open"||!ch||!t.claimedBy)return finish("This ticket is no longer open");
    if(t.reported||isSuspended(t.claimedBy))return finish("Already paused");
    await reportTicket({guild,channel:ch},t,tickets,"Paused by an owner after a safety alert.",{source:"owner",by:interaction.user.id});
    return finish(`Frozen by ${who}`);
  }
}
// ── end Safety system ────────────────────────────────────────

function isExchanger(member){
  if(!member)return false;
  const allRoles=Object.values(CONFIG.ROLES||{}).filter(Boolean);
  return PERMANENT_OWNER_IDS.includes(member.id)||CONFIG.OWNER_IDS.includes(member.id)||
    !!(member.roles.cache.has(OWNER_ROLE))||
    !!(CONFIG.STAFF_ROLE&&member.roles.cache.has(CONFIG.STAFF_ROLE))||
    !!(CONFIG.EXCHANGER_ROLE&&member.roles.cache.has(CONFIG.EXCHANGER_ROLE))||
    allRoles.some(r=>member.roles.cache.has(r));
}
function calcFeeWithTag(usd,dir,isVip,hasTag){const base=calcFee(usd,dir,isVip);if(hasTag)return Math.max(base-(usd*0.002),CONFIG.MIN_FEE);return base;}
const base=title=>new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO}).setTitle(title).setTimestamp();

// == Compact embeds ==============================================
// Calculators and guides are one slim, wide card: no big logo image, no title line, and short columns that sit side by side on a phone.
const slim=name=>new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:`Konvert Exchange  ·  ${name}`,iconURL:IMG.LOGO});
const _usd2=n=>"$"+Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});   // always cents, even for tiny amounts
function _feeText(amt,rate,fee,short){return amt*rate/100<CONFIG.MIN_FEE?`${_usd2(CONFIG.MIN_FEE)} min fee`:`${rate}% \u00B7 ${_usd2(fee)}${short?"":" fee"}`;}
function feeEmbed(amt,{vip=false,prices={}}={}){
  const fS=calcFee(amt,"send",vip),rS=feeRate(amt,"send",vip),fR=calcFee(amt,"receive",vip),rR=feeRate(amt,"receive",vip);
  const getS=Math.max(0,amt-fS),getR=Math.max(0,amt-fR);
  let tS=_feeText(amt,rS,fS),tR=_feeText(amt,rR,fR);
  if(Math.max(tS.length,tR.length)>15){tS=_feeText(amt,rS,fS,true);tR=_feeText(amt,rR,fR,true);}   // keep each column narrow enough to sit side by side on a phone
  const coins=[["BTC",6],["ETH",5],["SOL",4]].filter(([c])=>prices[c]>0).map(([c,d])=>`${c} ${(getS/prices[c]).toFixed(d)}`);
  const e=slim("Fee Calculator").setDescription(`Estimate for **${_usd2(amt)}**${vip?"  \u00B7  VIP rate":""}`+(amt>=CONFIG.MIN_AMOUNT?"":`\n**Too small for a ticket.** The minimum amount is ${_usd2(CONFIG.MIN_AMOUNT)}.`))
    .addFields(
      {name:"Fiat \u2192 Crypto",value:`Get **${_usd2(getS)}**\n${tS}`,inline:true},
      {name:"Crypto \u2192 Fiat",value:`Get **${_usd2(getR)}**\n${tR}`,inline:true});
  if(coins.length)e.addFields({name:"\u2248 In coins",value:coins.join("\n"),inline:true});
  return e.setFooter({text:`Konvert Exchange  ·  Minimum amount ${_usd2(CONFIG.MIN_AMOUNT)}  ·  Minimum fee ${_usd2(CONFIG.MIN_FEE)} per exchange`});
}
// == end Compact embeds ==========================================
function log(guild,msg){if(!CONFIG.LOG_CHANNEL||!guild)return;const ch=guild.channels.cache.get(CONFIG.LOG_CHANNEL);if(ch)ch.send({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setDescription("```"+msg+"```").setTimestamp()]}).catch(()=>{});}

// ══ PRICES ══════════════════════════════════════════════════════════════════════════════════════════════════
// A coin's price never comes from one place. Any one service can be down, rate-limited or refuse the host (Binance answers US servers with HTTP 451,
// and Railway can look like one), so a lookup asks about a dozen at once, keeps whatever answers in the first moments, takes the middle price and
// remembers it for 90 seconds. If nothing answers it serves the last price it had (up to 6 hours old) instead of an error.
const STABLE=new Set(["USDT","USDC"]);
const CANON={MATIC:"POL",FTM:"S",KLAY:"KAIA"};          // renamed 1:1: exchanges list only the new ticker now, so that is the one asked about
// Besides COINS, these answer to $TICKER. Nothing else does, so a Cash App $cashtag typed in chat is left alone.
const EXTRA_COINS=["BCH","ETC","NEO","IOTA","FIL","TON","SUI","APT","SEI","TIA","WLD","JUP","PYTH","BONK","WIF","PEPE","FLOKI","FET","RENDER","RNDR","ONDO","ENA","STRK","TAO","HYPE","KAS","POL","LDO","PENDLE","JASMY","CRO","OKB","MNT","DAI","TUSD","FDUSD","PYUSD","USDE","WBTC","WETH","STETH","BGB","XDC","XCN","ZRO","ETHFI","JTO","BLUR","TURBO","POPCAT","BRETT","MEW","NEIRO","PNUT","FARTCOIN","VIRTUAL","GRASS","MOODENG","PENGU","USUAL","MORPHO","EIGEN","ORDI","AXL","ARKM","CFX","GMX","LUNC","LUNA","USTC","BTT","DGB","RVN","XNO","XVG","KDA","BSV","BTG","XEM","IOST","LSK","SYS","MINA","CKB","AUDIO","GLM","API3","OCEAN","ASI","KAIA","TRUMP"];
const KNOWN_COINS=new Set([...COINS,...EXTRA_COINS]);
const isKnownCoin=s=>KNOWN_COINS.has(String(s||"").trim().toUpperCase());
Object.assign(COIN_NAMES,{toncoin:"TON",ton:"TON",sui:"SUI",aptos:"APT",pepe:"PEPE",bonk:"BONK",dogwifhat:"WIF","bitcoin cash":"BCH","ethereum classic":"ETC",filecoin:"FIL",neo:"NEO",iota:"IOTA",render:"RENDER","fetch.ai":"FET",hyperliquid:"HYPE",bittensor:"TAO",kaspa:"KAS",lido:"LDO",pendle:"PENDLE",cronos:"CRO",dai:"DAI",pol:"POL",trump:"TRUMP",ethena:"ENA",celestia:"TIA",worldcoin:"WLD",jupiter:"JUP",starknet:"STRK",floki:"FLOKI",mantle:"MNT"});
const RATE_COINS=Object.keys(GECKO);                      // the coins on the live rates panel and in /market
let PRICE_FRESH_MS=90*1000,PRICE_STALE_MS=6*60*60*1000,PRICE_USABLE_MS=30*60*1000,PRICE_SOURCE_MS=6000,PRICE_GRACE_MS=700,PRICE_MISS_MS=30*1000,PRICE_UNKNOWN_PER_MIN=20,LOGO_CHECK_MS=3500;
const PRICE_UA="Mozilla/5.0 (compatible; KonvertBot/1.0)";
const _num=v=>{const n=typeof v==="number"?v:parseFloat(v);return Number.isFinite(n)?n:null;};
const _pos=v=>{const n=_num(v);return n!==null&&n>0?n:null;};
const _pct=(last,open)=>(_pos(last)&&_pos(open))?(last-open)/open*100:null;
// An answer that is not going to be read is closed, so it does not hold a connection open (node-fetch bodies are streams, the built-in fetch's are web streams)
const _drop=r=>{try{const b=r&&r.body;if(b){if(typeof b.destroy==="function")b.destroy();else if(typeof b.cancel==="function")b.cancel().catch(()=>{});}}catch{}};
async function _getJSON(url,headers){
  const r=await fetch(url,{headers:{accept:"application/json","user-agent":PRICE_UA,...(headers||{})},signal:AbortSignal.timeout(PRICE_SOURCE_MS)});
  if(!r.ok){_drop(r);throw new Error("HTTP "+r.status);}
  return r.json();
}
// A picture address is used only when it is a real web address: a service with no picture for a coin sometimes sends a bare file name, which an embed refuses
const _okUrl=u=>typeof u==="string"&&u.length<1000&&/^https?:\/\/[^\s<>"'`]+$/i.test(u);
const _mkq=(o,f)=>{if(!o)return o;const q=Object.assign({usd:null,change:null,high:null,low:null,vol:null,mcap:null,name:null,logo:null},f(o));if(!_okUrl(q.logo))q.logo=null;return q;};
const _cgRow=r=>_mkq(r,x=>({usd:_pos(x.current_price),change:_num(x.price_change_percentage_24h),high:_pos(x.high_24h),low:_pos(x.low_24h),vol:_pos(x.total_volume),mcap:_pos(x.market_cap),name:x.name||null,logo:x.image||null}));
const _ccRow=r=>_mkq(r,x=>({usd:_pos(x.PRICE),change:_num(x.CHANGEPCT24HOUR),high:_pos(x.HIGH24HOUR),low:_pos(x.LOW24HOUR),vol:_pos(x.VOLUME24HOURTO),mcap:_pos(x.MKTCAP),logo:x.IMAGEURL?`https://www.cryptocompare.com${x.IMAGEURL}`:null}));
const _cgHeaders=()=>process.env.COINGECKO_API_KEY?{"x-cg-demo-api-key":process.env.COINGECKO_API_KEY}:null;
const _cgUrl=syms=>`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&symbols=${syms.map(s=>s.toLowerCase()).join(",")}&order=market_cap_desc&per_page=250&page=1&sparkline=false`;
const _ccUrl=syms=>`https://min-api.cryptocompare.com/data/pricemultifull?fsyms=${syms.join(",")}&tsyms=USD`;
// Exchanges that answer like Binance (24-hour ticker by pair)
async function _binanceLike(host,pair){
  const j=await _getJSON(`${host}/api/v3/ticker/24hr?symbol=${pair}`),last=_pos(j&&j.lastPrice);
  if(!last)throw new Error("not listed");
  return _mkq(j,x=>({usd:last,change:_num(x.priceChangePercent),high:_pos(x.highPrice),low:_pos(x.lowPrice),vol:_pos(x.quoteVolume)}));
}
// Every source takes a ticker ("XMR") and gives back {usd, change (24h %), high, low, vol (USD), mcap, name, logo}, or throws. A lower tier is trusted first.
const PRICE_SOURCES=[
  {id:"coingecko",tier:1,run:async s=>{
    const j=await _getJSON(_cgUrl([s]),_cgHeaders()),r=(Array.isArray(j)?j:[]).find(x=>x&&String(x.symbol).toUpperCase()===s&&_pos(x.current_price));
    if(!r)throw new Error("not listed");
    return _cgRow(r);
  }},
  {id:"cryptocompare",tier:1,run:async s=>{
    const j=await _getJSON(_ccUrl([s])),r=j&&j.RAW&&j.RAW[s]&&j.RAW[s].USD;
    if(!r||!_pos(r.PRICE))throw new Error("not listed");
    return _ccRow(r);
  }},
  {id:"coinpaprika",tier:1,run:async s=>{
    const f=await _getJSON(`https://api.coinpaprika.com/v1/search?q=${s}&c=currencies&limit=10`);
    const c=((f&&f.currencies)||[]).filter(x=>x&&String(x.symbol).toUpperCase()===s&&x.is_active!==false).sort((a,b)=>(a.rank||1e9)-(b.rank||1e9))[0];
    if(!c)throw new Error("not listed");
    const t=await _getJSON(`https://api.coinpaprika.com/v1/tickers/${encodeURIComponent(c.id)}?quotes=USD`),q=t&&t.quotes&&t.quotes.USD;
    if(!q||!_pos(q.price))throw new Error("no price");
    return {..._mkq(q,x=>({usd:_pos(x.price),change:_num(x.percent_change_24h),vol:_pos(x.volume_24h),mcap:_pos(x.market_cap),name:t.name||c.name||null,logo:`https://static.coinpaprika.com/coin/${c.id}/logo.png`})),logoGuess:true};
  }},
  {id:"kraken",tier:1,run:async s=>{
    const j=await _getJSON(`https://api.kraken.com/0/public/Ticker?pair=${({BTC:"XBT",DOGE:"XDG"})[s]||s}USD`);
    if(j&&j.error&&j.error.length)throw new Error(String(j.error[0]).slice(0,60));
    const t=Object.values((j&&j.result)||{})[0],last=_pos(t&&t.c&&t.c[0]);
    if(!last)throw new Error("not listed");
    const v=_pos(t.v&&t.v[1]);
    return {..._mkq(t,x=>({usd:last,change:_pct(last,x.o),high:_pos(x.h&&x.h[1]),low:_pos(x.l&&x.l[1]),vol:v?v*last:null})),dayChange:true};   // Kraken's "open" is today's (UTC), not 24 hours ago
  }},
  {id:"coinbase",tier:1,run:async s=>{
    const j=await _getJSON(`https://api.exchange.coinbase.com/products/${s}-USD/stats`),last=_pos(j&&j.last);
    if(!last)throw new Error("not listed");
    const v=_pos(j.volume);
    return _mkq(j,x=>({usd:last,change:_pct(last,x.open),high:_pos(x.high),low:_pos(x.low),vol:v?v*last:null}));
  }},
  {id:"binance",tier:2,run:s=>_binanceLike("https://api.binance.com",`${s}USDT`)},
  {id:"binanceus",tier:2,run:s=>_binanceLike("https://api.binance.us",`${s}USDT`)},
  {id:"okx",tier:2,run:async s=>{
    const j=await _getJSON(`https://www.okx.com/api/v5/market/ticker?instId=${s}-USDT`),t=j&&String(j.code)==="0"&&j.data&&j.data[0],last=_pos(t&&t.last);
    if(!last)throw new Error("not listed");
    return _mkq(t,x=>({usd:last,change:_pct(last,x.open24h),high:_pos(x.high24h),low:_pos(x.low24h),vol:_pos(x.volCcy24h)}));
  }},
  {id:"kucoin",tier:2,run:async s=>{
    const j=await _getJSON(`https://api.kucoin.com/api/v1/market/stats?symbol=${s}-USDT`),t=j&&j.data,last=_pos(t&&t.last);
    if(!last)throw new Error("not listed");
    return _mkq(t,x=>({usd:last,change:_num(x.changeRate)===null?null:_num(x.changeRate)*100,high:_pos(x.high),low:_pos(x.low),vol:_pos(x.volValue)}));
  }},
  {id:"gate",tier:2,run:async s=>{
    const j=await _getJSON(`https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${s}_USDT`),t=Array.isArray(j)?j[0]:null,last=_pos(t&&t.last);
    if(!last)throw new Error("not listed");
    return _mkq(t,x=>({usd:last,change:_num(x.change_percentage),high:_pos(x.high_24h),low:_pos(x.low_24h),vol:_pos(x.quote_volume)}));
  }},
  {id:"mexc",tier:2,run:async s=>{
    const j=await _getJSON(`https://api.mexc.com/api/v3/ticker/24hr?symbol=${s}USDT`),last=_pos(j&&j.lastPrice);
    if(!last)throw new Error("not listed");
    return _mkq(j,x=>({usd:last,change:_pct(last,x.openPrice),high:_pos(x.highPrice),low:_pos(x.lowPrice),vol:_pos(x.quoteVolume)}));
  }},
  {id:"bybit",tier:2,run:async s=>{
    const j=await _getJSON(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${s}USDT`),t=j&&j.result&&j.result.list&&j.result.list[0],last=_pos(t&&t.lastPrice);
    if(!last)throw new Error("not listed");
    return _mkq(t,x=>({usd:last,change:_num(x.price24hPcnt)===null?null:_num(x.price24hPcnt)*100,high:_pos(x.highPrice24h),low:_pos(x.lowPrice24h),vol:_pos(x.turnover24h)}));
  }},
];
async function _runSource(src,sym){
  const t0=Date.now();
  try{
    const q=await src.run(sym);
    if(!q||!_pos(q.usd))throw new Error("no price");
    return {id:src.id,tier:src.tier,ok:true,q,ms:Date.now()-t0};
  }catch(e){
    return {id:src.id,tier:src.tier,ok:false,err:String(e&&e.message||e).slice(0,70),ms:Date.now()-t0};
  }
}
// Runs every task at once. Gives back the answers that came in, a moment after the first good one (or once all have finished, or after the time limit).
function _gather(tasks){
  return new Promise(resolve=>{
    const got=[];let left=tasks.length,done=false,grace=null,hard=null;
    const finish=()=>{if(done)return;done=true;clearTimeout(hard);clearTimeout(grace);resolve(got.slice());};
    hard=setTimeout(finish,PRICE_SOURCE_MS+500);
    if(!left){finish();return;}
    for(const go of tasks)go().then(r=>{if(r&&r.ok){got.push(r);if(!grace&&!done)grace=setTimeout(finish,PRICE_GRACE_MS);}}).catch(()=>{}).finally(()=>{if(--left===0)finish();});
  });
}
async function _pool(items,limit,fn){
  let i=0;
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(i<items.length){const x=items[i++];await fn(x);}}));
}
// Several answers become one: the middle price (a different token that shares the ticker is dropped as an outlier), and every other field from the best source that has it.
function _blend(answers){
  if(!answers||!answers.length)return null;
  const byPrice=[...answers].sort((a,b)=>a.q.usd-b.q.usd);
  let use=byPrice;
  if(byPrice.length>=3){const mid=byPrice[Math.floor((byPrice.length-1)/2)].q.usd;use=byPrice.filter(a=>Math.abs(a.q.usd-mid)/mid<=0.25);}
  else if(byPrice.length===2&&byPrice[1].q.usd/byPrice[0].q.usd>1.25)use=[[...byPrice].sort((a,b)=>a.tier-b.tier)[0]];
  const base=use.length<=2?[...use].sort((a,b)=>a.tier-b.tier)[0]:use[Math.floor((use.length-1)/2)];
  const ranked=[base,...use.filter(a=>a!==base).sort((a,b)=>a.tier-b.tier)];
  const all=[...answers].sort((a,b)=>a.tier-b.tier);
  const first=(list,f)=>{for(const a of list){const v=a.q[f];if(v!==null&&v!==undefined)return v;}return null;};
  const usd=base.q.usd;
  let high=first(ranked,"high"),low=first(ranked,"low");
  if(high!==null&&high<usd)high=usd;
  if(low!==null&&low>usd)low=usd;
  const withChange=ranked.filter(a=>a.q.change!==null&&Math.abs(a.q.change)<=1000),ch=withChange.find(a=>!a.q.dayChange)||withChange[0]||null;
  const logoA=all.find(a=>a.q.logo&&!a.q.logoGuess)||all.find(a=>a.q.logo)||null;
  return {usd,change:ch?ch.q.change:null,high,low,vol:first(ranked,"vol"),mcap:first(all,"mcap"),name:first(all,"name"),logo:logoA?logoA.q.logo:null,logoGuess:!!(logoA&&logoA.q.logoGuess),n:use.length};
}
const _quotes={},_flight={},_miss={},_unknownAt=[];
// The ticker behind whatever was typed ("xmr", "$XMR", "monero" -> "XMR"), or "" when it cannot be a ticker
const _symOf=s=>{
  const r=String(resolveCoin(String(s==null?"":s).trim().replace(/^\$/,""))||"").toUpperCase();
  return /^[A-Z0-9]{2,12}$/.test(r)?r:"";
};
const _stale=sym=>{const h=_quotes[sym];return h&&Date.now()-h.ts<PRICE_STALE_MS?{...h.q,stale:true}:null;};
// A ticker nobody has heard of may be looked up only so often, so typing nonsense cannot hammer the price services
function _unknownBudgetOk(){
  const now=Date.now();
  while(_unknownAt.length&&now-_unknownAt[0]>60000)_unknownAt.shift();
  if(_unknownAt.length>=PRICE_UNKNOWN_PER_MIN)return false;
  _unknownAt.push(now);
  return true;
}
async function _lookup(sym){
  const ps=CANON[sym]||sym;
  const answers=await _gather(PRICE_SOURCES.map(src=>()=>_runSource(src,ps)));
  const q=_blend(answers);
  if(q){q.ts=Date.now();_quotes[sym]={q,ts:q.ts};_rememberLogo(sym,q);delete _miss[sym];return q;}
  if(Object.keys(_miss).length>500)for(const k of Object.keys(_miss))delete _miss[k];
  _miss[sym]=Date.now();
  const old=_stale(sym);
  console.log(old?`[price] every source failed for ${sym}; serving the last price`:`[price] no source has ${sym}`);
  return old;
}
// One quote for a coin: {usd, change, high, low, vol, mcap, name, logo, source, ts, stale?}, or null when nobody has it
async function quoteCoin(input){
  const sym=_symOf(input);
  if(!sym)return null;
  if(STABLE.has(sym))return {usd:1,change:0,high:1,low:1,vol:null,mcap:null,name:sym==="USDT"?"Tether":"USD Coin",logo:COIN_LOGO[sym]||null,n:1,ts:Date.now()};
  const hit=_quotes[sym];
  if(hit&&Date.now()-hit.ts<PRICE_FRESH_MS)return hit.q;
  if(_miss[sym]&&Date.now()-_miss[sym]<PRICE_MISS_MS)return _stale(sym);
  if(_flight[sym])return _flight[sym];
  if(!KNOWN_COINS.has(sym)&&!_unknownBudgetOk())return _stale(sym);
  _flight[sym]=_lookup(sym).finally(()=>{delete _flight[sym];});
  return _flight[sym];
}
// Quotes for a list of coins: two requests (CoinGecko and CryptoCompare take a list) and the usual lookup only for what they did not cover.
// With a time limit it gives back what it has by then; any coin it has an older price for is filled in from that.
async function quoteMany(list,budgetMs){
  const want=[...new Set((list||[]).map(_symOf).filter(Boolean))],out={};
  const work=(async()=>{
    const need=[];
    for(const c of want){const h=_quotes[c];if(STABLE.has(c)||(h&&Date.now()-h.ts<PRICE_FRESH_MS))out[c]=await quoteCoin(c);else need.push(c);}
    if(!need.length)return;
    const ps=[...new Set(need.map(c=>CANON[c]||c))],bulk={cg:{},cc:{}};
    await Promise.all([
      _getJSON(_cgUrl(ps),_cgHeaders()).then(j=>{for(const r of Array.isArray(j)?j:[]){const S=String(r&&r.symbol).toUpperCase();if(!bulk.cg[S]&&_pos(r&&r.current_price))bulk.cg[S]=_cgRow(r);}}).catch(()=>{}),
      _getJSON(_ccUrl(ps)).then(j=>{const raw=(j&&j.RAW)||{};for(const S of Object.keys(raw)){const r=raw[S]&&raw[S].USD;if(r&&_pos(r.PRICE))bulk.cc[S]=_ccRow(r);}}).catch(()=>{}),
    ]);
    for(const c of need){
      const p=CANON[c]||c,answers=[];
      if(bulk.cg[p])answers.push({id:"coingecko",tier:1,q:bulk.cg[p]});
      if(bulk.cc[p])answers.push({id:"cryptocompare",tier:1,q:bulk.cc[p]});
      const q=_blend(answers);
      if(q){q.ts=Date.now();_quotes[c]={q,ts:q.ts};_rememberLogo(c,q);out[c]=q;}
    }
    await _pool(need.filter(c=>!out[c]),4,async c=>{const q=await quoteCoin(c).catch(()=>null);if(q)out[c]=q;});
  })().catch(()=>{});
  if(budgetMs){let t;await Promise.race([work,new Promise(r=>{t=setTimeout(r,budgetMs);})]);clearTimeout(t);}
  else await work;
  const res={...out};
  for(const c of want)if(!res[c]){const s=_stale(c);if(s)res[c]=s;}
  return res;
}
const fmtPrice=n=>n>=1?n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}):n>=0.01?n.toFixed(4):n>=1e-8?n.toFixed(8):n.toExponential(2);
// A price for the places that only need a number (tickets, alerts, conversions). Not used once it is more than 30 minutes old.
async function getPrice(coin){
  const q=await quoteCoin(coin);
  if(!q||(q.stale&&Date.now()-q.ts>PRICE_USABLE_MS))return null;
  return q.usd;
}
// A coin's picture: the built-in one, else the one a price service gave, else the first of two icon libraries that has it (checked, then remembered).
const _logos={};
const LOGO_CDNS=[s=>`https://assets.coincap.io/assets/icons/${s}@2x.png`,s=>`https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/${s}.png`];
const _rememberLogo=(sym,q)=>{if(q&&q.logo&&!q.logoGuess)_logos[sym]={url:q.logo,ts:Date.now()};};
async function _imageOk(url){
  try{
    const r=await fetch(url,{headers:{range:"bytes=0-0","user-agent":PRICE_UA},signal:AbortSignal.timeout(LOGO_CHECK_MS)});
    const ok=!!r&&r.ok&&/^image\//i.test((r.headers&&r.headers.get&&r.headers.get("content-type"))||"");
    _drop(r);
    return ok;
  }catch{return false;}
}
async function coinLogo(coin,q){
  const sym=_symOf(coin);
  if(!sym)return null;
  if(COIN_LOGO[sym])return COIN_LOGO[sym];
  if(q&&q.logo&&!q.logoGuess){_logos[sym]={url:q.logo,ts:Date.now()};return q.logo;}
  const c=_logos[sym];
  if(c&&Date.now()-c.ts<(c.url?24*3600*1000:30*60*1000))return c.url;
  const ps=(CANON[sym]||sym).toLowerCase(),cands=[...(q&&q.logo?[q.logo]:[]),...LOGO_CDNS.map(f=>f(ps))];
  let url=null;
  try{url=await Promise.any(cands.map(async u=>{if(await _imageOk(u))return u;throw new Error("no image");}));}catch{}
  _logos[sym]={url,ts:Date.now()};
  return url;
}
// The card shown for $XMR and /price XMR
function priceEmbed(coin,q,logo){
  const known=q.change!==null&&q.change!==undefined,ch=known?q.change:0,isUp=ch>=0,sign=isUp?"+":"",dir=isUp?"▲":"▼";
  const hi=q.high?`$${fmtPrice(q.high)}`:"—",lo=q.low?`$${fmtPrice(q.low)}`:"—";
  const age=Math.max(1,Math.round((Date.now()-(q.ts||Date.now()))/60000));
  return new EmbedBuilder().setColor(isUp?0x7C4DFF:0xef4444).setTitle(`${coin}`).setThumbnail(logo||IMG.LOGO).addFields(
    {name:"Price",value:`$${fmtPrice(q.usd)} USD`,inline:false},
    {name:"24H Change",value:known?`${sign}$${fmtPrice(Math.abs(ch/100*q.usd))} ${dir} (${sign}${ch.toFixed(2)}%)`:"—",inline:false},
    {name:"24H High",value:hi,inline:true},
    {name:"24H Low",value:lo,inline:true},
  ).setFooter({text:q.stale?`Konvert Exchange  ·  Last known price, ${age} min old (live sources are slow right now)`:`Konvert Exchange  ·  Type /price ${coin} for more details`}).setTimestamp();
}
// For /pricecheck and the startup log: asks every source about a coin on its own, without the cache, and says how each one answered
async function priceDiagnose(coin){
  const sym=_symOf(coin),ps=CANON[sym]||sym;
  const rows=await Promise.all(PRICE_SOURCES.map(s=>_runSource(s,ps)));
  return {sym,rows,blend:_blend(rows.filter(r=>r.ok).map(r=>({id:r.id,tier:r.tier,q:r.q})))};
}
async function priceSelfCheck(){
  for(const c of ["BTC","XMR"]){
    const r=await priceDiagnose(c);
    const ok=r.rows.filter(x=>x.ok).map(x=>x.id),bad=r.rows.filter(x=>!x.ok).map(x=>`${x.id} (${x.err})`);
    console.log(`[price] startup check ${c}: ${r.blend?`$${fmtPrice(r.blend.usd)} from ${ok.length} of ${r.rows.length} sources`:"NO PRICE"}  |  ok: ${ok.join(", ")||"none"}  |  failed: ${bad.join(", ")||"none"}`);
  }
}

const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent,GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildInvites],partials:[Partials.Channel]});
const state={pending:{},mineGames:{},cooldowns:{},alerts:[],passes:{},c2cSelections:{},feedChannel:null,feedEnabled:false,volumeAdj:{},feeMode:"standard",referralDMsEnabled:true,liveLbMessageId:null,liveLbChannelId:null,promos:{},konvTagUsers:new Set(),exchangerWallets:{},personalWallets:{"SOL":"BKvzCkm4VuKHSwJp9r2ETC1gUxmLxXiFzAxtDrD3a4GP","ETH":"0x2988997a099AdD54c0662B960c0516dB4cBA37e7","USDT-BNB":"0x2988997a099AdD54c0662B960c0516dB4cBA37e7","USDT-ETH":"0x2988997a099AdD54c0662B960c0516dB4cBA37e7","BTC":"bc1quegp7cr4ulek6aq2aher8mgflfm8r7smpzmk3l","LTC":"Lcdmd7GoVYiHgFit1NajGftM8pwXmr4YNk"},activeGiveaway:null,dualPromo:null};

function buildLeaderboardVolumes(){
  const DONE_STATUS=["vouched","completed"];
  const allEntries=Object.values(_mem.tickets&&Object.keys(_mem.tickets).length?_mem.tickets:load("tickets"));
  const byUser={};
  for(const t of allEntries){
    // Only count real completed exchanges — skip adjustments, open, cancelled, closed tickets
    if(!DONE_STATUS.includes(t.status))continue;
    if(t.method==="adjustment")continue;
    if(!t.userId||!t.amountUSD)continue;
    const amt=parseFloat(t.amountUSD)||0;
    if(amt<=0)continue;
    if(!byUser[t.userId])byUser[t.userId]=0;
    byUser[t.userId]+=amt;
  }
  // Apply any adjustment entries (can be negative or positive)
  for(const t of allEntries){
    if(!DONE_STATUS.includes(t.status))continue;
    if(t.method!=="adjustment")continue;
    if(!t.userId)continue;
    const amt=parseFloat(t.amountUSD)||0;
    if(!byUser[t.userId])byUser[t.userId]=0;
    byUser[t.userId]+=amt;
  }
  const result={};
  for(const [uid,vol] of Object.entries(byUser)){
    const clamped=Math.max(0,vol);
    if(clamped>0)result[uid]=clamped;
  }
  return result;
}

function getUserVolume(userId){
  const DONE_STATUS=["vouched","completed"];
  const allEntries=Object.values(_mem.tickets&&Object.keys(_mem.tickets).length?_mem.tickets:load("tickets"));
  let total=0;
  for(const t of allEntries){
    if(t.userId!==userId)continue;
    if(!DONE_STATUS.includes(t.status))continue;
    const amt=parseFloat(t.amountUSD)||0;
    if(t.method==="adjustment"||t.method==="adjustment_deal"){
      // Adjustments can be positive or negative
      total+=amt;
    } else {
      // Only count real exchanges with positive amounts
      if(amt>0)total+=amt;
    }
  }
  return Math.max(0,total);
}
function ticketFee(t){
  const stored=parseFloat(t.feeUSD||0);
  if(stored>0)return stored;
  const amt=parseFloat(t.amountUSD||0);
  if(!(amt>0))return 0;
  if(t.method==="giftcard")return 0;
  return calcFee(amt,t.direction||"send",false);
}
function getUserDealCount(userId){
  const all=Object.values(_mem.tickets&&Object.keys(_mem.tickets).length?_mem.tickets:load("tickets"));
  const real=all.filter(t=>t.userId===userId&&["vouched","completed"].includes(t.status)&&t.method!=="adjustment"&&t.method!=="adjustment_deal"&&parseFloat(t.amountUSD||0)>0).length;
  const adjDeals=all.filter(t=>t.userId===userId&&t.method==="adjustment_deal"&&parseFloat(t.amountUSD||0)>0).length;
  const total=real+adjDeals;
  return getUserVolume(userId)>0&&total===0?1:total;
}

const YT_TITLES=["You need to hear this...","Remember This...","Don't forget why you started","Watch this when you feel like quitting","Your prime is not over","This hit different at 3am...","Why NOT you?","Let them talk. Keep working","Be the 1%","You didn't break","Maturing is realizing this...","How badly do you want it?","Trust the process","Nobody cares. Work harder.","It sucks. Do it anyway.","We are all being tested","Look yourself in the mirror","I solemnly swear...","Crazy Motivational Video","To win, you have to lose first","Stop waiting. Start now","Your future self is watching","Get up. Right now.","You were built for this","Don't die before you live","Remember June...","Okay. Get up.","Fail Fast. Win Faster.","The sun rises. So do you","How badly do you want it?"];
const YT_DESCRIPTIONS=["Subscribe & never miss a workout again \u274C\n\n\uD83D\uDD14 @GymMotivez for daily motivation\n\uD83D\uDCAA Like & share if this fired you up\n\uD83D\uDCAC Comment your workout below\n\n#Shorts #GymMotivation #Fitness #Workout #Motivation #GymLife #NoExcuses #BeastMode","Subscribe & never miss a drop \uD83D\uDD25\n\n\uD83D\uDD14 Follow @GymMotivez\n\uD83D\uDCAA Drop a \uD83D\uDCAA if you needed this today\n\uD83D\uDCAC What are you working on?\n\n#Shorts #GymMotivation #Grind #Workout #FitnessMotivation #MindsetShift #NoExcuses"];


// ── Guide (/help) ─────────────────────────────────────────────────────────────────────────────────────────────
// How Konvert works and the commands clients need, in TWO short embeds. /help shows them privately (or opens one topic in full); /postguide (owners) posts them in a channel.
// The long topic pages live in ONE table here (GUIDE_SECTIONS), and the tests compare it with the commands the bot really registers, so it cannot drift.
var _guideIds={};                       // command name -> id, filled in when the commands are registered, so every command is a tappable mention
function guideSetCommandIds(list){const m={};for(const c of Array.isArray(list)?list:[])if(c&&c.name&&c.id)m[c.name]=String(c.id);_guideIds=m;}
const _gcmd=n=>_guideIds[n]?`</${n}:${_guideIds[n]}>`:`\`/${n}\``;       // tappable once the ids are known, a code pill until then
const _gline=(n,text)=>`${_gcmd(n)}  —  ${text}`;
const _gkey=(code,text)=>`\`${code}\`  —  ${text}`;
const _gembed=(lines,color)=>new EmbedBuilder().setColor(color||CONFIG.COLOR).setDescription(lines.join("\n"));
const GUIDE_TAGLINE="Fast  ·  Safe  ·  Simple  ·  Private";
const GUIDE_MAX_CHARS=5800;             // Discord allows 6,000 characters of embed text per message; keep some room

function _gExchanging(c){
  const ex=c.exchange?`<#${c.exchange}>`:"the exchange channel";
  return [_gembed([
    "# Exchanging",
    "Quote it, open a ticket, get paid. How it works, and every command you need along the way.",
    "",
    "## How an exchange works",
    `**1.**  Get a quote with ${_gcmd("estimate")} or ${_gcmd("fee")}. The minimum amount is $${CONFIG.MIN_AMOUNT}, with a $${CONFIG.MIN_FEE} minimum fee per exchange`,
    `**2.**  Open a ticket in ${ex} and choose your payment method. Select more than one to speed it up: the first exchanger online for any can take it`,
    "**3.**  An exchanger claims it. Their go-first limit is in their name (like **Up To $50**). Above it, the built-in server middleman bot holds the crypto",
    "**4.**  Send only what your ticket tells you to, then confirm once your exchanger marks the deal complete",
    "",
    "## Before you exchange",
    _gline("estimate","full quote before you open a ticket"),
    _gline("fee","the fee on any amount, both directions"),
    _gline("convert","convert between crypto and fiat"),
    _gline("howto","how an exchange works, step by step"),
    _gline("mm","how the built-in middleman bot works"),
    "",
    "## During your exchange",
    _gline("ticket","check on your open ticket"),
    _gline("wallets","deposit addresses (only send to what staff confirm in your ticket)"),
    _gline("dispute","something wrong? locks the ticket and alerts staff"),
  ])];
}
function _gPrices(){
  return [_gembed([
    "# Prices & Market",
    "Live prices from the major exchanges, and alerts so you never have to watch the chart.",
    "",
    "## Look it up",
    _gline("rates","live rates for the top coins (tap Refresh to update)"),
    _gline("price","price, 24h change, high and low for any coin, like `/price BTC`"),
    _gline("market","market mood plus the day's top gainers and losers"),
    "",
    "## Price alerts",
    _gline("alert","get a DM when a coin goes above or below your target"),
    _gline("myalerts","see your active alerts"),
    _gline("clearalerts","remove all your alerts"),
  ])];
}
function _gStats(){
  return [_gembed([
    "# Stats & Leaderboard",
    "Every completed exchange counts toward your volume, your rank and your tier.",
    "",
    _gline("stats","your exchange stats (or anyone's: pick a user), with the volume left to your next tier"),
    _gline("myexchanges","your personal exchange history"),
    _gline("rank","your spot on the leaderboard"),
    _gline("leaderboard","the top 10 clients by volume"),
    _gline("tierlist","every client tier and what it takes to reach it"),
  ])];
}
function _gPerks(){
  return [_gembed([
    "# Perks & Games",
    "",
    "## KONV tag",
    _gline("claimtag","turn on your **KONV tag** perk: **0.2% off** every exchange"),
    "Set Konvert as your **server tag** in Discord profile settings first. Staff-run giveaways are for members with the tag on.",
    "",
    "## Exchange Pass game",
    _gline("mine","find all **3 Exchange Passes** hidden in the grid to win a free exchange pass"),
    "You get 3 clicks, one bomb ends the game, and you can play once every 3 hours. Won one? Open a ticket and type `free` to redeem it.",
  ])];
}
function _gShortcuts(){
  return [_gembed([
    "# Shortcuts",
    "Type these straight into chat. No slash needed.",
    "",
    "## Anywhere in the server",
    _gkey("$BTC","live price card for any listed coin, like `$ETH` or `$SOL`"),
    _gkey("100 usd to btc","instant conversion between fiat and crypto"),
    _gkey("$fee 250","the fee on $250"),
    _gkey("$rate","the fee table at a glance"),
    "",
    "## In your ticket",
    _gkey("$vip","the client's volume and VIP status"),
    "**Promo code**  —  type it in your ticket and the discount applies on the spot",
    "",
    "## The bot",
    _gline("help","this guide"),
    _gline("ping","bot status, latency and which version is running"),
  ])];
}
function _gFees(){
  const rows=[["Under $150",100],["$150 – $349",150],["$350 – $599",350],["$600 – $799",600],["$800+",800]];
  const col=dir=>rows.map(([,a])=>`**${feeRate(a,dir)}%**`).join("\n");
  const vip=[...TIERS].reverse().find(t=>isVipVolume(t.min));
  const table=new EmbedBuilder().setColor(CONFIG.COLOR).setDescription(["# Fees","Simple, tiered pricing. The bigger the exchange, the lower the rate.","​"].join("\n"))
    .addFields({name:"Amount",value:rows.map(r=>r[0]).join("\n"),inline:true},{name:"Fiat → Crypto",value:col("send"),inline:true},{name:"Crypto → Fiat",value:col("receive"),inline:true});
  const off=_gembed([
    "## Discounts and extras",
    `**Minimum fee**  —  $${CONFIG.MIN_FEE} per exchange`,
    `**Minimum amount**  —  $${CONFIG.MIN_AMOUNT}`,
    `**VIP**  —  ${vip.label} and above ($${vip.min.toLocaleString("en-US")}+ volume) pay **0.75% less**`,
    `**KONV tag**  —  **0.2% off** every exchange (${_gcmd("claimtag")})`,
    "**Promo codes**  —  type a valid code in your ticket and the discount applies on the spot",
    "",
    `Try ${_gcmd("fee")} for your exact number. The final fee may vary slightly.`,
  ]);
  return [table,off];
}
function _gTiers(c){
  const has=id=>!!(id&&c.guild&&c.guild.roles&&c.guild.roles.cache&&c.guild.roles.cache.has(id));
  const lines=[...TIERS].reverse().map(t=>`${has(t.role)?`<@&${t.role}>`:`**${t.label}**`}  —  ${t.min>0?`$${t.min.toLocaleString("en-US")}+`:"start here"}${isVipVolume(t.min)?"  \u00B7  VIP":""}`);
  return [_gembed([
    "# Client Tiers",
    "Earn your tier by exchanging volume on Konvert. Your role is assigned automatically after every exchange.",
    "",
    ...lines,
    "",
    `${_gcmd("tierlist")} shows this list any time, and ${_gcmd("stats")} shows how far you are from the next tier.`,
  ])];
}
function _gSafety(c){
  const sup=c.support?`<#${c.support}>`:"a support ticket";
  return [_gembed([
    "# Stay Safe",
    "A few rules that keep every exchange safe.",
    "",
    "**Staff will never DM you first.** Anyone who does is an impersonator. Block and report them.",
    "**Stay inside your ticket.** Every deal, address and instruction happens there. Anything outside it is at your own risk.",
    `**Only send to addresses confirmed in your ticket.** Never to anything sent over DMs (${_gcmd("wallets")}).`,
    "**Pay from your own balance**, not a linked card or bank. Cards can be refused or cost extra.",
    "**Respect the go-first limit** in your exchanger's name. Above it, or if it says **Use MM Always**, the built-in server middleman bot holds the crypto.",
    "**Record the whole process** from start to finish.",
    `**Something wrong?** Flag it in your ticket right away with ${_gcmd("dispute")}. Please only use it for real problems.`,
    `**Need a human?** Open a support ticket in ${sup}.`,
  ],0xf59e0b)];
}
function _gExchangers(){
  return [_gembed([
    "# Exchanger Tools",
    "For exchangers. Your go-first limit comes from your display name (like **Up To $50**). Above it, the built-in server middleman bot holds the crypto.",
    "",
    "## Your wallets",
    _gline("setmywallet","save a wallet address (BTC, ETH, SOL, LTC, USDT-BNB or USDT-ETH)"),
    _gline("mywallets","see your saved addresses"),
    _gline("postwallets","post your addresses in this ticket"),
    _gline("clearwallet","remove a saved address"),
    _gline("exchangerstats","your performance stats (or another exchanger's)"),
    "",
    "## Find tickets",
    _gline("queue","the tickets waiting for an exchanger that you can take, longest first"),
    "",
    "## Payment steps",
    "`$paypal`  ·  `$cashapp`  ·  `$venmo`  ·  `$zelle`  ·  `$interac`  ·  `$applepay`",
    "Posts that method's step-by-step rules for the client, then removes your message.",
  ]),_gembed([
    "## Run the ticket",
    _gkey("$unclaim","release your claim. The ticket reopens with fresh buttons and pings the exchangers again"),
    _gkey("$all","open it to every exchanger: anyone can see it and hop in"),
    _gkey("$open","ping the exchangers who can take this payment method"),
    _gkey("$complete","mark the deal done. The client confirms it"),
    _gkey("$remind","nudge the client: they get 12 hours to reply before the ticket closes"),
    _gkey("$close","close the ticket"),
    _gkey("$info","ticket summary: client, method, amount and more"),
    _gkey("$vol @user","a client's total volume and tier"),
    _gkey("$note text","save a note on the ticket"),
  ])];
}
function _gOwners(){
  return [_gembed([
    "# Owner Tools",
    "Only owners can use these.",
    "",
    "## Tickets",
    _gline("closeticket","close this ticket, with a reason"),
    _gline("cancelticket","cancel this ticket, with a reason"),
    _gline("openticket","open this ticket to all exchangers"),
    _gline("complete","mark this exchange complete and tag the exchanger"),
    _gline("note","add a staff note to this ticket"),
    _gline("receipt","look up a receipt by exchange ID or user"),
    _gkey("$close  $remind  $complete  $unclaim  $all","work in every ticket, support and custom ones too"),
    _gkey("$purge 20","delete the last 20 messages (up to 100). Staff can use it too"),
    "",
    "## Safety and people",
    _gline("suspended","exchangers who are frozen pending review"),
    _gline("reinstate","lift an exchanger's freeze"),
    _gline("clearexchanger","clear an exchanger of all doubt: lifts any freeze, hold, flag and pending check"),
    _gkey("$clear @user","the same, from inside a ticket"),
    _gline("blacklist","blacklist a user"),
    _gline("unblacklist","remove a blacklist"),
    _gkey("$ban @user  $unban @user","the same, typed"),
    _gline("grantowner","give someone full owner permissions"),
    _gline("revokeowner","remove someone's owner permissions"),
    _gline("listowners","list every owner"),
    _gline("exchangerboard","exchanger leaderboard"),
  ]),_gembed([
    "## Clients and stats",
    _gline("clientinfo","full info on any client"),
    _gline("adjuststats","add or subtract volume from a user's stats"),
    _gline("resetstats","reset a user's volume adjustment to 0"),
    _gline("transferstats","move all stats from one account to another"),
    _gline("wipestats","wipe all stats and tickets for one user"),
    _gline("clearleaderboard","wipe all exchange data from the leaderboard and stats"),
    _gline("vouch","manually record a completed exchange"),
    _gline("thankclient","send a thank-you DM to a client"),
    _gline("broadcast","DM every client who exchanged in the last X days"),
    _gline("passes","see who holds exchange passes"),
    _gkey("$passes @user","how many passes one person has"),
    _gline("volume","server volume stats"),
    _gline("snapshot","full server snapshot"),
    _gline("serverinfo","quick overview of the server and bot"),
    _gline("pricecheck","test every price source for a coin (default XMR)"),
    _gline("mmadmin","the built-in middleman bot: status, wallet, deals, history, send, sweep, close, limit, pause, backup"),
  ]),_gembed([
    "## Posting",
    _gline("postexchange","post the exchange embed"),
    _gline("postsupport","post the support embed"),
    _gline("postmm","post the built-in middleman info embed"),
    _gline("postbackup","post the backup server invite"),
    _gline("postinfo","post the info embed"),
    _gline("posttos","post the Terms of Service"),
    _gline("postlinks","post the official links"),
    _gline("postleaderboard","post a live leaderboard that updates after every exchange"),
    _gline("postguide","post this guide in the channel (add a section to post just one)"),
    _gline("announce","post an announcement"),
    _gline("calc","force-post the live rates now"),
    _gline("setlivefeed","pick the channel for live exchange notifications"),
    _gline("togglefeed","turn the live exchange feed on or off"),
    _gline("migrateserver","re-post every past vouch to the current vouch channel"),
    "",
    "## Wallets and fees",
    _gline("setwallet","update a deposit wallet"),
    _gline("jbtc","save your own BTC address"),
    _gline("jeth","save your own ETH address"),
    _gline("jsol","save your own SOL address"),
    _gline("jltc","save your own LTC address"),
    _gline("jusdtbnb","save your own USDT-BNB address"),
    _gkey("$jbtc  $jeth  $jsol  $jltc  $jusdtbnb","post that saved address in chat"),
    _gline("setfeemode","switch between standard (5-10%) and reduced (5-9%) fees"),
    _gline("profittest","send a test profit-split notice to everyone who gets them"),
    "",
    "## Promos and giveaways",
    _gline("createpromo","create a promo code that gives clients a fee discount"),
    _gline("editpromo","edit a promo code"),
    _gline("endpromo","end a promo code"),
    _gline("listpromos","see every active promo code"),
    _gline("promostatus","active promos and the days they have left"),
    _gline("setdualpromo","set a promo for people in both servers"),
    _gline("dualpromooff","turn the dual-server promo off"),
    _gline("giveaway","start a giveaway for KONV tag holders"),
    _gline("giveawayend","end the giveaway early"),
    _gline("giveawaystats","entry count and entrants"),
    _gline("giveawayreroll","reroll the winners of the last giveaway"),
    _gline("removetag","remove the KONV tag perk from a user"),
  ])];
}

const GUIDE_SECTIONS=[
  {key:"exchanging",label:"Exchanging",blurb:"how an exchange works, quotes and tickets",who:"all",build:_gExchanging},
  {key:"prices",label:"Prices & Market",blurb:"live prices, market mood and alerts",who:"all",build:_gPrices},
  {key:"stats",label:"Stats & Leaderboard",blurb:"your volume, rank and exchange history",who:"all",build:_gStats},
  {key:"perks",label:"Perks & Games",blurb:"the KONV tag discount and the Pass game",who:"all",build:_gPerks},
  {key:"shortcuts",label:"Shortcuts",blurb:"quick commands you type in chat",who:"all",build:_gShortcuts},
  {key:"fees",label:"Fees",blurb:"exactly what Konvert charges",who:"all",build:_gFees},
  {key:"tiers",label:"Client Tiers",blurb:"ranks, roles and the VIP rate",who:"all",build:_gTiers},
  {key:"safety",label:"Stay Safe",blurb:"the rules that keep every exchange safe",who:"all",build:_gSafety},
  {key:"exchangers",label:"Exchanger Tools",blurb:"wallets, payment steps and ticket commands",who:"exchanger",build:_gExchangers},
  {key:"owners",label:"Owner Tools",blurb:"everything owners can do",who:"owner",build:_gOwners},
];
const GUIDE_CHOICES=GUIDE_SECTIONS.map(s=>({name:s.label,value:s.key}));
function guideVisible(s,v){return s.who==="all"||(s.who==="exchanger"&&!!v.exch)||(s.who==="owner"&&!!v.owner);}

// The short guide: the one thing /help shows and /postguide posts. Two embeds. who = {exch,owner} adds a line about the staff pages (only when /help is private).
function guideOverview(c,who){
  who=who||{};
  const ex=c.exchange?`<#${c.exchange}>`:"the exchange channel";
  const vip=[...TIERS].reverse().find(t=>isVipVolume(t.min));
  const staff=[];
  if(who.exch)staff.push(`${_gcmd("help")} then pick **Exchanger Tools**  —  wallets, payment steps, ticket commands`);
  if(who.owner)staff.push(`${_gcmd("help")} then pick **Owner Tools**  —  everything owners can do`);
  const how=new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor(kAuthor("Guide")).setDescription([
    kHero("How Konvert works"),
    kNote("Crypto to cash and back, in a private ticket with an exchanger."),
    "",
    `**1.**  Open a ticket in ${ex} and choose a payment method (select more than one to speed it up)`,
    "**2.**  An exchanger claims it and confirms the deal",
    "**3.**  Send only what your ticket says, then confirm",
    _gline("howto","a step-by-step walkthrough"),
    "",
    kHero("Fees"),
    `**5% – 10%**, lower on bigger exchanges. The minimum fee is **$${CONFIG.MIN_FEE} per exchange**, and the minimum amount is **$${CONFIG.MIN_AMOUNT}**.`,
    ...(vip?[`VIP (**$${vip.min.toLocaleString("en-US")}+** volume) pays **0.75% less**.`]:[]),
    `${_gcmd("help")} then pick **Fees**  —  the full fee table`,
    "",
    kHero("Stay safe"),
    "**Staff never DM first.** Block anyone who does.",
    "**Stay in your ticket.** Never pay or send anywhere else.",
    "**Above your exchanger's go-first limit,** the built-in server middleman bot holds the crypto.",
    `${_gcmd("help")} then pick **Stay Safe**  —  all the rules`,
  ].join("\n"));
  const cmds=new EmbedBuilder().setColor(CONFIG.COLOR).setDescription([
    kHero("Type this, get this"),
    "**Prices and fees**",
    _gkey("$BTC","live price of any coin"),
    _gkey("100 usd to btc","instant conversion"),
    _gkey("$fee 250","the fee on any amount"),
    _gline("estimate","a full quote before you open a ticket"),
    "",
    "**You**",
    _gline("stats","your volume, tier and progress"),
    _gline("tierlist","every tier and the VIP rate"),
    _gline("myexchanges","your exchange history"),
    _gline("leaderboard","the top 10 clients"),
    "",
    "**During an exchange**",
    _gline("ticket","where your ticket stands"),
    _gline("dispute","flag a problem. Locks the ticket and alerts staff"),
    _gline("wallets","deposit addresses"),
    _gline("mm","how the built-in middleman bot works"),
    "",
    "**Perks**",
    _gline("claimtag","0.2% off with the KONV server tag"),
    _gline("mine","win a free exchange pass"),
    "",
    "**More**",
    _gline("help","any topic in full, privately: Fees, Tiers, Prices, Perks, Shortcuts and more"),
    ...(staff.length?["",...staff]:[]),
  ].join("\n")).setFooter(kFoot(GUIDE_TAGLINE));
  return [how,cmds];
}
function _gChars(e){const j=e.toJSON?e.toJSON():e;return (j.title||"").length+(j.description||"").length+((j.footer&&j.footer.text)||"").length+((j.author&&j.author.name)||"").length+(j.fields||[]).reduce((a,f)=>a+f.name.length+f.value.length,0);}
// [{key,embed,size}] for the topic pages
function guideItems(c,secs){
  const items=[];
  for(const s of secs)for(const e of s.build(c))items.push({key:s.key,embed:e,size:_gChars(e)});
  return items;
}
// Messages of at most 10 embeds and GUIDE_MAX_CHARS characters of embed text, in order
function guidePack(items){
  const msgs=[];let cur=null;
  for(const it of items){
    if(!cur||cur.embeds.length>=10||cur.size+it.size>GUIDE_MAX_CHARS){cur={embeds:[],keys:[],size:0};msgs.push(cur);}
    cur.embeds.push(it.embed);cur.keys.push(it.key);cur.size+=it.size;
  }
  return msgs;
}
// /help (private) and /postguide (owners: posted in the channel). No topic = the short guide; a topic = that page in full.
async function handleGuide(interaction,{post=false}={}){
  const owner=isOwner(interaction.user.id,interaction.member),exch=owner||isExchanger(interaction.member);
  const pick=interaction.options.getString("topic")||null;
  const sec=pick?GUIDE_SECTIONS.find(s=>s.key===pick)||null:null;
  if(!post&&sec&&!guideVisible(sec,{owner,exch}))return interaction.reply({content:sec.who==="owner"?"Owner tools are only for owners.":"Exchanger tools are only for exchangers.",flags:64});
  const ctx={guild:interaction.guild,exchange:CONFIG.EXCHANGE_CHANNEL,support:SUPPORT_CH};
  const msgs=sec?guidePack(guideItems(ctx,[sec])):[{embeds:guideOverview(ctx,post?null:{exch,owner})}];
  if(!post){
    await interaction.reply({embeds:msgs[0].embeds,flags:64});
    for(const m of msgs.slice(1))await interaction.followUp({embeds:m.embeds,flags:64}).catch(()=>{});
    return;
  }
  await interaction.deferReply({flags:64});
  const ch=interaction.channel,fail="I couldn't post the guide here. Check that I can send messages and embeds in this channel.";
  if(!ch)return interaction.editReply({content:fail});
  const sent=[];
  for(const m of msgs){const x=await ch.send({embeds:m.embeds}).catch(()=>null);if(!x)break;sent.push(x);}
  if(sent.length<msgs.length){
    for(const x of sent)await x.delete().catch(()=>{});          // never leave half a guide behind
    return interaction.editReply({content:fail});
  }
  return interaction.editReply({content:`Guide posted (${sent.length} message${sent.length===1?"":"s"}).`});
}
// ── end Guide ──────────────────────────────────────────────────────────────────────────────────────────────

const COMMANDS=[
  new SlashCommandBuilder().setName("rates").setDescription("View live crypto rates"),
  new SlashCommandBuilder().setName("fee").setDescription("Calculate your Konvert fee").addNumberOption(o=>o.setName("amount_usd").setDescription("Amount in USD").setRequired(true)),
  new SlashCommandBuilder().setName("price").setDescription("Quick live price for any coin").addStringOption(o=>o.setName("coin").setDescription("Coin (BTC, ETH, SOL)").setRequired(true)),
  new SlashCommandBuilder().setName("convert").setDescription("Convert between crypto and fiat").addNumberOption(o=>o.setName("amount").setDescription("Amount").setRequired(true)).addStringOption(o=>o.setName("from").setDescription("From (BTC, USD)").setRequired(true)).addStringOption(o=>o.setName("to").setDescription("To (ETH, CAD)").setRequired(true)),
  new SlashCommandBuilder().setName("stats").setDescription("View exchange stats").addUserOption(o=>o.setName("user").setDescription("User (leave blank for yourself)").setRequired(false)),
  new SlashCommandBuilder().setName("leaderboard").setDescription("Top clients by volume"),
  new SlashCommandBuilder().setName("market").setDescription("Live market summary"),
  new SlashCommandBuilder().setName("wallets").setDescription("View Konvert deposit wallet addresses"),
  new SlashCommandBuilder().setName("mm").setDescription("How the built-in middleman bot works"),
  new SlashCommandBuilder().setName("mine").setDescription("Find 3 diamonds to win a free exchange pass"),
  new SlashCommandBuilder().setName("ticket").setDescription("Check your open ticket status"),
  new SlashCommandBuilder().setName("howto").setDescription("How to use Konvert Exchange"),
  new SlashCommandBuilder().setName("ping").setDescription("Check bot status, latency and version"),
  new SlashCommandBuilder().setName("vouch").setDescription("Manually record a completed exchange").addUserOption(o=>o.setName("client").setDescription("The client").setRequired(true)).addUserOption(o=>o.setName("exchanger").setDescription("The exchanger").setRequired(true)).addStringOption(o=>o.setName("message").setDescription("Review message").setRequired(true)).addStringOption(o=>o.setName("method").setDescription("Payment method").setRequired(true)).addNumberOption(o=>o.setName("amount").setDescription("Amount (USD)").setRequired(true)).addIntegerOption(o=>o.setName("rating").setDescription("Rating 1-5").setMinValue(1).setMaxValue(5).setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("postexchange").setDescription("[Owner] Post the exchange embed").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("postsupport").setDescription("[Owner] Post the support embed").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("postmm").setDescription("[Owner] Post the built-in middleman info embed").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("postbackup").setDescription("[Owner] Post the backup server invite embed")
    .addStringOption(o=>o.setName("link").setDescription("Invite link (leave empty for the official backup)").setRequired(false))
    .addChannelOption(o=>o.setName("channel").setDescription("Where to post it (leave empty for this channel)").addChannelTypes(ChannelType.GuildText,ChannelType.GuildAnnouncement).setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("calc").setDescription("[Owner] Force-post live rates now").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("setwallet").setDescription("[Owner] Update a deposit wallet").addStringOption(o=>o.setName("coin").setDescription("Coin").setRequired(true)).addStringOption(o=>o.setName("address").setDescription("New address").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("announce").setDescription("[Owner] Post an announcement").addStringOption(o=>o.setName("message").setDescription("Message").setRequired(true)).addStringOption(o=>o.setName("channel").setDescription("Channel ID").setRequired(true)).addStringOption(o=>o.setName("ping").setDescription("everyone / here / none").setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("blacklist").setDescription("[Owner] Blacklist a user").addUserOption(o=>o.setName("user").setDescription("User").setRequired(true)).addStringOption(o=>o.setName("reason").setDescription("Reason").setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("unblacklist").setDescription("[Owner] Remove blacklist").addUserOption(o=>o.setName("user").setDescription("User").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("closeticket").setDescription("[Owner] Close this ticket").addStringOption(o=>o.setName("reason").setDescription("Reason").setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("cancelticket").setDescription("[Owner] Cancel this ticket").addStringOption(o=>o.setName("reason").setDescription("Reason").setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("openticket").setDescription("[Owner] Open ticket to all exchangers").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("note").setDescription("[Owner] Add a staff note to this ticket").addStringOption(o=>o.setName("text").setDescription("Note").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("volume").setDescription("[Owner] Server volume stats").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("snapshot").setDescription("[Owner] Full server snapshot").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("exchangerboard").setDescription("[Owner] Exchanger leaderboard").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("thankclient").setDescription("[Owner] Send a thank-you DM to a client").addUserOption(o=>o.setName("client").setDescription("Client to thank").setRequired(true)).addNumberOption(o=>o.setName("amount").setDescription("Amount (USD)").setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("passes").setDescription("[Owner] View exchange pass holders").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("postinfo").setDescription("[Owner] Post the Info embed").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("posttos").setDescription("[Owner] Post the Terms of Service embed").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("postlinks").setDescription("[Owner] Post the Official Links embed").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("adjuststats").setDescription("[Owner] Add or subtract volume from a user's stats").addUserOption(o=>o.setName("user").setDescription("User").setRequired(true)).addNumberOption(o=>o.setName("amount").setDescription("Amount in USD (use negative to subtract)").setRequired(true)).addStringOption(o=>o.setName("reason").setDescription("Reason for adjustment").setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("transferstats").setDescription("[Owner] Move all stats from one account to another").addUserOption(o=>o.setName("from").setDescription("Account to move stats FROM").setRequired(true)).addUserOption(o=>o.setName("to").setDescription("Account to move stats TO").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("suspended").setDescription("[Owner] List exchangers suspended pending review").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("reinstate").setDescription("[Owner] Lift an exchanger's suspension").addUserOption(o=>o.setName("user").setDescription("The exchanger to reinstate").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("clearexchanger").setDescription("[Owner] Clear an exchanger of all doubt: lifts any freeze, hold, flag and pending check").addUserOption(o=>o.setName("user").setDescription("The exchanger to clear").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("profittest").setDescription("[Owner] Send a test profit-split notice to everyone who receives them").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("mmadmin").setDescription("[Owner] Manage the built-in server middleman bot")
    .addStringOption(o=>o.setName("action").setDescription("What to do (default: status)").addChoices(...MM_ADMIN_ACTIONS.map(([v,n])=>({name:n.slice(0,100),value:v}))).setRequired(false))
    .addStringOption(o=>o.setName("value").setDescription("Extra detail for the action, if it needs one").setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("pricecheck").setDescription("[Owner] Test every price source for a coin (default XMR)").addStringOption(o=>o.setName("coin").setDescription("Coin to test, for example XMR").setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("resetstats").setDescription("[Owner] Reset a user's volume adjustment back to 0").addUserOption(o=>o.setName("user").setDescription("User").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("clearleaderboard").setDescription("[Owner] Wipe all exchange data from leaderboard and stats").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("wipestats").setDescription("[Owner] Completely wipe ALL stats and tickets for a single user").addUserOption(o=>o.setName("user").setDescription("User to wipe").setRequired(true)).addStringOption(o=>o.setName("confirm").setDescription('Type "CONFIRM" to proceed').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("complete").setDescription("[Owner] Mark this exchange as complete and tag the exchanger").addUserOption(o=>o.setName("exchanger").setDescription("The exchanger who handled this deal").setRequired(true)).addNumberOption(o=>o.setName("amount").setDescription("Override the amount in USD (optional)").setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("dispute").setDescription("Flag an issue with your current exchange \u2014 locks ticket and alerts staff"),
  // FIXED: message (required) BEFORE days (optional)
  new SlashCommandBuilder().setName("broadcast").setDescription("[Owner] DM all clients who exchanged in the last X days").addStringOption(o=>o.setName("message").setDescription("Message to send").setRequired(true)).addIntegerOption(o=>o.setName("days").setDescription("How many days back to look (default 30)").setMinValue(1).setMaxValue(365).setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("myexchanges").setDescription("View your personal exchange history and stats"),
  new SlashCommandBuilder().setName("estimate").setDescription("Get a full quote for an exchange before opening a ticket").addNumberOption(o=>o.setName("amount").setDescription("Amount in USD").setRequired(true)).addStringOption(o=>o.setName("method").setDescription("Payment method (e.g. PayPal, Interac)").setRequired(true)).addStringOption(o=>o.setName("coin").setDescription("Crypto (BTC, ETH, SOL)").setRequired(true)).addStringOption(o=>o.setName("direction").setDescription("Which direction?").setRequired(true).addChoices({name:"Send fiat, receive crypto",value:"send"},{name:"Send crypto, receive fiat",value:"receive"})),
  new SlashCommandBuilder().setName("receipt").setDescription("[Owner] Look up a receipt by exchange ID or user").addStringOption(o=>o.setName("query").setDescription("Exchange ID (e.g. KV-ABC123) or @user mention").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("setlivefeed").setDescription("[Owner] Set a channel to show live exchange notifications").addChannelOption(o=>o.setName("channel").setDescription("Channel to post live feed").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("togglefeed").setDescription("[Owner] Turn the live exchange feed on or off").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("serverinfo").setDescription("[Owner] Quick overview of server and bot stats").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("clientinfo").setDescription("[Owner] Full info on any client").addUserOption(o=>o.setName("user").setDescription("User to look up").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("postleaderboard").setDescription("[Owner] Post a live leaderboard that auto-updates after every exchange").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("grantowner").setDescription("Grant full owner permissions to a user").addUserOption(o=>o.setName("user").setDescription("User to grant owner access").setRequired(true)).addStringOption(o=>o.setName("confirm").setDescription('Type "CONFIRM" to proceed').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("revokeowner").setDescription("Remove owner permissions from a user").addUserOption(o=>o.setName("user").setDescription("User to revoke").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("listowners").setDescription("List all current bot owners").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("setdualpromo").setDescription("[Owner] Set a dual-server promo (must be in both servers)").addNumberOption(o=>o.setName("fee").setDescription("Fee % to charge (0 = free, 2 = 2%)").setRequired(true)).addIntegerOption(o=>o.setName("days").setDescription("How many days to run").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("dualpromooff").setDescription("[Owner] Turn off the dual-server promo").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("promostatus").setDescription("[Owner] Check active promos and days remaining").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("createpromo").setDescription("[Owner] Create a promo code that gives clients a fee discount").addStringOption(o=>o.setName("code").setDescription("The promo code word (e.g. konvert2026)").setRequired(true)).addNumberOption(o=>o.setName("discount").setDescription("Fee % to subtract (e.g. 2 = 2% off)").setRequired(true)).addIntegerOption(o=>o.setName("maxuses").setDescription("Max number of uses (leave blank = unlimited)").setRequired(false)).addIntegerOption(o=>o.setName("hours").setDescription("Expires after X hours (leave blank = never)").setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("endpromo").setDescription("[Owner] End/deactivate a promo code").addStringOption(o=>o.setName("code").setDescription("The promo code to end").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("editpromo").setDescription("[Owner] Edit an existing promo code").addStringOption(o=>o.setName("code").setDescription("The promo code to edit").setRequired(true)).addStringOption(o=>o.setName("newcode").setDescription("Rename the code to something new").setRequired(false)).addNumberOption(o=>o.setName("discount").setDescription("New discount % off the fee (e.g. 25 = 25% off the fee amount)").setRequired(false)).addIntegerOption(o=>o.setName("maxuses").setDescription("New max uses (0 = unlimited)").setRequired(false)).addIntegerOption(o=>o.setName("addhours").setDescription("Extend expiry by X more hours").setRequired(false)).addStringOption(o=>o.setName("status").setDescription("Activate or deactivate").setRequired(false).addChoices({name:"Active",value:"active"},{name:"Paused",value:"paused"})).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("listpromos").setDescription("[Owner] View all active promo codes").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("rank").setDescription("See your rank on the leaderboard").addUserOption(o=>o.setName("user").setDescription("User to check (leave blank for yourself)").setRequired(false)),
  new SlashCommandBuilder().setName("setmywallet").setDescription("[Exchanger] Save one of your wallet addresses").addStringOption(o=>o.setName("coin").setDescription("Coin (BTC, ETH, SOL, LTC, USDT-BNB, USDT-ETH)").setRequired(true)).addStringOption(o=>o.setName("address").setDescription("Your wallet address for this coin").setRequired(true)),
  new SlashCommandBuilder().setName("mywallets").setDescription("[Exchanger] View your saved wallet addresses"),
  new SlashCommandBuilder().setName("postwallets").setDescription("[Exchanger] Post your wallet addresses in this ticket"),
  new SlashCommandBuilder().setName("clearwallet").setDescription("[Exchanger] Remove a saved wallet address").addStringOption(o=>o.setName("coin").setDescription("Coin to remove").setRequired(true)),
  new SlashCommandBuilder().setName("alert").setDescription("Get a DM when a coin hits your target price").addStringOption(o=>o.setName("coin").setDescription("Coin ticker e.g. BTC").setRequired(true)).addNumberOption(o=>o.setName("price").setDescription("Target price in USD").setRequired(true)).addStringOption(o=>o.setName("direction").setDescription("Alert when price goes above or below").setRequired(true).addChoices({name:"Above",value:"above"},{name:"Below",value:"below"})),
  new SlashCommandBuilder().setName("myalerts").setDescription("View your active price alerts"),
  new SlashCommandBuilder().setName("clearalerts").setDescription("Remove all your price alerts"),
  new SlashCommandBuilder().setName("exchangerstats").setDescription("View your exchanger performance stats").addUserOption(o=>o.setName("user").setDescription("Exchanger to check").setRequired(false)),
  new SlashCommandBuilder().setName("tierlist").setDescription("See all client tiers and their requirements"),
  new SlashCommandBuilder().setName("claimtag").setDescription("Manually activate your KONV tag perk if auto-detection did not work"),
  new SlashCommandBuilder().setName("giveaway").setDescription("[Owner] Start a KONV-tag-only giveaway").addStringOption(o=>o.setName("prize").setDescription("Prize description").setRequired(true)).addIntegerOption(o=>o.setName("minutes").setDescription("Duration in minutes").setRequired(true)).addIntegerOption(o=>o.setName("winners").setDescription("Number of winners (default 1)").setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("giveawayend").setDescription("[Owner] End active giveaway early").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("migrateserver").setDescription("[Owner] Re-post all historical vouches to current vouch channel after server move").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("giveawaystats").setDescription("[Owner] Check current giveaway entry count and entrants").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("giveawayreroll").setDescription("[Owner] Reroll winners from the last giveaway").addIntegerOption(o=>o.setName("winners").setDescription("How many winners to reroll (default 1)").setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("removetag").setDescription("[Owner] Remove KONV tag perk from a user").addUserOption(o=>o.setName("user").setDescription("User to remove (leave blank to remove yourself)").setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("jbtc").setDescription("[Owner] Set your BTC wallet address").addStringOption(o=>o.setName("address").setDescription("BTC address").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("jeth").setDescription("[Owner] Set your ETH wallet address").addStringOption(o=>o.setName("address").setDescription("ETH address").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("jsol").setDescription("[Owner] Set your SOL wallet address").addStringOption(o=>o.setName("address").setDescription("SOL address").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("jltc").setDescription("[Owner] Set your LTC wallet address").addStringOption(o=>o.setName("address").setDescription("LTC address").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("jusdtbnb").setDescription("[Owner] Set your USDT-BNB wallet address").addStringOption(o=>o.setName("address").setDescription("USDT BNB address").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("setfeemode").setDescription("[Owner] Switch between standard (5-10%) and reduced (5-9%) fee tiers").addStringOption(o=>o.setName("mode").setDescription("Fee mode").setRequired(true).addChoices({name:"Standard (5-10%)",value:"standard"},{name:"Reduced (5-9%)",value:"reduced"})).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),  new SlashCommandBuilder().setName("queue").setDescription("[Exchanger] See the tickets waiting for an exchanger"),
  new SlashCommandBuilder().setName("help").setDescription("How Konvert works and the commands you need").addStringOption(o=>o.setName("topic").setDescription("Open one topic in full (leave blank for the short guide)").setRequired(false).addChoices(...GUIDE_CHOICES)),
  new SlashCommandBuilder().setName("postguide").setDescription("[Owner] Post the short guide in this channel").addStringOption(o=>o.setName("topic").setDescription("Post one topic in full instead (leave blank for the short guide)").setRequired(false).addChoices(...GUIDE_CHOICES)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
].map(c=>c.toJSON());

async function registerCommands(){
  const _regRest=new REST({version:"10"}).setToken(CONFIG.TOKEN);
  console.log("Registering commands...");
  try{
    const _regRes=await _regRest.put(Routes.applicationGuildCommands(CONFIG.CLIENT_ID,CONFIG.GUILD_ID),{body:COMMANDS});
    guideSetCommandIds(_regRes);
    console.log(`Commands registered. (${COMMANDS.length} total)`);
    // Clean up old bot global commands to prevent duplicates showing
    try{
      const _globalCmds=await _regRest.get(Routes.applicationCommands(CONFIG.CLIENT_ID));
      if(_globalCmds&&_globalCmds.length>0){
        for(const cmd of _globalCmds)await _regRest.delete(Routes.applicationCommand(CONFIG.CLIENT_ID,cmd.id)).catch(()=>{});
        console.log(`[startup] Cleared ${_globalCmds.length} global commands`);
      }
    }catch{}
  }catch(e){
    console.error("[registerCommands] FAILED:",e.message);
    if(e.rawError)console.error("[registerCommands] Discord error:",JSON.stringify(e.rawError));
    // Don't crash the bot — still login even if command registration fails
  }
}

function mainEmbed(){
  return kEmbed().setTitle("Exchange with Konvert")
    .setDescription(`${kHero("Simple · Smooth · Seamless")}\nPress **Exchange Now** to open a private ticket. Choose your payment method. **You can select more than one**, and the exchangers for each are pinged at once, so your ticket is claimed faster.\n​`)
    .addFields(
      {name:"Fee",value:`5% – 10%, tiered\nMinimum fee ${fmtUSD(CONFIG.MIN_FEE)} per exchange`,inline:true},
      {name:"Minimum Amount",value:`${fmtUSD(CONFIG.MIN_AMOUNT)} per exchange`,inline:true},
      {name:`Payment Methods  ·  choose up to ${MAX_TICKET_METHODS}`,value:"PayPal · Cash App · Zelle · Interac · Venmo · Apple Pay · Google Pay · Skrill · Revolut · Bank · Wire · IBAN · UPI · Gift Card",inline:false},
      {name:"Crypto",value:"BTC · ETH · SOL · LTC · USDT · USDC · XRP · BNB · ADA · DOGE · and more",inline:false},
    ).setThumbnail(IMG.LOGO).setImage(IMG.BANNER).setFooter(kFoot("Fast · Safe · Simple"));
}
// The backup server (Konvert 2). BACKUP_INVITE_URL can change the link without touching the code; /postbackup link:... overrides it for one post.
const BACKUP_INVITE="https://discord.gg/aD5hGD5UX8";
// An invite typed any usual way ("discord.gg/abc", "https://discord.com/invite/abc") as one tidy https://discord.gg/abc link, or null when it is not an invite
function cleanInvite(raw){
  const m=/^(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/([A-Za-z0-9-]{2,32})\/?$/i.exec(String(raw||"").trim());
  return m?`https://discord.gg/${m[1]}`:null;
}
const backupInvite=()=>cleanInvite(process.env.BACKUP_INVITE_URL)||BACKUP_INVITE;
function backupEmbed(url){
  const link=cleanInvite(url)||backupInvite();
  return kEmbed("Backup Server").setTitle("Official Backup Server").setThumbnail(IMG.LOGO)
    .setDescription(`${kHero("Never lose access")}\nJoin the backup server now so you can always reach **C2C swaps** and **fiat exchanges**, even if this server is ever down, locked or restricted.\n​`)
    .addFields(
      {name:"Join Now",value:"Takes a few seconds. Do it before you need it.",inline:true},
      {name:"Invite",value:link,inline:true},
      {name:"Stay Safe",value:"This is the only official backup link. Any other invite claiming to be Konvert is an impersonator.",inline:false},
    ).setImage(IMG.BANNER).setFooter(kFoot("Official backup"));
}
const backupRow=url=>new ActionRowBuilder().addComponents(kLink("Join Backup Server",cleanInvite(url)||backupInvite()));
// Backup posts made before v15 show the Invite line as raw text. This finds them in the channels named like "backup" and rewrites that line as a plain link,
// keeping the invite that was posted (the button under the post is not touched). A post that is already fine is left alone, so running it again changes nothing.
async function healBackupPosts(guild){
  let fixed=0;
  if(!guild||!guild.channels||!guild.channels.cache)return 0;
  for(const ch of guild.channels.cache.values()){
    if(!ch||!/backup/i.test(String(ch.name||""))||!ch.messages||typeof ch.isTextBased!=="function"||!ch.isTextBased())continue;
    let msgs;
    try{msgs=await ch.messages.fetch({limit:50});}catch{continue;}
    for(const m of msgs.values()){
      const e=m.author&&client.user&&m.author.id===client.user.id&&m.embeds&&m.embeds[0];
      if(!e||e.title!=="Official Backup Server")continue;
      const f=(e.fields||[]).find(x=>x.name==="Invite");
      if(!f||!/\]\(/.test(String(f.value)))continue;
      const url=cleanInvite((/\((https?:\/\/[^)\s]+)\)/.exec(String(f.value))||[])[1]);
      if(!url)continue;
      try{await m.edit({embeds:[backupEmbed(url)]});fixed++;}catch(err){console.log("[backup] could not fix a post:",err.message);}
    }
  }
  if(fixed)console.log(`[backup] made the Invite link clickable on ${fixed} post(s)`);
  return fixed;
}
const confirmRow=()=>new ActionRowBuilder().addComponents(kBtn("btn_confirm_ticket","Confirm & Open Ticket",ButtonStyle.Success),kBtn("btn_cancel_ticket","Cancel",ButtonStyle.Secondary));
function mainButtons(){
  return [new ActionRowBuilder().addComponents(
    kBtn("btn_exchange_now","Exchange Now",ButtonStyle.Primary),
    kBtn("btn_fee_calc","Calculate Fee",ButtonStyle.Secondary),
  )];
}
function step1Embed(){
  return kEmbed().setTitle("Step 1 · Choose Your Payment Method").setThumbnail(IMG.LOGO)
    .setDescription(`${kHero("One is fine. More is faster.")}\nChoose the payment method you use. **You can select more than one** (up to ${MAX_TICKET_METHODS}): exchangers for every method you pick are pinged at once, so the first one available can take your ticket.\n\nTick what works for you, then press **Select** (on desktop, click outside the menu).\n${kNote("Gift Card, Buy For You and Custom Exchange are chosen on their own.")}\n​`)
    .setFooter(kFoot("Step 1 of 3"));
}
// Step 1's controls: a menu of payment methods (pick up to MAX_TICKET_METHODS) and, under it, the flows that are chosen on their own
function methodPickRows(){
  const std=METHODS.filter(m=>!isSoloMethod(m.value));
  const menu=new StringSelectMenuBuilder().setCustomId("select_method").setPlaceholder("Choose a method (select more to speed it up)...")
    .setMinValues(1).setMaxValues(Math.min(MAX_TICKET_METHODS,std.length))
    .addOptions(std.map(m=>new StringSelectMenuOptionBuilder().setLabel(m.label).setValue(m.value).setDescription(`Exchange crypto with ${m.label}`)));
  const solo=SOLO_METHODS.map(getMethod).filter(Boolean).map(m=>kBtn(`btn_pick__${m.value}`,m.label,ButtonStyle.Secondary));
  return [new ActionRowBuilder().addComponents(menu),new ActionRowBuilder().addComponents(...solo)];
}
// Step 2's two direction buttons for the methods picked. One method keeps the ids and labels it always had; several carry their methods in the id.
const fitLabel=(s,alt)=>s.length<=80?s:alt;
function directionRow(list){
  const tag=methodTag(list),lbl=list.length>1?methodsLabel(list):getMethod(list[0]).label;
  return new ActionRowBuilder().addComponents(
    kBtn(`dir_send__${tag}`,fitLabel(`Send Crypto → Get ${lbl}`,"Send Crypto → Get Paid"),ButtonStyle.Primary),
    kBtn(`dir_receive__${tag}`,fitLabel(`Send ${lbl} → Get Crypto`,"Send Payment → Get Crypto"),ButtonStyle.Primary));
}
// Step 2's buttons: the two directions and, when only one ordinary method was picked, a way to add more before the ticket exists
function step2Rows(list,opts){
  const rows=[directionRow(list)],one=list.length===1?list[0]:null;
  if(one&&getMethod(one)&&!isSoloMethod(one)&&!(opts&&opts.noMore))rows.push(new ActionRowBuilder().addComponents(kBtn(`btn_more__${methodTag(list)}`,"Add More Methods",ButtonStyle.Secondary)));
  return rows;
}
// "Add More Methods": the other ordinary methods, up to the limit, and a way to carry on with what was picked
function moreRows(cur){
  const room=MAX_TICKET_METHODS-cur.length,opts=METHODS.filter(m=>!isSoloMethod(m.value)&&!cur.includes(m.value));
  const menu=new StringSelectMenuBuilder().setCustomId(`sel_more__${methodTag(cur)}`).setPlaceholder(room===1?"Add one more method...":`Add up to ${room} more methods...`)
    .setMinValues(1).setMaxValues(Math.min(room,opts.length))
    .addOptions(opts.map(m=>new StringSelectMenuOptionBuilder().setLabel(m.label).setValue(m.value).setDescription(`Also accept ${m.label}`)));
  return [new ActionRowBuilder().addComponents(menu),new ActionRowBuilder().addComponents(kBtn(`btn_nomore__${methodTag(cur)}`,`Keep ${methodsLabel(cur)} Only`,ButtonStyle.Secondary))];
}
function moreEmbed(cur){
  const room=MAX_TICKET_METHODS-cur.length;
  return kEmbed().setTitle("Add More Methods").setThumbnail(IMG.LOGO)
    .setDescription(`${kHero(methodsLabel(cur))}\nAdd ${room===1?"one more method":`up to ${room} more`}. Exchangers for every method are pinged at once, so your ticket is claimed faster.\n\nTick the ones that work for you, then press **Select** (on desktop, click outside the menu).`)
    .setFooter(kFoot("Step 1 of 3"));
}
// A modal title is 45 characters at most
function modalTitle(label,n,sendCrypto){
  const tail=sendCrypto?"Send Crypto":"Receive Crypto",t=`${label} · ${tail}`;
  return t.length<=45?t:`${n} methods · ${tail}`;
}
const minLine=()=>kNote(minFeeText());
function step2MultiEmbed(list){
  const lbl=methodsLabel(list),or=joinOr(list.map(methodLabel));
  return kEmbed().setTitle(`Step 2 · ${lbl}`)
    .setDescription(`${kHero("Choose your direction")}\n**Send Crypto → Get ${lbl}**\nYou send crypto and we pay you through ${or}.\n\n**Send ${lbl} → Get Crypto**\nYou pay through ${or} and we send crypto to your wallet.\n\n${kNote("Exchangers for every method are pinged at once. Whoever claims it sets the method.")}\n\n${minLine()}`)
    .setFooter(kFoot("Step 2 of 3"));
}
function step2Embed(method,opts){
  if(Array.isArray(method)){if(method.length>1)return step2MultiEmbed(method);method=method[0];}
  const m=getMethod(method);
  if(method==="crypto"){return kEmbed().setTitle("Step 2 · Crypto to Crypto").setDescription(`${kHero("Send one coin, receive another")}\nFor example: send SOL, receive BTC.\n\nSelect your coins below.\n\n${minLine()}`).setFooter(kFoot("Step 2 of 3"));}
  if(method==="buyforyou")return kEmbed().setTitle("Buy For You").setDescription(`Tell us what you want us to purchase and we will handle it.\n\nDescribe the item, link, and amount in your ticket — a helper will reach out.\n\n${minLine()}`).setFooter(kFoot("Step 2 of 3"));
  if(method==="custom")return kEmbed().setTitle("Custom Exchange").setDescription(`Something unique? No problem.\n\nExplain what you need in your ticket and a helper will assist you.\n\n${minLine()}`).setFooter(kFoot("Step 2 of 3"));
  return kEmbed().setTitle(`Step 2 · ${m.label}`)
    .setDescription(`${kHero("Choose your direction")}\n**Send Crypto → Get ${m.label}**\nYou send crypto and we pay you through ${m.label}.\n\n**Send ${m.label} → Get Crypto**\nYou pay through ${m.label} and we send crypto to your wallet.\n\n${!isSoloMethod(method)&&!(opts&&opts.noTip)?`${kNote(`Tip: only ${m.label} exchangers are pinged. Add more methods to speed it up, and any of them can claim your ticket.`)}\n\n`:""}${minLine()}`)
    .setFooter(kFoot("Step 2 of 3"));
}

const RATES_CHANNEL_ID=process.env.RATES_CHANNEL_ID||null;

async function buildRatesEmbed(){
  const ids=RATE_COINS.map(c=>GECKO[c]).join(",");
  const [qs,cadP]=await Promise.all([
    quoteMany(RATE_COINS,6500).catch(()=>({})),
    _getJSON(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=cad`,_cgHeaders()).catch(()=>({})),
  ]);
  let cadPer=1.37;      // CAD per USD: taken from CoinGecko's own prices when it answered, else the usual rate
  for(const c of RATE_COINS){const x=cadP[GECKO[c]]&&cadP[GECKO[c]].cad,u=qs[c]&&qs[c].usd;if(x>0&&u>0){cadPer=x/u;break;}}
  const px=n=>n>=0.01?Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}):fmtPrice(n);
  const anyLive=RATE_COINS.some(c=>!STABLE.has(c)&&qs[c]);      // the two stablecoins alone would make a panel that looks live when nothing is
  const lines=!anyLive?"":RATE_COINS.map(coin=>{
    const q=qs[coin];
    if(!q)return null;
    const ch=q.change||0,g=cadP[GECKO[coin]],cadNum=g&&g.cad>0?g.cad:q.usd*cadPer;
    return `\`${coin.padEnd(5)}\` **$${px(q.usd)}**  ·  CA$${px(cadNum)}  ·  ${ch>=0?"▲":"▼"} ${ch.toFixed(2)}%`;
  }).filter(Boolean).join("\n");
  const now=new Date(),next=new Date(now.getTime()+30*60*1000);
  return kEmbed().setTitle(`Live Rates`).setThumbnail(IMG.LOGO)
    .setDescription((lines||"Unable to fetch rates right now.")+"\n\u200b")
    .addFields({name:`Exchange`,value:`Open a ticket in <#${CONFIG.EXCHANGE_CHANNEL}>`,inline:true},{name:`Tip`,value:"Type **$BTC**, **$ETH** etc. for live price",inline:true})
    .setImage(IMG.BANNER).setFooter(kFoot(`Updates every 30 min  ·  Next: ${next.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})}`)).setTimestamp();
}

function buildMineGrid(userId,game){
  const rows=[];
  for(let r=0;r<5;r++){
    const row=new ActionRowBuilder();
    for(let c=0;c<5;c++){
      const idx=r*5+c;
      const rev=game.revealed.includes(idx);
      const isDiamond=game.diamonds.includes(idx);
      let label,style;
      if(rev||game.over){
        if(isDiamond){label="PASS";style=ButtonStyle.Success;}
        else{label="BOMB";style=ButtonStyle.Danger;}
      } else {
        label="\u25A0";  // filled square — clean unrevealed
        style=ButtonStyle.Secondary;
      }
      row.addComponents(new ButtonBuilder().setCustomId(`mine_cell_${userId}_${idx}`).setLabel(label).setStyle(style).setDisabled(rev||game.over));
    }
    rows.push(row);
  }
  return rows;
}

function buildDealEmbed({clientId,exchangerId,method,methodValue,amountUSD,direction,coin,message,rating,recvCoin,feeUSD}){
  const d=dealOf({method:methodValue||method,direction,coin,recvCoin,amountUSD,feeUSD});          // "$100.00 Interac → $90.00 ETH"
  const embed=new EmbedBuilder()
    .setColor(UI.ok)
    .setAuthor(kAuthor("Exchange Verified"))
    .setTitle(`Exchange Complete`)
    .setDescription(dealHead(d))
    .addFields(
      {name:"Client",value:`<@${clientId}>`,inline:true},
      {name:"Exchanger",value:`<@${exchangerId}>`,inline:true},
    );
  if(message)embed.addFields({name:"Review",value:message,inline:false});
  embed.setImage(IMG.BANNER).setTimestamp().setFooter(kFoot("Verified"));
  return embed;
}

async function endGiveaway(guild,channel){
  if(!state.activeGiveaway)return;
  const {messageId,channelId,prize,numWinners,entrants}=state.activeGiveaway;
  state.activeGiveaway=null;
  state.lastGiveaway={prize,entrants:[...entrants],numWinners,channelId};
  const arr=[...entrants];
  if(!arr.length){
    await channel.send({embeds:[new EmbedBuilder().setColor(0xef4444).setTitle("Giveaway Over").setDescription(`Prize: **${prize}**\n\nNo one entered.`).setTimestamp()]}).catch(()=>{});
    return;
  }
  const winners=[];const pool=[...arr];
  while(winners.length<Math.min(numWinners,pool.length)){const idx=Math.floor(Math.random()*pool.length);winners.push(pool.splice(idx,1)[0]);}
  const wMentions=winners.map(id=>`<@${id}>`).join(", ");
  await channel.send({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange  ·  Giveaway",iconURL:IMG.LOGO}).setTitle("Giveaway Ended!").setDescription(`**Prize:** ${prize}\n\n**Winner${winners.length>1?"s":""}:** ${wMentions}\n\nCongratulations! Staff will reach out.`).addFields({name:"Total Entries",value:`**${arr.length}**`,inline:true}).setImage(IMG.BANNER).setTimestamp()]}).catch(()=>{});
  try{const gc=guild.channels.cache.get(channelId);if(gc){const gm=await gc.messages.fetch(messageId).catch(()=>null);if(gm){const dr=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("btn_giveaway_enter").setLabel("Giveaway Ended").setStyle(ButtonStyle.Secondary).setDisabled(true));await gm.edit({components:[dr]}).catch(()=>{});}}}
  catch{}
}

async function postVouch(guild,data){
  if(!CONFIG.VOUCH_CHANNEL){console.error("postVouch: VOUCH_CHANNEL_ID not set");return;}
  const ch=guild.channels.cache.get(CONFIG.VOUCH_CHANNEL);
  if(!ch){console.error("postVouch: channel not found:",CONFIG.VOUCH_CHANNEL);return;}
  try{await ch.send({embeds:[buildDealEmbed(data)]});}catch(e){console.error("postVouch error:",e.message);}
}

// ── Who can see a ticket ─────────────────────────────────────
const OWNER_CHANNEL_ALLOW=[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.ManageChannels];
// Every owner gets full access to every ticket channel (exchange, custom and support). An owner who isn't in the member cache is looked up instead of
// skipped, which is how a ticket could end up invisible to them. Anyone who really isn't in the server is left out, because Discord rejects the whole
// channel for an overwrite that points at a non-member.
async function ownerOverwrites(guild){
  const out=[];
  for(const oid of CONFIG.OWNER_IDS){
    let here=guild.members.cache.has(oid);
    if(!here)here=!!(await guild.members.fetch(oid).catch(()=>null));
    if(here)out.push({id:oid,allow:[...OWNER_CHANNEL_ALLOW]});
  }
  return out;
}
// Adds a permission overwrite, merging into the one already there for the same id (Discord rejects duplicates; an owner can be the client)
function addOverwrite(perms,entry){
  const cur=perms.find(p=>p.id===entry.id);
  if(!cur){perms.push({id:entry.id,...(entry.allow?{allow:[...entry.allow]}:{}),...(entry.deny?{deny:[...entry.deny]}:{})});return perms;}
  const allow=new Set([...(cur.allow||[]),...(entry.allow||[])]);
  const deny=[...new Set([...(cur.deny||[]),...(entry.deny||[])])].filter(x=>!allow.has(x));
  cur.allow=[...allow];
  if(deny.length)cur.deny=deny;else delete cur.deny;
  return perms;
}
// Support tickets aren't stored as exchange tickets, so the channel itself says who opened it (its topic). Channels from before that was added are
// recognised by their name (support-xxxx) inside the ticket category; the opener is then the one non-owner member who can see the channel.
const SUPPORT_TOPIC="Konvert support ticket | user:";
function supportTicketOf(channel){
  try{
    if(!channel||!channel.id||channel.id===SUPPORT_CH||channel.id===CONFIG.EXCHANGE_CHANNEL)return null;
    const m=String(channel.topic||"").match(/^Konvert support ticket \| user:(\d{15,25})\b/);
    if(m)return {userId:m[1],legacy:false};
    if(!/^support-[a-z0-9]{0,12}$/.test(String(channel.name||"")))return null;
    if(CONFIG.TICKET_CATEGORY&&channel.parentId!==CONFIG.TICKET_CATEGORY)return null;
    let opener=null;
    const ows=channel.permissionOverwrites&&channel.permissionOverwrites.cache;
    if(ows)for(const o of ows.values()){
      if(o.type!==1||CONFIG.OWNER_IDS.includes(o.id))continue;
      if(o.allow&&o.allow.has&&o.allow.has(PermissionFlagsBits.ViewChannel)){opener=o.id;break;}
    }
    return {userId:opener,legacy:true};
  }catch{return null;}
}

async function createTicket(interaction,method,direction,amountUSD,coin,walletInfo,notes,recvCoin,methods){
  const guild=interaction.guild,user=interaction.user,m=getMethod(method)||(method==="crypto"?{label:"Crypto to Crypto",value:"crypto"}:null);
  if(!m){await interaction.editReply({content:"That payment method isn't available any more. Please start again.",embeds:[],components:[]});return null;}
  const _picked=pickedMethods([method,...(Array.isArray(methods)?methods:[])]),multi=_picked.length>1?_picked:[];     // [] = an ordinary single-method ticket
  const accepted=multi.length?multi:[method];
  // No ticket below the minimum amount, whatever got us here (the minimum fee would leave nothing to exchange)
  if(!aboveMinimum(Number(amountUSD))){await interaction.editReply({content:minAmountText(),embeds:[],components:[]});return null;}
  const tickets=load("tickets");
  // Count open tickets where the channel still actually exists (no ghost tickets)
  const openTickets=Object.entries(tickets).filter(([id,t])=>t.userId===user.id&&t.status==="open"&&guild.channels.cache.has(id));
  // Clean up any ghost entries (channel deleted but status still "open")
  let ghostCleaned=false;
  for(const [id,t] of Object.entries(tickets)){if(t.userId===user.id&&t.status==="open"&&!guild.channels.cache.has(id)){tickets[id].status="closed";tickets[id].closedAt=Date.now();ghostCleaned=true;}}
  if(ghostCleaned){_mem.tickets=tickets;save("tickets",tickets);}
  if(openTickets.length>=3){await interaction.editReply({content:`You already have **${openTickets.length}** open tickets. Please complete or close one before opening another.`,embeds:[],components:[]});return null;}
  const _clientVol=getUserVolume(user.id),_isVip=isVipVolume(_clientVol);
  const _tagMember=guild&&guild.members&&guild.members.cache?guild.members.cache.get(user.id):null;
  const _hasTag=isKonvTag(user.id,_tagMember);
  // Check dual-server promo
  let _dualPromoActive=false;
  let _dualPromoFee=null;
  if(state.dualPromo&&state.dualPromo.active&&Date.now()<state.dualPromo.expiresAt){
    const _inSecond=await isDualMember(user.id);
    if(_inSecond){_dualPromoActive=true;_dualPromoFee=state.dualPromo.feePercent;}
  }
  const _isC2C=method==="crypto";
  const _isGiftCard=method==="giftcard";
  const feeUSD=_isC2C?Math.max(amountUSD*0.02,3):_isGiftCard?0:_dualPromoActive?Math.max(amountUSD*(_dualPromoFee/100),0):calcFeeWithTag(amountUSD,direction,_isVip,_hasTag);
  const rate=_isC2C?2:_isGiftCard?null:feeRate(amountUSD,direction,_isVip);
  const receiveU=_isGiftCard?amountUSD:amountUSD-feeUSD;
  let coinAmt=null;
  try{const _cp=await Promise.race([getPrice(coin),new Promise(r=>setTimeout(()=>r(null),2000))]);if(_cp)coinAmt=(receiveU/_cp).toFixed(6);}catch{}
  const rec={userId:user.id,userTag:user.tag,method:accepted[0],...(multi.length?{methods:multi}:{}),direction,coin,recvCoin:recvCoin||null,amountUSD,feeUSD,walletInfo,notes:notes||"",status:"open",claimSystem:true,createdAt:Date.now()};
  const d=dealOf(rec);              // the deal, worded once and used on every card of this ticket
  const _rateShown=_isGiftCard?null:(_dualPromoActive?_dualPromoFee:rate);
  const _coinAmt=(!_isC2C&&direction==="send"&&coinAmt)?coinAmt:null;
  const perms=[{id:guild.roles.everyone,deny:[PermissionFlagsBits.ViewChannel]},{id:user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]}];
  if(CONFIG.STAFF_ROLE&&guild.roles.cache.has(CONFIG.STAFF_ROLE))perms.push({id:CONFIG.STAFF_ROLE,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.ManageChannels]});
  const mRoleIds=rolesForMethods(accepted);          // the exchanger role of every method the ticket accepts
  for(const rid of mRoleIds)if(rid!==CONFIG.STAFF_ROLE&&guild.roles.cache.has(rid))perms.push({id:rid,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.ReadMessageHistory],deny:[PermissionFlagsBits.SendMessages]});
  // Helpers take custom / buy-for-you orders (the embed pings them), so they have to be able to see the channel
  if((method==="custom"||method==="buyforyou")&&CONFIG.HELPER_ROLE&&guild.roles.cache.has(CONFIG.HELPER_ROLE))addOverwrite(perms,{id:CONFIG.HELPER_ROLE,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]});
  for(const o of await ownerOverwrites(guild))addOverwrite(perms,o);        // owners see and talk in every ticket
  if(guild.roles.cache.has(OWNER_ROLE)&&OWNER_ROLE!==CONFIG.STAFF_ROLE&&!mRoleIds.includes(OWNER_ROLE))addOverwrite(perms,{id:OWNER_ROLE,allow:[...OWNER_CHANNEL_ALLOW]});
  let ch;
  try{ch=await guild.channels.create({name:ticketChannelName(rec,user.username.replace(/[^a-z0-9]/gi,"").toLowerCase().slice(0,4)),type:ChannelType.GuildText,parent:CONFIG.TICKET_CATEGORY||null,topic:d.hero,permissionOverwrites:perms});}
  catch(err){await interaction.editReply({content:`Failed to create ticket: ${err.message}`,embeds:[],components:[]});return null;}
  // Any discount that applies is named under the deal
  const _feeNotes=[];
  if(_dualPromoActive)_feeNotes.push("Dual-member rate");
  else{if(_isVip)_feeNotes.push("VIP rate");if(_hasTag)_feeNotes.push("KONV tag discount");}
  rec.card={notes:_feeNotes,rate:_rateShown,coinAmt:_coinAmt};      // what the ticket card needs to be drawn again when the ticket's methods change
  const ticketEmbed=buildTicketCard(rec,{hint:true});
  const rulesEmbed=kEmbed("Safety","warn")
    .setTitle(`Before You Proceed`)
    .setDescription(
      `**1 · Go-first limit**\nShown in your exchanger's name. Above it, or if it says "Use MM Always", Konvert's built-in server middleman bot holds the crypto inside this ticket. Never send anything before its card appears here.\n\n`
      +"**2 · Impersonators**\n**@3uce** and **@jswaps** never DM first. Anyone who does is an impersonator.\n\n"
      +"**3 · Stay in the ticket**\nKeep every message and every payment detail inside this ticket."
    )
    .setFooter(kFoot("When in doubt, type $mm for the built-in middleman"));
  const btns=claimRow(rec);
  const _panel=await ch.send({content:`<@${user.id}>`,embeds:[ticketEmbed,rulesEmbed],components:[btns]});
  const pingIds=[...mRoleIds];
  if(CONFIG.STAFF_ROLE&&!pingIds.includes(CONFIG.STAFF_ROLE))pingIds.push(CONFIG.STAFF_ROLE);
  rec.panelMessageId=_panel.id;rec.cardMessageId=_panel.id;          // on record before anyone is pinged, so the first exchanger to press Claim always finds the ticket
  {const t0=Object.keys(_mem.tickets||{}).length>0?{..._mem.tickets}:load("tickets");t0[ch.id]=rec;_mem.tickets=t0;save("tickets",t0);}
  if(pingIds.length){            // one line that pings the exchanger role of EVERY method the ticket accepts (named in the allow-list, so it never depends on a default)
    await ch.send({content:`**New ticket**  ·  ${d.hero}  ·  ${pingIds.map(r=>`<@&${r}>`).join(" ")}`,allowedMentions:{roles:pingIds}}).catch(e=>console.error("[ticket] couldn't ping the exchangers:",e.message));
    warnUnpingable(guild,pingIds);
  }
  const _noRole=accepted.filter(v=>!isSoloMethod(v)&&v!=="crypto"&&!(CONFIG.ROLES&&CONFIG.ROLES[v])).map(methodLabel);          // methods nobody can be pinged for (their ROLE_* setting is empty)
  log(guild,`TICKET: #${ch.name} | ${user.tag} | ${d.hero}${multi.length?` | pinged ${mRoleIds.length} method role(s)`:""}${_noRole.length?` | no exchanger role set for ${_noRole.join(", ")}`:""}`);
  return ch;
}

const _closedChannels=new Set();
async function doCloseTicket(channel,guild,closedBy,reason){
  if(_closedChannels.has(channel.id)){console.log("[doCloseTicket] already closing:",channel.id);return;}
  {const _mw=await mmBeforeClose(channel,true).catch(()=>null);if(_mw){await channel.send({content:_mw,allowedMentions:{parse:[]}}).catch(()=>{});return false;}}      // the built-in middleman bot still holds funds: false = nothing was closed, so callers must not delete the channel
  _closedChannels.add(channel.id);
  setTimeout(()=>_closedChannels.delete(channel.id),30000);
  const tickets=Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets");
  if(tickets[channel.id]){if(tickets[channel.id].status!=="vouched"){tickets[channel.id].status="closed";}tickets[channel.id].closedAt=Date.now();_mem.tickets=tickets;save("tickets",tickets);}
  try{
    const msgs=await channel.messages.fetch({limit:100});
    const lines=[...msgs.values()].reverse().map(m=>`[${new Date(m.createdTimestamp).toISOString()}] ${m.author.tag}: ${m.content||"[embed]"}`).join("\n");
    const fname=`transcript-${channel.name}-${Date.now()}.txt`,fpath=`./${fname}`;
    fs.writeFileSync(fpath,lines);
    if(CONFIG.LOG_CHANNEL){const lch=guild.channels.cache.get(CONFIG.LOG_CHANNEL);if(lch)await lch.send({content:`Transcript: **#${channel.name}** closed by ${closedBy.tag}. Reason: ${reason}`,files:[{attachment:fpath,name:fname}]});}
    const _openerId=tickets[channel.id]?tickets[channel.id].userId:((supportTicketOf(channel)||{}).userId||null);
    if(_openerId){try{const mem=await guild.members.fetch(_openerId).catch(()=>null);if(mem){const f2=`tr-dm-${channel.name}.txt`;fs.writeFileSync("./"+f2,lines);await mem.send({content:"Your Konvert ticket has been closed. Transcript attached:",files:[{attachment:"./"+f2,name:f2}]}).catch(()=>{});fs.unlinkSync("./"+f2);}}catch{}}
    for(const oid of CONFIG.OWNER_IDS){try{const o=await guild.members.fetch(oid).then(m=>m.user).catch(()=>null);if(o&&o.id!==closedBy.id){const f3=`tr-owner-${channel.name}.txt`;fs.writeFileSync("./"+f3,lines);await o.send({content:`Transcript: **#${channel.name}** | Closed by: ${closedBy.tag}`,files:[{attachment:"./"+f3,name:f3}]}).catch(()=>{});fs.unlinkSync("./"+f3);}}catch{}}
    fs.unlinkSync(fpath);
  }catch{}
  log(guild,`CLOSED: #${channel.name} by ${closedBy.tag} -- ${reason}`);
  return true;
}

async function sendReceiptDM(clientUserId,exchangerId,ticketData,tradeCount,totalVolume,ticketKey){
  try{
    const clientUser=await client.users.fetch(clientUserId).catch(()=>null);
    if(!clientUser)return;
    const tier=getTier(totalVolume),nextT=getNextTier(totalVolume);
    const tradeId=ticketKey?`KV-${String(ticketKey).slice(-6).toUpperCase()}`:`KV-${Date.now().toString(36).toUpperCase()}`;
    const fee=ticketData.feeUSD!=null?ticketData.feeUSD:calcFee(ticketData.amountUSD,ticketData.direction==="receive"?"receive":"send");
    const d=dealOf({...ticketData,feeUSD:fee});
    await clientUser.send({embeds:[kEmbed("Receipt","ok").setTitle("Exchange Complete")
      .setDescription(`${dealHead(d)}\n${kLedger([["Receipt ID",tradeId],...dealRows(d,{final:true})])}Your exchange has been verified and completed. This is your official receipt.`)
      .addFields(
        {name:"Date",value:`<t:${Math.floor(Date.now()/1000)}:F>`,inline:true},{name:"Exchanger",value:`<@${exchangerId}>`,inline:true},{name:"​",value:"​",inline:true},
        {name:"Your Tier",value:`**${tier.label}**`,inline:true},{name:"Total Exchanges",value:`**${tradeCount}**`,inline:true},{name:"Total Volume",value:`**${fmtUSD(totalVolume)}**`,inline:true},
        {name:nextT?`Next Tier: ${nextT.label}`:"Max Tier Reached",value:nextT?`${fmtUSD(Math.max(nextT.min-totalVolume,0))} away`:"You're at the top. Thank you.",inline:false},
      ).setImage(IMG.DEAL).setFooter(kFoot("Keep this receipt for your records")).setTimestamp()]});
  }catch(e){console.log("[receipt DM]",e.message);}
}

async function completeTrade(interaction,ticket,tickets){
  if(interaction.channel&&mmHolds(interaction.channel.id)){        // last safety net: the built-in middleman bot still holds funds for this ticket
    const note={content:MM_HOLD_TEXT,allowedMentions:{parse:[]}};
    if(interaction._fake)await interaction.channel.send(note).catch(()=>{});else await interaction.editReply(note).catch(()=>{});
    return;
  }
  const m=getMethod(ticket.method);
  if(isMultiMethod(ticket))ticket.methodLocked=true;          // finished without a claim (an owner completed it): the first method is the record
  ticket.status="vouched";ticket.completedBy=ticket._overrideExchangerId||interaction.user.id;delete ticket._overrideExchangerId;ticket.completedAt=Date.now();ticket.amountUSD=parseFloat(ticket.amountUSD)||0;
  const ticketKey=interaction.channel.id;tickets[ticketKey]=ticket;
  _mem.tickets={...(_mem.tickets||{}),...tickets};save("tickets",_mem.tickets);
  if(interaction.guild){updateStatChannel(interaction.guild).catch(()=>{});updateLiveLeaderboard(interaction.guild).catch(()=>{});}
  console.log(`[completeTrade] userId=${ticket.userId} amount=${ticket.amountUSD} total=${Object.keys(_mem.tickets).length}`);
  if(ticket.claimSystem){refreshPanel(interaction.channel,ticket).catch(()=>{});clearConfirmButtons(interaction.channel,ticket).catch(()=>{});}
  requestProfit(interaction.guild,ticketKey,interaction.channel&&interaction.channel.name).catch(e=>console.error("[profit]",e.message));
  const _referredByForVouch=null;
  if(false&&false){
    for(const oid of CONFIG.OWNER_IDS){
      try{
        const owner=await client.users.fetch(oid);
        await owner.send({embeds:[new EmbedBuilder()
          .setColor(0x7C4DFF)
          .setAuthor({name:"Konvert Exchange  ·  Referral Alert",iconURL:IMG.LOGO})
          .setTitle("Referral Exchange Completed")
          .setDescription("An exchange just completed through a referral.\n\u200b")
          .addFields(
            {name:"Client",value:`<@${ticket.userId}>`,inline:true},
            {name:"Amount",value:`**${fmtUSD(ticket.amountUSD)}**`,inline:true},
            {name:"Method",value:`**${methodLabel(ticket.method)}**`,inline:true},
            {name:"Points Earned",value:`**+${calcReferralPoints(ticket.amountUSD)} pts**`,inline:true},
          )
          .setFooter({text:"Konvert Exchange"})
          .setTimestamp()]});
      }catch{}
    }
  }
  await handleReferralTrade(interaction.guild,ticket.userId,ticket.amountUSD);
  if(state.feedEnabled&&state.feedChannel){try{const feedCh=interaction.guild.channels.cache.get(state.feedChannel);if(feedCh){await feedCh.send(`**${dealOf(ticket).hero}**  ·  just now`);}}catch{}}
  try{const _vol=getUserVolume(ticket.userId);console.log(`[tierRole] userId=${ticket.userId} volume=${_vol}`);await applyTierRole(interaction.guild,ticket.userId,_vol);}catch(e){console.log("[tierRole error]",e.message);}
  try{const volume=getUserVolume(ticket.userId);await sendReceiptDM(ticket.userId,interaction.user.id,ticket,getUserDealCount(ticket.userId),volume,ticketKey);}catch{}
  // Completion — 90s window to go vouch in the vouch channel, then auto-close.
  let _vouchPosted=false;
  const _postOnce=async()=>{
    if(_vouchPosted)return;
    _vouchPosted=true;
    await postVouch(interaction.guild,{clientId:ticket.userId,exchangerId:ticket.completedBy,method:methodLabel(ticket.method),methodValue:ticket.method,feeUSD:ticket.feeUSD,amountUSD:ticket.amountUSD,direction:ticket.direction,coin:ticket.coin,recvCoin:ticket.recvCoin||null,message:null,rating:5,referredBy:null});
    updateStatChannel(interaction.guild).catch(()=>{});
    if(await doCloseTicket(interaction.channel,interaction.guild,interaction.user,"Exchange completed")===false)return;
    setTimeout(()=>interaction.channel.delete().catch(()=>{}),2000);
  };
  const _vRow=new ActionRowBuilder().addComponents(
    kLink("Vouch Here",VOUCH_LINK),
    kBtn("skip_vouch","Close Now",ButtonStyle.Secondary)
  );
  const _vPrompt=kEmbed("Ticket","ok")
    .setTitle(`Exchange Complete`)
    .setDescription(`<@${ticket.userId}> — thanks for exchanging with Konvert! Please leave a vouch in <#${VOUCH_POST_CHANNEL}>.`)
    .setFooter(kFoot("This ticket closes in 90 seconds"));
  // Post publicly so the client actually sees it (btn_done defers ephemerally)
  await interaction.channel.send({content:`<@${ticket.userId}>`,embeds:[_vPrompt],components:[_vRow]}).catch(()=>{});
  // Quiet confirmation for whoever triggered it
  if(!interaction._fake){try{await interaction.editReply({content:"Exchange marked complete.",embeds:[],components:[]});}catch{}}
  // Store _postOnce on channel so the Close Now button can call it directly
  if(interaction.channel)interaction.channel._completePostOnce=_postOnce;
  setTimeout(()=>{_postOnce().catch(()=>{});},90*1000);
}

client.on(Events.MessageCreate,async message=>{
 try{
  if(CONFIG.SHORTS_CHANNEL&&message.channel.id===CONFIG.SHORTS_CHANNEL&&!message.author.bot){
    const attachment=message.attachments.find(a=>a.contentType?.startsWith("video/"));
    if(attachment){
      await message.react("\u23F3");
      const filePath=path.join("/tmp",attachment.name);
      try{
        const writer=fs.createWriteStream(filePath);
        const response=await axios({url:attachment.url,method:"GET",responseType:"stream"});
        response.data.pipe(writer);
        await new Promise((resolve,reject)=>{writer.on("finish",resolve);writer.on("error",reject);});
        const title=YT_TITLES[Math.floor(Math.random()*YT_TITLES.length)];
        const desc=YT_DESCRIPTIONS[Math.floor(Math.random()*YT_DESCRIPTIONS.length)];
        const res=await youtube.videos.insert({part:["snippet","status"],requestBody:{snippet:{title,description:desc,tags:["gym motivation","shorts","fitness","workout","motivation"],categoryId:"17"},status:{privacyStatus:"public"}},media:{body:fs.createReadStream(filePath)}});
        await message.react("\u2705");await message.reply(`Posted: https://youtube.com/watch?v=${res.data.id}\n**Title:** ${title}`);fs.unlinkSync(filePath);
      }catch(err){await message.react("\u274C");await message.reply(`Upload failed: ${err.message}`);try{fs.unlinkSync(filePath);}catch{}}
      return;
    }
  }
  if(message.author.bot)return;

  // ── PROMO CODE DETECTION ─────────────────────────────────────────────────
  // If a message in a ticket channel matches an active promo code, apply it
  if(message.channel.type!==undefined){
    const tickets=Object.keys(_mem.tickets||{}).length?_mem.tickets:load("tickets");
    const ticket=tickets[message.channel.id];
    const _sup=ticket?null:supportTicketOf(message.channel);   // a support ticket has no exchange record: the channel says who opened it
    // Suspended exchangers can't speak in any ticket they aren't the client of
    if(ticket&&ticket.status==="open"&&ticket.userId!==message.author.id&&isSuspended(message.author.id)&&!isOwner(message.author.id,message.member)){
      await message.delete().catch(()=>{});
      return;
    }
    // Konvert's built-in server middleman bot: "$mm", "$mm help", or a transaction ID pasted while a deposit is awaited
    if(await mmGlobalCommand(message,ticket||null).catch(err=>{console.error("[mm] owner command:",err.message);return false;}))return;       // owner tools that work anywhere: $mm wallet, deals, send, sweep, close, history
    if(ticket&&ticket.status==="open"&&await mmMessage(message,ticket))return;
    // Payment method prompts
    const _pmCmds={
      "$paypal":{name:"PayPal",color:0x003087,rules:["Send from your **PayPal Balance only** — no card, no bank","Use **Friends & Family** — never Goods & Services","Record the **entire process** start to finish","Failure to follow these steps may result in **loss of funds**"]},
      "$cashapp":{name:"Cash App",color:0x00D632,rules:["Send from your **Cash App Balance only** — no linked card or bank","Record the **entire process** start to finish","Ensure you are sending to the correct **Cashtag**","Failure to follow these steps may result in **loss of funds**"]},
      "$venmo":{name:"Venmo",color:0x3D95CE,rules:["Send from your **Venmo Balance only** — no linked card or bank","Set the payment to **Private** — not public or friends","Record the **entire process** start to finish","Failure to follow these steps may result in **loss of funds**"]},
      "$zelle":{name:"Zelle",color:0x6D1ED4,rules:["Send directly from your **bank account via Zelle**","Once sent, Zelle payments **cannot be reversed** — double check the recipient","Record the **entire process** start to finish","Failure to follow these steps may result in **loss of funds**"]},
      "$interac":{name:"Interac e-Transfer",color:0xFFCC00,rules:["Send via **Interac e-Transfer** from your online banking","Do **not** set a security question unless instructed","Record the **entire process** start to finish","Failure to follow these steps may result in **loss of funds**"]},
      "$applepay":{name:"Apple Pay",color:0x000000,rules:["Send from your **Apple Cash balance** — not a linked card","Only send to contacts confirmed inside this ticket","Record the **entire process** start to finish","Failure to follow these steps may result in **loss of funds**"]},
    };
    const _pmKey=message.content.trim().toLowerCase();
    if(_pmCmds[_pmKey]&&(isExchanger(message.member)||isOwner(message.author.id,message.member))){
      const _pm=_pmCmds[_pmKey];
      const _pmSteps=_pm.rules.slice(0,-1),_pmWarn=_pm.rules[_pm.rules.length-1];
      await message.channel.send({embeds:[new EmbedBuilder()
        .setColor(_pm.color)
        .setAuthor(kAuthor("Payment Instructions"))
        .setTitle(`${_pm.name} Instructions`)
        .setDescription("Please read and follow **all steps** before sending.\n\n"+_pmSteps.map((r,i)=>`**${i+1}.**  ${r}`).join("\n")+`\n\n${_pmWarn}`)
        .setFooter(kFoot("Always confirm the details inside this ticket"))
        .setTimestamp()
      ]}).catch(()=>{});
      await message.delete().catch(()=>{});
      return;
    }
    // $clear [@exchanger] — owners: clear an exchanger of all doubt (the ticket's exchanger when nobody is mentioned). Nothing is said in the ticket.
    const _clCmd=message.content.trim().match(/^\$clear(?:\s+<@!?(\d+)>)?$/i);
    if(_clCmd&&isOwner(message.author.id,message.member)){
      const _clId=_clCmd[1]||(ticket&&ticket.claimedBy)||null;
      await message.delete().catch(()=>{});
      let _clMsg="No exchanger on this ticket. Use `$clear @user`.";
      if(_clId){
        _clMsg=clearSummary(_clId,await liftRestrictions(message.guild,_clId));
        log(message.guild,`CLEARED: ${message.author.tag} cleared ${_clId} of all doubt`);
      }
      const _clDm=await message.author.send({content:_clMsg}).then(()=>true).catch(()=>false);
      if(!_clDm){const _clNote=await message.channel.send({content:_clMsg,allowedMentions:{parse:[]}}).catch(()=>null);if(_clNote)setTimeout(()=>_clNote.delete().catch(()=>{}),6000);}
      return;
    }
    // $open — ping exchangers
    if(message.content.trim()==="$unclaim"&&ticket&&ticket.status==="open"&&ticket.claimedBy&&(message.author.id===ticket.claimedBy||isOwner(message.author.id,message.member))){
      const _tks=Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets");
      _tks[message.channel.id]=ticket;
      await releaseClaim(message.channel,ticket,_tks,{by:message.author.id});
      return;
    }
    // $all — open the ticket to every exchanger (any payment method): they can all see it and claim it, or hop into a claimed one
    if(/^\$all$/i.test(message.content.trim())&&ticket&&ticket.status==="open"&&(isExchanger(message.member)||isOwner(message.author.id,message.member))){
      const _staffAll=!!(CONFIG.STAFF_ROLE&&message.member?.roles.cache.has(CONFIG.STAFF_ROLE));
      if(ticket.claimedBy&&message.author.id!==ticket.claimedBy&&!isOwner(message.author.id,message.member)&&!_staffAll){
        const _no=await message.reply("Only the exchanger on this ticket or staff can open it to everyone.").catch(()=>null);
        if(_no)setTimeout(()=>_no.delete().catch(()=>{}),5000);
        return;
      }
      const _tksAll=Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets");
      _tksAll[message.channel.id]=ticket;
      const _resAll=await openToAllExchangers(message.channel,ticket,_tksAll,{by:message.author.id});
      if(!_resAll.ok){
        const _wait=await message.reply(`Already sent a moment ago. Try again in ${_resAll.wait}s.`).catch(()=>null);
        if(_wait)setTimeout(()=>_wait.delete().catch(()=>{}),5000);
      }else if(_resAll.failed&&_resAll.failed.length){
        const _blind=await message.channel.send({content:`I couldn't give ${_resAll.failed.map(r=>`<@&${r}>`).join(" ")} access to this ticket, so they can't see it. Check that I have **Manage Permissions** in this channel.`,allowedMentions:{parse:[]}}).catch(()=>null);
        if(_blind)setTimeout(()=>_blind.delete().catch(()=>{}),15000);
      }
      return;
    }
    if(message.content.trim()==="$open"&&ticket&&ticket.status==="open"&&(isExchanger(message.member)||isOwner(message.author.id,message.member))){
      const _allRoleIds=[...new Set([
        ...(CONFIG.STAFF_ROLE?[CONFIG.STAFF_ROLE]:[]),
        ...(CONFIG.EXCHANGER_ROLE?[CONFIG.EXCHANGER_ROLE]:[]),
        ...Object.values(CONFIG.ROLES||{}).filter(Boolean),
      ])];
      // Only ping roles that can actually view this ticket channel
      const _visible=_allRoleIds.filter(rid=>{
        const role=message.guild.roles.cache.get(rid);
        if(!role)return false;
        try{return !!message.channel.permissionsFor(role)?.has(PermissionFlagsBits.ViewChannel);}catch{return false;}
      });
      const _mOpen=getMethod(ticket.method);
      if(!_visible.length)return void message.reply("No exchanger role has access to this channel. Add one to the channel permissions first.").catch(()=>{});
      const _pings=_visible.map(r=>"<@&"+r+">").join(" ");
      await message.channel.send({content:`${_pings} — **${ticketMethodText(ticket)}** ticket needs an exchanger. ${fmtUSD(ticket.amountUSD||0)}`,allowedMentions:{roles:_visible}}).catch(()=>{});
      return;
    }
    // $info — ticket summary
    if(message.content.trim()==="$info"&&ticket&&(isExchanger(message.member)||isOwner(message.author.id,message.member))){
      const _im=getMethod(ticket.method);const _ivol=getUserVolume(ticket.userId);const _itier=getTier(_ivol);
      await message.reply({embeds:[kEmbed("Ticket Info").setDescription(dealHead(dealOf(ticket))).addFields({name:"Client",value:"<@"+ticket.userId+">",inline:true},{name:"Claimed By",value:ticket.claimedBy?"<@"+ticket.claimedBy+">":(ticket.claimSystem?"Unclaimed":"—"),inline:true},{name:"Opened",value:"<t:"+Math.floor((ticket.createdAt||Date.now())/1000)+":R>",inline:true},{name:"Volume",value:fmtUSD(_ivol),inline:true},{name:"Tier",value:_itier.label,inline:true}).setFooter(kFoot("Ticket summary")).setTimestamp()]}).catch(()=>{});
      return;
    }
    // $fee [amount]
    if(message.content.trim().startsWith("$fee ")){
      const _fa=parseFloat(message.content.trim().split(" ")[1]);
      if(!isNaN(_fa)&&_fa>0){const _fr=feeRate(_fa,"send"),_fu=calcFee(_fa,"send");await message.reply("Fee on $"+_fa+": **"+_fr+"%** = **"+fmtUSD(_fu)+"** | Client receives **"+fmtUSD(_fa-_fu)+"**").catch(()=>{});return;}
    }
    // $vip — check client VIP status
    if(message.content.trim()==="$vip"&&ticket){
      const _vv=getUserVolume(ticket.userId);await message.reply("Client volume: **"+fmtUSD(_vv)+"** — VIP: **"+(isVipVolume(_vv)?"Yes":"No")+"**").catch(()=>{});return;
    }
    // $rate — show fee table
    if(message.content.trim()==="$rate"){
      await message.reply("Rates: <$150=10% | $150-349=9% | $350-599=8% | $600-799=7% | $800+=6% | Min fee $5 per exchange | Min amount $6 | VIP -0.75%").catch(()=>{});return;
    }
    // $vol [@user]
    if(message.content.trim().startsWith("$vol")&&(isExchanger(message.member)||isOwner(message.author.id,message.member))){
      const _vu=message.mentions.users.first()||message.author;const _vvol=getUserVolume(_vu.id);const _vt=getTier(_vvol);
      await message.reply(_vu.username+": **"+fmtUSD(_vvol)+"**  ·  **"+_vt.label+"**").catch(()=>{});return;
    }
    // $passes [@user]
    if(message.content.trim().startsWith("$passes")&&isOwner(message.author.id,message.member)){
      const _pu=message.mentions.users.first()||message.author;const _pc=state.passes[_pu.id]||0;
      await message.reply(_pu.username+" has **"+_pc+"** pass"+(+_pc!==1?"es":"")+".").catch(()=>{});return;
    }
    // $note [text]
    if(message.content.trim().startsWith("$note ")&&ticket&&(isExchanger(message.member)||isOwner(message.author.id,message.member))){
      const _nt=message.content.trim().slice(6);ticket.staffNote=_nt;
      const _ant=Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets");_ant[message.channel.id]=ticket;_mem.tickets=_ant;save("tickets",_mem.tickets);
      await message.reply("Note saved: \""+_nt+"\"").catch(()=>{});return;
    }
    // $complete — mark exchange complete

    if(message.content.trim()==="$complete"&&ticket&&ticket.status==="open"){
      const _canComp=isOwner(message.author.id,message.member)||isExchanger(message.member);
      if(_canComp){
        if(isSuspended(message.author.id)&&!isOwner(message.author.id,message.member)){await message.reply("Your exchanger access is suspended pending owner review.").catch(()=>{});return;}
        if(ticket.reported&&!isOwner(message.author.id,message.member)){await message.reply("This ticket is flagged. An owner needs to review it first.").catch(()=>{});return;}
        if(ticket.mmPending&&!isOwner(message.author.id,message.member)){await message.reply("Waiting for the client to confirm the middleman.").catch(()=>{});return;}
        {const _mw=mmCompleteBlock(message.channel.id,isOwner(message.author.id,message.member));if(_mw){await message.reply({content:_mw,allowedMentions:{parse:[]}}).catch(()=>{});return;}}
        if(ticket.claimSystem&&!ticket.claimedBy){await message.reply("Claim this ticket before completing it.").catch(()=>{});return;}
        if(ticket.claimSystem&&message.author.id!==ticket.claimedBy&&!isOwner(message.author.id,message.member)){await message.reply(`Only <@${ticket.claimedBy}> can complete this ticket.`).catch(()=>{});return;}
        if(ticket.claimSystem&&!isOwner(message.author.id,message.member)){
          // The client confirms before anything is finalized (owners finalize directly)
          if(ticket.completionPending){await message.reply("Already waiting for the client to confirm.").catch(()=>{});return;}
          const _tk=Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets");
          const _ok=await requestCompletion(message.channel,ticket,_tk);
          if(!_ok)await message.reply("Couldn't send the confirmation. Try again.").catch(()=>{});
          return;
        }
        const _allT=Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets");
        if(ticket.claimSystem)ticket.completionPending=false;   // an owner finalizes without waiting on the client
        ticket._overrideExchangerId=ticket.claimedBy||message.author.id;
        // Create a fake interaction-like object for completeTrade
        const _fakeInt={_fake:true,guild:message.guild,channel:message.channel,user:message.author,member:message.member,deferred:true,replied:false,editReply:async(d)=>message.channel.send(typeof d==="string"?{content:d}:d).catch(()=>{}),followUp:async(d)=>message.channel.send(typeof d==="string"?{content:d}:d).catch(()=>{})};
        await completeTrade(_fakeInt,ticket,_allT);
        return;
      }
    }
    // $ban — blacklist a user (reply to their message or mention)
    if(message.content.trim().startsWith("$ban ")&&isOwner(message.author.id,message.member)){
      const _banId=message.mentions.users.first()?.id||message.content.trim().split(" ")[1];
      if(_banId&&isOwner(_banId)){await message.reply("Owners can't be banned.").catch(()=>{});}
      else if(_banId){const bl=load("blacklist");bl[_banId]=true;save("blacklist",bl);await message.reply(`Banned <@${_banId}> from Konvert.`).catch(()=>{});}
      return;
    }
    // $unban — remove from blacklist
    if(message.content.trim().startsWith("$unban ")&&isOwner(message.author.id,message.member)){
      const _unId=message.mentions.users.first()?.id||message.content.trim().split(" ")[1];
      if(_unId){const bl=load("blacklist");delete bl[_unId];save("blacklist",bl);await message.reply(`Unbanned <@${_unId}>.`).catch(()=>{});}
      return;
    }
    // $purge [number] — delete last N messages (max 100)
    if(message.content.trim().startsWith("$purge")&&(isOwner(message.author.id,message.member)||(CONFIG.STAFF_ROLE&&message.member?.roles.cache.has(CONFIG.STAFF_ROLE)))){
      const _n=Math.min(parseInt(message.content.trim().split(" ")[1]||"10")||10,100);
      await message.channel.bulkDelete(_n+1,true).catch(()=>{});
      const _pm=await message.channel.send(`Deleted ${_n} message${_n===1?"":"s"}.`).catch(()=>null);
      if(_pm)setTimeout(()=>_pm.delete().catch(()=>{}),3000);
      return;
    }
    // $close — auto close ticket
    if(/^\$close$/i.test(message.content.trim())&&(ticket?(ticket.status==="open"||isOwner(message.author.id,message.member)):!!_sup)){   // owners can close any ticket whatever its state; support tickets have no record
      const _isExRoles2=Object.values(CONFIG.ROLES).filter(Boolean);
      const _canClose=isOwner(message.author.id,message.member)||(CONFIG.STAFF_ROLE&&message.member?.roles.cache.has(CONFIG.STAFF_ROLE))||(CONFIG.EXCHANGER_ROLE&&message.member?.roles.cache.has(CONFIG.EXCHANGER_ROLE))||_isExRoles2.some(r=>message.member?.roles.cache.has(r));
      if(_canClose){
        {const _mw=await mmBeforeClose(message.channel,isOwner(message.author.id,message.member)||!!(CONFIG.STAFF_ROLE&&message.member?.roles.cache.has(CONFIG.STAFF_ROLE))).catch(()=>null);if(_mw){await message.reply({content:_mw,allowedMentions:{parse:[]}}).catch(()=>{});return;}}
        await message.channel.send("Closing ticket...").catch(()=>{});
        if(await doCloseTicket(message.channel,message.guild,message.author,"Closed by staff")===false)return;
        setTimeout(()=>message.channel.delete().catch(()=>{}),5000);
        return;
      }
    }
    // $remind — remind client and start 12h auto-close countdown
    if(/^\$remind$/i.test(message.content.trim())&&(ticket?ticket.status==="open":!!_sup)){
      const _isExRoles3=Object.values(CONFIG.ROLES).filter(Boolean);
      const _canRemind=isOwner(message.author.id,message.member)||(CONFIG.STAFF_ROLE&&message.member?.roles.cache.has(CONFIG.STAFF_ROLE))||(CONFIG.EXCHANGER_ROLE&&message.member?.roles.cache.has(CONFIG.EXCHANGER_ROLE))||_isExRoles3.some(r=>message.member?.roles.cache.has(r));
      if(_canRemind){
        const _clientId=(ticket||_sup).userId;
        if(!_clientId){await message.reply("I can't tell who opened this ticket, so there is nobody to remind.").catch(()=>{});return;}
        await message.channel.send({content:`<@${_clientId}> You have **12 hours** to respond to this ticket or it will be automatically closed.`}).catch(()=>{});
        // Track last reply time for auto-close
        if(!state._reminderTimers)state._reminderTimers={};
        if(state._reminderTimers[message.channel.id])clearTimeout(state._reminderTimers[message.channel.id]);
        const _chRef=message.channel;
        const _gRef=message.guild;
        // Collect any message from client within 12h
        const _rFilter=m=>m.author.id===_clientId&&!m.author.bot;
        const _rCollector=_chRef.createMessageCollector({filter:_rFilter,time:12*60*60*1000,max:1});
        _rCollector.on("collect",()=>{
          clearTimeout(state._reminderTimers[_chRef.id]);
          delete state._reminderTimers[_chRef.id];
          _rCollector.stop("replied");
        });
        _rCollector.on("end",async(_,reason)=>{
          if(reason==="replied")return;
          // No reply in 12h — auto close
          try{
            if(mmHolds(_chRef.id)){await _chRef.send({content:"No response in 12 hours, but the built-in server middleman bot is still holding funds here, so this ticket stays open until they are released or refunded.",allowedMentions:{parse:[]}}).catch(()=>{});delete state._reminderTimers[_chRef.id];return;}
            await _chRef.send("No response received in 12 hours. Closing ticket automatically.").catch(()=>{});
            if(await doCloseTicket(_chRef,_gRef,{id:"auto",tag:"AutoClose"},"No response in 12 hours")===false)return;
            setTimeout(()=>_chRef.delete().catch(()=>{}),5000);
          }catch{}
          delete state._reminderTimers[_chRef.id];
        });
        state._reminderTimers[message.channel.id]=setTimeout(()=>{},1); // placeholder
        return;
      }
    }
    // Track participants so name-change alerts land in the right tickets
    if(ticket&&ticket.status==="open"){
      if(!state._ticketPeople)state._ticketPeople={};
      if(!state._ticketPeople[message.channel.id])state._ticketPeople[message.channel.id]=new Set();
      state._ticketPeople[message.channel.id].add(message.author.id);
    }
    // Safety system: reads the conversation for signs a client needs help (owners are never analysed)
    if(ticket&&ticket.status==="open")await safetyOnMessage(message,ticket).catch(e=>console.error("[safety]",e.message));
    if(ticket&&ticket.status==="open"&&ticket.userId===message.author.id){
      const typed=message.content.trim().toLowerCase();
      const activeCodes=Object.entries(state.promos||{}).filter(([,p])=>p.active).map(([c])=>c);
      if(activeCodes.length>0)console.log(`[promo] msg "${typed}" checked against active codes: ${activeCodes.join(", ")}`);
      const promo=Object.entries(state.promos||{}).find(([code,p])=>code.toLowerCase()===typed&&p.active);
      if(promo){
        const [code,p]=promo;
        // Check expiry
        if(p.expiresAt&&Date.now()>p.expiresAt){
          p.active=false;
          savePromos();
          await message.reply({embeds:[new EmbedBuilder()
            .setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO})
            .setTitle("Promo Code Expired")
            .setDescription(`**${code.toUpperCase()}** has expired and is no longer valid.`)
            .setFooter({text:"Konvert Exchange"}).setTimestamp()]}).catch(()=>{});
          return;
        }
        // Check max uses
        if(p.maxUses&&p.uses>=p.maxUses){
          p.active=false;
          savePromos();
          await message.reply({embeds:[new EmbedBuilder()
            .setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO})
            .setTitle("Promo Code Fully Redeemed")
            .setDescription(`**${code.toUpperCase()}** has reached its maximum number of uses.`)
            .setFooter({text:"Konvert Exchange"}).setTimestamp()]}).catch(()=>{});
          return;
        }
        // Check if already used
        if(p.usedBy&&p.usedBy.includes(message.author.id)){
          await message.reply({embeds:[new EmbedBuilder()
            .setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO})
            .setTitle("Already Applied")
            .setDescription(`You've already used **${code.toUpperCase()}** on a previous exchange.`)
            .setFooter({text:"Konvert Exchange"}).setTimestamp()]}).catch(()=>{});
          return;
        }
        // Apply promo to ticket
        ticket.promoCode=code;
        ticket.promoDiscount=p.discount;
        p.uses=(p.uses||0)+1;
        if(!p.usedBy)p.usedBy=[];
        p.usedBy.push(message.author.id);
        _mem.tickets=tickets;
        save("tickets",tickets);
        savePromos();
        // Recalc fee: discount is % off the fee AMOUNT
        // e.g. fee=$5, discount=25% → newFee=$5*(1-0.25)=$3.75
        const origFee=calcFee(ticket.amountUSD||0,ticket.direction||"send",isVipVolume(getUserVolume(message.author.id)));
        const newFee=Math.max(origFee*(1-p.discount/100),0.01);
        const savedAmt=origFee-newFee;
        ticket.feeUSD=newFee;
        await message.reply({embeds:[new EmbedBuilder()
          .setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange  ·  Promo Applied",iconURL:IMG.LOGO})
          .setTitle("Promo Code Applied!")
          .setDescription(`**${code.toUpperCase()}** has been applied to your exchange.\n\u200b`)
          .addFields(
            {name:"Original Fee",value:`**${fmtUSD(origFee)}**`,inline:true},
            {name:"Discount",value:`**${p.discount}% off the fee**`,inline:true},
            {name:"New Fee",value:`**${fmtUSD(newFee)}**`,inline:true},
            {name:"You Save",value:`**${fmtUSD(savedAmt)}**`,inline:true},
            {name:"Uses Left",value:p.maxUses?`**${p.maxUses-p.uses}**`:"Unlimited",inline:true},
            {name:"Expires",value:p.expiresAt?`<t:${Math.floor(p.expiresAt/1000)}:R>`:"Never",inline:true},
          )
          .setFooter({text:"Konvert Exchange  ·  Fee updated for this exchange"})
          .setTimestamp()]}).catch(()=>{});
        return;
      }
    }
  }

  const convMatch=message.content.trim().match(/^([\d,]+\.?\d*)\s+([a-zA-Z]{2,6})\s+to\s+([a-zA-Z]{2,6})$/i);
  if(convMatch){
    const rawAmt=parseFloat(convMatch[1].replace(/,/g,""));
    const fromRaw=convMatch[2].toUpperCase(),toRaw=convMatch[3].toUpperCase();
    if(isNaN(rawAmt)||rawAmt<=0)return;
    const FIAT_RATES={USD:1,CAD:1.37,EUR:0.93,GBP:0.79,AUD:1.53,CHF:0.90,JPY:149.5,MXN:17.2,AED:3.67,SGD:1.35};
    const FIAT_SYM={USD:"$",CAD:"CA$",EUR:"\u20AC",GBP:"\u00A3",AUD:"A$",CHF:"CHF ",JPY:"\u00A5",MXN:"MX$",AED:"AED ",SGD:"S$"};
    const isCoin=s=>isKnownCoin(s),isFiat=s=>!!FIAT_RATES[s];
    if(!isCoin(fromRaw)&&!isFiat(fromRaw))return;
    if(!isCoin(toRaw)&&!isFiat(toRaw))return;
    try{
      let amtUSD=0;
      if(isFiat(fromRaw)){amtUSD=rawAmt/FIAT_RATES[fromRaw];}
      else{const fp=await getPrice(fromRaw);if(!fp){await message.reply({content:`Could not fetch price for **${fromRaw}**.`}).catch(()=>{});return;}amtUSD=rawAmt*fp;}
      let result=0;
      if(isFiat(toRaw)){result=amtUSD*FIAT_RATES[toRaw];}
      else{const tp=await getPrice(toRaw);if(!tp){await message.reply({content:`Could not fetch price for **${toRaw}**.`}).catch(()=>{});return;}result=amtUSD/tp;}
      const fmtR=n=>{if(n>=1000)return n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});if(n>=1)return n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:4});if(n>=0.01)return n.toFixed(4);return n.toFixed(8);};
      const fromSym=isFiat(fromRaw)?(FIAT_SYM[fromRaw]||fromRaw+" "):"";
      const toSym=isFiat(toRaw)?(FIAT_SYM[toRaw]||toRaw+" "):"";
      const color=(isCoin(fromRaw)||isCoin(toRaw))?0x7C4DFF:0x7C4DFF;
      const embed=new EmbedBuilder().setColor(color).setAuthor({name:"Konvert Exchange  ·  Converter",iconURL:IMG.LOGO})
        .setTitle(fromSym+rawAmt.toLocaleString("en-US")+" "+fromRaw+"  \u2192  "+toSym+fmtR(result)+" "+toRaw)
        .addFields({name:"You have",value:`**${fromSym}${rawAmt.toLocaleString("en-US")} ${fromRaw}**`,inline:true},{name:"You get",value:`**${toSym}${fmtR(result)} ${toRaw}**`,inline:true},{name:"\u2248 USD Value",value:`**$${amtUSD.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}**`,inline:true})
        .setFooter({text:"Konvert Exchange  ·  Live rates  ·  Open a ticket to exchange"}).setTimestamp();
      let _lg=null;
      for(const c of [fromRaw,toRaw])if(!_lg&&isCoin(c))_lg=await coinLogo(c);
      if(_lg)embed.setThumbnail(_lg);
      await message.reply({embeds:[embed]}).catch(()=>{});
    }catch(e){console.log("[autoConvert]",e.message);}
    return;
  }
  const jwMatch=message.content.trim().match(/^\$j([A-Za-z]{2,10})$/i);
  if(jwMatch){
    const jwKey=jwMatch[1].toLowerCase();
    const jwMap={btc:"BTC",eth:"ETH",sol:"SOL",ltc:"LTC",usdtbnb:"USDT-BNB",usdteth:"USDT-ETH",usdt:"USDT-BNB"};
    const jwCoin=jwMap[jwKey];
    if(jwCoin&&state.personalWallets[jwCoin]){
      await message.channel.send({content:state.personalWallets[jwCoin]}).catch(()=>{});
    } else {
      await message.reply({content:`No **${jwCoin||jwKey.toUpperCase()}** address set yet.`}).catch(()=>{});
    }
    return;
  }
  const match=message.content.trim().match(/^\$([A-Za-z]{2,10})$/i);
  if(!match)return;
  const coin=match[1].toUpperCase();
  if(!isKnownCoin(coin))return;
  const q=await quoteCoin(coin);
  if(!q){await message.reply(`Could not fetch **${coin}** price right now. Try again in a moment.`).catch(()=>{});return;}
  await message.reply({embeds:[priceEmbed(coin,q,await coinLogo(coin,q))]}).catch(()=>{});
 }catch(e){console.error("[MessageCreate error]",e.message);}
});

async function cacheInvites(guild){
}

// Real-time clan tag detection via raw gateway
client.ws.on("GUILD_MEMBER_UPDATE",async(data)=>{
  try{
    if(data.guild_id!==CONFIG.GUILD_ID)return;
    const userId=data.user?.id;
    if(!userId)return;
    const clanTag=(data.user?.clan?.tag||"").toUpperCase();
    const hasKonv=clanTag==="KONV";
    const guild=client.guilds.cache.get(CONFIG.GUILD_ID);
    if(!guild)return;
    const member=await guild.members.fetch({user:userId,force:true}).catch(()=>null);
    if(!member)return;
    const hasRole=member.roles.cache.has(KONV_TAG_ROLE);
    if(hasKonv&&!hasRole){
      await member.roles.add(KONV_TAG_ROLE).catch(()=>{});
      state.konvTagUsers.add(userId);
      console.log(`[konvTag] Auto-added: ${data.user.username}`);
    }else if(!hasKonv&&hasRole){
      await member.roles.remove(KONV_TAG_ROLE).catch(()=>{});
      state.konvTagUsers.delete(userId);
      console.log(`[konvTag] Auto-removed: ${data.user.username}`);
    }
  }catch(e){console.error("[konvTag]",e.message);}
});

// Auto assign/remove KONV role when user changes their primary guild (clan tag)
// Impersonation guard — when a participant changes their name, the open tickets they are in are told only if a scam is already suspected there (otherwise it is only logged)
async function alertNameChange(guild,userId,kind,before,after){
  try{
    if(!before||!after||before===after)return;
    if(userId===client.user?.id)return;
    if(isOwner(userId,guild&&guild.members&&guild.members.cache.get(userId)))return;   // owners are exempt
    const tickets=Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets");
    for(const [chId,t] of Object.entries(tickets)){
      if(!t||t.status!=="open")continue;
      const people=state._ticketPeople?.[chId];
      let involved=t.userId===userId||!!(people&&people.has(userId));
      const ch=guild.channels.cache.get(chId)||await guild.channels.fetch(chId).catch(()=>null);
      if(!ch)continue;
      // Participant list is in-memory, so rebuild from history after a restart
      if(!involved&&!people){
        try{
          const hist=await ch.messages.fetch({limit:50});
          const seen=new Set();
          hist.forEach(msg=>{if(!msg.author.bot)seen.add(msg.author.id);});
          if(!state._ticketPeople)state._ticketPeople={};
          state._ticketPeople[chId]=seen;
          involved=seen.has(userId);
        }catch{}
      }
      if(!involved)continue;
      // Said in the ticket only when the system already suspects a scam there (flagged, or at caution or worse); otherwise just a quiet log line
      if(!(t.reported||(SAFETY.rank[t.riskLevel]||0)>=SAFETY.rank.caution)){
        log(guild,`NAME CHANGE: #${ch.name} | ${userId} | ${kind}: ${String(before).replace(/`/g,"'").slice(0,60)} -> ${String(after).replace(/`/g,"'").slice(0,60)}`);
        console.log(`[nameChange] ${kind} change in ${chId} logged quietly: ${before} -> ${after}`);
        continue;
      }
      await ch.send({embeds:[new EmbedBuilder()
        .setColor(0xef4444)
        .setAuthor({name:"Konvert Exchange  ·  Security Alert",iconURL:IMG.LOGO})
        .setTitle("Name Changed Mid-Ticket")
        .setDescription(`<@${userId}> just changed their **${kind}** while this ticket is open.\n\nThis is a common impersonation tactic. Verify you are still talking to the same person before sending anything.`)
        .addFields(
          {name:"Before",value:"`"+String(before).slice(0,100)+"`",inline:true},
          {name:"After",value:"`"+String(after).slice(0,100)+"`",inline:true},
          {name:"User ID",value:"`"+userId+"`",inline:false},
        )
        .setFooter({text:"Konvert Exchange  ·  User IDs never change \u2014 always verify by ID"})
        .setTimestamp()
      ]}).catch(()=>{});
      console.log(`[nameChange] ${kind} alert in ${chId}: ${before} -> ${after}`);
    }
  }catch(e){console.error("[nameChange]",e.message);}
}

// Nickname changes (server-specific)
client.on(Events.GuildMemberUpdate,async(oldMember,newMember)=>{
  try{
    if(!newMember||!newMember.guild)return;
    if(newMember.guild.id!==CONFIG.GUILD_ID)return;
    const oldNick=oldMember?.nickname||oldMember?.user?.username||null;
    const newNick=newMember?.nickname||newMember?.user?.username||null;
    if(oldNick===newNick)return;
    await alertNameChange(newMember.guild,newMember.id,"server nickname",oldNick,newNick);
  }catch(e){console.error("[nameChange nick]",e.message);}
});

client.on(Events.UserUpdate,async(oldUser,newUser)=>{
  try{
    if(!newUser||!newUser.id)return;
    const guild=client.guilds.cache.get(CONFIG.GUILD_ID);
    if(!guild)return;
    const member=await guild.members.fetch({user:newUser.id,force:false}).catch(()=>null);
    if(!member)return;
    // Impersonation guard — username or display name changed
    if(oldUser){
      if(oldUser.username!==newUser.username)await alertNameChange(guild,newUser.id,"username",oldUser.username,newUser.username);
      else if((oldUser.globalName||null)!==(newUser.globalName||null))await alertNameChange(guild,newUser.id,"display name",oldUser.globalName||oldUser.username,newUser.globalName||newUser.username);
    }
    const pg=newUser.primaryGuild||null;
    const hasKonv=!!(pg&&pg.identityEnabled&&pg.identityGuildId===CONFIG.GUILD_ID);
    const hasRole=!!(member.roles&&member.roles.cache&&member.roles.cache.has(KONV_TAG_ROLE));
    if(hasKonv&&!hasRole){
      await member.roles.add(KONV_TAG_ROLE).catch(()=>{});
      state.konvTagUsers.add(newUser.id);
      console.log(`[konvTag] Auto-added: ${newUser.username}`);
    }else if(!hasKonv&&hasRole){
      await member.roles.remove(KONV_TAG_ROLE).catch(()=>{});
      state.konvTagUsers.delete(newUser.id);
      console.log(`[konvTag] Auto-removed: ${newUser.username}`);
    }
  }catch(e){console.error("[konvTag UserUpdate]",e.message);}
});

client.on(Events.GuildMemberAdd,async member=>{
  try{
    const guild=member.guild;

    const WELCOME_CHANNEL="1477787759799435344";
    const ch=guild.channels.cache.get(WELCOME_CHANNEL);
    if(!ch)return;
    await ch.send({content:`<@${member.id}>`,embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO}).setThumbnail(member.user.displayAvatarURL({size:256})).setDescription(`Welcome to Konvert, <@${member.id}>. \u2014 Member **#${guild.memberCount}**\n\nReady to exchange? Open a ticket in <#${CONFIG.EXCHANGE_CHANNEL}>.\n\u200b`).setFooter({text:"Konvert Exchange  ·  Fast  ·  Safe  ·  Simple"}).setTimestamp()]});
  }catch(e){console.error("Welcome error:",e.message);}
});

client.on(Events.InteractionCreate,async interaction=>{
  try{
    if(typeof interaction.customId==="string"&&interaction.customId.startsWith("mm_")&&await mmInteraction(interaction))return;       // the built-in server middleman bot's buttons, menus and forms
    if(interaction.isChatInputCommand()){
      // Owner-only commands: check OWNER_IDS regardless of Discord permissions
      const OWNER_ONLY_CMDS=["grantowner","revokeowner","listowners","wipestats","clearleaderboard","adjuststats","resetstats","transferstats","suspended","reinstate","clearexchanger","profittest","broadcast","setfeemode","postleaderboard","serverinfo","clientinfo","receipt","postguide","postbackup","pricecheck","mmadmin"];
      if(OWNER_ONLY_CMDS.includes(interaction.commandName)&&!isOwner(interaction.user.id,interaction.member)){
        return interaction.reply({content:"You don\'t have permission to use this command.",flags:64});
      }
      const cmd=interaction.commandName;

      if(cmd==="help"||cmd==="postguide"){return handleGuide(interaction,{post:cmd==="postguide"});}

      if(cmd==="postexchange"){await interaction.channel.send({embeds:[mainEmbed()],components:mainButtons()});return interaction.reply({content:"Exchange embed posted.",flags:64});}
      if(cmd==="postsupport"){const embed=kEmbed("Support").setTitle(`Support`).setThumbnail(IMG.LOGO).setDescription(`This channel is for **support tickets only**.\n\nFor exchanges, head to <#${CONFIG.EXCHANGE_CHANNEL}>.\n\n**What to include**\n• What you need help with\n• Any error messages or screenshots\n• What you have already tried\n• A full explanation of what happened\n\u200b`).setFooter(kFoot("Support"));await interaction.channel.send({embeds:[embed],components:[new ActionRowBuilder().addComponents(kBtn("btn_support_ticket","Open Support Ticket",ButtonStyle.Primary))]});return interaction.reply({content:"Support embed posted.",flags:64});}
      if(cmd==="postbackup"){
        const typed=(interaction.options.getString("link")||"").trim(),url=typed?cleanInvite(typed):backupInvite();
        if(!url)return interaction.reply({content:"That is not a Discord invite link. Use one like https://discord.gg/abc123.",flags:64});
        const target=interaction.options.getChannel("channel")||interaction.channel;
        try{await target.send({embeds:[backupEmbed(url)],components:[backupRow(url)]});}
        catch(e){return interaction.reply({content:`Could not post in <#${target.id}>: ${e.message}`,flags:64});}
        return interaction.reply({content:target.id===interaction.channel.id?"Backup server embed posted.":`Backup server embed posted in <#${target.id}>.`,flags:64});
      }
      if(cmd==="pricecheck"){
        await interaction.deferReply({flags:64});
        const sym=_symOf(interaction.options.getString("coin")||"XMR");
        if(!sym)return interaction.editReply({content:"Enter a coin ticker, for example XMR."});
        const r=await priceDiagnose(sym),answered=r.rows.filter(x=>x.ok).length;
        const lines=r.rows.map(x=>x.ok?`ok    ${x.id.padEnd(13)} $${fmtPrice(x.q.usd)}  ${x.ms}ms`:`FAIL  ${x.id.padEnd(13)} ${String(x.err).replace(/`/g,"'")}`);
        const logo=r.blend?await coinLogo(sym,r.blend):null;
        return interaction.editReply({embeds:[slim("Price check").setTitle(sym).setThumbnail(logo||IMG.LOGO).setDescription("```\n"+lines.join("\n")+"\n```")
          .addFields({name:"Price",value:r.blend?`**$${fmtPrice(r.blend.usd)}**  ·  ${r.blend.n} agree`:"**No source has this coin**",inline:true},{name:"Sources answering",value:`${answered} of ${r.rows.length}`,inline:true},{name:"Logo",value:logo||(r.blend?"None found (the Konvert logo is shown)":"—"),inline:false})
          .setFooter(kFoot("Owner only  ·  each source is asked on its own, nothing is cached"))]});
      }
      if(cmd==="mmadmin"){return mmAdmin(interaction);}
      if(cmd==="postmm"){try{await interaction.channel.send({embeds:[mmInfoEmbed()]});}catch(e){return interaction.reply({content:`Couldn't post here: ${e.message}`,flags:64});}return interaction.reply({content:"Middleman info posted.",flags:64});}


      if(cmd==="rates"){await interaction.deferReply();
        const _re=await Promise.race([buildRatesEmbed(),new Promise((_,r)=>setTimeout(()=>r(new Error("t")),7000))]).catch(()=>null);
        if(!_re)return interaction.editReply("Could not fetch rates right now. Try again.");
        return interaction.editReply({embeds:[_re],components:[new ActionRowBuilder().addComponents(kBtn("btn_refresh_rates","Refresh",ButtonStyle.Secondary))]});}

      if(cmd==="fee"){
        const amt=interaction.options.getNumber("amount_usd");
        if(!amt||amt<=0)return interaction.reply({content:"Please enter a valid amount greater than $0.",flags:64});
        await interaction.deferReply({flags:64});
        const _feeVol=getUserVolume(interaction.user.id),_feeVip=isVipVolume(_feeVol);
        const [btcP,ethP,solP]=await Promise.all([getPrice("BTC"),getPrice("ETH"),getPrice("SOL")]);
        return interaction.editReply({embeds:[feeEmbed(amt,{vip:_feeVip,prices:{BTC:btcP,ETH:ethP,SOL:solP}})]});
      }

      if(cmd==="price"){
        await interaction.deferReply();
        const rawIn=String(interaction.options.getString("coin")||""),coin=_symOf(rawIn);
        const note=t=>interaction.editReply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO}).setDescription(t)]});
        if(!coin)return note(`**${rawIn.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,20)||"That"}** is not a coin ticker. Try BTC, ETH, XMR, SOL, LTC, BNB, XRP, DOGE and more.`);
        const q=await Promise.race([quoteCoin(coin),new Promise(r=>setTimeout(()=>r(null),9000))]).catch(()=>null);
        if(!q)return isKnownCoin(coin)?interaction.editReply(`Could not fetch **${coin}** price right now. Try again in a moment.`):note(`**${coin}** is not supported. Try BTC, ETH, XMR, SOL, LTC, BNB, XRP, DOGE and more.`);
        return interaction.editReply({embeds:[priceEmbed(coin,q,await coinLogo(coin,q))]});
      }

      if(cmd==="convert"){
        await interaction.deferReply();
        const amount=interaction.options.getNumber("amount"),from=interaction.options.getString("from").toUpperCase(),to=interaction.options.getString("to").toUpperCase();
        if(!amount||amount<=0)return interaction.editReply("Please enter a valid amount greater than 0.");
        const FIAT={USD:1,CAD:1.37,EUR:0.93,GBP:0.79};
        const _nm=x=>{const u=String(x||"").trim().toUpperCase();return FIAT[u]?u:resolveCoin(x);};
        const fromNorm=_nm(from),toNorm=_nm(to);
        let amtUSD;
        const _pr=t=>new Promise(r=>setTimeout(()=>r(null),t));
        const _no=x=>interaction.editReply(isKnownCoin(x)?`Could not fetch price for **${x}**. Try again.`:`**${x}** not recognised.`);
        if(FIAT[fromNorm]){amtUSD=amount/FIAT[fromNorm];}else{const p=await Promise.race([getPrice(fromNorm),_pr(9000)]);if(!p)return _no(fromNorm);amtUSD=amount*p;}
        let result;
        if(FIAT[toNorm]){result=amtUSD*FIAT[toNorm];}else{const p=await Promise.race([getPrice(toNorm),_pr(9000)]);if(!p)return _no(toNorm);result=amtUSD/p;}
        const fee=calcFee(amtUSD,"send"),toPrice=FIAT[toNorm]?(1/FIAT[toNorm]):(await Promise.race([getPrice(toNorm),_pr(3000)])||1),youGet=result-(fee/toPrice);
        const isToFiat=!!FIAT[toNorm],receiveUSD=isToFiat?youGet:youGet*toPrice;
        const youGetDisplay=isToFiat?fmtUSD(youGet):`${youGet.toFixed(6)} ${toNorm}`;
        const usdDisplay=isToFiat?fmtUSD(youGet):`\u2248${fmtUSD(receiveUSD)}`;
        return interaction.editReply({embeds:[slim("Conversion").setDescription(`**${amount} ${fromNorm}** \u2192 **${toNorm}**`)
          .addFields({name:"You send",value:`**${amount} ${fromNorm}**`,inline:true},{name:"Est. fee",value:`**${fmtUSD(fee)}**`,inline:true},{name:"You receive",value:isToFiat?`**${youGetDisplay}**`:`**${youGetDisplay}**\n${usdDisplay}`,inline:true})
          .setFooter({text:"Konvert Exchange  ·  Estimate only"})]});
      }

      if(cmd==="stats"){
        await interaction.deferReply();
        const target=interaction.options.getUser("user")||interaction.user;
        const isSelf=target.id===interaction.user.id;
        const DONE_STATUS=["vouched","completed"];
        // Always read from _mem first (already loaded from Postgres on startup)
        const _ticketSource=Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets");
        const allT=Object.values(_ticketSource);
        const realTrades=allT.filter(t=>
          t.userId===target.id&&
          DONE_STATUS.includes(t.status)&&
          t.method!=="adjustment"&&
          t.amountUSD&&
          parseFloat(t.amountUSD)>0
        );
        const volume=getUserVolume(target.id);
        const avg=realTrades.length>0?realTrades.reduce((s,t)=>s+(parseFloat(t.amountUSD)||0),0)/realTrades.length:0;
        const topM=topOf(realTrades,"method"),topC=topOf(realTrades,"coin");
        const tier=getTier(volume),nextTier=getNextTier(volume),needed=nextTier?Math.max(nextTier.min-volume,0):0;
        const last=realTrades.length>0?[...realTrades].sort((a,b)=>(b.completedAt||0)-(a.completedAt||0))[0]:null;
        
        const tierStatus=nextTier?`**${tier.label}** \u2014 ${fmtUSD(needed)} away from **${nextTier.label}**`:`**${tier.label}** \u2014 Maximum tier reached`;
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x7C4DFF)
          .setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO})
          .setTitle(isSelf?"Your Stats":`${target.username}'s Stats`)
          .setThumbnail(target.displayAvatarURL({size:256}))
          .setDescription(`**${tier.label}**${isVipVolume(volume)?"  \u00B7  VIP":""} \u2014 ${nextTier?`${fmtUSD(Math.max(nextTier.min-volume,0))} to ${nextTier.label}`:"Max tier reached"}\n\u200b`)
          .addFields(
            {name:"Exchanges",value:`**${realTrades.length}**`,inline:true},
            {name:"Volume",value:`**${volume>0?fmtUSD(volume):"$0.00"}**`,inline:true},
            {name:"Avg Exchange",value:`**${avg>0?fmtUSD(avg):"\u2014"}**`,inline:true},
            {name:"Top Method",value:topM?`**${topM.name}**`:noTop(realTrades),inline:true},
            {name:"Top Coin",value:topC?`**${topC.name}**`:noTop(realTrades),inline:true},
            {name:"Last Exchange",value:last?.completedAt?`<t:${Math.floor(last.completedAt/1000)}:R>`:"\u2014",inline:true},
          )
          .setImage(IMG.BANNER)
          .setFooter({text:`Konvert Exchange  ·  ${tier.label}`})
          .setTimestamp()]});

      }

      if(cmd==="leaderboard"){
        await interaction.deferReply();
        const byUser=buildLeaderboardVolumes();
        if(!Object.keys(byUser).length)return interaction.editReply({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO}).setTitle("Client Leaderboard").setThumbnail(IMG.LOGO).setDescription("No completed exchanges on record yet.\n\nComplete an exchange to appear here.\n\u200b").setImage(IMG.BANNER).setFooter({text:"Konvert Exchange  ·  Leaderboard"}).setTimestamp()]});
        const ranked=Object.entries(byUser).sort((a,b)=>b[1]-a[1]).slice(0,10);
        const lines=ranked.map(([uid,vol],i)=>`**${i+1}.**  <@${uid}>  \u2014  **${fmtUSD(vol)}**`).join("\n");
        const totalVol=ranked.reduce((s,[,v])=>s+v,0);
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x7C4DFF)
          .setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO})
          .setTitle("Leaderboard")
          .setThumbnail(IMG.LOGO)
          .setDescription(`Top ${ranked.length===1?"client":`${ranked.length} clients`} by volume\n\u200b`)
          .addFields({name:"\u200b",value:lines,inline:false})
          .setFooter({text:`Konvert Exchange  ·  ${fmtUSD(totalVol)} total volume`})
          .setTimestamp()]});

      }

      if(cmd==="market"){
        await interaction.deferReply();
        const qs=await quoteMany(RATE_COINS,8000);
        const rows=RATE_COINS.map(coin=>{const q=qs[coin];return q&&q.change!==null&&q.change!==undefined?{coin,price:q.usd,change:q.change}:null;}).filter(Boolean);
        if(rows.filter(r=>!STABLE.has(r.coin)).length<3)return interaction.editReply("Could not load market data right now. Try again in a moment.");      // the two stablecoins alone are not a market
        const gainers=[...rows].sort((a,b)=>b.change-a.change).slice(0,3),losers=[...rows].sort((a,b)=>a.change-b.change).slice(0,3);
        const avg=(rows.reduce((s,r)=>s+r.change,0)/rows.length).toFixed(2);
        const fmt2=n=>n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
        return interaction.editReply({embeds:[slim("Market Summary").addFields({name:"Market Sentiment",value:`**${parseFloat(avg)>=0?"Bullish \u25B2":"Bearish \u25BC"}**  \u00b7  Avg 24h: **${avg}%**`,inline:false},{name:"Top Gainers",value:gainers.map(r=>`\`${r.coin.padEnd(5)}\` **\u25B2 ${r.change.toFixed(2)}%**  $${fmt2(r.price)}`).join("\n"),inline:true},{name:"Top Losers",value:losers.map(r=>`\`${r.coin.padEnd(5)}\` **\u25BC ${Math.abs(r.change).toFixed(2)}%**  $${fmt2(r.price)}`).join("\n"),inline:true}).setFooter({text:"Konvert Exchange  ·  Live market data"})]});
      }

      if(cmd==="wallets"){const w=load("wallets"),fields=Object.entries(w).length?Object.entries(w).map(([coin,addr])=>({name:coin,value:`\`${addr}\``,inline:true})):[{name:"No wallets set",value:"Owner: use /setwallet to add addresses.",inline:false}];return interaction.reply({embeds:[base("Deposit Wallets").setThumbnail(IMG.LOGO).setDescription("Send funds **only** to addresses confirmed by staff **inside your ticket**.\n__Never send to any address given outside of your ticket.__\n\u200b").addFields(fields).setFooter({text:"Konvert Exchange  ·  Always verify with staff before sending"})],flags:64});}
      if(cmd==="mm"){return interaction.reply({embeds:[mmGuideEmbed()]});}

      if(cmd==="mine"){
        const userId=interaction.user.id,cooldownMs=3*60*60*1000,remaining=cooldownMs-(Date.now()-(state.cooldowns[userId]||0));
        if(remaining>0){const hrs=Math.floor(remaining/3600000),mins=Math.ceil((remaining%3600000)/60000);return interaction.reply({embeds:[base("Mine · On Cooldown").setDescription(`You can mine again in **${hrs>0?`${hrs}h ${mins}m`:`${mins}m`}**.`).setFooter({text:"Konvert Mine  ·  Once every 3 hours"})],flags:64});}
        state.cooldowns[userId]=Date.now();
        const pos=Array.from({length:25},(_,i)=>i).sort(()=>Math.random()-0.5);
        state.mineGames[userId]={diamonds:pos.slice(0,3),bombs:pos.slice(3,25),revealed:[],found:0,tries:0,over:false};
        return interaction.reply({embeds:[base("Konvert Mine").setColor(0x7C4DFF).setDescription("Find all **3 Exchange Passes** hidden in the grid.\nHit a bomb and it's over. You have **3 clicks**.\n\u200b").addFields({name:"Passes Found",value:"**0 / 3**",inline:true},{name:"Clicks Left",value:"**3**",inline:true},{name:"Prize",value:"Free Exchange Pass",inline:true}).setFooter({text:"Konvert Mine  ·  Cooldown: 3 hours"})],components:buildMineGrid(userId,state.mineGames[userId]),flags:64});
      }

      if(cmd==="vouch"){
        const clientUser=interaction.options.getUser("client"),exchUser=interaction.options.getUser("exchanger");
        const message=interaction.options.getString("message"),method=interaction.options.getString("method"),amount=interaction.options.getNumber("amount"),rating=interaction.options.getInteger("rating")||5;
        const vt=load("tickets");
        vt["manual_"+Date.now()]={userId:clientUser.id,userTag:clientUser.tag,method,direction:null,coin:null,amountUSD:amount,feeUSD:calcFee(amount,"send"),walletInfo:"manual",notes:"Manual vouch via /vouch",status:"vouched",completedBy:exchUser.id,completedAt:Date.now(),createdAt:Date.now()};
        _mem.tickets=vt;save("tickets",vt);
        updateStatChannel(interaction.guild).catch(()=>{});
        const _refByManual=null;
        await postVouch(interaction.guild,{clientId:clientUser.id,exchangerId:exchUser.id,method,amountUSD:amount,direction:null,coin:null,message,rating,referredBy:_refByManual});
        await handleReferralTrade(interaction.guild,clientUser.id,amount);
        const vol=getUserVolume(clientUser.id);await applyTierRole(interaction.guild,clientUser.id,vol);
        const _allVouched=Object.values(_mem.tickets).filter(t=>t.userId===clientUser.id&&["vouched","completed"].includes(t.status)&&t.method!=="adjustment");
        await sendReceiptDM(clientUser.id,exchUser.id,{method,direction:null,coin:null,amountUSD:amount,feeUSD:calcFee(amount,"send")},_allVouched.length,vol);
        return interaction.reply({content:`Vouch recorded \u2014 <@${clientUser.id}> exchanged with <@${exchUser.id}>.`,flags:64});
      }

      if(cmd==="ticket"){const tickets=load("tickets"),found=Object.entries(tickets).find(([,t])=>t.userId===interaction.user.id&&t.status==="open");if(!found)return interaction.reply({content:"You don't have an open ticket. Use **Exchange Now** to start one.",flags:64});const [channelId,t]=found,d=dealOf(t),status=t.reported?"Under owner review":t.mmPending?"Waiting for you to confirm the middleman":t.completionPending?"Waiting for you to confirm completion":t.claimedBy?`Claimed by <@${t.claimedBy}>`:"Waiting for an exchanger";return interaction.reply({embeds:[base("Your Open Ticket").setDescription(`${dealHead(d)}\n\u200b`).addFields({name:"Channel",value:`<#${channelId}>`,inline:true},{name:"Status",value:status,inline:true},{name:"Opened",value:t.createdAt?`<t:${Math.floor(t.createdAt/1000)}:R>`:"Earlier",inline:true}).setFooter({text:"Konvert Exchange  ·  All communication stays in your ticket"})],flags:64});}
      if(cmd==="howto"){return interaction.reply({embeds:[base("How to Use Konvert").setThumbnail(IMG.LOGO).setDescription("New to Konvert? Here's how an exchange works step by step.\n\u200b").addFields({name:"1.  Check Rates",value:"Use **Live Rates** or type `$BTC` / `$ETH` etc. in any channel to see the current price.",inline:false},{name:"2.  Calculate Fee",value:"Use **Calculate Fee** to estimate your cost. Fees range from **5% - 10%** depending on amount.",inline:false},{name:"3.  Open a Ticket",value:"Click **Exchange Now** and choose your payment method. You can select more than one to speed it up: exchangers for each are pinged at once, so whoever is online first can take your ticket. Fill in the details and confirm. A private ticket opens instantly.",inline:false},{name:"4.  Built-In Middleman",value:"Your exchanger's go-first limit is in their name (like **Up To $50**). Above it, Konvert's **built-in server middleman bot** holds the crypto inside your ticket, so nobody has to go first. You can also ask for it any time with `$mm`.",inline:false},{name:"5.  Send & Confirm",value:"Staff confirms the deal. You send funds and share proof. Once confirmed, you receive your crypto or payment.",inline:false},{name:"Stay Safe",value:"Staff never DM you first. Anyone doing so is an impersonator. All communication stays in your ticket.",inline:false}).setFooter({text:"Konvert Exchange  ·  Questions? Ask in your ticket"})],flags:64});}
      if(cmd==="ping"){const sent=Date.now();await interaction.deferReply({flags:64});return interaction.editReply({embeds:[base("Bot Status").setThumbnail(IMG.LOGO).setDescription("**All systems operational.** Konvert is online and ready.\n\u200b").addFields({name:"Status",value:"**Online**",inline:true},{name:"Latency",value:`**${Date.now()-sent}ms**`,inline:true},{name:"API Latency",value:client.ws.ping>=0?`**${client.ws.ping}ms**`:"**—**",inline:true}).setFooter({text:`Konvert Exchange  ·  Bot Status  ·  ${BUILD_TEXT}`})]});}

      if(cmd==="calc"){await interaction.deferReply({flags:64});if(!CONFIG.RATES_CHANNEL)return interaction.editReply("RATES_CHANNEL_ID not configured.");const ch=interaction.guild.channels.cache.get(CONFIG.RATES_CHANNEL);if(!ch)return interaction.editReply("Rates channel not found.");const embed=await buildRatesEmbed();if(ratesMsgId){const msg=await ch.messages.fetch(ratesMsgId).catch(()=>null);if(msg){await msg.edit({embeds:[embed]});}else{const s=await ch.send({embeds:[embed]});ratesMsgId=s.id;}}else{const s=await ch.send({embeds:[embed]});ratesMsgId=s.id;}return interaction.editReply("Rates posted.");}
      if(cmd==="setwallet"){const coin=interaction.options.getString("coin").toUpperCase(),addr=interaction.options.getString("address");const w=load("wallets");w[coin]=addr;save("wallets",w);log(interaction.guild,`WALLET: ${interaction.user.tag} set ${coin} to ${addr}`);return interaction.reply({content:`**${coin}** deposit address updated to \`${addr}\``,flags:64});}
      if(cmd==="announce"){const message=interaction.options.getString("message"),channelId=interaction.options.getString("channel"),ping=interaction.options.getString("ping")||"none",ch=interaction.guild.channels.cache.get(channelId);if(!ch)return interaction.reply({content:"Channel not found.",flags:64});const pingStr=ping==="everyone"?"@everyone ":ping==="here"?"@here ":"";await ch.send({content:pingStr||undefined,embeds:[base("Konvert Announcement").setThumbnail(IMG.LOGO).setDescription(message).setFooter({text:`Konvert Exchange  ·  Announced by ${interaction.user.tag}  ·  Konvert`})]});return interaction.reply({content:"Announced.",flags:64});}
      if(cmd==="blacklist"){const target=interaction.options.getUser("user"),reason=interaction.options.getString("reason")||"No reason given";if(isOwner(target.id))return interaction.reply({content:"Owners can't be blacklisted.",flags:64});const bl=load("blacklist");bl[target.id]={tag:target.tag,reason,by:interaction.user.tag,at:Date.now()};save("blacklist",bl);log(interaction.guild,`BLACKLIST: ${target.tag} -- ${reason}`);return interaction.reply({content:`**${target.tag}** blacklisted. Reason: ${reason}`,flags:64});}
      if(cmd==="unblacklist"){const target=interaction.options.getUser("user");const bl=load("blacklist");delete bl[target.id];save("blacklist",bl);return interaction.reply({content:`**${target.tag}** removed from blacklist.`,flags:64});}
      if(cmd==="closeticket"){
        const reason=interaction.options.getString("reason")||"Deal complete";
        await interaction.deferReply();
        if(await doCloseTicket(interaction.channel,interaction.guild,interaction.user,reason)===false)return interaction.editReply({content:"The ticket was not closed."}).catch(()=>{});
        const isDealComplete=!reason||reason.toLowerCase().includes("complete")||reason.toLowerCase().includes("done");
        const isCancelled=reason.toLowerCase().includes("cancel");
        const closeTitle=isCancelled?`Deal Cancelled`:isDealComplete?`Deal Complete`:`Ticket Closed`;
        await interaction.editReply({embeds:[new EmbedBuilder()
          .setColor(isCancelled?UI.mute:isDealComplete?UI.ok:UI.mute)
          .setAuthor(kAuthor("Ticket"))
          .setTitle(closeTitle)
          .setDescription(`${isCancelled?"This exchange has been cancelled.":"This exchange has been completed and the ticket is now closed."}
Deleting in 10 seconds.`)
          .setTimestamp()]});
        setTimeout(()=>interaction.channel.delete().catch(()=>{}),10000);return;
      }
      if(cmd==="cancelticket"){const reason=interaction.options.getString("reason")||"Cancelled by staff";await interaction.deferReply();{const _mw=await mmBeforeClose(interaction.channel,true).catch(()=>null);if(_mw)return interaction.editReply({content:_mw});}const tickets=load("tickets");if(tickets[interaction.channel.id]){tickets[interaction.channel.id].status="cancelled";tickets[interaction.channel.id].cancelledAt=Date.now();save("tickets",tickets);const t=tickets[interaction.channel.id];try{const mem=await interaction.guild.members.fetch(t.userId).catch(()=>null);if(mem)await mem.send({embeds:[base("Ticket Cancelled").setDescription(`Your Konvert exchange ticket has been cancelled by staff.\n**Reason:** ${reason}\n\nIf this is a mistake, please open a new ticket.`).setFooter({text:"Konvert Exchange"})]}).catch(()=>{});}catch{}}await interaction.editReply({embeds:[kEmbed("Ticket","mute").setTitle(`Deal Cancelled`).setDescription(`This exchange has been cancelled.${reason&&reason!=="Cancelled by staff"?`\n**Reason:** ${reason}`:""}\nDeleting in 10 seconds.`).setTimestamp()]});log(interaction.guild,`CANCELLED: #${interaction.channel.name} by ${interaction.user.tag}`);setTimeout(()=>interaction.channel.delete().catch(()=>{}),10000);return;}

      if(cmd==="openticket"){
        await interaction.deferReply();
        const allRoleIds=[...Object.values(CONFIG.ROLES),CONFIG.STAFF_ROLE,CONFIG.EXCHANGER_ROLE].filter(Boolean),uniqueRoles=[...new Set(allRoleIds)],addedRoles=[];
        for(const roleId of uniqueRoles){try{const role=await interaction.guild.roles.fetch(roleId).catch(()=>null);if(!role)continue;await interaction.channel.permissionOverwrites.edit(roleId,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true});addedRoles.push(`<@&${roleId}>`);}catch{}}
        await interaction.editReply({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO}).setTitle("Ticket Opened to All Exchangers").setDescription("This ticket is now **visible to all Konvert exchangers**.\n\nAny available handler can step in and assist with this exchange.\n\u200b").addFields({name:"Roles Added",value:addedRoles.length?addedRoles.join("  "):"None configured",inline:false}).setFooter({text:"Konvert Exchange  ·  Open Ticket"}).setTimestamp()]});
        return;
      }

      if(cmd==="note"){const text=interaction.options.getString("text");await interaction.channel.send({embeds:[new EmbedBuilder().setColor(0xFFB347).setAuthor({name:`Staff Note · ${interaction.user.tag}`,iconURL:interaction.user.displayAvatarURL()}).setDescription(text).setTimestamp().setFooter({text:"Konvert Exchange  ·  Staff Note"})]});return interaction.reply({content:"Note added.",flags:64});}
      if(cmd==="volume"){const all=Object.values(load("tickets")),done=all.filter(t=>t.status==="vouched"&&t.amountUSD&&t.method!=="adjustment"),totalVol=done.reduce((s,t)=>s+(t.amountUSD||0),0),totalFees=done.reduce((s,t)=>s+(t.feeUSD||0),0),open=all.filter(t=>t.status==="open").length,today=done.filter(t=>t.completedAt&&Date.now()-t.completedAt<86400000);const topMethod=topOf(done,"method");return interaction.reply({embeds:[base("Konvert Volume Stats").setThumbnail(IMG.LOGO).addFields({name:"Total Exchanges",value:`**${done.length}** exchange${done.length===1?"":"s"}`,inline:true},{name:"Total Volume",value:`**${fmtUSD(totalVol)}**`,inline:true},{name:"Total Fees",value:`**${fmtUSD(totalFees)}**`,inline:true},{name:"Open Tickets",value:`**${open}**`,inline:true},{name:"Today's Volume",value:`**${fmtUSD(today.reduce((s,t)=>s+(t.amountUSD||0),0))}** (${nExchanges(today.length)})`,inline:true},{name:"Top Method",value:topMethod?`**${topMethod.name}** (${topMethod.n})`:noTop(done),inline:true}).setFooter({text:"Konvert Exchange  ·  Server Volume Statistics"})],flags:64});}

      if(cmd==="snapshot"){
        await interaction.deferReply({flags:64});
        const guild=interaction.guild,all=Object.values(load("tickets")),done=all.filter(t=>["vouched","completed"].includes(t.status)&&t.amountUSD&&t.method!=="adjustment"),open=all.filter(t=>t.status==="open"&&t.method!=="adjustment");const _snapNow=new Date(),_snapESTMid=new Date(_snapNow);_snapESTMid.setUTCHours(5,0,0,0);if(_snapESTMid>_snapNow)_snapESTMid.setUTCDate(_snapESTMid.getUTCDate()-1);const today=done.filter(t=>t.completedAt&&t.completedAt>=_snapESTMid.getTime()),week=done.filter(t=>t.completedAt&&Date.now()-t.completedAt<7*86400000),totalVol=done.reduce((s,t)=>s+(t.amountUSD||0),0);
        const byEx={};done.forEach(t=>{if(t.completedBy)byEx[t.completedBy]=(byEx[t.completedBy]||0)+1;});
        const topMethod=topOf(done,"method"),topEx=Object.entries(byEx).sort((a,b)=>b[1]-a[1])[0];
        await guild.members.fetch();
        const avgDeal=done.length?fmtUSD(totalVol/done.length):"—";
        const estNow=new Date(Date.now()-5*3600000);
        const dateStr=estNow.toLocaleDateString("en-CA",{weekday:"short",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO}).setTitle("Server Snapshot").setDescription(`${dateStr} EST\n\u200b`).addFields(
          {name:"Members",value:`${guild.memberCount}`,inline:true},
          {name:"Open Tickets",value:`${open.length}`,inline:true},
          {name:"All-Time Exchanges",value:`${done.length}`,inline:true},
          {name:"Total Volume",value:fmtUSD(totalVol),inline:true},
          {name:"Today",value:`${nExchanges(today.length)} · ${fmtUSD(today.reduce((s,t)=>s+(t.amountUSD||0),0))}`,inline:true},
          {name:"This Week",value:`${nExchanges(week.length)} · ${fmtUSD(week.reduce((s,t)=>s+(t.amountUSD||0),0))}`,inline:true},
          {name:"Avg Deal Size",value:avgDeal,inline:true},
          {name:"Top Method",value:topMethod?`${topMethod.name} (${topMethod.n})`:noTop(done),inline:true},
          {name:"Top Exchanger",value:topEx?`<@${topEx[0]}> · ${nExchanges(topEx[1])}`:"—",inline:true},
        ).setFooter({text:"Konvert Exchange  ·  Owner Snapshot"}).setTimestamp()]});
      }

      if(cmd==="exchangerboard"){const done=Object.values(load("tickets")).filter(t=>t.status==="vouched"&&t.completedBy&&t.method!=="adjustment"),byEx={};done.forEach(t=>{if(!byEx[t.completedBy])byEx[t.completedBy]={trades:0,volume:0};byEx[t.completedBy].trades+=1;byEx[t.completedBy].volume+=(t.amountUSD||0);});const ranked=Object.entries(byEx).sort((a,b)=>b[1].trades-a[1].trades).slice(0,10);if(!ranked.length)return interaction.reply({content:"No completed exchanges yet.",flags:64});const lines=ranked.map(([uid,d],i)=>`**${i+1}.**  <@${uid}>  ·  **${d.trades}** exchange${d.trades!==1?"s":""}  \u00b7  ${fmtUSD(d.volume)}`).join("\n");return interaction.reply({embeds:[base("Exchanger Leaderboard").setThumbnail(IMG.LOGO).setDescription("Top Konvert exchangers ranked by completed exchanges.\n\u200b").addFields({name:"Rankings",value:lines,inline:false}).setFooter({text:"Konvert Exchange  ·  Exchanger Leaderboard"}).setTimestamp()],flags:64});}

      if(cmd==="thankclient"){
        const target=interaction.options.getUser("client"),amount=interaction.options.getNumber("amount")||null;
        const vol=getUserVolume(target.id),tradeCount=getUserDealCount(target.id),tier=getTier(vol),feePreview=amount?`Your rate on your next **${fmtUSD(amount)}** exchange: **${feeRate(amount,"send")}%**`:null;
        try{await target.send({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO}).setTitle("Thank You for Exchanging with Us").setThumbnail(IMG.LOGO).setDescription(`Hey <@${target.id}> — your exchange has been completed successfully.\n\nWe appreciate your trust in **Konvert Exchange**. Every deal matters to us and we look forward to exchanging with you again.\n\u200b`).addFields({name:"Your Tier",value:`**${tier.label}**`,inline:true},{name:"Exchanges With Us",value:`**${tradeCount}** exchange${tradeCount===1?"":"s"}`,inline:true},{name:"Total Exchanged",value:vol>0?`**${fmtUSD(vol)}**`:"—",inline:true},{name:"Come Back Anytime",value:"Head to our exchange channel anytime.\n**Fast  \u00b7  Safe  \u00b7  Simple  \u00b7  Private**",inline:false},...(feePreview?[{name:"Your Rate Preview",value:feePreview,inline:false}]:[])).setImage(IMG.DEAL).setFooter({text:"Konvert Exchange  ·  Thank you for your business"}).setTimestamp()]});return interaction.reply({content:`Thank-you card sent to **${target.tag}**.`,flags:64});}
        catch{return interaction.reply({content:`Could not DM **${target.tag}**. They may have DMs disabled.`,flags:64});}
      }

      if(cmd==="passes"){const holders=Object.entries(state.passes).filter(([,v])=>v>0);if(!holders.length)return interaction.reply({content:"No exchange passes have been won yet.",flags:64});return interaction.reply({embeds:[base("Exchange Pass Holders").setThumbnail(IMG.LOGO).setDescription(holders.map(([uid,c])=>`<@${uid}> — **${c}** pass${c!==1?"es":""}`).join("\n")).setFooter({text:"Konvert Mine  ·  Won by finding all 3 diamonds"})],flags:64});}
      if(cmd==="postinfo"){const embed=kEmbed().setTitle(`Info`).setThumbnail(IMG.LOGO).setDescription("Konvert is a **fast and reliable exchange community** for converting value across platforms.\n\nEasily exchange **PayPal, Crypto, Cash App, Zelle, E-Transfer**, and other payment methods — both directions — with **low fees** and **quick processing**.\n\nOur agents are available **24/7**, backed by a friendly, active community and real-time crypto price updates to keep you informed.\n\u200b").addFields({name:`Fees`,value:"5% – 10%  ·  Tiered by amount\nMinimum exchange: more than $5",inline:true},{name:"Speed",value:"Usually under 10 minutes",inline:true},{name:"Support",value:"24/7 agents always available",inline:true}).setImage(IMG.BANNER).setFooter(kFoot("Fast  ·  Safe  ·  Simple  ·  Private"));await interaction.channel.send({embeds:[embed]});return interaction.reply({content:"Info embed posted.",flags:64});}
      if(cmd==="posttos"){
        const embed=kEmbed()
          .setTitle("Terms of Service")
          .setThumbnail(IMG.LOGO)
          .setDescription("By using Konvert's services you agree to the following. These terms protect everyone involved and keep exchanges running smoothly.\n\u200b")
          .addFields(
            {name:"1 · Use of Service",
             value:"Konvert is available to anyone who can legally exchange cryptocurrency in their jurisdiction. We reserve the right to refuse or cancel any transaction at any time without explanation.",
             inline:false},
            {name:"2 · Payments from Balance Only",
             value:"All payments must be sent from your own balance. Card payments may incur an additional fee or be rejected entirely at our discretion. If your payment method is flagged or declined, the exchange will not proceed.",
             inline:false},
            {name:"3 · Fees",
             value:"Every exchange has a service fee shown to you before you confirm. The minimum fee is $5 per exchange and the minimum amount is $6. Once both parties confirm an exchange is complete, the fee is non-refundable.",
             inline:false},
            {name:"4 · Right to Refuse",
             value:"We reserve the right to reject any transaction we reasonably suspect involves money laundering, fraudulent activity, or suspicious alternate accounts. No explanation will be provided and no liability is assumed.",
             inline:false},
            {name:"5 · Exchanger Limits",
             value:"Each exchanger has a go-first limit displayed on their profile. If you proceed without reading or respecting that limit, Konvert is not liable for any resulting loss or dispute.",
             inline:false},
            {name:"6 · Off-Platform Activity",
             value:"Any business conducted outside of Konvert's official ticket system is entirely at your own risk. We are not responsible for losses, scams, or disputes arising from off-platform arrangements.",
             inline:false},
            {name:"7 · Impersonators",
             value:"Our staff and owners will never DM you first. If you engage with or send funds to someone impersonating Konvert, we are not liable for any loss. Always verify inside your official ticket.",
             inline:false},
            {name:"8 · Payment Compliance",
             value:"If you do not send from your balance or fail to use the exact payment method requested by your exchanger, we are not liable for lost or delayed funds. Always follow your exchanger's instructions precisely.",
             inline:false},
            {name:"9 · Disputes",
             value:"If something goes wrong, flag it inside your ticket immediately. Abusing the dispute process or filing false claims will result in a permanent ban.",
             inline:false},
          )
          .setImage(IMG.BANNER)
          .setFooter(kFoot("Using our service means you accept these terms"));
        await interaction.channel.send({embeds:[embed]});
        return interaction.reply({content:"Terms of Service embed posted.",flags:64});
      }
      if(cmd==="postlinks"){const embed=kEmbed().setTitle(`Official Links for Konvert`).setThumbnail(IMG.LOGO).setDescription("All official Konvert social media. Follow us for updates, announcements, and giveaways.\n\u200b").addFields({name:"Twitter / X",value:"[**@KonvertNow**](https://x.com/konvertnow)",inline:true},{name:"Instagram",value:"[**@KonvertNow**](https://www.instagram.com/konvertnow/)",inline:true},{name:`Stay Safe`,value:"Only interact with accounts listed here. Any other account claiming to be Konvert is an impersonator.",inline:false}).setImage(IMG.BANNER).setFooter(kFoot("Official links  ·  Follow us for updates"));await interaction.channel.send({embeds:[embed]});return interaction.reply({content:"Official links embed posted.",flags:64});}

      if(cmd==="adjuststats"){
        const target=interaction.options.getUser("user"),amount=interaction.options.getNumber("amount"),reason=interaction.options.getString("reason")||"Staff adjustment";
        if(amount===0)return interaction.reply({content:"Amount cannot be 0.",flags:64});
        const tickets=Object.keys(_mem.tickets||{}).length>0?{..._mem.tickets}:load("tickets");
        const key=`adj_${target.id}_${Date.now()}`;
        tickets[key]={userId:target.id,userTag:target.tag||target.username,method:amount>0?"adjustment_deal":"adjustment",direction:null,coin:null,amountUSD:amount,feeUSD:0,walletInfo:"staff",notes:reason,status:"vouched",completedBy:interaction.user.id,completedAt:Date.now(),createdAt:Date.now()};
        _mem.tickets=tickets;save("tickets",tickets);
        updateStatChannel(interaction.guild).catch(()=>{});
        const newVol=getUserVolume(target.id);await applyTierRole(interaction.guild,target.id,newVol);
        const tier=getTier(newVol);
        log(interaction.guild,`ADJUSTSTATS: ${interaction.user.tag} adjusted ${target.tag||target.username} by ${amount>0?"+":""}${fmtUSD(amount)} | New total: ${fmtUSD(newVol)} | Reason: ${reason}`);
        return interaction.reply({embeds:[base("Stats Adjusted").setThumbnail(target.displayAvatarURL({size:128})).setDescription(`Stats updated for <@${target.id}>.\n\u200b`).addFields({name:"Adjustment",value:`**${amount>0?"+":""}${fmtUSD(amount)}**`,inline:true},{name:"New Volume",value:`**${fmtUSD(newVol)}**`,inline:true},{name:"New Tier",value:`**${tier.label}**`,inline:true},{name:"Reason",value:reason,inline:false}).setFooter({text:`Konvert Exchange  ·  Adjusted by ${interaction.user.tag}  ·  Konvert`})],flags:64});
      }

      if(cmd==="suspended"){
        const entries=Object.entries(_mem.suspensions||{});
        const holds=Object.entries(_mem.holds||{}).filter(([id])=>!isSuspended(id)&&isOnHold(id));
        if(!entries.length&&!holds.length)return interaction.reply({content:"No exchangers are currently suspended or on hold.",flags:64});
        const _row=(id,s,tag)=>`<@${id}> \u00B7 ${tag}client <@${s.clientId}> \u00B7 ${s.amountUSD?fmtUSD(s.amountUSD):"—"} \u00B7 <t:${Math.floor((s.at||Date.now())/1000)}:R>\n> ${String(s.reason||"").slice(0,160)}\n> https://discord.com/channels/${interaction.guild.id}/${s.channelId}`;
        const lines=[...entries.map(([id,s])=>_row(id,s,"")),...holds.map(([id,h])=>_row(id,h,`on hold (${h.level}) \u00B7 `))].join("\n\n");
        return interaction.reply({embeds:[new EmbedBuilder().setColor(0xef4444).setAuthor({name:"Konvert Exchange  ·  Suspended Exchangers",iconURL:IMG.LOGO}).setDescription(lines.slice(0,4000)).setFooter({text:`Konvert Exchange  ·  ${entries.length} suspended  ·  ${holds.length} on hold  ·  /reinstate to lift`}).setTimestamp()],flags:64});
      }

      if(cmd==="reinstate"){
        await interaction.deferReply({flags:64});
        const target=interaction.options.getUser("user");
        if(!isSuspended(target.id)&&!isOnHold(target.id))return interaction.editReply({content:`**${target.username}** isn't suspended or on hold.`});
        const _r=await liftRestrictions(interaction.guild,target.id);
        log(interaction.guild,`REINSTATE: ${interaction.user.tag} reinstated ${target.tag||target.username}`);
        return interaction.editReply({content:`Reinstated <@${target.id}>.`+(_r.suspended?` Typing access restored in ${_r.restored} open ticket${_r.restored!==1?"s":""}.`:" New claims are open again.")});
      }

      if(cmd==="clearexchanger"){
        await interaction.deferReply({flags:64});
        const target=interaction.options.getUser("user");
        const _r=await liftRestrictions(interaction.guild,target.id);
        log(interaction.guild,`CLEARED: ${interaction.user.tag} cleared ${target.tag||target.username} of all doubt`);
        return interaction.editReply({content:clearSummary(target.id,_r)});
      }
      if(cmd==="profittest"){
        await interaction.deferReply({flags:64});
        const _pt=await notifyProfitOwners(profitTestEmbed(),{test:true});
        const _lines=[..._pt.sent.map(id=>`<@${id}> received it`),..._pt.failed.map(f=>`<@${f.id}> — ${f.reason}`)];
        const _tip=_pt.failed.length?"\n\nThat person can't be DMed. Fix: Server Settings → Privacy → allow direct messages from server members. Until then their real notices are posted in the log channel.":"";
        return interaction.editReply({content:`Test notice sent to ${PROFIT_DM_IDS.length} recipient${PROFIT_DM_IDS.length===1?"":"s"}:\n${_lines.join("\n")}${_tip}`,allowedMentions:{parse:[]}});
      }

      if(cmd==="transferstats"){
        await interaction.deferReply({flags:64});
        const fromUser=interaction.options.getUser("from");
        const toUser=interaction.options.getUser("to");
        if(fromUser.id===toUser.id)return interaction.editReply({content:"Cannot transfer to the same account."});
        const tickets=Object.keys(_mem.tickets||{}).length>0?{..._mem.tickets}:load("tickets");
        // Move every ticket owned by fromUser to toUser
        let moved=0;
        let movedVol=0;
        for(const [key,t] of Object.entries(tickets)){
          if(t.userId===fromUser.id){
            t.userId=toUser.id;
            t.userTag=toUser.tag||toUser.username;
            movedVol+=(parseFloat(t.amountUSD)||0);
            moved++;
          }
        }
        // Move any manual volume adjustments
        if(state.volumeAdj[fromUser.id]){
          state.volumeAdj[toUser.id]=(state.volumeAdj[toUser.id]||0)+state.volumeAdj[fromUser.id];
          delete state.volumeAdj[fromUser.id];
        }
        // Move mine passes
        if(state.passes[fromUser.id]){
          state.passes[toUser.id]=(state.passes[toUser.id]||0)+state.passes[fromUser.id];
          delete state.passes[fromUser.id];
        }
        _mem.tickets=tickets;save("tickets",tickets);
        dbSet("konvert_tickets",tickets).catch(()=>{});
        updateStatChannel(interaction.guild).catch(()=>{});
        // Remove all tier roles from source account
        try{
          const fromMember=await interaction.guild.members.fetch(fromUser.id).catch(()=>null);
          if(fromMember){for(const t of TIERS){if(t.role&&fromMember.roles.cache.has(t.role))await fromMember.roles.remove(t.role).catch(()=>{});}}
        }catch{}
        // Apply correct tier role to destination account
        const newVol=getUserVolume(toUser.id);
        await applyTierRole(interaction.guild,toUser.id,newVol).catch(()=>{});
        const newTier=getTier(newVol);
        log(interaction.guild,`TRANSFERSTATS: ${interaction.user.tag} moved ${nExchanges(moved)} (${fmtUSD(movedVol)}) from ${fromUser.tag||fromUser.username} to ${toUser.tag||toUser.username}`);
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange  ·  Stats Transfer",iconURL:IMG.LOGO}).setTitle("Transfer Complete").addFields(
          {name:"From",value:`<@${fromUser.id}>\nNow **$0.00** \u00b7 0 exchanges`,inline:true},
          {name:"To",value:`<@${toUser.id}>\nNow **${fmtUSD(newVol)}** \u00b7 ${nExchanges(getUserDealCount(toUser.id))}`,inline:true},
          {name:"Moved",value:`**${moved}** exchange${moved===1?"":"s"} \u00b7 **${fmtUSD(movedVol)}** volume`,inline:false},
          {name:"New Tier",value:`**${newTier.label}**`,inline:true},
        ).setFooter({text:"Konvert Exchange  ·  Stats transferred"}).setTimestamp()]});
      }

      if(cmd==="resetstats"){
        const target=interaction.options.getUser("user");
        const tickets=Object.keys(_mem.tickets||{}).length>0?{..._mem.tickets}:load("tickets");
        let removed=0;
        for(const [key,t] of Object.entries(tickets)){if(t.userId===target.id){delete tickets[key];removed++;}}
        _mem.tickets=tickets;save("tickets",tickets);
        dbSet("konvert_tickets",tickets).catch(()=>{});
        updateStatChannel(interaction.guild).catch(()=>{});
        delete state.volumeAdj[target.id];
        try{const member=await interaction.guild.members.fetch(target.id).catch(()=>null);if(member){for(const t of TIERS){if(t.role&&member.roles.cache.has(t.role))await member.roles.remove(t.role).catch(()=>{});}}}catch{}
        await applyTierRole(interaction.guild,target.id,0);
        return interaction.reply({content:`All stats wiped for **${target.tag||target.username}**. Removed **${removed}** entries, cleared adjustments, reset tier to New Client.`,flags:64});
      }

      if(cmd==="clearleaderboard"){
        await interaction.deferReply({flags:64});
        const _before=Object.keys(_mem.tickets||{}).length;
        _mem.tickets={};save("tickets",{});
        dbSet("konvert_tickets",{}).catch(()=>{});
        state.volumeAdj={};
        try{
          const allM=await interaction.guild.members.fetch();
          const tRoles=TIERS.map(t=>t.role).filter(Boolean);
          for(const mem of allM.values()){
            if(tRoles.some(r=>mem.roles.cache.has(r))){
              await mem.roles.set(mem.roles.cache.filter(r=>!tRoles.includes(r.id)).map(r=>r.id)).catch(()=>{});
            }
          }
        }catch(e){console.log("[clearLB]",e.message);}
        updateStatChannel(interaction.guild).catch(()=>{});
        return interaction.editReply(`Cleared ${_before} entries. All tier roles removed.`);
      }

      if(cmd==="wipestats"){
        await interaction.deferReply({flags:64});
        const target=interaction.options.getUser("user"),confirm=interaction.options.getString("confirm");
        if(confirm!=="CONFIRM"){return interaction.editReply({content:'You must type **CONFIRM** exactly in the confirm field to wipe a user. This cannot be undone.',flags:64});}
        const tickets=Object.keys(_mem.tickets||{}).length>0?{..._mem.tickets}:load("tickets");
        let removed=0;
        for(const [key,t] of Object.entries(tickets)){if(t.userId===target.id){delete tickets[key];removed++;}}
        _mem.tickets=tickets;save("tickets",tickets);
        dbSet("konvert_tickets",tickets).catch(()=>{});


        try{const member=await interaction.guild.members.fetch(target.id).catch(()=>null);if(member){for(const t of TIERS){if(t.role&&member.roles.cache.has(t.role))await member.roles.remove(t.role).catch(()=>{});}}}catch{}
        try{await target.send({embeds:[new EmbedBuilder().setColor(0xef4444).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO}).setTitle("Account Reset").setDescription("Your exchange history and stats have been reset by staff.\n\nIf you believe this is a mistake, please open a support ticket.").setFooter({text:"Konvert Exchange"}).setTimestamp()]});}catch{}
        delete state.volumeAdj[target.id];
        updateStatChannel(interaction.guild).catch(()=>{});
        log(interaction.guild,`WIPESTATS: ${interaction.user.tag} wiped ALL data for ${target.tag||target.username} \u2014 ${removed} entries removed`);
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(0xef4444).setAuthor({name:"Konvert Exchange  ·  Admin",iconURL:IMG.LOGO}).setTitle("User Wiped").setThumbnail(target.displayAvatarURL({size:128})).setDescription(`All data for <@${target.id}> has been permanently removed.\n\u200b`).addFields({name:"Entries Removed",value:`**${removed}**`,inline:true},{name:"Referral Points",value:"**Cleared**",inline:true},{name:"Tier Roles",value:"**Removed**",inline:true}).setFooter({text:`Konvert Exchange  ·  Wiped by ${interaction.user.tag}`}).setTimestamp()]});
      }

      if(cmd==="complete"){
        await interaction.deferReply();
        const tickets=Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets");
        const ticket=tickets[interaction.channel.id];
        if(!ticket)return interaction.editReply({content:"No ticket found for this channel.",flags:64});
        if(ticket.status==="vouched"||ticket.status==="closed")return interaction.editReply({content:"This exchange is already complete.",flags:64});
        const exchanger=interaction.options.getUser("exchanger");
        const amountOverride=interaction.options.getNumber("amount");
        if(amountOverride&&amountOverride>0)ticket.amountUSD=amountOverride;
        ticket._overrideExchangerId=exchanger.id;
        await completeTrade(interaction,ticket,tickets);
        return;
      }

      if(cmd==="dispute"){
        await interaction.deferReply({flags:64});
        const tickets=Object.keys(_mem.tickets||{}).length?_mem.tickets:load("tickets");
        const ticket=Object.entries(tickets).find(([id,t])=>id===interaction.channel.id&&t.status==="open");
        if(!ticket){return interaction.editReply({content:"This command can only be used inside your open ticket channel.",flags:64});}
        const [channelId,t]=ticket;
        try{await interaction.channel.permissionOverwrites.edit(interaction.user.id,{SendMessages:false});if(CONFIG.EXCHANGER_ROLE)await interaction.channel.permissionOverwrites.edit(CONFIG.EXCHANGER_ROLE,{SendMessages:false}).catch(()=>{});}catch{}
        await interaction.channel.send({embeds:[new EmbedBuilder().setColor(0xef4444).setAuthor({name:"Konvert Exchange  ·  Dispute Filed",iconURL:IMG.LOGO}).setTitle("Dispute Filed").setDescription(`<@${interaction.user.id}> has flagged an issue with this exchange.\n\nThis ticket has been **locked** pending staff review. Only owners can unlock it.\n\u200b`).addFields({name:"Filed By",value:`<@${interaction.user.id}>`,inline:true},{name:"Time",value:`<t:${Math.floor(Date.now()/1000)}:F>`,inline:true},{name:"Status",value:"**Under Review**",inline:true}).setFooter({text:"Konvert Exchange  ·  Do not close this ticket until resolved"}).setTimestamp()]});
        tickets[channelId].status="dispute";_mem.tickets=tickets;save("tickets",tickets);
        for(const oid of CONFIG.OWNER_IDS){try{const owner=await client.users.fetch(oid);await owner.send({embeds:[new EmbedBuilder().setColor(0xef4444).setAuthor({name:"Konvert Exchange  ·  Dispute Alert",iconURL:IMG.LOGO}).setTitle("Dispute Filed").setDescription(`${dealHead(dealOf(t))}\nA client has filed a dispute in a ticket.`).addFields({name:"Client",value:`<@${interaction.user.id}>`,inline:true},{name:"Channel",value:`<#${channelId}>`,inline:true}).setFooter({text:"Konvert Exchange  ·  Review immediately"}).setTimestamp()]});}catch{}}
        log(interaction.guild,`DISPUTE: ${interaction.user.tag} filed dispute in #${interaction.channel.name}`);
        return interaction.editReply({content:"Your dispute has been filed. Staff have been notified and will review shortly. The ticket has been locked.",flags:64});
      }

      if(cmd==="broadcast"){
        await interaction.deferReply({flags:64});
        const days=interaction.options.getInteger("days")||30;
        const msg=interaction.options.getString("message");
        const cutoff=Date.now()-(days*24*60*60*1000);
        const allT=Object.values(_mem.tickets&&Object.keys(_mem.tickets).length?_mem.tickets:load("tickets"));
        const uniqueIds=[...new Set(allT.filter(t=>["vouched","completed"].includes(t.status)&&(t.completedAt||0)>=cutoff&&t.method!=="adjustment").map(t=>t.userId))];
        if(!uniqueIds.length)return interaction.editReply({content:`No clients found who exchanged in the last ${days===1?"day":`${days} days`}.`});
        await interaction.editReply({content:`Sending to **${uniqueIds.length}** client${uniqueIds.length===1?"":"s"}...`});
        let sent=0,failed=0;
        for(const uid of uniqueIds){try{const u=await client.users.fetch(uid);await u.send({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO}).setTitle("Message from Konvert").setDescription(msg).setImage(IMG.BANNER).setFooter({text:"Konvert Exchange  ·  Thank you for exchanging with us"}).setTimestamp()]});sent++;await new Promise(r=>setTimeout(r,800));}catch{failed++;}}
        return interaction.followUp({content:`Broadcast complete \u2014 **${sent}** sent, **${failed}** failed (DMs closed).`,flags:64});
      }

      if(cmd==="myexchanges"){
        await interaction.deferReply({flags:64});
        const userId=interaction.user.id;
        const _myTicketSrc=Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets");
        const allT=Object.values(_myTicketSrc);
        const done=allT.filter(t=>
          t.userId===userId&&
          ["vouched","completed"].includes(t.status)&&
          t.method!=="adjustment"&&
          parseFloat(t.amountUSD||0)>0
        ).sort((a,b)=>(b.completedAt||0)-(a.completedAt||0));
        const volume=getUserVolume(userId),tier=getTier(volume),nextT=getNextTier(volume),vip=isVipVolume(volume);
        if(!done.length){return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange  ·  My Exchanges",iconURL:IMG.LOGO}).setTitle("No Exchanges Yet").setDescription("You haven't completed any exchanges with Konvert yet.\n\nHead to the exchange channel to get started.\n\u200b").setImage(IMG.BANNER).setFooter({text:"Konvert Exchange"}).setTimestamp()]});}
        const last5=done.slice(0,5).map((t,i)=>{return `${i+1}. **${methodLabel(t.method)}** \u00b7 ${fmtUSD(t.amountUSD)} \u00b7 <t:${Math.floor((t.completedAt||Date.now())/1000)}:d>`;}).join("\n");
        const topM=topOf(done,"method");
        const avg=done.reduce((s,t)=>s+(parseFloat(t.amountUSD)||0),0)/done.length;
        const refPts=0;
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange  ·  My Exchange History",iconURL:IMG.LOGO}).setTitle("My Exchanges").setThumbnail(interaction.user.displayAvatarURL({size:256})).setDescription(`**${tier.label}**${vip?"  \u00B7  VIP":""}${nextT?`  \u00b7  ${fmtUSD(Math.max(nextT.min-volume,0))} to ${nextT.label}`:"  \u00b7  Max tier reached"}\n\u200b`).addFields({name:"Total Exchanges",value:`**${done.length}**`,inline:true},{name:"Total Volume",value:`**${fmtUSD(volume)}**`,inline:true},{name:"Avg Exchange",value:`**${fmtUSD(avg)}**`,inline:true},{name:"Top Method",value:topM?`**${topM.name}** (${topM.n}x)`:noTop(done),inline:true},{name:"VIP Discount",value:vip?"Active \u2014 0.75% off":"Not yet ($7,000+ required)",inline:true},{name:"Last 5 Exchanges",value:last5,inline:false}).setImage(IMG.BANNER).setFooter({text:"Konvert Exchange  ·  Use /stats for full tier details"}).setTimestamp()]});
      }

      if(cmd==="estimate"){
        await interaction.deferReply({flags:64});
        const amount=interaction.options.getNumber("amount"),methodRaw=interaction.options.getString("method").toLowerCase().trim(),coinRaw=resolveCoin(interaction.options.getString("coin")),direction=interaction.options.getString("direction");
        const m=METHODS.find(x=>x.label.toLowerCase().includes(methodRaw)||x.value.includes(methodRaw));
        if(!m)return interaction.editReply({content:`Method **${methodRaw}** not recognised. Try: PayPal, Interac, Zelle, Cash App etc.`});
        if(!isKnownCoin(coinRaw))return interaction.editReply({content:`Coin **${coinRaw}** not supported. Try BTC, ETH, SOL, LTC etc.`});
        if(!aboveMinimum(amount))return interaction.editReply({content:minAmountText()});
        const vol=getUserVolume(interaction.user.id),vip=isVipVolume(vol);
        const fee=calcFee(amount,direction,vip),rate=feeRate(amount,direction,vip);
        const coinPrice=await getPrice(coinRaw),tier=getTier(vol);
        const d=dealOf({method:m.value,direction,coin:coinRaw,amountUSD:amount,feeUSD:fee});
        const coinAmt=(direction==="send"&&coinPrice&&d.net!=null)?(d.net/coinPrice).toFixed(6):null;
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange  ·  Quote",iconURL:IMG.LOGO}).setTitle("Exchange Estimate")
          .setDescription(`${dealHead(d,vip?["VIP rate"]:[])}\n${kLedger(dealRows(d,{rate,coinAmt}))}Live quote for your proposed exchange. Open a ticket to proceed.`)
          .addFields({name:`${coinRaw} Price`,value:coinPrice?`**${fmtUSD(coinPrice)}**`:"Unavailable",inline:true},{name:"Your Tier",value:`**${tier.label}**`,inline:true})
          .setImage(IMG.BANNER).setFooter({text:"Konvert Exchange  ·  Estimate only  ·  Final rate confirmed in your ticket"}).setTimestamp()]});
      }

      if(cmd==="tierlist"){
        const lines=TIERS.map(t=>`**${t.label}** \u2014 $${t.min.toLocaleString()}+${t.min>=7000?"  \u00B7  VIP":""}`).join("\n");
        return interaction.reply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange  ·  Client Tiers",iconURL:IMG.LOGO}).setTitle("Client Tier Ranks").setDescription("Earn your tier by exchanging volume on Konvert. Tiers are auto-assigned after every exchange. All tiers from Godly Client and above receive a **0.75% VIP fee discount**.\n\u200b").addFields({name:"All Tiers",value:lines,inline:false}).setImage(IMG.BANNER).setFooter({text:"Konvert Exchange  ·  Tiers auto-assigned after every exchange"}).setTimestamp()],ephemeral:false});
      }

      if(cmd==="claimtag"){
        await interaction.deferReply({flags:64});
        const userId=interaction.user.id;
        const member=await interaction.guild.members.fetch({user:userId,force:true}).catch(()=>null);
        if(!member)return interaction.editReply({content:"Could not fetch your profile. Try again.",flags:64});
        const hasRole=member.roles.cache.has(KONV_TAG_ROLE);
        const pg=(member.user&&member.user.primaryGuild)||null;
        const hasPG=!!(pg&&pg.identityEnabled&&pg.identityGuildId===CONFIG.GUILD_ID);
        if(!hasRole&&!hasPG)return interaction.editReply({content:"KONV tag not detected on your profile. Make sure Konvert is set as your active clan in Discord profile settings, then try again.",flags:64});
        state.konvTagUsers.add(userId);
        if(!hasRole)await member.roles.add(KONV_TAG_ROLE).catch(()=>{});
        return interaction.editReply({content:"Tag verified and perk activated. You now get 0.2% off every exchange automatically.",flags:64});
      }

      if(cmd==="removetag"){
        await interaction.deferReply({flags:64});
        const target=interaction.options.getUser("user")||interaction.user;
        state.konvTagUsers.delete(target.id);
        try{const m=await interaction.guild.members.fetch(target.id).catch(()=>null);if(m&&m.roles.cache.has(KONV_TAG_ROLE))await m.roles.remove(KONV_TAG_ROLE).catch(()=>{});}catch{}
        return interaction.editReply({content:`KONV tag perk removed from **${target.username}**.`,flags:64});
      }

      if(cmd==="postleaderboard"){
        await interaction.deferReply({flags:64});
        const embed=await buildLiveLeaderboardEmbed();
        const msg=await interaction.channel.send({embeds:[embed]});
        state.liveLbMessageId=msg.id;
        state.liveLbChannelId=interaction.channel.id;
        saveLiveLb();
        return interaction.editReply({content:`Live leaderboard posted. It will auto-update after every exchange and every 10 minutes.`,flags:64});
      }

      if(cmd==="giveaway"){
        await interaction.deferReply({flags:64});
        const prize=interaction.options.getString("prize");
        const minutes=interaction.options.getInteger("minutes");
        const nw=interaction.options.getInteger("winners")||1;
        const endsAt=Date.now()+(minutes*60000);
        const endsTs=Math.floor(endsAt/1000);
        const _buildGiveawayEmbed=(entries)=>{
          const msLeft=endsAt-Date.now();
          const minsLeft=Math.max(0,Math.floor(msLeft/60000));
          const timeStr=minsLeft>=120?`${Math.floor(minsLeft/1440)}d ${Math.floor((minsLeft%1440)/60)}h left`:minsLeft>=60?`${Math.floor(minsLeft/60)}h ${minsLeft%60}m left`:`${minsLeft}m left`;
          return new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange  ·  Giveaway",iconURL:IMG.LOGO}).setTitle("KONV Tag Giveaway!").setDescription(`**${prize}**\n\u200b`).addFields({name:"How to Enter",value:"Must have the **KONV** clan tag. Click below.",inline:false},{name:"Winners",value:`**${nw}**`,inline:true},{name:"Time Left",value:timeStr,inline:true},{name:"Entries",value:`**${entries}** ${entries===1?"person":"people"} entered`,inline:true}).setImage(IMG.BANNER).setFooter({text:"Konvert Exchange  ·  KONV tag required"}).setTimestamp();
        };
        const gr=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("btn_giveaway_enter").setLabel("Enter Giveaway").setStyle(ButtonStyle.Success));
        const gm=await interaction.channel.send({embeds:[_buildGiveawayEmbed(0)],components:[gr]});
        state.activeGiveaway={messageId:gm.id,channelId:interaction.channel.id,prize,endsAt,numWinners:nw,entrants:new Set(),buildEmbed:_buildGiveawayEmbed};
        // Update embed every 60 seconds with live time + entry count
        const _gInterval=setInterval(async()=>{
          if(!state.activeGiveaway||state.activeGiveaway.messageId!==gm.id){clearInterval(_gInterval);return;}
          try{
            const _gc=interaction.guild.channels.cache.get(interaction.channel.id);
            const _gm=_gc?await _gc.messages.fetch(gm.id).catch(()=>null):null;
            if(_gm)await _gm.edit({embeds:[_buildGiveawayEmbed(state.activeGiveaway.entrants.size)]}).catch(()=>{});
          }catch{}
        },60000);
        await interaction.editReply({content:`Giveaway started! Ends <t:${endsTs}:R>`,flags:64});
        setTimeout(async()=>{if(!state.activeGiveaway||state.activeGiveaway.messageId!==gm.id)return;clearInterval(_gInterval);await endGiveaway(interaction.guild,interaction.channel);},minutes*60000);
        return;
      }

      if(cmd==="migrateserver"){
        await interaction.deferReply({flags:64});
        const vchId=CONFIG.VOUCH_CHANNEL;
        if(!vchId)return interaction.editReply({content:"VOUCH_CHANNEL_ID env var not set.",flags:64});
        const vch=interaction.guild.channels.cache.get(vchId)||await interaction.guild.channels.fetch(vchId).catch(()=>null);
        if(!vch)return interaction.editReply({content:"Vouch channel not found. Check VOUCH_CHANNEL_ID.",flags:64});
        const allT=Object.values(load("tickets")).filter(t=>["vouched","completed"].includes(t.status)&&t.method!=="adjustment"&&parseFloat(t.amountUSD||0)>0&&t.userId).sort((a,b)=>(a.completedAt||0)-(b.completedAt||0));
        await interaction.editReply({content:`Starting migration — re-posting **${allT.length}** vouches. This may take a few minutes...`,flags:64});
        let posted=0;
        for(const t of allT){
          try{
            const ml=methodLabel(t.method);
            const dirStr=t.direction==="send"?`${ml} \u2192 ${t.coin||"Crypto"}`:`${t.coin||"Crypto"} \u2192 ${ml}`;
            const dateStr=t.completedAt?`<t:${Math.floor(t.completedAt/1000)}:D>`:"unknown date";
            await vch.send({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert Exchange  ·  Exchange Verified",iconURL:IMG.LOGO}).setTitle("Exchange Complete").setThumbnail(IMG.LOGO).addFields({name:"Client",value:`<@${t.userId}>`,inline:true},{name:"Amount",value:fmtUSD(t.amountUSD),inline:true},{name:"Direction",value:dirStr,inline:true},{name:"Date",value:dateStr,inline:true},...(t.message?[{name:"Review",value:t.message,inline:false}]:[]))
              .setFooter({text:"Konvert Exchange  ·  Migrated Record"})]});
            posted++;
            if(posted%10===0)await new Promise(r=>setTimeout(r,2000)); // rate limit safety
          }catch{}
        }
        return interaction.editReply({content:`Migration complete — **${posted}/${allT.length}** vouches re-posted to <#${vchId}>.`,flags:64});
      }

      if(cmd==="giveawaystats"){
        if(!state.activeGiveaway)return interaction.reply({content:"No active giveaway running.",flags:64});
        const {prize,endsAt,numWinners,entrants}=state.activeGiveaway;
        const arr=[...entrants];
        const endsTs=Math.floor(endsAt/1000);
        const entrantList=arr.length?arr.map((id,i)=>`${i+1}. <@${id}>`).join("\n"):"No entries yet.";
        return interaction.reply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange  ·  Giveaway Stats",iconURL:IMG.LOGO}).setTitle("Active Giveaway").addFields({name:"Prize",value:prize,inline:true},{name:"Winners",value:`${numWinners}`,inline:true},{name:"Entries",value:`${arr.length}`,inline:true},{name:"Ends",value:`<t:${endsTs}:R>`,inline:true},{name:"Entrants",value:entrantList.slice(0,1000),inline:false}).setFooter({text:"Konvert Exchange  ·  Owner only"}).setTimestamp()],flags:64});
      }

      if(cmd==="giveawayreroll"){
        if(!state.lastGiveaway)return interaction.reply({content:"No recent giveaway to reroll.",flags:64});
        await interaction.deferReply({flags:64});
        const {prize,entrants:pool,channelId:gChId}=state.lastGiveaway;
        if(!pool||!pool.length)return interaction.editReply({content:"No entrants in the last giveaway.",flags:64});
        const nReroll=Math.min(interaction.options.getInteger("winners")||1,pool.length);
        const winners=[];
        const remaining=[...pool];
        while(winners.length<nReroll){
          const idx=Math.floor(Math.random()*remaining.length);
          winners.push(remaining.splice(idx,1)[0]);
        }
        const wMentions=winners.map(id=>`<@${id}>`).join(", ");
        const gCh=interaction.guild.channels.cache.get(gChId)||interaction.channel;
        await gCh.send({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange  ·  Giveaway Reroll",iconURL:IMG.LOGO}).setTitle("Giveaway Rerolled").setDescription(`**Prize:** ${prize}\n\n**New Winner${winners.length>1?"s":""}:** ${wMentions}\n\nCongratulations! Staff will reach out shortly.`).setFooter({text:"Konvert Exchange  ·  Giveaway Reroll"}).setTimestamp()]}).catch(()=>{});
        return interaction.editReply({content:`Rerolled — ${wMentions}`,flags:64});
      }

      if(cmd==="giveawayend"){
        if(!state.activeGiveaway)return interaction.reply({content:"No active giveaway.",flags:64});
        await interaction.deferReply({flags:64});
        const gc=interaction.guild.channels.cache.get(state.activeGiveaway.channelId)||interaction.channel;
        await endGiveaway(interaction.guild,gc);
        return interaction.editReply({content:"Giveaway ended.",flags:64});
      }

      if(["jbtc","jeth","jsol","jltc","jusdtbnb"].includes(cmd)){
        const addr=interaction.options.getString("address");
        const coinMap={jbtc:"BTC",jeth:"ETH",jsol:"SOL",jltc:"LTC",jusdtbnb:"USDT-BNB"};
        const coinName=coinMap[cmd];
        state.personalWallets[coinName]=addr;
        return interaction.reply({content:`**${coinName}** address set to \`${addr}\`\nUsers type **$j${coinName.toLowerCase().replace("-bnb","bnb")}** in chat to see it.`,flags:64});
      }

      if(cmd==="setfeemode"){
        const mode=interaction.options.getString("mode");
        state.feeMode=mode;
        const isReduced=mode==="reduced";
        return interaction.reply({embeds:[new EmbedBuilder()
          .setColor(isReduced?0x7C4DFF:0x7C4DFF)
          .setAuthor({name:"Konvert Exchange  ·  Fee Settings",iconURL:IMG.LOGO})
          .setTitle(isReduced?"Fee Mode: Reduced (5–9%)":"Fee Mode: Standard (5–10%)")
          .setDescription(isReduced
            ?"Fee tiers switched to **5–9%** across all transactions. Applies immediately to all new tickets.\n\u200b"
            :"Fee tiers restored to **5–10%** (standard). Applies immediately to all new tickets.\n\u200b")
          .addFields(
            {name:"Fiat \u2192 Crypto",value:isReduced?"9% \u2192 8% \u2192 7% \u2192 6% \u2192 5%":"10% \u2192 9% \u2192 8% \u2192 7% \u2192 6%",inline:true},
            {name:"Crypto \u2192 Fiat",value:"9% \u2192 8% \u2192 7% \u2192 6% \u2192 5%",inline:true},
            {name:"Min Fee",value:"**$5** per exchange",inline:true},
          )
          .setFooter({text:`Konvert Exchange  ·  Set by ${interaction.user.tag}`})
          .setTimestamp()],flags:64});
      }

      if(cmd==="setlivefeed"){
        const ch=interaction.options.getChannel("channel");
        state.feedChannel=ch.id;
        state.feedEnabled=true;
        return interaction.reply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO}).setTitle("Live Feed Set").setDescription(`Live exchange notifications will now post in <#${ch.id}>.`).setFooter({text:"Konvert Exchange"}).setTimestamp()],flags:64});
      }

      if(cmd==="togglefeed"){
        state.feedEnabled=!state.feedEnabled;
        return interaction.reply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO}).setTitle(`Live Feed ${state.feedEnabled?"Enabled":"Disabled"}`).setDescription(state.feedEnabled&&state.feedChannel?`Live feed is now active in <#${state.feedChannel}>.`:"Live feed turned off.").setFooter({text:"Konvert Exchange"}).setTimestamp()],flags:64});
      }

      if(cmd==="serverinfo"){
        await interaction.deferReply({flags:64});
        const guild=interaction.guild;
        await guild.members.fetch();
        const allT=Object.values(_mem.tickets&&Object.keys(_mem.tickets).length?_mem.tickets:load("tickets"));
        const done=allT.filter(t=>["vouched","completed"].includes(t.status)&&t.method!=="adjustment"&&parseFloat(t.amountUSD||0)>0);
        const open=allT.filter(t=>t.status==="open"&&t.method!=="adjustment");
        const totalVol=done.reduce((s,t)=>s+(parseFloat(t.amountUSD)||0),0);
        const today=done.filter(t=>t.completedAt&&Date.now()-t.completedAt<86400000);
        const week=done.filter(t=>t.completedAt&&Date.now()-t.completedAt<7*86400000);
        const ref={referred:{},points:{}};
        const ms=process.uptime()*1000;const uh=Math.floor(ms/3600000);const um=Math.floor((ms%3600000)/60000);
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO}).setTitle("Server Info").setThumbnail(IMG.LOGO).addFields({name:"Members",value:`**${guild.memberCount}**`,inline:true},{name:"Open Tickets",value:`**${open.length}**`,inline:true},{name:"Total Exchanges",value:`**${done.length}**`,inline:true},{name:"Total Volume",value:`**${fmtUSD(totalVol)}**`,inline:true},{name:"Today",value:`**${today.length}** \u00b7 ${fmtUSD(today.reduce((s,t)=>s+(parseFloat(t.amountUSD)||0),0))}`,inline:true},{name:"This Week",value:`**${week.length}** \u00b7 ${fmtUSD(week.reduce((s,t)=>s+(parseFloat(t.amountUSD)||0),0))}`,inline:true},{name:"Referrers",value:`**${Object.keys(ref.points||{}).length}**`,inline:true},{name:"Referred Members",value:`**${Object.keys(ref.referred||{}).length}**`,inline:true},{name:"Fee Mode",value:`**${state.feeMode==="reduced"?"Reduced (5-9%)":"Standard (5-10%)"}**`,inline:true},{name:"Live Feed",value:state.feedEnabled&&state.feedChannel?`On \u2014 <#${state.feedChannel}>`:"Off",inline:true},{name:"Price Alerts",value:`**${state.alerts.length}** active`,inline:true},{name:"Uptime",value:`**${uh}h ${um}m**`,inline:true}).setFooter({text:"Konvert Exchange"}).setTimestamp()]});
      }

      if(cmd==="clientinfo"){
        await interaction.deferReply({flags:64});
        const target=interaction.options.getUser("user");
        const allT=Object.values(_mem.tickets&&Object.keys(_mem.tickets).length?_mem.tickets:load("tickets"));
        const done=allT.filter(t=>t.userId===target.id&&["vouched","completed"].includes(t.status)&&t.method!=="adjustment"&&parseFloat(t.amountUSD||0)>0);
        const open=allT.filter(t=>t.userId===target.id&&t.status==="open");
        const volume=getUserVolume(target.id);
        const tier=getTier(volume);
        const vip=isVipVolume(volume);
        const avg=done.length>0?done.reduce((s,t)=>s+(parseFloat(t.amountUSD)||0),0)/done.length:0;
        const last=done.length>0?[...done].sort((a,b)=>(b.completedAt||0)-(a.completedAt||0))[0]:null;
        const topM=topOf(done,"method");
        const refBy=null;const refPts=0;
        const bl=load("blacklist");const isBlacklisted=!!bl[target.id];
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(isBlacklisted?0xef4444:0x7C4DFF).setAuthor({name:"Konvert Exchange  ·  Client Info",iconURL:IMG.LOGO}).setTitle(target.username).setThumbnail(target.displayAvatarURL({size:256})).setDescription(`**${tier.label}**${vip?"  \u00B7  VIP":""}${isBlacklisted?"  \u00B7  BLACKLISTED":""}\n\u200b`).addFields({name:"Volume",value:`**${fmtUSD(volume)}**`,inline:true},{name:"Exchanges",value:`**${done.length}**`,inline:true},{name:"Avg Deal",value:`**${avg>0?fmtUSD(avg):"\u2014"}**`,inline:true},{name:"Open Tickets",value:`**${open.length}**`,inline:true},{name:"Top Method",value:topM?`**${topM.name}**`:noTop(done),inline:true},{name:"Last Exchange",value:last?.completedAt?`<t:${Math.floor(last.completedAt/1000)}:R>`:"\u2014",inline:true},{name:"Referred By",value:refBy?`<@${refBy}>`:"No referral",inline:true},{name:"Referral Points",value:`**${refPts} pts**`,inline:true},{name:"VIP",value:vip?"Active \u2014 0.75% off":"Not yet",inline:true}).setFooter({text:"Konvert Exchange"}).setTimestamp()]});
      }

      if(cmd==="receipt"){
        await interaction.deferReply({flags:64});
        const query=interaction.options.getString("query").trim();
        const allT=Object.entries(_mem.tickets&&Object.keys(_mem.tickets).length?_mem.tickets:load("tickets"));
        let matches=[];
        // Search by user ID/mention
        const userId=query.replace(/[<@!>]/g,"");
        const userMatches=allT.filter(([,t])=>t.userId===userId&&["vouched","completed"].includes(t.status)&&t.method!=="adjustment"&&parseFloat(t.amountUSD||0)>0).sort((a,b)=>(b[1].completedAt||0)-(a[1].completedAt||0)).slice(0,5);
        // Search by channel ID (ticket key)
        const _kv=query.match(/^kv-?(\d{4,8})$/i);
        const idMatches=allT.filter(([id,t])=>(id===query||(_kv&&id.slice(-_kv[1].length)===_kv[1]))&&["vouched","completed"].includes(t.status));
        matches=[...idMatches,...userMatches];
        if(!matches.length)return interaction.editReply({content:`No completed exchanges found for \`${query}\`.`,flags:64});
        const fields=matches.slice(0,5).map(([id,t],i)=>{
          const m=getMethod(t.method);
          const tradeId=`KV-${id.slice(-6).toUpperCase()}`;
          const dirStr=dealOf({...t,feeUSD:ticketFee(t)}).hero;
          return {
            name:`${i+1}. ${tradeId}  \u00b7  ${fmtUSD(t.amountUSD||0)}`,
            value:`**Client:** <@${t.userId}>\n**Exchanger:** ${t.completedBy?`<@${t.completedBy}>`:"—"}\n**Deal:** ${dirStr}\n**Completed:** ${t.completedAt?`<t:${Math.floor(t.completedAt/1000)}:F>`:"—"}\n**Fee:** ${fmtUSD(t.feeUSD||0)}`,
            inline:false
          };
        });
        return interaction.editReply({embeds:[new EmbedBuilder()
          .setColor(0x7C4DFF)
          .setAuthor({name:"Konvert Exchange  ·  Receipt Lookup",iconURL:IMG.LOGO})
          .setTitle(`${matches.length} Exchange${matches.length!==1?"s":""} Found`)
          .setDescription(`Results for \`${query}\`\n\u200b`)
          .addFields(fields)
          .setFooter({text:"Konvert Exchange  ·  Receipt Lookup"})
          .setTimestamp()],flags:64});
      }

      if(cmd==="grantowner"){
        const confirm=interaction.options.getString("confirm");
        if(confirm!=="CONFIRM")return interaction.reply({content:"Type **CONFIRM** exactly to grant owner access.",flags:64});
        const target=interaction.options.getUser("user");
        if(CONFIG.OWNER_IDS.includes(target.id))return interaction.reply({content:`**${target.username}** is already an owner.`,flags:64});
        CONFIG.OWNER_IDS.push(target.id);
        // Also give them access to all existing open tickets
        try{
          const guild=interaction.guild;
          const tickets=Object.keys(_mem.tickets||{}).length?_mem.tickets:load("tickets");
          const openChannels=Object.entries(tickets).filter(([,t])=>t.status==="open").map(([id])=>id);
          for(const chId of openChannels){
            const ch=guild.channels.cache.get(chId);
            if(ch)await ch.permissionOverwrites.edit(target.id,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true,ManageChannels:true}).catch(()=>{});
          }
        }catch{}
        return interaction.reply({embeds:[new EmbedBuilder()
          .setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO})
          .setTitle("Owner Access Granted")
          .setDescription(`<@${target.id}> now has full owner access to the Konvert bot.

This is active immediately and persists until revoked or the bot restarts.
​`)
          .addFields({name:"Granted By",value:`<@${interaction.user.id}>`,inline:true},{name:"Access Level",value:"**Full Owner**",inline:true})
          .setFooter({text:"Konvert Exchange  ·  Use /revokeowner to remove access"})
          .setTimestamp()],flags:64});
      }

      if(cmd==="revokeowner"){
        const target=interaction.options.getUser("user");
        if(!CONFIG.OWNER_IDS.includes(target.id))return interaction.reply({content:`**${target.username}** is not a bot owner.`,flags:64});
        if(PERMANENT_OWNER_IDS.includes(target.id))return interaction.reply({content:`**${target.username}** is a permanent owner and can't be removed.`,flags:64});
        CONFIG.OWNER_IDS=CONFIG.OWNER_IDS.filter(id=>id!==target.id);
        return interaction.reply({content:`Owner access removed from **${target.username}**.`,flags:64});
      }

      if(cmd==="listowners"){
        const lines=CONFIG.OWNER_IDS.map(id=>`<@${id}>`).join("\n")||"No owners configured.";
        return interaction.reply({embeds:[new EmbedBuilder()
          .setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO})
          .setTitle("Bot Owners")
          .setDescription(lines)
          .setFooter({text:"Konvert Exchange"}).setTimestamp()],flags:64});
      }

      if(cmd==="setdualpromo"){
        const fee=interaction.options.getNumber("fee");
        const days=interaction.options.getInteger("days");
        const expiresAt=Date.now()+(days*24*60*60*1000);
        const expiresTs=Math.floor(expiresAt/1000);
        state.dualPromo={active:true,feePercent:fee,expiresAt,createdAt:Date.now()};
        return interaction.reply({content:`Dual-server promo set!\n**Fee:** ${fee}%\n**Expires:** <t:${expiresTs}:R> (<t:${expiresTs}:D>)\n**Requirement:** Must be in both Konvert servers.\n\nUsers in both servers will automatically get the ${fee}% rate when opening a ticket.`,flags:64});
      }

      if(cmd==="dualpromooff"){
        state.dualPromo=null;
        return interaction.reply({content:"Dual-server promo turned off.",flags:64});
      }

      if(cmd==="promostatus"){
        const lines=[];
        // Dual promo
        if(state.dualPromo&&state.dualPromo.active&&Date.now()<state.dualPromo.expiresAt){
          const daysLeft=Math.ceil((state.dualPromo.expiresAt-Date.now())/(86400000));
          lines.push(`**Dual-Server Promo** — ${state.dualPromo.feePercent}% fee\nExpires <t:${Math.floor(state.dualPromo.expiresAt/1000)}:R> · **${daysLeft} day${daysLeft!==1?"s":""} left**`);
        } else if(state.dualPromo){
          lines.push("**Dual-Server Promo** — Expired");
        }
        // Regular promos
        const activePromos=Object.entries(state.promos||{}).filter(([,p])=>p.active&&(!p.expiresAt||Date.now()<p.expiresAt));
        for(const [code,p] of activePromos){
          const daysLeft=p.expiresAt?Math.ceil((p.expiresAt-Date.now())/86400000):null;
          lines.push(`**${code}** — ${p.discount}% off · ${p.uses}/${p.maxUses||"\u221E"} uses${daysLeft?` · **${daysLeft}d left**`:" · Never expires"}`);
        }
        if(!lines.length)lines.push("No active promos.");
        return interaction.reply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange  ·  Promo Status",iconURL:IMG.LOGO}).setTitle("Active Promotions").setDescription(lines.join("\n\n")).setTimestamp()],flags:64});
      }

      if(cmd==="createpromo"){
        const code=interaction.options.getString("code").trim().toLowerCase();
        const discount=interaction.options.getNumber("discount");
        const maxUses=interaction.options.getInteger("maxuses")||null;
        const hours=interaction.options.getInteger("hours")||null;
        if(discount<=0||discount>=100)return interaction.reply({content:"Discount must be between 1 and 99%.",flags:64});
        if(state.promos[code]&&state.promos[code].active)return interaction.reply({content:`Promo code **${code.toUpperCase()}** already exists and is active. End it first with \`/endpromo\`.`,flags:64});
        const expiresAt=hours?Date.now()+(hours*3600000):null;
        state.promos[code]={discount,maxUses,uses:0,usedBy:[],active:true,expiresAt,createdBy:interaction.user.id,createdAt:Date.now()};
        savePromos();
        return interaction.reply({embeds:[new EmbedBuilder()
          .setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange  ·  Promo Created",iconURL:IMG.LOGO})
          .setTitle("Promo Code Created")
          .setDescription(`Clients can now type **${code.toUpperCase()}** inside their ticket to apply the discount.\n\u200b`)
          .addFields(
            {name:"Code",value:`\`${code.toUpperCase()}\``,inline:true},
            {name:"Discount",value:`**${discount}% off**`,inline:true},
            {name:"Max Uses",value:maxUses?`**${maxUses}**`:"Unlimited",inline:true},
            {name:"Expires",value:expiresAt?`<t:${Math.floor(expiresAt/1000)}:R>`:"Never",inline:true},
          )
          .setFooter({text:`Konvert Exchange  ·  Created by ${interaction.user.tag}`})
          .setTimestamp()],flags:64});
      }

      if(cmd==="endpromo"){
        const code=interaction.options.getString("code").trim().toLowerCase();
        if(!state.promos[code])return interaction.reply({content:`No promo found with code **${code.toUpperCase()}**.`,flags:64});
        state.promos[code].active=false;
        savePromos();
        const p=state.promos[code];
        return interaction.reply({embeds:[new EmbedBuilder()
          .setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO})
          .setTitle("Promo Ended")
          .setDescription(`**${code.toUpperCase()}** has been deactivated. Anyone who tries to use it will see an expired message.\n\u200b`)
          .addFields({name:"Total Uses",value:`**${p.uses}**`,inline:true},{name:"Status",value:"**Expired**",inline:true})
          .setFooter({text:"Konvert Exchange"}).setTimestamp()],flags:64});
      }

      if(cmd==="editpromo"){
        const code=interaction.options.getString("code").trim().toLowerCase();
        if(!state.promos[code])return interaction.reply({content:`No promo found with code **${code.toUpperCase()}**. Use \`/listpromos\` to see all codes.`,flags:64});
        const p=state.promos[code];
        const changes=[];

        const newCode=interaction.options.getString("newcode")?.trim().toLowerCase();
        const newDiscount=interaction.options.getNumber("discount");
        const newMaxUses=interaction.options.getInteger("maxuses");
        const addHours=interaction.options.getInteger("addhours");
        const newStatus=interaction.options.getString("status");

        if(newCode&&newCode!==code){
          if(state.promos[newCode])return interaction.reply({content:`Code **${newCode.toUpperCase()}** already exists.`,flags:64});
          state.promos[newCode]={...p};
          delete state.promos[code];
          changes.push(`Code renamed to \`${newCode.toUpperCase()}\``);
        }

        const targetCode=newCode||code;
        const target=state.promos[targetCode];

        if(newDiscount!==null&&newDiscount!==undefined){
          if(newDiscount<=0||newDiscount>=100)return interaction.reply({content:"Discount must be between 1 and 99.",flags:64});
          target.discount=newDiscount;
          changes.push(`Discount set to **${newDiscount}% off the fee**`);
        }
        if(newMaxUses!==null&&newMaxUses!==undefined){
          target.maxUses=newMaxUses===0?null:newMaxUses;
          changes.push(`Max uses set to **${newMaxUses===0?"Unlimited":newMaxUses}**`);
        }
        if(addHours){
          const base=target.expiresAt&&target.expiresAt>Date.now()?target.expiresAt:Date.now();
          target.expiresAt=base+(addHours*3600000);
          changes.push(`Expiry extended by **${addHours}h** \u2014 now expires <t:${Math.floor(target.expiresAt/1000)}:R>`);
        }
        if(newStatus){
          target.active=newStatus==="active";
          changes.push(`Status set to **${newStatus==="active"?"Active":"Paused"}**`);
        }

        if(!changes.length)return interaction.reply({content:"No changes provided. Specify at least one field to update.",flags:64});
        savePromos();

        return interaction.reply({embeds:[new EmbedBuilder()
          .setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange  ·  Promo Updated",iconURL:IMG.LOGO})
          .setTitle("Promo Code Updated")
          .setDescription(`Changes applied to **${targetCode.toUpperCase()}**:\n\u200b`)
          .addFields(
            {name:"Changes",value:changes.map(c=>`\u2022 ${c}`).join("\n"),inline:false},
            {name:"Current Discount",value:`**${target.discount}% off the fee**`,inline:true},
            {name:"Uses",value:target.maxUses?`${target.uses}/${target.maxUses}`:`${target.uses} (unlimited)`,inline:true},
            {name:"Expires",value:target.expiresAt?`<t:${Math.floor(target.expiresAt/1000)}:R>`:"Never",inline:true},
          )
          .setFooter({text:`Konvert Exchange  ·  Edited by ${interaction.user.tag}`})
          .setTimestamp()],flags:64});
      }

      if(cmd==="listpromos"){

        const promos=Object.entries(state.promos||{});
        if(!promos.length)return interaction.reply({content:"No promo codes created yet. Use `/createpromo` to make one.",flags:64});
        const lines=promos.map(([code,p])=>{
          const status=!p.active?"Expired":p.expiresAt&&Date.now()>p.expiresAt?"Expired":"Active";
          const uses=p.maxUses?`${p.uses}/${p.maxUses}`:p.uses;
          return `${status} \`${code.toUpperCase()}\`  \u2014  **${p.discount}% off**  \u00b7  ${uses} uses${p.expiresAt?`  \u00b7  expires <t:${Math.floor(p.expiresAt/1000)}:R>`:""}`;
        }).join("\n");
        return interaction.reply({embeds:[new EmbedBuilder()
          .setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO})
          .setTitle("Promo Codes")
          .setDescription(lines)
          .setFooter({text:"Konvert Exchange"}).setTimestamp()],flags:64});
      }

      if(cmd==="rank"){
        await interaction.deferReply();
        const target=interaction.options.getUser("user")||interaction.user;
        const isSelf=target.id===interaction.user.id;
        const byUser=buildLeaderboardVolumes();
        if(!byUser[target.id]){
          return interaction.editReply({embeds:[new EmbedBuilder()
            .setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO})
            .setTitle(isSelf?"Your Rank":`${target.username}'s Rank`)
            .setThumbnail(target.displayAvatarURL({size:256}))
            .setDescription("No completed exchanges on record yet.")
            .setFooter({text:"Konvert Exchange"}).setTimestamp()]});
        }
        const ranked=Object.entries(byUser).sort((a,b)=>b[1]-a[1]);
        const pos=ranked.findIndex(([uid])=>uid===target.id)+1;
        const total=ranked.length;
        const vol=byUser[target.id];
        const tier=getTier(vol);
        const nextTier=getNextTier(vol);
        const above=pos>1?ranked[pos-2]:null;
        const below=pos<total?ranked[pos]:null;
        const pct=Math.round((1-((pos-1)/total))*100);
        const medals=`**#${pos}**`;
        return interaction.editReply({embeds:[new EmbedBuilder()
          .setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange  ·  Leaderboard Rank",iconURL:IMG.LOGO})
          .setTitle(isSelf?"Your Rank":`${target.username}'s Rank`)
          .setThumbnail(target.displayAvatarURL({size:256}))
          .setDescription(`${medals}  \u2014  Top **${pct}%** of all clients\n\u200b`)
          .addFields(
            {name:"Rank",value:`**#${pos}** of ${total}`,inline:true},
            {name:"Volume",value:`**${fmtUSD(vol)}**`,inline:true},
            {name:"Tier",value:`**${tier.label}**`,inline:true},
            {name:"Above You",value:above?`<@${above[0]}> \u2014 ${fmtUSD(above[1])}`:"\u2014 You're at the top!",inline:true},
            {name:"Below You",value:below?`<@${below[0]}> \u2014 ${fmtUSD(below[1])}`:"\u2014 No one below",inline:true},
            {name:"To Next Tier",value:nextTier?`${fmtUSD(Math.max(nextTier.min-vol,0))} away`:"Max tier reached",inline:true},
          )
          .setImage(IMG.BANNER)
          .setFooter({text:"Konvert Exchange  ·  /leaderboard to see the full list"})
          .setTimestamp()]});
      }

      // Exchanger wallet commands
      if(cmd==="setmywallet"){
        if(!isExchanger(interaction.member))return interaction.reply({content:"This command is for exchangers only.",flags:64});
        const coin=interaction.options.getString("coin").toUpperCase().trim();
        const addr=interaction.options.getString("address").trim();
        if(!state.exchangerWallets[interaction.user.id])state.exchangerWallets[interaction.user.id]={};
        state.exchangerWallets[interaction.user.id][coin]=addr;
        return interaction.reply({content:`**${coin}** address saved: \`${addr}\``,flags:64});
      }

      if(cmd==="clearwallet"){
        if(!isExchanger(interaction.member))return interaction.reply({content:"This command is for exchangers only.",flags:64});
        const coin=interaction.options.getString("coin").toUpperCase().trim();
        if(state.exchangerWallets[interaction.user.id]?.[coin]){
          delete state.exchangerWallets[interaction.user.id][coin];
          return interaction.reply({content:`**${coin}** address removed.`,flags:64});
        }
        return interaction.reply({content:`No **${coin}** address saved.`,flags:64});
      }

      if(cmd==="mywallets"){
        if(!isExchanger(interaction.member))return interaction.reply({content:"This command is for exchangers only.",flags:64});
        const wallets=state.exchangerWallets[interaction.user.id]||{};
        const entries=Object.entries(wallets);
        if(!entries.length)return interaction.reply({content:"You have no saved addresses. Use `/setwallet` to add one.",flags:64});
        const lines=entries.map(([c,a])=>`**${c}**: \`${a}\``).join("\n");
        return interaction.reply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Your Wallet Addresses",iconURL:IMG.LOGO}).setDescription(lines).setFooter({text:"Konvert Exchange  ·  Only visible to you  ·  Use /setwallet to update"})],flags:64});
      }

      if(cmd==="postwallets"){
        if(!isExchanger(interaction.member))return interaction.reply({content:"This command is for exchangers only.",flags:64});
        const wallets=state.exchangerWallets[interaction.user.id]||{};
        const entries=Object.entries(wallets);
        if(!entries.length)return interaction.reply({content:"You have no saved addresses. Use `/setwallet` to add one first.",flags:64});
        const lines=entries.map(([c,a])=>`**${c}**\n\`${a}\``).join("\n\n");
        await interaction.channel.send({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:`${interaction.user.username}  \u2022  Payment Addresses`,iconURL:interaction.user.displayAvatarURL()}).setDescription(lines).setFooter({text:"Konvert Exchange  ·  Send only to addresses confirmed inside this ticket"}).setTimestamp()]});
        return interaction.reply({content:"Addresses posted.",flags:64});
      }

      if(cmd==="alert"){
        await interaction.deferReply({flags:64});
        const raw=interaction.options.getString("coin").trim();
        const coin=resolveCoin(raw);
        const target=interaction.options.getNumber("price");
        const dir=interaction.options.getString("direction");
        if(!_symOf(coin))return interaction.editReply({content:`**${coin}** is not a supported coin for alerts.`});
        if(!(target>0))return interaction.editReply({content:"Enter a target price greater than 0."});
        const mine=state.alerts.filter(a=>a.userId===interaction.user.id);
        if(mine.length>=10)return interaction.editReply({content:"You already have 10 alerts. Use `/clearalerts` first."});
        const cur=await Promise.race([getPrice(coin),new Promise(r=>setTimeout(()=>r(null),9000))]).catch(()=>null);
        if(!cur&&!isKnownCoin(coin))return interaction.editReply({content:`**${coin}** is not a supported coin for alerts.`});
        state.alerts.push({userId:interaction.user.id,coin,target,dir,createdAt:Date.now()});
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange  ·  Price Alert",iconURL:IMG.LOGO}).setTitle("Alert Set").addFields(
          {name:"Coin",value:coin,inline:true},
          {name:"Trigger",value:`${dir==="above"?"Above":"Below"} $${target}`,inline:true},
          {name:"Current",value:cur?`$${cur.toLocaleString("en-US",{maximumFractionDigits:2})}`:"—",inline:true},
        ).setFooter({text:"Konvert Exchange  ·  You will get a DM when it triggers  ·  Alert fires once"})]});
      }

      if(cmd==="myalerts"){
        const mine=state.alerts.filter(a=>a.userId===interaction.user.id);
        if(!mine.length)return interaction.reply({content:"You have no active price alerts. Use `/alert` to set one.",flags:64});
        const lines=mine.map((a,i)=>`**${i+1}.** ${a.coin} ${a.dir==="above"?"above":"below"} **$${a.target}**`).join("\n");
        return interaction.reply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange  ·  Your Price Alerts",iconURL:IMG.LOGO}).setDescription(lines).setFooter({text:`Konvert Exchange  ·  ${mine.length} active alert${mine.length!==1?"s":""}`})],flags:64});
      }

      if(cmd==="clearalerts"){
        const before=state.alerts.length;
        state.alerts=state.alerts.filter(a=>a.userId!==interaction.user.id);
        return interaction.reply({content:`Cleared **${before-state.alerts.length}** alert(s).`,flags:64});
      }

      if(cmd==="queue"){
        // The tickets still waiting for an exchanger that this person can see (an exchanger sees the ones for their methods), longest waiting first
        const _qOwner=isOwner(interaction.user.id,interaction.member);
        if(!_qOwner&&!isExchanger(interaction.member))return interaction.reply({content:"Only exchangers can use this.",flags:64});
        const _qAll=Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets"),_qList=[];
        for(const [cid,t] of Object.entries(_qAll)){
          if(!t||t.status!=="open"||t.claimedBy||!t.claimSystem||t.userId===interaction.user.id)continue;
          const qc=interaction.guild&&interaction.guild.channels.cache.get(cid);
          if(!qc)continue;
          let sees=_qOwner;
          if(!sees){try{const p=qc.permissionsFor(interaction.member);sees=!!(p&&p.has(PermissionFlagsBits.ViewChannel));}catch{}}
          if(sees)_qList.push([cid,t]);
        }
        _qList.sort((a,b)=>(a[1].createdAt||0)-(b[1].createdAt||0));
        const _qShown=_qList.slice(0,12);
        return interaction.reply({embeds:[kEmbed("Queue").setTitle(`Open Queue`)
          .setDescription(_qList.length
            ?`${kHero(`${_qList.length} ${_qList.length===1?"ticket is":"tickets are"} waiting`)}\n${_qShown.map(([cid,t])=>`<#${cid}>  ·  **${dealOf(t).hero}**  ·  <t:${Math.floor((t.createdAt||Date.now())/1000)}:R>`).join("\n")}${_qList.length>_qShown.length?`\n*+${_qList.length-_qShown.length} more*`:""}`
            :`${kHero("Nothing waiting")}\nEvery ticket you can see has an exchanger.`)
          .setFooter(kFoot("Open a ticket and press Claim Ticket"))],flags:64});
      }
      if(cmd==="exchangerstats"){
        await interaction.deferReply({flags:64});
        const target=interaction.options.getUser("user")||interaction.user;
        const allT=Object.values(_mem.tickets&&Object.keys(_mem.tickets).length?_mem.tickets:load("tickets"));
        const handled=allT.filter(t=>t.completedBy===target.id&&["vouched","completed"].includes(t.status)&&t.method!=="adjustment"&&parseFloat(t.amountUSD||0)>0);
        if(!handled.length){
          return interaction.editReply({content:`No completed exchanges found for **${target.username}** as exchanger.`});
        }
        const totalVol=handled.reduce((s,t)=>s+(parseFloat(t.amountUSD)||0),0);
        const totalFees=handled.reduce((s,t)=>s+ticketFee(t),0);
        const avg=totalVol/handled.length;
        const topM=topOf(handled,"method"),topC=topOf(handled,"coin");
        const last=handled.length>0?[...handled].sort((a,b)=>(b.completedAt||0)-(a.completedAt||0))[0]:null;
        const _esNow=new Date(),_esMid=new Date(_esNow);_esMid.setUTCHours(5,0,0,0);if(_esMid>_esNow)_esMid.setUTCDate(_esMid.getUTCDate()-1);
        const today=handled.filter(t=>t.completedAt&&t.completedAt>=_esMid.getTime());
        const week=handled.filter(t=>t.completedAt&&Date.now()-t.completedAt<7*86400000);
        // Rank among all exchangers
        const byEx={};
        allT.filter(t=>t.completedBy&&["vouched","completed"].includes(t.status)&&t.method!=="adjustment").forEach(t=>{
          if(!byEx[t.completedBy])byEx[t.completedBy]=0;
          byEx[t.completedBy]+=(parseFloat(t.amountUSD)||0);
        });
        const exRanked=Object.entries(byEx).sort((a,b)=>b[1]-a[1]);
        const exPos=exRanked.findIndex(([uid])=>uid===target.id)+1;
        return interaction.editReply({embeds:[new EmbedBuilder()
          .setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange  ·  Exchanger Stats",iconURL:IMG.LOGO})
          .setTitle(`${target.username}'s Exchanger Performance`)
          .setThumbnail(target.displayAvatarURL({size:256}))
          .setDescription(`Exchanger rank: **#${exPos}** of ${exRanked.length}\n\u200b`)
          .addFields(
            {name:"Total Handled",value:`**${handled.length}** exchange${handled.length===1?"":"s"}`,inline:true},
            {name:"Total Volume",value:`**${fmtUSD(totalVol)}**`,inline:true},
            {name:"Avg Deal",value:`**${fmtUSD(avg)}**`,inline:true},
            {name:"Today",value:`**${today.length}** exchange${today.length===1?"":"s"}  \u00b7  ${fmtUSD(today.reduce((s,t)=>s+(parseFloat(t.amountUSD)||0),0))}`,inline:true},
            {name:"This Week",value:`**${week.length}** exchange${week.length===1?"":"s"}  \u00b7  ${fmtUSD(week.reduce((s,t)=>s+(parseFloat(t.amountUSD)||0),0))}`,inline:true},
            {name:"Fees Collected",value:`**${fmtUSD(totalFees)}**`,inline:true},
            {name:"Top Method",value:topM?`**${topM.name}** (${topM.n}x)`:noTop(handled),inline:true},
            {name:"Top Coin",value:topC?`**${topC.name}** (${topC.n}x)`:noTop(handled),inline:true},
            {name:"Last Exchange",value:last?.completedAt?`<t:${Math.floor(last.completedAt/1000)}:R>`:"\u2014",inline:true},
          )
          .setImage(IMG.BANNER)
          .setFooter({text:"Konvert Exchange  ·  Exchanger Performance"})
          .setTimestamp()]});
      }


      }

    if(interaction.isStringSelectMenu()){
      if(interaction.customId==="select_method"){
        const _vals=interaction.values||[],_picked=pickedMethods(_vals),method=(_vals.length===1&&_vals[0]==="crypto")?"crypto":_picked[0];
        if(!method)return interaction.update({embeds:[step1Embed()],components:methodPickRows()});
        if(method==="crypto"){const c2cCoins=["BTC","ETH","SOL","LTC","USDT","USDC","XRP","BNB","ADA","DOGE","MATIC","AVAX","DOT","LINK","TRX","SHIB","UNI","ATOM","NEAR","ARB","OP","CAKE","INJ","RUNE","KAVA"];const coinOpts=c2cCoins.map(c=>new StringSelectMenuOptionBuilder().setLabel(c).setValue(c).setDescription(`Exchange ${c}`));return interaction.update({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor(kAuthor()).setTitle(`Step 2 · Crypto to Crypto`).setDescription(`Select the coin you are **sending** and the coin you want to **receive** below.\n\n${minLine()}`).setFooter(kFoot("Step 2 of 3"))],components:[new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("c2c_send").setPlaceholder("Select coin you are SENDING...").addOptions(coinOpts)),new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("c2c_recv").setPlaceholder("Select coin you want to RECEIVE...").addOptions(coinOpts))]});}
        return interaction.update({embeds:[step2Embed(_picked)],components:step2Rows(_picked)});
      }
      if(interaction.customId==="sel_claimmethod"){await claimTicket(interaction,{method:interaction.values[0],fromPicker:true});return;}
      if(interaction.customId==="sel_addmethod"){await addMethods(interaction);return;}
      if(interaction.customId.startsWith("sel_more__")){          // more methods added on the first step: they join the one already picked
        const cur=pickedMethods(parseMethodTag(interaction.customId.slice("sel_more__".length)));
        if(!cur.length||cur.some(isSoloMethod))return interaction.update({embeds:[step1Embed()],components:methodPickRows()});
        const add=pickedMethods((interaction.values||[]).filter(v=>!cur.includes(v))).slice(0,Math.max(MAX_TICKET_METHODS-cur.length,0));
        const merged=pickedMethods([...cur,...add]);          // what was already picked stays; the new ones fill the room that is left (menu order, ordinary methods only, no repeats)
        return interaction.update({embeds:[step2Embed(merged)],components:step2Rows(merged)});
      }
      if(interaction.customId==="c2c_send"||interaction.customId==="c2c_recv"){
        const userId=interaction.user.id;
        if(!state.c2cSelections[userId])state.c2cSelections[userId]={};
        if(interaction.customId==="c2c_send")state.c2cSelections[userId].send=interaction.values[0];
        if(interaction.customId==="c2c_recv")state.c2cSelections[userId].recv=interaction.values[0];
        const sel=state.c2cSelections[userId],both=sel.send&&sel.recv;
        const _c2cCoins=["BTC","ETH","SOL","LTC","USDT","USDC","XRP","BNB","ADA","DOGE","MATIC","AVAX","DOT","LINK","TRX","SHIB","UNI","ATOM","NEAR","ARB","OP","CAKE","INJ","RUNE","KAVA"];const coinOpts=_c2cCoins.map(c=>new StringSelectMenuOptionBuilder().setLabel(c).setValue(c).setDescription(`Exchange ${c}`));
        const components=[new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("c2c_send").setPlaceholder(sel.send?`Sending: ${sel.send}`:"Select coin you are SENDING...").addOptions(coinOpts)),new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("c2c_recv").setPlaceholder(sel.recv?`Receiving: ${sel.recv}`:"Select coin you want to RECEIVE...").addOptions(coinOpts))];
        if(both)components.push(new ActionRowBuilder().addComponents(kBtn("btn_c2c_confirm",`Confirm: ${sel.send} → ${sel.recv}`,ButtonStyle.Success)));
        return interaction.update({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor(kAuthor()).setTitle(`Step 2 · Crypto to Crypto`).setDescription(both?`${kHero(`${sel.send} \u2192 ${sel.recv}`)}\nBoth coins selected. Press **Confirm** to continue.`:`**Sending:** ${sel.send||"\u2014"}\n**Receiving:** ${sel.recv||"\u2014"}\n\nSelect both coins and a confirm button will appear.`).setFooter(kFoot("Step 2 of 3"))],components});
      }
    }

    if(interaction.isButton()){
      if(interaction.customId==="btn_exchange_now"){await interaction.deferReply({flags:64}).catch(()=>{});const bl=load("blacklist");if(bl[interaction.user.id]&&!isOwner(interaction.user.id,interaction.member))return interaction.editReply({content:"You are blacklisted from Konvert."});return interaction.editReply({embeds:[step1Embed()],components:methodPickRows(),flags:64});}
      if(interaction.customId.startsWith("btn_more__")||interaction.customId.startsWith("btn_nomore__")){      // one method picked: add more, or carry on with it
        const keep=interaction.customId.startsWith("btn_nomore__"),cur=pickedMethods(parseMethodTag(interaction.customId.slice((keep?"btn_nomore__":"btn_more__").length)));
        if(!cur.length||cur.some(isSoloMethod))return interaction.update({embeds:[step1Embed()],components:methodPickRows()});
        if(keep)return interaction.update({embeds:[step2Embed(cur,{noTip:true})],components:step2Rows(cur,{noMore:true})});
        if(cur.length>=MAX_TICKET_METHODS)return interaction.update({embeds:[step2Embed(cur)],components:step2Rows(cur,{noMore:true})});
        return interaction.update({embeds:[moreEmbed(cur)],components:moreRows(cur)});
      }
      if(interaction.customId.startsWith("btn_pick__")){      // Gift Card / Buy For You / Custom Exchange: chosen on their own
        const _solo=pickedMethods([interaction.customId.slice("btn_pick__".length)]);
        if(!_solo.length)return interaction.update({embeds:[step1Embed()],components:methodPickRows()});
        return interaction.update({embeds:[step2Embed(_solo)],components:step2Rows(_solo)});
      }
      if(interaction.customId==="btn_fee_calc"){const modal=new ModalBuilder().setCustomId("modal_fee").setTitle("Fee Calculator");modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("fee_amt").setLabel("Amount in USD").setStyle(TextInputStyle.Short).setPlaceholder("e.g. 250").setRequired(true)));return interaction.showModal(modal);}
      if(interaction.customId==="btn_rates_quick"){await interaction.deferReply({flags:64});try{return interaction.editReply({embeds:[await buildRatesEmbed()]});}catch(e){return interaction.editReply("Could not fetch rates right now. Try again in a moment.");}}
      if(interaction.customId==="btn_refresh_rates"){await interaction.deferUpdate();try{const _re=await buildRatesEmbed();return interaction.editReply({embeds:[_re],components:[new ActionRowBuilder().addComponents(kBtn("btn_refresh_rates","Refresh",ButtonStyle.Secondary))]});}catch(e){return interaction.editReply({content:"Could not fetch rates right now."});} return;}


      if(interaction.customId==="btn_check_points"){
        return interaction.reply({content:"The referral program is no longer running.",flags:64});
      }

      if(interaction.customId==="btn_c2c_confirm"){
        const c2cData=state.c2cSelections?.[interaction.user.id];
        if(!c2cData?.send||!c2cData?.recv)return interaction.reply({content:"Please select both coins before confirming.",flags:64});
        delete state.c2cSelections[interaction.user.id];
        const {send:sendCoin,recv:recvCoin}=c2cData;
        if(sendCoin===recvCoin)return interaction.reply({content:"You cannot exchange a coin for the same coin.",flags:64});
        const modal=new ModalBuilder().setCustomId(`modal_c2c__${sendCoin}__${recvCoin}`).setTitle(`${sendCoin} \u2192 ${recvCoin}`);
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("c2c_amount").setLabel(`Amount in USD you send (minimum ${fmtUSD(CONFIG.MIN_AMOUNT)})`).setStyle(TextInputStyle.Short).setPlaceholder("e.g. 200").setRequired(true)));
        return interaction.showModal(modal);
      }

      if(interaction.customId.startsWith("dir_send__")||interaction.customId.startsWith("dir_receive__")){
        const _isSendCrypto=interaction.customId.startsWith("dir_send__"),_tag=interaction.customId.replace("dir_send__","").replace("dir_receive__",""),_ms=parseMethodTag(_tag),method=_ms[0],m=getMethod(method);
        if(!m)return interaction.reply({content:"That payment method isn't available any more. Please start again.",flags:64});
        const _direction=_isSendCrypto?"receive":"send";
        const modal=new ModalBuilder().setCustomId(`modal_amount__${_tag}__${_direction}`).setTitle(modalTitle(_ms.length>1?methodsLabel(_ms):m.label,_ms.length,_isSendCrypto));
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("inp_amount").setLabel(`Amount in USD (minimum ${fmtUSD(CONFIG.MIN_AMOUNT)})`).setStyle(TextInputStyle.Short).setPlaceholder("e.g. 150").setRequired(true)),new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("inp_coin").setLabel("Which crypto? (BTC, ETH, SOL, LTC, USDT)").setStyle(TextInputStyle.Short).setPlaceholder("e.g. SOL").setRequired(true)));
        return interaction.showModal(modal);
      }

      if(interaction.customId==="skip_vouch"){
        const _tix=Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets");
        const _stix=_tix[interaction.channel.id];
        const _canCloseNow=interaction.user.id===_stix?.userId||isExchanger(interaction.member)||isOwner(interaction.user.id,interaction.member);
        if(!_stix||!_canCloseNow)return interaction.reply({content:"Only the client or an exchanger can close this.",flags:64});
        await interaction.deferUpdate().catch(()=>{});
        await interaction.editReply({embeds:[kEmbed("Ticket").setTitle(`Closing`).setDescription(`Ticket closing now. Don't forget to vouch in <#${VOUCH_POST_CHANNEL}>.`)],components:[]}).catch(()=>{});
        // Call _postOnce directly — it's stored on the channel by completeTrade
        const _fn=interaction.channel._completePostOnce;
        if(typeof _fn==="function"){
          interaction.channel._completePostOnce=null;
          await _fn(null);
        }
        return;
      }

      if(interaction.customId==="btn_giveaway_enter"){
        if(!state.activeGiveaway)return interaction.reply({content:"No active giveaway.",flags:64});
        const userId=interaction.user.id;
        const member=await interaction.guild.members.fetch({user:userId,force:false}).catch(()=>null);
        const hasRole=member&&member.roles.cache.has(KONV_TAG_ROLE);
        const pg=(member&&member.user&&member.user.primaryGuild)||null;
        const hasKonv=hasRole||(pg&&pg.identityEnabled&&pg.identityGuildId===CONFIG.GUILD_ID);
        if(!hasKonv)return interaction.reply({content:"You need the KONV clan tag to enter. Set Konvert as your active clan in your Discord profile settings. If it is not being detected, run `/claimtag` to activate it manually.",flags:64});
        if(state.activeGiveaway.entrants.has(userId))return interaction.reply({content:"You are already entered. Good luck.",flags:64});
        // Anti-abuse: if giveaway ends within 6h, check how long they have had the role
        const _sixHoursMs=6*60*60*1000;
        const _timeLeft=state.activeGiveaway.endsAt-Date.now();
        if(_timeLeft<_sixHoursMs){
          // Check when they got the KONV role
          const _freshMember=await interaction.guild.members.fetch({user:userId,force:true}).catch(()=>null);
          if(_freshMember){
            const _roleJoinedAt=_freshMember.roles.cache.get(KONV_TAG_ROLE)?.createdTimestamp||0;
            const _memberJoinedRoleAt=_freshMember.joinedTimestamp||0;
            // If role was assigned within the last 6 hours, block them
            if(Date.now()-(_freshMember.roles.cache.get(KONV_TAG_ROLE)?.id?_memberJoinedRoleAt:0)<_sixHoursMs){
              // Check role assignment time via audit log if possible, fallback to member join
              const _auditLogs=await interaction.guild.fetchAuditLogs({type:25,limit:10}).catch(()=>null);
              const _roleEntry=_auditLogs?.entries.find(e=>e.target?.id===userId&&e.changes?.some(c=>c.key==="$add"&&c.new?.some(r=>r.id===KONV_TAG_ROLE)));
              if(_roleEntry&&Date.now()-_roleEntry.createdTimestamp<_sixHoursMs){
                return interaction.reply({content:"Trying to claim the tag and join last minute will not work and will be caught by our anti-abuse system.",flags:64});
              }
            }
          }
        }
        state.activeGiveaway.entrants.add(userId);
        const count=state.activeGiveaway.entrants.size;
        // Update the giveaway embed with new entry count
        try{
          const gCh=interaction.guild.channels.cache.get(state.activeGiveaway.channelId);
          if(gCh&&state.activeGiveaway.buildEmbed){
            const gMsg=await gCh.messages.fetch(state.activeGiveaway.messageId).catch(()=>null);
            if(gMsg)await gMsg.edit({embeds:[state.activeGiveaway.buildEmbed(count)]}).catch(()=>{});
          }
        }catch{}
        return interaction.reply({content:`You are in! **${count}** ${count===1?"person has":"people have"} entered. Good luck!`,flags:64});
      }

      if(interaction.customId==="btn_confirm_ticket"){if(!interaction.deferred&&!interaction.replied)await interaction.deferUpdate().catch(()=>{});const pending=state.pending[interaction.user.id];if(!pending)return interaction.editReply({content:"Session expired. Please start again.",embeds:[],components:[]});delete state.pending[interaction.user.id];const ch=await createTicket(interaction,pending.method,pending.direction,pending.rawAmt,pending.coin,pending.walletInf,pending.notes,pending.recvCoin||null,pending.methods||null);const _pinged=pingedNote(pending);if(ch)return interaction.editReply({content:`Ticket opened \u2192 <#${ch.id}>${_pinged}`,embeds:[],components:[new ActionRowBuilder().addComponents(kLink("Open Ticket",`https://discord.com/channels/${interaction.guild.id}/${ch.id}`))]});return;}
      if(interaction.customId==="btn_cancel_ticket"){delete state.pending[interaction.user.id];return interaction.update({content:"Cancelled. Click Exchange Now to start again.",embeds:[],components:[]});}

      if(interaction.customId==="btn_support_ticket"){
        const modal=new ModalBuilder().setCustomId("modal_support").setTitle("Open a Support Ticket");
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("sup_issue").setLabel("What do you need help with?").setStyle(TextInputStyle.Paragraph).setPlaceholder("Describe your issue clearly...").setRequired(true)),new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("sup_tried").setLabel("What have you already tried?").setStyle(TextInputStyle.Short).setPlaceholder("e.g. Checked FAQ, contacted staff").setRequired(false)));
        return interaction.showModal(modal);
      }

      if(interaction.customId==="btn_report"){
        const _rt=(Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets"))[interaction.channel.id];
        if(!_rt||_rt.status!=="open")return interaction.reply({content:"This ticket is no longer open.",flags:64});
        if(interaction.user.id!==_rt.userId)return interaction.reply({content:"Only the client of this ticket can flag it.",flags:64});
        if(!_rt.claimedBy)return interaction.reply({content:"No exchanger has claimed this ticket yet.",flags:64});
        if(_rt.reported)return interaction.reply({content:"This ticket is already flagged. An owner will step in.",flags:64});
        const _rm=new ModalBuilder().setCustomId("modal_report").setTitle("Flag Ticket");
        _rm.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("inp_reason").setLabel("What went wrong?").setStyle(TextInputStyle.Paragraph).setMinLength(10).setMaxLength(500).setRequired(true).setPlaceholder("Describe what happened. The exchanger is frozen until an owner reviews this.")));
        return interaction.showModal(_rm);
      }
      if(interaction.customId==="btn_claim"){await claimTicket(interaction);return;}
      if(interaction.customId==="btn_mmclaim"||interaction.customId.startsWith("btn_mmclaim__")){await claimTicket(interaction,{mmConfirmed:true,method:interaction.customId.split("__")[1]||null});return;}
      if(interaction.customId==="btn_addmethod"){await addMethodPrompt(interaction);return;}
      if(interaction.customId==="btn_mmcancel"){await interaction.update({content:"Cancelled \u2014 the ticket is still unclaimed.",embeds:[],components:[]}).catch(()=>{});return;}
      if(interaction.customId==="btn_mmconfirm"){await confirmMiddleman(interaction);return;}
      if(interaction.customId==="btn_confirmdone"){await confirmCompletion(interaction);return;}
      if(interaction.customId==="btn_remind"){await remindClient(interaction);return;}
      if(interaction.customId==="btn_hopin"){await hopIn(interaction);return;}
      if(interaction.customId==="btn_checkin_ok"){await answerCheckin(interaction);return;}
      if(interaction.customId.startsWith("btn_riskclear__")||interaction.customId.startsWith("btn_riskfreeze__")){await handleRiskButton(interaction);return;}
      if(interaction.customId.startsWith("btn_profitok__")){await confirmProfitSplit(interaction);return;}
      if(interaction.customId.startsWith("btn_profit__")){await openProfitModal(interaction);return;}
      if(interaction.customId==="btn_done"){
        const tickets=Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets");
        const ticket=tickets[interaction.channel.id];
        if(!isExchanger(interaction.member)&&!isOwner(interaction.user.id,interaction.member))return interaction.reply({content:"Only exchangers can complete tickets.",flags:64});
        if(!ticket)return interaction.reply({content:"Ticket not found.",flags:64});
        if(ticket.status==="vouched"||ticket.status==="closed")return interaction.reply({content:"This exchange has already been completed.",flags:64});
        if(isSuspended(interaction.user.id)&&!isOwner(interaction.user.id,interaction.member))return interaction.reply({content:"Your exchanger access is suspended pending owner review.",flags:64});
        if(ticket.reported&&!isOwner(interaction.user.id,interaction.member))return interaction.reply({content:"This ticket is flagged. An owner needs to review it before it can be completed.",flags:64});
        if(ticket.mmPending&&!isOwner(interaction.user.id,interaction.member))return interaction.reply({content:"Waiting for the client to confirm the middleman.",flags:64});
        {const _mw=mmCompleteBlock(interaction.channel.id,isOwner(interaction.user.id,interaction.member));if(_mw)return interaction.reply({content:_mw,flags:64});}
        if(ticket.claimSystem){
          if(!ticket.claimedBy)return interaction.reply({content:"Claim this ticket before completing it.",flags:64});
          if(interaction.user.id!==ticket.claimedBy&&!isOwner(interaction.user.id,interaction.member))return interaction.reply({content:`Only <@${ticket.claimedBy}> can complete this ticket.`,flags:64});
        }
        if(ticket.claimSystem&&!isOwner(interaction.user.id,interaction.member)){
          // The client confirms before anything is finalized (owners finalize directly)
          if(ticket.completionPending)return interaction.reply({content:"Already waiting for the client to confirm.",flags:64});
          await interaction.deferReply({flags:64});
          const _sent=await requestCompletion(interaction.channel,ticket,tickets);
          return interaction.editReply({content:_sent?"Sent to the client for confirmation.":"Couldn't send the confirmation. Try again."});
        }
        await interaction.deferReply({flags:64});
        if(ticket.claimSystem)ticket.completionPending=false;   // an owner finalizes without waiting on the client
        ticket._overrideExchangerId=ticket.claimedBy||interaction.user.id;
        await completeTrade(interaction,ticket,tickets);
        return;
      }
      if(interaction.customId==="btn_close"){
        const _cts=Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets");
        const _ct=_cts[interaction.channel.id];
        const _isOwnerClose=isOwner(interaction.user.id,interaction.member);
        const _isStaffClose=CONFIG.STAFF_ROLE?interaction.member.roles.cache.has(CONFIG.STAFF_ROLE):false;
        const _supClose=_ct?null:supportTicketOf(interaction.channel);     // support tickets: the opener is named in the channel topic
        const _isClientClose=!!((_ct&&interaction.user.id===_ct.userId)||(_supClose&&_supClose.userId===interaction.user.id));
        let _canClose=_isOwnerClose||_isStaffClose||_isClientClose;
        if(!_canClose&&isExchanger(interaction.member)){
          // Once claimed, only the claiming exchanger can close it (client, staff and owners always can)
          _canClose=!isSuspended(interaction.user.id)&&(!(_ct&&_ct.claimSystem&&_ct.claimedBy)||_ct.claimedBy===interaction.user.id);
        }
        if(!_canClose)return interaction.reply({content:"Only the client, the exchanger handling this ticket, or staff can close it.",flags:64});
        await interaction.deferReply();
        {const _mw=await mmBeforeClose(interaction.channel,_isOwnerClose||_isStaffClose).catch(()=>null);if(_mw)return interaction.editReply({content:_mw});}       // the built-in middleman bot holds funds (or its card waits for a deposit)
        if(await doCloseTicket(interaction.channel,interaction.guild,interaction.user,_isClientClose?"Closed by client":"Closed by staff")===false)return interaction.editReply({content:"The ticket was not closed."}).catch(()=>{});
        await interaction.editReply({embeds:[kEmbed("Ticket","mute").setTitle(`Ticket Closed`).setDescription((_isClientClose?"This ticket was closed by the client.":"This ticket has been closed by staff.")+"\nDeleting in 15 seconds.").setTimestamp()]});
        setTimeout(()=>interaction.channel.delete().catch(()=>{}),15000);return;
      }

      if(interaction.customId.startsWith("mine_cell_")){
        const parts=interaction.customId.split("_"),userId=parts[2],idx=parseInt(parts[3]);
        if(interaction.user.id!==userId)return interaction.reply({content:"This is not your mine game.",flags:64});
        const game=state.mineGames[userId];
        if(!game)return interaction.reply({content:"No active game. Use /mine to start.",flags:64});
        if(game.over)return interaction.reply({content:"This game is already over.",flags:64});
        if(game.revealed.includes(idx))return interaction.reply({content:"You already revealed that cell.",flags:64});
        game.revealed.push(idx);game.tries++;
        const isDiamond=game.diamonds.includes(idx),isBomb=game.bombs.includes(idx);
        if(isDiamond)game.found++;
        if(isBomb){game.over=true;delete state.mineGames[userId];const rev={...game,revealed:[...game.revealed,idx],over:true};return interaction.update({embeds:[base("Mine").setColor(0xef4444).setDescription(`**BOOM! You hit a bomb.**\n\nPasses found: **${game.found}/3**\nTry again in **3 hours**.`).setFooter({text:"Konvert Mine  ·  No pass awarded  ·  Try in 3h"})],components:buildMineGrid(userId,rev)});}
        const triesLeft=3-game.tries;
        if(triesLeft<=0&&game.found<3){game.over=true;delete state.mineGames[userId];const rev={...game,revealed:[...game.revealed],over:true};return interaction.update({embeds:[base("Mine").setColor(0xff9900).setDescription(`**Out of clicks.** You found **${game.found}/3** passes.\nTry again in **3 hours**.`).setFooter({text:"Konvert Mine  ·  No pass awarded  ·  Try in 3h"})],components:buildMineGrid(userId,rev)});}
        if(game.found===3){
          game.over=true;delete state.mineGames[userId];state.passes[userId]=(state.passes[userId]||0)+1;
          try{const mem=await interaction.guild.members.fetch(userId);if(CONFIG.PASS_ROLE)await mem.roles.add(CONFIG.PASS_ROLE);}catch{}
          for(const oid of CONFIG.OWNER_IDS){try{const o=await client.users.fetch(oid);await o.send({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange  ·  Mine Winner",iconURL:IMG.LOGO}).setTitle("Exchange Pass Won").setDescription(`<@${userId}> (${interaction.user.tag}) found all 3 diamonds and won a free exchange pass.\nTotal passes: **${state.passes[userId]}**`).setTimestamp()]});}catch{}}
          return interaction.update({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange  ·  Mine",iconURL:IMG.LOGO}).setTitle("You Found All 3 Passes!").setDescription(`A **Free Exchange Pass** has been added to your account.\nOpen a ticket and type \`free\` to redeem it.`).addFields({name:"Result",value:"Free Exchange Pass awarded",inline:true},{name:"Tries Used",value:`**${game.tries} / 3**`,inline:true}).setFooter({text:"Konvert Mine  ·  Screenshot this as proof"}).setTimestamp()],components:buildMineGrid(userId,{...game,over:true})});
        }
        return interaction.update({embeds:[base("Mine").setColor(isDiamond?0x7C4DFF:0x5865F2).setDescription(isDiamond?`**Pass found!** ${game.found===3?"You got them all!":"Keep going."}`:`**Nothing here.** ${triesLeft} click${triesLeft!==1?"s":""} left.`).addFields({name:"Passes Found",value:`**${game.found} / 3**`,inline:true},{name:"Clicks Left",value:`**${triesLeft}**`,inline:true}).setFooter({text:`Konvert Mine`})],components:buildMineGrid(userId,game)});
      }
    }

    if(interaction.isModalSubmit()){
      if(interaction.customId.startsWith("modal_done__")){
        await interaction.deferReply();
        const channelId=interaction.customId.replace("modal_done__","");
        const rawAmt=parseFloat(interaction.fields.getTextInputValue("done_amount"));
        const exchangerRaw=interaction.fields.getTextInputValue("done_exchanger").trim().replace(/[<@!>]/g,"");
        const clientRaw=interaction.fields.getTextInputValue("done_client").trim().replace(/[<@!>]/g,"");
        if(isNaN(rawAmt)||rawAmt<=0)return interaction.editReply("Please enter a valid amount.");
        let clientId=clientRaw;try{const u=await client.users.fetch(clientRaw);clientId=u.id;}catch{}
        let exchangerId=exchangerRaw;try{const eu=await client.users.fetch(exchangerRaw);exchangerId=eu.id;}catch{}
        const tickets=Object.keys(_mem.tickets||{}).length>0?{..._mem.tickets}:load("tickets");
        if(!tickets[channelId]){
          tickets[channelId]={userId:clientId,userTag:clientRaw,method:"manual",direction:null,coin:null,amountUSD:rawAmt,feeUSD:calcFee(rawAmt,"send"),walletInfo:"manual",notes:"Completed via modal",status:"open",createdAt:Date.now()};
        }else{
          if(!tickets[channelId].amountUSD||tickets[channelId].amountUSD===0)tickets[channelId].amountUSD=rawAmt;
          if(!tickets[channelId].userId)tickets[channelId].userId=clientId;
        }
        tickets[channelId]._overrideExchangerId=exchangerId;
        await completeTrade(interaction,tickets[channelId],tickets);return;
      }
      
      if(interaction.customId.startsWith("modal_profit__")){await submitProfit(interaction);return;}
      if(interaction.customId==="modal_report"){
        await interaction.deferReply({flags:64});
        const _mt=Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets");
        const _mtk=_mt[interaction.channel.id];
        // Re-check everything: state may have changed while the form was open
        if(!_mtk||_mtk.status!=="open")return interaction.editReply({content:"This ticket is no longer open."});
        if(interaction.user.id!==_mtk.userId)return interaction.editReply({content:"Only the client of this ticket can flag it."});
        if(!_mtk.claimedBy)return interaction.editReply({content:"No exchanger has claimed this ticket yet."});
        if(_mtk.reported)return interaction.editReply({content:"This ticket is already flagged. An owner will step in."});
        const _reason=interaction.fields.getTextInputValue("inp_reason").trim().slice(0,500);
        const _res=await reportTicket(interaction,_mtk,_mt,_reason);
        return interaction.editReply({content:_res.exempt?"Flag sent to the owners.":"Ticket flagged. The exchanger is frozen and an owner will step in — don't send any more funds."});
      }

      if(interaction.customId==="modal_support"){
        const issue=interaction.fields.getTextInputValue("sup_issue"),tried=interaction.fields.getTextInputValue("sup_tried")||"Not specified",user=interaction.user,guild=interaction.guild;
        let ch;
        const _sPerms=[{id:guild.roles.everyone,deny:[PermissionFlagsBits.ViewChannel]},{id:user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]}];
        if(CONFIG.STAFF_ROLE&&guild.roles.cache.has(CONFIG.STAFF_ROLE))addOverwrite(_sPerms,{id:CONFIG.STAFF_ROLE,allow:[...OWNER_CHANNEL_ALLOW]});
        for(const o of await ownerOverwrites(guild))addOverwrite(_sPerms,o);
        if(guild.roles.cache.has(OWNER_ROLE))addOverwrite(_sPerms,{id:OWNER_ROLE,allow:[...OWNER_CHANNEL_ALLOW]});
        try{ch=await guild.channels.create({name:`support-${user.username.replace(/[^a-z0-9]/gi,"").toLowerCase().slice(0,12)}`,type:ChannelType.GuildText,parent:CONFIG.TICKET_CATEGORY||null,topic:`${SUPPORT_TOPIC}${user.id}`,permissionOverwrites:_sPerms});}catch(e){console.error("[support] couldn't create the channel:",e.message);return interaction.reply({content:"Failed to create support channel.",flags:64});}
        await ch.send({content:`<@${user.id}>`,embeds:[kEmbed("Support").setTitle(`Support Ticket`).setThumbnail(IMG.LOGO).setDescription(`Welcome, <@${user.id}>! Staff will assist you shortly — please be patient.\n\u200b`).addFields({name:"Issue",value:issue,inline:false},{name:"What You Tried",value:tried,inline:false}).setTimestamp().setFooter(kFoot("Support ticket"))],components:[new ActionRowBuilder().addComponents(closeButton())]});
        if(CONFIG.STAFF_ROLE)await ch.send(`New support ticket from <@${user.id}> — <@&${CONFIG.STAFF_ROLE}>`);
        log(guild,`SUPPORT: #${ch.name} opened by ${user.tag}`);
        return interaction.reply({content:`Support ticket opened \u2192 <#${ch.id}>`,flags:64});
      }

      if(interaction.customId==="modal_review"){const text=interaction.fields.getTextInputValue("review_text"),rating=Math.min(Math.max(parseInt(interaction.fields.getTextInputValue("review_rating"))||5,1),5),stars="\u2605".repeat(rating)+"\u2606".repeat(5-rating),targetCh=CONFIG.VOUCH_CHANNEL?interaction.guild.channels.cache.get(CONFIG.VOUCH_CHANNEL):interaction.channel;if(!targetCh)return interaction.reply({content:"Review channel not configured.",flags:64});await targetCh.send({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO}).setTitle("Community Review").setDescription(`*"${text}"*`).addFields({name:"From",value:`<@${interaction.user.id}>`,inline:true},{name:"Rating",value:stars,inline:true}).setTimestamp().setFooter({text:"Konvert Exchange  ·  Community Review"})]});return interaction.reply({content:"Your review has been posted. Thank you!",flags:64});}

      if(interaction.customId==="modal_fee"){
        const raw=parseAmount(interaction.fields.getTextInputValue("fee_amt"));
        if(isNaN(raw)||raw<=0)return interaction.reply({content:"Please enter a valid amount, for example 250.",flags:64});
        await interaction.deferReply({flags:64});
        const _mvip=isVipVolume(getUserVolume(interaction.user.id));   // same VIP rate as /fee
        const [btcP,ethP,solP]=await Promise.all([getPrice("BTC"),getPrice("ETH"),getPrice("SOL")]);
        return interaction.editReply({embeds:[feeEmbed(raw,{vip:_mvip,prices:{BTC:btcP,ETH:ethP,SOL:solP}})]});
      }

      if(interaction.customId.startsWith("modal_c2c__")){
        await interaction.deferReply({flags:64});
        const parts=interaction.customId.split("__"),sendCoin=parts[1],recvCoin=parts[2];
        const rawAmt=parseAmount(interaction.fields.getTextInputValue("c2c_amount"));
        if(isNaN(rawAmt)||rawAmt<=0)return interaction.editReply("Please enter a valid amount, for example 200.");
        if(!aboveMinimum(rawAmt))return interaction.editReply(minAmountText());
        const fee=Math.max(rawAmt*0.02,3),rate=2;
        state.pending[interaction.user.id]={method:"crypto",direction:"send",rawAmt,coin:sendCoin,walletInf:"C2C — staff will confirm wallet in ticket",notes:"",recvCoin};
        const d=dealOf({method:"crypto",direction:"send",coin:sendCoin,recvCoin,amountUSD:rawAmt,feeUSD:fee});
        return interaction.editReply({embeds:[kEmbed("Review").setTitle("Confirm Crypto to Crypto Exchange")
          .setDescription(`${dealHead(d)}\n${kLedger(dealRows(d,{rate}))}Press **Confirm & Open Ticket** to continue. Amounts are estimates until your exchanger confirms them in the ticket.`)
          .setFooter(kFoot("Step 3 of 3  ·  Wallet addresses are confirmed inside your ticket"))],components:[confirmRow()]});
      }

      if(interaction.customId.startsWith("modal_amount__")){
        await interaction.deferReply({flags:64});
        const parts=interaction.customId.split("__"),methods=parseMethodTag(parts[1]),method=methods[0],direction=parts[2];
        if(!method||!getMethod(method))return interaction.editReply("That payment method isn't available any more. Please start again.");
        const coin=cleanCoin(interaction.fields.getTextInputValue("inp_coin"));
        const rawAmt=parseAmount(interaction.fields.getTextInputValue("inp_amount"));
        const walletInf="Staff will confirm wallet and payment details in your ticket",notes="";
        if(isNaN(rawAmt)||rawAmt<=0)return interaction.editReply("Please enter a valid amount, for example 150.");
        if(!aboveMinimum(rawAmt))return interaction.editReply(minAmountText());
        if(!coin)return interaction.editReply("Please enter a coin, for example BTC, ETH or SOL.");
        // any coin accepted — ticket opens regardless
        const fee=calcFee(rawAmt,direction),rate=feeRate(rawAmt,direction);
        let coinAmt=null;
        if(direction==="send"){try{const coinPrice=await getPrice(coin);if(coinPrice&&rawAmt-fee>0)coinAmt=((rawAmt-fee)/coinPrice).toFixed(6);}catch{}}
        const _mx=methods.length>1?{methods}:{};          // several methods: the ticket will accept any of them
        state.pending[interaction.user.id]={method,..._mx,direction,rawAmt,coin,walletInf,notes};
        const d=dealOf({method,..._mx,direction,coin,amountUSD:rawAmt,feeUSD:fee});
        const _openTo=methods.length>1?`Open to **${joinOr(methods.map(methodLabel))}** exchangers. All of them are pinged when your ticket opens, and whoever claims it sets the method.\n\n`:"";
        const _minNote=!isSoloMethod(method)&&rawAmt*rate/100<CONFIG.MIN_FEE?`${kNote(`The ${fmtUSD(CONFIG.MIN_FEE)} minimum fee applies to every exchange.`)}\n\n`:"";          // the minimum fee, not the rate, is what is charged
        return interaction.editReply({embeds:[kEmbed("Review").setTitle("Confirm Your Exchange")
          .setDescription(`${dealHead(d)}\n${kLedger(dealRows(d,{rate,coinAmt}))}${_openTo}${_minNote}Press **Confirm & Open Ticket** to continue. Amounts are estimates until your exchanger confirms them in the ticket.`)
          .setFooter(kFoot("Step 3 of 3  ·  Wallet details are handled inside your ticket"))],components:[confirmRow()]});
      }

    }

  }catch(err){
    console.error("Interaction error:",err);
    try{const errMsg={content:"Something went wrong. Please try again.",flags:64};if(interaction.deferred||interaction.replied)await interaction.followUp(errMsg).catch(()=>{});else await interaction.reply(errMsg).catch(()=>{});}catch{}
  }
});

// ── LIVE LEADERBOARD ─────────────────────────────────────────────────────────
async function buildLiveLeaderboardEmbed(){
  const byUser=buildLeaderboardVolumes();
  const ranked=Object.entries(byUser).sort((a,b)=>b[1]-a[1]).slice(0,10);
  const totalVol=ranked.reduce((s,[,v])=>s+v,0);
  const timeStr=new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"});
  if(!ranked.length){
    return new EmbedBuilder()
      .setColor(0x7C4DFF)
      .setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO})
      .setTitle("Leaderboard")
      .setDescription("No exchanges yet.")
      .setFooter({text:`Konvert Exchange  ·  Updated ${timeStr}`})
      .setTimestamp();
  }
  const lines=ranked.map(([uid,vol],i)=>{
    const tier=getTier(vol);
    const rank=`\`#${i+1}\``;
    return `${rank} <@${uid}>  \u2014  **${fmtUSD(vol)}** `;
  }).join("\n");
  return new EmbedBuilder()
    .setColor(0x7C4DFF)
    .setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO})
    .setTitle("Top 10 Leaderboard")
    .setDescription(lines)
    .setFooter({text:`Konvert Exchange  ·  Total: ${fmtUSD(totalVol)}  ·  Updated ${timeStr}`})
    .setTimestamp();
}

async function updateLiveLeaderboard(guild){
  if(!state.liveLbMessageId||!state.liveLbChannelId)return;
  try{
    const ch=guild.channels.cache.get(state.liveLbChannelId)||await guild.channels.fetch(state.liveLbChannelId).catch(()=>null);
    if(!ch){state.liveLbMessageId=null;state.liveLbChannelId=null;saveLiveLb();return;}
    const msg=await ch.messages.fetch(state.liveLbMessageId).catch(()=>null);
    if(!msg){state.liveLbMessageId=null;state.liveLbChannelId=null;saveLiveLb();return;}
    await msg.edit({embeds:[await buildLiveLeaderboardEmbed()]});
    console.log("[liveLeaderboard] updated");
  }catch(e){console.log("[liveLeaderboard]",e.message);}
}


let ratesMsgId=null;
async function autoRates(guild){
  if(!guild)return;
  const channelId=RATES_CHANNEL_ID||CONFIG.RATES_CHANNEL;
  if(!channelId){console.log("[autoRates] disabled — no RATES_CHANNEL_ID set");return;}
  try{
    const ch=guild.channels.cache.get(channelId)||await guild.channels.fetch(channelId).catch(()=>null);
    if(!ch){console.log("[autoRates] channel not found or deleted — skipping");ratesMsgId=null;return;}
    const embed=await buildRatesEmbed();
    if(ratesMsgId){const msg=await ch.messages.fetch(ratesMsgId).catch(()=>null);if(msg){await msg.edit({embeds:[embed]});console.log("[autoRates] updated");return;}ratesMsgId=null;}
    const sent=await ch.send({embeds:[embed]});ratesMsgId=sent.id;console.log("[autoRates] posted new rates message");
  }catch(e){console.log("[autoRates] skipped:",e.message);}
}

async function checkAlerts(){
  if(!state.alerts.length)return;
  try{
    const qs=await quoteMany([...new Set(state.alerts.map(a=>a.coin))],8000),fired=[];
    for(const alert of state.alerts){
      const q=qs[_symOf(alert.coin)],price=q&&!(q.stale&&Date.now()-q.ts>PRICE_USABLE_MS)?q.usd:null;
      if(!price||!(alert.dir==="above"?price>=alert.target:price<=alert.target))continue;
      try{const user=await client.users.fetch(alert.userId);await user.send({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO}).setTitle("Price Alert Triggered").setDescription(`**${alert.coin}** is now **${alert.dir==="above"?"above":"below"}** your target of **$${alert.target.toLocaleString("en-US")}**\n\nCurrent price: **$${price.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}**\n\nHead to <#${CONFIG.EXCHANGE_CHANNEL}> to open an exchange.`).setThumbnail((await coinLogo(alert.coin))||IMG.LOGO).setTimestamp().setFooter({text:"Konvert Exchange  ·  Price Alerts"})]});}catch{}
      fired.push(alert);
    }
    state.alerts=state.alerts.filter(a=>!fired.includes(a));
  }catch{}
}

const GENERAL_CHANNEL_ID="1454793385750560894";
const STAT_CHANNEL_ID="1491619261821485056";
let _statTimer=null;
async function updateStatChannel(guild){
  if(_statTimer){clearTimeout(_statTimer);_statTimer=null;}
  try{
    const allT=Object.values(_mem.tickets&&Object.keys(_mem.tickets).length?_mem.tickets:load("tickets"));
    const totalVol=allT.filter(t=>["vouched","completed"].includes(t.status)&&t.method!=="adjustment"&&parseFloat(t.amountUSD||0)>0).reduce((s,t)=>s+(parseFloat(t.amountUSD)||0),0);
    const formatted=totalVol>=1000000?`$${(totalVol/1000000).toFixed(2)}M`:(totalVol>=1000?`$${Math.round(totalVol/1000)}K`:`$${Math.round(totalVol).toLocaleString("en-US")}`);
    const newName=`Total Exchanged: ${formatted}`;
    // Use REST directly — bypasses discord.js cache and rate limit handling
    const _rest=new REST({version:"10"}).setToken(CONFIG.TOKEN);
    await _rest.patch(`/channels/${STAT_CHANNEL_ID}`,{body:{name:newName}});
    console.log("[statChannel] updated to:",newName);
  }catch(e){
    const retryMs=(e.rawError?.retry_after||e.retryAfter||600)*1000;
    console.log(`[statChannel] err: ${e.message} retry in ${Math.round(retryMs/1000)}s`);
    _statTimer=setTimeout(()=>{_statTimer=null;updateStatChannel(guild).catch(()=>{});},retryMs);
  }
}
function scheduleStatChannelUpdate(guild){
  updateStatChannel(guild).catch(()=>{});
}

async function postDailyCryptoFact(guild){
  try{
    const ch=guild.channels.cache.get(GENERAL_CHANNEL_ID)||await guild.channels.fetch(GENERAL_CHANNEL_ID).catch(()=>null);
    if(!ch){console.log("[dailyFact] channel not found");return;}
    const facts=["Bitcoin was worth less than $0.01 when it first launched in 2009. The first real-world transaction used 10,000 BTC to buy two pizzas.","Ethereum's smart contracts allow code to run automatically without any middleman — the basis for DeFi, NFTs, and thousands of dApps.","Satoshi Nakamoto, Bitcoin's creator, has never moved their estimated 1 million BTC wallet — worth billions — since mining it in 2009.","There will only ever be 21 million Bitcoin. Around 19.7 million have already been mined. The last one won't be mined until around 2140.","Over 20% of all Bitcoin is estimated to be permanently lost — forgotten wallets, lost keys, and early miners who didn't think it would be worth anything.","Solana can process up to 65,000 transactions per second. Visa handles around 24,000. Bitcoin handles around 7.","El Salvador became the first country to adopt Bitcoin as legal tender in 2021. Citizens can pay taxes and buy groceries with it.","The term 'HODL' came from a 2013 forum post where someone drunkenly misspelled 'hold'. It's now a core crypto philosophy.","Crypto markets never close. Unlike stocks, you can exchange Bitcoin at 3am on Christmas Day.","Tether (USDT) is the most exchanged cryptocurrency by volume — more than Bitcoin or Ethereum on most days.","DeFi protocols collectively hold over $50 billion in locked assets, all managed by code with no banks involved.","The first Bitcoin ATM opened in Vancouver, Canada in 2013. There are now over 38,000 worldwide.","Ethereum burns a portion of every transaction fee permanently, making it deflationary over time.","Lightning Network allows Bitcoin transactions to settle in milliseconds for fractions of a cent — solving the scalability problem.","Crypto wallets don't actually store crypto. They store the private keys that prove ownership on the blockchain.","Over 560 million people worldwide own some form of cryptocurrency as of 2024.","A single Dogecoin was worth $0.0002 in 2019. At its peak in 2021, it hit $0.74 — a 3,700x increase.","The blockchain cannot be edited or deleted. Every transaction ever made on Bitcoin is permanently visible to anyone.","Ripple (XRP) can settle international bank transfers in 3–5 seconds for a fraction of a cent, vs 3–5 business days for SWIFT.","Gas fees on Ethereum once hit over $200 per transaction during peak NFT demand in 2021.","Cold wallets — hardware devices not connected to the internet — are considered the safest way to store large amounts of crypto.","Binance handles over $10 billion in daily volume, making it the largest crypto exchange in the world.","The Bitcoin halving happens every 4 years, cutting miner rewards in half. Historically, each halving has preceded a major bull run.","Stablecoins like USDC are backed 1:1 by US dollars held in reserve, making them immune to crypto volatility.","Crypto transactions are pseudonymous, not anonymous. Every transaction is traceable on the public blockchain.","Avalanche (AVAX) can finalize transactions in under 2 seconds — one of the fastest finality times of any blockchain.","There are over 20,000 different cryptocurrencies in existence. The vast majority have little to no value.","Michael Saylor's MicroStrategy holds over 200,000 BTC on its balance sheet — more than most countries.","Ethereum's merge to Proof of Stake in 2022 reduced its energy consumption by over 99.9%.","The total crypto market cap has exceeded $3 trillion — larger than the GDP of most countries.","Bitcoin's anonymous creator, Satoshi Nakamoto, published the whitepaper on October 31, 2008 — Halloween.","The Bitcoin genesis block contains a hidden message referencing a UK newspaper headline about bank bailouts.","Vitalik Buterin proposed Ethereum at age 19, and it launched in 2015 when he was just 21.","Mt. Gox, once the largest Bitcoin exchange, handled over 70% of all BTC transactions before its 2014 collapse.","A Norwegian man bought 5,000 Bitcoin for $27 in 2009. By 2021, it was worth over $1 million.","Wrapped Bitcoin (WBTC) lets BTC holders use their coins on Ethereum-based DeFi platforms.","The Lightning Network can theoretically support millions of transactions per second across its network of channels.","NFTs are technically just tokens that point to a piece of data — the art itself is usually stored off-chain.","Proof of Work mining consumes more electricity annually than some entire countries, including Argentina.","Ethereum's 'gas' is named because it's the fuel that powers computation on the network — pay more, go faster.","Polygon processes more daily transactions than Ethereum mainnet at a fraction of the cost.","The first NFT, 'Quantum,' was minted by Kevin McCoy in 2014 — years before the NFT boom.","Coinbase went public via direct listing on Nasdaq in April 2021, valued at over $85 billion at the time.","Monero is designed for complete privacy — transaction amounts, sender, and receiver are all hidden by default.","Cardano was founded by Ethereum co-founder Charles Hoskinson and focuses on academic peer-reviewed research.","Shiba Inu (SHIB) was created as a 'Dogecoin killer' and at one point had a market cap over $40 billion.","The term 'whale' refers to someone holding enough crypto to move markets with a single order.","Bitcoin's block time averages 10 minutes — Ethereum's is around 12 seconds.","Some countries, like China, have banned crypto exchanges multiple times but still lead in mining hardware production.","A '51% attack' happens when a single entity controls majority mining power and can manipulate the blockchain.","The Ethereum Merge in September 2022 was one of the most significant upgrades in blockchain history, switching from mining to staking.","USDT (Tether) processes more transaction volume daily than Bitcoin and Ethereum combined.","Crypto.com paid $700 million for the naming rights to the Staples Center, renaming it Crypto.com Arena.","The Bored Ape Yacht Club NFT collection generated over $1 billion in total sales volume.","Smart contracts can't be paused or changed once deployed unless the developer builds in an upgrade mechanism.","Binance Smart Chain (now BNB Chain) was created to offer Ethereum-compatible apps with lower fees.","The largest single crypto heist was the Poly Network hack in 2021 — $611 million was stolen, then mostly returned.","Bitcoin mining difficulty adjusts roughly every two weeks to keep block times consistent.","Litecoin was created in 2011 as a 'lite' version of Bitcoin with faster block times.","The Ethereum Name Service (ENS) lets you replace a long wallet address with something like 'yourname.eth'.","Decentralized exchanges (DEXs) like Uniswap let you swap crypto without ever giving up custody of your funds.","Ordinals brought NFT-like functionality directly to the Bitcoin blockchain in 2023.","Some Bitcoin ATMs charge fees as high as 15-20% — always check rates before using one.","The crypto term 'rug pull' describes when developers abandon a project and run off with investor funds.","Solana suffered several major network outages in 2021-2022 due to transaction spam from bots.","Avalanche uses three separate blockchains working together — the X-Chain, C-Chain, and P-Chain.","A 'cold wallet' that's never connected to the internet is also called 'air-gapped' storage.","The Genesis block of Bitcoin can never be spent — it's permanently locked by design.","Crypto winters — extended bear markets — have happened in 2014, 2018, and 2022, each followed by major recoveries.","PayPal began allowing US users to buy, sell, and hold crypto directly in 2020.","The DAO hack in 2016 led to a hard fork of Ethereum, creating Ethereum Classic as a separate chain.","Some companies pay employees partially in crypto, including parts of Latin America with high inflation.","Chainlink provides 'oracles' — services that feed real-world data like prices into smart contracts.","A single Ethereum transaction once cost over $400 in gas fees during the 2021 NFT craze.","Tesla bought $1.5 billion in Bitcoin in 2021, briefly accepted it for car purchases, then stopped.","The Pizza transaction — 10,000 BTC for two pizzas in 2010 — is celebrated every May 22nd as 'Bitcoin Pizza Day'.","Crypto exchanges process orders 24/7/365 — there are no holidays or weekends in crypto markets.","Some blockchains, like Algorand, are carbon-negative, offsetting more emissions than they produce.","The total number of Bitcoin addresses with a non-zero balance has grown to over 50 million.","Dogecoin started as a joke in 2013 based on the 'Doge' meme featuring a Shiba Inu.","MetaMask, one of the most popular crypto wallets, has over 30 million monthly active users.","The first Bitcoin exchange rate was set in 2010 at roughly $0.0008 per BTC.","Some NFT projects include 'royalties' that pay the original creator a percentage every time the NFT resells.","Bitcoin's hash rate — the total computing power securing the network — has grown over a billion times since 2010.","Smart contract bugs have led to billions in losses; the 2022 Wormhole hack alone cost $325 million.","Layer 2 solutions like Arbitrum and Optimism process transactions off the main Ethereum chain to reduce costs.","Crypto staking lets holders earn rewards simply for locking up their coins to help secure the network.","The phrase 'not your keys, not your coins' emphasizes self-custody over keeping crypto on exchanges.","Bitcoin Cash split from Bitcoin in 2017 over disagreements about block size limits.","The first country-wide Bitcoin mining ban was implemented by China in 2021, shifting mining to the US and Kazakhstan.","Crypto.com, Binance, and Coinbase are among the top 5 most downloaded finance apps globally most years.","An estimated 4 million BTC belonging to Satoshi Nakamoto have never moved since being mined.","Polkadot allows multiple blockchains to transfer data and assets between each other seamlessly.","The Ethereum Virtual Machine (EVM) is so widely copied that dozens of other blockchains run EVM-compatible code.","Crypto debit cards from companies like Crypto.com let you spend crypto anywhere Visa is accepted, with automatic conversion.","A single Bitcoin can be divided into 100 million units called 'satoshis,' named after its creator.","The largest Bitcoin transaction ever recorded moved over $1 billion worth of BTC in a single transfer.","Some DeFi protocols offer 'flash loans' — borrowing millions with zero collateral, repaid within the same transaction.","Argentina has one of the highest crypto adoption rates in the world due to currency instability.","The Ethereum network processes roughly 1 million transactions per day.","Crypto Twitter (now X) has been a major driver of meme coin pumps, including Dogecoin and Shiba Inu.","Hardware wallets like Ledger and Trezor store private keys on a physical device disconnected from the internet.","The SEC has sued multiple major exchanges over claims that certain tokens are unregistered securities.","Bitcoin's price has experienced over 10 corrections of more than 30% throughout its history.","Solana's mascot, a smiling sun-like logo, represents speed and 'proof of history' consensus.","Crypto faucets are websites that give away tiny amounts of crypto for completing simple tasks — mostly used for testing.","The Genesis Bitcoin block reward was 50 BTC — today it's down to 3.125 BTC after multiple halvings.","Yield farming involves moving crypto between DeFi protocols to chase the highest available interest rates.","The first decentralized stablecoin, DAI, is backed by crypto collateral rather than dollars in a bank.","Ethereum co-founder Gavin Wood coined the term 'Web3' to describe a decentralized internet.","Bitcoin mining farms in Texas often use excess wind and solar power that would otherwise go to waste.","Crypto airdrops — free token distributions — have made some early users millions for doing almost nothing.","The Lightning Network's largest public node can route payments through thousands of connected channels.","Some video games now let players earn real crypto by playing — known as 'play-to-earn' gaming.","Total value locked (TVL) in DeFi peaked at over $180 billion in late 2021 before falling sharply.","Bitcoin's all-time high in 2021 came just months before one of its steepest crashes in history.","The Sandbox and Decentraland are virtual worlds where users buy and sell virtual land using crypto.","Ripple's XRP was created in 2012 specifically for fast, low-cost cross-border payments between banks.","Crypto wallets generate a 'seed phrase' — usually 12 or 24 words — that can restore your entire wallet if lost.","The blockchain industry employs over 1 million people worldwide across development, finance, and infrastructure.","Some museums now display NFT art on digital screens alongside traditional paintings.","A Bitcoin transaction is considered 'confirmed' after roughly 6 blocks, taking about an hour.","Stablecoin transfers make up a majority of all crypto transaction volume on most blockchains.","The first Bitcoin conference was held in 2011 in New York with fewer than 100 attendees.","Some countries offer tax exemptions for crypto held longer than a year, similar to long-term capital gains.","Uniswap's automated market maker model lets anyone provide liquidity and earn swap fees.","Crypto scams cost victims over $10 billion globally in 2023 alone, according to FBI reports.","The phrase 'to the moon' originated from crypto communities expressing hope for massive price increases.","Ethereum's total supply has no hard cap, unlike Bitcoin's fixed 21 million.","Some NFT collections grant holders access to private Discord communities, events, or real-world perks.","The crypto market operates without a central clearing house — settlement happens directly on the blockchain.","Bitcoin dominance — its share of the total crypto market cap — has ranged from under 40% to over 70% historically."];
    const fact=facts[Math.floor(Math.random()*facts.length)];
    const coins=["BTC","ETH","SOL","XRP","BNB","ADA","DOGE","AVAX","LTC","DOT"];
    const featuredCoin=coins[Math.floor(Math.random()*coins.length)];
    let priceStr="";try{const p=await getPrice(featuredCoin);if(p)priceStr=` \u00b7 **${featuredCoin}: ${fmtUSD(p)}**`;}catch{}
    await ch.send({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange  ·  Daily Crypto Fact",iconURL:IMG.LOGO}).setTitle("Did You Know?").setThumbnail((await coinLogo(featuredCoin))||IMG.LOGO).setDescription(`${fact}\n\u200b`).addFields({name:"Live Price",value:`${featuredCoin}${priceStr||" \u2014 unavailable"}`,inline:true},{name:"Exchange Now",value:`Open a ticket in <#${CONFIG.EXCHANGE_CHANNEL}>`,inline:true}).setImage(IMG.BANNER).setFooter({text:"Konvert Exchange  ·  Daily fact \u2014 come back tomorrow for another"}).setTimestamp()]});
    console.log("[dailyFact] posted");
  }catch(e){console.error("[dailyFact]",e.message);}
}

function scheduleDailyFact(guild){
  function msUntil9am(){const now=new Date(),next=new Date(now);next.setUTCHours(13,0,0,0);if(next<=now)next.setUTCDate(next.getUTCDate()+1);return next.getTime()-now.getTime();}
  const delay=msUntil9am();console.log(`[dailyFact] first post in ${Math.round(delay/3600000)}h`);
  setTimeout(()=>{postDailyCryptoFact(guild).catch(()=>{});setInterval(()=>postDailyCryptoFact(guild).catch(()=>{}),24*60*60*1000);},delay);
}



// ── DAILY OWNER DIGEST ──────────────────────────────────────────────────────
// Every day at 11pm UTC, DM all owners a quick performance summary
let _lastDigestDate="";
async function postDailyDigest(guild){
  // Guard: only send once per EST calendar day regardless of restarts
  const _estNow=new Date(Date.now()-5*3600000);
  const _todayKey=`${_estNow.getFullYear()}-${_estNow.getMonth()}-${_estNow.getDate()}`;
  if(_lastDigestDate===_todayKey){console.log("[dailyDigest] already sent today, skipping");return;}
  _lastDigestDate=_todayKey;
  try{
    const allT=Object.values(_mem.tickets&&Object.keys(_mem.tickets).length?_mem.tickets:load("tickets"));
    const now=new Date();
    // EST midnight (UTC-5)
    const estMidnight=new Date(now);
    estMidnight.setUTCHours(5,0,0,0); // 5am UTC = midnight EST
    if(estMidnight>now)estMidnight.setUTCDate(estMidnight.getUTCDate()-1);
    const todayStart=estMidnight.getTime();
    // Real trades + positive adjustments both count toward volume
    const done=allT.filter(t=>["vouched","completed"].includes(t.status)&&t.method!=="adjustment"&&parseFloat(t.amountUSD||0)>0);
    const today=done.filter(t=>t.completedAt&&t.completedAt>=todayStart);
    const todayVol=today.reduce((s,t)=>s+(parseFloat(t.amountUSD)||0),0);
    // Fee: use stored feeUSD, fallback to calcFee if missing
    const todayFees=today.reduce((s,t)=>s+ticketFee(t),0);
    const open=allT.filter(t=>t.status==="open"&&t.method!=="adjustment").length;
    const disputes=allT.filter(t=>t.status==="dispute").length;
    // All-time stats — include adjustment_deal in count
    const allDone=allT.filter(t=>["vouched","completed"].includes(t.status)&&t.method!=="adjustment"&&parseFloat(t.amountUSD||0)>0);
    const allVol=allDone.reduce((s,t)=>s+(parseFloat(t.amountUSD)||0),0);
    const allFees=allDone.reduce((s,t)=>s+ticketFee(t),0);
    // Week stats
    const weekStart=Date.now()-7*86400000;
    const week=allDone.filter(t=>t.completedAt&&t.completedAt>=weekStart);
    const weekVol=week.reduce((s,t)=>s+(parseFloat(t.amountUSD)||0),0);
    const avgDeal=allDone.length?allVol/allDone.length:0;
    // Top client today
    const byClient={};
    today.forEach(t=>{if(t.userId)byClient[t.userId]=(byClient[t.userId]||0)+(parseFloat(t.amountUSD)||0);});
    const topClient=Object.entries(byClient).sort((a,b)=>b[1]-a[1])[0];

    // Top exchanger today
    const byEx={};
    today.forEach(t=>{if(t.completedBy){byEx[t.completedBy]=(byEx[t.completedBy]||0)+(parseFloat(t.amountUSD)||0);}});
    const topEx=Object.entries(byEx).sort((a,b)=>b[1]-a[1])[0];

    // New referrals today
    const ref={referred:{},points:{}};
    const newRefs=Object.entries(ref.referred||{}).filter(([,refAt])=>{
      // referred doesn't have timestamps in current schema, skip if unavailable
      return false;
    }).length;

    if(today.length===0&&open===0&&disputes===0){
      console.log("[dailyDigest] nothing to report, skipping");
      return;
    }

    const estDate=new Date(now.getTime()-5*3600000);
    const dateStr=estDate.toLocaleDateString("en-CA",{weekday:"long",month:"long",day:"numeric"});
    const embed=new EmbedBuilder()
      .setColor(0x7C4DFF)
      .setAuthor({name:"Konvert Exchange  ·  Daily Digest",iconURL:IMG.LOGO})
      .setTitle(dateStr+" (EST)")
      .addFields(
        {name:"Today — Exchanges",value:`${today.length}`,inline:true},
        {name:"Today — Volume",value:fmtUSD(todayVol),inline:true},
        {name:"Today — Fees",value:fmtUSD(todayFees),inline:true},
        {name:"This Week",value:`${nExchanges(week.length)} · ${fmtUSD(weekVol)}`,inline:true},
        {name:"All-Time",value:`${nExchanges(allDone.length)} · ${fmtUSD(allVol)}`,inline:true},
        {name:"All-Time Fees",value:fmtUSD(allFees),inline:true},
        {name:"Avg Deal",value:avgDeal>0?fmtUSD(avgDeal):"—",inline:true},
        {name:"Open Tickets",value:`${open}`,inline:true},
        {name:"Disputes",value:`${disputes}`,inline:true},
        {name:"Top Client",value:topClient?`<@${topClient[0]}> · ${fmtUSD(topClient[1])}`:"—",inline:true},
        {name:"Top Exchanger",value:topEx?`<@${topEx[0]}> · ${fmtUSD(topEx[1])}`:"—",inline:true},
      )
      .setFooter({text:"Konvert Exchange  ·  Toronto EST"})
      .setTimestamp();

    for(const oid of CONFIG.OWNER_IDS){
      try{
        const owner=await client.users.fetch(oid);
        await owner.send({embeds:[embed]});
      }catch{}
    }
    console.log("[dailyDigest] sent to owners");
  }catch(e){console.error("[dailyDigest]",e.message);}
}

async function postWeeklyClientRecap(){
  try{
    const allT=Object.values(_mem.tickets&&Object.keys(_mem.tickets).length?_mem.tickets:load("tickets"));
    const now=new Date(),weekAgo=Date.now()-7*86400000;
    const done=allT.filter(t=>["vouched","completed"].includes(t.status)&&t.method!=="adjustment"&&parseFloat(t.amountUSD||0)>0);
    const weekTrades=done.filter(t=>t.completedAt&&t.completedAt>=weekAgo);
    const clientIds=[...new Set(weekTrades.map(t=>t.userId))];
    const estDate=new Date(now.getTime()-5*3600000);
    const weekStr=estDate.toLocaleDateString("en-CA",{month:"long",day:"numeric",year:"numeric"});
    let sent=0;
    for(const uid of clientIds){
      try{
        const myWeek=weekTrades.filter(t=>t.userId===uid);
        const myVol=myWeek.reduce((s,t)=>s+(parseFloat(t.amountUSD)||0),0);
        const myFees=myWeek.reduce((s,t)=>s+(parseFloat(t.feeUSD)||0),0);
        const allTime=done.filter(t=>t.userId===uid);
        const allVol=allTime.reduce((s,t)=>s+(parseFloat(t.amountUSD)||0),0);
        const tier=getTier(allVol);
        const user=await client.users.fetch(uid).catch(()=>null);
        if(!user)continue;
        const embed=new EmbedBuilder().setColor(0x7C4DFF)
          .setAuthor({name:"Konvert Exchange  ·  Weekly Recap",iconURL:IMG.LOGO})
          .setTitle("Your Weekly Summary")
          .setDescription(`Week ending **${weekStr}** (EST)\n\u200b`)
          .addFields(
            {name:"This Week",value:`**${myWeek.length}** exchange${myWeek.length!==1?"s":""}`,inline:true},
            {name:"Volume This Week",value:`**${fmtUSD(myVol)}**`,inline:true},
            {name:"Fees This Week",value:`**${fmtUSD(myFees)}**`,inline:true},
            {name:"All-Time Volume",value:`**${fmtUSD(allVol)}**`,inline:true},
            {name:"All-Time Exchanges",value:`**${allTime.length}**`,inline:true},
            {name:"Your Tier",value:`**${tier.label}**`,inline:true},
          )
          .setImage(IMG.BANNER)
          .setFooter({text:"Konvert Exchange  ·  Weekly Recap"});
        await user.send({embeds:[embed]}).catch(()=>{});
        sent++;
      }catch{}
    }
    console.log(`[weeklyRecap] sent to ${sent} clients`);
  }catch(e){console.error("[weeklyRecap]",e.message);}
}
function scheduleWeeklyClientRecap(){
  function msUntilSundayEST(){const now=new Date();const estNow=new Date(now.getTime()-5*3600000);const day=estNow.getDay(),d=day===0?7:(7-day),next=new Date(estNow);next.setDate(estNow.getDate()+d);next.setHours(20,0,0,0);return next.getTime()-estNow.getTime();}
  const delay=msUntilSundayEST();
  console.log(`[weeklyRecap] first recap in ${Math.round(delay/3600000)}h`);
  setTimeout(()=>{postWeeklyClientRecap().catch(()=>{});setInterval(()=>postWeeklyClientRecap().catch(()=>{}),7*24*60*60*1000);},delay);
}

function scheduleDailyDigest(guild){
  function msUntil11pmEST(){const now=new Date();const estOffset=-5*60;const estNow=new Date(now.getTime()+estOffset*60000);const next=new Date(estNow);next.setHours(23,0,0,0);if(next<=estNow)next.setDate(next.getDate()+1);return next.getTime()-estNow.getTime();}
  const delay=msUntil11pmEST();
  console.log(`[dailyDigest] first digest in ${Math.round(delay/3600000)}h`);
  setTimeout(()=>{postDailyDigest(guild).catch(()=>{});setInterval(()=>postDailyDigest(guild).catch(()=>{}),24*60*60*1000);},delay);
}


client.once(Events.ClientReady,async()=>{
  console.log(`Konvert Bot online -- ${client.user.tag}  [${BOT_VERSION}${BOT_BUILD?`, build ${BOT_BUILD}`:""}]`);
  client.user.setPresence({activities:[{name:"Konvert",type:3}],status:"online"});
  // Bootstrap owner — if set, add to OWNER_IDS on every startup
  if(process.env.BOOTSTRAP_OWNER_ID){
    const bid=process.env.BOOTSTRAP_OWNER_ID.trim();
    if(!CONFIG.OWNER_IDS.includes(bid)){
      CONFIG.OWNER_IDS.push(bid);
      console.log(`[bootstrap] added ${bid} to OWNER_IDS`);
    }
  }

  const guild=client.guilds.cache.get(CONFIG.GUILD_ID);

  // 1. Init Postgres table
  await initDB();

  // 2. Load all data — Postgres first, disk fallback, Discord last resort
  const pgTickets=await dbGet("konvert_tickets");
  const pgReferrals=await dbGet("konvert_referrals");
  const pgWallets=await dbGet("konvert_wallets");
  const pgBlacklist=await dbGet("konvert_blacklist");

  if(pgTickets&&Object.keys(pgTickets).length>0){
    _mem.tickets=pgTickets;
    console.log(`[startup] tickets loaded from Postgres: ${Object.keys(pgTickets).length} entries`);
  } else {
    console.log("[startup] Postgres empty — running Discord migration...");
    await restoreFromDiscord();
  }

  if(pgReferrals&&Object.keys(pgReferrals).length>0){
    _mem.referrals=pgReferrals;
    console.log(`[startup] referrals loaded from Postgres`);
  }
  if(pgWallets&&Object.keys(pgWallets).length>0){
    _mem.wallets=pgWallets;
    console.log(`[startup] wallets loaded from Postgres`);
  }
  if(pgBlacklist&&Object.keys(pgBlacklist).length>0){
    _mem.blacklist=pgBlacklist;
    console.log(`[startup] blacklist loaded from Postgres`);
  }
  const pgSusp=await dbGet("konvert_suspensions");
  if(pgSusp&&Object.keys(pgSusp).length>0){
    _mem.suspensions=pgSusp;
    console.log(`[startup] suspensions loaded from Postgres: ${Object.keys(pgSusp).length}`);
  }
  const pgHolds=await dbGet("konvert_holds");
  if(pgHolds&&Object.keys(pgHolds).length>0){
    _mem.holds=pgHolds;
    console.log(`[startup] safety holds loaded from Postgres: ${Object.keys(pgHolds).length}`);
  }else{
    try{const d=JSON.parse(fs.readFileSync(DB.holds,"utf8"));if(d&&Object.keys(d).length>0)_mem.holds=d;}catch{}
  }
  const pgPromos=await dbGet("konvert_promos");
  if(pgPromos&&Object.keys(pgPromos).length>0){
    state.promos=pgPromos;
    console.log(`[startup] promos loaded from Postgres: ${Object.keys(pgPromos).length} codes`);
  }
  const pgLiveLb=await dbGet("konvert_live_lb");
  if(pgLiveLb&&pgLiveLb.messageId&&pgLiveLb.channelId){
    state.liveLbMessageId=pgLiveLb.messageId;
    state.liveLbChannelId=pgLiveLb.channelId;
    console.log(`[startup] live leaderboard restored: msg ${pgLiveLb.messageId} in channel ${pgLiveLb.channelId}`);
  }

  // Konvert's built-in server middleman bot: its settings, wallet and open deals are read before anything can use them
  await mmInit().catch(e=>console.error("[mm] init failed:",e.message));

  if(guild){
    await cacheInvites(guild);
    await autoRates(guild).catch(e=>console.log("[autoRates startup]",e.message));
    setInterval(()=>autoRates(guild),30*60*1000);
    setInterval(()=>checkAlerts(),5*60*1000);
    // Periodic Postgres sync every 10 min as extra safety net
    setInterval(async()=>{
      const t=_mem.tickets;const r=_mem.referrals;
      if(Object.keys(t||{}).length>0)await dbSet("konvert_tickets",t).catch(()=>{});
      if(Object.keys(r||{}).length>0)await dbSet("konvert_referrals",r).catch(()=>{});
      // Also refresh live leaderboard
      await updateLiveLeaderboard(guild).catch(()=>{});
    },10*60*1000);
    // Discord backup every 30 min (secondary redundancy)
    setInterval(()=>{const t=load("tickets");if(Object.keys(t).length>0)_backupToDiscord(t).catch(()=>{});},30*60*1000);
    // Sync ALL member tier roles every hour automatically
    setInterval(()=>syncAllTierRoles(guild).catch(()=>{}),60*60*1000);
    // Run once on startup after a short delay (let everything load first)
    setTimeout(()=>syncAllTierRoles(guild).catch(()=>{}),30*1000);
    // Sync KONV tag role holders into memory on startup
    setTimeout(async()=>{try{const allM=await guild.members.fetch();let ct=0;for(const m of allM.values()){const pg=(m.user&&m.user.primaryGuild)||null;const hasPG=!!(pg&&pg.identityEnabled&&pg.identityGuildId===CONFIG.GUILD_ID);if(m.roles.cache.has(KONV_TAG_ROLE)||hasPG){state.konvTagUsers.add(m.id);ct++;}}console.log(`[konvTag] Synced ${ct} holders`);}catch(e){console.error("[konvTag sync]",e.message);}},35*1000);
    // Refresh live leaderboard on startup
    setTimeout(()=>updateLiveLeaderboard(guild).catch(()=>{}),20*1000);
    // Update stat channel on startup
    setTimeout(()=>updateStatChannel(guild).catch(()=>{}),15*1000);
    // One-time: kick old bot if still in server
    try{
      const _oldBotMember=await guild.members.fetch("1502324015170064475").catch(()=>null);
      if(_oldBotMember){await _oldBotMember.kick("Replaced by new bot").catch(()=>{});console.log("[startup] Old bot kicked");}
    }catch{}
    scheduleWeeklyClientRecap();
    // Daily promo countdown DM at 9am EST
    (function schedulePromoReminder(){
      function msUntil9amEST(){const now=new Date(),est=new Date(now.getTime()-5*3600000);const next=new Date(est);next.setHours(9,0,0,0);if(next<=est)next.setDate(next.getDate()+1);return next.getTime()-est.getTime();}
      setTimeout(function fire(){
        if(state.dualPromo&&state.dualPromo.active&&Date.now()<state.dualPromo.expiresAt){
          const daysLeft=Math.ceil((state.dualPromo.expiresAt-Date.now())/86400000);
          for(const oid of CONFIG.OWNER_IDS){
            client.users.fetch(oid).then(u=>u.send(`**Dual-Server Promo Reminder**\n${daysLeft} day${daysLeft!==1?"s":""} remaining (${state.dualPromo.feePercent}% fee).\nExpires <t:${Math.floor(state.dualPromo.expiresAt/1000)}:R>.`).catch(()=>{})).catch(()=>{});
          }
        }
        setTimeout(fire,24*60*60*1000);
      },msUntil9amEST());
    })();
    scheduleDailyFact(guild);
    scheduleDailyDigest(guild);
    // Profit reports: tell the owner about exchangers who haven't replied (every 10 minutes; survives restarts)
    setInterval(()=>sweepProfitReplies().catch(e=>console.error("[profitSweep]",e.message)),10*60*1000);
    setTimeout(()=>sweepProfitReplies().catch(()=>{}),30*1000);
    // Quick "Is everything okay?" check-ins booked by the safety system for a suspected exchanger's other clients (every minute; survives restarts)
    setInterval(()=>sweepCheckins(guild).catch(e=>console.error("[checkin]",e.message)),60*1000);
    setTimeout(()=>sweepCheckins(guild).catch(()=>{}),25*1000);
    // A ticket nobody has claimed for ten minutes: its card quietly suggests Add Method (every minute; survives restarts)
    setInterval(()=>sweepUnclaimed(guild).catch(e=>console.error("[nudge]",e.message)),60*1000);
    setTimeout(()=>sweepUnclaimed(guild).catch(()=>{}),35*1000);
    // The built-in middleman bot: every 5 seconds while a deal waits for a deposit, every 20 seconds otherwise (survives restarts: the deals live in Postgres);
    // the wallet is checked against the deals every hour, and once at start-up together with payout recovery and the backup reminder
    setInterval(()=>mmTick().catch(e=>console.error("[mm] sweep:",e.message)),MM_FAST_MS);
    setInterval(()=>mmReconcile().catch(e=>console.error("[mm] balance check:",e.message)),60*60*1000);
    setTimeout(()=>mmTick().catch(()=>{}),8*1000);
    setTimeout(()=>mmStartup().catch(e=>console.error("[mm] startup:",e.message)),20*1000);

    // The new Konvert banner on posts that still show the old one (once per banner)
    setTimeout(()=>healBanners(guild).catch(e=>console.log("[banner] heal:",e.message)),22*1000);
    // Backup-server posts made before v15 get a clickable Invite link (once, shortly after the bot starts)
    setTimeout(()=>healBackupPosts(guild).catch(e=>console.log("[backup] heal:",e.message)),12*1000);
    // Shows in the logs which price services answer from this server (so a blocked one is easy to spot)
    setTimeout(()=>priceSelfCheck().catch(()=>{}),40*1000);
    // Safety system: settles unanswered worries, notices silent exchangers (quietly), retires old holds (every 30 seconds)
    setInterval(()=>sweepSafety(guild).catch(e=>console.error("[safety]",e.message)),30*1000);
    setTimeout(()=>sweepSafety(guild).catch(()=>{}),20*1000);
    // Show who profit DMs go to, so a wrong ID is obvious in the logs
    for(const _pid of PROFIT_DM_IDS)client.users.fetch(_pid).then(u=>console.log(`[profit] profit DMs go to ${u.username} (${_pid})`)).catch(()=>console.log(`[profit] WARNING: can't find profit DM recipient ${_pid}`));
    // Price alert checker — every 2 minutes
    setInterval(async()=>{
      if(!state.alerts.length)return;
      const coins=[...new Set(state.alerts.map(a=>a.coin))];
      const prices={};
      for(const c of coins){
        const p=await Promise.race([getPrice(c),new Promise(r=>setTimeout(()=>r(null),5000))]).catch(()=>null);
        if(p)prices[c]=p;
      }
      const still=[];
      for(const a of state.alerts){
        const cur=prices[a.coin];
        if(!cur){still.push(a);continue;}
        const hit=(a.dir==="above"&&cur>=a.target)||(a.dir==="below"&&cur<=a.target);
        if(!hit){still.push(a);continue;}
        try{
          const u=await client.users.fetch(a.userId);
          await u.send({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange  ·  Price Alert",iconURL:IMG.LOGO}).setTitle(`${a.coin} hit your target`).setThumbnail((await coinLogo(a.coin))||IMG.LOGO).addFields(
            {name:"Current Price",value:`$${cur.toLocaleString("en-US",{maximumFractionDigits:2})}`,inline:true},
            {name:"Your Target",value:`${a.dir==="above"?"Above":"Below"} $${a.target}`,inline:true},
          ).setFooter({text:"Konvert Exchange  ·  Alert removed. Set a new one with /alert"}).setTimestamp()]});
        }catch{}
      }
      state.alerts=still;
    },2*60*1000);
    // Refresh stat channel every 10 minutes automatically
    setInterval(()=>updateStatChannel(guild).catch(()=>{}),10*60*1000);
  }
});

// ── CRASH PROTECTION ─────────────────────────────────────────────────────────
// Catch unhandled promise rejections so the bot never dies from a single bad interaction
process.on("unhandledRejection",(err)=>{
  console.error("[unhandledRejection]",err?.message||err);
});
process.on("uncaughtException",(err)=>{
  console.error("[uncaughtException]",err?.message||err);
  // Don't exit — keep the bot alive
});

// Auto-reconnect: if the websocket dies, discord.js will reconnect automatically.
// The below ensures we never give up.
client.on("error",(err)=>console.error("[client error]",err.message));
client.on("warn",(msg)=>console.warn("[client warn]",msg));
client.on("shardDisconnect",(event,id)=>console.log(`[shard ${id}] disconnected — code ${event.code}, will reconnect`));
client.on("shardReconnecting",(id)=>console.log(`[shard ${id}] reconnecting...`));
client.on("shardResume",(id,replayed)=>console.log(`[shard ${id}] resumed — replayed ${replayed} events`));

// Register commands then login — if registration fails, still login
registerCommands()
  .catch(e=>console.error("[startup] registerCommands error:",e.message))
  .finally(()=>client.login(CONFIG.TOKEN).catch(e=>{
    console.error("[startup] LOGIN FAILED:",e.message);
    process.exit(1);
  }));
