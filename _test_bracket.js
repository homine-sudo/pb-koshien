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

console.log('\n[3] games.json と1対1');
const byKey = new Map(games.games.map(g => [key(g.date, noOf(g)), g]));
let missing = [], wrongRound = [];
bracket.games.forEach(b => {
  const g = byKey.get(key(b.date, b.no));
  if (!g) { missing.push(key(b.date, b.no)); return; }
  if (g.round !== ROUND[b.r]) wrongRound.push(`${key(b.date, b.no)} ${g.round}≠${ROUND[b.r]}`);
});
eq('games.json に無い試合はない', missing, []);
eq('回戦のずれはない', wrongRound, []);

const covered = new Set(bracket.games.map(b => key(b.date, b.no)));
const uncovered = games.games
  .filter(g => ['1回戦', '2回戦', '3回戦'].includes(g.round))
  .map(g => key(g.date, noOf(g)))
  .filter(k => !covered.has(k));
eq('1〜3回戦で枝の無い試合はない', uncovered, []);

console.log('\n[4] 校名が games.json と合っている');
const nameMismatch = [];
bracket.games.forEach(b => {
  const g = byKey.get(key(b.date, b.no)); if (!g) return;
  const want = [b.a, b.b].filter(s => s.t).map(s => norm(s.t));
  if (!want.length) return;
  const got = [g.home, g.away].filter(Boolean).map(norm);
  want.forEach(w => { if (!got.includes(w)) nameMismatch.push(`${key(b.date, b.no)} に ${w} がいない [${got}]`); });
});
eq('1回戦・シードの校名が一致', nameMismatch, []);

console.log('\n[5] 勝者参照が迷子になっていない');
const keys = new Set(bracket.games.map(b => key(b.date, b.no)));
const dangling = [];
bracket.games.forEach(b => [b.a, b.b].forEach(s => { if (s.w && !keys.has(s.w)) dangling.push(s.w); }));
eq('参照先はすべて実在', dangling, []);
// 3回戦の8試合から木をたどると、ちょうど49枚の葉が bracket.order の順に並ぶ
const gByKey = new Map(bracket.games.map(b => [key(b.date, b.no), b]));
const leaves = [];
const walk = side => {
  if (side.t != null) { leaves.push(side.t); return; }
  const g = gByKey.get(side.w);
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
