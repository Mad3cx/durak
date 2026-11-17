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
const FLUSH_MS = +env('FLUSH_MS') || 3000;

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

/* ---- коллекционные карточки (они же рубашки карт) ---- */
const RARITY = ['Обычная', 'Редкая', 'Эпическая', 'Легендарная'];
const CARD_DEF = [   // id, название, эмодзи, редкость, оттенок
  ['c01', 'Кулак', '👊', 0, 20], ['c02', 'Болт', '🔩', 0, 210], ['c03', 'Цепь', '⛓️', 0, 200], ['c04', 'Кирпич', '🧱', 0, 12],
  ['c05', 'Молот', '🔨', 0, 30], ['c06', 'Топор', '🪓', 0, 8], ['c07', 'Кость', '🦴', 0, 45], ['c08', 'Свеча', '🕯️', 0, 38],
  ['r01', 'Волк', '🐺', 1, 215], ['r02', 'Скорпион', '🦂', 1, 18], ['r03', 'Ястреб', '🦅', 1, 160], ['r04', 'Кобра', '🐍', 1, 130],
  ['r05', 'Акула', '🦈', 1, 195], ['r06', 'Кабан', '🐗', 1, 25], ['r07', 'Паук', '🕷️', 1, 280], ['r08', 'Упырь', '🦇', 1, 265],
  ['e01', 'Череп', '💀', 2, 275], ['e02', 'Пламя', '🔥', 2, 12], ['e03', 'Гроза', '⚡', 2, 48], ['e04', 'Клинок', '🗡️', 2, 205], ['e05', 'Бастион', '🛡️', 2, 225],
  ['l01', 'Король', '👑', 3, 44], ['l02', 'Дракон', '🐉', 3, 120], ['l03', 'Демон', '😈', 3, 350],
];
const CARDS = CARD_DEF.map(([id, n, e, r, h]) => ({ id, n, e, r, h }));
const CARD_BY = Object.fromEntries(CARDS.map(c => [c.id, c]));
const BY_RAR = [0, 1, 2, 3].map(r => CARDS.filter(c => c.r === r));
const PACK_PRICE = 400, PACK_SIZE = 3, PITY = 6, MAX_SLOTS = 4;
const ODDS = [70, 22, 6.5, 1.5];          // шансы редкости одной карточки в наборе
const SELL = [40, 120, 400, 1500];        // цена продажи дубликата
const DROP_CHANCE = 30, DROP_ODDS = [80, 18, 2, 0];   // награда за победу, %
const wPick = w => { const t = w.reduce((a, b) => a + b, 0); let x = crypto.randomInt(1e6) / 1e6 * t; for (let i = 0; i < w.length; i++) if ((x -= w[i]) < 0) return i; return w.length - 1; };
const pickCard = r => BY_RAR[r][crypto.randomInt(BY_RAR[r].length)];

const CFG = { emojis: EMOJIS, emotes: EMOTES, ranks: RANKS, stakes: STAKES, colors: COLORS, turn: TURN_MS, fee: FEE, minSend: MIN_SEND, offerTtl: OFFER_TTL, unameCooldown: UNAME_COOLDOWN,
  cards: CARDS, rarity: RARITY, packPrice: PACK_PRICE, packSize: PACK_SIZE, sell: SELL, odds: ODDS, maxSlots: MAX_SLOTS, dropChance: DROP_CHANCE, pity: PITY };
const BOT_NAMES = ['Дуракин', 'Хитрый Лис', 'Профессор Бито', 'Козырный', 'Шулер Петя', 'Валет', 'Король Пик', 'Тузик'];

const HTML = "<!doctype html>\n<html lang=\"ru\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover\">\n<meta name=\"theme-color\" content=\"#09090b\">\n<title>Дурак Онлайн</title>\n<script src=\"https://telegram.org/js/telegram-web-app.js\"></script>\n<style>\n:root{\n --bg:#000;--s1:rgba(255,255,255,.045);--s2:rgba(255,255,255,.08);--s3:rgba(255,255,255,.14);--line:rgba(255,255,255,.2);--line2:rgba(255,255,255,.55);\n --tx:#f5f5f7;--mut:#8f8f9b;--hot:#fff;--hot2:#d7dae0;--gold:#fff;--ok:#4ade80;--bad:#ff4d5e;--blue:#3b82f6;--pur:#a855f7;\n --glass:linear-gradient(165deg,rgba(255,255,255,.13),rgba(255,255,255,.03) 55%,rgba(255,255,255,.07));\n --edge:inset 0 0 0 1.5px rgba(255,255,255,.78),inset 0 0 20px rgba(255,255,255,.09),0 0 16px rgba(255,255,255,.13);\n --edge2:inset 0 0 0 1px rgba(255,255,255,.38),inset 0 0 14px rgba(255,255,255,.05);\n --hd:-apple-system,BlinkMacSystemFont,\"SF Pro Rounded\",\"SF Pro Display\",system-ui,\"Segoe UI\",Roboto,sans-serif;\n --cw:64px;\n --noise:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .35 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\");\n}\n*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}\nhtml,body{margin:0;height:100%;background:var(--bg);color:var(--tx);font-family:-apple-system,BlinkMacSystemFont,\"SF Pro Text\",\"Segoe UI\",Roboto,sans-serif;overflow:hidden}\nbody:before{content:\"\";position:fixed;inset:-20%;z-index:0;pointer-events:none;background:radial-gradient(38% 22% at 14% 24%,rgba(255,255,255,.08),transparent 70%),radial-gradient(44% 26% at 88% 52%,rgba(255,255,255,.07),transparent 70%),radial-gradient(52% 26% at 28% 92%,rgba(255,255,255,.06),transparent 70%);animation:drift 26s ease-in-out infinite alternate}\n@keyframes drift{to{transform:translate(4%,-3%) scale(1.08)}}\nbutton{font:inherit;color:inherit;border:0;background:none;cursor:pointer;padding:0}\ninput{font:inherit;user-select:text;-webkit-user-select:text}\n::-webkit-scrollbar{display:none}\n.hd{font-family:var(--hd);font-weight:800;letter-spacing:.01em}\n.screen{display:none;position:fixed;inset:0;flex-direction:column;z-index:1}\n.screen.active{display:flex}\n#splash{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;z-index:200;background:var(--bg);font-size:15px;color:var(--mut);text-align:center;padding:0 30px}\n#splash .logo{font-family:var(--hd);font-weight:900;font-size:56px;letter-spacing:.12em;color:#fff;text-shadow:0 0 28px rgba(255,255,255,.55);animation:beat 1.6s ease-in-out infinite}\n@keyframes beat{50%{transform:scale(1.05);text-shadow:0 0 44px rgba(255,255,255,.9)}}\n#toast{position:fixed;left:50%;top:max(14px,env(safe-area-inset-top));transform:translate(-50%,-170%);background:rgba(20,8,10,.94);box-shadow:inset 0 0 0 1.5px var(--bad);color:#ffd9de;padding:11px 18px;font-size:14px;z-index:300;transition:.3s;max-width:92%;text-align:center;border-radius:14px;font-weight:600}\n#toast.show{transform:translate(-50%,0)}\n#toast.ok{background:rgba(6,22,13,.94);box-shadow:inset 0 0 0 1.5px var(--ok);color:#d3ffe6}\n#net{position:fixed;left:0;right:0;top:0;background:var(--bad);color:#fff;text-align:center;font-size:13px;padding:4px;z-index:310;display:none}\n\n/* ---- кнопки ---- */\n.btn{position:relative;padding:14px 18px;font-family:var(--hd);font-weight:800;letter-spacing:.02em;font-size:17px;background:var(--glass);border-radius:16px;box-shadow:var(--edge2);transition:transform .1s,filter .2s;display:inline-flex;align-items:center;justify-content:center;gap:8px;color:var(--tx)}\n.btn:active{transform:scale(.96);filter:brightness(1.25)}\n.btn.primary,.btn.gold{background:linear-gradient(180deg,#fff,#cfd2d9);color:#0a0a0c;box-shadow:0 0 22px rgba(255,255,255,.35),inset 0 -3px 0 rgba(0,0,0,.18)}\n.btn.green{background:rgba(74,222,128,.16);color:#c6ffdc;box-shadow:inset 0 0 0 1.5px var(--ok),0 0 16px rgba(74,222,128,.2)}\n.btn.red{background:rgba(255,77,94,.16);color:#ffd0d6;box-shadow:inset 0 0 0 1.5px var(--bad),0 0 16px rgba(255,77,94,.2)}\n.btn.big{width:100%;padding:17px;font-size:19px}\n.btn.sm{padding:9px 14px;font-size:14px;border-radius:12px}\n.btn[disabled],.btn.off{opacity:.38}\n.btn[disabled]{pointer-events:none}\n\n/* ---- общие ---- */\n.panel{position:relative;background:var(--glass);border-radius:22px;padding:14px;margin-bottom:12px;box-shadow:var(--edge2)}\n.sec{font-family:var(--hd);font-weight:800;font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:var(--mut);margin:20px 4px 10px;display:flex;align-items:center;gap:10px}\n.sec:after{content:\"\";flex:1;height:1px;background:linear-gradient(90deg,var(--line2),transparent)}\n.av{position:relative;display:flex;align-items:center;justify-content:center;flex:none;overflow:hidden;border-radius:26%;box-shadow:inset 0 0 0 2px rgba(255,255,255,.85),0 0 12px rgba(255,255,255,.2)}\n.av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}\n.rk{font-weight:800;letter-spacing:.04em;font-size:11px;padding:2px 9px;background:rgba(255,255,255,.12);color:#fff;white-space:nowrap;text-transform:uppercase;border-radius:20px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.3)}\n.un{font-size:12px;color:var(--mut);font-weight:600}\n.coins{display:inline-flex;align-items:center;gap:8px;font-family:var(--hd);font-weight:800;font-size:18px;background:var(--glass);color:#fff;padding:6px 8px 6px 11px;border-radius:16px;box-shadow:var(--edge2)}\n.coins b{display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:9px;background:#fff;color:#000;font-size:20px;line-height:1}\n.coin{display:inline-block;width:1.25em;height:1.25em;background:var(--coinimg) center/contain no-repeat;vertical-align:-.32em;flex:none;filter:drop-shadow(0 0 5px rgba(255,255,255,.45))}\n.empty{text-align:center;color:var(--mut);padding:22px 10px;font-size:14px;line-height:1.45}\n.note{font-size:12px;color:var(--mut);margin:8px 2px 0;line-height:1.4}\n.note.bad{color:#ff8a98}.note.okc{color:#7be0a4}\n.spin{width:26px;height:26px;border-radius:50%;border:3px solid var(--line);border-top-color:#fff;animation:sp 1s linear infinite;flex:none}\n@keyframes sp{to{transform:rotate(360deg)}}\n.pulse-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 0 rgba(74,222,128,.6);animation:pd 1.8s infinite;margin-right:6px}\n@keyframes pd{70%{box-shadow:0 0 0 8px rgba(74,222,128,0)}100%{box-shadow:0 0 0 0 rgba(74,222,128,0)}}\n@keyframes popin{from{transform:scale(.72);opacity:0}}\n@keyframes rise{from{transform:translateY(14px);opacity:0}}\n@keyframes blink{50%{opacity:.5}}\n.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#555;margin-right:5px;flex:none}\n.dot.on{background:var(--ok);box-shadow:0 0 8px var(--ok)}\n\n/* ---- шапка и меню ---- */\n#head{display:flex;align-items:center;gap:11px;padding:max(14px,env(safe-area-inset-top)) 14px 8px}\n#hav{flex:none;border-radius:22px}\n#head .who{flex:1;min-width:0}\n#head .nm{font-family:var(--hd);font-weight:800;font-size:19px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.1}\n#head .lv{font-size:12px;color:var(--mut);font-weight:600;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.xp{height:7px;background:rgba(255,255,255,.1);margin-top:5px;overflow:hidden;border-radius:6px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.25)}\n.xp i{display:block;height:100%;background:linear-gradient(90deg,#9aa0ab,#fff);border-radius:6px;box-shadow:0 0 10px rgba(255,255,255,.7);transition:width .7s}\n.gear{flex:none;width:44px;height:44px;border-radius:16px;background:var(--glass);box-shadow:var(--edge2);display:flex;align-items:center;justify-content:center}\n.gear svg{width:25px;height:25px;stroke:#fff;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 0 5px rgba(255,255,255,.6))}\n#body{flex:1;overflow-y:auto;padding:4px 14px 124px;-webkit-overflow-scrolling:touch}\n#nav{position:fixed;left:12px;right:12px;bottom:calc(10px + env(safe-area-inset-bottom));display:flex;background:rgba(14,14,18,.82);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-radius:24px;box-shadow:var(--edge);padding:5px;z-index:20}\n#nav button{flex:1;padding:8px 0 6px;color:var(--mut);font-weight:700;font-size:11px;display:flex;flex-direction:column;align-items:center;gap:3px;position:relative;border-radius:19px;transition:color .2s,background .2s}\n#nav button svg{width:26px;height:26px;stroke:currentColor;fill:none;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;transition:transform .2s}\n#nav button.on{color:#fff;background:rgba(255,255,255,.1);box-shadow:inset 0 0 0 1px rgba(255,255,255,.35)}\n#nav button.on svg{filter:drop-shadow(0 0 7px rgba(255,255,255,.85));transform:translateY(-1px)}\n#nav button.on:after{content:\"\";position:absolute;bottom:2px;left:30%;right:30%;height:2px;background:#fff;border-radius:2px;box-shadow:0 0 8px #fff}\n.bdg{position:absolute;top:2px;right:16%;min-width:18px;height:18px;background:var(--bad);color:#fff;font-size:11px;font-weight:800;display:none;align-items:center;justify-content:center;padding:0 5px;font-style:normal;border-radius:9px;animation:popin .3s}\n\n/* ---- арты и плитки ---- */\n.art{display:flex;justify-content:center;align-items:center;height:clamp(120px,23vh,210px);margin:2px 0 6px;position:relative}\n.art svg{height:100%;width:auto;max-width:100%;overflow:visible;filter:drop-shadow(0 0 12px rgba(255,255,255,.4));animation:float 5s ease-in-out infinite}\n@keyframes float{50%{transform:translateY(-6px)}}\n.spark{position:absolute;color:#fff;font-size:16px;opacity:.7;animation:tw 3s ease-in-out infinite;text-shadow:0 0 8px #fff}\n.spark:nth-of-type(2){animation-delay:1.1s}.spark:nth-of-type(3){animation-delay:2s}\n@keyframes tw{50%{opacity:.15;transform:scale(.6)}}\n.tiles{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}\n.tile{position:relative;padding:12px 8px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:clamp(96px,15.5vh,132px);background:var(--glass);border-radius:24px;box-shadow:var(--edge);font-weight:800;font-size:16px;transition:transform .12s,box-shadow .2s}\n.tile:active{transform:scale(.95);box-shadow:inset 0 0 0 2px #fff,inset 0 0 30px rgba(255,255,255,.2),0 0 26px rgba(255,255,255,.35)}\n.tile .ic svg{width:48px;height:48px;stroke:#fff;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 0 7px rgba(255,255,255,.6))}\n.tile .ic svg.suit{fill:rgba(255,255,255,.1)}\n.tile small{display:block;font-size:11px;color:var(--mut);font-weight:600;margin-top:-6px}\n.tile .nw{position:absolute;right:10px;top:10px;min-width:20px;height:20px;border-radius:10px;background:#fff;color:#000;font-size:11px;font-weight:900;font-style:normal;display:flex;align-items:center;justify-content:center;padding:0 6px;animation:blink 1.6s infinite}\n.tile[disabled]{opacity:.4;pointer-events:none}\n.wbtn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:14px;margin-bottom:12px;background:var(--glass);border-radius:20px;box-shadow:var(--edge2);font-weight:800;font-size:16px}\n.wbtn svg{width:26px;height:26px;stroke:#fff;fill:none;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}\n.wbtn:active{transform:scale(.97)}\n.banner{display:flex;align-items:center;gap:12px;background:var(--glass);border-radius:22px;box-shadow:var(--edge);padding:12px 14px;margin-bottom:12px}\n.banner .tx{flex:1;font-size:14px;line-height:1.3}.banner b{font-weight:800}\n.banner .code{font-family:ui-monospace,Menlo,monospace;font-size:30px;font-weight:900;letter-spacing:.22em;text-shadow:0 0 16px rgba(255,255,255,.6)}\n.stakes{display:grid;grid-template-columns:repeat(5,1fr);gap:7px;margin:12px 0 4px}\n.stk{position:relative;padding:11px 0 9px;text-align:center;background:var(--s1);border-radius:14px;box-shadow:var(--edge2);font-weight:900;font-size:18px;color:var(--mut);transition:.15s}\n.stk small{display:block;font-size:9px;letter-spacing:.06em;color:#6a6a76;margin-top:1px;font-weight:700}\n.stk.on{background:rgba(255,255,255,.16);color:#fff;box-shadow:inset 0 0 0 2px #fff,0 0 20px rgba(255,255,255,.3)}\n.stk[disabled]{opacity:.28}\n.potline{font-size:12px;color:var(--mut);margin:10px 2px 14px;display:flex;justify-content:space-between}\n.potline b{color:#fff}\n.statrow{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}\n.statrow div{background:var(--glass);border-radius:16px;box-shadow:var(--edge2);padding:10px 4px 8px;text-align:center}\n.statrow b{display:block;font-weight:900;font-size:21px}\n.statrow span{font-size:10px;color:var(--mut);text-transform:uppercase;letter-spacing:.07em;font-weight:700}\n.trow{display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--glass);border-radius:18px;box-shadow:var(--edge2);margin-bottom:8px}\n.trow .mid{flex:1;min-width:0}\n.trow .nm{font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.trow.mine{box-shadow:inset 0 0 0 2px #fff,0 0 16px rgba(255,255,255,.25)}\n.stakeTag{font-weight:900;font-size:19px;display:flex;align-items:center;gap:6px;margin-right:2px}\n.wait{display:flex;align-items:center;gap:12px}\n\n/* ---- рюкзак ---- */\n.bagbtns{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}\n.bbtn{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:12px 6px;background:var(--glass);border-radius:22px;box-shadow:var(--edge);font-weight:800;font-size:14px;text-align:center;position:relative;transition:transform .12s}\n.bbtn:active{transform:scale(.95)}\n.bbtn svg{width:34px;height:34px;stroke:#fff;fill:none;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 0 6px rgba(255,255,255,.55))}\n.bbtn .coin{width:36px;height:36px;vertical-align:0}\n.bag{display:grid;grid-template-columns:92px 1fr;gap:10px;background:var(--glass);border-radius:26px;box-shadow:var(--edge);padding:10px}\n.btabs{display:flex;flex-direction:column;gap:8px}\n.btab{display:flex;flex-direction:column;align-items:center;gap:4px;padding:11px 4px;border-radius:18px;font-weight:800;font-size:12px;color:var(--mut);background:var(--s1);box-shadow:var(--edge2);transition:.15s}\n.btab svg{width:28px;height:28px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}\n.btab.on{color:#fff;background:rgba(255,255,255,.14);box-shadow:inset 0 0 0 2px #fff,0 0 16px rgba(255,255,255,.3)}\n.bcont{min-width:0}\n.bcont h4{margin:2px 0 10px;text-align:center;font-weight:900;font-size:17px;letter-spacing:.03em}\n.soon{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;min-height:200px;color:var(--mut);font-weight:700;text-align:center;font-size:14px}\n.soon svg{width:56px;height:56px;stroke:rgba(255,255,255,.5);fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}\n\n/* ---- коллекция ---- */\n.ccard{--w:70px;position:relative;width:var(--w);height:calc(var(--w)*1.42);font-size:var(--w);flex:none;overflow:hidden;border-radius:.09em;\n background:radial-gradient(circle at 50% 36%,hsl(var(--h) 68% 36%) 0,hsl(var(--h) 60% 15%) 58%,#08080a 100%);color:#fff;box-shadow:inset 0 0 0 .035em var(--bc,#8d8d9a)}\n.ccard:before{content:\"\";position:absolute;inset:0;background:repeating-linear-gradient(45deg,rgba(255,255,255,.05) 0 .02em,transparent .02em .07em);pointer-events:none}\n.ccard .ca{position:absolute;left:.09em;right:.09em;top:.1em;height:.78em;display:flex;align-items:center;justify-content:center;box-shadow:inset 0 0 0 .02em rgba(255,255,255,.18);background:radial-gradient(circle,rgba(255,255,255,.14),transparent 70%);border-radius:.04em}\n.ccard .em{font-style:normal;font-size:.44em;filter:drop-shadow(0 .02em .03em rgba(0,0,0,.7))}\n.ccard .cn{position:absolute;left:0;right:0;bottom:.12em;text-align:center;font-family:var(--hd);font-size:.104em;letter-spacing:.03em;font-weight:800;text-shadow:0 .01em .03em #000;white-space:nowrap;overflow:hidden}\n.ccard .cr3{position:absolute;left:0;right:0;bottom:.01em;text-align:center;font-size:.068em;letter-spacing:.2em;color:var(--bc);opacity:.95;line-height:1.6}\n.ccard .cnt{position:absolute;right:.04em;top:.03em;font-size:.12em;font-weight:900;background:#000;color:#fff;padding:0 .35em;text-decoration:none;letter-spacing:.04em;z-index:3;border-radius:.2em}\n.ccard.r0{--bc:#8d8d9a}\n.ccard.r1{--bc:#3b82f6;filter:drop-shadow(0 0 .05em rgba(59,130,246,.45))}\n.ccard.r2{--bc:#a855f7;filter:drop-shadow(0 0 .07em rgba(168,85,247,.7))}\n.ccard.r3{--bc:#ffb703;filter:drop-shadow(0 0 .08em rgba(255,183,3,.8))}\n.ccard.r2:after,.ccard.r3:after{content:\"\";position:absolute;inset:-30%;background:linear-gradient(105deg,transparent 40%,rgba(255,255,255,.4) 50%,transparent 60%);transform:translateX(-80%);animation:shine 3.2s infinite;pointer-events:none}\n.ccard.r3:after{animation-duration:2.4s}\n@keyframes shine{40%,100%{transform:translateX(80%)}}\n.ccard.locked{background:#0b0b0e;box-shadow:inset 0 0 0 .03em #2a2a32;filter:none}\n.ccard.locked:before{opacity:.5}\n.ccard.locked .q{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:.42em;color:#2a2a32;font-style:normal}\n.ccard.fresh{animation:popin .4s cubic-bezier(.2,1.4,.4,1)}\n.cgrid3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px 6px;justify-items:center}\n.cgrid3 .cell{position:relative;transition:transform .12s}\n.cgrid3 .cell:active{transform:scale(.95)}\n.cgrid3 .cell.eq:after{content:\"НАДЕТА\";position:absolute;left:50%;bottom:-8px;transform:translateX(-50%);background:#fff;color:#000;font-weight:900;font-size:9px;letter-spacing:.06em;padding:1px 6px;white-space:nowrap;border-radius:8px}\n.filters{display:flex;gap:6px;overflow-x:auto;margin:0 0 12px;padding-bottom:2px}\n.fl{flex:none;padding:6px 11px;background:var(--s1);border-radius:14px;box-shadow:var(--edge2);font-weight:800;font-size:12px;color:var(--mut)}\n.fl.on{background:#fff;color:#000;box-shadow:0 0 14px rgba(255,255,255,.4)}\n.packbtn{margin-bottom:12px;font-size:15px;padding:14px 8px;white-space:nowrap}\n.progress{display:flex;align-items:center;gap:10px;margin-bottom:10px;font-weight:800;font-size:13px}\n.progress .xp{flex:1;margin:0}\n\n/* ---- подстраницы ---- */\n#s-page{z-index:50;background:radial-gradient(70% 30% at 50% 0,rgba(255,255,255,.08),transparent 70%),#000;overflow:hidden}\n.phead{display:flex;align-items:center;gap:12px;padding:max(12px,env(safe-area-inset-top)) 14px 8px;flex:none}\n.phead b{font-family:var(--hd);font-weight:900;font-size:22px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.pbody{flex:1;overflow-y:auto;padding:4px 14px calc(30px + env(safe-area-inset-bottom))}\n.iconbtn{width:42px;height:42px;background:var(--glass);border-radius:15px;box-shadow:var(--edge2);font-size:18px;display:flex;align-items:center;justify-content:center;flex:none}\n.shopart{display:flex;flex-direction:column;align-items:center;gap:14px;padding:50px 20px;text-align:center;color:var(--mut);font-weight:600}\n.shopart .coin{width:96px;height:96px;filter:drop-shadow(0 0 22px rgba(255,255,255,.55));animation:float 4s ease-in-out infinite}\n.shopart h2{margin:0;color:#fff;font-weight:900;font-size:26px}\n.chips{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 0}\n.chip{padding:9px 14px;background:var(--s1);border-radius:14px;box-shadow:var(--edge2);font-weight:800;font-size:14px}\n.chip:active{background:rgba(255,255,255,.2)}\n.picked{display:flex;align-items:center;gap:10px;padding:10px 12px;background:rgba(255,255,255,.1);border-radius:16px;box-shadow:inset 0 0 0 1.5px #fff}\n.picked .mid{flex:1;min-width:0}\n\n/* ---- обмен ---- */\n.uwrap{position:relative}\n.uwrap .at{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--mut);font-weight:800;font-size:17px}\n.inp{width:100%;padding:14px;background:rgba(255,255,255,.05);border:0;box-shadow:inset 0 0 0 1.5px var(--line);color:var(--tx);font-size:17px;font-weight:700;outline:none;border-radius:14px}\n.inp:focus{box-shadow:inset 0 0 0 2px #fff,0 0 14px rgba(255,255,255,.25)}\n.inp[disabled]{opacity:.5}\n.uwrap .inp{padding-left:34px;padding-right:44px}\n.ustat{position:absolute;right:14px;top:50%;transform:translateY(-50%);font-size:18px}\n.lbl{display:block;font-weight:800;font-size:12px;color:var(--mut);margin:16px 2px 6px;letter-spacing:.1em;text-transform:uppercase}\n.mini{display:flex;align-items:center;gap:5px}\n.mini .ccard{--w:34px}\n.mini .cc{font-weight:900;color:#fff;font-size:14px;display:flex;align-items:center;gap:4px;margin-left:2px}\n.sw{font-size:20px;color:#fff;padding:0 4px;font-weight:900}\n.orow{position:relative;display:flex;align-items:center;gap:10px;padding:11px 12px;background:var(--glass);border-radius:20px;box-shadow:var(--edge2);margin-bottom:9px;transition:transform .1s}\n.orow:active{transform:scale(.98)}\n.orow.in{box-shadow:inset 0 0 0 2px var(--ok),0 0 16px rgba(74,222,128,.2)}\n.orow .mid{flex:1;min-width:0}\n.orow .nm{font-weight:800;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.orow .sub{font-size:11px;color:var(--mut);margin-bottom:6px}\n#s-trade{z-index:60;background:radial-gradient(70% 30% at 50% 0,rgba(255,255,255,.08),transparent 70%),#000;overflow-y:auto}\n.thead{display:flex;align-items:center;gap:10px;padding:max(10px,env(safe-area-inset-top)) 14px 8px}\n.thead .t{flex:1;min-width:0}\n.thead b{display:block;font-weight:900;font-size:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.tbox{position:relative;margin:0 14px;background:var(--glass);border-radius:26px;box-shadow:var(--edge);transition:transform .5s cubic-bezier(.6,0,.3,1),opacity .5s}\n.tbox.t{box-shadow:inset 0 0 0 2px rgba(74,222,128,.8),inset 0 0 20px rgba(74,222,128,.1),0 0 16px rgba(74,222,128,.15)}\n.tbox .tl{display:flex;justify-content:space-between;align-items:center;padding:10px 16px 2px;font-weight:800;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--mut)}\n.tbox .tl b{color:#fff;font-weight:900}\n.tgrid{display:grid;grid-template-columns:1fr 1fr;margin:6px 12px 0;position:relative}\n.tgrid:before,.tgrid:after{content:\"\";position:absolute;background:var(--line)}\n.tgrid:before{left:50%;top:6px;bottom:6px;width:1.5px;margin-left:-1px}\n.tgrid:after{top:50%;left:6px;right:6px;height:1.5px;margin-top:-1px}\n.slot{height:92px;display:flex;align-items:center;justify-content:center;position:relative;transition:background .15s;border-radius:14px}\n.slot.add:active{background:rgba(255,255,255,.08)}\n.slot .plus{font-weight:300;font-size:38px;color:rgba(255,255,255,.35)}\n.slot .ccard{--w:64px}\n.slot .rm{position:absolute;right:8px;top:6px;width:22px;height:22px;background:#000;color:#fff;font-size:12px;display:flex;align-items:center;justify-content:center;z-index:5;border-radius:8px;box-shadow:inset 0 0 0 1px #fff}\n.tcoins{display:flex;align-items:center;gap:10px;padding:8px 14px 14px}\n.tcoins .inp{padding:9px 12px;font-size:16px;flex:1}\n.tcoins .cv{font-weight:900;font-size:20px;display:flex;align-items:center;gap:7px}\n.tmid{display:flex;align-items:center;justify-content:center;gap:16px;padding:10px 0}\n.swapic{width:52px;height:52px;border-radius:50%;background:var(--glass);box-shadow:var(--edge);display:flex;align-items:center;justify-content:center;color:#fff;font-size:26px;transition:transform .6s cubic-bezier(.3,1.5,.5,1)}\n.swapic.spun{transform:rotate(180deg)}\n.bigact{width:64px;height:64px;font-weight:900;font-size:30px;border-radius:22px;display:flex;align-items:center;justify-content:center;transition:transform .1s}\n.bigact:active{transform:scale(.9)}\n.bigact.x{background:rgba(255,77,94,.2);color:#ffd0d6;box-shadow:inset 0 0 0 2px var(--bad),0 0 18px rgba(255,77,94,.3)}\n.bigact.v{background:rgba(74,222,128,.2);color:#c6ffdc;box-shadow:inset 0 0 0 2px var(--ok),0 0 18px rgba(74,222,128,.3)}\n.tfoot{position:sticky;bottom:0;z-index:5;background:linear-gradient(transparent,#000 30%);display:flex;gap:10px;padding:12px 14px calc(14px + env(safe-area-inset-bottom))}\n.tfoot .btn{flex:1}\n#sheet{position:fixed;inset:0;z-index:80;display:none;align-items:flex-end;background:rgba(0,0,0,.72)}\n#sheet.show{display:flex}\n#sheet .in{width:100%;max-height:84vh;overflow-y:auto;background:linear-gradient(180deg,#17171c,#0a0a0d);border-radius:28px 28px 0 0;padding:20px 16px calc(18px + env(safe-area-inset-bottom));animation:up .28s cubic-bezier(.2,.9,.3,1);box-shadow:inset 0 1.5px 0 rgba(255,255,255,.8),0 -10px 40px rgba(255,255,255,.08)}\n@keyframes up{from{transform:translateY(40%);opacity:0}}\n#sheet h3{margin:0 0 12px;font-weight:900;font-size:21px}\n.pgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px 8px;justify-items:center;margin-bottom:14px}\n.pgrid .cell{position:relative}\n.pgrid .cell.sel .ccard{box-shadow:inset 0 0 0 .05em var(--ok)}\n.pgrid .cell.sel:after{content:\"✓\";position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:28px;color:var(--ok);font-weight:900;text-shadow:0 0 8px #000;background:rgba(0,0,0,.55);width:100%;height:100%;display:flex;align-items:center;justify-content:center;border-radius:6px}\n\n/* ---- набор: открытие ---- */\n#pack{position:fixed;inset:0;z-index:120;display:none;flex-direction:column;align-items:center;justify-content:center;background:radial-gradient(70% 50% at 50% 45%,#26262e 0,#000 72%);overflow:hidden}\n#pack.show{display:flex}\n#pack .stage{position:relative;display:flex;gap:10px;justify-content:center;perspective:900px;min-height:230px;align-items:center}\n.pk{position:relative;width:96px;height:136px;transform-style:preserve-3d;transition:transform .7s cubic-bezier(.3,1.3,.5,1)}\n.pk .f,.pk .bk{position:absolute;inset:0;backface-visibility:hidden;display:flex;align-items:center;justify-content:center}\n.pk .bk{background:repeating-linear-gradient(45deg,#101015 0 7px,#1d1d24 7px 14px);border-radius:10px;box-shadow:inset 0 0 0 2px #fff,0 0 20px rgba(255,255,255,.4);font-size:38px;color:#fff;text-shadow:0 0 12px #fff}\n.pk .f{transform:rotateY(180deg)}\n.pk .f .ccard{--w:96px}\n.pk.flip{transform:rotateY(180deg)}\n.pk.shake{animation:shk .5s infinite}\n@keyframes shk{20%{transform:rotate(-6deg) translateY(-4px)}60%{transform:rotate(6deg) translateY(2px)}}\n.pk .new{position:absolute;left:50%;top:-14px;transform:translateX(-50%) rotateY(180deg);background:var(--ok);color:#022a14;font-weight:900;font-size:12px;letter-spacing:.08em;padding:1px 9px;z-index:6;backface-visibility:hidden;white-space:nowrap;border-radius:9px}\n.burst{position:absolute;width:260px;height:260px;border-radius:50%;pointer-events:none;opacity:0;z-index:0}\n.burst.show{animation:burst .9s ease-out forwards}\n@keyframes burst{0%{opacity:.9;transform:scale(.2)}100%{opacity:0;transform:scale(2.6)}}\n#pack .ptitle{font-weight:900;font-size:28px;letter-spacing:.06em;margin-bottom:26px;text-shadow:0 0 24px rgba(255,255,255,.7)}\n#pack .pbtns{display:flex;gap:10px;margin-top:34px;width:100%;max-width:340px;padding:0 20px;min-height:56px}\n#pack .pbtns .btn{flex:1}\n\n/* ---- профиль / настройки ---- */\n.phero{display:flex;flex-direction:column;align-items:center;text-align:center;padding:20px 14px 16px}\n.phero .hn{font-weight:900;font-size:26px;margin-top:10px}\n.phero .hu{color:var(--mut);font-weight:600;margin:0 0 8px}\n.phero .xp{width:100%;max-width:280px;height:7px}\n.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px;width:100%}\n.stats div{background:rgba(255,255,255,.05);border-radius:14px;padding:10px 4px;box-shadow:var(--edge2)}\n.stats b{display:block;font-weight:900;font-size:21px}.stats span{font-size:10px;color:var(--mut);text-transform:uppercase;letter-spacing:.07em;font-weight:700}\n.ranks .trow{padding:8px 12px;margin-bottom:6px;opacity:.5}.ranks .trow.cur{opacity:1;box-shadow:inset 0 0 0 2px #fff,0 0 14px rgba(255,255,255,.25)}\n.egrid{display:grid;grid-template-columns:repeat(8,1fr);gap:6px}\n.eb{font-size:22px;padding:6px 0;background:rgba(255,255,255,.05);box-shadow:var(--edge2);border-radius:12px}\n.eb.on{box-shadow:inset 0 0 0 2px #fff;background:rgba(255,255,255,.18)}\n.cgrid{display:grid;grid-template-columns:repeat(10,1fr);gap:6px}\n.cb{aspect-ratio:1;border-radius:50%;border:2.5px solid transparent}\n.cb.on{border-color:#fff;box-shadow:0 0 0 2px #000,0 0 0 4px #fff}\n.chk{display:flex!important;align-items:center;gap:10px;text-transform:none!important;font-size:14px!important;color:var(--tx)!important;letter-spacing:0!important}\n.chk input{width:20px;height:20px}\n.center{display:flex;justify-content:center;margin:6px 0}\n.setrow{display:flex;align-items:center;gap:12px;padding:12px 4px;border-bottom:1px solid rgba(255,255,255,.1);font-weight:700}\n.setrow:last-child{border:0}\n.setrow .tx{flex:1}\n.tog{position:relative;width:52px;height:30px;border-radius:15px;background:rgba(255,255,255,.12);box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.4);transition:.2s;flex:none}\n.tog:after{content:\"\";position:absolute;left:3px;top:3px;width:24px;height:24px;border-radius:50%;background:#fff;transition:.2s;box-shadow:0 0 8px rgba(255,255,255,.5)}\n.tog.on{background:rgba(74,222,128,.35);box-shadow:inset 0 0 0 1.5px var(--ok)}\n.tog.on:after{left:25px}\n#s-setup{padding:max(22px,env(safe-area-inset-top)) 18px 24px;overflow-y:auto}\n#s-setup h1{margin:10px 0 2px;text-align:center;font-weight:900;font-size:34px}\n#s-setup p{text-align:center;color:var(--mut);margin:0 0 8px}\n.lb .pl{width:30px;text-align:center;font-weight:900;font-size:18px;color:var(--mut)}\n\n/* ---- диалоги / результат ---- */\n#dlg,#modal{position:fixed;inset:0;background:rgba(0,0,0,.82);display:none;align-items:center;justify-content:center;z-index:90;padding:22px;backdrop-filter:blur(5px)}\n#dlg.show,#modal.show{display:flex}\n.res{width:100%;max-width:340px;background:linear-gradient(180deg,#1b1b21,#0a0a0d);border-radius:28px;padding:26px 20px 22px;text-align:center;animation:popin .4s cubic-bezier(.2,1.3,.4,1);box-shadow:var(--edge);position:relative}\n.res h2{margin:4px 0 2px;font-weight:900;font-size:32px;letter-spacing:.02em}\n.res.win{box-shadow:inset 0 0 0 2px #fff,0 0 40px rgba(255,255,255,.35)}\n.res.win h2{text-shadow:0 0 22px rgba(255,255,255,.7)}\n.res.lose h2{color:#9aa}\n.res .bigemo{font-size:58px;animation:bounce 1s .3s}\n@keyframes bounce{30%{transform:scale(1.3) rotate(-8deg)}60%{transform:scale(.95) rotate(5deg)}}\n.res .dl{font-weight:900;font-size:40px;margin:10px 0 2px;display:flex;align-items:center;justify-content:center;gap:8px}\n.res .dl.p{color:var(--ok)}.res .dl.n{color:var(--bad)}\n.res .sub{color:var(--mut);font-size:14px;margin-bottom:14px;line-height:1.4}\n.drop{display:flex;flex-direction:column;align-items:center;gap:6px;margin:4px 0 16px;animation:rise .5s .6s backwards}\n.drop .ccard{--w:92px}\n.drop small{font-weight:800;letter-spacing:.08em;color:#fff;font-size:13px;text-transform:uppercase}\n.fall{position:absolute;top:-40px;font-size:26px;animation:fall linear forwards;z-index:75;pointer-events:none}\n@keyframes fall{to{transform:translateY(110vh) rotate(540deg)}}\n\n/* ====== игровой стол ====== */\n#s-game{overflow:hidden;touch-action:none;background:radial-gradient(75% 48% at 50% 46%,rgba(255,255,255,.11),transparent 74%),#030305}\n#s-game:before{content:\"\";position:absolute;inset:0;background:var(--noise);opacity:.22;pointer-events:none;mix-blend-mode:screen}\n#s-game:after{content:\"\";position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 110px rgba(0,0,0,.9);z-index:1}\n#s-game>*{position:relative;z-index:2}\n#s-game>#fx{position:absolute;z-index:60}\n#s-game>#modal{position:absolute;inset:0;z-index:70;overflow-y:auto}\n.gtop{display:flex;align-items:center;gap:10px;padding:max(10px,env(safe-area-inset-top)) 12px 4px}\n.gtop .gap{flex:1;text-align:center;font-weight:800;letter-spacing:.06em;font-size:13px;color:#d6d6de;text-transform:uppercase}\n.gbtn{width:40px;height:40px;background:var(--glass);border-radius:14px;box-shadow:var(--edge2);font-size:18px;display:flex;align-items:center;justify-content:center}\n.bank{display:flex;align-items:center;gap:7px;font-weight:900;font-size:19px;background:var(--glass);padding:7px 12px;border-radius:14px;box-shadow:var(--edge2)}\n.tbar{height:4px;margin:2px 14px 0;background:rgba(255,255,255,.12);overflow:hidden;border-radius:4px}\n.tbar i{display:block;height:100%;width:100%;background:#fff;box-shadow:0 0 10px #fff;transition:width .2s linear}\n.tbar.low i{background:var(--bad);box-shadow:0 0 10px var(--bad);animation:blink .6s infinite}\n#gOpp{position:relative;height:124px;flex:none}\n.ofan{position:absolute;left:0;right:0;top:0;height:92px}\n.ofan .card{position:absolute;left:50%;top:6px;margin-left:calc(var(--cw)*-.29);scale:.58;transform-origin:50% 0;rotate:var(--r);translate:var(--x) 0}\n.oav{position:absolute;left:50%;top:44px;translate:-50% 0;z-index:3}\n.oav .av{box-shadow:0 0 0 3px #000,0 0 0 4.5px rgba(255,255,255,.5),0 6px 16px rgba(0,0,0,.6)}\n.oav.act .av{box-shadow:0 0 0 3px #000,0 0 0 5px #fff,0 0 24px rgba(255,255,255,.9);animation:glow 1.2s infinite}\n@keyframes glow{50%{box-shadow:0 0 0 3px #000,0 0 0 5px #fff,0 0 6px rgba(255,255,255,.3)}}\n.onm{position:absolute;left:0;right:0;bottom:0;text-align:center;font-weight:800;font-size:13px;text-shadow:0 1px 3px #000;z-index:3}\n.onm span{background:rgba(0,0,0,.6);padding:2px 10px;display:inline-block;max-width:60%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;vertical-align:bottom;border-radius:10px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.3)}\n.ocnt{position:absolute;left:calc(50% + 28px);top:42px;z-index:4;background:#fff;color:#000;font-weight:900;font-size:13px;padding:1px 8px;border-radius:10px}\n.dots i{display:inline-block;width:5px;height:5px;border-radius:50%;background:#fff;margin-left:3px;animation:dt 1.2s infinite}\n.dots i:nth-child(2){animation-delay:.2s}.dots i:nth-child(3){animation-delay:.4s}\n@keyframes dt{0%,60%,100%{opacity:.25;transform:translateY(0)}30%{opacity:1;transform:translateY(-3px)}}\n.felt{flex:1;position:relative;display:flex;align-items:center;justify-content:center;min-height:0}\n.felt:before{content:\"\";position:absolute;left:62px;right:50px;top:6%;bottom:6%;border-radius:50%;border:1.5px solid rgba(255,255,255,.1);box-shadow:0 0 40px rgba(255,255,255,.04),inset 0 0 40px rgba(255,255,255,.03);transition:.2s;pointer-events:none}\n.felt.dropok:before{border-color:rgba(255,255,255,.75);box-shadow:0 0 36px rgba(255,255,255,.3),inset 0 0 40px rgba(255,255,255,.1)}\n.tbl{display:grid;grid-template-columns:repeat(3,auto);gap:16px 14px;justify-content:center;padding:0 44px 0 58px}\n.pair{position:relative;width:calc(var(--cw) + 14px);height:calc(var(--cw)*1.42 + 12px)}\n.pair .card{position:absolute}\n.pair .a{left:0;top:0;rotate:-3deg;transition:scale .15s,filter .15s}\n.pair .d{left:14px;top:12px;rotate:8deg}\n.pair.hover .a{scale:1.1;filter:drop-shadow(0 0 .14em #fff)}\n.deckbox,.discardbox{position:absolute;top:50%;translate:0 -50%;width:50px;height:96px}\n.deckbox{left:10px}.discardbox{right:12px}\n.deckbox .trumpc{position:absolute;left:24px;top:30px;rotate:90deg;scale:.8}\n.deckbox .back{position:absolute;left:0;top:10px;scale:.8;transform-origin:top left}\n.deckbox .back+.back{left:2px;top:12px}\n.discardbox .back{position:absolute;left:0;top:10px;scale:.58;transform-origin:top left;filter:brightness(.7)}\n.discardbox.e{opacity:.2}\n.dn{position:absolute;left:0;right:0;top:-12px;text-align:center;font-weight:900;font-size:12px;background:#fff;color:#000;padding:1px 0;z-index:3;border-radius:8px}\n.trumpTag{position:absolute;left:8px;top:calc(50% + 60px);font-weight:800;font-size:12px;letter-spacing:.06em;background:rgba(0,0,0,.6);padding:2px 9px;border-radius:10px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.35);text-transform:uppercase}\n.callout{position:absolute;left:50%;top:50%;translate:-50% -50%;font-weight:900;font-size:34px;letter-spacing:.04em;color:#fff;text-shadow:0 3px 0 #000,0 0 22px rgba(255,255,255,.9);pointer-events:none;z-index:30;animation:cl 1.1s forwards;white-space:nowrap}\n@keyframes cl{0%{opacity:0;scale:.4}20%{opacity:1;scale:1.2}70%{opacity:1;scale:1}100%{opacity:0;translate:-50% -110%}}\n.acts{display:flex;justify-content:center;gap:10px;padding:2px 14px 4px;min-height:58px;align-items:center}\n.acts .btn{min-width:170px;padding:13px 26px;font-size:20px;animation:popin .3s}\n.merow{display:flex;align-items:center;gap:9px;padding:0 14px;margin-top:2px;font-size:13px;font-weight:700;min-height:34px}\n.merow .av{box-shadow:0 0 0 2px #000,0 0 0 3px rgba(255,255,255,.5)}\n.merow.act .av{box-shadow:0 0 0 2px #000,0 0 0 3.5px #fff,0 0 16px rgba(255,255,255,.9)}\n.merow .nm{max-width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 3px #000}\n.emobtn{margin-left:auto;width:38px;height:34px;background:var(--glass);border-radius:12px;box-shadow:var(--edge2);font-size:18px}\n#emoPanel{position:absolute;right:10px;bottom:176px;background:rgba(10,10,14,.95);padding:8px;display:none;gap:6px;z-index:15;border-radius:18px;box-shadow:var(--edge)}\n#emoPanel.show{display:flex;animation:popin .25s}\n#emoPanel button{font-size:26px;padding:4px 6px;border-radius:10px}\n#emoPanel button:active{background:rgba(255,255,255,.15)}\n.bubble{position:absolute;font-size:40px;z-index:25;pointer-events:none;animation:bub 2s forwards;filter:drop-shadow(0 4px 8px rgba(0,0,0,.5))}\n@keyframes bub{0%{opacity:0;translate:0 10px;scale:.4}15%{opacity:1;translate:0 -6px;scale:1.2}80%{opacity:1;translate:0 -14px;scale:1}100%{opacity:0;translate:0 -30px}}\n.hand{position:relative;--cw:var(--hw,72px);height:calc(var(--cw)*1.42 + 54px);flex:none;margin-bottom:calc(6px + env(safe-area-inset-bottom))}\n.hand .card{position:absolute;left:50%;bottom:8px;margin-left:calc(var(--cw)/-2);transform-origin:50% 160%;translate:var(--x) var(--y);rotate:var(--r);transition:translate .16s,opacity .15s;touch-action:none;cursor:grab}\n.hand .card.shake{animation:shake .35s}\n.hand .card.dragsrc{opacity:.18}\n@keyframes shake{25%{margin-left:calc(var(--cw)/-2 - 6px)}75%{margin-left:calc(var(--cw)/-2 + 6px)}}\n.card.dragghost{z-index:80;pointer-events:none;scale:1.12;filter:drop-shadow(0 14px 18px rgba(0,0,0,.75)) drop-shadow(0 0 14px rgba(255,255,255,.35))}\n.dragghost.back{transition:left .22s cubic-bezier(.2,.9,.3,1),top .22s cubic-bezier(.2,.9,.3,1),scale .22s}\n#fx{position:absolute;inset:0;pointer-events:none;overflow:hidden}\n\n/* ---- карты ---- */\n.card{position:relative;width:var(--cw);height:calc(var(--cw)*1.42);font-size:var(--cw);flex:none;background:linear-gradient(160deg,#25252c,#0b0b0e);color:#fff;border-radius:.09em;box-shadow:0 .03em .1em rgba(0,0,0,.75),inset 0 0 0 .022em rgba(255,255,255,.85),inset 0 0 .22em rgba(255,255,255,.1)}\n.card.red{color:#ff7183}\n.card .cr{position:absolute;left:.07em;top:.04em;font-weight:900;font-size:.24em;line-height:.95;text-align:center}\n.card .cr span{display:block;font-size:.8em;margin-top:.02em}\n.card .cr.b{left:auto;top:auto;right:.07em;bottom:.04em;transform:rotate(180deg)}\n.card .cm{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:.55em;line-height:1;text-shadow:0 0 .2em currentColor}\n.card.trump{box-shadow:0 .03em .1em rgba(0,0,0,.75),inset 0 0 0 .04em #fff,0 0 .16em rgba(255,255,255,.55),inset 0 0 .3em rgba(255,255,255,.25)}\n.card.back{background:repeating-linear-gradient(45deg,#0d0d11 0 .05em,#1c1c24 .05em .1em);box-shadow:0 .03em .09em rgba(0,0,0,.7),inset 0 0 0 .03em #fff,inset 0 0 0 .06em #000,inset 0 0 0 .075em rgba(255,255,255,.4);display:flex;align-items:center;justify-content:center;overflow:hidden}\n.card.back i{font-style:normal;font-size:.42em;color:#fff;opacity:.9;text-shadow:0 0 .14em #fff}\n.card.back.bk{background:radial-gradient(circle at 50% 40%,hsl(var(--h) 68% 36%) 0,hsl(var(--h) 60% 14%) 62%,#08080a 100%);box-shadow:0 .03em .09em rgba(0,0,0,.6),inset 0 0 0 .04em var(--bc),inset 0 0 0 .065em #0c0c0f}\n.card.back.bk:before{content:\"\";position:absolute;inset:0;background:repeating-linear-gradient(45deg,rgba(255,255,255,.06) 0 .02em,transparent .02em .07em)}\n.card.back.bk i{opacity:1;color:#fff;font-size:.5em;text-shadow:none;filter:drop-shadow(0 .02em .03em rgba(0,0,0,.7))}\n.card.back.r0{--bc:#8d8d9a}.card.back.r1{--bc:#3b82f6}.card.back.r2{--bc:#a855f7}.card.back.r3{--bc:#ffb703}\n.card.back.r3:after,.card.back.r2:after{content:\"\";position:absolute;inset:-30%;background:linear-gradient(105deg,transparent 40%,rgba(255,255,255,.35) 50%,transparent 60%);transform:translateX(-80%);animation:shine 3s infinite}\n#fx .card.dragghost{position:absolute;margin:0}\n@media (max-height:720px){:root{--cw:56px}}\n@media (min-height:860px){:root{--cw:68px}}\n.xprow{display:flex;align-items:center;gap:8px;margin-top:5px}\n.xprow .xp{flex:1;margin:0}\n.xprow span{font-size:10px;color:var(--mut);font-weight:700;white-space:nowrap}\n\n</style>\n</head>\n<body>\n<div id=\"net\">Нет связи… переподключаемся</div>\n<div id=\"toast\"></div>\n<div id=\"dlg\"></div>\n<div id=\"splash\"><div class=\"logo\">ДУРАК</div><div id=\"splashTx\">Загрузка…</div></div>\n\n<section class=\"screen\" id=\"s-setup\"></section>\n\n<section class=\"screen\" id=\"s-home\">\n  <div id=\"head\"></div>\n  <div id=\"body\"></div>\n  <div id=\"nav\">\n    <button data-tab=\"home\"><svg viewBox=\"0 0 24 24\"><path d=\"M3 11.5 12 4l9 7.5M5.5 10v9.5h4.5v-6h4v6h4.5V10\"/></svg>Главная</button>\n    <button data-tab=\"play\"><svg viewBox=\"0 0 24 24\"><path d=\"M7 4.5v15l12-7.5Z\"/></svg>Играть</button>\n    <button data-tab=\"bag\"><svg viewBox=\"0 0 24 24\"><path d=\"M8 8V6.5A2.5 2.5 0 0 1 10.5 4h3A2.5 2.5 0 0 1 16 6.5V8M5 8h14l1 11.5H4Z\"/><path d=\"M9.5 13h5\"/></svg>Рюкзак<i class=\"bdg\" id=\"bdg\"></i></button>\n    <button data-tab=\"set\"><svg viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"3.2\"/><path d=\"M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8\"/></svg>Настройки</button>\n  </div>\n</section>\n\n<section class=\"screen\" id=\"s-page\"></section>\n<section class=\"screen\" id=\"s-trade\"></section>\n\n<section class=\"screen\" id=\"s-game\">\n  <div class=\"gtop\">\n    <button class=\"gbtn\" id=\"gResign\" title=\"Сдаться\">🏳️</button>\n    <div class=\"gap\" id=\"gTurn\"></div>\n    <div class=\"bank\" id=\"gPot\"></div>\n  </div>\n  <div class=\"tbar\" id=\"tbar\"><i></i></div>\n  <div id=\"gOpp\"></div>\n  <div class=\"felt\" id=\"gFelt\"></div>\n  <div class=\"acts\" id=\"gActs\"></div>\n  <div class=\"merow\" id=\"gMe\"></div>\n  <div id=\"emoPanel\"></div>\n  <div class=\"hand\" id=\"gHand\"></div>\n  <div id=\"fx\"></div>\n  <div id=\"modal\"></div>\n</section>\n\n<div id=\"sheet\"></div>\n<div id=\"pack\"></div>\n\n<script>\n(()=>{\n'use strict';\nconst tg=window.Telegram&&window.Telegram.WebApp;\nif(tg){try{tg.ready();tg.expand();tg.setHeaderColor('#000000');tg.setBackgroundColor('#000000');tg.disableVerticalSwipes&&tg.disableVerticalSwipes();}catch(e){}}\nconst $=s=>document.querySelector(s);\nconst esc=s=>String(s).replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]));\nconst SUIT={S:'♠',H:'♥',D:'♦',C:'♣'};\nconst RN=r=>({11:'J',12:'Q',13:'K',14:'A'}[r]||r);\nconst fmt=n=>String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g,' ');\nconst GR=[['#ff9a3c','#ff5e62'],['#36d1dc','#5b86e5'],['#a8e063','#56ab2f'],['#f7797d','#c471ed'],['#fbd786','#f7797d'],['#43cea2','#185a9d'],['#f093fb','#f5576c'],['#667eea','#764ba2'],['#f2994a','#f2c94c'],['#7f7fd5','#86a8e7']];\nconst PREF={snd:true,vib:true};\ntry{PREF.snd=localStorage.getItem('snd')!=='0';PREF.vib=localStorage.getItem('vib')!=='0'}catch(e){}\nfunction setPref(k,v){PREF[k]=v;try{localStorage.setItem(k,v?'1':'0')}catch(e){}}\nconst hap=(t='light')=>{if(!PREF.vib)return;try{tg&&tg.HapticFeedback&&tg.HapticFeedback.impactOccurred(t)}catch(e){}};\nconst hapN=t=>{if(!PREF.vib)return;try{tg&&tg.HapticFeedback&&tg.HapticFeedback.notificationOccurred(t)}catch(e){}};\nconst sleep=ms=>new Promise(r=>setTimeout(r,ms));\nconst S={snap:null,tab:'home',page:null,bagTab:'decks',stake:100,token:null,es:null,shown:'',built:'',E:null,U:{state:'idle'},T:{q:'',found:[]},lb:null,flt:-1,\n  g:null,gid:null,sig:'',prevG:null,deadlineAt:0,celebrated:null,knownIn:null,emoSeen:{},TB:null,CB:{}};\nwindow.__S=S;\nlet guest=null;try{guest=localStorage.getItem('gid')}catch(e){}\nif(!guest){guest=Array.from(crypto.getRandomValues(new Uint8Array(12))).map(b=>b.toString(16).padStart(2,'0')).join('');try{localStorage.setItem('gid',guest)}catch(e){}}\n\n/* ---------- сеть ---------- */\nasync function post(path,body){\n  const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});\n  let j={};try{j=await r.json()}catch(e){}\n  j._status=r.status;return j;\n}\nasync function api(path){\n  const r=await fetch(path+(path.includes('?')?'&':'?')+'token='+S.token);\n  if(r.status===401){if(await login()===true){connect();return api(path)}}\n  return r.ok?r.json():null;\n}\nasync function login(){\n  try{\n    const r=await post('/api/auth',{initData:tg?tg.initData:'',guestId:guest});\n    if(r.token){S.token=r.token;return true}\n    $('#splashTx').textContent=r.error||'Ошибка входа';\n    return r._status===503?'retry':false;\n  }catch(e){$('#splashTx').textContent='Нет связи с сервером…';return 'retry'}\n}\nfunction applySnap(j){\n  if(!S.snap||!S.snap.cfg||S.snap.cfg.cards!==j.cfg.cards){S.CB={};for(const c of j.cfg.cards)S.CB[c.id]=c}\n  S.snap=j;$('#net').style.display='none';render()\n}\nfunction connect(){\n  if(S.es){S.es.close();S.es=null}\n  const es=new EventSource('/api/events?token='+S.token);S.es=es;\n  es.onopen=()=>{$('#net').style.display='none'};\n  es.onmessage=e=>{let j;try{j=JSON.parse(e.data)}catch(_){return}applySnap(j)};\n  es.onerror=()=>{\n    $('#net').style.display='block';es.close();if(S.es===es)S.es=null;\n    setTimeout(async()=>{if(S.es)return;const ok=await login();if(ok===true)connect();else setTimeout(()=>location.reload(),4000)},1500);\n  };\n}\nasync function act(type,data={}){\n  let r=await post('/api/action',{token:S.token,type,...data});\n  if(r._status===401){if(await login()===true){connect();r=await post('/api/action',{token:S.token,type,...data})}}\n  if(r.error&&r.error!=='AUTH'){toast(r.error);hapN('error')}\n  return r;\n}\nasync function refreshState(){\n  try{\n    const r=await fetch('/api/state?token='+S.token);\n    if(r.status===401){if(await login()===true)connect();return}\n    if(r.ok)applySnap(await r.json());\n    if(!S.es||S.es.readyState!==1)connect();\n  }catch(e){}\n}\nlet tt;function toast(m,ok){const t=$('#toast');t.textContent=m;t.className='show'+(ok?' ok':'');clearTimeout(tt);tt=setTimeout(()=>t.className='',2800)}\nfunction dlg(html){const d=$('#dlg');d.innerHTML='<div class=\"res\">'+html+'</div>';d.classList.add('show')}\nfunction closeDlg(){$('#dlg').classList.remove('show')}\n$('#dlg').onclick=e=>{if(e.target.id==='dlg')closeDlg()};\nfunction sheet(html){const s=$('#sheet');s.innerHTML='<div class=\"in\">'+html+'</div>';s.classList.add('show')}\nfunction closeSheet(){$('#sheet').classList.remove('show')}\n$('#sheet').onclick=e=>{if(e.target.id==='sheet')closeSheet()};\n\n/* ---------- общие куски ---------- */\nfunction av(p,sz=40){\n  const g=GR[p.color%GR.length];\n  return `<div class=\"av\" style=\"width:${sz}px;height:${sz}px;font-size:${Math.round(sz*.52)}px;background:linear-gradient(135deg,${g[0]},${g[1]})\"><span>${p.emoji}</span>${p.photo?`<img src=\"${esc(p.photo)}\" referrerpolicy=\"no-referrer\" onerror=\"this.remove()\">`:''}</div>`;\n}\nconst rk=r=>`<span class=\"rk\">${r.icon} ${esc(r.name)}</span>`;\nconst uname=u=>u.username?`<span class=\"un\">@${esc(u.username)}</span>`:'';\nconst coin='<i class=\"coin\"></i>';\n/* коллекционная карточка (и рубашка) */\nfunction cardArt(id,w=70,o={}){\n  const c=S.CB[id];if(!c)return '';\n  if(o.own===false)return `<div class=\"ccard locked\" style=\"--w:${w}px\"><i class=\"q\">?</i></div>`;\n  return `<div class=\"ccard r${c.r}${o.cls?' '+o.cls:''}\" style=\"--w:${w}px;--h:${c.h}\"><div class=\"ca\"><i class=\"em\">${c.e}</i></div><b class=\"cn\">${c.n}</b><span class=\"cr3\">${'◆'.repeat(c.r+1)}</span>${o.n>1?`<u class=\"cnt\">×${o.n}</u>`:''}</div>`;\n}\nfunction backHTML(id,cls='',st=''){\n  const c=id&&S.CB[id];\n  return c?`<div class=\"card back bk r${c.r} ${cls}\" style=\"--h:${c.h};${st}\"><i>${c.e}</i></div>`:`<div class=\"card back ${cls}\" style=\"${st}\"><i>♠</i></div>`;\n}\nfunction showScreen(n){\n  if(S.shown===n)return;S.shown=n;\n  for(const id of ['setup','home','game'])$('#s-'+id).classList.toggle('active',id===n);\n  $('#splash').style.display='none';\n  if(tg){try{n==='game'?tg.enableClosingConfirmation():tg.disableClosingConfirmation()}catch(e){}}\n}\nfunction hms(ms){const m=Math.ceil(ms/60000);return m>=60?Math.floor(m/60)+' ч '+(m%60)+' мин':m+' мин'}\nfunction countUp(el,v,pre=''){const t0=performance.now();const step=t=>{const k=Math.min(1,(t-t0)/900);el.innerHTML=(v>0?'+':'')+pre+Math.round(v*(1-Math.pow(1-k,3)))+' '+coin;if(k<1)requestAnimationFrame(step)};requestAnimationFrame(step)}\n\n/* ---------- профиль: редактор ---------- */\nfunction prevP(){const m=S.snap.me,E=S.E;return{emoji:E.emoji,color:E.color,photo:E.usePhoto?m.photoUrl:null}}\nfunction editorHTML(first){\n  const m=S.snap.me,E=S.E,cfg=S.snap.cfg,locked=!first&&m.unameWait>0;\n  return `<div class=\"ed\">\n  <div class=\"center\" id=\"edprev\">${av(prevP(),92)}</div>\n  <label class=\"lbl\">Имя (видят соперники)</label><input class=\"inp\" id=\"edname\" maxlength=\"16\" value=\"${esc(E.name)}\" placeholder=\"Как вас зовут?\" autocomplete=\"off\">\n  <label class=\"lbl\">Никнейм — уникальный, как в Telegram</label>\n  <div class=\"uwrap\"><span class=\"at\">@</span><input class=\"inp\" id=\"eduser\" maxlength=\"20\" value=\"${esc(E.username)}\" placeholder=\"username\" autocomplete=\"off\" autocapitalize=\"off\" autocorrect=\"off\" spellcheck=\"false\" ${locked?'disabled':''}><span class=\"ustat\" id=\"ustat\"></span></div>\n  <div class=\"note\" id=\"umsg\">${locked?'Ник можно менять раз в сутки (через '+hms(m.unameWait)+')':'5–20 символов: латиница, цифры и _. Занятый ник взять нельзя. По нику вас найдут для обмена.'}</div>\n  <label class=\"lbl\">Аватар</label><div class=\"egrid\">${cfg.emojis.map(e=>`<button class=\"eb ${e===E.emoji?'on':''}\" data-e=\"${e}\">${e}</button>`).join('')}</div>\n  <label class=\"lbl\">Цвет</label><div class=\"cgrid\">${GR.map((g,i)=>`<button class=\"cb ${i===E.color?'on':''}\" data-c=\"${i}\" style=\"background:linear-gradient(135deg,${g[0]},${g[1]})\"></button>`).join('')}</div>\n  ${m.hasPhoto?`<label class=\"lbl chk\"><input type=\"checkbox\" id=\"edphoto\" ${E.usePhoto?'checked':''}> Использовать моё фото из Telegram</label>`:''}\n  <div style=\"height:18px\"></div>\n  <button class=\"btn primary big\" id=\"edsave\">${first?'В бой':'Сохранить'}</button></div>`;\n}\nconst unameLocal=v=>(!/^[A-Za-z][A-Za-z0-9_]{4,19}$/.test(v)||/__/.test(v)||/_$/.test(v))?'5–20 символов: латиница, цифры и _, первая — буква':null;\nlet uTimer=0,uSeq=0;\nfunction setUStat(root,first,state,msg){\n  S.U={state,msg};\n  const st=root.querySelector('#ustat'),mg=root.querySelector('#umsg'),sv=root.querySelector('#edsave');if(!st)return;\n  st.textContent={ok:'✅',bad:'❌',wait:'⏳',idle:''}[state];\n  if(msg!==undefined){mg.textContent=msg;mg.className='note '+(state==='bad'?'bad':state==='ok'?'okc':'')}\n  if(sv)sv.classList.toggle('off',first&&state!=='ok');\n}\nfunction onUser(root,first,input){\n  let val=input.value.replace(/[^A-Za-z0-9_]/g,'').slice(0,20);input.value=val;S.E.username=val;\n  clearTimeout(uTimer);const my=S.snap.me;\n  if(my.username&&val===my.username)return setUStat(root,first,'ok','Это ваш текущий ник');\n  if(!val)return setUStat(root,first,'idle','5–20 символов: латиница, цифры и _. Занятый ник взять нельзя.');\n  const e=unameLocal(val);if(e)return setUStat(root,first,'bad',e);\n  setUStat(root,first,'wait','Проверяем…');const seq=++uSeq;\n  uTimer=setTimeout(async()=>{\n    try{const j=await api('/api/uname?q='+encodeURIComponent(val));\n      if(seq!==uSeq||!j)return;j.free?setUStat(root,first,'ok','Ник свободен ✨'):setUStat(root,first,'bad',j.error||'Ник занят')}\n    catch(_){if(seq===uSeq)setUStat(root,first,'idle','Не удалось проверить ник')}\n  },350);\n}\nfunction bindEditor(root,first){\n  const upd=()=>{root.querySelector('#edprev').innerHTML=av(prevP(),92)};\n  const ui=root.querySelector('#eduser');\n  if(ui&&!ui.disabled)onUser(root,first,ui);\n  root.onclick=async e=>{\n    const eb=e.target.closest('.eb'),cb=e.target.closest('.cb');\n    if(eb){S.E.emoji=eb.dataset.e;root.querySelectorAll('.eb').forEach(b=>b.classList.toggle('on',b===eb));upd();hap()}\n    else if(cb){S.E.color=+cb.dataset.c;root.querySelectorAll('.cb').forEach(b=>b.classList.toggle('on',b===cb));upd();hap()}\n    else if(e.target.closest('#edsave')){\n      const my=S.snap.me,changed=S.E.username&&S.E.username!==my.username;\n      if((first||changed)&&!ui.disabled&&S.U.state!=='ok'){toast(S.U.state==='wait'?'Подождите, проверяем ник…':(S.U.msg||'Выберите свободный ник'));return}\n      const r=await act('profile',{name:S.E.name,username:S.E.username,emoji:S.E.emoji,color:S.E.color,usePhoto:S.E.usePhoto});\n      if(r.ok){hapN('success');if(!first){toast('Сохранено ✅',true);S.built=''}}\n    }\n  };\n  root.oninput=e=>{if(e.target.id==='edname')S.E.name=e.target.value;else if(e.target.id==='eduser')onUser(root,first,e.target)};\n  root.onchange=e=>{if(e.target.id==='edphoto'){S.E.usePhoto=e.target.checked;upd()}};\n}\nfunction initE(){const m=S.snap.me;S.E={name:m.name,username:m.username||m.suggest||'',emoji:m.emoji,color:m.color,usePhoto:m.usePhoto||(!m.ready&&m.hasPhoto)}}\n\n/* ---------- иконки и арты ---------- */\nconst SUITP={\n  S:'M12 2C9 7 4 9.5 4 14a4 4 0 0 0 6.5 3.1C10.3 19 9.7 20.5 8.5 22h7c-1.2-1.5-1.8-3-2-4.9A4 4 0 0 0 20 14c0-4.5-5-7-8-12Z',\n  H:'M12 21C5 15.5 2.5 12 2.5 8.5A4.8 4.8 0 0 1 12 6.6 4.8 4.8 0 0 1 21.5 8.5C21.5 12 19 15.5 12 21Z',\n  D:'M12 2.5 20 12l-8 9.5L4 12Z',\n  C:'M12 3a3.8 3.8 0 0 0-3.4 5.5A4.2 4.2 0 1 0 10.5 15c-.1 2.4-.8 4.6-2 6h7c-1.2-1.4-1.9-3.6-2-6a4.2 4.2 0 1 0 1.9-6.5A3.8 3.8 0 0 0 12 3Z'\n};\nconst sv=(d,cls='')=>`<svg viewBox=\"0 0 24 24\"${cls?` class=\"${cls}\"`:''}>${d}</svg>`;\nconst IC={\n  spade:sv(`<path d=\"${SUITP.S}\"/>`,'suit'),heart:sv(`<path d=\"${SUITP.H}\"/>`,'suit'),\n  diamond:sv(`<path d=\"${SUITP.D}\"/>`,'suit'),club:sv(`<path d=\"${SUITP.C}\"/>`,'suit'),\n  friends:sv('<circle cx=\"12\" cy=\"7.5\" r=\"3.2\"/><circle cx=\"4.8\" cy=\"10\" r=\"2.3\"/><circle cx=\"19.2\" cy=\"10\" r=\"2.3\"/><path d=\"M6.5 20c0-3.3 2.4-5.4 5.5-5.4s5.5 2.1 5.5 5.4M1.8 18.5c0-2.2 1.3-3.8 3.3-4.2M22.2 18.5c0-2.2-1.3-3.8-3.3-4.2\"/>'),\n  stats:sv('<path d=\"M4 20V13M10 20V9M16 20V4M3 20.5h18\"/><rect x=\"2.8\" y=\"11\" width=\"2.4\" height=\"2\" /><rect x=\"8.8\" y=\"7\" width=\"2.4\" height=\"2\"/><rect x=\"14.8\" y=\"2\" width=\"2.4\" height=\"2\"/>'),\n  trophy:sv('<path d=\"M7 4h10v6a5 5 0 0 1-10 0ZM7 6H3.5v1.5A3.5 3.5 0 0 0 7 11M17 6h3.5v1.5A3.5 3.5 0 0 1 17 11M12 15v4M8 20.5h8\"/>'),\n  shop:sv('<path d=\"M4 9.5 5.5 4h13L20 9.5M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M5.5 12.5V20h13v-7.5M10 20v-4.5h4V20\"/>'),\n  swap:sv('<path d=\"M4 8.5h14.5M14.5 4.5l4 4-4 4M20 15.5H5.5M9.5 11.5l-4 4 4 4\"/>'),\n  gear:sv('<circle cx=\"12\" cy=\"12\" r=\"3.2\"/><path d=\"M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8\"/>'),\n  crown:sv('<path d=\"M3.5 18 2.5 7.5l5 4 4.5-7 4.5 7 5-4L20.5 18ZM4.5 21h15\"/>'),\n  sticker:sv('<rect x=\"3.5\" y=\"3.5\" width=\"17\" height=\"17\" rx=\"5\"/><circle cx=\"9\" cy=\"10\" r=\"1\"/><circle cx=\"15\" cy=\"10\" r=\"1\"/><path d=\"M8.5 14.5c1.8 2.2 5.2 2.2 7 0\"/>'),\n  frame:sv('<rect x=\"3\" y=\"4\" width=\"18\" height=\"16\" rx=\"3\"/><circle cx=\"9\" cy=\"10\" r=\"1.8\"/><path d=\"m4 18 5-4.5 3.5 3 3-2.5L20 18\"/>'),\n  lock:sv('<rect x=\"5\" y=\"10.5\" width=\"14\" height=\"10\" rx=\"3\"/><path d=\"M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5\"/>'),\n  cards:sv('<rect x=\"3\" y=\"6\" width=\"11\" height=\"15\" rx=\"2\" transform=\"rotate(-10 8 13)\"/><rect x=\"9\" y=\"3\" width=\"11\" height=\"15\" rx=\"2\" transform=\"rotate(8 14 10)\"/>')\n};\nconst ART={\n  crown:`<svg viewBox=\"0 0 200 150\"><g fill=\"none\" stroke=\"#fff\" stroke-width=\"3\" stroke-linejoin=\"round\" stroke-linecap=\"round\"><path d=\"M28 114 14 46l46 34 40-64 40 64 46-34-14 68Z\" fill=\"rgba(255,255,255,.07)\"/><path d=\"M60 80l12 34M100 16v98M140 80l-12 34\" stroke-width=\"1.6\" opacity=\".6\"/><path d=\"M26 130h148M30 122h140\" stroke-width=\"2.4\"/></g><g fill=\"#fff\"><circle cx=\"14\" cy=\"42\" r=\"4.5\"/><circle cx=\"100\" cy=\"11\" r=\"5.5\"/><circle cx=\"186\" cy=\"42\" r=\"4.5\"/></g></svg>`,\n  cards:`<svg viewBox=\"0 0 240 172\"><g fill=\"rgba(255,255,255,.07)\" stroke=\"#fff\" stroke-width=\"2.6\" stroke-linejoin=\"round\"><g transform=\"rotate(-16 62 100)\"><rect x=\"26\" y=\"48\" width=\"72\" height=\"104\" rx=\"10\"/><path d=\"${SUITP.S}\" transform=\"translate(39 77) scale(1.9)\" fill=\"rgba(255,255,255,.12)\"/></g><g transform=\"rotate(16 178 100)\"><rect x=\"142\" y=\"48\" width=\"72\" height=\"104\" rx=\"10\"/><path d=\"${SUITP.H}\" transform=\"translate(155 77) scale(1.9)\" fill=\"rgba(255,255,255,.12)\"/></g><g><rect x=\"84\" y=\"26\" width=\"72\" height=\"104\" rx=\"10\" fill=\"rgba(0,0,0,.8)\"/><rect x=\"84\" y=\"26\" width=\"72\" height=\"104\" rx=\"10\"/><path d=\"${SUITP.D}\" transform=\"translate(97 55) scale(1.9)\" fill=\"rgba(255,255,255,.14)\"/></g></g></svg>`\n};\n/* монета с джокером: рисуем сами, используется везде как .coin */\n(function(){\n  const svg=`<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><defs><radialGradient id=\"g\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#fff\"/><stop offset=\".6\" stop-color=\"#c9cdd6\"/><stop offset=\"1\" stop-color=\"#7d828d\"/></radialGradient></defs><circle cx=\"32\" cy=\"32\" r=\"30\" fill=\"url(#g)\" stroke=\"#fff\" stroke-width=\"2\"/><circle cx=\"32\" cy=\"32\" r=\"24.5\" fill=\"none\" stroke=\"#0b0b0e\" stroke-width=\"2\" opacity=\".75\"/><path d=\"M13 31 17 11l9 12 6-16 6 16 9-12 4 20Z\" fill=\"#0b0b0e\"/><circle cx=\"17\" cy=\"10\" r=\"3\" fill=\"#0b0b0e\"/><circle cx=\"32\" cy=\"6.5\" r=\"3\" fill=\"#0b0b0e\"/><circle cx=\"47\" cy=\"10\" r=\"3\" fill=\"#0b0b0e\"/><circle cx=\"32\" cy=\"40\" r=\"11.5\" fill=\"#0b0b0e\"/><path d=\"m25.5 37 3 3-3 3-3-3ZM38.5 37l3 3-3 3-3-3Z\" fill=\"#fff\"/><path d=\"M26 45c3.5 3.8 8.5 3.8 12 0\" fill=\"none\" stroke=\"#fff\" stroke-width=\"2\" stroke-linecap=\"round\"/></svg>`;\n  document.documentElement.style.setProperty('--coinimg','url(\"data:image/svg+xml,'+encodeURIComponent(svg)+'\")');\n})();\n\n/* ---------- звуки (синтез, без файлов) ---------- */\nconst SND={ctx:null,master:null,noise:null};\nfunction actx(){\n  if(!PREF.snd)return null;\n  try{\n    if(!SND.ctx){\n      const C=window.AudioContext||window.webkitAudioContext;if(!C)return null;\n      const c=SND.ctx=new C();SND.master=c.createGain();SND.master.gain.value=.6;SND.master.connect(c.destination);\n      const n=c.sampleRate|0,b=c.createBuffer(1,n,c.sampleRate),d=b.getChannelData(0);\n      for(let i=0;i<n;i++)d[i]=Math.random()*2-1;SND.noise=b;\n    }\n    if(SND.ctx.state==='suspended')SND.ctx.resume();\n    return SND.ctx;\n  }catch(e){return null}\n}\nfunction nz(c,t,dur,o={}){          // шорох: фильтрованный шум\n  const {f=3000,f2=0,q=.8,type='bandpass',vol=.3,att=.004}=o;\n  const s=c.createBufferSource();s.buffer=SND.noise;\n  const fl=c.createBiquadFilter();fl.type=type;fl.Q.value=q;fl.frequency.setValueAtTime(f,t);\n  if(f2)fl.frequency.exponentialRampToValueAtTime(f2,t+dur);\n  const g=c.createGain();g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(vol,t+att);g.gain.exponentialRampToValueAtTime(.0001,t+dur);\n  s.connect(fl);fl.connect(g);g.connect(SND.master);s.start(t,Math.random()*.5,dur+.05);\n}\nfunction tone(c,t,f,dur,o={}){\n  const {type='sine',vol=.2,f2=0,att=.006}=o;\n  const os=c.createOscillator(),g=c.createGain();os.type=type;os.frequency.setValueAtTime(f,t);\n  if(f2)os.frequency.exponentialRampToValueAtTime(f2,t+dur);\n  g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(vol,t+att);g.gain.exponentialRampToValueAtTime(.0001,t+dur);\n  os.connect(g);g.connect(SND.master);os.start(t);os.stop(t+dur+.05);\n}\nfunction sfx(k){\n  const c=actx();if(!c)return;const t=c.currentTime+.005;\n  try{switch(k){\n    case 'tap':nz(c,t,.07,{f:4300,f2:1700,q:.7,vol:.17});break;\n    case 'card':nz(c,t,.17,{f:2600,f2:900,q:.9,vol:.38});nz(c,t+.02,.1,{f:6500,type:'highpass',vol:.07});break;\n    case 'place':nz(c,t,.1,{f:650,type:'lowpass',q:.5,vol:.55});tone(c,t,150,.1,{vol:.28,f2:65});nz(c,t,.12,{f:3200,f2:1400,vol:.2});break;\n    case 'deal':for(let i=0;i<5;i++)nz(c,t+i*.1,.13,{f:2800,f2:1000,vol:.3});break;\n    case 'take':for(let i=0;i<3;i++)nz(c,t+i*.08,.14,{f:2400,f2:900,vol:.3});break;\n    case 'discard':nz(c,t,.32,{f:2300,f2:600,vol:.34});break;\n    case 'coin':tone(c,t,1320,.12,{type:'triangle',vol:.18});tone(c,t+.08,1760,.2,{type:'triangle',vol:.16});break;\n    case 'win':[523,659,784,1047].forEach((f,i)=>tone(c,t+i*.12,f,.3,{type:'triangle',vol:.22}));break;\n    case 'lose':[392,330,262].forEach((f,i)=>tone(c,t+i*.17,f,.34,{type:'triangle',vol:.2}));break;\n    case 'err':tone(c,t,150,.14,{type:'sawtooth',vol:.1,f2:90});break;\n    case 'pack':nz(c,t,.5,{f:400,f2:5000,q:.6,vol:.3});break;\n    case 'flip':nz(c,t,.18,{f:3200,f2:1200,vol:.3});tone(c,t+.04,880,.18,{type:'triangle',vol:.1});break;\n    case 'ok':tone(c,t,660,.1,{type:'triangle',vol:.15});tone(c,t+.08,990,.16,{type:'triangle',vol:.15});break;\n  }}catch(e){}\n}\n['touchend','click','keydown'].forEach(ev=>document.addEventListener(ev,()=>{actx()},{passive:true,capture:true}));\ndocument.addEventListener('pointerdown',e=>{\n  if(!PREF.snd)return;actx();\n  const el=e.target.closest&&e.target.closest('button,.tile,.trow,.orow,.cell,.bbtn,.chip,.slot.add,.stk,.fl,.btab,.eb,.cb,.tog,.pair');\n  if(el&&!el.closest('#gHand'))sfx('tap');\n},true);\n\n/* ================= шапка и вкладки ================= */\nfunction renderHead(){\n  const m=S.snap.me,r=m.rank;\n  const pct=r.to?Math.min(100,Math.round((m.rating-r.from)/(r.to-r.from)*100)):100;\n  const xt=r.to?`${m.rating-r.from} / ${r.to-r.from} XP`:'MAX';\n  $('#head').innerHTML=`<button id=\"hav\">${av(m,54)}</button>\n  <div class=\"who\"><div class=\"nm\">${esc(m.name)}</div><div class=\"lv\">Ур. ${r.idx+1} · ${esc(r.name)}</div><div class=\"xprow\"><div class=\"xp\"><i style=\"width:${pct}%\"></i></div><span>${xt}</span></div></div>\n  <button class=\"coins\" id=\"hcoins\">${coin}<span>${fmt(m.coins)}</span><b>+</b></button>\n  <button class=\"gear\" id=\"hgear\">${IC.gear}</button>`;\n  const n=(S.snap.offers||[]).filter(o=>o.dir==='in').length,b=$('#bdg');\n  b.textContent=n;b.style.display=n?'flex':'none';\n}\n$('#head').onclick=e=>{\n  if(e.target.closest('#hcoins')){hap();openPage('shop')}\n  else if(e.target.closest('#hav')||e.target.closest('#hgear')){hap();closePage();setTab('set')}\n};\nfunction setTab(t){S.tab=t;S.built='';renderHome();$('#body').scrollTop=0}\nconst ownedCount=inv=>Object.keys(inv||{}).length;\nfunction renderHome(){\n  const s=S.snap;renderHead();\n  document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('on',b.dataset.tab===S.tab));\n  const body=$('#body');\n  if(S.tab==='set')return tabSet(body);\n  if(S.tab==='bag'){S.built='bag';return tabBag(body)}\n  if(S.tab==='play'){S.built='play';return tabPlay(body)}\n  S.built='home';tabHome(body);\n}\nfunction waitBanner(){\n  const s=S.snap;if(!s.myTable)return '';\n  const t=s.tables.find(x=>x.id===s.myTable);\n  let h=`<div class=\"banner\"><div class=\"spin\"></div><div class=\"tx\"><b>Ищем соперника…</b><br><span class=\"un\">Ставка ${t?t.stake:''}${t&&t.priv?' · приватный стол':''}</span></div><button class=\"btn sm\" id=\"bCancel\">Отмена</button></div>`;\n  if(t&&t.priv)h+=`<div class=\"banner\" style=\"flex-direction:column;align-items:stretch;text-align:center;gap:6px\"><div class=\"un\">Код стола для друга</div><div class=\"code\">${esc(t.code)}</div>${S.snap.cfg.bot?'<button class=\"btn sm\" id=\"bShareCode\">Отправить другу</button>':''}</div>`;\n  return h;\n}\nfunction dailyBanner(){\n  const s=S.snap,m=s.me;\n  if(m.daily<=0)return `<div class=\"banner\"><span style=\"font-size:30px\">🎁</span><div class=\"tx\"><b>Ежедневный бонус</b><br><span class=\"un\">+${m.dailyAmount} монет</span></div><button class=\"btn gold sm\" id=\"bDaily\">Забрать</button></div>`;\n  if(m.coins<s.cfg.stakes[0])return `<div class=\"banner\"><span style=\"font-size:28px\">💸</span><div class=\"tx\">Монеты почти закончились.<br><span class=\"un\">Бонус через <b>${hms(m.daily)}</b></span></div></div>`;\n  return '';\n}\nfunction tile(attr,icon,label,badge,dis){\n  return `<button class=\"tile\" ${attr} ${dis?'disabled':''}><div class=\"ic\">${icon}</div>${label}${badge?`<i class=\"nw\">${badge}</i>`:''}</button>`;\n}\nfunction tabHome(body){\n  const s=S.snap,onl=(s.friends||[]).filter(f=>f.online).length;\n  body.innerHTML=waitBanner()+dailyBanner()+`<div class=\"art\">${ART.crown}<i class=\"spark\" style=\"left:16%;top:10%\">✦</i><i class=\"spark\" style=\"right:18%;top:4%\">✦</i><i class=\"spark\" style=\"left:28%;bottom:4%\">✧</i></div>\n  <div class=\"tiles\">${tile('data-go=\"friends\"',IC.friends,'Друзья',onl)}${tile('data-go=\"stats\"',IC.stats,'Статистика')}${tile('data-go=\"top\"',IC.trophy,'Топ 50')}${tile('data-go=\"shop\"',IC.shop,'Магазин')}</div>\n  <div class=\"note\" style=\"text-align:center\"><span class=\"pulse-dot\"></span>${s.online} онлайн</div>`;\n}\nfunction tabPlay(body){\n  const s=S.snap,busyT=!!s.myTable,others=s.tables.filter(t=>!t.mine).length;\n  body.innerHTML=waitBanner()+dailyBanner()+`<div class=\"art\">${ART.cards}<i class=\"spark\" style=\"left:10%;top:14%\">✦</i><i class=\"spark\" style=\"right:10%;top:8%\">✧</i></div>\n  <div class=\"tiles\">${tile('data-play=\"quick\"',IC.spade,'Быстрая игра','',busyT)}${tile('data-play=\"priv\"',IC.club,'Приватные','',busyT)}${tile('data-play=\"open\"',IC.heart,'Открытые',others,busyT)}${tile('data-play=\"create\"',IC.diamond,'Создать игру','',busyT)}</div>\n  <button class=\"wbtn\" id=\"bPractice\" ${busyT?'disabled':''}>${IC.cards} Тренировка с ботом <span class=\"un\">без ставки</span></button>`;\n}\n/* ---- выбор ставки ---- */\nfunction stakeSheet(kind){\n  const s=S.snap,m=s.me,st=s.cfg.stakes;\n  if(!st.includes(S.stake)||S.stake>m.coins){S.stake=[...st].reverse().find(x=>x<=m.coins)||st[0]}\n  const title={quick:'Быстрая игра',create:'Создать игру',priv:'Приватная игра'}[kind];\n  const sub={quick:'Мы найдём соперника с такой же ставкой.',create:'Ваш стол появится в списке «Открытые».',priv:'Стол увидят только те, кому вы отправите код.'}[kind];\n  const goTx={quick:'Играть',create:'Создать стол',priv:'Создать приватный стол'}[kind];\n  const pot=()=>{const p=S.stake*2,get=p-Math.floor(p*s.cfg.fee);return `<span>Банк <b>${fmt(p)}</b></span><span>Победа: <b>+${fmt(get-S.stake)}</b> (комиссия ${Math.round(s.cfg.fee*100)}%)</span>`};\n  sheet(`<h3>${title}</h3><div class=\"note\" style=\"margin:-6px 0 4px\">${sub}</div>\n  <div class=\"stakes\">${st.map(x=>`<button class=\"stk ${x===S.stake?'on':''}\" data-st=\"${x}\" ${x>m.coins?'disabled':''}>${x}<small>СТАВКА</small></button>`).join('')}</div>\n  <div class=\"potline\" id=\"potl\">${pot()}</div>\n  <button class=\"btn primary big\" id=\"sgo\" ${m.coins<st[0]?'disabled':''}>${goTx}</button>\n  ${kind==='priv'?`<div class=\"lbl\">Войти по коду</div><div style=\"display:flex;gap:8px\"><input class=\"inp\" id=\"pcode\" maxlength=\"5\" placeholder=\"КОД\" autocomplete=\"off\" autocapitalize=\"characters\" autocorrect=\"off\" spellcheck=\"false\" style=\"text-transform:uppercase;letter-spacing:.3em;text-align:center\"><button class=\"btn\" id=\"pjoin\">Войти</button></div>`:''}`);\n  $('#sheet').onclick=async e=>{\n    if(e.target.id==='sheet')return closeSheet();\n    const k=e.target.closest('.stk');\n    if(k&&!k.disabled){S.stake=+k.dataset.st;hap();$('#sheet').querySelectorAll('.stk').forEach(b=>b.classList.toggle('on',b===k));$('#potl').innerHTML=pot();return}\n    if(e.target.closest('#sgo')){\n      hap('medium');closeSheet();\n      if(kind==='quick')act('quick',{stake:S.stake});else act('create',{stake:S.stake,priv:kind==='priv'});\n      return;\n    }\n    if(e.target.closest('#pjoin')){\n      const code=($('#pcode').value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');\n      if(code.length!==5){toast('Код состоит из 5 символов');sfx('err');return}\n      const r=await act('joincode',{code});if(r.ok)closeSheet();\n    }\n  };\n}\n/* ---------- рюкзак ---------- */\nfunction tabBag(body){\n  const s=S.snap,m=s.me,cards=s.cfg.cards,own=ownedCount(m.inv),inOff=(s.offers||[]).filter(o=>o.dir==='in').length;\n  const tabs=[['decks','Колоды',IC.crown],['stickers','Стикеры',IC.sticker],['frames','Рамки',IC.frame]];\n  let c='';\n  if(S.bagTab==='decks'){\n    const hint=m.pity>0?`<div class=\"note\" style=\"text-align:center;margin:-4px 0 10px\">Гарантия эпика через ${Math.max(0,s.cfg.pity-m.pity)} наб.</div>`:'';\n    c=`<h4>Колоды</h4><div class=\"progress\"><span>${own}/${cards.length}</span><div class=\"xp\"><i style=\"width:${Math.round(own/cards.length*100)}%\"></i></div></div>\n    <button class=\"btn ${m.freePacks?'gold':'primary'} packbtn big\" id=\"bPack\">${m.freePacks?'🎁 Открыть бесплатно':coin+' Набор · '+s.cfg.packPrice}</button>${hint}\n    <div class=\"filters\">${['Все','Обыч.','Редк.','Эпич.','Лег.'].map((n,i)=>`<button class=\"fl ${S.flt===i-1?'on':''}\" data-flt=\"${i-1}\">${n}</button>`).join('')}</div>`;\n    const list=cards.filter(x=>S.flt<0||x.r===S.flt).sort((a,b)=>(b.r-a.r)||a.id.localeCompare(b.id));\n    c+=`<div class=\"cgrid3\">${list.map(x=>{const n=m.inv[x.id]||0;return `<div class=\"cell ${m.back===x.id?'eq':''}\" data-card=\"${x.id}\">${cardArt(x.id,72,{own:n>0,n})}</div>`}).join('')}</div>`;\n  }else{\n    const nm=S.bagTab==='stickers'?'Стикеры':'Рамки';\n    c=`<h4>${nm}</h4><div class=\"soon\">${S.bagTab==='stickers'?IC.sticker:IC.frame}<div>Скоро!</div><div class=\"un\">Мы уже работаем над этим разделом</div></div>`;\n  }\n  body.innerHTML=`<div class=\"bagbtns\"><button class=\"bbtn\" data-go=\"trade\">${IC.swap}Обмен${inOff?`<i class=\"nw\" style=\"position:absolute;right:12px;top:10px;min-width:20px;height:20px;border-radius:10px;background:#fff;color:#000;font-size:11px;font-weight:900;font-style:normal;display:flex;align-items:center;justify-content:center\">${inOff}</i>`:''}</button><button class=\"bbtn\" data-go=\"send\"><i class=\"coin\"></i>Передать монеты</button></div>\n  <div class=\"bag\"><div class=\"btabs\">${tabs.map(t=>`<button class=\"btab ${S.bagTab===t[0]?'on':''}\" data-btab=\"${t[0]}\">${t[2]}${t[1]}</button>`).join('')}</div><div class=\"bcont\">${c}</div></div>`;\n}\nfunction openCardSheet(id){\n  const s=S.snap,m=s.me,c=S.CB[id],n=m.inv[id]||0;if(!c)return;\n  const price=s.cfg.sell[c.r];\n  sheet(`<div style=\"display:flex;gap:16px;align-items:center;margin-bottom:16px\">${cardArt(id,120,{own:n>0})}<div style=\"flex:1\"><h3 style=\"margin:0 0 4px\">${n?esc(c.n):'???'}</h3><div class=\"rk\" style=\"display:inline-block;margin-bottom:8px\">${s.cfg.rarity[c.r]}</div><div style=\"color:var(--mut);font-size:13px\">${n?'У вас: '+n+' шт.':'Ещё не найдена. Выпадает из наборов и за победы.'}</div></div></div>\n  ${n?`<button class=\"btn ${m.back===id?'':'primary'} big\" id=\"cEq\">${m.back===id?'Снять рубашку':'Надеть как рубашку'}</button>`:''}\n  ${n>1?`<div style=\"height:8px\"></div><button class=\"btn big\" id=\"cSell\">Продать дубликат · +${price} ${coin}</button>`:''}\n  ${n?`<div style=\"height:8px\"></div><button class=\"btn big\" id=\"cTrade\">Предложить обмен</button>`:''}`);\n  $('#sheet').onclick=async e=>{\n    if(e.target.id==='sheet')return closeSheet();\n    if(e.target.closest('#cEq')){const r=await act('equip',{card:m.back===id?'':id});if(r.ok){hap();sfx('ok');closeSheet();toast(m.back===id?'Рубашка снята':'Рубашка надета ✅',true)}}\n    else if(e.target.closest('#cSell')){const r=await act('sell',{card:id});if(r.ok){hapN('success');sfx('coin');closeSheet();toast('Продано: +'+r.coins+' монет',true)}}\n    else if(e.target.closest('#cTrade')){closeSheet();openPage('trade')}\n  };\n}\n/* ---------- открытие набора ---------- */\nasync function openPackFlow(){\n  const m=S.snap.me,price=S.snap.cfg.packPrice;\n  if(!m.freePacks&&m.coins<price){toast('Не хватает монет: набор стоит '+price);hapN('error');sfx('err');return}\n  const r=await act('openpack');if(!r.ok)return;\n  hap('heavy');sfx('pack');showPack(r.pack);\n}\nfunction showPack(pack){\n  const p=$('#pack'),cfg=S.snap.cfg;\n  p.innerHTML=`<div class=\"ptitle\" id=\"ptt\">Открываем…</div><div class=\"stage\" id=\"pst\">${pack.map((c,i)=>`<div class=\"pk shake\" data-i=\"${i}\" style=\"animation-delay:${i*.08}s\"><div class=\"bk\">♠</div><div class=\"f\">${cardArt(c.id,96)}${c.isNew?'<span class=\"new\">НОВАЯ</span>':''}</div></div>`).join('')}</div><div class=\"pbtns\" id=\"pbt\"></div>`;\n  p.classList.add('show');\n  const cols=['#8d8d9a','#3b82f6','#a855f7','#ffb703'];\n  (async()=>{\n    await sleep(900);\n    const els=[...p.querySelectorAll('.pk')];\n    for(let i=0;i<els.length;i++){\n      const el=els[i],c=S.CB[pack[i].id];\n      el.classList.remove('shake');el.classList.add('flip');sfx('flip');\n      const r=el.getBoundingClientRect(),pr=p.getBoundingClientRect();\n      const b=document.createElement('div');b.className='burst';\n      b.style.cssText=`left:${r.left-pr.left+r.width/2-130}px;top:${r.top-pr.top+r.height/2-130}px;background:radial-gradient(circle,${cols[c.r]} 0,transparent 68%)`;\n      p.appendChild(b);requestAnimationFrame(()=>b.classList.add('show'));setTimeout(()=>b.remove(),1000);\n      hap(c.r>=2?'heavy':'medium');if(c.r>=3){hapN('success');sfx('win')}\n      await sleep(c.r>=2?1100:650);\n    }\n    $('#ptt').textContent='Ваши карточки';\n    const m=S.snap.me,again=m.freePacks||m.coins>=cfg.packPrice;\n    $('#pbt').innerHTML=`<button class=\"btn big\" id=\"pkOk\">Забрать</button>${again?`<button class=\"btn primary big\" id=\"pkAgain\">${m.freePacks?'Ещё бесплатно':'Ещё · '+cfg.packPrice}</button>`:''}`;\n  })();\n}\n$('#pack').onclick=e=>{\n  if(e.target.closest('#pkOk')){$('#pack').classList.remove('show');$('#pack').innerHTML=''}\n  else if(e.target.closest('#pkAgain')){$('#pack').classList.remove('show');$('#pack').innerHTML='';openPackFlow()}\n};\n/* ---------- настройки ---------- */\nfunction tabSet(body){\n  const s=S.snap,m=s.me;\n  if(S.built==='set')return;\n  S.built='set';initE();\n  const g=m.wins+m.losses,wr=g?Math.round(m.wins/g*100):0,r=m.rank;\n  body.innerHTML=`<div class=\"panel phero\">${av(m,96)}<div class=\"hn\">${esc(m.name)}</div><div class=\"hu\">@${esc(m.username)}</div>${rk(r)}\n    <div class=\"stats\"><div><b>${m.wins}</b><span>Побед</span></div><div><b>${m.losses}</b><span>Поражений</span></div><div><b>${wr}%</b><span>Винрейт</span></div></div></div>\n  <div class=\"panel\">\n    <div class=\"setrow\"><div class=\"tx\">🔊 Звуки</div><button class=\"tog ${PREF.snd?'on':''}\" data-tog=\"snd\"></button></div>\n    <div class=\"setrow\"><div class=\"tx\">📳 Вибрация</div><button class=\"tog ${PREF.vib?'on':''}\" data-tog=\"vib\"></button></div>\n  </div>\n  <div class=\"panel\" style=\"display:flex;align-items:center;gap:14px\"><div class=\"card back ${m.back&&S.CB[m.back]?'bk r'+S.CB[m.back].r:''}\" ${m.back&&S.CB[m.back]?`style=\"--h:${S.CB[m.back].h};--cw:54px\"`:'style=\"--cw:54px\"'}><i>${m.back&&S.CB[m.back]?S.CB[m.back].e:'♠'}</i></div><div style=\"flex:1\"><div style=\"font-weight:900;font-size:17px\">Моя рубашка</div><div style=\"color:var(--mut);font-size:12px;margin:2px 0 8px\">${m.back&&S.CB[m.back]?esc(S.CB[m.back].n):'Классика'}</div><button class=\"btn sm\" id=\"bToBag\">Выбрать в рюкзаке</button></div></div>\n  ${s.cfg.bot?`<button class=\"btn big\" id=\"bInvite\">📨 Пригласить друга</button>`:''}\n  <div class=\"sec\">Профиль</div><div class=\"panel\" id=\"edbox\">${editorHTML(false)}</div>\n  <div class=\"sec\">Звания</div><div class=\"ranks\">${s.cfg.ranks.map((x,i)=>`<div class=\"trow ${i===m.rank.idx?'cur':''}\"><span style=\"font-size:22px\">${x.icon}</span><div class=\"mid\"><b>${x.name}</b></div><span style=\"color:var(--mut);font-size:13px\">от ${x.min} ⭐</span></div>`).join('')}</div>\n  <div class=\"empty\" style=\"font-size:12px\">За победу +25 ⭐, за поражение −15 ⭐</div>`;\n  bindEditor($('#edbox'),false);\n}\n/* ================= подстраницы ================= */\nconst PG={};\nfunction openPage(k,arg){\n  S.page=k;S.pageArg=arg;\n  const p=$('#s-page');\n  p.innerHTML=`<div class=\"phead\"><button class=\"iconbtn\" id=\"pgBack\">←</button><b id=\"pgTitle\"></b></div><div class=\"pbody\" id=\"pgBody\"></div>`;\n  p.classList.add('active');\n  PG[k].open(arg);if(PG[k].update)PG[k].update();\n  if(k==='top')loadLB();\n}\nfunction closePage(){S.page=null;const p=$('#s-page');p.classList.remove('active');p.innerHTML=''}\nfunction updatePage(){const P=S.page&&PG[S.page];if(P&&P.update)P.update()}\n$('#s-page').onclick=e=>{\n  if(e.target.closest('#pgBack')){hap();closePage();return}\n  const P=PG[S.page];\n  const pf=e.target.closest('[data-prof]'),bt=e.target.closest('button');\n  if(pf&&!(bt&&pf.contains(bt))){hap();openProfile(pf.dataset.prof);return}\n  if(P&&P.click)P.click(e);\n};\n$('#s-page').oninput=e=>{const P=PG[S.page];if(P&&P.input)P.input(e)};\nconst setPg=(title,html)=>{$('#pgTitle').textContent=title;$('#pgBody').innerHTML=html};\n/* поиск игроков по нику (общий) */\nlet findT=0;\nfunction findUsers(v,cb){\n  clearTimeout(findT);\n  if(v.length<2){cb([]);return}\n  findT=setTimeout(async()=>{try{const j=await api('/api/find?q='+encodeURIComponent(v));cb(j&&j.list||[],v)}catch(_){}},250);\n}\nconst cleanQ=v=>v.replace(/[^A-Za-z0-9_@]/g,'').replace(/^@/,'');\nconst isFriend=un=>(S.snap.friends||[]).some(f=>f.username.toLowerCase()===String(un).toLowerCase());\nconst nickBox=(id,val)=>`<div class=\"uwrap\"><span class=\"at\">@</span><input class=\"inp\" id=\"${id}\" type=\"text\" maxlength=\"20\" placeholder=\"ник игрока\" autocomplete=\"off\" autocapitalize=\"off\" autocorrect=\"off\" spellcheck=\"false\" value=\"${esc(val||'')}\"></div>`;\nconst userRow=(u,right,attr)=>`<div class=\"trow\" ${attr||''} style=\"cursor:pointer\">${av(u,40)}<div class=\"mid\"><div class=\"nm\">${esc(u.name)}</div>${uname(u)} ${u.rank?rk(u.rank):''}</div>${right||''}</div>`;\n\n/* ---- друзья ---- */\nS.F={q:'',found:[]};\nPG.friends={\n  open(){\n    setPg('Друзья',`<div class=\"panel\"><label class=\"lbl\" style=\"margin-top:0\">Добавить друга по @нику</label>${nickBox('fq',S.F.q)}<div id=\"fres\" style=\"margin-top:8px\"></div></div>\n    ${S.snap.cfg.bot?'<button class=\"btn big\" id=\"fInvite\" style=\"margin-bottom:6px\">📨 Позвать друга в игру</button>':''}\n    <div class=\"sec\">Мои друзья <span id=\"fcnt\"></span></div><div id=\"flist\"></div>`);\n  },\n  update(){\n    const fr=[...(S.snap.friends||[])].sort((a,b)=>(b.online-a.online)||a.username.localeCompare(b.username));\n    const fl=$('#flist');if(!fl)return;\n    $('#fcnt').textContent=fr.length?'· '+fr.length:'';\n    fl.innerHTML=fr.length?fr.map(f=>`<div class=\"trow\" data-prof=\"${esc(f.username)}\" style=\"cursor:pointer\">${av(f,42)}<div class=\"mid\"><div class=\"nm\"><i class=\"dot ${f.online?'on':''}\"></i>${esc(f.name)}</div>${uname(f)} <span class=\"un\">${f.online?'в сети':'не в сети'}</span></div><span style=\"color:var(--mut);font-size:20px\">›</span></div>`).join(''):'<div class=\"empty\">Друзей пока нет.<br>Найдите игрока по нику выше.</div>';\n    const res=S.F.found.filter(u=>u.username);\n    $('#fres').innerHTML=res.length?res.map(u=>userRow(u,isFriend(u.username)?'<span class=\"un\">в друзьях</span>':`<button class=\"btn sm\" data-addf=\"${esc(u.username)}\">Добавить</button>`,`data-prof=\"${esc(u.username)}\"`)).join(''):(S.F.q.length>=2?'<div class=\"note\">Игрок с таким ником не найден</div>':'');\n  },\n  input(e){\n    if(e.target.id!=='fq')return;\n    const v=cleanQ(e.target.value);e.target.value=v;S.F.q=v;\n    findUsers(v,(l,q)=>{if(q===undefined||S.F.q===q){S.F.found=l;if(S.page==='friends')PG.friends.update()}});\n  },\n  async click(e){\n    const a=e.target.closest('[data-addf]');\n    if(a){e.stopPropagation();const r=await act('friend_add',{username:a.dataset.addf});if(r.ok){hapN('success');sfx('ok');toast('Добавлен в друзья ✅',true);S.F.q='';S.F.found=[];const q=$('#fq');if(q)q.value='';PG.friends.update()}return}\n    if(e.target.closest('#fInvite'))inviteFriend();\n  }\n};\n/* ---- статистика ---- */\nPG.stats={\n  open(){\n    const s=S.snap,m=s.me,g=m.wins+m.losses,wr=g?Math.round(m.wins/g*100):0,r=m.rank;\n    const pct=r.to?Math.min(100,Math.round((m.rating-r.from)/(r.to-r.from)*100)):100;\n    setPg('Статистика',`<div class=\"panel phero\" style=\"padding-bottom:18px\">${av(m,80)}<div class=\"hn\">${esc(m.name)}</div><div class=\"hu\">@${esc(m.username)}</div>${rk(r)}\n      <div class=\"xprow\" style=\"width:100%;max-width:300px;margin-top:10px\"><div class=\"xp\"><i style=\"width:${pct}%\"></i></div><span>⭐ ${m.rating}${r.to?' / '+r.to:''}</span></div></div>\n    <div class=\"statrow\" style=\"grid-template-columns:1fr 1fr\"><div><b>${m.wins}</b><span>Побед</span></div><div><b>${m.losses}</b><span>Поражений</span></div><div><b>${wr}%</b><span>Винрейт</span></div><div><b>${g}</b><span>Партий</span></div><div><b>${fmt(m.coins)}</b><span>Монет</span></div><div><b>${ownedCount(m.inv)}/${s.cfg.cards.length}</b><span>Карточек</span></div></div>\n    <div class=\"sec\">Звания</div><div class=\"ranks\">${s.cfg.ranks.map((x,i)=>`<div class=\"trow ${i===r.idx?'cur':''}\"><span style=\"font-size:22px\">${x.icon}</span><div class=\"mid\"><b>${x.name}</b></div><span style=\"color:var(--mut);font-size:13px\">от ${x.min} ⭐</span></div>`).join('')}</div>\n    <div class=\"empty\" style=\"font-size:12px\">За победу +25 ⭐, за поражение −15 ⭐</div>`);\n  },\n  update(){this.open()}\n};\n/* ---- топ 50 ---- */\nasync function loadLB(){\n  try{const j=await api('/api/leaderboard');if(j){S.lb=j.top;if(S.page==='top')PG.top.update()}}catch(e){}\n}\nPG.top={\n  open(){setPg('Топ 50',`<div class=\"lb\" id=\"lbl\"></div>`)},\n  update(){\n    const l=$('#lbl');if(!l)return;\n    l.innerHTML=S.lb?S.lb.map((u,i)=>`<div class=\"trow ${u.me?'mine':''}\" data-prof=\"${esc(u.username)}\" style=\"cursor:pointer\"><div class=\"pl\">${i<3?['🥇','🥈','🥉'][i]:i+1}</div>${av(u,40)}<div class=\"mid\"><div class=\"nm\">${esc(u.name)}</div>${uname(u)} ${rk(u.rank)}</div><div style=\"text-align:right\"><b style=\"font-weight:900;font-size:18px\">⭐ ${u.rating}</b><div style=\"font-size:11px;color:var(--mut)\">${u.wins} поб.</div></div></div>`).join('')||'<div class=\"empty\">Пока никого нет</div>':'<div class=\"empty\">Загрузка…</div>';\n  }\n};\nsetInterval(()=>{if(S.page==='top')loadLB()},20000);\n/* ---- магазин ---- */\nPG.shop={open(){setPg('Магазин',`<div class=\"shopart\"><i class=\"coin\"></i><h2>Скоро!</h2><div>Магазин пока пуст.<br>Здесь появятся наборы, рамки и стикеры.</div></div>`)}};\n/* ---- открытые столы ---- */\nPG.open={\n  open(){setPg('Открытые столы','<div id=\"otl\"></div>')},\n  update(){\n    const s=S.snap,m=s.me,others=s.tables.filter(t=>!t.mine),l=$('#otl');if(!l)return;\n    l.innerHTML=others.length?others.map(t=>`<div class=\"trow\" data-prof=\"${esc(t.owner.username)}\">${av(t.owner,42)}<div class=\"mid\"><div class=\"nm\">${esc(t.owner.name)}</div>${uname(t.owner)} ${rk(t.owner.rank)}</div><div class=\"stakeTag\">${coin}${t.stake}</div><button class=\"btn green sm\" data-join=\"${t.id}\" ${m.coins<t.stake||s.myTable?'disabled':''}>Играть</button></div>`).join(''):'<div class=\"empty\">Свободных столов нет.<br>Создайте свой или потренируйтесь с ботом.</div>';\n  },\n  click(e){\n    const j=e.target.closest('[data-join]');\n    if(j&&!j.disabled){e.stopPropagation();hap('medium');act('join',{table:j.dataset.join})}\n  }\n};\n/* ---- обмен ---- */\nfunction sideMini(sd){\n  const parts=sd.cards.map(id=>cardArt(id,34)).join('');\n  const coins=sd.coins?`<span class=\"cc\">${coin}${fmt(sd.coins)}</span>`:'';\n  return `<div class=\"mini\">${parts}${coins}${!parts&&!coins?'<span style=\"color:var(--mut);font-size:13px\">ничего</span>':''}</div>`;\n}\nconst recvOf=o=>o.dir==='in'?o.give:o.want, giveOf=o=>o.dir==='in'?o.want:o.give;\nfunction offerRow(o){\n  return `<div class=\"orow ${o.dir}\" data-offer=\"${o.id}\">${av(o.user,42)}<div class=\"mid\"><div class=\"nm\">@${esc(o.user.username)}</div><div class=\"sub\">${o.dir==='in'?'предлагает обмен':'ждёт ответа'} · ${hms(o.left)}</div>\n  <div style=\"display:flex;align-items:center;gap:8px;flex-wrap:wrap\">${sideMini(recvOf(o))}<span class=\"sw\">⇄</span>${sideMini(giveOf(o))}</div></div><span style=\"color:var(--mut);font-size:20px\">›</span></div>`;\n}\nPG.trade={\n  open(){\n    setPg('Обмен',`<div class=\"panel\"><label class=\"lbl\" style=\"margin-top:0\">Игрок (поиск по @нику)</label>${nickBox('tq',S.T.q)}\n    <div id=\"tres\" style=\"margin-top:8px\"></div><div id=\"tfr\"></div>\n    <div class=\"note\">Обмен идёт только по уникальному нику. Ваша часть замораживается, пока игрок не ответит. Не ответит за 48 часов — всё вернётся к вам. Можно обменять карточки на карточки, на монеты или просто подарить.</div></div>\n    <div class=\"sec\">Предложения</div><div id=\"toffers\"></div>`);\n  },\n  update(){\n    if(!$('#tres'))return;\n    const s=S.snap,fr=s.friends||[];\n    $('#tres').innerHTML=S.T.found.length?S.T.found.map((u,i)=>userRow(u,'<span style=\"font-weight:800\">Обмен ›</span>',`data-pick=\"${i}\"`)).join(''):(S.T.q.length>=2?'<div class=\"note\">Игрок с таким ником не найден</div>':'');\n    $('#tfr').innerHTML=fr.length&&!S.T.q?`<div class=\"lbl\">Друзья</div><div class=\"chips\">${fr.map(f=>`<button class=\"chip\" data-fr=\"${esc(f.username)}\"><i class=\"dot ${f.online?'on':''}\"></i>@${esc(f.username)}</button>`).join('')}</div>`:'';\n    const of=[...(s.offers||[])].sort((a,b)=>(a.dir==='in'?0:1)-(b.dir==='in'?0:1));\n    $('#toffers').innerHTML=of.length?of.map(offerRow).join(''):'<div class=\"empty\">Пока нет предложений</div>';\n  },\n  input(e){\n    if(e.target.id!=='tq')return;\n    const v=cleanQ(e.target.value);e.target.value=v;S.T.q=v;\n    findUsers(v,(l,q)=>{if(q===undefined||S.T.q===q){S.T.found=l;if(S.page==='trade')PG.trade.update()}});\n  },\n  click(e){\n    const pk=e.target.closest('[data-pick]');\n    if(pk){const u=S.T.found[+pk.dataset.pick];if(u){hap();S.T.found=[];S.T.q='';openBuilder(u)}return}\n    const fr=e.target.closest('[data-fr]');if(fr){hap();openBuilder({username:fr.dataset.fr});return}\n    const of=e.target.closest('[data-offer]');\n    if(of){const o=(S.snap.offers||[]).find(x=>x.id===of.dataset.offer);if(o){hap();openOffer(o)}}\n  }\n};\n/* ---- передать монеты ---- */\nS.SC={to:null,amt:0,q:'',found:[]};\nPG.send={\n  open(arg){\n    if(arg&&arg.username)S.SC={to:arg,amt:0,q:'',found:[]};\n    setPg('Передать монеты',`<div class=\"panel\" id=\"sRec\"></div>\n    <div class=\"panel\"><label class=\"lbl\" style=\"margin-top:0\">Сумма</label>\n    <div class=\"tcoins\" style=\"padding:0\"><span class=\"cv\"><i class=\"coin\"></i></span><input class=\"inp\" id=\"samt\" inputmode=\"numeric\" pattern=\"[0-9]*\" placeholder=\"от ${S.snap.cfg.minSend}\" autocomplete=\"off\" value=\"${S.SC.amt||''}\"></div>\n    <div class=\"chips\">${[50,100,500,1000].map(x=>`<button class=\"chip\" data-amt=\"${x}\">${x}</button>`).join('')}<button class=\"chip\" data-amt=\"all\">Все</button></div>\n    <div class=\"note\" id=\"sbal\"></div></div>\n    <button class=\"btn primary big\" id=\"sGo\">Передать</button>\n    <div class=\"note\" style=\"text-align:center;margin-top:10px\">Игрок подтвердит перевод ✓. Если не ответит за 48 часов, монеты вернутся к вам.</div>`);\n  },\n  update(){\n    const rec=$('#sRec');if(!rec)return;\n    const T=S.SC,fr=S.snap.friends||[];\n    $('#sbal').textContent='У вас '+fmt(S.snap.me.coins)+' монет';\n    if(T.to){rec.innerHTML=`<label class=\"lbl\" style=\"margin-top:0\">Кому</label><div class=\"picked\">${av(T.to,40)}<div class=\"mid\"><div style=\"font-weight:800\">${esc(T.to.name||'')}</div><div class=\"un\">@${esc(T.to.username)}</div></div><button class=\"btn sm\" id=\"sChange\">Изменить</button></div>`;return}\n    const foc=document.activeElement&&document.activeElement.id==='sq';\n    if(!foc||!$('#sq'))rec.innerHTML=`<label class=\"lbl\" style=\"margin-top:0\">Кому (поиск по @нику)</label>${nickBox('sq',T.q)}<div id=\"sres\" style=\"margin-top:8px\"></div><div id=\"sfr\"></div>`;\n    $('#sres').innerHTML=T.found.length?T.found.map((u,i)=>userRow(u,'',`data-spick=\"${i}\"`)).join(''):(T.q.length>=2?'<div class=\"note\">Игрок с таким ником не найден</div>':'');\n    $('#sfr').innerHTML=fr.length&&!T.q?`<div class=\"lbl\">Друзья</div><div class=\"chips\">${fr.map((f,i)=>`<button class=\"chip\" data-sfr=\"${i}\"><i class=\"dot ${f.online?'on':''}\"></i>@${esc(f.username)}</button>`).join('')}</div>`:'';\n  },\n  input(e){\n    if(e.target.id==='samt'){const v=e.target.value.replace(/\\D/g,'').slice(0,9);e.target.value=v;S.SC.amt=parseInt(v,10)||0;return}\n    if(e.target.id==='sq'){\n      const v=cleanQ(e.target.value);e.target.value=v;S.SC.q=v;\n      findUsers(v,(l,q)=>{if(q===undefined||S.SC.q===q){S.SC.found=l;if(S.page==='send')PG.send.update()}});\n    }\n  },\n  async click(e){\n    const T=S.SC,m=S.snap.me;\n    const a=e.target.closest('[data-amt]');\n    if(a){hap();const v=a.dataset.amt==='all'?m.coins:+a.dataset.amt;T.amt=Math.min(v,m.coins);$('#samt').value=T.amt||'';return}\n    const sp=e.target.closest('[data-spick]');if(sp){const u=T.found[+sp.dataset.spick];if(u){hap();T.to=u;T.q='';T.found=[];PG.send.update()}return}\n    const sf=e.target.closest('[data-sfr]');if(sf){const u=S.snap.friends[+sf.dataset.sfr];if(u){hap();T.to=u;PG.send.update()}return}\n    if(e.target.closest('#sChange')){T.to=null;PG.send.update();return}\n    if(e.target.closest('#sGo')){\n      const cfg=S.snap.cfg;\n      if(!T.to)return toast('Выберите, кому передать монеты');\n      if(!(T.amt>=cfg.minSend))return toast('Минимум '+cfg.minSend+' монет');\n      if(T.amt>m.coins)return toast('Не хватает монет');\n      const r=await act('trade',{to:T.to.username,give:{cards:[],coins:T.amt},want:{cards:[],coins:0}});\n      if(r.ok){hapN('success');sfx('coin');toast('Отправлено @'+T.to.username+': '+fmt(T.amt)+' монет. Ждём подтверждения',true);const to=T.to;S.SC={to:null,amt:0,q:'',found:[]};closePage();}\n    }\n  }\n};\n/* ---------- чужой профиль ---------- */\nasync function openProfile(username){\n  if(!username)return;\n  const j=await api('/api/user?q='+encodeURIComponent(username));\n  const u=j&&j.user;if(!u){toast('Игрок не найден');return}\n  const me=S.snap.me,isMe=u.id===me.id,ids=Object.keys(u.inv).sort((a,b)=>(S.CB[b].r-S.CB[a].r)||a.localeCompare(b));\n  const fr=isFriend(u.username);\n  sheet(`<div style=\"display:flex;gap:14px;align-items:center;margin-bottom:12px\">${av(u,64)}<div style=\"flex:1;min-width:0\"><div style=\"font-weight:900;font-size:22px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis\">${esc(u.name)}</div><div class=\"un\" style=\"font-size:14px\">@${esc(u.username)}</div><div style=\"margin-top:4px\">${rk(u.rank)} <span style=\"font-size:12px;color:var(--mut);font-weight:700\">⭐ ${u.rating}</span></div></div></div>\n  <div class=\"statrow\" style=\"grid-template-columns:repeat(3,1fr)\"><div><b>${u.wins}</b><span>Побед</span></div><div><b>${u.losses}</b><span>Поражений</span></div><div><b>${ids.length}</b><span>Карточек</span></div></div>\n  <div class=\"lbl\" style=\"margin-top:4px\">Коллекция</div>\n  ${ids.length?`<div class=\"pgrid\">${ids.map(id=>`<div class=\"cell\">${cardArt(id,64,{n:u.inv[id]})}</div>`).join('')}</div>`:'<div class=\"empty\" style=\"padding:8px\">Пока пусто</div>'}\n  ${isMe?'':`<div style=\"display:grid;grid-template-columns:1fr 1fr;gap:8px\"><button class=\"btn primary\" id=\"pfTrade\">🔁 Обмен</button><button class=\"btn\" id=\"pfSend\">Передать монеты</button></div><div style=\"height:8px\"></div><button class=\"btn big ${fr?'':'green'}\" id=\"pfFr\">${fr?'Убрать из друзей':'➕ Добавить в друзья'}</button>`}`);\n  $('#sheet').onclick=async e=>{\n    if(e.target.id==='sheet')return closeSheet();\n    if(e.target.closest('#pfTrade')){closeSheet();openBuilder(u)}\n    else if(e.target.closest('#pfSend')){closeSheet();S.SC={to:u,amt:0,q:'',found:[]};openPage('send',u)}\n    else if(e.target.closest('#pfFr')){\n      const r=await act(fr?'friend_del':'friend_add',{username:u.username});\n      if(r.ok){hapN('success');closeSheet();toast(fr?'Убран из друзей':'Добавлен в друзья ✅',true)}\n    }\n  };\n}\n/* ---------- события вкладок ---------- */\nfunction shareCode(code){\n  const bot=S.snap.cfg.bot;if(!bot)return;\n  const text='Го сыграем в Дурака! Открой игру, нажми «Играть» → «Приватные» и введи код: '+code;\n  const url='https://t.me/share/url?url='+encodeURIComponent('https://t.me/'+bot)+'&text='+encodeURIComponent(text);\n  if(tg&&tg.openTelegramLink)tg.openTelegramLink(url);else window.open(url,'_blank');\n}\n$('#body').onclick=async e=>{\n  const t=e.target;\n  const go=t.closest('[data-go]');if(go){hap();openPage(go.dataset.go);return}\n  const pl=t.closest('[data-play]');\n  if(pl){if(!pl.disabled){hap();if(pl.dataset.play==='open')openPage('open');else stakeSheet(pl.dataset.play)}return}\n  if(t.closest('#bPractice')){hap('medium');act('practice');return}\n  if(t.closest('#bCancel')){act('cancel');return}\n  if(t.closest('#bShareCode')){const tb=S.snap.tables.find(x=>x.id===S.snap.myTable);if(tb)shareCode(tb.code);return}\n  if(t.closest('#bInvite')){inviteFriend();return}\n  if(t.closest('#bDaily')){const r=await act('daily');if(r.ok){hapN('success');sfx('coin');toast('+'+S.snap.me.dailyAmount+' монет 🎁',true)}return}\n  if(t.closest('#bPack')){openPackFlow();return}\n  if(t.closest('#bToBag')){hap();setTab('bag');return}\n  const bt=t.closest('[data-btab]');if(bt){S.bagTab=bt.dataset.btab;hap();renderHome();return}\n  const fl=t.closest('[data-flt]');if(fl){S.flt=+fl.dataset.flt;hap();renderHome();return}\n  const cd=t.closest('[data-card]');if(cd){hap();openCardSheet(cd.dataset.card);return}\n  const tg2=t.closest('[data-tog]');if(tg2){const k=tg2.dataset.tog;setPref(k,!PREF[k]);tg2.classList.toggle('on',PREF[k]);if(k==='snd'&&PREF.snd)sfx('ok');return}\n  const pf=t.closest('[data-prof]');if(pf){hap();openProfile(pf.dataset.prof);return}\n};\n$('#nav').onclick=e=>{const b=e.target.closest('button');if(b){hap();closePage();setTab(b.dataset.tab)}};\n\n/* ================= обмен: экран ================= */\nfunction callout(t,host){\n  const f=host||$('#gFelt');if(!f)return;\n  const c=document.createElement('div');c.className='callout';c.textContent=t;f.appendChild(c);setTimeout(()=>c.remove(),1150);\n}\nfunction showTrade(){const s=$('#s-trade');s.classList.add('active');renderTrade();s.scrollTop=0}\nfunction closeTrade(){S.TB=null;const s=$('#s-trade');s.classList.remove('active');s.innerHTML=''}\nasync function openBuilder(u){\n  let inv=u.inv;\n  if(!inv){\n    const j=await api('/api/user?q='+encodeURIComponent(u.username));\n    if(!j||!j.user){toast('Игрок не найден');return}\n    u=j.user;inv=u.inv||{};\n  }\n  S.TB={mode:'new',to:u,theirInv:inv,top:{cards:[],coins:0},bot:{cards:[],coins:0},offer:null,busy:false};\n  closeSheet();showTrade();\n}\nfunction openOffer(o){\n  const inc=o.dir==='in';\n  S.TB={mode:o.dir,to:o.user,theirInv:{},top:inc?o.give:o.want,bot:inc?o.want:o.give,offer:o,busy:false};\n  showTrade();\n}\nfunction tbox(cls,title,key,side,edit){\n  const cfg=S.snap.cfg;\n  const slots=[0,1,2,3].map(i=>{\n    const id=side.cards[i];\n    if(id)return `<div class=\"slot\">${cardArt(id,64,{cls:'fresh'})}${edit?`<button class=\"rm\" data-rm=\"${key}\" data-id=\"${id}\">✕</button>`:''}</div>`;\n    return `<div class=\"slot ${edit?'add':''}\" ${edit?`data-add=\"${key}\"`:''}>${edit?'<span class=\"plus\">+</span>':''}</div>`;\n  }).join('');\n  const coins=edit\n    ?`<div class=\"tcoins\"><span class=\"cv\">${coin}</span><input class=\"inp\" inputmode=\"numeric\" pattern=\"[0-9]*\" data-coins=\"${key}\" placeholder=\"Монеты (от ${cfg.minSend})\" value=\"${side.coins||''}\" autocomplete=\"off\"></div>`\n    :(side.coins?`<div class=\"tcoins\"><span class=\"cv\">${coin} ${fmt(side.coins)}</span></div>`:'<div style=\"height:10px\"></div>');\n  return `<div class=\"tbox ${cls}\"><div class=\"tl\"><b>${title}</b><span>${side.cards.length}/${cfg.maxSlots}</span></div><div class=\"tgrid\">${slots}</div>${coins}</div>`;\n}\nfunction renderTrade(){\n  const T=S.TB;if(!T)return;\n  const u=T.to,edit=T.mode==='new';\n  const sub=T.mode==='in'?'предлагает вам обмен':T.mode==='out'?'ждёт ответа · '+hms(T.offer.left):'Новый обмен';\n  const note={\n    new:`Выберите карточки <b>@${esc(u.username)}</b>, которые хотите получить, и свои. Верх пустой — это подарок. Ваша часть замораживается, пока игрок не ответит (48 ч), потом вернётся.`,\n    in:'Нажмите ✓, чтобы принять. Обмен произойдёт сразу. ✕ — отказаться: вещи вернутся отправителю.',\n    out:'Ваша часть заморожена до ответа. Если игрок не ответит за 48 часов, всё вернётся к вам.'\n  }[T.mode];\n  $('#s-trade').innerHTML=`<div class=\"thead\"><button class=\"iconbtn\" id=\"tBack\">←</button>${av(u,40)}<div class=\"t\"><b>@${esc(u.username)}</b><span class=\"un\">${sub}</span></div></div>\n  ${tbox('t','Вы получаете','top',T.top,edit)}\n  <div class=\"tmid\">${T.mode==='in'?'<button class=\"bigact x\" id=\"tNo\">✕</button>':''}<div class=\"swapic\" id=\"tSwap\">⇅</div>${T.mode==='in'?'<button class=\"bigact v\" id=\"tYes\">✓</button>':''}</div>\n  ${tbox('b','Вы отдаёте','bot',T.bot,edit)}\n  <div class=\"note\" style=\"margin:12px 18px 0\">${note}</div>\n  <div class=\"tfoot\">${edit?'<button class=\"btn primary big\" id=\"tSend\">Отправить предложение</button>':T.mode==='out'?'<button class=\"btn big\" id=\"tWithdraw\">Отозвать предложение</button>':''}</div>`;\n}\nasync function swapAnim(){\n  const root=$('#s-trade'),t=root.querySelector('.tbox.t'),b=root.querySelector('.tbox.b');\n  if(!t||!b||!t.animate)return;\n  const d=b.getBoundingClientRect().top-t.getBoundingClientRect().top;\n  const sw=root.querySelector('.swapic');sw&&sw.classList.add('spun');\n  const o={duration:560,easing:'cubic-bezier(.6,0,.3,1)',fill:'forwards'};\n  t.animate([{transform:'none'},{transform:`translateY(${d}px) scale(.96)`}],o);\n  b.animate([{transform:'none'},{transform:`translateY(${-d}px) scale(.96)`}],o);\n  hap('heavy');await sleep(620);\n  callout('Обмен ✅',root);await sleep(900);\n}\nasync function tradeSend(){\n  const T=S.TB;if(!T)return;\n  if(!T.bot.cards.length&&!T.bot.coins)return toast('Добавьте, что вы отдаёте: карточки или монеты');\n  if(T.bot.coins>S.snap.me.coins)return toast('Не хватает монет');\n  const r=await act('trade',{to:T.to.username,give:T.bot,want:T.top});\n  if(!r.ok)return;\n  hapN('success');T.busy=true;await swapAnim();\n  toast('Предложение отправлено ✅ Ждём @'+T.to.username,true);closeTrade();openPage('trade');\n}\nasync function tradeAnswer(how){\n  const T=S.TB;if(!T||!T.offer)return;\n  const id=T.offer.id;\n  if(how==='accept'){\n    const r=await act('accept',{offer:id});if(!r.ok)return;\n    hapN('success');T.busy=true;await swapAnim();toast('Обмен состоялся 🔁',true);closeTrade();return;\n  }\n  const r=await act(how,{offer:id});if(!r.ok)return;\n  hapN('success');closeTrade();\n  toast(how==='decline'?'Отклонено, вещи вернулись отправителю':'Отозвано, всё вернулось к вам',true);\n}\nfunction openPicker(key){\n  const T=S.TB;if(!T)return;\n  const cfg=S.snap.cfg,max=cfg.maxSlots,inv=key==='bot'?S.snap.me.inv:T.theirInv;\n  const ids=Object.keys(inv).filter(id=>S.CB[id]).sort((a,b)=>(S.CB[b].r-S.CB[a].r)||a.localeCompare(b));\n  const sel=new Set(T[key].cards.filter(id=>inv[id]>0));\n  const title=key==='bot'?'Ваши карточки':'Карточки @'+esc(T.to.username);\n  const empty=key==='bot'?'У вас пока нет карточек. Откройте набор во вкладке «Рюкзак».':'У @'+esc(T.to.username)+' пока нет карточек. Можно обменять на монеты.';\n  sheet(`<h3>${title}</h3><div class=\"note\" style=\"margin:-6px 0 12px\">Выбрано <b id=\"pkc\">${sel.size}</b> из ${max}</div>\n  ${ids.length?`<div class=\"pgrid\">${ids.map(id=>`<div class=\"cell ${sel.has(id)?'sel':''}\" data-pk=\"${id}\">${cardArt(id,70,{n:inv[id]})}</div>`).join('')}</div>`:`<div class=\"empty\">${empty}</div>`}\n  <button class=\"btn primary big\" id=\"pkDone\">Готово</button>`);\n  $('#sheet').onclick=e=>{\n    if(e.target.id==='sheet')return closeSheet();\n    const c=e.target.closest('[data-pk]');\n    if(c){\n      const id=c.dataset.pk;\n      if(sel.has(id)){sel.delete(id);c.classList.remove('sel')}\n      else if(sel.size>=max){toast('Максимум '+max+' карточки');hapN('error');return}\n      else{sel.add(id);c.classList.add('sel')}\n      hap();$('#pkc').textContent=sel.size;return;\n    }\n    if(e.target.closest('#pkDone')){T[key].cards=[...sel];closeSheet();renderTrade()}\n  };\n}\n$('#s-trade').onclick=e=>{\n  const T=S.TB;if(!T||T.busy)return;\n  if(e.target.closest('#tBack')){closeTrade();return}\n  const add=e.target.closest('[data-add]');if(add){hap();openPicker(add.dataset.add);return}\n  const rm=e.target.closest('[data-rm]');\n  if(rm){const s=T[rm.dataset.rm];s.cards=s.cards.filter(x=>x!==rm.dataset.id);hap();renderTrade();return}\n  if(e.target.closest('#tSwap')){const s=e.target.closest('#tSwap');s.classList.toggle('spun');hap();return}\n  if(e.target.closest('#tSend'))return tradeSend();\n  if(e.target.closest('#tYes'))return tradeAnswer('accept');\n  if(e.target.closest('#tNo'))return tradeAnswer('decline');\n  if(e.target.closest('#tWithdraw'))return tradeAnswer('withdraw');\n};\n$('#s-trade').oninput=e=>{\n  const k=e.target.dataset&&e.target.dataset.coins;if(!k||!S.TB)return;\n  const v=e.target.value.replace(/\\D/g,'').slice(0,9);e.target.value=v;S.TB[k].coins=parseInt(v,10)||0;\n};\n\n/* ================= приглашение ================= */\nfunction inviteFriend(){\n  const bot=S.snap.cfg.bot;if(!bot)return;\n  const link='https://t.me/'+bot,text='Го сыграем в Дурака на монеты! 🃏';\n  const url='https://t.me/share/url?url='+encodeURIComponent(link)+'&text='+encodeURIComponent(text);\n  if(tg&&tg.openTelegramLink)tg.openTelegramLink(url);else window.open(url,'_blank');\n}\n\n/* ================= игровой стол ================= */\nfunction cardHTML(c,cls='',st=''){\n  const red=c.s==='H'||c.s==='D',id=c.s+c.r;\n  return `<div class=\"card ${red?'red':''} ${c.s===S.g.trump?'trump':''} ${cls}\" data-id=\"${id}\"${st?` style=\"${st}\"`:''}><div class=\"cr\">${RN(c.r)}<span>${SUIT[c.s]}</span></div><div class=\"cm\">${SUIT[c.s]}</div><div class=\"cr b\">${RN(c.r)}<span>${SUIT[c.s]}</span></div></div>`;\n}\nconst beats=(d,a,t)=>d.s===a.s?d.r>a.r:(d.s===t&&a.s!==t);\nfunction ranksOn(g){const s=new Set();g.table.forEach(p=>{s.add(p.a.r);if(p.d)s.add(p.d.r)});return s}\nfunction playable(g,c){\n  if(g.over)return false;\n  if(g.iAttack){if(!g.table.length)return g.phase==='attack';return g.table.length<g.limit&&ranksOn(g).has(c.r)}\n  if(g.phase!=='attack')return false;\n  return g.table.some(p=>!p.d&&beats(c,p.a,g.trump));\n}\n/* размеры карт под экран */\nfunction fitGame(){\n  const W=window.innerWidth,H=window.innerHeight;\n  let hw=Math.min(86,Math.round(W*.215));\n  hw=Math.max(58,Math.min(hw,Math.floor((H-295-250-50)/1.42)));\n  const cw=Math.max(50,Math.min(72,Math.floor((W-176)/3),Math.round(hw*.86)));\n  const r=document.documentElement.style;r.setProperty('--cw',cw+'px');r.setProperty('--hw',hw+'px');S.hw=hw;S.cw=cw;\n}\nfitGame();window.addEventListener('resize',()=>{fitGame();if(S.shown==='game'&&S.g&&!(DR&&DR.moved))drawGame(S.g,null,null,false)});\nfunction layoutHand(n){\n  const W=Math.min(window.innerWidth,520),hw=S.hw||80;\n  const a=Math.min(4.4,26/Math.max(n,1));\n  const tm=(n-1)/2,R=1.1*hw*1.42,avail=(W-hw-18)/2;\n  const sp=n<2?0:Math.max(8,Math.min(hw*.62,(avail-R*Math.sin(a*tm*Math.PI/180))/tm));\n  return Array.from({length:n},(_,i)=>{const t=i-(n-1)/2;return{x:+(t*sp).toFixed(1),y:+(Math.pow(Math.abs(t),1.6)*2.2).toFixed(1),r:+(t*a).toFixed(2)}});\n}\nconst center=r=>({x:r.left+r.width/2,y:r.top+r.height/2});\nfunction relRect(r){const f=$('#s-game').getBoundingClientRect();return{left:r.left-f.left,top:r.top-f.top,width:r.width,height:r.height}}\nfunction flyFrom(el,dx,dy,o={}){\n  if(!el.animate)return;\n  el.animate([{transform:`translate(${dx}px,${dy}px) scale(${o.sx||1},${o.sy||o.sx||1}) rotate(${o.rot||0}deg)`,opacity:o.op==null?1:o.op},{transform:'none',opacity:1}],\n    {duration:o.dur||360,delay:o.delay||0,easing:'cubic-bezier(.2,.85,.25,1)',fill:'backwards'});\n}\nfunction snapBefore(){\n  const m=new Map();\n  document.querySelectorAll('#gHand .card[data-id], #gFelt .pair .card[data-id]').forEach(el=>{\n    const r=el.getBoundingClientRect();\n    m.set(el.dataset.id,{rect:r,c:center(r),w:el.offsetWidth,node:el,where:el.closest('#gHand')?'hand':'table'});\n  });\n  if(S.dragFrom&&m.has(S.dragFrom.id)){const v=m.get(S.dragFrom.id);v.c=S.dragFrom.c;v.w=S.dragFrom.w}\n  S.dragFrom=null;\n  return m;\n}\nfunction ghost(v,to,delay,spin){\n  const f=$('#fx'),fr=$('#s-game').getBoundingClientRect(),g=v.node.cloneNode(true),w=v.w,h=w*1.42;\n  g.classList.remove('ok','dim','sel');\n  g.style.cssText+=`;position:absolute;left:${v.c.x-fr.left-w/2}px;top:${v.c.y-fr.top-h/2}px;width:${w}px;height:${h}px;font-size:${w}px;margin:0;translate:none;scale:none;rotate:none`;\n  f.appendChild(g);\n  const a=g.animate([{transform:'none',opacity:1},{transform:`translate(${to.x-v.c.x}px,${to.y-v.c.y}px) scale(.55) rotate(${spin}deg)`,opacity:0}],{duration:480,delay,easing:'cubic-bezier(.5,0,.75,.3)',fill:'forwards'});\n  a.onfinish=()=>g.remove();setTimeout(()=>g.remove(),1500);\n}\nfunction bubble(side,e){\n  const host=$(side==='opp'?'#gOpp':'#gMe');const b=document.createElement('div');b.className='bubble';b.textContent=e;\n  b.style.left=side==='opp'?'62%':'74px';b.style.top='-8px';host.appendChild(b);setTimeout(()=>b.remove(),2100);\n}\nfunction handleEmote(g){\n  const seen=S.emoSeen[g.id];\n  if(seen===undefined){S.emoSeen[g.id]=g.oppEmote?g.oppEmote.id:0;return}\n  if(g.oppEmote&&g.oppEmote.id>seen){S.emoSeen[g.id]=g.oppEmote.id;bubble('opp',g.oppEmote.e);hap()}\n}\nfunction animateDeal(){\n  sfx('deal');\n  const deck=$('#gFelt .deckbox');const dc=deck?center(deck.getBoundingClientRect()):{x:40,y:300};\n  document.querySelectorAll('#gHand .card[data-id]').forEach((el,i)=>{\n    const c=center(el.getBoundingClientRect());\n    flyFrom(el,dc.x-c.x,dc.y-c.y,{delay:200+i*110,dur:560,rot:-40,sx:.55});\n  });\n  document.querySelectorAll('#gOpp .ofan .card').forEach((el,i)=>{\n    const c=center(el.getBoundingClientRect());\n    flyFrom(el,dc.x-c.x,dc.y-c.y,{delay:260+i*110,dur:560,rot:30,sx:1.4});\n  });\n  const tc=document.querySelector('#gFelt .trumpc');\n  if(tc&&tc.animate)tc.animate([{opacity:0,transform:'scale(.2) rotate(-120deg)'},{opacity:1,transform:'none'}],{duration:600,delay:60,easing:'cubic-bezier(.2,1.3,.4,1)',fill:'backwards'});\n}\nfunction animateDiff(B,g,pg){\n  const els=[...document.querySelectorAll('#gHand .card[data-id], #gFelt .pair .card[data-id]')];\n  const present=new Set(els.map(e=>e.dataset.id));\n  const deck=$('#gFelt .deckbox'),fan=$('#gOpp .ofan'),disc=$('#gFelt .discardbox');\n  const dc=deck?center(deck.getBoundingClientRect()):{x:40,y:300};\n  const oc=fan?center(fan.getBoundingClientRect()):{x:300,y:100};\n  const xc=disc?center(disc.getBoundingClientRect()):{x:360,y:300};\n  let nd=0,no=0,iTook=false,sPlace=false,sOpp=false,sDraw=false;\n  for(const el of els){\n    const id=el.dataset.id,r=el.getBoundingClientRect(),c=center(r),old=B.get(id),inHand=!!el.closest('#gHand');\n    if(old){\n      const dx=old.c.x-c.x,dy=old.c.y-c.y,sx=old.w/(el.offsetWidth||old.w);\n      if(Math.abs(dx)+Math.abs(dy)>3||Math.abs(sx-1)>.03)flyFrom(el,dx,dy,{dur:380,sx});\n      if(old.where==='table'&&inHand)iTook=true;\n      if(old.where==='hand'&&!inHand)sPlace=true;\n    }else if(inHand){flyFrom(el,dc.x-c.x,dc.y-c.y,{delay:nd++*90,dur:500,rot:-25,sx:.55});sDraw=true}\n    else{flyFrom(el,oc.x-c.x,oc.y-c.y,{delay:no++*110,dur:440,rot:20,sx:.7});sOpp=true}\n  }\n  const gone=[];B.forEach((v,id)=>{if(v.where==='table'&&!present.has(id))gone.push(v)});\n  if(gone.length){\n    const defIsOpp=pg&&pg.iAttack;\n    const took=pg&&(pg.table.some(p=>!p.d)||pg.phase==='take');\n    if(took&&defIsOpp){gone.forEach((v,i)=>ghost(v,oc,i*70,40));callout('Соперник берёт 😈');sfx('take')}\n    else if(!took){gone.forEach((v,i)=>ghost(v,xc,i*70,-60));callout('Бито! ✅');hap();sfx('discard')}\n  }\n  if(iTook){callout('Берёте 📥');sfx('take')}\n  else if(sPlace)sfx('place');\n  else if(sOpp)sfx('card');\n  else if(sDraw)sfx('deal');\n}\nfunction oppFan(g){\n  const n=Math.min(g.oppCount,18),sp=Math.min(15,170/Math.max(n,1)),a=Math.min(5,34/Math.max(n,1));\n  return Array.from({length:n},(_,i)=>{const t=i-(n-1)/2;return backHTML(g.opp.back,'',`--x:${(t*sp).toFixed(1)}px;--r:${(t*a).toFixed(2)}deg`)}).join('');\n}\nfunction drawGame(g,B,pg,deal){\n  const m=S.snap.me;S.g=g;\n  $('#gPot').innerHTML=g.practice?'🤖 Тренировка':`${coin}<span>${fmt(g.stake*2)}</span>`;\n  $('#gTurn').textContent=g.over?'Игра окончена':g.turn?'Ваш ход':(g.iAttack&&g.phase==='take'?'Можно подкинуть':'Ход соперника');\n  $('#gOpp').innerHTML=`<div class=\"ofan\">${oppFan(g)}</div><div class=\"oav ${!g.turn&&!g.over?'act':''}\">${av(g.opp,50)}</div><div class=\"ocnt\">${g.oppCount}</div><div class=\"onm\"><span>${esc(g.opp.name)}${!g.turn&&!g.over?' <b class=\"dots\"><i></i><i></i><i></i></b>':''}</span></div>`;\n  let tb='';\n  g.table.forEach((p,i)=>{\n    tb+=`<div class=\"pair\" data-i=\"${i}\">${cardHTML(p.a,'a')}${p.d?cardHTML(p.d,'d'):''}</div>`;\n  });\n  const deckH=g.deck>0?`<div class=\"deckbox\"><div class=\"dn\">${g.deck}</div>${cardHTML(g.trumpCard,'trumpc')}${backHTML(m.back)}${backHTML(m.back)}</div>`:`<div class=\"deckbox\"><div class=\"dn\">0</div></div>`;\n  const discH=`<div class=\"discardbox ${g.discard?'':'e'}\">${g.discard?`<div class=\"dn\">${g.discard}</div>`:''}${backHTML(m.back)}</div>`;\n  $('#gFelt').innerHTML=deckH+discH+`<div class=\"trumpTag\" style=\"${g.trump==='H'||g.trump==='D'?'color:#ff9aa6':''}\">Козырь ${SUIT[g.trump]}</div><div class=\"tbl\">${tb}</div>`;\n  const un=g.table.some(p=>!p.d),all=g.table.length&&!un;let a='';\n  if(!g.over){\n    if(!g.iAttack&&g.phase==='attack'&&un)a=`<button class=\"btn red\" id=\"aTake\">Беру</button>`;\n    else if(g.iAttack&&(g.phase==='take'||all))a=`<button class=\"btn green\" id=\"aDone\">${g.phase==='take'?'Готово':'Бито'}</button>`;\n  }\n  $('#gActs').innerHTML=a;\n  const me=$('#gMe');me.classList.toggle('act',g.turn&&!g.over);\n  me.innerHTML=`${av(m,34)}<span class=\"nm\">${esc(m.name)}</span>${rk(m.rank)}<span style=\"font-size:13px\">${g.iAttack?'⚔️':'🛡️'}</span><button class=\"emobtn\" id=\"emoBtn\">😀</button>`;\n  const L=layoutHand(g.hand.length);\n  $('#gHand').innerHTML=g.hand.map((c,i)=>cardHTML(c,'',`--x:${L[i].x}px;--y:${L[i].y}px;--r:${L[i].r}deg`)).join('');\n  if(deal)animateDeal();else if(B)animateDiff(B,g,pg);\n  /* результат */\n  const mod=$('#modal');\n  if(g.over&&g.result){\n    const r=g.result,w=r.res==='win';\n    const why=r.reason==='timeout'?(w?'Соперник не успел сходить':'Вы не успели сходить'):r.reason==='resign'?(w?'Соперник сдался':'Вы сдались'):'';\n    if(!mod.classList.contains('show')){\n      mod.innerHTML=`<div class=\"res ${w?'win':'lose'}\"><div class=\"bigemo\">${w?'🏆':r.res==='draw'?'🤝':'💀'}</div><h2>${g.practice?(w?'Бот повержен':r.res==='draw'?'Ничья':'Бот хитрее'):(w?'Победа':r.res==='draw'?'Ничья':'Поражение')}</h2>\n      ${g.practice?'<div class=\"sub\">Тренировка: монеты и рейтинг не меняются</div>':`<div class=\"dl ${r.coins>0?'p':r.coins<0?'n':''}\" id=\"resCoins\" data-v=\"${r.coins}\">${r.coins>0?'+':''}0 ${coin}</div>\n      <div class=\"sub\">${r.rating?(r.rating>0?'+':'')+r.rating+' ⭐ рейтинг':'Рейтинг не изменился'}${why?'<br>'+why:''}</div>`}\n      ${r.drop?`<div class=\"drop\">${cardArt(r.drop,92,{cls:'fresh'})}<small>Новая карточка в коллекции!</small></div>`:''}\n      <button class=\"btn primary big\" id=\"rAgain\">Играть ещё</button><div style=\"height:8px\"></div><button class=\"btn big\" id=\"rMenu\">В меню</button></div>`;\n      mod.classList.add('show');\n      const el=$('#resCoins');if(el)countUp(el,+el.dataset.v);\n    }\n    if(S.celebrated!==g.id){S.celebrated=g.id;if(w){hapN('success');sfx('win');confetti()}else{hapN('warning');sfx('lose')}}\n  }else mod.classList.remove('show');\n  tick();\n}\nfunction renderGame(){\n  const g=S.snap.game;\n  if(DR&&DR.moved){S.pendingRender=true;return}\n  S.deadlineAt=Date.now()+g.left;\n  handleEmote(g);\n  const sig=JSON.stringify([g.id,g.hand,g.table,g.deck,g.discard,g.oppCount,g.turn,g.iAttack,g.phase,g.over,g.result,g.oppOnline,g.opp.name,g.opp.emoji,g.opp.back,g.limit,S.snap.me.name,S.snap.me.back,S.snap.me.rank.idx]);\n  if(sig===S.sig)return;\n  const deal=S.gid!==g.id;\n  if(deal)fitGame();\n  const B=!deal&&S.shown==='game'?snapBefore():null;\n  const pg=deal?null:S.prevG;\n  if(deal){S.gid=g.id;$('#emoPanel').classList.remove('show');$('#modal').classList.remove('show');$('#fx').innerHTML=''}\n  S.sig=sig;\n  drawGame(g,B,pg,deal);\n  S.prevG=g;\n  clearGhost();\n}\nfunction confetti(){\n  const root=$('#s-game');\n  for(let i=0;i<34;i++){\n    const d=document.createElement('div');d.className='fall';d.textContent=['🪙','✨','🎉','♠️','♥️'][i%5];\n    d.style.left=Math.random()*100+'%';d.style.animationDuration=(1.6+Math.random()*1.6)+'s';d.style.animationDelay=Math.random()*.5+'s';\n    root.appendChild(d);setTimeout(()=>d.remove(),4200);\n  }\n}\nfunction tick(){\n  const g=S.snap&&S.snap.game;if(S.shown!=='game'||!g)return;\n  const bar=$('#tbar');\n  if(g.over){bar.querySelector('i').style.width='0%';return}\n  const left=Math.max(0,S.deadlineAt-Date.now()),tot=S.snap.cfg.turn;\n  bar.querySelector('i').style.width=Math.min(100,left/tot*100)+'%';\n  bar.classList.toggle('low',left<10000);\n}\nsetInterval(tick,200);\n\n/* ---- ход картой: перетаскивание пальцем (или короткое касание) ---- */\nlet DR=null;\nconst inZone=(x,y)=>{const hr=$('#gHand').getBoundingClientRect(),or=$('#gOpp').getBoundingClientRect();return y<hr.top+6&&y>or.top+30};\nfunction badMsg(g,c){\n  if(!g||g.over)return 'Игра окончена';\n  if(!g.turn&&!(g.iAttack&&g.phase==='take'))return 'Сейчас ход соперника';\n  if(g.iAttack)return playable(g,c)?'':(g.table.length?(g.table.length>=g.limit?'Больше подкинуть нельзя (лимит '+g.limit+')':'Подкинуть можно карту того же достоинства, что на столе'):'Сейчас нельзя атаковать');\n  if(g.phase!=='attack'||!g.table.some(p=>!p.d))return 'Сейчас нечем отбиваться';\n  return g.table.some(p=>!p.d&&beats(c,p.a,g.trump))?'':'Эта карта не бьёт';\n}\nconst targetsOf=(g,c)=>{const r=[];g.table.forEach((p,i)=>{if(!p.d&&beats(c,p.a,g.trump))r.push(i)});return r};\nfunction shakeCard(el,m){\n  el.classList.remove('shake');void el.offsetWidth;el.classList.add('shake');hapN('error');sfx('err');if(m)toast(m);\n}\nfunction dropDecision(g,c,x,y){\n  const m=badMsg(g,c);if(m)return{err:m};\n  if(g.iAttack)return inZone(x,y)?{go:'attack'}:{err:''};\n  const tg=targetsOf(g,c),prs=[...document.querySelectorAll('#gFelt .pair')];\n  for(const pr of prs){\n    const i=+pr.dataset.i;if(!tg.includes(i))continue;\n    const r=pr.getBoundingClientRect();\n    if(x>=r.left-14&&x<=r.right+14&&y>=r.top-14&&y<=r.bottom+14)return{go:'defend',idx:i};\n  }\n  if(!inZone(x,y))return{err:''};\n  if(tg.length===1)return{go:'defend',idx:tg[0]};\n  let best=tg[0],bd=1e9;\n  prs.forEach(pr=>{const i=+pr.dataset.i;if(!tg.includes(i))return;const r=pr.getBoundingClientRect(),d=Math.hypot(x-(r.left+r.width/2),y-(r.top+r.height/2));if(d<bd){bd=d;best=i}});\n  return{go:'defend',idx:best};\n}\nfunction clearGhost(){const f=$('#fx');if(f)f.querySelectorAll('.dragghost').forEach(x=>x.remove())}\nfunction moveGhost(D,x,y){\n  const fr=$('#s-game').getBoundingClientRect();\n  D.gx=x;D.gy=y-34;\n  D.gh.style.left=(D.gx-fr.left-D.w/2)+'px';D.gh.style.top=(D.gy-fr.top-D.h/2)+'px';\n}\nfunction dragHover(g,D,x,y){\n  const felt=$('#gFelt');let ok=false,hv=-1;\n  if(!badMsg(g,D.c)){\n    if(g.iAttack)ok=inZone(x,y);\n    else{\n      const d=dropDecision(g,D.c,x,y);\n      if(d.go){ok=true;hv=d.idx}\n    }\n  }\n  felt.classList.toggle('dropok',ok&&hv<0);\n  document.querySelectorAll('#gFelt .pair').forEach(pr=>pr.classList.toggle('hover',+pr.dataset.i===hv));\n}\nfunction startDrag(D){\n  D.moved=true;\n  const el=D.el,g=S.snap.game;\n  D.w=el.offsetWidth;D.h=D.w*1.42;\n  const tmp=document.createElement('div');tmp.innerHTML=cardHTML(D.c,'dragghost',`--cw:${D.w}px;width:${D.w}px;height:${D.h}px;font-size:${D.w}px`);\n  D.gh=tmp.firstChild;$('#fx').appendChild(D.gh);\n  el.classList.add('dragsrc');hap();sfx('card');\n}\nfunction afterDrag(){\n  if(S.pendingRender){S.pendingRender=false;S.sig='';if(S.snap&&S.snap.game)renderGame()}\n}\nfunction bounceBack(D,m){\n  const r=D.el.getBoundingClientRect(),fr=$('#s-game').getBoundingClientRect();\n  if(D.gh&&D.gh.isConnected){\n    D.gh.classList.add('back');\n    D.gh.style.left=(r.left+r.width/2-fr.left-D.w/2)+'px';D.gh.style.top=(r.top+r.height/2-fr.top-D.h/2)+'px';\n    D.gh.style.scale='1';\n    setTimeout(()=>{D.gh.remove();D.el.classList.remove('dragsrc');afterDrag()},240);\n  }else{D.el.classList.remove('dragsrc');afterDrag()}\n  if(m){toast(m);sfx('err');hapN('error')}\n}\n$('#gHand').addEventListener('pointerdown',e=>{\n  const el=e.target.closest('.card');if(!el||DR)return;\n  const g=S.snap&&S.snap.game;if(!g||g.over)return;\n  const c=g.hand.find(x=>x.s+x.r===el.dataset.id);if(!c)return;\n  DR={el,id:el.dataset.id,c,pid:e.pointerId,sx:e.clientX,sy:e.clientY,moved:false};\n  e.preventDefault();\n});\nwindow.addEventListener('pointermove',e=>{\n  if(!DR||e.pointerId!==DR.pid)return;\n  if(!DR.moved){\n    if(Math.hypot(e.clientX-DR.sx,e.clientY-DR.sy)<9)return;\n    startDrag(DR);\n  }\n  moveGhost(DR,e.clientX,e.clientY);\n  dragHover(S.snap.game,DR,e.clientX,e.clientY);\n  e.preventDefault();\n},{passive:false});\nfunction endDrag(e,cancel){\n  if(!DR||(e&&e.pointerId!==DR.pid))return;\n  const D=DR;\n  const felt=$('#gFelt');if(felt)felt.classList.remove('dropok');\n  document.querySelectorAll('#gFelt .pair.hover').forEach(x=>x.classList.remove('hover'));\n  const g=S.snap&&S.snap.game;\n  if(!D.moved){                       // короткое касание: ход «одним касанием»\n    DR=null;\n    if(!g||cancel)return;\n    const m=badMsg(g,D.c);\n    if(m){shakeCard(D.el,m);return}\n    hap();sfx('card');\n    if(g.iAttack)act('attack',{card:D.id});\n    else act('defend',{card:D.id,idx:targetsOf(g,D.c)[0]});\n    return;\n  }\n  const res=cancel||!g?{err:''}:dropDecision(g,D.c,e.clientX,e.clientY);\n  if(res.go){\n    S.dragFrom={id:D.id,c:{x:D.gx,y:D.gy},w:D.w*1.12};\n    DR=null;\n    hap('medium');\n    const payload=res.go==='attack'?{card:D.id}:{card:D.id,idx:res.idx};\n    act(res.go,payload).then(r=>{\n      if(r&&r.error){S.dragFrom=null;bounceBack(D,'')}\n    });\n    setTimeout(()=>{if(D.gh&&D.gh.isConnected){D.gh.remove();D.el.classList.remove('dragsrc')}},1600);\n  }else{DR=null;bounceBack(D,res.err||'')}\n}\nwindow.addEventListener('pointerup',e=>endDrag(e,false));\nwindow.addEventListener('pointercancel',e=>endDrag(e,true));\n$('#gActs').onclick=e=>{\n  if(e.target.closest('#aTake')){hap('medium');act('take')}\n  if(e.target.closest('#aDone')){hap('medium');act('done')}\n};\n$('#gMe').onclick=e=>{\n  if(!e.target.closest('#emoBtn'))return;\n  const p=$('#emoPanel');\n  if(!p.innerHTML)p.innerHTML=S.snap.cfg.emotes.map(x=>`<button data-e=\"${x}\">${x}</button>`).join('');\n  p.classList.toggle('show');hap();\n};\n$('#emoPanel').onclick=e=>{\n  const b=e.target.closest('button');if(!b)return;\n  $('#emoPanel').classList.remove('show');bubble('me',b.dataset.e);hap();act('emote',{e:b.dataset.e});\n};\n$('#gResign').onclick=()=>{\n  const g=S.snap.game;if(!g||g.over)return;\n  const msg=g.practice?'Закончить тренировку?':'Сдаться? Ставка достанется сопернику.';\n  const go=()=>act('resign');\n  if(tg&&tg.showConfirm)tg.showConfirm(msg,ok=>ok&&go());else if(confirm(msg))go();\n};\n$('#modal').onclick=async e=>{\n  if(e.target.closest('#rMenu')){await act('leave');S.tab='play';S.built=''}\n  else if(e.target.closest('#rAgain')){\n    const g=S.snap.game,st=g.stake,pr=g.practice;await act('leave');S.tab='play';S.built='';\n    const r=await act(pr?'practice':'quick',pr?{}:{stake:st});if(r.error&&!pr)S.stake=st;\n  }\n};\n\n/* ---------- главный рендер ---------- */\nfunction render(){\n  const s=S.snap;if(!s)return;\n  const needSetup=!s.me.ready||s.me.needUsername;\n  if(needSetup){\n    if(S.shown!=='setup'||!S.E){\n      initE();\n      const old=s.me.ready&&s.me.needUsername;\n      $('#s-setup').innerHTML=`<h1>${old?'Выберите ник':'Добро пожаловать'}</h1><p>${old?'Теперь у каждого игрока уникальный @ник, как в Telegram':'Создайте профиль: вас увидят соперники'}</p><div class=\"panel\" style=\"margin-top:14px\">${editorHTML(true)}</div><div style=\"text-align:center;color:var(--mut);font-size:13px\">${old?'':'🎁 Подарок новичку: '+fmt(1000)+' монет и бесплатный набор карточек'}</div>`;\n      bindEditor($('#s-setup'),true);\n    }\n    showScreen('setup');return;\n  }\n  const inc=(s.offers||[]).filter(o=>o.dir==='in');\n  if(S.knownIn===null)S.knownIn=new Set(inc.map(o=>o.id));\n  else for(const o of inc)if(!S.knownIn.has(o.id)){S.knownIn.add(o.id);toast('🔁 @'+o.user.username+' предлагает обмен',true);hapN('success')}\n  /* открытое предложение пропало (ответил второй игрок) */\n  if(S.TB&&S.TB.offer&&!S.TB.busy){\n    const cur=(s.offers||[]).find(o=>o.id===S.TB.offer.id);\n    if(!cur){closeTrade();toast('Предложение уже неактуально')}\n    else{S.TB.offer=cur;if(S.TB.mode==='out'){const st=$('#s-trade .thead .un');if(st)st.textContent='ждёт ответа · '+hms(cur.left)}}\n  }\n  if(s.game){if(S.TB)closeTrade();closePage();closeSheet();showScreen('game');renderGame();return}\n  if(S.gid){S.gid=null;S.sig='';S.prevG=null;$('#modal').classList.remove('show');$('#fx').innerHTML=''}\n  showScreen('home');\n  updatePage();\n  if(S.tab==='set'&&S.built==='set'){renderHead();return}\n  renderHome();\n}\ndocument.addEventListener('visibilitychange',()=>{if(!document.hidden&&S.token)refreshState()});\n(async()=>{\n  for(let i=0;;i++){\n    const ok=await login();\n    if(ok===true){connect();return}\n    if(ok!=='retry'){setTimeout(()=>location.reload(),6000);return}\n    await sleep(2500);\n  }\n})();\n\n})();\n</script>\n</body>\n</html>\n";

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
  for (const o of db.offers) if (!o.give) { o.give = { cards: [], coins: o.amount || 0 }; o.want = { cards: [], coins: 0 }; markO(); }
  for (const u of Object.values(db.users)) {
    if (!u.inv) { u.inv = {}; u.back = ''; u.pity = 0; u.freePacks = 1; markU(u.id); }   // старые профили получают бесплатный набор
    if (u.username) unameIdx.set(u.username.toLowerCase(), u.id);
  }
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
  return { id: u.id, name: u.name, username: u.username || '', emoji: u.emoji, color: u.color, photo: u.usePhoto && u.photo ? u.photo : null, rating: u.rating, rank: rankOf(u.rating), back: u.back || '' };
}
/* ---- коллекция ---- */
function invAdd(u, id, n) { u.inv[id] = (u.inv[id] || 0) + (n || 1); }
function invTake(u, id, n) {
  n = n || 1;
  if ((u.inv[id] || 0) < n) return false;
  u.inv[id] -= n; if (u.inv[id] <= 0) { delete u.inv[id]; if (u.back === id) u.back = ''; }
  return true;
}
function openPack(uid) {
  const u = db.users[uid];
  if (u.freePacks > 0) u.freePacks--;
  else { if (u.coins < PACK_PRICE) return 'Не хватает монет'; u.coins -= PACK_PRICE; }
  const rs = []; let hi = false;
  for (let i = 0; i < PACK_SIZE; i++) { const r = wPick(ODDS); if (r >= 2) hi = true; rs.push(r); }
  if (!hi) {                                          // гарантия: не чаще чем раз в PITY наборов без эпика
    u.pity = (u.pity || 0) + 1;
    if (u.pity >= PITY) { rs[crypto.randomInt(rs.length)] = 2 + wPick([92, 8]); hi = true; }
  }
  if (hi) u.pity = 0;
  const cards = rs.map(r => { const c = pickCard(r), isNew = !(u.inv[c.id] > 0); invAdd(u, c.id, 1); return { id: c.id, isNew }; });
  markU(uid);
  return { pack: cards };
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
    inv: u.inv || {}, back: u.back || '', freePacks: u.freePacks || 0, pity: u.pity || 0,
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
      inv: {}, back: '', pity: 0, freePacks: 1,
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
    if (crypto.randomInt(100) < DROP_CHANCE) {            // шанс получить карточку за победу
      const c = pickCard(wPick(DROP_ODDS)); invAdd(w, c.id, 1); res.drop = { [winner]: c.id };
    }
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
const CODE_CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  for (let k = 0; k < 50; k++) {
    let c = ''; for (let i = 0; i < 5; i++) c += CODE_CH[crypto.randomInt(CODE_CH.length)];
    if (![...tables.values()].some(t => t.code === c)) return c;
  }
  return '';
}
function createTable(uid, stake, priv) {
  const u = db.users[uid];
  if (!STAKES.includes(stake)) return 'Неверная ставка';
  if (busy(uid)) return 'Вы уже в игре или за столом';
  if (u.coins < stake) return 'Не хватает монет';
  u.coins -= stake; u.escrow = stake;
  const t = { id: nid(), owner: uid, stake };
  if (priv) { t.priv = true; t.code = newCode(); }
  tables.set(t.id, t); userTable.set(uid, t.id);
  markU(uid);
  return null;
}
function joinTable(uid, tid, code) {
  const t = tables.get(tid), u = db.users[uid];
  if (!t) return 'Стол уже занят';
  if (t.priv && code !== t.code) return 'Стол уже занят';
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

function sideView(s) { return { cards: s.cards.slice(), coins: s.coins }; }
function offerView(o, uid) {
  const out = o.from === uid;
  return { id: o.id, dir: out ? 'out' : 'in', give: sideView(o.give), want: sideView(o.want), user: pub(db.users[out ? o.to : o.from]), left: Math.max(0, o.created + OFFER_TTL - Date.now()) };
}
function myOffers(uid) {
  return db.offers.filter(o => o.status === 'pending' && (o.from === uid || o.to === uid) && db.users[o.from] && db.users[o.to]).map(o => offerView(o, uid));
}
function cleanSide(s) {
  const raw = Array.isArray(s && s.cards) ? s.cards.map(String) : [];
  const cards = [...new Set(raw)];
  if (cards.length > MAX_SLOTS) return 'Максимум ' + MAX_SLOTS + ' карточки с каждой стороны';
  if (cards.some(id => !CARD_BY[id])) return 'Неизвестная карточка';
  const coins = Math.floor(+(s && s.coins) || 0);
  if (coins < 0 || coins > 1e9) return 'Неверная сумма';
  if (coins > 0 && coins < MIN_SEND) return 'Минимум ' + MIN_SEND + ' монет';
  return { cards, coins };
}
function sendTrade(uid, toName, giveRaw, wantRaw) {
  const u = db.users[uid];
  const rid = unameIdx.get(String(toName || '').replace(/^@/, '').toLowerCase());
  const r = rid && db.users[rid];
  if (!r || !r.ready || r.isBot) return 'Игрок с таким ником не найден';
  if (rid === uid) return 'Нельзя обмениваться с самим собой';
  const give = cleanSide(giveRaw); if (typeof give === 'string') return give;
  const want = cleanSide(wantRaw); if (typeof want === 'string') return want;
  if (!give.cards.length && !give.coins) return 'Добавьте, что вы отдаёте';
  if (give.cards.some(id => !(u.inv[id] > 0))) return 'У вас нет одной из карточек';
  if (u.coins < give.coins) return 'Не хватает монет';
  if (want.cards.some(id => !(r.inv[id] > 0))) return 'У @' + r.username + ' нет такой карточки';
  if (r.coins < want.coins) return 'У @' + r.username + ' не хватает монет';
  if (db.offers.filter(o => o.status === 'pending' && o.from === uid).length >= MAX_OUT) return 'Слишком много активных предложений';
  give.cards.forEach(id => invTake(u, id, 1));          // ваша часть замораживается, пока соперник не ответит
  u.coins -= give.coins;
  db.offers.push({ id: nid(), from: uid, to: rid, give, want, created: Date.now(), status: 'pending' });
  markU(uid); markO();
  return null;
}
function refund(o) {
  const f = db.users[o.from]; if (!f) return;
  o.give.cards.forEach(id => invAdd(f, id, 1)); f.coins += o.give.coins; markU(o.from);
}
function resolveOffer(uid, id, how) {
  const o = db.offers.find(x => x.id === id && x.status === 'pending');
  if (!o) return 'Предложение уже неактуально';
  if (how === 'accept') {
    if (o.to !== uid) return 'Это не ваше предложение';
    const to = db.users[o.to], from = db.users[o.from];
    if (o.want.cards.some(id => !(to.inv[id] > 0))) return 'У вас уже нет нужной карточки';
    if (to.coins < o.want.coins) return 'Не хватает монет';
    o.want.cards.forEach(id => { invTake(to, id, 1); invAdd(from, id, 1); });
    to.coins -= o.want.coins; from.coins += o.want.coins;
    o.give.cards.forEach(id => invAdd(to, id, 1)); to.coins += o.give.coins;
    o.status = 'accepted';
  } else if (how === 'decline') {
    if (o.to !== uid) return 'Это не ваше предложение';
    refund(o); o.status = 'declined';
  } else {
    if (o.from !== uid) return 'Это не ваше предложение';
    refund(o); o.status = 'withdrawn';
  }
  o.done = Date.now(); markU(o.from); markU(o.to); markO();
  return null;
}
function expireOffers() {
  const now = Date.now(); let ch = false;
  for (const o of db.offers) {
    if (o.status === 'pending' && now - o.created > OFFER_TTL) { refund(o); o.status = 'expired'; o.done = now; ch = true; }
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
    case 'create': if (!ensureReady(u)) return 'Сначала создайте профиль'; return createTable(uid, +b.stake, !!b.priv);
    case 'joincode': {
      if (!ensureReady(u)) return 'Сначала создайте профиль';
      const code = String(b.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
      const t = code.length === 5 && [...tables.values()].find(x => x.priv && x.code === code);
      if (!t) return 'Стол с таким кодом не найден';
      return joinTable(uid, t.id, code);
    }
    case 'friend_add': {
      const f = db.users[unameIdx.get(String(b.username || '').trim().replace(/^@/, '').toLowerCase())];
      if (!f || !f.ready || f.isBot) return 'Игрок с таким ником не найден';
      if (f.id === uid) return 'Это вы';
      u.friends = u.friends || [];
      if (u.friends.includes(f.id)) return 'Уже в друзьях';
      if (u.friends.length >= 100) return 'Максимум 100 друзей';
      u.friends.push(f.id); markU(uid); return null;
    }
    case 'friend_del': {
      const f = db.users[unameIdx.get(String(b.username || '').trim().replace(/^@/, '').toLowerCase())];
      if (f && u.friends) { u.friends = u.friends.filter(x => x !== f.id); markU(uid); }
      return null;
    }
    case 'cancel': cancelTable(uid); return null;
    case 'join': if (!ensureReady(u)) return 'Сначала создайте профиль'; { const t0 = tables.get(String(b.table)); if (t0 && t0.priv) return 'Стол уже занят'; } return joinTable(uid, String(b.table));
    case 'quick': {
      if (!ensureReady(u)) return 'Сначала создайте профиль';
      const stake = +b.stake;
      if (!STAKES.includes(stake)) return 'Неверная ставка';
      if (busy(uid)) return 'Вы уже в игре или за столом';
      const t = [...tables.values()].find(x => x.stake === stake && x.owner !== uid && !x.priv);
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
    case 'trade': if (!ensureReady(u)) return 'Сначала создайте профиль'; return sendTrade(uid, b.to, b.give, b.want);
    case 'openpack': if (!ensureReady(u)) return 'Сначала создайте профиль'; return openPack(uid);
    case 'equip': {
      const id = String(b.card || '');
      if (id && !(CARD_BY[id] && u.inv[id] > 0)) return 'У вас нет этой карточки';
      u.back = id; markU(uid); return null;
    }
    case 'sell': {
      const c = CARD_BY[String(b.card)];
      if (!c) return 'Нет такой карточки';
      if ((u.inv[c.id] || 0) < 2) return 'Продать можно только дубликат';
      invTake(u, c.id, 1); u.coins += SELL[c.r]; markU(uid);
      return { coins: SELL[c.r] };
    }
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
    v.result = { res: !r.winner ? 'draw' : r.winner === uid ? 'win' : 'lose', coins: d.coins, rating: d.rating, reason: r.reason, drop: (r.drop && r.drop[uid]) || null };
  }
  return v;
}
function snapshot(uid) {
  const u = db.users[uid];
  const gid = userGame.get(uid), g = gid && games.get(gid);
  const list = [...tables.values()].filter(t => db.users[t.owner] && (!t.priv || t.owner === uid)).map(t => ({ id: t.id, stake: t.stake, owner: pub(db.users[t.owner]), mine: t.owner === uid, priv: !!t.priv, code: t.owner === uid && t.priv ? t.code : '' }));
  list.sort((a, b) => (b.mine - a.mine) || a.stake - b.stake);
  return {
    me: meView(u), tables: list.slice(0, 40), myTable: userTable.get(uid) || null, game: g ? gameView(g, uid) : null,
    friends: (u.friends || []).map(id => db.users[id]).filter(x => x && x.ready && x.username).map(x => Object.assign(pub(x), { online: online(x.id), wins: x.wins, losses: x.losses })),
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
      if (typeof err === 'string') return json(res, 200, { error: err });
      return json(res, 200, Object.assign({ ok: true }, err || {}));
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
    if (p === '/api/user') {                        // профиль игрока по нику (для обмена)
      if (!uid) return json(res, 401, { error: 'AUTH' });
      const q = String(url.searchParams.get('q') || '').trim().replace(/^@/, '').toLowerCase();
      const x = db.users[unameIdx.get(q)];
      if (!x || !x.ready || x.isBot) return json(res, 200, { user: null });
      return json(res, 200, { user: Object.assign(pub(x), { wins: x.wins, losses: x.losses, inv: x.inv || {} }) });
    }
    if (p === '/api/leaderboard') {
      if (!uid) return json(res, 401, { error: 'AUTH' });
      const top = Object.values(db.users).filter(x => x.ready && x.username && !x.isBot)
        .sort((a, b) => b.rating - a.rating || b.wins - a.wins).slice(0, 50)
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
