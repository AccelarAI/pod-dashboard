// ============================================================
// Pod Dashboard — AAA Accelerator
// ============================================================

const SUPABASE_URL = 'https://jngaimwmdntcydqefryt.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_IIWDOFGb41BZC9J8XS-BAA_YiO1FQMv';
const PASSWORD = 'pod2026';

let db;
let currentMeetingId = null;
let members = [];
let topicFilter = 'open';

// --- AUTH ---
function attemptLogin() {
  const pw = document.getElementById('password-input').value;
  if (pw === PASSWORD) {
    sessionStorage.setItem('pod_auth', '1');
    showDashboard();
  } else {
    document.getElementById('login-error').classList.remove('hidden');
  }
}
document.getElementById('password-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') attemptLogin();
});
function logout() { sessionStorage.removeItem('pod_auth'); location.reload(); }
function showDashboard() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  init();
}

// --- INIT ---
async function init() {
  db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  await loadMembers();
  // Global data (no meeting needed)
  await loadAgenda();
  await loadTopics();
  // Meeting data
  await loadMeetings();
  setupPasteZone();
  setupRealtimeSubscriptions();
}

// --- MEMBERS ---
async function loadMembers() {
  const { data } = await db.from('members').select('*').order('name');
  members = data || [];
  // Populate all member dropdowns
  const checkinSel = document.getElementById('checkin-member');
  checkinSel.innerHTML = '<option value="">Choose name...</option>' +
    members.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
  const topicSel = document.getElementById('new-topic-by');
  topicSel.innerHTML = '<option value="">Name</option>' +
    members.map(m => `<option value="${m.name}">${m.name}</option>`).join('');
}

// --- MEMBER MANAGEMENT ---
function toggleMemberManager() {
  document.getElementById('member-manager').classList.toggle('hidden');
  renderMemberList();
}

function renderMemberList() {
  const container = document.getElementById('member-list');
  container.innerHTML = members.map(m => `
    <div class="member-manage-row">
      <span>${esc(m.name)}</span>
      <span class="delete-btn" onclick="removeMember('${m.id}')" title="Remove member">×</span>
    </div>
  `).join('');
}

async function addMember() {
  const input = document.getElementById('new-member-name');
  const name = input.value.trim();
  if (!name) return;
  const { data: newMember } = await db.from('members').insert({ name }).select().single();
  input.value = '';
  await loadMembers();
  renderMemberList();
  // Add attendance for all existing meetings
  if (newMember) {
    const { data: meetings } = await db.from('meetings').select('id');
    if (meetings) {
      for (const mtg of meetings) {
        await db.from('attendance').insert({ meeting_id: mtg.id, member_id: newMember.id, present: false });
      }
    }
  }
  if (currentMeetingId) await loadAttendance();
}

async function removeMember(id) {
  const member = members.find(m => m.id === id);
  if (!confirm(`Remove ${member?.name || 'this member'}? This also removes their attendance and check-in records.`)) return;
  await db.from('checkins').delete().eq('member_id', id);
  await db.from('attendance').delete().eq('member_id', id);
  await db.from('members').delete().eq('id', id);
  await loadMembers();
  renderMemberList();
  if (currentMeetingId) await loadAttendance();
}

// --- MEETINGS ---
async function loadMeetings() {
  const { data } = await db.from('meetings').select('*').order('date', { ascending: false });
  const sel = document.getElementById('meeting-selector');
  const content = document.getElementById('meeting-content');
  const noMsg = document.getElementById('no-meeting-msg');

  if (!data || data.length === 0) {
    sel.innerHTML = '<option>No meetings yet</option>';
    currentMeetingId = null;
    content.classList.add('hidden');
    noMsg.classList.remove('hidden');
    return;
  }

  noMsg.classList.add('hidden');
  content.classList.remove('hidden');
  sel.innerHTML = data.map(m =>
    `<option value="${m.id}">${formatDate(m.date)}${m.title ? ' — ' + m.title : ''}</option>`
  ).join('');
  currentMeetingId = data[0].id;
  await loadMeetingData();
}

async function switchMeeting() {
  currentMeetingId = document.getElementById('meeting-selector').value;
  await loadMeetingData();
}

async function createNewMeeting() {
  const title = prompt('Meeting title (optional):') || '';
  const dateStr = prompt('Date (YYYY-MM-DD):', new Date().toISOString().split('T')[0]);
  if (!dateStr) return;

  // Generate recap from previous meeting
  const { data: prevMeetings } = await db.from('meetings').select('id').order('date', { ascending: false }).limit(1);
  let autoRecap = '';
  if (prevMeetings && prevMeetings.length > 0) {
    autoRecap = await generateRecap(prevMeetings[0].id);
  }

  const { data } = await db.from('meetings').insert({
    date: dateStr, title, summary: autoRecap
  }).select().single();

  if (data) {
    const rows = members.map(m => ({ meeting_id: data.id, member_id: m.id, present: false }));
    if (rows.length) await db.from('attendance').upsert(rows, { onConflict: 'meeting_id,member_id' });
    await loadMeetings();
  }
}

async function deleteMeeting() {
  if (!currentMeetingId) return;
  const sel = document.getElementById('meeting-selector');
  const name = sel.options[sel.selectedIndex]?.text || '';
  if (!confirm(`Delete "${name}"? This removes all its data.`)) return;
  await db.from('meetings').delete().eq('id', currentMeetingId);
  await loadMeetings();
}

async function generateRecap(meetingId) {
  const { data: att } = await db.from('attendance')
    .select('present, member_id, members(name)').eq('meeting_id', meetingId);
  // Deduplicate by member_id
  const seen = new Set();
  const uniqueAtt = (att || []).filter(a => {
    if (seen.has(a.member_id)) return false;
    seen.add(a.member_id);
    return true;
  });
  const presentNames = uniqueAtt.filter(a => a.present).map(a => a.members?.name).filter(Boolean);
  const absentNames = uniqueAtt.filter(a => !a.present).map(a => a.members?.name).filter(Boolean);

  const { data: topics } = await db.from('topics')
    .select('text').eq('discussed', true).eq('meeting_id', meetingId);

  const { data: checkins } = await db.from('checkins')
    .select('members(name), goals, challenges').eq('meeting_id', meetingId);

  let recap = '';
  if (presentNames.length) recap += `**Present:** ${presentNames.join(', ')}\n`;
  if (absentNames.length) recap += `**Absent:** ${absentNames.join(', ')}\n`;
  if (topics && topics.length) {
    recap += `\n**Topics discussed:**\n`;
    topics.forEach(t => recap += `• ${t.text}\n`);
  }
  if (checkins && checkins.length) {
    recap += `\n**Check-in highlights:**\n`;
    checkins.forEach(c => {
      const name = c.members?.name || '?';
      if (c.goals) recap += `• ${name} — Goals: ${c.goals.substring(0, 120)}\n`;
      if (c.challenges) recap += `• ${name} — Challenge: ${c.challenges.substring(0, 120)}\n`;
    });
  }
  return recap;
}

async function loadMeetingData() {
  if (!currentMeetingId) return;
  await Promise.all([loadAttendance(), loadCheckins(), loadRecap()]);
}

// =============================================
// GLOBAL: AGENDA (standing agenda, not per meeting)
// =============================================
async function loadAgenda() {
  const { data } = await db.from('agenda_defaults').select('*').order('position');
  const container = document.getElementById('agenda-items');
  if (!data || data.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">No agenda items yet — add your standing agenda below.</p>';
    return;
  }
  container.innerHTML = data.map(item => `
    <div class="agenda-item" draggable="true" data-id="${item.id}">
      <span class="drag-handle">⠿</span>
      <span class="time-badge">${item.duration_min} min</span>
      <span class="text">${esc(item.text)}</span>
      <span class="delete-btn" onclick="deleteAgendaItem('${item.id}')">×</span>
    </div>
  `).join('');
  setupAgendaDragDrop();
}

async function addAgendaItem() {
  const text = document.getElementById('new-agenda-text').value.trim();
  const dur = parseInt(document.getElementById('new-agenda-time').value) || 5;
  if (!text) return;
  const { data: existing } = await db.from('agenda_defaults')
    .select('position').order('position', { ascending: false }).limit(1);
  const pos = existing && existing.length ? existing[0].position + 1 : 0;
  await db.from('agenda_defaults').insert({ text, duration_min: dur, position: pos });
  document.getElementById('new-agenda-text').value = '';
  await loadAgenda();
}

async function deleteAgendaItem(id) {
  await db.from('agenda_defaults').delete().eq('id', id);
  await loadAgenda();
}

function setupAgendaDragDrop() {
  const items = document.querySelectorAll('.agenda-item');
  items.forEach(item => {
    item.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', item.dataset.id);
      item.style.opacity = '0.4';
    });
    item.addEventListener('dragend', () => item.style.opacity = '1');
    item.addEventListener('dragover', e => e.preventDefault());
    item.addEventListener('drop', async e => {
      e.preventDefault();
      const draggedId = e.dataTransfer.getData('text/plain');
      const targetId = item.dataset.id;
      if (draggedId === targetId) return;
      const { data: all } = await db.from('agenda_defaults')
        .select('id,position').order('position');
      const ids = all.map(a => a.id);
      const fromIdx = ids.indexOf(draggedId);
      const toIdx = ids.indexOf(targetId);
      ids.splice(fromIdx, 1);
      ids.splice(toIdx, 0, draggedId);
      for (let i = 0; i < ids.length; i++) {
        await db.from('agenda_defaults').update({ position: i }).eq('id', ids[i]);
      }
      await loadAgenda();
    });
  });
}

// =============================================
// GLOBAL: TOPICS (backlog with date + member)
// =============================================
async function loadTopics() {
  let query = db.from('topics').select('*').order('created_at', { ascending: false });
  if (topicFilter === 'open') query = query.eq('discussed', false);
  else query = query.eq('discussed', true);

  const { data } = await query;
  const container = document.getElementById('topics-list');

  if (!data || data.length === 0) {
    container.innerHTML = `<p style="color:var(--text-muted);font-size:13px;">${topicFilter === 'open' ? 'No open topics' : 'Nothing discussed yet'}</p>`;
    return;
  }

  container.innerHTML = data.map(t => `
    <div class="topic-item">
      <div class="topic-checkbox ${t.discussed ? 'checked' : ''}"
        onclick="toggleTopic('${t.id}', ${!t.discussed})" title="${t.discussed ? 'Mark as open' : 'Mark as discussed'}"></div>
      <div style="flex:1">
        <div class="topic-text ${t.discussed ? 'discussed' : ''}">${esc(t.text)}</div>
        <div class="topic-meta">
          ${t.added_by ? '<span class="topic-by">' + esc(t.added_by) + '</span>' : ''}
          <span class="topic-date">${formatShortDate(t.created_at)}</span>
        </div>
      </div>
      <span class="delete-btn" onclick="deleteTopic('${t.id}')">×</span>
    </div>
  `).join('');
}

function filterTopics(filter) {
  topicFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
  loadTopics();
}

async function addTopic() {
  const text = document.getElementById('new-topic-text').value.trim();
  const by = document.getElementById('new-topic-by').value;
  if (!text) return;
  await db.from('topics').insert({ text, added_by: by, discussed: false, meeting_id: null });
  document.getElementById('new-topic-text').value = '';
  document.getElementById('new-topic-by').selectedIndex = 0;
  await loadTopics();
}

async function toggleTopic(id, val) {
  await db.from('topics').update({
    discussed: val,
    meeting_id: val ? currentMeetingId : null
  }).eq('id', id);
  await loadTopics();
}

async function deleteTopic(id) {
  await db.from('topics').delete().eq('id', id);
  await loadTopics();
}

// =============================================
// PER MEETING: ATTENDANCE
// =============================================
async function loadAttendance() {
  const { data } = await db.from('attendance')
    .select('*, members(name)').eq('meeting_id', currentMeetingId);
  const container = document.getElementById('attendance-list');

  if (!data || data.length === 0) {
    // Auto-create attendance records if members exist
    if (members.length && currentMeetingId) {
      for (const m of members) {
        await db.from('attendance').insert({ meeting_id: currentMeetingId, member_id: m.id, present: false }).select();
      }
      // Re-fetch after creating
      const { data: fresh } = await db.from('attendance')
        .select('*, members(name)').eq('meeting_id', currentMeetingId);
      if (fresh && fresh.length > 0) {
        renderAttendance(fresh, container);
        return;
      }
    }
    container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">No members</p>';
    return;
  }

  renderAttendance(data, container);
}

function renderAttendance(data, container) {
  const seen = new Set();
  const unique = data.filter(a => {
    if (seen.has(a.member_id)) return false;
    seen.add(a.member_id);
    return true;
  });

  const present = unique.filter(d => d.present).length;
  container.innerHTML = unique.map(a => `
    <div class="member-row">
      <span class="member-name">${esc(a.members?.name || '?')}</span>
      <button class="attendance-toggle ${a.present ? 'present' : 'absent'}"
        onclick="toggleAttendance('${a.id}', ${!a.present})"></button>
    </div>
  `).join('') + `<div style="margin-top:8px;font-size:12px;color:var(--text-muted);">${present}/${unique.length} present</div>`;
}

async function toggleAttendance(id, val) {
  await db.from('attendance').update({ present: val }).eq('id', id);
  await loadAttendance();
}

// =============================================
// PER MEETING: CHECK-INS
// =============================================
async function loadCheckins() {
  const { data } = await db.from('checkins')
    .select('*, members(name)').eq('meeting_id', currentMeetingId).order('created_at');
  const container = document.getElementById('checkin-list');

  if (!data || data.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">No check-ins yet</p>';
    return;
  }

  container.innerHTML = data.map(c => `
    <div class="checkin-entry">
      <div class="checkin-header">
        <h3>${esc(c.members?.name || 'Unknown')}</h3>
        <span class="delete-btn" onclick="deleteCheckin('${c.id}')" title="Delete check-in">×</span>
      </div>
      ${c.goals ? `<div class="field"><div class="field-label">🎯 Goals</div>${esc(c.goals)}</div>` : ''}
      ${c.progress ? `<div class="field"><div class="field-label">📈 Progress</div>${esc(c.progress)}</div>` : ''}
      ${c.challenges ? `<div class="field"><div class="field-label">⚡ Challenges</div>${esc(c.challenges)}</div>` : ''}
      ${c.support ? `<div class="field"><div class="field-label">🤝 Support needed</div>${esc(c.support)}</div>` : ''}
      ${c.screenshot_url ? `<img src="${c.screenshot_url}" alt="Check-in screenshot">` : ''}
    </div>
  `).join('');
}

let pastedImageBase64 = null;

function setupPasteZone() {
  const zone = document.getElementById('paste-zone');
  zone.addEventListener('click', () => zone.focus());
  zone.setAttribute('tabindex', '0');
  zone.addEventListener('paste', async e => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        const reader = new FileReader();
        reader.onload = async ev => {
          pastedImageBase64 = ev.target.result;
          document.getElementById('checkin-preview').src = pastedImageBase64;
          document.getElementById('checkin-preview').classList.remove('hidden');
          zone.textContent = '✅ Screenshot pasted!';
          zone.classList.add('active');

          const statusEl = document.getElementById('ocr-status');
          statusEl.classList.remove('hidden');
          statusEl.textContent = '🔍 Reading screenshot text...';
          try {
            const { data: { text } } = await Tesseract.recognize(pastedImageBase64, 'eng');
            statusEl.classList.add('hidden');
            const parsed = parseCheckinText(text);
            if (parsed.goals) document.getElementById('checkin-goals').value = parsed.goals;
            if (parsed.progress) document.getElementById('checkin-progress').value = parsed.progress;
            if (parsed.challenges) document.getElementById('checkin-challenges').value = parsed.challenges;
            if (parsed.support) document.getElementById('checkin-support').value = parsed.support;
          } catch {
            statusEl.textContent = '⚠️ Could not read text';
            setTimeout(() => statusEl.classList.add('hidden'), 3000);
          }
        };
        reader.readAsDataURL(file);
        e.preventDefault();
        return;
      }
    }
  });
}

function parseCheckinText(text) {
  const result = { goals: '', progress: '', challenges: '', support: '' };
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let currentField = null;
  const fieldMap = {
    'goals': ['goal', 'objectives', 'priorities', 'main goals'],
    'progress': ['progress', 'achievements', 'completed', 'made since'],
    'challenges': ['challenge', 'obstacle', 'difficult', 'facing'],
    'support': ['support', 'help', 'need from', 'pod']
  };
  for (const line of lines) {
    const lower = line.toLowerCase();
    let matched = false;
    for (const [field, keywords] of Object.entries(fieldMap)) {
      if (keywords.some(k => lower.includes(k)) && lower.length < 80) {
        currentField = field;
        matched = true;
        break;
      }
    }
    if (!matched && currentField) {
      if (lower.includes('describe your') || lower.includes('share your') || lower.includes('let your pod')) continue;
      result[currentField] += (result[currentField] ? '\n' : '') + line;
    }
  }
  if (!Object.values(result).some(v => v.trim()) && lines.length) result.goals = lines.join('\n');
  return result;
}

async function submitCheckin() {
  const memberId = document.getElementById('checkin-member').value;
  if (!memberId) { alert('Choose a name first'); return; }
  if (!currentMeetingId) { alert('Create a meeting first'); return; }

  const goals = document.getElementById('checkin-goals').value.trim();
  const progress = document.getElementById('checkin-progress').value.trim();
  const challenges = document.getElementById('checkin-challenges').value.trim();
  const support = document.getElementById('checkin-support').value.trim();

  let screenshotUrl = null;
  if (pastedImageBase64) {
    const blob = await (await fetch(pastedImageBase64)).blob();
    const filename = `checkin_${currentMeetingId}_${memberId}_${Date.now()}.png`;
    const { data: upload } = await db.storage.from('checkins').upload(filename, blob, { contentType: 'image/png' });
    if (upload) {
      const { data: urlData } = db.storage.from('checkins').getPublicUrl(filename);
      screenshotUrl = urlData.publicUrl;
    }
  }

  await db.from('checkins').insert({
    meeting_id: currentMeetingId, member_id: memberId,
    goals, progress, challenges, support, screenshot_url: screenshotUrl
  });

  // Reset
  ['checkin-goals','checkin-progress','checkin-challenges','checkin-support'].forEach(id => document.getElementById(id).value = '');
  pastedImageBase64 = null;
  document.getElementById('checkin-preview').classList.add('hidden');
  document.getElementById('paste-zone').textContent = '📋 Click here and paste (Ctrl+V) a check-in screenshot';
  document.getElementById('paste-zone').classList.remove('active');
  await loadCheckins();
}

async function deleteCheckin(id) {
  if (!confirm('Delete this check-in?')) return;
  await db.from('checkins').delete().eq('id', id);
  await loadCheckins();
}

// =============================================
// PER MEETING: RECAP / SUMMARY
// =============================================
async function loadRecap() {
  const { data: allMeetings } = await db.from('meetings')
    .select('*').order('date', { ascending: false });
  const recapEl = document.getElementById('prev-recap');
  const summaryEl = document.getElementById('prev-summary');

  if (!allMeetings || allMeetings.length === 0) return;

  const currentIdx = allMeetings.findIndex(m => m.id === currentMeetingId);
  const current = allMeetings[currentIdx];

  // Show auto-recap stored in this meeting's summary
  if (current && current.summary) {
    recapEl.innerHTML = '<strong>Previous meeting recap:</strong><br>' + formatRecap(current.summary);
  } else {
    recapEl.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">No recap yet</p>';
  }

  // Editable summary for THIS meeting
  summaryEl.innerHTML = current?.summary || '';
  summaryEl.dataset.meetingId = currentMeetingId;
}

function formatRecap(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^• (.+)$/gm, '<li>$1</li>')
    .replace(/\n/g, '<br>');
}

async function saveSummary() {
  const el = document.getElementById('prev-summary');
  const meetingId = el.dataset.meetingId;
  if (!meetingId) return;
  await db.from('meetings').update({ summary: el.innerHTML }).eq('id', meetingId);
  const btn = document.querySelector('.save-summary');
  btn.textContent = '✓ Saved';
  setTimeout(() => btn.textContent = 'Save', 1500);
}

// --- REALTIME ---
function setupRealtimeSubscriptions() {
  db.channel('all-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'agenda_defaults' }, () => loadAgenda())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, () => { if (currentMeetingId) loadAttendance(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'topics' }, () => loadTopics())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'checkins' }, () => { if (currentMeetingId) loadCheckins(); })
    .subscribe();
}

// --- UTILS ---
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
function formatShortDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}

// --- AUTO LOGIN ---
if (sessionStorage.getItem('pod_auth') === '1') {
  showDashboard();
}
