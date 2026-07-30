/* 提出された配分を、アプリ本体と同じパーサーで検証する */
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const src = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const noop = () => {};
const stubEl = () => ({innerHTML:'',textContent:'',value:'',style:{setProperty:noop},
  classList:{add:noop,remove:noop,toggle:noop,contains:()=>false},querySelector:()=>null,
  querySelectorAll:()=>[],appendChild:noop,remove:noop,dataset:{},
  getBoundingClientRect:()=>({top:0,left:0,right:0,bottom:0,width:0,height:0}),offsetParent:null});
global.document={getElementById:()=>stubEl(),querySelector:()=>null,querySelectorAll:()=>[],
  createElement:()=>stubEl(),body:stubEl(),addEventListener:noop,hidden:false};
global.window={location:{search:'',hash:'',pathname:'/',origin:'http://x',protocol:'http:'},scrollTo:noop,addEventListener:noop};
global.location=global.window.location;
global.localStorage={_d:{},getItem(k){return this._d[k]??null},setItem(k,v){this._d[k]=String(v)},removeItem(k){delete this._d[k]}};
global.sessionStorage=global.localStorage; global.navigator={clipboard:null};
global.requestAnimationFrame=f=>setTimeout(()=>f(0),0); global.performance={now:()=>Date.now()};
global.alert=noop; global.confirm=()=>true; global.URLSearchParams=URLSearchParams;
global.TextEncoder=TextEncoder; global.TextDecoder=TextDecoder;
global.btoa=s=>Buffer.from(s,'binary').toString('base64');
global.atob=s=>Buffer.from(s,'base64').toString('binary');
const body = src.replace(/\(function init\(\)\{[\s\S]*?\}\)\(\);\s*$/,'');
const A = new Function(`${body}\nreturn {parsePicks, TEAMS, N, findTeam};`)();

const text = fs.readFileSync(process.argv[2], 'utf8');
const name = process.argv[3] || '(名前なし)';
const r = A.parsePicks(text);

console.log(`\n===== ${name} さんの配分 =====`);
console.log(`読み取れた校 : ${r.hit} / ${A.N}`);
console.log(`合計         : ${r.sum}（正しくは 1225）`);
console.log(`エラー       : ${r.errs.length}件`);
r.errs.forEach(e => console.log('   🚨 ' + e));
if (r.missTeam.length) console.log('   🚨 点数が入っていない校: ' + r.missTeam.join('・'));
if (r.missVal.length)  console.log('   🚨 使われていない点数: ' + r.missVal.join(','));

const ok = r.hit === A.N && r.errs.length === 0 && !r.missTeam.length && !r.missVal.length && r.sum === 1225;
console.log(`\n判定: ${ok ? '✅ OK（そのまま登録できます）' : '❌ NG（本人に確認が必要）'}`);

if (ok) {
  const top = r.picks.map((v,i)=>({v,i})).sort((a,b)=>b.v-a.v);
  console.log('\n高く買った順 上位10校:');
  top.slice(0,10).forEach(x=>console.log(`  ${String(x.v).padStart(2)}点  ${A.TEAMS[x.i].name}（${A.TEAMS[x.i].pref}）`));
  console.log('\n低く見た順 下位5校:');
  top.slice(-5).reverse().forEach(x=>console.log(`  ${String(x.v).padStart(2)}点  ${A.TEAMS[x.i].name}（${A.TEAMS[x.i].pref}）`));
  // 表記ゆれで名寄せされたもの
  const lines = text.replace(/\r/g,'').split('\n').filter(l=>/[:：]/.test(l));
  const renamed = [];
  lines.forEach(l=>{
    const z=l.replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).replace(/[：]/g,':');
    const m=z.match(/^\s*(\d{1,2})?\s*[.．、]?\s*(.*?):\s*(\d{1,3})\s*$/);
    if(!m) return;
    const label=m[2].replace(/[（(].*?[）)]/g,'').replace(/[\s　]/g,'');
    const idx=A.findTeam(m[2]);
    if(idx>=0 && label!==A.TEAMS[idx].name) renamed.push(`${label} → ${A.TEAMS[idx].name}`);
  });
  if(renamed.length) console.log('\n表記ゆれを自動で直したもの:\n  ' + renamed.join('\n  '));
}
