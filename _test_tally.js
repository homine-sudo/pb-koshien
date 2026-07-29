/* 集計ロジックの検証（node で実行・アプリ本体から関数を抜き出して回す） */
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const src = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// ブラウザAPIの最小スタブ
const noop = () => {};
const stubEl = () => ({
  innerHTML:'', textContent:'', value:'', style:{setProperty:noop}, classList:{add:noop,remove:noop,toggle:noop,contains:()=>false},
  querySelector:()=>null, querySelectorAll:()=>[], appendChild:noop, remove:noop, dataset:{},
  getBoundingClientRect:()=>({top:0,left:0,right:0,bottom:0,width:0,height:0}), offsetParent:null, focus:noop, blur:noop
});
global.document = {
  getElementById:()=>stubEl(), querySelector:()=>null, querySelectorAll:()=>[],
  createElement:()=>stubEl(), body:stubEl(), addEventListener:noop, hidden:false
};
global.window = {location:{search:'',hash:'',pathname:'/',origin:'http://x',protocol:'http:'}, scrollTo:noop, addEventListener:noop};
global.location = global.window.location;
global.localStorage = {_d:{}, getItem(k){return this._d[k]??null}, setItem(k,v){this._d[k]=String(v)}, removeItem(k){delete this._d[k]}};
global.sessionStorage = global.localStorage;
global.navigator = {clipboard:null};
global.requestAnimationFrame = f=>setTimeout(()=>f(0),0);
global.performance = {now:()=>Date.now()};
global.alert = noop; global.confirm = ()=>true;
global.URLSearchParams = URLSearchParams;
global.TextEncoder = TextEncoder; global.TextDecoder = TextDecoder;
global.btoa = s=>Buffer.from(s,'binary').toString('base64');
global.atob = s=>Buffer.from(s,'base64').toString('binary');

// 起動時の即時実行(init)を外して読み込む
const body = src.replace(/\(function init\(\)\{[\s\S]*?\}\)\(\);\s*$/, '');
const ctx = {};
new Function('with(this){' + body + '\n;Object.assign(ctx0,{TEAMS,N,TOTAL_GAMES,ROUNDS,initMatches,blankState,ranking,scoreOf,totalGames,aliveCount,bracketDerived,checkIntegrity,pickWinner,setST,getST,encodeState,decodeState,parsePicks});}')
  .call({ctx0:ctx, setST:s=>{}, getST:()=>null});

// ST を触るために、生成されたスコープを再構築する（ST は let なので関数経由で操作）
const scope = new Function(`
  ${body}
  return {
    TEAMS, N, TOTAL_GAMES, ROUNDS, initMatches, blankState, ranking, scoreOf,
    totalGames, aliveCount, bracketDerived, checkIntegrity, recalcFromBracket,
    encodeState, decodeState, parsePicks,
    setST: s => { ST = s; }, getST: () => ST,
    _pickWinner: (mi,side) => pickWinner(mi,side)
  };
`)();

const A = scope;
let pass=0, fail=0;
const eq=(name,got,want)=>{ const ok=JSON.stringify(got)===JSON.stringify(want); (ok?pass++:fail++); console.log((ok?'  OK   ':'  FAIL ')+name+(ok?'':`  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)); };
const ok=(name,cond,info)=>{ (cond?pass++:fail++); console.log((cond?'  OK   ':'  FAIL ')+name+(cond?'':'  '+(info||''))); };

/* ---------- 1. トーナメント構造 ---------- */
console.log('\n[1] トーナメントの形');
eq('ラウンド構成', A.ROUNDS.map(r=>r.n), [17,16,8,4,2,1]);
eq('全試合数', A.ROUNDS.reduce((s,r)=>s+r.n,0), A.TOTAL_GAMES);
eq('出場校数', A.TEAMS.length, 49);
ok('試合数=校数-1（1試合で1校が消える）', A.TOTAL_GAMES === A.TEAMS.length-1);
eq('initMatchesの長さ', A.initMatches().length, 48);

/* ---------- 2. 勝ち数の理論値 ---------- */
console.log('\n[2] 優勝・準優勝の勝ち数');
// 1回戦から出る校は6試合、シード校は5試合
const roundsFromR1 = A.ROUNDS.length;            // 6
const roundsSeed   = A.ROUNDS.length - 1;        // 5
eq('1回戦から出た校の最大試合数', roundsFromR1, 6);
eq('シード校の最大試合数', roundsSeed, 5);
console.log('       → 優勝 6勝(1回戦から) / 5勝(シード)、準優勝 5勝 / 4勝');

/* ---------- 3. 48試合を実際に走らせる ---------- */
console.log('\n[3] 48試合フル進行の不変条件');
function buildFullTournament(seed){
  let s = seed;
  const rnd = () => { s = (s*1103515245+12345) & 0x7fffffff; return s/0x7fffffff; };
  const st = A.blankState();
  st.players = [{name:'P1',picks:A.TEAMS.map((_,i)=>i+1)}];
  st.matches = A.initMatches();
  let alive = A.TEAMS.map((_,i)=>i);
  // 1回戦：先頭34校が対戦、15校シード
  const order = alive.slice(); for(let i=order.length-1;i>0;i--){const j=(rnd()*(i+1))|0;[order[i],order[j]]=[order[j],order[i]];}
  let mi=0; const next=[];
  for(let k=0;k<17;k++){ st.matches[mi].a=order[k*2]; st.matches[mi].b=order[k*2+1]; mi++; }
  const seeds = order.slice(34);
  // 以降のラウンドは勝者から順に組む（実際の運用と同じく人が入れる想定）
  return {st, order, seeds, rnd};
}
const {st, order, seeds, rnd} = buildFullTournament(2026);
A.setST(st);
// 1回戦を消化
let winners=[];
for(let k=0;k<17;k++){ const m=st.matches[k]; const w=(rnd()<0.5)?m.a:m.b; A._pickWinner(k, w===m.a?'a':'b'); winners.push(w); }
let pool = winners.concat(seeds);                 // 32校
// 実際の抽選ではシード校が山に散らばるので、混ぜてから組む
for(let i=pool.length-1;i>0;i--){ const j=(rnd()*(i+1))|0; [pool[i],pool[j]]=[pool[j],pool[i]]; }
ok('1回戦後に残るのは32校', pool.length===32, 'pool='+pool.length);
// 2回戦以降
let mi=17;
[16,8,4,2,1].forEach(n=>{
  const nxt=[];
  for(let k=0;k<n;k++){
    const a=pool[k*2], b=pool[k*2+1];
    st.matches[mi].a=a; st.matches[mi].b=b;
    const w=(rnd()<0.5)?a:b;
    A._pickWinner(mi, w===a?'a':'b');
    nxt.push(w); mi++;
  }
  pool=nxt;
});
const champ = pool[0];
const S = A.getST();
const sumWins = S.wins.reduce((a,b)=>a+b,0);
const outCount = S.out.filter(Boolean).length;
eq('消化した試合数', sumWins, 48);
eq('敗退した校', outCount, 48);
eq('勝ち残り', A.aliveCount(), 1);
ok('優勝校が勝ち残り1校と一致', S.out.findIndex(o=>!o)===champ);
const champWins = S.wins[champ];
ok('優勝校の勝数は5か6', champWins===5||champWins===6, '実測'+champWins+'勝');
const fromR1 = order.slice(0,34).includes(champ);
eq('優勝校の勝数（シード可否と整合）', champWins, fromR1?6:5);
// 準優勝
const finalM = st.matches[47];
const runner = (finalM.w===finalM.a)?finalM.b:finalM.a;
const runnerWins = S.wins[runner];
ok('準優勝の勝数は4か5', runnerWins===4||runnerWins===5, '実測'+runnerWins+'勝');
eq('準優勝の勝数（シード可否と整合）', runnerWins, order.slice(0,34).includes(runner)?5:4);
console.log(`       → 実測: 優勝 ${A.TEAMS[champ].name} ${champWins}勝 / 準優勝 ${A.TEAMS[runner].name} ${runnerWins}勝`);
// 誰も6勝を超えない
ok('6勝を超える校がない', S.wins.every(w=>w<=6), '最大'+Math.max(...S.wins));
// 各校の勝数＝対戦表で勝った回数
const d = A.bracketDerived();
eq('対戦表から数え直した勝数と一致', d.wins, S.wins);
eq('対戦表から数え直した敗退と一致', d.out, S.out);
// 整合性チェックが「問題なし」を返す
eq('整合性チェック：問題0件', A.checkIntegrity().problems.length, 0);

/* ---------- 4. 得点計算 ---------- */
console.log('\n[4] 得点の計算');
const S2 = A.getST();
S2.players = [
  {name:'全部同じ', picks:A.TEAMS.map((_,i)=>i+1)},
  {name:'逆順',     picks:A.TEAMS.map((_,i)=>49-i)}
];
const manual = S2.players.map(p=>p.picks.reduce((s,v,i)=>s+v*S2.wins[i],0));
eq('scoreOf が 予想×勝利数の総和と一致', S2.players.map(p=>A.scoreOf(p)), manual);
const rk=A.ranking();
ok('順位は得点の降順', rk.every((r,i)=> i===0 || rk[i-1].pt>=r.pt));
eq('同点は同順位', (()=>{ S2.players.push({name:'コピー',picks:S2.players[0].picks.slice()});
  const r=A.ranking(); const a=r.find(x=>x.name==='全部同じ'), b=r.find(x=>x.name==='コピー');
  return a.rank===b.rank; })(), true);
S2.players.pop();

/* ---------- 5. 手入力との食い違いを検出できるか ---------- */
console.log('\n[5] 手入力でズラしたときに検出できるか');
const S3=A.getST();
S3.wins[0] += 1;                                   // 手で1勝足した想定
const chk = A.checkIntegrity();
ok('食い違いを検出する', chk.problems.length>0, '検出0件');
ok('「対戦表に合わせる」ボタンが出る条件を満たす', chk.problems.some(p=>p.fix));
ok('合計超過も検出', chk.problems.some(p=>/超えています|合いません|食い違/.test(p.t)));
S3.wins[0] -= 1;
eq('戻したら問題0件', A.checkIntegrity().problems.length, 0);

/* ---------- 6. 予想の取り込み ---------- */
console.log('\n[6] 予想の取り込み検証');
const mk = v => A.TEAMS.map((t,i)=>`${String(i+1).padStart(2,'0')}. ${t.name}：${v[i]}`).join('\n');
const base = A.TEAMS.map((_,i)=>i+1);
eq('正常な49行を受理', (()=>{const r=A.parsePicks(mk(base)); return [r.hit,r.errs.length,r.sum];})(), [49,0,1225]);
eq('合計は必ず1225', base.reduce((a,b)=>a+b,0), 1225);
ok('点数重複を弾く', (()=>{const v=base.slice(); v[5]=v[9]; return A.parsePicks(mk(v)).errs.length>0;})());
ok('範囲外を弾く', (()=>{const v=base.slice(); v[0]=50; return A.parsePicks(mk(v)).errs.length>0;})());
ok('抜けを検出', (()=>{const l=mk(base).split('\n'); l.splice(3,1); const r=A.parsePicks(l.join('\n')); return r.missTeam.length===1&&r.missVal.length===1;})());

/* ---------- 7. 共有リンクの往復 ---------- */
console.log('\n[7] 共有リンク');
const S4=A.getST();
const dec=A.decodeState(A.encodeState(S4));
eq('勝ち数が往復で一致', dec.wins, S4.wins);
eq('敗退が往復で一致', dec.out, S4.out);
eq('対戦表が往復で一致', dec.matches, S4.matches);
eq('予想が往復で一致', dec.players, S4.players);

console.log(`\n===== ${pass} 件合格 / ${fail} 件不合格 =====`);
process.exit(fail?1:0);
