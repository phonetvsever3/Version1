const $ = id => document.getElementById(id);

function setField(elId, copyId, value) {
  const el = $(elId);
  const btn = $(copyId);
  if (value && value !== "null" && value !== "") {
    el.textContent = value;
    el.className = "value found";
    btn.disabled = false;
    btn.onclick = () => copyText(btn, value);
  } else {
    el.textContent = "Not found";
    el.className = "value missing";
    btn.disabled = true;
  }
}

function copyText(btn, text) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = "✓ Copied!";
    btn.classList.add("copied");
    setTimeout(() => {
      btn.textContent = orig;
      btn.classList.remove("copied");
    }, 1500);
  });
}

$("btnScan").addEventListener("click", async () => {
  $("btnScan").textContent = "⏳ Scanning…";
  $("btnScan").disabled = true;

  try {
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab");

    // 1. Read localStorage via scripting injection
    let lsData = { token: null, tokenHeader: null };
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({
          token: localStorage.getItem("token"),
          tokenHeader: localStorage.getItem("tokenHeader"),
          allKeys: Object.keys(localStorage),
        }),
      });
      if (results?.[0]?.result) {
        lsData = results[0].result;
      }
    } catch (e) {
      console.warn("localStorage injection failed:", e);
    }

    // 2. Read cf_clearance cookie from both domains
    let cfClearance = null;
    const domains = ["cklottery.club", "ckygjf6r.com", ".cklottery.club", ".ckygjf6r.com"];
    for (const domain of domains) {
      try {
        const cookie = await chrome.cookies.get({ url: `https://${domain.replace(/^\./, "")}/`, name: "cf_clearance" });
        if (cookie?.value) { cfClearance = cookie.value; break; }
      } catch { /* try next */ }
    }
    // Also try getAllCookies as fallback
    if (!cfClearance) {
      try {
        const all = await chrome.cookies.getAll({ name: "cf_clearance" });
        if (all?.length) cfClearance = all[0].value;
      } catch { /* ignore */ }
    }

    // Render
    setField("valCf", "copyCf", cfClearance);
    setField("valToken", "copyToken", lsData.token);
    setField("valHeader", "copyHeader", lsData.tokenHeader);

    // Build JSON output
    const json = JSON.stringify({
      token: lsData.token ?? "",
      tokenHeader: lsData.tokenHeader ?? "Bearer",
      cfClearance: cfClearance ?? "",
    }, null, 2);
    $("jsonOut").textContent = json;
    $("copyJson").disabled = false;
    $("copyJson").onclick = () => copyText($("copyJson"), json);

  } catch (err) {
    $("jsonOut").textContent = "Error: " + String(err);
  } finally {
    $("btnScan").textContent = "🔍 Scan current tab";
    $("btnScan").disabled = false;
  }
});

// Auto-scan on open
window.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => $("btnScan").click(), 100);
});
