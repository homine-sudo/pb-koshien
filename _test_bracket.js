/* ============================================================
   data/bracket.json（抽選で決まった1〜3回戦の枝分かれ）の検算
   node _test_bracket.js

   bracket.json は甲子園球場の公式表を書き写したもの。書き写しミスは
   「勝ったのに次の枠に出てこない」という形で出て、気づきにくい。
   そこで games.json（スポーツナビ）と突き合わせて、
   ・49校がちょうど1回ずつ出てくるか
   ・41試合が全部 games.json に実在し、日付・回戦・試合番号が合っているか
   ・1回戦とシード校の校名が games.json と合っているか
   を毎回確かめる。
   ============================================================ */
const fs = require('fs');
const path = require('path');

const bracket = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/bracket.json'), 'utf8'));
const games   = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/games.json'), 'utf8'));
const html    = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

let ok = 0, ng = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { ok++; console.log('  OK   ' + label); }
  else { ng++; console.log('  NG   ' + label + `\n        got  ${g}\n        want ${w}`); }
};
const yes = (label, cond, detail) => eq(label + (cond ? '' : `（${detail}）`), !!cond, true);

/* index.html から 49校と表記ゆれ吸収を借りてくる（二重に持たないため） */
const TEAMS = [...html.matchAll(/\['([^']+)','([^']+)'\]/g)].slice(0, 49).map(m => m[1]);
const ALIAS = { '智辯和歌山': '智弁和歌山' };
const norm = s => {
  const x = String(s || '').replace(/[\s　]/g, '').replace(/[（(].*?[）)]/g, '');
  return ALIAS[x] || x;
};
const noOf = g => Number((g.no.match(/\d+/) || [0])[0]);
const key  = (date, no) => `${date}#${no}`;
const ROUND = { 1: '1回戦', 2: '2回戦', 3: '3回戦' };

console.log('\n[1] 49校がちょうど1回ずつ');
eq('校数は49', bracket.order.length, 49);
eq('重複なし', new Set(bracket.order.map(norm)).size, 49);
eq('index.html の49校と同じ顔ぶれ',
   bracket.order.map(norm).sort(), TEAMS.map(norm).sort());

console.log('\n[2] 試合数');
eq('1回戦 17', bracket.games.filter(g => g.r === 1).length, 17);
eq('2回戦 16', bracket.games.filter(g => g.r === 2).length, 16);
eq('3回戦 8',  bracket.games.filter(g => g.r === 3).length, 8);

console.log('\n[3] 実際の試合と結びつく（対戦カードで照合）');
/* 日付と試合番号は「予定」でしかない。雨で中止になると別IDで組み直され、
   その日の試合番号も総ずれする（2026-08-12 に実際に起きた）。
   なので結びつけは **どの2校が当たるか** で確かめる。 */
const pairKey = (x, y) => [x, y].sort().join(' / ');
const byPair = new Map();
games.games.forEach(g => {
  if (!g.home || !g.away) return;
  const k = pairKey(norm(g.home), norm(g.away));
  if (!byPair.has(k) || g.winner) byPair.set(k, g);       // 中止の残骸より決着ずみを優先
});
const gByKey = new Map(bracket.games.map(b => [key(b.date, b.no), b]));

/* 抽選表を下からたどって、各試合の「実際の対戦カードと勝者」を求める */
const resolved = new Map();                                // bracketのキー → {a,b,game,winner}
function resolve(k) {
  if (resolved.has(k)) return resolved.get(k);
  const b = gByKey.get(k);
  const side = s => s.t != null ? norm(s.t) : (resolve(s.w) || {}).winner || null;
  const a = side(b.a), c = side(b.b);
  let game = null, winner = null;
  if (a && c) { game = byPair.get(pairKey(a, c)) || null; if (game && game.winner) winner = norm(game.winner); }
  const r = { a, b: c, game, winner };
  resolved.set(k, r);
  return r;
}
bracket.games.forEach(b => resolve(key(b.date, b.no)));

const unmatched = [];
resolved.forEach((r, k) => { if (r.a && r.b && !r.game) unmatched.push(`${k} ${r.a} vs ${r.b}`); });
eq('対戦カードが決まっている枠は、必ず実際の試合が見つかる', unmatched, []);

/* 逆向き：games.json の1〜3回戦（両校が決まっているもの）が、すべて抽選表のどこかの枠に居る */
const inBracket = new Set();
resolved.forEach(r => { if (r.a && r.b) inBracket.add(pairKey(r.a, r.b)); });
const orphan = games.games
  .filter(g => ['1回戦', '2回戦', '3回戦'].includes(g.round) && g.home && g.away)
  .filter(g => !inBracket.has(pairKey(norm(g.home), norm(g.away))))
  .map(g => `${g.date}#${noOf(g)} ${norm(g.home)} vs ${norm(g.away)}`);
eq('抽選表に居ない対戦カードは無い', orphan, []);

console.log('\n[4] 校名が games.json と合っている');
const nameMismatch = [];
bracket.games.filter(b => b.r === 1).forEach(b => {
  const r = resolved.get(key(b.date, b.no));
  const want = [norm(b.a.t), norm(b.b.t)].sort();
  const got = r.game ? [norm(r.game.home), norm(r.game.away)].sort() : null;
  if (!got || got[0] !== want[0] || got[1] !== want[1])
    nameMismatch.push(`${want.join(' vs ')} → ${got ? got.join(' vs ') : '見つからない'}`);
});
eq('1回戦17試合がそのまま実在する', nameMismatch, []);

console.log('\n[5] 勝者参照が迷子になっていない');
const keys = new Set(bracket.games.map(b => key(b.date, b.no)));
const dangling = [];
bracket.games.forEach(b => [b.a, b.b].forEach(s => { if (s.w && !keys.has(s.w)) dangling.push(s.w); }));
eq('参照先はすべて実在', dangling, []);
// 3回戦の8試合から木をたどると、ちょうど49枚の葉が bracket.order の順に並ぶ
const gByKey2 = new Map(bracket.games.map(b => [key(b.date, b.no), b]));
const leaves = [];
const walk = side => {
  if (side.t != null) { leaves.push(side.t); return; }
  const g = gByKey2.get(side.w);
  if (!g) return;
  walk(g.a); walk(g.b);
};
bracket.games.filter(b => b.r === 3).forEach(b => { walk(b.a); walk(b.b); });
eq('木をたどると49校', leaves.length, 49);
eq('並び順が order と同じ', leaves, bracket.order);

console.log('\n[6] シードはちょうど15校（1回戦に出ない）');
const inR1 = new Set();
bracket.games.filter(b => b.r === 1).forEach(b => [b.a, b.b].forEach(s => inR1.add(norm(s.t))));
eq('1回戦に出るのは34校', inR1.size, 34);
eq('シードは15校', bracket.order.filter(t => !inR1.has(norm(t))).length, 15);

console.log(`\n===== ${ok} 件合格 / ${ng} 件不合格 =====`);
process.exit(ng ? 1 : 0);
