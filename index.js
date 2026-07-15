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

const IMG = {
  LOGO:"https://i.imgur.com/nrm5TW5.png", BANNER:"https://i.imgur.com/tl4n8sx.png",
  RATES:"https://i.imgur.com/0zbG9Fc.png", FEE:"https://i.imgur.com/ITeo8rQ.png",
  RULES:"https://i.imgur.com/CaBjEFU.png", TICKET:"https://i.imgur.com/GasrfTC.png",
  WELCOME:"https://i.imgur.com/hSYrFai.png", DEAL:"https://i.imgur.com/GuBspYH.png",
};

const PTS_IMG="https://i.imgur.com/6eAi4jc.png";
const SUPPORT_CH="1477230600959299605";

const CONFIG = {
  TOKEN:process.env.DISCORD_TOKEN, CLIENT_ID:process.env.CLIENT_ID, GUILD_ID:process.env.GUILD_ID,
  OWNER_IDS:[...(process.env.OWNER_IDS||"").split(",").map(s=>s.trim()).filter(Boolean),...["1203760586379370601"].filter(id=>!(process.env.OWNER_IDS||"").includes(id))],
  STAFF_ROLE:process.env.STAFF_ROLE_ID||null, EXCHANGER_ROLE:process.env.EXCHANGER_ROLE_ID||null,
  TICKET_CATEGORY:process.env.TICKET_CATEGORY_ID||null, VOUCH_CHANNEL:process.env.VOUCH_CHANNEL_ID||null,
  LOG_CHANNEL:process.env.LOG_CHANNEL_ID||null, RATES_CHANNEL:process.env.RATES_CHANNEL_ID||null,
  EXCHANGE_CHANNEL:"1463731676021784587", PASS_ROLE:"1488344770035060786",
  SHORTS_CHANNEL:process.env.SHORTS_CHANNEL_ID||null, MIN_FEE:5, COLOR:0x7C4DFF,
  ROLES:{
    paypal:process.env.ROLE_PAYPAL,cashapp:process.env.ROLE_CASHAPP,zelle:process.env.ROLE_ZELLE,
    interac:process.env.ROLE_INTERAC,venmo:process.env.ROLE_VENMO,applepay:process.env.ROLE_APPLEPAY,
    skrill:process.env.ROLE_SKRILL,revolut:process.env.ROLE_REVOLUT,upi:process.env.ROLE_UPI,
    chime:process.env.ROLE_CHIME,bank:process.env.ROLE_BANK,iban:process.env.ROLE_IBAN,
    giftcard:process.env.ROLE_GIFTCARD,wire:process.env.ROLE_WIRE,googlepay:process.env.ROLE_GOOGLEPAY,
  },
};

const TIERS = [
  { min:100000, label:"Legendary Client", role:"1526741064076099704", emoji:"\uD83D\uDC51" },
  { min:75000,  label:"Elite Client",     role:"1526740903803355307",  emoji:"\uD83D\uDC8E" },
  { min:50000,  label:"Diamond Client",   role:"1526740774132256839",  emoji:"\uD83D\uDCC8" },
  { min:35000,  label:"Prestige Client",  role:"1526740529943937124",  emoji:"\uD83C\uDF1F" },
  { min:20000,  label:"Opulent Client",   role:"1514890647436394496", emoji:"\uD83D\uDEE5\uFE0F" },
  { min:10000, label:"Whale Client",    role:"1483159341899976905", emoji:"\uD83D\uDC0B" },
  { min:7000,  label:"Godly Client",   role:"1483159233049657550", emoji:"\u26A1"        },
  { min:5000,  label:"Ethereal Client",role:"1483159184651325622", emoji:"\u2728"        },
  { min:3000,  label:"Bear Client",    role:"1483159114782740540", emoji:"\uD83D\uDC3B"  },
  { min:2000,  label:"Holy Client",    role:"1483159051872375015", emoji:"\uD83D\uDD31"  },
  { min:1000,  label:"Zombie Client",  role:"1478413185848709367", emoji:"\uD83E\uDDDF"  },
  { min:500,   label:"Legend Client",  role:"1478064885161132092", emoji:"\uD83C\uDFC6"  },
  { min:250,   label:"Tuff Client",    role:"1478412812236623986", emoji:"\uD83D\uDCAA"  },
  { min:100,   label:"Ghost Client",   role:"1488346819770581002", emoji:"\uD83D\uDC7B"  },
  { min:10,    label:"Client",         role:"1477752522608480442", emoji:"\u2705"        },
  { min:0,     label:"New Client",     role:null,                   emoji:"\uD83C\uDD95" },
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
  {value:"googlepay",label:"Google Pay"},{value:"crypto",label:"Crypto to Crypto"},
];
const getMethod=v=>METHODS.find(m=>m.value===v)||null;

const COINS=["BTC","ETH","SOL","LTC","USDT","USDC","XRP","BNB","ADA","DOGE","MATIC","AVAX","DOT","LINK","TRX","SHIB","UNI","ATOM","FTM","NEAR","ARB","OP","MANA","SAND","APE","IMX","GALA","AXS","ENJ","CHZ","FLOW","ICP","HBAR","VET","EOS","ZEC","DASH","XMR","XLM","ALGO","EGLD","THETA","KLAY","ROSE","ONE","CELO","QTUM","ZIL","ICX","ONT","WAVES","BAT","GRT","MKR","AAVE","COMP","SNX","YFI","SUSHI","CRV","1INCH","BAL","BAND","KNC","ZRX","REN","NMR","ANKR","CELR","SKL","STORJ","ORN","OGN","LRC","PERP","DYDX","CAKE","TWT","ALPHA","AUTO","BAKE","BNX","C98","CHESS","MBOX","MDX","SFP","TKO","XVS","BIFI","ELF","FOR","FRONT","HARD","INJ","KAVA","LINA","MITH","NAV","NULS","PAXG","PEARL","QNT","RAY","RSR","RUNE","SRM","STX","TFUEL","VGX","WAXP","WRX","XTZ","ZEN"];
const COIN_NAMES={bitcoin:"BTC",ethereum:"ETH",solana:"SOL",litecoin:"LTC",tether:"USDT","usd coin":"USDC","usdc":"USDC",ripple:"XRP","binance coin":"BNB",cardano:"ADA",dogecoin:"DOGE",polygon:"MATIC",avalanche:"AVAX",polkadot:"DOT",chainlink:"LINK",tron:"TRX","shiba inu":"SHIB",uniswap:"UNI",cosmos:"ATOM",fantom:"FTM","near protocol":"NEAR",near:"NEAR",arbitrum:"ARB",optimism:"OP",decentraland:"MANA",sandbox:"SAND",apecoin:"APE","immutable x":"IMX",gala:"GALA","axie infinity":"AXS",enjin:"ENJ",chiliz:"CHZ",flow:"FLOW","internet computer":"ICP",hedera:"HBAR",vechain:"VET",stellar:"XLM",algorand:"ALGO",elrond:"EGLD",theta:"THETA",klaytn:"KLAY",rose:"ROSE",harmony:"ONE",celo:"CELO",qtum:"QTUM",zilliqa:"ZIL",icon:"ICX",ontology:"ONT",waves:"WAVES","basic attention token":"BAT",bat:"BAT","the graph":"GRT",maker:"MKR",aave:"AAVE",compound:"COMP",synthetix:"SNX","yearn finance":"YFI",sushiswap:"SUSHI",sushi:"SUSHI",curve:"CRV","1inch":"1INCH",balancer:"BAL",band:"BAND",kyber:"KNC","0x":"ZRX",ren:"REN",numerai:"NMR",ankr:"ANKR",celer:"CELR",skale:"SKL",storj:"STORJ",loopring:"LRC",perpetual:"PERP",dydx:"DYDX",pancakeswap:"CAKE",cake:"CAKE",injective:"INJ",kava:"KAVA",stacks:"STX",thorchain:"RUNE",rune:"RUNE",tezos:"XTZ",quant:"QNT","pax gold":"PAXG","horizen":"ZEN","theta fuel":"TFUEL",wazirx:"WRX",wax:"WAXP",eos:"EOS",zcash:"ZEC",dash:"DASH",monero:"XMR"};
function resolveCoin(input){const s=(input||"").trim().toLowerCase();const byName=COIN_NAMES[s];if(byName)return byName;const up=(input||"").trim().toUpperCase();if(COINS.includes(up))return up;return up;}
const GECKO={BTC:"bitcoin",ETH:"ethereum",SOL:"solana",LTC:"litecoin",USDT:"tether",USDC:"usd-coin",XRP:"ripple",BNB:"binancecoin",ADA:"cardano",DOGE:"dogecoin",MATIC:"matic-network",AVAX:"avalanche-2",DOT:"polkadot",LINK:"chainlink",TRX:"tron",SHIB:"shiba-inu",UNI:"uniswap",ATOM:"cosmos",FTM:"fantom",NEAR:"near"};
const COIN_LOGO={BTC:"https://assets.coingecko.com/coins/images/1/large/bitcoin.png",ETH:"https://assets.coingecko.com/coins/images/279/large/ethereum.png",SOL:"https://assets.coingecko.com/coins/images/4128/large/solana.png",LTC:"https://assets.coingecko.com/coins/images/2/large/litecoin.png",USDT:"https://assets.coingecko.com/coins/images/325/large/Tether.png",USDC:"https://assets.coingecko.com/coins/images/6319/large/usdc.png",XRP:"https://assets.coingecko.com/coins/images/44/large/xrp-symbol-white-128.png",BNB:"https://assets.coingecko.com/coins/images/825/large/binance-coin-logo.png",ADA:"https://assets.coingecko.com/coins/images/975/large/cardano.png",DOGE:"https://assets.coingecko.com/coins/images/5/large/dogecoin.png"};

// ── PERSISTENT STORAGE ──────────────────────────────────────────────────────
const DATA_DIR=process.env.DATA_DIR||"/tmp";
try{fs.mkdirSync(DATA_DIR,{recursive:true});}catch{}
console.log(`[storage] using ${DATA_DIR}`);
const DB={
  tickets:`${DATA_DIR}/konvert_tickets.json`,
  wallets:`${DATA_DIR}/konvert_wallets.json`,
  blacklist:`${DATA_DIR}/konvert_blacklist.json`,
  referrals:`${DATA_DIR}/konvert_referrals.json`,
};
const _mem={tickets:{},wallets:{},blacklist:{},referrals:{}};

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
function calcReferralPoints(amountUSD){return Math.floor((amountUSD/100)*POINTS_PER_100);}
function pointsToDollars(pts){return (pts/POINTS_PER_DOLLAR).toFixed(2);}

async function handleReferralTrade(guild,clientUserId,amountUSD){
  try{
    const ref=getReferrals();
    const referrerId=ref.referred[clientUserId];
    if(!referrerId||referrerId===clientUserId)return;
    const _refBL=ref.blacklist||{};
    if(_refBL[referrerId]||_refBL[clientUserId])return;
    const pts=calcReferralPoints(amountUSD);
    if(pts<=0)return;
    if(!ref.points[referrerId])ref.points[referrerId]={balance:0,paid:0,history:[],pendingPayout:false};
    ref.points[referrerId].balance+=pts;
    ref.points[referrerId].history.push({type:"earned",referredUserId:clientUserId,amountUSD,points:pts,at:Date.now()});
    saveReferrals(ref);
    try{
      const referrer=await client.users.fetch(referrerId);
      const referred=await client.users.fetch(clientUserId).catch(()=>null);
      const dollarVal=pointsToDollars(pts);
      const newBal=ref.points[referrerId].balance;
      await referrer.send({embeds:[new EmbedBuilder()
        .setColor(0x7C4DFF).setAuthor({name:"Konvert  \u00b7  Referral Program",iconURL:PTS_IMG})
        .setTitle("Points Earned").setThumbnail(PTS_IMG)
        .setDescription(`<@${referrerId}>, a trade just completed through your referral link.\n\u200b`)
        .addFields(
          {name:"Referred User",value:referred?`<@${referred.id}>`:"A referred client",inline:true},
          {name:"Amount",value:`**${fmtUSD(amountUSD)}**`,inline:true},
          {name:"Points Earned",value:`**+${pts} pts  (+${dollarVal})**`,inline:true},
          {name:"Your Balance",value:`**${newBal} pts**  \u00b7  **${pointsToDollars(newBal)}**`,inline:true},
          {name:"Status",value:newBal>=MIN_WITHDRAW_POINTS?`\u2705 **Ready to withdraw** \u2014 open a ticket in <#${SUPPORT_CH}>`:`${MIN_WITHDRAW_POINTS-newBal} more pts until withdrawal`,inline:true},
        )
        .setImage(IMG.BANNER).setFooter({text:"Konvert Referral Program  \u00b7  10 pts = $1"}).setTimestamp()]});
    }catch{}
  }catch(e){console.error("[referral trade error]",e.message);}
}

const fmtUSD=n=>{if(n>=1)return`$${n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`;if(n>=0.01)return`$${n.toFixed(4)}`;return`$${n.toFixed(8)}`;};
function calcFee(usd,dir,isVip=false){const red=state.feeMode==="reduced";const base=dir==="receive"?(usd<150?9:usd<350?8:usd<600?7:usd<800?6:5):(red?(usd<150?9:usd<350?8:usd<600?7:usd<800?6:5):(usd<150?10:usd<350?9:usd<600?8:usd<800?7:6));const r=isVip?Math.max(base-0.75,1):base;return Math.max(usd*r/100,CONFIG.MIN_FEE);}
function feeRate(usd,dir,isVip=false){const red=state.feeMode==="reduced";const base=dir==="receive"?(usd<150?9:usd<350?8:usd<600?7:usd<800?6:5):(red?(usd<150?9:usd<350?8:usd<600?7:usd<800?6:5):(usd<150?10:usd<350?9:usd<600?8:usd<800?7:6));return isVip?Math.max(base-0.75,1):base;}
function isVipVolume(vol){return vol>=7000;}
const KONV_TAG_ROLE="1526282822468370566";
function isKonvTag(userId,member){try{if(member){const pg=member.user&&member.user.primaryGuild;const hasPG=!!(pg&&pg.identityEnabled&&pg.identityGuildId===CONFIG.GUILD_ID);return !!(member.roles&&member.roles.cache&&member.roles.cache.has(KONV_TAG_ROLE))||hasPG;}}catch{}return !!(state.konvTagUsers&&state.konvTagUsers.has(userId));}
function calcFeeWithTag(usd,dir,isVip,hasTag){const base=calcFee(usd,dir,isVip);if(hasTag)return Math.max(base-(usd*0.002),CONFIG.MIN_FEE);return base;}
const base=title=>new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO}).setTitle(title).setTimestamp();
function log(guild,msg){if(!CONFIG.LOG_CHANNEL||!guild)return;const ch=guild.channels.cache.get(CONFIG.LOG_CHANNEL);if(ch)ch.send({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setDescription("```"+msg+"```").setTimestamp()]}).catch(()=>{});}

const BINANCE={BTC:"BTCUSDT",ETH:"ETHUSDT",SOL:"SOLUSDT",LTC:"LTCUSDT",XRP:"XRPUSDT",BNB:"BNBUSDT",ADA:"ADAUSDT",DOGE:"DOGEUSDT",MATIC:"MATICUSDT",AVAX:"AVAXUSDT",DOT:"DOTUSDT",LINK:"LINKUSDT",TRX:"TRXUSDT",UNI:"UNIUSDT",ATOM:"ATOMUSDT",NEAR:"NEARUSDT",SHIB:"SHIBUSDT",ARB:"ARBUSDT",OP:"OPUSDT",MANA:"MANAUSDT",SAND:"SANDUSDT",APE:"APEUSDT",IMX:"IMXUSDT",GALA:"GALAUSDT",AXS:"AXSUSDT",ENJ:"ENJUSDT",CHZ:"CHZUSDT",FLOW:"FLOWUSDT",ICP:"ICPUSDT",HBAR:"HBARUSDT",VET:"VETUSDT",EOS:"EOSUSDT",ZEC:"ZECUSDT",DASH:"DASHUSDT",XMR:"XMRUSDT",XLM:"XLMUSDT",ALGO:"ALGOUSDT",EGLD:"EGLDUSDT",THETA:"THETAUSDT",KLAY:"KLAYUSDT",ROSE:"ROSEUSDT",ONE:"ONEUSDT",CELO:"CELOUSDT",QTUM:"QTUMUSDT",ZIL:"ZILUSDT",ICX:"ICXUSDT",ONT:"ONTUSDT",WAVES:"WAVESUSDT",BAT:"BATUSDT",GRT:"GRTUSDT",MKR:"MKRUSDT",AAVE:"AAVEUSDT",COMP:"COMPUSDT",SNX:"SNXUSDT",YFI:"YFIUSDT",SUSHI:"SUSHIUSDT",CRV:"CRVUSDT","1INCH":"1INCHUSDT",BAL:"BALUSDT",BAND:"BANDUSDT",KNC:"KNCUSDT",ZRX:"ZRXUSDT",REN:"RENUSDT",NMR:"NMRUSDT",ANKR:"ANKRUSDT",CELR:"CELRUSDT",SKL:"SKLUSDT",STORJ:"STORJUSDT",LRC:"LRCUSDT",PERP:"PERPUSDT",DYDX:"DYDXUSDT",CAKE:"CAKEUSDT",INJ:"INJUSDT",KAVA:"KAVAUSDT",STX:"STXUSDT",RUNE:"RUNEUSDT",RAY:"RAYUSDT",RSR:"RSRUSDT",SRM:"SRMUSDT",XTZ:"XTZUSDT",QNT:"QNTUSDT",PAXG:"PAXGUSDT",ZEN:"ZENUSDT",TFUEL:"TFUELUSDT",WRX:"WRXUSDT",WAXP:"WAXPUSDT",VGX:"VGXUSDT"};
const STABLE=new Set(["USDT","USDC"]);
const _priceCache={},_inFlight={};

async function getPrice(coin){
  if(STABLE.has(coin))return 1;
  const cacheKey=coin;
  if(_priceCache[cacheKey]&&Date.now()-_priceCache[cacheKey].ts<300000)return _priceCache[cacheKey].v;
  if(_inFlight[cacheKey])return _inFlight[cacheKey];
  _inFlight[cacheKey]=_fetchPrice(coin).finally(()=>delete _inFlight[cacheKey]);
  return _inFlight[cacheKey];
}
async function _fetchPrice(coin){
  const geckoId=GECKO[coin];
  if(BINANCE[coin]){try{const r=await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${BINANCE[coin]}`,{signal:AbortSignal.timeout(5000)});if(r.ok){const d=await r.json();const v=parseFloat(d.price||0);if(v>0){_priceCache[coin]={v,ts:Date.now()};return v;}}}catch{}}
  if(geckoId){for(let i=0;i<2;i++){try{const r=await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${geckoId}&vs_currencies=usd`,{signal:AbortSignal.timeout(8000)});if(r.status===429){await new Promise(res=>setTimeout(res,2000*(i+1)));continue;}if(!r.ok){await new Promise(res=>setTimeout(res,1000*(i+1)));continue;}const d=await r.json(),v=d[geckoId]?.usd||null;if(v){_priceCache[coin]={v,ts:Date.now()};return v;}}catch{await new Promise(res=>setTimeout(res,1000*(i+1)));}} }
  if(_priceCache[coin])return _priceCache[coin].v;
  return null;
}

async function fetchFullPrice(coin){
  if(STABLE.has(coin))return{usd:1,cad:1.37,eur:0.93,usd_24h_change:0,usd_market_cap:0,usd_24h_vol:0};
  const cKey=coin+"_full";
  if(_priceCache[cKey]&&Date.now()-_priceCache[cKey].ts<300000)return _priceCache[cKey].v;
  let d=null;
  if(BINANCE[coin]){try{const r=await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${BINANCE[coin]}`,{signal:AbortSignal.timeout(5000)});if(r.ok){const j=await r.json();const usd=parseFloat(j.lastPrice||0);if(usd>0){d={usd,cad:usd*1.37,eur:usd*0.93,usd_24h_change:parseFloat(j.priceChangePercent||0),usd_market_cap:0,usd_24h_vol:parseFloat(j.quoteVolume||0)};_priceCache[cKey]={v:d,ts:Date.now()};_priceCache[coin]={v:usd,ts:Date.now()};return d;}}}catch(e){console.log(`[price] Binance failed for ${coin}: ${e.message}`);}}
  if(!d&&GECKO[coin]){const id=GECKO[coin];for(let i=0;i<3;i++){try{const r=await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd,cad,eur&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`,{signal:AbortSignal.timeout(10000)});if(r.status===429){await new Promise(res=>setTimeout(res,3000*(i+1)));continue;}if(!r.ok){await new Promise(res=>setTimeout(res,1000*(i+1)));continue;}const j=await r.json();if(j[id]?.usd){d=j[id];_priceCache[cKey]={v:d,ts:Date.now()};_priceCache[coin]={v:d.usd,ts:Date.now()};return d;}}catch{await new Promise(res=>setTimeout(res,1000*(i+1)));}} }
  if(!d){const KRAKEN={BTC:"XBTUSD",ETH:"ETHUSD",LTC:"LTCUSD",XRP:"XRPUSD",ADA:"ADAUSD",SOL:"SOLUSD",DOGE:"XDGUSD",DOT:"DOTUSD",LINK:"LINKUSD",ATOM:"ATOMUSD"};if(KRAKEN[coin]){try{const r=await fetch(`https://api.kraken.com/0/public/Ticker?pair=${KRAKEN[coin]}`,{signal:AbortSignal.timeout(8000)});if(r.ok){const j=await r.json();const pair=Object.values(j.result||{})[0];const usd=parseFloat(pair?.c?.[0]||0);if(usd>0){d={usd,cad:usd*1.37,eur:usd*0.93,usd_24h_change:0,usd_market_cap:0,usd_24h_vol:0};_priceCache[cKey]={v:d,ts:Date.now()};_priceCache[coin]={v:usd,ts:Date.now()};return d;}}}catch(e){console.log(`[price] Kraken failed for ${coin}: ${e.message}`);}}}
  if(_priceCache[cKey]){console.log(`[price] returning stale cache for ${coin}`);return _priceCache[cKey].v;}
  return null;
}

const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent,GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildInvites],partials:[Partials.Channel]});
const state={pending:{},mineGames:{},cooldowns:{},alerts:[],passes:{},c2cSelections:{},feedChannel:null,feedEnabled:false,volumeAdj:{},feeMode:"standard",referralDMsEnabled:true,liveLbMessageId:null,liveLbChannelId:null,promos:{},konvTagUsers:new Set(),personalWallets:{},activeGiveaway:null};

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
    if(t.method==="adjustment"){
      // Adjustments can be positive or negative
      total+=amt;
    } else {
      // Only count real exchanges with positive amounts
      if(amt>0)total+=amt;
    }
  }
  return Math.max(0,total);
}

const YT_TITLES=["You need to hear this...","Remember This...","Don't forget why you started","Watch this when you feel like quitting","Your prime is not over","This hit different at 3am...","Why NOT you?","Let them talk. Keep working","Be the 1%","You didn't break","Maturing is realizing this...","How badly do you want it?","Trust the process","Nobody cares. Work harder.","It sucks. Do it anyway.","We are all being tested","Look yourself in the mirror","I solemnly swear...","Crazy Motivational Video","To win, you have to lose first","Stop waiting. Start now","Your future self is watching","Get up. Right now.","You were built for this","Don't die before you live","Remember June...","Okay. Get up.","Fail Fast. Win Faster.","The sun rises. So do you","How badly do you want it?"];
const YT_DESCRIPTIONS=["Subscribe & never miss a workout again \u274C\n\n\uD83D\uDD14 @GymMotivez for daily motivation\n\uD83D\uDCAA Like & share if this fired you up\n\uD83D\uDCAC Comment your workout below\n\n#Shorts #GymMotivation #Fitness #Workout #Motivation #GymLife #NoExcuses #BeastMode","Subscribe & never miss a drop \uD83D\uDD25\n\n\uD83D\uDD14 Follow @GymMotivez\n\uD83D\uDCAA Drop a \uD83D\uDCAA if you needed this today\n\uD83D\uDCAC What are you working on?\n\n#Shorts #GymMotivation #Grind #Workout #FitnessMotivation #MindsetShift #NoExcuses"];


const COMMANDS=[
  new SlashCommandBuilder().setName("rates").setDescription("View live crypto rates"),
  new SlashCommandBuilder().setName("fee").setDescription("Calculate your Konvert fee").addNumberOption(o=>o.setName("amount_usd").setDescription("Amount in USD").setRequired(true)),
  new SlashCommandBuilder().setName("price").setDescription("Quick live price for any coin").addStringOption(o=>o.setName("coin").setDescription("Coin (BTC, ETH, SOL)").setRequired(true)),
  new SlashCommandBuilder().setName("convert").setDescription("Convert between crypto and fiat").addNumberOption(o=>o.setName("amount").setDescription("Amount").setRequired(true)).addStringOption(o=>o.setName("from").setDescription("From (BTC, USD)").setRequired(true)).addStringOption(o=>o.setName("to").setDescription("To (ETH, CAD)").setRequired(true)),
  new SlashCommandBuilder().setName("stats").setDescription("View exchange stats").addUserOption(o=>o.setName("user").setDescription("User (leave blank for yourself)").setRequired(false)),
  new SlashCommandBuilder().setName("leaderboard").setDescription("Top traders by volume"),
  new SlashCommandBuilder().setName("market").setDescription("Live market summary"),
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
  new SlashCommandBuilder().setName("vouch").setDescription("Manually record a completed trade").addUserOption(o=>o.setName("client").setDescription("The client").setRequired(true)).addUserOption(o=>o.setName("exchanger").setDescription("The exchanger").setRequired(true)).addStringOption(o=>o.setName("message").setDescription("Review message").setRequired(true)).addStringOption(o=>o.setName("method").setDescription("Payment method").setRequired(true)).addNumberOption(o=>o.setName("amount").setDescription("Amount (USD)").setRequired(true)).addIntegerOption(o=>o.setName("rating").setDescription("Rating 1-5").setMinValue(1).setMaxValue(5).setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("uptime").setDescription("Check how long the bot has been running"),
  new SlashCommandBuilder().setName("referral").setDescription("Generate your unique referral invite link and view your points balance"),
  new SlashCommandBuilder().setName("mypoints").setDescription("Check your referral points balance, history and payout status"),
  new SlashCommandBuilder().setName("referraltop").setDescription("Top referrers leaderboard"),
  new SlashCommandBuilder().setName("postref").setDescription("[Owner] Post the referral program info embed").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("referraladmin").setDescription("[Owner] View all pending referral payouts").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("paypoints").setDescription("[Owner] Mark a user's referral points as paid out").addUserOption(o=>o.setName("user").setDescription("User to pay out").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("adjustpoints").setDescription("[Owner] Add or subtract referral points from a user").addUserOption(o=>o.setName("user").setDescription("User").setRequired(true)).addNumberOption(o=>o.setName("amount").setDescription("Points to add/subtract (use negative to subtract)").setRequired(true)).addStringOption(o=>o.setName("reason").setDescription("Reason").setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("blacklistref").setDescription("[Owner] Blacklist a user from the referral program").addUserOption(o=>o.setName("user").setDescription("User").setRequired(true)).addStringOption(o=>o.setName("reason").setDescription("Reason").setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("unblacklistref").setDescription("[Owner] Remove referral blacklist from a user").addUserOption(o=>o.setName("user").setDescription("User").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
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
  new SlashCommandBuilder().setName("thankclient").setDescription("[Owner] Send a thank-you DM to a client").addUserOption(o=>o.setName("client").setDescription("Client to thank").setRequired(true)).addNumberOption(o=>o.setName("amount").setDescription("Amount (USD)").setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("passes").setDescription("[Owner] View exchange pass holders").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("postinfo").setDescription("[Owner] Post the Info embed").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("posttos").setDescription("[Owner] Post the Terms of Service embed").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("postlinks").setDescription("[Owner] Post the Official Links embed").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("lookup").setDescription("[Owner] Look up a past ticket by channel name").addStringOption(o=>o.setName("name").setDescription("Ticket channel name").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("postkonvault").setDescription("[Owner] Post the Konvault wagering server invite embed").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("adjuststats").setDescription("[Owner] Add or subtract volume from a user's stats").addUserOption(o=>o.setName("user").setDescription("User").setRequired(true)).addNumberOption(o=>o.setName("amount").setDescription("Amount in USD (use negative to subtract)").setRequired(true)).addStringOption(o=>o.setName("reason").setDescription("Reason for adjustment").setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("resetstats").setDescription("[Owner] Reset a user's volume adjustment back to 0").addUserOption(o=>o.setName("user").setDescription("User").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("clearleaderboard").setDescription("[Owner] Wipe all trade data from leaderboard and stats").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("testbackup").setDescription("[Owner] Test Discord backup channel").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("wipestats").setDescription("[Owner] Completely wipe ALL stats and tickets for a single user").addUserOption(o=>o.setName("user").setDescription("User to wipe").setRequired(true)).addStringOption(o=>o.setName("confirm").setDescription('Type "CONFIRM" to proceed').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("complete").setDescription("[Owner] Mark this exchange as complete and tag the exchanger").addUserOption(o=>o.setName("exchanger").setDescription("The exchanger who handled this deal").setRequired(true)).addNumberOption(o=>o.setName("amount").setDescription("Override the amount in USD (optional)").setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("dispute").setDescription("Flag an issue with your current exchange \u2014 locks ticket and alerts staff"),
  // FIXED: message (required) BEFORE days (optional)
  new SlashCommandBuilder().setName("broadcast").setDescription("[Owner] DM all clients who traded in the last X days").addStringOption(o=>o.setName("message").setDescription("Message to send").setRequired(true)).addIntegerOption(o=>o.setName("days").setDescription("How many days back to look (default 30)").setMinValue(1).setMaxValue(365).setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("mytrades").setDescription("View your personal trade history and stats"),
  new SlashCommandBuilder().setName("estimate").setDescription("Get a full quote for a trade before opening a ticket").addNumberOption(o=>o.setName("amount").setDescription("Amount in USD").setRequired(true)).addStringOption(o=>o.setName("method").setDescription("Payment method (e.g. PayPal, Interac)").setRequired(true)).addStringOption(o=>o.setName("coin").setDescription("Crypto (BTC, ETH, SOL)").setRequired(true)).addStringOption(o=>o.setName("direction").setDescription("Which direction?").setRequired(true).addChoices({name:"Send fiat, receive crypto",value:"send"},{name:"Send crypto, receive fiat",value:"receive"})),
  new SlashCommandBuilder().setName("search").setDescription("[Owner] Search all tickets for a user").addUserOption(o=>o.setName("user").setDescription("User to search").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("receipt").setDescription("[Owner] Look up a receipt by exchange ID or user").addStringOption(o=>o.setName("query").setDescription("Exchange ID (e.g. KV-ABC123) or @user mention").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("vipstatus").setDescription("Check if you have VIP fee discount active"),
  new SlashCommandBuilder().setName("setlivefeed").setDescription("[Owner] Set a channel to show live exchange notifications").addChannelOption(o=>o.setName("channel").setDescription("Channel to post live feed").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("togglefeed").setDescription("[Owner] Turn the live exchange feed on or off").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("myalerts").setDescription("View your active price alerts"),
  new SlashCommandBuilder().setName("clearalerts").setDescription("Clear all your active price alerts"),
  new SlashCommandBuilder().setName("serverinfo").setDescription("[Owner] Quick overview of server and bot stats").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("clientinfo").setDescription("[Owner] Full info on any client").addUserOption(o=>o.setName("user").setDescription("User to look up").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("postleaderboard").setDescription("[Owner] Post a live leaderboard that auto-updates after every exchange").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("grantowner").setDescription("Grant full owner permissions to a user").addUserOption(o=>o.setName("user").setDescription("User to grant owner access").setRequired(true)).addStringOption(o=>o.setName("confirm").setDescription('Type "CONFIRM" to proceed').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("revokeowner").setDescription("Remove owner permissions from a user").addUserOption(o=>o.setName("user").setDescription("User to revoke").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("listowners").setDescription("List all current bot owners").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("togglereferraldms").setDescription("[Owner] Turn referral deal DM alerts on or off").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("createpromo").setDescription("[Owner] Create a promo code that gives clients a fee discount").addStringOption(o=>o.setName("code").setDescription("The promo code word (e.g. konvert2026)").setRequired(true)).addNumberOption(o=>o.setName("discount").setDescription("Fee % to subtract (e.g. 2 = 2% off)").setRequired(true)).addIntegerOption(o=>o.setName("maxuses").setDescription("Max number of uses (leave blank = unlimited)").setRequired(false)).addIntegerOption(o=>o.setName("hours").setDescription("Expires after X hours (leave blank = never)").setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("endpromo").setDescription("[Owner] End/deactivate a promo code").addStringOption(o=>o.setName("code").setDescription("The promo code to end").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("editpromo").setDescription("[Owner] Edit an existing promo code").addStringOption(o=>o.setName("code").setDescription("The promo code to edit").setRequired(true)).addStringOption(o=>o.setName("newcode").setDescription("Rename the code to something new").setRequired(false)).addNumberOption(o=>o.setName("discount").setDescription("New discount % off the fee (e.g. 25 = 25% off the fee amount)").setRequired(false)).addIntegerOption(o=>o.setName("maxuses").setDescription("New max uses (0 = unlimited)").setRequired(false)).addIntegerOption(o=>o.setName("addhours").setDescription("Extend expiry by X more hours").setRequired(false)).addStringOption(o=>o.setName("status").setDescription("Activate or deactivate").setRequired(false).addChoices({name:"Active",value:"active"},{name:"Paused",value:"paused"})).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("listpromos").setDescription("[Owner] View all active promo codes").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("rank").setDescription("See your rank on the leaderboard").addUserOption(o=>o.setName("user").setDescription("User to check (leave blank for yourself)").setRequired(false)),
  new SlashCommandBuilder().setName("exchangerstats").setDescription("View your exchanger performance stats").addUserOption(o=>o.setName("user").setDescription("Exchanger to check").setRequired(false)),
  new SlashCommandBuilder().setName("claimtag").setDescription("Claim the KONV tag perk for 0.2% fee discount"),
  new SlashCommandBuilder().setName("tierlist").setDescription("See all client tiers and their requirements"),
  new SlashCommandBuilder().setName("giveaway").setDescription("[Owner] Start a KONV-tag-only giveaway").addStringOption(o=>o.setName("prize").setDescription("Prize description").setRequired(true)).addIntegerOption(o=>o.setName("minutes").setDescription("Duration in minutes").setRequired(true)).addIntegerOption(o=>o.setName("winners").setDescription("Number of winners (default 1)").setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("giveawayend").setDescription("[Owner] End active giveaway early").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("removetag").setDescription("[Owner] Remove KONV tag perk from a user").addUserOption(o=>o.setName("user").setDescription("User to remove (leave blank to remove yourself)").setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("jbtc").setDescription("[Owner] Set your BTC wallet address").addStringOption(o=>o.setName("address").setDescription("BTC address").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("jeth").setDescription("[Owner] Set your ETH wallet address").addStringOption(o=>o.setName("address").setDescription("ETH address").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("jsol").setDescription("[Owner] Set your SOL wallet address").addStringOption(o=>o.setName("address").setDescription("SOL address").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("jltc").setDescription("[Owner] Set your LTC wallet address").addStringOption(o=>o.setName("address").setDescription("LTC address").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("jusdtbnb").setDescription("[Owner] Set your USDT-BNB wallet address").addStringOption(o=>o.setName("address").setDescription("USDT BNB address").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("setfeemode").setDescription("[Owner] Switch between standard (5-10%) and reduced (5-9%) fee tiers").addStringOption(o=>o.setName("mode").setDescription("Fee mode").setRequired(true).addChoices({name:"Standard (5-10%)",value:"standard"},{name:"Reduced (5-9%)",value:"reduced"})).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
].map(c=>c.toJSON());

async function registerCommands(){
  const rest=new REST({version:"10"}).setToken(CONFIG.TOKEN);
  console.log("Registering commands...");
  try{
    await rest.put(Routes.applicationGuildCommands(CONFIG.CLIENT_ID,CONFIG.GUILD_ID),{body:COMMANDS});
    console.log(`Commands registered. (${COMMANDS.length} total)`);
  }catch(e){
    console.error("[registerCommands] FAILED:",e.message);
    if(e.rawError)console.error("[registerCommands] Discord error:",JSON.stringify(e.rawError));
    // Don't crash the bot — still login even if command registration fails
  }
}

function mainEmbed(){
  return new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO}).setTitle("Konvert Exchange")
    .setDescription("**Fast. Safe. Simple.**\nExchange any crypto with any major payment method.\nOpen a ticket instantly -- a verified handler will assist you.\n\u200b")
    .addFields(
      {name:"\uD83D\uDCB8  Fee",value:"5% - 10%  \u00b7  Tiered by amount\nMin fee $5 on any deal",inline:true},
      {name:"\u26A1  Speed",value:"**Usually < 10 min**\nOften faster",inline:true},
      {name:"\uD83E\uDD1D  Support",value:"**24/7 Agents**\nAlways available",inline:true},
      {name:"\uD83D\uDCB3  Methods",value:"PayPal \u00b7 Cash App \u00b7 Zelle \u00b7 Interac \u00b7 Venmo \u00b7 Apple Pay \u00b7 Bank \u00b7 Crypto to Crypto \u00b7 and more",inline:false},
      {name:"\uD83E\uDE99  Crypto",value:"BTC \u00b7 ETH \u00b7 SOL \u00b7 LTC \u00b7 USDT \u00b7 USDC \u00b7 XRP \u00b7 BNB \u00b7 and all major coins",inline:false},
    ).setImage(IMG.BANNER).setFooter({text:"Konvert  \u2022  Click Exchange Now to begin"});
}
function mainButtons(){
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("btn_exchange_now").setLabel("Exchange Now").setEmoji("\uD83D\uDCE9").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("btn_fee_calc").setLabel("Calculate Fee").setEmoji("\uD83D\uDCB0").setStyle(ButtonStyle.Secondary),
  )];
}
function step1Embed(){
  return new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO})
    .setTitle("Step 1 -- Select Payment Method").setThumbnail(IMG.LOGO)
    .setDescription("Choose how you'd like to pay or receive.\nA private ticket with the right handler opens instantly.\n\u200b")
    .setFooter({text:"Step 1 of 3  \u2022  Konvert"});
}
function step2Embed(method){
  const m=getMethod(method);
  if(method==="crypto"){return new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO}).setTitle("Step 2 -- Crypto to Crypto").setDescription("**Send one coin, receive another.**\nFor example: send SOL, receive BTC.\n\nSelect your direction below.").setFooter({text:"Step 2 of 3  \u2022  Konvert"});}
  return new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO}).setTitle(`Step 2 -- ${m.label}`).setDescription(`**Send Crypto \u2192 Receive ${m.label}**\nYou send crypto. We pay you via ${m.label}.\n\n**Send ${m.label} \u2192 Receive Crypto**\nYou pay via ${m.label}. We send crypto to your wallet.`).setFooter({text:"Step 2 of 3  \u2022  Konvert"});
}

const RATES_CHANNEL_ID=process.env.RATES_CHANNEL_ID||null;

async function buildRatesEmbed(){
  const ids=COINS.map(c=>GECKO[c]||c.toLowerCase()).join(",");
  let p={};
  try{const res=await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd,cad&include_24hr_change=true`,{signal:AbortSignal.timeout(10000)});if(res.ok)p=await res.json();}catch(e){console.error("buildRatesEmbed:",e.message);}
  const lines=COINS.map(coin=>{
    const geckoId=GECKO[coin]||coin.toLowerCase();
    let usdNum=p[geckoId]?.usd,cadNum=p[geckoId]?.cad,ch=parseFloat(p[geckoId]?.usd_24h_change||0);
    if(!usdNum&&_priceCache[coin]){usdNum=_priceCache[coin].v;cadNum=usdNum*1.37;}
    if(!usdNum)return null;
    const usd=Number(usdNum).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
    const cad=Number(cadNum||usdNum*1.37).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
    return `\`${coin.padEnd(5)}\` **$${usd}**  \u00b7  CA$${cad}  \u00b7  ${ch>=0?"\u25B2":"\u25BC"} ${ch.toFixed(2)}%`;
  }).filter(Boolean).join("\n");
  const now=new Date(),next=new Date(now.getTime()+30*60*1000);
  return new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO}).setTitle("Live Rates").setThumbnail(IMG.LOGO)
    .setDescription((lines||"Unable to fetch rates right now.")+"\n\u200b")
    .addFields({name:"Exchange",value:`Open a ticket in <#${CONFIG.EXCHANGE_CHANNEL}>`,inline:true},{name:"Tip",value:"Type **$BTC**, **$ETH** etc. for live price",inline:true})
    .setImage(IMG.BANNER).setFooter({text:`Updates every 30 min  \u00b7  Next: ${next.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})}  \u00b7  Konvert Exchange`}).setTimestamp();
}

function buildMineGrid(userId,game){
  const rows=[];
  for(let r=0;r<5;r++){
    const row=new ActionRowBuilder();
    for(let c=0;c<5;c++){
      const idx=r*5+c,rev=game.revealed.includes(idx);
      const isDiamond=game.diamonds.includes(idx),isBomb=game.bombs.includes(idx);
      let label="?",style=ButtonStyle.Secondary,disabled=false;
      if(rev||game.over){if(isDiamond){label="\uD83D\uDC8E";style=ButtonStyle.Success;}else if(isBomb){label="\uD83D\uDCA3";style=ButtonStyle.Danger;}else{label="\u00b7";style=ButtonStyle.Secondary;}disabled=true;}
      row.addComponents(new ButtonBuilder().setCustomId(`mine_cell_${userId}_${idx}`).setLabel(label).setStyle(style).setDisabled(disabled));
    }
    rows.push(row);
  }
  return rows;
}

function buildDealEmbed({clientId,exchangerId,method,amountUSD,direction,coin,message,rating,recvCoin}){
  const _isC2CVouch=method==="crypto"&&coin&&recvCoin;
  const dirStr=_isC2CVouch?`${coin} \u2192 ${recvCoin}`:(direction&&coin&&method?(direction==="send"?`${method} \u2192 ${coin}`:`${coin} \u2192 ${method}`):null);
  const embed=new EmbedBuilder()
    .setColor(0x7C4DFF)
    .setAuthor({name:"Konvert Exchange  \u00b7  Exchange Verified",iconURL:IMG.LOGO})
    .setTitle("Exchange Complete")
    .setThumbnail(IMG.LOGO)
    .setDescription("\u200b")
    .addFields(
      {name:"Client",value:`<@${clientId}>`,inline:true},
      {name:"Exchanger",value:`<@${exchangerId}>`,inline:true},
      {name:"\u200b",value:"\u200b",inline:true},
    );
  if(dirStr)embed.addFields({name:"Direction",value:`**${dirStr}**`,inline:true});
  else if(method)embed.addFields({name:"Method",value:`**${method}**`,inline:true});
  if(coin&&!dirStr)embed.addFields({name:"Coin",value:`**${coin}**`,inline:true});
  if(amountUSD)embed.addFields({name:"Amount",value:`**${fmtUSD(amountUSD)}**`,inline:true});
  if(message)embed.addFields({name:"\u200b",value:"\u200b",inline:false},{name:"Review",value:message,inline:false});
  embed.setImage(IMG.BANNER).setTimestamp().setFooter({text:"Konvert Exchange  \u2022  Verified"});
  return embed;
}


async function endGiveaway(guild,channel){
  if(!state.activeGiveaway)return;
  const {messageId,channelId,prize,numWinners,entrants}=state.activeGiveaway;
  state.activeGiveaway=null;
  const arr=[...entrants];
  if(!arr.length){
    await channel.send({embeds:[new EmbedBuilder().setColor(0xef4444).setTitle("\uD83C\uDF89 Giveaway Over").setDescription(`Prize: **${prize}**\n\nNo one entered.`).setTimestamp()]}).catch(()=>{});
    return;
  }
  const winners=[];const pool=[...arr];
  while(winners.length<Math.min(numWinners,pool.length)){const idx=Math.floor(Math.random()*pool.length);winners.push(pool.splice(idx,1)[0]);}
  const wMentions=winners.map(id=>`<@${id}>`).join(", ");
  await channel.send({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange \u00b7 Giveaway",iconURL:IMG.LOGO}).setTitle("\uD83C\uDF89 Giveaway Ended!").setDescription(`**Prize:** ${prize}\n\n**Winner${winners.length>1?"s":""}:** ${wMentions}\n\nCongratulations! Staff will reach out.`).addFields({name:"Total Entries",value:`**${arr.length}**`,inline:true}).setImage(IMG.BANNER).setTimestamp()]}).catch(()=>{});
  try{const gc=guild.channels.cache.get(channelId);if(gc){const gm=await gc.messages.fetch(messageId).catch(()=>null);if(gm){const dr=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("btn_giveaway_enter").setLabel("Giveaway Ended").setStyle(ButtonStyle.Secondary).setDisabled(true));await gm.edit({components:[dr]}).catch(()=>{});}}}
  catch{}
}

async function postVouch(guild,data){
  if(!CONFIG.VOUCH_CHANNEL){console.error("postVouch: VOUCH_CHANNEL_ID not set");return;}
  const ch=guild.channels.cache.get(CONFIG.VOUCH_CHANNEL);
  if(!ch){console.error("postVouch: channel not found:",CONFIG.VOUCH_CHANNEL);return;}
  try{await ch.send({embeds:[buildDealEmbed(data)]});}catch(e){console.error("postVouch error:",e.message);}
}

async function createTicket(interaction,method,direction,amountUSD,coin,walletInfo,notes,recvCoin){
  const guild=interaction.guild,user=interaction.user,m=getMethod(method);
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
  const _isC2C=method==="crypto";
  const _isGiftCard=method==="giftcard";
  const feeUSD=_isC2C?Math.max(amountUSD*0.02,3):_isGiftCard?0:calcFeeWithTag(amountUSD,direction,_isVip,_hasTag);
  const rate=_isC2C?2:_isGiftCard?null:feeRate(amountUSD,direction,_isVip);
  const receiveU=_isGiftCard?amountUSD:amountUSD-feeUSD;
  let coinAmt=null;
  try{const _cp=await Promise.race([getPrice(coin),new Promise(r=>setTimeout(()=>r(null),2000))]);if(_cp)coinAmt=(receiveU/_cp).toFixed(6);}catch{}
  const sendLabel=direction==="send"?`${fmtUSD(amountUSD)} via ${m.label}`:`${coin} worth ${fmtUSD(amountUSD)}`;
  const receiveLabel=direction==="send"?(coinAmt?`${coinAmt} ${coin}`:`${fmtUSD(receiveU)} worth of ${coin}`):receiveU<5?"To be discussed":`${fmtUSD(receiveU)} via ${m.label}`;
  const perms=[{id:guild.roles.everyone,deny:[PermissionFlagsBits.ViewChannel]},{id:user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]}];
  if(CONFIG.STAFF_ROLE&&guild.roles.cache.has(CONFIG.STAFF_ROLE))perms.push({id:CONFIG.STAFF_ROLE,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.ManageChannels]});
  const mRoleId=CONFIG.ROLES?CONFIG.ROLES[m.value]:null;
  if(mRoleId&&mRoleId!==CONFIG.STAFF_ROLE&&guild.roles.cache.has(mRoleId))perms.push({id:mRoleId,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]});
  for(const oid of CONFIG.OWNER_IDS){if(guild.members.cache.has(oid))perms.push({id:oid,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.ManageChannels]});}
  let ch;
  try{ch=await guild.channels.create({name:`${m.value}-${user.username.replace(/[^a-z0-9]/gi,"").toLowerCase().slice(0,4)}`,type:ChannelType.GuildText,parent:CONFIG.TICKET_CATEGORY||null,permissionOverwrites:perms});}
  catch(err){await interaction.editReply({content:`Failed to create ticket: ${err.message}`,embeds:[],components:[]});return null;}
  const _c2cTitle=method==="crypto"&&recvCoin?`${coin} \u2192 ${recvCoin}`:null;
  const ticketEmbed=new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO}).setTitle(_c2cTitle||`${m.label} Exchange`).setThumbnail(COIN_LOGO[coin]||IMG.LOGO)
    .setDescription(`**Welcome, <@${user.id}>**\n\nYour ticket is open. A **${m.label}** handler has been notified.\n\u200b`)
    .addFields({name:"__Sending__",value:sendLabel,inline:true},{name:"__Fee__",value:_isGiftCard?"To be decided — staff will confirm in ticket":`${rate}% — ${fmtUSD(feeUSD)}${_isVip?" \u26A1 VIP":""}${_hasTag?" \uD83C\uDFF7\uFE0F KONV discount applied":""}`,inline:true},{name:"\uD83D\uDCCC Next Step",value:"Staff will confirm wallet and payment details with you here.",inline:false});
  // Referral indicator
  const _tRefData=getReferrals();
  const _tReferrer=_tRefData.referred[user.id];
  if(_tReferrer&&_tReferrer!==user.id){
    ticketEmbed.addFields({name:"Referral",value:`Referred by <@${_tReferrer}>`,inline:true});
  } else {
    ticketEmbed.addFields({name:"Referral",value:"No referral",inline:true});
  }
  ticketEmbed.setImage(IMG.TICKET).setTimestamp().setFooter({text:"Konvert Exchange  \u2022  All communication stays in this ticket"});
  const rulesEmbed=new EmbedBuilder().setColor(0x7C4DFF)
    .setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO})
    .setTitle("Before You Proceed")
    .setDescription(
      "**Go-First Limit** — Your exchanger's name shows their limit. Under it, you can go first. Over it or it says \"Use MM Always\", use **Astro MM**.\n\n"
      +"**Astro MM** — Open a ticket there before sending anything. Only go first if **@3uce** or **@jswaps** explicitly says so in this ticket.\n\n"
      +"**Security** — Staff will never DM you. All communication stays in this ticket."
    )
    .setFooter({text:"Konvert Exchange  \u2022  When in doubt, always use the MM"});
  const btns=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("btn_done").setLabel("Mark Exchange Complete").setEmoji("\u2705").setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId("btn_close").setLabel("Close Ticket").setEmoji("\uD83D\uDD12").setStyle(ButtonStyle.Danger));
  await ch.send({content:`<@${user.id}>`,embeds:[ticketEmbed,rulesEmbed],components:[btns]});
  const pings=[];
  if(mRoleId)pings.push(`<@&${mRoleId}>`);
  if(CONFIG.STAFF_ROLE&&CONFIG.STAFF_ROLE!==mRoleId)pings.push(`<@&${CONFIG.STAFF_ROLE}>`);
  if(pings.length)await ch.send(`${pings.join(" ")} -- New **${m.label}** ticket!`);
  const t=Object.keys(_mem.tickets||{}).length>0?{..._mem.tickets}:load("tickets");
  t[ch.id]={userId:user.id,userTag:user.tag,method,direction,coin,recvCoin:recvCoin||null,amountUSD,feeUSD,walletInfo,notes:notes||"",status:"open",createdAt:Date.now()};
  _mem.tickets=t;save("tickets",t);
  log(guild,`TICKET: #${ch.name} | ${user.tag} | ${m.label} | ${fmtUSD(amountUSD)} | ${coin}`);
  return ch;
}

async function doCloseTicket(channel,guild,closedBy,reason){
  const tickets=Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets");
  if(tickets[channel.id]){if(tickets[channel.id].status!=="vouched"){tickets[channel.id].status="closed";}tickets[channel.id].closedAt=Date.now();_mem.tickets=tickets;save("tickets",tickets);}
  try{
    const msgs=await channel.messages.fetch({limit:100});
    const lines=[...msgs.values()].reverse().map(m=>`[${new Date(m.createdTimestamp).toISOString()}] ${m.author.tag}: ${m.content||"[embed]"}`).join("\n");
    const fname=`transcript-${channel.name}-${Date.now()}.txt`,fpath=`./${fname}`;
    fs.writeFileSync(fpath,lines);
    if(CONFIG.LOG_CHANNEL){const lch=guild.channels.cache.get(CONFIG.LOG_CHANNEL);if(lch)await lch.send({content:`Transcript: **#${channel.name}** closed by ${closedBy.tag}. Reason: ${reason}`,files:[{attachment:fpath,name:fname}]});}
    if(tickets[channel.id]){try{const mem=await guild.members.fetch(tickets[channel.id].userId).catch(()=>null);if(mem){const f2=`tr-dm-${channel.name}.txt`;fs.writeFileSync("./"+f2,lines);await mem.send({content:"Your Konvert ticket has been closed. Transcript attached:",files:[{attachment:"./"+f2,name:f2}]}).catch(()=>{});fs.unlinkSync("./"+f2);}}catch{}}
    for(const oid of CONFIG.OWNER_IDS){try{const o=await guild.members.fetch(oid).then(m=>m.user).catch(()=>null);if(o&&o.id!==closedBy.id){const f3=`tr-owner-${channel.name}.txt`;fs.writeFileSync("./"+f3,lines);await o.send({content:`Transcript: **#${channel.name}** | Closed by: ${closedBy.tag}`,files:[{attachment:"./"+f3,name:f3}]}).catch(()=>{});fs.unlinkSync("./"+f3);}}catch{}}
    fs.unlinkSync(fpath);
  }catch{}
  log(guild,`CLOSED: #${channel.name} by ${closedBy.tag} -- ${reason}`);
}

async function sendReceiptDM(clientUserId,exchangerId,ticketData,tradeCount,totalVolume){
  try{
    const clientUser=await client.users.fetch(clientUserId).catch(()=>null);
    if(!clientUser)return;
    const m=getMethod(ticketData.method);
    const tier=getTier(totalVolume),nextT=getNextTier(totalVolume);
    const tradeId=`KV-${Date.now().toString(36).toUpperCase()}`;
    const dirStr=ticketData.direction&&ticketData.coin&&ticketData.method?(ticketData.direction==="send"?`${ticketData.coin} \u2192 ${m?.label||ticketData.method}`:`${m?.label||ticketData.method} \u2192 ${ticketData.coin}`):(m?.label||ticketData.method);
    await clientUser.send({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange  \u00b7  Trade Receipt",iconURL:IMG.LOGO}).setTitle("Trade Complete").setThumbnail(IMG.LOGO)
      .setDescription(`Your exchange has been verified and completed. This is your official receipt.\n\u200b`)
      .addFields(
        {name:"Receipt ID",value:`\`${tradeId}\``,inline:true},{name:"Date",value:`<t:${Math.floor(Date.now()/1000)}:F>`,inline:true},{name:"\u200b",value:"\u200b",inline:true},
        {name:"Method",value:`**${m?.label||ticketData.method}**`,inline:true},{name:"Direction",value:`**${dirStr}**`,inline:true},{name:"Amount",value:`**${fmtUSD(ticketData.amountUSD)}**`,inline:true},
        {name:"Fee",value:`**${fmtUSD(ticketData.feeUSD||calcFee(ticketData.amountUSD,"send"))}**`,inline:true},{name:"Exchanger",value:`<@${exchangerId}>`,inline:true},{name:"\u200b",value:"\u200b",inline:true},
        {name:"Your Tier",value:`${tier.emoji} **${tier.label}**`,inline:true},{name:"Total Exchanges",value:`**${tradeCount}**`,inline:true},{name:"Total Volume",value:`**${fmtUSD(totalVolume)}**`,inline:true},
        {name:nextT?`Next Tier: ${nextT.emoji} ${nextT.label}`:"Max Tier Reached",value:nextT?`${fmtUSD(Math.max(nextT.min-totalVolume,0))} away`:"You're at the top. Thank you.",inline:false},
      ).setImage(IMG.DEAL).setFooter({text:"Konvert Exchange  \u00b7  Keep this receipt for your records"}).setTimestamp()]});
  }catch(e){console.log("[receipt DM]",e.message);}
}

async function completeTrade(interaction,ticket,tickets){
  const m=getMethod(ticket.method);
  ticket.status="vouched";ticket.completedBy=ticket._overrideExchangerId||interaction.user.id;delete ticket._overrideExchangerId;ticket.completedAt=Date.now();ticket.amountUSD=parseFloat(ticket.amountUSD)||0;
  const ticketKey=interaction.channel.id;tickets[ticketKey]=ticket;
  _mem.tickets={...(_mem.tickets||{}),...tickets};save("tickets",_mem.tickets);
  if(interaction.guild){updateStatChannel(interaction.guild).catch(()=>{});updateLiveLeaderboard(interaction.guild).catch(()=>{});}
  console.log(`[completeTrade] userId=${ticket.userId} amount=${ticket.amountUSD} total=${Object.keys(_mem.tickets).length}`);
  const _refData=getReferrals();
  const _referredByForVouch=_refData.referred[ticket.userId]||null;
  // DM owners about referral deal if enabled
  if(state.referralDMsEnabled&&_referredByForVouch&&_referredByForVouch!==ticket.userId){
    for(const oid of CONFIG.OWNER_IDS){
      try{
        const owner=await client.users.fetch(oid);
        await owner.send({embeds:[new EmbedBuilder()
          .setColor(0x7C4DFF)
          .setAuthor({name:"Konvert  \u00b7  Referral Alert",iconURL:IMG.LOGO})
          .setTitle("Referral Exchange Completed")
          .setDescription("An exchange just completed through a referral.\n\u200b")
          .addFields(
            {name:"Client",value:`<@${ticket.userId}>`,inline:true},
            {name:"Referred By",value:`<@${_referredByForVouch}>`,inline:true},
            {name:"Amount",value:`**${fmtUSD(ticket.amountUSD)}**`,inline:true},
            {name:"Method",value:`**${m?.label||ticket.method}**`,inline:true},
            {name:"Points Earned",value:`**+${calcReferralPoints(ticket.amountUSD)} pts**`,inline:true},
          )
          .setFooter({text:"Use /togglereferraldms to disable these alerts"})
          .setTimestamp()]});
      }catch{}
    }
  }
  await handleReferralTrade(interaction.guild,ticket.userId,ticket.amountUSD);
  if(state.feedEnabled&&state.feedChannel){try{const feedCh=interaction.guild.channels.cache.get(state.feedChannel);if(feedCh){const vol=getUserVolume(ticket.userId);const _tier=getTier(vol);await feedCh.send(`\u2705  **${m?.label||ticket.method}**  \u00b7  **${fmtUSD(ticket.amountUSD)}**  \u00b7  ${_tier.emoji}  \u2014  just now`);}}catch{}}
  try{const _vol=getUserVolume(ticket.userId);console.log(`[tierRole] userId=${ticket.userId} volume=${_vol}`);await applyTierRole(interaction.guild,ticket.userId,_vol);}catch(e){console.log("[tierRole error]",e.message);}
  try{const volume=getUserVolume(ticket.userId);const allC=Object.values(_mem.tickets).filter(t=>t.userId===ticket.userId&&["vouched","completed"].includes(t.status)&&t.method!=="adjustment");await sendReceiptDM(ticket.userId,interaction.user.id,ticket,allC.length,volume);}catch{}
  const _ref=getReferrals();const _referrerId=_ref.referred[ticket.userId];
  let _referralLine="";
  if(_referrerId&&_referrerId!==ticket.userId){const _ptsEarned=calcReferralPoints(ticket.amountUSD);try{await client.users.fetch(_referrerId);_referralLine=`\n\n\uD83D\uDD17 **Referral deal** \u2014 referred by <@${_referrerId}> \u00b7 **+${_ptsEarned} pts** credited`;}catch{_referralLine=`\n\n\uD83D\uDD17 **Referral deal** \u2014 referral points credited`;}}
  else{_referralLine="\n\n\u274C **No referral** on this trade";}
  // Show completion — 5 min window for client review. _vouchPosted guards against any double post.
  let _vouchPosted=false;
  const _postOnce=async(reviewMsg)=>{
    if(_vouchPosted)return;
    _vouchPosted=true;
    await postVouch(interaction.guild,{clientId:ticket.userId,exchangerId:ticket.completedBy,method:m?.label||ticket.method,amountUSD:ticket.amountUSD,direction:ticket.direction,coin:ticket.coin,recvCoin:ticket.recvCoin||null,message:reviewMsg||null,rating:5,referredBy:_referredByForVouch});
    updateStatChannel(interaction.guild).catch(()=>{});
    await doCloseTicket(interaction.channel,interaction.guild,interaction.user,"Trade completed");
    interaction.channel.delete().catch(()=>{});
  };
  const _vRow=new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("skip_vouch").setLabel("Skip Review").setStyle(ButtonStyle.Secondary)
  );
  const _vPrompt=new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO})
    .setTitle("\u2705 Exchange Complete!")
    .setDescription(`<@${ticket.userId}> \u2014 your exchange is done!\n\nOptionally type a **review message** and it posts to vouches automatically.\n\n*90 seconds to leave a review \u2014 or click Skip to close now.*${_referralLine}`)
    .setFooter({text:"Konvert Exchange  \u2022  Your review helps the community"});
  await interaction.editReply({content:`<@${ticket.userId}>`,embeds:[_vPrompt],components:[_vRow]});
  // Store _postOnce on channel so skip button can call it directly
  if(interaction.channel)interaction.channel._completePostOnce=_postOnce;
  const _ticketOwnerId=ticket.userId;
  const _msgFilter=msg=>msg.author.id===_ticketOwnerId&&!msg.author.bot;
  const _collector=interaction.channel.createMessageCollector({filter:_msgFilter,time:90*1000,max:1});
  _collector.on("collect",async(msg)=>{
    _collector.stop("collected");
    await msg.reply("\uD83D\uDC4B Thanks! Posting vouch now.").catch(()=>{});
    await _postOnce(msg.content.slice(0,500));
  });
  _collector.on("end",(_col,reason)=>{
    if(reason!=="collected")_postOnce(null);
  });
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
        await message.react("\u2705");await message.reply(`\u2705 Posted: https://youtube.com/watch?v=${res.data.id}\n**Title:** ${title}`);fs.unlinkSync(filePath);
      }catch(err){await message.react("\u274C");await message.reply(`\u274C Upload failed: ${err.message}`);try{fs.unlinkSync(filePath);}catch{}}
      return;
    }
  }
  if(message.author.bot)return;

  // ── PROMO CODE DETECTION ─────────────────────────────────────────────────
  // If a message in a ticket channel matches an active promo code, apply it
  if(message.channel.type!==undefined){
    const tickets=Object.keys(_mem.tickets||{}).length?_mem.tickets:load("tickets");
    const ticket=tickets[message.channel.id];
    // Security reminder — once per ticket, after 10-15 messages
    if(ticket&&ticket.status==="open"){
      if(!state._ticketMsgCount)state._ticketMsgCount={};
      if(!state._ticketWarnSent)state._ticketWarnSent={};
      const _chId=message.channel.id;
      // Set a fixed threshold for this channel the first time we see it
      if(!state._ticketMsgCount[_chId+"_thresh"])state._ticketMsgCount[_chId+"_thresh"]=Math.floor(Math.random()*6)+10;
      state._ticketMsgCount[_chId]=(state._ticketMsgCount[_chId]||0)+1;
      if(!state._ticketWarnSent[_chId]&&state._ticketMsgCount[_chId]>=state._ticketMsgCount[_chId+"_thresh"]){
        state._ticketWarnSent[_chId]=true;
        await message.channel.send({content:`\u26A0\uFE0F **@3uce will NOT DM you first. @jswaps will NOT DM you first.** If you received a random DM from anyone claiming to be Konvert staff or an owner \u2014 it is an impersonator. Block and report them immediately. All communication happens inside this ticket only.`}).catch(()=>{});
      }
    }
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
          .setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange  \u00b7  Promo Applied",iconURL:IMG.LOGO})
          .setTitle("\u2728  Promo Code Applied!")
          .setDescription(`**${code.toUpperCase()}** has been applied to your exchange.\n\u200b`)
          .addFields(
            {name:"Original Fee",value:`**${fmtUSD(origFee)}**`,inline:true},
            {name:"Discount",value:`**${p.discount}% off the fee**`,inline:true},
            {name:"New Fee",value:`**${fmtUSD(newFee)}**`,inline:true},
            {name:"You Save",value:`**${fmtUSD(savedAmt)}**`,inline:true},
            {name:"Uses Left",value:p.maxUses?`**${p.maxUses-p.uses}**`:"Unlimited",inline:true},
            {name:"Expires",value:p.expiresAt?`<t:${Math.floor(p.expiresAt/1000)}:R>`:"Never",inline:true},
          )
          .setFooter({text:"Konvert Exchange  \u2022  Fee updated for this exchange"})
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
    const isCoin=s=>COINS.includes(s),isFiat=s=>!!FIAT_RATES[s];
    if(!isCoin(fromRaw)&&!isFiat(fromRaw))return;
    if(!isCoin(toRaw)&&!isFiat(toRaw))return;
    try{
      let amtUSD=0;
      if(isFiat(fromRaw)){amtUSD=rawAmt/FIAT_RATES[fromRaw];}
      else{const fp=await getPrice(fromRaw);if(!fp){await message.reply({content:`\u274C Could not fetch price for **${fromRaw}**.`}).catch(()=>{});return;}amtUSD=rawAmt*fp;}
      let result=0;
      if(isFiat(toRaw)){result=amtUSD*FIAT_RATES[toRaw];}
      else{const tp=await getPrice(toRaw);if(!tp){await message.reply({content:`\u274C Could not fetch price for **${toRaw}**.`}).catch(()=>{});return;}result=amtUSD/tp;}
      const fmtR=n=>{if(n>=1000)return n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});if(n>=1)return n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:4});if(n>=0.01)return n.toFixed(4);return n.toFixed(8);};
      const fromSym=isFiat(fromRaw)?(FIAT_SYM[fromRaw]||fromRaw+" "):"";
      const toSym=isFiat(toRaw)?(FIAT_SYM[toRaw]||toRaw+" "):"";
      const color=(isCoin(fromRaw)||isCoin(toRaw))?0x7C4DFF:0x7C4DFF;
      const embed=new EmbedBuilder().setColor(color).setAuthor({name:"Konvert Exchange  \u00b7  Converter",iconURL:IMG.LOGO})
        .setTitle(fromSym+rawAmt.toLocaleString("en-US")+" "+fromRaw+"  \u2192  "+toSym+fmtR(result)+" "+toRaw)
        .addFields({name:"You have",value:`**${fromSym}${rawAmt.toLocaleString("en-US")} ${fromRaw}**`,inline:true},{name:"You get",value:`**${toSym}${fmtR(result)} ${toRaw}**`,inline:true},{name:"\u2248 USD Value",value:`**$${amtUSD.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}**`,inline:true})
        .setFooter({text:"Konvert Exchange  \u00b7  Live rates  \u00b7  Open a ticket to trade"}).setTimestamp();
      if(isCoin(fromRaw)&&COIN_LOGO[fromRaw])embed.setThumbnail(COIN_LOGO[fromRaw]);
      else if(isCoin(toRaw)&&COIN_LOGO[toRaw])embed.setThumbnail(COIN_LOGO[toRaw]);
      await message.reply({embeds:[embed]}).catch(()=>{});
    }catch(e){console.log("[autoConvert]",e.message);}
    return;
  }
  const jwMatch=message.content.trim().match(/^\$j([A-Za-z]{2,10})$/i);
  if(jwMatch){
    const jwKey=jwMatch[1].toLowerCase();
    const jwMap={btc:"BTC",eth:"ETH",sol:"SOL",ltc:"LTC",usdtbnb:"USDT-BNB"};
    const jwCoin=jwMap[jwKey];
    if(jwCoin&&state.personalWallets[jwCoin]){
      await message.channel.send({content:state.personalWallets[jwCoin]}).catch(()=>{});
    } else {
      await message.reply({content:`\u274C No **${jwCoin||jwKey.toUpperCase()}** address set yet.`}).catch(()=>{});
    }
    return;
  }
  const match=message.content.trim().match(/^\$([A-Za-z]{2,10})$/i);
  if(!match)return;
  const coin=match[1].toUpperCase();
  if(!COINS.includes(coin))return;
  const d=await fetchFullPrice(coin);
  if(!d){await message.reply(`\u274C Could not fetch **${coin}** price right now. Try again in a moment.`).catch(()=>{});return;}
  const fmt=n=>{if(n>=1)return n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});if(n>=0.01)return n.toFixed(4);return n.toFixed(8);};
  const ch2=parseFloat(d.usd_24h_change||0),isUp=ch2>=0;
  const mcap=d.usd_market_cap?`$${(d.usd_market_cap/1e9).toFixed(2)}B`:"--";
  const vol=d.usd_24h_vol?`$${(d.usd_24h_vol/1e9).toFixed(2)}B`:"--";
  const fee=calcFee(Math.max(d.usd,1),"send"),rate=feeRate(Math.max(d.usd,1),"send");
  const color=isUp?0x7C4DFF:0x7C4DFF;
  await message.reply({embeds:[new EmbedBuilder().setColor(color).setAuthor({name:"Konvert Exchange  \u2022  Live Price",iconURL:IMG.LOGO}).setTitle(`${isUp?"\u25B2":"\u25BC"}  ${coin}  \u2014  $${fmt(d.usd)}`).setThumbnail(COIN_LOGO[coin]||IMG.LOGO).setDescription(`**${isUp?"+":""}${ch2.toFixed(2)}%** in the last 24 hours\n\u200b`)
    .addFields({name:"USD",value:`**$${fmt(d.usd)}**`,inline:true},{name:"CAD",value:`**CA$${fmt(d.cad)}**`,inline:true},{name:"EUR",value:`**\u20AC${fmt(d.eur)}**`,inline:true},{name:"Market Cap",value:mcap,inline:true},{name:"24h Volume",value:vol,inline:true},{name:"Konvert Fee",value:`**${rate}%** \u2014 ${fmtUSD(fee)}`,inline:true})
    .setImage(IMG.BANNER).setFooter({text:`Konvert Exchange  \u2022  Type /price ${coin} for more details`}).setTimestamp()]}).catch(()=>{});
 }catch(e){console.error("[MessageCreate error]",e.message);}
});

let _inviteCache=new Map();
async function cacheInvites(guild){
  try{const invites=await guild.invites.fetch();_inviteCache=new Map(invites.map(i=>[i.code,i.uses]));}catch(e){console.error("[inviteCache]",e.message);}
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
client.on(Events.UserUpdate,async(oldUser,newUser)=>{
  try{
    if(!newUser||!newUser.id)return;
    const guild=client.guilds.cache.get(CONFIG.GUILD_ID);
    if(!guild)return;
    const member=await guild.members.fetch({user:newUser.id,force:false}).catch(()=>null);
    if(!member)return;
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
    try{
      const ref=getReferrals();
      const freshInvites=await guild.invites.fetch();
      let usedCode=null;
      for(const invite of freshInvites.values()){const prev=_inviteCache.get(invite.code)||0;if(invite.uses>prev){usedCode=invite.code;break;}}
      _inviteCache=new Map(freshInvites.map(i=>[i.code,i.uses]));
      if(usedCode&&ref.invites[usedCode]){
        const referrerId=ref.invites[usedCode];
        if(referrerId!==member.id){
          ref.referred[member.id]=referrerId;saveReferrals(ref);
          try{const referrer=await client.users.fetch(referrerId);await referrer.send({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert  \u00b7  Referral Program",iconURL:PTS_IMG}).setTitle("New Referral").setThumbnail(member.user.displayAvatarURL({size:128})).setDescription(`**${member.user.username}** just joined Konvert using your invite link.\n\nYou'll earn **${POINTS_PER_100} pts** for every **$100** they exchange \u2014 automatically, every time.\n\u200b`).addFields({name:"Rate",value:`**${POINTS_PER_100} pts** per $100 traded  \u00b7  **${POINTS_PER_DOLLAR} pts = $1**`,inline:false}).setImage(IMG.BANNER).setFooter({text:"Konvert Referral Program  \u00b7  Earn on every trade they make"}).setTimestamp()]});}catch{}
        }
      }
    }catch(e){console.error("[referral join]",e.message);}
    const WELCOME_CHANNEL="1477787759799435344";
    const ch=guild.channels.cache.get(WELCOME_CHANNEL);
    if(!ch)return;
    await ch.send({content:`<@${member.id}>`,embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO}).setThumbnail(member.user.displayAvatarURL({size:256})).setDescription(`Welcome to Konvert, <@${member.id}>. \u2014 Member **#${guild.memberCount}**\n\nReady to exchange? Open a ticket in <#${CONFIG.EXCHANGE_CHANNEL}>.\n\u200b`).setFooter({text:"Fast  \u00b7  Safe  \u00b7  Simple"}).setTimestamp()]});
  }catch(e){console.error("Welcome error:",e.message);}
});

client.on(Events.InteractionCreate,async interaction=>{
  try{
    if(interaction.isChatInputCommand()){
      // Owner-only commands: check OWNER_IDS regardless of Discord permissions
      const OWNER_ONLY_CMDS=["grantowner","revokeowner","listowners","wipestats","clearleaderboard","adjuststats","resetstats","broadcast","setfeemode","togglereferraldms","postleaderboard","serverinfo","clientinfo","receipt"];
      if(OWNER_ONLY_CMDS.includes(interaction.commandName)&&!CONFIG.OWNER_IDS.includes(interaction.user.id)){
        return interaction.reply({content:"❌ You don\'t have permission to use this command.",ephemeral:true});
      }
      const cmd=interaction.commandName;

      if(cmd==="postexchange"){await interaction.channel.send({embeds:[mainEmbed()],components:mainButtons()});return interaction.reply({content:"Exchange embed posted.",ephemeral:true});}
      if(cmd==="postsupport"){const embed=new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO}).setTitle("Support").setThumbnail(IMG.LOGO).setDescription(`This channel is for **support tickets only**.\n\nFor exchanges, head to <#${CONFIG.EXCHANGE_CHANNEL}>.\n\n**What to include:**\n\u00b7 What you need help with\n\u00b7 Any error messages or screenshots\n\u00b7 What you have already tried\n\u00b7 A full explanation of what happened\n\u200b`).setFooter({text:"Konvert  \u2022  Support"});await interaction.channel.send({embeds:[embed],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("btn_support_ticket").setLabel("Open Support Ticket").setEmoji("\uD83C\uDF9F").setStyle(ButtonStyle.Primary))]});return interaction.reply({content:"Support embed posted.",ephemeral:true});}
      if(cmd==="postmm"){const embed=new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO}).setTitle("Middleman Information").setThumbnail(IMG.LOGO).setDescription(`**Konvert officially partners with Astro MM** to ensure all deals go smoothly.\n\n**How It Works:**\n**1.** Open a ticket in <#${CONFIG.EXCHANGE_CHANNEL}>\n**2.** Get a quote for your exchange\n**3.** If terms are agreed on, open an MM ticket on Astro MM\n**4.** Complete the exchange safely\n\u200b`).addFields({name:"Important",value:"**Do NOT go first** without using Astro MM, unless explicitly advised by an owner in your ticket.",inline:false},{name:"Astro MM",value:"Click the button below to join the Astro MM server.",inline:false}).setImage(IMG.BANNER).setFooter({text:"Konvert  \u2022  Official Escrow Partner: Astro MM"});await interaction.channel.send({embeds:[embed],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel("Join Astro MM").setEmoji("\uD83E\uDD1D").setStyle(ButtonStyle.Link).setURL("https://discord.gg/astromm"))]});return interaction.reply({content:"MM embed posted.",ephemeral:true});}

      if(cmd==="rates"){await interaction.deferReply();return interaction.editReply({embeds:[await buildRatesEmbed()],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("btn_refresh_rates").setLabel("Refresh").setStyle(ButtonStyle.Secondary))]});}

      if(cmd==="fee"){
        const amt=interaction.options.getNumber("amount_usd");
        if(!amt||amt<=0)return interaction.reply({content:"Please enter a valid amount greater than $0.",ephemeral:true});
        await interaction.deferReply({ephemeral:true});
        const _feeVol=getUserVolume(interaction.user.id),_feeVip=isVipVolume(_feeVol);
        const fS=calcFee(amt,"send",_feeVip),rS=feeRate(amt,"send",_feeVip),fR=calcFee(amt,"receive",_feeVip),rR=feeRate(amt,"receive",_feeVip);
        const [btcP,ethP,solP]=await Promise.all([getPrice("BTC"),getPrice("ETH"),getPrice("SOL")]);
        const recvS=amt-fS,coinLines=[];
        if(btcP)coinLines.push(`BTC: **${(recvS/btcP).toFixed(6)}** (\u2248${fmtUSD(recvS)})`);
        if(ethP)coinLines.push(`ETH: **${(recvS/ethP).toFixed(5)}** (\u2248${fmtUSD(recvS)})`);
        if(solP)coinLines.push(`SOL: **${(recvS/solP).toFixed(4)}** (\u2248${fmtUSD(recvS)})`);
        return interaction.editReply({embeds:[base("Fee Calculator").setThumbnail(IMG.LOGO).setDescription(`Estimate for **${fmtUSD(amt)}**\n*Final fee may vary slightly.*\n\u200b`).addFields({name:"Fiat \u2192 Crypto",value:`Rate: **${rS}%**${_feeVip?" \u26A1":""} \nFee: **${fmtUSD(fS)}**\nYou receive: **${fmtUSD(recvS)}**`,inline:true},{name:"Crypto \u2192 Fiat",value:`Rate: **${rR}%**${_feeVip?" \u26A1":""} \nFee: **${fmtUSD(fR)}**\nYou receive: **${fmtUSD(amt-fR)}**`,inline:true},{name:"\uD83E\uDE99 If Buying Crypto",value:coinLines.length?coinLines.join("\n"):"--",inline:false}).setImage(IMG.FEE).setFooter({text:`Konvert  \u2022 ${_feeVip?"\u26A1 VIP rate active  \u00b7  ":""}Rate shown is for the amount entered`})]});
      }

      if(cmd==="price"){
        await interaction.deferReply();
        const coin=interaction.options.getString("coin").toUpperCase();
        if(!GECKO[coin]&&!BINANCE[coin])return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert",iconURL:IMG.LOGO}).setDescription(`**${coin}** is not supported. Try BTC, ETH, SOL, LTC, BNB, XRP, DOGE and more.`)]});
        const d=await fetchFullPrice(coin);
        if(!d)return interaction.editReply("\u274C Could not fetch price right now. Try again in a moment.");
        const ch=parseFloat(d.usd_24h_change||0),isUp=ch>=0;
        const fmt2=n=>n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
        const mcap=d.usd_market_cap?`$${(d.usd_market_cap/1e9).toFixed(2)}B`:"--",vol=d.usd_24h_vol?`$${(d.usd_24h_vol/1e9).toFixed(2)}B`:"--";
        const fee=calcFee(Math.max(d.usd,1),"send"),rate=feeRate(Math.max(d.usd,1),"send");
        const color2=isUp?0x7C4DFF:0x7C4DFF;
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(color2).setAuthor({name:"Konvert Exchange  \u2022  Live Price",iconURL:IMG.LOGO}).setTitle(`${isUp?"\u25B2":"\u25BC"}  ${coin}  \u2014  $${fmt2(d.usd)}`).setThumbnail(COIN_LOGO[coin]||IMG.LOGO).setDescription(`**${isUp?"+":""}${ch.toFixed(2)}%** in the last 24 hours\n\u200b`).addFields({name:"USD",value:`**$${fmt2(d.usd)}**`,inline:true},{name:"CAD",value:`**CA$${fmt2(d.cad)}**`,inline:true},{name:"EUR",value:`**\u20AC${fmt2(d.eur)}**`,inline:true},{name:"Market Cap",value:mcap,inline:true},{name:"24h Volume",value:vol,inline:true},{name:"Konvert Fee",value:`**${rate}%** \u2014 ${fmtUSD(fee)}`,inline:true}).setImage(IMG.BANNER).setFooter({text:"Konvert Exchange  \u2022  Open a ticket to start trading"}).setTimestamp()]});
      }

      if(cmd==="convert"){
        await interaction.deferReply();
        const amount=interaction.options.getNumber("amount"),from=interaction.options.getString("from").toUpperCase(),to=interaction.options.getString("to").toUpperCase();
        if(!amount||amount<=0)return interaction.editReply("Please enter a valid amount greater than 0.");
        const FIAT={USD:1,CAD:1.37,EUR:0.93,GBP:0.79};
        const fromNorm=from.trim().toUpperCase(),toNorm=to.trim().toUpperCase();
        if(!FIAT[fromNorm]&&!GECKO[fromNorm])return interaction.editReply(`\u274C **${fromNorm}** not recognised.`);
        if(!FIAT[toNorm]&&!GECKO[toNorm])return interaction.editReply(`\u274C **${toNorm}** not recognised.`);
        let amtUSD;
        if(FIAT[fromNorm]){amtUSD=amount/FIAT[fromNorm];}else{const p=await getPrice(fromNorm);if(!p)return interaction.editReply(`\u274C Could not fetch price for **${fromNorm}**.`);amtUSD=amount*p;}
        let result;
        if(FIAT[toNorm]){result=amtUSD*FIAT[toNorm];}else{const p=await getPrice(toNorm);if(!p)return interaction.editReply(`\u274C Could not fetch price for **${toNorm}**.`);result=amtUSD/p;}
        const fee=calcFee(amtUSD,"send"),toPrice=FIAT[toNorm]?(1/FIAT[toNorm]):(await getPrice(toNorm)||1),youGet=result-(fee/toPrice);
        const isToFiat=!!FIAT[toNorm],receiveUSD=isToFiat?youGet:youGet*(await getPrice(toNorm)||1);
        const youGetDisplay=isToFiat?fmtUSD(youGet):`${youGet.toFixed(6)} ${toNorm}`;
        const usdDisplay=isToFiat?fmtUSD(youGet):`\u2248${fmtUSD(receiveUSD)}`;
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert Exchange  \u2022  Conversion",iconURL:IMG.LOGO}).setTitle(`${fromNorm} \u2192 ${toNorm}`).setThumbnail(COIN_LOGO[fromNorm]||COIN_LOGO[toNorm]||IMG.LOGO).setDescription(`Estimated conversion for **${amount} ${fromNorm}** to **${toNorm}**\n\u200b`).addFields({name:"\uD83D\uDCE4  You Send",value:`**${amount} ${fromNorm}**`,inline:true},{name:"\uD83D\uDCB8  Est. Fee",value:`**${fmtUSD(fee)}**`,inline:true},{name:"\uD83D\uDCE5  You Receive",value:`**${youGetDisplay}**`,inline:true},{name:"\uD83D\uDCB5  USD Value",value:`**${usdDisplay}**`,inline:true}).setImage(IMG.BANNER).setFooter({text:"Estimate only  \u2022  Konvert Exchange  \u2022  Open a ticket to begin"}).setTimestamp()]});
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
        const methods={};realTrades.forEach(t=>{if(t.method)methods[t.method]=(methods[t.method]||0)+1;});
        const topM=Object.entries(methods).sort((a,b)=>b[1]-a[1])[0];
        const coins={};realTrades.forEach(t=>{if(t.coin)coins[t.coin]=(coins[t.coin]||0)+1;});
        const topC=Object.entries(coins).sort((a,b)=>b[1]-a[1])[0];
        const tier=getTier(volume),nextTier=getNextTier(volume),needed=nextTier?Math.max(nextTier.min-volume,0):0;
        const last=realTrades.length>0?[...realTrades].sort((a,b)=>(b.completedAt||0)-(a.completedAt||0))[0]:null;
        
        const tierStatus=nextTier?`${tier.emoji} **${tier.label}** \u2014 ${fmtUSD(needed)} away from ${nextTier.emoji} **${nextTier.label}**`:`${tier.emoji} **${tier.label}** \u2014 Maximum tier reached`;
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x7C4DFF)
          .setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO})
          .setTitle(isSelf?"Your Stats":`${target.username}'s Stats`)
          .setThumbnail(target.displayAvatarURL({size:256}))
          .setDescription(`${tier.emoji} **${tier.label}**${isVipVolume(volume)?" \u26A1":""} \u2014 ${nextTier?`${fmtUSD(Math.max(nextTier.min-volume,0))} to ${nextTier.emoji} ${nextTier.label}`:"Max tier reached"}\n\u200b`)
          .addFields(
            {name:"Exchanges",value:`**${realTrades.length}**`,inline:true},
            {name:"Volume",value:`**${volume>0?fmtUSD(volume):"$0.00"}**`,inline:true},
            {name:"Avg Trade",value:`**${avg>0?fmtUSD(avg):"\u2014"}**`,inline:true},
            {name:"Top Method",value:topM?`**${getMethod(topM[0])?.label||topM[0]}**`:"\u2014",inline:true},
            {name:"Top Coin",value:topC?`**${topC[0]}**`:"\u2014",inline:true},
            {name:"Last Exchange",value:last?.completedAt?`<t:${Math.floor(last.completedAt/1000)}:R>`:"\u2014",inline:true},
          )
          .setImage(IMG.BANNER)
          .setFooter({text:`Konvert Exchange  \u00b7  ${tier.emoji} ${tier.label}`})
          .setTimestamp()]});

      }

      if(cmd==="leaderboard"){
        await interaction.deferReply();
        const byUser=buildLeaderboardVolumes();
        if(!Object.keys(byUser).length)return interaction.editReply({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO}).setTitle("Client Leaderboard").setThumbnail(IMG.LOGO).setDescription("No completed trades on record yet.\n\nComplete a trade to appear here.\n\u200b").setImage(IMG.BANNER).setFooter({text:"Konvert Exchange  \u2022  Leaderboard"}).setTimestamp()]});
        const ranked=Object.entries(byUser).sort((a,b)=>b[1]-a[1]).slice(0,10);
        const medals=["🥇","🥈","🥉"];
        const lines=ranked.map(([uid,vol],i)=>`${medals[i]||`**${i+1}.**`}  <@${uid}>  \u2014  **${fmtUSD(vol)}**`).join("\n");
        const totalVol=ranked.reduce((s,[,v])=>s+v,0);
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x7C4DFF)
          .setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO})
          .setTitle("Leaderboard")
          .setThumbnail(IMG.LOGO)
          .setDescription(`Top ${ranked.length} clients by volume\n\u200b`)
          .addFields({name:"\u200b",value:lines,inline:false})
          .setFooter({text:`${fmtUSD(totalVol)} total volume  \u00b7  Konvert Exchange`})
          .setTimestamp()]});

      }

      if(cmd==="market"){
        await interaction.deferReply();
        const ids=COINS.map(c=>GECKO[c]||c.toLowerCase()).join(",");
        const res=await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,{signal:AbortSignal.timeout(10000)});
        const data=await res.json();
        const rows=COINS.map(coin=>{const d=data[GECKO[coin]||coin.toLowerCase()];if(!d)return null;return{coin,price:d.usd,change:parseFloat(d.usd_24h_change||0)};}).filter(Boolean);
        const gainers=[...rows].sort((a,b)=>b.change-a.change).slice(0,3),losers=[...rows].sort((a,b)=>a.change-b.change).slice(0,3);
        const avg=(rows.reduce((s,r)=>s+r.change,0)/rows.length).toFixed(2);
        const fmt2=n=>n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
        return interaction.editReply({embeds:[base("Market Summary").setThumbnail(IMG.LOGO).addFields({name:"Market Sentiment",value:`**${parseFloat(avg)>=0?"Bullish \u25B2":"Bearish \u25BC"}**  \u00b7  Avg 24h: **${avg}%**`,inline:false},{name:"Top Gainers",value:gainers.map(r=>`\`${r.coin.padEnd(5)}\` **\u25B2 ${r.change.toFixed(2)}%**  $${fmt2(r.price)}`).join("\n"),inline:true},{name:"Top Losers",value:losers.map(r=>`\`${r.coin.padEnd(5)}\` **\u25BC ${Math.abs(r.change).toFixed(2)}%**  $${fmt2(r.price)}`).join("\n"),inline:true}).setImage(IMG.RATES).setFooter({text:"Live market data  \u2022  Konvert"})]});
      }

      if(cmd==="wallets"){const w=load("wallets"),fields=Object.entries(w).length?Object.entries(w).map(([coin,addr])=>({name:coin,value:`\`${addr}\``,inline:true})):[{name:"No wallets set",value:"Owner: use /setwallet to add addresses.",inline:false}];return interaction.reply({embeds:[base("Deposit Wallets").setThumbnail(IMG.LOGO).setDescription("Send funds **only** to addresses confirmed by staff **inside your ticket**.\n__Never send to any address given outside of your ticket.__\n\u200b").addFields(fields).setFooter({text:"Always verify with staff before sending  \u2022  Konvert"})],ephemeral:true});}
      if(cmd==="mm"){return interaction.reply({embeds:[base("Middleman Guide").setDescription("A **middleman (MM)** holds crypto between both parties during a trade -- protecting everyone from scams.\n\u200b").addFields({name:"How to Pick an MM",value:"Agree with your exchanger on a trusted MM you both know.",inline:false},{name:"Owner Override Only",value:"The **only** time you skip an MM is if **@jswaps** or **@3uce** explicitly says so in your ticket.",inline:false},{name:"Stay Safe",value:"**Staff will never DM you first.** All MM arrangements happen in your ticket only.",inline:false}).setImage(IMG.RULES).setFooter({text:"Konvert  \u2022  Trade safely, always"})]});}

      if(cmd==="mine"){
        const userId=interaction.user.id,cooldownMs=3*60*60*1000,remaining=cooldownMs-(Date.now()-(state.cooldowns[userId]||0));
        if(remaining>0){const hrs=Math.floor(remaining/3600000),mins=Math.ceil((remaining%3600000)/60000);return interaction.reply({embeds:[base("Mine -- On Cooldown").setDescription(`You can mine again in **${hrs>0?`${hrs}h ${mins}m`:`${mins}m`}**.`).setFooter({text:"Konvert Mine  \u2022  Once every 3 hours"})],ephemeral:true});}
        state.cooldowns[userId]=Date.now();
        const pos=Array.from({length:25},(_,i)=>i).sort(()=>Math.random()-0.5);
        state.mineGames[userId]={diamonds:pos.slice(0,3),bombs:pos.slice(3,8),revealed:[],found:0,tries:0,over:false};
        return interaction.reply({embeds:[base("Konvert Mine").setThumbnail(IMG.LOGO).setDescription("A **5\u00D75** grid lies before you.\n\n\uD83D\uDC8E **3 diamonds** are hidden among the cells.\n\uD83D\uDCA3 **5 bombs** are also hidden -- hit one and it's over.\n\nYou have **3 tries**. Find all 3 diamonds to win a **Free Exchange Pass**.\n\u200b").addFields({name:"Tries Remaining",value:"**3**",inline:true},{name:"Diamonds Found",value:"**0 / 3**",inline:true},{name:"Win Condition",value:"All 3 \uD83D\uDC8E with no \uD83D\uDCA3",inline:true}).setFooter({text:"Konvert Mine  \u2022  Find all 3 diamonds  \u2022  Cooldown: 3 hours"})],components:buildMineGrid(userId,state.mineGames[userId]),ephemeral:true});
      }

      if(cmd==="vouch"){
        const clientUser=interaction.options.getUser("client"),exchUser=interaction.options.getUser("exchanger");
        const message=interaction.options.getString("message"),method=interaction.options.getString("method"),amount=interaction.options.getNumber("amount"),rating=interaction.options.getInteger("rating")||5;
        const vt=load("tickets");
        vt["manual_"+Date.now()]={userId:clientUser.id,userTag:clientUser.tag,method,direction:null,coin:null,amountUSD:amount,feeUSD:calcFee(amount,"send"),walletInfo:"manual",notes:"Manual vouch via /vouch",status:"vouched",completedBy:exchUser.id,completedAt:Date.now(),createdAt:Date.now()};
        _mem.tickets=vt;save("tickets",vt);
        updateStatChannel(interaction.guild).catch(()=>{});
        const _refD=getReferrals();
        const _refByManual=_refD.referred[clientUser.id]||null;
        await postVouch(interaction.guild,{clientId:clientUser.id,exchangerId:exchUser.id,method,amountUSD:amount,direction:null,coin:null,message,rating,referredBy:_refByManual});
        await handleReferralTrade(interaction.guild,clientUser.id,amount);
        const vol=getUserVolume(clientUser.id);await applyTierRole(interaction.guild,clientUser.id,vol);
        const _allVouched=Object.values(_mem.tickets).filter(t=>t.userId===clientUser.id&&["vouched","completed"].includes(t.status)&&t.method!=="adjustment");
        await sendReceiptDM(clientUser.id,exchUser.id,{method,direction:null,coin:null,amountUSD:amount,feeUSD:calcFee(amount,"send")},_allVouched.length,vol);
        return interaction.reply({content:`Vouch recorded \u2014 <@${clientUser.id}> exchanged with <@${exchUser.id}>.`,ephemeral:true});
      }

      if(cmd==="alert"){const coin=interaction.options.getString("coin").toUpperCase(),price=interaction.options.getNumber("price"),dir=interaction.options.getString("direction");if(!COINS.includes(coin))return interaction.reply({content:`Unsupported coin: ${coin}`,ephemeral:true});state.alerts.push({userId:interaction.user.id,coin,target:price,direction:dir});return interaction.reply({embeds:[base("Price Alert Set").setThumbnail(COIN_LOGO[coin]||IMG.LOGO).setDescription(`You will be DM'd when **${coin}** goes **${dir}** **$${price.toLocaleString("en-US")}**.`).setFooter({text:"Konvert  \u2022  Price Alerts"})],ephemeral:true});}
      if(cmd==="ticket"){const tickets=load("tickets"),found=Object.entries(tickets).find(([,t])=>t.userId===interaction.user.id&&t.status==="open");if(!found)return interaction.reply({content:"You don't have an open ticket. Use **Exchange Now** to start one.",ephemeral:true});const [channelId,t]=found,m=getMethod(t.method);return interaction.reply({embeds:[base("Your Open Ticket").setThumbnail(IMG.LOGO).addFields({name:"Channel",value:`<#${channelId}>`,inline:true},{name:"Method",value:`**${m?.label||t.method}**`,inline:true},{name:"Amount",value:`**${fmtUSD(t.amountUSD)}**`,inline:true},{name:"Coin",value:`**${t.coin||"--"}**`,inline:true},{name:"Direction",value:t.direction==="send"?"Fiat \u2192 Crypto":"Crypto \u2192 Fiat",inline:true},{name:"Opened",value:`<t:${Math.floor(t.createdAt/1000)}:R>`,inline:true}).setFooter({text:"Konvert  \u2022  All communication stays in your ticket"})],ephemeral:true});}
      if(cmd==="howto"){return interaction.reply({embeds:[base("How to Use Konvert").setThumbnail(IMG.LOGO).setDescription("New to Konvert? Here's how a trade works step by step.\n\u200b").addFields({name:"1.  Check Rates",value:"Use **Live Rates** or type `$BTC` / `$ETH` etc. in any channel to see the current price.",inline:false},{name:"2.  Calculate Fee",value:"Use **Calculate Fee** to estimate your cost. Fees range from **5% - 10%** depending on amount.",inline:false},{name:"3.  Open a Ticket",value:"Click **Exchange Now**, pick your payment method, fill in details, confirm. A private ticket opens instantly.",inline:false},{name:"4.  Agree on an MM",value:"A **middleman** is required on all trades. Agree on one with your exchanger inside your ticket.",inline:false},{name:"5.  Send & Confirm",value:"Staff confirms the deal. You send funds and share proof. Once confirmed, you receive your crypto or payment.",inline:false},{name:"Stay Safe",value:"Staff never DM you first. Anyone doing so is an impersonator. All communication stays in your ticket.",inline:false}).setFooter({text:"Konvert  \u2022  Questions? Ask in your ticket"})],ephemeral:true});}
      if(cmd==="ping"){const sent=Date.now();await interaction.deferReply({ephemeral:true});return interaction.editReply({embeds:[base("Bot Status").setThumbnail(IMG.LOGO).setDescription("**All systems operational.** Konvert is online and ready.\n\u200b").addFields({name:"Status",value:"**Online**",inline:true},{name:"Latency",value:`**${Date.now()-sent}ms**`,inline:true},{name:"API Latency",value:`**${client.ws.ping}ms**`,inline:true}).setFooter({text:"Konvert  \u2022  Bot Status"})]});}
      if(cmd==="supported"){return interaction.reply({embeds:[base("Supported Methods & Coins").setThumbnail(IMG.LOGO).addFields({name:"\uD83D\uDCB3  Payment Methods",value:METHODS.map(m=>`**${m.label}**`).join("  \u00b7  "),inline:false},{name:"\uD83E\uDE99  Cryptocurrencies",value:COINS.map(c=>`\`${c}\``).join("  ")+"\n\n*Don't see your coin? Ask in your ticket -- we support most major coins.*",inline:false}).setFooter({text:"Don't see your method or coin? Open a ticket and ask  \u2022  Konvert"})],ephemeral:true});}
      if(cmd==="review"){const modal=new ModalBuilder().setCustomId("modal_review").setTitle("Leave a Review for Konvert");modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("review_text").setLabel("Your experience with Konvert").setStyle(TextInputStyle.Paragraph).setPlaceholder("Fast, legit, smooth -- describe your experience").setRequired(true)),new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("review_rating").setLabel("Rating out of 5").setStyle(TextInputStyle.Short).setPlaceholder("5").setRequired(true)));return interaction.showModal(modal);}
      if(cmd==="remind"){const mins=interaction.options.getInteger("minutes"),message=interaction.options.getString("message");if(mins<1||mins>1440)return interaction.reply({content:"Reminder must be between 1 minute and 24 hours.",ephemeral:true});await interaction.reply({content:`Got it. I'll remind you about **"${message}"** in **${mins} minute${mins!==1?"s":""}**.`,ephemeral:true});setTimeout(async()=>{try{const user=await client.users.fetch(interaction.user.id);await user.send({embeds:[base("Reminder").setDescription(`**"${message}"**\n\nThis is your reminder from **${mins} minute${mins!==1?"s":""}** ago.`).setFooter({text:"Konvert  \u2022  Reminder"})]});}catch{}},mins*60*1000);return;}
      if(cmd==="uptime"){const ms=process.uptime()*1000,hrs=Math.floor(ms/3600000),min=Math.floor((ms%3600000)/60000),sec=Math.floor((ms%60000)/1000),str=`${hrs}h ${min}m ${sec}s`;return interaction.reply({embeds:[base("Bot Uptime").setThumbnail(IMG.LOGO).setDescription(`Konvert Bot has been online for **${str}**.\n\u200b`).addFields({name:"Status",value:"**Online**",inline:true},{name:"Uptime",value:`**${str}**`,inline:true},{name:"Latency",value:`**${client.ws.ping}ms**`,inline:true}).setFooter({text:"Konvert  \u2022  Bot Status"})],ephemeral:true});}

      if(cmd==="referral"){
        await interaction.deferReply({ephemeral:true});
        const userId=interaction.user.id,ref=getReferrals();
        if(ref.blacklist?.[userId])return interaction.editReply({content:"You are not eligible for the Konvert referral program.",ephemeral:true});
        const pts=ref.points[userId]?.balance||0,dollarVal=pointsToDollars(pts),pending=ref.points[userId]?.pendingPayout||false;
        let existingInvite=null;
        const existing=ref.inviteCodes[userId];
        if(existing&&existing.code){try{const invites=await interaction.guild.invites.fetch();const found=invites.find(i=>i.code===existing.code);if(found)existingInvite=found;}catch{}}
        let invite=existingInvite;
        if(!invite){try{const guild=interaction.guild;const ch=guild.channels.cache.get(CONFIG.EXCHANGE_CHANNEL)||guild.channels.cache.first();invite=await ch.createInvite({maxAge:0,maxUses:0,unique:true,reason:`Konvert referral link for ${interaction.user.tag}`});ref.invites[invite.code]=userId;ref.inviteCodes[userId]={code:invite.code,expiresAt:0,uses:0};saveReferrals(ref);_inviteCache.set(invite.code,invite.uses);}catch(e){return interaction.editReply({content:`\u274C Could not create invite link: ${e.message}`,ephemeral:true});}}
        const referredCount=Object.values(ref.referred).filter(r=>r===userId).length;
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert  \u00b7  Referral Program",iconURL:PTS_IMG}).setTitle("\uD83D\uDD17  Your Referral Link").setThumbnail(IMG.LOGO).setDescription(`Share your link below. When someone joins through it and completes a trade, you earn points automatically.\n\u200b`).addFields({name:"Your Invite",value:`**https://discord.gg/${invite.code}**`,inline:false},{name:"Link",value:"**Permanent** \u2014 never expires",inline:true},{name:"People Referred",value:`**${referredCount}**`,inline:true},{name:"\u200b",value:"\u200b",inline:true},{name:"Your Balance",value:`**${pts} pts**`,inline:true},{name:"USD Value",value:`**$${dollarVal}**`,inline:true},{name:"Status",value:pending?"⏳ Payout pending":pts>=MIN_WITHDRAW_POINTS?"✅ Ready to withdraw":"Need **"+`${MIN_WITHDRAW_POINTS-pts}`+"** more pts",inline:true}).addFields({name:"\u200b",value:`**How it works**\n💸  **${POINTS_PER_100} pts** earned per **$100** exchanged by your referral\n💰  **${POINTS_PER_DOLLAR} pts = $1**  \u00b7  Minimum withdrawal: **${MIN_WITHDRAW_POINTS} pts ($${(MIN_WITHDRAW_POINTS/POINTS_PER_DOLLAR).toFixed(0)})**\n📬  You get a DM every time they trade`,inline:false}).setImage(IMG.BANNER).setFooter({text:"Konvert Referrals  \u2022  Earn while your network trades"}).setTimestamp()]});
      }

      if(cmd==="mypoints"){
        await interaction.deferReply({ephemeral:true});
        const userId=interaction.user.id,ref=getReferrals();
        const data=ref.points[userId]||{balance:0,paid:0,history:[],pendingPayout:false};
        const bal=data.balance||0,paid=data.paid||0;
        const history=(data.history||[]).slice(-10).reverse();
        const referredCount=Object.values(ref.referred).filter(r=>r===userId).length;
        const readyToWithdraw=bal>=MIN_WITHDRAW_POINTS&&!data.pendingPayout;
        let historyText="No activity yet.";
        if(history.length){historyText=history.map(h=>{if(h.type==="earned")return `+**${h.points} pts**  \u00b7  $${fmtUSD(h.amountUSD||0)} trade  \u00b7  <t:${Math.floor((h.at||Date.now())/1000)}:R>`;if(h.type==="paid")return `💵  **Paid out ${h.points} pts**  \u00b7  <t:${Math.floor((h.at||Date.now())/1000)}:R>`;return `**${h.points} pts**`;}).join("\n");}
        const withdrawStatusMp=data.pendingPayout?"⏳  Payout requested \u2014 staff will process shortly":readyToWithdraw?`\u2705  **Ready to withdraw** \u2014 open a ticket in <#${SUPPORT_CH}>`:`**${MIN_WITHDRAW_POINTS-bal} pts** to go  (${bal}/${MIN_WITHDRAW_POINTS} pts)`;
        const embed=new EmbedBuilder().setColor(bal>=MIN_WITHDRAW_POINTS?0x7C4DFF:0x7C4DFF).setAuthor({name:"Konvert  \u00b7  Referral Program",iconURL:PTS_IMG}).setTitle("My Points").setThumbnail(PTS_IMG).setDescription(`**${interaction.user.username}**, here's a full breakdown of your referral earnings.\n\u200b`).addFields({name:"💰  Balance",value:`**${bal} pts**  \u00b7  **${pointsToDollars(bal)}**`,inline:true},{name:"👥  Referred",value:`**${referredCount}** member${referredCount!==1?"s":""}`,inline:true},{name:"💵  All-Time Paid",value:`**${pointsToDollars(paid)}**`,inline:true},{name:"📬  Withdraw Status",value:withdrawStatusMp,inline:false},{name:"📋  Recent Activity",value:historyText,inline:false}).setImage(IMG.BANNER).setFooter({text:"Konvert Referral Program  \u00b7  10 pts = $1  \u00b7  Min: 50 pts"}).setTimestamp();
        const components=[];
        if(readyToWithdraw){components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("btn_request_payout").setLabel("Request Payout").setEmoji("💸").setStyle(ButtonStyle.Success)));}
        return interaction.editReply({embeds:[embed],components});
      }

      if(cmd==="postref"){
        const embed=new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO}).setTitle("\uD83D\uDD17  Konvert Referral Program").setThumbnail(IMG.LOGO).setDescription("**Refer people to Konvert and earn real money every time they trade.**\n\nShare your link. When someone joins and completes a trade, you earn points automatically. No manual tracking, no asking staff.\n\u200b").addFields({name:"💸  How Points Work",value:`> **${POINTS_PER_100} points** earned per **$100** your referral exchanges\n> **${POINTS_PER_DOLLAR} points = $1**\n> Minimum payout: **${MIN_WITHDRAW_POINTS} points = $${(MIN_WITHDRAW_POINTS/POINTS_PER_DOLLAR).toFixed(0)}**\n\u200b`,inline:false},{name:"📋  Example",value:`> Referral completes a **$500** trade\n> You earn **${calcReferralPoints(500)} points** ($${pointsToDollars(calcReferralPoints(500))})\n> Lands in your balance instantly\n\u200b`,inline:false},{name:"⚡  Commands",value:"`/referral` \u2014 Get your invite link + view balance\n`/mypoints` \u2014 Full history, balance, request payout\n`/referraltop` \u2014 Top referrers leaderboard\n\u200b",inline:false},{name:"📬  You Get a DM Every Time",value:"\u2014 Someone joins using your link\n\u2014 They complete a trade (points shown)\n\u2014 Your payout is processed\n\u200b",inline:false},{name:"💡  No Limits",value:"Refer as many people as you want. Every trade they ever complete earns you points forever.\n\u200b",inline:false}).setImage(IMG.BANNER).setFooter({text:"Konvert Referrals  \u2022  Earn while your network trades"}).setTimestamp();
        const refRow=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("btn_get_referral_link").setLabel("Get My Referral Link").setEmoji("\uD83D\uDD17").setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId("btn_check_points").setLabel("Check My Points").setEmoji("💰").setStyle(ButtonStyle.Secondary));
        await interaction.channel.send({embeds:[embed],components:[refRow]});
        return interaction.reply({content:"Referral program embed posted.",ephemeral:true});
      }

      if(cmd==="adjustpoints"){
        await interaction.deferReply({ephemeral:true});
        const target=interaction.options.getUser("user"),amount=interaction.options.getNumber("amount"),reason=interaction.options.getString("reason")||"Staff adjustment";
        if(amount===0)return interaction.editReply({content:"Amount cannot be 0.",ephemeral:true});
        const ref=getReferrals();
        if(!ref.points[target.id])ref.points[target.id]={balance:0,paid:0,history:[],pendingPayout:false};
        const before=ref.points[target.id].balance;
        ref.points[target.id].balance=Math.max(0,before+amount);
        ref.points[target.id].history.push({type:"adjustment",points:amount,reason,by:interaction.user.id,at:Date.now()});
        saveReferrals(ref);
        const after=ref.points[target.id].balance;
        try{const u=await client.users.fetch(target.id);await u.send({embeds:[new EmbedBuilder().setColor(amount>0?0x7C4DFF:0xef4444).setAuthor({name:"Konvert  \u00b7  Referral Program",iconURL:PTS_IMG}).setTitle("Points Adjusted by Staff").setThumbnail(PTS_IMG).setDescription(`A staff member has adjusted your referral points balance.\n\u200b`).addFields({name:"Adjustment",value:`**${amount>0?"+":""}${amount} pts**`,inline:true},{name:"New Balance",value:`**${after} pts** (${pointsToDollars(after)})`,inline:true},{name:"Reason",value:reason,inline:false}).setFooter({text:"Konvert Referral Program"}).setTimestamp()]});}catch{}
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert  \u00b7  Referral Admin",iconURL:PTS_IMG}).setTitle("Points Adjusted").setThumbnail(target.displayAvatarURL({size:128})).setDescription(`Referral points adjusted for <@${target.id}>.\n\u200b`).addFields({name:"Before",value:`**${before} pts**`,inline:true},{name:"Adjustment",value:`**${amount>0?"+":""}${amount} pts**`,inline:true},{name:"After",value:`**${after} pts** (${pointsToDollars(after)})`,inline:true},{name:"Reason",value:reason,inline:false}).setFooter({text:`Adjusted by ${interaction.user.tag}  \u00b7  Konvert Referral Program`}).setTimestamp()]});
      }

      if(cmd==="blacklistref"){
        await interaction.deferReply({ephemeral:true});
        const target=interaction.options.getUser("user"),reason=interaction.options.getString("reason")||"No reason given";
        const ref=getReferrals();if(!ref.blacklist)ref.blacklist={};ref.blacklist[target.id]={reason,by:interaction.user.tag,at:Date.now()};saveReferrals(ref);
        try{const u=await client.users.fetch(target.id);await u.send({embeds:[new EmbedBuilder().setColor(0xef4444).setAuthor({name:"Konvert  \u00b7  Referral Program",iconURL:PTS_IMG}).setTitle("Referral Access Removed").setDescription(`Your access to the Konvert referral program has been removed by staff.\n**Reason:** ${reason}\n\nContact support if you believe this is a mistake.`).setFooter({text:"Konvert Referral Program"}).setTimestamp()]});}catch{}
        return interaction.editReply({content:`**${target.username}** has been blacklisted from the referral program. Reason: ${reason}`,ephemeral:true});
      }

      if(cmd==="unblacklistref"){await interaction.deferReply({ephemeral:true});const target=interaction.options.getUser("user");const ref=getReferrals();if(!ref.blacklist)ref.blacklist={};delete ref.blacklist[target.id];saveReferrals(ref);return interaction.editReply({content:`**${target.username}** has been removed from the referral blacklist.`,ephemeral:true});}

      if(cmd==="referraltop"){
        await interaction.deferReply();
        const ref=getReferrals();
        const entries=Object.entries(ref.points||{}).map(([uid,data])=>({uid,balance:data.balance||0,paid:data.paid||0,total:(data.balance||0)+(data.paid||0)})).filter(e=>e.total>0).sort((a,b)=>b.total-a.total).slice(0,10);
        if(!entries.length){return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert  \u00b7  Referral Program",iconURL:PTS_IMG}).setTitle("Referral Leaderboard").setThumbnail(PTS_IMG).setDescription("No referral activity yet. Be the first to refer someone and start earning.\n\nUse `/referral` to get your personal invite link.\n\u200b").setImage(IMG.BANNER).setFooter({text:"Konvert Referral Program  \u00b7  Top referrers by lifetime points"}).setTimestamp()]});}
        const medals=["🥇","🥈","🥉"];
        const lines=entries.map((e,i)=>{const referredCount=Object.values(ref.referred).filter(r=>r===e.uid).length;return `${medals[i]||`**${i+1}.**`}  <@${e.uid}>  \u2014  **${e.balance} pts bal**  \u00b7  **$${pointsToDollars(e.total)}** earned  \u00b7  ${referredCount} referred`;}).join("\n");
        const totalPts=entries.reduce((s,e)=>s+e.total,0);
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert  \u00b7  Referral Program",iconURL:PTS_IMG}).setTitle("Referral Leaderboard").setDescription(`Ranked by lifetime points earned. Top ${entries.length} referrers at Konvert.\n\u200b`).setThumbnail(PTS_IMG).addFields({name:"Rankings",value:lines||"No referral activity yet.",inline:false}).setImage(IMG.BANNER).setFooter({text:`${totalPts} total pts earned  \u00b7  Konvert Referral Program`}).setTimestamp()]});
      }

      if(cmd==="referraladmin"){
        await interaction.deferReply({ephemeral:true});
        const ref=getReferrals();
        const pending=Object.entries(ref.points||{}).filter(([,d])=>(d.balance||0)>=MIN_WITHDRAW_POINTS).sort((a,b)=>(b[1].balance||0)-(a[1].balance||0));
        if(!pending.length){return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert  \u00b7  Referral Admin",iconURL:PTS_IMG}).setTitle("Pending Payouts").setThumbnail(PTS_IMG).setDescription("No pending payouts at this time.\n\nAll referrers are either below the **"+MIN_WITHDRAW_POINTS+" pt** minimum or already paid out.\n\u200b").setFooter({text:"Konvert Referral Program  \u00b7  Admin Panel"}).setTimestamp()]});}
        const lines=pending.map(([uid,d],i)=>{const referredCount=Object.values(ref.referred).filter(r=>r===uid).length;const flag=d.pendingPayout?"⏳":"💰";return `${flag} **${i+1}.** <@${uid}>  \u2014  **${d.balance} pts** ($${pointsToDollars(d.balance)})  \u00b7  ${referredCount} referred`;}).join("\n");
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert  \u00b7  Referral Admin",iconURL:PTS_IMG}).setTitle("Pending Payouts").setThumbnail(PTS_IMG).setDescription(`**${pending.length}** referrer${pending.length!==1?"s":""} with **${MIN_WITHDRAW_POINTS}+ pts** ready for payout.\nUse \`/paypoints @user\` to mark as paid and notify them.\n\u200b`).addFields({name:"Queue",value:lines,inline:false}).setImage(IMG.BANNER).setFooter({text:`Konvert Referral Program  \u00b7  Admin Panel  \u00b7  ${pending.length} pending`}).setTimestamp()]});
      }

      if(cmd==="paypoints"){
        await interaction.deferReply({ephemeral:true});
        const target=interaction.options.getUser("user"),ref=getReferrals(),data=ref.points[target.id];
        if(!data||!data.balance||data.balance<=0){return interaction.editReply({content:`**${target.username}** has no points to pay out.`,ephemeral:true});}
        const paidPts=data.balance,paidUSD=pointsToDollars(paidPts);
        data.paid=(data.paid||0)+paidPts;data.history=(data.history||[]);data.history.push({type:"paid",points:paidPts,at:Date.now(),paidBy:interaction.user.id});data.balance=0;data.pendingPayout=false;ref.points[target.id]=data;saveReferrals(ref);
        try{await target.send({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert  \u00b7  Referral Program",iconURL:PTS_IMG}).setTitle("Payout Complete").setThumbnail(PTS_IMG).setDescription(`Your referral points have been paid out. Thank you for growing the Konvert community!\n\u200b`).addFields({name:"💰  Points Paid",value:`**${paidPts} pts**`,inline:true},{name:"💵  USD Value",value:`**${paidUSD}**`,inline:true},{name:"💳  Processed By",value:`<@${interaction.user.id}>`,inline:true},{name:"📊  New Balance",value:"**0 pts**",inline:true},{name:"🏆  All-Time Earned",value:`**${pointsToDollars(data.paid)}**`,inline:true}).setImage(IMG.BANNER).setFooter({text:"Konvert Referral Program  \u00b7  Keep sharing your link to keep earning"}).setTimestamp()]});}catch{}
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert  \u00b7  Referral Admin",iconURL:PTS_IMG}).setTitle("Payout Recorded").setThumbnail(target.displayAvatarURL({size:128})).setDescription(`Payout confirmed for <@${target.id}>. They have been notified via DM.\n\u200b`).addFields({name:"💰  Paid Out",value:`**${paidPts} pts** (${paidUSD})`,inline:true},{name:"📊  New Balance",value:"**0 pts**",inline:true},{name:"🏆  All-Time",value:`**${pointsToDollars(data.paid)}**`,inline:true}).setFooter({text:`Processed by ${interaction.user.tag}  \u00b7  Konvert Referral Program`}).setTimestamp()]});
      }

      if(cmd==="calc"){await interaction.deferReply({ephemeral:true});if(!CONFIG.RATES_CHANNEL)return interaction.editReply("RATES_CHANNEL_ID not configured.");const ch=interaction.guild.channels.cache.get(CONFIG.RATES_CHANNEL);if(!ch)return interaction.editReply("Rates channel not found.");const embed=await buildRatesEmbed();if(ratesMsgId){const msg=await ch.messages.fetch(ratesMsgId).catch(()=>null);if(msg){await msg.edit({embeds:[embed]});}else{const s=await ch.send({embeds:[embed]});ratesMsgId=s.id;}}else{const s=await ch.send({embeds:[embed]});ratesMsgId=s.id;}return interaction.editReply("Rates posted.");}
      if(cmd==="setwallet"){const coin=interaction.options.getString("coin").toUpperCase(),addr=interaction.options.getString("address");const w=load("wallets");w[coin]=addr;save("wallets",w);log(interaction.guild,`WALLET: ${interaction.user.tag} set ${coin} to ${addr}`);return interaction.reply({content:`**${coin}** deposit address updated to \`${addr}\``,ephemeral:true});}
      if(cmd==="announce"){const message=interaction.options.getString("message"),channelId=interaction.options.getString("channel"),ping=interaction.options.getString("ping")||"none",ch=interaction.guild.channels.cache.get(channelId);if(!ch)return interaction.reply({content:"Channel not found.",ephemeral:true});const pingStr=ping==="everyone"?"@everyone ":ping==="here"?"@here ":"";await ch.send({content:pingStr||undefined,embeds:[base("Konvert Announcement").setThumbnail(IMG.LOGO).setDescription(message).setFooter({text:`Announced by ${interaction.user.tag}  \u2022  Konvert`})]});return interaction.reply({content:"Announced.",ephemeral:true});}
      if(cmd==="blacklist"){const target=interaction.options.getUser("user"),reason=interaction.options.getString("reason")||"No reason given";const bl=load("blacklist");bl[target.id]={tag:target.tag,reason,by:interaction.user.tag,at:Date.now()};save("blacklist",bl);log(interaction.guild,`BLACKLIST: ${target.tag} -- ${reason}`);return interaction.reply({content:`**${target.tag}** blacklisted. Reason: ${reason}`,ephemeral:true});}
      if(cmd==="unblacklist"){const target=interaction.options.getUser("user");const bl=load("blacklist");delete bl[target.id];save("blacklist",bl);return interaction.reply({content:`**${target.tag}** removed from blacklist.`,ephemeral:true});}
      if(cmd==="closeticket"){
        const reason=interaction.options.getString("reason")||"Deal complete";
        await interaction.deferReply();
        await doCloseTicket(interaction.channel,interaction.guild,interaction.user,reason);
        const isDealComplete=!reason||reason.toLowerCase().includes("complete")||reason.toLowerCase().includes("done");
        const isCancelled=reason.toLowerCase().includes("cancel");
        const closeTitle=isCancelled?"Deal Cancelled":isDealComplete?"Deal Complete":"Ticket Closed";
        await interaction.editReply({embeds:[new EmbedBuilder()
          .setColor(0x7C4DFF)
          .setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO})
          .setTitle(closeTitle)
          .setDescription(`${isCancelled?"This exchange has been cancelled.":"This exchange has been completed and the ticket is now closed."}
Deleting in 10 seconds.`)
          .setTimestamp()]});
        setTimeout(()=>interaction.channel.delete().catch(()=>{}),10000);return;
      }
      if(cmd==="cancelticket"){const reason=interaction.options.getString("reason")||"Cancelled by staff";await interaction.deferReply();const tickets=load("tickets");if(tickets[interaction.channel.id]){tickets[interaction.channel.id].status="cancelled";tickets[interaction.channel.id].cancelledAt=Date.now();save("tickets",tickets);const t=tickets[interaction.channel.id];try{const mem=await interaction.guild.members.fetch(t.userId).catch(()=>null);if(mem)await mem.send({embeds:[base("Ticket Cancelled").setDescription(`Your Konvert exchange ticket has been cancelled by staff.\n**Reason:** ${reason}\n\nIf this is a mistake, please open a new ticket.`).setFooter({text:"Konvert"})]}).catch(()=>{});}catch{}}await interaction.editReply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO}).setTitle("Deal Cancelled").setDescription(`This exchange has been cancelled.${reason&&reason!=="Cancelled by staff"?`\n**Reason:** ${reason}`:""}\nDeleting in 10 seconds.`).setTimestamp()]});log(interaction.guild,`CANCELLED: #${interaction.channel.name} by ${interaction.user.tag}`);setTimeout(()=>interaction.channel.delete().catch(()=>{}),10000);return;}

      if(cmd==="openticket"){
        await interaction.deferReply();
        const allRoleIds=[...Object.values(CONFIG.ROLES),CONFIG.STAFF_ROLE,CONFIG.EXCHANGER_ROLE].filter(Boolean),uniqueRoles=[...new Set(allRoleIds)],addedRoles=[];
        for(const roleId of uniqueRoles){try{const role=await interaction.guild.roles.fetch(roleId).catch(()=>null);if(!role)continue;await interaction.channel.permissionOverwrites.edit(roleId,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true});addedRoles.push(`<@&${roleId}>`);}catch{}}
        await interaction.editReply({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO}).setTitle("Ticket Opened to All Exchangers").setDescription("This ticket is now **visible to all Konvert exchangers**.\n\nAny available handler can step in and assist with this trade.\n\u200b").addFields({name:"Roles Added",value:addedRoles.length?addedRoles.join("  "):"None configured",inline:false}).setFooter({text:"Konvert  \u2022  Open Ticket"}).setTimestamp()]});
        return;
      }

      if(cmd==="note"){const text=interaction.options.getString("text");await interaction.channel.send({embeds:[new EmbedBuilder().setColor(0xFFB347).setAuthor({name:`Staff Note -- ${interaction.user.tag}`,iconURL:interaction.user.displayAvatarURL()}).setDescription(text).setTimestamp().setFooter({text:"Konvert  \u2022  Staff Note"})]});return interaction.reply({content:"Note added.",ephemeral:true});}
      if(cmd==="tradelog"){const limit=interaction.options.getInteger("limit")||5;const done=Object.values(load("tickets")).filter(t=>t.status==="vouched"&&t.completedAt&&t.method!=="adjustment").sort((a,b)=>b.completedAt-a.completedAt).slice(0,limit);if(!done.length)return interaction.reply({content:"No completed exchanges yet.",ephemeral:true});const lines=done.map((t,i)=>{const m=getMethod(t.method);return `**${i+1}.** <@${t.userId}>  \u00b7  ${m?.label||t.method}  \u00b7  ${fmtUSD(t.amountUSD)}  \u00b7  <t:${Math.floor(t.completedAt/1000)}:R>`;}).join("\n");return interaction.reply({embeds:[base(`Last ${done.length} Completed Trades`).setDescription(lines).setFooter({text:"Konvert  \u2022  Trade Log"})],ephemeral:true});}
      if(cmd==="volume"){const all=Object.values(load("tickets")),done=all.filter(t=>t.status==="vouched"&&t.amountUSD&&t.method!=="adjustment"),totalVol=done.reduce((s,t)=>s+(t.amountUSD||0),0),totalFees=done.reduce((s,t)=>s+(t.feeUSD||0),0),open=all.filter(t=>t.status==="open").length,today=done.filter(t=>t.completedAt&&Date.now()-t.completedAt<86400000),methods={};done.forEach(t=>{if(t.method)methods[t.method]=(methods[t.method]||0)+1;});const topMethod=Object.entries(methods).sort((a,b)=>b[1]-a[1])[0];return interaction.reply({embeds:[base("Konvert Volume Stats").setThumbnail(IMG.LOGO).addFields({name:"Total Exchanges",value:`**${done.length}** exchanges`,inline:true},{name:"Total Volume",value:`**${fmtUSD(totalVol)}**`,inline:true},{name:"Total Fees",value:`**${fmtUSD(totalFees)}**`,inline:true},{name:"Open Tickets",value:`**${open}**`,inline:true},{name:"Today's Volume",value:`**${fmtUSD(today.reduce((s,t)=>s+(t.amountUSD||0),0))}** (${today.length} trades)`,inline:true},{name:"Top Method",value:topMethod?`**${getMethod(topMethod[0])?.label||topMethod[0]}** (${topMethod[1]})`:"--",inline:true}).setFooter({text:"Konvert  \u2022  Server Volume Statistics"})],ephemeral:true});}

      if(cmd==="snapshot"){
        await interaction.deferReply({ephemeral:true});
        const guild=interaction.guild,all=Object.values(load("tickets")),done=all.filter(t=>["vouched","completed"].includes(t.status)&&t.amountUSD&&t.method!=="adjustment"),open=all.filter(t=>t.status==="open"&&t.method!=="adjustment");const _snapNow=new Date(),_snapESTMid=new Date(_snapNow);_snapESTMid.setUTCHours(5,0,0,0);if(_snapESTMid>_snapNow)_snapESTMid.setUTCDate(_snapESTMid.getUTCDate()-1);const today=done.filter(t=>t.completedAt&&t.completedAt>=_snapESTMid.getTime()),week=done.filter(t=>t.completedAt&&Date.now()-t.completedAt<7*86400000),totalVol=done.reduce((s,t)=>s+(t.amountUSD||0),0);
        const methods={},coins={},byEx={};done.forEach(t=>{if(t.method)methods[t.method]=(methods[t.method]||0)+1;if(t.coin)coins[t.coin]=(coins[t.coin]||0)+1;if(t.completedBy)byEx[t.completedBy]=(byEx[t.completedBy]||0)+1;});
        const topMethod=Object.entries(methods).sort((a,b)=>b[1]-a[1])[0],topCoin=Object.entries(coins).sort((a,b)=>b[1]-a[1])[0],topEx=Object.entries(byEx).sort((a,b)=>b[1]-a[1])[0];
        await guild.members.fetch();
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert  \u2022  Server Snapshot",iconURL:IMG.LOGO}).setTitle("Server Snapshot").setThumbnail(IMG.LOGO).setDescription(`Snapshot taken <t:${Math.floor(Date.now()/1000)}:F>\n\u200b`).addFields({name:"\uD83D\uDC65  Members",value:`**${guild.memberCount}**`,inline:true},{name:"\uD83C\uDF9F  Open Tickets",value:`**${open.length}**`,inline:true},{name:"\u2705  Completed",value:`**${done.length}** exchanges`,inline:true},{name:"\uD83D\uDCB0  Total Volume",value:`**${fmtUSD(totalVol)}**`,inline:true},{name:"\uD83D\uDCC5  Today (EST)",value:`**${today.length}** trades  \u00b7  ${fmtUSD(today.reduce((s,t)=>s+(t.amountUSD||0),0))}`,inline:true},{name:"\uD83D\uDCC6  This Week",value:`**${week.length}** trades  \u00b7  ${fmtUSD(week.reduce((s,t)=>s+(t.amountUSD||0),0))}`,inline:true},{name:"\uD83D\uDCB3  Top Method",value:topMethod?`**${getMethod(topMethod[0])?.label||topMethod[0]}** (${topMethod[1]})`:"--",inline:true},{name:"\uD83E\uDE99  Top Coin",value:topCoin?`**${topCoin[0]}** (${topCoin[1]})`:"--",inline:true},{name:"\uD83C\uDFC6  Top Exchanger",value:topEx?`<@${topEx[0]}> (${topEx[1]} trades)`:"--",inline:true}).setFooter({text:"Konvert  \u2022  Snapshot"}).setTimestamp()]});
      }

      if(cmd==="exchangerboard"){const done=Object.values(load("tickets")).filter(t=>t.status==="vouched"&&t.completedBy&&t.method!=="adjustment"),byEx={};done.forEach(t=>{if(!byEx[t.completedBy])byEx[t.completedBy]={trades:0,volume:0};byEx[t.completedBy].trades+=1;byEx[t.completedBy].volume+=(t.amountUSD||0);});const ranked=Object.entries(byEx).sort((a,b)=>b[1].trades-a[1].trades).slice(0,10);if(!ranked.length)return interaction.reply({content:"No completed exchanges yet.",ephemeral:true});const medals=["\uD83E\uDD47","\uD83E\uDD48","\uD83E\uDD49"];const lines=ranked.map(([uid,d],i)=>`${medals[i]||`**${i+1}.**`}  <@${uid}>  --  **${d.trades}** exchange${d.trades!==1?"s":""}  \u00b7  ${fmtUSD(d.volume)}`).join("\n");return interaction.reply({embeds:[base("Exchanger Leaderboard").setThumbnail(IMG.LOGO).setDescription("Top Konvert exchangers ranked by completed trades.\n\u200b").addFields({name:"Rankings",value:lines,inline:false}).setFooter({text:"Konvert  \u2022  Exchanger Leaderboard"}).setTimestamp()],ephemeral:true});}

      if(cmd==="thankclient"){
        const target=interaction.options.getUser("client"),amount=interaction.options.getNumber("amount")||null;
        const vol=getUserVolume(target.id),clientDone=Object.values(load("tickets")).filter(t=>t.userId===target.id&&t.status==="vouched"&&t.method!=="adjustment");
        const tradeCount=clientDone.length,tier=getTier(vol),feePreview=amount?`Your rate on your next **${fmtUSD(amount)}** trade: **${feeRate(amount,"send")}%**`:null;
        try{await target.send({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO}).setTitle("Thank You for Trading with Us").setThumbnail(IMG.LOGO).setDescription(`Hey <@${target.id}> -- your trade has been completed successfully.\n\nWe appreciate your trust in **Konvert Exchange**. Every deal matters to us and we look forward to trading with you again.\n\u200b`).addFields({name:"Your Tier",value:`${tier.emoji} **${tier.label}**`,inline:true},{name:"Trades With Us",value:`**${tradeCount}** exchanges`,inline:true},{name:"Total Exchanged",value:vol>0?`**${fmtUSD(vol)}**`:"--",inline:true},{name:"Come Back Anytime",value:"Head to our exchange channel anytime.\n**Fast  \u00b7  Safe  \u00b7  Simple  \u00b7  Private**",inline:false},...(feePreview?[{name:"Your Rate Preview",value:feePreview,inline:false}]:[])).setImage(IMG.DEAL).setFooter({text:"Konvert Exchange  \u2022  Thank you for your business"}).setTimestamp()]});return interaction.reply({content:`Thank-you card sent to **${target.tag}**.`,ephemeral:true});}
        catch{return interaction.reply({content:`Could not DM **${target.tag}**. They may have DMs disabled.`,ephemeral:true});}
      }

      if(cmd==="passes"){const holders=Object.entries(state.passes).filter(([,v])=>v>0);if(!holders.length)return interaction.reply({content:"No exchange passes have been won yet.",ephemeral:true});return interaction.reply({embeds:[base("Exchange Pass Holders").setThumbnail(IMG.LOGO).setDescription(holders.map(([uid,c])=>`<@${uid}> -- **${c}** pass${c!==1?"es":""}`).join("\n")).setFooter({text:"Konvert Mine  \u2022  Won by finding all 3 diamonds"})],ephemeral:true});}
      if(cmd==="lookup"){const query=interaction.options.getString("name").toLowerCase().trim(),tickets=load("tickets"),match=Object.entries(tickets).find(([id,t])=>{const chName=interaction.guild.channels.cache.get(id)?.name||"";return chName.includes(query)||id===query;});if(!match)return interaction.reply({content:`No ticket found matching **${query}**.`,ephemeral:true});const [channelId,t]=match,m=getMethod(t.method),se=t.status==="vouched"?"\u2705":t.status==="open"?"\uD83D\uDFE1":"\uD83D\uDD34";return interaction.reply({embeds:[base("Ticket Lookup").setThumbnail(IMG.LOGO).addFields({name:"Client",value:`<@${t.userId}>`,inline:true},{name:"Status",value:`${se} **${t.status==="vouched"?"Exchanges":t.status==="open"?"Open":"Closed"}**`,inline:true},{name:"Method",value:m?.label||t.method,inline:true},{name:"Amount",value:fmtUSD(t.amountUSD||0),inline:true},{name:"Coin",value:t.coin||"--",inline:true},{name:"Opened",value:t.createdAt?`<t:${Math.floor(t.createdAt/1000)}:R>`:"--",inline:true},{name:"Exchanges",value:t.completedAt?`<t:${Math.floor(t.completedAt/1000)}:R>`:"--",inline:true},{name:"Channel",value:`<#${channelId}>`,inline:true}).setFooter({text:"Konvert  \u2022  Ticket Lookup"})],ephemeral:true});}
      if(cmd==="postkonvault"){const inviteUrl="https://discord.gg/jnT63k4UA7";const embed=new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO}).setTitle("\uD83D\uDE80  Konvault\u2122").setDescription("**The Ultimate Crypto Wagering Hub**\n-- Owned by Konvert Exchange\n-- Free MM service  \u00b7  0% fee\n\n*Flip, win, repeat. It's that simple.*\n\u200b").addFields({name:"What We Offer",value:"\uD83D\uDCB0  Choose any amount of crypto to wager\n\uD83E\uDE99  Fair coin flips -- winner takes all\n\uD83D\uDD12  Funds securely held by trusted middlemen\n\u26A1  Active agents & support 24/7\n\uD83C\uDF10  Supports ALL cryptocurrencies\n\u2705  0 fees -- tips are always welcome",inline:false},{name:"\uD83C\uDF89  Join Now",value:"Click the button below to join Konvault and start flipping!",inline:false}).setImage(IMG.BANNER).setFooter({text:"Konvault by Konvert Exchange  \u2022  Free MM  \u2022  0% Fee"}).setTimestamp();await interaction.channel.send({embeds:[embed],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel("Join Konvault").setEmoji("\uD83D\uDE80").setStyle(ButtonStyle.Link).setURL(inviteUrl))]});return interaction.reply({content:"Konvault embed posted.",ephemeral:true});}
      if(cmd==="postinfo"){const embed=new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO}).setTitle("Info").setThumbnail(IMG.LOGO).setDescription("Konvert is a **fast and reliable exchange community** for converting value across platforms.\n\nEasily exchange **PayPal, Crypto, Cash App, Zelle, E-Transfer**, and other payment methods -- both directions -- with **low fees** and **quick processing**.\n\nOur agents are available **24/7**, backed by a friendly, active community and real-time crypto price updates to keep you informed.\n\u200b").addFields({name:"\uD83D\uDCB8  Fees",value:"5% - 10%  \u00b7  Tiered by amount  \u00b7  Min $5",inline:true},{name:"\u26A1  Speed",value:"Usually under 10 minutes",inline:true},{name:"\uD83E\uDD1D  Support",value:"24/7 agents always available",inline:true}).setImage(IMG.BANNER).setFooter({text:"Konvert Exchange  \u2022  Fast  \u00b7  Safe  \u00b7  Simple  \u00b7  Private"});await interaction.channel.send({embeds:[embed]});return interaction.reply({content:"Info embed posted.",ephemeral:true});}
      if(cmd==="posttos"){
        const embed=new EmbedBuilder()
          .setColor(CONFIG.COLOR)
          .setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO})
          .setTitle("Terms of Service")
          .setThumbnail(IMG.LOGO)
          .setDescription("By using Konvert's services you agree to the following. These terms protect everyone involved and keep trades running smoothly.\n\u200b")
          .addFields(
            {name:"1. Use of Service",
             value:"Konvert is available to anyone who can legally exchange cryptocurrency in their country. We reserve the right to refuse service to anyone at any time without explanation. Do not use Konvert for fraud, money laundering, or chargebacks.",
             inline:false},
            {name:"2. Fees",
             value:"Every trade has a service fee that is shown to you before you confirm. The minimum fee is $5. Once both sides confirm a trade is done, the fee is non-refundable. If we made an error on our end, reach out within 24 hours.",
             inline:false},
            {name:"3. Stay on Platform",
             value:"All trades must go through Konvert's official ticket system. Anything arranged outside of this server is entirely at your own risk — we won't help or compensate for off-platform deals gone wrong.",
             inline:false},
            {name:"4. Use a Middleman",
             value:"A middleman is required on all trades unless an owner specifically says otherwise inside your ticket. Staff will never DM you first. If someone messages you claiming to be Konvert, ignore them and report it.",
             inline:false},
            {name:"5. Disputes",
             value:"If something goes wrong, flag it inside your ticket. We'll review it and make a call. Abusing the dispute process, filing false claims, or trying to scam will get you permanently banned.",
             inline:false},
            {name:"6. Liability",
             value:"Konvert is a middleman service. We are not responsible for losses caused by market swings, mistakes you make, or anything outside our control. Trade at your own risk.",
             inline:false},
          )
          .setImage(IMG.BANNER)
          .setFooter({text:"Konvert Exchange  \u2022  Using our service means you accept these terms"});
        await interaction.channel.send({embeds:[embed]});
        return interaction.reply({content:"Terms of Service embed posted.",ephemeral:true});
      }
      if(cmd==="postlinks"){const embed=new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO}).setTitle("Official Links for Konvert").setThumbnail(IMG.LOGO).setDescription("All official Konvert social media. Follow us for updates, announcements, and giveaways.\n\u200b").addFields({name:"\uD835\uDD4F  Twitter / X",value:"[**@KonvertNow**](https://x.com/konvertnow)",inline:true},{name:"\uD83D\uDCF8  Instagram",value:"[**@KonvertNow**](https://www.instagram.com/konvertnow/)",inline:true},{name:"\u26A0\uFE0F  Stay Safe",value:"Only interact with accounts listed here. Any other account claiming to be Konvert is an impersonator.",inline:false}).setImage(IMG.BANNER).setFooter({text:"Konvert  \u2022  Official Links  \u2022  Follow us for updates"});await interaction.channel.send({embeds:[embed]});return interaction.reply({content:"Official links embed posted.",ephemeral:true});}

      if(cmd==="adjuststats"){
        const target=interaction.options.getUser("user"),amount=interaction.options.getNumber("amount"),reason=interaction.options.getString("reason")||"Staff adjustment";
        if(amount===0)return interaction.reply({content:"Amount cannot be 0.",ephemeral:true});
        const tickets=Object.keys(_mem.tickets||{}).length>0?{..._mem.tickets}:load("tickets");
        const key=`adj_${target.id}_${Date.now()}`;
        tickets[key]={userId:target.id,userTag:target.tag||target.username,method:"adjustment",direction:null,coin:null,amountUSD:amount,feeUSD:0,walletInfo:"staff",notes:reason,status:"vouched",completedBy:interaction.user.id,completedAt:Date.now(),createdAt:Date.now()};
        _mem.tickets=tickets;save("tickets",tickets);
        updateStatChannel(interaction.guild).catch(()=>{});
        const newVol=getUserVolume(target.id);await applyTierRole(interaction.guild,target.id,newVol);
        const tier=getTier(newVol);
        log(interaction.guild,`ADJUSTSTATS: ${interaction.user.tag} adjusted ${target.tag||target.username} by ${amount>0?"+":""}${fmtUSD(amount)} | New total: ${fmtUSD(newVol)} | Reason: ${reason}`);
        return interaction.reply({embeds:[base("Stats Adjusted").setThumbnail(target.displayAvatarURL({size:128})).setDescription(`Stats updated for <@${target.id}>.\n\u200b`).addFields({name:"Adjustment",value:`**${amount>0?"+":""}${fmtUSD(amount)}**`,inline:true},{name:"New Volume",value:`**${fmtUSD(newVol)}**`,inline:true},{name:"New Tier",value:`${tier.emoji} **${tier.label}**`,inline:true},{name:"Reason",value:reason,inline:false}).setFooter({text:`Adjusted by ${interaction.user.tag}  \u2022  Konvert`})],ephemeral:true});
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
        const ref=getReferrals();delete ref.points[target.id];saveReferrals(ref);
        try{const member=await interaction.guild.members.fetch(target.id).catch(()=>null);if(member){for(const t of TIERS){if(t.role&&member.roles.cache.has(t.role))await member.roles.remove(t.role).catch(()=>{});}}}catch{}
        await applyTierRole(interaction.guild,target.id,0);
        return interaction.reply({content:`\u2705 All stats wiped for **${target.tag||target.username}**. Removed **${removed}** entries, cleared adjustments, reset tier to New Client.`,ephemeral:true});
      }

      if(cmd==="clearleaderboard"){
        await interaction.deferReply({ephemeral:true});
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
        return interaction.editReply(`✅ Cleared ${_before} entries. All tier roles removed.`);
      }

      if(cmd==="search"){
        await interaction.deferReply({ephemeral:true});
        const target=interaction.options.getUser("user");
        const allT=Object.entries(_mem.tickets&&Object.keys(_mem.tickets).length?_mem.tickets:load("tickets"));
        const userTickets=allT.filter(([,t])=>t.userId===target.id).sort((a,b)=>(b[1].createdAt||0)-(a[1].createdAt||0));
        if(!userTickets.length)return interaction.editReply({content:`No tickets found for **${target.username}**.`,ephemeral:true});
        const volume=getUserVolume(target.id),tier=getTier(volume);
        const completed=userTickets.filter(([,t])=>["vouched","completed"].includes(t.status)&&t.method!=="adjustment");
        const adjustments=userTickets.filter(([,t])=>t.method==="adjustment");
        const adjTotal=adjustments.reduce((s,[,t])=>s+(parseFloat(t.amountUSD)||0),0);
        const open=userTickets.filter(([,t])=>t.status==="open");
        const lines=userTickets.slice(0,8).map(([id,t])=>{const m=getMethod(t.method);const statusEmoji=t.status==="vouched"?"\u2705":t.status==="open"?"\uD83D\uDFE1":t.status==="cancelled"?"\uD83D\uDEAB":"\uD83D\uDD34";const amt=t.method==="adjustment"?(parseFloat(t.amountUSD)>0?"+":"")+`${fmtUSD(parseFloat(t.amountUSD))}`:fmtUSD(t.amountUSD||0);return `${statusEmoji} **${m?.label||t.method||"\u2014"}**  \u00b7  ${amt}  \u00b7  <t:${Math.floor((t.createdAt||Date.now())/1000)}:d>`;}).join("\n");
        const vipActive=isVipVolume(volume);
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert  \u00b7  User Search",iconURL:IMG.LOGO}).setTitle(`${target.username}'s Full History`).setThumbnail(target.displayAvatarURL({size:256})).setDescription(`${tier.emoji} **${tier.label}**${vipActive?" \u26A1 VIP":""}\n\u200b`).addFields({name:"\uD83D\uDCB0  Total Volume",value:`**${fmtUSD(volume)}**`,inline:true},{name:"\u2705  Completed",value:`**${completed.length}** trade${completed.length!==1?"s":""}`,inline:true},{name:"\uD83D\uDFE1  Open",value:`**${open.length}**`,inline:true},{name:"\uD83D\uDCCA  Adjustments",value:adjustments.length?`**${adjustments.length}** entries  \u00b7  net ${adjTotal>=0?"+":""}${fmtUSD(adjTotal)}`:"None",inline:true},{name:"\u26A1  VIP Discount",value:vipActive?"Active \u2014 0.75% off all trades":"Not yet (requires $7,000+)",inline:true},{name:"\uD83D\uDD17  Referred By",value:(()=>{const r=getReferrals();const ref=r.referred[target.id];return ref?`<@${ref}>`:"No referral";})(),inline:true},{name:`Last ${Math.min(userTickets.length,8)} Tickets`,value:lines||"\u2014",inline:false}).setFooter({text:`${userTickets.length} total tickets  \u00b7  Konvert Exchange`}).setTimestamp()]});
      }

      if(cmd==="vipstatus"){
        await interaction.deferReply({ephemeral:true});
        const vol=getUserVolume(interaction.user.id),vip=isVipVolume(vol),tier=getTier(vol),needed=vip?0:Math.max(7000-vol,0);
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange  \u00b7  VIP Status",iconURL:IMG.LOGO}).setTitle(vip?"\u26A1  VIP Rate Active":"VIP Rate \u2014 Not Yet Unlocked").setThumbnail(IMG.LOGO).setDescription(vip?"Your account has been upgraded. You receive a **0.75% fee discount** on every trade automatically.\n\u200b":`You're **${fmtUSD(needed)}** away from unlocking VIP status and a permanent fee discount.\n\u200b`).addFields({name:"Your Tier",value:`${tier.emoji} **${tier.label}**`,inline:true},{name:"Your Volume",value:`**${fmtUSD(vol)}**`,inline:true},{name:"VIP Threshold",value:"**$7,000+** (\u26A1 Godly Client)",inline:true},{name:"VIP Perk",value:"**0.75% off** every trade \u2014 both directions, automatically applied",inline:false}).setImage(IMG.BANNER).setFooter({text:"Konvert Exchange  \u00b7  VIP benefits apply to all future trades"}).setTimestamp()]});
      }

      if(cmd==="wipestats"){
        await interaction.deferReply({ephemeral:true});
        const target=interaction.options.getUser("user"),confirm=interaction.options.getString("confirm");
        if(confirm!=="CONFIRM"){return interaction.editReply({content:'\u274C You must type **CONFIRM** exactly in the confirm field to wipe a user. This cannot be undone.',ephemeral:true});}
        const tickets=Object.keys(_mem.tickets||{}).length>0?{..._mem.tickets}:load("tickets");
        let removed=0;
        for(const [key,t] of Object.entries(tickets)){if(t.userId===target.id){delete tickets[key];removed++;}}
        _mem.tickets=tickets;save("tickets",tickets);
        dbSet("konvert_tickets",tickets).catch(()=>{});
        const ref=getReferrals();delete ref.points[target.id];delete ref.referred[target.id];
        for(const [code,uid] of Object.entries(ref.invites||{})){if(uid===target.id)delete ref.invites[code];}
        delete ref.inviteCodes[target.id];saveReferrals(ref);
        try{const member=await interaction.guild.members.fetch(target.id).catch(()=>null);if(member){for(const t of TIERS){if(t.role&&member.roles.cache.has(t.role))await member.roles.remove(t.role).catch(()=>{});}}}catch{}
        try{await target.send({embeds:[new EmbedBuilder().setColor(0xef4444).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO}).setTitle("Account Reset").setDescription("Your exchange history and stats have been reset by staff.\n\nIf you believe this is a mistake, please open a support ticket.").setFooter({text:"Konvert Exchange"}).setTimestamp()]});}catch{}
        delete state.volumeAdj[target.id];
        updateStatChannel(interaction.guild).catch(()=>{});
        log(interaction.guild,`WIPESTATS: ${interaction.user.tag} wiped ALL data for ${target.tag||target.username} \u2014 ${removed} entries removed`);
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(0xef4444).setAuthor({name:"Konvert  \u00b7  Admin",iconURL:IMG.LOGO}).setTitle("User Wiped").setThumbnail(target.displayAvatarURL({size:128})).setDescription(`All data for <@${target.id}> has been permanently removed.\n\u200b`).addFields({name:"Entries Removed",value:`**${removed}**`,inline:true},{name:"Referral Points",value:"**Cleared**",inline:true},{name:"Tier Roles",value:"**Removed**",inline:true}).setFooter({text:`Wiped by ${interaction.user.tag}  \u00b7  Konvert Exchange`}).setTimestamp()]});
      }

      if(cmd==="complete"){
        await interaction.deferReply();
        const tickets=Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets");
        const ticket=tickets[interaction.channel.id];
        if(!ticket)return interaction.editReply({content:"❌ No ticket found for this channel.",ephemeral:true});
        if(ticket.status==="vouched"||ticket.status==="closed")return interaction.editReply({content:"❌ This exchange is already complete.",ephemeral:true});
        const exchanger=interaction.options.getUser("exchanger");
        const amountOverride=interaction.options.getNumber("amount");
        if(amountOverride&&amountOverride>0)ticket.amountUSD=amountOverride;
        ticket._overrideExchangerId=exchanger.id;
        await completeTrade(interaction,ticket,tickets);
        return;
      }

      if(cmd==="dispute"){
        await interaction.deferReply({ephemeral:true});
        const tickets=Object.keys(_mem.tickets||{}).length?_mem.tickets:load("tickets");
        const ticket=Object.entries(tickets).find(([id,t])=>id===interaction.channel.id&&t.status==="open");
        if(!ticket){return interaction.editReply({content:"This command can only be used inside your open ticket channel.",ephemeral:true});}
        const [channelId,t]=ticket;
        try{await interaction.channel.permissionOverwrites.edit(interaction.user.id,{SendMessages:false});if(CONFIG.EXCHANGER_ROLE)await interaction.channel.permissionOverwrites.edit(CONFIG.EXCHANGER_ROLE,{SendMessages:false}).catch(()=>{});}catch{}
        await interaction.channel.send({embeds:[new EmbedBuilder().setColor(0xef4444).setAuthor({name:"Konvert Exchange  \u00b7  Dispute Filed",iconURL:IMG.LOGO}).setTitle("\u26A0\uFE0F  Dispute Filed").setDescription(`<@${interaction.user.id}> has flagged an issue with this trade.\n\nThis ticket has been **locked** pending staff review. Only owners can unlock it.\n\u200b`).addFields({name:"Filed By",value:`<@${interaction.user.id}>`,inline:true},{name:"Time",value:`<t:${Math.floor(Date.now()/1000)}:F>`,inline:true},{name:"Status",value:"\uD83D\uDD34 **Under Review**",inline:true}).setFooter({text:"Konvert Exchange  \u00b7  Do not close this ticket until resolved"}).setTimestamp()]});
        tickets[channelId].status="dispute";_mem.tickets=tickets;save("tickets",tickets);
        for(const oid of CONFIG.OWNER_IDS){try{const owner=await client.users.fetch(oid);await owner.send({embeds:[new EmbedBuilder().setColor(0xef4444).setAuthor({name:"Konvert  \u00b7  Dispute Alert",iconURL:IMG.LOGO}).setTitle("\u26A0\uFE0F  Dispute Filed").setDescription(`A client has filed a dispute in a ticket.\n\u200b`).addFields({name:"Client",value:`<@${interaction.user.id}>`,inline:true},{name:"Channel",value:`<#${channelId}>`,inline:true},{name:"Method",value:getMethod(t.method)?.label||t.method||"\u2014",inline:true},{name:"Amount",value:fmtUSD(t.amountUSD||0),inline:true}).setFooter({text:"Konvert Exchange  \u00b7  Review immediately"}).setTimestamp()]});}catch{}}
        log(interaction.guild,`DISPUTE: ${interaction.user.tag} filed dispute in #${interaction.channel.name}`);
        return interaction.editReply({content:"Your dispute has been filed. Staff have been notified and will review shortly. The ticket has been locked.",ephemeral:true});
      }

      if(cmd==="broadcast"){
        await interaction.deferReply({ephemeral:true});
        const days=interaction.options.getInteger("days")||30;
        const msg=interaction.options.getString("message");
        const cutoff=Date.now()-(days*24*60*60*1000);
        const allT=Object.values(_mem.tickets&&Object.keys(_mem.tickets).length?_mem.tickets:load("tickets"));
        const uniqueIds=[...new Set(allT.filter(t=>["vouched","completed"].includes(t.status)&&(t.completedAt||0)>=cutoff&&t.method!=="adjustment").map(t=>t.userId))];
        if(!uniqueIds.length)return interaction.editReply({content:`No clients found who traded in the last ${days} days.`});
        await interaction.editReply({content:`\uD83D\uDCE8 Sending to **${uniqueIds.length}** clients...`});
        let sent=0,failed=0;
        for(const uid of uniqueIds){try{const u=await client.users.fetch(uid);await u.send({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO}).setTitle("Message from Konvert").setDescription(msg).setImage(IMG.BANNER).setFooter({text:"Konvert Exchange  \u00b7  Thank you for trading with us"}).setTimestamp()]});sent++;await new Promise(r=>setTimeout(r,800));}catch{failed++;}}
        return interaction.followUp({content:`\u2705 Broadcast complete \u2014 **${sent}** sent, **${failed}** failed (DMs closed).`,ephemeral:true});
      }

      if(cmd==="mytrades"){
        await interaction.deferReply({ephemeral:true});
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
        if(!done.length){return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange  \u00b7  My Trades",iconURL:IMG.LOGO}).setTitle("No Trades Yet").setDescription("You haven't completed any trades with Konvert yet.\n\nHead to the exchange channel to get started.\n\u200b").setImage(IMG.BANNER).setFooter({text:"Konvert Exchange"}).setTimestamp()]});}
        const last5=done.slice(0,5).map((t,i)=>{const m=getMethod(t.method);return `${i+1}. **${m?.label||t.method}** \u00b7 ${fmtUSD(t.amountUSD)} \u00b7 <t:${Math.floor((t.completedAt||Date.now())/1000)}:d>`;}).join("\n");
        const methods={};done.forEach(t=>{if(t.method)methods[t.method]=(methods[t.method]||0)+1;});
        const topM=Object.entries(methods).sort((a,b)=>b[1]-a[1])[0];
        const avg=done.reduce((s,t)=>s+(parseFloat(t.amountUSD)||0),0)/done.length;
        const ref=getReferrals(),refPts=ref.points[userId]?.balance||0;
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange  \u00b7  My Trade History",iconURL:IMG.LOGO}).setTitle("My Trades").setThumbnail(interaction.user.displayAvatarURL({size:256})).setDescription(`${tier.emoji} **${tier.label}**${vip?" \u26A1 VIP":""}${nextT?`  \u00b7  ${fmtUSD(Math.max(nextT.min-volume,0))} to ${nextT.emoji} ${nextT.label}`:"  \u00b7  Max tier reached"}\n\u200b`).addFields({name:"\u2705  Total Trades",value:`**${done.length}**`,inline:true},{name:"\uD83D\uDCB0  Total Volume",value:`**${fmtUSD(volume)}**`,inline:true},{name:"\uD83D\uDCCA  Avg Trade",value:`**${fmtUSD(avg)}**`,inline:true},{name:"\uD83C\uDFC6  Top Method",value:topM?`**${getMethod(topM[0])?.label||topM[0]}** (${topM[1]}x)`:"\u2014",inline:true},{name:"\uD83D\uDD17  Referral Points",value:`**${refPts} pts** ($${pointsToDollars(refPts)})`,inline:true},{name:"\u26A1  VIP Discount",value:vip?"Active \u2014 0.75% off":"Not yet ($7,000+ required)",inline:true},{name:"\uD83D\uDCCB  Last 5 Trades",value:last5,inline:false}).setImage(IMG.BANNER).setFooter({text:"Konvert Exchange  \u00b7  Use /stats for full tier details"}).setTimestamp()]});
      }

      if(cmd==="estimate"){
        await interaction.deferReply({ephemeral:true});
        const amount=interaction.options.getNumber("amount"),methodRaw=interaction.options.getString("method").toLowerCase().trim(),coinRaw=interaction.options.getString("coin").toUpperCase().trim(),direction=interaction.options.getString("direction");
        const m=METHODS.find(x=>x.label.toLowerCase().includes(methodRaw)||x.value.includes(methodRaw));
        if(!m)return interaction.editReply({content:`\u274C Method **${methodRaw}** not recognised. Try: PayPal, Interac, Zelle, Cash App etc.`});
        if(!COINS.includes(coinRaw))return interaction.editReply({content:`\u274C Coin **${coinRaw}** not supported. Try BTC, ETH, SOL, LTC etc.`});
        const vol=getUserVolume(interaction.user.id),vip=isVipVolume(vol);
        const fee=calcFee(amount,direction,vip),rate=feeRate(amount,direction,vip),receive=amount-fee;
        const coinPrice=await getPrice(coinRaw),tier=getTier(vol);
        let coinLine="";
        if(coinPrice){coinLine=direction==="send"?`**~${(receive/coinPrice).toFixed(6)} ${coinRaw}**  (\u2248${fmtUSD(receive)})`:`**${fmtUSD(receive)}** via ${m.label}`;}
        const sendStr=direction==="send"?`**${fmtUSD(amount)}** via **${m.label}**`:`**${coinRaw}** worth **${fmtUSD(amount)}**`;
        const receiveStr=coinLine||(direction==="send"?`~${fmtUSD(receive)} worth of ${coinRaw}`:`${fmtUSD(receive)} via ${m.label}`);
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange  \u00b7  Trade Estimate",iconURL:IMG.LOGO}).setTitle(`${m.label}  \u2194  ${coinRaw}  \u2014  Estimate`).setThumbnail(COIN_LOGO[coinRaw]||IMG.LOGO).setDescription(`Live quote for your proposed trade. Open a ticket to proceed.\n\u200b`).addFields({name:"\uD83D\uDCE4  You Send",value:sendStr,inline:true},{name:"\uD83D\uDCE5  You Receive",value:receiveStr,inline:true},{name:"\u200b",value:"\u200b",inline:true},{name:"\uD83D\uDCB8  Fee",value:`**${rate}%**${vip?" \u26A1 VIP":""} \u2014 ${fmtUSD(fee)}`,inline:true},{name:`\uD83D\uDCC8  ${coinRaw} Price`,value:coinPrice?`**${fmtUSD(coinPrice)}**`:"Unavailable",inline:true},{name:`${tier.emoji}  Your Tier`,value:`**${tier.label}**`,inline:true}).setImage(IMG.BANNER).setFooter({text:"Estimate only  \u00b7  Final rate confirmed in your ticket  \u00b7  Konvert Exchange"}).setTimestamp()]});
      }

      if(cmd==="tierlist"){
        const lines=TIERS.map(t=>`${t.emoji} **${t.label}** \u2014 $${t.min.toLocaleString()}+${t.min>=7000?" \u26A1 VIP":""}`).join("\n");
        return interaction.reply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange \u00b7 Client Tiers",iconURL:IMG.LOGO}).setTitle("Client Tier Ranks").setDescription("Earn your tier by exchanging volume on Konvert. Tiers are auto-assigned after every trade. All tiers from \u26A1 Godly Client and above receive a **0.75% VIP fee discount**.\n\u200b").addFields({name:"All Tiers",value:lines,inline:false}).setImage(IMG.BANNER).setFooter({text:"Konvert Exchange \u2022 Tiers auto-assigned after every trade"}).setTimestamp()],ephemeral:false});
      }

      if(cmd==="claimtag"){
        await interaction.deferReply({ephemeral:true});
        const userId=interaction.user.id;
        const member=await interaction.guild.members.fetch({user:userId,force:true}).catch(()=>null);
        if(!member)return interaction.editReply({content:"\u274C Could not fetch your profile. Try again.",ephemeral:true});
        const hasRole=member.roles.cache.has(KONV_TAG_ROLE);
        const pg=(member.user&&member.user.primaryGuild)||null;
        const hasPG=pg&&pg.identityEnabled&&pg.identityGuildId===CONFIG.GUILD_ID;
        if(!hasRole&&!hasPG)return interaction.editReply({embeds:[new EmbedBuilder().setColor(0xef4444).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO}).setTitle("\u274C KONV Tag Not Detected").setDescription("Set **Konvert** as your active clan in Discord profile settings, then run this command again.\n\u200b").setFooter({text:"Konvert Exchange  \u2022  Tag must be active"}).setTimestamp()],ephemeral:true});
        state.konvTagUsers.add(userId);
        if(!hasRole)await member.roles.add(KONV_TAG_ROLE).catch(()=>{});
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange  \u00b7  KONV Tag",iconURL:IMG.LOGO}).setTitle("\u2705  KONV Tag Perk Activated!").setDescription("KONV tag verified — **0.2% off** every exchange automatically.\n\u200b").addFields({name:"Perk",value:"**0.2% fee discount** on every trade",inline:true},{name:"Status",value:"\uD83C\uDFF7\uFE0F Active",inline:true}).setFooter({text:"Konvert Exchange  \u2022  Perk auto-removes when you remove the tag"}).setTimestamp()],ephemeral:true});
      }

      if(cmd==="removetag"){
        await interaction.deferReply({ephemeral:true});
        const target=interaction.options.getUser("user")||interaction.user;
        state.konvTagUsers.delete(target.id);
        try{const m=await interaction.guild.members.fetch(target.id).catch(()=>null);if(m&&m.roles.cache.has(KONV_TAG_ROLE))await m.roles.remove(KONV_TAG_ROLE).catch(()=>{});}catch{}
        return interaction.editReply({content:`\u2705 KONV tag perk removed from **${target.username}**.`,ephemeral:true});
      }

      if(cmd==="postleaderboard"){
        await interaction.deferReply({ephemeral:true});
        const embed=await buildLiveLeaderboardEmbed();
        const msg=await interaction.channel.send({embeds:[embed]});
        state.liveLbMessageId=msg.id;
        state.liveLbChannelId=interaction.channel.id;
        saveLiveLb();
        return interaction.editReply({content:`\u2705 Live leaderboard posted. It will auto-update after every exchange and every 10 minutes.`,ephemeral:true});
      }

      if(cmd==="togglereferraldms"){
        state.referralDMsEnabled=!state.referralDMsEnabled;
        const on=state.referralDMsEnabled;
        return interaction.reply({embeds:[new EmbedBuilder()
          .setColor(0x7C4DFF)
          .setAuthor({name:"Konvert  \u00b7  Referral Alerts",iconURL:IMG.LOGO})
          .setTitle(`Referral DMs ${on?"Enabled":"Disabled"}`)
          .setDescription(on
            ?"You will now receive a DM every time a referral exchange is completed."
            :"Referral deal DM alerts are now off. You can re-enable anytime.")
          .setFooter({text:"Konvert Exchange"})
          .setTimestamp()],ephemeral:true});
      }

      if(cmd==="giveaway"){
        await interaction.deferReply({ephemeral:true});
        const prize=interaction.options.getString("prize");
        const minutes=interaction.options.getInteger("minutes");
        const nw=interaction.options.getInteger("winners")||1;
        const endsAt=Date.now()+(minutes*60000);
        const endsTs=Math.floor(endsAt/1000);
        const ge=new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange \u00b7 Giveaway",iconURL:IMG.LOGO}).setTitle("\uD83C\uDF89 KONV Tag Giveaway!").setDescription(`**${prize}**\n\u200b`).addFields({name:"How to Enter",value:"Must have the **KONV** clan tag. Click below.",inline:false},{name:"Winners",value:`**${nw}**`,inline:true},{name:"Ends",value:`<t:${endsTs}:R>`,inline:true}).setImage(IMG.BANNER).setFooter({text:"KONV tag required \u2022 Konvert Exchange"}).setTimestamp();
        const gr=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("btn_giveaway_enter").setLabel("\uD83C\uDF89 Enter Giveaway").setStyle(ButtonStyle.Success));
        const gm=await interaction.channel.send({embeds:[ge],components:[gr]});
        state.activeGiveaway={messageId:gm.id,channelId:interaction.channel.id,prize,endsAt,numWinners:nw,entrants:new Set()};
        await interaction.editReply({content:`\u2705 Giveaway started! Ends <t:${endsTs}:R>`,ephemeral:true});
        setTimeout(async()=>{if(!state.activeGiveaway||state.activeGiveaway.messageId!==gm.id)return;await endGiveaway(interaction.guild,interaction.channel);},minutes*60000);
        return;
      }

      if(cmd==="giveawayend"){
        if(!state.activeGiveaway)return interaction.reply({content:"No active giveaway.",ephemeral:true});
        await interaction.deferReply({ephemeral:true});
        const gc=interaction.guild.channels.cache.get(state.activeGiveaway.channelId)||interaction.channel;
        await endGiveaway(interaction.guild,gc);
        return interaction.editReply({content:"\u2705 Giveaway ended.",ephemeral:true});
      }

      if(["jbtc","jeth","jsol","jltc","jusdtbnb"].includes(cmd)){
        const addr=interaction.options.getString("address");
        const coinMap={jbtc:"BTC",jeth:"ETH",jsol:"SOL",jltc:"LTC",jusdtbnb:"USDT-BNB"};
        const coinName=coinMap[cmd];
        state.personalWallets[coinName]=addr;
        return interaction.reply({content:`\u2705 **${coinName}** address set to \`${addr}\`\nUsers type **$j${coinName.toLowerCase().replace("-bnb","bnb")}** in chat to see it.`,ephemeral:true});
      }

      if(cmd==="setfeemode"){
        const mode=interaction.options.getString("mode");
        state.feeMode=mode;
        const isReduced=mode==="reduced";
        return interaction.reply({embeds:[new EmbedBuilder()
          .setColor(isReduced?0x7C4DFF:0x7C4DFF)
          .setAuthor({name:"Konvert  ·  Fee Settings",iconURL:IMG.LOGO})
          .setTitle(isReduced?"Fee Mode: Reduced (5–9%)":"Fee Mode: Standard (5–10%)")
          .setDescription(isReduced
            ?"Fee tiers switched to **5–9%** across all transactions. Applies immediately to all new tickets.\n\u200b"
            :"Fee tiers restored to **5–10%** (standard). Applies immediately to all new tickets.\n\u200b")
          .addFields(
            {name:"Fiat \u2192 Crypto",value:isReduced?"9% \u2192 8% \u2192 7% \u2192 6% \u2192 5%":"10% \u2192 9% \u2192 8% \u2192 7% \u2192 6%",inline:true},
            {name:"Crypto \u2192 Fiat",value:"9% \u2192 8% \u2192 7% \u2192 6% \u2192 5%",inline:true},
            {name:"Min Fee",value:"**$5** on all trades",inline:true},
          )
          .setFooter({text:`Set by ${interaction.user.tag}  ·  Konvert Exchange`})
          .setTimestamp()],ephemeral:true});
      }

      if(cmd==="setlivefeed"){
        const ch=interaction.options.getChannel("channel");
        state.feedChannel=ch.id;
        state.feedEnabled=true;
        return interaction.reply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO}).setTitle("Live Feed Set").setDescription(`Live exchange notifications will now post in <#${ch.id}>.`).setFooter({text:"Konvert Exchange"}).setTimestamp()],ephemeral:true});
      }

      if(cmd==="togglefeed"){
        state.feedEnabled=!state.feedEnabled;
        return interaction.reply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO}).setTitle(`Live Feed ${state.feedEnabled?"Enabled":"Disabled"}`).setDescription(state.feedEnabled&&state.feedChannel?`Live feed is now active in <#${state.feedChannel}>.`:"Live feed turned off.").setFooter({text:"Konvert Exchange"}).setTimestamp()],ephemeral:true});
      }

      if(cmd==="myalerts"){
        const userAlerts=state.alerts.filter(a=>a.userId===interaction.user.id);
        if(!userAlerts.length)return interaction.reply({content:"You have no active price alerts. Use `/alert` to set one.",ephemeral:true});
        const lines=userAlerts.map((a,i)=>`**${i+1}.** ${a.coin} ${a.direction==="above"?"\u25B2":"\u25BC"} **$${a.target.toLocaleString("en-US")}**`).join("\n");
        return interaction.reply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO}).setTitle("Your Price Alerts").setDescription(lines).setFooter({text:"Use /clearalerts to remove all"}).setTimestamp()],ephemeral:true});
      }

      if(cmd==="clearalerts"){
        const before=state.alerts.filter(a=>a.userId===interaction.user.id).length;
        state.alerts=state.alerts.filter(a=>a.userId!==interaction.user.id);
        return interaction.reply({content:`Cleared **${before}** price alert${before!==1?"s":""}. You have no active alerts.`,ephemeral:true});
      }

      if(cmd==="serverinfo"){
        await interaction.deferReply({ephemeral:true});
        const guild=interaction.guild;
        await guild.members.fetch();
        const allT=Object.values(_mem.tickets&&Object.keys(_mem.tickets).length?_mem.tickets:load("tickets"));
        const done=allT.filter(t=>["vouched","completed"].includes(t.status)&&t.method!=="adjustment"&&parseFloat(t.amountUSD||0)>0);
        const open=allT.filter(t=>t.status==="open"&&t.method!=="adjustment");
        const totalVol=done.reduce((s,t)=>s+(parseFloat(t.amountUSD)||0),0);
        const today=done.filter(t=>t.completedAt&&Date.now()-t.completedAt<86400000);
        const week=done.filter(t=>t.completedAt&&Date.now()-t.completedAt<7*86400000);
        const ref=getReferrals();
        const ms=process.uptime()*1000;const uh=Math.floor(ms/3600000);const um=Math.floor((ms%3600000)/60000);
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO}).setTitle("Server Info").setThumbnail(IMG.LOGO).addFields({name:"Members",value:`**${guild.memberCount}**`,inline:true},{name:"Open Tickets",value:`**${open.length}**`,inline:true},{name:"Total Exchanges",value:`**${done.length}**`,inline:true},{name:"Total Volume",value:`**${fmtUSD(totalVol)}**`,inline:true},{name:"Today",value:`**${today.length}** \u00b7 ${fmtUSD(today.reduce((s,t)=>s+(parseFloat(t.amountUSD)||0),0))}`,inline:true},{name:"This Week",value:`**${week.length}** \u00b7 ${fmtUSD(week.reduce((s,t)=>s+(parseFloat(t.amountUSD)||0),0))}`,inline:true},{name:"Referrers",value:`**${Object.keys(ref.points||{}).length}**`,inline:true},{name:"Referred Members",value:`**${Object.keys(ref.referred||{}).length}**`,inline:true},{name:"Fee Mode",value:`**${state.feeMode==="reduced"?"Reduced (5-9%)":"Standard (5-10%)"}**`,inline:true},{name:"Live Feed",value:state.feedEnabled&&state.feedChannel?`On \u2014 <#${state.feedChannel}>`:"Off",inline:true},{name:"Price Alerts",value:`**${state.alerts.length}** active`,inline:true},{name:"Uptime",value:`**${uh}h ${um}m**`,inline:true}).setFooter({text:"Konvert Exchange"}).setTimestamp()]});
      }

      if(cmd==="clientinfo"){
        await interaction.deferReply({ephemeral:true});
        const target=interaction.options.getUser("user");
        const allT=Object.values(_mem.tickets&&Object.keys(_mem.tickets).length?_mem.tickets:load("tickets"));
        const done=allT.filter(t=>t.userId===target.id&&["vouched","completed"].includes(t.status)&&t.method!=="adjustment"&&parseFloat(t.amountUSD||0)>0);
        const open=allT.filter(t=>t.userId===target.id&&t.status==="open");
        const volume=getUserVolume(target.id);
        const tier=getTier(volume);
        const vip=isVipVolume(volume);
        const avg=done.length>0?done.reduce((s,t)=>s+(parseFloat(t.amountUSD)||0),0)/done.length:0;
        const last=done.length>0?[...done].sort((a,b)=>(b.completedAt||0)-(a.completedAt||0))[0]:null;
        const methods={};done.forEach(t=>{if(t.method)methods[t.method]=(methods[t.method]||0)+1;});
        const topM=Object.entries(methods).sort((a,b)=>b[1]-a[1])[0];
        const ref=getReferrals();const refBy=ref.referred[target.id];const refPts=ref.points[target.id]?.balance||0;
        const bl=load("blacklist");const isBlacklisted=!!bl[target.id];
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(isBlacklisted?0xef4444:0x7C4DFF).setAuthor({name:"Konvert Exchange \u00b7 Client Info",iconURL:IMG.LOGO}).setTitle(target.username).setThumbnail(target.displayAvatarURL({size:256})).setDescription(`${tier.emoji} **${tier.label}**${vip?" \u26A1 VIP":""}${isBlacklisted?" \uD83D\uDEAB BLACKLISTED":""}\n\u200b`).addFields({name:"Volume",value:`**${fmtUSD(volume)}**`,inline:true},{name:"Exchanges",value:`**${done.length}**`,inline:true},{name:"Avg Deal",value:`**${avg>0?fmtUSD(avg):"\u2014"}**`,inline:true},{name:"Open Tickets",value:`**${open.length}**`,inline:true},{name:"Top Method",value:topM?`**${getMethod(topM[0])?.label||topM[0]}**`:"\u2014",inline:true},{name:"Last Exchange",value:last?.completedAt?`<t:${Math.floor(last.completedAt/1000)}:R>`:"\u2014",inline:true},{name:"Referred By",value:refBy?`<@${refBy}>`:"No referral",inline:true},{name:"Referral Points",value:`**${refPts} pts**`,inline:true},{name:"VIP",value:vip?"Active \u2014 0.75% off":"Not yet",inline:true}).setFooter({text:"Konvert Exchange"}).setTimestamp()]});
      }

      if(cmd==="receipt"){
        await interaction.deferReply({ephemeral:true});
        const query=interaction.options.getString("query").trim();
        const allT=Object.entries(_mem.tickets&&Object.keys(_mem.tickets).length?_mem.tickets:load("tickets"));
        let matches=[];
        // Search by user ID/mention
        const userId=query.replace(/[<@!>]/g,"");
        const userMatches=allT.filter(([,t])=>t.userId===userId&&["vouched","completed"].includes(t.status)&&t.method!=="adjustment"&&parseFloat(t.amountUSD||0)>0).sort((a,b)=>(b[1].completedAt||0)-(a[1].completedAt||0)).slice(0,5);
        // Search by channel ID (ticket key)
        const idMatches=allT.filter(([id,t])=>id===query&&["vouched","completed"].includes(t.status));
        matches=[...idMatches,...userMatches];
        if(!matches.length)return interaction.editReply({content:`No completed exchanges found for \`${query}\`.`,ephemeral:true});
        const fields=matches.slice(0,5).map(([id,t],i)=>{
          const m=getMethod(t.method);
          const tradeId=`KV-${id.slice(-6).toUpperCase()}`;
          const dirStr=t.direction&&t.coin&&t.method?(t.direction==="send"?`${t.coin} \u2192 ${m?.label||t.method}`:`${m?.label||t.method} \u2192 ${t.coin}`):m?.label||t.method;
          return {
            name:`${i+1}. ${tradeId}  \u00b7  ${fmtUSD(t.amountUSD||0)}`,
            value:`**Client:** <@${t.userId}>\n**Exchanger:** ${t.completedBy?`<@${t.completedBy}>`:"—"}\n**Direction:** ${dirStr||"—"}\n**Completed:** ${t.completedAt?`<t:${Math.floor(t.completedAt/1000)}:F>`:"—"}\n**Fee:** ${fmtUSD(t.feeUSD||0)}`,
            inline:false
          };
        });
        return interaction.editReply({embeds:[new EmbedBuilder()
          .setColor(0x7C4DFF)
          .setAuthor({name:"Konvert Exchange  \u00b7  Receipt Lookup",iconURL:IMG.LOGO})
          .setTitle(`${matches.length} Exchange${matches.length!==1?"s":""} Found`)
          .setDescription(`Results for \`${query}\`\n\u200b`)
          .addFields(fields)
          .setFooter({text:"Konvert Exchange  \u2022  Receipt Lookup"})
          .setTimestamp()],ephemeral:true});
      }

      if(cmd==="grantowner"){
        const confirm=interaction.options.getString("confirm");
        if(confirm!=="CONFIRM")return interaction.reply({content:"❌ Type **CONFIRM** exactly to grant owner access.",ephemeral:true});
        const target=interaction.options.getUser("user");
        if(CONFIG.OWNER_IDS.includes(target.id))return interaction.reply({content:`**${target.username}** is already an owner.`,ephemeral:true});
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
          .setFooter({text:"Konvert Exchange  •  Use /revokeowner to remove access"})
          .setTimestamp()],ephemeral:true});
      }

      if(cmd==="revokeowner"){
        const target=interaction.options.getUser("user");
        if(!CONFIG.OWNER_IDS.includes(target.id))return interaction.reply({content:`**${target.username}** is not a bot owner.`,ephemeral:true});
        CONFIG.OWNER_IDS=CONFIG.OWNER_IDS.filter(id=>id!==target.id);
        return interaction.reply({content:`✅ Owner access removed from **${target.username}**.`,ephemeral:true});
      }

      if(cmd==="listowners"){
        const lines=CONFIG.OWNER_IDS.map(id=>`<@${id}>`).join("\n")||"No owners configured.";
        return interaction.reply({embeds:[new EmbedBuilder()
          .setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO})
          .setTitle("Bot Owners")
          .setDescription(lines)
          .setFooter({text:"Konvert Exchange"}).setTimestamp()],ephemeral:true});
      }

      if(cmd==="createpromo"){
        const code=interaction.options.getString("code").trim().toLowerCase();
        const discount=interaction.options.getNumber("discount");
        const maxUses=interaction.options.getInteger("maxuses")||null;
        const hours=interaction.options.getInteger("hours")||null;
        if(discount<=0||discount>=100)return interaction.reply({content:"Discount must be between 1 and 99%.",ephemeral:true});
        if(state.promos[code]&&state.promos[code].active)return interaction.reply({content:`Promo code **${code.toUpperCase()}** already exists and is active. End it first with \`/endpromo\`.`,ephemeral:true});
        const expiresAt=hours?Date.now()+(hours*3600000):null;
        state.promos[code]={discount,maxUses,uses:0,usedBy:[],active:true,expiresAt,createdBy:interaction.user.id,createdAt:Date.now()};
        savePromos();
        return interaction.reply({embeds:[new EmbedBuilder()
          .setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange  \u00b7  Promo Created",iconURL:IMG.LOGO})
          .setTitle("\uD83C\uDF89  Promo Code Created")
          .setDescription(`Clients can now type **${code.toUpperCase()}** inside their ticket to apply the discount.\n\u200b`)
          .addFields(
            {name:"Code",value:`\`${code.toUpperCase()}\``,inline:true},
            {name:"Discount",value:`**${discount}% off**`,inline:true},
            {name:"Max Uses",value:maxUses?`**${maxUses}**`:"Unlimited",inline:true},
            {name:"Expires",value:expiresAt?`<t:${Math.floor(expiresAt/1000)}:R>`:"Never",inline:true},
          )
          .setFooter({text:`Created by ${interaction.user.tag}  \u00b7  Konvert Exchange`})
          .setTimestamp()],ephemeral:true});
      }

      if(cmd==="endpromo"){
        const code=interaction.options.getString("code").trim().toLowerCase();
        if(!state.promos[code])return interaction.reply({content:`No promo found with code **${code.toUpperCase()}**.`,ephemeral:true});
        state.promos[code].active=false;
        savePromos();
        const p=state.promos[code];
        return interaction.reply({embeds:[new EmbedBuilder()
          .setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO})
          .setTitle("Promo Ended")
          .setDescription(`**${code.toUpperCase()}** has been deactivated. Anyone who tries to use it will see an expired message.\n\u200b`)
          .addFields({name:"Total Uses",value:`**${p.uses}**`,inline:true},{name:"Status",value:"**Expired**",inline:true})
          .setFooter({text:"Konvert Exchange"}).setTimestamp()],ephemeral:true});
      }

      if(cmd==="editpromo"){
        const code=interaction.options.getString("code").trim().toLowerCase();
        if(!state.promos[code])return interaction.reply({content:`No promo found with code **${code.toUpperCase()}**. Use \`/listpromos\` to see all codes.`,ephemeral:true});
        const p=state.promos[code];
        const changes=[];

        const newCode=interaction.options.getString("newcode")?.trim().toLowerCase();
        const newDiscount=interaction.options.getNumber("discount");
        const newMaxUses=interaction.options.getInteger("maxuses");
        const addHours=interaction.options.getInteger("addhours");
        const newStatus=interaction.options.getString("status");

        if(newCode&&newCode!==code){
          if(state.promos[newCode])return interaction.reply({content:`Code **${newCode.toUpperCase()}** already exists.`,ephemeral:true});
          state.promos[newCode]={...p};
          delete state.promos[code];
          changes.push(`Code renamed to \`${newCode.toUpperCase()}\``);
        }

        const targetCode=newCode||code;
        const target=state.promos[targetCode];

        if(newDiscount!==null&&newDiscount!==undefined){
          if(newDiscount<=0||newDiscount>=100)return interaction.reply({content:"Discount must be between 1 and 99.",ephemeral:true});
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
          changes.push(`Status set to **${newStatus==="active"?"Active \uD83D\uDFE2":"Paused \uD83D\uDD34"}**`);
        }

        if(!changes.length)return interaction.reply({content:"No changes provided. Specify at least one field to update.",ephemeral:true});
        savePromos();

        return interaction.reply({embeds:[new EmbedBuilder()
          .setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange  \u00b7  Promo Updated",iconURL:IMG.LOGO})
          .setTitle("Promo Code Updated")
          .setDescription(`Changes applied to **${targetCode.toUpperCase()}**:\n\u200b`)
          .addFields(
            {name:"Changes",value:changes.map(c=>`\u2022 ${c}`).join("\n"),inline:false},
            {name:"Current Discount",value:`**${target.discount}% off the fee**`,inline:true},
            {name:"Uses",value:target.maxUses?`${target.uses}/${target.maxUses}`:`${target.uses} (unlimited)`,inline:true},
            {name:"Expires",value:target.expiresAt?`<t:${Math.floor(target.expiresAt/1000)}:R>`:"Never",inline:true},
          )
          .setFooter({text:`Edited by ${interaction.user.tag}  \u00b7  Konvert Exchange`})
          .setTimestamp()],ephemeral:true});
      }

      if(cmd==="listpromos"){

        const promos=Object.entries(state.promos||{});
        if(!promos.length)return interaction.reply({content:"No promo codes created yet. Use `/createpromo` to make one.",ephemeral:true});
        const lines=promos.map(([code,p])=>{
          const status=!p.active?"\uD83D\uDD34 Expired":p.expiresAt&&Date.now()>p.expiresAt?"\uD83D\uDD34 Expired":"\uD83D\uDFE2 Active";
          const uses=p.maxUses?`${p.uses}/${p.maxUses}`:p.uses;
          return `${status} \`${code.toUpperCase()}\`  \u2014  **${p.discount}% off**  \u00b7  ${uses} uses${p.expiresAt?`  \u00b7  expires <t:${Math.floor(p.expiresAt/1000)}:R>`:""}`;
        }).join("\n");
        return interaction.reply({embeds:[new EmbedBuilder()
          .setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO})
          .setTitle("Promo Codes")
          .setDescription(lines)
          .setFooter({text:"Konvert Exchange"}).setTimestamp()],ephemeral:true});
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
        const medals=pos===1?"\uD83E\uDD47":pos===2?"\uD83E\uDD48":pos===3?"\uD83E\uDD49":`**#${pos}**`;
        return interaction.editReply({embeds:[new EmbedBuilder()
          .setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange  \u00b7  Leaderboard Rank",iconURL:IMG.LOGO})
          .setTitle(isSelf?"Your Rank":`${target.username}'s Rank`)
          .setThumbnail(target.displayAvatarURL({size:256}))
          .setDescription(`${medals}  \u2014  Top **${pct}%** of all clients\n\u200b`)
          .addFields(
            {name:"Rank",value:`**#${pos}** of ${total}`,inline:true},
            {name:"Volume",value:`**${fmtUSD(vol)}**`,inline:true},
            {name:"Tier",value:`${tier.emoji} **${tier.label}**`,inline:true},
            {name:"Above You",value:above?`<@${above[0]}> \u2014 ${fmtUSD(above[1])}`:"\u2014 You're at the top!",inline:true},
            {name:"Below You",value:below?`<@${below[0]}> \u2014 ${fmtUSD(below[1])}`:"\u2014 No one below",inline:true},
            {name:"To Next Tier",value:nextTier?`${fmtUSD(Math.max(nextTier.min-vol,0))} away`:"Max tier reached",inline:true},
          )
          .setImage(IMG.BANNER)
          .setFooter({text:"Konvert Exchange  \u2022  /leaderboard to see the full list"})
          .setTimestamp()]});
      }

      if(cmd==="exchangerstats"){
        await interaction.deferReply({ephemeral:true});
        const target=interaction.options.getUser("user")||interaction.user;
        const allT=Object.values(_mem.tickets&&Object.keys(_mem.tickets).length?_mem.tickets:load("tickets"));
        const handled=allT.filter(t=>t.completedBy===target.id&&["vouched","completed"].includes(t.status)&&t.method!=="adjustment"&&parseFloat(t.amountUSD||0)>0);
        if(!handled.length){
          return interaction.editReply({content:`No completed exchanges found for **${target.username}** as exchanger.`});
        }
        const totalVol=handled.reduce((s,t)=>s+(parseFloat(t.amountUSD)||0),0);
        const totalFees=handled.reduce((s,t)=>s+(parseFloat(t.feeUSD||0)),0);
        const avg=totalVol/handled.length;
        const methods={};handled.forEach(t=>{if(t.method)methods[t.method]=(methods[t.method]||0)+1;});
        const topM=Object.entries(methods).sort((a,b)=>b[1]-a[1])[0];
        const coins={};handled.forEach(t=>{if(t.coin)coins[t.coin]=(coins[t.coin]||0)+1;});
        const topC=Object.entries(coins).sort((a,b)=>b[1]-a[1])[0];
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
          .setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange  \u00b7  Exchanger Stats",iconURL:IMG.LOGO})
          .setTitle(`${target.username}'s Exchanger Performance`)
          .setThumbnail(target.displayAvatarURL({size:256}))
          .setDescription(`Exchanger rank: **#${exPos}** of ${exRanked.length}\n\u200b`)
          .addFields(
            {name:"Total Handled",value:`**${handled.length}** exchanges`,inline:true},
            {name:"Total Volume",value:`**${fmtUSD(totalVol)}**`,inline:true},
            {name:"Avg Deal",value:`**${fmtUSD(avg)}**`,inline:true},
            {name:"Today",value:`**${today.length}** deals  \u00b7  ${fmtUSD(today.reduce((s,t)=>s+(parseFloat(t.amountUSD)||0),0))}`,inline:true},
            {name:"This Week",value:`**${week.length}** deals  \u00b7  ${fmtUSD(week.reduce((s,t)=>s+(parseFloat(t.amountUSD)||0),0))}`,inline:true},
            {name:"Fees Collected",value:`**${fmtUSD(totalFees)}**`,inline:true},
            {name:"Top Method",value:topM?`**${getMethod(topM[0])?.label||topM[0]}** (${topM[1]}x)`:"\u2014",inline:true},
            {name:"Top Coin",value:topC?`**${topC[0]}** (${topC[1]}x)`:"\u2014",inline:true},
            {name:"Last Exchange",value:last?.completedAt?`<t:${Math.floor(last.completedAt/1000)}:R>`:"\u2014",inline:true},
          )
          .setImage(IMG.BANNER)
          .setFooter({text:"Konvert Exchange  \u2022  Exchanger Performance"})
          .setTimestamp()]});
      }

      if(cmd==="testbackup"){



        await interaction.deferReply({ephemeral:true});
        const channelId=process.env.BACKUP_CHANNEL_ID;
        if(!channelId)return interaction.editReply("\u274C `BACKUP_CHANNEL_ID` is not set in Railway Variables.");
        try{const ch=await client.channels.fetch(channelId).catch(()=>null);if(!ch)return interaction.editReply(`\u274C Cannot find channel \`${channelId}\`.`);const tickets=_mem.tickets||load("tickets");const json=JSON.stringify(tickets,null,2);const buf=Buffer.from(json,"utf8");await ch.send({content:`**Test Backup** \`${new Date().toISOString()}\` \u2014 ${Object.keys(tickets).length} entries`,files:[{attachment:buf,name:"konvert_tickets.json"}]});return interaction.editReply(`\u2705 Backup sent successfully to <#${channelId}> with **${Object.keys(tickets).length}** entries.`);}
        catch(e){return interaction.editReply(`\u274C Backup failed: \`${e.message}\``);}
      }

      return;
    }

    if(interaction.isStringSelectMenu()){
      if(interaction.customId==="select_method"){
        const method=interaction.values[0],_m=getMethod(method);
        if(method==="crypto"){const c2cCoins=["BTC","ETH","SOL","LTC","USDT","USDC","XRP","BNB","ADA","DOGE","MATIC","AVAX","DOT","LINK","TRX","SHIB","UNI","ATOM","NEAR","ARB","OP","CAKE","INJ","RUNE","KAVA"];const coinOpts=c2cCoins.map(c=>new StringSelectMenuOptionBuilder().setLabel(c).setValue(c).setDescription(`Exchange ${c}`));return interaction.update({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO}).setTitle("Crypto to Crypto").setDescription("Select the coin you are **sending** and the coin you want to **receive** below.\n\u200b").setFooter({text:"Step 2 of 3  \u2022  Konvert"})],components:[new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("c2c_send").setPlaceholder("Select coin you are SENDING...").addOptions(coinOpts)),new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("c2c_recv").setPlaceholder("Select coin you want to RECEIVE...").addOptions(coinOpts))]});}
        return interaction.update({embeds:[step2Embed(method)],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`dir_send__${method}`).setLabel(`Send Crypto \u2192 Get ${_m.label}`).setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId(`dir_receive__${method}`).setLabel(`Send ${_m.label} \u2192 Get Crypto`).setStyle(ButtonStyle.Success))]});
      }
      if(interaction.customId==="c2c_send"||interaction.customId==="c2c_recv"){
        const userId=interaction.user.id;
        if(!state.c2cSelections[userId])state.c2cSelections[userId]={};
        if(interaction.customId==="c2c_send")state.c2cSelections[userId].send=interaction.values[0];
        if(interaction.customId==="c2c_recv")state.c2cSelections[userId].recv=interaction.values[0];
        const sel=state.c2cSelections[userId],both=sel.send&&sel.recv;
        const _c2cCoins=["BTC","ETH","SOL","LTC","USDT","USDC","XRP","BNB","ADA","DOGE","MATIC","AVAX","DOT","LINK","TRX","SHIB","UNI","ATOM","NEAR","ARB","OP","CAKE","INJ","RUNE","KAVA"];const coinOpts=_c2cCoins.map(c=>new StringSelectMenuOptionBuilder().setLabel(c).setValue(c).setDescription(`Exchange ${c}`));
        const components=[new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("c2c_send").setPlaceholder(sel.send?`Sending: ${sel.send}`:"Select coin you are SENDING...").addOptions(coinOpts)),new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("c2c_recv").setPlaceholder(sel.recv?`Receiving: ${sel.recv}`:"Select coin you want to RECEIVE...").addOptions(coinOpts))];
        if(both)components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("btn_c2c_confirm").setLabel(`Confirm: ${sel.send} \u2192 ${sel.recv}`).setStyle(ButtonStyle.Success)));
        return interaction.update({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO}).setTitle("Crypto to Crypto").setDescription(`**Sending:** ${sel.send||"--"}\n**Receiving:** ${sel.recv||"--"}\n\n${both?"Both coins selected. Click **Confirm** to continue.\n\u200b":"Select both coins then a confirm button will appear.\n\u200b"}`).setFooter({text:"Step 2 of 3  \u2022  Konvert"})],components});
      }
    }

    if(interaction.isButton()){
      if(interaction.customId==="btn_exchange_now"){const bl=load("blacklist");if(bl[interaction.user.id])return interaction.reply({content:"You are blacklisted from Konvert.",ephemeral:true});return interaction.reply({embeds:[step1Embed()],components:[new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("select_method").setPlaceholder("Select your payment method...").addOptions(METHODS.map(m=>new StringSelectMenuOptionBuilder().setLabel(m.label).setValue(m.value).setDescription(`Exchange crypto with ${m.label}`))))],ephemeral:true});}
      if(interaction.customId==="btn_fee_calc"){const modal=new ModalBuilder().setCustomId("modal_fee").setTitle("Fee Calculator");modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("fee_amt").setLabel("Amount in USD").setStyle(TextInputStyle.Short).setPlaceholder("e.g. 250").setRequired(true)));return interaction.showModal(modal);}
      if(interaction.customId==="btn_rates_quick"){await interaction.deferReply({ephemeral:true});try{return interaction.editReply({embeds:[await buildRatesEmbed()]});}catch(e){return interaction.editReply("Could not fetch rates right now. Try again in a moment.");}}
      if(interaction.customId==="btn_refresh_rates"){await interaction.deferUpdate();try{const _re=await buildRatesEmbed();return interaction.editReply({embeds:[_re],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("btn_refresh_rates").setLabel("Refresh").setStyle(ButtonStyle.Secondary))]});}catch(e){return interaction.editReply({content:"Could not fetch rates right now."});} return;}

      if(interaction.customId==="btn_get_referral_link"){
        await interaction.deferReply({ephemeral:true});
        const userId=interaction.user.id,ref=getReferrals();
        const pts=ref.points[userId]?.balance||0;
        let existingInvite=null;
        const existing=ref.inviteCodes[userId];
        if(existing&&existing.code){try{const invites=await interaction.guild.invites.fetch();const found=invites.find(i=>i.code===existing.code);if(found)existingInvite=found;}catch{}}
        let invite=existingInvite;
        if(!invite){try{const ch=interaction.guild.channels.cache.get(CONFIG.EXCHANGE_CHANNEL)||interaction.guild.channels.cache.first();invite=await ch.createInvite({maxAge:0,maxUses:0,unique:true,reason:`Konvert referral for ${interaction.user.tag}`});ref.invites[invite.code]=userId;ref.inviteCodes[userId]={code:invite.code,expiresAt:0,uses:0};saveReferrals(ref);_inviteCache.set(invite.code,invite.uses);}catch(e){return interaction.editReply({content:`\u274C Could not create invite: ${e.message}`});}}
        const referredCount=Object.values(ref.referred).filter(r=>r===userId).length;
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert  \u00b7  Referral Program",iconURL:PTS_IMG}).setTitle("\uD83D\uDD17  Your Referral Link").setDescription("Share this link. Every trade your referrals complete earns you points.\n\u200b").addFields({name:"Your Invite",value:`**https://discord.gg/${invite.code}**`,inline:false},{name:"Link",value:"**Permanent**",inline:true},{name:"Referred",value:`**${referredCount}** people`,inline:true},{name:"Balance",value:`**${pts} pts** ($${pointsToDollars(pts)})`,inline:true}).setFooter({text:"Konvert Referrals  \u2022  Use /referral for full details"}).setTimestamp()]});
      }

      if(interaction.customId==="btn_check_points"){
        await interaction.deferReply({ephemeral:true});
        const userId=interaction.user.id,ref=getReferrals();
        const data=ref.points[userId]||{balance:0,paid:0,history:[],pendingPayout:false};
        const bal=data.balance||0,paid=data.paid||0,referredCount=Object.values(ref.referred).filter(r=>r===userId).length;
        const readyToWithdraw=bal>=MIN_WITHDRAW_POINTS&&!data.pendingPayout;
        const embed=new EmbedBuilder().setColor(bal>=MIN_WITHDRAW_POINTS?0x7C4DFF:0x7C4DFF).setAuthor({name:"Konvert  \u00b7  Referral Program",iconURL:PTS_IMG}).setTitle("\uD83D\uDCB0  My Points").addFields({name:"Balance",value:`**${bal} pts** ($${pointsToDollars(bal)})`,inline:true},{name:"Total Paid Out",value:`**$${pointsToDollars(paid)}**`,inline:true},{name:"People Referred",value:`**${referredCount}**`,inline:true},{name:"Status",value:data.pendingPayout?"⏳ Payout pending":readyToWithdraw?"✅ Ready — use `/mypoints` to request":`**${MIN_WITHDRAW_POINTS-bal}** more pts to withdraw`,inline:false}).setFooter({text:"Konvert Referrals  \u2022  Use /mypoints for full history"}).setTimestamp();
        const components=[];if(readyToWithdraw){components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("btn_request_payout").setLabel("Request Payout").setEmoji("💸").setStyle(ButtonStyle.Success)));}
        return interaction.editReply({embeds:[embed],components});
      }

      if(interaction.customId==="btn_request_payout"){
        const userId=interaction.user.id,ref=getReferrals(),data=ref.points[userId];
        if(!data||data.balance<MIN_WITHDRAW_POINTS)return interaction.reply({content:"You don't have enough points to request a payout.",ephemeral:true});
        if(data.pendingPayout)return interaction.reply({content:"You already have a pending payout request.",ephemeral:true});
        data.pendingPayout=true;ref.points[userId]=data;saveReferrals(ref);
        for(const oid of CONFIG.OWNER_IDS){try{const owner=await client.users.fetch(oid);await owner.send({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert  \u00b7  Referral Admin",iconURL:PTS_IMG}).setTitle("Payout Request").setThumbnail(PTS_IMG).setDescription(`<@${userId}> has requested a referral payout and is waiting.\n\u200b`).addFields({name:"\uD83D\uDCB0  Amount",value:`**${data.balance} pts**  \u00b7  **$${pointsToDollars(data.balance)}**`,inline:true},{name:"\u26A1  Action",value:`\`/paypoints @${interaction.user.username}\``,inline:true}).setTimestamp().setFooter({text:"Konvert Referral Program  \u00b7  Admin Notification"})]});}catch{}}
        return interaction.reply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert  \u00b7  Referral Program",iconURL:PTS_IMG}).setTitle("Payout Requested").setThumbnail(PTS_IMG).setDescription(`Your payout request has been sent. Staff will process it and DM you once it's done.\n\u200b`).addFields({name:"\uD83D\uDCB0  Amount Requested",value:`**${data.balance} pts**  \u00b7  **$${pointsToDollars(data.balance)}**`,inline:true},{name:"\uD83D\uDCEC  Next Step",value:"Wait for a DM from staff confirming payment.",inline:true}).setImage(IMG.BANNER).setFooter({text:"Konvert Referral Program  \u00b7  Thank you for referring people to Konvert"}).setTimestamp()],ephemeral:true});
      }

      if(interaction.customId==="btn_c2c_confirm"){
        const c2cData=state.c2cSelections?.[interaction.user.id];
        if(!c2cData?.send||!c2cData?.recv)return interaction.reply({content:"Please select both coins before confirming.",ephemeral:true});
        delete state.c2cSelections[interaction.user.id];
        const {send:sendCoin,recv:recvCoin}=c2cData;
        if(sendCoin===recvCoin)return interaction.reply({content:"You cannot exchange a coin for the same coin.",ephemeral:true});
        const modal=new ModalBuilder().setCustomId(`modal_c2c__${sendCoin}__${recvCoin}`).setTitle(`${sendCoin} \u2192 ${recvCoin}`);
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("c2c_amount").setLabel("Amount in USD you are sending").setStyle(TextInputStyle.Short).setPlaceholder("e.g. 200").setRequired(true)));
        return interaction.showModal(modal);
      }

      if(interaction.customId.startsWith("dir_send__")||interaction.customId.startsWith("dir_receive__")){
        const _isSendCrypto=interaction.customId.startsWith("dir_send__"),method=interaction.customId.replace("dir_send__","").replace("dir_receive__",""),m=getMethod(method);
        const _direction=_isSendCrypto?"receive":"send";
        const modal=new ModalBuilder().setCustomId(`modal_amount__${method}__${_direction}`).setTitle(`${m.label} -- ${_isSendCrypto?"Send Crypto":"Receive Crypto"}`);
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("inp_amount").setLabel("Amount in USD").setStyle(TextInputStyle.Short).setPlaceholder("e.g. 150").setRequired(true)),new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("inp_coin").setLabel("Which crypto? (BTC, ETH, SOL, LTC, USDT)").setStyle(TextInputStyle.Short).setPlaceholder("e.g. SOL").setRequired(true)));
        return interaction.showModal(modal);
      }

      if(interaction.customId==="skip_vouch"){
        const _tix=Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets");
        const _stix=_tix[interaction.channel.id];
        if(!_stix||interaction.user.id!==_stix.userId)return interaction.reply({content:"Only the client can skip the review.",ephemeral:true});
        await interaction.deferUpdate().catch(()=>{});
        await interaction.editReply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setTitle("Closing...").setDescription("No review submitted. Closing ticket now.")],components:[]}).catch(()=>{});
        // Call _postOnce directly — it's stored on the channel by completeTrade
        const _fn=interaction.channel._completePostOnce;
        if(typeof _fn==="function"){
          interaction.channel._completePostOnce=null;
          await _fn(null);
        }
        return;
      }

      if(interaction.customId==="btn_giveaway_enter"){
        if(!state.activeGiveaway)return interaction.reply({content:"No active giveaway.",ephemeral:true});
        const userId=interaction.user.id;
        const member=await interaction.guild.members.fetch({user:userId,force:false}).catch(()=>null);
        const hasRole=member&&member.roles.cache.has(KONV_TAG_ROLE);
        const pg=(member&&member.user&&member.user.primaryGuild)||null;
        const hasKonv=hasRole||(pg&&pg.identityEnabled&&pg.identityGuildId===CONFIG.GUILD_ID);
        if(!hasKonv)return interaction.reply({content:"\u274C You need the **KONV** clan tag to enter. Set Konvert as your active clan in Discord settings, then run `/claimtag`.",ephemeral:true});
        if(state.activeGiveaway.entrants.has(userId))return interaction.reply({content:"\u2705 You are already entered! Good luck \uD83C\uDF89",ephemeral:true});
        state.activeGiveaway.entrants.add(userId);
        const count=state.activeGiveaway.entrants.size;
        return interaction.reply({content:`\uD83C\uDF89 You are in! **${count}** ${count===1?"person":"people"} entered. Good luck!`,ephemeral:true});
      }

      if(interaction.customId==="btn_confirm_ticket"){if(!interaction.deferred&&!interaction.replied)await interaction.deferUpdate().catch(()=>{});const pending=state.pending[interaction.user.id];if(!pending)return interaction.editReply({content:"Session expired. Please start again.",embeds:[],components:[]});delete state.pending[interaction.user.id];const ch=await createTicket(interaction,pending.method,pending.direction,pending.rawAmt,pending.coin,pending.walletInf,pending.notes,pending.recvCoin||null);if(ch)return interaction.editReply({content:`Ticket opened \u2192 <#${ch.id}>`,embeds:[],components:[]});return;}
      if(interaction.customId==="btn_cancel_ticket"){delete state.pending[interaction.user.id];return interaction.update({content:"Cancelled. Click Exchange Now to start again.",embeds:[],components:[]});}

      if(interaction.customId==="btn_support_ticket"){
        const modal=new ModalBuilder().setCustomId("modal_support").setTitle("Open a Support Ticket");
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("sup_issue").setLabel("What do you need help with?").setStyle(TextInputStyle.Paragraph).setPlaceholder("Describe your issue clearly...").setRequired(true)),new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("sup_tried").setLabel("What have you already tried?").setStyle(TextInputStyle.Short).setPlaceholder("e.g. Checked FAQ, contacted staff").setRequired(false)));
        return interaction.showModal(modal);
      }

      if(interaction.customId==="btn_done"){
        const tickets=Object.keys(_mem.tickets||{}).length>0?_mem.tickets:load("tickets");
        const ticket=tickets[interaction.channel.id];
        const isOwner=CONFIG.OWNER_IDS.includes(interaction.user.id);
        const isStaff=CONFIG.STAFF_ROLE?interaction.member.roles.cache.has(CONFIG.STAFF_ROLE):false;
        const mRoleId=ticket?.method?CONFIG.ROLES[ticket.method]:null;
        const isHandler=mRoleId?interaction.member.roles.cache.has(mRoleId):false;
        const isAnyExchanger=CONFIG.EXCHANGER_ROLE?interaction.member.roles.cache.has(CONFIG.EXCHANGER_ROLE):false;
        const allExchangerRoles=Object.values(CONFIG.ROLES).filter(Boolean);
        const hasAnyExchangerRole=allExchangerRoles.some(r=>interaction.member.roles.cache.has(r));
        if(!isOwner&&!isStaff&&!isHandler&&!isAnyExchanger&&!hasAnyExchangerRole)return interaction.reply({content:"Only exchangers can mark an exchange complete.",ephemeral:true});
        if(ticket?.status==="vouched"||ticket?.status==="closed")return interaction.reply({content:"This exchange has already been completed.",ephemeral:true});
        // Auto-complete — person who clicks IS the exchanger, no form needed
        await interaction.deferReply();
        await completeTrade(interaction,ticket,tickets);
        return;
      }
      if(interaction.customId==="btn_close"){
        if(!CONFIG.OWNER_IDS.includes(interaction.user.id)&&!(CONFIG.STAFF_ROLE&&interaction.member.roles.cache.has(CONFIG.STAFF_ROLE)))return interaction.reply({content:"Only owners or staff can close tickets.",ephemeral:true});
        await interaction.deferReply();await doCloseTicket(interaction.channel,interaction.guild,interaction.user,"Closed by staff");
        await interaction.editReply({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO}).setTitle("Ticket Closed").setDescription("This ticket has been closed by staff.\nDeleting in 15 seconds.").setTimestamp()]});
        setTimeout(()=>interaction.channel.delete().catch(()=>{}),15000);return;
      }

      if(interaction.customId.startsWith("mine_cell_")){
        const parts=interaction.customId.split("_"),userId=parts[2],idx=parseInt(parts[3]);
        if(interaction.user.id!==userId)return interaction.reply({content:"This is not your mine game.",ephemeral:true});
        const game=state.mineGames[userId];
        if(!game)return interaction.reply({content:"No active game. Use /mine to start.",ephemeral:true});
        if(game.over)return interaction.reply({content:"This game is already over.",ephemeral:true});
        if(game.revealed.includes(idx))return interaction.reply({content:"You already revealed that cell.",ephemeral:true});
        game.revealed.push(idx);game.tries++;
        const isDiamond=game.diamonds.includes(idx),isBomb=game.bombs.includes(idx);
        if(isDiamond)game.found++;
        if(isBomb){game.over=true;delete state.mineGames[userId];const rev={...game,revealed:Array.from({length:25},(_,i)=>i),over:true};return interaction.update({embeds:[base("Mine -- Bomb Hit").setColor(0x7C4DFF).setDescription("**BOOM!** You hit a bomb.\n\nBetter luck next time -- you can try again in **3 hours**.\n\u200b").addFields({name:"Diamonds Found",value:`**${game.found} / 3**`,inline:true},{name:"Result",value:"No pass awarded",inline:true},{name:"Next Try",value:"In **3 hours**",inline:true}).setFooter({text:"Konvert Mine  \u2022  Try again in 3 hours"})],components:buildMineGrid(userId,rev)});}
        const triesLeft=3-game.tries;
        if(triesLeft<=0&&game.found<3){game.over=true;delete state.mineGames[userId];const rev={...game,revealed:Array.from({length:25},(_,i)=>i),over:true};return interaction.update({embeds:[base("Mine -- Out of Tries").setDescription(`You used all **3 tries** and found **${game.found} / 3** diamonds.\nThe grid has been revealed. Try again in **3 hours**.\n\u200b`).addFields({name:"Diamonds Found",value:`**${game.found} / 3**`,inline:true},{name:"Result",value:"No pass awarded",inline:true},{name:"Next Try",value:"In **3 hours**",inline:true}).setFooter({text:"Konvert Mine  \u2022  Try again in 3 hours"})],components:buildMineGrid(userId,rev)});}
        if(game.found===3){
          game.over=true;delete state.mineGames[userId];state.passes[userId]=(state.passes[userId]||0)+1;
          try{const mem=await interaction.guild.members.fetch(userId);if(CONFIG.PASS_ROLE)await mem.roles.add(CONFIG.PASS_ROLE);}catch{}
          for(const oid of CONFIG.OWNER_IDS){try{const o=await client.users.fetch(oid);await o.send({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Mine -- Winner",iconURL:IMG.LOGO}).setTitle("Exchange Pass Won").setDescription(`<@${userId}> (${interaction.user.tag}) found all 3 diamonds and won a free exchange pass.\nTotal passes: **${state.passes[userId]}**`).setTimestamp()]});}catch{}}
          return interaction.update({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert",iconURL:IMG.LOGO}).setTitle("All 3 Diamonds Found").setDescription("You found every diamond without hitting a bomb.\n\nA **Free Exchange Pass** has been awarded and the role has been added to your account.\nOpen a ticket and let staff know.\n\u200b").addFields({name:"Pass Holder",value:`<@${userId}>`,inline:true},{name:"Passes",value:`**${state.passes[userId]}**`,inline:true},{name:"Tries Used",value:`**${game.tries} / 3**`,inline:true}).setFooter({text:"Konvert Mine  \u2022  Screenshot this as proof"}).setTimestamp()],components:[]});
        }
        return interaction.update({embeds:[base("Konvert Mine").setThumbnail(IMG.LOGO).setDescription(`${isDiamond?"**Diamond found!** Keep going.":"Nothing there. Keep looking."}\n\u200b`).addFields({name:"Diamonds Found",value:`**${game.found} / 3**`,inline:true},{name:"Tries Remaining",value:`**${triesLeft}**`,inline:true}).setFooter({text:`Konvert Mine  \u2022  ${triesLeft} tr${triesLeft!==1?"ies":"y"} left  \u2022  Hit a bomb = game over`})],components:buildMineGrid(userId,game)});
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
      
      if(interaction.customId==="modal_support"){
        const issue=interaction.fields.getTextInputValue("sup_issue"),tried=interaction.fields.getTextInputValue("sup_tried")||"Not specified",user=interaction.user,guild=interaction.guild;
        let ch;
        try{ch=await guild.channels.create({name:`support-${user.username.replace(/[^a-z0-9]/gi,"").toLowerCase().slice(0,12)}`,type:ChannelType.GuildText,parent:CONFIG.TICKET_CATEGORY||null,permissionOverwrites:[{id:guild.roles.everyone,deny:[PermissionFlagsBits.ViewChannel]},{id:user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]},...(CONFIG.STAFF_ROLE?[{id:CONFIG.STAFF_ROLE,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.ManageChannels]}]:[]),...CONFIG.OWNER_IDS.map(id=>({id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.ManageChannels]}))]});}catch{return interaction.reply({content:"Failed to create support channel.",ephemeral:true});}
        await ch.send({content:`<@${user.id}>`,embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert  \u2022  Support",iconURL:IMG.LOGO}).setTitle("Support Ticket").setThumbnail(IMG.LOGO).setDescription(`**Welcome, <@${user.id}>**\n\nStaff will assist you shortly. Please be patient.\n\u200b`).addFields({name:"Issue",value:issue,inline:false},{name:"What Tried",value:tried,inline:false}).setTimestamp().setFooter({text:"Konvert  \u2022  Support Ticket"})],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("btn_close").setLabel("Close Ticket").setStyle(ButtonStyle.Danger))]});
        if(CONFIG.STAFF_ROLE)await ch.send(`<@&${CONFIG.STAFF_ROLE}> -- New support ticket from <@${user.id}>`);
        log(guild,`SUPPORT: #${ch.name} opened by ${user.tag}`);
        return interaction.reply({content:`Support ticket opened \u2192 <#${ch.id}>`,ephemeral:true});
      }

      if(interaction.customId==="modal_review"){const text=interaction.fields.getTextInputValue("review_text"),rating=Math.min(Math.max(parseInt(interaction.fields.getTextInputValue("review_rating"))||5,1),5),stars="\u2605".repeat(rating)+"\u2606".repeat(5-rating),targetCh=CONFIG.VOUCH_CHANNEL?interaction.guild.channels.cache.get(CONFIG.VOUCH_CHANNEL):interaction.channel;if(!targetCh)return interaction.reply({content:"Review channel not configured.",ephemeral:true});await targetCh.send({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO}).setTitle("Community Review").setDescription(`*"${text}"*`).addFields({name:"From",value:`<@${interaction.user.id}>`,inline:true},{name:"Rating",value:stars,inline:true}).setTimestamp().setFooter({text:"Konvert  \u2022  Community Review"})]});return interaction.reply({content:"Your review has been posted. Thank you!",ephemeral:true});}

      if(interaction.customId==="modal_fee"){
        const raw=parseFloat(interaction.fields.getTextInputValue("fee_amt"));
        if(isNaN(raw)||raw<=0)return interaction.reply({content:"Please enter a valid amount.",ephemeral:true});
        await interaction.deferReply({ephemeral:true});
        const fS=calcFee(raw,"send"),rS=feeRate(raw,"send"),fR=calcFee(raw,"receive"),rR=feeRate(raw,"receive");
        const [btcP,ethP,solP]=await Promise.all([getPrice("BTC"),getPrice("ETH"),getPrice("SOL")]);
        const recvS=raw-fS,coinLines=[];
        if(btcP)coinLines.push(`BTC: **${(recvS/btcP).toFixed(6)}**`);if(ethP)coinLines.push(`ETH: **${(recvS/ethP).toFixed(5)}**`);if(solP)coinLines.push(`SOL: **${(recvS/solP).toFixed(4)}**`);
        return interaction.editReply({embeds:[base("Fee Calculator").setThumbnail(IMG.LOGO).setDescription(`Estimate for **${fmtUSD(raw)}**\n*Final fee may vary slightly.*\n\u200b`).addFields({name:"Fiat \u2192 Crypto",value:`Rate: **${rS}%**\nFee: **${fmtUSD(fS)}**\nYou receive: **${fmtUSD(recvS)}**`,inline:true},{name:"Crypto \u2192 Fiat",value:`Rate: **${rR}%**\nFee: **${fmtUSD(fR)}**\nYou receive: **${fmtUSD(raw-fR)}**`,inline:true},{name:"\uD83E\uDE99 Coin Amounts",value:coinLines.length?coinLines.join("  \u00b7  "):"--",inline:false}).setImage(IMG.FEE).setFooter({text:"Konvert  \u2022  Open a ticket to begin"})]});
      }

      if(interaction.customId.startsWith("modal_c2c__")){
        await interaction.deferReply({ephemeral:true});
        const parts=interaction.customId.split("__"),sendCoin=parts[1],recvCoin=parts[2];
        const rawAmt=parseFloat(interaction.fields.getTextInputValue("c2c_amount"));
        if(isNaN(rawAmt)||rawAmt<=0)return interaction.editReply("Please enter a valid amount greater than $0.");
        const fee=Math.max(rawAmt*0.02,3),rate=2;
        state.pending[interaction.user.id]={method:"crypto",direction:"send",rawAmt,coin:sendCoin,walletInf:"C2C — staff will confirm wallet in ticket",notes:"",recvCoin};
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO}).setTitle("Confirm Crypto to Crypto Exchange").setThumbnail(COIN_LOGO[sendCoin]||IMG.LOGO).setDescription("Review your details before confirming. Staff will handle wallet addresses inside your ticket.\n\u200b").addFields({name:"You Send",value:`**${sendCoin}** worth **${fmtUSD(rawAmt)}**`,inline:true},{name:"You Receive",value:`**${recvCoin}**`,inline:true},{name:"Fee",value:`**2%** \u2014 ${fmtUSD(fee)}`,inline:true}).setFooter({text:"Wallet addresses confirmed inside your ticket  \u2022  Konvert"})],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("btn_confirm_ticket").setLabel("Confirm & Open Ticket").setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId("btn_cancel_ticket").setLabel("Cancel").setStyle(ButtonStyle.Secondary))]});
      }

      if(interaction.customId.startsWith("modal_amount__")){
        await interaction.deferReply({ephemeral:true});
        const parts=interaction.customId.split("__"),method=parts[1],direction=parts[2],m=getMethod(method);
        const _rawCoin=interaction.fields.getTextInputValue("inp_coin").trim();
        const coin=resolveCoin(_rawCoin);
        const rawAmt=parseFloat(interaction.fields.getTextInputValue("inp_amount"));
        const walletInf="Staff will confirm wallet and payment details in your ticket",notes="";
        if(isNaN(rawAmt)||rawAmt<=0)return interaction.editReply("Please enter a valid amount greater than $0.");
        if(rawAmt<5)return interaction.editReply("\u274C Minimum exchange amount is **$5.00**. Please enter a higher amount.");
        // any coin accepted — ticket opens regardless
        const fee=calcFee(rawAmt,direction),rate=feeRate(rawAmt,direction),recv=rawAmt-fee;
        const sendLabel=direction==="send"?`**${fmtUSD(rawAmt)}** via ${m.label}`:`**${coin}** worth **${fmtUSD(rawAmt)}**`;
        let recvLabel=direction==="send"?(recv<5?"To be discussed":`~${fmtUSD(recv)} worth of ${coin}`):(`${fmtUSD(recv)} via ${m.label}`);
        if(direction==="send"){try{const coinPrice=await getPrice(coin);if(coinPrice)recvLabel=`~${(recv/coinPrice).toFixed(6)} ${coin} (${fmtUSD(recv)})`;}catch{}}
        state.pending[interaction.user.id]={method,direction,rawAmt,coin,walletInf,notes};
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO}).setTitle("Confirm Your Exchange").setThumbnail(COIN_LOGO[coin]||IMG.LOGO).setDescription("Review your details and click Confirm to open your ticket. Staff will share wallet details inside.\n\u200b").addFields({name:"Method",value:`**${m.label}**`,inline:true},{name:"Crypto",value:`**${coin}**`,inline:true},{name:"Direction",value:`**${direction==="send"?"Fiat to Crypto":"Crypto to Fiat"}**`,inline:true},{name:"Amount",value:`**${fmtUSD(rawAmt)}**`,inline:true},{name:"Est. Fee",value:`**${rate}%** - ${fmtUSD(fee)}`,inline:true},{name:"You Receive",value:recvLabel,inline:true}).setFooter({text:"Wallet details handled inside your ticket  \u2022  Konvert"})],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("btn_confirm_ticket").setLabel("Confirm & Open Ticket").setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId("btn_cancel_ticket").setLabel("Cancel").setStyle(ButtonStyle.Secondary))]});
      }
    }

  }catch(err){
    console.error("Interaction error:",err);
    try{const errMsg={content:"Something went wrong. Please try again.",ephemeral:true};if(interaction.deferred||interaction.replied)await interaction.followUp(errMsg).catch(()=>{});else await interaction.reply(errMsg).catch(()=>{});}catch{}
  }
});

// ── LIVE LEADERBOARD ─────────────────────────────────────────────────────────
async function buildLiveLeaderboardEmbed(){
  const byUser=buildLeaderboardVolumes();
  const ranked=Object.entries(byUser).sort((a,b)=>b[1]-a[1]).slice(0,10);
  const totalVol=ranked.reduce((s,[,v])=>s+v,0);
  const medals=["\uD83E\uDD47","\uD83E\uDD48","\uD83E\uDD49"];
  const timeStr=new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"});
  if(!ranked.length){
    return new EmbedBuilder()
      .setColor(0x7C4DFF)
      .setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO})
      .setTitle("\uD83C\uDFC6 Leaderboard")
      .setDescription("No exchanges yet.")
      .setFooter({text:`Updated ${timeStr}`})
      .setTimestamp();
  }
  const lines=ranked.map(([uid,vol],i)=>{
    const tier=getTier(vol);
    const rank=medals[i]||`\`#${i+1}\``;
    return `${rank} <@${uid}>  \u2014  **${fmtUSD(vol)}** ${tier.emoji}`;
  }).join("\n");
  return new EmbedBuilder()
    .setColor(0x7C4DFF)
    .setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO})
    .setTitle("\uD83C\uDFC6 Top 10 Leaderboard")
    .setDescription(lines)
    .setFooter({text:`Total: ${fmtUSD(totalVol)}  \u00b7  Updated ${timeStr}`})
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
  const ids=[...new Set(state.alerts.map(a=>GECKO[a.coin]||a.coin.toLowerCase()))].join(",");
  try{
    const res=await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,{signal:AbortSignal.timeout(8000)});
    const prices=await res.json(),fired=[];
    for(const alert of state.alerts){
      const price=prices[GECKO[alert.coin]||alert.coin.toLowerCase()]?.usd;
      if(!price||!(alert.direction==="above"?price>=alert.target:price<=alert.target))continue;
      try{const user=await client.users.fetch(alert.userId);await user.send({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO}).setTitle("Price Alert Triggered").setDescription(`**${alert.coin}** is now **${alert.direction==="above"?"above":"below"}** your target of **$${alert.target.toLocaleString("en-US")}**\n\nCurrent price: **$${price.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}**\n\nHead to <#${CONFIG.EXCHANGE_CHANNEL}> to open a trade.`).setThumbnail(COIN_LOGO[alert.coin]||IMG.LOGO).setTimestamp().setFooter({text:"Konvert  \u2022  Price Alerts"})]});}catch{}
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
    const {REST}=require("@discordjs/rest");
    const rest=new REST({version:"10"}).setToken(CONFIG.TOKEN);
    await rest.patch(`/channels/${STAT_CHANNEL_ID}`,{body:{name:newName}});
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
    const facts=["Bitcoin was worth less than $0.01 when it first launched in 2009. The first real-world transaction used 10,000 BTC to buy two pizzas.","Ethereum's smart contracts allow code to run automatically without any middleman — the basis for DeFi, NFTs, and thousands of dApps.","Satoshi Nakamoto, Bitcoin's creator, has never moved their estimated 1 million BTC wallet — worth billions — since mining it in 2009.","There will only ever be 21 million Bitcoin. Around 19.7 million have already been mined. The last one won't be mined until around 2140.","Over 20% of all Bitcoin is estimated to be permanently lost — forgotten wallets, lost keys, and early miners who didn't think it would be worth anything.","Solana can process up to 65,000 transactions per second. Visa handles around 24,000. Bitcoin handles around 7.","El Salvador became the first country to adopt Bitcoin as legal tender in 2021. Citizens can pay taxes and buy groceries with it.","The term 'HODL' came from a 2013 forum post where someone drunkenly misspelled 'hold'. It's now a core crypto philosophy.","Crypto markets never close. Unlike stocks, you can trade Bitcoin at 3am on Christmas Day.","Tether (USDT) is the most traded cryptocurrency by volume — more than Bitcoin or Ethereum on most days.","DeFi protocols collectively hold over $50 billion in locked assets, all managed by code with no banks involved.","The first Bitcoin ATM opened in Vancouver, Canada in 2013. There are now over 38,000 worldwide.","Ethereum burns a portion of every transaction fee permanently, making it deflationary over time.","Lightning Network allows Bitcoin transactions to settle in milliseconds for fractions of a cent — solving the scalability problem.","Crypto wallets don't actually store crypto. They store the private keys that prove ownership on the blockchain.","Over 560 million people worldwide own some form of cryptocurrency as of 2024.","A single Dogecoin was worth $0.0002 in 2019. At its peak in 2021, it hit $0.74 — a 3,700x increase.","The blockchain cannot be edited or deleted. Every transaction ever made on Bitcoin is permanently visible to anyone.","Ripple (XRP) can settle international bank transfers in 3–5 seconds for a fraction of a cent, vs 3–5 business days for SWIFT.","Gas fees on Ethereum once hit over $200 per transaction during peak NFT demand in 2021.","Cold wallets — hardware devices not connected to the internet — are considered the safest way to store large amounts of crypto.","Binance processes over $10 billion in trades daily, making it the largest crypto exchange in the world by volume.","The Bitcoin halving happens every 4 years, cutting miner rewards in half. Historically, each halving has preceded a major bull run.","Stablecoins like USDC are backed 1:1 by US dollars held in reserve, making them immune to crypto volatility.","Crypto transactions are pseudonymous, not anonymous. Every transaction is traceable on the public blockchain.","Avalanche (AVAX) can finalize transactions in under 2 seconds — one of the fastest finality times of any blockchain.","There are over 20,000 different cryptocurrencies in existence. The vast majority have little to no value.","Michael Saylor's MicroStrategy holds over 200,000 BTC on its balance sheet — more than most countries.","Ethereum's merge to Proof of Stake in 2022 reduced its energy consumption by over 99.9%.","The total crypto market cap has exceeded $3 trillion — larger than the GDP of most countries.","Bitcoin's anonymous creator, Satoshi Nakamoto, published the whitepaper on October 31, 2008 — Halloween.","The Bitcoin genesis block contains a hidden message referencing a UK newspaper headline about bank bailouts.","Vitalik Buterin proposed Ethereum at age 19, and it launched in 2015 when he was just 21.","Mt. Gox, once the largest Bitcoin exchange, handled over 70% of all BTC transactions before its 2014 collapse.","A Norwegian man bought 5,000 Bitcoin for $27 in 2009. By 2021, it was worth over $1 million.","Wrapped Bitcoin (WBTC) lets BTC holders use their coins on Ethereum-based DeFi platforms.","The Lightning Network can theoretically support millions of transactions per second across its network of channels.","NFTs are technically just tokens that point to a piece of data — the art itself is usually stored off-chain.","Proof of Work mining consumes more electricity annually than some entire countries, including Argentina.","Ethereum's 'gas' is named because it's the fuel that powers computation on the network — pay more, go faster.","Polygon processes more daily transactions than Ethereum mainnet at a fraction of the cost.","The first NFT, 'Quantum,' was minted by Kevin McCoy in 2014 — years before the NFT boom.","Coinbase went public via direct listing on Nasdaq in April 2021, valued at over $85 billion at the time.","Monero is designed for complete privacy — transaction amounts, sender, and receiver are all hidden by default.","Cardano was founded by Ethereum co-founder Charles Hoskinson and focuses on academic peer-reviewed research.","Shiba Inu (SHIB) was created as a 'Dogecoin killer' and at one point had a market cap over $40 billion.","The term 'whale' refers to someone holding enough crypto to move markets with a single trade.","Bitcoin's block time averages 10 minutes — Ethereum's is around 12 seconds.","Some countries, like China, have banned crypto trading multiple times but still lead in mining hardware production.","A '51% attack' happens when a single entity controls majority mining power and can manipulate the blockchain.","The Ethereum Merge in September 2022 was one of the most significant upgrades in blockchain history, switching from mining to staking.","USDT (Tether) processes more transaction volume daily than Bitcoin and Ethereum combined.","Crypto.com paid $700 million for the naming rights to the Staples Center, renaming it Crypto.com Arena.","The Bored Ape Yacht Club NFT collection generated over $1 billion in total trading volume.","Smart contracts can't be paused or changed once deployed unless the developer builds in an upgrade mechanism.","Binance Smart Chain (now BNB Chain) was created to offer Ethereum-compatible apps with lower fees.","The largest single crypto heist was the Poly Network hack in 2021 — $611 million was stolen, then mostly returned.","Bitcoin mining difficulty adjusts roughly every two weeks to keep block times consistent.","Litecoin was created in 2011 as a 'lite' version of Bitcoin with faster block times.","The Ethereum Name Service (ENS) lets you replace a long wallet address with something like 'yourname.eth'.","Decentralized exchanges (DEXs) like Uniswap let you trade crypto without ever giving up custody of your funds.","Ordinals brought NFT-like functionality directly to the Bitcoin blockchain in 2023.","Some Bitcoin ATMs charge fees as high as 15-20% — always check rates before using one.","The crypto term 'rug pull' describes when developers abandon a project and run off with investor funds.","Solana suffered several major network outages in 2021-2022 due to transaction spam from bot trading.","Avalanche uses three separate blockchains working together — the X-Chain, C-Chain, and P-Chain.","A 'cold wallet' that's never connected to the internet is also called 'air-gapped' storage.","The Genesis block of Bitcoin can never be spent — it's permanently locked by design.","Crypto winters — extended bear markets — have happened in 2014, 2018, and 2022, each followed by major recoveries.","PayPal began allowing US users to buy, sell, and hold crypto directly in 2020.","The DAO hack in 2016 led to a hard fork of Ethereum, creating Ethereum Classic as a separate chain.","Some companies pay employees partially in crypto, including parts of Latin America with high inflation.","Chainlink provides 'oracles' — services that feed real-world data like prices into smart contracts.","A single Ethereum transaction once cost over $400 in gas fees during the 2021 NFT craze.","Tesla bought $1.5 billion in Bitcoin in 2021, briefly accepted it for car purchases, then stopped.","The Pizza transaction — 10,000 BTC for two pizzas in 2010 — is celebrated every May 22nd as 'Bitcoin Pizza Day'.","Crypto exchanges process trades 24/7/365 — there are no holidays or weekends in crypto markets.","Some blockchains, like Algorand, are carbon-negative, offsetting more emissions than they produce.","The total number of Bitcoin addresses with a non-zero balance has grown to over 50 million.","Dogecoin started as a joke in 2013 based on the 'Doge' meme featuring a Shiba Inu.","MetaMask, one of the most popular crypto wallets, has over 30 million monthly active users.","The first Bitcoin exchange rate was set in 2010 at roughly $0.0008 per BTC.","Some NFT projects include 'royalties' that pay the original creator a percentage every time the NFT resells.","Bitcoin's hash rate — the total computing power securing the network — has grown over a billion times since 2010.","Smart contract bugs have led to billions in losses; the 2022 Wormhole hack alone cost $325 million.","Layer 2 solutions like Arbitrum and Optimism process transactions off the main Ethereum chain to reduce costs.","Crypto staking lets holders earn rewards simply for locking up their coins to help secure the network.","The phrase 'not your keys, not your coins' emphasizes self-custody over keeping crypto on exchanges.","Bitcoin Cash split from Bitcoin in 2017 over disagreements about block size limits.","The first country-wide Bitcoin mining ban was implemented by China in 2021, shifting mining to the US and Kazakhstan.","Crypto.com, Binance, and Coinbase are among the top 5 most downloaded finance apps globally most years.","An estimated 4 million BTC belonging to Satoshi Nakamoto have never moved since being mined.","Polkadot allows multiple blockchains to transfer data and assets between each other seamlessly.","The Ethereum Virtual Machine (EVM) is so widely copied that dozens of other blockchains run EVM-compatible code.","Crypto debit cards from companies like Crypto.com let you spend crypto anywhere Visa is accepted, with automatic conversion.","A single Bitcoin can be divided into 100 million units called 'satoshis,' named after its creator.","The largest Bitcoin transaction ever recorded moved over $1 billion worth of BTC in a single transfer.","Some DeFi protocols offer 'flash loans' — borrowing millions with zero collateral, repaid within the same transaction.","Argentina has one of the highest crypto adoption rates in the world due to currency instability.","The Ethereum network processes roughly 1 million transactions per day.","Crypto Twitter (now X) has been a major driver of meme coin pumps, including Dogecoin and Shiba Inu.","Hardware wallets like Ledger and Trezor store private keys on a physical device disconnected from the internet.","The SEC has sued multiple major exchanges over claims that certain tokens are unregistered securities.","Bitcoin's price has experienced over 10 corrections of more than 30% throughout its history.","Solana's mascot, a smiling sun-like logo, represents speed and 'proof of history' consensus.","Crypto faucets are websites that give away tiny amounts of crypto for completing simple tasks — mostly used for testing.","The Genesis Bitcoin block reward was 50 BTC — today it's down to 3.125 BTC after multiple halvings.","Yield farming involves moving crypto between DeFi protocols to chase the highest available interest rates.","The first decentralized stablecoin, DAI, is backed by crypto collateral rather than dollars in a bank.","Ethereum co-founder Gavin Wood coined the term 'Web3' to describe a decentralized internet.","Bitcoin mining farms in Texas often use excess wind and solar power that would otherwise go to waste.","Crypto airdrops — free token distributions — have made some early users millions for doing almost nothing.","The Lightning Network's largest public node can route payments through thousands of connected channels.","Some video games now let players earn real crypto by playing — known as 'play-to-earn' gaming.","Total value locked (TVL) in DeFi peaked at over $180 billion in late 2021 before falling sharply.","Bitcoin's all-time high in 2021 came just months before one of its steepest crashes in history.","The Sandbox and Decentraland are virtual worlds where users buy and sell virtual land using crypto.","Ripple's XRP was created in 2012 specifically for fast, low-cost cross-border payments between banks.","Crypto wallets generate a 'seed phrase' — usually 12 or 24 words — that can restore your entire wallet if lost.","The blockchain industry employs over 1 million people worldwide across development, trading, and infrastructure.","Some museums now display NFT art on digital screens alongside traditional paintings.","A Bitcoin transaction is considered 'confirmed' after roughly 6 blocks, taking about an hour.","Stablecoin transfers make up a majority of all crypto transaction volume on most blockchains.","The first Bitcoin conference was held in 2011 in New York with fewer than 100 attendees.","Some countries offer tax exemptions for crypto held longer than a year, similar to long-term capital gains.","Uniswap's automated market maker model lets anyone provide liquidity and earn trading fees.","Crypto scams cost victims over $10 billion globally in 2023 alone, according to FBI reports.","The phrase 'to the moon' originated from crypto communities expressing hope for massive price increases.","Ethereum's total supply has no hard cap, unlike Bitcoin's fixed 21 million.","Some NFT collections grant holders access to private Discord communities, events, or real-world perks.","The crypto market operates without a central clearing house — settlement happens directly on the blockchain.","Bitcoin dominance — its share of the total crypto market cap — has ranged from under 40% to over 70% historically."];
    const fact=facts[Math.floor(Math.random()*facts.length)];
    const coins=["BTC","ETH","SOL","XRP","BNB","ADA","DOGE","AVAX","LTC","DOT"];
    const featuredCoin=coins[Math.floor(Math.random()*coins.length)];
    let priceStr="";try{const p=await getPrice(featuredCoin);if(p)priceStr=` \u00b7 **${featuredCoin}: ${fmtUSD(p)}**`;}catch{}
    await ch.send({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert Exchange  \u00b7  Daily Crypto Fact",iconURL:IMG.LOGO}).setTitle("Did You Know?").setThumbnail(COIN_LOGO[featuredCoin]||IMG.LOGO).setDescription(`${fact}\n\u200b`).addFields({name:"Live Price",value:`${featuredCoin}${priceStr||" \u2014 unavailable"}`,inline:true},{name:"Trade Now",value:`Open a ticket in <#${CONFIG.EXCHANGE_CHANNEL}>`,inline:true}).setImage(IMG.BANNER).setFooter({text:"Konvert Exchange  \u00b7  Daily fact \u2014 come back tomorrow for another"}).setTimestamp()]});
    console.log("[dailyFact] posted");
  }catch(e){console.error("[dailyFact]",e.message);}
}

function scheduleDailyFact(guild){
  function msUntil9am(){const now=new Date(),next=new Date(now);next.setUTCHours(13,0,0,0);if(next<=now)next.setUTCDate(next.getUTCDate()+1);return next.getTime()-now.getTime();}
  const delay=msUntil9am();console.log(`[dailyFact] first post in ${Math.round(delay/3600000)}h`);
  setTimeout(()=>{postDailyCryptoFact(guild).catch(()=>{});setInterval(()=>postDailyCryptoFact(guild).catch(()=>{}),24*60*60*1000);},delay);
}

async function postWeeklyReferralSummary(guild){
  try{
    const ch=guild.channels.cache.get(GENERAL_CHANNEL_ID)||await guild.channels.fetch(GENERAL_CHANNEL_ID).catch(()=>null);
    if(!ch){console.log("[weeklyRef] general channel not found");return;}
    const ref=getReferrals(),now=Date.now(),weekAgo=now-(7*24*60*60*1000);
    const weekPts={};
    for(const [uid,data] of Object.entries(ref.points||{})){const earned=(data.history||[]).filter(h=>h.type==="earned"&&h.at>=weekAgo).reduce((s,h)=>s+(h.points||0),0);if(earned>0)weekPts[uid]=earned;}
    const ranked=Object.entries(weekPts).sort((a,b)=>b[1]-a[1]).slice(0,5);
    const totalReferrers=Object.keys(ref.points||{}).filter(uid=>(ref.points[uid].balance||0)+(ref.points[uid].paid||0)>0).length;
    const totalReferred=Object.keys(ref.referred||{}).length;
    const weekTickets=Object.values(_mem.tickets||load("tickets")).filter(t=>["vouched","completed"].includes(t.status)&&t.completedAt&&t.completedAt>=weekAgo&&t.method!=="adjustment");
    const weekVolume=weekTickets.reduce((s,t)=>s+(parseFloat(t.amountUSD)||0),0);
    const medals=["🥇","🥈","🥉","4.","5."];
    const topLines=ranked.length?ranked.map(([uid,pts],i)=>`${medals[i]}  <@${uid}>  \u2014  **${pts} pts** ($${pointsToDollars(pts)})`).join("\n"):"No referral activity this week.";
    await ch.send({embeds:[new EmbedBuilder().setColor(0x7C4DFF).setAuthor({name:"Konvert  \u00b7  Weekly Referral Report",iconURL:PTS_IMG}).setTitle("Weekly Referral Summary").setThumbnail(PTS_IMG).setDescription(`Here's how the referral program performed this week.\n\u200b`).addFields({name:"\uD83D\uDCCA  This Week's Volume",value:`**${fmtUSD(weekVolume)}** across **${weekTickets.length}** trades`,inline:false},{name:"\uD83D\uDC65  Total Referred Members",value:`**${totalReferred}**`,inline:true},{name:"\uD83D\uDD17  Active Referrers",value:`**${totalReferrers}**`,inline:true},{name:"\u200b",value:"\u200b",inline:true},{name:"\uD83C\uDFC6  Top Earners This Week",value:topLines,inline:false},{name:"\uD83D\uDCA1  Want to earn?",value:`Use \`/referral\` to get your personal invite link. You earn points every time someone you refer completes a trade.\n**${POINTS_PER_100} pts per $100 traded  \u00b7  ${POINTS_PER_DOLLAR} pts = $1**`,inline:false}).setImage(IMG.BANNER).setFooter({text:"Konvert Referral Program  \u00b7  Every Monday"}).setTimestamp()]});
    console.log("[weeklyRef] summary posted");
  }catch(e){console.error("[weeklyRef]",e.message);}
}


// ── DAILY OWNER DIGEST ──────────────────────────────────────────────────────
// Every day at 11pm UTC, DM all owners a quick performance summary
async function postDailyDigest(guild){
  try{
    const allT=Object.values(_mem.tickets&&Object.keys(_mem.tickets).length?_mem.tickets:load("tickets"));
    const now=new Date();
    // EST midnight (UTC-5)
    const estMidnight=new Date(now);
    estMidnight.setUTCHours(5,0,0,0); // 5am UTC = midnight EST
    if(estMidnight>now)estMidnight.setUTCDate(estMidnight.getUTCDate()-1);
    const todayStart=estMidnight.getTime();
    const done=allT.filter(t=>["vouched","completed"].includes(t.status)&&t.method!=="adjustment"&&parseFloat(t.amountUSD||0)>0);
    const today=done.filter(t=>t.completedAt&&t.completedAt>=todayStart);
    const todayVol=today.reduce((s,t)=>s+(parseFloat(t.amountUSD)||0),0);
    const todayFees=today.reduce((s,t)=>s+(parseFloat(t.feeUSD)||0),0);
    const open=allT.filter(t=>t.status==="open"&&t.method!=="adjustment").length;
    const disputes=allT.filter(t=>t.status==="dispute").length;

    // Top exchanger today
    const byEx={};
    today.forEach(t=>{if(t.completedBy){byEx[t.completedBy]=(byEx[t.completedBy]||0)+(parseFloat(t.amountUSD)||0);}});
    const topEx=Object.entries(byEx).sort((a,b)=>b[1]-a[1])[0];

    // New referrals today
    const ref=getReferrals();
    const newRefs=Object.entries(ref.referred||{}).filter(([,refAt])=>{
      // referred doesn't have timestamps in current schema, skip if unavailable
      return false;
    }).length;

    if(today.length===0&&open===0&&disputes===0){
      console.log("[dailyDigest] nothing to report, skipping");
      return;
    }

    const allVol=done.reduce((s,t)=>s+(parseFloat(t.amountUSD)||0),0);
    const estDate=new Date(now.getTime()-5*3600000);
    const dateStr=estDate.toLocaleDateString("en-CA",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
    const embed=new EmbedBuilder()
      .setColor(0x7C4DFF)
      .setAuthor({name:"Konvert Exchange  \u00b7  Daily Digest",iconURL:IMG.LOGO})
      .setTitle(`Daily Summary — ${dateStr} (EST)`)
      .addFields(
        {name:"\uD83D\uDCB0 Volume Today",value:`**${fmtUSD(todayVol)}**`,inline:true},
        {name:"\u2705 Exchanges Today",value:`**${today.length}**`,inline:true},
        {name:"\uD83D\uDCB8 Fees Today",value:`**${fmtUSD(todayFees)}**`,inline:true},
        {name:"\uD83D\uDCCA All-Time Volume",value:`**${fmtUSD(allVol)}**`,inline:true},
        {name:"\uD83D\uDCCA All-Time Trades",value:`**${done.length}**`,inline:true},
        {name:"\uD83C\uDFAF Top Exchanger Today",value:topEx?`<@${topEx[0]}> \u2014 ${fmtUSD(topEx[1])}`:"\u2014",inline:true},
        {name:"\uD83D\uDCEC Open Tickets",value:`**${open}**${open>5?" \u26A0\uFE0F":""}`,inline:true},
        {name:"\uD83D\uDD34 Disputes",value:`**${disputes}**${disputes>0?" \uD83D\uDD34":""}`,inline:true},
        {name:"\u200b",value:"\u200b",inline:true},
      )
      .setFooter({text:"Konvert Exchange  \u00b7  Daily digest  \u2022  Toronto EST"})
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
          .setAuthor({name:"Konvert Exchange \u00b7 Weekly Recap",iconURL:IMG.LOGO})
          .setTitle("\uD83D\uDCCA Your Weekly Summary")
          .setDescription(`Week ending **${weekStr}** (EST)\n\u200b`)
          .addFields(
            {name:"This Week",value:`**${myWeek.length}** exchange${myWeek.length!==1?"s":""}`,inline:true},
            {name:"Volume This Week",value:`**${fmtUSD(myVol)}**`,inline:true},
            {name:"Fees This Week",value:`**${fmtUSD(myFees)}**`,inline:true},
            {name:"All-Time Volume",value:`**${fmtUSD(allVol)}**`,inline:true},
            {name:"All-Time Trades",value:`**${allTime.length}**`,inline:true},
            {name:"Your Tier",value:`${tier.emoji} **${tier.label}**`,inline:true},
          )
          .setImage(IMG.BANNER)
          .setFooter({text:"Konvert Exchange \u2022 Weekly Recap"});
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

function scheduleWeeklyReferralSummary(guild){
  function msUntilNextMonday(){const now=new Date(),day=now.getUTCDay(),daysUntilMon=day===1?7:(8-day)%7||7,next=new Date(now);next.setUTCDate(now.getUTCDate()+daysUntilMon);next.setUTCHours(9,0,0,0);return next.getTime()-now.getTime();}
  const firstDelay=msUntilNextMonday();console.log(`[weeklyRef] first post in ${Math.round(firstDelay/3600000)}h`);
  setTimeout(()=>{postWeeklyReferralSummary(guild).catch(()=>{});setInterval(()=>postWeeklyReferralSummary(guild).catch(()=>{}),7*24*60*60*1000);},firstDelay);
}

client.once(Events.ClientReady,async()=>{
  console.log(`Konvert Bot online -- ${client.user.tag}`);
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
    scheduleWeeklyReferralSummary(guild);
    scheduleWeeklyClientRecap();
    scheduleDailyFact(guild);
    scheduleDailyDigest(guild);
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
