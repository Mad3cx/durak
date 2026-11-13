'use strict';
/* Дурак онлайн — Telegram Mini App. Один файл, без зависимостей (только Node.js 18+). */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const env = n => (process.env[n] || '').trim();
const PORT = +env('PORT') || 3000;
const BOT_TOKEN = env('BOT_TOKEN');                      // пробелы по краям убираются автоматически
let BOT_USERNAME = env('BOT_USERNAME').replace(/^@/, '');
const DATA_FILE = env('DATA_FILE') || path.join(__dirname, 'durak-data.json');
const R_URL = env('UPSTASH_REDIS_REST_URL').replace(/\/+$/, '');
const R_TOKEN = env('UPSTASH_REDIS_REST_TOKEN');
const USE_REDIS = !!(R_URL && R_TOKEN);
const FLUSH_MS = +env('FLUSH_MS') || 1500;

const START_COINS = 1000;
const FEE = 0.05;
const TURN_MS = +env('TURN_MS') || 45000;
const OFFLINE_GRACE = +env('OFFLINE_GRACE_MS') || 45000;   // доп. время, если игрок вышел из приложения
const STAKES = [50, 100, 250, 500, 1000];
const MIN_SEND = 10, MAX_OUT = 5, OFFER_TTL = +env('OFFER_TTL_MS') || 48 * 3600e3;
const UNAME_COOLDOWN = +env('UNAME_COOLDOWN_MS') || 24 * 3600e3;
const UNAME_GRACE = env('UNAME_GRACE_MS') !== '' ? +env('UNAME_GRACE_MS') : 10 * 60e3;   // 10 минут после выбора ника можно исправить опечатку
const unameWaitOf = u => { const since = Date.now() - (u.unameAt || 0); return since > UNAME_GRACE && since < UNAME_COOLDOWN ? UNAME_COOLDOWN - since : 0; };
const EMOJIS = ['😎','🤠','🦊','🐼','🐯','🦁','🐸','🐵','🦄','🐲','👑','🔥','💀','👻','🤖','👽','🥷','🧙','🦅','🐺','🦈','🐙','🍀','⭐'];
const EMOTES = ['👍','😂','😎','😡','🙏','🔥'];
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
const CFG = { emojis: EMOJIS, emotes: EMOTES, ranks: RANKS, stakes: STAKES, colors: COLORS, turn: TURN_MS, fee: FEE, minSend: MIN_SEND, offerTtl: OFFER_TTL, unameCooldown: UNAME_COOLDOWN };
const BOT_NAMES = ['Дуракин', 'Хитрый Лис', 'Профессор Бито', 'Козырный', 'Шулер Петя', 'Валет', 'Король Пик', 'Тузик'];

const HTML = "<!doctype html>\n<html lang=\"ru\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover\">\n<title>Дурак Онлайн</title>\n<script src=\"https://telegram.org/js/telegram-web-app.js\"></script>\n<style>\n:root{--bg:#0e1320;--bg2:#171f33;--card:#1e2842;--line:#2b3757;--tx:#eef2ff;--mut:#8f9bbd;--gold:#ffc93c;--gold2:#ff9d00;--green:#2ecc71;--red:#ff5468;--blue:#4c8dff}\n*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none}\nhtml,body{margin:0;height:100%;background:var(--bg);color:var(--tx);font-family:-apple-system,BlinkMacSystemFont,\"SF Pro Display\",\"Segoe UI\",Roboto,sans-serif;overflow:hidden}\nbody{background:radial-gradient(120% 80% at 50% 0%,#1b2650 0%,var(--bg) 60%)}\nbutton{font:inherit;color:inherit;border:0;background:none;cursor:pointer}\ninput{font:inherit;user-select:text;-webkit-user-select:text}\n.screen{display:none;position:fixed;inset:0;flex-direction:column}\n.screen.active{display:flex}\n#splash{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px;z-index:50;background:var(--bg);font-size:15px;color:var(--mut);text-align:center;padding:0 30px}\n#splash .logo{font-size:64px;animation:float 1.6s ease-in-out infinite}\n@keyframes float{50%{transform:translateY(-8px) rotate(6deg)}}\n#toast{position:fixed;left:50%;top:max(14px,env(safe-area-inset-top));transform:translate(-50%,-140%);background:#2a1a24;border:1px solid var(--red);color:#ffd5da;padding:10px 16px;border-radius:14px;font-size:14px;z-index:99;transition:.3s;max-width:90%;text-align:center}\n#toast.show{transform:translate(-50%,0)}\n#toast.ok{background:#14301f;border-color:var(--green);color:#cffbe0}\n#net{position:fixed;left:0;right:0;top:0;background:var(--red);color:#fff;text-align:center;font-size:13px;padding:4px;z-index:98;display:none}\n\n/* кнопки */\n.btn{padding:13px 18px;border-radius:14px;font-weight:700;font-size:16px;background:var(--card);border:1px solid var(--line);transition:transform .1s,opacity .2s}\n.btn:active{transform:scale(.96)}\n.btn.primary{background:linear-gradient(180deg,#ffd84d,#ff9d00);color:#3a2500;border:0;box-shadow:0 6px 18px rgba(255,157,0,.35)}\n.btn.blue{background:linear-gradient(180deg,#5b9bff,#3a6fe0);border:0;box-shadow:0 6px 18px rgba(60,110,230,.35)}\n.btn.green{background:linear-gradient(180deg,#43e08a,#1fae5f);color:#04301a;border:0;box-shadow:0 6px 18px rgba(46,204,113,.3)}\n.btn.red{background:linear-gradient(180deg,#ff7487,#e0364d);border:0}\n.btn.big{width:100%;padding:16px;font-size:17px}\n.btn[disabled],.btn.off{opacity:.4}\n.btn[disabled]{pointer-events:none}\n\n/* аватар / мелочи */\n.av{position:relative;border-radius:50%;display:flex;align-items:center;justify-content:center;flex:none;overflow:hidden;box-shadow:inset 0 0 0 2px rgba(255,255,255,.25),0 3px 10px rgba(0,0,0,.35)}\n.av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}\n.rk{font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;background:rgba(255,201,60,.14);color:var(--gold);white-space:nowrap}\n.un{font-size:12px;color:var(--mut);font-weight:600}\n.coins{display:inline-flex;align-items:center;gap:6px;font-weight:800;background:rgba(255,201,60,.12);border:1px solid rgba(255,201,60,.35);padding:7px 12px;border-radius:30px;color:var(--gold)}\n.coin{display:inline-block;width:1.15em;height:1.15em;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff3b0,#ffc93c 45%,#d98a00);box-shadow:inset 0 0 0 .12em #b36f00;vertical-align:-.2em;position:relative}\n.coin:after{content:\"♠\";position:absolute;inset:0;font-size:.7em;text-align:center;line-height:1.65;color:#9a5d00}\n\n/* главная */\n#head{padding:max(12px,env(safe-area-inset-top)) 14px 8px;display:flex;align-items:center;gap:12px}\n#head .who{flex:1;min-width:0}\n#head .nm{font-weight:800;font-size:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.xp{height:5px;border-radius:5px;background:#26314f;margin-top:5px;overflow:hidden}\n.xp i{display:block;height:100%;background:linear-gradient(90deg,var(--gold),var(--gold2));border-radius:5px;transition:width .6s}\n#body{flex:1;overflow-y:auto;padding:6px 14px 100px;-webkit-overflow-scrolling:touch}\n#nav{position:fixed;left:0;right:0;bottom:0;display:flex;background:rgba(14,19,32,.94);backdrop-filter:blur(14px);border-top:1px solid var(--line);padding:6px 10px calc(8px + env(safe-area-inset-bottom));gap:6px}\n#nav button{flex:1;padding:8px 0;border-radius:12px;color:var(--mut);font-size:12px;font-weight:600;display:flex;flex-direction:column;align-items:center;gap:2px;position:relative}\n#nav button b{font-size:22px;filter:grayscale(.6)}\n#nav button.on{color:var(--tx);background:var(--card)}\n#nav button.on b{filter:none}\n.bdg{position:absolute;top:2px;right:18%;min-width:18px;height:18px;border-radius:9px;background:var(--red);color:#fff;font-size:11px;font-weight:800;display:none;align-items:center;justify-content:center;padding:0 5px;font-style:normal}\n.panel{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:14px;margin-bottom:12px}\n.sec{font-size:13px;color:var(--mut);font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin:16px 4px 8px}\n.chips{display:flex;gap:8px;flex-wrap:wrap}\n.chip{flex:1;min-width:58px;padding:11px 0;text-align:center;border-radius:14px;background:#141c33;border:1.5px solid var(--line);font-weight:800;color:var(--mut)}\n.chip.on{border-color:var(--gold);color:var(--gold);background:rgba(255,201,60,.1);box-shadow:0 0 14px rgba(255,201,60,.2)}\n.chip[disabled]{opacity:.35}\n.row2{display:flex;gap:10px;margin-top:12px}\n.row2 .btn{flex:1}\n.trow{display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--card);border:1px solid var(--line);border-radius:16px;margin-bottom:8px}\n.trow .mid{flex:1;min-width:0}\n.trow .nm{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.trow .btn{padding:9px 14px;font-size:14px}\n.stakeTag{font-weight:800;color:var(--gold);display:flex;align-items:center;gap:5px;margin-right:4px}\n.empty{text-align:center;color:var(--mut);padding:22px 10px;font-size:14px}\n.wait{display:flex;align-items:center;gap:12px}\n.spin{width:26px;height:26px;border-radius:50%;border:3px solid var(--line);border-top-color:var(--gold);animation:sp 1s linear infinite;flex:none}\n@keyframes sp{to{transform:rotate(360deg)}}\n.daily{display:flex;align-items:center;gap:12px;background:linear-gradient(90deg,#3b2c08,#2a2210);border:1px solid rgba(255,201,60,.4);border-radius:16px;padding:12px 14px;margin-bottom:12px}\n.daily .tx{flex:1;font-size:14px}.daily b{color:var(--gold)}\n.lb .pl{width:26px;text-align:center;font-weight:800;color:var(--mut)}\n.lb .mine{border-color:var(--gold)}\n.payb{padding:7px 10px!important;font-size:16px!important}\n.note{font-size:12px;color:var(--mut);margin:8px 2px 0;line-height:1.4}\n.note.bad{color:#ff8a98}.note.okc{color:#7be0a4}\n.hero{display:flex;flex-direction:column;align-items:center;text-align:center;padding:18px 14px}\n.hero .hn{font-size:22px;font-weight:900;margin-top:10px}\n.hero .hu{color:var(--mut);font-weight:600;margin:2px 0 8px}\n.hero .xp{width:100%;max-width:280px;height:7px}\n.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px;text-align:center;width:100%}\n.stats div{background:#141c33;border-radius:12px;padding:10px 4px}\n.stats b{display:block;font-size:19px}.stats span{font-size:11px;color:var(--mut)}\n.ranks .trow{padding:8px 12px;margin-bottom:6px;opacity:.55}.ranks .trow.cur{opacity:1;border-color:var(--gold)}\n\n/* поля ввода */\n.inp{width:100%;padding:14px;border-radius:14px;background:#141c33;border:1.5px solid var(--line);color:var(--tx);font-size:17px;font-weight:700;outline:none}\n.inp:focus{border-color:var(--blue)}\n.inp[disabled]{opacity:.5}\n.lbl{display:block;font-size:12px;color:var(--mut);margin:14px 2px 6px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}\n.uwrap{position:relative}\n.uwrap .at{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--mut);font-weight:800;font-size:17px}\n.uwrap .inp{padding-left:34px;padding-right:44px}\n.ustat{position:absolute;right:14px;top:50%;transform:translateY(-50%);font-size:18px}\n.achip{flex:1;min-width:58px;padding:10px 0;text-align:center;border-radius:14px;background:#141c33;border:1.5px solid var(--line);font-weight:800;color:var(--mut)}\n.achip:active{border-color:var(--gold);color:var(--gold)}\n.egrid{display:grid;grid-template-columns:repeat(8,1fr);gap:6px}\n.eb{font-size:22px;padding:6px 0;border-radius:12px;background:#141c33;border:1.5px solid transparent}\n.eb.on{border-color:var(--gold);background:rgba(255,201,60,.12)}\n.cgrid{display:grid;grid-template-columns:repeat(10,1fr);gap:6px}\n.cb{aspect-ratio:1;border-radius:50%;border:2.5px solid transparent}\n.cb.on{border-color:#fff;box-shadow:0 0 0 2px var(--bg),0 0 0 4px var(--gold)}\n.chk{display:flex!important;align-items:center;gap:10px;text-transform:none!important;font-size:14px!important;color:var(--tx)!important}\n.chk input{width:20px;height:20px}\n.center{display:flex;justify-content:center;margin:6px 0}\n#s-setup{padding:max(20px,env(safe-area-inset-top)) 18px 24px;overflow-y:auto}\n#s-setup h1{margin:10px 0 2px;text-align:center;font-size:26px}\n#s-setup p{text-align:center;color:var(--mut);margin:0 0 8px}\n\n/* обмен */\n.offer{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:12px;margin-bottom:8px}\n.offer.in{border-color:rgba(46,204,113,.55)}\n.offer .top{display:flex;align-items:center;gap:12px}\n.offer .mid{flex:1;min-width:0}\n.offer .nm{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.offer .sub{font-size:12px;color:var(--mut)}\n.offer .amt{font-weight:900;font-size:18px;display:flex;align-items:center;gap:5px}\n.offer .amt.p{color:var(--green)}.offer .amt.o{color:var(--gold)}\n.offer .row2{margin-top:10px}.offer .btn{padding:10px 12px;font-size:14px}\n\n/* диалог / результат */\n#dlg,#modal{position:fixed;inset:0;background:rgba(5,8,18,.78);display:none;align-items:center;justify-content:center;z-index:90;padding:24px;backdrop-filter:blur(4px)}\n#modal{position:absolute;z-index:20}\n#dlg.show,#modal.show{display:flex}\n.res{width:100%;max-width:340px;background:linear-gradient(180deg,#25315a,#161e38);border:1px solid var(--line);border-radius:24px;padding:26px 20px;text-align:center;animation:popin .4s cubic-bezier(.2,1.3,.4,1)}\n@keyframes popin{from{transform:scale(.7);opacity:0}}\n.res .bigemo{font-size:60px;animation:bounce 1s .3s}\n@keyframes bounce{30%{transform:scale(1.3) rotate(-8deg)}60%{transform:scale(.95) rotate(5deg)}}\n.res h2{margin:6px 0 2px;font-size:28px}\n.res .dl{font-size:30px;font-weight:900;margin:12px 0 2px}\n.res .dl.p{color:var(--green)}.res .dl.n{color:var(--red)}\n.res .sub{color:var(--mut);font-size:14px;margin-bottom:16px;line-height:1.4}\n.res .who{display:flex;align-items:center;gap:12px;justify-content:center;margin:10px 0 4px;text-align:left}\n.fall{position:absolute;top:-40px;font-size:26px;animation:fall linear forwards;z-index:25;pointer-events:none}\n@keyframes fall{to{transform:translateY(110vh) rotate(540deg)}}\n\n/* ===== игровой стол ===== */\n#s-game{background:radial-gradient(90% 60% at 50% 45%,#1f8a58 0%,#126040 55%,#0a3825 100%);overflow:hidden}\n.gtop{display:flex;align-items:center;gap:10px;padding:max(10px,env(safe-area-inset-top)) 12px 6px;background:linear-gradient(180deg,rgba(0,0,0,.35),transparent)}\n.gtop .pot{flex:1;text-align:center;font-weight:800;font-size:14px}\n.gtop .pot small{display:block;color:#a8e8c8;font-weight:600;font-size:11px}\n.iconbtn{width:38px;height:38px;border-radius:12px;background:rgba(0,0,0,.3);font-size:18px}\n.tbar{height:5px;margin:0 12px;border-radius:5px;background:rgba(0,0,0,.35);overflow:hidden}\n.tbar i{display:block;height:100%;width:100%;background:var(--gold);border-radius:5px;transition:width .2s linear}\n.tbar.low i{background:var(--red)}\n.pl-row{position:relative;display:flex;align-items:center;gap:10px;padding:8px 14px;transition:background .3s}\n.pl-row.active{background:linear-gradient(90deg,rgba(255,201,60,.18),transparent)}\n.pl-row.active .av{box-shadow:0 0 0 3px var(--gold),0 0 18px rgba(255,201,60,.6);animation:glow 1.2s infinite}\n@keyframes glow{50%{box-shadow:0 0 0 3px var(--gold),0 0 4px rgba(255,201,60,.2)}}\n.pl-row .nm{font-weight:800;font-size:15px;white-space:nowrap;max-width:150px;overflow:hidden;text-overflow:ellipsis}\n.dots i{display:inline-block;width:5px;height:5px;border-radius:50%;background:#fff;margin-left:3px;animation:dt 1.2s infinite}\n.dots i:nth-child(2){animation-delay:.2s}.dots i:nth-child(3){animation-delay:.4s}\n@keyframes dt{0%,60%,100%{opacity:.25;transform:translateY(0)}30%{opacity:1;transform:translateY(-3px)}}\n.fan{display:flex;margin-left:auto;align-items:center}\n.fan .card{margin-left:-30px;scale:.62;transform-origin:right center}\n.fan .card:first-child{margin-left:0}\n.cnt{background:rgba(0,0,0,.45);border-radius:20px;padding:3px 9px;font-weight:800;font-size:13px;margin-left:-4px;z-index:2}\n.felt{flex:1;position:relative;display:flex;align-items:center;justify-content:center;min-height:0}\n.tbl{display:grid;grid-template-columns:repeat(3,auto);gap:14px 12px;justify-content:center;padding:0 40px 0 56px}\n.pair{position:relative;width:70px;height:96px}\n.pair .card{position:absolute}\n.pair .a{left:0;top:0}\n.pair .d{left:15px;top:14px;rotate:9deg}\n.pair.tgt{animation:pulse .9s infinite}\n.pair.tgt:after{content:\"\";position:absolute;inset:-6px;border:2.5px dashed var(--gold);border-radius:12px}\n@keyframes pulse{50%{scale:1.06}}\n.deckbox,.discardbox{position:absolute;top:50%;transform:translateY(-50%);width:50px;height:96px}\n.deckbox{left:10px}.discardbox{right:10px;opacity:.9}\n.deckbox .trumpc{position:absolute;left:14px;top:30px;rotate:90deg;scale:.8}\n.deckbox .back{position:absolute;left:0;top:10px;scale:.8;transform-origin:top left}\n.discardbox .back{position:absolute;left:0;top:10px;scale:.62;transform-origin:top left}\n.discardbox.e{opacity:.25}\n.dn{position:absolute;left:0;right:0;top:-10px;text-align:center;font-size:11px;font-weight:800;background:rgba(0,0,0,.5);border-radius:8px;padding:2px 0;z-index:3}\n.trumpTag{position:absolute;left:8px;top:calc(50% + 58px);font-size:12px;font-weight:800;background:rgba(0,0,0,.4);padding:3px 8px;border-radius:10px}\n.callout{position:absolute;left:50%;top:50%;translate:-50% -50%;font-size:26px;font-weight:900;color:#fff;text-shadow:0 2px 10px rgba(0,0,0,.6);pointer-events:none;z-index:30;animation:cl 1.1s forwards;white-space:nowrap}\n@keyframes cl{0%{opacity:0;scale:.5}20%{opacity:1;scale:1.15}70%{opacity:1;scale:1}100%{opacity:0;translate:-50% -90%}}\n.hint{text-align:center;font-weight:700;font-size:14px;padding:4px 12px;min-height:26px;text-shadow:0 1px 3px rgba(0,0,0,.5)}\n.acts{display:flex;justify-content:center;gap:10px;padding:2px 14px 6px;min-height:50px}\n.acts .btn{padding:11px 30px;animation:popin .3s}\n.me-row{position:relative;display:flex;align-items:center;gap:8px;padding:2px 14px;font-size:13px;font-weight:700}\n.emobtn{margin-left:auto;width:36px;height:36px;border-radius:12px;background:rgba(0,0,0,.3);font-size:18px}\n#emoPanel{position:absolute;right:10px;bottom:150px;background:rgba(10,20,35,.92);border:1px solid var(--line);border-radius:18px;padding:8px;display:none;gap:6px;z-index:15}\n#emoPanel.show{display:flex;animation:popin .25s}\n#emoPanel button{font-size:26px;padding:4px 6px;border-radius:12px}\n#emoPanel button:active{background:rgba(255,255,255,.15)}\n.bubble{position:absolute;font-size:38px;z-index:25;pointer-events:none;animation:bub 2s forwards;filter:drop-shadow(0 4px 8px rgba(0,0,0,.5))}\n@keyframes bub{0%{opacity:0;translate:0 10px;scale:.4}15%{opacity:1;translate:0 -6px;scale:1.2}80%{opacity:1;translate:0 -14px;scale:1}100%{opacity:0;translate:0 -30px}}\n.hand{display:flex;overflow-x:auto;padding:16px 12px calc(10px + env(safe-area-inset-bottom));-webkit-overflow-scrolling:touch;min-height:132px;align-items:flex-end}\n.hand:before,.hand:after{content:\"\";margin:auto}\n.hand .card{flex:none;margin-left:-18px;transition:translate .15s,scale .15s,filter .2s}\n.hand .card:first-of-type{margin-left:0}\n.hand .card.dim{filter:brightness(.62) saturate(.7)}\n.hand .card.ok{translate:0 -8px}\n.hand .card.sel{translate:0 -22px;scale:1.06;box-shadow:0 0 0 3px var(--gold),0 10px 20px rgba(0,0,0,.5);z-index:5}\n.hand .card.shake{animation:shake .35s}\n@keyframes shake{25%{translate:-6px 0}75%{translate:6px 0}}\n#fx{position:absolute;inset:0;pointer-events:none;z-index:40;overflow:hidden}\n\n/* карты */\n.card{position:relative;width:62px;height:90px;border-radius:9px;background:linear-gradient(160deg,#fff,#eceff5);color:#1b2233;box-shadow:0 2px 6px rgba(0,0,0,.4),inset 0 0 0 1px rgba(0,0,0,.08);flex:none}\n.card.red{color:#e0283e}\n.card .cr{position:absolute;left:5px;top:3px;font-weight:800;font-size:15px;line-height:1}\n.card .cr span{display:block;font-size:14px;margin-top:1px}\n.card .cr.b{left:auto;top:auto;right:5px;bottom:3px;transform:rotate(180deg)}\n.card .cm{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:34px;opacity:.9}\n.card.trump{box-shadow:0 2px 6px rgba(0,0,0,.4),inset 0 0 0 2px var(--gold)}\n.card.back{background:repeating-linear-gradient(45deg,#2b4fd8 0 6px,#1d3aa8 6px 12px);box-shadow:0 2px 6px rgba(0,0,0,.4),inset 0 0 0 3px #fff}\n@media (max-height:700px){.card{width:56px;height:80px}.pair{width:64px;height:86px}.hand{min-height:112px}.card .cm{font-size:30px}}\n</style>\n</head>\n<body>\n<div id=\"net\">Нет связи… переподключаемся</div>\n<div id=\"toast\"></div>\n<div id=\"dlg\"></div>\n<div id=\"splash\"><div class=\"logo\">🃏</div><div id=\"splashTx\">Загрузка…</div></div>\n\n<section class=\"screen\" id=\"s-setup\"></section>\n\n<section class=\"screen\" id=\"s-home\">\n  <div id=\"head\"></div>\n  <div id=\"body\"></div>\n  <div id=\"nav\">\n    <button data-tab=\"play\"><b>🎴</b>Играть</button>\n    <button data-tab=\"top\"><b>🏆</b>Рейтинг</button>\n    <button data-tab=\"trade\"><b>💸</b>Обмен<i class=\"bdg\" id=\"bdg\"></i></button>\n    <button data-tab=\"me\"><b>👤</b>Профиль</button>\n  </div>\n</section>\n\n<section class=\"screen\" id=\"s-game\">\n  <div class=\"gtop\">\n    <button class=\"iconbtn\" id=\"gResign\" title=\"Сдаться\">🏳️</button>\n    <div class=\"pot\"><span id=\"gPot\"></span><small id=\"gTurn\"></small></div>\n    <div class=\"iconbtn\" style=\"display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800\" id=\"gSec\"></div>\n  </div>\n  <div class=\"tbar\" id=\"tbar\"><i></i></div>\n  <div class=\"pl-row\" id=\"gOpp\"></div>\n  <div class=\"felt\" id=\"gFelt\"></div>\n  <div class=\"hint\" id=\"gHint\"></div>\n  <div class=\"acts\" id=\"gActs\"></div>\n  <div class=\"me-row pl-row\" id=\"gMe\"></div>\n  <div id=\"emoPanel\"></div>\n  <div class=\"hand\" id=\"gHand\"></div>\n  <div id=\"fx\"></div>\n  <div id=\"modal\"></div>\n</section>\n\n<script>\n(()=>{\n'use strict';\nconst tg=window.Telegram&&window.Telegram.WebApp;\nif(tg){try{tg.ready();tg.expand();tg.setHeaderColor('#0e1320');tg.setBackgroundColor('#0e1320');tg.disableVerticalSwipes&&tg.disableVerticalSwipes();}catch(e){}}\nconst $=s=>document.querySelector(s);\nconst esc=s=>String(s).replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]));\nconst SUIT={S:'♠',H:'♥',D:'♦',C:'♣'};\nconst RN=r=>({11:'J',12:'Q',13:'K',14:'A'}[r]||r);\nconst fmt=n=>String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g,' ');\nconst GR=[['#ff9a3c','#ff5e62'],['#36d1dc','#5b86e5'],['#a8e063','#56ab2f'],['#f7797d','#c471ed'],['#fbd786','#f7797d'],['#43cea2','#185a9d'],['#f093fb','#f5576c'],['#667eea','#764ba2'],['#f2994a','#f2c94c'],['#7f7fd5','#86a8e7']];\nconst hap=(t='light')=>{try{tg&&tg.HapticFeedback&&tg.HapticFeedback.impactOccurred(t)}catch(e){}};\nconst hapN=t=>{try{tg&&tg.HapticFeedback&&tg.HapticFeedback.notificationOccurred(t)}catch(e){}};\nconst sleep=ms=>new Promise(r=>setTimeout(r,ms));\nconst S={snap:null,tab:'play',stake:100,token:null,es:null,shown:'',built:'',E:null,U:{state:'idle'},T:{q:'',found:[],to:null},lb:null,\n  g:null,gid:null,sig:'',prevG:null,sel:null,deadlineAt:0,celebrated:null,knownIn:null,emoSeen:{}};\nwindow.__S=S;\nlet guest=null;try{guest=localStorage.getItem('gid')}catch(e){}\nif(!guest){guest=Array.from(crypto.getRandomValues(new Uint8Array(12))).map(b=>b.toString(16).padStart(2,'0')).join('');try{localStorage.setItem('gid',guest)}catch(e){}}\n\n/* ---------- сеть ---------- */\nasync function post(path,body){\n  const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});\n  let j={};try{j=await r.json()}catch(e){}\n  j._status=r.status;return j;\n}\nasync function login(){\n  try{\n    const r=await post('/api/auth',{initData:tg?tg.initData:'',guestId:guest});\n    if(r.token){S.token=r.token;return true}\n    $('#splashTx').textContent=r.error||'Ошибка входа';\n    return r._status===503?'retry':false;\n  }catch(e){$('#splashTx').textContent='Нет связи с сервером…';return 'retry'}\n}\nfunction applySnap(j){S.snap=j;$('#net').style.display='none';render()}\nfunction connect(){\n  if(S.es){S.es.close();S.es=null}\n  const es=new EventSource('/api/events?token='+S.token);S.es=es;\n  es.onopen=()=>{$('#net').style.display='none'};\n  es.onmessage=e=>{let j;try{j=JSON.parse(e.data)}catch(_){return}applySnap(j)};\n  es.onerror=()=>{\n    $('#net').style.display='block';es.close();if(S.es===es)S.es=null;\n    setTimeout(async()=>{if(S.es)return;const ok=await login();if(ok===true)connect();else setTimeout(()=>location.reload(),4000)},1500);\n  };\n}\nasync function act(type,data={}){\n  let r=await post('/api/action',{token:S.token,type,...data});\n  if(r._status===401){if(await login()===true){connect();r=await post('/api/action',{token:S.token,type,...data})}}\n  if(r.error&&r.error!=='AUTH'){toast(r.error);hapN('error')}\n  return r;\n}\nasync function refreshState(){\n  try{\n    const r=await fetch('/api/state?token='+S.token);\n    if(r.status===401){if(await login()===true)connect();return}\n    if(r.ok)applySnap(await r.json());\n    if(!S.es||S.es.readyState!==1)connect();\n  }catch(e){}\n}\nlet tt;function toast(m,ok){const t=$('#toast');t.textContent=m;t.className='show'+(ok?' ok':'');clearTimeout(tt);tt=setTimeout(()=>t.className='',2600)}\nfunction dlg(html){const d=$('#dlg');d.innerHTML='<div class=\"res\">'+html+'</div>';d.classList.add('show')}\nfunction closeDlg(){$('#dlg').classList.remove('show')}\n$('#dlg').onclick=e=>{if(e.target.id==='dlg')closeDlg()};\n\n/* ---------- общие куски ---------- */\nfunction av(p,sz=40){\n  const g=GR[p.color%GR.length];\n  return `<div class=\"av\" style=\"width:${sz}px;height:${sz}px;font-size:${Math.round(sz*.52)}px;background:linear-gradient(135deg,${g[0]},${g[1]})\"><span>${p.emoji}</span>${p.photo?`<img src=\"${esc(p.photo)}\" referrerpolicy=\"no-referrer\" onerror=\"this.remove()\">`:''}</div>`;\n}\nconst rk=r=>`<span class=\"rk\">${r.icon} ${esc(r.name)}</span>`;\nconst uname=u=>u.username?`<span class=\"un\">@${esc(u.username)}</span>`:'';\nconst coin='<i class=\"coin\"></i>';\nfunction showScreen(n){\n  if(S.shown===n)return;S.shown=n;\n  for(const id of ['setup','home','game'])$('#s-'+id).classList.toggle('active',id===n);\n  $('#splash').style.display='none';\n  if(tg){try{n==='game'?tg.enableClosingConfirmation():tg.disableClosingConfirmation()}catch(e){}}\n}\nfunction hms(ms){const m=Math.ceil(ms/60000);return m>=60?Math.floor(m/60)+' ч '+(m%60)+' мин':m+' мин'}\n\n/* ---------- профиль: редактор ---------- */\nfunction prevP(){const m=S.snap.me,E=S.E;return{emoji:E.emoji,color:E.color,photo:E.usePhoto?m.photoUrl:null}}\nfunction editorHTML(first){\n  const m=S.snap.me,E=S.E,cfg=S.snap.cfg,locked=!first&&m.unameWait>0;\n  return `<div class=\"ed\">\n  <div class=\"center\" id=\"edprev\">${av(prevP(),92)}</div>\n  <label class=\"lbl\">Имя (видят соперники)</label><input class=\"inp\" id=\"edname\" maxlength=\"16\" value=\"${esc(E.name)}\" placeholder=\"Как вас зовут?\" autocomplete=\"off\">\n  <label class=\"lbl\">Никнейм — уникальный, как в Telegram</label>\n  <div class=\"uwrap\"><span class=\"at\">@</span><input class=\"inp\" id=\"eduser\" maxlength=\"20\" value=\"${esc(E.username)}\" placeholder=\"username\" autocomplete=\"off\" autocapitalize=\"off\" autocorrect=\"off\" spellcheck=\"false\" ${locked?'disabled':''}><span class=\"ustat\" id=\"ustat\"></span></div>\n  <div class=\"note\" id=\"umsg\">${locked?'Ник можно менять раз в сутки (через '+hms(m.unameWait)+')':'5–20 символов: латиница, цифры и _. По нику вас найдут, чтобы отправить монеты.'}</div>\n  <label class=\"lbl\">Аватар</label><div class=\"egrid\">${cfg.emojis.map(e=>`<button class=\"eb ${e===E.emoji?'on':''}\" data-e=\"${e}\">${e}</button>`).join('')}</div>\n  <label class=\"lbl\">Цвет</label><div class=\"cgrid\">${GR.map((g,i)=>`<button class=\"cb ${i===E.color?'on':''}\" data-c=\"${i}\" style=\"background:linear-gradient(135deg,${g[0]},${g[1]})\"></button>`).join('')}</div>\n  ${m.hasPhoto?`<label class=\"lbl chk\"><input type=\"checkbox\" id=\"edphoto\" ${E.usePhoto?'checked':''}> Использовать моё фото из Telegram</label>`:''}\n  <div style=\"height:18px\"></div>\n  <button class=\"btn primary big\" id=\"edsave\">${first?'Начать игру 🎴':'Сохранить'}</button></div>`;\n}\nconst unameLocal=v=>(!/^[A-Za-z][A-Za-z0-9_]{4,19}$/.test(v)||/__/.test(v)||/_$/.test(v))?'5–20 символов: латиница, цифры и _, первая — буква':null;\nlet uTimer=0,uSeq=0;\nfunction setUStat(root,first,state,msg){\n  S.U={state,msg};\n  const st=root.querySelector('#ustat'),mg=root.querySelector('#umsg'),sv=root.querySelector('#edsave');if(!st)return;\n  st.textContent={ok:'✅',bad:'❌',wait:'⏳',idle:''}[state];\n  if(msg!==undefined){mg.textContent=msg;mg.className='note '+(state==='bad'?'bad':state==='ok'?'okc':'')}\n  if(sv)sv.classList.toggle('off',first&&state!=='ok');\n}\nfunction onUser(root,first,input){\n  let val=input.value.replace(/[^A-Za-z0-9_]/g,'').slice(0,20);input.value=val;S.E.username=val;\n  clearTimeout(uTimer);const my=S.snap.me;\n  if(my.username&&val===my.username)return setUStat(root,first,'ok','Это ваш текущий ник');\n  if(!val)return setUStat(root,first,'idle','5–20 символов: латиница, цифры и _. По нику вас найдут, чтобы отправить монеты.');\n  const e=unameLocal(val);if(e)return setUStat(root,first,'bad',e);\n  setUStat(root,first,'wait','Проверяем…');const seq=++uSeq;\n  uTimer=setTimeout(async()=>{\n    try{const r=await fetch('/api/uname?token='+S.token+'&q='+encodeURIComponent(val));const j=await r.json();\n      if(seq!==uSeq)return;j.free?setUStat(root,first,'ok','Ник свободен ✨'):setUStat(root,first,'bad',j.error||'Ник занят')}\n    catch(_){if(seq===uSeq)setUStat(root,first,'idle','Не удалось проверить ник')}\n  },350);\n}\nfunction bindEditor(root,first){\n  const upd=()=>{root.querySelector('#edprev').innerHTML=av(prevP(),92)};\n  const ui=root.querySelector('#eduser');\n  if(ui&&!ui.disabled)onUser(root,first,ui);\n  root.onclick=async e=>{\n    const eb=e.target.closest('.eb'),cb=e.target.closest('.cb');\n    if(eb){S.E.emoji=eb.dataset.e;root.querySelectorAll('.eb').forEach(b=>b.classList.toggle('on',b===eb));upd();hap()}\n    else if(cb){S.E.color=+cb.dataset.c;root.querySelectorAll('.cb').forEach(b=>b.classList.toggle('on',b===cb));upd();hap()}\n    else if(e.target.closest('#edsave')){\n      const my=S.snap.me,changed=S.E.username&&S.E.username!==my.username;\n      if((first||changed)&&!ui.disabled&&S.U.state!=='ok'){toast(S.U.state==='wait'?'Подождите, проверяем ник…':(S.U.msg||'Выберите свободный ник'));return}\n      const r=await act('profile',{name:S.E.name,username:S.E.username,emoji:S.E.emoji,color:S.E.color,usePhoto:S.E.usePhoto});\n      if(r.ok){hapN('success');if(!first){toast('Сохранено ✅',true);S.built=''}}\n    }\n  };\n  root.oninput=e=>{if(e.target.id==='edname')S.E.name=e.target.value;else if(e.target.id==='eduser')onUser(root,first,e.target)};\n  root.onchange=e=>{if(e.target.id==='edphoto'){S.E.usePhoto=e.target.checked;upd()}};\n}\nfunction initE(){const m=S.snap.me;S.E={name:m.name,username:m.username||m.suggest||'',emoji:m.emoji,color:m.color,usePhoto:m.usePhoto||(!m.ready&&m.hasPhoto)}}\n\n/* ---------- главная ---------- */\nfunction renderHead(){\n  const m=S.snap.me,r=m.rank;\n  const pct=r.to?Math.min(100,Math.round((m.rating-r.from)/(r.to-r.from)*100)):100;\n  $('#head').innerHTML=`<div id=\"hav\">${av(m,50)}</div>\n  <div class=\"who\"><div class=\"nm\">${esc(m.name)}</div><div style=\"display:flex;gap:8px;align-items:center;margin-top:2px\">${rk(r)}<span style=\"font-size:11px;color:var(--mut)\">⭐ ${m.rating}${r.to?' / '+r.to:''}</span></div><div class=\"xp\"><i style=\"width:${pct}%\"></i></div></div>\n  <div class=\"coins\">${coin}<span>${fmt(m.coins)}</span></div>`;\n  $('#hav').onclick=()=>setTab('me');\n  const n=(S.snap.offers||[]).filter(o=>o.dir==='in').length,b=$('#bdg');\n  b.textContent=n;b.style.display=n?'flex':'none';\n}\nfunction setTab(t){S.tab=t;S.built='';renderHome();if(t==='top')loadLB()}\nasync function loadLB(){\n  try{const r=await fetch('/api/leaderboard?token='+S.token);if(r.ok){S.lb=(await r.json()).top;if(S.tab==='top')renderHome()}}catch(e){}\n}\nfunction inviteBtn(){return S.snap.cfg.bot?`<button class=\"btn big\" id=\"bInvite\" style=\"margin-top:12px\">📨 Пригласить друга</button>`:''}\nfunction renderHome(){\n  const s=S.snap,m=s.me;renderHead();\n  document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('on',b.dataset.tab===S.tab));\n  const body=$('#body');\n  if(S.tab==='me'){\n    if(S.built==='me')return;S.built='me';initE();\n    const g=m.wins+m.losses,wr=g?Math.round(m.wins/g*100):0,r=m.rank;\n    const pct=r.to?Math.min(100,Math.round((m.rating-r.from)/(r.to-r.from)*100)):100;\n    body.innerHTML=`<div class=\"panel hero\">${av(m,96)}<div class=\"hn\">${esc(m.name)}</div><div class=\"hu\">@${esc(m.username)}</div>${rk(r)}\n      <div style=\"font-size:12px;color:var(--mut);margin:8px 0 4px\">⭐ ${m.rating}${r.to?' до звания «'+esc(s.cfg.ranks[r.idx+1].name)+'»: '+r.to:''}</div><div class=\"xp\"><i style=\"width:${pct}%\"></i></div>\n      <div class=\"stats\"><div><b>${m.wins}</b><span>Побед</span></div><div><b>${m.losses}</b><span>Поражений</span></div><div><b>${wr}%</b><span>Винрейт</span></div><div><b>${g}</b><span>Партий</span></div><div><b>${fmt(m.coins)}</b><span>Монет</span></div><div><b>${m.rating}</b><span>Рейтинг</span></div></div></div>\n      ${inviteBtn()}\n    <div class=\"sec\">Редактировать профиль</div><div class=\"panel\" id=\"edbox\">${editorHTML(false)}</div>\n    <div class=\"sec\">Звания</div><div class=\"ranks\">${s.cfg.ranks.map((r,i)=>`<div class=\"trow ${i===m.rank.idx?'cur':''}\"><span style=\"font-size:22px\">${r.icon}</span><div class=\"mid\"><b>${r.name}</b></div><span style=\"color:var(--mut);font-size:13px\">от ${r.min} ⭐</span></div>`).join('')}</div>\n    <div class=\"empty\" style=\"font-size:12px\">За победу +25 ⭐, за поражение −15 ⭐</div>`;\n    bindEditor($('#edbox'),false);\n    return;\n  }\n  if(S.tab==='trade'){\n    if(S.built!=='trade'){\n      S.built='trade';\n      body.innerHTML=`<div class=\"sec\" style=\"margin-top:4px\">Отправить монеты</div>\n      <div class=\"panel\"><div id=\"tsel\"></div>\n      <div class=\"uwrap\" id=\"tqwrap\"><span class=\"at\">@</span><input class=\"inp\" id=\"tq\" type=\"text\" maxlength=\"20\" placeholder=\"ник получателя\" autocomplete=\"off\" autocapitalize=\"off\" autocorrect=\"off\" spellcheck=\"false\" value=\"${esc(S.T.q)}\"><span class=\"ustat\"></span></div>\n      <div id=\"tres\" style=\"margin-top:8px\"></div>\n      <label class=\"lbl\">Сумма</label>\n      <input class=\"inp\" id=\"tamt\" type=\"text\" inputmode=\"numeric\" maxlength=\"7\" placeholder=\"Сколько монет?\" autocomplete=\"off\">\n      <div class=\"chips\" style=\"margin-top:8px\">${[50,100,250,500].map(x=>`<button class=\"achip\" data-amt=\"${x}\">${x}</button>`).join('')}</div>\n      <button class=\"btn primary big\" id=\"tSend\" style=\"margin-top:14px\">Отправить 💸</button>\n      <div class=\"note\">Перевод идёт строго по уникальному нику — ошибиться адресатом нельзя. Получатель должен принять монеты; не примет за 48 часов — вернутся к вам. Минимум ${s.cfg.minSend} монет.</div></div>\n      <div class=\"sec\">Предложения</div><div id=\"toffers\"></div>`;\n    }\n    updateTrade();return;\n  }\n  S.built=S.tab;\n  if(S.tab==='top'){\n    body.innerHTML=`<div class=\"sec\" style=\"margin-top:4px\">Лучшие игроки</div><div class=\"lb\">`+(S.lb?S.lb.map((u,i)=>`<div class=\"trow ${u.me?'mine':''}\"><div class=\"pl\">${i<3?['🥇','🥈','🥉'][i]:i+1}</div>${av(u,40)}<div class=\"mid\"><div class=\"nm\">${esc(u.name)}</div>${uname(u)} ${rk(u.rank)}</div><div style=\"text-align:right\"><b>⭐ ${u.rating}</b><div style=\"font-size:11px;color:var(--mut)\">${u.wins} поб.</div></div>${u.me?'':`<button class=\"btn payb\" data-pay=\"${i}\">💸</button>`}</div>`).join('')||'<div class=\"empty\">Пока никого нет</div>':'<div class=\"empty\">Загрузка…</div>')+'</div>';\n    return;\n  }\n  /* вкладка «Играть» */\n  const st=s.cfg.stakes;if(!st.includes(S.stake)||S.stake>m.coins){S.stake=[...st].reverse().find(x=>x<=m.coins&&x<=S.stake)||st[0]}\n  let h='';\n  if(m.daily<=0)h+=`<div class=\"daily\"><span style=\"font-size:30px\">🎁</span><div class=\"tx\"><b>Бонус готов!</b><br>Забери +${m.dailyAmount} монет</div><button class=\"btn primary\" id=\"bDaily\" style=\"padding:10px 16px\">Забрать</button></div>`;\n  else if(m.coins<st[0])h+=`<div class=\"daily\"><span style=\"font-size:30px\">💸</span><div class=\"tx\">Монеты почти закончились. Бонус через <b>${hms(m.daily)}</b></div></div>`;\n  if(s.myTable){\n    const t=s.tables.find(x=>x.id===s.myTable);\n    h+=`<div class=\"panel wait\"><div class=\"spin\"></div><div style=\"flex:1\"><b>Ищем соперника…</b><div style=\"color:var(--mut);font-size:13px\">Ставка ${t?t.stake:''} монет</div></div><button class=\"btn\" id=\"bCancel\" style=\"padding:10px 14px\">Отмена</button></div>`;\n  }else{\n    h+=`<div class=\"sec\" style=\"margin-top:4px\">Ставка</div><div class=\"chips\">${st.map(x=>`<button class=\"chip ${x===S.stake?'on':''}\" data-st=\"${x}\" ${x>m.coins?'disabled':''}>${x}</button>`).join('')}</div>\n    <div class=\"row2\"><button class=\"btn primary\" id=\"bQuick\" ${m.coins<st[0]?'disabled':''}>⚡ Быстрая игра</button><button class=\"btn blue\" id=\"bCreate\" ${m.coins<S.stake?'disabled':''}>➕ Создать стол</button></div>\n    <div style=\"font-size:12px;color:var(--mut);margin:8px 4px\">Победитель забирает банк, комиссия стола ${Math.round(s.cfg.fee*100)}%</div>`;\n  }\n  h+=`<button class=\"btn big\" id=\"bPractice\" style=\"margin-top:6px\" ${s.myTable?'disabled':''}>🤖 Тренировка с ботом <span style=\"color:var(--mut);font-weight:600;font-size:13px\">· без ставки</span></button>`;\n  const others=s.tables.filter(t=>!t.mine);\n  h+=`<div class=\"sec\">Открытые столы · 👥 ${s.online} онлайн</div>`+(others.length?others.map(t=>`<div class=\"trow\">${av(t.owner,42)}<div class=\"mid\"><div class=\"nm\">${esc(t.owner.name)}</div>${uname(t.owner)} ${rk(t.owner.rank)}</div><div class=\"stakeTag\">${coin}${t.stake}</div><button class=\"btn green\" data-join=\"${t.id}\" ${m.coins<t.stake||s.myTable?'disabled':''}>Играть</button></div>`).join(''):'<div class=\"empty\">Свободных столов нет.<br>Создайте свой или потренируйтесь с ботом!</div>')+inviteBtn();\n  body.innerHTML=h;\n}\n\n/* ---------- обмен ---------- */\nfunction updateTrade(){\n  const s=S.snap,sel=$('#tsel');if(!sel)return;\n  const T=S.T;\n  sel.innerHTML=T.to?`<div class=\"trow\" style=\"border-color:var(--gold)\">${av(T.to,42)}<div class=\"mid\"><div class=\"nm\">${esc(T.to.name)}</div>${uname(T.to)} ${rk(T.to.rank)}</div><button class=\"btn\" data-clear=\"1\">✕</button></div>`:'';\n  $('#tqwrap').style.display=T.to?'none':'';\n  $('#tres').innerHTML=T.to?'':(T.found.length?T.found.map((u,i)=>`<div class=\"trow\" data-pick=\"${i}\" style=\"cursor:pointer\">${av(u,38)}<div class=\"mid\"><div class=\"nm\">${esc(u.name)}</div>${uname(u)}</div><span style=\"color:var(--mut)\">Выбрать ›</span></div>`).join(''):(T.q.length>=2?'<div class=\"note\">Игрок с таким ником не найден</div>':''));\n  const of=[...(s.offers||[])].sort((a,b)=>(a.dir==='in'?0:1)-(b.dir==='in'?0:1));\n  $('#toffers').innerHTML=of.length?of.map(o=>o.dir==='in'\n    ?`<div class=\"offer in\"><div class=\"top\">${av(o.user,42)}<div class=\"mid\"><div class=\"nm\">${esc(o.user.name)}</div><div class=\"sub\">@${esc(o.user.username)} отправил(а) вам · ${hms(o.left)}</div></div><div class=\"amt p\">+${fmt(o.amount)} ${coin}</div></div><div class=\"row2\"><button class=\"btn green\" data-offer=\"${o.id}\" data-how=\"accept\">Принять</button><button class=\"btn\" data-offer=\"${o.id}\" data-how=\"decline\">Отклонить</button></div></div>`\n    :`<div class=\"offer\"><div class=\"top\">${av(o.user,42)}<div class=\"mid\"><div class=\"nm\">${esc(o.user.name)}</div><div class=\"sub\">@${esc(o.user.username)} · ждёт ответа · ${hms(o.left)}</div></div><div class=\"amt o\">−${fmt(o.amount)} ${coin}</div></div><div class=\"row2\"><button class=\"btn\" data-offer=\"${o.id}\" data-how=\"withdraw\">Отозвать</button></div></div>`).join('')\n    :'<div class=\"empty\">Пока нет предложений</div>';\n}\nfunction pickPlayer(u){S.T.to=u;S.T.found=[];S.T.q='';S.built='';renderHome();setTimeout(()=>{const a=$('#tamt');a&&a.focus()},50)}\nlet qT=0;\n$('#body').oninput=e=>{\n  if(e.target.id==='tamt'){e.target.value=e.target.value.replace(/\\D/g,'');return}\n  if(e.target.id==='tq'){\n    let v=e.target.value.replace(/[^A-Za-z0-9_@]/g,'').replace(/^@/,'');e.target.value=v;S.T.q=v;\n    clearTimeout(qT);\n    if(v.length<2){S.T.found=[];updateTrade();return}\n    qT=setTimeout(async()=>{\n      try{const r=await fetch('/api/find?token='+S.token+'&q='+encodeURIComponent(v));if(r.ok&&S.T.q===v){S.T.found=(await r.json()).list||[];updateTrade()}}catch(_){}\n    },250);\n  }\n};\nfunction inviteFriend(){\n  const bot=S.snap.cfg.bot;if(!bot)return;\n  const link='https://t.me/'+bot,text='Го сыграем в Дурака на монеты! 🃏';\n  const url='https://t.me/share/url?url='+encodeURIComponent(link)+'&text='+encodeURIComponent(text);\n  if(tg&&tg.openTelegramLink)tg.openTelegramLink(url);else window.open(url,'_blank');\n}\n$('#body').onclick=async e=>{\n  const c=e.target.closest('.chip');\n  if(c&&!c.disabled){S.stake=+c.dataset.st;hap();renderHome();return}\n  if(e.target.closest('#bInvite')){inviteFriend();return}\n  if(e.target.closest('#bDaily')){const r=await act('daily');if(r.ok){hapN('success');toast('+200 монет 🎁',true)}return}\n  if(e.target.closest('#bQuick')){hap('medium');act('quick',{stake:S.stake});return}\n  if(e.target.closest('#bCreate')){hap();act('create',{stake:S.stake});return}\n  if(e.target.closest('#bPractice')){hap('medium');act('practice');return}\n  if(e.target.closest('#bCancel')){act('cancel');return}\n  const j=e.target.closest('[data-join]');if(j&&!j.disabled){hap('medium');act('join',{table:j.dataset.join});return}\n  const pay=e.target.closest('[data-pay]');\n  if(pay){const u=S.lb[+pay.dataset.pay];if(u){hap();S.tab='trade';pickPlayer(u)}return}\n  const pk=e.target.closest('[data-pick]');\n  if(pk){const u=S.T.found[+pk.dataset.pick];if(u){hap();pickPlayer(u)}return}\n  if(e.target.closest('[data-clear]')){S.T.to=null;S.built='';renderHome();setTimeout(()=>{const q=$('#tq');q&&q.focus()},50);return}\n  const am=e.target.closest('[data-amt]');\n  if(am){$('#tamt').value=am.dataset.amt;hap();return}\n  if(e.target.closest('#tSend')){\n    if(!S.T.to)return toast('Сначала выберите получателя по нику');\n    const amount=parseInt($('#tamt').value,10)||0;\n    if(amount<S.snap.cfg.minSend)return toast('Минимум '+S.snap.cfg.minSend+' монет');\n    if(amount>S.snap.me.coins)return toast('Не хватает монет');\n    const u=S.T.to;\n    dlg(`<div style=\"font-size:42px\">💸</div><h2 style=\"font-size:22px\">Подтвердите перевод</h2>\n      <div class=\"who\">${av(u,52)}<div><div style=\"font-weight:800\">${esc(u.name)}</div><div class=\"un\" style=\"font-size:14px\">@${esc(u.username)}</div></div></div>\n      <div class=\"dl p\" style=\"color:var(--gold)\">${fmt(amount)} ${coin}</div>\n      <div class=\"sub\">Проверьте ник получателя. Монеты будут заморожены, пока он не примет перевод.</div>\n      <button class=\"btn primary big\" id=\"dgOk\">Отправить</button><div style=\"height:8px\"></div><button class=\"btn big\" id=\"dgNo\">Отмена</button>`);\n    $('#dgNo').onclick=closeDlg;\n    $('#dgOk').onclick=async()=>{\n      closeDlg();\n      const r=await act('send',{to:u.username,amount});\n      if(r.ok){hapN('success');toast('Отправлено ✅ Ждём ответа @'+u.username,true);S.T.to=null;S.built='';renderHome()}\n    };\n    return;\n  }\n  const of=e.target.closest('[data-offer]');\n  if(of){\n    const how=of.dataset.how,r=await act(how,{offer:of.dataset.offer});\n    if(r.ok){hapN('success');toast(how==='accept'?'Монеты получены 💰':how==='decline'?'Отклонено, монеты вернулись отправителю':'Отозвано, монеты вернулись к вам',true)}\n  }\n};\n$('#nav').onclick=e=>{const b=e.target.closest('button');if(b){hap();setTab(b.dataset.tab)}};\nsetInterval(()=>{if(S.shown==='home'&&S.tab==='top')loadLB()},20000);\n\n/* ================= игровой стол ================= */\nfunction cardHTML(c,cls=''){\n  const red=c.s==='H'||c.s==='D',id=c.s+c.r;\n  return `<div class=\"card ${red?'red':''} ${c.s===S.g.trump?'trump':''} ${cls}\" data-id=\"${id}\"><div class=\"cr\">${RN(c.r)}<span>${SUIT[c.s]}</span></div><div class=\"cm\">${SUIT[c.s]}</div><div class=\"cr b\">${RN(c.r)}<span>${SUIT[c.s]}</span></div></div>`;\n}\nconst beats=(d,a,t)=>d.s===a.s?d.r>a.r:(d.s===t&&a.s!==t);\nfunction ranksOn(g){const s=new Set();g.table.forEach(p=>{s.add(p.a.r);if(p.d)s.add(p.d.r)});return s}\nfunction playable(g,c){\n  if(g.over)return false;\n  if(g.iAttack){if(!g.table.length)return g.phase==='attack';return g.table.length<g.limit&&ranksOn(g).has(c.r)}\n  if(g.phase!=='attack')return false;\n  return g.table.some(p=>!p.d&&beats(c,p.a,g.trump));\n}\nfunction hint(g){\n  if(g.over)return '';\n  const un=g.table.some(p=>!p.d),all=g.table.length&&!un;\n  let t;\n  if(g.iAttack){\n    if(g.phase==='take')t='😈 Соперник берёт — можно подкинуть ещё';\n    else if(!g.table.length)t='⚔️ Ваш ход — выберите карту для атаки';\n    else if(un)t='⏳ Соперник отбивается…';\n    else t='✅ Отбито! Подкиньте или нажмите «Бито»';\n  }else if(g.phase==='take')t='📥 Вы берёте карты…';\n  else if(un)t=S.sel?'👆 Выберите, какую карту бить':'🛡️ Отбейте карты или возьмите';\n  else t='⏳ Соперник думает…';\n  if(!g.oppOnline&&!g.practice)t+=' · ⚠️ соперник не в сети';\n  return t;\n}\nconst center=r=>({x:r.left+r.width/2,y:r.top+r.height/2});\nfunction relRect(r){const f=$('#s-game').getBoundingClientRect();return{left:r.left-f.left,top:r.top-f.top,width:r.width,height:r.height}}\nfunction flyFrom(el,dx,dy,o={}){\n  if(!el.animate)return;\n  el.animate([{transform:`translate(${dx}px,${dy}px) scale(${o.sx||1},${o.sy||o.sx||1}) rotate(${o.rot||0}deg)`,opacity:o.op==null?1:o.op},{transform:'none',opacity:1}],\n    {duration:o.dur||360,delay:o.delay||0,easing:'cubic-bezier(.2,.85,.25,1)',fill:'backwards'});\n}\nfunction snapBefore(){\n  const m=new Map();\n  document.querySelectorAll('#gHand .card[data-id], #gFelt .pair .card[data-id]').forEach(el=>{\n    m.set(el.dataset.id,{rect:el.getBoundingClientRect(),node:el,where:el.closest('#gHand')?'hand':'table'});\n  });\n  return m;\n}\nfunction ghost(v,to,delay,spin){\n  const f=$('#fx'),r=relRect(v.rect),g=v.node.cloneNode(true);\n  g.classList.remove('ok','dim','sel');\n  g.style.cssText+=`;position:absolute;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;margin:0;translate:none;scale:none`;\n  f.appendChild(g);\n  const tx=to.x-(v.rect.left+v.rect.width/2),ty=to.y-(v.rect.top+v.rect.height/2);\n  const a=g.animate([{transform:'none',opacity:1},{transform:`translate(${tx}px,${ty}px) scale(.55) rotate(${spin}deg)`,opacity:0}],{duration:480,delay,easing:'cubic-bezier(.5,0,.75,.3)',fill:'forwards'});\n  a.onfinish=()=>g.remove();setTimeout(()=>g.remove(),1500);\n}\nfunction callout(t){\n  const f=$('#gFelt');const c=document.createElement('div');c.className='callout';c.textContent=t;f.appendChild(c);setTimeout(()=>c.remove(),1150);\n}\nfunction bubble(side,e){\n  const host=$(side==='opp'?'#gOpp':'#gMe');const b=document.createElement('div');b.className='bubble';b.textContent=e;\n  b.style.left=side==='opp'?'70px':'70px';b.style.top='-8px';host.appendChild(b);setTimeout(()=>b.remove(),2100);\n}\nfunction handleEmote(g){\n  const seen=S.emoSeen[g.id];\n  if(seen===undefined){S.emoSeen[g.id]=g.oppEmote?g.oppEmote.id:0;return}\n  if(g.oppEmote&&g.oppEmote.id>seen){S.emoSeen[g.id]=g.oppEmote.id;bubble('opp',g.oppEmote.e);hap()}\n}\nfunction animateDeal(){\n  const deck=$('#gFelt .deckbox');const dc=deck?center(deck.getBoundingClientRect()):{x:40,y:300};\n  document.querySelectorAll('#gHand .card[data-id]').forEach((el,i)=>{\n    const r=el.getBoundingClientRect(),c=center(r);\n    flyFrom(el,dc.x-c.x,dc.y-c.y,{delay:200+i*110,dur:520,rot:-30,sx:.6});\n  });\n  document.querySelectorAll('#gOpp .fan .card').forEach((el,i)=>{\n    const r=el.getBoundingClientRect(),c=center(r);\n    flyFrom(el,dc.x-c.x,dc.y-c.y,{delay:260+i*110,dur:520,rot:30,sx:.9});\n  });\n  const tc=document.querySelector('#gFelt .trumpc');\n  if(tc&&tc.animate)tc.animate([{opacity:0,transform:'scale(.2) rotate(-120deg)'},{opacity:1,transform:'none'}],{duration:600,delay:60,easing:'cubic-bezier(.2,1.3,.4,1)',fill:'backwards'});\n}\nfunction animateDiff(B,g,pg){\n  const els=[...document.querySelectorAll('#gHand .card[data-id], #gFelt .pair .card[data-id]')];\n  const present=new Set(els.map(e=>e.dataset.id));\n  const deck=$('#gFelt .deckbox'),fan=$('#gOpp .fan'),disc=$('#gFelt .discardbox');\n  const dc=deck?center(deck.getBoundingClientRect()):{x:40,y:300};\n  const oc=fan?center(fan.getBoundingClientRect()):{x:300,y:100};\n  const xc=disc?center(disc.getBoundingClientRect()):{x:360,y:300};\n  let nd=0,no=0,iTook=false;\n  for(const el of els){\n    const id=el.dataset.id,r=el.getBoundingClientRect(),old=B.get(id),inHand=!!el.closest('#gHand');\n    if(old){\n      const dx=old.rect.left-r.left,dy=old.rect.top-r.top;\n      if(Math.abs(dx)+Math.abs(dy)>3)flyFrom(el,dx,dy,{dur:360});\n      if(old.where==='table'&&inHand)iTook=true;\n    }else if(inHand){const c=center(r);flyFrom(el,dc.x-c.x,dc.y-c.y,{delay:nd++*90,dur:480,rot:-25,sx:.6})}\n    else{const c=center(r);flyFrom(el,oc.x-c.x,oc.y-c.y,{delay:no++*110,dur:420,rot:20,sx:.65})}\n  }\n  const gone=[];B.forEach((v,id)=>{if(v.where==='table'&&!present.has(id))gone.push(v)});\n  if(gone.length){\n    const defIsOpp=pg&&pg.iAttack;                       // защищался соперник\n    const took=pg&&(pg.table.some(p=>!p.d)||pg.phase==='take');\n    if(took&&defIsOpp){gone.forEach((v,i)=>ghost(v,oc,i*70,40));callout('Соперник берёт 😈')}\n    else if(!took){gone.forEach((v,i)=>ghost(v,xc,i*70,-60));callout('Бито! ✅');hap()}\n  }\n  if(iTook){callout('Берёте 📥')}\n}\nfunction drawGame(g,B,pg,deal){\n  const m=S.snap.me;S.g=g;\n  const sc=S.sel?g.hand.find(c=>c.s+c.r===S.sel):null;\n  $('#gPot').innerHTML=g.practice?'🤖 Тренировка':`${coin} ${fmt(g.stake*2)} <span style=\"font-weight:600;color:#a8e8c8\">банк</span>`;\n  $('#gTurn').textContent=g.over?'Игра окончена':g.turn?'Ваш ход':'Ход соперника';\n  const opp=$('#gOpp');opp.classList.toggle('active',!g.turn&&!g.over);\n  opp.innerHTML=`${av(g.opp,40)}<div><div class=\"nm\">${esc(g.opp.name)} ${!g.turn&&!g.over?'<span class=\"dots\"><i></i><i></i><i></i></span>':''}</div>${uname(g.opp)} ${rk(g.opp.rank)}</div><div class=\"fan\">${Array.from({length:Math.min(g.oppCount,9)},()=>'<div class=\"card back\"></div>').join('')}<span class=\"cnt\">${g.oppCount}</span></div>`;\n  let tb='';\n  g.table.forEach((p,i)=>{\n    const tgt=sc&&!p.d&&beats(sc,p.a,g.trump);\n    tb+=`<div class=\"pair ${tgt?'tgt':''}\" data-i=\"${i}\">${cardHTML(p.a,'a')}${p.d?cardHTML(p.d,'d'):''}</div>`;\n  });\n  const deckH=g.deck>0?`<div class=\"deckbox\"><div class=\"dn\">${g.deck}</div>${cardHTML(g.trumpCard,'trumpc')}<div class=\"card back\"></div></div>`:`<div class=\"deckbox\"><div class=\"dn\">0</div></div>`;\n  const discH=`<div class=\"discardbox ${g.discard?'':'e'}\">${g.discard?`<div class=\"dn\">${g.discard}</div>`:''}<div class=\"card back\"></div></div>`;\n  $('#gFelt').innerHTML=deckH+discH+`<div class=\"trumpTag\" style=\"${g.trump==='H'||g.trump==='D'?'color:#ff8a98':''}\">Козырь ${SUIT[g.trump]}</div><div class=\"tbl\">${tb}</div>`;\n  const un=g.table.some(p=>!p.d),all=g.table.length&&!un;let a='';\n  if(!g.over){\n    if(!g.iAttack&&g.phase==='attack'&&un)a=`<button class=\"btn red\" id=\"aTake\">Беру</button>`;\n    else if(g.iAttack&&(g.phase==='take'||all))a=`<button class=\"btn green\" id=\"aDone\">${g.phase==='take'?'Готово':'Бито'}</button>`;\n  }\n  $('#gActs').innerHTML=a;\n  $('#gHint').textContent=hint(g);\n  const me=$('#gMe');me.classList.toggle('active',g.turn&&!g.over);\n  me.innerHTML=`${av(m,30)}<span>${esc(m.name)}</span>${rk(m.rank)}<span style=\"font-size:12px;color:#a8e8c8\">${g.iAttack?'⚔️':'🛡️'}</span><button class=\"emobtn\" id=\"emoBtn\">😀</button>`;\n  $('#gHand').innerHTML=g.hand.map(c=>{const id=c.s+c.r,ok=playable(g,c);return cardHTML(c,(ok?'ok':'dim')+(S.sel===id?' sel':''))}).join('');\n  if(deal)animateDeal();else if(B)animateDiff(B,g,pg);\n  /* результат */\n  const mod=$('#modal');\n  if(g.over&&g.result){\n    const r=g.result,w=r.res==='win';\n    const why=r.reason==='timeout'?(w?'Соперник не успел сходить':'Вы не успели сходить'):r.reason==='resign'?(w?'Соперник сдался':'Вы сдались'):'';\n    if(!mod.classList.contains('show')){\n      mod.innerHTML=`<div class=\"res\"><div class=\"bigemo\">${w?'🏆':r.res==='draw'?'🤝':'😔'}</div><h2>${g.practice?(w?'Вы победили бота!':r.res==='draw'?'Ничья':'Бот оказался хитрее'):(w?'Победа!':r.res==='draw'?'Ничья':'Поражение')}</h2>\n      ${g.practice?'<div class=\"sub\">Тренировка — монеты и рейтинг не меняются</div>':`<div class=\"dl ${r.coins>0?'p':r.coins<0?'n':''}\" id=\"resCoins\" data-v=\"${r.coins}\">${r.coins>0?'+':''}0 ${coin}</div>\n      <div class=\"sub\">${r.rating?(r.rating>0?'+':'')+r.rating+' ⭐ рейтинг':'Рейтинг не изменился'}${why?'<br>'+why:''}</div>`}\n      <button class=\"btn primary big\" id=\"rAgain\">Играть ещё</button><div style=\"height:8px\"></div><button class=\"btn big\" id=\"rMenu\">В меню</button></div>`;\n      mod.classList.add('show');\n      const el=$('#resCoins');if(el){const v=+el.dataset.v,t0=performance.now();const step=t=>{const k=Math.min(1,(t-t0)/900);el.innerHTML=(v>0?'+':'')+Math.round(v*(1-Math.pow(1-k,3)))+' '+coin;if(k<1)requestAnimationFrame(step)};requestAnimationFrame(step)}\n    }\n    if(S.celebrated!==g.id){S.celebrated=g.id;if(w){hapN('success');confetti()}else hapN('warning')}\n  }else mod.classList.remove('show');\n  tick();\n}\nfunction renderGame(){\n  const g=S.snap.game;\n  S.deadlineAt=Date.now()+g.left;\n  handleEmote(g);\n  const sig=JSON.stringify([g.id,g.hand,g.table,g.deck,g.discard,g.oppCount,g.turn,g.iAttack,g.phase,g.over,g.result,g.oppOnline,g.opp.name,g.opp.emoji,g.limit,S.snap.me.name,S.snap.me.rank.idx]);\n  if(sig===S.sig)return;\n  const deal=S.gid!==g.id;\n  const B=!deal&&S.shown==='game'?snapBefore():null;\n  const pg=deal?null:S.prevG;\n  if(deal){S.gid=g.id;S.sel=null;$('#emoPanel').classList.remove('show');$('#modal').classList.remove('show');$('#fx').innerHTML=''}\n  else if(pg&&(pg.turn!==g.turn||pg.table.length!==g.table.length))S.sel=null;\n  S.sig=sig;\n  drawGame(g,B,pg,deal);\n  S.prevG=g;\n}\nfunction confetti(){\n  const root=$('#s-game');\n  for(let i=0;i<30;i++){\n    const d=document.createElement('div');d.className='fall';d.textContent=['🪙','✨','🎉','♠️','♥️'][i%5];\n    d.style.left=Math.random()*100+'%';d.style.animationDuration=(1.6+Math.random()*1.6)+'s';d.style.animationDelay=Math.random()*.5+'s';\n    root.appendChild(d);setTimeout(()=>d.remove(),4200);\n  }\n}\nfunction tick(){\n  const g=S.snap&&S.snap.game;if(S.shown!=='game'||!g)return;\n  if(g.over){$('#gSec').textContent='';$('#tbar i').style.width='0%';return}\n  const left=Math.max(0,S.deadlineAt-Date.now()),tot=S.snap.cfg.turn;\n  $('#tbar i').style.width=Math.min(100,left/tot*100)+'%';\n  $('#tbar').classList.toggle('low',left<10000);\n  $('#gSec').textContent=Math.ceil(left/1000);\n}\nsetInterval(tick,200);\n\n$('#gHand').onclick=async e=>{\n  const el=e.target.closest('.card');if(!el)return;\n  const g=S.snap.game;if(!g||g.over)return;\n  const id=el.dataset.id,c=g.hand.find(x=>x.s+x.r===id);if(!c)return;\n  const bad=m=>{el.classList.remove('shake');void el.offsetWidth;el.classList.add('shake');hapN('error');toast(m)};\n  if(g.iAttack){\n    if(!playable(g,c))return bad(g.table.length?(g.table.length>=g.limit?'Больше подкинуть нельзя (лимит '+g.limit+')':'Подкинуть можно карту того же достоинства, что на столе'):'Сейчас нельзя атаковать');\n    hap();act('attack',{card:id});return;\n  }\n  if(g.phase!=='attack'||!g.table.some(p=>!p.d))return bad('Сейчас нечем отбиваться');\n  const tg2=[];g.table.forEach((p,i)=>{if(!p.d&&beats(c,p.a,g.trump))tg2.push(i)});\n  if(!tg2.length)return bad('Эта карта не бьёт');\n  if(tg2.length===1){hap();act('defend',{card:id,idx:tg2[0]});return}\n  S.sel=S.sel===id?null:id;hap();drawGame(g,null,null,false);\n};\n$('#gFelt').onclick=e=>{\n  const pr=e.target.closest('.pair.tgt');if(!pr||!S.sel)return;\n  hap();const card=S.sel;S.sel=null;act('defend',{card,idx:+pr.dataset.i});\n};\n$('#gActs').onclick=e=>{\n  if(e.target.closest('#aTake')){hap('medium');act('take')}\n  if(e.target.closest('#aDone')){hap('medium');act('done')}\n};\n$('#gMe').onclick=e=>{\n  if(!e.target.closest('#emoBtn'))return;\n  const p=$('#emoPanel');\n  if(!p.innerHTML)p.innerHTML=S.snap.cfg.emotes.map(x=>`<button data-e=\"${x}\">${x}</button>`).join('');\n  p.classList.toggle('show');hap();\n};\n$('#emoPanel').onclick=e=>{\n  const b=e.target.closest('button');if(!b)return;\n  $('#emoPanel').classList.remove('show');bubble('me',b.dataset.e);hap();act('emote',{e:b.dataset.e});\n};\n$('#gResign').onclick=()=>{\n  const g=S.snap.game;if(!g||g.over)return;\n  const msg=g.practice?'Закончить тренировку?':'Сдаться? Ставка достанется сопернику.';\n  const go=()=>act('resign');\n  if(tg&&tg.showConfirm)tg.showConfirm(msg,ok=>ok&&go());else if(confirm(msg))go();\n};\n$('#modal').onclick=async e=>{\n  if(e.target.closest('#rMenu')){await act('leave');S.tab='play';S.built=''}\n  else if(e.target.closest('#rAgain')){\n    const g=S.snap.game,st=g.stake,pr=g.practice;await act('leave');S.tab='play';S.built='';\n    const r=await act(pr?'practice':'quick',pr?{}:{stake:st});if(r.error&&!pr)S.stake=st;\n  }\n};\n\n/* ---------- главный рендер ---------- */\nfunction render(){\n  const s=S.snap;if(!s)return;\n  const needSetup=!s.me.ready||s.me.needUsername;\n  if(needSetup){\n    if(S.shown!=='setup'||!S.E){\n      initE();\n      const old=s.me.ready&&s.me.needUsername;\n      $('#s-setup').innerHTML=`<h1>${old?'Выберите ник':'Добро пожаловать!'}</h1><p>${old?'Теперь у каждого игрока уникальный @ник, как в Telegram':'Создайте профиль — вас увидят соперники'}</p><div class=\"panel\" style=\"margin-top:14px\">${editorHTML(true)}</div><div style=\"text-align:center;color:var(--mut);font-size:13px\">${old?'':'🎁 Стартовый бонус: '+fmt(1000)+' монет'}</div>`;\n      bindEditor($('#s-setup'),true);\n    }\n    showScreen('setup');return;\n  }\n  const inc=(s.offers||[]).filter(o=>o.dir==='in');\n  if(S.knownIn===null)S.knownIn=new Set(inc.map(o=>o.id));\n  else for(const o of inc)if(!S.knownIn.has(o.id)){S.knownIn.add(o.id);toast('💸 @'+o.user.username+' отправил(а) вам '+o.amount+' монет',true);hapN('success')}\n  if(s.game){showScreen('game');renderGame();return}\n  if(S.gid){S.gid=null;S.sig='';S.prevG=null;S.sel=null;$('#modal').classList.remove('show');$('#fx').innerHTML=''}\n  showScreen('home');\n  if(S.tab==='me'&&S.built==='me'){renderHead();return}\n  if(S.tab==='trade'&&S.built==='trade'){renderHead();updateTrade();return}\n  renderHome();\n}\ndocument.addEventListener('visibilitychange',()=>{if(!document.hidden&&S.token)refreshState()});\n(async()=>{\n  for(let i=0;;i++){\n    const ok=await login();\n    if(ok===true){connect();return}\n    if(ok!=='retry'){setTimeout(()=>location.reload(),6000);return}\n    await sleep(2500);\n  }\n})();\n})();\n</script>\n</body>\n</html>\n";

/* ================= хранилище ================= */
const db = { users: {}, offers: [] };
const unameIdx = new Map();   // ник (lowercase) -> uid
const sessions = new Map();   // token -> {uid, t}
const clients = new Map();    // uid -> Set(res)
const lastActive = new Map();
const tables = new Map();
const games = new Map();
const userGame = new Map();
const userTable = new Map();
const nid = () => crypto.randomBytes(5).toString('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isBot = id => !!(db.users[id] && db.users[id].isBot);
let booted = false;

async function rPipeline(cmds) {
  const r = await fetch(R_URL + '/pipeline', {
    method: 'POST', headers: { Authorization: 'Bearer ' + R_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds), signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error('redis http ' + r.status);
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error('redis: плохой ответ');
  const bad = j.find(x => x && x.error);
  if (bad) throw new Error('redis: ' + bad.error);
  return j.map(x => x.result);
}
function pairs(a) {
  if (Array.isArray(a)) { const o = {}; for (let i = 0; i + 1 < a.length; i += 2) o[a[i]] = a[i + 1]; return o; }
  return a || {};
}
function parseAll(obj) {
  const out = {};
  for (const [k, v] of Object.entries(pairs(obj))) { try { out[k] = typeof v === 'string' ? JSON.parse(v) : v; } catch (e) {} }
  return out;
}
async function loadAll() {
  if (USE_REDIS) {
    const [u, g, o] = await rPipeline([['HGETALL', 'durak:users'], ['HGETALL', 'durak:games'], ['GET', 'durak:offers']]);
    let offers = []; try { offers = o ? JSON.parse(o) : []; } catch (e) {}
    return { users: parseAll(u), games: parseAll(g), offers };
  }
  try {
    const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return { users: d.users || {}, games: d.games || {}, offers: d.offers || [] };
  } catch (e) { return { users: {}, games: {}, offers: [] }; }
}

const dirty = { u: new Set(), g: new Set(), dg: new Set(), o: false };
let flushT = null, flushing = false;
const anyDirty = () => dirty.u.size || dirty.g.size || dirty.dg.size || dirty.o;
function scheduleFlush(ms) { if (!flushT) flushT = setTimeout(flush, ms || FLUSH_MS); }
function markU(id) { const u = db.users[id]; if (u && !u.isBot) { dirty.u.add(id); scheduleFlush(); } }
function markG(g) { if (g && !g.practice) { dirty.g.add(g.id); scheduleFlush(); } }
function markO() { dirty.o = true; scheduleFlush(); }
async function flush() {
  flushT = null;
  if (!booted) return;
  if (flushing) return scheduleFlush();
  flushing = true;
  const u = [...dirty.u], g = [...dirty.g], dg = [...dirty.dg], o = dirty.o;
  dirty.u.clear(); dirty.g.clear(); dirty.dg.clear(); dirty.o = false;
  let failed = false;
  try {
    if (USE_REDIS) {
      const cmds = [];
      for (const id of u) if (db.users[id] && !db.users[id].isBot) cmds.push(['HSET', 'durak:users', id, JSON.stringify(db.users[id])]);
      for (const id of g) { const x = games.get(id); if (x && !x.practice) cmds.push(['HSET', 'durak:games', id, JSON.stringify(x)]); }
      for (const id of dg) cmds.push(['HDEL', 'durak:games', id]);
      if (o) cmds.push(['SET', 'durak:offers', JSON.stringify(db.offers)]);
      for (let i = 0; i < cmds.length; i += 100) await rPipeline(cmds.slice(i, i + 100));
    } else {
      const users = {}; for (const [id, x] of Object.entries(db.users)) if (!x.isBot) users[id] = x;
      const gs = {}; for (const [id, x] of games) if (!x.practice) gs[id] = x;
      fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify({ users, games: gs, offers: db.offers }));
      fs.renameSync(DATA_FILE + '.tmp', DATA_FILE);
    }
  } catch (e) {
    failed = true;
    console.error('save error:', e.message);
    u.forEach(x => dirty.u.add(x)); g.forEach(x => dirty.g.add(x)); dg.forEach(x => dirty.dg.add(x)); if (o) dirty.o = true;
  }
  flushing = false;
  if (anyDirty()) scheduleFlush(failed ? 3000 : FLUSH_MS);
}
async function flushNow() {
  if (flushT) { clearTimeout(flushT); flushT = null; }
  for (let i = 0; i < 100 && flushing; i++) await sleep(50);
  await flush();
}
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { try { await flushNow(); } catch (e) {} process.exit(0); });

function initFrom(data) {
  db.users = data.users; db.offers = Array.isArray(data.offers) ? data.offers : [];
  for (const u of Object.values(db.users)) if (u.username) unameIdx.set(u.username.toLowerCase(), u.id);
  for (const g of Object.values(data.games)) {            // партии переживают перезапуск сервера
    if (!g || !Array.isArray(g.players) || g.players.some(p => !db.users[p])) continue;
    games.set(g.id, g);
    for (const p of g.players) userGame.set(p, g.id);
    if (!g.over) g.deadline = Date.now() + TURN_MS;
  }
  for (const u of Object.values(db.users)) {              // ставки без партии возвращаются
    const gid = userGame.get(u.id), g = gid && games.get(gid);
    if (u.escrow > 0 && !(g && !g.over)) { u.coins += u.escrow; u.escrow = 0; markU(u.id); }
  }
}

/* ================= профили, ники ================= */
function rankOf(r) {
  let i = 0;
  for (let k = 0; k < RANKS.length; k++) if (r >= RANKS[k].min) i = k;
  const nx = RANKS[i + 1];
  return { idx: i, name: RANKS[i].name, icon: RANKS[i].icon, from: RANKS[i].min, to: nx ? nx.min : null };
}
function pub(u) {
  return { id: u.id, name: u.name, username: u.username || '', emoji: u.emoji, color: u.color, photo: u.usePhoto && u.photo ? u.photo : null, rating: u.rating, rank: rankOf(u.rating) };
}
function dailyWait(u) {
  const cd = u.coins < STAKES[0] ? 2 * 3600e3 : 24 * 3600e3;
  return Math.max(0, (u.lastDaily || 0) + cd - Date.now());
}
const RESERVED = new Set(['admin', 'administrator', 'support', 'telegram', 'durak', 'moderator', 'system', 'official', 'root', 'owner', 'service', 'bot', 'null', 'undefined']);
const UNAME_RE = /^[A-Za-z][A-Za-z0-9_]{4,19}$/;
function unameCheck(name, uid) {
  if (!UNAME_RE.test(name) || /__/.test(name) || /_$/.test(name)) return 'Ник: 5–20 символов, только латиница, цифры и _, начинается с буквы';
  const l = name.toLowerCase();
  if (RESERVED.has(l)) return 'Этот ник недоступен';
  const owner = unameIdx.get(l);
  if (owner && owner !== uid) return 'Этот ник уже занят';
  return null;
}
function meView(u) {
  const wait = u.username ? unameWaitOf(u) : 0;
  let suggest = '';
  if (!u.username && u.tgUser && !unameCheck(u.tgUser, u.id)) suggest = u.tgUser;
  return {
    id: u.id, name: u.name, username: u.username || '', needUsername: !u.username, suggest, unameWait: wait,
    emoji: u.emoji, color: u.color, ready: !!(u.ready && u.username),
    photo: u.usePhoto && u.photo ? u.photo : null, photoUrl: u.photo || null, usePhoto: !!u.usePhoto, hasPhoto: !!u.photo,
    coins: u.coins, rating: u.rating, wins: u.wins, losses: u.losses, rank: rankOf(u.rating),
    daily: dailyWait(u), dailyAmount: 200,
  };
}
function cleanName(s) {
  s = String(s || '').replace(/[<>\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, 16).join('').trim();
}
function photoOk(u) { return typeof u === 'string' && /^https:\/\/[a-z0-9.-]*(t\.me|telegram\.org|telesco\.pe)\//i.test(u); }

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
  let u = db.users[uid], changed = false;
  if (!u) {
    u = db.users[uid] = {
      id: uid, name: cleanName(tg && (tg.first_name || tg.username)) || 'Игрок', username: '', unameAt: 0, ready: false,
      emoji: EMOJIS[crypto.randomInt(EMOJIS.length)], color: crypto.randomInt(COLORS), usePhoto: false,
      coins: START_COINS, rating: 0, wins: 0, losses: 0, escrow: 0, lastDaily: 0, created: Date.now(),
    };
    changed = true;
  }
  if (tg && tg.username && u.tgUser !== String(tg.username).slice(0, 32)) { u.tgUser = String(tg.username).slice(0, 32); changed = true; }
  if (tg && photoOk(tg.photo_url) && u.photo !== tg.photo_url) { u.photo = tg.photo_url; changed = true; }
  const token = crypto.randomBytes(16).toString('hex');
  sessions.set(token, { uid, t: Date.now() });
  if (changed) markU(uid);
  return { token };
}

/* ================= логика «Дурака» ================= */
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
function startGame(aId, bId, stake, practice) {
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
    id: nid(), players: [aId, bId], stake, practice: !!practice, deck, trump, trumpCard, hands, table: [], attacker: att,
    defender: att === aId ? bId : aId, phase: 'attack', limit: 5, first: true, discard: 0,   // в первом круге — не больше 5 карт
    deadline: Date.now() + TURN_MS, over: false, result: null, born: Date.now(), emote: {},
  };
  games.set(g.id, g);
  for (const id of g.players) {
    userGame.set(id, g.id);
    const t = userTable.get(id); if (t) { tables.delete(t); userTable.delete(id); }
  }
  markG(g);
  return g;
}
function dropGame(g) {
  for (const p of g.players) {
    if (userGame.get(p) === g.id) userGame.delete(p);
    if (isBot(p)) delete db.users[p];
  }
  games.delete(g.id);
  if (!g.practice) { dirty.dg.add(g.id); scheduleFlush(); }
}
function refill(g) {
  for (const id of [g.attacker, g.defender]) while (g.hands[id].length < 6 && g.deck.length) g.hands[id].push(g.deck.pop());
}
function settle(g, winner, reason) {
  if (g.over) return;
  g.over = true; g.deadline = 0;
  const [a, b] = g.players;
  const res = { winner, reason, delta: {} };
  if (g.practice) {                                    // тренировка: без монет и рейтинга
    for (const id of g.players) res.delta[id] = { coins: 0, rating: 0 };
    g.result = res; return;
  }
  const pot = g.stake * 2, fee = Math.floor(pot * FEE);
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
  markU(a); markU(b); markG(g);
}
function finishRound(g, took) {
  const cards = [];
  g.table.forEach(p => { cards.push(p.a); if (p.d) cards.push(p.d); });
  if (took) g.hands[g.defender].push(...cards);
  else g.discard += cards.length;
  g.table = [];
  g.first = false;
  refill(g);
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

/* ================= бот-соперник (тренировка) ================= */
function makeBot() {
  const id = 'bot' + nid();
  db.users[id] = {
    id, isBot: true, name: BOT_NAMES[crypto.randomInt(BOT_NAMES.length)], username: '', emoji: '🤖', color: crypto.randomInt(COLORS),
    ready: true, coins: 0, rating: crypto.randomInt(40, 320), wins: 0, losses: 0, escrow: 0,
  };
  return db.users[id];
}
function botMove(g, bid) {
  const hand = g.hands[bid], tr = g.trump;
  const cost = c => (c.s === tr ? 100 : 0) + c.r;
  const sorted = hand.slice().sort((a, b) => cost(a) - cost(b));
  const ranks = ranksOnTable(g);
  const act = (type, extra) => gameMove(bid, Object.assign({ type }, extra));
  let err = null;
  if (g.attacker === bid) {
    const canAdd = g.table.length < g.limit;
    if (g.phase === 'take') {
      const c = canAdd && sorted.find(x => ranks.has(x.r));
      err = c ? act('attack', { card: cid(c) }) : act('done');
    } else if (!g.table.length) {
      err = act('attack', { card: cid(sorted[0]) });
    } else {
      const c = canAdd && sorted.find(x => ranks.has(x.r) && ((x.s !== tr && x.r <= 11) || !g.deck.length));
      err = c ? act('attack', { card: cid(c) }) : act('done');
    }
  } else {
    const idx = g.table.findIndex(p => !p.d);
    if (idx < 0) return;
    const pair = g.table[idx];
    const c = sorted.find(x => beats(x, pair.a, tr));
    const wasteTrump = c && c.s === tr && pair.a.s !== tr && pair.a.r <= 8 && g.deck.length > 4 && hand.length < 9 && Math.random() < 0.5;
    err = c && !wasteTrump ? act('defend', { card: cid(c), idx }) : act('take');
  }
  if (err) { console.error('bot error:', err); if (g.attacker === bid) act('done'); else act('take'); }
}
setInterval(() => {
  const now = Date.now(); let ch = false;
  for (const g of games.values()) {
    if (!g.practice || g.over) continue;
    const bid = g.players.find(isBot);
    if (!bid) continue;
    const human = other(g, bid);
    if (onMove(g) === bid) {
      if (!g.botDue) g.botDue = now + 650 + Math.random() * 900;
      else if (now >= g.botDue) { g.botDue = 0; botMove(g, bid); ch = true; }
    } else g.botDue = 0;
    const em = g.emote && g.emote[human];
    if (em && em.id !== g.botSeen) { g.botSeen = em.id; g.botEmoteAt = now + 700 + Math.random() * 700; }
    if (g.botEmoteAt && now >= g.botEmoteAt) {
      g.botEmoteAt = 0;
      g.emote[bid] = { e: EMOTES[crypto.randomInt(EMOTES.length)], id: ((g.emote[bid] || {}).id || 0) + 1, t: now };
      ch = true;
    }
  }
  if (ch) push();
}, 300);

/* ================= столы / лобби / обмен ================= */
const ensureReady = u => !!(u && u.ready && u.username);
const busy = uid => userGame.has(uid) || userTable.has(uid);
function createTable(uid, stake) {
  const u = db.users[uid];
  if (!STAKES.includes(stake)) return 'Неверная ставка';
  if (busy(uid)) return 'Вы уже в игре или за столом';
  if (u.coins < stake) return 'Не хватает монет';
  u.coins -= stake; u.escrow = stake;
  const t = { id: nid(), owner: uid, stake };
  tables.set(t.id, t); userTable.set(uid, t.id);
  markU(uid);
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
  startGame(t.owner, uid, t.stake, false);
  markU(uid); markU(t.owner);
  return null;
}
function cancelTable(uid) {
  const tid = userTable.get(uid); if (!tid) return;
  const t = tables.get(tid);
  if (t) { const u = db.users[uid]; u.coins += t.stake; u.escrow = 0; tables.delete(tid); markU(uid); }
  userTable.delete(uid);
}

function offerView(o, uid) {
  const o2 = db.users[o.from === uid ? o.to : o.from];
  return { id: o.id, amount: o.amount, dir: o.from === uid ? 'out' : 'in', user: pub(o2), left: Math.max(0, o.created + OFFER_TTL - Date.now()) };
}
function myOffers(uid) {
  return db.offers.filter(o => o.status === 'pending' && (o.from === uid || o.to === uid) && db.users[o.from] && db.users[o.to]).map(o => offerView(o, uid));
}
function sendOffer(uid, toName, amount) {
  const u = db.users[uid];
  const rid = unameIdx.get(String(toName || '').replace(/^@/, '').toLowerCase());
  const r = rid && db.users[rid];
  amount = Math.floor(+amount);
  if (!r || !r.ready) return 'Игрок с таким ником не найден';
  if (rid === uid) return 'Нельзя отправить самому себе';
  if (!(amount >= MIN_SEND)) return 'Минимум ' + MIN_SEND + ' монет';
  if (u.coins < amount) return 'Не хватает монет';
  if (db.offers.filter(o => o.status === 'pending' && o.from === uid).length >= MAX_OUT) return 'Слишком много активных предложений';
  u.coins -= amount;
  db.offers.push({ id: nid(), from: uid, to: rid, amount, created: Date.now(), status: 'pending' });
  markU(uid); markO();
  return null;
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
  o.done = Date.now(); markU(o.from); markU(o.to); markO();
  return null;
}
function expireOffers() {
  const now = Date.now(); let ch = false;
  for (const o of db.offers) {
    if (o.status === 'pending' && now - o.created > OFFER_TTL) {
      if (db.users[o.from]) { db.users[o.from].coins += o.amount; markU(o.from); }
      o.status = 'expired'; o.done = now; ch = true;
    }
  }
  const n = db.offers.length;
  db.offers = db.offers.filter(o => o.status === 'pending' || now - (o.done || now) < 7 * 86400e3);
  if (ch || n !== db.offers.length) markO();
  return ch;
}

function action(uid, b) {
  const u = db.users[uid];
  if (!u) return 'AUTH';
  lastActive.set(uid, Date.now());
  switch (b.type) {
    case 'profile': {
      const name = cleanName(b.name);
      if (Array.from(name).length < 2) return 'Имя слишком короткое';
      if (!EMOJIS.includes(b.emoji)) return 'Выберите аватар';
      const c = +b.color; if (!(c >= 0 && c < COLORS)) return 'Выберите цвет';
      const want = String(b.username || '').trim().replace(/^@/, '');
      let newU = null;
      if (!u.username) {
        const e = unameCheck(want, uid); if (e) return e;
        newU = want;
      } else if (want && want !== u.username) {
        if (want.toLowerCase() !== u.username.toLowerCase() && unameWaitOf(u) > 0) return 'Ник можно менять раз в сутки';
        const e = unameCheck(want, uid); if (e) return e;
        newU = want;
      }
      if (newU) {
        const hadOld = !!u.username;
        const sameName = hadOld && newU.toLowerCase() === u.username.toLowerCase();
        if (hadOld) unameIdx.delete(u.username.toLowerCase());
        if (!sameName) u.unameAt = Date.now();
        u.username = newU; unameIdx.set(newU.toLowerCase(), uid);
      }
      u.name = name; u.emoji = b.emoji; u.color = c | 0; u.usePhoto = !!b.usePhoto && !!u.photo; u.ready = true;
      markU(uid); return null;
    }
    case 'daily': {
      if (dailyWait(u) > 0) return 'Бонус ещё не готов';
      u.coins += 200; u.lastDaily = Date.now(); markU(uid); return null;
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
    case 'practice': {
      if (!ensureReady(u)) return 'Сначала создайте профиль';
      if (busy(uid)) return 'Вы уже в игре или за столом';
      const bot = makeBot();
      startGame(uid, bot.id, 0, true);
      return null;
    }
    case 'resign': {
      const g = games.get(userGame.get(uid));
      if (g && !g.over) settle(g, other(g, uid), 'resign');
      return null;
    }
    case 'leave': {
      const gid = userGame.get(uid), g = games.get(gid);
      if (g && g.over) {
        userGame.delete(uid);
        if (!g.players.some(p => !isBot(p) && userGame.get(p) === gid)) dropGame(g);
      }
      return null;
    }
    case 'emote': {
      const g = games.get(userGame.get(uid));
      if (!g || g.over) return null;
      if (!EMOTES.includes(b.e)) return 'Нет такой реакции';
      const now = Date.now(), prev = g.emote[uid];
      if (prev && now - prev.t < 1500) return null;
      g.emote[uid] = { e: b.e, id: (prev ? prev.id : 0) + 1, t: now };
      return null;
    }
    case 'send': if (!ensureReady(u)) return 'Сначала создайте профиль'; return sendOffer(uid, b.to, b.amount);
    case 'accept': case 'decline': case 'withdraw': return resolveOffer(uid, String(b.offer), b.type);
    case 'attack': case 'defend': case 'take': case 'done': {
      if (!userGame.has(uid)) return 'Вы не в игре';
      const g = games.get(userGame.get(uid));
      const err = gameMove(uid, b);
      if (!err) markG(g);
      return err;
    }
  }
  return 'Неизвестная команда';
}

/* ================= представление и рассылка ================= */
const online = uid => isBot(uid) || (clients.has(uid) && clients.get(uid).size > 0);
function gameView(g, uid) {
  const opp = other(g, uid);
  const e = g.emote && g.emote[opp];
  const v = {
    id: g.id, stake: g.stake, practice: !!g.practice, trump: g.trump, trumpCard: g.trumpCard, deck: g.deck.length, discard: g.discard,
    hand: sortHand(g.hands[uid], g.trump), oppCount: g.hands[opp].length, opp: pub(db.users[opp]), oppOnline: online(opp),
    table: g.table, iAttack: g.attacker === uid, phase: g.phase, limit: g.limit, over: g.over,
    left: Math.max(0, g.deadline - Date.now()), turn: onMove(g) === uid, oppEmote: e ? { e: e.e, id: e.id } : null,
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
  const list = [...tables.values()].filter(t => db.users[t.owner]).map(t => ({ id: t.id, stake: t.stake, owner: pub(db.users[t.owner]), mine: t.owner === uid }));
  list.sort((a, b) => (b.mine - a.mine) || a.stake - b.stake);
  return {
    me: meView(u), tables: list.slice(0, 40), myTable: userTable.get(uid) || null, game: g ? gameView(g, uid) : null,
    offers: myOffers(uid), cfg: Object.assign({ bot: BOT_USERNAME }, CFG), online: clients.size,
  };
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
  if (!booted) return;
  const now = Date.now();
  for (const uid of clients.keys()) lastActive.set(uid, now);
  for (const [t, v] of sessions) if (now - v.t > 24 * 3600e3) sessions.delete(t);
  let changed = false;
  for (const g of [...games.values()]) {
    if (!g.over) {
      const who = onMove(g);
      if (now > g.deadline + (online(who) ? 0 : OFFLINE_GRACE)) { settle(g, other(g, who), 'timeout'); changed = true; }
      else if (g.practice && !g.players.some(p => !isBot(p) && now - (lastActive.get(p) || 0) < 10 * 60e3)) { dropGame(g); changed = true; }
    } else if (now - g.born > 3 * 3600e3) { dropGame(g); changed = true; }
  }
  for (const t of [...tables.values()]) {
    if (now - (lastActive.get(t.owner) || 0) > 25000) { cancelTable(t.owner); changed = true; }
  }
  if (expireOffers()) changed = true;
  if (changed) push();
}, 1000);

/* ================= HTTP ================= */
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
const sessionUid = tok => { const s = sessions.get(String(tok)); return s ? s.uid : null; };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if ((req.method === 'GET' || req.method === 'HEAD') && (p === '/' || p === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(HTML);
    }
    if (p === '/health') return json(res, 200, { ok: true, ready: booted, storage: USE_REDIS ? 'redis' : 'file', users: Object.keys(db.users).length, games: games.size });
    if (p.startsWith('/api/') && !booted) return json(res, 503, { error: 'Сервер запускается, подождите минуту…' });
    if (p === '/api/auth' && req.method === 'POST') {
      const r = auth(await readBody(req));
      return json(res, r.error ? 401 : 200, r);
    }
    if (p === '/api/action' && req.method === 'POST') {
      const b = await readBody(req);
      const uid = sessionUid(b.token);
      if (!uid) return json(res, 401, { error: 'AUTH' });
      const err = action(uid, b);
      if (err === 'AUTH') return json(res, 401, { error: 'AUTH' });
      push();
      return json(res, 200, err ? { error: err } : { ok: true });
    }
    const uid = sessionUid(url.searchParams.get('token'));
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
    if (p === '/api/uname') {                       // проверка свободен ли ник
      if (!uid) return json(res, 401, { error: 'AUTH' });
      const q = String(url.searchParams.get('q') || '').trim().replace(/^@/, '');
      const e = unameCheck(q, uid);
      return json(res, 200, e ? { free: false, error: e } : { free: true });
    }
    if (p === '/api/find') {                        // поиск игроков по нику
      if (!uid) return json(res, 401, { error: 'AUTH' });
      const q = String(url.searchParams.get('q') || '').trim().replace(/^@/, '').toLowerCase().slice(0, 20);
      if (q.length < 2) return json(res, 200, { list: [] });
      const list = Object.values(db.users)
        .filter(x => x.ready && x.username && !x.isBot && x.id !== uid && x.username.toLowerCase().startsWith(q))
        .sort((a, b) => (a.username.toLowerCase() === q ? -1 : 0) - (b.username.toLowerCase() === q ? -1 : 0) || a.username.length - b.username.length)
        .slice(0, 8).map(pub);
      return json(res, 200, { list });
    }
    if (p === '/api/leaderboard') {
      if (!uid) return json(res, 401, { error: 'AUTH' });
      const top = Object.values(db.users).filter(x => x.ready && x.username && !x.isBot)
        .sort((a, b) => b.rating - a.rating || b.wins - a.wins).slice(0, 20)
        .map(x => Object.assign(pub(x), { wins: x.wins, losses: x.losses, me: x.id === uid }));
      return json(res, 200, { top });
    }
    res.writeHead(404); res.end('Not found');
  } catch (e) {
    console.error(e);
    try { json(res, 500, { error: 'Ошибка сервера' }); } catch (_) {}
  }
});

async function fetchBotName() {
  if (BOT_USERNAME || !BOT_TOKEN) return;
  try {
    const r = await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/getMe', { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    if (j.ok && j.result && j.result.username) BOT_USERNAME = j.result.username;
  } catch (e) {}
}
async function boot() {
  for (let i = 1; ; i++) {
    try { initFrom(await loadAll()); break; }
    catch (e) { console.error('не удалось загрузить данные (' + i + '):', e.message); await sleep(Math.min(15000, 2000 * i)); }
  }
  booted = true;
  console.log('Данные загружены: игроков ' + Object.keys(db.users).length + ', партий ' + games.size + ', хранилище: ' + (USE_REDIS ? 'Upstash Redis' : 'файл (на бесплатном Render стирается!)'));
  if (anyDirty()) scheduleFlush();
  fetchBotName();
}
server.listen(PORT, '0.0.0.0', () => console.log('Дурак онлайн запущен на порту ' + PORT + (BOT_TOKEN ? '' : ' (BOT_TOKEN не задан — режим теста)')));
process.on('uncaughtException', e => console.error('uncaught', e));
process.on('unhandledRejection', e => console.error('unhandled', e));
boot();
