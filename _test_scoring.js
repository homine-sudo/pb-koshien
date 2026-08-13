/* ============================================================
   点数の入り方を「敵対的に」確かめる（node _test_scoring.js）

   得点ルールは1行：**その人がその校につけた点 × その校の勝利数**。
   だから勝利数さえ狂わなければ点は狂わない。逆に勝利数が1つでも
   ずれると、全員の点が静かにずれて誰も気づかない。

   ここではアプリの計算を信用せず、games.json から**独立に**数え直して
   突き合わせる。さらに、実際に起きた／起こりうる嫌な入力を投げる：

   ・雨天中止 → 別IDで組み直し（同じカードが2回出る）
   ・引き分け再試合（同じカードが2回、1回目は勝敗なし）
   ・組み直しでホームとアウェイが入れ替わる
   ・枠（48）からあふれる数の試合が来る
   ・勝者がその試合の出場校でない壊れたデータ
   ・同じ校の勝ちが二重に数えられないか
   ============================================================ */
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
  return {TEAMS,N,TOTAL_GAMES,ROUNDS,mapGames,buildFromGames,findTeam,blankState,ranking,
          checkIntegrity,bracketDerived,setST:s=>{ST=s;},getST:()=>ST,setME:v=>{ME=v;},
          setOverflow:v=>{IMPORT_OVERFLOW=v;}};`)();

let pass=0, fail=0;
const ok=(n,c,i)=>{ (c?pass++:fail++); console.log((c?'  OK   ':'  FAIL ')+n+(c?'':'  '+(i||''))); };
const eq=(n,g,w)=>ok(n, JSON.stringify(g)===JSON.stringify(w), `got=${JSON.stringify(g)} want=${JSON.stringify(w)}`);

const games = JSON.parse(fs.readFileSync(__dirname + '/data/games.json','utf8'));
const pool  = JSON.parse(fs.readFileSync(__dirname + '/data/pool.json','utf8'));

/* ---- アプリを一切通さない、独立した数え方 ---------------------------
   校名 → 番号すら別に持つ（findTeam のバグに巻き込まれないため）      */
const ALIAS = {'智辯和歌山':'智弁和歌山'};
const norm = s => { const x=String(s||'').replace(/[\s　]/g,'').replace(/[（(].*?[）)]/g,''); return ALIAS[x]||x; };
const NAMES = A.TEAMS.map(t=>norm(t.name));
const idxOf = n => NAMES.indexOf(norm(n));

function countIndependently(list){
  const wins = new Array(49).fill(0), out = new Array(49).fill(false), used = new Set();
  list.forEach(g=>{
    if(!g.winner || !g.home || !g.away) return;
    const h=idxOf(g.home), a=idxOf(g.away), w=idxOf(g.winner);
    if(h<0||a<0||w<0) return;
    if(w!==h && w!==a) return;
    const k=[h,a].sort((x,y)=>x-y).join('-');
    if(used.has(k)) return; used.add(k);
    wins[w]++; out[w===h?a:h]=true;
  });
  return {wins,out};
}
const ptOf = (picks,wins) => picks.reduce((s,v,i)=>s+(v||0)*wins[i],0);

console.log('\n[1] 本番データ：アプリの数え方と、独立した数え方が一致するか');
{
  const m = A.mapGames(games.games);
  eq('校名はすべて照合できる', m.unmatched, []);
  const b = A.buildFromGames(m.list);
  const ind = countIndependently(games.games);
  eq('勝ち数が1校ずつ完全一致', b.wins, ind.wins);
  eq('敗退も完全一致', b.out.map(Boolean), ind.out);
  const decided = games.games.filter(g=>g.winner).length;
  eq('勝ち数の合計＝決着した試合数', b.wins.reduce((x,y)=>x+y,0), decided);
  eq('敗退した校の数＝決着した試合数', b.out.filter(Boolean).length, decided);
  ok('1校の勝ち数が6を超えない', b.wins.every(w=>w<=6), '最大'+Math.max(...b.wins));

  // 全員の点も独立に出して突き合わせる
  const st = A.blankState();
  st.players = pool.players.map(p=>({name:p.name, picks:p.picks}));
  st.matches=b.matches; st.wins=b.wins; st.out=b.out;
  st.roster = pool.roster; st.published = true;
  A.setST(st); A.setME('');
  const sortPairs = o => Object.entries(o).sort((x,y)=> x[0]<y[0]?-1:1);
  const appPts = {}; A.ranking().forEach(r=> appPts[r.name]=r.pt);
  const indPts = {}; pool.players.forEach(p=> indPts[p.name]=ptOf(p.picks, ind.wins));
  eq('10人ぜんぶの点が一致', sortPairs(appPts), sortPairs(indPts));
  const names = Object.keys(indPts).sort((x,y)=>indPts[y]-indPts[x]);
  eq('1位の人も一致', A.ranking()[0].name, names[0]);
  eq('人数も一致', A.ranking().length, pool.players.length);
}

/* ---- 嫌な入力を作って投げる ---------------------------------------- */
const G = (date,no,round,home,away,hs,as,status) => ({
  id:String(Math.abs(date.length*31+no*7+home.length*13+away.length*17+(hs||0)*3+(as||0))) + no + home.length,
  date, no:`第${no}試合`, round, home, away, homeScore:hs, awayScore:as,
  winner: (hs!=null && as!=null && hs!==as) ? (hs>as?home:away) : null,
  status: status || (hs!=null?'試合終了':'見どころ')
});

console.log('\n[2] 雨天中止 → 別IDで組み直し（同じカードが2回出る）');
{
  const list = [
    G('2026-08-12',4,'2回戦','東海大甲府','健大高崎',null,null,'試合中止'),
    G('2026-08-13',1,'2回戦','健大高崎','東海大甲府',1,0),       // ホーム／アウェイも入れ替わっている
  ];
  const b = A.buildFromGames(A.mapGames(list).list);
  const ind = countIndependently(list);
  eq('健大高崎の勝ちは1回だけ', b.wins[idxOf('健大高崎')], 1);
  eq('東海大甲府は敗退', b.out[idxOf('東海大甲府')], true);
  eq('中止のほうは勝ちも敗退も生まない', b.wins.reduce((x,y)=>x+y,0), 1);
  eq('独立計算とも一致', b.wins, ind.wins);
}

console.log('\n[3] 引き分け再試合（同じカードが2回、1回目は勝敗なし）');
{
  const list = [
    G('2026-08-15',1,'3回戦','天理','高川学園',3,3),             // 引き分け（winner なし）
    G('2026-08-17',1,'3回戦','天理','高川学園',5,2),             // 再試合
  ];
  const b = A.buildFromGames(A.mapGames(list).list);
  eq('引き分けは勝ちを生まない＋再試合の1勝だけ入る', b.wins[idxOf('天理')], 1);
  eq('合計も1勝', b.wins.reduce((x,y)=>x+y,0), 1);
  eq('高川学園が敗退', b.out[idxOf('高川学園')], true);
}

console.log('\n[4] 枠（各回戦の試合数）からあふれても勝敗を落とさない');
{
  // 2回戦の枠は16。17試合来ても17勝ぶんが入らなければならない
  const teams = A.TEAMS.map(t=>t.name);
  const list = [];
  for(let i=0;i<17;i++) list.push(G('2026-08-13', (i%4)+1, '2回戦', teams[i*2], teams[i*2+1], 5, 1));
  const b = A.buildFromGames(A.mapGames(list).list);
  eq('17試合ぶんの勝ちが全部入る', b.wins.reduce((x,y)=>x+y,0), 17);
  eq('敗退も17校', b.out.filter(Boolean).length, 17);
  ok('枠は48のまま（表示側はあふれる）', b.matches.length===48, '実測'+b.matches.length);
}

console.log('\n[5] 二重計上を狙う');
{
  const teams = A.TEAMS.map(t=>t.name);
  // まったく同じ試合を3回入れる
  const dup = [G('2026-08-13',1,'2回戦',teams[0],teams[1],7,0),
               G('2026-08-13',2,'2回戦',teams[0],teams[1],7,0),
               G('2026-08-14',3,'2回戦',teams[1],teams[0],0,7)];
  const b = A.buildFromGames(A.mapGames(dup).list);
  eq('同じカードは何度出ても1勝', b.wins.reduce((x,y)=>x+y,0), 1);
  eq('勝った校の勝ちも1', b.wins[idxOf(teams[0])], 1);
}

console.log('\n[6] 壊れたデータ：勝者がその試合の出場校でない');
{
  const teams = A.TEAMS.map(t=>t.name);
  const bad = [G('2026-08-13',1,'2回戦',teams[0],teams[1],5,1)];
  bad[0].winner = teams[9];                              // 出ていない校が勝者になっている
  const b = A.buildFromGames(A.mapGames(bad).list);
  eq('関係ない校に勝ちを付けない', b.wins[idxOf(teams[9])], 0);
  eq('出場校にも勝手に付けない', b.wins.reduce((x,y)=>x+y,0), 0);
}

console.log('\n[7] 満了：全48試合が終わった状態');
{
  const teams = A.TEAMS.map(t=>t.name);
  const list = []; let alive = teams.slice(0,32);        // 32校で5回戦ぶん（31試合）＋端数
  let day = 5;
  const rounds = ['1回戦','2回戦','3回戦','準々決勝','準決勝'];
  rounds.forEach((r,ri)=>{
    const nx=[];
    for(let i=0;i<alive.length;i+=2){
      list.push(G('2026-08-'+String(day).padStart(2,'0'), (i/2)%4+1, r, alive[i], alive[i+1], 4, 1));
      nx.push(alive[i]);
    }
    alive=nx; day++;
  });
  const b = A.buildFromGames(A.mapGames(list).list);
  const ind = countIndependently(list);
  eq('勝ち数＝試合数', b.wins.reduce((x,y)=>x+y,0), list.length);
  eq('敗退＝試合数', b.out.filter(Boolean).length, list.length);
  eq('独立計算と一致', b.wins, ind.wins);
  eq('勝ち残りは1校', b.out.slice(0,32).filter(x=>!x).length, 1);
  ok('優勝校は5勝', b.wins[idxOf(alive[0])]===5, '実測'+b.wins[idxOf(alive[0])]);
}

console.log('\n[8] 順位と同点の扱い');
{
  const st = A.blankState();
  st.published = true;
  st.roster = ['あ','い','う'];
  const mk = n => { const p=new Array(49).fill(0); p[0]=n; return p; };
  st.players = [{name:'あ',picks:mk(10)},{name:'い',picks:mk(10)},{name:'う',picks:mk(3)}];
  st.wins = new Array(49).fill(0); st.wins[0]=2; st.out=new Array(49).fill(false);
  A.setST(st);
  const r = A.ranking();
  eq('点は 配点×勝利数', r.map(x=>x.pt), [20,20,6]);
  eq('同点は同じ順位', r.map(x=>x.rank), [1,1,3]);
  eq('3位が飛ぶ（2位はいない）', r.filter(x=>x.rank===2).length, 0);
}

console.log('\n[9] 勝ち数が変わると点も必ず動く（取りこぼしが静かに起きないか）');
{
  const m = A.mapGames(games.games);
  const b = A.buildFromGames(m.list);
  const decidedGames = games.games.filter(g=>g.winner);
  const dropped = decidedGames[decidedGames.length-1];
  const cut = decidedGames.slice(0,-1).concat(games.games.filter(g=>!g.winner));
  const b2 = A.buildFromGames(A.mapGames(cut).list);
  const wi = idxOf(dropped.winner);
  ok('1試合落とすと合計勝ち数がちょうど1減る',
     b.wins.reduce((x,y)=>x+y,0) - b2.wins.reduce((x,y)=>x+y,0) === 1);
  eq('減るのは落とした試合の勝者の勝ちだけ', b.wins[wi]-b2.wins[wi], 1);
  // 取りこぼしは「全員の点が、その校につけた点ちょうどぶん減る」形で必ず現れる
  const diffs = pool.players.map(p=> ptOf(p.picks,b.wins) - ptOf(p.picks,b2.wins));
  const want  = pool.players.map(p=> p.picks[wi]||0);
  eq('全員の点が、その校の配点ぶんだけ減る', diffs, want);
  ok('その校に点を入れている人が居る＝黙って消えない', want.some(v=>v>0), '配点'+JSON.stringify(want));
}

console.log('\n[10] 危険なボタン：対戦表に載りきらないとき「対戦表に合わせる」を出さない');
{
  // 順延で2回戦が17試合になった状態＝枠(16)に載りきらない
  const teams = A.TEAMS.map(t=>t.name);
  const list = [];
  for(let i=0;i<17;i++) list.push(G('2026-08-13',(i%4)+1,'2回戦',teams[i*2],teams[i*2+1],5,1));
  const b = A.buildFromGames(A.mapGames(list).list);
  const st = A.blankState(); st.matches=b.matches; st.wins=b.wins; st.out=b.out;
  A.setST(st); A.setOverflow(b.overflow);          // 取り込みであふれた状態を再現
  const chk = A.checkIntegrity();
  eq('あふれた数を数えている', b.overflow, 1);
  eq('集計の勝ち数は17のまま', b.wins.reduce((x,y)=>x+y,0), 17);
  eq('対戦表から数えると16（枠が足りない）', A.bracketDerived().decided, 16);
  ok('修正ボタンを出さない（押すと1勝消えるため）',
     chk.problems.every(p=>!p.fix), JSON.stringify(chk.problems.map(p=>p.t)));
  ok('代わりに注意として知らせる',
     chk.problems.some(p=>/載りきらない/.test(p.t)), JSON.stringify(chk.problems.map(p=>p.t)));
  ok('致命(ng)扱いにはしない（点は正しいので）',
     chk.problems.every(p=>p.lv!=='ng'), JSON.stringify(chk.problems.map(p=>p.lv)));
}

console.log('\n[11] 手入力のズレは、順延と取り違えずに修正ボタンを出す');
{
  const teams = A.TEAMS.map(t=>t.name);
  const list = [];
  for(let i=0;i<8;i++) list.push(G('2026-08-13',(i%4)+1,'2回戦',teams[i*2],teams[i*2+1],5,1));
  const b = A.buildFromGames(A.mapGames(list).list);
  const st = A.blankState(); st.matches=b.matches; st.wins=b.wins.slice(); st.out=b.out.slice();
  st.wins[A.TEAMS.findIndex(t=>t.name===teams[0])] = 0;   // 集計だけ人為的にずらす
  A.setST(st); A.setOverflow(0);                          // あふれてはいない
  const chk = A.checkIntegrity();
  ok('食い違いを検出する', chk.problems.some(p=>/食い違/.test(p.t)));
  ok('このときは修正ボタンを出す', chk.problems.some(p=>p.fix===true));
}

console.log(`\n===== ${pass} 件合格 / ${fail} 件不合格 =====`);
process.exit(fail?1:0);
