/* ============================================================
   スポーツナビ（バーチャル高校野球）から 日程・対戦・結果 を取得して
   data/games.json に書き出す。GitHub Actions から定期実行する。
   外部ライブラリなし（node標準のみ）。

   大事な考えかた：**取れたものを足すだけ。前回取れていたものは消さない。**
   （試合中・試合直後はページの形が変わって読めなくなることがある。
     読めなかった試合をそのまま落とすと、結果が一時的に消えてしまう）
   ============================================================ */
const fs = require('fs');
const path = require('path');

const BASE = 'https://baseball.yahoo.co.jp/hsb_summer/schedule/competition';
const START = process.env.KOSHIEN_START || '2026-08-05';
const DAYS  = Number(process.env.KOSHIEN_DAYS || 24);   // 順延を見込んで長めに見る
const EXPECT = Number(process.env.KOSHIEN_GAMES || 48); // 49校＝全48試合
const OUT   = process.env.KOSHIEN_OUT || path.join(__dirname, '..', 'data', 'games.json');

const ROUND_ORDER = ['1回戦','2回戦','3回戦','準々決勝','準決勝','決勝'];
/* 各回戦の試合数。ここと合わない＝どこかを取りこぼしている */
const ROUND_N = {'1回戦':17,'2回戦':16,'3回戦':8,'準々決勝':4,'準決勝':2,'決勝':1};

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

/* marker ごとに切り出す。1片は「次の marker まで」。
   閉じタグ end で切ったほうが短くて安全だが、**中身（need）が残るときだけ**そうする。
   試合が始まると入れ子のタグが増えて、最初の閉じタグで切ると
   2試合目以降がまるごと消える（2026-08-06 に実際に起きた）。 */
function chunks(hay, marker, end, need) {
  return hay.split(marker).slice(1).map(raw => {
    const cut = raw.split(end)[0];
    if (cut === raw) return raw;
    return need.every(n => cut.includes(n)) ? cut : raw;
  });
}

/* 1日ぶんのHTMLから試合を取り出す */
function parseDay(html, date) {
  const games = [];
  // <section class="bb-score"> ごと（＝回戦ごと）。次の bb-score セクションまでを1片にする。
  // ここで </section> で切らないこと（入れ子があると後ろの試合が消える）
  const sections = html.split(/<section class="bb-score"/).slice(1);
  for (const sec of sections) {
    const rm = sec.match(/class="bb-score__title"[^>]*>([\s\S]*?)<\/h1>/);
    const round = rm ? strip(rm[1]) : '';
    if (!ROUND_ORDER.includes(round)) continue;

    const items = chunks(sec, '<li class="bb-score__item"', '</li>',
                         ['bb-score__home', 'bb-score__away']);
    for (const it of items) {
      const idm = it.match(/\/hsb_summer\/game\/(\d+)\//);
      if (!idm) continue;                       // 試合IDがないものは試合ではない
      const nom = it.match(/class="bb-score__round"[^>]*>([\s\S]*?)<\/span>/);
      const home = it.match(/class="bb-score__home"[\s\S]*?<p>([\s\S]*?)<\/p>/);
      const away = it.match(/class="bb-score__away"[\s\S]*?<p>([\s\S]*?)<\/p>/);

      // スコア：<span class="bb-score__score bb-score__score--left">3</span>
      //         <span class="… --center">-</span><span class="… --right">1</span>
      // 修飾子(--left/--right)で拾う。真ん中の "-" を混ぜないこと。
      // ※ class="bb-score__score" の完全一致で探すと1件も取れない（2026-08-06 修正）
      const scores = [...it.matchAll(/bb-score__score--(?:left|right)[^>]*>([\s\S]*?)<\/span>/g)].map(m => strip(m[1]));
      const st = it.match(/class="bb-score__link"[^>]*>([\s\S]*?)<\/[a-z]+>/);

      const nm = m => { if (!m) return null; const s = strip(m[1]); return (!s || s === '未定') ? null : s; };
      const hName = nm(home);
      const aName = nm(away);
      const hs = scores[0] !== undefined && /^\d+$/.test(scores[0]) ? Number(scores[0]) : null;
      const as = scores[1] !== undefined && /^\d+$/.test(scores[1]) ? Number(scores[1]) : null;

      let winner = null;
      if (hName && aName && hs !== null && as !== null && hs !== as) winner = hs > as ? hName : aName;

      // 校名が読めなくても捨てない。IDだけでも残しておけば、前回ぶんと合体できる
      games.push({
        id: idm[1],
        date,
        round,
        no: nom ? strip(nom[1]) : '',
        home: hName,
        away: aName,
        homeScore: hs,
        awayScore: as,
        winner,
        status: st ? strip(st[1]) : '',
        _partial: !(home && away)
      });
    }
  }
  return games;
}

/* 前回ぶんと合体する。**空で上書きしない**（＝分かったことだけが増えていく） */
function mergeGame(prev, next) {
  if (!prev) return next;
  const keep = (a, b) => (b === null || b === undefined || b === '') ? a : b;
  return {
    id:        next.id,
    date:      keep(prev.date, next.date),
    round:     keep(prev.round, next.round),
    no:        keep(prev.no, next.no),
    home:      keep(prev.home, next.home),
    away:      keep(prev.away, next.away),
    homeScore: keep(prev.homeScore, next.homeScore),
    awayScore: keep(prev.awayScore, next.awayScore),
    winner:    keep(prev.winner, next.winner),
    status:    keep(prev.status, next.status)
  };
}

(async () => {
  const fresh = [];
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
    fresh.push(...g);
    const part = g.filter(x => x._partial).length;
    console.log(`  ${date}: ${g.length}試合${part ? `（うち ${part}件は校名が読めず）` : ''}`);
    if (g.length === 0) { if (++emptyStreak >= 5) break; } else emptyStreak = 0;
    await sleep(1200);                       // 相手に負荷をかけない
  }

  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) {}
  const prevGames = (prev && Array.isArray(prev.games)) ? prev.games : [];

  // 前回ぶんを土台にして、今回読めたぶんを上書きしていく
  const byId = new Map(prevGames.map(g => [g.id, g]));
  fresh.forEach(f => { const { _partial, ...clean } = f; byId.set(f.id, mergeGame(byId.get(f.id), clean)); });
  let all = [...byId.values()];

  // 今回まったく読めなかった試合（前回はあった）＝ページの形が変わったサイン
  const vanished = prevGames.filter(g => !seen.has(g.id));

  // 雨で中止になった試合は、後日**別のID**で作り直される（2026-08-12 に実際に起きた）。
  // 中止のほうを残すと、同じカードが2つ＝49試合になり、回戦の数が合わなくなる。
  // 組み直されたほうがあるなら、中止のほうは落とす。
  const superseded = [];
  const card = g => (g.home && g.away) ? [g.home, g.away].sort().join(' / ') : null;
  const live = new Set(all.filter(g => !/中止/.test(g.status)).map(card).filter(Boolean));
  all = all.filter(g => {
    if (!/中止/.test(g.status) || !live.has(card(g))) return true;
    superseded.push(g);
    return false;
  });

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
  const byRound = ROUND_ORDER.map(r => ({ round: r, n: all.filter(g => g.round === r).length }));
  // 予定の試合数に足りない＝どこかを丸ごと取りこぼしている
  const shortRounds = byRound.filter(r => r.n !== ROUND_N[r.round]);

  if (broken.length) {
    console.error(`\n⚠ 取得できていない試合が ${broken.length} 件あります（HTMLの形が変わった可能性）`);
    broken.forEach(g => console.error(`   ${g.date} ${g.round}${g.no} ${g.home} vs ${g.away} [${g.status}]`));
  }
  if (vanished.length) {
    console.error(`\n⚠ 今回のページから消えていた試合が ${vanished.length} 件あります（前回ぶんを残しました）`);
    vanished.forEach(g => console.error(`   ${g.date} ${g.round}${g.no} ${g.home} vs ${g.away}`));
  }
  if (superseded.length) {
    console.log(`\n中止のあと組み直された試合が ${superseded.length} 件ありました（中止のほうを外しました）`);
    superseded.forEach(g => console.log(`   ${g.date} ${g.round}${g.no} ${g.home} vs ${g.away}`));
  }
  if (all.length !== EXPECT || shortRounds.length) {
    console.error(`\n⚠ 試合数が ${all.length} 件です（予定は ${EXPECT} 件）`);
    shortRounds.forEach(r => console.error(`   ${r.round}: ${r.n}（予定 ${ROUND_N[r.round]}）`));
  }

  const out = {
    source: 'https://baseball.yahoo.co.jp/hsb_summer/schedule/competition/',
    fetchedAt: new Date().toISOString(),
    counts: { games: all.length, expected: EXPECT, paired, decided,
              broken: broken.length, vanished: vanished.length,
              superseded: superseded.length },
    byRound,
    games: all
  };

  // 前回と中身が同じなら書き換えない（無意味なコミットを作らない）
  if (prev && JSON.stringify(prev.games) === JSON.stringify(out.games)) {
    console.log('変化なし（書き込みなし）');
    process.exit(0);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n', 'utf8');
  console.log(`\n書き出し: ${all.length}試合 / 対戦確定 ${paired} / 勝敗確定 ${decided}`);
  byRound.forEach(r => console.log(`  ${r.round}: ${r.n}`));
})();
