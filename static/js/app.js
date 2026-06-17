// app.js — frontend logic for the AI-Based RBAC Role Recommendation System
// All recommendation data is fetched live from the Flask backend, which
// runs the scikit-learn-backed peer-similarity engine in models/recommender.py

let QUEUE = { prehire: [], transfers: [] };
let selectedId = null;       // currently selected identity record (raw)
let selectedKind = null;     // "prehire" | "transfer"
let currentData = null;      // last /api/.../recommendations response
let selectedRoles = {};      // role_id -> bool (grant selection)
let revokeSelections = {};   // role_id -> bool (revoke selection, transfer only)
let currentTab = "recommendations";
let filterVal = "all";

const DIM_LABELS = {
  section: "Section", manager: "Manager", department: "Dept",
  manager_department: "Mgr Dept", division: "Division"
};

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

function catClass(c) { return "cat-" + c.toLowerCase().replace(/[ /]/g, "-"); }
function scoreClass(s, isTransfer) {
  if (isTransfer) return "score-purple";
  return s >= 75 ? "score-high" : s >= 50 ? "score-med" : "score-low";
}
function fillClass(s, isTransfer) {
  if (isTransfer) return "fill-purple";
  return s >= 75 ? "fill-teal" : s >= 50 ? "fill-blue" : "fill-gray";
}

// ─────────────────────────────────────────────
// INITIAL LOAD
// ─────────────────────────────────────────────
async function init() {
  const data = await fetchJSON("/api/queue");
  QUEUE = data;
  document.getElementById("stat-prehire").textContent = data.prehire.length;
  document.getElementById("stat-transfer").textContent = data.transfers.length;
  document.getElementById("stat-active").textContent = data.active_count;
  renderList();
}

// ─────────────────────────────────────────────
// SIDEBAR
// ─────────────────────────────────────────────
function filterIdentities() { renderList(document.getElementById("search-input").value.toLowerCase()); }
function setFilter(v, el) {
  filterVal = v;
  document.querySelectorAll(".filter-chip").forEach(c => c.classList.remove("active"));
  el.classList.add("active");
  filterIdentities();
}

function renderList(q = "") {
  const list = document.getElementById("id-list");
  const items = [];
  if (filterVal === "all" || filterVal === "PreHire") {
    QUEUE.prehire.forEach(p => items.push({ ...p, kind: "prehire" }));
  }
  if (filterVal === "all" || filterVal === "Transfer") {
    QUEUE.transfers.forEach(t => items.push({ ...t, kind: "transfer" }));
  }
  const filtered = items.filter(it => {
    if (!q) return true;
    const name = (it.name || "").toLowerCase();
    const dept = (it.department || it.to_department || "").toLowerCase();
    const section = (it.section || it.to_section || "").toLowerCase();
    return name.includes(q) || dept.includes(q) || section.includes(q);
  });

  list.innerHTML = "";
  if (filtered.length === 0) {
    list.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px">No identities match</div>`;
    return;
  }

  filtered.forEach((it, i) => {
    const isTransfer = it.kind === "transfer";
    const sel = selectedId && selectedId.identity_id === it.identity_id;
    const initials = it.name.split(" ").map(p => p[0]).slice(0, 2).join("");
    const subline = isTransfer
      ? `${it.from_department} \u2192 ${it.to_department}`
      : `${it.section} \u00b7 ${it.department}`;
    const el = document.createElement("div");
    el.className = `id-item fadein${sel ? (isTransfer ? " transfer-selected" : " selected") : ""}`;
    el.style.animationDelay = (i * 0.03) + "s";
    el.innerHTML = `
      <div class="id-avatar${isTransfer ? " transfer-av" : ""}">${initials}</div>
      <div class="id-meta">
        <div class="id-name">${it.name}</div>
        <div class="id-role">${subline}</div>
      </div>
      ${isTransfer ? `<div class="transfer-badge">Transfer</div>` : `<div class="status-dot"></div>`}`;
    el.onclick = () => selectIdentity(it, it.kind);
    list.appendChild(el);
  });
}

// ─────────────────────────────────────────────
// SELECT IDENTITY -> FETCH RECOMMENDATIONS
// ─────────────────────────────────────────────
async function selectIdentity(record, kind) {
  selectedId = record;
  selectedKind = kind;
  selectedRoles = {};
  revokeSelections = {};
  currentTab = "recommendations";
  renderList(document.getElementById("search-input").value.toLowerCase());

  document.getElementById("empty-state").style.display = "none";
  const dv = document.getElementById("detail-view");
  dv.style.display = "flex";
  dv.innerHTML = `<div class="loading-row"><div class="spinner"></div> Computing peer similarity and role recommendations&hellip;</div>`;

  const url = kind === "prehire"
    ? `/api/prehire/${record.identity_id}/recommendations`
    : `/api/transfer/${record.identity_id}/recommendations`;

  try {
    currentData = await fetchJSON(url);
    renderDetail();
  } catch (e) {
    dv.innerHTML = `<div class="loading-row" style="color:var(--red)">Failed to load recommendations: ${e.message}</div>`;
  }
}

// ─────────────────────────────────────────────
// DETAIL VIEW
// ─────────────────────────────────────────────
function renderDetail() {
  const dv = document.getElementById("detail-view");
  const isTransfer = selectedKind === "transfer";
  const id = currentData.identity;
  const recs = currentData.recommendations;

  // pre-select birthright / current grants
  recs.filter(r => r.classification === "birthright").forEach(r => selectedRoles[r.role_id] = true);
  if (isTransfer) {
    (currentData.current_roles || []).forEach(r => revokeSelections[r.role_id] = true);
  }

  const initials = id.name.split(" ").map(p => p[0]).slice(0, 2).join("");

  const attrRow = isTransfer ? `
    <div class="det-attrs">
      <div class="det-attr changed"><div class="det-attr-lbl">Department</div><div class="det-attr-val">${id.to_department}</div><div class="det-attr-old">${id.from_department}</div></div>
      <div class="det-attr changed"><div class="det-attr-lbl">Division</div><div class="det-attr-val">${id.to_division}</div><div class="det-attr-old">${id.from_division}</div></div>
      <div class="det-attr changed"><div class="det-attr-lbl">Section</div><div class="det-attr-val">${id.to_section}</div><div class="det-attr-old">${id.from_section}</div></div>
      <div class="det-attr changed"><div class="det-attr-lbl">Manager</div><div class="det-attr-val">${id.to_manager}</div><div class="det-attr-old">${id.from_manager}</div></div>
      <div class="det-attr"><div class="det-attr-lbl">Effective</div><div class="det-attr-val">${id.effective_date}</div></div>
    </div>` : `
    <div class="det-attrs">
      <div class="det-attr"><div class="det-attr-lbl">Division</div><div class="det-attr-val">${id.division}</div></div>
      <div class="det-attr"><div class="det-attr-lbl">Department</div><div class="det-attr-val">${id.department}</div></div>
      <div class="det-attr"><div class="det-attr-lbl">Section</div><div class="det-attr-val">${id.section}</div></div>
      <div class="det-attr"><div class="det-attr-lbl">Manager</div><div class="det-attr-val">${id.manager}</div></div>
      <div class="det-attr"><div class="det-attr-lbl">Mgr Dept</div><div class="det-attr-val">${id.manager_department}</div></div>
    </div>`;

  const badge = isTransfer
    ? `<span style="font-size:11px;color:#A78BFA;background:rgba(139,92,246,0.15);padding:3px 10px;border-radius:20px;border:1px solid rgba(139,92,246,0.3)">Dept Transfer</span>`
    : `<span style="font-size:11px;color:#6BABFF;background:rgba(30,111,217,0.15);padding:3px 10px;border-radius:20px;border:1px solid rgba(30,111,217,0.3)">PreHire</span>`;

  const reasonLine = isTransfer ? `<p style="font-size:11px;color:var(--text3);margin-top:3px">Reason: ${id.reason}</p>` : "";
  const titleLine = isTransfer ? `&middot; Effective ${id.effective_date}` : `&middot; Starts ${id.start_date || ""}`;

  dv.innerHTML = `
    <div class="detail-top fadein">
      <div class="detail-top-row">
        <div class="det-avatar${isTransfer ? " transfer-av" : ""}">${initials}</div>
        <div class="det-info">
          <h1>${id.name}</h1>
          <p>${id.title || ""} ${badge} ${titleLine}</p>
          <p style="font-size:11px;color:var(--text3);margin-top:2px;font-family:var(--mono)">UID: ${id.identity_id}</p>
          ${reasonLine}
        </div>
        <div style="margin-left:auto">
          <button class="btn ${isTransfer ? "btn-purple" : "btn-primary"}" onclick="${isTransfer ? "openTransferModal()" : "openModal()"}">
            ${isTransfer ? "&#8644; Submit Transfer Request" : "&#8679; Submit to ISC"}
          </button>
        </div>
      </div>${attrRow}
    </div>
    <div class="tabs">
      <div class="tab active${isTransfer ? " transfer-tab" : ""}" onclick="switchTab('recommendations',event)">${isTransfer ? "Role Delta" : "Role Recommendations"} <span class="tab-badge${isTransfer ? " tab-badge-purple" : ""}">${recs.length}</span></div>
      <div class="tab${isTransfer ? " transfer-tab" : ""}" onclick="switchTab('peers',event)">Peer Analysis</div>
      <div class="tab${isTransfer ? " transfer-tab" : ""}" onclick="switchTab('methodology',event)">Methodology</div>
    </div>
    <div class="content" id="tab-content"></div>
    <div class="bottom-bar" id="bottom-bar">
      <div class="sum-chips" id="sum-chips"></div>
      <div class="progress-wrap">
        <div class="progress-track"><div class="progress-fill" id="prog-fill" style="width:0%;${isTransfer ? "background:var(--purple)" : ""}"></div></div>
        <div class="progress-lbl" id="prog-lbl"></div>
      </div>
      <button class="btn ${isTransfer ? "btn-purple" : "btn-primary"}" onclick="${isTransfer ? "openTransferModal()" : "openModal()"}" style="margin-left:auto">${isTransfer ? "&#8644; Submit Transfer Request" : "&#8679; Submit to ISC"}</button>
    </div>`;
  renderTab();
}

function switchTab(tab, e) {
  currentTab = tab;
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  if (e) e.target.closest(".tab").classList.add("active");
  renderTab();
}

function renderTab() {
  const content = document.getElementById("tab-content");
  const isTransfer = selectedKind === "transfer";
  if (currentTab === "recommendations") {
    isTransfer ? renderTransferDelta(content) : renderPreHireRecs(content);
  } else if (currentTab === "peers") {
    renderPeers(content, isTransfer);
  } else {
    renderMethodology(content, isTransfer);
  }
}

// ─── PreHire Recommendations ───
function renderPreHireRecs(content) {
  const recs = currentData.recommendations;
  const births = recs.filter(r => r.classification === "birthright");
  const reco = recs.filter(r => r.classification === "recommended");
  const opts = recs.filter(r => r.classification === "optional");
  const id = currentData.identity;

  let h = `<div class="ai-banner fadein"><div class="ai-icon">&#9672;</div><div class="ai-text">
    <strong>Peer similarity analysis complete.</strong> Evaluated ${currentData.peer_count} Active peer identities in <strong>${id.department}</strong> using weighted cosine-similarity-style scoring across 5 organisational dimensions.
    Found <strong>${births.length} birthright</strong> and <strong>${reco.length} recommended</strong> roles for the <strong>${id.section}</strong> &middot; <strong>${id.manager}</strong> reporting line.
    <span class="methodology-note">See the Methodology tab for the full scoring formula.</span></div></div>`;

  if (births.length) { h += `<div class="section-label fadein stagger-1">Birthright &mdash; auto-assigned at PreHire</div><div class="roles-grid">`; births.forEach((r, i) => h += buildRoleCard(r, true, i + 2, false)); h += `</div>`; }
  if (reco.length) { h += `<div class="section-label fadein stagger-2" style="margin-top:18px">Peer-recommended roles</div><div class="roles-grid">`; reco.forEach((r, i) => h += buildRoleCard(r, false, i + 3, false)); h += `</div>`; }
  if (opts.length) { h += `<div class="section-label fadein stagger-3" style="margin-top:18px">Optional &mdash; low peer coverage</div><div class="roles-grid">`; opts.forEach((r, i) => h += buildRoleCard(r, false, i + 4, false)); h += `</div>`; }

  content.innerHTML = h;
  updateSummary(recs, false);
}

// ─── Transfer Role Delta ───
function renderTransferDelta(content) {
  const recs = currentData.recommendations;
  const currentRoles = currentData.current_roles || [];
  const id = currentData.identity;

  const births = recs.filter(r => r.classification === "birthright");
  const reco = recs.filter(r => r.classification === "recommended");
  const opts = recs.filter(r => r.classification === "optional");
  births.forEach(r => selectedRoles[r.role_id] = true);

  let h = `<div class="ai-banner transfer fadein"><div class="ai-icon purple">&#8644;</div><div class="ai-text">
    <strong>Department transfer detected.</strong> ${id.name} is moving from <strong>${id.from_department} &middot; ${id.from_section}</strong> to <strong>${id.to_department} &middot; ${id.to_section}</strong> (effective ${id.effective_date}).
    <strong>${currentRoles.length} old role(s)</strong> queued for revocation &middot; <strong>${births.length + reco.length} new role(s)</strong> recommended by the peer similarity engine for the new department. Review both actions below before submitting.
  </div></div>
  <div class="delta-banner fadein stagger-1">
    <div class="delta-col revoke"><div class="delta-col-title">&#10005; Revoke &mdash; old dept roles</div>
      ${currentRoles.map(r => `<div class="delta-role-tag revoke-tag"><input type="checkbox" id="rev-${r.role_id}" ${revokeSelections[r.role_id] !== false ? "checked" : ""} onchange="toggleRevoke('${r.role_id}',this.checked)" style="cursor:pointer;accent-color:var(--red)"><label for="rev-${r.role_id}" style="cursor:pointer">${r.role_name}</label></div>`).join("")}
    </div>
    <div class="delta-arrow">&rarr;</div>
    <div class="delta-col grant"><div class="delta-col-title">&#10003; Grant &mdash; new dept roles</div>
      ${births.map(r => `<div class="delta-role-tag grant-tag">&#128274; ${r.role_name} <span style="font-size:9px;opacity:.7">(birthright)</span></div>`).join("")}
      ${reco.map(r => `<div class="delta-role-tag grant-tag" style="opacity:.75">&#9672; ${r.role_name} <span style="font-size:9px;opacity:.7">(review below)</span></div>`).join("")}
    </div>
  </div>
  <div class="section-label fadein stagger-2" style="margin-top:4px">Old department roles &mdash; confirm revocation</div><div class="roles-grid">`;
  currentRoles.forEach((r, i) => h += buildRevokeCard(r, i + 3));
  h += `</div>`;

  if (births.length) { h += `<div class="section-label fadein stagger-3" style="margin-top:18px">New birthright &mdash; auto-granted on transfer</div><div class="roles-grid">`; births.forEach((r, i) => h += buildRoleCard(r, true, i + 4, true)); h += `</div>`; }
  if (reco.length) { h += `<div class="section-label fadein stagger-4" style="margin-top:18px">Peer-recommended for new department</div><div class="roles-grid">`; reco.forEach((r, i) => h += buildRoleCard(r, false, i + 5, true)); h += `</div>`; }
  if (opts.length) { h += `<div class="section-label fadein stagger-5" style="margin-top:18px">Optional &mdash; low peer coverage</div><div class="roles-grid">`; opts.forEach((r, i) => h += buildRoleCard(r, false, i + 6, true)); h += `</div>`; }

  content.innerHTML = h;
  updateSummary(recs, true);
}

function renderPeers(content, isTransfer) {
  const peers = currentData.peers || [];
  const dept = isTransfer ? currentData.identity.to_department : currentData.identity.department;
  let h = `<div class="ai-banner${isTransfer ? " transfer" : ""} fadein"><div class="ai-icon${isTransfer ? " purple" : ""}">&#9672;</div><div class="ai-text">
    Top <strong>${peers.length}</strong> peers in <strong>${dept}${isTransfer ? " (new department)" : ""}</strong>, ranked by organisational-distance weight (section &gt; manager &gt; department &gt; mgr-dept &gt; division). Only <strong>Active</strong> identities are eligible peers.</div></div>
    <div class="peers-grid">`;
  peers.forEach((p, i) => {
    const initials = p.name.split(" ").map(x => x[0]).slice(0, 2).join("");
    h += `<div class="peer-card fadein" style="animation-delay:${i * 0.05}s;opacity:0">
      <div class="peer-card-top"><div class="peer-av">${initials}</div><div><div class="peer-name">${p.name}</div><div class="peer-title">${p.title}</div></div></div>
      <div class="peer-roles">${p.roles.map(r => `<div class="pr-tag">${r}</div>`).join("") || '<span style="font-size:10px;color:var(--text3)">No roles</span>'}</div>
      <div class="match-dim">${p.matched_dimensions.map(d => `<span class="dim-tag${isTransfer ? " purple" : ""}">${d}</span>`).join("")}</div>
    </div>`;
  });
  content.innerHTML = h + `</div>`;
}

function renderMethodology(content, isTransfer) {
  content.innerHTML = `
  <div class="ai-banner${isTransfer ? " transfer" : ""} fadein"><div class="ai-icon${isTransfer ? " purple" : ""}">&#931;</div><div class="ai-text">
  This recommendation was generated by a live call to the Flask backend's <strong>RBACRecommender</strong> engine (models/recommender.py), which implements a weighted peer-similarity scoring model over an Identity &times; Role binary assignment matrix using <strong>scikit-learn</strong> and <strong>pandas</strong>.</div></div>

  <div class="section-label fadein stagger-1">Step 1 &mdash; Organisational distance weight</div>
  <div class="role-card fadein stagger-1" style="margin-bottom:16px">
    <div class="role-desc" style="margin-bottom:10px">Each Active peer is scored against the target identity's attributes. Matching dimensions contribute additively, then the sum is raised to the 4th power to sharply favour close peers over a large population of weakly-related ones (see code comments for the empirical justification).</div>
    <div class="score-bar-row"><span class="score-bar-lbl">Section</span><div class="score-track"><div class="score-fill fill-teal" style="width:35%"></div></div><span class="score-pct">0.35</span></div>
    <div class="score-bar-row"><span class="score-bar-lbl">Manager</span><div class="score-track"><div class="score-fill fill-blue" style="width:25%"></div></div><span class="score-pct">0.25</span></div>
    <div class="score-bar-row"><span class="score-bar-lbl">Department</span><div class="score-track"><div class="score-fill fill-blue" style="width:20%"></div></div><span class="score-pct">0.20</span></div>
    <div class="score-bar-row"><span class="score-bar-lbl">Mgr Department</span><div class="score-track"><div class="score-fill fill-gray" style="width:12%"></div></div><span class="score-pct">0.12</span></div>
    <div class="score-bar-row"><span class="score-bar-lbl">Division</span><div class="score-track"><div class="score-fill fill-gray" style="width:8%"></div></div><span class="score-pct">0.08</span></div>
  </div>

  <div class="section-label fadein stagger-2">Step 2 &mdash; Weighted role adoption score</div>
  <div class="role-card fadein stagger-2" style="margin-bottom:16px">
    <div class="role-desc">For each candidate role <em>r</em> in the target department:</div>
    <div class="modal-payload" style="margin:10px 0">score(r) = &Sigma; [ weight(peer) &times; holds(peer, r) ]  &divide;  &Sigma; [ weight(peer) ]</div>
    <div class="role-desc">This is a weighted mean adoption rate &mdash; mathematically equivalent to a similarity-weighted nearest-neighbour vote, the same family of technique used in item-based collaborative filtering (Sarwar et al., 2001).</div>
  </div>

  <div class="section-label fadein stagger-3">Step 3 &mdash; Classification thresholds</div>
  <div class="role-card fadein stagger-3" style="margin-bottom:16px">
    <div class="role-desc">score &ge; 90% and marked birthright &rarr; <strong style="color:var(--teal)">Birthright</strong> (auto-provision, no review)<br>
    score &ge; 55% &rarr; <strong style="color:var(--blue-light)">Recommended</strong> (suggested to Account Manager)<br>
    score &lt; 55% &rarr; <strong style="color:var(--text3)">Optional</strong> (shown for completeness, low confidence)</div>
  </div>

  <div class="section-label fadein stagger-4">Step 4 &mdash; True cosine similarity (peer diagnostics)</div>
  <div class="role-card fadein stagger-4">
    <div class="role-desc">For Active-to-Active peer comparison (e.g. "who is most similar to this person after their transfer"), the engine separately computes genuine cosine similarity between full role-assignment vectors using <code>sklearn.metrics.pairwise.cosine_similarity</code>:</div>
    <div class="modal-payload" style="margin:10px 0">cos(A,B) = (A &middot; B) / (||A|| &times; ||B||)</div>
    <div class="role-desc">This is exposed via the <code>peer_similarity_ranking()</code> function and demonstrates the genuine ML/statistical technique underpinning the "AI-Based" framing of this system, beyond simple rule-based filtering.</div>
  </div>`;
}

// ─────────────────────────────────────────────
// ROLE CARD BUILDERS
// ─────────────────────────────────────────────
function buildRoleCard(r, locked, delay, isTransfer) {
  const s = r.score;
  const sClass = scoreClass(s, isTransfer);
  const fClass = fillClass(s, isTransfer);
  const sel = selectedRoles[r.role_id] || false;
  const cov = r.peer_coverage;
  const tags = [];
  Object.keys(DIM_LABELS).forEach(dim => {
    if (cov[dim] >= 60) tags.push(`<span class="peer-tag pt-${dim}">${DIM_LABELS[dim]} ${cov[dim]}%</span>`);
  });
  const cClass = locked ? "birthright" : (sel ? (isTransfer ? "transfer-rec selected-transfer" : "recommended selected-role") : (isTransfer ? "transfer-rec" : "recommended"));

  return `<div class="role-card ${cClass} fadein" style="animation-delay:${delay * 0.05}s;opacity:0" id="rc-${r.role_id}">
    <div class="role-top">
      <div class="role-left"><div class="role-name">${r.role_name}</div><div class="role-desc">${r.category} role &middot; ${r.role_id}</div></div>
      <div class="role-right"><div class="score-num ${sClass}">${locked ? "&mdash;" : s}</div><div class="score-lbl">${locked ? "birthright" : "match score"}</div></div>
    </div>
    ${!locked ? `
    <div class="score-bar-row"><span class="score-bar-lbl">Section peers</span><div class="score-track"><div class="score-fill ${fClass}" style="width:${cov.section}%"></div></div><span class="score-pct">${cov.section}%</span></div>
    <div class="score-bar-row"><span class="score-bar-lbl">Manager peers</span><div class="score-track"><div class="score-fill ${fClass}" style="width:${cov.manager}%"></div></div><span class="score-pct">${cov.manager}%</span></div>
    <div class="score-bar-row"><span class="score-bar-lbl">Dept peers</span><div class="score-track"><div class="score-fill ${fClass}" style="width:${cov.department}%"></div></div><span class="score-pct">${cov.department}%</span></div>` : ""}
    <div class="peer-tags">${tags.join("") || (!locked ? `<span style="font-size:10px;color:var(--text3)">Low coverage across all peer dimensions</span>` : "")}</div>
    <div class="role-foot"><span class="cat-badge ${catClass(r.category)}">${r.category}</span>
    ${locked ? `<div class="birth-lock" style="margin-left:auto">&#128274; Auto-granted &middot; no action required</div>` :
        sel ? `<button class="btn btn-sm btn-ghost" onclick="toggleRole('${r.role_id}',false,${isTransfer})" style="margin-left:auto;color:var(--red)">&#10005; Remove</button><span style="font-size:11px;color:${isTransfer ? "#A78BFA" : "var(--teal)"}">&#10003; Added</span>` :
          `<button class="btn btn-sm ${isTransfer ? "btn-purple" : "btn-primary"}" onclick="toggleRole('${r.role_id}',true,${isTransfer})" style="margin-left:auto">+ Add to request</button>`}
    </div></div>`;
}

function buildRevokeCard(r, delay) {
  const confirmed = revokeSelections[r.role_id] !== false;
  return `<div class="role-card revoke-card${confirmed ? " selected-revoke" : ""} fadein" style="animation-delay:${delay * 0.05}s;opacity:0" id="rvc-${r.role_id}">
    <div class="role-top">
      <div class="role-left"><div class="role-name" style="color:${confirmed ? "var(--red)" : "var(--text)"}">${r.role_name}</div><div class="role-desc">${r.category} role &middot; ${r.role_id}</div></div>
      <div class="role-right"><div style="font-size:11px;font-weight:600;color:${confirmed ? "var(--red)" : "var(--text3)"}">${confirmed ? "REVOKE" : "KEEP"}</div><div style="font-size:10px;color:var(--text3);margin-top:2px">old dept role</div></div>
    </div>
    <div class="peer-tags"><span style="font-size:10px;color:var(--text3)">Currently assigned &middot; will be revoked on transfer unless kept</span></div>
    <div class="role-foot"><span class="cat-badge ${catClass(r.category)}">${r.category}</span>
    ${confirmed ? `<button class="btn btn-sm btn-ghost" onclick="toggleRevoke('${r.role_id}',false)" style="margin-left:auto;color:var(--text2)">&#8617; Keep this role</button><span style="font-size:11px;color:var(--red)">&#9888; Will be revoked</span>` :
      `<button class="btn btn-sm btn-danger-outline" onclick="toggleRevoke('${r.role_id}',true)" style="margin-left:auto">&#10005; Mark for revocation</button><span style="font-size:11px;color:var(--teal)">&#10003; Keeping</span>`}
    </div></div>`;
}

// ─────────────────────────────────────────────
// TOGGLE HANDLERS
// ─────────────────────────────────────────────
function toggleRole(rid, val, isTransfer) {
  selectedRoles[rid] = val;
  const r = currentData.recommendations.find(x => x.role_id === rid);
  if (!r) return;
  const el = document.getElementById("rc-" + rid);
  if (!el) return;
  el.className = `role-card ${val ? (isTransfer ? "transfer-rec selected-transfer" : "recommended selected-role") : (isTransfer ? "transfer-rec" : "recommended")} fadein`;
  el.querySelector(".role-foot").innerHTML = `<span class="cat-badge ${catClass(r.category)}">${r.category}</span>` +
    (val ? `<button class="btn btn-sm btn-ghost" onclick="toggleRole('${rid}',false,${isTransfer})" style="margin-left:auto;color:var(--red)">&#10005; Remove</button><span style="font-size:11px;color:${isTransfer ? "#A78BFA" : "var(--teal)"}">&#10003; Added</span>` :
      `<button class="btn btn-sm ${isTransfer ? "btn-purple" : "btn-primary"}" onclick="toggleRole('${rid}',true,${isTransfer})" style="margin-left:auto">+ Add to request</button>`);
  updateSummary(currentData.recommendations, isTransfer);
  showToast(val ? `"${r.role_name}" added` : `"${r.role_name}" removed`);
}

function toggleRevoke(rid, val) {
  revokeSelections[rid] = val;
  const cb = document.getElementById("rev-" + rid);
  if (cb) cb.checked = val;
  const r = (currentData.current_roles || []).find(x => x.role_id === rid);
  if (!r) return;
  const el = document.getElementById("rvc-" + rid);
  if (!el) return;
  el.className = `role-card revoke-card${val ? " selected-revoke" : ""} fadein`;
  el.querySelector(".role-name").style.color = val ? "var(--red)" : "var(--text)";
  el.querySelector(".role-foot").innerHTML = `<span class="cat-badge ${catClass(r.category)}">${r.category}</span>` +
    (val ? `<button class="btn btn-sm btn-ghost" onclick="toggleRevoke('${rid}',false)" style="margin-left:auto;color:var(--text2)">&#8617; Keep this role</button><span style="font-size:11px;color:var(--red)">&#9888; Will be revoked</span>` :
      `<button class="btn btn-sm btn-danger-outline" onclick="toggleRevoke('${rid}',true)" style="margin-left:auto">&#10005; Mark for revocation</button><span style="font-size:11px;color:var(--teal)">&#10003; Keeping</span>`);
  updateSummary(currentData.recommendations, true);
  showToast(val ? `"${r.role_name}" marked for revocation` : `"${r.role_name}" will be kept`);
}

// ─────────────────────────────────────────────
// SUMMARY BAR
// ─────────────────────────────────────────────
function updateSummary(recs, isTransfer) {
  const sel = Object.values(selectedRoles).filter(Boolean).length;
  const birth = recs.filter(r => r.classification === "birthright").length;
  const revCnt = Object.values(revokeSelections).filter(Boolean).length;
  const sc = document.getElementById("sum-chips"), pf = document.getElementById("prog-fill"), pl = document.getElementById("prog-lbl");
  if (sc) sc.innerHTML = isTransfer
    ? `<div class="sum-chip">Grant: <strong>${sel}</strong> roles</div><div class="sum-chip" style="color:var(--text3)">|</div><div class="sum-chip">Revoke: <strong style="color:var(--red)">${revCnt}</strong> roles</div>`
    : `<div class="sum-chip">Selected: <strong>${sel}</strong> roles</div><div class="sum-chip" style="color:var(--text3)">|</div><div class="sum-chip">Birthright: <strong style="color:var(--teal)">${birth}</strong> auto-assigned</div>`;
  if (pf) pf.style.width = Math.round(sel / Math.max(recs.length, 1) * 100) + "%";
  if (pl) pl.textContent = isTransfer ? `${revCnt} revocations \u00b7 ${sel} grants pending` : `${sel} of ${recs.length} roles reviewed`;
}

// ─────────────────────────────────────────────
// MODALS
// ─────────────────────────────────────────────
function openModal() {
  const chosen = currentData.recommendations.filter(r => selectedRoles[r.role_id]);
  if (!chosen.length) { showToast("Select at least one role before submitting"); return; }
  const id = currentData.identity;
  document.getElementById("modal-box").innerHTML = `<div class="modal-title">Submit Access Request to SailPoint ISC</div>
    <div class="modal-sub">The following roles will be submitted for <strong>${id.name}</strong> (${id.identity_id}). Existing approval workflows and SoD policies apply.</div>
    <div class="modal-section">Roles to Grant</div>
    <div class="modal-role-list">${chosen.map(r => `<div class="modal-role grant"><span class="cat-badge ${catClass(r.category)}">${r.category}</span><span class="modal-role-name">${r.role_name}</span>${r.classification === "birthright" ? `<span style="font-size:10px;color:var(--teal)">&#128274; Birthright</span>` : `<span style="font-size:10px;color:var(--blue-light)">score: ${r.score}%</span>`}</div>`).join("")}</div>
    <div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-top:14px">ISC API Payload Preview</div>
    <div class="modal-payload">POST /v3/access-requests\n${JSON.stringify({ requestedFor: [id.identity_id], requestType: "GRANT_ACCESS", requestedItems: chosen.map(r => ({ type: "ROLE", id: r.role_id, name: r.role_name })) }, null, 2)}</div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-success" onclick="submitToISC(false)">&#10003; Confirm &amp; Submit</button></div>`;
  document.getElementById("modal").classList.add("show");
}

function openTransferModal() {
  const id = currentData.identity;
  const grantRoles = currentData.recommendations.filter(r => selectedRoles[r.role_id]);
  const allCurrent = currentData.current_roles || [];
  const revokeRoles = allCurrent.filter(r => revokeSelections[r.role_id] !== false);
  const keepRoles = allCurrent.filter(r => revokeSelections[r.role_id] === false);
  if (!grantRoles.length && !revokeRoles.length) { showToast("No changes to submit"); return; }

  document.getElementById("modal-box").innerHTML = `<div class="modal-title">&#8644; Submit Department Transfer Request</div>
    <div class="modal-sub">Processing transfer for <strong>${id.name}</strong>: <strong>${id.from_department}</strong> &rarr; <strong>${id.to_department}</strong> &middot; Effective ${id.effective_date}.</div>
    ${revokeRoles.length ? `<div class="modal-section" style="color:var(--red)">Roles to Revoke (${revokeRoles.length})</div><div class="modal-role-list">${revokeRoles.map(r => `<div class="modal-role revoke"><span class="cat-badge ${catClass(r.category)}">${r.category}</span><span class="modal-role-name">${r.role_name}</span><span style="font-size:10px;color:var(--red)">&#10005; Revoke</span></div>`).join("")}</div>` : ""}
    ${keepRoles.length ? `<div class="modal-section" style="color:var(--text3)">Roles Retained (${keepRoles.length})</div><div class="modal-role-list">${keepRoles.map(r => `<div class="modal-role"><span class="cat-badge ${catClass(r.category)}">${r.category}</span><span class="modal-role-name">${r.role_name}</span><span style="font-size:10px;color:var(--text3)">&#8617; Retained</span></div>`).join("")}</div>` : ""}
    ${grantRoles.length ? `<div class="modal-section" style="color:var(--teal)">Roles to Grant (${grantRoles.length})</div><div class="modal-role-list">${grantRoles.map(r => `<div class="modal-role grant"><span class="cat-badge ${catClass(r.category)}">${r.category}</span><span class="modal-role-name">${r.role_name}</span>${r.classification === "birthright" ? `<span style="font-size:10px;color:var(--teal)">&#128274; Birthright</span>` : `<span style="font-size:10px;color:#A78BFA">score: ${r.score}%</span>`}</div>`).join("")}</div>` : ""}
    <div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-top:14px">ISC API Payload Preview</div>
    <div class="modal-payload">${revokeRoles.length ? "POST /v3/access-requests (REVOKE)\n" + JSON.stringify({ requestedFor: [id.identity_id], requestType: "REVOKE_ACCESS", requestedItems: revokeRoles.map(r => ({ type: "ROLE", id: r.role_id, name: r.role_name })) }, null, 2) + "\n\n" : ""}${grantRoles.length ? "POST /v3/access-requests (GRANT)\n" + JSON.stringify({ requestedFor: [id.identity_id], requestType: "GRANT_ACCESS", requestedItems: grantRoles.map(r => ({ type: "ROLE", id: r.role_id, name: r.role_name })) }, null, 2) : ""}</div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-purple" onclick="submitToISC(true)">&#8644; Confirm Transfer</button></div>`;
  document.getElementById("modal").classList.add("show");
}

function closeModal() { document.getElementById("modal").classList.remove("show"); }

// ─────────────────────────────────────────────
// SUBMIT -> backend /api/submit
// ─────────────────────────────────────────────
async function submitToISC(isTransfer) {
  closeModal();
  const id = currentData.identity;
  const grantRoles = currentData.recommendations.filter(r => selectedRoles[r.role_id]);
  const revokeRoles = isTransfer ? (currentData.current_roles || []).filter(r => revokeSelections[r.role_id] !== false) : [];

  const payload = {
    identity_id: id.identity_id,
    identity_name: id.name,
    kind: isTransfer ? "transfer" : "prehire",
    grant_roles: grantRoles.map(r => ({ role_id: r.role_id, role_name: r.role_name })),
    revoke_roles: revokeRoles.map(r => ({ role_id: r.role_id, role_name: r.role_name })),
  };

  let resp;
  try {
    resp = await fetchJSON("/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    showToast("Submission failed: " + e.message);
    return;
  }

  const icon = document.getElementById("success-icon");
  if (isTransfer) {
    icon.className = "success-icon purple-icon"; icon.textContent = "\u21C4";
    document.getElementById("success-title").textContent = "Transfer Request Submitted";
    document.getElementById("success-sub").textContent = `${id.name} \u00b7 ${id.from_department} \u2192 ${id.to_department} \u00b7 Effective ${id.effective_date}`;
    document.getElementById("success-chips").innerHTML = `<div class="success-chip" style="background:rgba(232,68,90,0.15);color:#F08090;border:1px solid rgba(232,68,90,0.3)">${revokeRoles.length} roles revoked</div><div class="success-chip" style="background:rgba(0,201,167,0.15);color:#00C9A7;border:1px solid rgba(0,201,167,0.3)">${grantRoles.length} roles granted</div>`;
  } else {
    icon.className = "success-icon"; icon.textContent = "\u2713";
    document.getElementById("success-title").textContent = "Access Request Submitted";
    document.getElementById("success-sub").textContent = `${grantRoles.length} role(s) submitted for ${id.name} \u00b7 Pending ISC approval workflow`;
    document.getElementById("success-chips").innerHTML = `<div class="success-chip" style="background:rgba(0,201,167,0.15);color:#00C9A7;border:1px solid rgba(0,201,167,0.3)">${grantRoles.length} roles granted</div>`;
  }
  document.getElementById("success-detail").innerHTML = `Request ID: ${resp.request_id} \u00b7 ${new Date(resp.timestamp).toLocaleTimeString()}<br>Endpoint: ${resp.isc_endpoint} \u00b7 ${resp.message}`;
  document.getElementById("success-overlay").classList.add("show");
}

function closeSuccess() {
  document.getElementById("success-overlay").classList.remove("show");
  selectedId = null; selectedKind = null; currentData = null; selectedRoles = {}; revokeSelections = {};
  document.getElementById("empty-state").style.display = "flex";
  document.getElementById("detail-view").style.display = "none";
  renderList();
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.innerHTML = `<span style="color:var(--teal)">&#9672;</span> ${msg}`;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2800);
}

init();
