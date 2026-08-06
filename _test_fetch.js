/* ============================================================
   scripts/fetch_games.js の取りこぼし対策テスト（node _test_fetch.js）

   実際に起きた事故を再現する：
   ・8/5、8/6 とも「試合が終わった直後にその試合がページから消えた」。
     取れたぶんだけで書き直していたので、結果が games.json から消えた。
   ・試合中／試合直後は入れ子のタグが増える。最初の </li> / </section> で切る
     作り方だと校名が読めなくなり、その試合がまるごと落ちた。
   ネットにはつながず、偽のHTMLを fetch に返して確かめる。
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let ok = 0, ng = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { ok++; console.log('  OK   ' + label); }
  else { ng++; console.log('  NG   ' + label + `\n        got  ${g}\n        want ${w}`); }
};

/* ---- 偽のスポーツナビHTML ---------------------------------- */
function item(g) {
  // 試合中／試合終了になると入れ子の要素が増える、という状況を live で再現する
  const nest = g.live
    ? '<div class="bb-liveDetail"><ul><li>1回表</li><li>1回裏</li></ul></div>'
    : '';
  const score = (g.hs === undefined) ? '' :
    `<span class="bb-score__score bb-score__score--left">${g.hs}</span>` +
    `<span class="bb-score__score bb-score__score--center">-</span>` +
    `<span class="bb-score__score bb-score__score--right">${g.as}</span>`;
  return `<li class="bb-score__item">
    <a href="/hsb_summer/game/${g.id}/top"><span class="bb-score__round">${g.no}</span></a>
    <div class="bb-score__home"><p>${g.home}</p></div>
    ${score}${nest}
    <div class="bb-score__away"><p>${g.away}</p></div>
    <a class="bb-score__link" href="#">${g.status}</a>
  </li>`;
}
function page(round, games) {
  return `<html><body><main>
    <section class="bb-score"><h1 class="bb-score__title">${round}</h1>
      <ul class="bb-score__list">${games.map(item).join('')}</ul>
    </section>
  </main><footer>おわり</footer></body></html>`;
}

/* ---- fetch を差し替えて fetch_games.js を丸ごと動かす -------- */
function run(pagesByDate, prevFile) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pbk-'));
  const out = path.join(tmp, 'games.json');
  if (prevFile) fs.writeFileSync(out, JSON.stringify(prevFile, null, 1));

  const stub = path.join(tmp, 'stub.js');
  fs.writeFileSync(stub, `
    const PAGES = ${JSON.stringify(pagesByDate)};
    global.fetch = async (url) => {
      const d = String(url).split('date=')[1];
      return { ok: true, status: 200, text: async () => PAGES[d] || '<html></html>' };
    };
    require(${JSON.stringify(path.join(__dirname, 'scripts', 'fetch_games.js'))});
  `);
  execFileSync(process.execPath, [stub], {
    env: { ...process.env, KOSHIEN_OUT: out, KOSHIEN_DAYS: '8', KOSHIEN_START: '2026-08-05', KOSHIEN_GAMES: '2' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}
/* 警告は stderr に出る。execFileSync では拾いにくいので、別に確かめる用 */
function runErr(pagesByDate, prevFile) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pbk-'));
  const out = path.join(tmp, 'games.json');
  if (prevFile) fs.writeFileSync(out, JSON.stringify(prevFile, null, 1));
  const stub = path.join(tmp, 'stub.js');
  fs.writeFileSync(stub, `
    const PAGES = ${JSON.stringify(pagesByDate)};
    global.fetch = async (url) => {
      const d = String(url).split('date=')[1];
      return { ok: true, status: 200, text: async () => PAGES[d] || '<html></html>' };
    };
    require(${JSON.stringify(path.join(__dirname, 'scripts', 'fetch_games.js'))});
  `);
  const res = require('child_process').spawnSync(process.execPath, [stub], {
    env: { ...process.env, KOSHIEN_OUT: out, KOSHIEN_DAYS: '8', KOSHIEN_START: '2026-08-05', KOSHIEN_GAMES: '2' },
    encoding: 'utf8'
  });
  return res.stderr || '';
}
const brief = j => j.games.map(g => [g.id, g.home, g.away, g.winner, g.status].join('/')).sort();

console.log('\n[1] ふつうに2試合とも読める');
{
  const html = page('1回戦', [
    { id: '1', no: '第1試合', home: 'A校', away: 'B校', status: '見どころ' },
    { id: '2', no: '第2試合', home: 'C校', away: 'D校', status: '見どころ' }
  ]);
  const j = run({ '2026-08-05': html });
  eq('2試合とも取れる', brief(j), ['1/A校/B校//見どころ', '2/C校/D校//見どころ']);
  eq('件数も2', j.counts.games, 2);
}

console.log('\n[2] 試合中／試合直後で入れ子が増えても、その試合が落ちない');
{
  const html = page('1回戦', [
    { id: '1', no: '第1試合', home: 'A校', away: 'B校', hs: 3, as: 1, status: '試合終了', live: true },
    { id: '2', no: '第2試合', home: 'C校', away: 'D校', status: '見どころ' }
  ]);
  const j = run({ '2026-08-05': html });
  eq('2試合とも残る', brief(j), ['1/A校/B校/A校/試合終了', '2/C校/D校//見どころ']);
  eq('スコアが取れている', [j.games[0].homeScore, j.games[0].awayScore], [3, 1]);
  eq('勝敗も1件', j.counts.decided, 1);
}

console.log('\n[3] 試合直後にページから消えても、前回ぶんが残る（今回の事故）');
{
  const before = run({
    '2026-08-05': page('1回戦', [
      { id: '1', no: '第1試合', home: 'A校', away: 'B校', hs: 3, as: 1, status: '試合終了' },
      { id: '2', no: '第2試合', home: 'C校', away: 'D校', status: '見どころ' }
    ])
  });
  // 2試合目が終わった直後、ページから丸ごと消えた
  const gone = page('1回戦', [
    { id: '1', no: '第1試合', home: 'A校', away: 'B校', hs: 3, as: 1, status: '試合終了' }
  ]);
  const after = run({ '2026-08-05': gone }, before);
  eq('消えた試合も残っている', brief(after), ['1/A校/B校/A校/試合終了', '2/C校/D校//見どころ']);
  eq('件数は減らない', after.counts.games, 2);
  const err = runErr({ '2026-08-05': gone }, before);
  eq('消えていたことを警告する', /消えていた試合が 1 件/.test(err), true);
}

console.log('\n[4] 校名が読めない回があっても、前回の校名を消さない');
{
  const before = run({
    '2026-08-05': page('1回戦', [
      { id: '1', no: '第1試合', home: 'A校', away: 'B校', status: '見どころ' },
      { id: '2', no: '第2試合', home: 'C校', away: 'D校', status: '見どころ' }
    ])
  });
  // 2試合目の校名まわりのタグだけが崩れた（IDとステータスは読める）
  const broken = page('1回戦', [
    { id: '1', no: '第1試合', home: 'A校', away: 'B校', hs: 5, as: 2, status: '試合終了' },
    { id: '2', no: '第2試合', home: 'C校', away: 'D校', status: '見どころ' }
  ]).replace(/<div class="bb-score__home"><p>C校<\/p><\/div>/, '<div class="bb-score__home"></div>')
    .replace(/<div class="bb-score__away"><p>D校<\/p><\/div>/, '<div class="bb-score__away"></div>');
  const after = run({ '2026-08-05': broken }, before);
  eq('校名は前回ぶんが残る', brief(after), ['1/A校/B校/A校/試合終了', '2/C校/D校//見どころ']);
}

console.log('\n[5] 未定は空として扱う（対戦相手が決まったら上書きされる）');
{
  const before = run({
    '2026-08-05': page('2回戦', [{ id: '9', no: '第1試合', home: 'A校', away: '未定', status: '試合前' }])
  });
  eq('未定は null', [before.games[0].home, before.games[0].away], ['A校', null]);
  const after = run({
    '2026-08-05': page('2回戦', [{ id: '9', no: '第1試合', home: 'A校', away: 'Z校', status: '見どころ' }])
  }, before);
  eq('決まったら入る', [after.games[0].home, after.games[0].away], ['A校', 'Z校']);
}

console.log(`\n===== ${ok} 件合格 / ${ng} 件不合格 =====`);
process.exit(ng ? 1 : 0);
