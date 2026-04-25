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

const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID, process.env.YOUTUBE_CLIENT_SECRET, "urn:ietf:wg:oauth:2.0:oob");
oauth2Client.setCredentials({ refresh_token: process.env.YOUTUBE_REFRESH_TOKEN });
const youtube = google.youtube({ version: "v3", auth: oauth2Client });

const IMG = {
  LOGO:"https://i.imgur.com/GXwsQv0.png", BANNER:"https://i.imgur.com/uVQ6hho.png",
  RATES:"https://i.imgur.com/0zbG9Fc.png", FEE:"https://i.imgur.com/o6bi905.png",
  RULES:"https://i.imgur.com/CaBjEFU.png", TICKET:"https://i.imgur.com/GasrfTC.png",
  WELCOME:"https://i.imgur.com/hSYrFai.png", DEAL:"https://i.imgur.com/GuBspYH.png",
};

const CONFIG = {
  TOKEN:process.env.DISCORD_TOKEN, CLIENT_ID:process.env.CLIENT_ID, GUILD_ID:process.env.GUILD_ID,
  OWNER_IDS:(process.env.OWNER_IDS||"").split(",").map(s=>s.trim()).filter(Boolean),
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
    const member=await guild.members.fetch(userId).catch(()=>null);if(!member)return;
    const tier=getTier(volume);
    for(const t of TIERS){if(t.role&&member.roles.cache.has(t.role)&&t.role!==tier.role)await member.roles.remove(t.role).catch(()=>{});}
    if(tier.role&&!member.roles.cache.has(tier.role))await member.roles.add(tier.role).catch(()=>{});
  }catch{}
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

const COINS=["BTC","ETH","SOL","LTC","USDT","USDC","XRP","BNB","ADA","DOGE","MATIC","AVAX","DOT","LINK","TRX","SHIB","UNI","ATOM","FTM","NEAR"];
const GECKO={BTC:"bitcoin",ETH:"ethereum",SOL:"solana",LTC:"litecoin",USDT:"tether",USDC:"usd-coin",XRP:"ripple",BNB:"binancecoin",ADA:"cardano",DOGE:"dogecoin",MATIC:"matic-network",AVAX:"avalanche-2",DOT:"polkadot",LINK:"chainlink",TRX:"tron",SHIB:"shiba-inu",UNI:"uniswap",ATOM:"cosmos",FTM:"fantom",NEAR:"near"};
const COIN_LOGO={BTC:"https://assets.coingecko.com/coins/images/1/large/bitcoin.png",ETH:"https://assets.coingecko.com/coins/images/279/large/ethereum.png",SOL:"https://assets.coingecko.com/coins/images/4128/large/solana.png",LTC:"https://assets.coingecko.com/coins/images/2/large/litecoin.png",USDT:"https://assets.coingecko.com/coins/images/325/large/Tether.png",USDC:"https://assets.coingecko.com/coins/images/6319/large/usdc.png",XRP:"https://assets.coingecko.com/coins/images/44/large/xrp-symbol-white-128.png",BNB:"https://assets.coingecko.com/coins/images/825/large/binance-coin-logo.png",ADA:"https://assets.coingecko.com/coins/images/975/large/cardano.png",DOGE:"https://assets.coingecko.com/coins/images/5/large/dogecoin.png"};

const DB={tickets:"./tickets.json",wallets:"./wallets.json",blacklist:"./blacklist.json"};
const load=k=>{try{return JSON.parse(fs.readFileSync(DB[k],"utf8"));}catch{return {};}};
const save=(k,d)=>{try{fs.writeFileSync(DB[k],JSON.stringify(d,null,2));}catch{}};

const fmtUSD=n=>{if(n>=1)return`$${n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`;if(n>=0.01)return`$${n.toFixed(4)}`;return`$${n.toFixed(8)}`;};
function calcFee(usd,dir){let r=usd<150?9:usd<500?7:usd<1000?6:5.5;if(dir==="receive")r=Math.max(r-1,0);return Math.max(usd*r/100,CONFIG.MIN_FEE);}
function feeRate(usd,dir){let r=usd<150?9:usd<500?7:usd<1000?6:5.5;if(dir==="receive")r=Math.max(r-1,0);return r;}
const base=title=>new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO}).setTitle(title).setTimestamp();
function log(guild,msg){if(!CONFIG.LOG_CHANNEL||!guild)return;const ch=guild.channels.cache.get(CONFIG.LOG_CHANNEL);if(ch)ch.send({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setDescription("```"+msg+"```").setTimestamp()]}).catch(()=>{});}

// Price cache + 3 retries -- fixes SOL/BTC intermittent fails when spammed
const _priceCache={};
async function getPrice(coin){
  const id=GECKO[coin];if(!id)return null;
  if(_priceCache[id]&&Date.now()-_priceCache[id].ts<30000)return _priceCache[id].v;
  for(let i=0;i<3;i++){
    try{
      const r=await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`,{signal:AbortSignal.timeout(8000)});
      if(!r.ok){await new Promise(res=>setTimeout(res,1000*(i+1)));continue;}
      const d=await r.json(),v=d[id]?.usd||null;
      if(v!==null){_priceCache[id]={v,ts:Date.now()};return v;}
    }catch{await new Promise(res=>setTimeout(res,1000*(i+1)));}
  }
  return null;
}

const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent,GatewayIntentBits.GuildMembers],partials:[Partials.Channel]});
const state={pending:{},mineGames:{},cooldowns:{},alerts:[],passes:{},c2cSelections:{},feedChannel:null,feedEnabled:false};

// YouTube titles -- clean, punchy, emotional, matching the channel style exactly
const YT_TITLES=[
  "You need to hear this...",
  "Remember This...",
  "Don't forget why you started",
  "Watch this when you feel like quitting",
  "Your prime is not over",
  "This hit different at 3am...",
  "Why NOT you?",
  "Let them talk. Keep working",
  "Be the 1%",
  "You didn't break",
  "Maturing is realizing this...",
  "How badly do you want it?",
  "Trust the process",
  "Nobody cares. Work harder.",
  "It sucks. Do it anyway.",
  "We are all being tested",
  "Look yourself in the mirror",
  "I solemnly swear...",
  "Crazy Motivational Video",
  "To win, you have to lose first",
  "Stop waiting. Start now",
  "Your future self is watching",
  "Get up. Right now.",
  "You were built for this",
  "Don't die before you live",
  "Remember June...",
  "Okay. Get up.",
  "Fail Fast. Win Faster.",
  "The sun rises. So do you",
  "How badly do you want it?",
];

const YT_DESCRIPTIONS=[
  "Subscribe & never miss a workout again \u274C\n\n\uD83D\uDD14 @GymMotivez for daily motivation\n\uD83D\uDCAA Like & share if this fired you up\n\uD83D\uDCAC Comment your workout below\n\n#Shorts #GymMotivation #Fitness #Workout #Motivation #GymLife #NoExcuses #BeastMode",
  "Subscribe & never miss a drop \uD83D\uDD25\n\n\uD83D\uDD14 Follow @GymMotivez\n\uD83D\uDCAA Drop a \uD83D\uDCAA if you needed this today\n\uD83D\uDCAC What are you working on?\n\n#Shorts #GymMotivation #Grind #Workout #FitnessMotivation #MindsetShift #NoExcuses",
  "Subscribe & never miss a workout again \uD83D\uDCAA\n\n\uD83D\uDD14 @GymMotivez \u2014 daily fire\n\u2764\uFE0F Save this for when you need it\n\uD83D\uDCAC What's your why?\n\n#Shorts #Motivation #GymLife #MindsetMatters #WorkoutMotivation #Fitness #Discipline",
  "Subscribe & never lose this mindset \uD83D\uDD25\n\n\uD83D\uDD14 @GymMotivez every day\n\uD83D\uDCAA Tag someone who needs this\n\uD83D\uDCAC Reply with your goal\n\n#Shorts #GymMotivation #NoExcuses #Discipline #Fitness #Grind #DailyMotivation",
];

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
  new SlashCommandBuilder().setName("vouch").setDescription("Manually record a completed trade").addUserOption(o=>o.setName("client").setDescription("The client").setRequired(true)).addUserOption(o=>o.setName("exchanger").setDescription("The exchanger").setRequired(true)).addStringOption(o=>o.setName("message").setDescription("Review message").setRequired(true)).addStringOption(o=>o.setName("method").setDescription("Payment method").setRequired(true)).addNumberOption(o=>o.setName("amount").setDescription("Trade amount USD").setRequired(true)).addIntegerOption(o=>o.setName("rating").setDescription("Rating 1-5").setMinValue(1).setMaxValue(5).setRequired(false)),
  new SlashCommandBuilder().setName("uptime").setDescription("Check how long the bot has been running"),
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
  new SlashCommandBuilder().setName("postinfo").setDescription("[Owner] Post the Info embed").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("posttos").setDescription("[Owner] Post the Terms of Service embed").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("postlinks").setDescription("[Owner] Post the Official Links embed").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("lookup").setDescription("[Owner] Look up a past ticket by channel name").addStringOption(o=>o.setName("name").setDescription("Ticket channel name").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("postkonvault").setDescription("[Owner] Post the Konvault wagering server invite embed").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("setfeedchannel").setDescription("[Owner] Set the live deal feed channel").addStringOption(o=>o.setName("channel_id").setDescription("Channel ID").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("livefeed").setDescription("[Owner] Toggle live deal feed on/off").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
].map(c=>c.toJSON());

async function registerCommands(){
  const rest=new REST({version:"10"}).setToken(CONFIG.TOKEN);
  console.log("Registering commands...");
  await rest.put(Routes.applicationGuildCommands(CONFIG.CLIENT_ID,CONFIG.GUILD_ID),{body:COMMANDS});
  console.log("Commands registered.");
}

function mainEmbed(){
  return new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO}).setTitle("Konvert Exchange")
    .setDescription("**Fast. Safe. Simple.**\nExchange any crypto with any major payment method.\nOpen a ticket instantly -- a verified handler will assist you.\n\u200b")
    .addFields(
      {name:"\uD83D\uDCB8  Fee",     value:"5% - 9%  \u00b7  Tiered by amount\nMin fee $5 on any deal",inline:true},
      {name:"\u26A1  Speed",         value:"**Usually < 10 min**\nOften faster",                       inline:true},
      {name:"\uD83E\uDD1D  Support", value:"**24/7 Agents**\nAlways available",                        inline:true},
      {name:"\uD83D\uDCB3  Methods", value:"PayPal \u00b7 Cash App \u00b7 Zelle \u00b7 Interac \u00b7 Venmo \u00b7 Apple Pay \u00b7 Bank \u00b7 Crypto to Crypto \u00b7 and more",inline:false},
      {name:"\uD83E\uDE99  Crypto",  value:"BTC \u00b7 ETH \u00b7 SOL \u00b7 LTC \u00b7 USDT \u00b7 USDC \u00b7 XRP \u00b7 BNB \u00b7 and all major coins",inline:false},
    ).setImage(IMG.BANNER).setFooter({text:"Konvert  \u2022  Click Exchange Now to begin"});
}
function mainButtons(){
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("btn_exchange_now").setLabel("Exchange Now").setEmoji("\uD83D\uDCE9").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("btn_fee_calc").setLabel("Calculate Fee").setEmoji("\uD83D\uDCB0").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("btn_rates_quick").setLabel("Live Rates").setEmoji("\uD83D\uDCC8").setStyle(ButtonStyle.Secondary),
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
  if(method==="crypto"){
    return new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO})
      .setTitle("Step 2 -- Crypto to Crypto")
      .setDescription("**Send one coin, receive another.**\nFor example: send SOL, receive BTC.\n\nSelect your direction below.")
      .setFooter({text:"Step 2 of 3  \u2022  Konvert"});
  }
  return new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO})
    .setTitle(`Step 2 -- ${m.label}`)
    .setDescription(`**Send Crypto \u2192 Receive ${m.label}**\nYou send crypto. We pay you via ${m.label}.\n\n**Send ${m.label} \u2192 Receive Crypto**\nYou pay via ${m.label}. We send crypto to your wallet.`)
    .setFooter({text:"Step 2 of 3  \u2022  Konvert"});
}

async function buildRatesEmbed(){
  const ids=COINS.map(c=>GECKO[c]||c.toLowerCase()).join(",");
  const res=await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd,cad&include_24hr_change=true`,{signal:AbortSignal.timeout(10000)});
  const p=await res.json();
  const lines=COINS.map(coin=>{
    const d=p[GECKO[coin]||coin.toLowerCase()];if(!d)return null;
    const usd=d.usd.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
    const cad=d.cad.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
    const ch=parseFloat(d.usd_24h_change||0).toFixed(2);
    return `\`${coin.padEnd(5)}\` **$${usd}**  \u00b7  CA$${cad}  \u00b7  ${Number(ch)>=0?"\u25B2":"\u25BC"} ${ch}%`;
  }).filter(Boolean).join("\n");
  return new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO})
    .setTitle("Live Rates").setThumbnail(IMG.LOGO)
    .setDescription(lines+"\n\u200b")
    .addFields(
      {name:"Exchange",value:`Open a ticket in <#${CONFIG.EXCHANGE_CHANNEL}>`,inline:true},
      {name:"Tip",value:"Type **$BTC**, **$ETH** etc. for a quick lookup",inline:true},
    )
    .setImage(IMG.RATES)
    .setFooter({text:"Updates every 10 min  \u2022  Use /calc to post now  \u2022  Konvert"})
    .setTimestamp();
}

function buildMineGrid(userId,game){
  const rows=[];
  for(let r=0;r<5;r++){
    const row=new ActionRowBuilder();
    for(let c=0;c<5;c++){
      const idx=r*5+c,rev=game.revealed.includes(idx);
      const isDiamond=game.diamonds.includes(idx),isBomb=game.bombs.includes(idx);
      let label="?",style=ButtonStyle.Secondary,disabled=false;
      if(rev||game.over){
        if(isDiamond){label="\uD83D\uDC8E";style=ButtonStyle.Success;}
        else if(isBomb){label="\uD83D\uDCA3";style=ButtonStyle.Danger;}
        else{label="\u00b7";style=ButtonStyle.Secondary;}
        disabled=true;
      }
      row.addComponents(new ButtonBuilder().setCustomId(`mine_cell_${userId}_${idx}`).setLabel(label).setStyle(style).setDisabled(disabled));
    }
    rows.push(row);
  }
  return rows;
}

function buildDealEmbed({clientId,exchangerId,method,amountUSD,direction,coin,message,rating}){
  const stars="\u2605".repeat(Math.min(Math.max(rating||5,1),5));
  const dirStr=direction&&coin&&method?(direction==="send"?`${coin} \u2192 ${method}`:`${method} \u2192 ${coin}`):null;
  const embed=new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO})
    .setTitle("Deal Complete").setDescription("Trade verified and completed on Konvert Exchange.\n\u200b")
    .addFields(
      {name:"Client",value:`<@${clientId}>`,inline:true},
      {name:"Exchanger",value:`<@${exchangerId}>`,inline:true},
      {name:"Rating",value:stars,inline:true},
    );
  if(method)embed.addFields({name:"Method",value:`**${method}**`,inline:true});
  if(amountUSD)embed.addFields({name:"Amount",value:`**${fmtUSD(amountUSD)}**`,inline:true});
  if(dirStr)embed.addFields({name:"Direction",value:dirStr,inline:true});
  if(coin&&!dirStr)embed.addFields({name:"Coin",value:`**${coin}**`,inline:true});
  if(message)embed.addFields({name:"Review",value:message,inline:false});
  embed.setImage(IMG.DEAL).setTimestamp().setFooter({text:"Konvert  \u2022  Verified Trade"});
  return embed;
}

async function postVouch(guild,data){
  if(!CONFIG.VOUCH_CHANNEL){console.error("postVouch: VOUCH_CHANNEL_ID not set");return;}
  const ch=guild.channels.cache.get(CONFIG.VOUCH_CHANNEL);
  if(!ch){console.error("postVouch: channel not found:",CONFIG.VOUCH_CHANNEL);return;}
  try{await ch.send({embeds:[buildDealEmbed(data)]});}catch(e){console.error("postVouch error:",e.message);}
}

async function createTicket(interaction,method,direction,amountUSD,coin,walletInfo,notes){
  const guild=interaction.guild,user=interaction.user,m=getMethod(method);
  const tickets=load("tickets");
  const existing=Object.entries(tickets).find(([,t])=>t.userId===user.id&&t.status==="open");
  if(existing){await interaction.editReply({content:`You already have an open ticket: <#${existing[0]}>`,embeds:[],components:[]});return null;}
  const feeUSD=calcFee(amountUSD,direction),rate=feeRate(amountUSD,direction),receiveU=amountUSD-feeUSD;
  let coinAmt=null;
  try{const p=await getPrice(coin);if(p)coinAmt=(receiveU/p).toFixed(6);}catch{}
  const sendLabel=direction==="send"?`**${coin}** worth ${fmtUSD(amountUSD)}`:`${fmtUSD(amountUSD)} via ${m.label}`;
  const receiveLabel=direction==="send"?`${fmtUSD(receiveU)} via ${m.label}`:receiveU<5?"To be discussed":coinAmt?`${coinAmt} ${coin}`:`${fmtUSD(receiveU)} worth of ${coin}`;
  const perms=[
    {id:guild.roles.everyone,deny:[PermissionFlagsBits.ViewChannel]},
    {id:user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]},
  ];
  if(CONFIG.STAFF_ROLE)perms.push({id:CONFIG.STAFF_ROLE,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.ManageChannels]});
  const mRoleId=CONFIG.ROLES[m.value];
  if(mRoleId&&mRoleId!==CONFIG.STAFF_ROLE)perms.push({id:mRoleId,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]});
  for(const oid of CONFIG.OWNER_IDS)perms.push({id:oid,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.ManageChannels]});
  let ch;
  try{
    ch=await guild.channels.create({
      name:`${m.value}-${user.username.replace(/[^a-z0-9]/gi,"").toLowerCase().slice(0,4)}`,
      type:ChannelType.GuildText,parent:CONFIG.TICKET_CATEGORY||null,permissionOverwrites:perms,
    });
  }catch(err){await interaction.editReply({content:`Failed to create ticket: ${err.message}`,embeds:[],components:[]});return null;}
  const ticketEmbed=new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO})
    .setTitle(`${m.label} Exchange`).setThumbnail(COIN_LOGO[coin]||IMG.LOGO)
    .setDescription(`**Welcome, <@${user.id}>**\n\nYour ticket is open. A **${m.label}** handler has been notified.\n\u200b`)
    .addFields(
      {name:"__Sending__",  value:`**${sendLabel}**`,                   inline:true},
      {name:"__Receiving__",value:`**${receiveLabel}**`,                inline:true},
      {name:"__Fee__",      value:`**${rate}%**  --  ${fmtUSD(feeUSD)}`,inline:true},
      {name:direction==="send"?`__Your ${m.label} Details__`:"__Your Receiving Wallet__",value:`\`${walletInfo}\``,inline:false},
    );
  if(notes)ticketEmbed.addFields({name:"Notes",value:notes,inline:false});
  ticketEmbed.setImage(IMG.TICKET).setTimestamp().setFooter({text:"Konvert  \u2022  All communication stays in this ticket"});
  const rulesEmbed=new EmbedBuilder().setColor(CONFIG.COLOR).setTitle("Before You Proceed")
    .setDescription("**Middleman required on all trades.**\nAgree on a trusted MM with your exchanger before sending anything.\n\n**Do not go first** unless **@jswaps** or **@3uce** explicitly says so in this ticket.\n\n__Staff will **never** DM you first.__ Anyone claiming to be Konvert in DMs is an impersonator.\nAll communication stays **in this ticket only.**")
    .setImage(IMG.RULES).setFooter({text:"Konvert  \u2022  Stay safe, stay in this ticket"});
  const btns=new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("btn_done").setLabel("Mark Trade Complete").setEmoji("\u2705").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("btn_close").setLabel("Close Ticket").setEmoji("\uD83D\uDD12").setStyle(ButtonStyle.Danger),
  );
  await ch.send({content:`<@${user.id}>`,embeds:[ticketEmbed,rulesEmbed],components:[btns]});
  const pings=[];
  if(mRoleId)pings.push(`<@&${mRoleId}>`);
  if(CONFIG.STAFF_ROLE&&CONFIG.STAFF_ROLE!==mRoleId)pings.push(`<@&${CONFIG.STAFF_ROLE}>`);
  if(pings.length)await ch.send(`${pings.join(" ")} -- New **${m.label}** ticket!`);
  const t=load("tickets");
  t[ch.id]={userId:user.id,userTag:user.tag,method,direction,coin,amountUSD,feeUSD,walletInfo,notes:notes||"",status:"open",createdAt:Date.now()};
  save("tickets",t);
  log(guild,`TICKET: #${ch.name} | ${user.tag} | ${m.label} | ${fmtUSD(amountUSD)} | ${coin}`);
  return ch;
}

async function doCloseTicket(channel,guild,closedBy,reason){
  const tickets=load("tickets");
  if(tickets[channel.id]){tickets[channel.id].status="closed";tickets[channel.id].closedAt=Date.now();save("tickets",tickets);}
  try{
    const msgs=await channel.messages.fetch({limit:100});
    const lines=[...msgs.values()].reverse().map(m=>`[${new Date(m.createdTimestamp).toISOString()}] ${m.author.tag}: ${m.content||"[embed]"}`).join("\n");
    const fname=`transcript-${channel.name}-${Date.now()}.txt`,fpath=`./${fname}`;
    fs.writeFileSync(fpath,lines);
    if(CONFIG.LOG_CHANNEL){const lch=guild.channels.cache.get(CONFIG.LOG_CHANNEL);if(lch)await lch.send({content:`Transcript: **#${channel.name}** closed by ${closedBy.tag}. Reason: ${reason}`,files:[{attachment:fpath,name:fname}]});}
    if(tickets[channel.id]){
      try{const mem=await guild.members.fetch(tickets[channel.id].userId).catch(()=>null);if(mem){const f2=`tr-dm-${channel.name}.txt`;fs.writeFileSync("./"+f2,lines);await mem.send({content:"Your Konvert ticket has been closed. Transcript attached:",files:[{attachment:"./"+f2,name:f2}]}).catch(()=>{});fs.unlinkSync("./"+f2);}}catch{}
    }
    for(const oid of CONFIG.OWNER_IDS){try{const o=await guild.members.fetch(oid).then(m=>m.user).catch(()=>null);if(o&&o.id!==closedBy.id){const f3=`tr-owner-${channel.name}.txt`;fs.writeFileSync("./"+f3,lines);await o.send({content:`Transcript: **#${channel.name}** | Closed by: ${closedBy.tag}`,files:[{attachment:"./"+f3,name:f3}]}).catch(()=>{});fs.unlinkSync("./"+f3);}}catch{}}
    fs.unlinkSync(fpath);
  }catch{}
  log(guild,`CLOSED: #${channel.name} by ${closedBy.tag} -- ${reason}`);
}

// --- MESSAGE HANDLER ($COIN + YouTube) ---
client.on(Events.MessageCreate, async message => {
  // YouTube Shorts upload
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
        const res=await youtube.videos.insert({
          part:["snippet","status"],
          requestBody:{
            snippet:{title,description:desc,tags:["gym motivation","shorts","fitness","workout","motivation","gym life","no excuses","beast mode","grind","discipline","mindset","never give up"],categoryId:"17"},
            status:{privacyStatus:"public"},
          },
          media:{body:fs.createReadStream(filePath)},
        });
        await message.react("\u2705");
        await message.reply(`\u2705 Posted: https://youtube.com/watch?v=${res.data.id}\n**Title:** ${title}`);
        fs.unlinkSync(filePath);
      }catch(err){
        await message.react("\u274C");
        await message.reply(`\u274C Upload failed: ${err.message}`);
        try{fs.unlinkSync(filePath);}catch{}
      }
      return;
    }
  }

  // $COIN price lookup with cache + 3-retry
  if(message.author.bot)return;
  const match=message.content.trim().match(/^\$([A-Za-z]{2,10})$/i);
  if(!match)return;
  const coin=match[1].toUpperCase();
  if(!COINS.includes(coin))return;
  const id=GECKO[coin];if(!id)return;
  let d=null;
  const cKey=id+"_full";
  if(_priceCache[cKey]&&Date.now()-_priceCache[cKey].ts<30000){d=_priceCache[cKey].v;}
  else{
    for(let attempt=0;attempt<3;attempt++){
      try{
        const res=await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd,cad,eur&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`,{signal:AbortSignal.timeout(8000)});
        if(!res.ok){await new Promise(r=>setTimeout(r,1000*(attempt+1)));continue;}
        const json=await res.json();
        if(json[id]?.usd){d=json[id];_priceCache[cKey]={v:d,ts:Date.now()};break;}
      }catch{await new Promise(r=>setTimeout(r,1000*(attempt+1)));}
    }
  }
  if(!d)return;
  const fmt=n=>{if(n>=1)return n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});if(n>=0.01)return n.toFixed(4);return n.toFixed(8);};
  const ch2=parseFloat(d.usd_24h_change||0);
  const mcap=d.usd_market_cap?`$${(d.usd_market_cap/1e9).toFixed(2)}B`:"--";
  const vol=d.usd_24h_vol?`$${(d.usd_24h_vol/1e9).toFixed(2)}B`:"--";
  const fee=calcFee(Math.max(d.usd,1),"send"),rate=feeRate(Math.max(d.usd,1),"send");
  await message.reply({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR)
    .setAuthor({name:"Konvert  \u2022  Live Price",iconURL:IMG.LOGO})
    .setTitle(`${coin}  --  $${fmt(d.usd)}`).setThumbnail(COIN_LOGO[coin]||IMG.LOGO)
    .setDescription(`${ch2>=0?"\u25B2":"\u25BC"} **${ch2.toFixed(2)}%** in the last 24 hours\n\u200b`)
    .addFields(
      {name:"USD",        value:`**$${fmt(d.usd)}**`,           inline:true},
      {name:"CAD",        value:`CA$${fmt(d.cad)}`,             inline:true},
      {name:"EUR",        value:`\u20AC${fmt(d.eur)}`,          inline:true},
      {name:"Market Cap", value:mcap,                           inline:true},
      {name:"24h Volume", value:vol,                            inline:true},
      {name:"Konvert Fee",value:`${rate}%  --  **${fmtUSD(fee)}**`,inline:true},
    ).setFooter({text:`Konvert  \u2022  /price ${coin} for full details`}).setTimestamp()]}).catch(()=>{});
});

// --- INTERACTION HANDLER ---
client.on(Events.InteractionCreate, async interaction => {
  try {
    if(interaction.isChatInputCommand()){
      const cmd=interaction.commandName;

      if(cmd==="postexchange"){await interaction.channel.send({embeds:[mainEmbed()],components:mainButtons()});return interaction.reply({content:"Exchange embed posted.",ephemeral:true});}

      if(cmd==="postsupport"){
        const embed=new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO}).setTitle("Support").setThumbnail(IMG.LOGO)
          .setDescription(`This channel is for **support tickets only**.\n\nFor exchanges, head to <#${CONFIG.EXCHANGE_CHANNEL}>.\n\n**What to include:**\n\u00b7 What you need help with\n\u00b7 Any error messages or screenshots\n\u00b7 What you have already tried\n\u00b7 A full explanation of what happened\n\u200b`)
          .setFooter({text:"Konvert  \u2022  Support"});
        await interaction.channel.send({embeds:[embed],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("btn_support_ticket").setLabel("Open Support Ticket").setEmoji("\uD83C\uDF9F").setStyle(ButtonStyle.Primary))]});
        return interaction.reply({content:"Support embed posted.",ephemeral:true});
      }

      if(cmd==="postmm"){
        const embed=new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO}).setTitle("Middleman Information").setThumbnail(IMG.LOGO)
          .setDescription(`**Konvert officially partners with Astro MM** to ensure all deals go smoothly.\n\n**How It Works:**\n**1.** Open a ticket in <#${CONFIG.EXCHANGE_CHANNEL}>\n**2.** Get a quote for your exchange\n**3.** If terms are agreed on, open an MM ticket on Astro MM\n**4.** Complete the exchange safely\n\u200b`)
          .addFields({name:"Important",value:"**Do NOT go first** without using Astro MM, unless explicitly advised by an owner in your ticket.",inline:false},{name:"Astro MM",value:"Click the button below to join the Astro MM server.",inline:false})
          .setImage(IMG.BANNER).setFooter({text:"Konvert  \u2022  Official Escrow Partner: Astro MM"});
        await interaction.channel.send({embeds:[embed],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel("Join Astro MM").setEmoji("\uD83E\uDD1D").setStyle(ButtonStyle.Link).setURL("https://discord.gg/astromm"))]});
        return interaction.reply({content:"MM embed posted.",ephemeral:true});
      }

      if(cmd==="rates"){await interaction.deferReply();return interaction.editReply({embeds:[await buildRatesEmbed()],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("btn_refresh_rates").setLabel("Refresh").setStyle(ButtonStyle.Secondary))]});}

      // /fee -- shows USD amounts AND coin amounts (BTC/ETH/SOL)
      if(cmd==="fee"){
        const amt=interaction.options.getNumber("amount_usd");
        if(!amt||amt<=0)return interaction.reply({content:"Please enter a valid amount greater than $0.",ephemeral:true});
        await interaction.deferReply({ephemeral:true});
        const fS=calcFee(amt,"send"),rS=feeRate(amt,"send"),fR=calcFee(amt,"receive"),rR=feeRate(amt,"receive");
        const [btcP,ethP,solP]=await Promise.all([getPrice("BTC"),getPrice("ETH"),getPrice("SOL")]);
        const recvS=amt-fS,coinLines=[];
        if(btcP)coinLines.push(`BTC: **${(recvS/btcP).toFixed(6)}** (\u2248${fmtUSD(recvS)})`);
        if(ethP)coinLines.push(`ETH: **${(recvS/ethP).toFixed(5)}** (\u2248${fmtUSD(recvS)})`);
        if(solP)coinLines.push(`SOL: **${(recvS/solP).toFixed(4)}** (\u2248${fmtUSD(recvS)})`);
        return interaction.editReply({embeds:[base("Fee Calculator").setThumbnail(IMG.LOGO)
          .setDescription(`Estimate for **${fmtUSD(amt)}**\n*Final fee may vary slightly.*\n\u200b`)
          .addFields(
            {name:"Fiat \u2192 Crypto",       value:`Rate: **${rS}%**\nFee: **${fmtUSD(fS)}**\nYou receive: **${fmtUSD(recvS)}**`,inline:true},
            {name:"Crypto \u2192 Fiat",       value:`Rate: **${rR}%**\nFee: **${fmtUSD(fR)}**\nYou receive: **${fmtUSD(amt-fR)}**`,inline:true},
            {name:"\uD83E\uDE99 If Buying Crypto",value:coinLines.length?coinLines.join("\n"):"--",inline:false},
          ).setImage(IMG.FEE).setFooter({text:"Konvert  \u2022  Coin amounts shown for Fiat \u2192 Crypto direction"})]});
      }

      if(cmd==="price"){
        await interaction.deferReply();
        const coin=interaction.options.getString("coin").toUpperCase(),id=GECKO[coin];
        if(!id)return interaction.editReply({embeds:[new EmbedBuilder().setColor(0xFF4444).setAuthor({name:"Konvert",iconURL:IMG.LOGO}).setDescription(`**${coin}** is not supported. Try BTC, ETH, SOL, LTC, BNB, XRP, DOGE and more.`)]});
        let d=null;
        const cKey=id+"_full";
        if(_priceCache[cKey]&&Date.now()-_priceCache[cKey].ts<30000){d=_priceCache[cKey].v;}
        else{for(let i=0;i<3;i++){try{const res=await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd,cad,eur&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`,{signal:AbortSignal.timeout(8000)});if(!res.ok){await new Promise(r=>setTimeout(r,1000*(i+1)));continue;}const dat=await res.json();if(dat[id]?.usd){d=dat[id];_priceCache[cKey]={v:d,ts:Date.now()};break;}}catch{await new Promise(r=>setTimeout(r,1000*(i+1)));}}}
        if(!d)return interaction.editReply("Could not fetch price. Try again in a moment.");
        const ch=parseFloat(d.usd_24h_change||0),fmt2=n=>n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
        const mcap=d.usd_market_cap?`$${(d.usd_market_cap/1e9).toFixed(2)}B`:"--",vol=d.usd_24h_vol?`$${(d.usd_24h_vol/1e9).toFixed(2)}B`:"--";
        const fee=calcFee(Math.max(d.usd,1),"send"),rate=feeRate(Math.max(d.usd,1),"send");
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert  \u2022  Live Price",iconURL:IMG.LOGO})
          .setTitle(`${coin}  --  $${fmt2(d.usd)}`).setThumbnail(COIN_LOGO[coin]||IMG.LOGO)
          .setDescription(`${ch>=0?"\u25B2":"\u25BC"} **${ch.toFixed(2)}%** in the last 24 hours\n\u200b`)
          .addFields(
            {name:"USD",        value:`**$${fmt2(d.usd)}**`,inline:true},
            {name:"CAD",        value:`CA$${fmt2(d.cad)}`, inline:true},
            {name:"EUR",        value:`\u20AC${fmt2(d.eur)}`,inline:true},
            {name:"Market Cap", value:mcap,inline:true},
            {name:"24h Volume", value:vol, inline:true},
            {name:"Konvert Fee",value:`${rate}%  --  **${fmtUSD(fee)}**`,inline:true},
          ).setFooter({text:`Konvert  \u2022  /price ${coin}`}).setTimestamp()]});
      }

      // /convert -- shows both coin amount AND USD value
      if(cmd==="convert"){
        await interaction.deferReply();
        const amount=interaction.options.getNumber("amount"),from=interaction.options.getString("from").toUpperCase(),to=interaction.options.getString("to").toUpperCase();
        if(!amount||amount<=0)return interaction.editReply("Please enter a valid amount greater than 0.");
        const FIAT={USD:1,CAD:1.37,EUR:0.93,GBP:0.79};
        // Normalize: if it's not a fiat currency, treat as coin and uppercase it
        const fromNorm=from.toUpperCase(), toNorm=to.toUpperCase();
        let amtUSD;
        if(FIAT[fromNorm])amtUSD=amount/FIAT[fromNorm];
        else{const p=await getPrice(fromNorm);if(!p)return interaction.editReply(`Can't find price for **${fromNorm}**. Use coin symbols like BTC, ETH, SOL or fiat like USD, CAD.`);amtUSD=amount*p;}
        let result;
        if(FIAT[toNorm])result=amtUSD*FIAT[toNorm];
        else{const p=await getPrice(toNorm);if(!p)return interaction.editReply(`Can't find price for **${toNorm}**. Use coin symbols like BTC, ETH, SOL or fiat like USD, CAD.`);result=amtUSD/p;}
        const fee=calcFee(amtUSD,"send"),p2=FIAT[toNorm]?1/FIAT[toNorm]:(await getPrice(toNorm)||1),youGet=result-(fee/p2);
        const isToFiat=!!FIAT[toNorm],receiveUSD=isToFiat?youGet:youGet*(await getPrice(toNorm)||1);
        const youGetDisplay=isToFiat?fmtUSD(youGet):`${youGet.toFixed(6)} ${toNorm}`;
        return interaction.editReply({embeds:[base("Conversion").setThumbnail(IMG.LOGO)
          .addFields(
            {name:"You Send",      value:`**${amount} ${fromNorm}**`,                                       inline:true},
            {name:"Est. Fee",      value:`**\u2248${fmtUSD(fee)}**`,                                        inline:true},
            {name:"\u200b",        value:"\u200b",                                                          inline:true},
            {name:"You Receive",   value:`**${youGetDisplay}**`,                                            inline:true},
            {name:"Est. USD Value",value:isToFiat?`**${fmtUSD(youGet)}**`:`**\u2248${fmtUSD(receiveUSD)}**`,inline:true},
          ).setFooter({text:"Estimate only  \u2022  Konvert  \u2022  Open a ticket to begin"})]});
      }

      // /stats -- deferred, reads vouched tickets, nice UI with progress bar + %
      if(cmd==="stats"){
        await interaction.deferReply();
        const target=interaction.options.getUser("user")||interaction.user,isSelf=target.id===interaction.user.id;
        const allT=Object.values(load("tickets"));
        const done=allT.filter(t=>t.userId===target.id&&t.status==="vouched");
        const volume=done.reduce((s,t)=>s+(t.amountUSD||0),0),avg=done.length>0?volume/done.length:0;
        const methods={};done.forEach(t=>{if(t.method)methods[t.method]=(methods[t.method]||0)+1;});
        const topM=Object.entries(methods).sort((a,b)=>b[1]-a[1])[0];
        const coins={};done.forEach(t=>{if(t.coin)coins[t.coin]=(coins[t.coin]||0)+1;});
        const topC=Object.entries(coins).sort((a,b)=>b[1]-a[1])[0];
        const tier=getTier(volume),nextTier=getNextTier(volume);
        const bar=nextTier?progressBar(volume,tier.min,nextTier.min):"\u2593".repeat(12)+" MAX";
        const needed=nextTier?Math.max(nextTier.min-volume,0):0;
        await applyTierRole(interaction.guild,target.id,volume);
        const exDone=allT.filter(t=>t.completedBy===target.id&&t.status==="vouched"),exVol=exDone.reduce((s,t)=>s+(t.amountUSD||0),0);
        const tierLine=`${tier.emoji} **${tier.label}**`+(nextTier?`  \u2192  ${nextTier.emoji} **${nextTier.label}**`:"  \u00b7  **\u2B50 Max Tier**");
        const nextLine=nextTier?`Need **${fmtUSD(needed)}** more to reach ${nextTier.emoji} **${nextTier.label}**`:"You have reached the highest tier!";
        const embed=new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO})
          .setTitle(isSelf?"\uD83D\uDCCA Your Exchange Stats":`\uD83D\uDCCA ${target.username}'s Stats`)
          .setThumbnail(target.displayAvatarURL({size:128}))
          .setDescription(`${tierLine}\n\`${bar}\`\n${nextLine}\n\u200b`)
          .addFields(
            {name:"\uD83E\uDDFE  Trades",    value:`**${done.length}** completed`,                           inline:true},
            {name:"\uD83D\uDCB0  Volume",    value:volume>0?`**${fmtUSD(volume)}**`:"No trades yet",         inline:true},
            {name:"\uD83D\uDCCA  Avg Deal",  value:avg>0?`**${fmtUSD(avg)}**`:"--",                          inline:true},
            {name:"\uD83D\uDCB3  Top Method",value:topM?`**${getMethod(topM[0])?.label||topM[0]}** (${topM[1]}x)`:"--",inline:true},
            {name:"\uD83E\uDE99  Top Coin",  value:topC?`**${topC[0]}** (${topC[1]}x)`:"--",                 inline:true},
            {name:"\u2B50  Tier",           value:`${tier.emoji} **${tier.label}**`,                         inline:true},
          );
        if(done.length>0){const last=done.sort((a,b)=>(b.completedAt||0)-(a.completedAt||0))[0];embed.addFields({name:"\u23F0  Last Trade",value:last.completedAt?`<t:${Math.floor(last.completedAt/1000)}:R>`:"--",inline:false});}
        if(exDone.length>0)embed.addFields({name:"\u200b",value:"**\u2014\u2014 Exchanger Stats \u2014\u2014**",inline:false},{name:"Deals Handled",value:`**${exDone.length}**`,inline:true},{name:"Vol. Handled",value:`**${fmtUSD(exVol)}**`,inline:true});
        embed.setFooter({text:done.length===0?"No completed trades yet  \u2022  Konvert":`${done.length} verified trade${done.length!==1?"s":""} on Konvert`});
        return interaction.editReply({embeds:[embed]});
      }

      // /leaderboard -- deferred, shows % share of total volume
      if(cmd==="leaderboard"){
        await interaction.deferReply();
        const allT=Object.values(load("tickets")).filter(t=>t.status==="vouched"&&t.amountUSD);
        if(!allT.length)return interaction.editReply({embeds:[base("Top Traders").setThumbnail(IMG.LOGO).setDescription("No completed trades yet -- be the first!").setFooter({text:"Konvert  \u2022  Leaderboard"})]});
        const byUser={};
        allT.forEach(t=>{if(!byUser[t.userId])byUser[t.userId]={volume:0,trades:0};byUser[t.userId].volume+=(t.amountUSD||0);byUser[t.userId].trades+=1;});
        const ranked=Object.entries(byUser).sort((a,b)=>b[1].volume-a[1].volume).slice(0,10);
        const totalVol=ranked.reduce((s,[,d])=>s+d.volume,0);
        const medals=["\uD83E\uDD47","\uD83E\uDD48","\uD83E\uDD49"];
        const lines=ranked.map(([uid,d],i)=>{
          const tier=getTier(d.volume),share=totalVol>0?Math.round((d.volume/totalVol)*100):0;
          return `${medals[i]||`**${i+1}.**`}  <@${uid}>  ${tier.emoji}  \u2014  **${fmtUSD(d.volume)}** (${share}%)  \u00b7  ${d.trades} deal${d.trades!==1?"s":""}`;
        }).join("\n");
        const linesValue = lines.length > 0 ? lines : "No traders yet.";
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO})
          .setTitle("\uD83C\uDFC6  Top Traders").setThumbnail(IMG.LOGO)
          .setDescription("Ranked by total USD volume exchanged on Konvert.\n\u200b")
          .addFields(
            {name:"Rankings",      value:linesValue,                                                  inline:false},
            {name:"Total Volume",  value:`**${fmtUSD(totalVol)}** across all traders`,               inline:true},
            {name:"Avg Per Trader",value:`**${fmtUSD(Math.round(totalVol/ranked.length))}**`,        inline:true},
          )
          .setFooter({text:`${ranked.length} traders  \u2022  Konvert Leaderboard`}).setTimestamp()]});
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
        return interaction.editReply({embeds:[base("Market Summary").setThumbnail(IMG.LOGO)
          .addFields(
            {name:"Market Sentiment",value:`**${parseFloat(avg)>=0?"Bullish \u25B2":"Bearish \u25BC"}**  \u00b7  Avg 24h: **${avg}%**`,inline:false},
            {name:"Top Gainers",     value:gainers.map(r=>`\`${r.coin.padEnd(5)}\` **\u25B2 ${r.change.toFixed(2)}%**  $${fmt2(r.price)}`).join("\n"),inline:true},
            {name:"Top Losers",      value:losers.map(r=>`\`${r.coin.padEnd(5)}\` **\u25BC ${Math.abs(r.change).toFixed(2)}%**  $${fmt2(r.price)}`).join("\n"),inline:true},
          ).setImage(IMG.RATES).setFooter({text:"Live market data  \u2022  Konvert"})]});
      }

      if(cmd==="wallets"){const w=load("wallets"),fields=Object.entries(w).length?Object.entries(w).map(([coin,addr])=>({name:coin,value:`\`${addr}\``,inline:true})):[{name:"No wallets set",value:"Owner: use /setwallet to add addresses.",inline:false}];return interaction.reply({embeds:[base("Deposit Wallets").setThumbnail(IMG.LOGO).setDescription("Send funds **only** to addresses confirmed by staff **inside your ticket**.\n__Never send to any address given outside of your ticket.__\n\u200b").addFields(fields).setFooter({text:"Always verify with staff before sending  \u2022  Konvert"})],ephemeral:true});}
      if(cmd==="mm"){return interaction.reply({embeds:[base("Middleman Guide").setDescription("A **middleman (MM)** holds crypto between both parties during a trade -- protecting everyone from scams.\n\u200b").addFields({name:"How to Pick an MM",value:"Agree with your exchanger on a trusted MM you both know. Konvert supports any reputable third-party MM.",inline:false},{name:"Owner Override Only",value:"The **only** time you skip an MM is if **@jswaps** or **@3uce** explicitly says so in your ticket.",inline:false},{name:"Stay Safe",value:"**Staff will never DM you first.** All MM arrangements happen in your ticket only.",inline:false}).setImage(IMG.RULES).setFooter({text:"Konvert  \u2022  Trade safely, always"})]});}

      if(cmd==="mine"){
        const userId=interaction.user.id,cooldownMs=3*60*60*1000,remaining=cooldownMs-(Date.now()-(state.cooldowns[userId]||0));
        if(remaining>0){const hrs=Math.floor(remaining/3600000),mins=Math.ceil((remaining%3600000)/60000);return interaction.reply({embeds:[base("Mine -- On Cooldown").setDescription(`You can mine again in **${hrs>0?`${hrs}h ${mins}m`:`${mins}m`}**.`).setFooter({text:"Konvert Mine  \u2022  Once every 3 hours"})],ephemeral:true});}
        state.cooldowns[userId]=Date.now();
        const pos=Array.from({length:25},(_,i)=>i).sort(()=>Math.random()-0.5);
        state.mineGames[userId]={diamonds:pos.slice(0,3),bombs:pos.slice(3,8),revealed:[],found:0,tries:0,over:false};
        return interaction.reply({embeds:[base("Konvert Mine").setThumbnail(IMG.LOGO)
          .setDescription("A **5\u00D75** grid lies before you.\n\n\uD83D\uDC8E **3 diamonds** are hidden among the cells.\n\uD83D\uDCA3 **5 bombs** are also hidden -- hit one and it's over.\n\nYou have **3 tries**. Find all 3 diamonds to win a **Free Exchange Pass**.\n\u200b")
          .addFields({name:"Tries Remaining",value:"**3**",inline:true},{name:"Diamonds Found",value:"**0 / 3**",inline:true},{name:"Win Condition",value:"All 3 \uD83D\uDC8E with no \uD83D\uDCA3",inline:true})
          .setFooter({text:"Konvert Mine  \u2022  Find all 3 diamonds  \u2022  Cooldown: 3 hours"})],
          components:buildMineGrid(userId,state.mineGames[userId]),ephemeral:true});
      }

      // /vouch -- saves to tickets.json so stats and leaderboard count it + applies tier role
      if(cmd==="vouch"){
        const clientUser=interaction.options.getUser("client"),exchUser=interaction.options.getUser("exchanger");
        const message=interaction.options.getString("message"),method=interaction.options.getString("method"),amount=interaction.options.getNumber("amount"),rating=interaction.options.getInteger("rating")||5;
        const vt=load("tickets");
        vt["manual_"+Date.now()]={userId:clientUser.id,userTag:clientUser.tag,method,direction:null,coin:null,amountUSD:amount,feeUSD:calcFee(amount,"send"),walletInfo:"manual",notes:"Manual vouch via /vouch",status:"vouched",completedBy:exchUser.id,completedAt:Date.now(),createdAt:Date.now()};
        save("tickets",vt);
        await postVouch(interaction.guild,{clientId:clientUser.id,exchangerId:exchUser.id,method,amountUSD:amount,direction:null,coin:null,message,rating});
        const allC=Object.values(load("tickets")).filter(t=>t.userId===clientUser.id&&t.status==="vouched");
        await applyTierRole(interaction.guild,clientUser.id,allC.reduce((s,t)=>s+(t.amountUSD||0),0));
        return interaction.reply({content:`Vouch recorded -- <@${clientUser.id}> exchanged with <@${exchUser.id}>.`,ephemeral:true});
      }

      if(cmd==="alert"){const coin=interaction.options.getString("coin").toUpperCase(),price=interaction.options.getNumber("price"),dir=interaction.options.getString("direction");if(!COINS.includes(coin))return interaction.reply({content:`Unsupported coin: ${coin}`,ephemeral:true});state.alerts.push({userId:interaction.user.id,coin,target:price,direction:dir});return interaction.reply({embeds:[base("Price Alert Set").setThumbnail(COIN_LOGO[coin]||IMG.LOGO).setDescription(`You will be DM'd when **${coin}** goes **${dir}** **$${price.toLocaleString("en-US")}**.`).setFooter({text:"Konvert  \u2022  Price Alerts"})],ephemeral:true});}

      if(cmd==="ticket"){const tickets=load("tickets"),found=Object.entries(tickets).find(([,t])=>t.userId===interaction.user.id&&t.status==="open");if(!found)return interaction.reply({content:"You don't have an open ticket. Use **Exchange Now** to start one.",ephemeral:true});const [channelId,t]=found,m=getMethod(t.method);return interaction.reply({embeds:[base("Your Open Ticket").setThumbnail(IMG.LOGO).addFields({name:"Channel",value:`<#${channelId}>`,inline:true},{name:"Method",value:`**${m?.label||t.method}**`,inline:true},{name:"Amount",value:`**${fmtUSD(t.amountUSD)}**`,inline:true},{name:"Coin",value:`**${t.coin||"--"}**`,inline:true},{name:"Direction",value:t.direction==="send"?"Fiat \u2192 Crypto":"Crypto \u2192 Fiat",inline:true},{name:"Opened",value:`<t:${Math.floor(t.createdAt/1000)}:R>`,inline:true}).setFooter({text:"Konvert  \u2022  All communication stays in your ticket"})],ephemeral:true});}

      if(cmd==="howto"){return interaction.reply({embeds:[base("How to Use Konvert").setThumbnail(IMG.LOGO).setDescription("New to Konvert? Here's how a trade works step by step.\n\u200b").addFields({name:"1.  Check Rates",value:"Use **Live Rates** or type `$BTC` / `$ETH` etc. in any channel to see the current price.",inline:false},{name:"2.  Calculate Fee",value:"Use **Calculate Fee** to estimate your cost. Fees range from **5% - 9%** depending on amount.",inline:false},{name:"3.  Open a Ticket",value:"Click **Exchange Now**, pick your payment method, fill in details, confirm. A private ticket opens instantly.",inline:false},{name:"4.  Agree on an MM",value:"A **middleman** is required on all trades. Agree on one with your exchanger inside your ticket.",inline:false},{name:"5.  Send & Confirm",value:"Staff confirms the deal. You send funds and share proof. Once confirmed, you receive your crypto or payment.",inline:false},{name:"Stay Safe",value:"Staff never DM you first. Anyone doing so is an impersonator. All communication stays in your ticket.",inline:false}).setFooter({text:"Konvert  \u2022  Questions? Ask in your ticket"})],ephemeral:true});}

      if(cmd==="ping"){const sent=Date.now();await interaction.deferReply({ephemeral:true});return interaction.editReply({embeds:[base("Bot Status").setThumbnail(IMG.LOGO).setDescription("**All systems operational.** Konvert is online and ready.\n\u200b").addFields({name:"Status",value:"**Online**",inline:true},{name:"Latency",value:`**${Date.now()-sent}ms**`,inline:true},{name:"API Latency",value:`**${client.ws.ping}ms**`,inline:true}).setFooter({text:"Konvert  \u2022  Bot Status"})]});}

      if(cmd==="supported"){return interaction.reply({embeds:[base("Supported Methods & Coins").setThumbnail(IMG.LOGO).addFields({name:"\uD83D\uDCB3  Payment Methods",value:METHODS.map(m=>`**${m.label}**`).join("  \u00b7  "),inline:false},{name:"\uD83E\uDE99  Cryptocurrencies",value:COINS.map(c=>`\`${c}\``).join("  ")+"\n\n*Don't see your coin? Ask in your ticket -- we support most major coins.*",inline:false}).setFooter({text:"Don't see your method or coin? Open a ticket and ask  \u2022  Konvert"})],ephemeral:true});}

      if(cmd==="review"){const modal=new ModalBuilder().setCustomId("modal_review").setTitle("Leave a Review for Konvert");modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("review_text").setLabel("Your experience with Konvert").setStyle(TextInputStyle.Paragraph).setPlaceholder("Fast, legit, smooth -- describe your experience").setRequired(true)),new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("review_rating").setLabel("Rating out of 5").setStyle(TextInputStyle.Short).setPlaceholder("5").setRequired(true)));return interaction.showModal(modal);}

      if(cmd==="remind"){const mins=interaction.options.getInteger("minutes"),message=interaction.options.getString("message");if(mins<1||mins>1440)return interaction.reply({content:"Reminder must be between 1 minute and 24 hours.",ephemeral:true});await interaction.reply({content:`Got it. I'll remind you about **"${message}"** in **${mins} minute${mins!==1?"s":""}**.`,ephemeral:true});setTimeout(async()=>{try{const user=await client.users.fetch(interaction.user.id);await user.send({embeds:[base("Reminder").setDescription(`**"${message}"**\n\nThis is your reminder from **${mins} minute${mins!==1?"s":""}** ago.`).setFooter({text:"Konvert  \u2022  Reminder"})]});}catch{}},mins*60*1000);return;}

      if(cmd==="uptime"){const ms=process.uptime()*1000,hrs=Math.floor(ms/3600000),min=Math.floor((ms%3600000)/60000),sec=Math.floor((ms%60000)/1000),str=`${hrs}h ${min}m ${sec}s`;return interaction.reply({embeds:[base("Bot Uptime").setThumbnail(IMG.LOGO).setDescription(`Konvert Bot has been online for **${str}**.\n\u200b`).addFields({name:"Status",value:"**Online**",inline:true},{name:"Uptime",value:`**${str}**`,inline:true},{name:"Latency",value:`**${client.ws.ping}ms**`,inline:true}).setFooter({text:"Konvert  \u2022  Bot Status"})],ephemeral:true});}

      if(cmd==="calc"){await interaction.deferReply({ephemeral:true});if(!CONFIG.RATES_CHANNEL)return interaction.editReply("RATES_CHANNEL_ID not configured.");const ch=interaction.guild.channels.cache.get(CONFIG.RATES_CHANNEL);if(!ch)return interaction.editReply("Rates channel not found.");const embed=await buildRatesEmbed();if(ratesMsgId){const msg=await ch.messages.fetch(ratesMsgId).catch(()=>null);if(msg){await msg.edit({embeds:[embed]});}else{const s=await ch.send({embeds:[embed]});ratesMsgId=s.id;}}else{const s=await ch.send({embeds:[embed]});ratesMsgId=s.id;}return interaction.editReply("Rates posted.");}

      if(cmd==="setwallet"){const coin=interaction.options.getString("coin").toUpperCase(),addr=interaction.options.getString("address");const w=load("wallets");w[coin]=addr;save("wallets",w);log(interaction.guild,`WALLET: ${interaction.user.tag} set ${coin} to ${addr}`);return interaction.reply({content:`**${coin}** deposit address updated to \`${addr}\``,ephemeral:true});}
      if(cmd==="announce"){const message=interaction.options.getString("message"),channelId=interaction.options.getString("channel"),ping=interaction.options.getString("ping")||"none",ch=interaction.guild.channels.cache.get(channelId);if(!ch)return interaction.reply({content:"Channel not found.",ephemeral:true});const pingStr=ping==="everyone"?"@everyone ":ping==="here"?"@here ":"";await ch.send({content:pingStr||undefined,embeds:[base("Konvert Announcement").setThumbnail(IMG.LOGO).setDescription(message).setFooter({text:`Announced by ${interaction.user.tag}  \u2022  Konvert`})]});return interaction.reply({content:"Announced.",ephemeral:true});}
      if(cmd==="blacklist"){const target=interaction.options.getUser("user"),reason=interaction.options.getString("reason")||"No reason given";const bl=load("blacklist");bl[target.id]={tag:target.tag,reason,by:interaction.user.tag,at:Date.now()};save("blacklist",bl);log(interaction.guild,`BLACKLIST: ${target.tag} -- ${reason}`);return interaction.reply({content:`**${target.tag}** blacklisted. Reason: ${reason}`,ephemeral:true});}
      if(cmd==="unblacklist"){const target=interaction.options.getUser("user");const bl=load("blacklist");delete bl[target.id];save("blacklist",bl);return interaction.reply({content:`**${target.tag}** removed from blacklist.`,ephemeral:true});}

      if(cmd==="closeticket"){const reason=interaction.options.getString("reason")||"Completed";await interaction.deferReply();await doCloseTicket(interaction.channel,interaction.guild,interaction.user,reason);await interaction.editReply({embeds:[new EmbedBuilder().setColor(0xFF4444).setTitle("Ticket Closed").setDescription(`Closed by staff.\n**Reason:** ${reason}\n\nDeleting in 10 seconds.`).setTimestamp()]});setTimeout(()=>interaction.channel.delete().catch(()=>{}),10000);return;}
      if(cmd==="cancelticket"){const reason=interaction.options.getString("reason")||"Cancelled by staff";await interaction.deferReply();const tickets=load("tickets");if(tickets[interaction.channel.id]){tickets[interaction.channel.id].status="cancelled";tickets[interaction.channel.id].cancelledAt=Date.now();save("tickets",tickets);const t=tickets[interaction.channel.id];try{const mem=await interaction.guild.members.fetch(t.userId).catch(()=>null);if(mem)await mem.send({embeds:[base("Ticket Cancelled").setDescription(`Your Konvert exchange ticket has been cancelled by staff.\n**Reason:** ${reason}\n\nIf this is a mistake, please open a new ticket.`).setFooter({text:"Konvert"})]}).catch(()=>{});}catch{}}await interaction.editReply({embeds:[new EmbedBuilder().setColor(0xFF6600).setTitle("Ticket Cancelled").setDescription(`Cancelled by ${interaction.user.tag}\n**Reason:** ${reason}\n\nDeleting in 10 seconds.`).setTimestamp()]});log(interaction.guild,`CANCELLED: #${interaction.channel.name} by ${interaction.user.tag}`);setTimeout(()=>interaction.channel.delete().catch(()=>{}),10000);return;}

      if(cmd==="openticket"){
        await interaction.deferReply();
        const allRoleIds=[...Object.values(CONFIG.ROLES),CONFIG.STAFF_ROLE,CONFIG.EXCHANGER_ROLE].filter(Boolean),uniqueRoles=[...new Set(allRoleIds)],addedRoles=[];
        for(const roleId of uniqueRoles){try{const role=await interaction.guild.roles.fetch(roleId).catch(()=>null);if(!role)continue;await interaction.channel.permissionOverwrites.edit(roleId,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true});addedRoles.push(`<@&${roleId}>`);}catch{}}
        await interaction.editReply({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO}).setTitle("Ticket Opened to All Exchangers").setDescription("This ticket is now **visible to all Konvert exchangers**.\n\nAny available handler can step in and assist with this trade.\n\u200b").addFields({name:"Roles Added",value:addedRoles.length?addedRoles.join("  "):"None configured",inline:false}).setFooter({text:"Konvert  \u2022  Open Ticket"}).setTimestamp()]});
        return;
      }

      if(cmd==="note"){const text=interaction.options.getString("text");await interaction.channel.send({embeds:[new EmbedBuilder().setColor(0xFFB347).setAuthor({name:`Staff Note -- ${interaction.user.tag}`,iconURL:interaction.user.displayAvatarURL()}).setDescription(text).setTimestamp().setFooter({text:"Konvert  \u2022  Staff Note"})]});return interaction.reply({content:"Note added.",ephemeral:true});}

      if(cmd==="tradelog"){const limit=interaction.options.getInteger("limit")||5;const done=Object.values(load("tickets")).filter(t=>t.status==="vouched"&&t.completedAt).sort((a,b)=>b.completedAt-a.completedAt).slice(0,limit);if(!done.length)return interaction.reply({content:"No completed trades yet.",ephemeral:true});const lines=done.map((t,i)=>{const m=getMethod(t.method);return `**${i+1}.** <@${t.userId}>  \u00b7  ${m?.label||t.method}  \u00b7  ${fmtUSD(t.amountUSD)}  \u00b7  <t:${Math.floor(t.completedAt/1000)}:R>`;}).join("\n");return interaction.reply({embeds:[base(`Last ${done.length} Completed Trades`).setDescription(lines).setFooter({text:"Konvert  \u2022  Trade Log"})],ephemeral:true});}

      if(cmd==="volume"){const all=Object.values(load("tickets")),done=all.filter(t=>t.status==="vouched"&&t.amountUSD),totalVol=done.reduce((s,t)=>s+(t.amountUSD||0),0),totalFees=done.reduce((s,t)=>s+(t.feeUSD||0),0),open=all.filter(t=>t.status==="open").length,today=done.filter(t=>t.completedAt&&Date.now()-t.completedAt<86400000),methods={};done.forEach(t=>{if(t.method)methods[t.method]=(methods[t.method]||0)+1;});const topMethod=Object.entries(methods).sort((a,b)=>b[1]-a[1])[0];return interaction.reply({embeds:[base("Konvert Volume Stats").setThumbnail(IMG.LOGO).addFields({name:"Total Completed",value:`**${done.length}** trades`,inline:true},{name:"Total Volume",value:`**${fmtUSD(totalVol)}**`,inline:true},{name:"Total Fees",value:`**${fmtUSD(totalFees)}**`,inline:true},{name:"Open Tickets",value:`**${open}**`,inline:true},{name:"Today's Volume",value:`**${fmtUSD(today.reduce((s,t)=>s+(t.amountUSD||0),0))}** (${today.length} trades)`,inline:true},{name:"Top Method",value:topMethod?`**${getMethod(topMethod[0])?.label||topMethod[0]}** (${topMethod[1]})`:"--",inline:true}).setFooter({text:"Konvert  \u2022  Server Volume Statistics"})],ephemeral:true});}

      if(cmd==="snapshot"){
        await interaction.deferReply({ephemeral:true});
        const guild=interaction.guild,all=Object.values(load("tickets")),done=all.filter(t=>t.status==="vouched"&&t.amountUSD),open=all.filter(t=>t.status==="open"),today=done.filter(t=>t.completedAt&&Date.now()-t.completedAt<86400000),week=done.filter(t=>t.completedAt&&Date.now()-t.completedAt<7*86400000),totalVol=done.reduce((s,t)=>s+(t.amountUSD||0),0);
        const methods={},coins={},byEx={};
        done.forEach(t=>{if(t.method)methods[t.method]=(methods[t.method]||0)+1;if(t.coin)coins[t.coin]=(coins[t.coin]||0)+1;if(t.completedBy)byEx[t.completedBy]=(byEx[t.completedBy]||0)+1;});
        const topMethod=Object.entries(methods).sort((a,b)=>b[1]-a[1])[0],topCoin=Object.entries(coins).sort((a,b)=>b[1]-a[1])[0],topEx=Object.entries(byEx).sort((a,b)=>b[1]-a[1])[0];
        await guild.members.fetch();
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert  \u2022  Server Snapshot",iconURL:IMG.LOGO}).setTitle("Server Snapshot").setThumbnail(IMG.LOGO)
          .setDescription(`Snapshot taken <t:${Math.floor(Date.now()/1000)}:F>\n\u200b`)
          .addFields(
            {name:"\uD83D\uDC65  Members",       value:`**${guild.memberCount}**`,                                                               inline:true},
            {name:"\uD83C\uDF9F  Open Tickets",  value:`**${open.length}**`,                                                                     inline:true},
            {name:"\u2705  Completed",           value:`**${done.length}** trades`,                                                               inline:true},
            {name:"\uD83D\uDCB0  Total Volume",  value:`**${fmtUSD(totalVol)}**`,                                                                 inline:true},
            {name:"\uD83D\uDCC5  Today",         value:`**${today.length}** trades  \u00b7  ${fmtUSD(today.reduce((s,t)=>s+(t.amountUSD||0),0))}`,inline:true},
            {name:"\uD83D\uDCC6  This Week",     value:`**${week.length}** trades  \u00b7  ${fmtUSD(week.reduce((s,t)=>s+(t.amountUSD||0),0))}`,  inline:true},
            {name:"\uD83D\uDCB3  Top Method",    value:topMethod?`**${getMethod(topMethod[0])?.label||topMethod[0]}** (${topMethod[1]})`:"--",    inline:true},
            {name:"\uD83E\uDE99  Top Coin",      value:topCoin?`**${topCoin[0]}** (${topCoin[1]})`:"--",                                          inline:true},
            {name:"\uD83C\uDFC6  Top Exchanger", value:topEx?`<@${topEx[0]}> (${topEx[1]} trades)`:"--",                                          inline:true},
          ).setFooter({text:"Konvert  \u2022  Snapshot"}).setTimestamp()]});
      }

      if(cmd==="exchangerboard"){const done=Object.values(load("tickets")).filter(t=>t.status==="vouched"&&t.completedBy),byEx={};done.forEach(t=>{if(!byEx[t.completedBy])byEx[t.completedBy]={trades:0,volume:0};byEx[t.completedBy].trades+=1;byEx[t.completedBy].volume+=(t.amountUSD||0);});const ranked=Object.entries(byEx).sort((a,b)=>b[1].trades-a[1].trades).slice(0,10);if(!ranked.length)return interaction.reply({content:"No completed trades yet.",ephemeral:true});const medals=["\uD83E\uDD47","\uD83E\uDD48","\uD83E\uDD49"];const lines=ranked.map(([uid,d],i)=>`${medals[i]||`**${i+1}.**`}  <@${uid}>  --  **${d.trades}** trade${d.trades!==1?"s":""}  \u00b7  ${fmtUSD(d.volume)}`).join("\n");return interaction.reply({embeds:[base("Exchanger Leaderboard").setThumbnail(IMG.LOGO).setDescription("Top Konvert exchangers ranked by completed trades.\n\u200b").addFields({name:"Rankings",value:lines,inline:false}).setFooter({text:"Konvert  \u2022  Exchanger Leaderboard"}).setTimestamp()],ephemeral:true});}

      if(cmd==="thankclient"){
        const target=interaction.options.getUser("client"),amount=interaction.options.getNumber("amount")||null;
        const clientDone=Object.values(load("tickets")).filter(t=>t.userId===target.id&&t.status==="vouched");
        const totalVol=clientDone.reduce((s,t)=>s+(t.amountUSD||0),0),tradeCount=clientDone.length,tier=getTier(totalVol);
        const feePreview=amount?`Your rate on your next **${fmtUSD(amount)}** trade: **${feeRate(amount,"send")}%**`:null;
        try{
          await target.send({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO}).setTitle("Thank You for Trading with Us").setThumbnail(IMG.LOGO)
            .setDescription(`Hey <@${target.id}> -- your trade has been completed successfully.\n\nWe appreciate your trust in **Konvert Exchange**. Every deal matters to us and we look forward to trading with you again.\n\u200b`)
            .addFields(
              {name:"Your Tier",       value:`${tier.emoji} **${tier.label}**`,               inline:true},
              {name:"Trades With Us",  value:`**${tradeCount}** completed`,                   inline:true},
              {name:"Total Exchanged", value:totalVol>0?`**${fmtUSD(totalVol)}**`:"--",       inline:true},
              {name:"Come Back Anytime",value:"Head to our exchange channel anytime.\n**Fast  \u00b7  Safe  \u00b7  Simple  \u00b7  Private**",inline:false},
              ...(feePreview?[{name:"Your Rate Preview",value:feePreview,inline:false}]:[]),
            ).setImage(IMG.DEAL).setFooter({text:"Konvert Exchange  \u2022  Thank you for your business"}).setTimestamp()]});
          return interaction.reply({content:`Thank-you card sent to **${target.tag}**.`,ephemeral:true});
        }catch{return interaction.reply({content:`Could not DM **${target.tag}**. They may have DMs disabled.`,ephemeral:true});}
      }

      if(cmd==="passes"){const holders=Object.entries(state.passes).filter(([,v])=>v>0);if(!holders.length)return interaction.reply({content:"No exchange passes have been won yet.",ephemeral:true});return interaction.reply({embeds:[base("Exchange Pass Holders").setThumbnail(IMG.LOGO).setDescription(holders.map(([uid,c])=>`<@${uid}> -- **${c}** pass${c!==1?"es":""}`).join("\n")).setFooter({text:"Konvert Mine  \u2022  Won by finding all 3 diamonds"})],ephemeral:true});}

      if(cmd==="lookup"){const query=interaction.options.getString("name").toLowerCase().trim(),tickets=load("tickets"),match=Object.entries(tickets).find(([id,t])=>{const chName=interaction.guild.channels.cache.get(id)?.name||"";return chName.includes(query)||id===query;});if(!match)return interaction.reply({content:`No ticket found matching **${query}**.`,ephemeral:true});const [channelId,t]=match,m=getMethod(t.method),se=t.status==="vouched"?"\u2705":t.status==="open"?"\uD83D\uDFE1":"\uD83D\uDD34";return interaction.reply({embeds:[base("Ticket Lookup").setThumbnail(IMG.LOGO).addFields({name:"Client",value:`<@${t.userId}>`,inline:true},{name:"Status",value:`${se} **${t.status==="vouched"?"Completed":t.status==="open"?"Open":"Closed"}**`,inline:true},{name:"Method",value:m?.label||t.method,inline:true},{name:"Amount",value:fmtUSD(t.amountUSD||0),inline:true},{name:"Coin",value:t.coin||"--",inline:true},{name:"Opened",value:t.createdAt?`<t:${Math.floor(t.createdAt/1000)}:R>`:"--",inline:true},{name:"Completed",value:t.completedAt?`<t:${Math.floor(t.completedAt/1000)}:R>`:"--",inline:true},{name:"Channel",value:`<#${channelId}>`,inline:true}).setFooter({text:"Konvert  \u2022  Ticket Lookup"})],ephemeral:true});}

      if(cmd==="postkonvault"){const inviteUrl="https://discord.gg/jnT63k4UA7";const embed=new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO}).setTitle("\uD83D\uDE80  Konvault\u2122").setDescription("**The Ultimate Crypto Wagering Hub**\n-- Owned by Konvert Exchange\n-- Free MM service  \u00b7  0% fee\n\n*Flip, win, repeat. It's that simple.*\n\u200b").addFields({name:"What We Offer",value:"\uD83D\uDCB0  Choose any amount of crypto to wager\n\uD83E\uDE99  Fair coin flips -- winner takes all\n\uD83D\uDD12  Funds securely held by trusted middlemen\n\u26A1  Active agents & support 24/7\n\uD83C\uDF10  Supports ALL cryptocurrencies\n\uD83D\uDD0D  Full transparency -- proof provided for every wager\n\u2705  0 fees -- tips are always welcome",inline:false},{name:"\uD83C\uDF89  Join Now",value:"Click the button below to join Konvault and start flipping!",inline:false}).setImage(IMG.BANNER).setFooter({text:"Konvault by Konvert Exchange  \u2022  Free MM  \u2022  0% Fee"}).setTimestamp();await interaction.channel.send({embeds:[embed],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel("Join Konvault").setEmoji("\uD83D\uDE80").setStyle(ButtonStyle.Link).setURL(inviteUrl))]});return interaction.reply({content:"Konvault embed posted.",ephemeral:true});}

      if(cmd==="postinfo"){const embed=new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO}).setTitle("Info").setThumbnail(IMG.LOGO).setDescription("Konvert is a **fast and reliable exchange community** for converting value across platforms.\n\nEasily exchange **PayPal, Crypto, Cash App, Zelle, E-Transfer**, and other payment methods -- both directions -- with **low fees** and **quick processing**.\n\nOur agents are available **24/7**, backed by a friendly, active community and real-time crypto price updates to keep you informed. We also run **giveaways of cryptocurrency** which can be won regularly.\n\nSay goodbye to slow exchangers and high fees -- hello to convenience and 24/7 replies.\n\u200b").addFields({name:"\uD83D\uDCB8  Fees",value:"5% - 9%  \u00b7  Tiered by amount  \u00b7  Min $5",inline:true},{name:"\u26A1  Speed",value:"Usually under 10 minutes",inline:true},{name:"\uD83E\uDD1D  Support",value:"24/7 agents always available",inline:true}).setImage(IMG.BANNER).setFooter({text:"Konvert Exchange  \u2022  Fast  \u00b7  Safe  \u00b7  Simple  \u00b7  Private"});await interaction.channel.send({embeds:[embed]});return interaction.reply({content:"Info embed posted.",ephemeral:true});}

      if(cmd==="posttos"){const embed=new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO}).setTitle("Terms of Service").setThumbnail(IMG.LOGO).setDescription("**Konvert -- Exchange Policies**\n\u200b").addFields({name:"1. Lawful Use",value:"Konvert strictly prohibits the use of its services for any unlawful activity, including but not limited to fraud, scams, chargebacks, or abuse of payment systems. Transactions deemed suspicious, unauthorized, or high-risk can be rejected and denied.",inline:false},{name:"2. Fees & Pricing",value:"All exchanges are subject to a minimum service fee of **$5 USD**, and a tiered % for larger deals.\n\nFees are **non-refundable** if:\n- The exchange is confirmed completed by both parties\n- Payment details provided are inaccurate or unverifiable\n- The client withdraws after the exchange process has begun\n\nRefunds only in cases of verified error, reported within 24 hours.",inline:false},{name:"3. On-Platform Transactions Only",value:"All exchanges must be conducted exclusively through the Konvert server and official ticket system. Transactions arranged outside of Konvert are **strictly prohibited**.\n\nKonvert will not provide support or refund for any off-platform transactions.",inline:false},{name:"4. Accepted Payment Methods",value:"PayPal  \u00b7  Cash App  \u00b7  Venmo  \u00b7  Interac e-Transfer  \u00b7  Zelle  \u00b7  IBAN  \u00b7  Bank Transfer  \u00b7  Crypto\n\nAdditional fees may apply for card or bank-based payments. All fees will be clearly disclosed before deal is taken.",inline:false},{name:"5. Disputes & Enforcement",value:"Any attempt to chargeback, make false claims, abuse staff, or bypass policies will result in an **immediate ban** from the server.",inline:false}).setFooter({text:"Konvert  \u2022  By using our services you agree to these terms"});await interaction.channel.send({embeds:[embed]});return interaction.reply({content:"Terms of Service embed posted.",ephemeral:true});}

      if(cmd==="postlinks"){const embed=new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO}).setTitle("Official Links for Konvert").setThumbnail(IMG.LOGO).setDescription("All official Konvert social media. Follow us for updates, announcements, and giveaways.\n\u200b").addFields({name:"\uD835\uDD4F  Twitter / X",value:"[**@KonvertNow**](https://x.com/konvertnow)",inline:true},{name:"\uD83D\uDCF8  Instagram",value:"[**@KonvertNow**](https://www.instagram.com/konvertnow/)",inline:true},{name:"\u26A0\uFE0F  Stay Safe",value:"Only interact with accounts listed here. Any other account claiming to be Konvert is an impersonator.",inline:false}).setImage(IMG.BANNER).setFooter({text:"Konvert  \u2022  Official Links  \u2022  Follow us for updates"});await interaction.channel.send({embeds:[embed]});return interaction.reply({content:"Official links embed posted.",ephemeral:true});}

      if(cmd==="setfeedchannel"){const channelId=interaction.options.getString("channel_id"),ch=interaction.guild.channels.cache.get(channelId);if(!ch)return interaction.reply({content:"Channel not found.",ephemeral:true});state.feedChannel=channelId;return interaction.reply({content:`\uD83D\uDCE1 Live deal feed channel set to <#${channelId}>.`,ephemeral:true});}
      if(cmd==="livefeed"){state.feedEnabled=!state.feedEnabled;return interaction.reply({content:`Live deal feed is now **${state.feedEnabled?"\u2705 ON":"\u274C OFF"}**${state.feedChannel?` in <#${state.feedChannel}>`:" (set a channel with /setfeedchannel first)"}.`,ephemeral:true});}

      return;
    } // end isChatInputCommand

    // --- SELECT MENUS ---
    if(interaction.isStringSelectMenu()){
      if(interaction.customId==="select_method"){
        const method=interaction.values[0],_m=getMethod(method);
        if(method==="crypto"){
          const coinOpts=COINS.map(c=>new StringSelectMenuOptionBuilder().setLabel(c).setValue(c).setDescription(`Exchange ${c}`));
          return interaction.update({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO}).setTitle("Crypto to Crypto").setDescription("Select the coin you are **sending** and the coin you want to **receive** below.\n\u200b").setFooter({text:"Step 2 of 3  \u2022  Konvert"})],components:[new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("c2c_send").setPlaceholder("Select coin you are SENDING...").addOptions(coinOpts)),new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("c2c_recv").setPlaceholder("Select coin you want to RECEIVE...").addOptions(coinOpts))]});
        }
        return interaction.update({embeds:[step2Embed(method)],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`dir_send__${method}`).setLabel(`Send Crypto \u2192 Get ${_m.label}`).setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId(`dir_receive__${method}`).setLabel(`Send ${_m.label} \u2192 Get Crypto`).setStyle(ButtonStyle.Success))]});
      }
      if(interaction.customId==="c2c_send"||interaction.customId==="c2c_recv"){
        const userId=interaction.user.id;
        if(!state.c2cSelections[userId])state.c2cSelections[userId]={};
        if(interaction.customId==="c2c_send")state.c2cSelections[userId].send=interaction.values[0];
        if(interaction.customId==="c2c_recv")state.c2cSelections[userId].recv=interaction.values[0];
        const sel=state.c2cSelections[userId],both=sel.send&&sel.recv;
        const coinOpts=COINS.map(c=>new StringSelectMenuOptionBuilder().setLabel(c).setValue(c).setDescription(`Exchange ${c}`));
        const components=[new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("c2c_send").setPlaceholder(sel.send?`Sending: ${sel.send}`:"Select coin you are SENDING...").addOptions(coinOpts)),new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("c2c_recv").setPlaceholder(sel.recv?`Receiving: ${sel.recv}`:"Select coin you want to RECEIVE...").addOptions(coinOpts))];
        if(both)components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("btn_c2c_confirm").setLabel(`Confirm: ${sel.send} \u2192 ${sel.recv}`).setStyle(ButtonStyle.Success)));
        return interaction.update({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO}).setTitle("Crypto to Crypto").setDescription(`**Sending:** ${sel.send||"--"}\n**Receiving:** ${sel.recv||"--"}\n\n${both?"Both coins selected. Click **Confirm** to continue.\n\u200b":"Select both coins then a confirm button will appear.\n\u200b"}`).setFooter({text:"Step 2 of 3  \u2022  Konvert"})],components});
      }
    }

    // --- BUTTONS ---
    if(interaction.isButton()){
      if(interaction.customId==="btn_exchange_now"){const bl=load("blacklist");if(bl[interaction.user.id])return interaction.reply({content:"You are blacklisted from Konvert.",ephemeral:true});return interaction.reply({embeds:[step1Embed()],components:[new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("select_method").setPlaceholder("Select your payment method...").addOptions(METHODS.map(m=>new StringSelectMenuOptionBuilder().setLabel(m.label).setValue(m.value).setDescription(`Exchange crypto with ${m.label}`))))],ephemeral:true});}
      if(interaction.customId==="btn_fee_calc"){const modal=new ModalBuilder().setCustomId("modal_fee").setTitle("Fee Calculator");modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("fee_amt").setLabel("Trade amount in USD").setStyle(TextInputStyle.Short).setPlaceholder("e.g. 250").setRequired(true)));return interaction.showModal(modal);}
      if(interaction.customId==="btn_rates_quick"){await interaction.deferReply({ephemeral:true});return interaction.editReply({embeds:[await buildRatesEmbed()]});}
      if(interaction.customId==="btn_refresh_rates"){await interaction.deferUpdate();return interaction.editReply({embeds:[await buildRatesEmbed()],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("btn_refresh_rates").setLabel("Refresh").setStyle(ButtonStyle.Secondary))]});}

      if(interaction.customId==="btn_c2c_confirm"){
        const c2cData=state.c2cSelections?.[interaction.user.id];
        if(!c2cData?.send||!c2cData?.recv)return interaction.reply({content:"Please select both coins before confirming.",ephemeral:true});
        delete state.c2cSelections[interaction.user.id];
        const {send:sendCoin,recv:recvCoin}=c2cData;
        if(sendCoin===recvCoin)return interaction.reply({content:"You cannot exchange a coin for the same coin.",ephemeral:true});
        const modal=new ModalBuilder().setCustomId(`modal_c2c__${sendCoin}__${recvCoin}`).setTitle(`${sendCoin} \u2192 ${recvCoin}`);
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("c2c_amount").setLabel("Amount in USD you are sending").setStyle(TextInputStyle.Short).setPlaceholder("e.g. 200").setRequired(true)),new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("c2c_wallet").setLabel(`Your ${recvCoin} receiving wallet address`).setStyle(TextInputStyle.Short).setRequired(true)),new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("c2c_notes").setLabel("Notes (optional)").setStyle(TextInputStyle.Paragraph).setRequired(false)));
        return interaction.showModal(modal);
      }

      if(interaction.customId.startsWith("dir_send__")||interaction.customId.startsWith("dir_receive__")){
        const isSend=interaction.customId.startsWith("dir_send__"),method=interaction.customId.replace("dir_send__","").replace("dir_receive__",""),m=getMethod(method);
        const modal=new ModalBuilder().setCustomId(`modal_amount__${method}__${isSend?"send":"receive"}`).setTitle(`${m.label} -- ${isSend?"Send Crypto":"Receive Crypto"}`);
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("inp_amount").setLabel("Trade amount in USD").setStyle(TextInputStyle.Short).setPlaceholder("e.g. 150").setRequired(true)),new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("inp_coin").setLabel("Which crypto? (BTC, ETH, SOL)").setStyle(TextInputStyle.Short).setPlaceholder("e.g. SOL").setRequired(true)),new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("inp_wallet").setLabel(isSend?`Your ${m.label} receiving info`:"Your crypto receiving wallet").setStyle(TextInputStyle.Short).setRequired(true)),new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("inp_notes").setLabel("Notes (optional)").setStyle(TextInputStyle.Paragraph).setRequired(false)));
        return interaction.showModal(modal);
      }

      if(interaction.customId==="btn_confirm_ticket"){await interaction.deferUpdate();const pending=state.pending[interaction.user.id];if(!pending)return interaction.editReply({content:"Session expired. Please start again.",embeds:[],components:[]});delete state.pending[interaction.user.id];const ch=await createTicket(interaction,pending.method,pending.direction,pending.rawAmt,pending.coin,pending.walletInf,pending.notes);if(ch)return interaction.editReply({content:`Ticket opened \u2192 <#${ch.id}>`,embeds:[],components:[]});return;}
      if(interaction.customId==="btn_cancel_ticket"){delete state.pending[interaction.user.id];return interaction.update({content:"Cancelled. Click Exchange Now to start again.",embeds:[],components:[]});}

      if(interaction.customId==="btn_support_ticket"){
        const modal=new ModalBuilder().setCustomId("modal_support").setTitle("Open a Support Ticket");
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("sup_issue").setLabel("What do you need help with?").setStyle(TextInputStyle.Paragraph).setPlaceholder("Describe your issue clearly...").setRequired(true)),new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("sup_tried").setLabel("What have you already tried?").setStyle(TextInputStyle.Short).setPlaceholder("e.g. Checked FAQ, contacted staff").setRequired(false)));
        return interaction.showModal(modal);
      }

      // btn_done -- CORRECT ORDER: save -> vouch -> live feed -> tier role -> DM client
      if(interaction.customId==="btn_done"){
        const tickets=load("tickets"),ticket=tickets[interaction.channel.id];
        const isOwner=CONFIG.OWNER_IDS.includes(interaction.user.id),isStaff=CONFIG.STAFF_ROLE?interaction.member.roles.cache.has(CONFIG.STAFF_ROLE):false;
        const mRoleId=ticket?.method?CONFIG.ROLES[ticket.method]:null,isHandler=mRoleId?interaction.member.roles.cache.has(mRoleId):false;
        if(!isOwner&&!isStaff&&!isHandler)return interaction.reply({content:"Only staff or the assigned handler can mark a trade complete.",ephemeral:true});
        if(ticket?.status==="vouched"||ticket?.status==="closed")return interaction.reply({content:"This ticket has already been completed.",ephemeral:true});
        await interaction.deferReply();
        const m=ticket?getMethod(ticket.method):null;
        if(ticket){
          // 1. Save as vouched FIRST
          tickets[interaction.channel.id].status="vouched";tickets[interaction.channel.id].completedBy=interaction.user.id;tickets[interaction.channel.id].completedAt=Date.now();save("tickets",tickets);
          // 2. Post vouch embed to vouch channel
          await postVouch(interaction.guild,{clientId:ticket.userId,exchangerId:interaction.user.id,method:m?.label||ticket.method,amountUSD:ticket.amountUSD,direction:ticket.direction,coin:ticket.coin,message:null,rating:5});
          // 3. Post to live deal feed if enabled
          if(state.feedEnabled&&state.feedChannel){try{const feedCh=interaction.guild.channels.cache.get(state.feedChannel);if(feedCh){const _all=Object.values(load("tickets")).filter(t=>t.userId===ticket.userId&&t.status==="vouched"),_tier=getTier(_all.reduce((s,t)=>s+(t.amountUSD||0),0));await feedCh.send(`\u2705  **${m?.label||ticket.method}**  \u00b7  **${fmtUSD(ticket.amountUSD)}**  \u00b7  ${_tier.emoji}  \u2014  just now`);}}catch{}}
          // 4. Apply tier role
          try{const allR=Object.values(load("tickets")).filter(t=>t.userId===ticket.userId&&t.status==="vouched");await applyTierRole(interaction.guild,ticket.userId,allR.reduce((s,t)=>s+(t.amountUSD||0),0));}catch{}
          // 5. Auto thank-you DM to client
          try{
            const allC=Object.values(load("tickets")).filter(t=>t.userId===ticket.userId&&t.status==="vouched"),totalVol=allC.reduce((s,t)=>s+(t.amountUSD||0),0),tradeCount=allC.length,tier=getTier(totalVol);
            const clientUser=await client.users.fetch(ticket.userId);
            await clientUser.send({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert Exchange",iconURL:IMG.LOGO}).setTitle("Thank You for Trading with Us").setThumbnail(IMG.LOGO)
              .setDescription(`Hey <@${ticket.userId}> -- your trade has been completed successfully.\n\nWe appreciate your trust in **Konvert Exchange**. Every deal matters to us and we look forward to trading with you again.\n\u200b`)
              .addFields(
                {name:"Your Tier",        value:`${tier.emoji} **${tier.label}**`,              inline:true},
                {name:"Trades With Us",   value:`**${tradeCount}** completed`,                  inline:true},
                {name:"Total Exchanged",  value:`**${fmtUSD(totalVol)}**`,                      inline:true},
                {name:"This Trade",       value:`**${fmtUSD(ticket.amountUSD)}** via ${m?.label||ticket.method}`,inline:false},
                {name:"Come Back Anytime",value:`Head to our exchange channel anytime to open a new ticket.\n**Fast  \u00b7  Safe  \u00b7  Simple  \u00b7  Private**`,inline:false},
              ).setImage(IMG.DEAL).setTimestamp().setFooter({text:"Konvert Exchange  \u2022  Thank you for your business"})]});
          }catch{}
        }
        const completionEmbed=ticket?buildDealEmbed({clientId:ticket.userId,exchangerId:interaction.user.id,method:m?.label||ticket.method,amountUSD:ticket.amountUSD,direction:ticket.direction,coin:ticket.coin,message:null,rating:5}):new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO}).setTitle("Trade Complete").setDescription("Trade marked complete by staff.").setImage(IMG.DEAL).setTimestamp().setFooter({text:"Konvert"});
        const replyEmbed=new EmbedBuilder(completionEmbed.data).setDescription("Vouch posted. Thank-you card sent to client.\nThis ticket closes in **15 seconds**.");
        await interaction.editReply({embeds:[replyEmbed]});
        setTimeout(async()=>{await doCloseTicket(interaction.channel,interaction.guild,interaction.user,"Trade completed");interaction.channel.delete().catch(()=>{});},15000);
        return;
      }

      if(interaction.customId==="btn_close"){
        if(!CONFIG.OWNER_IDS.includes(interaction.user.id)&&!(CONFIG.STAFF_ROLE&&interaction.member.roles.cache.has(CONFIG.STAFF_ROLE)))return interaction.reply({content:"Only owners or staff can close tickets.",ephemeral:true});
        await interaction.deferReply();
        await doCloseTicket(interaction.channel,interaction.guild,interaction.user,"Closed by staff");
        await interaction.editReply({embeds:[new EmbedBuilder().setColor(0xFF4444).setTitle("Ticket Closed").setDescription("This ticket has been closed.\nDeleting in 15 seconds.").setTimestamp()]});
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
        if(isBomb){game.over=true;delete state.mineGames[userId];const rev={...game,revealed:Array.from({length:25},(_,i)=>i),over:true};return interaction.update({embeds:[base("Mine -- Bomb Hit").setColor(0xFF4444).setDescription("**BOOM!** You hit a bomb. The grid has been revealed.\n\nBetter luck next time -- you can try again in **3 hours**.\n\u200b").addFields({name:"Diamonds Found",value:`**${game.found} / 3**`,inline:true},{name:"Result",value:"No pass awarded",inline:true},{name:"Next Try",value:"In **3 hours**",inline:true}).setFooter({text:"Konvert Mine  \u2022  Try again in 3 hours"})],components:buildMineGrid(userId,rev)});}
        const triesLeft=3-game.tries;
        if(triesLeft<=0&&game.found<3){game.over=true;delete state.mineGames[userId];const rev={...game,revealed:Array.from({length:25},(_,i)=>i),over:true};return interaction.update({embeds:[base("Mine -- Out of Tries").setDescription(`You used all **3 tries** and found **${game.found} / 3** diamonds.\nThe grid has been revealed. Try again in **3 hours**.\n\u200b`).addFields({name:"Diamonds Found",value:`**${game.found} / 3**`,inline:true},{name:"Result",value:"No pass awarded",inline:true},{name:"Next Try",value:"In **3 hours**",inline:true}).setFooter({text:"Konvert Mine  \u2022  Try again in 3 hours"})],components:buildMineGrid(userId,rev)});}
        if(game.found===3){
          game.over=true;delete state.mineGames[userId];state.passes[userId]=(state.passes[userId]||0)+1;
          try{const mem=await interaction.guild.members.fetch(userId);if(CONFIG.PASS_ROLE)await mem.roles.add(CONFIG.PASS_ROLE);}catch{}
          for(const oid of CONFIG.OWNER_IDS){try{const o=await client.users.fetch(oid);await o.send({embeds:[new EmbedBuilder().setColor(0xFFD700).setAuthor({name:"Konvert Mine -- Winner",iconURL:IMG.LOGO}).setTitle("Exchange Pass Won").setDescription(`<@${userId}> (${interaction.user.tag}) found all 3 diamonds and won a free exchange pass.\nTotal passes: **${state.passes[userId]}**`).setTimestamp()]});}catch{}}
          return interaction.update({embeds:[new EmbedBuilder().setColor(0xFFD700).setAuthor({name:"Konvert",iconURL:IMG.LOGO}).setTitle("All 3 Diamonds Found").setDescription("You found every diamond without hitting a bomb.\n\nA **Free Exchange Pass** has been awarded and the role has been added to your account.\nOpen a ticket and let staff know.\n\u200b").addFields({name:"Pass Holder",value:`<@${userId}>`,inline:true},{name:"Passes",value:`**${state.passes[userId]}**`,inline:true},{name:"Tries Used",value:`**${game.tries} / 3**`,inline:true}).setFooter({text:"Konvert Mine  \u2022  Screenshot this as proof"}).setTimestamp()],components:[]});
        }
        return interaction.update({embeds:[base("Konvert Mine").setThumbnail(IMG.LOGO).setDescription(`${isDiamond?"**Diamond found!** Keep going.":"Nothing there. Keep looking."}\n\u200b`).addFields({name:"Diamonds Found",value:`**${game.found} / 3**`,inline:true},{name:"Tries Remaining",value:`**${triesLeft}**`,inline:true}).setFooter({text:`Konvert Mine  \u2022  ${triesLeft} tr${triesLeft!==1?"ies":"y"} left  \u2022  Hit a bomb = game over`})],components:buildMineGrid(userId,game)});
      }
    } // end isButton

    // --- MODALS ---
    if(interaction.isModalSubmit()){
      if(interaction.customId==="modal_support"){
        const issue=interaction.fields.getTextInputValue("sup_issue"),tried=interaction.fields.getTextInputValue("sup_tried")||"Not specified",user=interaction.user,guild=interaction.guild;
        let ch;
        try{ch=await guild.channels.create({name:`support-${user.username.replace(/[^a-z0-9]/gi,"").toLowerCase().slice(0,12)}`,type:ChannelType.GuildText,parent:CONFIG.TICKET_CATEGORY||null,permissionOverwrites:[{id:guild.roles.everyone,deny:[PermissionFlagsBits.ViewChannel]},{id:user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]},...(CONFIG.STAFF_ROLE?[{id:CONFIG.STAFF_ROLE,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.ManageChannels]}]:[]),...CONFIG.OWNER_IDS.map(id=>({id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.ManageChannels]}))]});}catch{return interaction.reply({content:"Failed to create support channel.",ephemeral:true});}
        await ch.send({content:`<@${user.id}>`,embeds:[new EmbedBuilder().setColor(0xFF6B35).setAuthor({name:"Konvert  \u2022  Support",iconURL:IMG.LOGO}).setTitle("Support Ticket").setThumbnail(IMG.LOGO).setDescription(`**Welcome, <@${user.id}>**\n\nStaff will assist you shortly. Please be patient.\n\u200b`).addFields({name:"Issue",value:issue,inline:false},{name:"What Tried",value:tried,inline:false}).setTimestamp().setFooter({text:"Konvert  \u2022  Support Ticket"})],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("btn_close").setLabel("Close Ticket").setStyle(ButtonStyle.Danger))]});
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
        if(btcP)coinLines.push(`BTC: **${(recvS/btcP).toFixed(6)}**`);
        if(ethP)coinLines.push(`ETH: **${(recvS/ethP).toFixed(5)}**`);
        if(solP)coinLines.push(`SOL: **${(recvS/solP).toFixed(4)}**`);
        return interaction.editReply({embeds:[base("Fee Calculator").setThumbnail(IMG.LOGO)
          .setDescription(`Estimate for **${fmtUSD(raw)}**\n*Final fee may vary slightly.*\n\u200b`)
          .addFields(
            {name:"Fiat \u2192 Crypto",       value:`Rate: **${rS}%**\nFee: **${fmtUSD(fS)}**\nYou receive: **${fmtUSD(recvS)}**`,inline:true},
            {name:"Crypto \u2192 Fiat",       value:`Rate: **${rR}%**\nFee: **${fmtUSD(fR)}**\nYou receive: **${fmtUSD(raw-fR)}**`,inline:true},
            {name:"\uD83E\uDE99 Coin Amounts",value:coinLines.length?coinLines.join("  \u00b7  "):"--",inline:false},
          ).setImage(IMG.FEE).setFooter({text:"Konvert  \u2022  Open a ticket to begin"})]});
      }

      if(interaction.customId.startsWith("modal_c2c__")){
        await interaction.deferReply({ephemeral:true});
        const parts=interaction.customId.split("__"),sendCoin=parts[1],recvCoin=parts[2];
        const rawAmt=parseFloat(interaction.fields.getTextInputValue("c2c_amount")),walletInf=interaction.fields.getTextInputValue("c2c_wallet").trim(),notes=interaction.fields.getTextInputValue("c2c_notes")?.trim()||"";
        if(isNaN(rawAmt)||rawAmt<=0)return interaction.editReply("Please enter a valid amount greater than $0.");
        if(!walletInf)return interaction.editReply("Please enter your receiving wallet address.");
        const fee=calcFee(rawAmt,"send"),rate=feeRate(rawAmt,"send");
        state.pending[interaction.user.id]={method:"crypto",direction:"send",rawAmt,coin:sendCoin,walletInf,notes,recvCoin};
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO}).setTitle("Confirm Crypto to Crypto Exchange").setThumbnail(COIN_LOGO[sendCoin]||IMG.LOGO)
          .setDescription("Review your details below before confirming.\n\u200b")
          .addFields({name:"You Send",value:`**${sendCoin}** worth **${fmtUSD(rawAmt)}**`,inline:true},{name:"You Receive",value:`**${recvCoin}**`,inline:true},{name:"Est. Fee",value:`**${rate}%** -- ${fmtUSD(fee)}`,inline:true},{name:"Receiving Wallet",value:`||${walletInf}||`,inline:false},...(notes?[{name:"Notes",value:notes,inline:false}]:[]))
          .setFooter({text:"Fee is an estimate and may vary slightly  \u2022  Konvert"})],
          components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("btn_confirm_ticket").setLabel("Confirm & Open Ticket").setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId("btn_cancel_ticket").setLabel("Cancel").setStyle(ButtonStyle.Secondary))]});
      }

      if(interaction.customId.startsWith("modal_amount__")){
        await interaction.deferReply({ephemeral:true});
        const parts=interaction.customId.split("__"),method=parts[1],direction=parts[2],m=getMethod(method);
        const rawAmt=parseFloat(interaction.fields.getTextInputValue("inp_amount")),coin=interaction.fields.getTextInputValue("inp_coin").toUpperCase().trim();
        const walletInf=interaction.fields.getTextInputValue("inp_wallet").trim(),notes=interaction.fields.getTextInputValue("inp_notes")?.trim()||"";
        if(isNaN(rawAmt)||rawAmt<=0)return interaction.editReply("Please enter a valid amount greater than $0.");
        if(!COINS.includes(coin))return interaction.editReply(`**${coin}** is not supported. Supported: ${COINS.join(", ")}`);
        if(!walletInf)return interaction.editReply("Please enter your wallet or account info.");
        const fee=calcFee(rawAmt,direction),rate=feeRate(rawAmt,direction),recv=rawAmt-fee;
        const sendLabel=direction==="send"?`**${coin}** worth **${fmtUSD(rawAmt)}**`:`**${fmtUSD(rawAmt)}** via ${m.label}`;
        let recvLabel=direction==="send"?`**${fmtUSD(recv)}** via ${m.label}`:recv<5?"To be discussed":`**~${fmtUSD(recv)}** worth of ${coin}`;
        // Show coin amount for fiat->crypto direction
        if(direction==="receive"){try{const coinPrice=await getPrice(coin);if(coinPrice)recvLabel=`**~${(recv/coinPrice).toFixed(6)} ${coin}** (\u2248${fmtUSD(recv)})`;}catch{}}
        state.pending[interaction.user.id]={method,direction,rawAmt,coin,walletInf,notes};
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR).setAuthor({name:"Konvert",iconURL:IMG.LOGO}).setTitle("Confirm Your Exchange")
          .setThumbnail(COIN_LOGO[coin]||IMG.LOGO).setDescription("Review your details below before confirming.\n\u200b")
          .addFields(
            {name:"Method",   value:`**${m.label}**`,                                              inline:true},
            {name:"Crypto",   value:`**${coin}**`,                                                 inline:true},
            {name:"Direction",value:`**${direction==="send"?"Fiat \u2192 Crypto":"Crypto \u2192 Fiat"}**`,inline:true},
            {name:"Sending",  value:sendLabel,                                                     inline:true},
            {name:"Receiving",value:recvLabel,                                                     inline:true},
            {name:"Est. Fee", value:`**${rate}%** -- ${fmtUSD(fee)}`,                              inline:true},
            {name:"Your Info",value:`||${walletInf}||`,                                            inline:false},
          ).setFooter({text:"Fee is an estimate and may vary slightly  \u2022  Konvert"})],
          components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("btn_confirm_ticket").setLabel("Confirm & Open Ticket").setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId("btn_cancel_ticket").setLabel("Cancel").setStyle(ButtonStyle.Secondary))]});
      }
    } // end isModalSubmit

  }catch(err){
    console.error("Interaction error:",err);
    try{const errMsg={content:"Something went wrong. Please try again.",ephemeral:true};if(interaction.deferred||interaction.replied)await interaction.followUp(errMsg).catch(()=>{});else await interaction.reply(errMsg).catch(()=>{});}catch{}
  }
});

let ratesMsgId=null;
async function autoRates(guild){
  if(!CONFIG.RATES_CHANNEL||!guild)return;
  const ch=guild.channels.cache.get(CONFIG.RATES_CHANNEL);if(!ch)return;
  try{const embed=await buildRatesEmbed();if(ratesMsgId){const msg=await ch.messages.fetch(ratesMsgId).catch(()=>null);if(msg){await msg.edit({embeds:[embed]});return;}}const sent=await ch.send({embeds:[embed]});ratesMsgId=sent.id;}catch(e){console.error("Auto rates:",e.message);}
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

client.once(Events.ClientReady, async () => {
  console.log(`Konvert Bot online -- ${client.user.tag}`);
  client.user.setPresence({activities:[{name:"Konvert",type:3}],status:"online"});
  const guild=client.guilds.cache.get(CONFIG.GUILD_ID);
  if(guild){
    await autoRates(guild);
    setInterval(()=>autoRates(guild),10*60*1000);
    setInterval(()=>checkAlerts(),5*60*1000);
  }
});

registerCommands().then(()=>client.login(CONFIG.TOKEN)).catch(console.error);
