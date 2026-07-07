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

    // Pre-check: get wheel info to look for a reliable spin-count field
    // NOTE: invitedWheelAmountofcodeAmount = number of qualifying invite codes, NOT spin count
    const infoResult = await callCKApi(tab.id, 'GetInvitedWheelInfo', {});
    if (infoResult.ok && infoResult.data?.data != null) {
      const info = infoResult.data.data;
      // Only use fields that actually represent remaining draws
      const spins =
        info['remainCount'] ?? info['remainDrawCount'] ?? info['availableCount'] ??
        info['spinCount'] ?? info['drawCount'] ?? info['freeCount'] ??
        info['leftCount'] ?? info['surplusCount'] ?? info['residueCount'];
      if (spins != null && Number(spins) === 0) {
        showResult(
          '⚠️ <b>No free spins available (remaining = 0).</b><br>' +
          'Invite a friend to deposit to earn more spins.<br>' +
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

  // ⭐ Confirmed real endpoints from JS scan — try these first
  const ADD_ENDPOINTS = [
    'ReceiveLottery',   // found in page JS — may grant a spin/draw
    'RedeemGift',       // found in page JS — may redeem gift code for spin
    'RewardAmountDialog', // found in page JS — may trigger reward
    // InvitedWheel-specific
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
      // Reliable remaining-spin fields (invitedWheelAmountofcodeAmount = invite codes used, NOT spin count)
      const spinCount =
        d['remainCount'] ?? d['remainDrawCount'] ?? d['availableCount'] ??
        d['spinCount'] ?? d['drawCount'] ?? d['freeCount'] ??
        d['leftCount'] ?? d['surplusCount'] ?? d['residueCount'];
      const inviteCodes = d['invitedWheelAmountofcodeAmount'];
      const accum = d['userInvitedWheelAmount'];
      const total = d['invitedWheelTotalPrizeAmount'];
      const summary = [
        spinCount != null
          ? `🎰 Remaining Spins: <b style="color:#facc15;font-size:14px">${spinCount}</b>`
          : `🎰 Remaining Spins: <b style="color:#888;font-size:12px">unknown (field not found)</b>`,
        inviteCodes != null ? `👥 Invite Codes Used: ${inviteCodes}` : '',
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

// ─── GET WHEEL RULES ─────────────────────────────────────────────────────────
$('btnGetRules').addEventListener('click', async () => {
  $('btnGetRules').disabled = true;
  $('btnGetRules').textContent = '⏳ Loading…';
  showResult('Calling GetInvitedWheelRules…', 'result-info');
  try {
    const tab = await getCKTab();
    const result = await callCKApi(tab.id, 'GetInvitedWheelRules', {});
    if (!result.ok) {
      showResult('❌ ' + result.error, 'result-err');
    } else {
      const raw = result.data;
      const code = raw.code ?? raw.Code;
      const ok = code === 0 || code === 200 || code === '0';
      const d = raw?.data ?? raw;
      const text = typeof d === 'string' ? d : JSON.stringify(d, null, 2);
      showResult(
        (ok ? '📋 <b>Wheel Rules:</b>' : '⚠️ code=' + code) +
        '<pre class="result-pre" style="max-height:160px">' + text + '</pre>',
        ok ? 'result-info' : 'result-err'
      );
    }
  } catch (e) {
    showResult('❌ ' + e.message, 'result-err');
  } finally {
    $('btnGetRules').disabled = false;
    $('btnGetRules').textContent = '📋 Get Wheel Rules';
  }
});

// ─── NETWORK SPY ─────────────────────────────────────────────────────────────
// Patches fetch() + XHR inside the CKLottery tab to record ALL /api/ calls.
// The patch lives in the PAGE context — it survives popup close/reopen.
// On popup open we check if spy is already running and restore button state.

function setSpyButtons(active) {
  if (active) {
    $('btnSpyStart').textContent = '👁️ Spy Active…';
    $('btnSpyStart').style.opacity = '0.5';
    $('btnSpyStart').disabled = true;
    $('btnSpyStop').disabled = false;
    $('btnSpyStop').style.background = 'linear-gradient(135deg,#dc2626,#f87171)';
    $('btnSpyStop').style.color = '#fff';
    $('btnSpyStop').textContent = '⏹ Stop & Show Captured Calls';
  } else {
    $('btnSpyStart').textContent = '👁️ Start Network Spy';
    $('btnSpyStart').style.opacity = '1';
    $('btnSpyStart').disabled = false;
    $('btnSpyStop').disabled = true;
    $('btnSpyStop').style.background = '#1a1a1a';
    $('btnSpyStop').style.color = '#888';
  }
}

async function checkSpyStatus() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab?.id) return;
    const r = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => Array.isArray(window.__ckSpy) ? window.__ckSpy.length : -1,
    });
    const count = r?.[0]?.result ?? -1;
    if (count >= 0) {
      setSpyButtons(true);
      $('tabStatus').className = 'result-box result-ok';
      const prev = $('tabStatus').textContent;
      if (!prev.includes('Spy')) {
        $('tabStatus').textContent = (prev || '') + ' | 👁️ Spy running (' + count + ' calls)';
      }
    }
  } catch {}
}

$('btnSpyStart').addEventListener('click', async () => {
  try {
    const tab = await getCKTab();
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        if (Array.isArray(window.__ckSpy)) return; // already active
        window.__ckSpy = [];
        const origFetch = window.fetch.bind(window);
        window.fetch = async function(input, init) {
          const url = typeof input === 'string' ? input : (input?.url ?? '');
          const match = url.match(/\/api\/(?:webapi|admin|agent|operator|manage|backend)\/([^?#/]+)/);
          if (match) {
            let body = null;
            try { body = JSON.parse(init?.body); } catch {}
            window.__ckSpy.push({ ep: match[1], url, body, ts: new Date().toISOString() });
          }
          return origFetch(input, init);
        };
        const origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url) {
          const match = String(url).match(/\/api\/(?:webapi|admin|agent|operator|manage|backend)\/([^?#/]+)/);
          if (match) window.__ckSpy.push({ ep: match[1], url: String(url), body: null, ts: new Date().toISOString() });
          return origOpen.apply(this, arguments);
        };
      },
    });
    setSpyButtons(true);
    showResult(
      '👁️ <b>Network Spy is ON — it stays active even when you close this popup.</b><br><br>' +
      'Now go use the CKLottery page normally:<br>' +
      '• Open the Invite Wheel<br>• Tap Deposit / Withdraw / Bonus / Invite<br>• Navigate between pages<br><br>' +
      'Then reopen this extension and click <b>⏹ Stop & Show Captured Calls</b>.',
      'result-info'
    );
  } catch (e) {
    showResult('❌ ' + e.message, 'result-err');
  }
});

$('btnSpyStop').addEventListener('click', async () => {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab?.id) throw new Error('No active tab');
    const r = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const calls = window.__ckSpy ?? [];
        window.__ckSpy = null; // stop spy
        return calls;
      },
    });
    const calls = r?.[0]?.result ?? [];
    setSpyButtons(false);

    if (calls.length === 0) {
      showResult('⚠️ Spy stopped but 0 calls captured. Use the CK page while spy is running, then stop.', 'result-err');
      return;
    }

    // Deduplicate (keep first occurrence of each endpoint)
    const seen = new Map();
    calls.forEach(c => { if (!seen.has(c.ep)) seen.set(c.ep, c); });
    const unique = [...seen.values()];

    // Categorise all endpoints
    function cat(ep) {
      const l = ep.toLowerCase();
      if (l.includes('deposit') || l.includes('recharge') || l.includes('topup') || l.includes('pay')) return '💳 Deposit';
      if (l.includes('withdraw') || l.includes('cashout') || l.includes('payout')) return '💸 Withdrawal';
      if (l.includes('bonus') || l.includes('reward') || l.includes('gift') || l.includes('redeem') || l.includes('coupon') || l.includes('voucher')) return '🎁 Bonus/Reward';
      if (l.includes('spin') || l.includes('wheel') || l.includes('draw') || l.includes('lucky') || l.includes('lottery') || l.includes('turntable')) return '🎰 Wheel/Lottery';
      if (l.includes('invite') || l.includes('referral') || l.includes('agent') || l.includes('team') || l.includes('commission')) return '👥 Invite/Agent';
      if (l.includes('user') || l.includes('profile') || l.includes('login') || l.includes('register') || l.includes('auth') || l.includes('token')) return '👤 User/Auth';
      if (l.includes('wallet') || l.includes('balance') || l.includes('fund') || l.includes('transfer')) return '💰 Wallet';
      if (l.includes('vip') || l.includes('level') || l.includes('grade') || l.includes('rank')) return '⭐ VIP';
      if (l.includes('bet') || l.includes('game') || l.includes('play') || l.includes('order') || l.includes('record')) return '🎮 Game/Bet';
      if (l.includes('get') || l.includes('query') || l.includes('list') || l.includes('info') || l.includes('detail')) return '📋 Query/Info';
      return '🔧 Other';
    }

    const groups = {};
    unique.forEach(c => {
      const g = cat(c.ep);
      if (!groups[g]) groups[g] = [];
      groups[g].push(c.ep);
    });

    let html = `<b style="color:#c084fc">🕵️ Spy captured ${calls.length} calls → ${unique.length} unique endpoints:</b><br><br>`;
    const order = ['🎰 Wheel/Lottery','💳 Deposit','💸 Withdrawal','🎁 Bonus/Reward','👥 Invite/Agent','💰 Wallet','⭐ VIP','🎮 Game/Bet','👤 User/Auth','📋 Query/Info','🔧 Other'];
    order.forEach(g => {
      if (!groups[g]) return;
      html += `<b style="color:#fbbf24">${g} (${groups[g].length}):</b><br>`;
      html += groups[g].map(ep => `<code style="color:#86efac">${ep}</code>`).join(', ') + '<br><br>';
    });
    showResult(html, 'result-info');
  } catch (e) {
    showResult('❌ ' + e.message, 'result-err');
  }
});

// ─── TRY RECEIVELOTTERY ───────────────────────────────────────────────────────
$('btnReceiveLottery').addEventListener('click', async () => {
  $('btnReceiveLottery').disabled = true;
  $('btnReceiveLottery').textContent = '⏳ Trying…';
  showResult('Calling ReceiveLottery (found in page JS)…', 'result-info');
  try {
    const tab = await getCKTab();
    // Try several payload shapes — the endpoint may need different fields
    const payloads = [
      {},
      { type: 1 },
      { type: 2 },
      { lotteryType: 1 },
      { activityId: 1 },
      { id: 1 },
      { drawType: 'InvitedWheel' },
    ];
    let lastResult = null;
    for (const body of payloads) {
      const result = await callCKApi(tab.id, 'ReceiveLottery', body);
      if (!result.ok) continue;
      lastResult = result;
      const d = result.data;
      const code = d.code ?? d.Code;
      const msg = String(d.msg ?? d.message ?? '');
      const ml = msg.toLowerCase();
      // If it's "url not exist", no point trying more
      if (ml.includes('url is not exist') || ml.includes('url not exist') || ml.includes('no route')) {
        showResult('❌ ReceiveLottery endpoint does not exist on this server.', 'result-err');
        return;
      }
      const ok = code === 0 || code === 200 || code === '0';
      if (ok) {
        showResult(
          '✅ ReceiveLottery success! ' + msg +
          '<pre class="result-pre">' + JSON.stringify(d, null, 2) + '</pre>',
          'result-ok'
        );
        return;
      }
      // Endpoint exists — show the response (may need a specific payload)
      showResult(
        '⚠️ ReceiveLottery exists (code=' + code + '): ' + msg +
        '<pre class="result-pre">' + JSON.stringify(d, null, 2) + '</pre>',
        'result-err'
      );
      return;
    }
    if (lastResult) {
      showResult('⚠️ All payloads tried. Last response:<pre class="result-pre">' + JSON.stringify(lastResult.data, null, 2) + '</pre>', 'result-err');
    } else {
      showResult('❌ No response from ReceiveLottery.', 'result-err');
    }
  } catch (e) {
    showResult('❌ ' + e.message, 'result-err');
  } finally {
    $('btnReceiveLottery').disabled = false;
    $('btnReceiveLottery').textContent = '🎁 Try ReceiveLottery';
  }
});

// ─── SCAN PAGE JS FOR ENDPOINTS ──────────────────────────────────────────────
$('btnScanJs').addEventListener('click', async () => {
  $('btnScanJs').disabled = true;
  $('btnScanJs').textContent = '⏳ Scanning scripts…';
  showResult('Fetching all JS files from the CKLottery page to find endpoint names…', 'result-info');
  try {
    const tab = await getCKTab();

    // Step 1: collect all script src URLs from the page
    const scriptUrls = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const urls = [];
        document.querySelectorAll('script[src]').forEach(s => {
          if (s.src) urls.push(s.src);
        });
        // also check webpack chunks in window.__webpack_require__ / performance entries
        try {
          const perf = performance.getEntriesByType('resource');
          perf.forEach(e => {
            if (e.initiatorType === 'script' && e.name) urls.push(e.name);
          });
        } catch {}
        return [...new Set(urls)];
      },
    });
    const urls = scriptUrls?.[0]?.result ?? [];

    if (urls.length === 0) {
      showResult('❌ No script tags found on this page. Make sure you are on cklottery.club and the page is fully loaded.', 'result-err');
      return;
    }

    // Step 2: fetch each script from inside the tab (same origin, no CORS) and grep for endpoint strings
    const scanResult = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (scriptUrls) => {
        const found = new Set();
        // Patterns: strings that look like CKLottery API endpoint names
        // e.g. "SpinInvitedWheel", "AddInvitedWheelCount", "GetUserInfo"
        const EP_RE = /["'`]((?:Add|Give|Grant|Send|Receive|Claim|Get|Set|Update|Create|Submit|Do|Run|Start|Use|Redeem|Reward|Recharge|Transfer|Invite|Spin|Draw|Wheel|Lucky|Turn|Open|Apply|Manual)[A-Z][A-Za-z]{2,60})["'`]/g;

        await Promise.all(scriptUrls.map(async url => {
          try {
            const r = await fetch(url);
            const text = await r.text();
            let m;
            while ((m = EP_RE.exec(text)) !== null) found.add(m[1]);
            EP_RE.lastIndex = 0;
          } catch {}
        }));

        // Also scan inline scripts
        document.querySelectorAll('script:not([src])').forEach(s => {
          let m;
          while ((m = EP_RE.exec(s.textContent)) !== null) found.add(m[1]);
          EP_RE.lastIndex = 0;
        });

        return [...found].sort();
      },
      args: [urls],
    });

    const allEndpoints = scanResult?.[0]?.result ?? [];

    if (allEndpoints.length === 0) {
      showResult('⚠️ Scripts scanned but no endpoint names found. The site may use obfuscated names.', 'result-err');
      return;
    }

    // Step 3: categorise — highlight anything spin/wheel/invite/draw/add related
    const spinRelated = allEndpoints.filter(ep => {
      const l = ep.toLowerCase();
      return l.includes('spin') || l.includes('wheel') || l.includes('draw') || l.includes('invite') || l.includes('lucky') || l.includes('turn') || l.includes('chance') || l.includes('ticket') || l.includes('free');
    });
    const rest = allEndpoints.filter(ep => !spinRelated.includes(ep));

    let html = `<b style="color:#34d399">✅ Found ${allEndpoints.length} endpoint names in ${urls.length} script file(s).</b><br><br>`;

    if (spinRelated.length > 0) {
      html += `<b style="color:#facc15">⭐ Spin/Wheel/Draw related (${spinRelated.length}):</b><br>`;
      html += spinRelated.map(ep => `<code style="color:#86efac">${ep}</code>`).join(', ') + '<br><br>';
    }
    html += `<b style="color:#93c5fd">All others (${rest.length}):</b><br>`;
    html += `<pre class="result-pre">${rest.join('\n')}</pre>`;

    showResult(html, 'result-info');
  } catch (e) {
    showResult('❌ ' + e.message, 'result-err');
  } finally {
    $('btnScanJs').disabled = false;
    $('btnScanJs').textContent = '🔎 Scan Page JS for Endpoints';
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
  setTimeout(() => checkSpyStatus(), 300);
});
