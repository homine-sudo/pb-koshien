/* ============================================================
   スポーツナビ（バーチャル高校野球）から 日程・対戦・結果 を取得して
   data/games.json に書き出す。GitHub Actions から定期実行する。
   外部ライブラリなし（node標準のみ）。
   ============================================================ */
const fs = require('fs');
const path = require('path');

const BASE = 'https://baseball.yahoo.co.jp/hsb_summer/schedule/competition';
const START = process.env.KOSHIEN_START || '2026-08-05';
const DAYS  = Number(process.env.KOSHIEN_DAYS || 24);   // 順延を見込んで長めに見る
const OUT   = path.join(__dirname, '..', 'data', 'games.json');

const ROUND_ORDER = ['1回戦','2回戦','3回戦','準々決勝','準決勝','決勝'];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const addDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function get(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; pb-koshien/1.0; personal tally bot)',
      'Accept-Language': 'ja'
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

const strip = s => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"')
  .replace(/\s+/g, ' ').trim();

/* 1日ぶんのHTMLから試合を取り出す */
function parseDay(html, date) {
  const games = [];
  // <section class="bb-score"> ... </section> を丸ごと拾う（ラウンド単位）
  const sections = html.split(/<section class="bb-score"/).slice(1);
  for (const secRaw of sections) {
    const sec = secRaw.split('</section>')[0];
    const rm = sec.match(/class="bb-score__title"[^>]*>([\s\S]*?)<\/h1>/);
    const round = rm ? strip(rm[1]) : '';
    if (!ROUND_ORDER.includes(round)) continue;

    const items = sec.split(/<li class="bb-score__item"/).slice(1);
    for (const itRaw of items) {
      const it = itRaw.split('</li>')[0];
      const idm = it.match(/\/hsb_summer\/game\/(\d+)\//);
      const nom = it.match(/class="bb-score__round"[^>]*>([\s\S]*?)<\/span>/);
      const home = it.match(/class="bb-score__home"[\s\S]*?<p>([\s\S]*?)<\/p>/);
      const away = it.match(/class="bb-score__away"[\s\S]*?<p>([\s\S]*?)<\/p>/);
      if (!idm || !home || !away) continue;

      // スコア：<span class="bb-score__score bb-score__score--left">3</span>
      //         <span class="… --center">-</span><span class="… --right">1</span>
      // 修飾子(--left/--right)で拾う。真ん中の "-" を混ぜないこと。
      // ※ class="bb-score__score" の完全一致で探すと1件も取れない（2026-08-06 修正）
      const scores = [...it.matchAll(/bb-score__score--(?:left|right)[^>]*>([\s\S]*?)<\/span>/g)].map(m => strip(m[1]));
      const st = it.match(/class="bb-score__link"[^>]*>([\s\S]*?)<\/[a-z]+>/);

      const hName = strip(home[1]);
      const aName = strip(away[1]);
      const hs = scores[0] !== undefined && /^\d+$/.test(scores[0]) ? Number(scores[0]) : null;
      const as = scores[1] !== undefined && /^\d+$/.test(scores[1]) ? Number(scores[1]) : null;

      let winner = null;
      if (hs !== null && as !== null && hs !== as) winner = hs > as ? hName : aName;

      games.push({
        id: idm[1],
        date,
        round,
        no: nom ? strip(nom[1]) : '',
        home: hName === '未定' ? null : hName,
        away: aName === '未定' ? null : aName,
        homeScore: hs,
        awayScore: as,
        winner: winner === '未定' ? null : winner,
        status: st ? strip(st[1]) : ''
      });
    }
  }
  return games;
}

(async () => {
  const all = [];
  const seen = new Set();
  let emptyStreak = 0;

  for (let i = 0; i < DAYS; i++) {
    const date = addDays(START, i);
    let html;
    try {
      html = await get(`${BASE}?date=${date}`);
    } catch (e) {
      console.error(`  ${date}: 取得失敗 ${e.message}`);
      continue;
    }
    const g = parseDay(html, date).filter(x => !seen.has(x.id));
    g.forEach(x => seen.add(x.id));
    all.push(...g);
    console.log(`  ${date}: ${g.length}試合`);
    if (g.length === 0) { if (++emptyStreak >= 5) break; } else emptyStreak = 0;
    await sleep(1200);                       // 相手に負荷をかけない
  }

  all.sort((a, b) => {
    const r = ROUND_ORDER.indexOf(a.round) - ROUND_ORDER.indexOf(b.round);
    if (r) return r;
    const na = Number((a.no.match(/\d+/) || [0])[0]), nb = Number((b.no.match(/\d+/) || [0])[0]);
    return a.date === b.date ? na - nb : a.date < b.date ? -1 : 1;
  });

  const decided = all.filter(g => g.winner).length;
  const paired  = all.filter(g => g.home && g.away).length;
  // 「試合終了なのに勝敗が取れていない」= 取得側の不具合。黙って通さない
  const broken = all.filter(g => /試合終了/.test(g.status) && !g.winner &&
                                 !(g.homeScore !== null && g.homeScore === g.awayScore));
  if (broken.length) {
    console.error(`\n⚠ 取得できていない試合が ${broken.length} 件あります（HTMLの形が変わった可能性）`);
    broken.forEach(g => console.error(`   ${g.date} ${g.round}${g.no} ${g.home} vs ${g.away} [${g.status}]`));
  }
  const out = {
    source: 'https://baseball.yahoo.co.jp/hsb_summer/schedule/competition/',
    fetchedAt: new Date().toISOString(),
    counts: { games: all.length, paired, decided, broken: broken.length },
    byRound: ROUND_ORDER.map(r => ({ round: r, n: all.filter(g => g.round === r).length })),
    games: all
  };

  // 前回と中身が同じなら書き換えない（無意味なコミットを作らない）
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) {}
  if (prev && JSON.stringify(prev.games) === JSON.stringify(out.games)) {
    console.log('変化なし（書き込みなし）');
    process.exit(0);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n', 'utf8');
  console.log(`\n書き出し: ${all.length}試合 / 対戦確定 ${paired} / 勝敗確定 ${decided}`);
  out.byRound.forEach(r => console.log(`  ${r.round}: ${r.n}`));
})();
