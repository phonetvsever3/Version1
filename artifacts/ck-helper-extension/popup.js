const $ = id => document.getElementById(id);

// ─── Tab switching ──────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $('tab-' + btn.dataset.tab).classList.add('active');
  });
});

function copyText(btn, text) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✓ Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1500);
  });
}

function showResult(html, cls = 'result-info') {
  const box = $('actionResult');
  box.style.display = 'block';
  box.className = 'result-box ' + cls;
  box.innerHTML = html;
}

async function getCKTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) throw new Error('No active tab');
  const url = tab.url || '';
  if (!url.includes('cklottery') && !url.includes('ckygjf6r')) {
    throw new Error('Open cklottery.club first, log in, then try again.');
  }
  return tab;
}

// ─── Inject + call CKLottery API from inside the tab (no CORS, no Cloudflare) ─
// The func runs with the page's origin (cklottery.club) so CORS passes.
// Full MD5 + ckSign is embedded so the injected function is self-contained.
async function callCKApi(tabId, endpoint, extraBody = {}) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (ep, extra) => {
      // ── MD5 (RFC 1321) ──────────────────────────────────────────────────
      function md5(str) {
        function safeAdd(x, y) { const l=(x&0xffff)+(y&0xffff); return ((x>>16)+(y>>16)+(l>>16)<<16)|(l&0xffff); }
        function rol(n,c) { return (n<<c)|(n>>>(32-c)); }
        function cmn(q,a,b,x,s,t) { return safeAdd(rol(safeAdd(safeAdd(a,q),safeAdd(x,t)),s),b); }
        function ff(a,b,c,d,x,s,t) { return cmn((b&c)|(~b&d),a,b,x,s,t); }
        function gg(a,b,c,d,x,s,t) { return cmn((b&d)|(c&~d),a,b,x,s,t); }
        function hh(a,b,c,d,x,s,t) { return cmn(b^c^d,a,b,x,s,t); }
        function ii(a,b,c,d,x,s,t) { return cmn(c^(b|~d),a,b,x,s,t); }
        const bytes = new TextEncoder().encode(str);
        const len8 = bytes.length;
        const M = [];
        for (let i=0;i<len8;i++) M[i>>2]|=bytes[i]<<((i%4)*8);
        M[len8>>2]|=0x80<<((len8%4)*8);
        M[(((len8+8)>>6)<<4)+14]=len8*8;
        let a=1732584193,b=-271733879,c=-1732584194,d=271733878;
        for (let i=0;i<M.length;i+=16) {
          const [oa,ob,oc,od]=[a,b,c,d];
          a=ff(a,b,c,d,M[i+0],7,-680876936);d=ff(d,a,b,c,M[i+1],12,-389564586);c=ff(c,d,a,b,M[i+2],17,606105819);b=ff(b,c,d,a,M[i+3],22,-1044525330);
          a=ff(a,b,c,d,M[i+4],7,-176418897);d=ff(d,a,b,c,M[i+5],12,1200080426);c=ff(c,d,a,b,M[i+6],17,-1473231341);b=ff(b,c,d,a,M[i+7],22,-45705983);
          a=ff(a,b,c,d,M[i+8],7,1770035416);d=ff(d,a,b,c,M[i+9],12,-1958414417);c=ff(c,d,a,b,M[i+10],17,-42063);b=ff(b,c,d,a,M[i+11],22,-1990404162);
          a=ff(a,b,c,d,M[i+12],7,1804603682);d=ff(d,a,b,c,M[i+13],12,-40341101);c=ff(c,d,a,b,M[i+14],17,-1502002290);b=ff(b,c,d,a,M[i+15],22,1236535329);
          a=gg(a,b,c,d,M[i+1],5,-165796510);d=gg(d,a,b,c,M[i+6],9,-1069501632);c=gg(c,d,a,b,M[i+11],14,643717713);b=gg(b,c,d,a,M[i+0],20,-373897302);
          a=gg(a,b,c,d,M[i+5],5,-701558691);d=gg(d,a,b,c,M[i+10],9,38016083);c=gg(c,d,a,b,M[i+15],14,-660478335);b=gg(b,c,d,a,M[i+4],20,-405537848);
          a=gg(a,b,c,d,M[i+9],5,568446438);d=gg(d,a,b,c,M[i+14],9,-1019803690);c=gg(c,d,a,b,M[i+3],14,-187363961);b=gg(b,c,d,a,M[i+8],20,1163531501);
          a=gg(a,b,c,d,M[i+13],5,-1444681467);d=gg(d,a,b,c,M[i+2],9,-51403784);c=gg(c,d,a,b,M[i+7],14,1735328473);b=gg(b,c,d,a,M[i+12],20,-1926607734);
          a=hh(a,b,c,d,M[i+5],4,-378558);d=hh(d,a,b,c,M[i+8],11,-2022574463);c=hh(c,d,a,b,M[i+11],16,1839030562);b=hh(b,c,d,a,M[i+14],23,-35309556);
          a=hh(a,b,c,d,M[i+1],4,-1530992060);d=hh(d,a,b,c,M[i+4],11,1272893353);c=hh(c,d,a,b,M[i+7],16,-155497632);b=hh(b,c,d,a,M[i+10],23,-1094730640);
          a=hh(a,b,c,d,M[i+13],4,681279174);d=hh(d,a,b,c,M[i+0],11,-358537222);c=hh(c,d,a,b,M[i+3],16,-722521979);b=hh(b,c,d,a,M[i+6],23,76029189);
          a=hh(a,b,c,d,M[i+9],4,-640364487);d=hh(d,a,b,c,M[i+12],11,-421815835);c=hh(c,d,a,b,M[i+15],16,530742520);b=hh(b,c,d,a,M[i+2],23,-995338651);
          a=ii(a,b,c,d,M[i+0],6,-198630844);d=ii(d,a,b,c,M[i+7],10,1126891415);c=ii(c,d,a,b,M[i+14],15,-1416354905);b=ii(b,c,d,a,M[i+5],21,-57434055);
          a=ii(a,b,c,d,M[i+12],6,1700485571);d=ii(d,a,b,c,M[i+3],10,-1894986606);c=ii(c,d,a,b,M[i+10],15,-1051523);b=ii(b,c,d,a,M[i+1],21,-2054922799);
          a=ii(a,b,c,d,M[i+8],6,1873313359);d=ii(d,a,b,c,M[i+15],10,-30611744);c=ii(c,d,a,b,M[i+6],15,-1560198380);b=ii(b,c,d,a,M[i+13],21,1309151649);
          a=ii(a,b,c,d,M[i+4],6,-145523070);d=ii(d,a,b,c,M[i+11],10,-1120210379);c=ii(c,d,a,b,M[i+2],15,718787259);b=ii(b,c,d,a,M[i+9],21,-343485551);
          a=safeAdd(a,oa);b=safeAdd(b,ob);c=safeAdd(c,oc);d=safeAdd(d,od);
        }
        let hex='';
        for(let i=0;i<4;i++){const w=[a,b,c,d][i];for(let j=0;j<=3;j++)hex+=('0'+((w>>(j*8))&0xff).toString(16)).slice(-2);}
        return hex;
      }

      // ── ckSign (matches CKLottery interceptor) ───────────────────────────
      function ckSign(body) {
        const EXCLUDE = ['signature','track','xosoBettingData'];
        const random = 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, c => {
          const r=(Math.random()*16)|0; return (c==='x'?r:(r&3)|8).toString(16);
        });
        const withExtras = { ...body, language: body.language ?? 0, random };
        const sorted = {};
        for (const k of Object.keys(withExtras).sort()) {
          const v = withExtras[k];
          if (v !== null && v !== '' && !EXCLUDE.includes(k)) sorted[k] = v;
        }
        const sig = md5(JSON.stringify(sorted)).toUpperCase().slice(0, 32);
        return { ...withExtras, signature: sig, timestamp: Math.floor(Date.now() / 1000) };
      }

      // ── Make the signed request ──────────────────────────────────────────
      const token = localStorage.getItem('token') || '';
      const tokenHeader = (localStorage.getItem('tokenHeader') || 'Bearer').trim();
      const signed = ckSign(extra);

      try {
        const res = await fetch(`https://ckygjf6r.com/api/webapi/${ep}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `${tokenHeader} ${token}`,
            'Origin': 'https://www.cklottery.club',
            'Referer': 'https://www.cklottery.club/',
          },
          body: JSON.stringify(signed),
        });
        const text = await res.text();
        try { return { ok: true, data: JSON.parse(text) }; }
        catch { return { ok: false, error: 'Non-JSON: ' + text.slice(0, 200) }; }
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    },
    args: [endpoint, extraBody],
  });
  return results?.[0]?.result ?? { ok: false, error: 'No result from injection' };
}

// ─── SPIN button ────────────────────────────────────────────────────────────
$('btnSpin').addEventListener('click', async () => {
  $('btnSpin').disabled = true;
  $('btnSpin').textContent = '⏳ Checking spins…';
  showResult('Checking available spins before calling SpinInvitedWheel…', 'result-info');
  try {
    const tab = await getCKTab();

    // Pre-check: get wheel info first so we know spin count
    const infoResult = await callCKApi(tab.id, 'GetInvitedWheelInfo', {});
    if (infoResult.ok && infoResult.data?.data != null) {
      const info = infoResult.data.data;
      const spins = info['invitedWheelAmountofcodeAmount'] ?? info['spinCount'] ?? info['drawCount'];
      if (spins != null && Number(spins) === 0) {
        showResult(
          '⚠️ <b>No free spins available (spins = 0).</b><br>' +
          'Use <b>Add 1 Spin</b> to get more, or invite friends.<br>' +
          '<pre class="result-pre">' + JSON.stringify(info, null, 2) + '</pre>',
          'result-err'
        );
        return;
      }
    }

    $('btnSpin').textContent = '⏳ Spinning…';
    const result = await callCKApi(tab.id, 'SpinInvitedWheel', {});
    if (!result.ok) {
      showResult('❌ Injection error: ' + result.error, 'result-err');
    } else {
      const d = result.data;
      const code = d.code ?? d.Code;
      const msg = d.msg || d.message || '';
      const msgCode = d.msgCode;
      const ok = code === 0 || code === 200 || code === '0';
      // msgCode 1019 = "No available draws" — give a friendly message
      const noDraws = msgCode === 1019 || (msg && msg.toLowerCase().includes('no available draw'));
      showResult(
        (ok
          ? '✅ Spin success!'
          : noDraws
            ? '⚠️ No available draws — you have no free spins left. Try <b>Add 1 Spin</b>.'
            : '⚠️ code=' + code) +
        ((!noDraws && msg) ? ' ' + msg : '') +
        '<pre class="result-pre">' + JSON.stringify(d, null, 2) + '</pre>',
        ok ? 'result-ok' : 'result-err'
      );
    }
  } catch (e) {
    showResult('❌ ' + e.message, 'result-err');
  } finally {
    $('btnSpin').disabled = false;
    $('btnSpin').textContent = '🎰 Spin Now (SpinInvitedWheel)';
  }
});

// ─── ADD SPIN button ─────────────────────────────────────────────────────────
$('btnAddSpin').addEventListener('click', async () => {
  $('btnAddSpin').disabled = true;
  $('btnAddSpin').textContent = '⏳ Scanning…';
  showResult('Scanning add-spin endpoints… (this may take a few seconds)', 'result-info');

  // Expanded list — covers more naming variants used by CKLottery forks
  const ADD_ENDPOINTS = [
    // InvitedWheel-specific (most likely)
    'AddInvitedWheelCount','AddInvitedWheelTimes','AddInvitedWheelNum',
    'GiveInvitedWheelSpin','GiveInvitedWheelCount','GiveInvitedWheelTimes',
    'InvitedWheelAdd','InvitedWheelAddCount','InvitedWheelAddTimes',
    'SendInvitedWheelSpin','GrantInvitedWheelSpin','RechargeInvitedWheelTimes',
    // Generic wheel
    'AddWheelTimes','AddWheelCount','AddWheelSpin','AddWheelNum',
    'GiveWheelSpin','GiveWheelTimes','GiveWheelCount',
    'RechargeWheelTimes','RechargeWheelCount',
    'SendWheelSpin','GrantWheelSpin','GrantWheelCount',
    // Spin / draw
    'AddSpinCount','AddSpinTimes','AddSpinNum','GiveSpinCount','GiveSpinTimes',
    'AddDrawCount','AddDrawTimes','AddDrawNum','GiveDrawCount',
    // TurnTable / LuckyDraw
    'AddTurnTableCount','AddTurnTableTimes','AddLuckyDrawTimes','AddLuckyDrawCount',
    'GiveTurnTableSpin','GiveLuckyDrawSpin',
    // Ticket / chance
    'AddChance','AddTicket','AddFreePlay','AddFreeChance','AddFreeSpin',
  ];

  // Only filter messages that mean the URL literally doesn't exist on the server.
  // Do NOT filter auth/permission errors — those prove the endpoint IS there.
  function isNotExist(msg) {
    const m = msg.toLowerCase();
    return (
      m.includes('url is not exist') ||
      m.includes('url not exist') ||
      m.includes('no route') ||
      m.includes('invalid url') ||
      m.includes('no such route') ||
      (m.includes('not exist') && !m.includes('draw') && !m.includes('spin') && !m.includes('permission') && !m.includes('auth'))
    );
  }

  try {
    const tab = await getCKTab();
    let successEp = null;
    const permissionDenied = [];
    const errors = [];

    for (const ep of ADD_ENDPOINTS) {
      const result = await callCKApi(tab.id, ep, { count: 1, times: 1, num: 1 });
      if (!result.ok) continue;
      const d = result.data;
      const msg = String(d.msg ?? d.message ?? '');
      const code = d.code ?? d.Code;
      const ok = code === 0 || code === 200 || code === '0';

      // Skip truly non-existent endpoints
      if (isNotExist(msg)) continue;

      if (ok) {
        successEp = { ep, d, msg };
        break;
      }

      // Endpoint EXISTS but returned an error — track it
      const ml = msg.toLowerCase();
      const isAuth = ml.includes('permission') || ml.includes('auth') ||
        ml.includes('privilege') || ml.includes('admin') || ml.includes('agent') ||
        ml.includes('forbidden') || ml.includes('unauthorized') || ml.includes('access');
      if (isAuth) {
        permissionDenied.push({ ep, msg });
      } else {
        errors.push({ ep, code, msg });
      }
    }

    if (successEp) {
      showResult(
        '✅ +1 Spin added via <b>' + successEp.ep + '</b>! ' + successEp.msg +
        '<pre class="result-pre">' + JSON.stringify(successEp.d, null, 2) + '</pre>',
        'result-ok'
      );
    } else if (permissionDenied.length > 0) {
      const list = permissionDenied.map(x => `<b>${x.ep}</b>: ${x.msg}`).join('<br>');
      showResult(
        '🔒 <b>' + permissionDenied.length + ' endpoint(s) found but require admin/agent token:</b><br>' + list +
        '<br><br><small>These endpoints exist on the server but your user token lacks the required privilege level.</small>',
        'result-err'
      );
    } else if (errors.length > 0) {
      const list = errors.map(x => `<b>${x.ep}</b> (code ${x.code}): ${x.msg}`).join('<br>');
      showResult(
        '⚠️ <b>' + errors.length + ' endpoint(s) found but returned errors:</b><br>' + list,
        'result-err'
      );
    } else {
      showResult(
        '❌ No add-spin endpoint found on this server.<br>' +
        '<small>All ' + ADD_ENDPOINTS.length + ' candidates returned "url not exist". ' +
        'This server may not expose an add-spin API for regular users.</small>',
        'result-err'
      );
    }
  } catch (e) {
    showResult('❌ ' + e.message, 'result-err');
  } finally {
    $('btnAddSpin').disabled = false;
    $('btnAddSpin').textContent = '➕ Add 1 Spin';
  }
});

// ─── GET WHEEL INFO ──────────────────────────────────────────────────────────
$('btnGetInfo').addEventListener('click', async () => {
  $('btnGetInfo').disabled = true;
  $('btnGetInfo').textContent = '⏳ Loading…';
  showResult('Calling GetInvitedWheelInfo…', 'result-info');
  try {
    const tab = await getCKTab();
    const result = await callCKApi(tab.id, 'GetInvitedWheelInfo', {});
    if (!result.ok) {
      showResult('❌ ' + result.error, 'result-err');
    } else {
      const raw = result.data;
      const d = raw?.data ?? raw;
      const spins = d['invitedWheelAmountofcodeAmount'];
      const accum = d['userInvitedWheelAmount'];
      const total = d['invitedWheelTotalPrizeAmount'];
      const summary = [
        spins != null ? `🎰 Free Spins: <b style="color:#facc15;font-size:14px">${spins}</b>` : '',
        accum != null ? `💰 My Amount: K${Number(accum).toLocaleString()}` : '',
        total != null ? `🏆 Total Prize: K${Number(total).toLocaleString()}` : '',
      ].filter(Boolean).join('<br>');
      const fields = Object.entries(d)
        .filter(([,v]) => typeof v !== 'object' || v === null)
        .map(([k,v]) => k + ': ' + JSON.stringify(v))
        .join('\n');
      showResult(
        summary + '<pre class="result-pre">' + fields + '</pre>',
        'result-info'
      );
    }
  } catch (e) {
    showResult('❌ ' + e.message, 'result-err');
  } finally {
    $('btnGetInfo').disabled = false;
    $('btnGetInfo').textContent = '📊 Get Wheel Info';
  }
});

// ─── EXTRACT TAB ─────────────────────────────────────────────────────────────
function setField(elId, copyId, value) {
  const el=$(elId), btn=$(copyId);
  if (value && value !== 'null' && value !== '') {
    el.textContent=value; el.className='value found';
    btn.disabled=false; btn.onclick=()=>copyText(btn,value);
  } else {
    el.textContent='Not found'; el.className='value missing'; btn.disabled=true;
  }
}

$('btnScan').addEventListener('click', async () => {
  $('btnScan').textContent = '⏳ Scanning…';
  $('btnScan').disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab');

    let lsData = { token: null, tokenHeader: null };
    try {
      const r = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({ token: localStorage.getItem('token'), tokenHeader: localStorage.getItem('tokenHeader') }),
      });
      if (r?.[0]?.result) lsData = r[0].result;
    } catch(e) { console.warn(e); }

    let cfClearance = null;
    try {
      const all = await chrome.cookies.getAll({ name: 'cf_clearance' });
      if (all?.length) cfClearance = all[0].value;
    } catch { }

    setField('valCf', 'copyCf', cfClearance);
    setField('valToken', 'copyToken', lsData.token);
    setField('valHeader', 'copyHeader', lsData.tokenHeader);

    const json = JSON.stringify({ token: lsData.token??'', tokenHeader: lsData.tokenHeader??'Bearer', cfClearance: cfClearance??'' }, null, 2);
    $('jsonOut').textContent = json;
    $('copyJson').disabled = false;
    $('copyJson').onclick = () => copyText($('copyJson'), json);

    if (lsData.token) {
      $('tabStatus').className = 'result-box result-ok';
      $('tabStatus').textContent = '✅ Token found! Spin and Add Spin buttons are ready.';
    } else {
      $('tabStatus').className = 'result-box result-err';
      $('tabStatus').textContent = '❌ No token. Open cklottery.club and log in first.';
    }
  } catch(err) {
    $('jsonOut').textContent = 'Error: ' + String(err);
  } finally {
    $('btnScan').textContent = '🔍 Scan current tab';
    $('btnScan').disabled = false;
  }
});

window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => $('btnScan').click(), 80);
});
