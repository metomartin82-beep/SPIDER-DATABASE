// ============================================================
// SpiderDB — shared site behavior
// ============================================================

// Mobile nav
function toggleMobileNav(){
  document.querySelector('.mobile-nav')?.classList.toggle('open');
}

// Scroll reveal
document.addEventListener('DOMContentLoaded', () => {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => { if(e.isIntersecting) e.target.classList.add('in'); });
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach(el => io.observe(el));

  buildWebDiagram();
  initCodeTabs();
});

// Code sample tab switcher
function initCodeTabs(){
  document.querySelectorAll('.code-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const panel = tab.closest('.code-panel');
      panel.querySelectorAll('.code-tab').forEach(t => t.classList.remove('active'));
      panel.querySelectorAll('.code-pane').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      panel.querySelector(`[data-pane="${tab.dataset.tab}"]`).classList.add('active');
    });
  });
}

// The hero signature: a center node ("your app") radiating silk threads
// out to a scatter of isolated database nodes. Built as SVG so it stays
// crisp, animates on load, and needs no external assets.
function buildWebDiagram(){
  const mount = document.getElementById('web-diagram-svg');
  if(!mount) return;

  const W = 1100, H = 420;
  const cx = W / 2, cy = H / 2;

  const dbNames = [
    'tenant_042.db','user_a91f.db','org_beta.db','acct_7x3.db','app_prod.db',
    'user_c14.db','tenant_119.db','shard_04.db','user_9f2.db','org_delta.db',
    'acct_2ke.db','tenant_071.db','user_b83.db','app_stage.db','org_iota.db',
    'user_e5c.db','tenant_205.db','acct_kx9.db'
  ];

  const nodes = dbNames.map((name, i) => {
    const angle = (i / dbNames.length) * Math.PI * 2 - Math.PI / 2;
    const radius = 150 + (i % 3) * 34;
    const x = cx + Math.cos(angle) * radius * (W > 700 ? 1 : 0.6);
    const y = cy + Math.sin(angle) * radius * 0.82;
    return { x, y, name, delay: 0.15 + i * 0.045 };
  });

  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Diagram: one isolated database spun per user, radiating from your app">`;

  // threads
  nodes.forEach((n, i) => {
    const midX = (cx + n.x) / 2 + (i % 2 === 0 ? 18 : -18);
    const midY = (cy + n.y) / 2;
    svg += `<path class="web-thread${i % 3 === 0 ? ' slow' : ''}" style="animation-delay:${n.delay}s" d="M${cx},${cy} Q${midX},${midY} ${n.x},${n.y}"/>`;
  });

  // center node
  svg += `<g class="web-node center" style="animation-delay:0s">
    <circle class="dot" cx="${cx}" cy="${cy}" r="7"/>
    <text x="${cx}" y="${cy - 16}" text-anchor="middle">your app</text>
  </g>`;

  // satellite nodes
  nodes.forEach((n, i) => {
    const pulse = i % 4 === 0;
    svg += `<g class="web-node${pulse ? ' pulse' : ''}" style="animation-delay:${n.delay + 0.3}s">
      ${pulse ? `<circle class="pulse-ring" cx="${n.x}" cy="${n.y}" r="4" style="animation-delay:${n.delay + 1}s"/>` : ''}
      <circle class="dot" cx="${n.x}" cy="${n.y}" r="3.5"/>
      <text x="${n.x}" y="${n.y - 10}" text-anchor="middle">${n.name}</text>
    </g>`;
  });

  svg += `</svg>`;
  mount.innerHTML = svg;
}
