'use strict';
/* Дурак онлайн — Telegram Mini App. Один файл, без зависимостей (только Node.js 18+). */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = +process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'durak-data.json');
const START_COINS = 1000;
const MIN_SEND = 10, MAX_OUT = 5, OFFER_TTL = +process.env.OFFER_TTL_MS || 48 * 3600e3;
const FEE = 0.05;
const TURN_MS = +process.env.TURN_MS || 45000;
const STAKES = [50, 100, 250, 500, 1000];
const EMOJIS = ['😎','🤠','🦊','🐼','🐯','🦁','🐸','🐵','🦄','🐲','👑','🔥','💀','👻','🤖','👽','🥷','🧙','🦅','🐺','🦈','🐙','🍀','⭐'];
const COLORS = 10;
const RANKS = [
  { min: 0, name: 'Дурачок', icon: '🤡' },
  { min: 50, name: 'Новичок', icon: '🌱' },
  { min: 150, name: 'Игрок', icon: '🎴' },
  { min: 300, name: 'Знаток', icon: '🧠' },
  { min: 600, name: 'Мастер', icon: '⚔️' },
  { min: 1000, name: 'Профи', icon: '💎' },
  { min: 1800, name: 'Легенда', icon: '👑' },
];
const CFG = { emojis: EMOJIS, ranks: RANKS, stakes: STAKES, colors: COLORS, turn: TURN_MS, fee: FEE, minSend: MIN_SEND, offerTtl: OFFER_TTL };

const HTML = "<!doctype html>\n<html lang=\"ru\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover\">\n<title>Дурак Онлайн</title>\n<script src=\"https://telegram.org/js/telegram-web-app.js\"></script>\n<style>\n:root{--bg:#0e1320;--bg2:#171f33;--card:#1e2842;--line:#2b3757;--tx:#eef2ff;--mut:#8f9bbd;--gold:#ffc93c;--gold2:#ff9d00;--green:#2ecc71;--red:#ff5468;--blue:#4c8dff}\n*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none}\nhtml,body{margin:0;height:100%;background:var(--bg);color:var(--tx);font-family:-apple-system,BlinkMacSystemFont,\"SF Pro Display\",\"Segoe UI\",Roboto,sans-serif;overflow:hidden}\nbody{background:radial-gradient(120% 80% at 50% 0%,#1b2650 0%,var(--bg) 60%)}\nbutton{font:inherit;color:inherit;border:0;background:none;cursor:pointer}\ninput{font:inherit;user-select:text;-webkit-user-select:text}\n.screen{display:none;position:fixed;inset:0;flex-direction:column}\n.screen.active{display:flex}\n#splash{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px;z-index:50;background:var(--bg);font-size:15px;color:var(--mut)}\n#splash .logo{font-size:64px;animation:float 1.6s ease-in-out infinite}\n@keyframes float{50%{transform:translateY(-8px) rotate(6deg)}}\n#toast{position:fixed;left:50%;top:max(14px,env(safe-area-inset-top));transform:translate(-50%,-140%);background:#2a1a24;border:1px solid var(--red);color:#ffd5da;padding:10px 16px;border-radius:14px;font-size:14px;z-index:99;transition:.3s;max-width:90%;text-align:center}\n#toast.show{transform:translate(-50%,0)}\n#toast.ok{background:#14301f;border-color:var(--green);color:#cffbe0}\n#net{position:fixed;left:0;right:0;top:0;background:var(--red);color:#fff;text-align:center;font-size:13px;padding:4px;z-index:98;display:none}\n\n/* кнопки */\n.btn{padding:13px 18px;border-radius:14px;font-weight:700;font-size:16px;background:var(--card);border:1px solid var(--line);transition:transform .1s}\n.btn:active{transform:scale(.96)}\n.btn.primary{background:linear-gradient(180deg,#ffd84d,#ff9d00);color:#3a2500;border:0;box-shadow:0 6px 18px rgba(255,157,0,.35)}\n.btn.blue{background:linear-gradient(180deg,#5b9bff,#3a6fe0);border:0;box-shadow:0 6px 18px rgba(60,110,230,.35)}\n.btn.green{background:linear-gradient(180deg,#43e08a,#1fae5f);color:#04301a;border:0;box-shadow:0 6px 18px rgba(46,204,113,.3)}\n.btn.red{background:linear-gradient(180deg,#ff7487,#e0364d);border:0}\n.btn.big{width:100%;padding:16px;font-size:17px}\n.btn[disabled]{opacity:.4;pointer-events:none}\n\n/* аватар */\n.av{position:relative;border-radius:50%;display:flex;align-items:center;justify-content:center;flex:none;overflow:hidden;box-shadow:inset 0 0 0 2px rgba(255,255,255,.25),0 3px 10px rgba(0,0,0,.35)}\n.av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}\n.rk{font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;background:rgba(255,201,60,.14);color:var(--gold);white-space:nowrap}\n.coins{display:inline-flex;align-items:center;gap:6px;font-weight:800;background:rgba(255,201,60,.12);border:1px solid rgba(255,201,60,.35);padding:7px 12px;border-radius:30px;color:var(--gold)}\n.coin{display:inline-block;width:1.15em;height:1.15em;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff3b0,#ffc93c 45%,#d98a00);box-shadow:inset 0 0 0 .12em #b36f00;vertical-align:-.2em;position:relative}\n.coin:after{content:\"♠\";position:absolute;inset:0;font-size:.7em;text-align:center;line-height:1.65;color:#9a5d00}\n\n/* главная */\n#head{padding:max(12px,env(safe-area-inset-top)) 14px 8px;display:flex;align-items:center;gap:12px}\n#head .who{flex:1;min-width:0}\n#head .nm{font-weight:800;font-size:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.xp{height:5px;border-radius:5px;background:#26314f;margin-top:5px;overflow:hidden}\n.xp i{display:block;height:100%;background:linear-gradient(90deg,var(--gold),var(--gold2));border-radius:5px}\n#body{flex:1;overflow-y:auto;padding:6px 14px 100px;-webkit-overflow-scrolling:touch}\n#nav{position:fixed;left:0;right:0;bottom:0;display:flex;background:rgba(14,19,32,.94);backdrop-filter:blur(14px);border-top:1px solid var(--line);padding:6px 10px calc(8px + env(safe-area-inset-bottom));gap:6px}\n#nav button{flex:1;padding:8px 0;border-radius:12px;color:var(--mut);font-size:12px;font-weight:600;display:flex;flex-direction:column;align-items:center;gap:2px}\n#nav button b{font-size:22px;filter:grayscale(.6)}\n#nav button.on{color:var(--tx);background:var(--card)}\n#nav button.on b{filter:none}\n.panel{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:14px;margin-bottom:12px}\n.sec{font-size:13px;color:var(--mut);font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin:16px 4px 8px}\n.chips{display:flex;gap:8px;flex-wrap:wrap}\n.chip{flex:1;min-width:58px;padding:11px 0;text-align:center;border-radius:14px;background:#141c33;border:1.5px solid var(--line);font-weight:800;color:var(--mut)}\n.chip.on{border-color:var(--gold);color:var(--gold);background:rgba(255,201,60,.1);box-shadow:0 0 14px rgba(255,201,60,.2)}\n.chip[disabled]{opacity:.35}\n.row2{display:flex;gap:10px;margin-top:12px}\n.row2 .btn{flex:1}\n.trow{display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--card);border:1px solid var(--line);border-radius:16px;margin-bottom:8px}\n.trow .mid{flex:1;min-width:0}\n.trow .nm{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.trow .btn{padding:9px 14px;font-size:14px}\n.stakeTag{font-weight:800;color:var(--gold);display:flex;align-items:center;gap:5px;margin-right:4px}\n.empty{text-align:center;color:var(--mut);padding:22px 10px;font-size:14px}\n.wait{display:flex;align-items:center;gap:12px}\n.spin{width:26px;height:26px;border-radius:50%;border:3px solid var(--line);border-top-color:var(--gold);animation:sp 1s linear infinite;flex:none}\n@keyframes sp{to{transform:rotate(360deg)}}\n.daily{display:flex;align-items:center;gap:12px;background:linear-gradient(90deg,#3b2c08,#2a2210);border:1px solid rgba(255,201,60,.4);border-radius:16px;padding:12px 14px;margin-bottom:12px}\n.daily .tx{flex:1;font-size:14px}.daily b{color:var(--gold)}\n.lb .pl{width:26px;text-align:center;font-weight:800;color:var(--mut)}\n.lb .mine{border-color:var(--gold)}\n.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px;text-align:center}\n.stats div{background:#141c33;border-radius:12px;padding:10px 4px}\n.stats b{display:block;font-size:20px}.stats span{font-size:11px;color:var(--mut)}\n.ranks .trow{padding:8px 12px;margin-bottom:6px;opacity:.55}.ranks .trow.cur{opacity:1;border-color:var(--gold)}\n\n/* обмен */\n#nav button{position:relative}\n.bdg{position:absolute;top:2px;right:18%;min-width:18px;height:18px;border-radius:9px;background:var(--red);color:#fff;font-size:11px;font-weight:800;display:none;align-items:center;justify-content:center;padding:0 5px;font-style:normal}\n.inp{width:100%;padding:14px;border-radius:14px;background:#141c33;border:1.5px solid var(--line);color:var(--tx);font-size:17px;font-weight:700;outline:none}\n.inp:focus{border-color:var(--blue)}\n.lbl{display:block;font-size:12px;color:var(--mut);margin:14px 2px 6px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}\n.achip{flex:1;min-width:58px;padding:10px 0;text-align:center;border-radius:14px;background:#141c33;border:1.5px solid var(--line);font-weight:800;color:var(--mut)}\n.achip:active{border-color:var(--gold);color:var(--gold)}\n.note{font-size:12px;color:var(--mut);margin:10px 2px 0;line-height:1.4}\n.offer{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:12px;margin-bottom:8px}\n.offer.in{border-color:rgba(46,204,113,.55)}\n.offer .top{display:flex;align-items:center;gap:12px}\n.offer .mid{flex:1;min-width:0}\n.offer .nm{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.offer .sub{font-size:12px;color:var(--mut)}\n.offer .amt{font-weight:900;font-size:18px;display:flex;align-items:center;gap:5px}\n.offer .amt.p{color:var(--green)}.offer .amt.o{color:var(--gold)}\n.offer .row2{margin-top:10px}\n.offer .btn{padding:10px 12px;font-size:14px}\n.payb{padding:7px 10px!important;font-size:16px!important}\n/* редактор */\n.ed label{display:block;font-size:12px;color:var(--mut);margin:14px 2px 6px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}\n.ed input[type=text]{width:100%;padding:14px;border-radius:14px;background:#141c33;border:1.5px solid var(--line);color:var(--tx);font-size:17px;font-weight:700;outline:none}\n.ed input[type=text]:focus{border-color:var(--blue)}\n.egrid{display:grid;grid-template-columns:repeat(8,1fr);gap:6px}\n.eb{font-size:22px;padding:6px 0;border-radius:12px;background:#141c33;border:1.5px solid transparent}\n.eb.on{border-color:var(--gold);background:rgba(255,201,60,.12)}\n.cgrid{display:grid;grid-template-columns:repeat(10,1fr);gap:6px}\n.cb{aspect-ratio:1;border-radius:50%;border:2.5px solid transparent}\n.cb.on{border-color:#fff;box-shadow:0 0 0 2px var(--bg),0 0 0 4px var(--gold)}\n.chk{display:flex!important;align-items:center;gap:10px;text-transform:none!important;font-size:14px!important;color:var(--tx)!important}\n.chk input{width:20px;height:20px}\n.center{display:flex;justify-content:center;margin:6px 0}\n#s-setup{padding:max(20px,env(safe-area-inset-top)) 18px 24px;overflow-y:auto}\n#s-setup h1{margin:10px 0 2px;text-align:center;font-size:26px}\n#s-setup p{text-align:center;color:var(--mut);margin:0 0 8px}\n\n/* ===== игровой стол ===== */\n#s-game{background:radial-gradient(90% 60% at 50% 45%,#1f8a58 0%,#126040 55%,#0a3825 100%)}\n.gtop{display:flex;align-items:center;gap:10px;padding:max(10px,env(safe-area-inset-top)) 12px 6px;background:linear-gradient(180deg,rgba(0,0,0,.35),transparent)}\n.gtop .pot{flex:1;text-align:center;font-weight:800;font-size:14px}\n.gtop .pot small{display:block;color:#a8e8c8;font-weight:600;font-size:11px}\n.iconbtn{width:38px;height:38px;border-radius:12px;background:rgba(0,0,0,.3);font-size:18px}\n.tbar{height:5px;margin:0 12px;border-radius:5px;background:rgba(0,0,0,.35);overflow:hidden}\n.tbar i{display:block;height:100%;width:100%;background:var(--gold);border-radius:5px;transition:width .2s linear}\n.tbar.low i{background:var(--red)}\n.opp{display:flex;align-items:center;gap:10px;padding:8px 14px}\n.opp .nm{font-weight:800;font-size:15px}\n.fan{display:flex;margin-left:auto;align-items:center}\n.fan .card{margin-left:-30px;transform:scale(.62);transform-origin:right center}\n.fan .card:first-child{margin-left:0}\n.cnt{background:rgba(0,0,0,.45);border-radius:20px;padding:3px 9px;font-weight:800;font-size:13px;margin-left:-4px;z-index:2}\n.felt{flex:1;position:relative;display:flex;align-items:center;justify-content:center;min-height:0}\n.tbl{display:grid;grid-template-columns:repeat(3,auto);gap:14px 12px;justify-content:center;padding:0 10px 0 56px}\n.pair{position:relative;width:70px;height:96px}\n.pair .card{position:absolute}\n.pair .a{left:0;top:0}\n.pair .d{left:15px;top:14px;transform:rotate(9deg)}\n.pair.tgt{animation:pulse .9s infinite}\n.pair.tgt:after{content:\"\";position:absolute;inset:-6px;border:2.5px dashed var(--gold);border-radius:12px}\n@keyframes pulse{50%{transform:scale(1.06)}}\n.deckbox{position:absolute;left:12px;top:50%;transform:translateY(-50%);width:50px;height:96px}\n.deckbox .trumpc{position:absolute;left:14px;top:30px;transform:rotate(90deg) scale(.8);transform-origin:center}\n.deckbox .back{position:absolute;left:0;top:10px;transform:scale(.8);transform-origin:top left}\n.deckbox .dn{position:absolute;left:0;right:0;top:-8px;text-align:center;font-size:11px;font-weight:800;background:rgba(0,0,0,.45);border-radius:8px;padding:2px 0;z-index:3}\n.trumpTag{position:absolute;left:8px;top:calc(50% + 58px);font-size:12px;font-weight:800;background:rgba(0,0,0,.4);padding:3px 8px;border-radius:10px}\n.hint{text-align:center;font-weight:700;font-size:14px;padding:4px 12px;min-height:26px;text-shadow:0 1px 3px rgba(0,0,0,.5)}\n.acts{display:flex;justify-content:center;gap:10px;padding:2px 14px 6px;min-height:50px}\n.acts .btn{padding:11px 30px}\n.me{display:flex;align-items:center;gap:8px;padding:0 14px;font-size:13px;font-weight:700}\n.hand{display:flex;overflow-x:auto;padding:16px 12px calc(10px + env(safe-area-inset-bottom));-webkit-overflow-scrolling:touch;min-height:132px;align-items:flex-end}\n.hand:before,.hand:after{content:\"\";margin:auto}\n.hand .card{flex:none;margin-left:-18px;transition:transform .15s,opacity .2s,filter .2s}\n.hand .card:first-of-type{margin-left:0}\n.hand .card.dim{filter:brightness(.62) saturate(.7)}\n.hand .card.ok{transform:translateY(-8px)}\n.hand .card.sel{transform:translateY(-22px) scale(1.06);box-shadow:0 0 0 3px var(--gold),0 10px 20px rgba(0,0,0,.5);z-index:5}\n.hand .card.shake{animation:shake .35s}\n@keyframes shake{25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}\n\n/* карты */\n.card{position:relative;width:62px;height:90px;border-radius:9px;background:linear-gradient(160deg,#fff,#eceff5);color:#1b2233;box-shadow:0 2px 6px rgba(0,0,0,.4),inset 0 0 0 1px rgba(0,0,0,.08);flex:none}\n.card.red{color:#e0283e}\n.card .cr{position:absolute;left:5px;top:3px;font-weight:800;font-size:15px;line-height:1}\n.card .cr span{display:block;font-size:14px;margin-top:1px}\n.card .cr.b{left:auto;top:auto;right:5px;bottom:3px;transform:rotate(180deg)}\n.card .cm{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:34px;opacity:.9}\n.card.trump{box-shadow:0 2px 6px rgba(0,0,0,.4),inset 0 0 0 2px var(--gold)}\n.card.back{background:repeating-linear-gradient(45deg,#2b4fd8 0 6px,#1d3aa8 6px 12px);box-shadow:0 2px 6px rgba(0,0,0,.4),inset 0 0 0 3px #fff}\n.card.pop{animation:pop .3s cubic-bezier(.2,1.4,.4,1)}\n.card.deal{animation:deal .4s ease-out}\n@keyframes pop{from{transform:translateY(60px) scale(.6);opacity:0}}\n.pair .d.pop{animation:popd .3s cubic-bezier(.2,1.4,.4,1)}\n@keyframes popd{from{transform:translateY(40px) rotate(9deg) scale(.6);opacity:0}}\n@keyframes deal{from{transform:translateY(-120px) scale(.7);opacity:0}}\n\n/* результат */\n#modal{position:absolute;inset:0;background:rgba(5,8,18,.78);display:none;align-items:center;justify-content:center;z-index:20;padding:24px;backdrop-filter:blur(4px)}\n#modal.show{display:flex}\n.res{width:100%;max-width:340px;background:linear-gradient(180deg,#25315a,#161e38);border:1px solid var(--line);border-radius:24px;padding:26px 20px;text-align:center;animation:pop .4s}\n.res .big{font-size:60px}\n.res h2{margin:6px 0 2px;font-size:28px}\n.res .dl{font-size:30px;font-weight:900;margin:12px 0 2px}\n.res .dl.p{color:var(--green)}.res .dl.n{color:var(--red)}\n.res .sub{color:var(--mut);font-size:14px;margin-bottom:16px}\n.fall{position:absolute;top:-40px;font-size:26px;animation:fall linear forwards;z-index:25;pointer-events:none}\n@keyframes fall{to{transform:translateY(110vh) rotate(540deg)}}\n@media (max-height:700px){.card{width:56px;height:80px}.pair{width:64px;height:86px}.hand{min-height:112px}.card .cm{font-size:30px}}\n</style>\n</head>\n<body>\n<div id=\"net\">Нет связи… переподключаемся</div>\n<div id=\"toast\"></div>\n<div id=\"splash\"><div class=\"logo\">🃏</div><div id=\"splashTx\">Загрузка…</div></div>\n\n<section class=\"screen\" id=\"s-setup\"></section>\n\n<section class=\"screen\" id=\"s-home\">\n  <div id=\"head\"></div>\n  <div id=\"body\"></div>\n  <div id=\"nav\">\n    <button data-tab=\"play\"><b>🎴</b>Играть</button>\n    <button data-tab=\"top\"><b>🏆</b>Рейтинг</button>\n    <button data-tab=\"trade\"><b>💸</b>Обмен<i class=\"bdg\" id=\"bdg\"></i></button>\n    <button data-tab=\"me\"><b>👤</b>Профиль</button>\n  </div>\n</section>\n\n<section class=\"screen\" id=\"s-game\">\n  <div class=\"gtop\">\n    <button class=\"iconbtn\" id=\"gResign\" title=\"Сдаться\">🏳️</button>\n    <div class=\"pot\"><span id=\"gPot\"></span><small id=\"gTurn\"></small></div>\n    <div class=\"iconbtn\" style=\"display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800\" id=\"gSec\"></div>\n  </div>\n  <div class=\"tbar\" id=\"tbar\"><i></i></div>\n  <div class=\"opp\" id=\"gOpp\"></div>\n  <div class=\"felt\" id=\"gFelt\"></div>\n  <div class=\"hint\" id=\"gHint\"></div>\n  <div class=\"acts\" id=\"gActs\"></div>\n  <div class=\"me\" id=\"gMe\"></div>\n  <div class=\"hand\" id=\"gHand\"></div>\n  <div id=\"modal\"></div>\n</section>\n\n<script>\n(()=>{\n'use strict';\nconst tg=window.Telegram&&window.Telegram.WebApp;\nif(tg){try{tg.ready();tg.expand();tg.setHeaderColor('#0e1320');tg.setBackgroundColor('#0e1320');tg.disableVerticalSwipes&&tg.disableVerticalSwipes();}catch(e){}}\nconst $=s=>document.querySelector(s);\nconst esc=s=>String(s).replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]));\nconst SUIT={S:'♠',H:'♥',D:'♦',C:'♣'};\nconst RN=r=>({11:'J',12:'Q',13:'K',14:'A'}[r]||r);\nconst fmt=n=>String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g,' ');\nconst GR=[['#ff9a3c','#ff5e62'],['#36d1dc','#5b86e5'],['#a8e063','#56ab2f'],['#f7797d','#c471ed'],['#fbd786','#f7797d'],['#43cea2','#185a9d'],['#f093fb','#f5576c'],['#667eea','#764ba2'],['#f2994a','#f2c94c'],['#7f7fd5','#86a8e7']];\nconst hap=(t='light')=>{try{tg&&tg.HapticFeedback&&tg.HapticFeedback.impactOccurred(t)}catch(e){}};\nconst hapN=t=>{try{tg&&tg.HapticFeedback&&tg.HapticFeedback.notificationOccurred(t)}catch(e){}};\n\nconst S={snap:null,tab:'play',stake:100,token:null,es:null,shown:'',built:'',E:null,sel:null,seen:null,gid:null,deadlineAt:0,lb:null,closing:false,celebrated:null,tradeTo:null,found:[],knownIn:null,qt:null};\nlet guest=localStorage.getItem('gid');if(!guest){guest=Array.from(crypto.getRandomValues(new Uint8Array(12))).map(b=>b.toString(16).padStart(2,'0')).join('');localStorage.setItem('gid',guest)}\n\n/* ---------- сеть ---------- */\nasync function post(path,body){\n  const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});\n  let j={};try{j=await r.json()}catch(e){}\n  j._status=r.status;return j;\n}\nasync function login(){\n  const r=await post('/api/auth',{initData:tg?tg.initData:'',guestId:guest});\n  if(r.token){S.token=r.token;return true}\n  $('#splashTx').textContent=r.error||'Ошибка входа';return false;\n}\nfunction connect(){\n  if(S.es){S.es.close();S.es=null}\n  const es=new EventSource('/api/events?token='+S.token);S.es=es;\n  es.onopen=()=>{$('#net').style.display='none'};\n  es.onmessage=e=>{try{S.snap=JSON.parse(e.data)}catch(_){return}$('#net').style.display='none';render()};\n  es.onerror=()=>{\n    $('#net').style.display='block';es.close();if(S.es===es)S.es=null;\n    setTimeout(async()=>{if(S.es)return;if(await login())connect();else setTimeout(()=>location.reload(),4000)},1500);\n  };\n}\nasync function act(type,data={}){\n  let r=await post('/api/action',{token:S.token,type,...data});\n  if(r._status===401){if(await login()){connect();r=await post('/api/action',{token:S.token,type,...data})}}\n  if(r.error){toast(r.error);hapN('error')}\n  return r;\n}\nlet tt;function toast(m,ok){const t=$('#toast');t.textContent=m;t.className='show'+(ok?' ok':'');clearTimeout(tt);tt=setTimeout(()=>t.className='',2400)}\n\n/* ---------- общие куски ---------- */\nfunction av(p,sz=40){\n  const g=GR[p.color%GR.length];\n  return `<div class=\"av\" style=\"width:${sz}px;height:${sz}px;font-size:${Math.round(sz*.52)}px;background:linear-gradient(135deg,${g[0]},${g[1]})\"><span>${p.emoji}</span>${p.photo?`<img src=\"${esc(p.photo)}\" referrerpolicy=\"no-referrer\" onerror=\"this.remove()\">`:''}</div>`;\n}\nconst rk=r=>`<span class=\"rk\">${r.icon} ${esc(r.name)}</span>`;\nconst coin='<i class=\"coin\"></i>';\nfunction showScreen(n){\n  if(S.shown===n)return;S.shown=n;\n  for(const id of ['setup','home','game'])$('#s-'+id).classList.toggle('active',id===n);\n  $('#splash').style.display='none';\n  if(tg){try{n==='game'?tg.enableClosingConfirmation():tg.disableClosingConfirmation()}catch(e){}}\n}\nfunction hms(ms){const m=Math.ceil(ms/60000);return m>=60?Math.floor(m/60)+' ч '+(m%60)+' мин':m+' мин'}\n\n/* ---------- редактор профиля ---------- */\nfunction prevP(){const m=S.snap.me,E=S.E;return{emoji:E.emoji,color:E.color,photo:E.usePhoto?m.photoUrl:null}}\nfunction editorHTML(first){\n  const m=S.snap.me,E=S.E,cfg=S.snap.cfg;\n  return `<div class=\"ed\">\n  <div class=\"center\" id=\"edprev\">${av(prevP(),92)}</div>\n  <label>Имя</label><input type=\"text\" id=\"edname\" maxlength=\"16\" value=\"${esc(E.name)}\" placeholder=\"Как вас зовут?\" autocomplete=\"off\">\n  <label>Аватар</label><div class=\"egrid\">${cfg.emojis.map(e=>`<button class=\"eb ${e===E.emoji?'on':''}\" data-e=\"${e}\">${e}</button>`).join('')}</div>\n  <label>Цвет</label><div class=\"cgrid\">${GR.map((g,i)=>`<button class=\"cb ${i===E.color?'on':''}\" data-c=\"${i}\" style=\"background:linear-gradient(135deg,${g[0]},${g[1]})\"></button>`).join('')}</div>\n  ${m.hasPhoto?`<label class=\"chk\"><input type=\"checkbox\" id=\"edphoto\" ${E.usePhoto?'checked':''}> Использовать моё фото из Telegram</label>`:''}\n  <div style=\"height:18px\"></div>\n  <button class=\"btn primary big\" id=\"edsave\">${first?'Начать игру 🎴':'Сохранить'}</button></div>`;\n}\nfunction bindEditor(root,first){\n  const upd=()=>{root.querySelector('#edprev').innerHTML=av(prevP(),92)};\n  root.onclick=async e=>{\n    const eb=e.target.closest('.eb'),cb=e.target.closest('.cb');\n    if(eb){S.E.emoji=eb.dataset.e;root.querySelectorAll('.eb').forEach(b=>b.classList.toggle('on',b===eb));upd();hap()}\n    else if(cb){S.E.color=+cb.dataset.c;root.querySelectorAll('.cb').forEach(b=>b.classList.toggle('on',b===cb));upd();hap()}\n    else if(e.target.closest('#edsave')){\n      const r=await act('profile',{name:S.E.name,emoji:S.E.emoji,color:S.E.color,usePhoto:S.E.usePhoto});\n      if(r.ok){hapN('success');if(!first)toast('Сохранено ✅',true)}\n    }\n  };\n  root.oninput=e=>{if(e.target.id==='edname')S.E.name=e.target.value};\n  root.onchange=e=>{if(e.target.id==='edphoto'){S.E.usePhoto=e.target.checked;upd()}};\n}\nfunction initE(){const m=S.snap.me;S.E={name:m.name,emoji:m.emoji,color:m.color,usePhoto:m.usePhoto||(!m.ready&&m.hasPhoto)}}\n\n/* ---------- главная ---------- */\nfunction renderHead(){\n  const m=S.snap.me,r=m.rank;\n  const pct=r.to?Math.min(100,Math.round((m.rating-r.from)/(r.to-r.from)*100)):100;\n  $('#head').innerHTML=`<div id=\"hav\">${av(m,50)}</div>\n  <div class=\"who\"><div class=\"nm\">${esc(m.name)}</div><div style=\"display:flex;gap:8px;align-items:center;margin-top:2px\">${rk(r)}<span style=\"font-size:11px;color:var(--mut)\">⭐ ${m.rating}${r.to?' / '+r.to:''}</span></div><div class=\"xp\"><i style=\"width:${pct}%\"></i></div></div>\n  <div class=\"coins\">${coin}<span>${fmt(m.coins)}</span></div>`;\n  $('#hav').onclick=()=>setTab('me');\n  const n=(S.snap.offers||[]).filter(o=>o.dir==='in').length,b=$('#bdg');\n  b.textContent=n;b.style.display=n?'flex':'none';\n}\nfunction setTab(t){S.tab=t;S.built='';renderHome();if(t==='top')loadLB()}\nasync function loadLB(){\n  try{const r=await fetch('/api/leaderboard?token='+S.token);if(r.ok){S.lb=(await r.json()).top;if(S.tab==='top')renderHome()}}catch(e){}\n}\nfunction renderHome(){\n  const s=S.snap,m=s.me;renderHead();\n  document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('on',b.dataset.tab===S.tab));\n  const body=$('#body');\n  if(S.tab==='me'){\n    if(S.built==='me')return;S.built='me';initE();\n    const g=m.wins+m.losses,wr=g?Math.round(m.wins/g*100):0;\n    body.innerHTML=`<div class=\"panel\"><div class=\"stats\"><div><b>${m.wins}</b><span>Побед</span></div><div><b>${m.losses}</b><span>Поражений</span></div><div><b>${wr}%</b><span>Винрейт</span></div></div></div>\n    <div class=\"sec\">Профиль</div><div class=\"panel\" id=\"edbox\">${editorHTML(false)}</div>\n    <div class=\"sec\">Звания</div><div class=\"ranks\">${s.cfg.ranks.map((r,i)=>`<div class=\"trow ${i===m.rank.idx?'cur':''}\"><span style=\"font-size:22px\">${r.icon}</span><div class=\"mid\"><b>${r.name}</b></div><span style=\"color:var(--mut);font-size:13px\">от ${r.min} ⭐</span></div>`).join('')}</div>\n    <div class=\"empty\" style=\"font-size:12px\">За победу +25 ⭐, за поражение −15 ⭐</div>`;\n    bindEditor($('#edbox'),false);\n    return;\n  }\n  if(S.tab==='trade'){\n    if(S.built!=='trade'){\n      S.built='trade';\n      body.innerHTML=`<div class=\"sec\" style=\"margin-top:4px\">Отправить монеты</div>\n      <div class=\"panel\"><div id=\"tsel\"></div>\n      <input class=\"inp\" id=\"tq\" type=\"text\" maxlength=\"16\" placeholder=\"🔍 Найти игрока по имени\" autocomplete=\"off\">\n      <div id=\"tres\" style=\"margin-top:8px\"></div>\n      <label class=\"lbl\">Сумма</label>\n      <input class=\"inp\" id=\"tamt\" type=\"text\" inputmode=\"numeric\" maxlength=\"7\" placeholder=\"Сколько монет?\" autocomplete=\"off\">\n      <div class=\"chips\" style=\"margin-top:8px\">${[50,100,250,500].map(x=>`<button class=\"achip\" data-amt=\"${x}\">${x}</button>`).join('')}</div>\n      <button class=\"btn primary big\" id=\"tSend\" style=\"margin-top:14px\">Отправить 💸</button>\n      <div class=\"note\">Получатель должен принять перевод. Если не примет за 48 часов — монеты вернутся к вам. Минимум ${s.cfg.minSend} монет. Это игровая валюта, вывод невозможен.</div></div>\n      <div class=\"sec\">Предложения</div><div id=\"toffers\"></div>`;\n    }\n    updateTrade();return;\n  }\n  S.built=S.tab;\n  if(S.tab==='top'){\n    body.innerHTML=`<div class=\"sec\">Лучшие игроки</div><div class=\"lb\">`+(S.lb?S.lb.map((u,i)=>`<div class=\"trow ${u.me?'mine':''}\"><div class=\"pl\">${i<3?['🥇','🥈','🥉'][i]:i+1}</div>${av(u,40)}<div class=\"mid\"><div class=\"nm\">${esc(u.name)}</div>${rk(u.rank)}</div><div style=\"text-align:right\"><b>⭐ ${u.rating}</b><div style=\"font-size:11px;color:var(--mut)\">${u.wins} поб.</div></div>${u.me?'':`<button class=\"btn payb\" data-pay=\"${i}\">💸</button>`}</div>`).join('')||'<div class=\"empty\">Пока никого нет</div>':'<div class=\"empty\">Загрузка…</div>')+'</div>';\n    return;\n  }\n  /* вкладка «Играть» */\n  const st=s.cfg.stakes;if(!st.includes(S.stake)||S.stake>m.coins){S.stake=[...st].reverse().find(x=>x<=m.coins&&x<=S.stake)||st[0]}\n  let h='';\n  if(m.daily<=0)h+=`<div class=\"daily\"><span style=\"font-size:30px\">🎁</span><div class=\"tx\"><b>Бонус готов!</b><br>Забери +${m.dailyAmount} монет</div><button class=\"btn primary\" id=\"bDaily\" style=\"padding:10px 16px\">Забрать</button></div>`;\n  else if(m.coins<st[0])h+=`<div class=\"daily\"><span style=\"font-size:30px\">💸</span><div class=\"tx\">Монеты почти закончились. Бонус через <b>${hms(m.daily)}</b></div></div>`;\n  if(s.myTable){\n    const t=s.tables.find(x=>x.id===s.myTable);\n    h+=`<div class=\"panel wait\"><div class=\"spin\"></div><div style=\"flex:1\"><b>Ищем соперника…</b><div style=\"color:var(--mut);font-size:13px\">Ставка ${t?t.stake:''} монет</div></div><button class=\"btn\" id=\"bCancel\" style=\"padding:10px 14px\">Отмена</button></div>`;\n  }else{\n    h+=`<div class=\"sec\" style=\"margin-top:4px\">Ставка</div><div class=\"chips\">${st.map(x=>`<button class=\"chip ${x===S.stake?'on':''}\" data-st=\"${x}\" ${x>m.coins?'disabled':''}>${x}</button>`).join('')}</div>\n    <div class=\"row2\"><button class=\"btn primary\" id=\"bQuick\" ${m.coins<st[0]?'disabled':''}>⚡ Быстрая игра</button><button class=\"btn blue\" id=\"bCreate\" ${m.coins<S.stake?'disabled':''}>➕ Создать стол</button></div>\n    <div style=\"font-size:12px;color:var(--mut);margin:8px 4px\">Победитель забирает банк, комиссия стола ${Math.round(s.cfg.fee*100)}%</div>`;\n  }\n  const others=s.tables.filter(t=>!t.mine);\n  h+=`<div class=\"sec\">Открытые столы · 👥 ${s.online} онлайн</div>`+(others.length?others.map(t=>`<div class=\"trow\">${av(t.owner,42)}<div class=\"mid\"><div class=\"nm\">${esc(t.owner.name)}</div>${rk(t.owner.rank)}</div><div class=\"stakeTag\">${coin}${t.stake}</div><button class=\"btn green\" data-join=\"${t.id}\" ${m.coins<t.stake||s.myTable?'disabled':''}>Играть</button></div>`).join(''):'<div class=\"empty\">Свободных столов нет.<br>Создайте свой — кто-нибудь присоединится!</div>');\n  body.innerHTML=h;\n}\nfunction updateTrade(){\n  const s=S.snap,sel=$('#tsel');if(!sel)return;\n  sel.innerHTML=S.tradeTo?`<div class=\"trow\" style=\"border-color:var(--gold)\">${av(S.tradeTo,42)}<div class=\"mid\"><div class=\"nm\">${esc(S.tradeTo.name)}</div>${rk(S.tradeTo.rank)}</div><button class=\"btn\" data-clear=\"1\">✕</button></div>`:'';\n  $('#tq').style.display=S.tradeTo?'none':'';\n  $('#tres').innerHTML=S.tradeTo?'':S.found.map((u,i)=>`<div class=\"trow\" data-pick=\"${i}\" style=\"cursor:pointer\">${av(u,38)}<div class=\"mid\"><div class=\"nm\">${esc(u.name)}</div>${rk(u.rank)}</div><span style=\"color:var(--mut)\">Выбрать ›</span></div>`).join('');\n  const of=[...(s.offers||[])].sort((a,b)=>(a.dir==='in'?0:1)-(b.dir==='in'?0:1));\n  $('#toffers').innerHTML=of.length?of.map(o=>o.dir==='in'\n    ?`<div class=\"offer in\"><div class=\"top\">${av(o.user,42)}<div class=\"mid\"><div class=\"nm\">${esc(o.user.name)}</div><div class=\"sub\">отправил(а) вам монеты · ${hms(o.left)}</div></div><div class=\"amt p\">+${fmt(o.amount)} ${coin}</div></div><div class=\"row2\"><button class=\"btn green\" data-offer=\"${o.id}\" data-how=\"accept\">Принять</button><button class=\"btn\" data-offer=\"${o.id}\" data-how=\"decline\">Отклонить</button></div></div>`\n    :`<div class=\"offer\"><div class=\"top\">${av(o.user,42)}<div class=\"mid\"><div class=\"nm\">${esc(o.user.name)}</div><div class=\"sub\">ждёт ответа · ${hms(o.left)}</div></div><div class=\"amt o\">−${fmt(o.amount)} ${coin}</div></div><div class=\"row2\"><button class=\"btn\" data-offer=\"${o.id}\" data-how=\"withdraw\">Отозвать</button></div></div>`).join('')\n    :'<div class=\"empty\">Пока нет предложений</div>';\n}\nfunction pickPlayer(u){S.tradeTo=u;S.found=[];S.built='';renderHome();setTimeout(()=>{const a=$('#tamt');a&&a.focus()},50)}\n$('#nav').onclick=e=>{const b=e.target.closest('button');if(b){hap();setTab(b.dataset.tab)}};\n$('#body').oninput=e=>{\n  if(e.target.id==='tamt'){e.target.value=e.target.value.replace(/\\D/g,'');return}\n  if(e.target.id==='tq'){\n    clearTimeout(S.qt);const q=e.target.value.trim();\n    if(q.length<2){S.found=[];updateTrade();return}\n    S.qt=setTimeout(async()=>{\n      try{const r=await fetch('/api/find?token='+S.token+'&q='+encodeURIComponent(q));if(r.ok){S.found=(await r.json()).list||[];updateTrade()}}catch(_){}\n    },300);\n  }\n};\n$('#body').onclick=async e=>{\n  const pay=e.target.closest('[data-pay]');\n  if(pay){const u=S.lb[+pay.dataset.pay];if(u){hap();S.tab='trade';pickPlayer(u)}return}\n  const pk=e.target.closest('[data-pick]');\n  if(pk){const u=S.found[+pk.dataset.pick];if(u){hap();pickPlayer(u)}return}\n  if(e.target.closest('[data-clear]')){S.tradeTo=null;S.built='';renderHome();setTimeout(()=>{const q=$('#tq');q&&q.focus()},50);return}\n  const am=e.target.closest('[data-amt]');\n  if(am){$('#tamt').value=am.dataset.amt;hap();return}\n  if(e.target.closest('#tSend')){\n    if(!S.tradeTo)return toast('Сначала выберите получателя');\n    const amount=parseInt($('#tamt').value,10)||0;\n    if(amount<S.snap.cfg.minSend)return toast('Минимум '+S.snap.cfg.minSend+' монет');\n    const r=await act('send',{to:S.tradeTo.id,amount});\n    if(r.ok){hapN('success');toast('Отправлено ✅ Ждём ответа игрока',true);$('#tamt').value='';S.tradeTo=null;S.built='';renderHome()}\n    return;\n  }\n  const of=e.target.closest('[data-offer]');\n  if(of){\n    const how=of.dataset.how,r=await act(how,{offer:of.dataset.offer});\n    if(r.ok){hapN('success');toast(how==='accept'?'Монеты получены 💰':how==='decline'?'Отклонено, монеты вернулись отправителю':'Отозвано, монеты вернулись к вам',true)}\n    return;\n  }\n  const c=e.target.closest('.chip');\n  if(c&&!c.disabled){S.stake=+c.dataset.st;hap();renderHome();return}\n  if(e.target.closest('#bDaily')){const r=await act('daily');if(r.ok){hapN('success');toast('+200 монет 🎁',true)}return}\n  if(e.target.closest('#bQuick')){hap('medium');act('quick',{stake:S.stake});return}\n  if(e.target.closest('#bCreate')){hap();act('create',{stake:S.stake});return}\n  if(e.target.closest('#bCancel')){act('cancel');return}\n  const j=e.target.closest('[data-join]');if(j&&!j.disabled){hap('medium');act('join',{table:j.dataset.join})}\n};\nsetInterval(()=>{if(S.shown==='home'&&S.tab==='top')loadLB()},20000);\n\n/* ---------- игровой стол ---------- */\nfunction cardHTML(c,cls='',extra=''){\n  const red=c.s==='H'||c.s==='D',id=c.s+c.r;\n  return `<div class=\"card ${red?'red':''} ${c.s===S.g.trump?'trump':''} ${cls}\" data-id=\"${id}\" ${extra}><div class=\"cr\">${RN(c.r)}<span>${SUIT[c.s]}</span></div><div class=\"cm\">${SUIT[c.s]}</div><div class=\"cr b\">${RN(c.r)}<span>${SUIT[c.s]}</span></div></div>`;\n}\nconst beats=(d,a,t)=>d.s===a.s?d.r>a.r:(d.s===t&&a.s!==t);\nfunction ranksOn(g){const s=new Set();g.table.forEach(p=>{s.add(p.a.r);if(p.d)s.add(p.d.r)});return s}\nfunction playable(g,c){\n  if(g.over)return false;\n  if(g.iAttack){if(!g.table.length)return g.phase==='attack';return g.table.length<g.limit&&ranksOn(g).has(c.r)}\n  if(g.phase!=='attack')return false;\n  return g.table.some(p=>!p.d&&beats(c,p.a,g.trump));\n}\nfunction hint(g){\n  if(g.over)return '';\n  const un=g.table.some(p=>!p.d),all=g.table.length&&!un;\n  if(g.iAttack){\n    if(g.phase==='take')return '😈 Соперник берёт — можно подкинуть ещё';\n    if(!g.table.length)return '⚔️ Ваш ход — выберите карту для атаки';\n    if(un)return '⏳ Соперник отбивается…';\n    return '✅ Отбито! Подкиньте или нажмите «Бито»';\n  }\n  if(g.phase==='take')return '📥 Вы берёте карты…';\n  if(un)return S.sel?'👆 Выберите, какую карту бить':'🛡️ Отбейте карты или возьмите';\n  return '⏳ Соперник думает…';\n}\nfunction renderGame(keep){\n  const g=S.snap.game,m=S.snap.me;S.g=g;\n  if(!keep){\n    S.sel=null;S.deadlineAt=Date.now()+g.left;\n    if(S.gid!==g.id){S.gid=g.id;S.seen=new Set();S.celebrated=null}\n  }\n  const seen=S.seen,now=new Set();\n  $('#gPot').innerHTML=`${coin} ${fmt(g.stake*2)} <span style=\"font-weight:600;color:#a8e8c8\">банк</span>`;\n  $('#gTurn').textContent=g.over?'Игра окончена':g.turn?'Ваш ход':'Ход соперника';\n  $('#gOpp').innerHTML=`${av(g.opp,40)}<div><div class=\"nm\">${esc(g.opp.name)}</div>${rk(g.opp.rank)}</div><div class=\"fan\">${Array.from({length:Math.min(g.oppCount,9)},()=>'<div class=\"card back\"></div>').join('')}<span class=\"cnt\">${g.oppCount}</span></div>`;\n  /* стол */\n  const sc=S.sel?g.hand.find(c=>c.s+c.r===S.sel):null;\n  let tb='';\n  g.table.forEach((p,i)=>{\n    const ida=p.a.s+p.a.r,idd=p.d?p.d.s+p.d.r:'';now.add(ida);if(idd)now.add(idd);\n    const tgt=sc&&!p.d&&beats(sc,p.a,g.trump);\n    tb+=`<div class=\"pair ${tgt?'tgt':''}\" data-i=\"${i}\">${cardHTML(p.a,'a '+(seen.has(ida)?'':'pop'))}${p.d?cardHTML(p.d,'d '+(seen.has(idd)?'':'pop')):''}</div>`;\n  });\n  const tc=g.trumpCard;\n  const deckH=g.deck>0?`<div class=\"deckbox\"><div class=\"dn\">${g.deck}</div>${cardHTML(tc,'trumpc')}<div class=\"card back\"></div></div>`:'';\n  $('#gFelt').innerHTML=deckH+`<div class=\"trumpTag\" style=\"${g.trump==='H'||g.trump==='D'?'color:#ff8a98':''}\">Козырь ${SUIT[g.trump]}</div><div class=\"tbl\">${tb}</div>`;\n  /* кнопки */\n  const un=g.table.some(p=>!p.d),all=g.table.length&&!un;let a='';\n  if(!g.over){\n    if(!g.iAttack&&g.phase==='attack'&&un)a=`<button class=\"btn red\" id=\"aTake\">Беру</button>`;\n    else if(g.iAttack&&(g.phase==='take'||all))a=`<button class=\"btn green\" id=\"aDone\">${g.phase==='take'?'Готово':'Бито'}</button>`;\n  }\n  $('#gActs').innerHTML=a;\n  $('#gHint').textContent=hint(g);\n  $('#gMe').innerHTML=`${av(m,26)}<span>${esc(m.name)}</span>${rk(m.rank)}<span style=\"margin-left:auto;font-size:12px;color:#a8e8c8\">${g.iAttack?'⚔️ атакуете':'🛡️ защищаетесь'}</span>`;\n  /* рука */\n  $('#gHand').innerHTML=g.hand.map(c=>{\n    const id=c.s+c.r;now.add(id);const ok=playable(g,c);\n    return cardHTML(c,(ok?'ok':'dim')+(S.sel===id?' sel':'')+(seen.has(id)?'':' deal'));\n  }).join('');\n  S.seen=now;\n  /* результат */\n  const mod=$('#modal');\n  if(g.over&&g.result){\n    const r=g.result,w=r.res==='win';\n    mod.innerHTML=`<div class=\"res\"><div class=\"big\">${w?'🏆':r.res==='draw'?'🤝':'😔'}</div><h2>${w?'Победа!':r.res==='draw'?'Ничья':'Поражение'}</h2>\n    <div class=\"dl ${r.coins>0?'p':r.coins<0?'n':''}\">${r.coins>0?'+':''}${fmt(r.coins)} ${coin}</div>\n    <div class=\"sub\">${r.rating?(r.rating>0?'+':'')+r.rating+' ⭐ рейтинг':'Рейтинг не изменился'}${r.reason==='timeout'?'<br>'+(w?'Соперник не успел сходить':'Вы не успели сходить'):''}${r.reason==='resign'?'<br>'+(w?'Соперник сдался':'Вы сдались'):''}</div>\n    <button class=\"btn primary big\" id=\"rAgain\">Играть ещё</button><div style=\"height:8px\"></div><button class=\"btn big\" id=\"rMenu\">В меню</button></div>`;\n    mod.classList.add('show');\n    if(w&&S.celebrated!==g.id){S.celebrated=g.id;hapN('success');confetti()}\n    else if(!w&&S.celebrated!==g.id){S.celebrated=g.id;hapN('warning')}\n  }else mod.classList.remove('show');\n  tick();\n}\nfunction confetti(){\n  const root=$('#s-game');\n  for(let i=0;i<28;i++){\n    const d=document.createElement('div');d.className='fall';d.textContent=['🪙','✨','🎉','♠️','♥️'][i%5];\n    d.style.left=Math.random()*100+'%';d.style.animationDuration=(1.6+Math.random()*1.6)+'s';d.style.animationDelay=Math.random()*.5+'s';\n    root.appendChild(d);setTimeout(()=>d.remove(),4000);\n  }\n}\nfunction tick(){\n  const g=S.snap&&S.snap.game;if(S.shown!=='game'||!g)return;\n  if(g.over){$('#gSec').textContent='';$('#tbar i').style.width='0%';return}\n  const left=Math.max(0,S.deadlineAt-Date.now()),tot=S.snap.cfg.turn;\n  $('#tbar i').style.width=(left/tot*100)+'%';\n  $('#tbar').classList.toggle('low',left<10000);\n  $('#gSec').textContent=Math.ceil(left/1000);\n}\nsetInterval(tick,200);\n\n$('#gHand').onclick=async e=>{\n  const el=e.target.closest('.card');if(!el)return;\n  const g=S.snap.game;if(!g||g.over)return;\n  const id=el.dataset.id,c=g.hand.find(x=>x.s+x.r===id);if(!c)return;\n  const bad=m=>{el.classList.remove('shake');void el.offsetWidth;el.classList.add('shake');hapN('error');toast(m)};\n  if(g.iAttack){\n    if(!playable(g,c))return bad(g.table.length?(g.table.length>=g.limit?'Больше подкинуть нельзя':'Подкинуть можно карту того же достоинства, что на столе'):'Сейчас нельзя атаковать');\n    hap();act('attack',{card:id});return;\n  }\n  if(g.phase!=='attack'||!g.table.some(p=>!p.d))return bad('Сейчас нечем отбиваться');\n  const tg2=[];g.table.forEach((p,i)=>{if(!p.d&&beats(c,p.a,g.trump))tg2.push(i)});\n  if(!tg2.length)return bad('Эта карта не бьёт');\n  if(tg2.length===1){hap();act('defend',{card:id,idx:tg2[0]});return}\n  S.sel=S.sel===id?null:id;hap();renderGame(true);\n};\n$('#gFelt').onclick=e=>{\n  const pr=e.target.closest('.pair.tgt');if(!pr||!S.sel)return;\n  hap();const card=S.sel;S.sel=null;act('defend',{card,idx:+pr.dataset.i});\n};\n$('#gActs').onclick=e=>{\n  if(e.target.closest('#aTake')){hap('medium');act('take')}\n  if(e.target.closest('#aDone')){hap('medium');act('done')}\n};\n$('#gResign').onclick=()=>{\n  const g=S.snap.game;if(!g||g.over)return;\n  const go=()=>act('resign');\n  if(tg&&tg.showConfirm)tg.showConfirm('Сдаться? Ставка достанется сопернику.',ok=>ok&&go());else if(confirm('Сдаться? Ставка достанется сопернику.'))go();\n};\n$('#modal').onclick=async e=>{\n  if(e.target.closest('#rMenu')){await act('leave');S.tab='play';S.built=''}\n  else if(e.target.closest('#rAgain')){const st=S.snap.game.stake;await act('leave');S.tab='play';S.built='';const r=await act('quick',{stake:st});if(r.error)S.stake=st}\n};\n\n/* ---------- главный рендер ---------- */\nfunction render(){\n  const s=S.snap;if(!s)return;\n  if(!s.me.ready){\n    if(S.shown!=='setup'||!S.E){initE();$('#s-setup').innerHTML=`<h1>Добро пожаловать!</h1><p>Создайте профиль — вас увидят соперники</p><div class=\"panel\" style=\"margin-top:14px\">${editorHTML(true)}</div><div style=\"text-align:center;color:var(--mut);font-size:13px\">🎁 Стартовый бонус: ${fmt(1000)} монет</div>`;bindEditor($('#s-setup'),true)}\n    showScreen('setup');return;\n  }\n  const inc=(s.offers||[]).filter(o=>o.dir==='in');\n  if(S.knownIn===null)S.knownIn=new Set(inc.map(o=>o.id));\n  else for(const o of inc)if(!S.knownIn.has(o.id)){S.knownIn.add(o.id);toast('💸 '+o.user.name+' отправил(а) вам '+o.amount+' монет',true);hapN('success')}\n  if(s.game){showScreen('game');renderGame();return}\n  S.gid=null;\n  showScreen('home');\n  if(S.tab==='me'&&S.built==='me'){renderHead();return}\n  renderHome();\n}\ndocument.addEventListener('visibilitychange',()=>{if(!document.hidden&&S.token&&!S.es){login().then(ok=>ok&&connect())}});\n(async()=>{if(await login())connect();else setTimeout(()=>location.reload(),5000)})();\n})();\n</script>\n</body>\n</html>\n";

/* ---------- база (JSON-файл) ---------- */
let db = { users: {} };
try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) {}
db.users = db.users || {};
db.offers = db.offers || [];
for (const u of Object.values(db.users)) { if (u.escrow > 0) u.coins += u.escrow; u.escrow = 0; } // вернуть ставки после перезапуска
let saveT = null;
function save() {
  if (saveT) return;
  saveT = setTimeout(() => {
    saveT = null;
    try { fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(db)); fs.renameSync(DATA_FILE + '.tmp', DATA_FILE); }
    catch (e) { console.error('save error', e.message); }
  }, 400);
}

/* ---------- состояние в памяти ---------- */
const sessions = new Map();   // token -> uid
const clients = new Map();    // uid -> Set(res)
const lastActive = new Map(); // uid -> ts
const tables = new Map();     // id -> {id, owner, stake}
const games = new Map();
const userGame = new Map();
const userTable = new Map();
const nid = () => crypto.randomBytes(5).toString('hex');

function rankOf(r) {
  let i = 0;
  for (let k = 0; k < RANKS.length; k++) if (r >= RANKS[k].min) i = k;
  const nx = RANKS[i + 1];
  return { idx: i, name: RANKS[i].name, icon: RANKS[i].icon, from: RANKS[i].min, to: nx ? nx.min : null };
}
function pub(u) {
  return { id: u.id, name: u.name, emoji: u.emoji, color: u.color, photo: u.usePhoto && u.photo ? u.photo : null, rating: u.rating, rank: rankOf(u.rating) };
}
function dailyWait(u) {
  const cd = u.coins < STAKES[0] ? 2 * 3600e3 : 24 * 3600e3;
  return Math.max(0, (u.lastDaily || 0) + cd - Date.now());
}
function meView(u) {
  return {
    id: u.id, name: u.name, emoji: u.emoji, color: u.color, ready: !!u.ready,
    photo: u.usePhoto && u.photo ? u.photo : null, photoUrl: u.photo || null, usePhoto: !!u.usePhoto, hasPhoto: !!u.photo,
    coins: u.coins, rating: u.rating, wins: u.wins, losses: u.losses, rank: rankOf(u.rating),
    daily: dailyWait(u), dailyAmount: u.coins < STAKES[0] ? 200 : 200,
  };
}

/* ---------- авторизация ---------- */
function checkInit(initData) {
  const p = new URLSearchParams(initData);
  const hash = p.get('hash');
  if (!hash) return null;
  p.delete('hash');
  const dcs = [...p.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => k + '=' + v).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const h = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
  if (h.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(h), Buffer.from(hash))) return null;
  if (Date.now() / 1000 - (+p.get('auth_date') || 0) > 86400 * 7) return null;
  try { return JSON.parse(p.get('user')); } catch (e) { return null; }
}
function cleanName(s) {
  return String(s || '').replace(/[<>\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
}
function photoOk(u) { return typeof u === 'string' && /^https:\/\/[a-z0-9.-]*(t\.me|telegram\.org|telesco\.pe)\//i.test(u); }

function auth(body) {
  let tg = null;
  const initData = String(body.initData || '');
  if (BOT_TOKEN) {
    if (!initData) return { error: 'Откройте игру через Telegram' };
    tg = checkInit(initData);
    if (!tg || !tg.id) return { error: 'Перезапустите игру из Telegram' };
  } else if (initData) {
    try { tg = JSON.parse(new URLSearchParams(initData).get('user')); } catch (e) {}
  }
  let uid;
  if (tg && tg.id) uid = 'tg' + tg.id;
  else {
    const g = String(body.guestId || '').replace(/[^a-z0-9]/gi, '').slice(0, 32);
    if (g.length < 8) return { error: 'bad guest' };
    uid = 'g' + g;
  }
  let u = db.users[uid];
  if (!u) {
    u = db.users[uid] = {
      id: uid, name: cleanName(tg && (tg.first_name || tg.username)) || 'Игрок', ready: false,
      emoji: EMOJIS[crypto.randomInt(EMOJIS.length)], color: crypto.randomInt(COLORS), usePhoto: false,
      coins: START_COINS, rating: 0, wins: 0, losses: 0, escrow: 0, lastDaily: 0, created: Date.now(),
    };
  }
  if (tg && photoOk(tg.photo_url)) u.photo = tg.photo_url;
  const token = crypto.randomBytes(16).toString('hex');
  sessions.set(token, uid);
  save();
  return { token };
}

/* ---------- логика «Дурака» ---------- */
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const cid = c => c.s + c.r;
const beats = (d, a, trump) => (d.s === a.s ? d.r > a.r : d.s === trump && a.s !== trump);
const other = (g, id) => (g.players[0] === id ? g.players[1] : g.players[0]);
const ranksOnTable = g => { const s = new Set(); g.table.forEach(p => { s.add(p.a.r); if (p.d) s.add(p.d.r); }); return s; };
function sortHand(h, trump) {
  return h.slice().sort((x, y) => ((x.s === trump) - (y.s === trump)) || (x.s < y.s ? -1 : x.s > y.s ? 1 : 0) || x.r - y.r);
}
function onMove(g) {
  if (g.over) return null;
  if (g.phase === 'take') return g.attacker;
  return g.table.some(p => !p.d) ? g.defender : g.attacker;
}
function startGame(aId, bId, stake) {
  const deck = [];
  for (const s of 'SHDC') for (let r = 6; r <= 14; r++) deck.push({ s, r });
  shuffle(deck);
  const hands = { [aId]: [], [bId]: [] };
  for (let i = 0; i < 6; i++) { hands[aId].push(deck.pop()); hands[bId].push(deck.pop()); }
  const trumpCard = deck[0], trump = trumpCard.s;
  const low = id => Math.min(99, ...hands[id].filter(c => c.s === trump).map(c => c.r));
  const la = low(aId), lb = low(bId);
  const att = la === lb ? (crypto.randomInt(2) ? aId : bId) : la < lb ? aId : bId;
  const g = {
    id: nid(), players: [aId, bId], stake, deck, trump, trumpCard, hands, table: [], attacker: att,
    defender: att === aId ? bId : aId, phase: 'attack', limit: 6, discard: 0,
    deadline: Date.now() + TURN_MS, over: false, result: null, born: Date.now(),
  };
  games.set(g.id, g);
  for (const id of g.players) {
    userGame.set(id, g.id);
    const t = userTable.get(id); if (t) { tables.delete(t); userTable.delete(id); }
  }
  return g;
}
function refill(g) {
  for (const id of [g.attacker, g.defender]) while (g.hands[id].length < 6 && g.deck.length) g.hands[id].push(g.deck.pop());
}
function settle(g, winner, reason) {
  if (g.over) return;
  g.over = true; g.deadline = 0;
  const [a, b] = g.players;
  const pot = g.stake * 2, fee = Math.floor(pot * FEE);
  const res = { winner, reason, delta: {} };
  for (const id of g.players) db.users[id].escrow = 0;
  if (!winner) {
    for (const id of g.players) { db.users[id].coins += g.stake; res.delta[id] = { coins: 0, rating: 0 }; }
  } else {
    const loser = a === winner ? b : a, w = db.users[winner], l = db.users[loser];
    w.coins += pot - fee; w.wins++; w.rating += 25;
    const lr = Math.min(15, l.rating); l.rating -= lr; l.losses++;
    res.delta[winner] = { coins: pot - fee - g.stake, rating: 25 };
    res.delta[loser] = { coins: -g.stake, rating: -lr };
  }
  g.result = res;
  save();
}
function finishRound(g, took) {
  const cards = [];
  g.table.forEach(p => { cards.push(p.a); if (p.d) cards.push(p.d); });
  if (took) g.hands[g.defender].push(...cards);
  else { g.discard += cards.length; }
  g.table = [];
  refill(g); // сначала тот, кто атаковал
  if (!took) { const t = g.attacker; g.attacker = g.defender; g.defender = t; }
  if (!g.deck.length) {
    const [a, b] = g.players;
    const ea = !g.hands[a].length, eb = !g.hands[b].length;
    if (ea && eb) return settle(g, null, 'normal');
    if (ea) return settle(g, a, 'normal');
    if (eb) return settle(g, b, 'normal');
  }
  g.phase = 'attack';
  g.limit = Math.min(6, g.hands[g.defender].length);
  g.deadline = Date.now() + TURN_MS;
}
function afterAction(g) {
  const canAdd = g.table.length < g.limit && g.hands[g.attacker].some(c => ranksOnTable(g).has(c.r));
  const allBeaten = g.table.length > 0 && g.table.every(p => p.d);
  if (g.phase === 'take' && !canAdd) return finishRound(g, true);
  if (g.phase === 'attack' && allBeaten && !canAdd) return finishRound(g, false);
  g.deadline = Date.now() + TURN_MS;
}
function findCard(g, uid, id) {
  const h = g.hands[uid];
  const i = h.findIndex(c => cid(c) === id);
  return i < 0 ? null : { i, c: h[i] };
}
function gameMove(uid, b) {
  const g = games.get(userGame.get(uid));
  if (!g || g.over) return 'Игра уже закончена';
  const t = b.type;
  if (t === 'attack') {
    if (g.attacker !== uid) return 'Сейчас вы защищаетесь';
    const f = findCard(g, uid, String(b.card)); if (!f) return 'Нет такой карты';
    if (g.table.length) {
      if (g.table.length >= g.limit) return 'Больше карт подкинуть нельзя';
      if (!ranksOnTable(g).has(f.c.r)) return 'Подкинуть можно только карту того же достоинства';
    }
    g.hands[uid].splice(f.i, 1);
    g.table.push({ a: f.c, d: null });
    return afterAction(g), null;
  }
  if (t === 'defend') {
    if (g.defender !== uid || g.phase !== 'attack') return 'Сейчас нельзя отбиваться';
    const pair = g.table[+b.idx];
    if (!pair || pair.d) return 'Эту карту уже отбили';
    const f = findCard(g, uid, String(b.card)); if (!f) return 'Нет такой карты';
    if (!beats(f.c, pair.a, g.trump)) return 'Эта карта не бьёт';
    g.hands[uid].splice(f.i, 1);
    pair.d = f.c;
    return afterAction(g), null;
  }
  if (t === 'take') {
    if (g.defender !== uid || g.phase !== 'attack') return 'Сейчас нельзя взять';
    if (!g.table.some(p => !p.d)) return 'Нечего брать';
    g.phase = 'take';
    return afterAction(g), null;
  }
  if (t === 'done') {
    if (g.attacker !== uid) return 'Это действие атакующего';
    if (g.phase === 'take') return finishRound(g, true), null;
    if (!g.table.length || g.table.some(p => !p.d)) return 'Ещё не всё отбито';
    return finishRound(g, false), null;
  }
  return 'Неизвестное действие';
}

/* ---------- столы / лобби ---------- */
function ensureReady(u) { return u && u.ready; }
function busy(uid) { return userGame.has(uid) || userTable.has(uid); }
function createTable(uid, stake) {
  const u = db.users[uid];
  if (!STAKES.includes(stake)) return 'Неверная ставка';
  if (busy(uid)) return 'Вы уже в игре или за столом';
  if (u.coins < stake) return 'Не хватает монет';
  u.coins -= stake; u.escrow = stake;
  const t = { id: nid(), owner: uid, stake };
  tables.set(t.id, t); userTable.set(uid, t.id);
  save();
  return null;
}
function joinTable(uid, tid) {
  const t = tables.get(tid), u = db.users[uid];
  if (!t) return 'Стол уже занят';
  if (t.owner === uid) return 'Это ваш стол';
  if (busy(uid)) return 'Вы уже в игре или за столом';
  if (u.coins < t.stake) return 'Не хватает монет';
  u.coins -= t.stake; u.escrow = t.stake;
  tables.delete(tid); userTable.delete(t.owner);
  startGame(t.owner, uid, t.stake);
  save();
  return null;
}
function cancelTable(uid) {
  const tid = userTable.get(uid); if (!tid) return;
  const t = tables.get(tid);
  if (t) { const u = db.users[uid]; u.coins += t.stake; u.escrow = 0; tables.delete(tid); }
  userTable.delete(uid); save();
}

/* ---------- обмен монетами (трейдинг) ---------- */
function offerView(o, uid) {
  const other = db.users[o.from === uid ? o.to : o.from];
  return { id: o.id, amount: o.amount, dir: o.from === uid ? 'out' : 'in', user: pub(other), left: Math.max(0, o.created + OFFER_TTL - Date.now()) };
}
function myOffers(uid) {
  return db.offers.filter(o => o.status === 'pending' && (o.from === uid || o.to === uid)).map(o => offerView(o, uid));
}
function sendOffer(uid, to, amount) {
  const u = db.users[uid], r = db.users[to];
  amount = Math.floor(+amount);
  if (!r || !r.ready) return 'Игрок не найден';
  if (to === uid) return 'Нельзя отправить самому себе';
  if (!(amount >= MIN_SEND)) return 'Минимум ' + MIN_SEND + ' монет';
  if (u.coins < amount) return 'Не хватает монет';
  if (db.offers.filter(o => o.status === 'pending' && o.from === uid).length >= MAX_OUT) return 'Слишком много активных предложений';
  u.coins -= amount;
  db.offers.push({ id: nid(), from: uid, to, amount, created: Date.now(), status: 'pending' });
  save(); return null;
}
function resolveOffer(uid, id, how) {
  const o = db.offers.find(x => x.id === id && x.status === 'pending');
  if (!o) return 'Предложение уже неактуально';
  if (how === 'accept') {
    if (o.to !== uid) return 'Это не ваше предложение';
    db.users[o.to].coins += o.amount; o.status = 'accepted';
  } else if (how === 'decline') {
    if (o.to !== uid) return 'Это не ваше предложение';
    db.users[o.from].coins += o.amount; o.status = 'declined';
  } else {
    if (o.from !== uid) return 'Это не ваше предложение';
    db.users[o.from].coins += o.amount; o.status = 'withdrawn';
  }
  o.done = Date.now(); save(); return null;
}
function expireOffers() {
  const now = Date.now(); let ch = false;
  for (const o of db.offers) {
    if (o.status === 'pending' && now - o.created > OFFER_TTL) { db.users[o.from].coins += o.amount; o.status = 'expired'; o.done = now; ch = true; }
  }
  const n = db.offers.length;
  db.offers = db.offers.filter(o => o.status === 'pending' || now - (o.done || now) < 7 * 86400e3);
  if (ch || n !== db.offers.length) save();
  return ch;
}

function action(uid, b) {
  const u = db.users[uid];
  if (!u) return 'AUTH';
  lastActive.set(uid, Date.now());
  switch (b.type) {
    case 'profile': {
      const name = cleanName(b.name);
      if (name.length < 2) return 'Имя слишком короткое';
      if (!EMOJIS.includes(b.emoji)) return 'Выберите аватар';
      const c = +b.color; if (!(c >= 0 && c < COLORS)) return 'Выберите цвет';
      u.name = name; u.emoji = b.emoji; u.color = c | 0; u.usePhoto = !!b.usePhoto && !!u.photo; u.ready = true;
      save(); return null;
    }
    case 'daily': {
      if (dailyWait(u) > 0) return 'Бонус ещё не готов';
      u.coins += 200; u.lastDaily = Date.now(); save(); return null;
    }
    case 'create': if (!ensureReady(u)) return 'Сначала создайте профиль'; return createTable(uid, +b.stake);
    case 'cancel': cancelTable(uid); return null;
    case 'join': if (!ensureReady(u)) return 'Сначала создайте профиль'; return joinTable(uid, String(b.table));
    case 'quick': {
      if (!ensureReady(u)) return 'Сначала создайте профиль';
      const stake = +b.stake;
      if (!STAKES.includes(stake)) return 'Неверная ставка';
      if (busy(uid)) return 'Вы уже в игре или за столом';
      const t = [...tables.values()].find(x => x.stake === stake && x.owner !== uid);
      return t ? joinTable(uid, t.id) : createTable(uid, stake);
    }
    case 'resign': {
      const g = games.get(userGame.get(uid));
      if (g && !g.over) settle(g, other(g, uid), 'resign');
      return null;
    }
    case 'leave': {
      const gid = userGame.get(uid), g = games.get(gid);
      if (g && g.over) { userGame.delete(uid); if (!g.players.some(p => userGame.get(p) === gid)) games.delete(gid); }
      return null;
    }
    case 'send': if (!ensureReady(u)) return 'Сначала создайте профиль'; return sendOffer(uid, String(b.to), b.amount);
    case 'accept': case 'decline': case 'withdraw': return resolveOffer(uid, String(b.offer), b.type);
    case 'attack': case 'defend': case 'take': case 'done':
      if (!userGame.has(uid)) return 'Вы не в игре';
      return gameMove(uid, b);
  }
  return 'Неизвестная команда';
}

/* ---------- представление и рассылка ---------- */
function gameView(g, uid) {
  const opp = other(g, uid);
  const v = {
    id: g.id, stake: g.stake, trump: g.trump, trumpCard: g.trumpCard, deck: g.deck.length, discard: g.discard,
    hand: sortHand(g.hands[uid], g.trump), oppCount: g.hands[opp].length, opp: pub(db.users[opp]),
    table: g.table, iAttack: g.attacker === uid, phase: g.phase, limit: g.limit, over: g.over,
    left: Math.max(0, g.deadline - Date.now()), turn: onMove(g) === uid,
  };
  if (g.over) {
    const r = g.result, d = r.delta[uid];
    v.result = { res: !r.winner ? 'draw' : r.winner === uid ? 'win' : 'lose', coins: d.coins, rating: d.rating, reason: r.reason };
  }
  return v;
}
function snapshot(uid) {
  const u = db.users[uid];
  const gid = userGame.get(uid), g = gid && games.get(gid);
  const list = [...tables.values()].map(t => ({ id: t.id, stake: t.stake, owner: pub(db.users[t.owner]), mine: t.owner === uid }));
  list.sort((a, b) => (b.mine - a.mine) || a.stake - b.stake);
  return { me: meView(u), tables: list.slice(0, 40), myTable: userTable.get(uid) || null, game: g ? gameView(g, uid) : null, offers: myOffers(uid), cfg: CFG, online: clients.size };
}
let pushT = null;
function push() {
  if (pushT) return;
  pushT = setTimeout(() => {
    pushT = null;
    for (const [uid, set] of clients) {
      if (!db.users[uid]) continue;
      const data = 'data:' + JSON.stringify(snapshot(uid)) + '\n\n';
      for (const r of set) { try { r.write(data); } catch (e) {} }
    }
  }, 50);
}

setInterval(() => {
  const now = Date.now();
  for (const uid of clients.keys()) lastActive.set(uid, now);
  let changed = false;
  for (const g of games.values()) {
    if (!g.over && now > g.deadline) { const who = onMove(g); settle(g, other(g, who), 'timeout'); changed = true; }
    if (g.over && now - g.born > 3 * 3600e3) { for (const p of g.players) if (userGame.get(p) === g.id) userGame.delete(p); games.delete(g.id); }
  }
  for (const t of [...tables.values()]) {
    if (now - (lastActive.get(t.owner) || 0) > 25000) { cancelTable(t.owner); changed = true; }
  }
  if (expireOffers()) changed = true;
  if (changed) push();
}, 1000);

/* ---------- HTTP ---------- */
function json(res, code, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(s);
}
function readBody(req) {
  return new Promise(resolve => {
    let s = '';
    req.on('data', d => { s += d; if (s.length > 20000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(HTML);
    }
    if (p === '/health') return json(res, 200, { ok: true, users: Object.keys(db.users).length, games: games.size });
    if (p === '/api/auth' && req.method === 'POST') {
      const r = auth(await readBody(req));
      return json(res, r.error ? 401 : 200, r);
    }
    if (p === '/api/action' && req.method === 'POST') {
      const b = await readBody(req);
      const uid = sessions.get(String(b.token));
      if (!uid) return json(res, 401, { error: 'AUTH' });
      const err = action(uid, b);
      if (err === 'AUTH') return json(res, 401, { error: 'AUTH' });
      push();
      return json(res, 200, err ? { error: err } : { ok: true });
    }
    const uid = sessions.get(String(url.searchParams.get('token')));
    if (p === '/api/events') {
      if (!uid || !db.users[uid]) { res.writeHead(401); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 2000\n\n');
      if (!clients.has(uid)) clients.set(uid, new Set());
      clients.get(uid).add(res);
      lastActive.set(uid, Date.now());
      res.write('data:' + JSON.stringify(snapshot(uid)) + '\n\n');
      const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 15000);
      req.on('close', () => {
        clearInterval(hb);
        const s = clients.get(uid); if (s) { s.delete(res); if (!s.size) clients.delete(uid); }
        push();
      });
      push();
      return;
    }
    if (p === '/api/state') {
      if (!uid || !db.users[uid]) return json(res, 401, { error: 'AUTH' });
      return json(res, 200, snapshot(uid));
    }
    if (p === '/api/find') {
      if (!uid) return json(res, 401, { error: 'AUTH' });
      const q = (url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 16);
      if (q.length < 2) return json(res, 200, { list: [] });
      const list = Object.values(db.users).filter(u => u.ready && u.id !== uid && u.name.toLowerCase().includes(q)).slice(0, 10).map(pub);
      return json(res, 200, { list });
    }
    if (p === '/api/leaderboard') {
      if (!uid) return json(res, 401, { error: 'AUTH' });
      const top = Object.values(db.users).filter(u => u.ready)
        .sort((a, b) => b.rating - a.rating || b.wins - a.wins).slice(0, 20)
        .map(u => ({ ...pub(u), wins: u.wins, losses: u.losses, me: u.id === uid }));
      return json(res, 200, { top });
    }
    res.writeHead(404); res.end('Not found');
  } catch (e) {
    console.error(e);
    try { json(res, 500, { error: 'Ошибка сервера' }); } catch (_) {}
  }
});
server.listen(PORT, '0.0.0.0', () => console.log('Дурак онлайн запущен на порту ' + PORT + (BOT_TOKEN ? '' : ' (BOT_TOKEN не задан — режим теста)')));
process.on('uncaughtException', e => console.error('uncaught', e));
