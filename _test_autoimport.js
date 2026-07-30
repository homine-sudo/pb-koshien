/* 自動取り込み（games.json → 対戦表・勝ち数）の検証 */
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const src = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const noop=()=>{}; const stub=()=>({innerHTML:'',textContent:'',value:'',style:{setProperty:noop},
  classList:{add:noop,remove:noop,toggle:noop,contains:()=>false},querySelector:()=>null,
  querySelectorAll:()=>[],appendChild:noop,remove:noop,dataset:{},
  getBoundingClientRect:()=>({top:0,left:0,right:0,bottom:0,width:0,height:0}),offsetParent:null});
global.document={getElementById:()=>stub(),querySelector:()=>null,querySelectorAll:()=>[],
  createElement:()=>stub(),body:stub(),addEventListener:noop,hidden:false};
global.window={location:{search:'',hash:'',pathname:'/',origin:'http://x',protocol:'http:'},scrollTo:noop,addEventListener:noop};
global.location=global.window.location;
global.localStorage={_d:{},getItem(k){return this._d[k]??null},setItem(k,v){this._d[k]=String(v)},removeItem(k){delete this._d[k]}};
global.sessionStorage=global.localStorage; global.navigator={clipboard:null};
global.requestAnimationFrame=f=>setTimeout(()=>f(0),0); global.performance={now:()=>Date.now()};
global.alert=noop; global.confirm=()=>true; global.prompt=()=>null;
global.URLSearchParams=URLSearchParams; global.TextEncoder=TextEncoder; global.TextDecoder=TextDecoder;
global.btoa=s=>Buffer.from(s,'binary').toString('base64');
global.atob=s=>Buffer.from(s,'base64').toString('binary');
const body = src.replace(/\(function init\(\)\{[\s\S]*?\}\)\(\);\s*$/,'');
const A = new Function(`${body}
  return {TEAMS,N,TOTAL_GAMES,ROUNDS,mapGames,buildFromGames,findTeam,blankState,checkIntegrity,
          bracketDerived,pickCode,passHash,setST:s=>{ST=s;},getST:()=>ST};`)();

let pass=0, fail=0;
const ok=(n,c,i)=>{ (c?pass++:fail++); console.log((c?'  OK   ':'  FAIL ')+n+(c?'':'  '+(i||''))); };
const eq=(n,g,w)=>ok(n, JSON.stringify(g)===JSON.stringify(w), `got=${JSON.stringify(g)} want=${JSON.stringify(w)}`);

A.setST(A.blankState());

console.log('\n[1] 実データ（今の games.json）の取り込み');
const d = JSON.parse(fs.readFileSync(__dirname + '/data/games.json','utf8'));
eq('取得した試合数', d.games.length, 48);
eq('ラウンド構成', d.byRound.map(r=>r.n), [17,16,8,4,2,1]);
eq('アプリのラウンド構成と一致', A.ROUNDS.map(r=>r.n), d.byRound.map(r=>r.n));
eq('ラウンド名も一致', A.ROUNDS.map(r=>r.l), d.byRound.map(r=>r.round));
const m0 = A.mapGames(d.games);
eq('照合できない校名（抽選前なので0のはず）', m0.unmatched, []);
const b0 = A.buildFromGames(m0.list);
eq('作られた対戦表の数', b0.matches.length, 48);
eq('抽選前なので勝ち数は全部0', b0.wins.reduce((a,b)=>a+b,0), 0);

console.log('\n[2] 抽選＋結果が入った状態を作って取り込む');
// 実データの器に、こちらで組み合わせと勝敗を流し込んで模擬する
const T = A.TEAMS.map(t=>t.name);
const sim = JSON.parse(JSON.stringify(d.games));
let pool = T.slice();
const rnd = (()=>{ let s=12345; return ()=>{ s=(s*1103515245+12345)&0x7fffffff; return s/0x7fffffff; }; })();
for(let i=pool.length-1;i>0;i--){ const j=(rnd()*(i+1))|0; [pool[i],pool[j]]=[pool[j],pool[i]]; }
const byRound = {}; sim.forEach(g=>{ (byRound[g.round] ||= []).push(g); });
Object.values(byRound).forEach(a=>a.sort((x,y)=>Number((x.no.match(/\d+/)||[0])[0])-Number((y.no.match(/\d+/)||[0])[0])));
// 1回戦：先頭34校、15校シード
let next=[];
byRound['1回戦'].forEach((g,k)=>{
  g.home=pool[k*2]; g.away=pool[k*2+1];
  const w = rnd()<0.5 ? g.home : g.away;
  g.homeScore = w===g.home?5:2; g.awayScore = w===g.home?2:5; g.winner=w; next.push(w);
});
let cur = next.concat(pool.slice(34));
for(const r of ['2回戦','3回戦','準々決勝','準決勝','決勝']){
  const nx=[];
  byRound[r].forEach((g,k)=>{
    g.home=cur[k*2]; g.away=cur[k*2+1];
    const w = rnd()<0.5 ? g.home : g.away;
    g.homeScore = w===g.home?3:1; g.awayScore = w===g.home?1:3; g.winner=w; nx.push(w);
  });
  cur=nx;
}
const m1 = A.mapGames(sim);
eq('全49校の名前が照合できる', m1.unmatched, []);
const b1 = A.buildFromGames(m1.list);
eq('勝ち数の合計＝48', b1.wins.reduce((a,b)=>a+b,0), 48);
eq('敗退＝48校', b1.out.filter(Boolean).length, 48);
eq('勝ち残り＝1校', b1.out.filter(x=>!x).length, 1);
const champIdx = b1.out.findIndex(x=>!x);
eq('優勝校がYahoo側の決勝勝者と一致', A.TEAMS[champIdx].name, byRound['決勝'][0].winner);
ok('優勝の勝数は5か6', [5,6].includes(b1.wins[champIdx]), '実測'+b1.wins[champIdx]);
// 整合性チェックが通る
const st = A.getST(); st.matches=b1.matches; st.wins=b1.wins; st.out=b1.out;
eq('整合性チェック：問題0件', A.checkIntegrity().problems.length, 0);
// 何度取り込んでも同じ（冪等）
const b2 = A.buildFromGames(A.mapGames(sim).list);
eq('2回取り込んでも同じ結果', JSON.stringify(b2), JSON.stringify(b1));

console.log('\n[3] 途中経過（半分だけ終わった状態）');
const half = JSON.parse(JSON.stringify(sim));
half.forEach((g,i)=>{ if(i>=20){ g.winner=null; g.homeScore=null; g.awayScore=null; } });
const b3 = A.buildFromGames(A.mapGames(half).list);
eq('勝ち数の合計＝20', b3.wins.reduce((a,b)=>a+b,0), 20);
eq('敗退＝20校', b3.out.filter(Boolean).length, 20);
const st3=A.getST(); st3.matches=b3.matches; st3.wins=b3.wins; st3.out=b3.out;
eq('途中でも整合性OK', A.checkIntegrity().problems.filter(p=>p.lv==='ng').length, 0);

console.log('\n[4] 知らない校名が来たら止まる（fail-closed）');
const bad = JSON.parse(JSON.stringify(sim));
bad[0].home = 'ぜんぜん知らない高校';
const m4 = A.mapGames(bad);
ok('照合できない名前を報告する', m4.unmatched.includes('ぜんぜん知らない高校'), JSON.stringify(m4.unmatched));

console.log('\n[5] 表記ゆれへの耐性');
[['市立福山','福山'],['霞ヶ浦','霞ケ浦'],['高岡商業','高岡商'],['関東一','関東第一'],
 ['福山市立福山','福山'],['八幡商業','八幡商']].forEach(([a,b])=>{
  const i=A.findTeam(a);
  ok(`${a} → ${b}`, i>=0 && A.TEAMS[i].name===b, i>=0?('→'+A.TEAMS[i].name):'照合不可');
});

console.log('\n[5b] 照合の安全性');
// 49校すべてが「自分自身」に正しく照合されること
const selfOk = A.TEAMS.every((t,i)=>A.findTeam(t.name)===i);
ok('49校すべて自分の名前で正しく照合', selfOk);
// 誰かの校名が他校に化けないこと（総当たり）
const cross=[];
A.TEAMS.forEach((t,i)=>{ const r=A.findTeam(t.name); if(r!==i) cross.push(`${t.name}→${r<0?'不可':A.TEAMS[r].name}`); });
eq('他校に化ける校', cross, []);
// 曖昧な入力は「決めつけない」
ok('「日大」はあいまいなので照合しない（札幌/佐野/長崎日大）', A.findTeam('日大')<0, A.findTeam('日大')>=0?A.TEAMS[A.findTeam('日大')].name:'');
ok('「商業」だけでは照合しない', A.findTeam('商業')<0);
ok('空文字は照合しない', A.findTeam('')<0);
ok('「未定」は照合しない', A.findTeam('未定')<0, A.findTeam('未定')>=0?A.TEAMS[A.findTeam('未定')].name:'');

console.log('\n[5c] 公開ゲート（提出がそろうまで見せない）');
{
  const B = new Function(`${body}
    return {blankState,submitState,isPublished,encodeState,decodeState,setST:s=>{ST=s;},getST:()=>ST,TEAMS};`)();
  const st = B.blankState();
  B.setST(st);
  ok('新規は「受付中」（公開されていない）', B.isPublished()===false, String(B.isPublished()));
  st.roster = ['A','B','C'];
  st.players = [{name:'A',picks:[]},{name:'B',picks:[]}];
  const s1 = B.submitState();
  eq('提出ずみ2人', s1.done, ['A','B']);
  eq('まだの人はC', s1.yet, ['C']);
  ok('全員そろっていない', s1.ready===false);
  st.players.push({name:'C',picks:[]});
  ok('3人そろったら公開できる', B.submitState().ready===true);
  st.players.push({name:'D',picks:[]});
  eq('名簿にない人を検出', B.submitState().extra, ['D']);
  // 共有リンクに公開フラグが乗るか
  st.players = [{name:'A',picks:A.TEAMS.map((_,i)=>i+1)}];
  st.published = false;
  const d1 = B.decodeState(B.encodeState(st));
  ok('非公開のまま往復する', d1.published===false, String(d1.published));
  eq('参加者名簿も往復する', d1.roster, ['A','B','C']);
  st.published = true;
  ok('公開ずみも往復する', B.decodeState(B.encodeState(st)).published===true);
}

console.log('\n[6] 予想の確認コード');
const p1=A.TEAMS.map((_,i)=>i+1), p2=p1.slice(); [p2[0],p2[1]]=[p2[1],p2[0]];
ok('同じ予想なら同じコード', A.pickCode(p1)===A.pickCode(p1.slice()));
ok('1か所でも違えばコードが変わる', A.pickCode(p1)!==A.pickCode(p2), A.pickCode(p1)+' vs '+A.pickCode(p2));
ok('コードは4桁', /^\d{4}$/.test(A.pickCode(p1)), A.pickCode(p1));
ok('パスコードのハッシュは一致する', A.passHash('1234')===A.passHash('1234'));
ok('違うパスコードは違うハッシュ', A.passHash('1234')!==A.passHash('1235'));

console.log(`\n===== ${pass} 件合格 / ${fail} 件不合格 =====`);
process.exit(fail?1:0);
