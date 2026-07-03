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

// ─── Helper: copy text ──────────────────────────────────────────────────────
function copyText(btn, text) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✓ Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1500);
  });
}

// ─── Helper: set result box ─────────────────────────────────────────────────
function showResult(html, cls = 'result-info') {
  const box = $('actionResult');
  box.style.display = 'block';
  box.className = 'result-box ' + cls;
  box.innerHTML = html;
}

// ─── Helper: get active CKLottery tab ──────────────────────────────────────
async function getCKTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) throw new Error('No active tab');
  const url = tab.url || '';
  if (!url.includes('cklottery') && !url.includes('ckygjf6r')) {
    throw new Error('Please open cklottery.club first, then click Scan to load your token.');
  }
  return tab;
}

// ─── Helper: inject and call CKLottery API from inside the tab ──────────────
// This runs inside the page context — same origin as cklottery.club — so CORS passes!
async function callCKApi(tabId, endpoint, extraBody = {}) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (ep, extra) => {
      // Read auth from localStorage
      const token = localStorage.getItem('token') || '';
      const tokenHeader = (localStorage.getItem('tokenHeader') || 'Bearer').trim();

      // Build signed body (CKLottery uses timestamp + nonce)
      const ts = Math.floor(Date.now() / 1000);
      const nonce = Math.random().toString(36).slice(2, 10);
      const body = { ...extra, timestamp: ts, nonce };

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
          body: JSON.stringify(body),
        });
        const text = await res.text();
        try { return { ok: true, data: JSON.parse(text) }; }
        catch { return { ok: false, error: 'Non-JSON: ' + text.slice(0, 120) }; }
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
  $('btnSpin').textContent = '⏳ Spinning…';
  showResult('Calling SpinInvitedWheel from inside CKLottery tab…', 'result-info');
  try {
    const tab = await getCKTab();
    const result = await callCKApi(tab.id, 'SpinInvitedWheel', {});
    if (!result.ok) {
      showResult('❌ Injection error: ' + result.error, 'result-err');
    } else {
      const d = result.data;
      const code = d.code ?? d.Code;
      const msg = d.msg || d.message || '';
      const ok = code === 0 || code === 200 || code === '0';
      showResult(
        (ok ? '✅ Spin success!' : '⚠️ code=' + code) + '<br>' + msg +
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
  $('btnAddSpin').textContent = '⏳ Scanning add-spin endpoints…';
  showResult('Scanning for add-spin endpoint inside CKLottery tab…', 'result-info');

  const ADD_ENDPOINTS = [
    'AddInvitedWheelCount', 'AddInvitedWheelTimes', 'GiveInvitedWheelSpin',
    'AddWheelTimes', 'AddWheelCount', 'AddWheelSpin', 'GiveWheelSpin',
    'RechargeWheelTimes', 'InvitedWheelAdd', 'AddSpinCount', 'AddSpinTimes',
    'AddTurnTableCount', 'AddTurnTableTimes', 'AddLuckyDrawTimes',
  ];

  try {
    const tab = await getCKTab();
    let found = false;
    for (const ep of ADD_ENDPOINTS) {
      const result = await callCKApi(tab.id, ep, { count: 1, times: 1, num: 1 });
      if (!result.ok) continue;
      const d = result.data;
      const msg = String(d.msg ?? d.message ?? '');
      const ml = msg.toLowerCase();
      if (ml.includes('not exist') || ml.includes('no route') || ml.includes('not found')) continue;
      const code = d.code ?? d.Code;
      const ok = code === 0 || code === 200 || code === '0';
      showResult(
        (ok ? '✅ +1 Spin added!' : '⚠️') + ' [' + ep + '] ' + msg +
        '<pre class="result-pre">' + JSON.stringify(d, null, 2) + '</pre>',
        ok ? 'result-ok' : 'result-err'
      );
      found = true;
      break;
    }
    if (!found) showResult('❌ No add-spin endpoint found. Server may require higher privileges.', 'result-err');
  } catch (e) {
    showResult('❌ ' + e.message, 'result-err');
  } finally {
    $('btnAddSpin').disabled = false;
    $('btnAddSpin').textContent = '➕ Add 1 Spin';
  }
});

// ─── GET WHEEL INFO button ──────────────────────────────────────────────────
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
      const d = result.data?.data ?? result.data;
      showResult(
        '📊 Wheel Info<pre class="result-pre">' +
        Object.entries(d ?? result.data)
          .filter(([,v]) => typeof v !== 'object' || v === null)
          .map(([k,v]) => k + ': ' + JSON.stringify(v))
          .join('\n') +
        '</pre>',
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

// ─── EXTRACT TAB ────────────────────────────────────────────────────────────
function setField(elId, copyId, value) {
  const el = $(elId), btn = $(copyId);
  if (value && value !== 'null' && value !== '') {
    el.textContent = value; el.className = 'value found';
    btn.disabled = false; btn.onclick = () => copyText(btn, value);
  } else {
    el.textContent = 'Not found'; el.className = 'value missing'; btn.disabled = true;
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
    } catch { /* ignore */ }

    setField('valCf', 'copyCf', cfClearance);
    setField('valToken', 'copyToken', lsData.token);
    setField('valHeader', 'copyHeader', lsData.tokenHeader);

    const json = JSON.stringify({ token: lsData.token ?? '', tokenHeader: lsData.tokenHeader ?? 'Bearer', cfClearance: cfClearance ?? '' }, null, 2);
    $('jsonOut').textContent = json;
    $('copyJson').disabled = false;
    $('copyJson').onclick = () => copyText($('copyJson'), json);

    // Update actions tab status
    if (lsData.token) {
      $('tabStatus').className = 'result-box result-ok';
      $('tabStatus').textContent = '✅ Token found! Spin and Add Spin buttons are ready.';
    } else {
      $('tabStatus').className = 'result-box result-err';
      $('tabStatus').textContent = '❌ No token found. Open cklottery.club and log in first.';
    }
  } catch(err) {
    $('jsonOut').textContent = 'Error: ' + String(err);
  } finally {
    $('btnScan').textContent = '🔍 Scan current tab';
    $('btnScan').disabled = false;
  }
});

// Auto-scan + auto-switch to actions
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => $('btnScan').click(), 80);
});
